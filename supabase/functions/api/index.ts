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
  const value = record?.IsOnline ?? record?.isOnline ?? record?.Online ?? record?.online ?? record?.ConnectionStatus ?? record?.connectionStatus ?? record?.Status ?? record?.status;
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["online", "active", "connected", "available", "true", "1"].includes(normalized) ? "online" : ["offline", "inactive", "disconnected", "unavailable", "false", "0"].includes(normalized) ? "offline" : null;
}
function tramigoCatalogueLastSeen(record: any) {
  const value = record?.LastSeen ?? record?.lastSeen ?? record?.LastSeenAt ?? record?.last_seen_at ?? record?.DateTime_Actual ?? record?.DateTimeActual;
  return value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString() : null;
}
function tramigoLocation(report: any) {
  const source = report?.main_reports?.[0] ?? report?.mainReports?.[0] ?? report;
  const latitude = Number(source?.Latitude ?? source?.latitude); const longitude = Number(source?.Longitude ?? source?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  // Tramigo status can be returned at either report level. Do not infer an
  // active device from an old report; return its explicit connection state so
  // the mobile app can use it ahead of timestamp ageing.
  const statusValue = report?.IsOnline ?? report?.isOnline ?? report?.Online ?? report?.online
    ?? report?.DeviceStatus ?? report?.deviceStatus ?? report?.ConnectionStatus ?? report?.connectionStatus
    ?? source?.IsOnline ?? source?.isOnline ?? source?.Online ?? source?.online
    ?? source?.DeviceStatus ?? source?.deviceStatus ?? source?.ConnectionStatus ?? source?.connectionStatus;
  const normalizedStatus = typeof statusValue === "boolean" ? (statusValue ? "online" : "offline") : String(statusValue ?? "").trim().toLowerCase();
  const trackerStatus = ["online", "active", "connected", "available", "true", "1"].includes(normalizedStatus)
    ? "online"
    : ["offline", "inactive", "disconnected", "unavailable", "false", "0"].includes(normalizedStatus) ? "offline" : null;
  return { latitude, longitude, speedKph: Number(source?.Speed ?? source?.speed ?? 0), recordedAt: source?.DateTimeActual ?? source?.DateTime_Actual ?? report?.DateTimeActual ?? report?.DateTime_Actual ?? new Date().toISOString(), trackerStatus };
}

function tramigoReportRecords(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  for (const key of ["data", "items", "results", "reports"]) if (Array.isArray(payload?.[key])) return payload[key];
  return [];
}

function tramigoRouteLocations(payload: any) {
  return tramigoReportRecords(payload).map((report) => {
    const source = report?.main_reports?.[0] ?? report?.mainReports?.[0] ?? report;
    const latitude = Number(source?.Latitude ?? source?.latitude); const longitude = Number(source?.Longitude ?? source?.longitude);
    const recordedAt = source?.DateTimeActual ?? source?.DateTime_Actual ?? source?.datetime_actual ?? source?.dateTime ?? source?.timestamp ?? report?.DateTimeActual ?? report?.DateTime_Actual ?? report?.DateTime_Received;
    return { latitude, longitude, speedKph: Number(source?.Speed ?? source?.speed ?? 0), recordedAt };
  }).filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude) && point.latitude >= -90 && point.latitude <= 90 && point.longitude >= -180 && point.longitude <= 180 && point.recordedAt);
}

