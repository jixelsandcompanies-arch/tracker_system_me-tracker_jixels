import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-tracker-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
});

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const expectedToken = Deno.env.get("TRACKER_INGEST_TOKEN");
  if (!expectedToken || request.headers.get("x-tracker-token") !== expectedToken) {
    return json({ error: "Unauthorized tracker" }, 401);
  }

  let payload: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json({ error: "JSON object required" }, 400);
    payload = parsed as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid JSON payload" }, 400);
  }

  const trackerId = String(payload.trackerId ?? payload.tracker_id ?? "").trim();
  const latitudeValue = payload.latitude;
  const longitudeValue = payload.longitude;
  const hasLatitude = latitudeValue !== undefined && latitudeValue !== null && latitudeValue !== "";
  const hasLongitude = longitudeValue !== undefined && longitudeValue !== null && longitudeValue !== "";
  const latitude = hasLatitude ? Number(latitudeValue) : null;
  const longitude = hasLongitude ? Number(longitudeValue) : null;
  const batteryValue = payload.batteryPercent ?? payload.battery_percent;
  const battery = batteryValue === undefined || batteryValue === null || batteryValue === "" ? null : Number(batteryValue);
  const recordedValue = payload.recordedAt ?? payload.recorded_at;
  const recordedAt = recordedValue == null || recordedValue === "" ? null : new Date(String(recordedValue));

  if (!trackerId) return json({ error: "trackerId is required" }, 400);
  if (hasLatitude !== hasLongitude) return json({ error: "latitude and longitude must be provided together" }, 400);
  if ((hasLatitude && (!Number.isFinite(latitude) || latitude! < -90 || latitude! > 90 || !Number.isFinite(longitude) || longitude! < -180 || longitude! > 180))) {
    return json({ error: "Coordinates are invalid" }, 400);
  }
  if (battery !== null && (!Number.isInteger(battery) || battery < 0 || battery > 100)) return json({ error: "batteryPercent must be an integer from 0 to 100" }, 400);
  if (recordedAt && !Number.isFinite(recordedAt.getTime())) return json({ error: "recordedAt must be a valid timestamp" }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "Tracker ingest is not configured" }, 503);
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.rpc("record_tracker_heartbeat", {
    tracker_identifier: trackerId,
    tracker_latitude: latitude,
    tracker_longitude: longitude,
    tracker_battery: battery,
    tracker_recorded_at: recordedAt?.toISOString() ?? null,
  });
  if (error) {
    const unknownTracker = error.message.includes("Unknown tracker");
    console.error("Tracker heartbeat could not be recorded", { trackerId, error: error.message });
    return json({ error: unknownTracker ? "Tracker is not registered" : "Heartbeat could not be recorded" }, unknownTracker ? 404 : 500);
  }
  return json({ accepted: true, trackerId: data.identifier, lastSeenAt: data.last_seen_at, batteryPercent: data.battery_percent });
});
