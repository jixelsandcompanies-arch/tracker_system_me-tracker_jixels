import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const agentApp = readFileSync(new URL("../Jixels angets/App.js", import.meta.url), "utf8");
const api = readFileSync(new URL("../supabase/functions/api/index.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/202610240001_customer_due_dates.sql", import.meta.url), "utf8");
const finance = readFileSync(new URL("../finance-portal/js/data.js", import.meta.url), "utf8");
const financeApp = readFileSync(new URL("../finance-portal/js/app.js", import.meta.url), "utf8");

assert.doesNotMatch(agentApp, /First installment due date/);
assert.doesNotMatch(agentApp, /dueDate: form\.dueDate/);
assert.doesNotMatch(agentApp, /depositAmount: Number\(depositAmount \|\| 0\), dueDate/);
assert.doesNotMatch(agentApp, /First installment due \{customer\.dueDate\}/);
assert.match(api, /due_date: dueDate \|\| null/);
assert.equal((api.match(/if \(dueDate &&/g) || []).length, 2);
assert.match(api, /dueDate: item\.due_date \?\? null/);
assert.match(api, /INVALID_DUE_DATE/);
assert.match(migration, /add column if not exists due_date date/);
assert.match(migration, /due_at_value/);
assert.match(migration, /'dueAt', due_at_value/);
assert.match(finance, /row\.due_at \|\| row\.data\?\.dueAt/);
assert.match(finance, /customers\?select=id,full_name,email,phone,plate_number,tracker_number,status,created_at/);
assert.match(financeApp, /\.sort\(newestPaymentFirst\)/);
assert.match(financeApp, /const newestPaymentFirst = \(left, right\) => \{[\s\S]*paymentDate\(left\)[\s\S]*paymentDate\(right\)/);

console.log("Customer due-date onboarding and Finance synchronization checks passed.");
