const SESSION_TTL = 8 * 60 * 60 * 1000;
const INACTIVITY_LIMIT = 30 * 60 * 1000;
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
let activeSession = null;
const SESSION_KEY = "jixels.admin.session.v1";

function safeMessage(status, message = "") {
  if (status === 401 || status === 400) return "Incorrect email or password. Please check your details and try again.";
  if (status === 429) return message || "Too many requests. Please wait and try again.";
  if (status === 403 && message) return message;
  return "Authentication temporarily unavailable. Please try again in a few moments.";
}

function restoreSession() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
    if (stored?.accessToken && stored?.refreshToken && stored?.expiresAt > Date.now()) return stored;
  } catch (error) { console.error("Could not restore admin session", error); }
  return null;
}

function persistSession(session) {
  activeSession = session;
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (error) { console.error("Could not persist admin session", error); }
}

export function getSession() {
  if (!activeSession) activeSession = restoreSession();
  if (!activeSession || !activeSession.refreshToken || Date.now() > activeSession.expiresAt || Date.now() - activeSession.lastActivity > INACTIVITY_LIMIT) {
    signOut();
    return null;
  }
  return activeSession;
}

export async function signIn(email, password) {
  if (supabaseUrl && supabaseKey) {
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/api/v1/admin/auth/login`, {
        method: "POST",
        headers: { apikey: supabaseKey, "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        console.error("Admin sign-in failed", response.status, payload.message || "");
        return { error: safeMessage(response.status, payload.message) };
      }
      const result = await response.json();
      if (!result?.accessToken || !result?.user) return { error: "Authentication temporarily unavailable. Please try again in a few moments." };
      const expiresAt = Date.parse(result.expiresAt || "") || Date.now() + SESSION_TTL;
      const session = { userId: result.user.id, email: result.user.email || email, name: result.user.name || "Administrator", role: result.user.role, accessToken: result.accessToken, refreshToken: result.refreshToken || null, expiresAt, lastActivity: Date.now() };
      persistSession(session);
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


