export function paymentDecision({ resultCode, callbackAmount, packageAmount, currentStatus = "pending" }) {
  if (currentStatus !== "pending") return { status: currentStatus, activate: false };
  const paid = Number(resultCode) === 0 && Number(callbackAmount) === Number(packageAmount);
  return { status: paid ? "completed" : "failed", activate: paid };
}

export function sessionExpiry(start, durationMinutes) {
  const startTime = new Date(start);
  if (Number.isNaN(startTime.getTime()) || !Number.isInteger(Number(durationMinutes)) || Number(durationMinutes) <= 0) throw new Error("Invalid session duration");
  return new Date(startTime.getTime() + Number(durationMinutes) * 60_000);
}

export function shouldExpire(status, expiresAt, now = new Date()) {
  return status === "active" && new Date(expiresAt).getTime() <= new Date(now).getTime();
}
