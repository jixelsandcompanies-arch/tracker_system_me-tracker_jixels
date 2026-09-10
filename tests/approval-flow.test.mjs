import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const source = fs.readFileSync(new URL("../supabase/functions/api/index.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("api.ts", source, ts.ScriptTarget.Latest, true);
const functions = ["existingCustomerRecord", "registerPortalUser", "portalSignIn", "accountStatus"];
const code = ts.transpileModule(ast.statements.filter(node => ts.isFunctionDeclaration(node) && functions.includes(node.name?.text)).map(node => node.getText(ast)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture({ customer = null, profile = null, lookupError = null, passwordValid = true, usedAt = null } = {}) {
  const calls = [];
  const admin = {
    from(table) {
      const query = { operation: "read" };
      const chain = {
        select() { return chain; }, eq() { return chain; }, ilike(column, pattern) { calls.push(["pattern", pattern]); return chain; }, limit() { return chain; },
        upsert(record) { query.operation = "upsert"; calls.push(["upsert", table, record]); return chain; },
        then(resolve) { return Promise.resolve({ error: null }).then(resolve); },
        async maybeSingle() {
          if (table === "customers") return { data: customer, error: lookupError };
          if (table === "profiles") return { data: profile, error: null };
          if (table === "customer_approval_codes") return { data: { used_at: usedAt }, error: null };
          throw new Error(`Unexpected table ${table}`);
        },
      };
      return chain;
    },
    rpc: async () => ({ error: null }),
    auth: { admin: { deleteUser: async () => ({ error: null }) } },
  };
  const client = { auth: {
    signUp: async () => { calls.push(["signup"]); return { data: { user: { id: "new-user", identities: [{}] } }, error: null }; },
    signInWithPassword: async () => { calls.push(["password-check"]); return passwordValid ? { data: { session: { access_token: "session", refresh_token: "refresh", expires_at: 2000000000 }, user: { id: "customer-id", email: "known@example.com" } }, error: null } : { data: {}, error: new Error("Invalid credentials") }; },
  } };
  const deps = {
    response: (body, status = 200) => ({ body, status }),
    fail: (message, status = 400, code, details) => ({ status, body: { message, code, details } }),
    approvedStatuses: new Set(["active", "approved"]), agentRoles: new Set(["agent"]),
    loginAttemptKey: async email => email, getLoginLock: async () => ({}), recordLoginFailure: async () => ({}), LOGIN_LOCK_MESSAGE: "locked",
    saveCustomerPushToken: async () => { calls.push(["save-token"]); return { registered: false }; },
    issueCustomerApprovalCode: async () => { calls.push(["issue-code"]); return { issued: true, code: "123456", pushSent: false }; },
  };
  const api = new Function(...Object.keys(deps), code + ";return {registerPortalUser, portalSignIn, accountStatus};")(...Object.values(deps));
  return { api, admin, client, calls };
}
const body = { name: "Customer", email: " KNOWN@example.com ", phone: "0700000000", password: "ValidPassword!1" };
for (const [options, expected] of [[{}, "CUSTOMER_DETAILS_NOT_FOUND"], [{ lookupError: new Error("offline") }, "CUSTOMER_LOOKUP_UNAVAILABLE"], [{ customer: { id: "known", status: "rejected" } }, "ACCOUNT_INACTIVE"]]) {
  const f = fixture(options);
  const result = await f.api.registerPortalUser(f.client, f.admin, body, "customer");
  assert.equal(result.body.code, expected);
  assert.equal(f.calls.some(call => ["signup", "upsert", "save-token"].includes(call[0])), false, "rejected registrations must have no side effects");
}
{
  const f = fixture({ customer: { id: "existing-directory-customer", status: "active" } });
  const result = await f.api.registerPortalUser(f.client, f.admin, body, "customer");
  assert.equal(result.status, 201);
  assert.equal(result.body.status, "pending");
  assert.equal(f.calls.filter(call => call[0] === "signup").length, 1);
  assert.equal(f.calls.some(call => call[0] === "upsert" && call[1] === "customers"), false, "registration must not duplicate directory customers");
  assert.equal(f.calls.find(call => call[0] === "upsert")[2].account_status, "pending");
  assert.ok(f.calls.some(call => call[0] === "pattern" && call[1] === "known@example.com"));
}
const approved = { role: "customer", account_status: "approved", email: "known@example.com" };
{
  const f = fixture({ customer: { id: "known", status: "active" }, profile: approved, passwordValid: false });
  const result = await f.api.registerPortalUser(f.client, f.admin, body, "customer");
  assert.equal(result.body.code, "INVALID_CREDENTIALS");
  assert.equal(f.calls.some(call => ["signup", "save-token", "issue-code"].includes(call[0])), false, "an email alone cannot replace push tokens or retrieve an OTP");
}
for (const [profile, usedAt, expected] of [[approved, null, "CUSTOMER_OTP_REQUIRED"], [{ ...approved, account_status: "pending" }, null, "ACCOUNT_PENDING_APPROVAL"], [{ ...approved, account_status: "rejected" }, null, "ACCOUNT_INACTIVE"], [approved, "2026-09-10", undefined]]) {
  const f = fixture({ profile, usedAt });
  const result = await f.api.portalSignIn(f.client, f.admin, body, new Set(["customer"]));
  assert.equal(result.body.code, expected);
  if (expected === "CUSTOMER_OTP_REQUIRED") {
    assert.equal(result.body.details.otpCode, "123456", "OTP must be visible even if push delivery fails");
    assert.match(result.body.message, /123456.*Do not share or expose/);
    assert.equal(result.body.accessToken, undefined, "OTP is required before a session is returned");
  } else assert.equal(f.calls.some(call => call[0] === "issue-code"), false);
}
{
  const f = fixture({ profile: approved });
  const result = await f.api.accountStatus(f.admin, new URL("https://example.com?email=known@example.com"));
  assert.equal(result.body.approved, true);
  assert.equal(result.body.otpCode, undefined, "public email lookup must never expose an OTP");
  assert.equal(f.calls.some(call => call[0] === "issue-code"), false);
}
console.log("PASS approval registration eligibility, duplicate protection, password binding, push fallback, pending/rejected/verified login, and public OTP privacy");
