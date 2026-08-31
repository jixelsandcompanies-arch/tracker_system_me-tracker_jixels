import * as SecureStore from "expo-secure-store";

const SESSION_KEY = "jixels.customer.session.v1";

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
    try {
      const session = JSON.parse(value);
      if (isUsableSession(session)) return session;
      await SecureStore.deleteItemAsync(SESSION_KEY);
      return null;
    } catch {
      await SecureStore.deleteItemAsync(SESSION_KEY);
      return null;
    }
  },
  set(session) {
    if (!isUsableSession(session)) return Promise.reject(new Error("Refusing to store an invalid or expired session."));
    return SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  },
  clear() {
    return SecureStore.deleteItemAsync(SESSION_KEY);
  },
};