async function fetchTramigoRoute(identifier: string, window: { from: string; to: string }, session: TramigoSession, catalogue: any) {
  const cloudDeviceId = await tramigoCloudDeviceId(identifier, catalogue, session);
  const params = new URLSearchParams({ page: "1", per_page: "100", start_date: window.from.replace("T", " ").replace(/\.\d{3}Z$/, ""), end_date: window.to.replace("T", " ").replace(/\.\d{3}Z$/, "") });
  const payload = await tramigoRequest(`/api/reports/${encodeURIComponent(cloudDeviceId)}?${params}`, {}, session);
  return tramigoRouteLocations(payload);
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

async function loadRoute(admin: ReturnType<typeof createClient>, vehicleId: string | null, trackerId: string | null, window: { from: string; to: string }) {
  let query = admin.from("tracker_locations").select("latitude,longitude,recorded_at");
  query = vehicleId ? query.eq("vehicle_id", vehicleId) : query.eq("tracker_id", trackerId);
  const { data, error } = await query
    .gte("recorded_at", window.from)
    .lte("recorded_at", window.to)
    .order("recorded_at", { ascending: true })
    .limit(2000);
  if (error) throw error;
  const points = (data ?? []).map((point: any) => ({ latitude: Number(point.latitude), longitude: Number(point.longitude), recorded_at: point.recorded_at }));
  return { points, ...routeSummary(points), from: window.from, to: window.to };
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

async function uploadScreeningDocument(admin: ReturnType<typeof createClient>, applicationId: string, field: string, value: unknown) {
  const document = decodeScreeningDocument(value);
  if (!document) throw new Error("Each customer image must be a JPEG or PNG smaller than 5 MB.");
  const path = `${applicationId}/${field}-${crypto.randomUUID()}.${document.extension}`;
  const { error } = await admin.storage.from(screeningDocumentBucket).upload(path, document.bytes, { contentType: document.contentType, upsert: false });
  if (error) throw error;
  return path;
}

async function removeScreeningDocuments(admin: ReturnType<typeof createClient>, paths: string[]) {
  if (paths.length) await admin.storage.from(screeningDocumentBucket).remove(paths);
}

async function signedScreeningDocuments(admin: ReturnType<typeof createClient>, application: Record<string, unknown>) {
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
  return Object.fromEntries(signedDocuments.filter((entry): entry is readonly [string, string] => Boolean(entry[1])));
}

async function sendCustomerApprovalPush(
  admin: ReturnType<typeof createClient>,
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
    body: `Your verification code is ${code}.`,
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

async function saveCustomerPushToken(
  admin: ReturnType<typeof createClient>,
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
  admin: ReturnType<typeof createClient>,
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
  return { issued: true, pushSent: await sendCustomerApprovalPush(admin, [customerId], code, email) };
}

async function removeCustomerWorkspace(admin: ReturnType<typeof createClient>, customerId: string) {
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

async function registerPortalUser(client: ReturnType<typeof createClient>, admin: ReturnType<typeof createClient>, body: Record<string, unknown>, role: "customer" | "agent" | "finance") {
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const fullName = String(body.name ?? body.fullName ?? "").trim();
  const phone = String(body.phone ?? "").trim();
  if (!email || !password || !fullName) return fail("Complete your name, email, and password.", 422, "INVALID_REGISTRATION");
  const { data, error } = await client.auth.signUp({ email, password, options: { data: { full_name: fullName, phone } } });
  const existingProfile = async () => {
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id,role,account_status")
      .eq("email", email)
      .maybeSingle();
    if (profileError) {
      console.error("Existing registration lookup failed", profileError);
      return null;
    }
    return profile;
  };
  const existing = await existingProfile();
  const refreshExistingCustomerPushToken = async () => {
    if (role !== "customer" || !existing?.id) return { registered: false, supplied: false };
    return saveCustomerPushToken(admin, existing.id, body, new Date().toISOString());
  };
  const retryApprovedCustomerDelivery = async () => {
    const token = await refreshExistingCustomerPushToken();
    if (!token.registered) return response({
      status: "approved",
      notificationReady: false,
      message: "Your account is approved. Enable notifications in Jixels Customer Trackings, then submit your registration again to receive the approval code.",
    });
    const delivery = await issueCustomerApprovalCode(admin, existing!.id, email);
    if (!delivery.issued) return fail("Your account is approved, but the in-app approval code could not be created. Please ask an administrator to retry approval.", 503, "APPROVAL_CODE_UNAVAILABLE");
    return response({ status: "approved", notificationReady: true, pushSent: delivery.pushSent, message: delivery.pushSent ? "Your account is approved. The six-digit approval code was sent to Jixels Customer Trackings." : "Your account is approved, but the device notification could not be delivered. Open Jixels Customer Trackings and submit your registration again." });
  };
  // Supabase can return an obfuscated user with no identities for an existing email.
  // A repeat submission for the same pending account is not a technical failure.
  // Do not overwrite an account registered for a different portal role.
  if (data.user && data.user.identities?.length === 0) {
    if (existing?.role === role && existing.account_status === "pending") {
      const token = await refreshExistingCustomerPushToken();
      return response({ status: "pending", notificationReady: role === "customer" ? token.registered : undefined, message: "Registration details were already submitted. Please wait for administrator approval before signing in." });
    }
    if (existing?.role === "customer" && approvedStatuses.has(existing.account_status)) return retryApprovedCustomerDelivery();
    return fail("An account with this email already exists. Sign in or reset its password.", 409, "ACCOUNT_ALREADY_EXISTS");
  }
  if (error || !data.user) {
    console.error("Portal registration failed", error);
    const providerMessage = String(error?.message ?? "").toLowerCase();
    if (providerMessage.includes("already") || providerMessage.includes("exists") || providerMessage.includes("registered")) {
      if (existing?.role === role && existing.account_status === "pending") {
        const token = await refreshExistingCustomerPushToken();
        return response({ status: "pending", notificationReady: role === "customer" ? token.registered : undefined, message: "Registration details were already submitted. Please wait for administrator approval before signing in." });
      }
      if (existing?.role === "customer" && approvedStatuses.has(existing.account_status)) return retryApprovedCustomerDelivery();
      if (existing && existing.role !== role) return fail("This email is registered for a different Jixels workspace.", 409, "PORTAL_ROLE_CONFLICT");
      return fail("An account with this email already exists. Sign in or reset its password.", 409, "ACCOUNT_ALREADY_EXISTS");
    }
    if (providerMessage.includes("password")) return fail("Use a stronger password that meets the account requirements.", 422, "INVALID_PASSWORD");
    if (providerMessage.includes("signup") && providerMessage.includes("disabled")) return fail("Registration is temporarily unavailable. Contact Jixels support.", 503, "SIGNUP_DISABLED");
    return fail("Registration could not be completed. Please try again.", 400, "REGISTRATION_FAILED");
  }
  const rollbackAuthUser = async () => {
    const { error: deleteError } = await admin.auth.admin.deleteUser(data.user!.id);
    if (deleteError) console.error("Registration rollback failed", deleteError);
  };
  const { error: profileError } = await admin.from("profiles").upsert({ id: data.user.id, full_name: fullName, email, phone, role, account_status: "pending", updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (profileError) { console.error("Portal profile provisioning failed", profileError); await rollbackAuthUser(); return fail("Registration could not be completed. Please try again.", 503, "PROFILE_PROVISIONING_FAILED"); }
  if (role === "customer") {
    const now = new Date().toISOString();
    const { data: submittedApplication, error: submittedApplicationError } = await admin
      .from("screening_applications")
      .select("id,customer_id")
      .eq("email", email)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (submittedApplicationError) { console.error("Customer screening lookup failed", submittedApplicationError); await rollbackAuthUser(); return fail("Registration could not be completed. Please try again.", 503, "CUSTOMER_SCREENING_LOOKUP_FAILED"); }
    // A field-agent onboarding already owns the customer and screening record.
    // Register only the mobile identity here so the customer does not appear twice.
    if (submittedApplication) {
      const { data: applicationStatus, error: applicationStatusError } = await admin.from("screening_applications").select("status").eq("id", submittedApplication.id).single();
      if (applicationStatusError || !applicationStatus) { await rollbackAuthUser(); return fail("Registration could not be completed. Please try again.", 503, "CUSTOMER_SCREENING_LOOKUP_FAILED"); }
      const token = await saveCustomerPushToken(admin, data.user.id, body, now);
      return response({ status: "pending", notificationReady: token.registered, message: "Registration details submitted successfully. Please wait for administrator approval before signing in." }, 201);
    }
    const { error: customerError } = await admin.from("customers").upsert({ id: data.user.id, full_name: fullName, email, phone, status: "pending", created_at: now, updated_at: now }, { onConflict: "id" });
    if (customerError) { console.error("Customer account provisioning failed", customerError); await rollbackAuthUser(); return fail("Registration could not be completed. Please try again.", 503, "CUSTOMER_PROVISIONING_FAILED"); }
    const token = await saveCustomerPushToken(admin, data.user.id, body, now);
    return response({ status: "pending", notificationReady: token.registered, message: "Registration details submitted successfully. Please wait for administrator approval before signing in." }, 201);
  }
  return response({ status: "pending", message: "Registration details submitted successfully. Please wait for administrator approval before signing in." }, 201);
}

const customerRoles = new Set(["customer"]);
const agentRoles = new Set(["agent", "support_agent"]);
const financeRoles = new Set(["finance", "finance_officer", "admin", "super_admin"]);
const adminRoles = new Set(["admin", "super_admin", "operations_manager"]);
const approvableStaffRoles = new Set(["agent", "support_agent", "finance", "finance_officer"]);
const approvableAccountRoles = new Set(["customer", ...approvableStaffRoles]);
const approvedStatuses = new Set(["active", "approved"]);
const LOGIN_LOCK_MESSAGE = "Too many failed sign-in attempts. Please try again in 15 minutes.";

async function loginAttemptKey(email: string) {
  return sha256(`jixels-login:${email}`);
}

async function getLoginLock(admin: ReturnType<typeof createClient>, accountKey: string) {
  const { data, error } = await admin.rpc("get_login_lock", { p_account_key: accountKey });
  if (error) {
    console.error("Login lock lookup failed", error);
    return { error: true, locked: false };
  }
  return { error: false, locked: Boolean(data) };
}

async function recordLoginFailure(admin: ReturnType<typeof createClient>, accountKey: string) {
  const { data, error } = await admin.rpc("record_login_failure", { p_account_key: accountKey });
  if (error) {
    console.error("Login failure recording failed", error);
    return { error: true, locked: false };
  }
  const state = Array.isArray(data) ? data[0] : data;
  return { error: false, locked: Boolean(state?.locked_until) };
}

async function portalSignIn(
  client: ReturnType<typeof createClient>,
  admin: ReturnType<typeof createClient>,
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
    if (pendingCode && !pendingCode.used_at) {
      const delivery = await issueCustomerApprovalCode(admin, data.user.id, profile.email ?? email);
      if (!delivery.issued) return fail("A secure approval code could not be created. Contact Jixels support.", 503, "APPROVAL_CODE_UNAVAILABLE");
      return fail(
        delivery.pushSent
          ? "A fresh six-digit approval code was sent to this Jixels Customer app. Enter it to finish signing in."
          : "Your account needs its six-digit approval code. Enable notifications in Jixels Customer Trackings, then sign in again.",
        403,
        "CUSTOMER_OTP_REQUIRED",
      );
    }
  }
  let assignedVehicles: unknown[] = [];
  if (agentRoles.has(profile.role)) {
    const { data: bikes, error: bikesError } = await admin.from("bikes").select("id,identifier,model,product_type,payable_amount,status,assigned_agent_id,trackers(identifier)").eq("assigned_agent_id", data.user.id).order("created_at", { ascending: false });
    if (bikesError) console.error("Agent vehicle load failed", bikesError);
    assignedVehicles = (bikes ?? []).map((bike: any) => ({ id: bike.id, registration: bike.identifier, model: bike.model, product_type: bike.product_type, payable_amount: bike.payable_amount, status: bike.status, assigned_agent_id: bike.assigned_agent_id, tracker: bike.trackers?.[0]?.identifier ?? "Pending" }));
  }
  return response({
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt: new Date(data.session.expires_at! * 1000).toISOString(),
    user: { id: data.user.id, email: data.user.email, name: profile.full_name, phone: profile.phone, role: profile.role, agentCode: profile.agent_code, assignedVehicles },
  });
}

async function requestPortalPasswordReset(
  client: ReturnType<typeof createClient>,
  admin: ReturnType<typeof createClient>,
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

async function accountStatus(admin: ReturnType<typeof createClient>, url: URL) {
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

  const status = profile?.account_status === "active" ? "approved" : profile?.account_status ?? "pending";
  return response({
    status,
    role: profile?.role ?? null,
    approved: approvedStatuses.has(profile?.account_status ?? ""),
    message: approvedStatuses.has(profile?.account_status ?? "") ? "Your account has been approved." : "Your registration is waiting for administrator approval.",
  });
}

async function financeAccountStatus(admin: ReturnType<typeof createClient>, url: URL) {
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
    const completed = Number(callback.ResultCode) === 0;
    const checkoutRequestId = String(callback.CheckoutRequestID ?? "");
    await admin.from("daraja_transactions").upsert({ direction: "C2B", checkout_request_id: checkoutRequestId || null, transaction_id: items.MpesaReceiptNumber ?? null, phone: items.PhoneNumber ?? null, amount: Number(items.Amount ?? 0), status: completed ? "completed" : "failed", payload: body, updated_at: new Date().toISOString() }, { onConflict: "transaction_id" });
    if (checkoutRequestId) {
      const { data: promptedPayment, error: promptedPaymentError } = await admin
        .from("payments")
        .select("id,customer_id,product_id")
        .eq("checkout_request_id", checkoutRequestId)
        .maybeSingle();
      if (promptedPaymentError) console.error("Prompted deposit lookup failed", promptedPaymentError);
      if (promptedPayment) {
        const paidAt = new Date().toISOString();
        const { error: paymentUpdateError } = await admin.from("payments").update({
          status: completed ? "paid" : "failed",
          paid_at: completed ? paidAt : null,
          receipt_number: completed ? String(items.MpesaReceiptNumber ?? "") || null : null,
        }).eq("id", promptedPayment.id);
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
              const { error: financeRefreshError } = await admin.rpc("materialize_tracker_sale", { p_application_id: approvedApplication.id });
              if (financeRefreshError) console.error("Finance payment materialization failed", financeRefreshError);
            }
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
    const { data: profile, error: profileError } = await admin.from("profiles").select("id,role,account_status").eq("email", email).maybeSingle();
    if (profileError || !profile || profile.role !== "customer") return fail("Customer account not found. Register an account or contact Jixels support.", 404, "ACCOUNT_NOT_FOUND");
    if (!approvedStatuses.has(profile.account_status)) return fail("This account is still awaiting administrator approval.", 403, "ACCOUNT_PENDING_APPROVAL");
    const { data: stored, error: storedError } = await admin.from("customer_approval_codes").select("code_hash,expires_at,used_at").eq("customer_id", profile.id).maybeSingle();
    if (storedError || !stored || stored.used_at || new Date(stored.expires_at).getTime() <= Date.now()) return fail("The approval code is unavailable or expired. Ask an administrator to issue a new code.", 401, "APPROVAL_CODE_EXPIRED");
    if (stored.code_hash !== await sha256(code)) return fail("The approval code is incorrect.", 401, "APPROVAL_CODE_INVALID");
    const { error: useError } = await admin.from("customer_approval_codes").update({ used_at: new Date().toISOString() }).eq("customer_id", profile.id);
    if (useError) return fail("The approval code could not be verified. Please try again.", 503, "APPROVAL_CODE_UNAVAILABLE");
    return response({ verified: true, message: "Account verified. Sign in with your registered email and password." });
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

  if (route === "/v1/admin/trackers/refresh" && request.method === "POST") {
    const { data: manager, error: managerError } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
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
        const reportAge = Date.now() - new Date(live.recordedAt).getTime();
        const isOnline = live.trackerStatus === "online" || catalogueStatus === "online" || (live.trackerStatus == null && catalogueStatus == null && Number.isFinite(reportAge) && reportAge <= 10 * 60_000);
        const operationalStatus = live.trackerStatus ?? catalogueStatus ?? (isOnline ? "online" : "offline");
        const { error: updateError } = await admin.from("trackers").update({
          latitude: live.latitude, longitude: live.longitude, last_seen_at: catalogueSeenAt && new Date(catalogueSeenAt) > new Date(live.recordedAt) ? catalogueSeenAt : live.recordedAt,
          is_online: isOnline, operational_status: operationalStatus, updated_at: new Date().toISOString(),
        }).eq("id", tracker.id);
        if (updateError) throw updateError;
        const { error: historyError } = await admin.from("tracker_locations").insert({
          vehicle_id: tracker.vehicle_id ?? null, tracker_id: tracker.id, latitude: live.latitude, longitude: live.longitude,
          speed_kph: live.speedKph, recorded_at: live.recordedAt,
        });
        if (historyError) console.error("Tracker route history insert failed", tracker.id, historyError);
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
    const { data: manager, error: managerError } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (managerError || !manager || !adminRoles.has(manager.role)) return fail("Administrator permission is required to view tracker routes.", 403, "FORBIDDEN");
    const window = routeWindow(url);
    if ("error" in window) return fail(window.error, 422, "INVALID_ROUTE_WINDOW");
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
    let providerPointCount = 0; let providerRouteError = false;
    if (providerIdentifier && Deno.env.get("TRAMIGO_USERNAME")) {
      try {
        const providerSession = await tramigoSession();
        const catalogue = await tramigoRequest("/api/v2/devices?page=1&per_page=1000", {}, providerSession);
        const providerPoints = await fetchTramigoRoute(providerIdentifier, window, providerSession, catalogue);
        providerPointCount = providerPoints.length;
        if (providerPoints.length) {
          const rows = providerPoints.map((point) => ({ vehicle_id: vehicleId, tracker_id: tracker.id, latitude: point.latitude, longitude: point.longitude, speed_kph: point.speedKph, recorded_at: point.recordedAt }));
          const { error: historyError } = await admin.from("tracker_locations").insert(rows);
          if (historyError) console.error("Provider route history insert failed", tracker.id, historyError);
        }
      } catch (error) { providerRouteError = true; console.error("Tramigo historical route unavailable", tracker.id, error); }
    }
    try {
      const result = await loadRoute(admin, vehicleId, tracker.id, window);
      return response({ trackerId, identifier: tracker.identifier, ...result, providerPointCount, providerRouteError, message: result.points.length ? undefined : "No saved GPS points for this date." });
    } catch (error) {
      console.error("Admin tracker route load failed", trackerId, error);
      return fail("Tracker route history is temporarily unavailable.", 503, "ROUTE_UNAVAILABLE");
    }
  }

  const screeningDocumentMatch = route.match(/^\/v1\/admin\/screening\/([^/]+)\/documents$/);
  if (screeningDocumentMatch && request.method === "GET") {
    const { data: manager, error: managerError } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (managerError || !manager || !adminRoles.has(manager.role)) return fail("Administrator permission is required to view identity documents.", 403, "FORBIDDEN");
    const applicationId = decodeURIComponent(screeningDocumentMatch[1]);
    const { data: application, error: applicationError } = await admin
      .from("screening_applications")
      .select(screeningDocumentFields.join(","))
      .eq("id", applicationId)
      .maybeSingle();
    if (applicationError || !application) return fail("Screening application not found.", 404, "NOT_FOUND");
    return response({ documents: await signedScreeningDocuments(admin, application) });
  }

  const screeningUpdateMatch = route.match(/^\/v1\/admin\/screening\/([^/]+)$/);
  if (screeningUpdateMatch && request.method === "PATCH") {
    const { data: manager, error: managerError } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
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

  const paymentPhoneMatch = route.match(/^\/v1\/agent\/customers\/([^/]+)\/payment-phone$/);
  if (paymentPhoneMatch && request.method === "PATCH") {
    const { data: agentProfile, error: agentError } = await admin.from("profiles").select("role,account_status").eq("id", user.id).maybeSingle();
    if (agentError || !agentProfile || !agentRoles.has(agentProfile.role)) return fail("This account does not have permission to update customer payment details.", 403, "PORTAL_ACCESS_DENIED");
    if (!approvedStatuses.has(agentProfile.account_status)) return fail("Your agent account is awaiting administrator approval.", 403, "ACCOUNT_PENDING_APPROVAL");
    const paymentPhone = String(body.paymentPhone ?? "").trim();
    if (!paymentPhone) return fail("Enter the phone number that should receive the payment prompt.", 422, "INVALID_PAYMENT_PHONE");
    const customerId = decodeURIComponent(paymentPhoneMatch[1]);
    const { data: application, error } = await admin
      .from("screening_applications")
      .update({ payment_phone: paymentPhone, updated_at: new Date().toISOString() })
      .eq("customer_id", customerId)
      .eq("installer_agent_id", user.id)
      .select("customer_id,payment_phone")
      .maybeSingle();
    if (error || !application) return fail("Customer payment details could not be saved.", 404, "CUSTOMER_NOT_FOUND");
    return response({ customerId: application.customer_id, paymentPhone: application.payment_phone });
  }

  const depositPromptMatch = route.match(/^\/v1\/agent\/customers\/([^/]+)\/deposit-prompt$/);
  if (depositPromptMatch && request.method === "POST") {
    const { data: agentProfile, error: agentError } = await admin.from("profiles").select("role,account_status").eq("id", user.id).maybeSingle();
    if (agentError || !agentProfile || !agentRoles.has(agentProfile.role)) return fail("This account does not have permission to request a customer payment.", 403, "PORTAL_ACCESS_DENIED");
    if (!approvedStatuses.has(agentProfile.account_status)) return fail("Your agent account is awaiting administrator approval.", 403, "ACCOUNT_PENDING_APPROVAL");
    const customerId = decodeURIComponent(depositPromptMatch[1]);
    const amount = Number(body.amount);
    const payerPhone = normalizeKenyanPhone(body.paymentPhone);
    if (!Number.isFinite(amount) || amount <= 0 || !payerPhone) return fail("Enter a valid deposit amount and Kenyan payment phone number.", 422, "INVALID_PAYMENT");
    const { data: application, error: applicationError } = await admin.from("screening_applications")
      .select("id,customer_id,product_id,bikes(payable_amount)")
      .eq("customer_id", customerId).eq("installer_agent_id", user.id).maybeSingle();
    if (applicationError || !application?.customer_id || !application.product_id) return fail("Customer payment details could not be found.", 404, "CUSTOMER_NOT_FOUND");
    const payableAmount = Number((application.bikes as any)?.payable_amount ?? 0);
    if (payableAmount > 0 && amount > payableAmount) return fail("The deposit cannot be higher than the total payable amount.", 422, "INVALID_DEPOSIT");

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
        AccountReference: reference,
        TransactionDesc: "Jixels tracker deposit",
      });
      const checkoutRequestId = String(result.CheckoutRequestID ?? "");
      if (!checkoutRequestId) throw new Error("M-Pesa did not return a checkout request ID.");
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
    const { data: manager, error: managerError } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (managerError || !manager || !adminRoles.has(manager.role)) return fail("Administrator approval permission is required.", 403, "FORBIDDEN");

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
    const { data: manager, error: managerError } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
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
    const { data: manager, error: managerError } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
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
    const { data: manager, error: managerError } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
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
    const { error: approvalError } = await admin.from("screening_applications").update({ status: "approved", reviewed_by: user.id, reviewed_at: now, approved_at: now, updated_at: now }).eq("id", application.id);
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

  if (route === "/v1/agent/customers" && (request.method === "GET" || request.method === "POST")) {
    const { data: agentProfile, error: agentError } = await admin.from("profiles").select("role,account_status").eq("id", user.id).maybeSingle();
    if (agentError || !agentProfile || !agentRoles.has(agentProfile.role)) return fail("This account does not have permission to onboard customers.", 403, "PORTAL_ACCESS_DENIED");
    if (!approvedStatuses.has(agentProfile.account_status)) return fail("Your agent account is awaiting administrator approval.", 403, "ACCOUNT_PENDING_APPROVAL");
    if (request.method === "GET") {
      const { data: applications, error } = await admin.from("screening_applications").select("id,customer_id,full_name,email,phone,payment_phone,national_id,location,product_identifier,product_type,product_model,tracker_identifier,deposit_amount,requested_deposit_amount,status,created_at,customers(email,address,customer_code),bikes(id,identifier,model,payable_amount,trackers(identifier))").eq("installer_agent_id", user.id).order("created_at", { ascending: false });
      if (error) return fail("Agent customers could not be loaded.", 503, "CUSTOMERS_UNAVAILABLE");
      const customerIds = [...new Set((applications ?? []).map((item: any) => item.customer_id).filter(Boolean))];
      const { data: payments, error: paymentsError } = customerIds.length
        ? await admin.from("payments").select("customer_id,product_id,amount,status,receipt_number,payer_phone,payment_reference,created_at").in("customer_id", customerIds).in("status", ["processing", "paid", "completed", "confirmed"])
        : { data: [], error: null };
      if (paymentsError) return fail("Customer payment records could not be loaded.", 503, "PAYMENTS_UNAVAILABLE");
      const { data: financeSettings, error: financeSettingsError } = await admin.from("finance_settings").select("data").eq("id", "default").maybeSingle();
      if (financeSettingsError) return fail("Commission settings could not be loaded.", 503, "COMMISSION_SETTINGS_UNAVAILABLE");
      const saleCommission = Number(financeSettings?.data?.saleCommission ?? 0);
      const monthlyCustomerCommission = Number(financeSettings?.data?.monthlyCustomerCommission ?? 0);
      const paymentBySale = new Map<string, any[]>();
      for (const payment of payments ?? []) {
        const key = `${payment.customer_id}:${payment.product_id}`;
        paymentBySale.set(key, [...(paymentBySale.get(key) ?? []), payment]);
      }
      return response({ customers: (applications ?? []).map((item: any) => {
        const salePayments = paymentBySale.get(`${item.customer_id}:${item.bikes?.id ?? item.product_id}`) ?? [];
        const confirmed = salePayments.filter((payment) => ["paid", "completed", "confirmed"].includes(String(payment.status).toLowerCase()));
        const processing = salePayments.find((payment) => String(payment.status).toLowerCase() === "processing");
        const amountPaid = confirmed.reduce((total, payment) => total + Number(payment.amount ?? 0), 0);
        const requestedDepositAmount = Number(item.requested_deposit_amount ?? item.deposit_amount ?? 0);
        return {
          id: item.customer_id ?? item.id,
          customerCode: item.customers?.customer_code ?? "",
          vehicleId: item.bikes?.id ?? "",
          name: item.full_name,
          phone: item.phone ?? "",
          email: item.email ?? item.customers?.email ?? "",
          location: item.location ?? item.customers?.address ?? "",
          payerPhone: processing?.payer_phone ?? confirmed[0]?.payer_phone ?? item.payment_phone ?? "",
          idNumber: item.national_id ?? "",
          bike: item.product_identifier ?? item.bikes?.identifier ?? "Pending assignment",
          vehicleModel: item.product_model ?? item.bikes?.model ?? "Assigned bike",
          tracker: item.tracker_identifier ?? item.bikes?.trackers?.[0]?.identifier ?? "Pending",
          kyc: item.status === "approved" ? "Approved" : "Submitted",
          install: "Pending",
          payment: amountPaid > 0 ? "Deposit Paid" : processing ? "Processing" : "Pending",
          requestedDepositAmount,
          payableAmount: Number(item.bikes?.payable_amount ?? 0),
          amount: amountPaid,
          balance: Math.max(0, Number(item.bikes?.payable_amount ?? 0) - amountPaid),
          commission: item.status === "approved" ? saleCommission + monthlyCustomerCommission : 0,
          receipt: confirmed[0]?.receipt_number ?? processing?.payment_reference ?? "",
          date: item.created_at?.slice(0, 10) ?? "",
          screeningStatus: item.status,
        };
      }) });
    }
    const name = String(body.name ?? "").trim();
    const phone = String(body.phone ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const nationalId = String(body.nationalId ?? "").trim();
    const location = String(body.location ?? "").trim();
    const bikeId = String(body.bikeId ?? "").trim();
    const depositAmount = Number(body.depositAmount ?? 0);
    if (!name || !phone || !email || !nationalId || !bikeId || !body.customerPhoto || !body.idFrontPhoto || !body.idBackPhoto) return fail("Enter the customer name, phone number, email address, national ID, assigned bike, and all three images.", 422, "INVALID_CUSTOMER_REGISTRATION");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Enter a valid customer email address.", 422, "INVALID_EMAIL");
    if (!Number.isFinite(depositAmount) || depositAmount < 0) return fail("Enter a valid customer deposit amount.", 422, "INVALID_DEPOSIT");
    const { data: bike, error: bikeError } = await admin.from("bikes").select("id,identifier,model,product_type,payable_amount,status,customer_id,trackers(identifier)").eq("id", bikeId).eq("assigned_agent_id", user.id).maybeSingle();
    if (bikeError || !bike) return fail("This bike is not assigned to your agent account.", 403, "BIKE_NOT_ASSIGNED");
    if (bike.customer_id || ["pending", "sold"].includes(String(bike.status).toLowerCase())) return fail("This tracker is already linked to another customer sale.", 409, "TRACKER_ALREADY_SOLD");
    if (depositAmount > Number(bike.payable_amount ?? 0)) return fail("The deposit cannot be higher than the total payable amount.", 422, "INVALID_DEPOSIT");
    const now = new Date().toISOString();
    const { data: customer, error: customerError } = await admin.from("customers").insert({ full_name: name, email, phone, national_id: nationalId, address: location || null, status: "pending", created_at: now, updated_at: now }).select("id,customer_code").single();
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

    const { data: application, error: applicationError } = await admin.from("screening_applications").insert({ customer_id: customer.id, product_id: bike.id, installer_agent_id: user.id, full_name: name, email, phone, national_id: nationalId, location: location || null, product_identifier: bike.identifier, product_type: bike.product_type, product_model: bike.model, tracker_identifier: bike.trackers?.[0]?.identifier ?? bike.identifier, deposit_amount: 0, requested_deposit_amount: depositAmount, payment_phone: phone, status: "pending", created_at: now, updated_at: now }).select("id").single();
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
    return response({ customer: { id: customer.id, customerCode: customer.customer_code ?? "", vehicleId: bike.id, name, phone, email, idNumber: nationalId, location: location || "Field location", bike: bike.identifier, vehicleModel: bike.model, tracker: bike.trackers?.[0]?.identifier ?? "Pending", kyc: "Submitted", install: "Pending", payment: "Pending", requestedDepositAmount: depositAmount, payableAmount: Number(bike.payable_amount ?? 0), amount: 0, balance: Number(bike.payable_amount ?? 0), commission: 0, receipt: "", date: now.slice(0, 10), screeningStatus: "pending" } }, 201);
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
      .select("id,identifier,model,product_type,payable_amount,status,assigned_agent_id,trackers(identifier)")
      .eq("assigned_agent_id", user.id)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("Agent assignment load failed", error);
      return fail("Assigned trackers could not be loaded.", 503, "ASSIGNMENTS_UNAVAILABLE");
    }
    return response({ assignments: (bikes ?? []).map((bike: any) => ({
      id: bike.id,
      registration: bike.identifier,
      model: bike.model,
      product_type: bike.product_type,
      payable_amount: bike.payable_amount,
      status: bike.status,
      assigned_agent_id: bike.assigned_agent_id,
      tracker: bike.trackers?.[0]?.identifier ?? "Pending",
    })) });
  }

  if (route === "/v1/customer/overview" && request.method === "GET") {
    const [{ data: profile, error: profileError }, { data: vehicles, error: vehiclesError }] = await Promise.all([
      client.from("profiles").select("full_name,phone,avatar_url").single(),
      admin.from("vehicles").select("id,registration,model,vehicle_type,monitoring_armed,immobilized").eq("owner_id", user.id),
    ]);
    if (profileError || !profile) return fail("This customer account is no longer available.", 404, "ACCOUNT_NOT_FOUND");
    if (vehiclesError) return fail("Customer vehicles could not be loaded.", 503, "CUSTOMER_RECORDS_UNAVAILABLE");
    return response({ profile, vehicles: vehicles ?? [] });
  }
  if (route === "/v1/customer/payments/mpesa" && request.method === "POST") {
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim(); const amount = Number(body.amount); const phone = String(body.phone ?? "").replace(/\D/g, "");
    if (!idempotencyKey || !Number.isFinite(amount) || amount <= 0 || !/^254\d{9}$/.test(phone)) return fail("Valid amount, Kenyan phone number, and Idempotency-Key are required.", 422, "INVALID_PAYMENT");
    const { data: existing } = await client.from("payment_requests").select("id,status").eq("idempotency_key", idempotencyKey).maybeSingle(); if (existing) return response(existing);
    const { data: vehicle } = await admin.from("vehicles").select("id").eq("id", body.vehicleId).eq("owner_id", user.id).single(); if (!vehicle) return fail("Vehicle not found.", 404, "NOT_FOUND");
    const { data: payment, error } = await client.from("payment_requests").insert({ owner_id: user.id, vehicle_id: vehicle.id, idempotency_key: idempotencyKey, amount, phone, status: "processing" }).select("id,status").single(); if (error) return fail(error.message, 400);
    try { const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14); const result = await darajaPost("/mpesa/stkpush/v1/processrequest", { BusinessShortCode: Deno.env.get("DARAJA_SHORTCODE"), Password: stkPassword(timestamp), Timestamp: timestamp, TransactionType: "CustomerPayBillOnline", Amount: amount, PartyA: phone, PartyB: Deno.env.get("DARAJA_SHORTCODE"), PhoneNumber: phone, CallBackURL: Deno.env.get("DARAJA_STK_CALLBACK_URL"), AccountReference: idempotencyKey.slice(0, 12), TransactionDesc: "Tracker service payment" }); await client.from("daraja_transactions").insert({ direction: "C2B", checkout_request_id: result.CheckoutRequestID ?? null, account_reference: idempotencyKey, phone, amount, status: "submitted", payload: result }); return response({ ...payment, ...result }, 202); }
    catch (cause) { await client.from("payment_requests").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", payment.id); return fail(cause instanceof Error ? cause.message : "M-Pesa request failed.", 502, "MPESA_ERROR"); }
  }
  const statusMatch = route.match(/^\/v1\/customer\/motorcycles\/([^/]+)\/security-status$/);
  if (statusMatch && request.method === "GET") {
    const vehicleId = decodeURIComponent(statusMatch[1]);
    const { data: vehicle } = await admin.from("vehicles").select("id,tracker_imei,monitoring_armed,immobilized").eq("id", vehicleId).eq("owner_id", user.id).single();
    if (!vehicle) return fail("Vehicle not found.", 404, "NOT_FOUND");
    let provider = null;
    const configuredPath = Deno.env.get("TRAMIGO_CLOUD_OUTBOUND_STATUS_PATH");
    if (vehicle.tracker_imei && configuredPath) {
      try { provider = await tramigoRequest(tramigoPath(configuredPath, vehicle.tracker_imei)); } catch (_) { /* return last trusted local state */ }
    }
    return response({ vehicleId, monitoringArmed: vehicle.monitoring_armed, immobilized: vehicle.immobilized, provider });
  }
  if (route === "/v1/customer/motorcycles/security-status" && request.method === "GET") {
    const { data: vehicles } = await admin.from("vehicles").select("id,registration,monitoring_armed,immobilized").eq("owner_id", user.id);
    return response({ vehicles: vehicles ?? [] });
  }
  const securityMatch = route.match(/^\/v1\/customer\/motorcycles\/([^/]+)\/(monitoring|immobilizer)$/);
  if (securityMatch && request.method === "POST") {
    const vehicleId = decodeURIComponent(securityMatch[1]); const action = securityMatch[2];
    const { data: vehicle } = await admin.from("vehicles").select("id,tracker_imei").eq("id", vehicleId).eq("owner_id", user.id).single();
    if (!vehicle) return fail("Vehicle not found.", 404, "NOT_FOUND");
    if (!vehicle.tracker_imei) return fail("This vehicle has no Tramigo tracker assigned.", 409, "TRACKER_NOT_ASSIGNED");
    const enabled = action === "monitoring" ? Boolean(body.armed) : Boolean(body.immobilized);
    const configuredPath = action === "monitoring" ? Deno.env.get("TRAMIGO_CLOUD_CONTROL_STATUS_PATH") : Deno.env.get("TRAMIGO_CLOUD_IMMOBILIZER_PATH");
    if (!configuredPath) return fail("Tramigo security control is not configured.", 503, "TRAMIGO_NOT_CONFIGURED");
    try {
      const provider = await tramigoRequest(tramigoPath(configuredPath, vehicle.tracker_imei), { method: "POST", body: { deviceId: vehicle.tracker_imei, imei: vehicle.tracker_imei, enabled, armed: action === "monitoring" ? enabled : undefined, immobilized: action === "immobilizer" ? enabled : undefined } });
      const update = action === "monitoring" ? { monitoring_armed: enabled, updated_at: new Date().toISOString() } : { immobilized: enabled, updated_at: new Date().toISOString() };
      const { error } = await admin.from("vehicles").update(update).eq("id", vehicleId).eq("owner_id", user.id);
      if (error) return fail("Tramigo accepted the command, but local state could not be saved.", 502, "STATE_SYNC_FAILED");
      return response({ vehicleId, action, enabled, provider });
    } catch (error) { return fail(error instanceof Error ? error.message : "Tramigo command failed.", 502, "TRAMIGO_ERROR"); }
  }
  if (route === "/v1/customer/profile" && request.method === "PATCH") {
    const { data, error } = await client.from("profiles").update({ full_name: body.fullName, phone: body.phone, avatar_url: body.avatarUrl, updated_at: new Date().toISOString() }).eq("id", user.id).select().single();
    return error ? fail(error.message, 400) : response(data);
  }
  const locationMatch = route.match(/^\/v1\/customer\/motorcycles\/([^/]+)\/location$/);
  if (locationMatch && request.method === "GET") {
    const vehicleId = decodeURIComponent(locationMatch[1]);
    const { data: vehicle } = await admin.from("vehicles").select("id,registration,model,vehicle_type,tracker_imei").eq("id", vehicleId).eq("owner_id", user.id).single();
    if (!vehicle) return fail("Vehicle not found.", 404, "NOT_FOUND");
    let location = null;
    // A short per-owner lease makes repeated polling return the last trusted
    // location instead of turning a stolen session into a Tramigo API flood.
    const { data: canQueryProvider, error: rateLimitError } = await admin.rpc("claim_location_provider_read", {
      p_key: `${user.id}:${vehicleId}`, p_max_requests: 4, p_window_seconds: 60,
    });
    if (rateLimitError) console.error("Location provider rate limit unavailable", rateLimitError);
    if (vehicle.tracker_imei && Deno.env.get("TRAMIGO_USERNAME") && !rateLimitError && canQueryProvider === true) {
      try {
        const providerSession = await tramigoSession();
        const deviceCatalogue = await tramigoRequest("/api/v2/devices?page=1&per_page=1000", {}, providerSession);
        const cloudDeviceId = await tramigoCloudDeviceId(vehicle.tracker_imei, deviceCatalogue, providerSession);
        const tramigo = tramigoLocation(await tramigoRequest(`/api/reports/last_location/${encodeURIComponent(cloudDeviceId)}`, {}, providerSession));
        if (tramigo) { const trackerRow = await admin.from("trackers").select("id").eq("identifier", vehicle.tracker_imei).maybeSingle(); await admin.from("tracker_locations").insert({ vehicle_id: vehicleId, tracker_id: trackerRow.data?.id ?? null, latitude: tramigo.latitude, longitude: tramigo.longitude, speed_kph: tramigo.speedKph, recorded_at: tramigo.recordedAt }); location = { latitude: tramigo.latitude, longitude: tramigo.longitude, speedKph: tramigo.speedKph, recordedAt: tramigo.recordedAt, trackerStatus: tramigo.trackerStatus }; }
      } catch (_) { /* fall back to the last synced location */ }
    }
    if (!location) { const { data: saved } = await admin.from("tracker_locations").select("latitude,longitude,speed_kph,heading,accuracy_meters,recorded_at").eq("vehicle_id", vehicleId).order("recorded_at", { ascending: false }).limit(1).maybeSingle(); location = saved && { latitude: saved.latitude, longitude: saved.longitude, speedKph: saved.speed_kph, heading: saved.heading, accuracyMeters: saved.accuracy_meters, recordedAt: saved.recorded_at }; }
    const { tracker_imei: _privateTrackerImei, ...safeVehicle } = vehicle;
    return response({ ...safeVehicle, location });
  }
  const routeMatch = route.match(/^\/v1\/customer\/motorcycles\/([^/]+)\/route$/);
  if (routeMatch && request.method === "GET") {
    const vehicleId = decodeURIComponent(routeMatch[1]);
    const { data: vehicle } = await admin.from("vehicles").select("id").eq("id", vehicleId).eq("owner_id", user.id).maybeSingle();
    if (!vehicle) return fail("Vehicle not found.", 404, "NOT_FOUND");
    const window = routeWindow(url);
    if ("error" in window) return fail(window.error, 422, "INVALID_ROUTE_WINDOW");
    try { return response(await loadRoute(admin, vehicleId, null, window)); }
    catch (error) { console.error("Customer route load failed", vehicleId, error); return fail("Route history is temporarily unavailable.", 503, "ROUTE_UNAVAILABLE"); }
  }
  return fail("Endpoint not implemented yet.", 501, "NOT_IMPLEMENTED");
  } catch (error) {
    // Never let an unexpected Edge Function exception become an opaque 500.
    // The path is logged without credentials or request data for diagnosis.
    console.error("Unhandled API request error", requestPath, error);
    return fail("The tracker service encountered a server error. Refresh once more, then contact support with the request time.", 503, "API_UNEXPECTED_ERROR");
  }
});
