import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, idempotency-key",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (message: string, status = 400, code?: string) => response({ message, code }, status);

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  const url = new URL(request.url);
  const routeIndex = url.pathname.indexOf("/v1/");
  const route = routeIndex >= 0 ? url.pathname.slice(routeIndex) : url.pathname;
  const authHeader = request.headers.get("Authorization") ?? "";
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
  const body = request.method === "GET" || request.method === "DELETE" ? {} : await request.json().catch(() => ({}));

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
  if (route === "/v1/customer/profile" && request.method === "PATCH") {
    const { data, error } = await client.from("profiles").update({ full_name: body.fullName, phone: body.phone, avatar_url: body.avatarUrl, updated_at: new Date().toISOString() }).eq("id", user.id).select().single();
    return error ? fail(error.message, 400) : response(data);
  }
  const locationMatch = route.match(/^\/v1\/customer\/motorcycles\/([^/]+)\/location$/);
  if (locationMatch && request.method === "GET") {
    const vehicleId = decodeURIComponent(locationMatch[1]);
    const { data: vehicle } = await client.from("vehicles").select("id,registration,model,vehicle_type").eq("id", vehicleId).single();
    if (!vehicle) return fail("Vehicle not found.", 404, "NOT_FOUND");
    const { data: location } = await client.from("tracker_locations").select("latitude,longitude,speed_kph,heading,accuracy_meters,recorded_at").eq("vehicle_id", vehicleId).order("recorded_at", { ascending: false }).limit(1).maybeSingle();
    return response({ ...vehicle, location: location && { latitude: location.latitude, longitude: location.longitude, speedKph: location.speed_kph, heading: location.heading, accuracyMeters: location.accuracy_meters, recordedAt: location.recorded_at } });
  }
  const routeMatch = route.match(/^\/v1\/customer\/motorcycles\/([^/]+)\/route$/);
  if (routeMatch && request.method === "GET") {
    const vehicleId = decodeURIComponent(routeMatch[1]);
    const { data: locations } = await client.from("tracker_locations").select("latitude,longitude,recorded_at").eq("vehicle_id", vehicleId).order("recorded_at", { ascending: true }).limit(500);
    return response({ points: locations ?? [] });
  }
  return fail("Endpoint not implemented yet.", 501, "NOT_IMPLEMENTED");
});
