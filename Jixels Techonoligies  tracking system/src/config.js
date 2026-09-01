const apiUrl = process.env.EXPO_PUBLIC_JIXELS_API_URL?.trim().replace(/\/$/, "");
const explicitDemoMode = process.env.EXPO_PUBLIC_DEMO_MODE;

export const config = Object.freeze({
  apiUrl: apiUrl || null,
  demoMode: explicitDemoMode === "true",
  requestTimeoutMs: 15_000,
});

export function requireApiUrl() {
  if (!config.apiUrl) throw new Error("The Jixels backend is not configured.");
  if (!/^https:\/\//i.test(config.apiUrl) && !config.demoMode) {
    throw new Error("Production backend connections must use HTTPS.");
  }
  return config.apiUrl;
}
