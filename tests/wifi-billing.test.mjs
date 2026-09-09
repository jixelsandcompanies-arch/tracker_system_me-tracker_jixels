import assert from "node:assert/strict";
import { paymentDecision, sessionExpiry, shouldExpire } from "../src/utils/wifiBilling.mjs";

assert.deepEqual(paymentDecision({ resultCode: 0, callbackAmount: 60, packageAmount: 60 }), { status: "completed", activate: true });
assert.deepEqual(paymentDecision({ resultCode: 1, callbackAmount: 60, packageAmount: 60 }), { status: "failed", activate: false });
assert.deepEqual(paymentDecision({ resultCode: 0, callbackAmount: 20, packageAmount: 60 }), { status: "failed", activate: false });
assert.deepEqual(paymentDecision({ resultCode: 0, callbackAmount: 60, packageAmount: 60, currentStatus: "completed" }), { status: "completed", activate: false });
const start = new Date("2026-09-09T08:00:00.000Z");
assert.equal(sessionExpiry(start, 90).toISOString(), "2026-09-09T09:30:00.000Z");
assert.equal(shouldExpire("active", "2026-09-09T09:00:00.000Z", "2026-09-09T09:00:00.000Z"), true);
assert.equal(shouldExpire("pending", "2026-09-09T09:00:00.000Z", "2026-09-09T10:00:00.000Z"), false);
console.log("PASS Wi-Fi payment, duplicate, expiry, and activation rules");
