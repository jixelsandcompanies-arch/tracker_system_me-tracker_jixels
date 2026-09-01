const SESSION_TTL = 8 * 60 * 60 * 1000;
const INACTIVITY_LIMIT = 30 * 60 * 1000;
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
let activeSession = null;

const demoAccount = {
  email: "admin@jixels.co.za",
  name: "Demo administrator",
  role: "Super administrator"
};


export function getSession() {
  if (!activeSession || Date.now() > activeSession.expiresAt || Date.now() - activeSession.lastActivity > INACTIVITY_LIMIT) {
    signOut();
    return null;
  }
  return activeSession;
}

export async function signIn(email, password) {
  if (supabaseUrl && supabaseKey) {
    try {
      const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: supabaseKey, "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password })
      });
      if (!response.ok) return { error: "Unable to sign in. Check your credentials." };
      const result = await response.json();
      const session = { userId: result.user?.id, email: result.user?.email || email, name: result.user?.user_metadata?.name || "Administrator", role: result.user?.user_metadata?.role || "Support agent", accessToken: result.access_token, refreshToken: result.refresh_token, expiresAt: Date.now() + Math.min((result.expires_in || 3600) * 1000, SESSION_TTL), lastActivity: Date.now() };
      activeSession = session;
      return { data: session };
    } catch {
      return { error: "Authentication service is unavailable. Try again shortly." };
    }
  }

  if (email.trim().toLowerCase() !== demoAccount.email || password !== "jixels-admin") return { error: "Use the demo account or connect Supabase." };
  const session = { ...demoAccount, expiresAt: Date.now() + SESSION_TTL, lastActivity: Date.now() };
  activeSession = session;
  return { data: session };
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

export const demoCredentials = { email: demoAccount.email, password: "jixels-admin" };

