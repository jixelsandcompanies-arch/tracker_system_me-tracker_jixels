import { config, requireApiUrl } from "../config";

export class ApiError extends Error {
  constructor(message, status = 0, code = null, details = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function apiRequest(path, { method = "GET", token, body, timeoutMs = config.requestTimeoutMs, signal, headers = {} } = {}) {
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
        "X-Client-Platform": "agent-mobile",
        ...headers
      },
      body: body == null ? undefined : JSON.stringify(body)
    });
    const contentType = response.headers.get("content-type") ?? "";
    let payload = null;
    if (response.status !== 204) {
      if (contentType.includes("application/json")) payload = await response.json().catch(() => null);
      else await response.text().catch(() => "");
    }
    if (!response.ok) throw new ApiError(payload?.message ?? "The request could not be completed.", response.status, payload?.code, payload?.details);
    return payload;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error?.name === "AbortError") throw new ApiError("The request timed out. Please try again.", 0, "TIMEOUT");
    throw new ApiError(error instanceof Error ? error.message : "The Jixels agent service could not be reached.", 0, "NETWORK_ERROR");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
