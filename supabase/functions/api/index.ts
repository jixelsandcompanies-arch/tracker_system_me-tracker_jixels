import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, idempotency-key",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (message: string, status = 400, code?: string) => response({ message, code }, status);
const darajaBase = Deno.env.get("DARAJA_ENV") === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";
async function darajaToken() {
  const key = Deno.env.get("DARAJA_CONSUMER_KEY"); const secret = Deno.env.get("DARAJA_CONSUMER_SECRET");
  if (!key || !secret) throw new Error("Daraja credentials are not configured.");
  const result = await fetch(`${darajaBase}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${btoa(`${key}:${secret}`)}` } });
  const data = await result.json().catch(() => ({}));
  if (!result.ok || !data.access_token) throw new Error(data.error_description ?? "Daraja authentication failed.");
  return data.access_token as string;
}
async function darajaPost(path: string, payload: unknown) {
  const result = await fetch(`${darajaBase}${path}`, { method: "POST", headers: { Authorization: `Bearer ${await darajaToken()}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await result.json().catch(() => ({}));
  if (!result.ok) throw new Error(data.errorMessage ?? data.errorDescription ?? "Daraja request failed.");
  return data;
}
function stkPassword(timestamp: string) {
  const shortcode = Deno.env.get("DARAJA_SHORTCODE") ?? "";
  return btoa(`${shortcode}${Deno.env.get("DARAJA_PASSKEY") ?? ""}${timestamp}`);
}
async function tramigoRequest(path: string) {
  const base = (Deno.env.get("TRAMIGO_API_BASE_URL") ?? "https://api.tracking.tramigocloud.com").replace(/\/$/, "");
  const username = Deno.env.get("TRAMIGO_USERNAME"); const password = Deno.env.get("TRAMIGO_PASSWORD");
  if (!username || !password) throw new Error("Tramigo credentials are not configured.");
  const login = await fetch(`${base}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
  const session = await login.json().catch(() => ({}));
  if (!login.ok || !session.access_token) throw new Error("Tramigo authentication failed.");
  const result = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${session.access_token}`, Accept: "application/json" } });
  const data = await result.json().catch(() => ({}));
  if (!result.ok) throw new Error(data.message ?? "Tramigo request failed.");
  return data;
}
function tramigoLocation(report: any) {
  const source = report?.main_reports?.[0] ?? report?.mainReports?.[0] ?? report;
  const latitude = Number(source?.Latitude ?? source?.latitude); const longitude = Number(source?.Longitude ?? source?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude, speedKph: Number(source?.Speed ?? source?.speed ?? 0), recordedAt: source?.DateTimeActual ?? report?.DateTimeActual ?? new Date().toISOString() };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  const url = new URL(request.url);
  const routeIndex = url.pathname.indexOf("/v1/");
  const route = routeIndex >= 0 ? url.pathname.slice(routeIndex) : url.pathname;
  const authHeader = request.headers.get("Authorization") ?? "";
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
  const body = request.method === "GET" || request.method === "DELETE" ? {} : await request.json().catch(() => ({}));

  // Safaricom callbacks are public and must return quickly. Database writes use
  // the service-role client and are idempotent on the transaction receipt.
  if (route === "/v1/mpesa/c2b/validation" && request.method === "POST") {
    const reference = String(body.BillRefNumber ?? "").trim();
    if (!reference) return response({ ResultCode: 1, ResultDesc: "Missing account reference" });
    const { data } = await admin.from("payment_requests").select("id").eq("idempotency_key", reference).maybeSingle();
    return response(data ? { ResultCode: 0, ResultDesc: "Accepted" } : { ResultCode: 1, ResultDesc: "Unknown account reference" });
  }
  if (route === "/v1/mpesa/c2b/confirmation" && request.method === "POST") {
    await admin.from("daraja_transactions").upsert({ direction: "C2B", transaction_id: body.TransID ?? null, account_reference: body.BillRefNumber ?? null, phone: body.MSISDN ?? null, amount: Number(body.TransAmount ?? 0), status: "completed", payload: body, updated_at: new Date().toISOString() }, { onConflict: "transaction_id" });
    return response({ ResultCode: 0, ResultDesc: "Accepted" });
  }
  if (route === "/v1/mpesa/b2c/result" && request.method === "POST") {
    const result = body.Result ?? {}; const parameters = Object.fromEntries((result.ResultParameters?.ResultParameter ?? []).map((item: { Key: string; Value: unknown }) => [item.Key, item.Value]));
    await admin.from("daraja_transactions").upsert({ direction: "B2C", transaction_id: parameters.TransactionReceipt ?? null, conversation_id: result.ConversationID ?? null, originator_conversation_id: result.OriginatorConversationID ?? null, amount: Number(parameters.TransactionAmount ?? 0), status: Number(result.ResultCode) === 0 ? "completed" : "failed", payload: body, updated_at: new Date().toISOString() }, { onConflict: "transaction_id" });
    return response({ ResultCode: 0, ResultDesc: "Accepted" });
  }
  if (route === "/v1/mpesa/b2c/timeout" && request.method === "POST") {
    const result = body.Result ?? body; await admin.from("daraja_transactions").insert({ direction: "B2C", conversation_id: result.ConversationID ?? null, originator_conversation_id: result.OriginatorConversationID ?? null, status: "timeout", payload: body });
    return response({ ResultCode: 0, ResultDesc: "Accepted" });
  }
  if (route === "/v1/mpesa/stk/callback" && request.method === "POST") {
    const callback = body.Body?.stkCallback ?? {}; const items = Object.fromEntries((callback.CallbackMetadata?.Item ?? []).map((item: { Name: string; Value?: unknown }) => [item.Name, item.Value]));
    await admin.from("daraja_transactions").upsert({ direction: "C2B", checkout_request_id: callback.CheckoutRequestID ?? null, transaction_id: items.MpesaReceiptNumber ?? null, phone: items.PhoneNumber ?? null, amount: Number(items.Amount ?? 0), status: Number(callback.ResultCode) === 0 ? "completed" : "failed", payload: body, updated_at: new Date().toISOString() }, { onConflict: "transaction_id" });
    return response({ ResultCode: 0, ResultDesc: "Accepted" });
  }

  if (route === "/v1/auth/login" && request.method === "POST") {
    const { data, error } = await client.auth.signInWithPassword({ email: String(body.email ?? ""), password: String(body.password ?? "") });
    if (error || !data.session || !data.user) return fail("Invalid email or password.", 401, "INVALID_CREDENTIALS");
    return response({ accessToken: data.session.access_token, expiresAt: new Date(data.session.expires_at! * 1000).toISOString(), user: { id: data.user.id, email: data.user.email } });
  }
  if (route === "/v1/auth/register" && request.method === "POST") {
    const { data, error } = await client.auth.signUp({ email: String(body.email ?? ""), password: String(body.password ?? ""), options: { data: { full_name: body.fullName ?? body.name, phone: body.phone } } });
    if (error) return fail(error.message, 400, "REGISTRATION_FAILED");
    return response({ user: data.user, message: "Check your email to confirm your account." }, 201);
  }
  if (route === "/v1/auth/request-admin-otp" && request.method === "POST") {
    const identifier = String(body.identifier ?? "").trim(); const purpose = String(body.purpose ?? "app-access");
    const email = identifier.includes("@");
    if (!identifier || (!email && !/^\+?\d{10,15}$/.test(identifier.replace(/\s/g, "")))) return fail("A valid email address or phone number is required.", 422, "INVALID_IDENTIFIER");
    const { error } = email
      ? await client.auth.signInWithOtp({ email: identifier.toLowerCase(), options: { shouldCreateUser: purpose === "account-approval" } })
      : await client.auth.signInWithOtp({ phone: identifier.replace(/\s/g, ""), options: { shouldCreateUser: purpose === "account-approval" } });
    if (error) return fail(error.message, 400, "OTP_SEND_FAILED");
    return response({ accepted: true, expiresInSeconds: 300 });
  }
  if (route === "/v1/auth/verify-admin-otp" && request.method === "POST") {
    const identifier = String(body.identifier ?? "").trim(); const code = String(body.code ?? "").trim();
    if (!identifier || !/^\d{6}$/.test(code)) return fail("Enter the six-digit verification code.", 422, "INVALID_OTP");
    const email = identifier.includes("@");
    const { data, error } = email
      ? await client.auth.verifyOtp({ email: identifier.toLowerCase(), token: code, type: "email" })
      : await client.auth.verifyOtp({ phone: identifier.replace(/\s/g, ""), token: code, type: "sms" });
    if (error || !data.session || !data.user) return fail(error?.message ?? "The code is invalid or expired.", 401, "OTP_INVALID_OR_EXPIRED");
    return response({ verified: true, accessToken: data.session.access_token, expiresAt: new Date(data.session.expires_at! * 1000).toISOString(), user: { id: data.user.id, email: data.user.email, phone: data.user.phone } });
  }

  if (route === "/v1/mpesa/c2b/register" && request.method === "POST") {
    try {
      const shortcode = Deno.env.get("DARAJA_SHORTCODE");
      if (!shortcode || !Deno.env.get("DARAJA_C2B_CONFIRMATION_URL") || !Deno.env.get("DARAJA_C2B_VALIDATION_URL")) return fail("C2B Daraja secrets are not configured.", 503, "MPESA_NOT_CONFIGURED");
      return response(await darajaPost("/mpesa/c2b/v2/registerurl", { ShortCode: shortcode, ResponseType: "Cancelled", ConfirmationURL: Deno.env.get("DARAJA_C2B_CONFIRMATION_URL"), ValidationURL: Deno.env.get("DARAJA_C2B_VALIDATION_URL") }));
    } catch (error) { return fail(error instanceof Error ? error.message : "C2B registration failed.", 502, "MPESA_ERROR"); }
  }

  const { data: identity } = await client.auth.getUser();
  const user = identity.user;
  if (!user) return fail("Authentication is required.", 401, "UNAUTHORIZED");

  if (route === "/v1/customer/overview" && request.method === "GET") {
    const [{ data: profile }, { data: vehicles }] = await Promise.all([
      client.from("profiles").select("full_name,phone,avatar_url").single(),
      client.from("vehicles").select("id,registration,model,vehicle_type,monitoring_armed,immobilized"),
    ]);
    return response({ profile, vehicles: vehicles ?? [] });
  }
  if (route === "/v1/customer/payments/mpesa" && request.method === "POST") {
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim(); const amount = Number(body.amount); const phone = String(body.phone ?? "").replace(/\D/g, "");
    if (!idempotencyKey || !Number.isFinite(amount) || amount <= 0 || !/^254\d{9}$/.test(phone)) return fail("Valid amount, Kenyan phone number, and Idempotency-Key are required.", 422, "INVALID_PAYMENT");
    const { data: existing } = await client.from("payment_requests").select("id,status").eq("idempotency_key", idempotencyKey).maybeSingle(); if (existing) return response(existing);
    const { data: vehicle } = await client.from("vehicles").select("id").eq("id", body.vehicleId).single(); if (!vehicle) return fail("Vehicle not found.", 404, "NOT_FOUND");
    const { data: payment, error } = await client.from("payment_requests").insert({ owner_id: user.id, vehicle_id: vehicle.id, idempotency_key: idempotencyKey, amount, phone, status: "processing" }).select("id,status").single(); if (error) return fail(error.message, 400);
    try { const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14); const result = await darajaPost("/mpesa/stkpush/v1/processrequest", { BusinessShortCode: Deno.env.get("DARAJA_SHORTCODE"), Password: stkPassword(timestamp), Timestamp: timestamp, TransactionType: "CustomerPayBillOnline", Amount: amount, PartyA: phone, PartyB: Deno.env.get("DARAJA_SHORTCODE"), PhoneNumber: phone, CallBackURL: Deno.env.get("DARAJA_STK_CALLBACK_URL"), AccountReference: idempotencyKey.slice(0, 12), TransactionDesc: "Tracker service payment" }); await client.from("daraja_transactions").insert({ direction: "C2B", checkout_request_id: result.CheckoutRequestID ?? null, account_reference: idempotencyKey, phone, amount, status: "submitted", payload: result }); return response({ ...payment, ...result }, 202); }
    catch (cause) { await client.from("payment_requests").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", payment.id); return fail(cause instanceof Error ? cause.message : "M-Pesa request failed.", 502, "MPESA_ERROR"); }
  }
  if (route === "/v1/customer/profile" && request.method === "PATCH") {
    const { data, error } = await client.from("profiles").update({ full_name: body.fullName, phone: body.phone, avatar_url: body.avatarUrl, updated_at: new Date().toISOString() }).eq("id", user.id).select().single();
    return error ? fail(error.message, 400) : response(data);
  }
  const locationMatch = route.match(/^\/v1\/customer\/motorcycles\/([^/]+)\/location$/);
  if (locationMatch && request.method === "GET") {
    const vehicleId = decodeURIComponent(locationMatch[1]);
    const { data: vehicle } = await client.from("vehicles").select("id,registration,model,vehicle_type,tracker_imei").eq("id", vehicleId).single();
    if (!vehicle) return fail("Vehicle not found.", 404, "NOT_FOUND");
    let location = null;
    if (vehicle.tracker_imei && Deno.env.get("TRAMIGO_USERNAME")) {
      try {
        const tramigo = tramigoLocation(await tramigoRequest(`/api/reports/last_location/${encodeURIComponent(vehicle.tracker_imei)}`));
        if (tramigo) { await admin.from("tracker_locations").insert({ vehicle_id: vehicleId, latitude: tramigo.latitude, longitude: tramigo.longitude, speed_kph: tramigo.speedKph, recorded_at: tramigo.recordedAt }); location = { latitude: tramigo.latitude, longitude: tramigo.longitude, speedKph: tramigo.speedKph, recordedAt: tramigo.recordedAt }; }
      } catch (_) { /* fall back to the last synced location */ }
    }
    if (!location) { const { data: saved } = await client.from("tracker_locations").select("latitude,longitude,speed_kph,heading,accuracy_meters,recorded_at").eq("vehicle_id", vehicleId).order("recorded_at", { ascending: false }).limit(1).maybeSingle(); location = saved && { latitude: saved.latitude, longitude: saved.longitude, speedKph: saved.speed_kph, heading: saved.heading, accuracyMeters: saved.accuracy_meters, recordedAt: saved.recorded_at }; }
    return response({ ...vehicle, location });
  }
  const routeMatch = route.match(/^\/v1\/customer\/motorcycles\/([^/]+)\/route$/);
  if (routeMatch && request.method === "GET") {
    const vehicleId = decodeURIComponent(routeMatch[1]);
    const { data: locations } = await client.from("tracker_locations").select("latitude,longitude,recorded_at").eq("vehicle_id", vehicleId).order("recorded_at", { ascending: true }).limit(500);
    return response({ points: locations ?? [] });
  }
  return fail("Endpoint not implemented yet.", 501, "NOT_IMPLEMENTED");
});
