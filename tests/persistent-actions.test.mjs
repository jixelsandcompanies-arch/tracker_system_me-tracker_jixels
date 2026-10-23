import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../supabase/migrations/202610230002_persistent_customer_and_agent_actions.sql");
const api = read("../supabase/functions/api/index.ts");
const customer = read("../App.js");
const agent = read("../Jixels angets/App.js");
const customerApp = read("../App.js");

assert.match(migration, /tracker_installed_at/);
assert.match(migration, /agent_alert_states/);
assert.match(migration, /customer_payment_dismissals/);
assert.match(api, /\/v1\/agent\/alerts/);
assert.match(api, /installationMatch = route\.match/);
assert.match(api, /item\.payment_phone \?\? processing\?\.payer_phone/);
assert.match(api, /\/v1\/customer\/payments" && request\.method === "DELETE"/);
assert.match(customer, /customerApi\.markAlertsRead\(session\.accessToken, ids\)/);
assert.match(customer, /customerApi\.deleteAlerts\(session\.accessToken, ids\)/);
assert.match(customer, /customerApi\.dismissPayments\(session\.accessToken, ids\)/);
assert.match(agent, /authApi\.updateInstallation\(agent\.accessToken, id, true\)/);
assert.match(agent, /authApi\.updateAlertStates\(agent\.accessToken, ids, action\)/);
assert.match(agent, /\}, \[visible, customer\?\.id\]\)/);
assert.match(api, /replayed: true/);
assert.match(api, /DEPOSIT_PROMPT_PENDING/);
assert.match(api, /PAYMENT_ALREADY_PROCESSING/);
assert.match(api, /IDEMPOTENCY_KEY_REUSED/);
assert.match(api, /idempotency_key: idempotencyKey/);
assert.match(customerApp, /Payment request already in progress/);

console.log("Customer and agent persistence regression checks passed.");
