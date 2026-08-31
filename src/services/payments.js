import { apiRequest } from "./api";

export function newIdempotencyKey(vehicleId) {
  return `${vehicleId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export const paymentsApi = {
  requestMpesa(token, { vehicleId, amount, phone, idempotencyKey }) {
    if (!idempotencyKey) return Promise.reject(new Error("A stable payment idempotency key is required."));
    return apiRequest("/v1/customer/payments/mpesa", {
      method: "POST",
      token,
      body: { vehicleId, amount, phone },
      headers: { "Idempotency-Key": idempotencyKey },
      timeoutMs: 30_000,
    });
  },
};
