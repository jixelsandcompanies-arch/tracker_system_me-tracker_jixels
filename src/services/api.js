import { config, requireApiUrl } from "../config";
import { sessionStore } from "./session";

export class ApiError extends Error {
  constructor(message, status = 0, code = null, details = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function apiRequest(path, { method = "GET", token, body, timeoutMs = config.requestTimeoutMs, signal, headers = {}, retryAuth = true } = {}) {
  if (!path.startsWith("/")) throw new ApiError("Invalid API path.", 0, "INVALID_PATH");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(`${requireApiUrl()}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(body == null ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "X-Client-Platform": "mobile",
        ...headers,
      },
      body: body == null ? undefined : JSON.stringify(body),
    });
    const contentType = response.headers.get("content-type") ?? "";
    let payload = null;
    if (response.status !== 204) {
      if (contentType.includes("application/json")) payload = await response.json().catch(() => null);
      else await response.text().catch(() => "");
    }
    if (!response.ok && response.status === 401 && token && retryAuth) {
      const refreshedToken = await sessionStore.refreshForToken(token).catch(() => null);
      if (refreshedToken && refreshedToken !== token) return apiRequest(path, { method, token: refreshedToken, body, timeoutMs, signal, headers, retryAuth: false });
    }
    if (!response.ok) throw new ApiError(payload?.message ?? "The request could not be completed.", response.status, payload?.code, payload?.details);
    return payload;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error?.name === "AbortError") throw new ApiError("The request timed out. Please try again.", 0, "TIMEOUT");
    throw new ApiError("The Jixels service could not be reached.", 0, "NETWORK_ERROR");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
