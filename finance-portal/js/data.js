/* Finance data is persisted in Supabase; memory is only the render cache. */
(function () {
  const SUPABASE_URL = "https://tpzebfvhvjsezynqgdns.supabase.co";
  const SUPABASE_KEY = "sb_publishable_IeSvEQI25WeymzwM-3j4VQ_a6a84vRO";
  const emptyData = {
    accounts: [],
    payments: [],
    auditLogs: [],
    alerts: [],
    notifications: [],
    settings: {
      workspaceName: "Jixels Finance",
      timezone: "Africa/Nairobi",
      currency: "KES",
      commissionRate: "5",
      dailyCollectionTarget: "18500",
      overdueGraceDays: "3",
      exportRetentionDays: "90",
      sessionTimeoutMinutes: "30",
      notifyPayments: true,
      notifyReconciliation: true,
      notifyCommissions: true
    },
    agents: []
  };
  let memoryData = { ...emptyData };
  let accessToken = null;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function readData() {
    return { ...emptyData, ...clone(memoryData) };
  }

  function saveData(data) {
    memoryData = { ...emptyData, ...clone(data) };
    if (accessToken) fetch(`${SUPABASE_URL}/rest/v1/finance_workspace_state?on_conflict=owner_id`, { method: "POST", headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ owner_id: JSON.parse(atob(accessToken.split('.')[1])).sub, state: memoryData, updated_at: new Date().toISOString() }) }).catch(() => {});
  }
  async function hydrate(token) {
    accessToken = token;
    const response = await fetch(`${SUPABASE_URL}/rest/v1/finance_workspace_state?select=state&limit=1`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error("Finance data could not be loaded.");
    const rows = await response.json();
    if (rows[0]?.state) memoryData = { ...emptyData, ...rows[0].state };
    return clone(memoryData);
  }

  async function registerFinanceUser({ name, email, phone, password }) {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/signup`, { method: "POST", headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ email, password, data: { full_name: name, phone, role: "finance_officer" } }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.user) throw new Error(result.msg || result.error_description || "Finance registration failed.");
    if (!result.access_token) throw new Error("Check your email to confirm the finance account before signing in.");
    await hydrate(result.access_token);
    return { id: result.user.id, name, email: result.user.email, phone, role: "Finance" };
  }

  async function authenticateFinanceUser(email, password) {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.access_token) throw new Error("The email or password is incorrect.");
    await hydrate(result.access_token);
    return { id: result.user.id, name: result.user.user_metadata?.full_name || result.user.email.split("@")[0], email: result.user.email, phone: result.user.user_metadata?.phone || "", role: result.user.user_metadata?.role || "Finance", accessToken: result.access_token };
  }

  function money(value) {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
      maximumFractionDigits: 0
    }).format(Number(value || 0));
  }

  window.FinanceStore = { emptyData, readData, saveData, registerFinanceUser, authenticateFinanceUser, hydrate, money };
})();
