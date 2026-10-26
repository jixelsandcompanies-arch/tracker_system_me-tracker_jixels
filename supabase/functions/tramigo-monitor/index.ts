import { createClient } from "npm:@supabase/supabase-js@2";

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

function records(value: any): any[] {
  if (Array.isArray(value)) return value;
  for (const key of ["devices", "data", "items", "results"]) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

function value(record: any, keys: string[]) {
  for (const key of keys) {
    const found = record?.[key];
    if (found != null && String(found).trim()) return String(found).trim();
  }
  return null;
}

function locationFrom(report: any) {
  const source = report?.main_reports?.[0] ?? report?.mainReports?.[0] ?? report?.data?.main_reports?.[0] ?? report?.data ?? report;
  const latitude = Number(source?.Latitude ?? source?.latitude);
  const longitude = Number(source?.Longitude ?? source?.longitude);
  const rawTime = source?.DateTimeActual ?? source?.DateTime_Actual ?? source?.DateTime_Received
    ?? report?.DateTimeActual ?? report?.DateTime_Actual ?? report?.DateTime_Received;
  const recordedAt = rawTime == null ? null : new Date(String(rawTime));
  const rawSpeed = source?.Speed ?? source?.speed;
  const speed = rawSpeed == null || rawSpeed === "" ? null : Number(rawSpeed);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  if (!recordedAt || !Number.isFinite(recordedAt.getTime())) return null;
  if (speed !== null && (!Number.isFinite(speed) || speed < 0 || speed > 300)) return null;
  return { latitude, longitude, speedKph: speed, recordedAt: recordedAt.toISOString() };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const base = (Deno.env.get("TRAMIGO_API_BASE_URL") ?? "https://api.tracking.tramigocloud.com").replace(/\/$/, "");
  const username = Deno.env.get("TRAMIGO_USERNAME");
  const password = Deno.env.get("TRAMIGO_PASSWORD");
  if (!supabaseUrl || !serviceRoleKey || !username || !password) return json({ error: "Tramigo monitoring is not configured" }, 503);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: bikes, error: bikeError } = await admin.from("bikes")
    .select("id,identifier,trackers(id,identifier,tramigo_device_id)")
    .eq("monitoring_armed", true)
    .limit(500);
  if (bikeError) {
    console.error("Tramigo monitor could not load armed bikes", bikeError.message);
    return json({ error: "Armed tracker list is unavailable" }, 503);
  }
  const work = (bikes ?? []).flatMap((bike: any) => {
    const relation = bike.trackers;
    const tracker = Array.isArray(relation) ? relation[0] : relation;
    const deviceId = String(tracker?.tramigo_device_id ?? tracker?.identifier ?? "").trim();
    return tracker?.id && deviceId ? [{ trackerId: tracker.id, deviceId }] : [];
  });
  if (!work.length) return json({ scanned: 0, recorded: 0, skipped: 0 });

  const login = await fetch(`${base}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
    signal: AbortSignal.timeout(10_000),
  });
  const loginBody = await login.json().catch(() => ({}));
  const token = loginBody.access_token ?? loginBody.accessToken ?? loginBody.token;
  if (!login.ok || !token) {
    console.error("Tramigo monitor authentication failed", login.status);
    return json({ error: "Tramigo authentication failed" }, 502);
  }

  const catalogueResponse = await fetch(`${base}/api/v2/devices?page=1&per_page=1000`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  const catalogue = await catalogueResponse.json().catch(() => ({}));
  if (!catalogueResponse.ok) return json({ error: "Tramigo device list is unavailable" }, 502);
  const devices = records(catalogue);
  let cursor = 0;
  let recorded = 0;
  let skipped = 0;
  const workers = Array.from({ length: Math.min(5, work.length) }, async () => {
    while (cursor < work.length) {
      const item = work[cursor++];
      const device = devices.find((candidate) => [
        value(candidate, ["Device_ID", "device_id", "ID", "id"]),
        value(candidate, ["IMEI", "imei", "Device_IMEI", "device_imei", "identifier"]),
      ].includes(item.deviceId));
      const cloudId = value(device, ["Device_ID", "device_id", "ID", "id"]);
      if (!cloudId) { skipped += 1; continue; }
      try {
        const reportResponse = await fetch(`${base}/api/reports/last_location/${encodeURIComponent(cloudId)}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
          signal: AbortSignal.timeout(10_000),
        });
        const report = await reportResponse.json().catch(() => ({}));
        const point = reportResponse.ok ? locationFrom(report) : null;
        const ageMs = point ? Date.now() - new Date(point.recordedAt).getTime() : Infinity;
        if (!point || ageMs < 0 || ageMs > 120_000) { skipped += 1; continue; }

        const { data: duplicate } = await admin.from("tracker_locations").select("id")
          .eq("tracker_id", item.trackerId).eq("recorded_at", point.recordedAt).limit(1).maybeSingle();
        if (duplicate) { skipped += 1; continue; }
        const { error: insertError } = await admin.from("tracker_locations").insert({
          vehicle_id: null,
          tracker_id: item.trackerId,
          latitude: point.latitude,
          longitude: point.longitude,
          speed_kph: point.speedKph,
          recorded_at: point.recordedAt,
        });
        if (insertError) {
          console.error("Tramigo report could not be saved", item.trackerId, insertError.message);
          skipped += 1;
        } else recorded += 1;
      } catch (error) {
        console.error("Tramigo report fetch failed", item.trackerId, error instanceof Error ? error.message : "unknown error");
        skipped += 1;
      }
    }
  });
  await Promise.all(workers);

  let pushed = 0;
  const { data: pendingMessages, error: messageError } = await admin.from("alerts")
    .select("id,owner_id,title,body")
    .eq("kind", "movement")
    .is("push_sent_at", null)
    .order("created_at", { ascending: true })
    .limit(100);
  if (messageError) console.error("Movement message push queue could not be loaded", messageError.message);
  for (const message of pendingMessages ?? []) {
    const { data: tokens, error: tokenError } = await admin.from("customer_push_tokens")
      .select("expo_push_token")
      .eq("customer_id", message.owner_id);
    if (tokenError || !tokens?.length) continue;
    const messages = tokens
      .map((row: any) => String(row.expo_push_token ?? ""))
      .filter((pushToken: string) => /^(?:Expo|Exponent)PushToken\[[^\]]+\]$/.test(pushToken))
      .map((pushToken: string) => ({
        to: pushToken,
        sound: "default",
        title: message.title,
        body: message.body,
        data: { type: "movement", eventId: message.id, screen: "alerts", inAppRecorded: true },
      }));
    if (!messages.length) continue;
    try {
      const pushResponse = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(messages),
        signal: AbortSignal.timeout(10_000),
      });
      const pushBody = await pushResponse.json().catch(() => null);
      const tickets = Array.isArray(pushBody?.data) ? pushBody.data : [];
      if (!pushResponse.ok || tickets.length !== messages.length || tickets.some((ticket: any) => ticket?.status !== "ok")) continue;
      const { error: markPushError } = await admin.from("alerts").update({ push_sent_at: new Date().toISOString() })
        .eq("id", message.id).is("push_sent_at", null);
      if (markPushError) console.error("Movement push delivery could not be recorded", message.id, markPushError.message);
      else pushed += 1;
    } catch (error) {
      console.error("Movement push send failed", message.id, error instanceof Error ? error.message : "unknown error");
    }
  }
  return json({ scanned: work.length, recorded, skipped, pushed });
});
