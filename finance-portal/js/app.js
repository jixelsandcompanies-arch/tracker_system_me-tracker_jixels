/* Finance portal shell: no React, Babel, or CDN dependency required. */
(function () {
  const showFatalError = error => {
    console.error("Finance portal runtime error", error);
    const target = document.getElementById("root");
    if (!target) return;
    target.innerHTML = '<main class="login-screen"><section class="login-shell"><div class="login-form-panel"><div class="login-card"><div class="login-form-mark">!</div><div class="eyebrow">FINANCE WORKSPACE</div><h2>Something went wrong</h2><p>We could not open the Finance portal. Please refresh and try again.</p><button class="button button-primary login-button" type="button" onclick="window.location.reload()">Try again</button></div></div></section></main>';
  };
  window.addEventListener("error", event => showFatalError(event.error || event.message));
  window.addEventListener("unhandledrejection", event => showFatalError(event.reason));
  try {
  const { readData, saveData, registerFinanceUser, financeAccountStatus, authenticateFinanceUser, hydrate, refreshLive, hydrateSupplementary, money } = window.FinanceStore;

  let approvalCheckBusy = false;
  async function checkPendingApproval() {
    const email = localStorage.getItem("jixels.finance.pending-email");
    if (!email || approvalCheckBusy) return;
    approvalCheckBusy = true;
    try {
      const account = await window.FinanceStore.approvalAccountStatus(email);
      if (!["finance", "finance_officer", "admin", "super_admin"].includes(account.role)) return;
      if (account.approved || ["rejected", "suspended"].includes(account.status)) {
        localStorage.removeItem("jixels.finance.pending-email");
        window.alert(account.approved ? "Your account has been approved. You can now log in." : "Your account has not been approved. Contact Jixels support.");
        if (!session) { authMode = "login"; root.innerHTML = loginView(account.approved ? "Your account has been approved. You can now log in." : "Account not approved."); bindLoginEvents(); }
      }
    } catch { /* Retry when the connection returns. */ }
    finally { approvalCheckBusy = false; }
  }
  window.setInterval(checkPendingApproval, 10_000);
  window.addEventListener("focus", checkPendingApproval);
  window.setTimeout(checkPendingApproval, 0);
  const root = document.getElementById("root");
  let data = readData();
  let page = "dashboard";
  let authMode = "login";
  let authDraft = { name: "", phone: "", email: "", password: "", confirm: "" };
  let sidebarOpen = false;
  let sidebarCollapsed = false;
  let loading = false;
  let loadingMode = "launch";
  let online = navigator.onLine;
  let session = null;
  let commissionDialog = null;
  let liveRefreshTimer = null;
  let notificationsOpen = false;

  const icon = paths => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths}</svg>`;
  const icons = {
    menu: icon('<path d="M4 7h16M4 12h16M4 17h16"/>'),
    dashboard: icon('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
    accounts: icon('<circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 6h5M18.5 3.5v5"/>'),
    commissions: icon('<circle cx="12" cy="12" r="8"/><path d="M12 7v10M9.5 9.5c.6-1 3.9-1.1 4.7.3.7 1.2-.1 2.1-2.2 2.4-2.3.4-3.1 1.2-2.4 2.5.8 1.5 4.3 1.3 5-.1"/>'),
    payments: icon('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3"/>'),
    overdue: icon('<path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v4M12 17h.01"/>'),
    reconciliation: icon('<path d="M20 7h-5V2M4 17h5v5M19 12a7 7 0 0 0-12-5l-2 2M5 12a7 7 0 0 0 12 5l2-2"/>'),
    reports: icon('<path d="M5 21V10M12 21V3M19 21v-7"/>'),
    alerts: icon('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>'),
    settings: icon('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>'),
    eye: icon('<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="3"/>'),
    audit: icon('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    logout: icon('<path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9"/>'),
    launchCar: icon('<path d="M4 16h16l-1.8-5.4A2 2 0 0 0 16.3 9H7.7a2 2 0 0 0-1.9 1.6L4 16Z"/><path d="M3 16h18v3H3zM7 19v2M17 19v2M7.5 13h.01M16.5 13h.01"/>'),
    launchBike: icon('<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M6 17l4-8h3l2 8M10 9l-2-3h3M13 9l3-2M10 17h6"/>'),
    launchTuktuk: icon('<path d="M5 18V9l4-4h6l4 4v9H5Z"/><path d="M9 18V11h6v7M5 14h14M7 18v2M17 18v2M7 10h2M15 10h2"/>')
  };
  const navigation = [
    ["dashboard", icons.dashboard, "Dashboard"], ["customers", icons.accounts, "Customers"], ["accounts", icons.accounts, "Accounts"], ["commissions", icons.commissions, "Commissions"],
    ["payments", icons.payments, "Payments"], ["overdue", icons.overdue, "Overdue"],
    ["reconciliation", icons.reconciliation, "Reconciliation"], ["reports", icons.reports, "Reports"],
    ["alerts", icons.alerts, "Alerts"], ["settings", icons.settings, "Settings"], ["audit", icons.audit, "Audit Logs"]
  ];

  const escapeHtml = value => String(value || "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  const status = value => `<span class="status ${String(value).toLowerCase().replace(" ", "-")}">${escapeHtml(value)}</span>`;
  const empty = (title, text) => `<div class="empty"><span class="empty-icon">◌</span><strong>${title}</strong><span>${text}</span></div>`;
  const metric = (label, value, note, tone = "blue") => `<article class="metric metric-${tone}"><div class="metric-label">${label}</div><div class="metric-value">${value}</div><div class="metric-note">${note}</div></article>`;
  const rowCheck = (scope, id) => `<label class="row-select"><input type="checkbox" data-select-row="${scope}" value="${escapeHtml(id)}"><span></span></label>`;
  const selectAll = scope => `<label class="row-select row-select-all"><input type="checkbox" data-select-all="${scope}"><span></span></label>`;
  const bulkActions = scope => `<div class="bulk-actions"><button class="button button-secondary" type="button" data-delete-selected="${scope}">Delete selected</button><button class="button danger-button" type="button" data-delete-all="${scope}">Delete all</button></div>`;
  const passwordInput = (name, autocomplete, placeholder, value = "") => `<span class="password-field"><input name="${name}" type="password" value="${escapeHtml(value)}" placeholder="${placeholder}" autocomplete="${autocomplete}" required><button type="button" class="password-toggle" data-toggle-password aria-label="Show password">${icons.eye}</button></span>`;
  const isValidEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  const isStrongPassword = value => /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value) && !/\s/.test(value) && value.length >= 8;
  const safeLoginMessage = error => {
    const message = String(error?.message || "");
    console.error("Finance authentication failed", error);
    if (error?.code === "ACCOUNT_NOT_FOUND" || /finance account not found/i.test(message)) return "Finance account not found. Please register a Finance account before signing in.";
    if (/invalid[_ ]credentials|invalid login|incorrect email|password/i.test(message)) return "Incorrect email or password. Please check your details and try again.";
    if (/account[_ ]locked|temporarily locked/i.test(message)) return "Your account has been temporarily locked because of too many failed login attempts. Please contact an administrator or use account recovery.";
    if (/permission|not approved|not authorized|awaiting administrator approval|account is not active/i.test(message)) {
      if (/awaiting administrator approval|not approved/i.test(message)) return "Your Finance registration is waiting for administrator approval. You can sign in after the account is approved.";
      return message || "Your account is not approved for the Finance portal. Please contact an administrator.";
    }
    if (/network|fetch|offline|connect/i.test(message)) return "Unable to connect to the server. Check your internet connection and try again.";
    return "We could not complete sign-in. Please try again or contact an administrator.";
  };
  const safeRegistrationMessage = error => {
    const message = String(error?.message || "");
    console.error("Finance registration failed", error);
    if (error?.code === "ACCOUNT_ALREADY_EXISTS" || /already exists|already registered/i.test(message)) return "A Finance account already exists for this email. Sign in after approval, or reset its password.";
    if (/strong password|password/i.test(message)) return "Use a stronger password that meets the password requirements.";
    if (/network|fetch|offline|connect/i.test(message)) return "Unable to submit registration. Check your internet connection and try again.";
    return message || "Registration was not submitted. Please correct the details and try again.";
  };

  const setAuthButtonLoading = (button, label) => {
    if (!button) return;
    button.disabled = true;
    button.classList.add("is-loading");
    button.setAttribute("aria-busy", "true");
    button.innerHTML = `<i class="button-spinner" aria-hidden="true"></i><span>${label}</span><span aria-hidden="true">↗</span>`;
  };

  const paintLoadingFrame = () => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
  const configuredAmount = key => {
    const value = Number(data.settings?.[key]);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  };
  const commissionRules = () => ({ sale: configuredAmount("saleCommission"), monthlyCustomer: configuredAmount("monthlyCustomerCommission") });
  const commissionRuleNote = () => {
    const rules = commissionRules();
    return rules.sale || rules.monthlyCustomer ? `${money(rules.sale)} per sale plus ${money(rules.monthlyCustomer)} per customer this month` : "Commission policy has not been configured";
  };
  const sameDay = (left, right) => left && right && left.toDateString() === right.toDateString();
  const parseDate = value => {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
  };
  const paymentDate = payment => parseDate(payment.date || payment.paid_at || payment.created_at);
  const paymentsToday = () => data.payments.filter(payment => sameDay(paymentDate(payment), new Date()));
  const paymentsThisMonth = () => {
    const now = new Date();
    return data.payments.filter(payment => {
      const date = paymentDate(payment);
      return date && date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
    });
  };
  const sum = (items, key) => items.reduce((total, item) => total + Number(item[key] || 0), 0);
  const commissionRows = () => {
    const map = new Map();
    data.accounts.filter(account => account.agentId || account.agentCode).forEach(account => {
      const key = String(account.agentId || account.agentCode);
      if (!map.has(key)) map.set(key, { agent: account.agent || "Unassigned agent", code: account.agentCode || key, phone: "", customers: new Map(), sales: [], saleValue: 0 });
      const row = map.get(key);
      const customerKey = String(account.customerId || account.customer || account.id);
      row.customers.set(customerKey, { name: account.customer || "Unlinked", phone: account.phone || "", product: account.bike || "No tracker" });
      row.sales.push(account);
      row.saleValue += Number(account.total || 0);
    });
    return [...map.values()].map(row => {
      const customerList = [...row.customers.values()];
      const rules = commissionRules();
      const saleCommission = row.sales.length * rules.sale;
      const monthlyCommission = customerList.length * rules.monthlyCustomer;
      return { ...row, total: row.saleValue, customerList, sold: row.sales.length, saleCommission, monthlyCommission, commission: saleCommission + monthlyCommission };
    });
  };
  const collectionsGraph = () => {
    const today = new Date();
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(today);
      date.setDate(today.getDate() - (6 - index));
      return date;
    });
    const values = days.map(date => sum(data.payments.filter(payment => sameDay(paymentDate(payment), date)), "amount"));
    const max = Math.max(...values, 1);
    const points = values.map((value, index) => {
      const x = index * (700 / 6);
      const y = 200 - (value / max) * 180;
      return [x, y];
    });
    const line = points.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");
    const area = `${line}V200H0Z`;
    const labels = days.map(date => date.toLocaleDateString(undefined, { weekday: "short" }));
    const total = values.reduce((total, value) => total + value, 0);
    const yLabels = [max, max * 0.8, max * 0.6, max * 0.4, max * 0.2, 0].map(value => value >= 1000 ? `${Math.round(value / 1000)}K` : String(Math.round(value)));
    return `<div class="collections-chart" role="img" aria-label="Collections for the last seven days"><div class="chart-summary"><strong>${money(total)}</strong><span><i></i> Last 7 days</span></div><div class="chart-canvas"><div class="chart-y-labels">${yLabels.map(label => `<span>${label}</span>`).join("")}</div><div class="chart-plot"><svg viewBox="0 0 700 210" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="collectionsFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1673b9" stop-opacity=".28"/><stop offset="1" stop-color="#1673b9" stop-opacity=".02"/></linearGradient></defs><g class="chart-grid"><path d="M0 10H700M0 48H700M0 86H700M0 124H700M0 162H700M0 200H700"/></g><path class="chart-area" d="${area}"/><path class="chart-line" d="${line}"/><g class="chart-points">${points.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4"/>`).join("")}</g></svg><div class="chart-x-labels">${labels.map(label => `<span>${label}</span>`).join("")}</div></div></div></div>`;
  };

  function loginView(message = "") {
    const registering = authMode === "register";
    return `<main class="login-screen"><section class="login-shell"><div class="login-story"><div class="login-brand"><img src="./assets/jixels-form-ni-tenje.svg" alt="Jixels Form Ni Tenje"></div><div class="login-story-copy"><span class="login-kicker"><i></i> FINANCE OPERATIONS PLATFORM</span><h1>Every payment.<br>One clear view.</h1><p>Manage financed accounts, collections, overdue balances, reconciliation, and reports from one secure workspace.</p><div class="login-feature-grid"><div><span>↗</span><strong>Live finance</strong><small>Collections and account health</small></div><div><span>✓</span><strong>Controlled access</strong><small>Protected finance workspace</small></div></div></div><div class="login-system-status"><span><i></i> Systems operational</span><small>Secure Jixels workspace</small></div></div><div class="login-form-panel"><form class="login-card" id="login-form"><div class="login-form-mark">✓</div><div class="eyebrow">FINANCE WORKSPACE</div><h2>${registering ? "Register finance user" : "Welcome back"}</h2><p>${registering ? "Create a finance user before accessing payment and account records." : "Enter your registered finance user details."}</p><div class="login-tabs"><button type="button" data-auth-mode="login" class="${!registering ? "active" : ""}">Login</button><button type="button" data-auth-mode="register" class="${registering ? "active" : ""}">Register</button></div>${registering ? '<label>Full name<input name="name" placeholder="Full name" autocomplete="name" required></label><label>Phone number<input name="phone" placeholder="07++++++++++" autocomplete="tel" required></label>' : ""}<label>Email address<input name="email" type="email" placeholder="you@jixels.com" autocomplete="email" required></label><label>Password${passwordInput("password", registering ? "new-password" : "current-password", "Enter your password")}</label>${registering ? `<label>Confirm password${passwordInput("confirm", "new-password", "Repeat your password")}</label>` : ""}${message ? `<div class="login-error">! ${escapeHtml(message)}</div>` : ""}<button class="button button-primary login-button" type="submit">${registering ? "Create finance user" : "Sign in securely"} <span>↗</span></button><small class="login-security-note">✓ Protected financial access</small></form><footer class="login-panel-footer">© 2026 Jixels Technologies</footer></div></section></main>`;
  }

  function registrationPendingView() {
    return `<main class="login-screen"><section class="login-shell"><div class="login-story"><div class="login-brand"><img src="./assets/jixels-form-ni-tenje.svg" alt="Jixels Form Ni Tenje"></div><div class="login-story-copy"><span class="login-kicker"><i></i> FINANCE OPERATIONS PLATFORM</span><h1>Registration<br>received.</h1><p>Your Finance account is protected until a Jixels administrator reviews and approves it.</p></div><div class="login-system-status"><span><i></i> Registration submitted</span><small>Administrator review required</small></div></div><div class="login-form-panel"><section class="login-card" aria-live="polite"><div class="login-form-mark">✓</div><div class="eyebrow">FINANCE ACCOUNT</div><h2>Awaiting approval</h2><p>Registration details submitted successfully. Your account is awaiting approval from a Jixels administrator.</p><p>You will be able to sign in with your registered email and password after approval.</p><button class="button button-primary login-button" type="button" data-return-login>Return to sign in <span>↗</span></button></section><footer class="login-panel-footer">© 2026 Jixels Technologies</footer></div></section></main>`;
  }

  function showRegistrationPending() {
    root.innerHTML = registrationPendingView();
    document.querySelector("[data-return-login]")?.addEventListener("click", () => {
      authMode = "login";
      authDraft = { name: "", phone: "", email: "", password: "", confirm: "" };
      root.innerHTML = loginView();
      bindLoginEvents();
    });
  }

  function authLoadingView() {
    const registering = authMode === "register";
    const title = registering ? "Submitting registration" : "Signing you in";
    const detail = registering ? "Creating your finance profile and sending it for administrator approval." : "Checking your finance access and loading secure workspace records.";
    return `<main class="finance-launch finance-auth-loading" aria-live="polite"><div class="finance-launch-stage"><div class="finance-launch-ring">⌖</div><div class="finance-launch-road"></div><span class="launch-finance-car">${icons.launchCar}</span><span class="launch-finance-bike">${icons.launchBike}</span><span class="launch-finance-tuktuk">${icons.launchTuktuk}</span></div><small>WELCOME TO JIXELS FINANCE</small><h1>${title}</h1><p>${detail}</p><div class="finance-launch-dots" aria-label="Loading"><i></i><i></i><i></i></div></main>`;
  }

  function accountTable(accounts, allowRemove) {
    if (!accounts.length) return empty("No finance accounts", "Add an account to start tracking finance.");
    return `<div class="table-wrap"><table><thead><tr>${allowRemove ? `<th>${selectAll("accounts")}</th>` : ""}<th>Customer</th><th>Bike</th><th>Account</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th>${allowRemove ? "<th>Actions</th>" : ""}</tr></thead><tbody>${accounts.map(account => `<tr>${allowRemove ? `<td>${rowCheck("accounts", account.id)}</td>` : ""}<td><strong>${escapeHtml(account.customer)}</strong><br><small>${escapeHtml(account.phone)}</small></td><td>${escapeHtml(account.bike)}<br><small>${escapeHtml(account.model)}</small></td><td>${escapeHtml(account.id)}</td><td>${money(account.total)}</td><td>${money(account.paid)}</td><td>${money(account.balance)}</td><td>${status(account.status)}</td>${allowRemove ? `<td><div class="row-actions"><button class="button button-secondary" data-edit-account="${escapeHtml(account.id)}" type="button">Modify</button><button class="button danger-button" data-remove-account="${escapeHtml(account.id)}" type="button">Delete</button></div></td>` : ""}</tr>`).join("")}</tbody></table></div>`;
  }

  function dashboard() {
    const overdue = data.accounts.filter(account => account.status === "Overdue");
    const collections = sum(data.payments, "amount");
    const outstanding = data.accounts.reduce((total, account) => total + Number(account.balance || Math.max(Number(account.total || 0) - Number(account.paid || 0), 0)), 0);
    const todayPayments = paymentsToday();
    const monthPayments = paymentsThisMonth();
    const trackerSalesTotal = data.accounts.reduce((total, account) => total + Number(account.total || 0), 0);
    const overview = [
      ["Collections", money(collections), "Total money received from customers", "blue"],
      ["Outstanding Balance", money(outstanding), "Total amount customers still owe", "orange"],
      ["Overdue Accounts", overdue.length, "Accounts with overdue payments", "red"],
      ["Commissions", money(commissionRows().reduce((sum, row) => sum + row.commission, 0)), commissionRuleNote(), "green"],
      ["Due Today", money(sum(data.accounts.filter(account => account.status !== "Completed"), "dailyTarget")), "Total payments expected today", "orange"],
      ["Payments Today", money(sum(todayPayments, "amount")), "Total money actually received today", "green"],
      ["Tracker Sales", money(trackerSalesTotal), "Total value of trackers sold to all customers", "red"],
      ["Monthly Revenue", money(sum(monthPayments, "amount")), "Total revenue collected this month", "blue"]
    ];
    return `<section><div class="section-heading"><div><div class="eyebrow"><i></i> FINANCE OPERATIONS</div><h2>Finance Overview</h2><p>Collections, balances, and account health at a glance.</p></div><span class="live-status"><i></i> Live workspace</span></div><div class="metrics">${overview.map(item => metric(...item)).join("")}</div><div class="dashboard-grid"><div class="card collections-card"><div class="card-header"><div><div class="card-title">Collections performance</div><div class="card-subtitle">Daily customer collections for the last seven days</div></div></div><div class="card-body">${collectionsGraph()}</div></div><div class="card"><div class="card-header"><div><div class="card-title">Overdue accounts</div><div class="card-subtitle">Accounts requiring collection attention</div></div></div>${overdue.length ? accountTable(overdue.slice(0, 5), false) : empty("No overdue accounts", "Overdue records will show here.")}</div></div></section>`;
  }

  function accountsPage() {
    return `<section class="page-stack"><div class="section-heading"><div><h2>Finance Accounts</h2><p>Review financing records and account status.</p></div></div><div class="card"><div class="card-header"><div><div class="card-title">Finance accounts</div><div class="card-subtitle">Customer financing records are created through the approved onboarding workflow.</div></div><div class="toolbar"><label class="table-search" for="account-search"><span aria-hidden="true">⌕</span><input id="account-search" placeholder="Search accounts" aria-label="Search accounts"></label><select id="account-filter" aria-label="Filter accounts by status"><option value="">All statuses</option><option>On Track</option><option>Overdue</option><option>Completed</option></select></div></div><div id="account-list">${accountTable(data.accounts, false)}</div></div></section>`;
  }

  function registrationDate(value) {
    const parsed = parseDate(value);
    return parsed ? parsed.toLocaleDateString() : "-";
  }

  function customerDirectoryTable(rows) {
    if (!rows.length) return empty("No customer registrations", "New customer registrations will appear here.");
    return `<div class="table-wrap"><table><thead><tr><th>Customer</th><th>Contact</th><th>Plate number</th><th>Tracker number</th><th>Registration</th><th>Approval status</th></tr></thead><tbody>${rows.map(customer => `<tr><td><strong>${escapeHtml(customer.full_name)}</strong></td><td>${escapeHtml(customer.email || "-")}<br><small>${escapeHtml(customer.phone || "-")}</small></td><td>${escapeHtml(customer.plate_number || "-")}</td><td>${escapeHtml(customer.tracker_number || "-")}</td><td>${registrationDate(customer.created_at)}</td><td>${status(customer.status || "pending")}</td></tr>`).join("")}</tbody></table></div>`;
  }

  function customersPage() {
    const rows = data.customers || [];
    return `<section class="finance-module finance-directory"><div class="section-heading"><div><div class="eyebrow"><i></i> SHARED CUSTOMER DIRECTORY</div><h2>Customers</h2><p>Customer registrations from the Jixels app are available here for finance review.</p></div><span class="live-status"><i></i> Live data</span></div><section class="finance-directory-summary"><span class="directory-summary-icon">${icons.accounts}</span><div><span>Registered customers</span><strong>${rows.length}</strong></div><p>Shared customer records for finance review. Account approval remains an Admin workflow.</p></section><section class="card module-table"><div class="card-header directory-card-header"><div><div class="card-title">Customer records</div><div class="card-subtitle">Review customer contact details and registration status.</div></div><label class="table-search" for="customer-search"><span aria-hidden="true">⌕</span><input id="customer-search" placeholder="Search customers" aria-label="Search customers"></label></div><div id="customer-list">${customerDirectoryTable(rows)}</div></section></section>`;
  }

  function staffPage() {
    const rows = data.staff || [];
    return `<section class="finance-module"><div class="section-heading"><div><div class="eyebrow"><i></i> SHARED STAFF DIRECTORY</div><h2>Agents and finance staff</h2><p>Agent and finance registrations are visible here after they are submitted.</p></div><span class="live-status"><i></i> ${rows.length} staff records</span></div><section class="card module-table"><div class="card-header"><div><div class="card-title">Staff registrations</div><div class="card-subtitle">Only an administrator can approve, reject, or change a staff account.</div></div></div>${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Contact</th><th>Role</th><th>Approval status</th></tr></thead><tbody>${rows.map(member => `<tr><td><strong>${escapeHtml(member.full_name || "Unnamed user")}</strong></td><td>${escapeHtml(member.email || "-")}<br><small>${escapeHtml(member.phone || "-")}</small></td><td>${escapeHtml(String(member.role || "staff").replaceAll("_", " "))}</td><td>${status(member.account_status || "pending")}</td></tr>`).join("")}</tbody></table></div>` : empty("No staff registrations", "New agent and finance registrations will appear here.")}</section></section>`;
  }

  function commissionsPage() {
    const rows = commissionRows();
    const totals = rows.reduce((sum, row) => ({ paid: sum.paid + row.total, commission: sum.commission + row.commission, customers: sum.customers + row.customerList.length, sold: sum.sold + row.sold }), { paid: 0, commission: 0, customers: 0, sold: 0 });
    const body = rows.map(row => `<tr><td><strong>${escapeHtml(row.agent)}</strong><small>${escapeHtml(row.phone || "No phone")}</small></td><td>${escapeHtml(row.code)}</td><td>${row.customerList.length}</td><td>${row.sold}</td><td>${money(row.total)}</td><td>${money(row.saleCommission)}</td><td>${money(row.monthlyCommission)}</td><td><strong>${money(row.commission)}</strong></td><td><div class="commission-actions"><button class="commission-action view" type="button" data-view-agent="${escapeHtml(row.code)}">Open</button></div></td></tr>`).join("");
    return `<section class="commission-workspace"><div class="section-heading"><div><div class="eyebrow"><i></i> AGENT SALES</div><h2>Commissions</h2><p>${escapeHtml(commissionRuleNote())}. Commission is calculated only from approved tracker sales and active customers.</p></div></div><div class="metrics">${metric("Commission due", money(totals.commission), commissionRuleNote(), "green")}${metric("Tracker sales", money(totals.paid), "Value of approved tracker sales", "blue")}${metric("Customers sold to", totals.customers, "Approved customer records", "orange")}${metric("Sold trackers", totals.sold, "Approved tracker sales", "blue")}</div><section class="card commission-panel"><div class="card-header commission-card-header"><div><div class="card-title">Agent commission register</div><div class="card-subtitle">Commission is calculated from approved tracker sales and active customers.</div></div><label class="commission-search"><span aria-hidden="true">⌕</span><input id="commission-search" placeholder="Search agents, code, customers" aria-label="Search commission register"></label></div><div class="table-wrap commission-table-wrap"><table class="commission-table"><thead><tr><th>Agent</th><th>Code</th><th>Customers</th><th>Sold trackers</th><th>Sale value</th><th>Sale commission</th><th>Monthly commission</th><th>Total due</th><th>Actions</th></tr></thead><tbody>${body}</tbody></table></div></section></section>`;
  }

  function paymentRecords(query = "") {
    const visible = data.payments.filter(payment => `${payment.id || ""} ${payment.account || ""} ${payment.customer || ""} ${payment.phone || ""}`.toLowerCase().includes(query.toLowerCase()));
    const rows = visible.map(payment => `<tr><td><strong>${escapeHtml(payment.customer || "Unlinked")}</strong><small>${escapeHtml(payment.phone || "-")}</small><small>${escapeHtml(payment.email || "-")}</small></td><td>${escapeHtml(payment.product || "-")}<small>${escapeHtml(payment.tracker || "No tracker")}</small></td><td>${escapeHtml(payment.health || "Unknown")}</td><td>${escapeHtml(payment.paymentType || "Daily payment")}</td><td>${escapeHtml(payment.receipt || "Awaiting M-Pesa receipt")}</td><td><strong>${money(payment.amount || 0)}</strong></td><td>${money(payment.balance || 0)}</td><td>${escapeHtml(payment.date ? new Date(payment.date).toLocaleDateString() : "-")}</td><td>${escapeHtml(payment.agent || "Unassigned")}<small>${escapeHtml(payment.agentCode || "No code")}</small></td><td>${status(payment.status || "Confirmed")}</td></tr>`).join("");
    return `<div class="payment-scroll"><table class="payment-records-table"><thead><tr><th>Customer contact</th><th>Product / tracker</th><th>Tracker health</th><th>Payment type</th><th>M-Pesa receipt</th><th>Amount</th><th>Balance</th><th>Date</th><th>Agent</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function paymentsPage() {
    return `<section class="payments-workspace"><div class="section-heading payments-page-heading"><div><div class="eyebrow"><i></i> OPERATIONS</div><h2>Payments</h2><p>Confirmed customer payments.</p></div></div><section class="card payment-panel"><div class="payment-heading"><div><h3>Payment records (<span id="payment-count">${data.payments.length}</span>)</h3><p>Scroll sideways to view every payment and account field.</p></div><div class="toolbar"><label class="payment-search"><span aria-hidden="true">⌕</span><input id="payment-search" placeholder="Search product payments" aria-label="Search product payments"></label></div></div>${data.payments.length ? "" : '<div class="payment-connect-note">No confirmed payments are available.</div>'}<div id="payment-list">${paymentRecords()}</div><div class="horizontal-scroll-hint">Scroll left and right to view all columns</div></section></section>`;
  }

  function reconciliationPage() {
    const rows = data.payments.filter(payment => payment.receipt).map(payment => `<tr><td>${escapeHtml(payment.receipt)}</td><td>${escapeHtml(payment.customer || "Unlinked")}</td><td>${escapeHtml(payment.paymentType || "Daily payment")}</td><td>${money(payment.amount || 0)}</td><td>${escapeHtml(payment.date ? new Date(payment.date).toLocaleString() : "-")}</td><td>${status("Reconciled")}</td></tr>`).join("");
    return `<section class="reconciliation-workspace"><div class="reconcile-heading"><div><div class="reconcile-kicker"><i></i> Review activity</div><h2>Reconcile</h2><p>Confirmed M-Pesa receipts are reconciled against customer finance records.</p></div></div><section class="card reconcile-panel">${rows ? `<div class="table-wrap"><table><thead><tr><th>M-Pesa receipt</th><th>Customer</th><th>Payment type</th><th>Amount</th><th>Confirmed at</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>` : empty("No confirmed M-Pesa receipts", "Confirmed receipts will appear here automatically.")}</section></section>`;
  }

  function reportsPage() {
    return `<section class="reports-workspace"><section class="card reports-export-card"><div><h2>Reports & exports</h2><p>Export stored Finance records for the selected period.</p><div class="report-controls"><select id="report-dataset" aria-label="Data to export"><option value="all">All operational data</option><option value="payments">Payments</option><option value="accounts">Finance accounts</option><option value="commissions">Commissions</option><option value="alerts">Alerts</option><option value="audit">Audit logs</option></select><select id="report-period" aria-label="Report period"><option value="day">Daily</option><option value="week">Weekly</option><option value="month" selected>Monthly</option><option value="year">Yearly</option></select><input id="report-date" type="date" aria-label="Specific report date" title="Choose one specific day"></div></div><div class="report-actions"><button class="button report-export-button" type="button" data-export-report>Export data</button></div></section></section>`;
  }

  function addAudit(action, details) {
    data.auditLogs.unshift({ id: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, time: new Date().toLocaleString(), action, details });
  }

  async function exportFinanceReport() {
    const dataset = document.getElementById("report-dataset")?.value || "all";
    const period = document.getElementById("report-period")?.value || "month";
    const specificDate = document.getElementById("report-date")?.value || "";
    const inPeriod = value => {
      if (!specificDate && dataset !== "payments") return true;
      if (!value) return !specificDate;
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return !specificDate;
      if (specificDate) return date.toISOString().slice(0, 10) === specificDate;
      const now = new Date();
      const start = new Date(now);
      if (period === "day") start.setDate(now.getDate());
      if (period === "week") start.setDate(now.getDate() - 6);
      if (period === "month") start.setMonth(now.getMonth() - 1);
      if (period === "year") start.setFullYear(now.getFullYear() - 1);
      return date >= start && date <= now;
    };
    const rows = [];
    const add = (type, record) => rows.push({ record_type: type, ...record });
    if (dataset === "all" || dataset === "payments") data.payments.filter(payment => inPeriod(payment.date || payment.paid_at || payment.created_at)).forEach(payment => add("payment", payment));
    if (dataset === "all" || dataset === "accounts") data.accounts.forEach(account => add("finance_account", account));
    if (dataset === "all" || dataset === "commissions") commissionRows().forEach(row => add("commission", { agent: row.agent, code: row.code, customers: row.customerList.length, sold: row.sold, sales_paid: row.total, commission: row.commission }));
    if (dataset === "all" || dataset === "alerts") data.alerts.forEach(alert => add("alert", alert));
    if (dataset === "all" || dataset === "audit") data.auditLogs.filter(log => inPeriod(log.time)).forEach(log => add("audit", log));
    if (!rows.length) { window.alert("No records match this export selection."); return; }
    const headers = [...new Set(rows.flatMap(row => Object.keys(row)))];
    const csv = [headers, ...rows.map(row => headers.map(header => row[header] ?? ""))].map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `jixels-finance-${dataset}-${specificDate || period}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    addAudit("Finance report exported", `${rows.length} ${dataset} record(s)`);
    await persistChanges();
  }

  function alertsPage() {
    const rows = data.alerts.map(alert => `<tr><td>${rowCheck("alerts", alert.id)}</td><td><strong>${escapeHtml(alert.title)}</strong><small>${escapeHtml(alert.detail)}</small></td><td>${escapeHtml(alert.severity)}</td><td>${alert.resolved ? "Resolved" : "Open"}</td><td>${escapeHtml(alert.time)}</td><td><div class="row-actions">${alert.resolved ? "" : `<button class="button button-secondary" data-resolve-alert="${escapeHtml(alert.id)}">Resolve</button>`}<button class="button danger-button" data-delete-alert="${escapeHtml(alert.id)}" type="button">Delete</button></div></td></tr>`).join("");
    const open = data.alerts.filter(alert => !alert.resolved);
    const critical = open.filter(alert => alert.severity === "critical");
    return `<section class="finance-module"><div class="section-heading"><div><div class="eyebrow"><i></i> ACTIVITY CENTER</div><h2>Alerts</h2><p>Resolve finance alerts only after payment, reconciliation, or commission review.</p></div></div><div class="metrics">${metric("Open alerts", open.length, "Finance items needing action", "orange")}${metric("Critical alerts", critical.length, "High-priority collection risk", "red")}${metric("Audit records", data.auditLogs.length, "Finance actions recorded", "green")}</div><section class="card module-table"><div class="card-header table-card-header"><div><div class="card-title">Finance alert register</div><div class="card-subtitle">Payments, reconciliation, overdue accounts, and commission approvals.</div></div><div class="toolbar"><label class="table-search"><span aria-hidden="true">⌕</span><input id="alerts-search" placeholder="Search alerts" aria-label="Search alerts"></label>${bulkActions("alerts")}</div></div><div class="table-wrap limited-table-wrap"><table class="searchable-table"><thead><tr><th>${selectAll("alerts")}</th><th>Alert</th><th>Severity</th><th>Status</th><th>Time</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div></section></section>`;
  }

  function settingsPage() {
    return `<section class="settings-layout"><div class="settings-intro"><div><span class="eyebrow">WORKSPACE CONTROLS</span><h2>Settings</h2><p>Configure the commission policy used for approved tracker sales.</p></div><button class="button button-primary" data-save-settings>Save changes</button></div><form id="settings-form" class="settings-grid"><article class="card settings-card"><div class="settings-card-title"><span>${icons.accounts}</span><div><h2>My account</h2></div></div><label>Display name<input name="displayName" value="${escapeHtml(session?.name || "")}"></label><label>Email<input value="${escapeHtml(session?.email || "")}" disabled></label></article><article class="card settings-card"><div class="settings-card-title"><span>${icons.payments}</span><div><h2>Commission policy</h2></div></div><label>Commission per approved tracker sale<input name="saleCommission" type="number" min="0" value="${escapeHtml(data.settings.saleCommission)}"></label><label>Monthly commission per approved customer<input name="monthlyCustomerCommission" type="number" min="0" value="${escapeHtml(data.settings.monthlyCustomerCommission)}"></label></article></form></section>`;
  }

  function auditPage() {
    const rows = data.auditLogs.map(log => `<tr><td>${escapeHtml(log.action)}</td><td>${escapeHtml(log.details)}</td><td>${escapeHtml(log.time)}</td></tr>`).join("");
    return `<section class="finance-module"><div class="section-heading"><div><h2>Audit Logs</h2><p>Stored Finance activity.</p></div></div><section class="card module-table"><div class="card-header table-card-header"><div><div class="card-title">Finance audit trail</div><div class="card-subtitle">Audit records are retained and cannot be deleted from this portal.</div></div><div class="toolbar"><label class="table-search"><span aria-hidden="true">⌕</span><input id="audit-search" placeholder="Search logs" aria-label="Search audit logs"></label></div></div>${data.auditLogs.length ? `<div class="table-wrap limited-table-wrap"><table class="searchable-table"><thead><tr><th>Action</th><th>Details</th><th>Time</th></tr></thead><tbody>${rows}</tbody></table></div>` : empty("No audit records yet", "Stored Finance actions will appear here.")}</section></section>`;
  }

  function simplePage() {
    const content = {
      overdue: ["Overdue Accounts", "Accounts with overdue status will appear here."],
      reconciliation: ["Reconciliation", "Connect your payment gateway to reconcile transactions."],
      alerts: ["Alerts & Notifications", "New finance events will appear here."],
      settings: ["Finance Settings", "Connect a backend or payment provider to configure this portal."],
      audit: ["Audit Logs", "Actions taken in this browser are listed below."]
    };
    const [title, text] = content[page];
    const logs = page === "audit" && data.auditLogs.length ? `<div class="table-wrap"><table><thead><tr><th>Time</th><th>Action</th><th>Details</th></tr></thead><tbody>${data.auditLogs.map(log => `<tr><td>${escapeHtml(log.time)}</td><td>${escapeHtml(log.action)}</td><td>${escapeHtml(log.details)}</td></tr>`).join("")}</tbody></table></div>` : empty("Nothing to show yet", "This page is ready for live data.");
    return `<section><div class="section-heading"><div><h2>${title}</h2><p>${text}</p></div></div><div class="card">${logs}</div></section>`;
  }

  function view() { return page === "dashboard" ? dashboard() : page === "customers" ? customersPage() : page === "staff" ? staffPage() : page === "commissions" ? commissionsPage() : page === "accounts" ? accountsPage() : page === "payments" ? paymentsPage() : page === "reconciliation" ? reconciliationPage() : page === "reports" ? reportsPage() : page === "alerts" ? alertsPage() : page === "settings" ? settingsPage() : page === "audit" ? auditPage() : simplePage(); }

  function commissionModal() {
    if (!commissionDialog) return "";
    const items = commissionDialog.customers.map(customer => `<li><strong>${escapeHtml(customer.name)}</strong><span>${escapeHtml(customer.product || "No tracker")}</span></li>`).join("");
    return `<div class="finance-side-backdrop" data-close-commission-modal><aside class="finance-side-panel" role="dialog" aria-modal="true" aria-labelledby="commission-modal-title"><div class="finance-modal-heading"><div><span>AGENT CUSTOMERS</span><h3 id="commission-modal-title">${escapeHtml(commissionDialog.agent)}</h3><p>${escapeHtml(commissionDialog.code)}</p></div><button type="button" data-close-commission-modal aria-label="Close">×</button></div><div class="finance-modal-body">${items ? `<ul class="commission-customer-list">${items}</ul>` : `<div class="commission-empty">${escapeHtml(commissionDialog.agent)} has no customer sales yet.</div>`}</div><div class="finance-modal-actions"><button class="button button-primary" type="button" data-close-commission-modal>OK</button></div></aside></div>`;
  }

  function loadingView() {
    if (loadingMode === "page") return `<div class="finance-loading"><div class="finance-loading-brand"><strong>Jixels Finance</strong><small>Loading workspace records…</small></div><div class="finance-skeleton-heading skeleton"></div><div class="finance-skeleton-metrics">${Array.from({ length: 4 }, () => '<div class="skeleton"></div>').join("")}</div><div class="finance-skeleton-panel skeleton">${Array.from({ length: 5 }, () => '<span></span>').join("")}</div></div>`;
    return `<div class="finance-launch"><div class="finance-launch-stage"><div class="finance-launch-ring">⌖</div><div class="finance-launch-road"></div><span class="launch-finance-car">${icons.launchCar}</span><span class="launch-finance-bike">${icons.launchBike}</span><span class="launch-finance-tuktuk">${icons.launchTuktuk}</span></div><small>WELCOME TO JIXELS FINANCE</small><h1>Opening your finance workspace</h1><p>Preparing your live accounts, payments, and tracker records.</p><div class="finance-launch-dots"><i></i><i></i><i></i></div></div>`;
  }

  function offlineView() {
    return `<main class="finance-offline"><div class="finance-offline-icon">⌁</div><div class="finance-offline-road"><i class="vehicle-one">●</i><i class="vehicle-two">●</i><i class="vehicle-three">●</i></div><h1>Network is down</h1><p>Live finance records require an internet connection. Reconnect before opening the workspace.</p><button class="offline-retry" data-retry>Check connection</button></main>`;
  }

  function render() {
    if (!online) { root.innerHTML = offlineView(); bindOfflineEvents(); return; }
    if (loading) { root.innerHTML = loadingView(); return; }
    if (!session) { root.innerHTML = loginView(); bindLoginEvents(); return; }
    const currentLabel = navigation.find(item => item[0] === page)[2];
    const userEmail = session?.email || "";
    const userName = session?.name || userEmail.split("@")[0] || "Finance user";
    const initials = userName.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase() || "FU";
    root.innerHTML = `<div class="app ${sidebarCollapsed ? "sidebar-collapsed" : ""}"><aside class="sidebar ${sidebarOpen ? "open" : ""} ${sidebarCollapsed ? "collapsed" : ""}"><div class="sidebar-header"><button class="sidebar-toggle" data-collapse aria-label="Toggle navigation">${icons.menu}</button><div class="brand"><img class="finance-brand-logo" src="./assets/jixels-form-ni-tenje.svg?v=3" alt="Jixels Form Ni Tenje"></div></div><nav class="nav">${navigation.map(([id, navIcon, label], index) => `${index === 0 ? '<div class="nav-section">FINANCE</div>' : index === 7 ? '<div class="nav-section">REPORTING</div>' : index === 9 ? '<div class="nav-section">ADMIN</div>' : ''}<button data-go="${id}" class="${page === id ? "active" : ""}" title="${label}" aria-label="${label}"><span class="nav-icon">${navIcon}</span><span class="nav-label">${label}</span></button>`).join("")}</nav><div class="sidebar-footer"><button data-logout>${icons.logout}<span>Logout</span></button></div></aside>${sidebarOpen ? '<button class="scrim" data-close-menu aria-label="Close menu"></button>' : ""}<main class="main"><header class="topbar"><button class="menu-button" data-menu aria-label="Open navigation">${icons.menu}</button><div class="topbar-actions"><div class="top-profile"><span class="user-avatar">${escapeHtml(initials)}</span><span><strong>${escapeHtml(userName)}</strong><small>${escapeHtml(userEmail || "Finance workspace")}</small></span></div></div></header><div class="content">${view()}</div><footer class="system-footer"><span><strong>JIXELS FINANCE</strong> · Form Ni Tenje · Finance workspace</span><span>© 2026 Jixels Technologies</span></footer></main></div>${commissionModal()}`;
    bindEvents();
  }

  function notificationMarkup() {
    const alerts = (data.alerts || []).filter(alert => !alert.resolved).slice(0, 5);
    const list = alerts.length
      ? `<div class="notification-list">${alerts.map(alert => `<button class="notification-item unread" type="button" data-go="alerts"><span class="notification-dot"></span><span><strong>${escapeHtml(alert.title || "Finance alert")}</strong><small>${escapeHtml(alert.detail || "Requires review")}</small><time>${escapeHtml(alert.time || "Now")}</time></span></button>`).join("")}</div>`
      : `<div class="notification-list"><div class="notification-item"><span class="notification-dot"></span><span><strong>No new finance alerts</strong><small>New payment and account events appear here.</small></span></div></div>`;
    return `<button class="notification-button ${alerts.length ? "has-unread" : ""}" type="button" data-toggle-notifications aria-label="Finance notifications">${icons.alerts}</button>${notificationsOpen ? `<section class="notification-panel" aria-label="Finance notifications"><div class="notification-panel-heading"><strong>Notifications</strong><button type="button" data-go="alerts">Open alerts</button></div>${list}</section>` : ""}`;
  }

  function prepareLoginForm() {
    const form = document.getElementById("login-form");
    if (!form) return;
    const applyDraft = () => {
      form.setAttribute("autocomplete", "off");
      ["name", "phone", "email", "password", "confirm"].forEach(key => {
        const input = form.elements.namedItem(key);
        if (!input) return;
        input.setAttribute("autocomplete", key === "password" || key === "confirm" ? "new-password" : "off");
        input.value = authDraft[key] || "";
      });
    };
    applyDraft();
    window.requestAnimationFrame(applyDraft);
  }

  function bindLoginEvents() {
    prepareLoginForm();
    document.querySelectorAll("[data-auth-mode]").forEach(button => button.addEventListener("click", () => {
      authMode = button.dataset.authMode;
      root.innerHTML = loginView();
      bindLoginEvents();
    }));
    document.querySelectorAll("[data-toggle-password]").forEach(button => button.addEventListener("click", () => {
      const input = button.closest(".password-field")?.querySelector("input");
      if (!input) return;
      const visible = input.type === "text";
      input.type = visible ? "password" : "text";
      button.setAttribute("aria-label", visible ? "Show password" : "Hide password");
      button.classList.toggle("active", !visible);
    }));
    document.getElementById("login-form")?.addEventListener("submit", async event => {
      event.preventDefault(); const formData = new FormData(event.currentTarget);
      const email = formData.get("email").trim().toLowerCase();
      const password = formData.get("password");
      authDraft = { name: formData.get("name") || "", phone: formData.get("phone") || "", email, password, confirm: formData.get("confirm") || "" };
      if (!email || !password) {
        root.innerHTML = loginView("Enter your finance workspace email and password."); bindLoginEvents(); return;
      }
      if (!isValidEmail(email)) {
        root.innerHTML = loginView("Enter a valid finance workspace email address."); bindLoginEvents(); return;
      }
      try {
        if (authMode === "register") {
          const name = formData.get("name").trim();
          const phone = formData.get("phone").trim();
          const confirm = formData.get("confirm");
          if (!name || !phone) throw new Error("Complete your full name and phone number.");
          if (password !== confirm) throw new Error("Passwords do not match.");
          if (!isStrongPassword(password)) throw new Error("Use 8+ characters with uppercase, lowercase, number, and special character.");
          const submit = event.currentTarget.querySelector("button[type=submit]");
          setAuthButtonLoading(submit, "Creating account...");
          await paintLoadingFrame();
          const registration = await registerFinanceUser({ name, email, phone, password });
          localStorage.setItem("jixels.finance.pending-email", email);
          if (!registration.pending) throw new Error("Registration was not submitted. Please try again.");
          showRegistrationPending(); return;
        } else {
          const submit = event.currentTarget.querySelector("button[type=submit]");
          setAuthButtonLoading(submit, "Signing in...");
          await paintLoadingFrame();
          const account = await financeAccountStatus(email);
          if (!account.exists) {
            const error = new Error("Finance account not found.");
            error.code = "ACCOUNT_NOT_FOUND";
            throw error;
          }
          if (!account.approved) throw new Error(account.message || "Your Finance registration is waiting for administrator approval. You can sign in after the account is approved.");
          session = await authenticateFinanceUser(email, password);
          root.innerHTML = authLoadingView();
        }
        startWorkspaceLoading();
      } catch (error) {
        root.innerHTML = loginView(authMode === "register" ? safeRegistrationMessage(error) : safeLoginMessage(error));
        bindLoginEvents();
      }
    });
  }

  async function startWorkspaceLoading() {
    loading = true; loadingMode = "launch"; render();
    await paintLoadingFrame();
    try {
      await hydrate(session.accessToken);
      data = readData();
      loading = false;
      render();
      hydrateSupplementary().then(records => {
        if (!session) return;
        data = records;
        render();
      }).catch(error => console.error("Finance supplementary data loading failed", error));
      if (!liveRefreshTimer) liveRefreshTimer = window.setInterval(refreshLiveWorkspace, 5_000);
    } catch (error) {
      console.error("Finance workspace loading failed", error);
      loading = false;
      session = null;
      root.innerHTML = loginView(safeLoginMessage(error));
      bindLoginEvents();
    }
  }

  async function refreshLiveWorkspace() {
    if (!session || loading || document.visibilityState !== "visible") return;
    try {
      const previous = JSON.stringify(data);
      const refreshed = await refreshLive();
      if (previous === JSON.stringify(refreshed)) return;
      data = { ...data, ...refreshed };
      render();
    } catch (error) {
      console.error("Finance live refresh failed", error);
    }
  }

  function bindOfflineEvents() {
    root.querySelector("[data-retry]")?.addEventListener("click", () => { online = navigator.onLine; render(); });
  }

  function openPage(nextPage) {
    page = nextPage; sidebarOpen = false; notificationsOpen = false; if (window.innerWidth > 760) sidebarCollapsed = true; render();
  }

  function updateAccountList() {
    const search = document.getElementById("account-search").value.toLowerCase();
    const filter = document.getElementById("account-filter").value;
    const results = data.accounts.filter(account => `${account.customer} ${account.bike} ${account.id}`.toLowerCase().includes(search) && (!filter || account.status === filter));
    document.getElementById("account-list").innerHTML = accountTable(results, false);
  }

  async function persistChanges() {
    try {
      await saveData(data);
      return true;
    } catch (error) {
      console.error("Finance data was not saved", error);
      try {
        await hydrate(session.accessToken);
        await hydrateSupplementary();
        data = readData();
      } catch (reloadError) {
        console.error("Finance data reload failed", reloadError);
      }
      window.alert(`The change was not saved. ${error.message}`);
      render();
      return false;
    }
  }

  function selectedRows(scope) {
    return [...document.querySelectorAll(`[data-select-row="${scope}"]:checked`)].map(input => input.value);
  }

  async function deleteByScope(scope, ids) {
    if (!ids.length) return;
    if (scope === "alerts") data.alerts = data.alerts.filter(item => !ids.includes(item.id));
    if (scope !== "alerts") return;
    addAudit("Alerts deleted", `${ids.length} record${ids.length === 1 ? "" : "s"}`);
    if (await persistChanges()) render();
  }

  function bindSelectionControls() {
    document.querySelectorAll("[data-select-all]").forEach(input => input.addEventListener("change", () => {
      document.querySelectorAll(`[data-select-row="${input.dataset.selectAll}"]`).forEach(rowInput => { rowInput.checked = input.checked; });
    }));
    document.querySelectorAll("[data-delete-selected]").forEach(button => button.addEventListener("click", () => {
      const scope = button.dataset.deleteSelected;
      const ids = selectedRows(scope);
      if (!ids.length) { window.alert("Select at least one record first."); return; }
      if (window.confirm(`Delete ${ids.length} selected ${scope} record${ids.length === 1 ? "" : "s"}?`)) void deleteByScope(scope, ids);
    }));
    document.querySelectorAll("[data-delete-all]").forEach(button => button.addEventListener("click", () => {
      const scope = button.dataset.deleteAll;
      const ids = [...document.querySelectorAll(`[data-select-row="${scope}"]`)].map(input => input.value);
      if (!ids.length) return;
      if (window.confirm(`Delete all ${ids.length} ${scope} records shown on this page?`)) void deleteByScope(scope, ids);
    }));
  }

  function bindTableSearch(inputId, tableSelector) {
    const input = document.getElementById(inputId);
    const table = document.querySelector(tableSelector);
    if (!input || !table) return;
    input.addEventListener("input", () => {
      const query = input.value.trim().toLowerCase();
      table.querySelectorAll("tbody tr").forEach(row => {
        row.hidden = query ? !row.textContent.toLowerCase().includes(query) : false;
      });
    });
  }

  function bindEvents() {
    const topbarActions = document.querySelector(".topbar-actions");
    if (topbarActions) topbarActions.insertAdjacentHTML("afterbegin", notificationMarkup());
    document.querySelectorAll("[data-go]").forEach(button => button.addEventListener("click", () => openPage(button.dataset.go)));
    document.querySelector("[data-toggle-notifications]")?.addEventListener("click", event => { event.stopPropagation(); notificationsOpen = !notificationsOpen; render(); });
    const menu = document.querySelector("[data-menu]");
    if (menu) menu.addEventListener("click", () => { sidebarOpen = true; render(); });
    document.querySelector("[data-close-menu]")?.addEventListener("click", () => { sidebarOpen = false; render(); });
    document.querySelector("[data-collapse]")?.addEventListener("click", () => { if (window.innerWidth <= 760) sidebarOpen = false; else sidebarCollapsed = !sidebarCollapsed; render(); });
    document.querySelector(".main")?.addEventListener("pointerdown", () => {
      if (notificationsOpen) { notificationsOpen = false; render(); return; }
      if (window.innerWidth > 760 && !sidebarCollapsed) {
        sidebarCollapsed = true;
        document.querySelector(".app")?.classList.add("sidebar-collapsed");
        document.querySelector(".sidebar")?.classList.add("collapsed");
      }
    });
    document.querySelector("[data-logout]")?.addEventListener("click", () => { authDraft = { name: "", phone: "", email: "", password: "", confirm: "" }; session = null; if (liveRefreshTimer) { window.clearInterval(liveRefreshTimer); liveRefreshTimer = null; } render(); });
    document.querySelector("[data-export-report]")?.addEventListener("click", () => { void exportFinanceReport(); });
    document.querySelector(".commission-table")?.addEventListener("click", event => {
      const viewButton = event.target.closest("[data-view-agent]");
      const code = viewButton?.dataset.viewAgent;
      if (!code) return;
      const row = commissionRows().find(item => item.code === code);
      if (!row) return;
      commissionDialog = { agent: row.agent, code: row.code, customers: row.customerList };
      render();
    });
    document.getElementById("commission-search")?.addEventListener("input", event => {
      const query = event.currentTarget.value.trim().toLowerCase();
      document.querySelectorAll(".commission-table tbody tr").forEach(row => { row.hidden = query ? !row.textContent.toLowerCase().includes(query) : false; });
    });
    bindTableSearch("alerts-search", ".module-table .searchable-table");
    bindTableSearch("audit-search", ".module-table .searchable-table");
    document.querySelectorAll("[data-resolve-alert]").forEach(button => button.addEventListener("click", async () => {
      const alert = data.alerts.find(item => item.id === button.dataset.resolveAlert);
      data.alerts = data.alerts.map(item => item.id === button.dataset.resolveAlert ? { ...item, resolved: true } : item);
      addAudit("Finance alert resolved", alert?.title || button.dataset.resolveAlert);
      if (await persistChanges()) render();
    }));
    document.querySelectorAll("[data-delete-alert]").forEach(button => button.addEventListener("click", async () => {
      if (!window.confirm("Delete this finance alert?")) return;
      const alert = data.alerts.find(item => item.id === button.dataset.deleteAlert);
      data.alerts = data.alerts.filter(item => item.id !== button.dataset.deleteAlert);
      addAudit("Finance alert deleted", alert?.title || button.dataset.deleteAlert);
      if (await persistChanges()) render();
    }));
    document.querySelectorAll("[data-close-commission-modal]").forEach(element => element.addEventListener("click", event => {
      if (event.target === element || element.tagName === "BUTTON") { commissionDialog = null; render(); }
    }));
    const settingsForm = document.getElementById("settings-form");
    settingsForm?.addEventListener("submit", event => event.preventDefault());
    document.querySelector("[data-save-settings]")?.addEventListener("click", async () => {
      const form = new FormData(document.getElementById("settings-form"));
      data.settings = { workspaceName: data.settings.workspaceName || "", saleCommission: form.get("saleCommission"), monthlyCustomerCommission: form.get("monthlyCustomerCommission") };
      session = { ...session, name: form.get("displayName") || session?.name || "" };
      addAudit("Commission policy updated", `Per sale: ${money(data.settings.saleCommission)}; monthly: ${money(data.settings.monthlyCustomerCommission)}`);
      if (await persistChanges()) render();
    });
    const customerSearch = document.getElementById("customer-search");
    if (customerSearch) customerSearch.addEventListener("input", () => {
      const query = customerSearch.value.trim().toLowerCase();
      const rows = (data.customers || []).filter(customer => `${customer.full_name || ""} ${customer.email || ""} ${customer.phone || ""} ${customer.status || ""}`.toLowerCase().includes(query));
      const target = document.getElementById("customer-list");
      if (target) target.innerHTML = customerDirectoryTable(rows);
    });
    const search = document.getElementById("account-search"); const filter = document.getElementById("account-filter");
    if (search) search.addEventListener("input", updateAccountList); if (filter) filter.addEventListener("change", updateAccountList);
    const paymentSearch = document.getElementById("payment-search");
    if (paymentSearch) paymentSearch.addEventListener("input", () => {
      const visible = data.payments.filter(payment => `${payment.id || ""} ${payment.account || ""} ${payment.customer || ""} ${payment.phone || ""}`.toLowerCase().includes(paymentSearch.value.toLowerCase()));
      document.getElementById("payment-count").textContent = String(visible.length);
      document.getElementById("payment-list").innerHTML = paymentRecords(paymentSearch.value);
    });
    bindSelectionControls();
  }

  window.addEventListener("online", () => { online = true; render(); });
  window.addEventListener("offline", () => { online = false; render(); });
  if (session) startWorkspaceLoading();
  else render();
  } catch (error) {
    showFatalError(error);
  }
})();
