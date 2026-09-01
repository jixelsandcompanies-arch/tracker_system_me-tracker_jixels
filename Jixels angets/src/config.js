const apiUrl = process.env.EXPO_PUBLIC_JIXELS_AGENT_API_URL?.trim().replace(/\/$/, "")
  || process.env.EXPO_PUBLIC_JIXELS_API_URL?.trim().replace(/\/$/, "");

export const config = Object.freeze({
  apiUrl: apiUrl || null,
  requestTimeoutMs: 15_000
});

export function requireApiUrl() {
  if (!config.apiUrl) throw new Error("The Jixels agent backend is not configured.");
  if (!/^https:\/\//i.test(config.apiUrl)) throw new Error("Production backend connections must use HTTPS.");
  return config.apiUrl;
}
