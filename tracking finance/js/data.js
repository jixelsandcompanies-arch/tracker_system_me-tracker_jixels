(function () {
  const SUPABASE_URL = "https://tpzebfvhvjsezynqgdns.supabase.co";
  const SUPABASE_KEY = "sb_publishable_IeSvEQI25WeymzwM-3j4VQ_a6a84vRO";
  const emptyData = { accounts: [], payments: [], agents: [], alerts: [], auditLogs: [], notifications: [], settings: { workspaceName: "Jixels Finance", timezone: "Africa/Nairobi", currency: "KES", commissionRate: "5", dailyCollectionTarget: "18500", overdueGraceDays: "3", exportRetentionDays: "90", sessionTimeoutMinutes: "30", notifyPayments: true, notifyReconciliation: true, notifyCommissions: true } };
  let memoryData = JSON.parse(JSON.stringify(emptyData)); let accessToken = null;
  const tables = { accounts: "finance_accounts", payments: "finance_payments", agents: "finance_agents", alerts: "finance_alerts", auditLogs: "finance_audit_logs" };
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
  function saveData(data) { memoryData = { ...emptyData, ...clone(data) }; if (!accessToken) return; const jobs = Object.entries(tables).flatMap(([key, table]) => (memoryData[key] || []).map(item => request(`/rest/v1/${table}?on_conflict=external_id`, { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ external_id: String(item.id || `${key}-${Date.now()}`), data: item, updated_at: new Date().toISOString() }) }))); jobs.push(request("/rest/v1/finance_settings?on_conflict=id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ id: "default", data: memoryData.settings, updated_at: new Date().toISOString() }) })); Promise.all(jobs).catch(error => window.dispatchEvent(new CustomEvent("finance-sync-error", { detail: error.message })));
  }
  async function hydrate(token) { accessToken = token; const rows = await Promise.all(Object.entries(tables).map(async ([key, table]) => [key, await request(`/rest/v1/${table}?select=external_id,data&order=updated_at.desc`)])); const settings = await request("/rest/v1/finance_settings?select=data&id=eq.default"); memoryData = { ...emptyData }; rows.forEach(([key, values]) => { memoryData[key] = (values || []).map(row => ({ ...(row.data || {}), id: row.data?.id || row.external_id })); }); if (settings?.[0]?.data) memoryData.settings = { ...emptyData.settings, ...settings[0].data }; return clone(memoryData); }
  async function financeProfile(userId, token) {
    const previous = accessToken; accessToken = token;
    try {
      const rows = await request(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=full_name,phone,role,account_status`);
      const profile = rows?.[0];
      if (!profile || !["finance", "finance_officer", "admin", "super_admin"].includes(profile.role) || !["active", "approved"].includes(profile.account_status)) throw new Error("Your account is not approved for the Finance portal. Please contact an administrator.");
      return profile;
    } finally { accessToken = previous; }
  }
  async function registerFinanceUser({ name, email, phone, password }) { const response = await fetch(`${SUPABASE_URL}/functions/v1/api/v1/finance/auth/register`, { method: "POST", headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ name, email, phone, password }) }); const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.message || "Finance registration could not be completed. Please try again."); return { pending: true, message: result.message || "Finance registration submitted for administrator approval." }; }
  async function authenticateFinanceUser(email, password) { const result = await request("/auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password }) }); if (!result?.access_token || !result?.user) throw new Error("Incorrect email or password. Please check your details and try again."); const profile = await financeProfile(result.user.id, result.access_token); await hydrate(result.access_token); return { id: result.user.id, name: profile.full_name || result.user.email.split("@")[0], email: result.user.email, phone: profile.phone || "", role: profile.role, accessToken: result.access_token }; }
  const money = value => new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(Number(value || 0));
  window.FinanceStore = { emptyData, readData, saveData, registerFinanceUser, authenticateFinanceUser, hydrate, money };
})();
