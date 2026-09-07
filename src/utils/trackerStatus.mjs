const ONLINE_VALUES = new Set(["online", "active", "connected", "available", "1", "true"]);
const OFFLINE_VALUES = new Set(["offline", "inactive", "disconnected", "unavailable", "0", "false"]);

export function normalizeProviderTrackerStatus(record) {
  if (!record || typeof record !== "object") return null;
  const candidates = [record.isOnline, record.online, record.connected, record.connectionStatus, record.deviceStatus, record.trackerStatus, record.status];
  for (const value of candidates) {
    if (typeof value === "boolean") return value ? "online" : "offline";
    if (value == null) continue;
    const normalized = String(value).trim().toLowerCase();
    if (ONLINE_VALUES.has(normalized)) return "online";
    if (OFFLINE_VALUES.has(normalized)) return "offline";
  }
  return null;
}

// A device-provider connection state is authoritative; age its location only
// when the provider did not send a connectivity state.
export function trackerState({ providerStatus, recordedAt, now = Date.now(), staleMs = 2 * 60_000, offlineMs = 10 * 60_000 } = {}) {
  if (providerStatus === "online" || providerStatus === "offline") return providerStatus;
  const timestamp = new Date(recordedAt).getTime();
  if (!Number.isFinite(timestamp)) return "offline";
  const age = Math.max(0, now - timestamp);
  return age > offlineMs ? "offline" : age > staleMs ? "stale" : "online";
}
