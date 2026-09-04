const apiUrl = process.env.EXPO_PUBLIC_JIXELS_API_URL?.trim().replace(/\/$/, "")
  || "https://tpzebfvhvjsezynqgdns.supabase.co/functions/v1/api";
const explicitDemoMode = process.env.EXPO_PUBLIC_DEMO_MODE;

export const config = Object.freeze({
  apiUrl: apiUrl || null,
  // Database-backed behavior is the default in every environment. Demo data is
  // available only through an explicit local-development opt-in.
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
