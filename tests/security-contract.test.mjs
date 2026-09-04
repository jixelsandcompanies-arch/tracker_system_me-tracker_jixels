import assert from "node:assert/strict";
import fs from "node:fs";

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const app = read("App.js");
const config = read("src/config.js");
const session = read("src/services/session.js");
const payments = read("src/services/payments.js");
const tracking = read("src/services/tracking.js");
const apiFunction = read("supabase/functions/api/index.ts");
const agentAuth = read("Jixels angets/src/services/auth.js");
const agentEas = JSON.parse(read("Jixels angets/eas.json"));
const eas = JSON.parse(read("eas.json"));

assert.match(config, /\^https:/, "production transport must enforce HTTPS");
assert.equal(eas.build.production.env.EXPO_PUBLIC_DEMO_MODE, "false", "production must disable demo mode");
assert.equal(eas.build.production.env.EXPO_PUBLIC_JIXELS_API_URL, "https://tpzebfvhvjsezynqgdns.supabase.co/functions/v1/api", "customer production builds must point to the shared backend");
assert.equal(agentEas.build.production.env.EXPO_PUBLIC_JIXELS_AGENT_API_URL, "https://tpzebfvhvjsezynqgdns.supabase.co/functions/v1/api", "agent production builds must point to the shared backend");
assert.match(session, /if \(!session\.expiresAt\) return false/, "stored sessions must expire");
assert.match(payments, /Idempotency-Key/, "M-Pesa requests require an idempotency key");
assert.match(payments, /stable payment idempotency key is required/, "M-Pesa must reject missing idempotency keys");
assert.match(tracking, /socket\.on\("connect".*tracker:subscribe/, "tracker subscription must be connection-scoped");
assert.match(app, /identifier: identity/, "OTP must be bound to a registered identifier");

const reportAction = app.match(/const action = \{[^;]+reportType: "payments"[^;]+\};/)?.[0] ?? "";
assert.ok(reportAction, "payment report request must exist");
assert.doesNotMatch(reportAction, /customerId|email:/, "report ownership must come from the access token");

const agentRegisterIndex = apiFunction.indexOf('route === "/v1/agent/auth/register"');
const agentResetIndex = apiFunction.indexOf('route === "/v1/agent/auth/request-password-reset"');
const authGateIndex = apiFunction.indexOf("const { data: identity } = await client.auth.getUser()");
assert.ok(agentRegisterIndex > 0 && agentRegisterIndex < authGateIndex, "agent registration must remain public before the auth gate");
assert.ok(agentResetIndex > 0 && agentResetIndex < authGateIndex, "agent password reset must remain public before the auth gate");
assert.match(apiFunction, /route === "\/v1\/auth\/account-status"/, "customer account status polling route must exist");
assert.match(apiFunction, /resetPasswordForEmail/, "password reset must use Supabase Auth");
assert.match(agentAuth, /\/v1\/agent\/auth\/login/, "agent app login must use the shared agent auth route");
assert.match(agentAuth, /\/v1\/agent\/auth\/register/, "agent app registration must use the shared agent auth route");

console.log("PASS production HTTPS and demo-mode policy");
console.log("PASS shared backend release URL policy");
console.log("PASS expiring secure-session policy");
console.log("PASS OTP identity binding");
console.log("PASS M-Pesa idempotency contract");
console.log("PASS connection-scoped tracker subscription contract");
console.log("PASS token-derived report ownership contract");
console.log("PASS public agent auth route contract");
