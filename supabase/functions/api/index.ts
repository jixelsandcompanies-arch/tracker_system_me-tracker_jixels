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
async function tramigoRequest(path: string, options: { method?: string; body?: unknown } = {}) {
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
  const resultController = new AbortController(); const resultTimer = setTimeout(() => resultController.abort(), 10_000);
  let result: Response;
  try {
    result = await fetch(`${base}${path}`, { method: options.method ?? "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(options.body == null ? {} : { "Content-Type": "application/json" }) }, body: options.body == null ? undefined : JSON.stringify(options.body), signal: resultController.signal });
  } finally { clearTimeout(resultTimer); }
  const data = await result.json().catch(() => ({}));
  if (!result.ok) throw new Error(data.message ?? "Tramigo request failed.");
  return data;
}
function tramigoLocation(report: any) {
  const source = report?.main_reports?.[0] ?? report?.mainReports?.[0] ?? report;
  const latitude = Number(source?.Latitude ?? source?.latitude); const longitude = Number(source?.Longitude ?? source?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude, speedKph: Number(source?.Speed ?? source?.speed ?? 0), recordedAt: source?.DateTimeActual ?? report?.DateTimeActual ?? new Date().toISOString() };
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

async function sendCustomerApprovalPush(
  admin: ReturnType<typeof createClient>,
  customerId: string,
  code: string,
  email: string,
) {
  const { data: tokens, error } = await admin
    .from("customer_push_tokens")
    .select("expo_push_token")
    .eq("customer_id", customerId);
  if (error || !tokens?.length) return false;

  const messages = tokens.map(({ expo_push_token }) => ({
    to: expo_push_token,
    sound: "default",
    title: "Jixels account approved",
    body: "Your account is approved. Open Jixels Customer Trackings to enter your secure approval code.",
    data: { type: "customer_approval", customerId, code, email },
  }));
  try {
    const result = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
    });
    if (!result.ok) console.error("Customer approval push failed", await result.text());
    return result.ok;
  } catch (error) {
    console.error("Customer approval push failed", error);
    return false;
  }
}

async function removeCustomerWorkspace(admin: ReturnType<typeof createClient>, customerId: string) {
  const { data: bikes, error: bikesError } = await admin.from("bikes").select("id").eq("customer_id", customerId);
  if (bikesError) throw bikesError;
  const bikeIds = (bikes ?? []).map((bike) => bike.id);
  const remove = async (request: any) => {
    const { error } = await request;
    if (error) throw error;
  };

  await remove(admin.from("support_cases").delete().eq("customer_id", customerId));
  await remove(admin.from("screening_applications").delete().eq("customer_id", customerId));
  await remove(admin.from("payments").delete().eq("customer_id", customerId));
  await remove(admin.from("finance_accounts").delete().eq("customer_id", customerId));
  await remove(admin.from("finance_accounts").delete().filter("data->>customerId", "eq", customerId));
  if (bikeIds.length) {
    await remove(admin.from("trackers").delete().in("bike_id", bikeIds));
    await remove(admin.from("bikes").delete().in("id", bikeIds));
  }
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
  // Supabase can return an obfuscated user with no identities for an existing email.
  // A repeat submission for the same pending account is not a technical failure.
  // Do not overwrite an account registered for a different portal role.
  if (data.user && data.user.identities?.length === 0) {
    if (existing?.role === role && existing.account_status === "pending") {
      return response({ status: "pending", message: "Registration details were already submitted. Please wait for administrator approval before signing in." });
    }
    return fail("An account with this email already exists. Sign in or reset its password.", 409, "ACCOUNT_ALREADY_EXISTS");
  }
  if (error || !data.user) {
    console.error("Portal registration failed", error);
    const providerMessage = String(error?.message ?? "").toLowerCase();
    if (providerMessage.includes("already") || providerMessage.includes("exists") || providerMessage.includes("registered")) {
      if (existing?.role === role && existing.account_status === "pending") {
        return response({ status: "pending", message: "Registration details were already submitted. Please wait for administrator approval before signing in." });
      }
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
    const { error: customerError } = await admin.from("customers").upsert({ id: data.user.id, full_name: fullName, email, phone, status: "pending", created_at: now, updated_at: now }, { onConflict: "id" });
    if (customerError) { console.error("Customer account provisioning failed", customerError); await rollbackAuthUser(); return fail("Registration could not be completed. Please try again.", 503, "CUSTOMER_PROVISIONING_FAILED"); }
    const { error: screeningError } = await admin.from("screening_applications").insert({ customer_id: data.user.id, full_name: fullName, email, phone, status: "pending", updated_at: now });
    if (screeningError) { console.error("Customer screening provisioning failed", screeningError); await rollbackAuthUser(); return fail("Registration could not be completed. Please try again.", 503, "CUSTOMER_APPROVAL_PROVISIONING_FAILED"); }
    const pushToken = body.pushToken;
    if (isExpoPushToken(pushToken)) {
      const { error: pushTokenError } = await admin.from("customer_push_tokens").upsert({ customer_id: data.user.id, expo_push_token: pushToken, platform: String(body.platform ?? "mobile"), updated_at: now }, { onConflict: "customer_id,expo_push_token" });
      if (pushTokenError) console.error("Customer push token provisioning failed", pushTokenError);
    }
  }
  return response({ status: "pending", message: "Registration details submitted successfully. Please wait for administrator approval before signing in." }, 201);
}

const customerRoles = new Set(["customer"]);
const agentRoles = new Set(["agent", "support_agent"]);
const financeRoles = new Set(["finance", "finance_officer", "admin", "super_admin"]);
const adminRoles = new Set(["admin", "super_admin", "operations_manager"]);
const approvableStaffRoles = new Set(["agent", "support_agent", "finance", "finance_officer"]);
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
    .select("full_name,email,phone,role,account_status")
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
    user: { id: data.user.id, email: data.user.email, name: profile.full_name, phone: profile.phone, role: profile.role, assignedVehicles },
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
      let accountsQuery = admin
        .from("profiles")
        .select("id,full_name,email,phone,role,account_status,created_at,updated_at")
        .in("role", [...approvableStaffRoles]);
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
    if (accountError || !account || !approvableStaffRoles.has(account.role)) return fail("Pending staff account not found.", 404, "ACCOUNT_NOT_FOUND");
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
    const { error: auditError } = await admin.from("audit_logs").insert({
      actor_id: user.id,
      action: nextStatus === "approved" ? "approved staff account" : "rejected staff account",
      resource: "profiles",
      detail: { account_id: account.id, email: account.email, role: account.role, previous_status: account.account_status, next_status: nextStatus },
    });
    if (auditError) console.error("Account approval audit write failed", auditError);
    return response({ account: updated, message: nextStatus === "approved" ? "Account approved. The user can now sign in." : "Account rejected. The user cannot access the portal." });
  }

  const deleteMatch = route.match(/^\/v1\/admin\/users\/([^/]+)$/);
  if (deleteMatch && request.method === "DELETE") {
    const targetId = decodeURIComponent(deleteMatch[1]);
    const { data: manager, error: managerError } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (managerError || !manager || !adminRoles.has(manager.role)) return fail("Administrator permission is required to delete an account.", 403, "FORBIDDEN");
    if (targetId === user.id) return fail("You cannot delete the account currently signed in to Admin.", 422, "CANNOT_DELETE_SELF");
    try {
      await removeCustomerWorkspace(admin, targetId);
      const { data: profile, error: profileError } = await admin.from("profiles").select("id").eq("id", targetId).maybeSingle();
      if (profileError) throw profileError;
      if (profile) {
        const { error: deleteError } = await admin.auth.admin.deleteUser(targetId);
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
    const applicationQuery = admin.from("screening_applications").select("id,customer_id,email,phone");
    const { data: application, error: applicationError } = applicationId
      ? await applicationQuery.eq("id", applicationId).maybeSingle()
      : await applicationQuery.eq("customer_id", customerId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (applicationError || !application) return fail("Screening application not found.", 404, "NOT_FOUND");
    const now = new Date().toISOString();
    const { error: approvalError } = await admin.from("screening_applications").update({ status: "approved", reviewed_by: user.id, reviewed_at: now, approved_at: now, updated_at: now }).eq("id", application.id);
    if (approvalError) return fail("The screening application could not be approved.", 400, "APPROVAL_FAILED");
    if (application.customer_id) {
      await admin.from("customers").update({ status: "active", updated_at: now }).eq("id", application.customer_id);
      await admin.from("profiles").update({ account_status: "approved", updated_at: now }).eq("id", application.customer_id);
    } else if (application.email) {
      await admin.from("profiles").update({ account_status: "approved", updated_at: now }).eq("email", application.email.toLowerCase());
    }
    if (!application.customer_id) return response({ approved: true, pushSent: false, message: "Customer approved. The customer must register the Jixels Customer app before an in-app approval code can be issued." });
    const { data: mobileProfile, error: mobileProfileError } = await admin.from("profiles").select("email,role").eq("id", application.customer_id).maybeSingle();
    if (mobileProfileError) return fail("Customer approved, but mobile account status could not be checked.", 503, "CUSTOMER_APP_UNAVAILABLE");
    if (!mobileProfile || mobileProfile.role !== "customer") return response({ approved: true, pushSent: false, message: "Customer approved. The customer must register the Jixels Customer app before an in-app approval code can be issued." });
    const code = approvalCode();
    const { error: codeError } = await admin.from("customer_approval_codes").upsert({ customer_id: application.customer_id, code_hash: await sha256(code), expires_at: new Date(Date.now() + 5 * 60_000).toISOString(), used_at: null }, { onConflict: "customer_id" });
    if (codeError) return fail("Customer approved, but the in-app approval code could not be created.", 503, "APPROVAL_CODE_UNAVAILABLE");
    const pushSent = await sendCustomerApprovalPush(admin, application.customer_id, code, mobileProfile.email ?? application.email ?? "");
    return response({ approved: true, pushSent, message: pushSent ? "Customer approved. The Jixels Customer app received an in-app approval code." : "Customer approved. The customer must open the registered Jixels Customer app to receive the in-app code." });
  }

  if (route === "/v1/agent/customers" && (request.method === "GET" || request.method === "POST")) {
    const { data: agentProfile, error: agentError } = await admin.from("profiles").select("role,account_status").eq("id", user.id).maybeSingle();
    if (agentError || !agentProfile || !agentRoles.has(agentProfile.role)) return fail("This account does not have permission to onboard customers.", 403, "PORTAL_ACCESS_DENIED");
    if (!approvedStatuses.has(agentProfile.account_status)) return fail("Your agent account is awaiting administrator approval.", 403, "ACCOUNT_PENDING_APPROVAL");
    if (request.method === "GET") {
      const { data: applications, error } = await admin.from("screening_applications").select("id,customer_id,full_name,phone,national_id,tracker_identifier,deposit_amount,status,created_at,bikes(id,identifier,model,payable_amount,trackers(identifier))").eq("installer_agent_id", user.id).order("created_at", { ascending: false });
      if (error) return fail("Agent customers could not be loaded.", 503, "CUSTOMERS_UNAVAILABLE");
      return response({ customers: (applications ?? []).map((item: any) => ({ id: item.customer_id ?? item.id, vehicleId: item.bikes?.id ?? "", name: item.full_name, phone: item.phone ?? "", idNumber: item.national_id ?? "", bike: item.bikes?.identifier ?? "Pending assignment", vehicleModel: item.bikes?.model ?? "Assigned bike", tracker: item.tracker_identifier ?? item.bikes?.trackers?.[0]?.identifier ?? "Pending", kyc: "Submitted", install: "Pending", payment: Number(item.deposit_amount ?? 0) > 0 ? "Deposit Paid" : "Pending", payableAmount: Number(item.bikes?.payable_amount ?? 0), amount: Number(item.deposit_amount ?? 0), balance: Math.max(0, Number(item.bikes?.payable_amount ?? 0) - Number(item.deposit_amount ?? 0)), commission: 0, receipt: "", date: item.created_at?.slice(0, 10) ?? "", screeningStatus: item.status })) });
    }
    const name = String(body.name ?? "").trim();
    const phone = String(body.phone ?? "").trim();
    const nationalId = String(body.nationalId ?? "").trim();
    const location = String(body.location ?? "").trim();
    const bikeId = String(body.bikeId ?? "").trim();
    const depositAmount = Number(body.depositAmount ?? 0);
    if (!name || !phone || !nationalId || !bikeId) return fail("Enter the customer name, phone number, national ID, and assigned bike.", 422, "INVALID_CUSTOMER_REGISTRATION");
    if (!Number.isFinite(depositAmount) || depositAmount < 0) return fail("Enter a valid customer deposit amount.", 422, "INVALID_DEPOSIT");
    const { data: bike, error: bikeError } = await admin.from("bikes").select("id,identifier,model,payable_amount,status,trackers(identifier)").eq("id", bikeId).eq("assigned_agent_id", user.id).maybeSingle();
    if (bikeError || !bike) return fail("This bike is not assigned to your agent account.", 403, "BIKE_NOT_ASSIGNED");
    if (depositAmount > Number(bike.payable_amount ?? 0)) return fail("The deposit cannot be higher than the total payable amount.", 422, "INVALID_DEPOSIT");
    const now = new Date().toISOString();
    const { data: customer, error: customerError } = await admin.from("customers").insert({ full_name: name, phone, national_id: nationalId, address: location || null, status: "pending", created_at: now, updated_at: now }).select("id").single();
    if (customerError || !customer) return fail("Customer registration could not be saved.", 503, "CUSTOMER_REGISTRATION_FAILED");
    const { error: applicationError } = await admin.from("screening_applications").insert({ customer_id: customer.id, product_id: bike.id, installer_agent_id: user.id, full_name: name, phone, national_id: nationalId, tracker_identifier: bike.trackers?.[0]?.identifier ?? bike.identifier, deposit_amount: depositAmount, status: "pending", created_at: now, updated_at: now });
    if (applicationError) {
      await admin.from("customers").delete().eq("id", customer.id);
      return fail("Customer screening could not be submitted.", 503, "SCREENING_REGISTRATION_FAILED");
    }
    return response({ customer: { id: customer.id, vehicleId: bike.id, name, phone, idNumber: nationalId, location: location || "Field location", bike: bike.identifier, vehicleModel: bike.model, tracker: bike.trackers?.[0]?.identifier ?? "Pending", kyc: "Submitted", install: "Pending", payment: depositAmount > 0 ? "Deposit Paid" : "Pending", payableAmount: Number(bike.payable_amount ?? 0), amount: depositAmount, balance: Math.max(0, Number(bike.payable_amount ?? 0) - depositAmount), commission: 0, receipt: "", date: now.slice(0, 10), screeningStatus: "pending" } }, 201);
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
  const statusMatch = route.match(/^\/v1\/customer\/motorcycles\/([^/]+)\/security-status$/);
  if (statusMatch && request.method === "GET") {
    const vehicleId = decodeURIComponent(statusMatch[1]);
    const { data: vehicle } = await client.from("vehicles").select("id,tracker_imei,monitoring_armed,immobilized").eq("id", vehicleId).single();
    if (!vehicle) return fail("Vehicle not found.", 404, "NOT_FOUND");
    let provider = null;
    const configuredPath = Deno.env.get("TRAMIGO_CLOUD_OUTBOUND_STATUS_PATH");
    if (vehicle.tracker_imei && configuredPath) {
      try { provider = await tramigoRequest(tramigoPath(configuredPath, vehicle.tracker_imei)); } catch (_) { /* return last trusted local state */ }
    }
    return response({ vehicleId, monitoringArmed: vehicle.monitoring_armed, immobilized: vehicle.immobilized, provider });
  }
  if (route === "/v1/customer/motorcycles/security-status" && request.method === "GET") {
    const { data: vehicles } = await client.from("vehicles").select("id,registration,monitoring_armed,immobilized");
    return response({ vehicles: vehicles ?? [] });
  }
  const securityMatch = route.match(/^\/v1\/customer\/motorcycles\/([^/]+)\/(monitoring|immobilizer)$/);
  if (securityMatch && request.method === "POST") {
    const vehicleId = decodeURIComponent(securityMatch[1]); const action = securityMatch[2];
    const { data: vehicle } = await client.from("vehicles").select("id,tracker_imei").eq("id", vehicleId).single();
    if (!vehicle) return fail("Vehicle not found.", 404, "NOT_FOUND");
    if (!vehicle.tracker_imei) return fail("This vehicle has no Tramigo tracker assigned.", 409, "TRACKER_NOT_ASSIGNED");
    const enabled = action === "monitoring" ? Boolean(body.armed) : Boolean(body.immobilized);
    const configuredPath = action === "monitoring" ? Deno.env.get("TRAMIGO_CLOUD_CONTROL_STATUS_PATH") : Deno.env.get("TRAMIGO_CLOUD_IMMOBILIZER_PATH");
    if (!configuredPath) return fail("Tramigo security control is not configured.", 503, "TRAMIGO_NOT_CONFIGURED");
    try {
      const provider = await tramigoRequest(tramigoPath(configuredPath, vehicle.tracker_imei), { method: "POST", body: { deviceId: vehicle.tracker_imei, imei: vehicle.tracker_imei, enabled, armed: action === "monitoring" ? enabled : undefined, immobilized: action === "immobilizer" ? enabled : undefined } });
      const update = action === "monitoring" ? { monitoring_armed: enabled, updated_at: new Date().toISOString() } : { immobilized: enabled, updated_at: new Date().toISOString() };
      const { error } = await admin.from("vehicles").update(update).eq("id", vehicleId);
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
