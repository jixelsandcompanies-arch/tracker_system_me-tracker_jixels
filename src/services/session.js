import * as SecureStore from "expo-secure-store";
import { requireApiUrl } from "../config";

const SESSION_KEY = "jixels.customer.session.v1";
const refreshedAccessTokens = new Map();

function isUsableSession(session) {
  if (!session?.accessToken || !session?.user) return false;
  if (!session.expiresAt) return false;
  const expiresAt = typeof session.expiresAt === "number" ? session.expiresAt : Date.parse(session.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > Date.now() + 30_000;
}

export const sessionStore = {
  async get() {
    const value = await SecureStore.getItemAsync(SESSION_KEY);
    if (!value) return null;
    let session;
    try {
      session = JSON.parse(value);
      if (isUsableSession(session)) return session;
      if (session?.refreshToken) {
        const refreshed = await this.refresh(session);
        if (refreshed) return refreshed;
        await SecureStore.deleteItemAsync(SESSION_KEY);
        return null;
      }
      await SecureStore.deleteItemAsync(SESSION_KEY);
      return null;
    } catch {
      // Preserve the saved login when a refresh attempt failed due to network.
      return session?.refreshToken ? session : null;
    }
  },
  set(session) {
    if (!isUsableSession(session)) return Promise.reject(new Error("Refusing to store an invalid or expired session."));
    return SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  },
  async refresh(session) {
    if (!session?.refreshToken) return null;
    const response = await fetch(`${requireApiUrl()}/v1/auth/refresh`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-Client-Platform": "mobile" },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });
    const next = await response.json().catch(() => null);
    if (!response.ok || !next?.accessToken || !next?.refreshToken || !next?.expiresAt) return null;
    refreshedAccessTokens.set(session.accessToken, next.accessToken);
    await this.set(next);
    return next;
  },
  async refreshForToken(accessToken) {
    const cached = refreshedAccessTokens.get(accessToken);
    if (cached) return cached;
    const raw = await SecureStore.getItemAsync(SESSION_KEY);
    if (!raw) return null;
    let session;
    try { session = JSON.parse(raw); } catch { return null; }
    if (session.accessToken !== accessToken) return session.accessToken || null;
    const next = await this.refresh(session);
    return next?.accessToken || null;
  },
  clear() {
    return SecureStore.deleteItemAsync(SESSION_KEY);
  },
};
