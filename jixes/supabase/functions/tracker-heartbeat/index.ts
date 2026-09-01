// Deploy with: supabase functions deploy tracker-heartbeat --no-verify-jwt
// Authenticate trackers with a per-device HMAC or gateway token in production.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const expected = Deno.env.get("TRACKER_INGEST_TOKEN");
  if (!expected || request.headers.get("x-tracker-token") !== expected) return new Response("Unauthorized", { status: 401 });
  try {
    const { trackerId, latitude, longitude, batteryPercent } = await request.json();
    if (!trackerId || !Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) return Response.json({ error: "trackerId, latitude and longitude are required" }, { status: 400 });
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data, error } = await admin.rpc("record_tracker_heartbeat", { tracker_identifier: trackerId, tracker_latitude: latitude, tracker_longitude: longitude, tracker_battery: batteryPercent ?? null });
    if (error) return Response.json({ error: error.message }, { status: 404 });
    return Response.json({ tracker: data, receivedAt: new Date().toISOString() });
  } catch { return Response.json({ error: "Invalid heartbeat payload" }, { status: 400 }); }
});
