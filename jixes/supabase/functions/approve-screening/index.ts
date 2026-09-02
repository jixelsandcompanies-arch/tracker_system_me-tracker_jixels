import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ message: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const auth = createClient(url, anon, { global: { headers: { Authorization: request.headers.get("Authorization") || "" } } });
  const admin = createClient(url, service);
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return json({ message: "Unauthorized" }, 401);
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
  if (!profile || !["super_admin", "operations_manager"].includes(profile.role)) return json({ message: "Approval requires a manager role" }, 403);
  const { applicationId } = await request.json();
  const { data: application, error } = await admin.from("screening_applications").select("*").eq("id", applicationId).single();
  if (error || !application) return json({ message: "Application not found" }, 404);
  const identifier = application.email || application.phone;
  if (!identifier) return json({ message: "Customer email or phone is required before approval" }, 400);
  const code = crypto.getRandomValues(new Uint32Array(1))[0].toString().padStart(10, "0").slice(0, 6);
  const encoded = new TextEncoder().encode(`${code}:${application.id}`);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const codeHash = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  await admin.from("approval_otps").update({ consumed_at: new Date().toISOString() }).eq("application_id", application.id).is("consumed_at", null);
  const { error: otpError } = await admin.from("approval_otps").insert({ application_id: application.id, identifier, code_hash: codeHash, expires_at: new Date(Date.now() + 10 * 60_000).toISOString() });
  if (otpError) return json({ message: otpError.message }, 500);
  const now = new Date().toISOString();
  const { error: applicationError } = await admin.from("screening_applications")
    .update({ status: "approved", reviewed_by: user.id, reviewed_at: now, approved_at: now })
    .eq("id", application.id);
  if (applicationError) return json({ message: applicationError.message }, 500);
  // Customer sign-in is authorized from the shared profile table.  Approving a
  // screening application without this update made an approved customer remain
  // blocked in the customer portal.
  const profileQuery = application.email
    ? admin.from("profiles").update({ account_status: "approved", updated_at: now }).ilike("email", application.email)
    : admin.from("profiles").update({ account_status: "approved", updated_at: now }).eq("phone", application.phone);
  const { error: profileError } = await profileQuery;
  if (profileError) return json({ message: profileError.message }, 500);
  await admin.from("customer_notifications").insert({ customer_id: application.customer_id, recipient_email: application.email, recipient_phone: application.phone, kind: "account_approved", title: "Your Jixels account is approved", message: `Your one-time login code is ${code}. It expires in 10 minutes.` });
  return json({ approved: true, notificationCreated: true });
});
