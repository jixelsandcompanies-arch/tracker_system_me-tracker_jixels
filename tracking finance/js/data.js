/* Data access is isolated here so a real API can replace the in-memory store. */
(function () {
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
  let memoryUsers = [];

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function readData() {
    return { ...emptyData, ...clone(memoryData) };
  }

  function saveData(data) {
    memoryData = { ...emptyData, ...clone(data) };
  }

  function readUsers() {
    return clone(memoryUsers);
  }

  function saveUsers(users) {
    memoryUsers = clone(users);
  }

  function randomSalt() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  }

  async function passwordHash(password, salt) {
    if (!crypto?.subtle) throw new Error("Secure password storage requires a modern browser.");
    const payload = new TextEncoder().encode(`${salt}:${password}`);
    const digest = await crypto.subtle.digest("SHA-256", payload);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  }

  async function registerFinanceUser({ name, email, phone, password }) {
    const users = readUsers();
    if (users.some(user => user.email === email)) throw new Error("A finance user with this email already exists.");
    const salt = randomSalt();
    const user = {
      id: `FIN-${Date.now()}`,
      name,
      email,
      phone,
      role: "Finance",
      status: "active",
      salt,
      passwordHash: await passwordHash(password, salt),
      createdAt: new Date().toISOString()
    };
    users.unshift(user);
    saveUsers(users);
    return { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role };
  }

  async function authenticateFinanceUser(email, password) {
    const user = readUsers().find(item => item.email === email);
    if (!user) throw new Error("No registered finance user was found for this email.");
    if (user.status !== "active") throw new Error("This finance user is not active.");
    const candidate = await passwordHash(password, user.salt);
    if (candidate !== user.passwordHash) throw new Error("The email or password is incorrect.");
    return { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role };
  }

  function money(value) {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
      maximumFractionDigits: 0
    }).format(Number(value || 0));
  }

  window.FinanceStore = { emptyData, readData, saveData, registerFinanceUser, authenticateFinanceUser, money };
})();
