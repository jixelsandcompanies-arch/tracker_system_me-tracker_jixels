const SESSION_TTL = 8 * 60 * 60 * 1000;
const INACTIVITY_LIMIT = 30 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 3;
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
let activeSession = null;
const failedAttempts = new Map();
const blockedAccounts = new Set();

export function getSession() {
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
  if (attempts > MAX_FAILED_ATTEMPTS) {
    blockedAccounts.add(key);
    return "Account blocked after the fourth wrong login attempt. Contact the Jixels administrator.";
  }
  const remaining = MAX_FAILED_ATTEMPTS + 1 - attempts;
  return `Unable to sign in. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining before the account is blocked.`;
}

function clearFailedAttempts(email) {
  const key = normalizedLogin(email);
  failedAttempts.delete(key);
  blockedAccounts.delete(key);
}

export async function signIn(email, password) {
  if (blockedAccounts.has(normalizedLogin(email))) return { error: "Account blocked. Contact the Jixels administrator to reopen access." };
  if (supabaseUrl && supabaseKey) {
    try {
      const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: supabaseKey, "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password })
      });
      if (!response.ok) return { error: registerFailedAttempt(email) };
      const result = await response.json();
      const session = { userId: result.user?.id, email: result.user?.email || email, name: result.user?.user_metadata?.name || "Administrator", role: result.user?.user_metadata?.role || "Support agent", accessToken: result.access_token, refreshToken: result.refresh_token, expiresAt: Date.now() + Math.min((result.expires_in || 3600) * 1000, SESSION_TTL), lastActivity: Date.now() };
      activeSession = session;
      clearFailedAttempts(email);
      return { data: session };
    } catch {
      return { error: "Authentication service is unavailable. Try again shortly." };
    }
  }

  return { error: "Admin authentication is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY." };
}

export function signOut() {
  activeSession = null;
}

export function touchSession() {
  const session = getSession();
  if (!session) return null;
  const refreshed = { ...session, lastActivity: Date.now() };
  activeSession = refreshed;
  return refreshed;
}


