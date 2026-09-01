let activeSession = null;

function isUsableSession(session) {
  if (!session?.accessToken || !session?.user) return false;
  if (!session.expiresAt) return false;
  const expiresAt = typeof session.expiresAt === "number" ? session.expiresAt : Date.parse(session.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > Date.now() + 30_000;
}

export const sessionStore = {
  async get() {
    return isUsableSession(activeSession) ? activeSession : null;
  },
  async set(session) {
    if (!isUsableSession(session)) throw new Error("Refusing to keep an invalid or expired session.");
    activeSession = session;
  },
  async clear() {
    activeSession = null;
  },
};
