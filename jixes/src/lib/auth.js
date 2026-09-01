const SESSION_TTL = 8 * 60 * 60 * 1000;
const INACTIVITY_LIMIT = 30 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 3;
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
let activeSession = null;
const failedAttempts = new Map();
const blockedAccounts = new Set();
const SESSION_KEY = "jixels.admin.session.v1";

function safeMessage(status) {
  if (status === 401 || status === 400) return "Incorrect email or password. Please check your details and try again.";
  if (status === 429) return "Too many requests. Please wait and try again.";
  return "Authentication temporarily unavailable. Please try again in a few moments.";
}

function restoreSession() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
    if (stored?.accessToken && stored?.expiresAt > Date.now()) return stored;
  } catch (error) { console.error("Could not restore admin session", error); }
  return null;
}

function persistSession(session) {
  activeSession = session;
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (error) { console.error("Could not persist admin session", error); }
}

export function getSession() {
  if (!activeSession) activeSession = restoreSession();
  if (!activeSession || Date.now() > activeSession.expiresAt || Date.now() - activeSession.lastActivity > INACTIVITY_LIMIT) {
    signOut();
    return null;
  }
  return activeSession;
}

function normalizedLogin(email) {
  return email.trim().toLowerCase();
}

function registerFailedAttempt(email) {
  const key = normalizedLogin(email);
  const attempts = (failedAttempts.get(key) || 0) + 1;
  failedAttempts.set(key, attempts);
  if (attempts >= MAX_FAILED_ATTEMPTS) {
    blockedAccounts.add(key);
    return "Your account has been temporarily locked because of too many failed login attempts. Please contact an administrator or use the account recovery option.";
  }
  const remaining = MAX_FAILED_ATTEMPTS + 1 - attempts;
  return `Incorrect email or password. Please check your details and try again. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining before the account is blocked.`;
}

function clearFailedAttempts(email) {
  const key = normalizedLogin(email);
  failedAttempts.delete(key);
  blockedAccounts.delete(key);
}

export async function signIn(email, password) {
  if (blockedAccounts.has(normalizedLogin(email))) return { error: "Your account has been temporarily locked because of too many failed login attempts. Please contact an administrator or use the account recovery option." };
  if (supabaseUrl && supabaseKey) {
    try {
      const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: supabaseKey, "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password })
      });
      if (!response.ok) {
        // Only rejected credentials count toward lockout. Network, schema and
        // server errors must never lock a legitimate staff account.
        if (response.status === 400 || response.status === 401) return { error: registerFailedAttempt(email) };
        console.error("Admin sign-in failed", response.status, await response.text().catch(() => ""));
        return { error: safeMessage(response.status) };
      }
      const result = await response.json();
      const profileResponse = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(result.user?.id)}&select=full_name,role,account_status`, { headers: { apikey: supabaseKey, Authorization: `Bearer ${result.access_token}` } });
      if (!profileResponse.ok) {
        console.error("Admin profile lookup failed", profileResponse.status, await profileResponse.text().catch(() => ""));
        return { error: "Your account profile could not be loaded. Please contact an administrator." };
      }
      const profile = (await profileResponse.json())[0];
      if (!profile?.role || profile.account_status !== "approved") return { error: "Your account is not approved for the Admin portal. Please contact an administrator." };
      const session = { userId: result.user?.id, email: result.user?.email || email, name: profile.full_name || "Administrator", role: profile.role, accessToken: result.access_token, refreshToken: result.refresh_token, expiresAt: Date.now() + Math.min((result.expires_in || 3600) * 1000, SESSION_TTL), lastActivity: Date.now() };
      persistSession(session);
      clearFailedAttempts(email);
      return { data: session };
    } catch (error) {
      console.error("Admin authentication service failure", error);
      return { error: "Authentication temporarily unavailable. Please try again in a few moments." };
    }
  }

  return { error: "Admin authentication is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY." };
}

export function signOut() {
  activeSession = null;
  try { sessionStorage.removeItem(SESSION_KEY); } catch (error) { console.error("Could not clear admin session", error); }
}

export function touchSession() {
  const session = getSession();
  if (!session) return null;
  const refreshed = { ...session, lastActivity: Date.now() };
  persistSession(refreshed);
  return refreshed;
}


