import assert from "node:assert/strict";
import fs from "node:fs";

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const app = read("App.js");
const config = read("src/config.js");
const session = read("src/services/session.js");
const payments = read("src/services/payments.js");
const tracking = read("src/services/tracking.js");
const eas = JSON.parse(read("eas.json"));

assert.match(config, /\^https:/, "production transport must enforce HTTPS");
assert.equal(eas.build.production.env.EXPO_PUBLIC_DEMO_MODE, "false", "production must disable demo mode");
assert.match(session, /if \(!session\.expiresAt\) return false/, "stored sessions must expire");
assert.match(payments, /Idempotency-Key/, "M-Pesa requests require an idempotency key");
assert.match(payments, /stable payment idempotency key is required/, "M-Pesa must reject missing idempotency keys");
assert.match(tracking, /socket\.on\("connect".*tracker:subscribe/, "tracker subscription must be connection-scoped");
assert.match(app, /identifier: identity/, "OTP must be bound to a registered identifier");

const reportAction = app.match(/const action = \{[^;]+reportType: "payments"[^;]+\};/)?.[0] ?? "";
assert.ok(reportAction, "payment report request must exist");
assert.doesNotMatch(reportAction, /customerId|email:/, "report ownership must come from the access token");

console.log("PASS production HTTPS and demo-mode policy");
console.log("PASS expiring secure-session policy");
console.log("PASS OTP identity binding");
console.log("PASS M-Pesa idempotency contract");
console.log("PASS connection-scoped tracker subscription contract");
console.log("PASS token-derived report ownership contract");
