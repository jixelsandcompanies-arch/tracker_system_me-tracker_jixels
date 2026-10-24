import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const agentApp = readFileSync(new URL("../Jixels angets/App.js", import.meta.url), "utf8");
const api = readFileSync(new URL("../supabase/functions/api/index.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/202610240001_customer_due_dates.sql", import.meta.url), "utf8");
const finance = readFileSync(new URL("../finance-portal/js/data.js", import.meta.url), "utf8");

assert.match(agentApp, /First installment due date \(required\)/);
assert.match(agentApp, /dueDate: form\.dueDate/);
assert.match(agentApp, /depositAmount: Number\(depositAmount \|\| 0\), dueDate/);
assert.match(agentApp, /First installment due \{customer\.dueDate\}/);
assert.match(api, /due_date: dueDate/);
assert.match(api, /dueDate: item\.due_date \?\? null/);
assert.match(api, /INVALID_DUE_DATE/);
assert.match(migration, /add column if not exists due_date date/);
assert.match(migration, /due_at_value/);
assert.match(migration, /'dueAt', due_at_value/);
assert.match(finance, /row\.due_at \|\| row\.data\?\.dueAt/);

console.log("Customer due-date onboarding and Finance synchronization checks passed.");
