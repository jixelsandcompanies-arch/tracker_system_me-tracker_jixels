import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, idempotency-key",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const fail = (message: string, status = 400, code?: string, details?: Record<string, unknown>) => response({ message, code, details }, status);
const CUSTOMER_MONTHLY_AMOUNT = 750;
const confirmedPaymentStatuses = ["paid", "completed", "confirmed"];
function addBillingMonth(date: Date, anchorDay = date.getUTCDate()) {
  const next = new Date(date);
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(anchorDay, lastDay));
  return next;
}
async function customerMonthlyBilling(admin: SupabaseClient, ownerId: string) {
  const { data: profile, error: profileError } = await admin.from("profiles").select("email").eq("id", ownerId).maybeSingle();
  if (profileError) throw new Error("Customer billing status is temporarily unavailable.");
  const email = String(profile?.email ?? "").trim();
  const { data: customer, error: customerError } = email
    ? await admin.from("customers").select("id").ilike("email", email).maybeSingle()
    : { data: null, error: null };
  if (customerError) throw new Error("Customer billing status is temporarily unavailable.");
  if (!customer?.id) return { locked: false, monthlyAmount: CUSTOMER_MONTHLY_AMOUNT, amountDue: 0, overdueSince: null, vehicles: [] as any[] };
  const [{ data: bikes, error: bikesError }, { data: applications, error: applicationsError }] = await Promise.all([
    admin.from("bikes").select("id,identifier").eq("customer_id", customer.id),
    admin.from("screening_applications").select("product_id,monthly_service_amount,monthly_service_started_at,approved_at,created_at").eq("customer_id", customer.id).eq("status", "approved"),
  ]);
  if (bikesError || applicationsError) throw new Error("Customer billing status is temporarily unavailable.");
  const bikeIds = (bikes ?? []).map((bike: any) => String(bike.id));
  if (!bikeIds.length) return { locked: false, monthlyAmount: CUSTOMER_MONTHLY_AMOUNT, amountDue: 0, overdueSince: null, vehicles: [] as any[] };
  const { data: payments, error: paymentsError } = await admin.from("payments")
    .select("product_id,amount,payment_type,paid_at,created_at,status")
    .eq("customer_id", customer.id).in("product_id", bikeIds).in("status", confirmedPaymentStatuses)
    .order("paid_at", { ascending: true, nullsFirst: true });
  if (paymentsError) throw new Error("Customer billing status is temporarily unavailable.");
  const appByBike = new Map((applications ?? []).map((application: any) => [String(application.product_id), application]));
  const result = bikeIds.map((bikeId) => {
    const application: any = appByBike.get(bikeId);
    const fee = CUSTOMER_MONTHLY_AMOUNT;
    const startValue = application?.monthly_service_started_at ?? application?.approved_at ?? application?.created_at;
    const started = startValue ? new Date(startValue) : null;
    if (!started || !Number.isFinite(started.getTime()) || fee <= 0) return { bikeId, monthlyAmount: fee, locked: false, amountDue: 0, overdueSince: null };
    const cycles: Array<{ start: number; due: number; paid: number }> = [];
    let cycleStart = started;
    let cycleDue = addBillingMonth(cycleStart, started.getUTCDate());
    const now = Date.now();
    for (let count = 0; cycleDue.getTime() <= now && count < 240; count++) {
      cycles.push({ start: cycleStart.getTime(), due: cycleDue.getTime(), paid: 0 });
      cycleStart = cycleDue;
      cycleDue = addBillingMonth(cycleStart, started.getUTCDate());
    }
    const transactions = (payments ?? []).filter((payment: any) => String(payment.product_id) === bikeId
      && String(payment.payment_type ?? "daily").toLowerCase().replace(/[ _-]/g, "") !== "deposit")
      .map((payment: any) => ({ amount: Math.max(0, Number(payment.amount ?? 0)), at: new Date(payment.paid_at ?? payment.created_at).getTime() }))
      .filter((payment: any) => payment.amount > 0 && Number.isFinite(payment.at) && payment.at >= started.getTime());
    for (const transaction of transactions) {
      let remaining = transaction.amount;
      while (remaining > 0) {
        const cycle = cycles.find((item) => item.start <= transaction.at && item.paid < fee);
        if (!cycle) break;
        const allocated = Math.min(remaining, fee - cycle.paid);
        cycle.paid += allocated;
        remaining -= allocated;
      }
    }
    const unpaid = cycles.filter((cycle) => cycle.paid < fee);
    return { bikeId, monthlyAmount: fee, locked: unpaid.length > 0, amountDue: unpaid.reduce((sum, cycle) => sum + Math.ceil(fee - cycle.paid), 0), overdueSince: unpaid.length ? new Date(unpaid[0].due).toISOString() : null };
  });
  const overdue = result.filter((vehicle) => vehicle.locked);
  return { locked: overdue.length > 0, monthlyAmount: CUSTOMER_MONTHLY_AMOUNT, amountDue: overdue.reduce((sum, vehicle) => sum + vehicle.amountDue, 0), overdueSince: overdue.map((vehicle) => vehicle.overdueSince).filter(Boolean).sort()[0] ?? null, vehicles: result };
}
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
  if (!result.ok) throw new Error(data.errorMessage ?? data.errorDescription ?? data.error_description ?? data.error ?? "Daraja request failed.");
  return data;
}
function stkCheckoutRequestId(result: any) {
  if (String(result?.ResponseCode ?? "") !== "0") {
    throw new Error(String(result?.ResponseDescription ?? result?.CustomerMessage ?? "Safaricom did not accept the STK request."));
  }
  const checkoutRequestId = String(result?.CheckoutRequestID ?? "");
  if (!checkoutRequestId) throw new Error("Safaricom accepted no checkout request ID.");
  return checkoutRequestId;
}
function stkPassword(timestamp: string) {
  const shortcode = Deno.env.get("DARAJA_SHORTCODE") ?? "";
  return btoa(`${shortcode}${Deno.env.get("DARAJA_PASSKEY") ?? ""}${timestamp}`);
}
function tramigoPath(template: string, deviceId: string) {
  return template.replace(/\{(?:deviceId|imei|tracker_imei)\}|:deviceId/g, encodeURIComponent(deviceId));
}
type TramigoSession = { base: string; token: string };
async function tramigoSession(): Promise<TramigoSession> {
  const base = (Deno.env.get("TRAMIGO_API_BASE_URL") ?? Deno.env.get("TRAMIGO_API_URL") ?? "https://api.tracking.tramigocloud.com").replace(/\/$/, "");
  const username = Deno.env.get("TRAMIGO_USERNAME"); const password = Deno.env.get("TRAMIGO_PASSWORD");
  if (!username || !password) throw new Error("Tramigo credentials are not configured.");
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10_000);
  let login: Response;
  try {
    login = await fetch(`${base}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }), signal: controller.signal });
  } finally { clearTimeout(timer); }
  const session = await login.json().catch(() => ({}));
  const token = session.access_token ?? session.accessToken ?? session.token;
  if (!login.ok || !token) throw new Error("Tramigo authentication failed.");
  return { base, token: String(token) };
}
async function tramigoRequest(path: string, options: { method?: string; body?: unknown } = {}, existingSession?: TramigoSession) {
  // Reuse one short-lived Tramigo login for a fleet refresh. This avoids one
  // provider login per tracker while keeping credentials server-side only.
  const session = existingSession ?? await tramigoSession();
  const resultController = new AbortController(); const resultTimer = setTimeout(() => resultController.abort(), 10_000);
  let result: Response;
  try {
    result = await fetch(`${session.base}${path}`, { method: options.method ?? "GET", headers: { Authorization: `Bearer ${session.token}`, Accept: "application/json", ...(options.body == null ? {} : { "Content-Type": "application/json" }) }, body: options.body == null ? undefined : JSON.stringify(options.body), signal: resultController.signal });
  } finally { clearTimeout(resultTimer); }
  const data = await result.json().catch(() => ({}));
  if (!result.ok) throw new Error(data.message ?? "Tramigo request failed.");
  return data;
}
function tramigoDeviceRecords(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  for (const key of ["devices", "data", "items", "results"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}
function tramigoValue(record: any, names: string[]) {
  for (const name of names) {
    const value = record?.[name];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return null;
}
// Tramigo report endpoints require the Cloud Device_ID. Operations may store
// the tracker IMEI instead, so resolve it through the documented v2 devices
// endpoint before requesting last_location.
async function tramigoCloudDeviceId(identifier: string, catalogue?: any, session?: TramigoSession) {
  const requested = String(identifier).trim();
  const deviceList = catalogue ?? await tramigoRequest("/api/v2/devices?page=1&per_page=1000", {}, session);
  const device = tramigoDeviceRecords(deviceList).find((item) => [
    tramigoValue(item, ["Device_ID", "device_id", "ID", "id"]),
    tramigoValue(item, ["IMEI", "imei", "Device_IMEI", "device_imei", "identifier"]),
  ].includes(requested));
  const cloudId = tramigoValue(device, ["Device_ID", "device_id", "ID", "id"]);
  if (!cloudId) throw new Error(`Tramigo device ${requested} was not found in the configured account.`);
  return cloudId;
}
function tramigoCatalogueDevice(catalogue: any, cloudDeviceId: string) {
  return tramigoDeviceRecords(catalogue).find((item) => String(tramigoValue(item, ["Device_ID", "device_id", "ID", "id"]) ?? "") === String(cloudDeviceId));
}
function tramigoCatalogueStatus(record: any) {
  const source = record?.device ?? record?.Device ?? record?.connection ?? record?.Connection ?? record?.state ?? record?.State ?? record;
  const value = source?.IsOnline ?? source?.isOnline ?? source?.Online ?? source?.online ?? source?.ConnectionStatus ?? source?.connectionStatus ?? source?.Connectivity ?? source?.connectivity ?? source?.IsConnected ?? source?.isConnected ?? source?.IsActive ?? source?.isActive ?? source?.Active ?? source?.active ?? source?.DeviceStatus ?? source?.deviceStatus ?? source?.Status ?? source?.status ?? source?.State ?? source?.state;
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["online", "active", "connected", "available", "true", "1"].includes(normalized) ? "online" : ["offline", "inactive", "disconnected", "unavailable", "false", "0"].includes(normalized) ? "offline" : null;
}
function tramigoCatalogueLastSeen(record: any) {
  const source = record?.device ?? record?.Device ?? record?.connection ?? record?.Connection ?? record?.state ?? record?.State ?? record;
  const value = source?.LastSeen ?? source?.lastSeen ?? source?.LastSeenAt ?? source?.last_seen_at ?? source?.LastCommunication ?? source?.lastCommunication ?? source?.LastCommunicationTime ?? source?.lastCommunicationTime ?? source?.LastUpdate ?? source?.lastUpdate ?? source?.LastActivity ?? source?.lastActivity ?? source?.LastActivityAt ?? source?.lastActivityAt ?? source?.DateTime_Actual ?? source?.DateTimeActual ?? source?.DateTime_Received ?? source?.DateTimeReceived;
  return value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString() : null;
}
function safeLiveTimestamp(value: unknown) {
  const parsed = new Date(String(value ?? ""));
  if (!Number.isFinite(parsed.getTime())) return new Date().toISOString();
  // Device clocks and timezone-less Tramigo values can be ahead of the API
  // server. Never display a live timestamp from the future.
  return parsed.getTime() > Date.now() + 5 * 60_000 ? new Date().toISOString() : parsed.toISOString();
}
function tramigoLocation(report: any) {
  const source = report?.main_reports?.[0] ?? report?.mainReports?.[0] ?? report;
  const latitude = Number(source?.Latitude ?? source?.latitude); const longitude = Number(source?.Longitude ?? source?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  // Tramigo status can be returned at either report level. Do not infer an
  // active device from an old report; return its explicit connection state so
  // the mobile app can use it ahead of timestamp ageing.
  const statusValue = report?.IsOnline ?? report?.isOnline ?? report?.Online ?? report?.online
    ?? report?.DeviceStatus ?? report?.deviceStatus ?? report?.ConnectionStatus ?? report?.connectionStatus ?? report?.IsActive ?? report?.isActive ?? report?.Active ?? report?.active
    ?? source?.IsOnline ?? source?.isOnline ?? source?.Online ?? source?.online
    ?? source?.DeviceStatus ?? source?.deviceStatus ?? source?.ConnectionStatus ?? source?.connectionStatus ?? source?.IsActive ?? source?.isActive ?? source?.Active ?? source?.active;
  const normalizedStatus = typeof statusValue === "boolean" ? (statusValue ? "online" : "offline") : String(statusValue ?? "").trim().toLowerCase();
  const trackerStatus = ["online", "active", "connected", "available", "true", "1"].includes(normalizedStatus)
    ? "online"
    : ["offline", "inactive", "disconnected", "unavailable", "false", "0"].includes(normalizedStatus) ? "offline" : null;
  const batteryValue = source?.BatteryPercent ?? source?.batteryPercent ?? source?.battery_percent ?? source?.Battery_Level_Percent ?? source?.batteryLevelPercent ?? source?.battery_level_percent;
  const parsedBattery = batteryValue == null ? null : Number(batteryValue);
  const batteryPercent = parsedBattery !== null && Number.isInteger(parsedBattery) && parsedBattery >= 0 && parsedBattery <= 100 ? parsedBattery : null;
  const rawSpeed = source?.Speed ?? source?.speed;
  const parsedSpeed = rawSpeed == null || rawSpeed === "" ? null : Number(rawSpeed);
  // Prefer Tramigo's receipt time for "last update". Device GPS clocks can
  // be ahead, making the UI show zero before falling back to an older point.
  const rawRecordedAt = source?.DateTime_Received ?? source?.DateTimeReceived ?? report?.DateTime_Received ?? report?.DateTimeReceived ?? source?.DateTimeActual ?? source?.DateTime_Actual ?? report?.DateTimeActual ?? report?.DateTime_Actual;
  const parsedRecordedAt = rawRecordedAt == null ? null : new Date(String(rawRecordedAt));
  return {
    latitude,
    longitude,
    speedKph: parsedSpeed !== null && Number.isFinite(parsedSpeed) && parsedSpeed >= 0 && parsedSpeed <= 300 ? parsedSpeed : null,
    recordedAt: parsedRecordedAt && Number.isFinite(parsedRecordedAt.getTime()) ? safeLiveTimestamp(parsedRecordedAt.toISOString()) : null,
    trackerStatus,
    batteryPercent,
  };
}

async function fetchLatestTramigoLocation(identifier: string, existingSession?: TramigoSession, existingCatalogue?: any) {
  const session = existingSession ?? await tramigoSession();
  const catalogue = existingCatalogue ?? await tramigoRequest("/api/v2/devices?page=1&per_page=1000", {}, session);
  const cloudDeviceId = await tramigoCloudDeviceId(identifier, catalogue, session);
  const locationReport = tramigoLocation(await tramigoRequest(`/api/reports/last_location/${encodeURIComponent(cloudDeviceId)}`, {}, session));
  if (locationReport?.speedKph != null) return locationReport;
  // Tramigo's location endpoint can omit speed. The existing /reports/last
  // integration returns the latest report with speed when the device sent it.
  // Choose by report timestamp so the speed fallback never replaces a newer fix.
  let latestReport = null;
  try { latestReport = tramigoLocation(await tramigoRequest(`/api/reports/last/${encodeURIComponent(cloudDeviceId)}`, {}, session)); } catch (_) { /* last_location remains the fallback */ }
  return latestReport?.recordedAt && (!locationReport || new Date(latestReport.recordedAt).getTime() >= new Date(locationReport.recordedAt).getTime())
    ? latestReport
    : locationReport;
}

function reportIsFresh(location: any, maxAgeMs = 60_000) {
  if (!location?.recordedAt || location.speedKph == null || !Number.isFinite(Number(location.speedKph))) return false;
  return reportPositionIsFresh(location, maxAgeMs);
}

function reportPositionIsFresh(location: any, maxAgeMs = 60_000) {
  if (!Number.isFinite(Number(location?.latitude)) || !Number.isFinite(Number(location?.longitude)) || !location?.recordedAt) return false;
  const ageMs = Date.now() - new Date(location.recordedAt).getTime();
  return Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= maxAgeMs;
}

function distanceMeters(first: { latitude: number; longitude: number }, second: { latitude: number; longitude: number }) {
  const radians = (value: number) => value * Math.PI / 180;
  const latitudeDelta = radians(second.latitude - first.latitude);
  const longitudeDelta = radians(second.longitude - first.longitude);
  const firstLatitude = radians(first.latitude);
  const secondLatitude = radians(second.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function tramigoReportRecords(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  for (const key of ["data", "items", "results", "reports"]) if (Array.isArray(payload?.[key])) return payload[key];
  if (payload?.data && typeof payload.data === "object") return tramigoReportRecords(payload.data);
  return [];
}

function tramigoRouteLocations(payload: any) {
  return tramigoReportRecords(payload).map((report) => {
    const source = report?.main_reports?.[0] ?? report?.mainReports?.[0] ?? report;
    const latitude = Number(source?.Latitude ?? source?.latitude); const longitude = Number(source?.Longitude ?? source?.longitude);
    const recordedAt = source?.DateTimeActual ?? source?.DateTime_Actual ?? source?.datetime_actual ?? source?.dateTime ?? source?.timestamp ?? report?.DateTimeActual ?? report?.DateTime_Actual ?? report?.DateTime_Received;
    const rawSpeed = source?.Speed ?? source?.speed;
    const parsedSpeed = rawSpeed == null || rawSpeed === "" ? null : Number(rawSpeed);
    return { latitude, longitude, speedKph: parsedSpeed != null && Number.isFinite(parsedSpeed) && parsedSpeed >= 0 && parsedSpeed <= 300 ? parsedSpeed : null, recordedAt };
  }).filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude) && point.latitude >= -90 && point.latitude <= 90 && point.longitude >= -180 && point.longitude <= 180 && point.recordedAt);
}

async function fetchTramigoRoute(identifier: string, window: { from: string; to: string }, session: TramigoSession, catalogue: any) {
  const cloudDeviceId = await tramigoCloudDeviceId(identifier, catalogue, session);
  const params = new URLSearchParams({ page: "1", per_page: "100", start_date: window.from.replace("T", " ").replace(/\.\d{3}Z$/, ""), end_date: window.to.replace("T", " ").replace(/\.\d{3}Z$/, "") });
  const payload = await tramigoRequest(`/api/reports/${encodeURIComponent(cloudDeviceId)}?${params}`, {}, session);
  const points = tramigoRouteLocations(payload);
  const records = tramigoReportRecords(payload);
  const first = records[0] ?? {}; const last = records.at(-1) ?? {};
  const firstMain = first?.main_reports?.[0] ?? first?.mainReports?.[0] ?? {};
  const lastMain = last?.main_reports?.[0] ?? last?.mainReports?.[0] ?? {};
  const value = (record: any, keys: string[]) => keys.map((key) => record?.[key]).find((item) => item != null && String(item).trim() !== "") ?? null;
  const infoText = records.flatMap((record) => record?.info_reports ?? record?.infoReports ?? []).map((item) => String(item?.Info_Details ?? item?.infoDetails ?? "")).filter(Boolean).join(" | ");
  const infoValue = (label: string) => infoText.match(new RegExp(`${label}\\s*[:=]\\s*([^|]+)`, "i"))?.[1]?.trim() ?? null;
  const firstEvent = value(first, ["HeaderString", "headerString", "Type", "type"]);
  const lastEvent = value(last, ["HeaderString", "headerString", "Type", "type"]);
  const trip = records.flatMap((record) => record?.trip_reports ?? record?.tripReports ?? []).at(0) ?? {};
  return {
    points,
    summary: {
      start: { event: firstEvent, time: value(first, ["DateTime_Actual", "DateTimeActual", "StartTime"]) ?? value(trip, ["StartTime"]), landmark: value(firstMain, ["Landmark", "landmark"]) ?? firstEvent, latitude: points[0]?.latitude ?? null, longitude: points[0]?.longitude ?? null },
      end: { event: lastEvent, time: value(last, ["DateTime_Actual", "DateTimeActual", "EndTime"]) ?? value(trip, ["EndTime"]), landmark: value(lastMain, ["Landmark", "landmark"]) ?? lastEvent, latitude: points.at(-1)?.latitude ?? null, longitude: points.at(-1)?.longitude ?? null },
      battery: value(last, ["Battery", "battery", "BatteryLevel", "batteryLevel"]) ?? infoValue("Battery"), satellite: value(last, ["Satellite", "satellite", "Satellites", "satellites"]) ?? infoValue("Satellite"), gsm: value(last, ["GSM", "gsm", "Gsm", "SignalStrength"]) ?? infoValue("GSM"), parkedTime: value(last, ["ParkedTime", "parkedTime"]) ?? infoValue("Parked Time"), fuel: value(last, ["Fuel", "fuel", "FuelAnalog", "fuelAnalog"]) ?? infoValue("Fuel \\(Analog\\)") ?? infoValue("Fuel"), zone: value(last, ["Zone", "zone", "Geofence", "geofence"]) ?? infoValue("Zone") ?? "No Geofence",
    },
  };
}

function routeWindow(url: URL) {
  const now = new Date();
  const range = String(url.searchParams.get("range") ?? "today").toLowerCase();
  let from = url.searchParams.get("from");
  let to = url.searchParams.get("to");
  if (!from && !to) {
    const days = range === "today" || range === "yesterday" ? 1 : range === "7-days" || range === "7days" ? 7 : range === "30-days" || range === "30days" ? 30 : Number.NaN;
    if (!Number.isInteger(days)) return { error: "Route range must be today, yesterday, 7-days, or 30-days." };
    if (range === "yesterday") {
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      to = end.toISOString(); from = new Date(end.getTime() - 24 * 60 * 60 * 1000).toISOString();
    } else {
      to = now.toISOString(); from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
    }
  }
  const start = new Date(String(from));
  const end = new Date(String(to ?? now.toISOString()));
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) return { error: "Route dates are invalid. Use ISO dates with from before to." };
  if (end.getTime() - start.getTime() > 31 * 24 * 60 * 60 * 1000) return { error: "Route history is limited to 31 days per request." };
  return { from: start.toISOString(), to: end.toISOString() };
}

function routeSummary(points: Array<{ latitude: number; longitude: number; recorded_at: string }>) {
  const earthKm = 6371;
  let distanceKm = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]; const current = points[index];
    const lat1 = previous.latitude * Math.PI / 180; const lat2 = current.latitude * Math.PI / 180;
    const dLat = lat2 - lat1; const dLon = (current.longitude - previous.longitude) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    distanceKm += earthKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  const start = points[0]?.recorded_at; const end = points.at(-1)?.recorded_at;
  const durationMinutes = start && end ? Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000)) : 0;
  let stops = 0;
  for (let index = 1; index < points.length; index += 1) {
    if (new Date(points[index].recorded_at).getTime() - new Date(points[index - 1].recorded_at).getTime() >= 10 * 60 * 1000) stops += 1;
  }
  return { distanceKm: Number(distanceKm.toFixed(2)), durationMinutes, stops };
}

async function loadRoute(admin: SupabaseClient, vehicleId: string | null, trackerId: string | null, window: { from: string; to: string }) {
  let query = admin.from("tracker_locations").select("latitude,longitude,recorded_at");
  query = vehicleId ? query.eq("vehicle_id", vehicleId) : query.eq("tracker_id", trackerId!);
  const { data, error } = await query
    .gte("recorded_at", window.from)
    .lte("recorded_at", window.to)
    .order("recorded_at", { ascending: true })
    .limit(2000);
  if (error) throw error;
  const points = (data ?? []).map((point: any) => ({ latitude: Number(point.latitude), longitude: Number(point.longitude), recorded_at: point.recorded_at }));
  return { points, ...routeSummary(points), from: window.from, to: window.to };
}

async function customerBikeForUser(admin: SupabaseClient, userId: string, bikeId: string) {
  const { data: profile, error: profileError } = await admin.from("profiles").select("email").eq("id", userId).maybeSingle();
  if (profileError) return { bike: null, tracker: null, error: profileError };
  const email = String(profile?.email ?? "").trim();
  if (!email) return { bike: null, tracker: null, error: null };
  const { data: customer, error: customerError } = await admin.from("customers").select("id").ilike("email", email).maybeSingle();
  if (customerError || !customer?.id) return { bike: null, tracker: null, error: customerError };
  const { data: bike, error: bikeError } = await admin.from("bikes")
    .select("id,identifier,customer_id,monitoring_armed,immobilized,trackers(id,identifier,tramigo_device_id,latitude,longitude,last_seen_at,is_online)")
    .eq("id", bikeId).eq("customer_id", customer.id).maybeSingle();
  if (bikeError || !bike) return { bike: null, tracker: null, error: bikeError };
  const relation = (bike as any).trackers;
  return { bike, tracker: Array.isArray(relation) ? relation[0] ?? null : relation ?? null, error: null };
}

async function bikeActivationReadiness(admin: SupabaseClient, bike: any) {
  const { data: applications, error } = await admin.from("screening_applications")
    .select("tracker_installed_at,deposit_amount,requested_deposit_amount")
    .eq("customer_id", bike.customer_id)
    .eq("product_id", bike.id)
    .order("created_at", { ascending: false });
  if (error) return { ready: false, error };
  const applicationRows = applications ?? [];
  const { data: paidDeposits, error: paymentError } = await admin.from("payments")
    .select("amount,status")
    .eq("customer_id", bike.customer_id)
    .eq("product_id", bike.id)
    .eq("payment_type", "deposit");
  if (paymentError) return { ready: false, error: paymentError };
  const requested = applicationRows.reduce((highest: number, row: any) => Math.max(highest, Number(row.requested_deposit_amount ?? 0)), 0);
  const confirmedDeposit = Math.max(
    applicationRows.reduce((highest: number, row: any) => Math.max(highest, Number(row.deposit_amount ?? 0)), 0),
    (paidDeposits ?? []).reduce((total: number, payment: any) => {
      const status = String(payment.status ?? "").toLowerCase();
      return ["paid", "completed", "confirmed"].includes(status) ? total + Number(payment.amount ?? 0) : total;
    }, 0),
  );
  const depositPaid = requested > 0 && Number.isFinite(confirmedDeposit) && confirmedDeposit >= requested;
  const installed = applicationRows.some((row: any) => Boolean(row.tracker_installed_at));
  return {
    ready: Boolean(applicationRows.length && installed && depositPaid),
    error: null,
    installed,
    depositPaid,
    message: !applicationRows.length
      ? "This vehicle is not linked to an agent installation and confirmed deposit."
      : !installed
        ? "The agent must confirm tracker installation first."
        : !depositPaid
          ? "The requested deposit must be confirmed as paid first."
          : null,
  };
}

function isExpoPushToken(value: unknown) {
  return typeof value === "string" && /^(?:Expo|Exponent)PushToken\[[^\]]+\]$/.test(value);
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((item) => item.toString(16).padStart(2, "0")).join("");
}

function approvalCode() {
  return String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
}

const screeningDocumentBucket = "screening-documents";
const screeningDocumentFields = ["customer_photo_url", "id_front_url", "id_back_url"] as const;

function screeningDocumentPath(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.startsWith("data:")) return null;
  if (!/^https?:\/\//i.test(value)) return value.replace(/^\/+/, "");
  try {
    const path = new URL(value).pathname.split(`/${screeningDocumentBucket}/`)[1];
    return path ? decodeURIComponent(path) : null;
  } catch (_) {
    return null;
  }
}

function normalizeKenyanPhone(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (/^254\d{9}$/.test(digits)) return digits;
  if (/^0\d{9}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^7\d{8}$/.test(digits)) return `254${digits}`;
  return null;
}

function normalizeNationalId(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return /^\d{1,12}$/.test(digits) ? digits : null;
}

type WifiGatewayAdapter = { activate: (session: any) => Promise<{ gatewaySessionId: string }>; revoke: (session: any) => Promise<void> };
function wifiGateway(): WifiGatewayAdapter {
  const adapter = (Deno.env.get("WIFI_GATEWAY_ADAPTER") ?? "mock").toLowerCase();
  if (adapter === "mock") return {
    activate: async (session) => ({ gatewaySessionId: `mock-${session.id}` }),
    revoke: async () => {},
  };
  throw new Error("The production Wi-Fi gateway adapter is not configured. Set WIFI_GATEWAY_ADAPTER after selecting the actual gateway hardware.");
}

function decodeScreeningDocument(value: unknown) {
  if (typeof value !== "string") return null;
  const match = value.match(/^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/);
  if (!match || match[2].length > 7_000_000) return null;
  const binary = atob(match[2]);
  return {
    contentType: match[1],
    extension: match[1] === "image/png" ? "png" : "jpg",
    bytes: Uint8Array.from(binary, (character) => character.charCodeAt(0)),
  };
}

async function uploadScreeningDocument(admin: SupabaseClient, applicationId: string, field: string, value: unknown) {
  const document = decodeScreeningDocument(value);
  if (!document) throw new Error("Each customer image must be a JPEG or PNG smaller than 5 MB.");
  const path = `${applicationId}/${field}-${crypto.randomUUID()}.${document.extension}`;
  const { error } = await admin.storage.from(screeningDocumentBucket).upload(path, document.bytes, { contentType: document.contentType, upsert: false });
  if (error) throw error;
  return path;
}

async function removeScreeningDocuments(admin: SupabaseClient, paths: string[]) {
  if (paths.length) await admin.storage.from(screeningDocumentBucket).remove(paths);
}

async function signedScreeningDocuments(admin: SupabaseClient, application: Record<string, unknown>) {
  const signedDocuments = await Promise.all(screeningDocumentFields.map(async (field) => {
    const path = screeningDocumentPath(application[field]);
    if (!path) return [field, null] as const;
    const { data, error } = await admin.storage.from(screeningDocumentBucket).createSignedUrl(path, 900);
    if (error || !data?.signedUrl) {
      console.error("Screening document signing failed", field, error);
      return [field, null] as const;
    }
    return [field, data.signedUrl] as const;
  }));
  return Object.fromEntries(signedDocuments.filter((entry): entry is readonly [typeof screeningDocumentFields[number], string] => Boolean(entry[1])));
}

async function sendCustomerApprovalPush(
  admin: SupabaseClient,
  customerIds: string[],
  code: string,
  email: string,
) {
  const { data: tokens, error } = await admin
    .from("customer_push_tokens")
    .select("expo_push_token")
    .in("customer_id", [...new Set(customerIds.filter(Boolean))]);
  if (error || !tokens?.length) return false;

  const messages = tokens.map(({ expo_push_token }) => ({
    to: expo_push_token,
    sound: "default",
    title: "Your account has been approved",
    body: `Your account has been approved. Your one-time verification code is ${code}. Do not share or expose this OTP. It expires in five minutes.`,
    data: { type: "customer_approval", customerId: customerIds[0], code, email },
  }));
  try {
    const result = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
    });
    const payload = await result.json().catch(() => null);
    const tickets = Array.isArray(payload?.data) ? payload.data : [];
    const accepted = result.ok && tickets.length === messages.length && tickets.every((ticket: any) => ticket?.status === "ok");
    if (!accepted) console.error("Customer approval push failed", payload);
    return accepted;
  } catch (error) {
    console.error("Customer approval push failed", error);
    return false;
  }
}

async function sendCustomerPaymentPush(admin: SupabaseClient, customerId: string, title: string, body: string, data: Record<string, unknown>) {
  const { data: tokens, error } = await admin.from("customer_push_tokens").select("expo_push_token").eq("customer_id", customerId);
  if (error || !tokens?.length) return false;
  const messages = tokens.filter((row: any) => isExpoPushToken(row.expo_push_token)).map((row: any) => ({
    to: row.expo_push_token,
    sound: "default",
    title,
    body,
    data,
  }));
  if (!messages.length) return false;
  try {
    const result = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
    });
    const payload = await result.json().catch(() => null);
    const tickets = Array.isArray(payload?.data) ? payload.data : [];
    const accepted = result.ok && tickets.length === messages.length && tickets.every((ticket: any) => ticket?.status === "ok");
    if (!accepted) console.error("Customer payment push failed", payload);
    return accepted;
  } catch (error) {
    console.error("Customer payment push failed", error);
    return false;
  }
}

async function recordPaymentNotices(admin: SupabaseClient, paymentId: string, ownerId: string, amount: number, registration: string, receipt: string, phone: string, paidAt: string) {
  const detail = `KES ${Number(amount).toLocaleString("en-KE")} received for ${registration}${receipt ? ` · M-Pesa receipt ${receipt}` : ""}.`;
  const financeAlertId = `PAYMENT-RECEIVED-${paymentId}`;
  const { error: financeAlertError } = await admin.from("finance_alerts").upsert({
    external_id: financeAlertId,
    data: { id: financeAlertId, title: "Customer payment received", detail, severity: "normal", status: "Open", time: paidAt, paymentId },
    updated_at: paidAt,
  }, { onConflict: "external_id" });
  if (financeAlertError) console.error("Finance payment notification failed", paymentId, financeAlertError);

  const { data: existingCustomerAlert } = await admin.from("alerts").select("id").eq("id", paymentId).maybeSingle();
  const { error: customerAlertError } = await admin.from("alerts").upsert({
    id: paymentId,
    owner_id: ownerId,
    title: "Payment received",
    body: detail,
    detail,
    kind: "payment",
    severity: "info",
    created_at: paidAt,
  }, { onConflict: "id" });
  if (customerAlertError) console.error("Customer payment message save failed", paymentId, customerAlertError);
  if (!existingCustomerAlert) await sendCustomerPaymentPush(admin, ownerId, "Payment received", detail, { type: "payment", screen: "history", eventId: paymentId, inAppRecorded: true });

  return detail;
}

async function materializeSaleKeepingDueDate(admin: SupabaseClient, applicationId: string, customerId: string) {
  const { data: account } = await admin.from("finance_accounts").select("external_id,due_at")
    .eq("customer_id", customerId).filter("data->>applicationId", "eq", applicationId).maybeSingle();
  const { error } = await admin.rpc("materialize_tracker_sale", { p_application_id: applicationId });
  if (error) return error;
  if (account?.due_at) {
    const { error: dueDateError } = await admin.from("finance_accounts").update({ due_at: account.due_at })
      .eq("external_id", account.external_id);
    if (dueDateError) console.error("Finance account due date restore failed", applicationId, dueDateError);
  }
  return null;
}

async function syncCustomerPaymentToPortals(admin: SupabaseClient, paymentRequestId: string, receipt: string, paidAt: string) {
  const { data: payment, error: paymentError } = await admin.from("payment_requests")
    .select("id,owner_id,vehicle_id,bike_id,amount,phone,status,provider_reference")
    .eq("id", paymentRequestId).maybeSingle();
  if (paymentError || !payment || payment.status !== "paid") {
    if (paymentError) console.error("Confirmed customer payment lookup failed", paymentRequestId, paymentError);
    return;
  }

  const [{ data: profile }, { data: vehicle }, { data: bike }] = await Promise.all([
    admin.from("profiles").select("full_name,email,phone").eq("id", payment.owner_id).maybeSingle(),
    payment.vehicle_id ? admin.from("vehicles").select("registration,tracker_imei,model").eq("id", payment.vehicle_id).maybeSingle() : Promise.resolve({ data: null }),
    payment.bike_id ? admin.from("bikes").select("id,identifier,model,customer_id,payable_amount").eq("id", payment.bike_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  let tracker: any = null;
  if (bike?.id) {
    const { data } = await admin.from("trackers").select("id,identifier,plate_number").eq("bike_id", bike.id).order("created_at", { ascending: true }).limit(1).maybeSingle();
    tracker = data;
  } else if (vehicle?.tracker_imei) {
    const { data } = await admin.from("trackers").select("id,bike_id,identifier,plate_number").eq("identifier", vehicle.tracker_imei).maybeSingle();
    tracker = data;
    if (!tracker && vehicle.registration) {
      const { data: plateTracker } = await admin.from("trackers").select("id,bike_id,identifier,plate_number").eq("plate_number", vehicle.registration).maybeSingle();
      tracker = plateTracker;
    }
    if (tracker?.bike_id) {
      const { data: linkedBike } = await admin.from("bikes").select("id,identifier,model,customer_id,payable_amount").eq("id", tracker.bike_id).maybeSingle();
      if (linkedBike) Object.assign(tracker, { bike: linkedBike });
    }
  }

  const normalizedEmail = String(profile?.email ?? "").trim();
  const { data: customer } = normalizedEmail
    ? await admin.from("customers").select("id,full_name,email,phone,customer_code").ilike("email", normalizedEmail).maybeSingle()
    : { data: null };
  const linkedBike = bike ?? tracker?.bike ?? null;
  const customerId = linkedBike?.customer_id ?? customer?.id ?? null;
  const productId = linkedBike?.id ?? tracker?.bike_id ?? null;
  const registration = String(tracker?.plate_number || vehicle?.registration || linkedBike?.identifier || "Vehicle");
  const paymentReference = `MOBILE-${payment.id}`;
  const { data: existingBusinessPayment } = await admin.from("payments").select("id").eq("payment_reference", paymentReference).maybeSingle();
  if (existingBusinessPayment?.id) {
    await admin.from("payments").update({ status: "paid", paid_at: paidAt, receipt_number: receipt || null }).eq("id", existingBusinessPayment.id);
  } else {
    const { error } = await admin.from("payments").insert({
      customer_id: customerId,
      product_id: productId,
      amount: Number(payment.amount),
      currency: "KES",
      status: "paid",
      paid_at: paidAt,
      receipt_number: receipt || null,
      payment_reference: paymentReference,
      payment_type: "daily",
      payer_phone: payment.phone,
    });
    if (error) console.error("Admin payment sync failed", payment.id, error);
  }

  let materialized = false;
  if (customerId && productId) {
    const { data: application } = await admin.from("screening_applications").select("id,status").eq("customer_id", customerId).eq("product_id", productId).maybeSingle();
    if (application?.status === "approved") {
      const error = await materializeSaleKeepingDueDate(admin, application.id, customerId);
      materialized = !error;
      if (error) console.error("Finance account refresh failed", payment.id, error);
    }
  }

  // Approved sales are reconciled atomically by the serialized materializer.
  // Retain this receipt-sum fallback only for older accounts without an
  // approved screening application.
  if (!materialized && customerId && productId) {
    const { data: account } = await admin.from("finance_accounts").select("external_id,data,outstanding")
      .eq("customer_id", customerId).contains("data", { bike: linkedBike?.identifier }).maybeSingle();
    if (account?.external_id) {
      const { data: receipts, error: receiptError } = await admin.from("payments").select("amount")
        .eq("customer_id", customerId).eq("product_id", productId).in("status", ["paid", "completed", "confirmed"]);
      if (receiptError) console.error("Finance account payment reconciliation failed", payment.id, receiptError);
      else {
        const paid = (receipts ?? []).reduce((sum: number, row: any) => sum + Number(row.amount ?? 0), 0);
        const total = Number(account.data?.total ?? linkedBike?.payable_amount ?? 0);
        const balance = Math.max(0, total - paid);
        const status = balance <= 0 ? "Completed" : "On Track";
        const { error } = await admin.from("finance_accounts").update({
          outstanding: balance,
          status: balance <= 0 ? "completed" : "active",
          data: { ...account.data, paid, balance, status },
          updated_at: paidAt,
        }).eq("external_id", account.external_id);
        if (error) console.error("Finance account balance update failed", payment.id, error);
      }
    }
  }

  if (!materialized) {
    const financePaymentId = `MOBILE-PAY-${payment.id}`;
    const { error } = await admin.from("finance_payments").upsert({
      external_id: financePaymentId,
      data: {
        id: financePaymentId,
        account: customer?.customer_code ? `ACC-${customer.customer_code}` : `VEH-${registration}`,
        customerId,
        customer: customer?.full_name || profile?.full_name || "Customer",
        phone: payment.phone || profile?.phone || "",
        product: registration,
        tracker: tracker?.identifier ?? vehicle?.tracker_imei ?? "Pending",
        receipt: receipt || null,
        amount: Number(payment.amount),
        status: "Confirmed",
        paymentType: "Daily payment",
        date: paidAt,
      },
      updated_at: paidAt,
    }, { onConflict: "external_id" });
    if (error) console.error("Finance payment sync failed", payment.id, error);
  }

  await recordPaymentNotices(admin, payment.id, payment.owner_id, Number(payment.amount), registration, receipt, payment.phone, paidAt);
}

async function resolvePaybillReference(admin: SupabaseClient, reference: string) {
  const { data: vehicles } = await admin.from("vehicles").select("id,owner_id,registration").eq("registration", reference).limit(2);
  if (vehicles?.length === 1) return { vehicleId: vehicles[0].id as string, bikeId: null, ownerId: vehicles[0].owner_id as string, registration: vehicles[0].registration as string };
  if (vehicles?.length) return null;

  const { data: directBikes } = await admin.from("bikes").select("id,identifier,customer_id").eq("identifier", reference).limit(2);
  const { data: plateTrackers } = await admin.from("trackers").select("bike_id,plate_number").eq("plate_number", reference).limit(3);
  const bikeIds = [...new Set([...(directBikes ?? []).map((bike: any) => String(bike.id)), ...(plateTrackers ?? []).map((tracker: any) => String(tracker.bike_id ?? "")).filter(Boolean)])];
  if (bikeIds.length === 1) {
    const { data: bike } = await admin.from("bikes").select("id,identifier,customer_id").eq("id", bikeIds[0]).maybeSingle();
    if (!bike?.customer_id) return null;
    const { data: customer } = await admin.from("customers").select("email").eq("id", bike.customer_id).maybeSingle();
    const { data: profile } = customer?.email
      ? await admin.from("profiles").select("id").ilike("email", String(customer.email).trim()).maybeSingle()
      : { data: null };
    if (!profile?.id) return null;
    const tracker = (plateTrackers ?? []).find((item: any) => String(item.bike_id) === String(bike.id));
    return { vehicleId: null, bikeId: bike.id as string, ownerId: profile.id as string, registration: String(tracker?.plate_number || bike.identifier) };
  }

  const nationalId = normalizeNationalId(reference);
  if (!nationalId) return null;
  const { data: customers } = await admin.from("customers").select("id,email,national_id").eq("national_id", nationalId).limit(2);
  if (customers?.length !== 1 || normalizeNationalId(customers[0].national_id) !== nationalId) return null;
  const customer = customers[0];
  const { data: customerBikes } = await admin.from("bikes").select("id,identifier").eq("customer_id", customer.id).limit(2);
  // A national ID identifies a customer; for manual PayBill payments it must
  // also identify one bike so the receipt can be allocated without guessing.
  if (customerBikes?.length !== 1) return null;
  const { data: profile } = customer.email
    ? await admin.from("profiles").select("id").ilike("email", String(customer.email).trim()).maybeSingle()
    : { data: null };
  if (!profile?.id) return null;
  const { data: tracker } = await admin.from("trackers").select("plate_number").eq("bike_id", customerBikes[0].id).order("created_at", { ascending: true }).limit(1).maybeSingle();
  return { vehicleId: null, bikeId: customerBikes[0].id as string, ownerId: profile.id as string, registration: String(tracker?.plate_number || customerBikes[0].identifier) };
}

async function saveCustomerPushToken(
  admin: SupabaseClient,
  customerId: string,
  body: Record<string, unknown>,
  updatedAt: string,
) {
  const pushToken = body.pushToken;
  if (!isExpoPushToken(pushToken)) return { registered: false, supplied: false };
  const { error } = await admin.from("customer_push_tokens").upsert({
    customer_id: customerId,
    expo_push_token: pushToken,
    platform: String(body.platform ?? "mobile"),
    updated_at: updatedAt,
  }, { onConflict: "customer_id,expo_push_token" });
  if (error) {
    console.error("Customer push token provisioning failed", error);
    return { registered: false, supplied: true };
  }
  return { registered: true, supplied: true };
}

async function issueCustomerApprovalCode(
  admin: SupabaseClient,
  customerId: string,
  email: string,
) {
  const code = approvalCode();
  const { error } = await admin.from("customer_approval_codes").upsert({
    customer_id: customerId,
    code_hash: await sha256(code),
    expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    used_at: null,
  }, { onConflict: "customer_id" });
  if (error) {
    console.error("Customer approval code creation failed", error);
    return { issued: false, pushSent: false };
  }
  return { issued: true, code, pushSent: await sendCustomerApprovalPush(admin, [customerId], code, email) };
}

async function removeCustomerWorkspace(admin: SupabaseClient, customerId: string) {
  const { data: bikes, error: bikesError } = await admin.from("bikes").select("id").eq("customer_id", customerId);
  if (bikesError) throw bikesError;
  const bikeIds = (bikes ?? []).map((bike) => bike.id);
  const { data: applications, error: applicationsError } = await admin.from("screening_applications").select("id,customer_photo_url,id_front_url,id_back_url").eq("customer_id", customerId);
  if (applicationsError) throw applicationsError;
  const applicationIds = (applications ?? []).map((application) => application.id);
  const documentPaths = (applications ?? []).flatMap((application: any) => screeningDocumentFields.map((field) => application[field]).filter(Boolean));
  const remove = async (request: any) => {
    const { error } = await request;
    if (error) throw error;
  };

  await remove(admin.from("support_cases").delete().eq("customer_id", customerId));
  await remove(admin.from("customer_approval_codes").delete().eq("customer_id", customerId));
  await remove(admin.from("customer_push_tokens").delete().eq("customer_id", customerId));
  await remove(admin.from("payment_requests").delete().eq("owner_id", customerId));
  await remove(admin.from("alerts").delete().eq("owner_id", customerId));
  await remove(admin.from("screening_applications").delete().eq("customer_id", customerId));
  await remove(admin.from("payments").delete().eq("customer_id", customerId));
  await remove(admin.from("finance_accounts").delete().eq("customer_id", customerId));
  await remove(admin.from("finance_accounts").delete().filter("data->>customerId", "eq", customerId));
  await remove(admin.from("finance_payments").delete().filter("data->>customerId", "eq", customerId));
  if (applicationIds.length) await remove(admin.from("finance_payments").delete().in("external_id", applicationIds.map((id) => `DEPOSIT-${id}`)));
  if (bikeIds.length) {
    const { data: trackers, error: trackersError } = await admin.from("trackers").select("id").in("bike_id", bikeIds);
    if (trackersError) throw trackersError;
    const trackerIds = (trackers ?? []).map((tracker) => tracker.id);
    if (trackerIds.length) await remove(admin.from("tracker_heartbeats").delete().in("tracker_id", trackerIds));
    await remove(admin.from("trackers").delete().in("bike_id", bikeIds));
    await remove(admin.from("bikes").delete().in("id", bikeIds));
  }
  await removeScreeningDocuments(admin, documentPaths);
  await remove(admin.from("customers").delete().eq("id", customerId));
}

async function existingCustomerRecord(admin: SupabaseClient, email: string) {
  const pattern = email.replace(/[\\%_]/g, "\\$&");
  const { data, error } = await admin.from("customers").select("id,status").ilike("email", pattern).limit(1).maybeSingle();
  return { customer: data, error };
}

async function registerPortalUser(client: SupabaseClient, admin: SupabaseClient, body: Record<string, unknown>, role: "customer" | "agent" | "finance") {
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const fullName = String(body.name ?? body.fullName ?? "").trim();
  const rawPhone = String(body.phone ?? "").trim();
  const phone = role === "agent" ? normalizeKenyanPhone(rawPhone) : rawPhone;
  if (!email || !password || !fullName) return fail("Complete your name, email, and password.", 422, "INVALID_REGISTRATION");
  if (role === "agent" && !phone) return fail("Enter a valid Kenyan mobile number, such as 0712 345 678.", 422, "INVALID_AGENT_PHONE");
  // Only customers already onboarded in Operations may request app access.
  if (role === "customer") {
    const eligibility = await existingCustomerRecord(admin, email);
    if (eligibility.error) return fail("Customer records could not be checked. Please try again.", 503, "CUSTOMER_LOOKUP_UNAVAILABLE");
    if (!eligibility.customer) return fail("Your account details do not exist in our records. Account not approved. Contact Jixels to have your details added.", 403, "CUSTOMER_DETAILS_NOT_FOUND");
    if (["rejected", "declined", "suspended"].includes(eligibility.customer.status)) return fail("Your account has not been approved. Contact Jixels support.", 403, "ACCOUNT_INACTIVE");
  }
  const { data: existing, error: existingError } = await admin.from("profiles").select("id,role,account_status").eq("email", email).maybeSingle();
  if (existingError) return fail("Registration is temporarily unavailable.", 503, "PROFILE_UNAVAILABLE");
  // A repeat registration must prove ownership before it can change a device
  // token or retrieve an approval code. Never reset an existing password here.
  if (existing) return portalSignIn(client, admin, body, new Set([role]));
  const { data, error } = await client.auth.signUp({ email, password, options: { data: { full_name: fullName, phone } } });
  if (error || !data.user || data.user.identities?.length === 0) return fail("Registration could not be completed. If you already registered, sign in or reset your password.", 400, "REGISTRATION_FAILED");
  const rollbackAuthUser = async () => {
    const { error: deleteError } = await admin.auth.admin.deleteUser(data.user!.id);
    if (deleteError) console.error("Registration rollback failed", deleteError);
  };
  const { error: profileError } = await admin.from("profiles").upsert({ id: data.user.id, full_name: fullName, email, phone, role, account_status: "pending", updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (profileError) { console.error("Portal profile provisioning failed", profileError); await rollbackAuthUser(); return fail("Registration could not be completed. Please try again.", 503, "PROFILE_PROVISIONING_FAILED"); }
  if (role === "customer") {
    const now = new Date().toISOString();
    // Keep the existing Operations customer record and its vehicle ownership.
    const token = await saveCustomerPushToken(admin, data.user.id, body, now);
    return response({ status: "pending", notificationReady: token.registered, message: "Registration details submitted successfully. Please wait for administrator approval before signing in." }, 201);
  }
  return response({ status: "pending", message: "Registration details submitted successfully. Please wait for administrator approval before signing in." }, 201);
}

const customerRoles = new Set(["customer"]);
const agentRoles = new Set(["agent", "support_agent"]);
const financeRoles = new Set(["finance", "finance_officer", "admin", "super_admin"]);
const adminRoles = new Set(["admin", "super_admin", "operations_manager"]);
const approvableStaffRoles = new Set(["agent", "support_agent", "finance", "finance_officer", "admin", "operations_manager"]);
const approvableAccountRoles = new Set(["customer", ...approvableStaffRoles]);
const approvedStatuses = new Set(["active", "approved"]);
const LOGIN_LOCK_MESSAGE = "Too many failed sign-in attempts. Please try again in 15 minutes.";

async function loginAttemptKey(email: string) {
  return sha256(`jixels-login:${email}`);
}

async function getLoginLock(admin: SupabaseClient, accountKey: string) {
  const { data, error } = await admin.rpc("get_login_lock", { p_account_key: accountKey });
  if (error) {
    console.error("Login lock lookup failed", error);
    return { error: true, locked: false };
  }
  return { error: false, locked: Boolean(data) };
}

async function recordLoginFailure(admin: SupabaseClient, accountKey: string) {
  const { data, error } = await admin.rpc("record_login_failure", { p_account_key: accountKey });
  if (error) {
    console.error("Login failure recording failed", error);
    return { error: true, locked: false };
  }
  const state = Array.isArray(data) ? data[0] : data;
  return { error: false, locked: Boolean(state?.locked_until) };
}

async function portalSignIn(
  client: SupabaseClient,
  admin: SupabaseClient,
  body: Record<string, unknown>,
  allowedRoles: Set<string>,
) {
  const email = String(body.email ?? "").trim().toLowerCase();
  const accountKey = await loginAttemptKey(email);
  const currentLock = await getLoginLock(admin, accountKey);
  if (currentLock.error) return fail("Sign-in is temporarily unavailable. Please try again in a few moments.", 503, "LOGIN_SECURITY_UNAVAILABLE");
  if (currentLock.locked) return fail(LOGIN_LOCK_MESSAGE, 429, "LOGIN_TEMPORARILY_LOCKED");

  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: String(body.password ?? ""),
  });
  if (error || !data.session || !data.user) {
    const failure = await recordLoginFailure(admin, accountKey);
    if (failure.error) return fail("Sign-in is temporarily unavailable. Please try again in a few moments.", 503, "LOGIN_SECURITY_UNAVAILABLE");
    if (failure.locked) return fail(LOGIN_LOCK_MESSAGE, 429, "LOGIN_TEMPORARILY_LOCKED");
    return fail("Incorrect email or password.", 401, "INVALID_CREDENTIALS");
  }

  const { error: clearFailureError } = await admin.rpc("clear_login_failures", { p_account_key: accountKey });
  if (clearFailureError) console.error("Login failure reset failed", clearFailureError);

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("full_name,email,phone,role,account_status,agent_code")
    .eq("id", data.user.id)
    .maybeSingle();
  if (profileError || !profile) {
    console.error("Profile load failed after sign-in", profileError);
    return fail("Your account profile could not be loaded. Please contact an administrator.", 503, "PROFILE_UNAVAILABLE");
  }
  if (!allowedRoles.has(profile.role)) {
    return fail("You don't have permission to access this portal.", 403, "PORTAL_ACCESS_DENIED");
  }
  if (!approvedStatuses.has(profile.account_status)) {
    if (profile.account_status === "pending") return fail("Your registration is awaiting administrator approval. You can sign in once the account is approved.", 403, "ACCOUNT_PENDING_APPROVAL");
    if (profile.account_status === "rejected" || profile.account_status === "suspended") return fail("This account is not active. Please contact Jixels support.", 403, "ACCOUNT_INACTIVE");
    return fail("Your account is not active. Please contact Jixels support.", 403, "ACCOUNT_INACTIVE");
  }
  if (profile.role === "customer") {
    await saveCustomerPushToken(admin, data.user.id, body, new Date().toISOString());
    const { data: pendingCode, error: pendingCodeError } = await admin
      .from("customer_approval_codes")
      .select("used_at")
      .eq("customer_id", data.user.id)
      .maybeSingle();
    if (pendingCodeError) {
      console.error("Customer approval code lookup failed", pendingCodeError);
      return fail("Customer approval verification is temporarily unavailable.", 503, "APPROVAL_CODE_UNAVAILABLE");
    }
    if (!pendingCode || !pendingCode.used_at) {
      const delivery = await issueCustomerApprovalCode(admin, data.user.id, profile.email ?? email);
      if (!delivery.issued) return fail("A secure approval code could not be created. Contact Jixels support.", 503, "APPROVAL_CODE_UNAVAILABLE");
      return fail(
        `Your account has been approved. Your one-time verification code is ${delivery.code}. Do not share or expose this OTP. It expires in five minutes.`,
        403,
        "CUSTOMER_OTP_REQUIRED",
        { otpCode: delivery.code, expiresInSeconds: 300 },
      );
    }
  }
  let assignedVehicles: unknown[] = [];
  if (agentRoles.has(profile.role)) {
    const { data: bikes, error: bikesError } = await admin.from("bikes").select("id,identifier,model,product_type,payable_amount,status,assigned_agent_id,trackers(identifier,plate_number)").eq("assigned_agent_id", data.user.id).order("created_at", { ascending: false });
    if (bikesError) console.error("Agent vehicle load failed", bikesError);
    assignedVehicles = (bikes ?? []).map((bike: any) => ({ id: bike.id, registration: bike.trackers?.[0]?.plate_number || bike.identifier, model: bike.model, product_type: bike.product_type, payable_amount: bike.payable_amount, status: bike.status, assigned_agent_id: bike.assigned_agent_id, tracker: bike.trackers?.[0]?.identifier ?? "Pending" }));
  }
  return response({
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt: new Date(data.session.expires_at! * 1000).toISOString(),
    user: { id: data.user.id, email: data.user.email, name: profile.full_name, phone: profile.phone, role: profile.role, agentCode: profile.agent_code, assignedVehicles },
  });
}

async function requestPortalPasswordReset(
  client: SupabaseClient,
  admin: SupabaseClient,
  body: Record<string, unknown>,
  allowedRoles: Set<string>,
) {
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("A valid email address is required.", 422, "INVALID_EMAIL");

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("role,account_status")
    .eq("email", email)
    .maybeSingle();

  if (!profileError && profile && allowedRoles.has(profile.role) && approvedStatuses.has(profile.account_status)) {
    const redirectTo = Deno.env.get("PASSWORD_RESET_REDIRECT_URL") ?? Deno.env.get("SITE_URL") ?? undefined;
    const { error } = await client.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined);
    if (error) console.error("Password reset request failed", error);
  }

  return response({ accepted: true, message: "If an approved account exists, reset instructions will be sent." });
}

async function accountStatus(admin: SupabaseClient, url: URL) {
  const email = String(url.searchParams.get("email") ?? "").trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("A valid email address is required.", 422, "INVALID_EMAIL");

  const { data: profile, error } = await admin
    .from("profiles")
    .select("role,account_status")
    .eq("email", email)
    .maybeSingle();
  if (error) {
    console.error("Account status lookup failed", error);
    return fail("Account status is temporarily unavailable.", 503, "ACCOUNT_STATUS_UNAVAILABLE");
  }

  const status = profile?.account_status === "active" ? "approved" : profile?.account_status ?? "not_found";
  return response({
    status,
    role: profile?.role ?? null,
    approved: approvedStatuses.has(profile?.account_status ?? ""),
    message: approvedStatuses.has(profile?.account_status ?? "") ? "Your account has been approved." : ["rejected", "suspended"].includes(status) ? "Your account has not been approved. Contact Jixels support." : "Your registration is waiting for administrator approval.",
  });
}

async function financeAccountStatus(admin: SupabaseClient, url: URL) {
  const email = String(url.searchParams.get("email") ?? "").trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("A valid email address is required.", 422, "INVALID_EMAIL");

  const { data: profile, error } = await admin
    .from("profiles")
    .select("role,account_status")
    .eq("email", email)
    .maybeSingle();
  if (error) {
    console.error("Finance account status lookup failed", error);
    return fail("Finance account status is temporarily unavailable.", 503, "ACCOUNT_STATUS_UNAVAILABLE");
  }
  if (!profile) return response({ exists: false, approved: false, message: "Finance account not found. Please register a Finance account before signing in." });
  if (!financeRoles.has(profile.role)) return response({ exists: true, approved: false, message: "This email is registered for a different Jixels workspace and cannot access Finance." });
  if (!approvedStatuses.has(profile.account_status)) return response({ exists: true, approved: false, message: "Your Finance registration is waiting for administrator approval. You can sign in after the account is approved." });
  return response({ exists: true, approved: true, message: "Finance account approved." });
}

Deno.serve(async (request) => {
  const requestPath = new URL(request.url).pathname;
  try {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  const url = new URL(request.url);
  const routeIndex = url.pathname.indexOf("/v1/");
  const route = routeIndex >= 0 ? url.pathname.slice(routeIndex) : url.pathname;
  if (route.startsWith("/v1/wifi/")) return fail("Wi-Fi services are not part of this tracking system.", 404, "WIFI_FEATURE_REMOVED");
  const authHeader = request.headers.get("Authorization") ?? "";
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
  // Customer delete endpoints pass selected IDs in a JSON DELETE body. Keep
  // parsing it; endpoints that do not need a body safely receive an empty one.
  const body = request.method === "GET" ? {} : await request.json().catch(() => ({}));

  // Safaricom callbacks are public and must return quickly. Database writes use
  // the service-role client and are idempotent on the transaction receipt.
  if (route === "/v1/mpesa/c2b/validation" && request.method === "POST") {
    const reference = String(body.BillRefNumber ?? "").trim();
    if (!reference) return response({ ResultCode: 1, ResultDesc: "Missing account reference" });
    const { data: requestRecord } = await admin.from("payment_requests").select("id").eq("idempotency_key", reference).maybeSingle();
    if (requestRecord) return response({ ResultCode: 0, ResultDesc: "Accepted" });
    const target = await resolvePaybillReference(admin, reference);
    return response(target ? { ResultCode: 0, ResultDesc: "Accepted" } : { ResultCode: 1, ResultDesc: "Unknown or ambiguous account reference" });
  }
  if (route === "/v1/mpesa/c2b/confirmation" && request.method === "POST") {
    const transactionId = String(body.TransID ?? "").trim();
    const reference = String(body.BillRefNumber ?? "").trim();
    const amount = Number(body.TransAmount ?? 0);
    const phone = String(body.MSISDN ?? "").replace(/\D/g, "");
    await admin.from("daraja_transactions").upsert({ direction: "C2B", transaction_id: transactionId || null, account_reference: reference || null, phone: body.MSISDN ?? null, amount, status: "completed", payload: body, updated_at: new Date().toISOString() }, { onConflict: "transaction_id" });
    if (transactionId && reference && Number.isFinite(amount) && amount > 0 && /^254\d{9}$/.test(phone)) {
      const target = await resolvePaybillReference(admin, reference);
      if (target) {
        const paidAt = new Date().toISOString();
        const { data: paymentRequest, error } = await admin.from("payment_requests").upsert({ owner_id: target.ownerId, vehicle_id: target.vehicleId, bike_id: target.bikeId, idempotency_key: `C2B-${transactionId}`, provider_reference: transactionId, amount, phone, status: "paid", updated_at: paidAt }, { onConflict: "idempotency_key" }).select("id").single();
        if (error) console.error("C2B payment reconciliation failed", transactionId, error);
        else if (paymentRequest?.id) await syncCustomerPaymentToPortals(admin, paymentRequest.id, transactionId, paidAt);
      }
    }
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
    const completed = Number(callback.ResultCode) === 0;
    const checkoutRequestId = String(callback.CheckoutRequestID ?? "");
    const paidAt = new Date().toISOString();
    const receipt = String(items.MpesaReceiptNumber ?? "").trim();
    await admin.from("daraja_transactions").upsert({ direction: "C2B", checkout_request_id: checkoutRequestId || null, transaction_id: receipt || null, phone: items.PhoneNumber ?? null, amount: Number(items.Amount ?? 0), status: completed ? "completed" : "failed", payload: body, updated_at: paidAt }, { onConflict: "transaction_id" });
    if (checkoutRequestId) {
      const { data: customerPayment } = await admin.from("payment_requests").select("id,owner_id,vehicle_id,bike_id,amount,phone").eq("provider_reference", checkoutRequestId).maybeSingle();
      if (customerPayment) {
        const { error } = await admin.from("payment_requests").update({ status: completed ? "paid" : "failed", provider_reference: completed ? (receipt || checkoutRequestId) : checkoutRequestId, updated_at: paidAt }).eq("id", customerPayment.id);
        if (error) console.error("Customer STK payment update failed", customerPayment.id, error);
        if (completed) await syncCustomerPaymentToPortals(admin, customerPayment.id, receipt, paidAt);
      }
    }
    if (checkoutRequestId) {
    const { data: promptedPayment, error: promptedPaymentError } = await admin
        .from("payments")
      .select("id,customer_id,product_id,amount,payment_type,status,receipt_number,payer_phone,payment_reference")
        .eq("checkout_request_id", checkoutRequestId)
        .maybeSingle();
      if (promptedPaymentError) console.error("Prompted deposit lookup failed", promptedPaymentError);
      if (promptedPayment) {
        const paidAt = new Date().toISOString();
        const receipt = String(items.MpesaReceiptNumber ?? "").trim();
        let { error: paymentUpdateError } = await admin.from("payments").update({
          status: completed ? "paid" : "failed",
          paid_at: completed ? paidAt : null,
          receipt_number: completed ? receipt || null : null,
        }).eq("id", promptedPayment.id);
        if (completed && receipt && !paymentUpdateError) {
          const { data: duplicateReceiptPayment } = await admin.from("payments").select("id")
            .eq("receipt_number", receipt).neq("id", promptedPayment.id).maybeSingle();
          if (duplicateReceiptPayment?.id) {
            // Daraja may deliver the same confirmation via multiple callback
            // paths. Keep the canonical first row and retire this duplicate.
            const { error: duplicateRetireError } = await admin.from("payments").update({ status: "duplicate", payment_reference: `DUP-${promptedPayment.id}-${duplicateReceiptPayment.id}` }).eq("id", promptedPayment.id);
            if (duplicateRetireError) console.error("Duplicate callback payment could not be retired", promptedPayment.id, duplicateRetireError);
            return response({ ResultCode: 0, ResultDesc: "Accepted" });
          }
        }
        if (paymentUpdateError) console.error("Prompted deposit update failed", paymentUpdateError);
        if (!completed) {
          const { error: alertError } = await admin.from("finance_alerts").upsert({
            external_id: `PAYMENT-FAILED-${promptedPayment.id}`,
            data: {
              id: `PAYMENT-FAILED-${promptedPayment.id}`,
              title: "M-Pesa payment failed",
              detail: "A prompted customer deposit was not completed.",
              severity: "high",
              status: "Open",
              time: paidAt,
              paymentId: promptedPayment.id,
            },
            updated_at: paidAt,
          }, { onConflict: "external_id" });
          if (alertError) console.error("Finance payment alert failed", alertError);
        }
        if (completed && promptedPayment.customer_id && promptedPayment.product_id) {
          const { data: paidPayments, error: paidPaymentsError } = await admin
            .from("payments")
            .select("amount")
            .eq("customer_id", promptedPayment.customer_id)
            .eq("product_id", promptedPayment.product_id)
            .eq("payment_type", "deposit")
            .in("status", ["paid", "completed", "confirmed"]);
          if (paidPaymentsError) console.error("Prompted deposit total failed", paidPaymentsError);
          else {
            const depositedAmount = (paidPayments ?? []).reduce((total: number, payment: any) => total + Number(payment.amount ?? 0), 0);
            const { error: applicationUpdateError } = await admin.from("screening_applications").update({ deposit_amount: depositedAmount, updated_at: paidAt })
              .eq("customer_id", promptedPayment.customer_id).eq("product_id", promptedPayment.product_id);
            if (applicationUpdateError) console.error("Prompted deposit application update failed", applicationUpdateError);
            const { data: approvedApplication, error: approvedApplicationError } = await admin.from("screening_applications")
              .select("id,status")
              .eq("customer_id", promptedPayment.customer_id)
              .eq("product_id", promptedPayment.product_id)
              .maybeSingle();
            if (approvedApplicationError) console.error("Finance payment materialization lookup failed", approvedApplicationError);
            else if (approvedApplication?.status === "approved") {
              const financeRefreshError = await materializeSaleKeepingDueDate(admin, approvedApplication.id, promptedPayment.customer_id);
              if (financeRefreshError) console.error("Finance payment materialization failed", financeRefreshError);
            }
          }
        }
        if (completed && promptedPayment.customer_id) {
          const { data: customer } = await admin.from("customers").select("email,full_name,phone").eq("id", promptedPayment.customer_id).maybeSingle();
          const { data: customerProfile } = customer?.email
            ? await admin.from("profiles").select("id,phone").ilike("email", String(customer.email).trim()).maybeSingle()
            : { data: null };
          const { data: product } = promptedPayment.product_id ? await admin.from("bikes").select("identifier").eq("id", promptedPayment.product_id).maybeSingle() : { data: null };
          if (customerProfile?.id) await recordPaymentNotices(admin, promptedPayment.id, customerProfile.id, Number(items.Amount ?? 0), product?.identifier ?? "your vehicle", receipt, String(items.PhoneNumber ?? customer.phone ?? customerProfile.phone ?? ""), paidAt);
        }
      }
    }
    return response({ ResultCode: 0, ResultDesc: "Accepted" });
  }
  if (route === "/v1/wifi/packages" && request.method === "GET") {
    const { data, error } = await admin.from("wifi_packages").select("id,name,slug,price_kes,duration_minutes,description,is_active,is_popular,is_best_value,display_order").eq("is_active", true).order("display_order", { ascending: true });
    if (error) return fail("Wi-Fi packages are temporarily unavailable.", 503, "WIFI_PACKAGES_UNAVAILABLE");
    return response({ packages: data ?? [] });
  }
  if (route === "/v1/wifi/expire" && request.method === "POST") {
    const secret = request.headers.get("x-wifi-expiry-secret") ?? "";
    if (!Deno.env.get("WIFI_EXPIRY_SECRET") || secret !== Deno.env.get("WIFI_EXPIRY_SECRET")) return fail("Expiry worker authentication failed.", 401, "WIFI_EXPIRY_UNAUTHORIZED");
    const { data: sessions } = await admin.from("wifi_sessions").select("id,gateway_session_id").eq("status", "active").lte("expires_at", new Date().toISOString()).limit(200);
    const gateway = wifiGateway();
    for (const session of sessions ?? []) { await gateway.revoke(session); await admin.from("wifi_sessions").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", session.id); }
    return response({ expired: sessions?.length ?? 0 });
  }
  if (route === "/v1/wifi/purchase" && request.method === "POST") {
    const packageId = String(body.packageId ?? "").trim();
    const phone = normalizeKenyanPhone(body.phone);
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || String(body.idempotencyKey ?? "").trim();
    const deviceMac = String(body.deviceMac ?? "").trim().slice(0, 64) || null;
    if (!packageId || !phone || !idempotencyKey) return fail("Choose a package, enter a valid Kenyan M-Pesa number, and provide a payment reference.", 422, "INVALID_WIFI_PURCHASE");
    const { data: existing } = await admin.from("wifi_purchases").select("id,status,checkout_request_id").eq("idempotency_key", idempotencyKey).maybeSingle();
    if (existing) return response({ purchase: existing }, existing.status === "pending" ? 202 : 200);
    const { data: wifiPackage, error: packageError } = await admin.from("wifi_packages").select("id,name,price_kes,duration_minutes,is_active").eq("id", packageId).eq("is_active", true).maybeSingle();
    if (packageError || !wifiPackage) return fail("That Wi-Fi package is unavailable.", 404, "WIFI_PACKAGE_UNAVAILABLE");
    const { data: purchase, error: purchaseError } = await admin.from("wifi_purchases").insert({ package_id: wifiPackage.id, phone, device_mac: deviceMac, amount_kes: wifiPackage.price_kes, idempotency_key: idempotencyKey }).select("id,status,amount_kes").single();
    if (purchaseError || !purchase) return fail("The Wi-Fi purchase could not be created.", 503, "WIFI_PURCHASE_UNAVAILABLE");
    const { data: wifiSession, error: sessionError } = await admin.from("wifi_sessions").insert({ purchase_id: purchase.id, package_id: wifiPackage.id, phone, device_mac: deviceMac }).select("id").single();
    if (sessionError) return fail("The Wi-Fi session could not be created.", 503, "WIFI_SESSION_UNAVAILABLE");
    try {
      const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
      const callbackUrl = Deno.env.get("WIFI_MPESA_CALLBACK_URL") ?? `${Deno.env.get("SUPABASE_URL")}/functions/v1/api/v1/wifi/mpesa/callback`;
      const result = await darajaPost("/mpesa/stkpush/v1/processrequest", { BusinessShortCode: Deno.env.get("DARAJA_SHORTCODE"), Password: stkPassword(timestamp), Timestamp: timestamp, TransactionType: "CustomerPayBillOnline", Amount: Number(wifiPackage.price_kes), PartyA: phone, PartyB: Deno.env.get("DARAJA_SHORTCODE"), PhoneNumber: phone, CallBackURL: callbackUrl, AccountReference: Deno.env.get("DARAJA_SHORTCODE"), TransactionDesc: `Jixels Wi-Fi ${wifiPackage.name}` });
      const checkoutRequestId = String(result.CheckoutRequestID ?? "");
      if (!checkoutRequestId) throw new Error("M-Pesa did not return a checkout request ID.");
      await admin.from("wifi_purchases").update({ checkout_request_id: checkoutRequestId, updated_at: new Date().toISOString() }).eq("id", purchase.id);
      return response({ purchase: { ...purchase, status: "pending", checkoutRequestId }, sessionId: wifiSession?.id }, 202);
    } catch (error) {
      await admin.from("wifi_purchases").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", purchase.id);
      return fail(error instanceof Error ? error.message : "M-Pesa request failed.", 502, "WIFI_MPESA_ERROR");
    }
  }
  const wifiSessionMatch = route.match(/^\/v1\/wifi\/sessions\/([^/]+)$/);
  if (wifiSessionMatch && request.method === "GET") {
    const { data, error } = await admin.from("wifi_sessions").select("id,status,starts_at,expires_at,gateway_session_id,wifi_packages(name,duration_minutes)").eq("id", decodeURIComponent(wifiSessionMatch[1])).maybeSingle();
    if (error || !data) return fail("Wi-Fi session not found.", 404, "WIFI_SESSION_NOT_FOUND");
    return response({ session: data });
  }
  if (route === "/v1/wifi/mpesa/callback" && request.method === "POST") {
    const callback = body.Body?.stkCallback ?? {};
    const items = Object.fromEntries((callback.CallbackMetadata?.Item ?? []).map((item: { Name: string; Value?: unknown }) => [item.Name, item.Value]));
    const completed = Number(callback.ResultCode) === 0;
    const checkoutRequestId = String(callback.CheckoutRequestID ?? "");
    const { data: purchase } = await admin.from("wifi_purchases").select("id,status,amount_kes,package_id,phone").eq("checkout_request_id", checkoutRequestId).maybeSingle();
    if (purchase && purchase.status === "pending") {
      const receipt = String(items.MpesaReceiptNumber ?? "").trim() || null;
      const amountMatches = Number(items.Amount ?? 0) === Number(purchase.amount_kes);
      const nextStatus = completed && amountMatches ? "completed" : "failed";
      const { data: claimed } = await admin.from("wifi_purchases").update({ status: nextStatus, mpesa_receipt: receipt, paid_at: nextStatus === "completed" ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq("id", purchase.id).eq("status", "pending").select("id").maybeSingle();
      if (claimed && nextStatus === "completed") {
        const { data: session } = await admin.from("wifi_sessions").select("id,status,package_id,phone,device_mac").eq("purchase_id", purchase.id).maybeSingle();
        const { data: wifiPackage } = await admin.from("wifi_packages").select("duration_minutes").eq("id", purchase.package_id).single();
        if (session && wifiPackage) {
          try {
            const startsAt = new Date(); const expiresAt = new Date(startsAt.getTime() + Number(wifiPackage.duration_minutes) * 60_000);
            const gateway = await wifiGateway(); const activated = await gateway.activate(session);
            await admin.from("wifi_sessions").update({ status: "active", starts_at: startsAt.toISOString(), expires_at: expiresAt.toISOString(), gateway_session_id: activated.gatewaySessionId, updated_at: new Date().toISOString() }).eq("id", session.id);
          } catch (error) {
            await admin.from("wifi_sessions").update({ status: "gateway_failed", updated_at: new Date().toISOString() }).eq("id", session.id);
            console.error("Wi-Fi gateway activation failed", error);
          }
        }
      }
    }
    return response({ ResultCode: 0, ResultDesc: "Accepted" });
  }

  if (route === "/v1/auth/login" && request.method === "POST") {
    return portalSignIn(client, admin, body, customerRoles);
  }
  if (route === "/v1/agent/auth/login" && request.method === "POST") {
    return portalSignIn(client, admin, body, agentRoles);
  }
  if (route === "/v1/finance/auth/login" && request.method === "POST") {
    return portalSignIn(client, admin, body, financeRoles);
  }
  if (route === "/v1/admin/auth/login" && request.method === "POST") {
    return portalSignIn(client, admin, body, adminRoles);
  }
  if (route === "/v1/auth/register" && request.method === "POST") return registerPortalUser(client, admin, body, "customer");
  if (route === "/v1/agent/auth/register" && request.method === "POST") return registerPortalUser(client, admin, body, "agent");
  if (route === "/v1/finance/auth/register" && request.method === "POST") return registerPortalUser(client, admin, body, "finance");
  if (route === "/v1/auth/request-password-reset" && request.method === "POST") {
    return requestPortalPasswordReset(client, admin, body, customerRoles);
  }
  if (route === "/v1/agent/auth/request-password-reset" && request.method === "POST") {
    return requestPortalPasswordReset(client, admin, body, agentRoles);
  }
  if (route === "/v1/finance/auth/request-password-reset" && request.method === "POST") {
    return requestPortalPasswordReset(client, admin, body, financeRoles);
  }
  if (route === "/v1/finance/auth/account-status" && request.method === "GET") return financeAccountStatus(admin, url);
  if (route === "/v1/auth/account-status" && request.method === "GET") return accountStatus(admin, url);
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
    return response({ verified: true, accessToken: data.session.access_token, refreshToken: data.session.refresh_token, expiresAt: new Date(data.session.expires_at! * 1000).toISOString(), user: { id: data.user.id, email: data.user.email, phone: data.user.phone } });
  }
  if (route === "/v1/auth/verify-customer-approval-code" && request.method === "POST") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const code = String(body.code ?? "").trim();
    if (!email || !/^\d{6}$/.test(code)) return fail("Enter your registered email address and the six-digit approval code.", 422, "INVALID_APPROVAL_CODE");
    const otpAttemptKey = await loginAttemptKey(`approval-otp:${email}`);
    const otpLock = await getLoginLock(admin, otpAttemptKey);
    if (otpLock.error) return fail("Verification is temporarily unavailable.", 503, "LOGIN_SECURITY_UNAVAILABLE");
    if (otpLock.locked) return fail("Too many incorrect codes. Please try again in 15 minutes.", 429, "OTP_TEMPORARILY_LOCKED");
    const { data: profile, error: profileError } = await admin.from("profiles").select("id,role,account_status").eq("email", email).maybeSingle();
    if (profileError || !profile || profile.role !== "customer") return fail("Customer account not found. Register an account or contact Jixels support.", 404, "ACCOUNT_NOT_FOUND");
    if (!approvedStatuses.has(profile.account_status)) return fail("This account is still awaiting administrator approval.", 403, "ACCOUNT_PENDING_APPROVAL");
    const { data: stored, error: storedError } = await admin.from("customer_approval_codes").select("code_hash,expires_at,used_at").eq("customer_id", profile.id).maybeSingle();
    if (storedError || !stored || stored.used_at || new Date(stored.expires_at).getTime() <= Date.now()) return fail("The approval code is unavailable or expired. Ask an administrator to issue a new code.", 401, "APPROVAL_CODE_EXPIRED");
    if (stored.code_hash !== await sha256(code)) {
      const failure = await recordLoginFailure(admin, otpAttemptKey);
      if (failure.error) return fail("Verification is temporarily unavailable.", 503, "LOGIN_SECURITY_UNAVAILABLE");
      return fail("The approval code is incorrect.", 401, "APPROVAL_CODE_INVALID");
    }
    const { data: usedCode, error: useError } = await admin.from("customer_approval_codes")
      .update({ used_at: new Date().toISOString() }).eq("customer_id", profile.id)
      .eq("code_hash", stored.code_hash).is("used_at", null).gt("expires_at", new Date().toISOString())
      .select("customer_id").maybeSingle();
    if (useError) return fail("The approval code could not be verified. Please try again.", 503, "APPROVAL_CODE_UNAVAILABLE");
    if (!usedCode) return fail("The approval code has expired or was already used.", 401, "APPROVAL_CODE_EXPIRED");
    await admin.rpc("clear_login_failures", { p_account_key: otpAttemptKey });
    return response({ verified: true, message: "Account verified. Sign in with your registered email and password." });
  }

  if (route === "/v1/auth/refresh" && request.method === "POST") {
    const refreshToken = String(body.refreshToken ?? "").trim();
    if (!refreshToken) return fail("A refresh token is required.", 422, "REFRESH_TOKEN_REQUIRED");
    const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session || !data.user) return fail("Your session has expired. Please sign in again.", 401, "SESSION_EXPIRED");
    const { data: profile, error: profileError } = await admin.from("profiles").select("full_name,email,phone,role,account_status").eq("id", data.user.id).maybeSingle();
    const refreshableRoles = new Set([...approvableAccountRoles, ...financeRoles, ...adminRoles]);
    if (profileError || !profile || !refreshableRoles.has(profile.role) || !approvedStatuses.has(profile.account_status)) return fail("This account is not active.", 403, "ACCOUNT_INACTIVE");
    return response({
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: new Date(data.session.expires_at! * 1000).toISOString(),
      user: { id: data.user.id, email: data.user.email, name: profile.full_name, phone: profile.phone, role: profile.role },
    });
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

  if (route.startsWith("/v1/customer/")) {
    let billing;
    try { billing = await customerMonthlyBilling(admin, user.id); }
    catch (error) { return fail(error instanceof Error ? error.message : "Customer billing status is temporarily unavailable.", 503, "CUSTOMER_BILLING_UNAVAILABLE"); }
    const paymentAccess = (route === "/v1/customer/overview" && request.method === "GET")
      || (route === "/v1/customer/payments" && ["GET", "DELETE"].includes(request.method))
      || (route === "/v1/customer/payments/mpesa" && request.method === "POST");
    if (billing.locked && !paymentAccess) {
      return fail("Your account is temporarily limited because a KSh 750 monthly instalment is overdue. You can sign in and make a payment to restore access.", 423, "CUSTOMER_MONTHLY_PAYMENT_DUE", { billing });
    }
  }

  if (route === "/v1/admin/trackers/refresh" && request.method === "POST") {
    const { data: manager, error: managerError } = await admin.from("profiles").select("role,account_status").eq("id", user.id).maybeSingle();
    if (managerError || !manager || !adminRoles.has(manager.role)) return fail("Administrator permission is required to refresh trackers.", 403, "FORBIDDEN");
    const { data: claimed, error: claimError } = await admin.rpc("claim_tracker_refresh", { p_lock_key: "operations-tracker-refresh", p_seconds: 20 });
    if (claimError) return fail("Tracker refresh protection is unavailable.", 503, "REFRESH_GUARD_UNAVAILABLE");
    if (!claimed) return fail("A live tracker refresh is already running. Try again in a few seconds.", 429, "REFRESH_IN_PROGRESS");
    const requestedTrackerId = typeof body.trackerId === "string" ? body.trackerId : null;
    let query = admin.from("trackers").select("id,identifier,tramigo_device_id,vehicle_id");
    if (requestedTrackerId) query = query.eq("id", requestedTrackerId);
    const { data: trackers, error: trackersError } = await query;
    if (trackersError) return fail("Tracker records could not be loaded.", 503, "TRACKERS_UNAVAILABLE");
    if ((trackers?.length ?? 0) > 100) return fail("Refresh no more than 100 trackers at once.", 422, "TRACKER_BATCH_TOO_LARGE");
    let providerSession: TramigoSession; let deviceCatalogue: any;
    try {
      providerSession = await tramigoSession();
      deviceCatalogue = await tramigoRequest("/api/v2/devices?page=1&per_page=1000", {}, providerSession);
    }
    catch (error) { return fail(error instanceof Error ? error.message : "Tramigo device catalogue is unavailable.", 502, "TRAMIGO_CATALOGUE_UNAVAILABLE"); }
    const refreshed: Array<Record<string, unknown>> = [];
    for (const tracker of trackers ?? []) {
      // A numeric Operations identifier can be the Tramigo device ID itself.
      // Internal codes such as T-003GHBS are deliberately not sent to Tramigo.
      const storedDeviceId = String(tracker.tramigo_device_id ?? "").trim();
      const deviceId = storedDeviceId || (/^\d{10,20}$/.test(String(tracker.identifier ?? "").trim()) ? String(tracker.identifier).trim() : "");
      if (!deviceId) {
        refreshed.push({ id: tracker.id, identifier: tracker.identifier, status: "not_configured", message: "Tramigo device ID is not configured." });
        continue;
      }
      try {
        const cloudDeviceId = await tramigoCloudDeviceId(deviceId, deviceCatalogue, providerSession);
        const locationReport = tramigoLocation(await tramigoRequest(`/api/reports/last_location/${encodeURIComponent(cloudDeviceId)}`, {}, providerSession));
        let latestReport = null;
        try { latestReport = tramigoLocation(await tramigoRequest(`/api/reports/last/${encodeURIComponent(cloudDeviceId)}`, {}, providerSession)); } catch (_) { /* last_location remains the fallback */ }
        const live = latestReport && (!locationReport || new Date(latestReport.recordedAt).getTime() >= new Date(locationReport.recordedAt).getTime()) ? latestReport : locationReport;
        if (!live) {
          refreshed.push({ id: tracker.id, identifier: tracker.identifier, status: "invalid_report", message: "Tramigo returned no valid GPS position." });
          continue;
        }
        // Some Tramigo last-location responses omit an explicit connection
        // flag. In that case, a recent valid report is the correct fallback;
        // explicit Tramigo status always remains authoritative.
        const catalogueDevice = tramigoCatalogueDevice(deviceCatalogue, cloudDeviceId);
        const catalogueStatus = tramigoCatalogueStatus(catalogueDevice);
        const catalogueSeenAt = tramigoCatalogueLastSeen(catalogueDevice);
        const liveTimestamp = safeLiveTimestamp(live.recordedAt);
        const reportAge = Date.now() - new Date(liveTimestamp).getTime();
        // The catalogue is Tramigo's current device connection state. A stale
        // report can contain an old offline flag, so it must not override a
        // newer catalogue state during a refresh.
        const isOnline = catalogueStatus === "online" || (catalogueStatus == null && live.trackerStatus === "online") || (live.trackerStatus == null && catalogueStatus == null && Number.isFinite(reportAge) && reportAge <= 10 * 60_000);
        const operationalStatus = catalogueStatus ?? live.trackerStatus ?? (isOnline ? "online" : "offline");
        const trackerUpdate: Record<string, unknown> = {
          latitude: live.latitude, longitude: live.longitude, last_seen_at: catalogueSeenAt && new Date(catalogueSeenAt) <= new Date() && new Date(catalogueSeenAt) > new Date(liveTimestamp) ? catalogueSeenAt : liveTimestamp,
          is_online: isOnline, operational_status: operationalStatus, updated_at: new Date().toISOString(),
        };
        if (live.batteryPercent !== null) trackerUpdate.battery_percent = live.batteryPercent;
        const { error: updateError } = await admin.from("trackers").update(trackerUpdate).eq("id", tracker.id);
        if (updateError) throw updateError;
        const { error: historyError } = await admin.from("tracker_locations").insert({
          vehicle_id: tracker.vehicle_id ?? null, tracker_id: tracker.id, latitude: live.latitude, longitude: live.longitude,
          speed_kph: live.speedKph, recorded_at: live.recordedAt,
        });
        if (historyError) console.error("Tracker route history insert failed", tracker.id, historyError);
        const { error: heartbeatError } = await admin.from("tracker_heartbeats").insert({
          tracker_id: tracker.id, latitude: live.latitude, longitude: live.longitude,
          battery_percent: live.batteryPercent, tracker_status: operationalStatus,
          recorded_at: live.recordedAt,
        });
        if (heartbeatError) console.error("Tracker health history insert failed", tracker.id, heartbeatError);
        refreshed.push({ id: tracker.id, identifier: tracker.identifier, deviceId, cloudDeviceId, status: operationalStatus, recordedAt: live.recordedAt });
      } catch (error) {
        console.error("Tramigo tracker refresh failed", tracker.id, error);
        refreshed.push({ id: tracker.id, identifier: tracker.identifier, deviceId, status: "unreachable", message: error instanceof Error ? error.message : "Tramigo request failed." });
      }
    }
    return response({ trackers: refreshed });
  }

  const adminRouteMatch = route.match(/^\/v1\/admin\/trackers\/([^/]+)\/route$/);
  if (adminRouteMatch && request.method === "GET") {
    const { data: manager, error: managerError } = await admin.from("profiles").select("role,account_status").eq("id", user.id).maybeSingle();
    if (managerError || !manager || !adminRoles.has(manager.role)) return fail("Administrator permission is required to view tracker routes.", 403, "FORBIDDEN");
    const window = routeWindow(url);
    if ("error" in window) return fail(window.error || "Invalid route window.", 422, "INVALID_ROUTE_WINDOW");
    const trackerId = decodeURIComponent(adminRouteMatch[1]);
    const { data: tracker, error: trackerError } = await admin.from("trackers").select("id,identifier,tramigo_device_id,bike_id,vehicle_id").eq("id", trackerId).maybeSingle();
    if (trackerError) return fail("Tracker route could not be loaded.", 503, "ROUTE_UNAVAILABLE");
    if (!tracker) return fail("Tracker not found.", 404, "NOT_FOUND");
    let vehicleId = tracker.vehicle_id;
    if (!vehicleId && tracker.bike_id) {
      const { data: bike } = await admin.from("bikes").select("identifier").eq("id", tracker.bike_id).maybeSingle();
      if (bike?.identifier) {
        const { data: vehicle } = await admin.from("vehicles").select("id").eq("registration", bike.identifier).maybeSingle();
        vehicleId = vehicle?.id ?? null;
        if (vehicleId) await admin.from("trackers").update({ vehicle_id: vehicleId, updated_at: new Date().toISOString() }).eq("id", tracker.id);
      }
    }
    const providerIdentifier = String(tracker.tramigo_device_id ?? tracker.identifier ?? "").trim();
    let providerPointCount = 0; let providerRouteError = false; let providerSummary = null;
    if (providerIdentifier && Deno.env.get("TRAMIGO_USERNAME")) {
      try {
        const providerSession = await tramigoSession();
        const catalogue = await tramigoRequest("/api/v2/devices?page=1&per_page=1000", {}, providerSession);
        const providerRoute = await fetchTramigoRoute(providerIdentifier, window, providerSession, catalogue);
        providerPointCount = providerRoute.points.length; providerSummary = providerRoute.summary;
        if (providerRoute.points.length) {
          const rows = providerRoute.points.map((point) => ({ vehicle_id: vehicleId, tracker_id: tracker.id, latitude: point.latitude, longitude: point.longitude, speed_kph: point.speedKph, recorded_at: point.recordedAt }));
          const { error: historyError } = await admin.from("tracker_locations").insert(rows);
          if (historyError) console.error("Provider route history insert failed", tracker.id, historyError);
        }
      } catch (error) { providerRouteError = true; console.error("Tramigo historical route unavailable", tracker.id, error); }
    }
    try {
      const result = await loadRoute(admin, vehicleId, tracker.id, window);
      return response({ trackerId, identifier: tracker.identifier, ...result, providerPointCount, providerSummary, providerRouteError, message: result.points.length ? undefined : "No saved GPS points for this date." });
    } catch (error) {
      console.error("Admin tracker route load failed", trackerId, error);
      return fail("Tracker route history is temporarily unavailable.", 503, "ROUTE_UNAVAILABLE");
    }
  }

  const screeningDocumentMatch = route.match(/^\/v1\/admin\/screening\/([^/]+)\/documents$/);
  if (screeningDocumentMatch && request.method === "GET") {
    const { data: manager, error: managerError } = await admin.from("profiles").select("role,account_status").eq("id", user.id).maybeSingle();
    if (managerError || !manager || !adminRoles.has(manager.role)) return fail("Administrator permission is required to view identity documents.", 403, "FORBIDDEN");
    const applicationId = decodeURIComponent(screeningDocumentMatch[1]);
    const { data: application, error: applicationError } = await admin
      .from("screening_applications")
      .select(screeningDocumentFields.join(","))
      .eq("id", applicationId)
      .maybeSingle();
    if (applicationError || !application) return fail("Screening application not found.", 404, "NOT_FOUND");
    return response({ documents: await signedScreeningDocuments(admin, application as unknown as Record<string, unknown>) });
  }

  const screeningUpdateMatch = route.match(/^\/v1\/admin\/screening\/([^/]+)$/);
  if (screeningUpdateMatch && request.method === "PATCH") {
    const { data: manager, error: managerError } = await admin.from("profiles").select("role,account_status").eq("id", user.id).maybeSingle();
    if (managerError || !manager || !adminRoles.has(manager.role)) return fail("Administrator permission is required to update customer records.", 403, "FORBIDDEN");
    const applicationId = decodeURIComponent(screeningUpdateMatch[1]);
    const { data: application, error: applicationError } = await admin
      .from("screening_applications")
      .select("id,customer_id,full_name,email,phone,national_id,location,product_type,product_model,customer_photo_url,id_front_url,id_back_url")
      .eq("id", applicationId)
      .maybeSingle();
    if (applicationError || !application) return fail("Screening application not found.", 404, "NOT_FOUND");

    const text = (key: string, current: unknown) => body[key] === undefined ? current : String(body[key] ?? "").trim() || null;
    const email = text("email", application.email);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) return fail("Enter a valid customer email address.", 422, "INVALID_EMAIL");
    const now = new Date().toISOString();
    const applicationChanges: Record<string, unknown> = {
      full_name: text("fullName", application.full_name),
      phone: text("phone", application.phone),
      email,
      national_id: text("nationalId", application.national_id),
      location: text("location", application.location),
      product_type: text("productType", application.product_type),
      product_model: text("productModel", application.product_model),
      updated_at: now,
    };
    const uploadedPaths: string[] = [];
    const replacedPaths: string[] = [];
    let screeningUpdated = false;
    const imageFields = [
      ["customerPhoto", "customer_photo_url", "customer-photo"],
      ["idFrontPhoto", "id_front_url", "national-id-front"],
      ["idBackPhoto", "id_back_url", "national-id-back"],
    ] as const;
    try {
      for (const [bodyField, column, label] of imageFields) {
        if (!body[bodyField]) continue;
        const path = await uploadScreeningDocument(admin, application.id, label, body[bodyField]);
        uploadedPaths.push(path);
        applicationChanges[column] = path;
        const prior = screeningDocumentPath(application[column]);
        if (prior) replacedPaths.push(prior);
      }
      const { data: updated, error: updateError } = await admin.from("screening_applications")
        .update(applicationChanges).eq("id", application.id).select().single();
      if (updateError || !updated) throw updateError ?? new Error("Customer record could not be updated.");
      screeningUpdated = true;
      if (application.customer_id) {
        const { error: customerError } = await admin.from("customers").update({
          full_name: applicationChanges.full_name,
          phone: applicationChanges.phone,
          email: applicationChanges.email,
          national_id: applicationChanges.national_id,
          address: applicationChanges.location,
          updated_at: now,
        }).eq("id", application.customer_id);
        if (customerError) throw customerError;
      }
      try {
        await removeScreeningDocuments(admin, replacedPaths);
      } catch (cleanupError) {
        console.error("Previous screening document cleanup failed", cleanupError);
      }
      let documents: Record<string, string> = {};
      try {
        documents = await signedScreeningDocuments(admin, updated);
      } catch (signingError) {
        console.error("Updated screening document signing failed", signingError);
      }
      return response({ application: updated, documents });
    } catch (error) {
      if (screeningUpdated) {
        const { error: rollbackError } = await admin.from("screening_applications").update({
          full_name: application.full_name,
          phone: application.phone,
          email: application.email,
          national_id: application.national_id,
          location: application.location,
          product_type: application.product_type,
          product_model: application.product_model,
          customer_photo_url: application.customer_photo_url,
          id_front_url: application.id_front_url,
          id_back_url: application.id_back_url,
        }).eq("id", application.id);
        if (rollbackError) console.error("Customer update rollback failed", rollbackError);
      }
      await removeScreeningDocuments(admin, uploadedPaths);
      console.error("Customer update failed", error);
      return fail("Customer updates could not be saved. No image was replaced.", 503, "CUSTOMER_UPDATE_FAILED");
    }
  }

  if (route === "/v1/agent/alerts" && (request.method === "GET" || request.method === "PATCH")) {
    const { data: agentProfile, error: agentError } = await admin.from("profiles").select("role,account_status").eq("id", user.id).maybeSingle();
    if (agentError || !agentProfile || !agentRoles.has(agentProfile.role) || !approvedStatuses.has(agentProfile.account_status)) return fail("Approved agent access is required to manage agent alerts.", 403, "PORTAL_ACCESS_DENIED");
    if (request.method === "GET") {
      const { data, error } = await admin.from("agent_alert_states").select("alert_id,read_at,deleted_at").eq("agent_id", user.id).order("updated_at", { ascending: false }).limit(500);
      return error ? fail("Agent alert preferences could not be loaded.", 503, "AGENT_ALERTS_UNAVAILABLE") : response({ states: data ?? [] });
    }
    const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map(String).map((id: string) => id.trim()).filter(Boolean))].slice(0, 500) : [];
    const action = String(body.action ?? "");
    if (!ids.length || !["read", "delete"].includes(action)) return fail("Choose alert IDs and a read or delete action.", 422, "INVALID_AGENT_ALERT_ACTION");
    const { data: existing, error: existingError } = await admin.from("agent_alert_states").select("alert_id,read_at,deleted_at").eq("agent_id", user.id).in("alert_id", ids);
    if (existingError) return fail("Agent alert preferences could not be updated.", 503, "AGENT_ALERT_UPDATE_FAILED");
    const existingById = new Map((existing ?? []).map((state: any) => [state.alert_id, state]));
    const now = new Date().toISOString();
    const changes = ids.map((alertId: string) => {
      const prior: any = existingById.get(alertId);
      return { agent_id: user.id, alert_id: alertId, read_at: action === "read" ? prior?.read_at ?? now : prior?.read_at ?? null, deleted_at: action === "delete" ? now : prior?.deleted_at ?? null, updated_at: now };
    });
    const { error } = await admin.from("agent_alert_states").upsert(changes, { onConflict: "agent_id,alert_id" });
    return error ? fail("Agent alert preferences could not be updated.", 503, "AGENT_ALERT_UPDATE_FAILED") : response({ updated: ids.length });
  }

  const installationMatch = route.match(/^\/v1\/agent\/customers\/([^/]+)\/installation$/);
  if (installationMatch && request.method === "PATCH") {
    const { data: agentProfile, error: agentError } = await admin.from("profiles").select("role,account_status").eq("id", user.id).maybeSingle();
    if (agentError || !agentProfile || !agentRoles.has(agentProfile.role) || !approvedStatuses.has(agentProfile.account_status)) return fail("Approved agent access is required to update tracker installation.", 403, "PORTAL_ACCESS_DENIED");
    if (typeof body.installed !== "boolean") return fail("Choose whether the tracker is installed.", 422, "INVALID_INSTALLATION_STATUS");
    const targetId = decodeURIComponent(installationMatch[1]);
    const installedAt = body.installed ? new Date().toISOString() : null;
    let { data, error } = await admin.from("screening_applications").update({ tracker_installed_at: installedAt, updated_at: new Date().toISOString() }).eq("id", targetId).eq("installer_agent_id", user.id).select("id,customer_id,tracker_installed_at").maybeSingle();
    if (!data && !error) ({ data, error } = await admin.from("screening_applications").update({ tracker_installed_at: installedAt, updated_at: new Date().toISOString() }).eq("customer_id", targetId).eq("installer_agent_id", user.id).select("id,customer_id,tracker_installed_at").order("created_at", { ascending: false }).limit(1).maybeSingle());
    if (error || !data) return fail("Tracker installation could not be saved for this customer.", 404, "CUSTOMER_NOT_FOUND");
    return response({ customerId: data.customer_id, applicationId: data.id, installed: Boolean(data.tracker_installed_at), installedAt: data.tracker_installed_at });
  }

  const paymentPhoneMatch = route.match(/^\/v1\/agent\/customers\/([^/]+)\/payment-phone$/);
  if (paymentPhoneMatch && request.method === "PATCH") {
    const { data: agentProfile, error: agentError } = await admin.from("profiles").select("role,account_status").eq("id", user.id).maybeSingle();
    if (agentError || !agentProfile || !agentRoles.has(agentProfile.role)) return fail("This account does not have permission to update customer payment details.", 403, "PORTAL_ACCESS_DENIED");
    if (!approvedStatuses.has(agentProfile.account_status)) return fail("Your agent account is awaiting administrator approval.", 403, "ACCOUNT_PENDING_APPROVAL");
    const paymentPhone = String(body.paymentPhone ?? "").trim();
    if (!paymentPhone) return fail("Enter the phone number that should receive the payment prompt.", 422, "INVALID_PAYMENT_PHONE");
    const targetId = decodeURIComponent(paymentPhoneMatch[1]);
    let { data: application, error } = await admin
      .from("screening_applications")
      .update({ payment_phone: paymentPhone, updated_at: new Date().toISOString() })
      .eq("id", targetId)
      .eq("installer_agent_id", user.id)
      .select("customer_id,payment_phone")
      .maybeSingle();
    if (!application && !error) ({ data: application, error } = await admin.from("screening_applications").update({ payment_phone: paymentPhone, updated_at: new Date().toISOString() }).eq("customer_id", targetId).eq("installer_agent_id", user.id).select("customer_id,payment_phone").order("created_at", { ascending: false }).limit(1).maybeSingle());
    if (error || !application) return fail("Customer payment details could not be saved.", 404, "CUSTOMER_NOT_FOUND");
    return response({ customerId: application.customer_id, paymentPhone: application.payment_phone });
  }

  const depositPromptMatch = route.match(/^\/v1\/agent\/customers\/([^/]+)\/deposit-prompt$/);
  if (depositPromptMatch && request.method === "POST") {
    const { data: agentProfile, error: agentError } = await admin.from("profiles").select("role,account_status").eq("id", user.id).maybeSingle();
    if (agentError || !agentProfile || !agentRoles.has(agentProfile.role)) return fail("This account does not have permission to request a customer payment.", 403, "PORTAL_ACCESS_DENIED");
    if (!approvedStatuses.has(agentProfile.account_status)) return fail("Your agent account is awaiting administrator approval.", 403, "ACCOUNT_PENDING_APPROVAL");
    const targetId = decodeURIComponent(depositPromptMatch[1]);
    const amount = Number(body.amount);
    const payerPhone = normalizeKenyanPhone(body.paymentPhone);
    if (!Number.isFinite(amount) || amount <= 0 || !payerPhone) return fail("Enter a valid deposit amount and Kenyan payment phone number.", 422, "INVALID_PAYMENT");
    let { data: application, error: applicationError } = await admin.from("screening_applications")
      .select("id,customer_id,product_id,national_id,bikes(payable_amount)")
      .eq("id", targetId).eq("installer_agent_id", user.id).maybeSingle();
    if (!application && !applicationError) ({ data: application, error: applicationError } = await admin.from("screening_applications").select("id,customer_id,product_id,national_id,bikes(payable_amount)").eq("customer_id", targetId).eq("installer_agent_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle());
    if (applicationError || !application?.customer_id || !application.product_id) return fail("Customer payment details could not be found.", 404, "CUSTOMER_NOT_FOUND");
    let depositAccountNumber = normalizeNationalId(application.national_id);
    if (!depositAccountNumber) {
      const { data: depositCustomer } = await admin.from("customers").select("national_id").eq("id", application.customer_id).maybeSingle();
      depositAccountNumber = normalizeNationalId(depositCustomer?.national_id);
    }
    if (!depositAccountNumber) return fail("The customer's national ID is missing or invalid. Update the customer record before requesting payment.", 409, "CUSTOMER_ID_MISSING");
    const payableAmount = Number((application.bikes as any)?.payable_amount ?? 0);
    if (payableAmount > 0 && amount > payableAmount) return fail("The deposit cannot be higher than the total payable amount.", 422, "INVALID_DEPOSIT");

    // Avoid duplicate prompts and duplicate processing rows when an agent taps
    // twice or retries while Daraja is still waiting for the customer response.
    const { data: activePrompt, error: activePromptError } = await admin.from("payments")
      .select("id,payment_reference,status,checkout_request_id,amount,payer_phone")
      .eq("customer_id", application.customer_id).eq("product_id", application.product_id)
      .eq("payment_type", "deposit").eq("status", "processing")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (activePromptError) return fail("Could not check for an existing deposit prompt.", 503, "PAYMENT_CHECK_FAILED");
    if (activePrompt) {
      if (Number(activePrompt.amount) !== amount || normalizeKenyanPhone(activePrompt.payer_phone) !== payerPhone) {
        return fail("A deposit prompt is already awaiting a response. Wait for it to finish before sending a new amount or phone number.", 409, "DEPOSIT_PROMPT_PENDING", { paymentId: activePrompt.id });
      }
      return response({ payment: { id: activePrompt.id, reference: activePrompt.payment_reference, status: activePrompt.status, checkoutRequestId: activePrompt.checkout_request_id }, replayed: true }, 202);
    }

    const reference = `DEP-${crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`;
    const now = new Date().toISOString();
    const { data: payment, error: paymentError } = await admin.from("payments").insert({
      customer_id: application.customer_id,
      product_id: application.product_id,
      amount,
      currency: "KES",
      status: "processing",
      payer_phone: payerPhone,
      prompted_by: user.id,
      payment_reference: reference,
      payment_type: "deposit",
    }).select("id,payment_reference,status").single();
    if (paymentError || !payment) return fail("The deposit prompt could not be recorded.", 503, "PAYMENT_RECORD_FAILED");
    const { error: applicationUpdateError } = await admin.from("screening_applications").update({
      payment_phone: payerPhone,
      requested_deposit_amount: amount,
      updated_at: now,
    }).eq("id", application.id);
    if (applicationUpdateError) {
      await admin.from("payments").delete().eq("id", payment.id);
      return fail("The payment phone could not be saved.", 503, "PAYMENT_PHONE_SAVE_FAILED");
    }

    try {
      const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
      const result = await darajaPost("/mpesa/stkpush/v1/processrequest", {
        BusinessShortCode: Deno.env.get("DARAJA_SHORTCODE"),
        Password: stkPassword(timestamp),
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: amount,
        PartyA: payerPhone,
        PartyB: Deno.env.get("DARAJA_SHORTCODE"),
        PhoneNumber: payerPhone,
        CallBackURL: Deno.env.get("DARAJA_STK_CALLBACK_URL"),
        AccountReference: depositAccountNumber,
        TransactionDesc: "Bike deposit",
      });
      const checkoutRequestId = stkCheckoutRequestId(result);
      const { error: checkoutUpdateError } = await admin.from("payments").update({ checkout_request_id: checkoutRequestId }).eq("id", payment.id);
      if (checkoutUpdateError) throw checkoutUpdateError;
      await admin.from("daraja_transactions").insert({ direction: "C2B", checkout_request_id: checkoutRequestId, account_reference: reference, phone: payerPhone, amount, status: "submitted", payload: result });
      return response({ payment: { id: payment.id, reference, status: "processing", checkoutRequestId } }, 202);
    } catch (error) {
      await admin.from("payments").update({ status: "failed" }).eq("id", payment.id);
      return fail(error instanceof Error ? error.message : "M-Pesa request failed.", 502, "MPESA_ERROR");
    }
  }

  const accountApprovalMatch = route.match(/^\/v1\/admin\/account-approvals\/([^/]+)$/);
  if ((route === "/v1/admin/account-approvals" && request.method === "GET") || (accountApprovalMatch && request.method === "POST")) {
    const { data: manager, error: managerError } = await admin.from("profiles").select("role,account_status").eq("id", user.id).maybeSingle();
    if (managerError || !manager || !adminRoles.has(manager.role) || !approvedStatuses.has(manager.account_status)) return fail("Administrator approval permission is required.", 403, "FORBIDDEN");

    if (request.method === "GET") {
      const directory = url.searchParams.get("status") === "directory";
      const requestedStatus = url.searchParams.get("status")?.trim().toLowerCase();
      if (requestedStatus && requestedStatus !== "directory" && !new Set(["pending", "approved", "rejected"]).has(requestedStatus)) {
        return fail("Choose a valid account directory status.", 422, "INVALID_ACCOUNT_STATUS");
      }
      const roles = directory ? [...approvableStaffRoles] : [...approvableAccountRoles];
      let accountsQuery = admin
        .from("profiles")
        .select("id,full_name,email,phone,role,account_status,created_at,updated_at")
        .in("role", roles);
      accountsQuery = directory
        ? accountsQuery.neq("account_status", "pending")
        : accountsQuery.eq("account_status", requestedStatus || "pending");
      const { data: accounts, error } = await accountsQuery.order("created_at", { ascending: false });
      if (error) {
        console.error("Account approvals query failed", error);
        return fail("Pending accounts could not be loaded.", 500, "ACCOUNT_APPROVAL_QUERY_FAILED");
      }
      return response({ accounts: accounts ?? [] });
    }

    const accountId = decodeURIComponent(accountApprovalMatch![1]);
    const nextStatus = String(body.status ?? "").trim().toLowerCase();
    if (!new Set(["approved", "rejected"]).has(nextStatus)) return fail("Choose approved or rejected for the account decision.", 422, "INVALID_ACCOUNT_STATUS");
    const { data: account, error: accountError } = await admin
      .from("profiles")
      .select("id,full_name,email,phone,role,account_status")
      .eq("id", accountId)
      .maybeSingle();
    if (accountError || !account || !approvableAccountRoles.has(account.role)) return fail("Pending account not found.", 404, "ACCOUNT_NOT_FOUND");
    if (["admin", "operations_manager"].includes(account.role) && manager.role !== "super_admin") return fail("Only a super administrator can approve administrator accounts.", 403, "PORTAL_ACCESS_DENIED");
    if (account.role === "customer" && nextStatus === "approved") {
      const eligibility = await existingCustomerRecord(admin, String(account.email ?? "").trim().toLowerCase());
      if (eligibility.error) return fail("Customer records could not be checked.", 503, "CUSTOMER_LOOKUP_UNAVAILABLE");
      if (!eligibility.customer || ["rejected", "declined", "suspended"].includes(eligibility.customer.status)) return fail("Account not approved: eligible customer details do not exist in the system.", 403, "CUSTOMER_DETAILS_NOT_FOUND");
    }
    const { data: updated, error: updateError } = await admin
      .from("profiles")
      .update({ account_status: nextStatus, updated_at: new Date().toISOString() })
      .eq("id", account.id)
      .select("id,full_name,email,phone,role,account_status,created_at,updated_at")
      .single();
    if (updateError) {
      console.error("Account approval update failed", updateError);
      return fail("The account decision could not be saved.", 500, "ACCOUNT_APPROVAL_UPDATE_FAILED");
    }
    let pushSent = false;
    if (account.role === "customer" && nextStatus === "approved") {
      const delivery = await issueCustomerApprovalCode(admin, account.id, account.email ?? "");
      if (!delivery.issued) {
        await admin.from("profiles").update({ account_status: account.account_status, updated_at: new Date().toISOString() }).eq("id", account.id);
        return fail("The customer account could not be approved because the approval code could not be created.", 503, "APPROVAL_CODE_UNAVAILABLE");
      }
      pushSent = delivery.pushSent;
    }
    const { error: auditError } = await admin.from("audit_logs").insert({
      actor_id: user.id,
      action: nextStatus === "approved" ? `approved ${account.role} account` : `rejected ${account.role} account`,
      resource: "profiles",
      detail: { account_id: account.id, email: account.email, role: account.role, previous_status: account.account_status, next_status: nextStatus },
    });
    if (auditError) console.error("Account approval audit write failed", auditError);
    const message = nextStatus === "approved"
      ? account.role === "customer"
        ? pushSent
          ? "Customer account approved. The six-digit code was sent in the Jixels Customer app."
          : "Customer account approved. The code is ready, but the device notification was not delivered. Ask the customer to reopen the registered app."
        : "Account approved. The user can now sign in."
      : "Account rejected. The user cannot access the portal.";
    return response({ account: updated, pushSent, message });
  }

  const deleteMatch = route.match(/^\/v1\/admin\/users\/([^/]+)$/);
  const deleteProductMatch = route.match(/^\/v1\/admin\/products\/([^/]+)$/);
  if (deleteProductMatch && request.method === "DELETE") {
    const { data: manager, error: managerError } = await admin.from("profiles").select("role,account_status").eq("id", user.id).maybeSingle();
    if (managerError || !manager || !adminRoles.has(manager.role)) return fail("Administrator permission is required to delete inventory.", 403, "FORBIDDEN");
    const productId = decodeURIComponent(deleteProductMatch[1]);
    const { data: applications, error: applicationsError } = await admin.from("screening_applications").select("customer_id").eq("product_id", productId);
    if (applicationsError) return fail("Inventory links could not be checked.", 500, "PRODUCT_DELETE_FAILED");
    try {
      for (const customerId of new Set((applications ?? []).map((application) => application.customer_id).filter(Boolean))) await removeCustomerWorkspace(admin, customerId);
      const { data: trackers, error: trackersError } = await admin.from("trackers").select("id").eq("bike_id", productId);
      if (trackersError) throw trackersError;
      const trackerIds = (trackers ?? []).map((tracker) => tracker.id);
      if (trackerIds.length) await admin.from("tracker_heartbeats").delete().in("tracker_id", trackerIds);
      await admin.from("trackers").delete().eq("bike_id", productId);
      const { error: deleteError } = await admin.from("bikes").delete().eq("id", productId);
      if (deleteError) throw deleteError;
      return response({ deleted: true, message: "The inventory product and every linked record were permanently deleted." });
    } catch (error) {
      console.error("Inventory deletion failed", error);
      return fail("The inventory product could not be deleted completely.", 500, "PRODUCT_DELETE_FAILED");
    }
  }
  if (deleteMatch && request.method === "DELETE") {
    const targetId = decodeURIComponent(deleteMatch[1]);
    const { data: manager, error: managerError } = await admin.from("profiles").select("role,account_status").eq("id", user.id).maybeSingle();
    if (managerError || !manager || !adminRoles.has(manager.role)) return fail("Administrator permission is required to delete an account.", 403, "FORBIDDEN");
    if (targetId === user.id) return fail("You cannot delete the account currently signed in to Admin.", 422, "CANNOT_DELETE_SELF");
    try {
      const [{ data: targetProfile, error: targetProfileError }, { data: directCustomer, error: directCustomerError }] = await Promise.all([
        admin.from("profiles").select("id,email,role").eq("id", targetId).maybeSingle(),
        admin.from("customers").select("id,email").eq("id", targetId).maybeSingle(),
      ]);
      if (targetProfileError || directCustomerError) throw targetProfileError ?? directCustomerError;
      const email = (directCustomer?.email ?? targetProfile?.email ?? "").trim().toLowerCase();
      const { data: matchingCustomers, error: matchingCustomersError } = email
        ? await admin.from("customers").select("id").eq("email", email)
        : { data: [], error: null };
      if (matchingCustomersError) throw matchingCustomersError;
      const customerIds = new Set([directCustomer?.id, ...(matchingCustomers ?? []).map((customer) => customer.id)].filter(Boolean));
      for (const customerId of customerIds) await removeCustomerWorkspace(admin, customerId);

      const { data: matchingProfiles, error: matchingProfilesError } = email
        ? await admin.from("profiles").select("id,role").eq("email", email)
        : { data: [], error: null };
      if (matchingProfilesError) throw matchingProfilesError;
      const profileIds = new Set([
        targetProfile?.id,
        ...(matchingProfiles ?? []).filter((profile) => profile.role === "customer").map((profile) => profile.id),
      ].filter(Boolean));
      for (const profileId of profileIds) {
        const { error: deleteError } = await admin.auth.admin.deleteUser(profileId);
        if (deleteError) throw deleteError;
      }
      return response({ deleted: true, message: "The account and its linked workspace records were permanently deleted." });
    } catch (error) {
      console.error("Admin account deletion failed", error);
      return fail("The account could not be deleted completely.", 500, "ACCOUNT_DELETE_FAILED");
    }
  }

  if (route === "/v1/admin/screening/approve" && request.method === "POST") {
    const { data: manager, error: managerError } = await admin.from("profiles").select("role,account_status").eq("id", user.id).maybeSingle();
    if (managerError || !manager || !["admin", "super_admin", "operations_manager"].includes(manager.role)) return fail("Administrator approval is required.", 403, "FORBIDDEN");
    const applicationId = String(body.applicationId ?? "").trim();
    const customerId = String(body.customerId ?? "").trim();
    if (!applicationId && !customerId) return fail("A screening application or customer is required.", 422, "INVALID_APPLICATION");
    const applicationQuery = admin.from("screening_applications").select("id,customer_id,email,phone,product_id,tracker_identifier");
    const { data: application, error: applicationError } = applicationId
      ? await applicationQuery.eq("id", applicationId).maybeSingle()
      : await applicationQuery.eq("customer_id", customerId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (applicationError || !application) return fail("Screening application not found.", 404, "NOT_FOUND");
    const now = new Date().toISOString();
    const { error: approvalError } = await admin.from("screening_applications").update({ status: "approved", reviewed_by: user.id, reviewed_at: now, approved_at: now, monthly_service_started_at: now, updated_at: now }).eq("id", application.id);
    if (approvalError) return fail("The screening application could not be approved.", 400, "APPROVAL_FAILED");
    if (application.customer_id) {
      const { data: tracker } = application.product_id
        ? await admin.from("trackers").select("identifier").eq("bike_id", application.product_id).order("created_at", { ascending: true }).limit(1).maybeSingle()
        : { data: null };
      await admin.from("customers").update({ status: "active", tracker_number: application.tracker_identifier || tracker?.identifier || null, updated_at: now }).eq("id", application.customer_id);
      const { error: financeRefreshError } = await admin.rpc("materialize_tracker_sale", { p_application_id: application.id });
      if (financeRefreshError) console.error("Finance sale materialization failed", financeRefreshError);
    }
    return response({ approved: true, message: "Screening approved. Customer app access and its approval code are managed separately in Account approvals." });
  }

  const addVehicleMatch = route.match(/^\/v1\/agent\/customers\/([^/]+)\/vehicles$/);
  if (addVehicleMatch && request.method === "POST") {
    const { data: agentProfile } = await admin.from("profiles").select("role,account_status").eq("id", user.id).maybeSingle();
    if (!agentProfile || !agentRoles.has(agentProfile.role) || !approvedStatuses.has(agentProfile.account_status)) return fail("An approved agent account is required.", 403, "PORTAL_ACCESS_DENIED");
    const customerId = decodeURIComponent(addVehicleMatch[1]);
    const bikeId = String(body.bikeId ?? "").trim();
    const plateNumber = String(body.plateNumber ?? "").trim().toUpperCase();
    const depositAmount = Number(body.depositAmount ?? 0);
    const dueDate = String(body.dueDate ?? "").trim();
    if (!bikeId || !plateNumber) return fail("Choose an available tracker and enter the vehicle plate number.", 422, "INVALID_VEHICLE_ASSIGNMENT");
    if (dueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || Number.isNaN(Date.parse(`${dueDate}T00:00:00Z`)))) return fail("Choose a valid first installment due date.", 422, "INVALID_DUE_DATE");
    const { data: customer } = await admin.from("customers").select("id,full_name,email,phone,national_id,address").eq("id", customerId).maybeSingle();
    const { data: bike } = await admin.from("bikes").select("id,identifier,model,product_type,payable_amount,trackers(identifier)").eq("id", bikeId).eq("assigned_agent_id", user.id).is("customer_id", null).maybeSingle();
    if (!customer || !bike) return fail("The customer or available tracker could not be found.", 404, "ASSIGNMENT_NOT_FOUND");
    const now = new Date().toISOString();
    const { data: reservedBike, error: reserveError } = await admin.from("bikes").update({ customer_id: customer.id, status: "pending", updated_at: now }).eq("id", bike.id).eq("assigned_agent_id", user.id).is("customer_id", null).select("id").maybeSingle();
    if (reserveError || !reservedBike) return fail("That tracker is no longer available.", 409, "TRACKER_ALREADY_SOLD");
    const { error: trackerError } = await admin.from("trackers").update({ plate_number: plateNumber, updated_at: now }).eq("bike_id", bike.id);
    if (trackerError) { await admin.from("bikes").update({ customer_id: null, status: "available", updated_at: now }).eq("id", bike.id); return fail("The vehicle plate could not be saved.", 503, "PLATE_SAVE_FAILED"); }
    const { data: application, error: applicationError } = await admin.from("screening_applications").insert({ customer_id: customer.id, product_id: bike.id, installer_agent_id: user.id, full_name: customer.full_name, email: customer.email, phone: customer.phone, national_id: customer.national_id, location: customer.address, product_identifier: bike.identifier, product_type: bike.product_type, product_model: bike.model, tracker_identifier: (bike as any).trackers?.[0]?.identifier ?? bike.identifier, due_date: dueDate || null, deposit_amount: 0, requested_deposit_amount: Number.isFinite(depositAmount) ? depositAmount : 0, payment_phone: customer.phone, status: "pending", created_at: now, updated_at: now }).select("id").single();
    if (applicationError || !application) { await admin.from("bikes").update({ customer_id: null, status: "available", updated_at: now }).eq("id", bike.id); return fail("The additional vehicle screening could not be created.", 503, "SCREENING_REGISTRATION_FAILED"); }
     return response({ customer: { id: customer.id, applicationId: application.id, vehicleId: bike.id, name: customer.full_name, phone: customer.phone, payerPhone: customer.phone, email: customer.email, plateNumber, bike: bike.identifier, vehicleModel: bike.model, tracker: (bike as any).trackers?.[0]?.identifier ?? bike.identifier, payment: "Pending", install: "Pending", dueDate, requestedDepositAmount: Number.isFinite(depositAmount) ? depositAmount : 0, payableAmount: Number(bike.payable_amount ?? 0), screeningStatus: "pending" } }, 201);
  }

  if (route === "/v1/agent/customers" && (request.method === "GET" || request.method === "POST")) {
    const { data: agentProfile, error: agentError } = await admin.from("profiles").select("role,account_status").eq("id", user.id).maybeSingle();
    if (agentError || !agentProfile || !agentRoles.has(agentProfile.role)) return fail("This account does not have permission to onboard customers.", 403, "PORTAL_ACCESS_DENIED");
    if (!approvedStatuses.has(agentProfile.account_status)) return fail("Your agent account is awaiting administrator approval.", 403, "ACCOUNT_PENDING_APPROVAL");
    if (request.method === "GET") {
    const { data: applications, error } = await admin.from("screening_applications").select("id,customer_id,full_name,email,phone,payment_phone,national_id,location,product_identifier,product_type,product_model,tracker_identifier,tracker_installed_at,deposit_amount,requested_deposit_amount,due_date,status,created_at,customers(email,address,customer_code,plate_number),bikes(id,identifier,model,payable_amount,trackers(identifier,plate_number))").eq("installer_agent_id", user.id).order("created_at", { ascending: false });
      if (error) return fail("Agent customers could not be loaded.", 503, "CUSTOMERS_UNAVAILABLE");
      const customerIds = [...new Set((applications ?? []).map((item: any) => item.customer_id).filter(Boolean))];
    const { data: payments, error: paymentsError } = customerIds.length
        ? await admin.from("payments").select("id,customer_id,product_id,amount,status,payment_type,paid_at,receipt_number,payer_phone,payment_reference,created_at").in("customer_id", customerIds).in("status", ["processing", "paid", "completed", "confirmed"])
        : { data: [], error: null };
      if (paymentsError) return fail("Customer payment records could not be loaded.", 503, "PAYMENTS_UNAVAILABLE");
      const { data: financeSettings, error: financeSettingsError } = await admin.from("finance_settings").select("data").eq("id", "default").maybeSingle();
      if (financeSettingsError) return fail("Commission settings could not be loaded.", 503, "COMMISSION_SETTINGS_UNAVAILABLE");
      const saleCommission = Number(financeSettings?.data?.saleCommission ?? 0);
      const monthlyCustomerCommission = Number(financeSettings?.data?.monthlyCustomerCommission ?? 0);
      const commissionNow = new Date();
      const commissionMonthStart = new Date(commissionNow.getFullYear(), commissionNow.getMonth(), 1);
      const commissionNextMonthStart = new Date(commissionNow.getFullYear(), commissionNow.getMonth() + 1, 1);
      const paymentBySale = new Map<string, any[]>();
      for (const payment of payments ?? []) {
        const key = `${payment.customer_id}:${payment.product_id}`;
        paymentBySale.set(key, [...(paymentBySale.get(key) ?? []), payment]);
      }
      return response({ customers: (applications ?? []).map((item: any) => {
        const salePayments = paymentBySale.get(`${item.customer_id}:${item.bikes?.id ?? item.product_id}`) ?? [];
        const seenPaymentTransactions = new Set<string>();
        const uniqueSalePayments = salePayments.filter((payment) => {
          const receipt = String(payment.receipt_number || payment.payment_reference || payment.id);
          if (seenPaymentTransactions.has(receipt)) return false;
          seenPaymentTransactions.add(receipt);
          return true;
        });
        const confirmed = uniqueSalePayments.filter((payment) => ["paid", "completed", "confirmed"].includes(String(payment.status).toLowerCase()));
        const confirmedDepositAmount = confirmed
          .filter((payment) => String(payment.payment_type ?? "daily").toLowerCase().replace(/[ _-]/g, "") === "deposit")
          .reduce((total, payment) => total + Number(payment.amount ?? 0), 0);
        const monthlyPayments = confirmed.filter((payment) => {
          const paymentType = String(payment.payment_type ?? "daily").toLowerCase().replace(/[ _-]/g, "");
          const paidAt = new Date(payment.paid_at ?? payment.created_at ?? "");
          return paymentType !== "deposit" && Number.isFinite(paidAt.getTime()) && paidAt >= commissionMonthStart && paidAt < commissionNextMonthStart;
        });
        const processing = uniqueSalePayments.find((payment) => String(payment.status).toLowerCase() === "processing" && String(payment.payment_type ?? "daily").toLowerCase().replace(/[ _-]/g, "") === "deposit");
        const amountPaid = confirmed.reduce((total, payment) => total + Number(payment.amount ?? 0), 0);
        const requestedDepositAmount = Number(item.requested_deposit_amount ?? 0);
        const depositPaid = requestedDepositAmount > 0
          && Math.max(Number(item.deposit_amount ?? 0), confirmedDepositAmount) >= requestedDepositAmount;
        return {
          id: item.customer_id ?? item.id,
          applicationId: item.id,
          customerCode: item.customers?.customer_code ?? "",
          vehicleId: item.bikes?.id ?? "",
          name: item.full_name,
          phone: item.phone ?? "",
          email: item.email ?? item.customers?.email ?? "",
          location: item.location ?? item.customers?.address ?? "",
          payerPhone: item.payment_phone ?? processing?.payer_phone ?? confirmed[0]?.payer_phone ?? "",
          idNumber: item.national_id ?? "",
          plateNumber: item.bikes?.trackers?.[0]?.plate_number ?? item.customers?.plate_number ?? item.bikes?.identifier ?? "",
          bike: item.product_identifier ?? item.bikes?.identifier ?? "Pending assignment",
          vehicleModel: item.product_model ?? item.bikes?.model ?? "Assigned bike",
          tracker: item.tracker_identifier ?? item.bikes?.trackers?.[0]?.identifier ?? "Pending",
          kyc: item.status === "approved" ? "Approved" : "Submitted",
          install: item.tracker_installed_at ? (depositPaid ? "Complete" : "Awaiting deposit") : "Pending",
          installationConfirmed: Boolean(item.tracker_installed_at),
          payment: depositPaid ? "Deposit Paid" : processing ? "Processing" : "Pending",
          requestedDepositAmount,
          payableAmount: Number(item.bikes?.payable_amount ?? 0),
          amount: amountPaid,
          balance: Math.max(0, Number(item.bikes?.payable_amount ?? 0) - amountPaid),
          commission: item.status === "approved" ? saleCommission + (monthlyPayments.length * monthlyCustomerCommission) : 0,
          receipt: confirmed[0]?.receipt_number ?? processing?.payment_reference ?? "",
          date: item.created_at?.slice(0, 10) ?? "",
          screeningStatus: item.status,
          dueDate: item.due_date ?? null,
        };
      }) });
    }
    const name = String(body.name ?? "").trim();
    const phone = String(body.phone ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const nationalId = normalizeNationalId(body.nationalId);
    const location = String(body.location ?? "").trim();
    const plateNumber = String(body.plateNumber ?? "").trim().toUpperCase();
    const bikeId = String(body.bikeId ?? "").trim();
    const depositAmount = Number(body.depositAmount ?? 0);
    const dueDate = String(body.dueDate ?? "").trim();
    if (!name || !phone || !email || !nationalId || !bikeId || !body.customerPhoto || !body.idFrontPhoto || !body.idBackPhoto) return fail("Enter the customer name, phone number, a valid national ID, assigned bike, and all three images.", 422, "INVALID_CUSTOMER_REGISTRATION");
    if (dueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || Number.isNaN(Date.parse(`${dueDate}T00:00:00Z`)))) return fail("Choose a valid first installment due date.", 422, "INVALID_DUE_DATE");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Enter a valid customer email address.", 422, "INVALID_EMAIL");
    if (!Number.isFinite(depositAmount) || depositAmount < 0) return fail("Enter a valid customer deposit amount.", 422, "INVALID_DEPOSIT");
    const { data: bike, error: bikeError } = await admin.from("bikes").select("id,identifier,model,product_type,payable_amount,status,customer_id,trackers(identifier,plate_number)").eq("id", bikeId).eq("assigned_agent_id", user.id).maybeSingle();
    if (bikeError || !bike) return fail("This bike is not assigned to your agent account.", 403, "BIKE_NOT_ASSIGNED");
    if (bike.customer_id || ["pending", "sold"].includes(String(bike.status).toLowerCase())) return fail("This tracker is already linked to another customer sale.", 409, "TRACKER_ALREADY_SOLD");
    if (depositAmount > Number(bike.payable_amount ?? 0)) return fail("The deposit cannot be higher than the total payable amount.", 422, "INVALID_DEPOSIT");
    const now = new Date().toISOString();
    const { data: customer, error: customerError } = await admin.from("customers").insert({ full_name: name, email, phone, national_id: nationalId, address: location || null, plate_number: plateNumber || null, status: "pending", created_at: now, updated_at: now }).select("id,customer_code").single();
    if (customerError || !customer) return fail("Customer registration could not be saved.", 503, "CUSTOMER_REGISTRATION_FAILED");

    // This conditional update is the transaction boundary that prevents two
    // onboarding requests from claiming the same tracker.
    const { data: reservedBike, error: reservationError } = await admin.from("bikes")
      .update({ customer_id: customer.id, status: "pending", updated_at: now })
      .eq("id", bike.id)
      .eq("assigned_agent_id", user.id)
      .is("customer_id", null)
      .select("id")
      .maybeSingle();
    if (reservationError || !reservedBike) {
      await admin.from("customers").delete().eq("id", customer.id);
      return fail("The tracker was just assigned to another customer. Choose another assigned tracker.", 409, "TRACKER_ALREADY_SOLD");
    }

    if (plateNumber) {
      const { error: plateError } = await admin.from("trackers").update({ plate_number: plateNumber, updated_at: now }).eq("bike_id", bike.id);
      if (plateError) {
        await admin.from("bikes").update({ customer_id: null, status: "available", updated_at: now }).eq("id", bike.id).eq("customer_id", customer.id);
        await admin.from("customers").delete().eq("id", customer.id);
        return fail("The vehicle plate number could not be saved.", 503, "PLATE_UPDATE_FAILED");
      }
    }

    const { data: application, error: applicationError } = await admin.from("screening_applications").insert({ customer_id: customer.id, product_id: bike.id, installer_agent_id: user.id, full_name: name, email, phone, national_id: nationalId, location: location || null, product_identifier: bike.identifier, product_type: bike.product_type, product_model: bike.model, tracker_identifier: bike.trackers?.[0]?.identifier ?? bike.identifier, due_date: dueDate || null, deposit_amount: 0, requested_deposit_amount: depositAmount, payment_phone: phone, status: "pending", created_at: now, updated_at: now }).select("id").single();
    if (applicationError || !application) {
      await admin.from("bikes").update({ customer_id: null, status: "available", updated_at: now }).eq("id", bike.id).eq("customer_id", customer.id);
      await admin.from("customers").delete().eq("id", customer.id);
      return fail("Customer screening could not be submitted.", 503, "SCREENING_REGISTRATION_FAILED");
    }

    const uploadedPaths: string[] = [];
    try {
      const customerPhotoUrl = await uploadScreeningDocument(admin, application.id, "customer-photo", body.customerPhoto);
      uploadedPaths.push(customerPhotoUrl);
      const idFrontUrl = await uploadScreeningDocument(admin, application.id, "national-id-front", body.idFrontPhoto);
      uploadedPaths.push(idFrontUrl);
      const idBackUrl = await uploadScreeningDocument(admin, application.id, "national-id-back", body.idBackPhoto);
      uploadedPaths.push(idBackUrl);
      const { error: documentsError } = await admin.from("screening_applications").update({ customer_photo_url: customerPhotoUrl, id_front_url: idFrontUrl, id_back_url: idBackUrl, updated_at: now }).eq("id", application.id);
      if (documentsError) throw documentsError;
    } catch (error) {
      console.error("Customer screening document upload failed", error);
      await removeScreeningDocuments(admin, uploadedPaths);
      await admin.from("screening_applications").delete().eq("id", application.id);
      await admin.from("bikes").update({ customer_id: null, status: "available", updated_at: now }).eq("id", bike.id).eq("customer_id", customer.id);
      await admin.from("customers").delete().eq("id", customer.id);
      return fail("Customer images could not be saved. The registration was not submitted; capture the three images again.", 503, "SCREENING_DOCUMENTS_FAILED");
    }
    return response({ customer: { id: customer.id, applicationId: application.id, customerCode: customer.customer_code ?? "", vehicleId: bike.id, name, phone, payerPhone: phone, email, idNumber: nationalId, location: location || "Field location", plateNumber: plateNumber || bike.trackers?.[0]?.plate_number || bike.identifier, bike: bike.identifier, vehicleModel: bike.model, tracker: bike.trackers?.[0]?.identifier ?? "Pending", kyc: "Submitted", install: "Pending", payment: "Pending", requestedDepositAmount: depositAmount, dueDate, payableAmount: Number(bike.payable_amount ?? 0), amount: 0, balance: Number(bike.payable_amount ?? 0), commission: 0, receipt: "", date: now.slice(0, 10), screeningStatus: "pending" } }, 201);
  }

  if (route === "/v1/agent/assignments" && request.method === "GET") {
    const { data: agentProfile, error: agentError } = await admin
      .from("profiles")
      .select("role,account_status")
      .eq("id", user.id)
      .maybeSingle();
    if (agentError || !agentProfile || !agentRoles.has(agentProfile.role)) return fail("This account does not have permission to view assigned trackers.", 403, "PORTAL_ACCESS_DENIED");
    if (!approvedStatuses.has(agentProfile.account_status)) return fail("Your agent account is awaiting administrator approval.", 403, "ACCOUNT_PENDING_APPROVAL");

    const { data: bikes, error } = await admin
      .from("bikes")
      .select("id,identifier,model,product_type,payable_amount,status,assigned_agent_id,trackers(identifier,plate_number)")
      .eq("assigned_agent_id", user.id)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("Agent assignment load failed", error);
      return fail("Assigned trackers could not be loaded.", 503, "ASSIGNMENTS_UNAVAILABLE");
    }
    return response({ assignments: (bikes ?? []).map((bike: any) => ({
      id: bike.id,
      registration: bike.trackers?.[0]?.plate_number || bike.identifier,
      model: bike.model,
      product_type: bike.product_type,
      payable_amount: bike.payable_amount,
      status: bike.status,
      assigned_agent_id: bike.assigned_agent_id,
      tracker: bike.trackers?.[0]?.identifier ?? "Pending",
    })) });
  }

  if (route === "/v1/customer/overview" && request.method === "GET") {
    let billing;
    try { billing = await customerMonthlyBilling(admin, user.id); }
    catch (error) { return fail(error instanceof Error ? error.message : "Customer billing status is temporarily unavailable.", 503, "CUSTOMER_BILLING_UNAVAILABLE"); }
    const { data: profile, error: profileError } = await client.from("profiles").select("full_name,email,phone,avatar_url").single();
    if (profileError || !profile) return fail("This customer account is no longer available.", 404, "ACCOUNT_NOT_FOUND");
    const { data: customer, error: customerError } = await admin.from("customers").select("id,national_id").ilike("email", String(profile.email ?? "").trim()).maybeSingle();
    if (customerError) return fail("Customer vehicles could not be loaded.", 503, "CUSTOMER_RECORDS_UNAVAILABLE");
    const { data: bikes, error: bikesError } = customer?.id
      ? await admin.from("bikes").select("id,identifier,model,product_type,payable_amount,status,monitoring_armed,immobilized,trackers(identifier,plate_number,is_online,latitude,longitude,last_seen_at)").eq("customer_id", customer.id)
      : { data: [], error: null };
    if (bikesError) return fail("Customer vehicles could not be loaded.", 503, "CUSTOMER_RECORDS_UNAVAILABLE");
    const bikeIds = (bikes ?? []).map((bike: any) => bike.id);
    const [{ data: confirmedPayments }, { data: financeAccounts }] = await Promise.all([
      customer?.id && bikeIds.length ? admin.from("payments").select("product_id,amount").eq("customer_id", customer.id).in("product_id", bikeIds).in("status", ["paid", "completed", "confirmed"]) : Promise.resolve({ data: [] }),
      customer?.id ? admin.from("finance_accounts").select("external_id,due_at,outstanding,status,data").eq("customer_id", customer.id) : Promise.resolve({ data: [] }),
    ]);
    const paidByBike = new Map<string, number>();
    for (const payment of confirmedPayments ?? []) paidByBike.set(String(payment.product_id), (paidByBike.get(String(payment.product_id)) ?? 0) + Number(payment.amount ?? 0));
    const accountByBike = new Map<string, any>();
    for (const account of financeAccounts ?? []) {
      const product = String(account.data?.productId ?? account.data?.product ?? account.data?.bike ?? "");
      if (product) accountByBike.set(product, account);
    }
    const now = Date.now();
    const vehicles = (bikes ?? []).map((bike: any) => {
      const total = Number(bike.payable_amount ?? 0);
      const account = accountByBike.get(String(bike.id)) ?? accountByBike.get(String(bike.identifier));
      const paid = paidByBike.get(String(bike.id)) ?? 0;
      const balance = Math.max(0, Number(account?.outstanding ?? total - paid));
      const dueAt = account?.due_at ?? account?.data?.dueAt ?? null;
      const financeStatus = balance <= 0 ? "Completed" : dueAt && new Date(dueAt).getTime() < now ? "Overdue" : account?.data?.status ?? "On Track";
      const serviceBilling = billing.vehicles.find((item: any) => item.bikeId === String(bike.id));
      return { id: bike.id, registration: bike.trackers?.[0]?.plate_number || bike.identifier, identifier: bike.identifier, model: bike.model || "Jixels vehicle", vehicle_type: bike.product_type, product_type: bike.product_type, tracker: bike.trackers?.[0]?.identifier ?? "Pending", status: bike.trackers?.[0]?.is_online ? "online" : "offline", is_online: Boolean(bike.trackers?.[0]?.is_online), latitude: bike.trackers?.[0]?.latitude, longitude: bike.trackers?.[0]?.longitude, last_seen_at: bike.trackers?.[0]?.last_seen_at, total, payable_amount: total, paid, balance, outstanding: balance, finance_status: financeStatus, monthly_payment: serviceBilling?.monthlyAmount ?? CUSTOMER_MONTHLY_AMOUNT, service_payment_due: serviceBilling?.amountDue ?? 0, service_due_at: serviceBilling?.overdueSince ?? null, service_locked: serviceBilling?.locked ?? false, next_payment: dueAt ? new Date(dueAt).toLocaleDateString("en-KE", { timeZone: "Africa/Nairobi" }) : "", monitoring_armed: Boolean(bike.monitoring_armed), immobilized: Boolean(bike.immobilized) };
    });
    const visibleVehicles = billing.locked ? vehicles.map((vehicle: any) => ({
      id: vehicle.id, registration: vehicle.registration, identifier: vehicle.identifier, model: vehicle.model,
      total: vehicle.total, payable_amount: vehicle.payable_amount, balance: vehicle.balance, outstanding: vehicle.outstanding,
      monthly_payment: vehicle.monthly_payment, service_payment_due: vehicle.service_payment_due,
    })) : vehicles;
    return response({ profile: { ...profile, national_id: customer?.national_id ?? null }, billing, vehicles: visibleVehicles });
  }
  if (route === "/v1/customer/payments" && request.method === "DELETE") {
    const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map(String).map((id: string) => id.trim()).filter(Boolean))].slice(0, 200) : [];
    if (!ids.length || ids.some((id: string) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) return fail("Choose valid payment records to hide.", 422, "INVALID_PAYMENT_IDS");
    const { data: requestPayments, error: requestError } = await admin.from("payment_requests").select("id").eq("owner_id", user.id).in("id", ids);
    if (requestError) return fail("Payment history could not be updated.", 503, "PAYMENT_HISTORY_UPDATE_FAILED");
    const { data: profile } = await admin.from("profiles").select("email").eq("id", user.id).maybeSingle();
    const { data: customer } = profile?.email ? await admin.from("customers").select("id").ilike("email", String(profile.email).trim()).maybeSingle() : { data: null };
    const { data: businessPayments, error: businessError } = customer?.id
      ? await admin.from("payments").select("id").eq("customer_id", customer.id).in("id", ids)
      : { data: [], error: null };
    if (businessError) return fail("Payment history could not be updated.", 503, "PAYMENT_HISTORY_UPDATE_FAILED");
    const ownedIds = new Set([...(requestPayments ?? []), ...(businessPayments ?? [])].map((payment: any) => payment.id));
    if (ownedIds.size !== ids.length) return fail("One or more payment records were not found in your account.", 404, "PAYMENT_NOT_FOUND");
    const { error } = await admin.from("customer_payment_dismissals").upsert(ids.map((paymentId: string) => ({ user_id: user.id, payment_id: paymentId })), { onConflict: "user_id,payment_id", ignoreDuplicates: true });
    return error ? fail("Payment history could not be updated.", 503, "PAYMENT_HISTORY_UPDATE_FAILED") : response({ dismissed: ids.length });
  }
  if (route === "/v1/customer/payments" && request.method === "GET") {
    const { data, error } = await admin.from("payment_requests").select("id,vehicle_id,bike_id,amount,phone,status,provider_reference,created_at,vehicles(registration),bikes(identifier,trackers(plate_number))").eq("owner_id", user.id).order("created_at", { ascending: false }).limit(200);
    if (error) return fail("Payment history is temporarily unavailable.", 503, "PAYMENT_HISTORY_UNAVAILABLE");
    const { data: profile } = await admin.from("profiles").select("email").eq("id", user.id).maybeSingle();
    const { data: customer } = profile?.email ? await admin.from("customers").select("id").ilike("email", String(profile.email).trim()).maybeSingle() : { data: null };
    const { data: customerBikes, error: customerBikesError } = customer?.id
      ? await admin.from("bikes").select("id").eq("customer_id", customer.id)
      : { data: [], error: null };
    if (customerBikesError) return fail("Payment history is temporarily unavailable.", 503, "PAYMENT_HISTORY_UNAVAILABLE");
    const bikeIds = [...new Set([...(data ?? []).map((payment: any) => payment.bike_id), ...(customerBikes ?? []).map((bike: any) => bike.id)].filter(Boolean))];
    const { data: businessPayments, error: businessPaymentError } = customer?.id && bikeIds.length
      ? await admin.from("payments").select("id,product_id,amount,status,receipt_number,payment_reference,payment_type,paid_at,created_at,payer_phone,bikes(identifier,trackers(plate_number))").eq("customer_id", customer.id).in("product_id", bikeIds).order("created_at", { ascending: false }).limit(200)
      : { data: [], error: null };
    if (businessPaymentError) return fail("Payment history is temporarily unavailable.", 503, "PAYMENT_HISTORY_UNAVAILABLE");
    const paymentRows: Array<Record<string, unknown>> = (data ?? []).map((payment: any) => ({ id: payment.id, vehicleId: payment.vehicle_id ?? payment.bike_id, registration: payment.vehicles?.registration ?? payment.bikes?.trackers?.[0]?.plate_number ?? payment.bikes?.identifier ?? "Vehicle", date: payment.created_at, amount: Number(payment.amount), status: payment.status === "paid" ? "Confirmed" : payment.status, paymentType: "M-Pesa", mpesaReceiptNumber: payment.status === "paid" ? payment.provider_reference ?? "Confirmed" : "Pending", payerPhone: payment.phone }));
    const receipts = new Set(paymentRows.filter((payment: any) => payment.status === "Confirmed").map((payment: any) => payment.mpesaReceiptNumber));
    for (const payment of businessPayments ?? []) {
      const receipt = payment.receipt_number || payment.payment_reference || payment.id;
      const samePaymentRequest = payment.payment_reference?.startsWith("MOBILE-") && (data ?? []).some((request: any) => request.id === payment.payment_reference.slice("MOBILE-".length));
      if (samePaymentRequest || receipts.has(receipt)) continue;
      receipts.add(receipt);
      paymentRows.push({ id: payment.id, vehicleId: payment.product_id, registration: payment.bikes?.trackers?.[0]?.plate_number ?? payment.bikes?.identifier ?? "Vehicle", date: payment.paid_at ?? payment.created_at, amount: Number(payment.amount), status: ["paid", "completed", "confirmed"].includes(String(payment.status).toLowerCase()) ? "Confirmed" : payment.status, paymentType: String(payment.payment_type ?? "daily").toLowerCase() === "deposit" ? "Deposit" : "M-Pesa", mpesaReceiptNumber: payment.receipt_number || payment.payment_reference || "Confirmed", payerPhone: payment.payer_phone ?? "" });
    }
    const { data: dismissals, error: dismissalsError } = await admin.from("customer_payment_dismissals").select("payment_id").eq("user_id", user.id);
    if (dismissalsError) return fail("Payment history is temporarily unavailable.", 503, "PAYMENT_HISTORY_UNAVAILABLE");
    const dismissedIds = new Set((dismissals ?? []).map((item: any) => item.payment_id));
    const visiblePayments = paymentRows.filter((payment: any) => !dismissedIds.has(payment.id));
    visiblePayments.sort((left: any, right: any) => new Date(right.date).getTime() - new Date(left.date).getTime());
    return response({ payments: visiblePayments.slice(0, 200) });
  }
  if (route === "/v1/customer/payments/mpesa" && request.method === "POST") {
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim(); const amount = Number(body.amount); const phone = String(body.phone ?? "").replace(/\D/g, "");
    if (!idempotencyKey || !Number.isFinite(amount) || amount <= 0 || !/^254\d{9}$/.test(phone)) return fail("Valid amount, Kenyan phone number, and Idempotency-Key are required.", 422, "INVALID_PAYMENT");
    const { data: existing, error: existingError } = await admin.from("payment_requests").select("id,status,provider_reference,amount,phone,vehicle_id,bike_id").eq("owner_id", user.id).eq("idempotency_key", idempotencyKey).maybeSingle();
    if (existingError) return fail("Could not verify this payment attempt. Please retry safely.", 503, "PAYMENT_LOOKUP_FAILED");
    if (existing) {
      const existingPhone = String(existing.phone ?? "").replace(/\D/g, "");
      const existingVehicleId = existing.vehicle_id ?? existing.bike_id;
      if (Number(existing.amount) !== amount || existingPhone !== phone || existingVehicleId !== body.vehicleId) return fail("This payment attempt key is already tied to another payment. Start a new attempt.", 409, "IDEMPOTENCY_KEY_REUSED");
      // Replaying an attempt returns its original state. Never issue a second STK
      // request for the same idempotency key, even if Daraja's first response was lost.
      return response({ payment: { id: existing.id, status: existing.status, checkoutRequestId: existing.provider_reference ?? undefined }, replayed: true });
    }
    const { data: vehicle } = await admin.from("vehicles").select("id").eq("id", body.vehicleId).eq("owner_id", user.id).maybeSingle();
    let vehicleId = vehicle?.id ?? null;
    let bikeId: string | null = null;
    const { data: profile } = await admin.from("profiles").select("email").eq("id", user.id).maybeSingle();
    const { data: customer } = profile?.email
      ? await admin.from("customers").select("id,national_id").ilike("email", String(profile.email).trim()).maybeSingle()
      : { data: null };
    const customerAccountNumber = normalizeNationalId(customer?.national_id);
    if (!customerAccountNumber) return fail("Your national ID is missing or invalid. Contact Jixels support before making a payment.", 409, "CUSTOMER_ID_MISSING");
    if (!vehicleId) {
      const { data: bike } = await admin.from("bikes").select("id,customer_id").eq("id", body.vehicleId).maybeSingle();
      if (!bike || !customer?.id || bike.customer_id !== customer.id) return fail("Vehicle not found.", 404, "NOT_FOUND");
      bikeId = bike.id;
    }
    const attemptTargetFilter = bikeId ? { column: "bike_id", value: bikeId } : { column: "vehicle_id", value: vehicleId };
    const { data: activePayment, error: activePaymentError } = await admin.from("payment_requests")
      .select("id,idempotency_key,status,provider_reference,amount,phone,vehicle_id,bike_id")
      .eq("owner_id", user.id).eq(attemptTargetFilter.column, attemptTargetFilter.value)
      .in("status", ["pending", "processing"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (activePaymentError) return fail("Could not check for another payment in progress.", 503, "PAYMENT_CHECK_FAILED");
    if (activePayment) {
      const sameAttempt = activePayment.idempotency_key === idempotencyKey
        && Number(activePayment.amount) === amount
        && String(activePayment.phone ?? "").replace(/\D/g, "") === phone;
      if (sameAttempt) return response({ payment: { id: activePayment.id, status: activePayment.status, checkoutRequestId: activePayment.provider_reference ?? undefined }, replayed: true });
      return fail("A payment request is already awaiting a response. Wait for it to finish before requesting another prompt.", 409, "PAYMENT_ALREADY_PROCESSING", { paymentId: activePayment.id });
    }
    const { data: payment, error } = await admin.from("payment_requests").insert({ owner_id: user.id, vehicle_id: vehicleId, bike_id: bikeId, idempotency_key: idempotencyKey, amount, phone, status: "processing" }).select("id,status").single();
    if (error) {
      // Two quick taps can race through the read above. The unique key is the
      // concurrency guard; return its winning request instead of failing/retrying.
      const { data: racedRequest } = await admin.from("payment_requests").select("id,status,provider_reference,amount,phone,vehicle_id,bike_id").eq("owner_id", user.id).eq("idempotency_key", idempotencyKey).maybeSingle();
      if (racedRequest) {
        const sameAttempt = Number(racedRequest.amount) === amount
          && String(racedRequest.phone ?? "").replace(/\D/g, "") === phone
          && (racedRequest.vehicle_id ?? racedRequest.bike_id) === body.vehicleId;
        if (sameAttempt) return response({ payment: { id: racedRequest.id, status: racedRequest.status, checkoutRequestId: racedRequest.provider_reference ?? undefined }, replayed: true });
        return fail("This payment attempt key is already tied to another payment. Start a new attempt.", 409, "IDEMPOTENCY_KEY_REUSED");
      }
      return fail("The payment could not be recorded.", 503, "PAYMENT_RECORD_FAILED");
    }
    try { const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14); const result = await darajaPost("/mpesa/stkpush/v1/processrequest", { BusinessShortCode: Deno.env.get("DARAJA_SHORTCODE"), Password: stkPassword(timestamp), Timestamp: timestamp, TransactionType: "CustomerPayBillOnline", Amount: amount, PartyA: phone, PartyB: Deno.env.get("DARAJA_SHORTCODE"), PhoneNumber: phone, CallBackURL: Deno.env.get("DARAJA_STK_CALLBACK_URL"), AccountReference: customerAccountNumber, TransactionDesc: "Bike payment" }); const checkoutRequestId = stkCheckoutRequestId(result); const { error: linkError } = await admin.from("payment_requests").update({ provider_reference: checkoutRequestId, status: "processing", updated_at: new Date().toISOString() }).eq("id", payment.id); if (linkError) throw linkError; await admin.from("daraja_transactions").insert({ direction: "C2B", checkout_request_id: checkoutRequestId, account_reference: idempotencyKey, phone, amount, status: "submitted", payload: result }); return response({ ...payment, ...result }, 202); }
    catch (cause) { await admin.from("payment_requests").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", payment.id); return fail(cause instanceof Error ? cause.message : "M-Pesa request failed.", 502, "MPESA_ERROR"); }
  }
  const statusMatch = route.match(/^\/v1\/customer\/motorcycles\/([^/]+)\/security-status$/);
  if (statusMatch && request.method === "GET") {
    const vehicleId = decodeURIComponent(statusMatch[1]);
    const ownedBike = await customerBikeForUser(admin, user.id, vehicleId);
    if (ownedBike.error) return fail("Vehicle security could not be loaded.", 503, "SECURITY_STATUS_UNAVAILABLE");
    if (ownedBike.bike) {
      const readiness = await bikeActivationReadiness(admin, ownedBike.bike);
      if (readiness.error) return fail("Vehicle installation and deposit status could not be checked.", 503, "VEHICLE_ACTIVATION_STATUS_UNAVAILABLE");
      const identifier = String(ownedBike.tracker?.tramigo_device_id ?? ownedBike.tracker?.identifier ?? "").trim();
      const deviceId = String(ownedBike.tracker?.tramigo_device_id ?? (/^\d{10,20}$/.test(identifier) ? identifier : ""));
      let provider = null;
      const configuredPath = Deno.env.get("TRAMIGO_CLOUD_OUTBOUND_STATUS_PATH");
      if (deviceId && configuredPath) {
        try { provider = await tramigoRequest(tramigoPath(configuredPath, deviceId)); } catch (_) { /* Keep last saved customer security state. */ }
      }
      return response({ vehicleId, monitoringArmed: Boolean((ownedBike.bike as any).monitoring_armed), immobilized: Boolean((ownedBike.bike as any).immobilized), securityReady: readiness.ready, securityMessage: readiness.message, provider });
    }
    const { data: vehicle, error } = await admin.from("vehicles").select("id,tracker_imei,monitoring_armed,immobilized").eq("id", vehicleId).eq("owner_id", user.id).maybeSingle();
    if (error) return fail("Vehicle security could not be loaded.", 503, "SECURITY_STATUS_UNAVAILABLE");
    if (!vehicle) return fail("Vehicle not found.", 404, "NOT_FOUND");
    let provider = null;
    const configuredPath = Deno.env.get("TRAMIGO_CLOUD_OUTBOUND_STATUS_PATH");
    if (vehicle.tracker_imei && configuredPath) {
      try { provider = await tramigoRequest(tramigoPath(configuredPath, vehicle.tracker_imei)); } catch (_) { /* Return the last trusted local state. */ }
    }
    return response({ vehicleId, monitoringArmed: vehicle.monitoring_armed, immobilized: vehicle.immobilized, provider });
  }
  if (route === "/v1/customer/motorcycles/security-status" && request.method === "GET") {
    const [{ data: vehicles, error: vehicleError }, { data: profile, error: profileError }] = await Promise.all([
      admin.from("vehicles").select("id,registration,monitoring_armed,immobilized").eq("owner_id", user.id),
      admin.from("profiles").select("email").eq("id", user.id).maybeSingle(),
    ]);
    if (vehicleError || profileError) return fail("Vehicle security could not be loaded.", 503, "SECURITY_STATUS_UNAVAILABLE");
    const email = String(profile?.email ?? "").trim();
    const { data: customer, error: customerError } = email ? await admin.from("customers").select("id").ilike("email", email).maybeSingle() : { data: null, error: null };
    if (customerError) return fail("Vehicle security could not be loaded.", 503, "SECURITY_STATUS_UNAVAILABLE");
    const { data: customerBikes, error: bikeError } = customer?.id
      ? await admin.from("bikes").select("id,identifier,monitoring_armed,immobilized,trackers(id,identifier,tramigo_device_id)").eq("customer_id", customer.id)
      : { data: [], error: null };
    if (bikeError) return fail("Vehicle security could not be loaded.", 503, "SECURITY_STATUS_UNAVAILABLE");
    const readinessByBike = new Map<string, any>();
    for (const bike of customerBikes ?? []) {
      const readiness = await bikeActivationReadiness(admin, bike);
      if (readiness.error) return fail("Vehicle installation and deposit status could not be checked.", 503, "VEHICLE_ACTIVATION_STATUS_UNAVAILABLE");
      readinessByBike.set(String(bike.id), readiness);
    }
    // Keep armed customer bikes fresh while their app is active. The customer
    // app polls this endpoint every 30 seconds; writing trusted points here
    // also drives the database movement-alert rule.
    let providerSession: TramigoSession | undefined;
    let deviceCatalogue: any;
    for (const bike of customerBikes ?? []) {
      if (!bike.monitoring_armed) continue;
      const trackerRelation = (bike as any).trackers;
      const tracker = Array.isArray(trackerRelation) ? trackerRelation[0] : trackerRelation;
      const identifier = String(tracker?.tramigo_device_id ?? tracker?.identifier ?? "").trim();
      if (!tracker?.id || !identifier || !Deno.env.get("TRAMIGO_USERNAME")) continue;
      const { data: canQueryProvider, error: rateLimitError } = await admin.rpc("claim_location_provider_read", {
        p_key: `${user.id}:${bike.id}`, p_max_requests: 1, p_window_seconds: 10,
      });
      if (rateLimitError || canQueryProvider !== true) continue;
      try {
        providerSession ??= await tramigoSession();
        deviceCatalogue ??= await tramigoRequest("/api/v2/devices?page=1&per_page=1000", {}, providerSession);
        const location = await fetchLatestTramigoLocation(identifier, providerSession, deviceCatalogue);
        if (!reportPositionIsFresh(location)) continue;
        const { error: locationError } = await admin.from("tracker_locations").insert({
          vehicle_id: null,
          tracker_id: tracker.id,
          latitude: location.latitude,
          longitude: location.longitude,
          speed_kph: location.speedKph,
          recorded_at: location.recordedAt,
        });
        if (locationError) console.error("Customer monitoring location could not be saved", bike.id, locationError.message);
      } catch (error) {
        console.error("Customer Tramigo monitoring refresh failed", bike.id, error instanceof Error ? error.message : "unknown error");
      }
    }
    return response({ vehicles: [
      ...(vehicles ?? []).map((vehicle: any) => ({ ...vehicle, securityReady: true })),
      ...(customerBikes ?? []).map((bike: any) => ({ ...bike, registration: bike.identifier, securityReady: readinessByBike.get(String(bike.id))?.ready ?? false, securityMessage: readinessByBike.get(String(bike.id))?.message ?? "Setup is incomplete." })),
    ] });
  }
  const securityMatch = route.match(/^\/v1\/customer\/motorcycles\/([^/]+)\/(monitoring|immobilizer)$/);
  if (securityMatch && request.method === "POST") {
    const vehicleId = decodeURIComponent(securityMatch[1]);
    const action = securityMatch[2];
    const field = action === "monitoring" ? "armed" : "immobilized";
    if (typeof body[field] !== "boolean") return fail("Choose whether to enable or disable this control.", 422, "INVALID_SECURITY_ACTION");
    const enabled = body[field] as boolean;
    const ownedBike = await customerBikeForUser(admin, user.id, vehicleId);
    if (ownedBike.error) return fail("Vehicle security could not be loaded.", 503, "SECURITY_STATUS_UNAVAILABLE");
    const bike = ownedBike.bike as any;
    const legacy = bike ? null : (await admin.from("vehicles").select("id,tracker_imei").eq("id", vehicleId).eq("owner_id", user.id).maybeSingle()).data;
    if (!bike && !legacy) return fail("Vehicle not found.", 404, "NOT_FOUND");
    if (bike && enabled) {
      const readiness = await bikeActivationReadiness(admin, bike);
      if (readiness.error) return fail("Vehicle installation and deposit status could not be checked.", 503, "VEHICLE_ACTIVATION_STATUS_UNAVAILABLE");
      if (!readiness.ready) return fail(readiness.message ?? "Agent installation confirmation and a fully paid deposit are both required before security can be armed.", 409, "VEHICLE_SETUP_INCOMPLETE");
    }
    const tracker = ownedBike.tracker;
    const rawIdentifier = String(bike ? (tracker?.tramigo_device_id ?? tracker?.identifier ?? "") : (legacy?.tracker_imei ?? "")).trim();
    const deviceId = bike ? (tracker?.tramigo_device_id || (/^\d{10,20}$/.test(rawIdentifier) ? rawIdentifier : "")) : rawIdentifier;
    if (!deviceId) return fail("This vehicle has no Tramigo tracker assigned.", 409, "TRACKER_NOT_ASSIGNED");
    if (bike && !tracker?.id) return fail("This bike has no assigned tracker.", 409, "TRACKER_NOT_ASSIGNED");
    if (action === "immobilizer" && enabled) {
      const { data: canQueryProvider, error: rateLimitError } = await admin.rpc("claim_location_provider_read", {
        p_key: `${user.id}:${vehicleId}`, p_max_requests: 4, p_window_seconds: 60,
      });
      if (rateLimitError || canQueryProvider !== true) return fail("Wait briefly for the next tracker update before immobilizing.", 429, "TRACKER_READ_RATE_LIMITED");
      let latestLocation: any;
      try { latestLocation = await fetchLatestTramigoLocation(deviceId); }
      catch (error) { return fail(error instanceof Error ? error.message : "The tracker did not return a fresh position.", 503, "TRACKER_POSITION_UNAVAILABLE"); }
      if (!reportIsFresh(latestLocation) || Number(latestLocation.speedKph) > 0.5) {
        return fail("The tracker cannot confirm the bike is stopped. A fresh report with known speed at or below 0.5 km/h is required.", 409, "VEHICLE_NOT_SAFE_TO_IMMOBILIZE");
      }
      let previousQuery = admin.from("tracker_locations").select("latitude,longitude,recorded_at").order("recorded_at", { ascending: false }).limit(1).maybeSingle();
      previousQuery = bike ? previousQuery.eq("tracker_id", tracker.id) : previousQuery.eq("vehicle_id", vehicleId);
      const { data: previousLocation, error: previousError } = await previousQuery;
      const reportTime = new Date(latestLocation.recordedAt).getTime();
      const previousTime = previousLocation?.recorded_at ? new Date(previousLocation.recorded_at).getTime() : NaN;
      const previousAgeMs = Date.now() - previousTime;
      if (previousError || !previousLocation || !Number.isFinite(previousTime) || previousTime >= reportTime || previousAgeMs < 0 || previousAgeMs > 60_000) {
        return fail("Wait for two new tracker positions before immobilizing so the system can confirm the bike stayed still.", 409, "STATIONARY_MOVEMENT_NOT_CONFIRMED");
      }
      if (distanceMeters(previousLocation, latestLocation) > 30) {
        return fail("The tracker shows the bike moved recently. Park it and wait for two stationary updates before immobilizing.", 409, "VEHICLE_MOVEMENT_CONFIRMED");
      }
      const { error: saveLocationError } = await admin.from("tracker_locations").insert({
        vehicle_id: bike ? null : vehicleId,
        tracker_id: bike ? tracker.id : null,
        latitude: latestLocation.latitude,
        longitude: latestLocation.longitude,
        speed_kph: latestLocation.speedKph,
        recorded_at: latestLocation.recordedAt,
      });
      if (saveLocationError) return fail("The fresh stationary report could not be saved, so no immobilizer command was sent.", 503, "TRACKER_POSITION_SAVE_FAILED");
    }
    // Monitoring is a server-side alert state: the tracker keeps sending GPS
    // either way, so arming it must not depend on an undocumented Tramigo
    // command endpoint. Only engine immobilization sends a device command.
    const configuredPath = action === "immobilizer" ? Deno.env.get("TRAMIGO_CLOUD_IMMOBILIZER_PATH") : null;
    if (action === "immobilizer" && !configuredPath) return fail("Tramigo immobilizer control is not configured.", 503, "TRAMIGO_NOT_CONFIGURED");
    try {
      const provider = action === "immobilizer"
        ? await tramigoRequest(tramigoPath(configuredPath!, deviceId), { method: "POST", body: { deviceId, imei: deviceId, enabled, immobilized: enabled } })
        : null;
      const update = action === "monitoring" ? { monitoring_armed: enabled, updated_at: new Date().toISOString() } : { immobilized: enabled, updated_at: new Date().toISOString() };
      const { data: savedState, error } = bike
        ? await admin.from("bikes").update(update).eq("id", vehicleId).eq("customer_id", bike.customer_id).select("id,monitoring_armed,immobilized").maybeSingle()
        : await admin.from("vehicles").update(update).eq("id", vehicleId).eq("owner_id", user.id).select("id,monitoring_armed,immobilized").maybeSingle();
      if (error) return fail("Tramigo accepted the command, but the security state could not be saved.", 502, "STATE_SYNC_FAILED");
      if (!savedState) return fail("The security setting was not saved for this vehicle. Refresh the bike and try again.", 409, "STATE_NOT_SAVED");
      const savedEnabled = Boolean(action === "monitoring" ? savedState.monitoring_armed : savedState.immobilized);
      if (savedEnabled !== enabled) return fail("The database did not confirm the requested security setting. Try again.", 409, "STATE_NOT_CONFIRMED");
      return response({ vehicleId, action, enabled: savedEnabled, provider });
    } catch (error) { return fail(error instanceof Error ? error.message : "Tramigo command failed.", 502, "TRAMIGO_ERROR"); }
  }  if (route === "/v1/customer/profile" && request.method === "PATCH") {
    const { data, error } = await client.from("profiles").update({ full_name: body.fullName, phone: body.phone, avatar_url: body.avatarUrl, updated_at: new Date().toISOString() }).eq("id", user.id).select().single();
    return error ? fail(error.message, 400) : response(data);
  }
  if (route === "/v1/customer/alerts" && request.method === "GET") {
    const { data, error } = await admin.from("alerts").select("id,title,body,detail,kind,severity,created_at,read_at").eq("owner_id", user.id).or("kind.is.null,kind.neq.movement").order("created_at", { ascending: false }).limit(100);
    if (error) return fail("Your notifications are temporarily unavailable.", 503, "ALERTS_UNAVAILABLE");
    return response({ alerts: (data ?? []).map((alert: any) => ({ id: alert.id, title: alert.title, message: alert.detail || alert.body, type: alert.kind || "notification", icon: alert.kind === "payment" ? "wallet-outline" : alert.kind === "movement" ? "bicycle-outline" : "notifications-outline", severity: alert.severity, age: new Date(alert.created_at).toLocaleString("en-KE", { timeZone: "Africa/Nairobi" }), unread: !alert.read_at, createdAt: alert.created_at })) });
  }
  if (route === "/v1/customer/alerts/read" && request.method === "POST") {
    const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean).slice(0, 100) : [];
    if (!ids.length) return fail("Choose at least one notification.", 422, "INVALID_ALERT_IDS");
    const databaseIds = ids.filter((id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id));
    if (!databaseIds.length) return response({ updated: 0 });
    const { error } = await admin.from("alerts").update({ read_at: new Date().toISOString() }).eq("owner_id", user.id).in("id", databaseIds);
    return error ? fail("Notifications could not be marked as read.", 503, "ALERT_UPDATE_FAILED") : response({ updated: databaseIds.length });
  }
  if (route === "/v1/customer/alerts" && request.method === "DELETE") {
    const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean).slice(0, 100) : [];
    if (!ids.length) return fail("Choose at least one notification.", 422, "INVALID_ALERT_IDS");
    const databaseIds = ids.filter((id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id));
    if (!databaseIds.length) return response({ deleted: 0 });
    const { error } = await admin.from("alerts").delete().eq("owner_id", user.id).in("id", databaseIds);
    return error ? fail("Notifications could not be deleted.", 503, "ALERT_DELETE_FAILED") : response({ deleted: databaseIds.length });
  }
  const locationMatch = route.match(/^\/v1\/customer\/motorcycles\/([^/]+)\/location$/);
  if (locationMatch && request.method === "GET") {
    const vehicleId = decodeURIComponent(locationMatch[1]);
    // New customer onboarding assigns a bike to a customer record rather than
    // creating the legacy owner-scoped `vehicles` record. Resolve that path
    // first, so the customer app receives the same live tracker data.
    const { data: customerProfile } = await admin.from("profiles").select("email").eq("id", user.id).maybeSingle();
    const { data: assignedCustomer } = customerProfile?.email
      ? await admin.from("customers").select("id").ilike("email", String(customerProfile.email).trim()).maybeSingle()
      : { data: null };
    const { data: assignedBike } = assignedCustomer?.id
      ? await admin.from("bikes").select("id,identifier,model,product_type,monitoring_armed,trackers(id,identifier,tramigo_device_id,plate_number,latitude,longitude,last_seen_at,is_online)").eq("id", vehicleId).eq("customer_id", assignedCustomer.id).maybeSingle()
      : { data: null };
    if (assignedBike) {
      const tracker = (assignedBike as any).trackers?.[0] ?? null;
      let location = null;
      const trackerIdentifier = String(tracker?.tramigo_device_id ?? tracker?.identifier ?? "").trim();
      if (tracker?.id && trackerIdentifier && Deno.env.get("TRAMIGO_USERNAME")) {
        const { data: canQueryProvider, error: rateLimitError } = await admin.rpc("claim_location_provider_read", {
          p_key: `${user.id}:${vehicleId}`, p_max_requests: 1, p_window_seconds: 3,
        });
        if (!rateLimitError && canQueryProvider === true) {
          try {
            const latest = await fetchLatestTramigoLocation(trackerIdentifier);
            if (latest?.recordedAt && Number.isFinite(latest.latitude) && Number.isFinite(latest.longitude)) {
              location = { ...latest, trackerStatus: latest.trackerStatus ?? (tracker.is_online ? "online" : "offline") };
              if (reportPositionIsFresh(latest)) {
                const { error: locationError } = await admin.from("tracker_locations").insert({ vehicle_id: null, tracker_id: tracker.id, latitude: latest.latitude, longitude: latest.longitude, speed_kph: latest.speedKph, recorded_at: latest.recordedAt });
                if (locationError) console.error("Customer live tracker point could not be saved", vehicleId, locationError.message);
                const reportTime = new Date(latest.recordedAt).getTime();
                const previousTime = new Date(tracker.last_seen_at ?? 0).getTime();
                if (!Number.isFinite(previousTime) || reportTime > previousTime) {
                  const { error: trackerUpdateError } = await admin.from("trackers").update({ latitude: latest.latitude, longitude: latest.longitude, last_seen_at: latest.recordedAt, is_online: latest.trackerStatus === "offline" ? false : true, updated_at: new Date().toISOString() }).eq("id", tracker.id);
                  if (trackerUpdateError) console.error("Customer live tracker status could not be updated", vehicleId, trackerUpdateError.message);
                }
              }
            }
          } catch (error) {
            console.error("Customer live Tramigo location unavailable", vehicleId, error instanceof Error ? error.message : "unknown error");
          }
        }
      }
      if (!location && tracker?.id) {
        const { data: saved } = await admin.from("tracker_locations").select("latitude,longitude,speed_kph,heading,accuracy_meters,recorded_at").eq("tracker_id", tracker.id).order("recorded_at", { ascending: false }).limit(1).maybeSingle();
        location = saved && { latitude: saved.latitude, longitude: saved.longitude, speedKph: saved.speed_kph, heading: saved.heading, accuracyMeters: saved.accuracy_meters, recordedAt: saved.recorded_at, trackerStatus: tracker.is_online ? "online" : "offline" };
        if (!location && tracker.latitude != null && tracker.longitude != null && tracker.last_seen_at) {
          const latitude = Number(tracker.latitude);
          const longitude = Number(tracker.longitude);
          if (Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180) {
            location = { latitude, longitude, recordedAt: tracker.last_seen_at, trackerStatus: tracker.is_online ? "online" : "offline" };
          }
        }
      }
      return response({ id: assignedBike.id, registration: tracker?.plate_number || assignedBike.identifier, model: assignedBike.model, vehicle_type: assignedBike.product_type, location });
    }
    const { data: vehicle } = await admin.from("vehicles").select("id,registration,model,vehicle_type,tracker_imei").eq("id", vehicleId).eq("owner_id", user.id).single();
    if (!vehicle) return fail("Vehicle not found.", 404, "NOT_FOUND");
    let location = null;
    // A short per-owner lease makes repeated polling return the last trusted
    // location instead of turning a stolen session into a Tramigo API flood.
    const { data: canQueryProvider, error: rateLimitError } = await admin.rpc("claim_location_provider_read", {
      p_key: `${user.id}:${vehicleId}`, p_max_requests: 1, p_window_seconds: 3,
    });
    if (rateLimitError) console.error("Location provider rate limit unavailable", rateLimitError);
    if (vehicle.tracker_imei && Deno.env.get("TRAMIGO_USERNAME") && !rateLimitError && canQueryProvider === true) {
      try {
        const providerSession = await tramigoSession();
        const deviceCatalogue = await tramigoRequest("/api/v2/devices?page=1&per_page=1000", {}, providerSession);
        const cloudDeviceId = await tramigoCloudDeviceId(vehicle.tracker_imei, deviceCatalogue, providerSession);
        const tramigo = tramigoLocation(await tramigoRequest(`/api/reports/last_location/${encodeURIComponent(cloudDeviceId)}`, {}, providerSession));
        if (tramigo) {
          const trackerRow = await admin.from("trackers").select("id,last_seen_at").eq("identifier", vehicle.tracker_imei).maybeSingle();
          if (reportPositionIsFresh(tramigo)) {
            await admin.from("tracker_locations").insert({ vehicle_id: vehicleId, tracker_id: trackerRow.data?.id ?? null, latitude: tramigo.latitude, longitude: tramigo.longitude, speed_kph: tramigo.speedKph, recorded_at: tramigo.recordedAt });
            const previousTime = new Date(trackerRow.data?.last_seen_at ?? 0).getTime();
            const reportTime = new Date(tramigo.recordedAt).getTime();
            if (trackerRow.data?.id && (!Number.isFinite(previousTime) || reportTime > previousTime)) {
              await admin.from("trackers").update({ latitude: tramigo.latitude, longitude: tramigo.longitude, last_seen_at: tramigo.recordedAt, is_online: tramigo.trackerStatus === "offline" ? false : true, updated_at: new Date().toISOString() }).eq("id", trackerRow.data.id);
            }
          }
          location = { latitude: tramigo.latitude, longitude: tramigo.longitude, speedKph: tramigo.speedKph, recordedAt: tramigo.recordedAt, trackerStatus: tramigo.trackerStatus };
        }
      } catch (_) { /* fall back to the last synced location */ }
    }
    if (!location) { const { data: saved } = await admin.from("tracker_locations").select("latitude,longitude,speed_kph,heading,accuracy_meters,recorded_at").eq("vehicle_id", vehicleId).order("recorded_at", { ascending: false }).limit(1).maybeSingle(); location = saved && { latitude: saved.latitude, longitude: saved.longitude, speedKph: saved.speed_kph, heading: saved.heading, accuracyMeters: saved.accuracy_meters, recordedAt: saved.recorded_at }; }
    const { tracker_imei: _privateTrackerImei, ...safeVehicle } = vehicle;
    return response({ ...safeVehicle, location });
  }
  const routeMatch = route.match(/^\/v1\/customer\/motorcycles\/([^/]+)\/route$/);
  if (routeMatch && request.method === "GET") {
    const vehicleId = decodeURIComponent(routeMatch[1]);
    const window = routeWindow(url);
    if ("error" in window) return fail(window.error || "Invalid route window.", 422, "INVALID_ROUTE_WINDOW");
    const ownedBike = await customerBikeForUser(admin, user.id, vehicleId);
    if (ownedBike.error) return fail("Route history is temporarily unavailable.", 503, "ROUTE_UNAVAILABLE");
    if (ownedBike.bike) {
      const tracker = ownedBike.tracker;
      if (!tracker?.id) return response({ vehicleId, points: [], distanceKm: 0, durationMinutes: 0, stops: 0, from: window.from, to: window.to, message: "No tracker is assigned to this bike yet." });
      let providerPointCount = 0;
      let providerRouteError = false;
      const providerIdentifier = String(tracker.tramigo_device_id ?? tracker.identifier ?? "").trim();
      if (providerIdentifier && Deno.env.get("TRAMIGO_USERNAME")) {
        try {
          const providerSession = await tramigoSession();
          const catalogue = await tramigoRequest("/api/v2/devices?page=1&per_page=1000", {}, providerSession);
          const providerRoute = await fetchTramigoRoute(providerIdentifier, window, providerSession, catalogue);
          providerPointCount = providerRoute.points.length;
          if (providerRoute.points.length) {
            const rows = providerRoute.points.map(point => ({ vehicle_id: null, tracker_id: tracker.id, latitude: point.latitude, longitude: point.longitude, speed_kph: point.speedKph, recorded_at: point.recordedAt }));
            const { error: historyError } = await admin.from("tracker_locations").insert(rows);
            if (historyError) console.error("Customer route history insert failed", vehicleId, historyError);
          }
        } catch (error) {
          providerRouteError = true;
          console.error("Customer provider route unavailable", vehicleId, error);
        }
      }
      try {
        const result = await loadRoute(admin, null, tracker.id, window);
        return response({ vehicleId, ...result, providerPointCount, providerRouteError, message: result.points.length ? undefined : "No saved GPS points for this bike and time range." });
      } catch (error) {
        console.error("Customer route load failed", vehicleId, error);
        return fail("Route history is temporarily unavailable.", 503, "ROUTE_UNAVAILABLE");
      }
    }
    const { data: vehicle, error: vehicleError } = await admin.from("vehicles").select("id").eq("id", vehicleId).eq("owner_id", user.id).maybeSingle();
    if (vehicleError) return fail("Route history is temporarily unavailable.", 503, "ROUTE_UNAVAILABLE");
    if (!vehicle) return fail("Vehicle not found.", 404, "NOT_FOUND");
    try { return response(await loadRoute(admin, vehicleId, null, window)); }
    catch (error) { console.error("Customer route load failed", vehicleId, error); return fail("Route history is temporarily unavailable.", 503, "ROUTE_UNAVAILABLE"); }
  }  return fail("Endpoint not implemented yet.", 501, "NOT_IMPLEMENTED");
  } catch (error) {
    // Never let an unexpected Edge Function exception become an opaque 500.
    // The path is logged without credentials or request data for diagnosis.
    console.error("Unhandled API request error", requestPath, error);
    return fail("The tracker service encountered a server error. Refresh once more, then contact support with the request time.", 503, "API_UNEXPECTED_ERROR");
  }
});
