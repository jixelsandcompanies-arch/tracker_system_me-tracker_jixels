(function () {
  const SUPABASE_URL = "https://tpzebfvhvjsezynqgdns.supabase.co";
  const SUPABASE_KEY = "sb_publishable_IeSvEQI25WeymzwM-3j4VQ_a6a84vRO";
  const emptyData = { accounts: [], payments: [], agents: [], customers: [], staff: [], alerts: [], auditLogs: [], notifications: [], settings: { workspaceName: "Jixels Finance", timezone: "Africa/Nairobi", currency: "KES", commissionRate: "5", dailyCollectionTarget: "18500", overdueGraceDays: "3", exportRetentionDays: "90", sessionTimeoutMinutes: "30", notifyPayments: true, notifyReconciliation: true, notifyCommissions: true } };
  let memoryData = JSON.parse(JSON.stringify(emptyData)); let accessToken = null;
  const tables = { accounts: "finance_accounts", payments: "finance_payments", agents: "finance_agents", alerts: "finance_alerts", auditLogs: "finance_audit_logs" };
  const dashboardTables = { accounts: tables.accounts, payments: tables.payments };
  const supplementalTables = { agents: tables.agents, alerts: tables.alerts, auditLogs: tables.auditLogs };
  const clone = value => JSON.parse(JSON.stringify(value));
  function readData() { return { ...emptyData, ...clone(memoryData) }; }
  function safeError(status) {
    if (status === 401) return "Incorrect email or password. Please check your details and try again.";
    if (status === 403) return "You don't have permission to access the Finance portal.";
    if (status === 429) return "Too many requests. Please wait and try again.";
    if (status >= 500 || status === 0) return "We're experiencing a temporary system problem. Please try again later.";
    return "The request could not be completed. Please try again.";
  }
  async function request(path, options = {}) {
    let response;
    try { response = await fetch(`${SUPABASE_URL}${path}`, { ...options, headers: { apikey: SUPABASE_KEY, ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) } }); }
    catch (error) { console.error("Finance network request failed", path, error); throw new Error("Unable to connect to the server. Check your internet connection and try again."); }
    if (!response.ok) { console.error("Finance API request failed", path, response.status, await response.text().catch(() => "")); throw new Error(safeError(response.status)); }
    return response.status === 204 ? null : response.json();
  }
  function saveData(data) {
    const previousData = memoryData;
    const nextData = { ...emptyData, ...clone(data) };
    memoryData = nextData;
    if (!accessToken) return Promise.resolve();
    const jobs = Object.entries(tables).flatMap(([key, table]) => {
      const previousRows = new Map((previousData[key] || []).map(item => [String(item.id), item]));
      const nextRows = new Map((nextData[key] || []).map(item => [String(item.id), item]));
      const writes = [...nextRows.entries()].flatMap(([externalId, item]) => {
        if (JSON.stringify(previousRows.get(externalId)) === JSON.stringify(item)) return [];
        const customer = key === "accounts" ? nextData.customers.find(candidate => candidate.id === item.customerId || (candidate.full_name === item.customer && candidate.phone === item.phone)) : null;
        const record = { external_id: externalId, data: item, updated_at: new Date().toISOString() };
        if (key === "accounts") Object.assign(record, { customer_id: customer?.id || item.customerId || null, outstanding: Math.max(0, Number(item.balance || 0)), status: item.status || "active" });
        return [request(`/rest/v1/${table}?on_conflict=external_id`, { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify(record) })];
      });
      const deletes = [...previousRows.keys()].filter(externalId => !nextRows.has(externalId)).map(externalId => request(`/rest/v1/${table}?external_id=eq.${encodeURIComponent(externalId)}`, { method: "DELETE" }));
      return [...writes, ...deletes];
    });
    if (JSON.stringify(previousData.settings) !== JSON.stringify(nextData.settings)) jobs.push(request("/rest/v1/finance_settings?on_conflict=id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ id: "default", data: nextData.settings, updated_at: new Date().toISOString() }) }));
    return Promise.all(jobs).catch(error => { window.dispatchEvent(new CustomEvent("finance-sync-error", { detail: error.message })); return null; });
  }
  async function loadStoredTables(tableMap) {
    return Promise.all(Object.entries(tableMap).map(async ([key, table]) => [key, await request(`/rest/v1/${table}?select=external_id,data&order=updated_at.desc`)]));
  }
  function applyStoredTables(rows) {
    rows.forEach(([key, values]) => { memoryData[key] = (values || []).map(row => ({ ...(row.data || {}), id: row.data?.id || row.external_id })); });
  }
  async function hydrate(token) {
    accessToken = token;
    const [rows, settings] = await Promise.all([
      loadStoredTables(dashboardTables),
      request("/rest/v1/finance_settings?select=data&id=eq.default")
    ]);
    memoryData = clone(emptyData);
    applyStoredTables(rows);
    if (settings?.[0]?.data) memoryData.settings = { ...emptyData.settings, ...settings[0].data };
    return clone(memoryData);
  }
  async function hydrateSupplementary() {
    const [rows, customers, staff] = await Promise.all([
      loadStoredTables(supplementalTables),
      request("/rest/v1/customers?select=id,full_name,email,phone,status,created_at&order=created_at.desc"),
      request("/rest/v1/profiles?select=id,full_name,email,phone,role,account_status&role=in.(agent,support_agent,finance,finance_officer,admin,super_admin)&order=full_name.asc")
    ]);
    const nonCustomerAccountIds = new Set((staff || []).filter(profile => profile.role !== "customer").map(profile => profile.id));
    memoryData = { ...memoryData, customers: (customers || []).filter(customer => !nonCustomerAccountIds.has(customer.id)), staff: staff || [] };
    applyStoredTables(rows);
    return clone(memoryData);
  }
  async function financeProfile(userId, token) {
    const previous = accessToken; accessToken = token;
    try {
      const rows = await request(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=full_name,phone,role,account_status`);
      const profile = rows?.[0];
      if (!profile || !["finance", "finance_officer", "admin", "super_admin"].includes(profile.role) || !["active", "approved"].includes(profile.account_status)) throw new Error("Your account is not approved for the Finance portal. Please contact an administrator.");
      return profile;
    } finally { accessToken = previous; }
  }
  function portalError(result, fallback) { const error = new Error(result.message || fallback); error.code = result.code; return error; }
  async function registerFinanceUser({ name, email, phone, password }) { const response = await fetch(`${SUPABASE_URL}/functions/v1/api/v1/finance/auth/register`, { method: "POST", headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ name, email, phone, password }) }); const result = await response.json().catch(() => ({})); if (!response.ok) throw portalError(result, "Finance registration could not be completed. Please try again."); return { pending: true, message: result.message || "Registration details submitted successfully. Please wait for administrator approval before signing in." }; }
  async function financeAccountStatus(email) {
    let response;
    try { response = await fetch(`${SUPABASE_URL}/functions/v1/api/v1/finance/auth/account-status?email=${encodeURIComponent(email)}`, { headers: { apikey: SUPABASE_KEY } }); }
    catch (error) { console.error("Finance account lookup failed", error); throw new Error("Unable to connect to the server. Check your internet connection and try again."); }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw portalError(result, "We could not check the Finance account.");
    return result;
  }
  async function authenticateFinanceUser(email, password) {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/api/v1/finance/auth/login`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.accessToken || !result.user) throw portalError(result, "Incorrect email or password. Please check your details and try again.");
    return { id: result.user.id, name: result.user.name || result.user.email.split("@")[0], email: result.user.email, phone: result.user.phone || "", role: result.user.role, accessToken: result.accessToken };
  }
  const money = value => new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(Number(value || 0));
  window.FinanceStore = { emptyData, readData, saveData, registerFinanceUser, financeAccountStatus, authenticateFinanceUser, hydrate, hydrateSupplementary, money };
})();
