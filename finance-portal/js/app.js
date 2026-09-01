/* Finance portal shell: no React, Babel, or CDN dependency required. */
(function () {
  const { readData, saveData, registerFinanceUser, authenticateFinanceUser, money } = window.FinanceStore;
  const root = document.getElementById("root");
  let data = readData();
  let page = "dashboard";
  let authMode = "login";
  let sidebarOpen = false;
  let sidebarCollapsed = false;
  let notificationsOpen = false;
  let loading = false;
  let loadingMode = "launch";
  let launchSeconds = 7;
  let online = navigator.onLine;
  let session = null;
  let reconciliationMessage = "";
  let editingAccountId = null;
  let editingPaymentId = null;
  let commissionDialog = null;
  let reconciliationRecords = [];

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
    logout: icon('<path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9"/>')
  };
  const navigation = [
    ["dashboard", icons.dashboard, "Dashboard"], ["accounts", icons.accounts, "Accounts"], ["commissions", icons.commissions, "Commissions"],
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
  const passwordInput = (name, autocomplete, placeholder) => `<span class="password-field"><input name="${name}" type="password" placeholder="${placeholder}" autocomplete="${autocomplete}" required><button type="button" class="password-toggle" data-toggle-password aria-label="Show password">${icons.eye}</button></span>`;
  const isValidEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  const isStrongPassword = value => /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value) && !/\s/.test(value) && value.length >= 8;
  const safeLoginMessage = error => {
    const message = String(error?.message || "");
    console.error("Finance authentication failed", error);
    if (/invalid[_ ]credentials|invalid login|incorrect email|password/i.test(message)) return "Incorrect email or password. Please check your details and try again.";
    if (/account[_ ]locked|temporarily locked/i.test(message)) return "Your account has been temporarily locked because of too many failed login attempts. Please contact an administrator or use account recovery.";
    if (/permission|not approved|not authorized/i.test(message)) return "Your account is not approved for the Finance portal. Please contact an administrator.";
    if (/network|fetch|offline|connect/i.test(message)) return "Unable to connect to the server. Check your internet connection and try again.";
    return "Authentication temporarily unavailable. Please try again in a few moments.";
  };
  const commissionRate = () => Math.max(0, Number(data.settings.commissionRate || 5)) / 100;
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
  const agentName = payment => payment.agent || data.agents.find(agent => agent.code === payment.agentCode)?.name || "Unassigned agent";
  const agentCode = payment => payment.agentCode || data.agents.find(agent => agent.name === payment.agent)?.code || "No code";
  const paymentCustomerKey = payment => `${payment.customer || "Unlinked"}|${payment.phone || ""}`;
  const commissionRows = () => {
    const map = new Map();
    data.agents.forEach(agent => map.set(agent.code, { agent: agent.name, code: agent.code, phone: agent.phone, customers: new Map(), payments: [], total: 0 }));
    data.payments.forEach(payment => {
      const code = agentCode(payment);
      if (!map.has(code)) map.set(code, { agent: agentName(payment), code, phone: "", customers: new Map(), payments: [], total: 0 });
      const row = map.get(code);
      row.customers.set(paymentCustomerKey(payment), { name: payment.customer || "Unlinked", phone: payment.phone || "", product: payment.product || payment.account || "" });
      row.payments.push(payment);
      row.total += Number(payment.amount || 0);
    });
    return [...map.values()].map(row => ({ ...row, customerList: [...row.customers.values()], sold: row.payments.filter(payment => Number(payment.amount || 0) > 0).length, commission: row.total * commissionRate() }));
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
    return `<main class="login-screen"><section class="login-shell"><div class="login-story"><div class="login-brand"><img src="./assets/jixels-form-ni-tenje.svg" alt="Jixels Form Ni Tenje"></div><div class="login-story-copy"><span class="login-kicker"><i></i> FINANCE OPERATIONS PLATFORM</span><h1>Every payment.<br>One clear view.</h1><p>Manage financed accounts, collections, overdue balances, reconciliation, and reports from one secure workspace.</p><div class="login-feature-grid"><div><span>↗</span><strong>Live finance</strong><small>Collections and account health</small></div><div><span>✓</span><strong>Controlled access</strong><small>Protected finance workspace</small></div></div></div><div class="login-system-status"><span><i></i> Systems operational</span><small>Secure Jixels workspace</small></div></div><div class="login-form-panel"><form class="login-card" id="login-form"><div class="login-form-mark">✓</div><div class="eyebrow">FINANCE WORKSPACE</div><h2>${registering ? "Register finance user" : "Welcome back"}</h2><p>${registering ? "Create a finance user before accessing payment and account records." : "Enter your registered finance user details."}</p><div class="login-tabs"><button type="button" data-auth-mode="login" class="${!registering ? "active" : ""}">Login</button><button type="button" data-auth-mode="register" class="${registering ? "active" : ""}">Register</button></div>${registering ? '<label>Full name<input name="name" placeholder="Full name" autocomplete="name" required></label><label>Phone number<input name="phone" placeholder="07++++++++++" autocomplete="tel" required></label>' : ""}<label>Email address<input name="email" type="email" placeholder="you@jixels.com" autocomplete="email" required></label><label>Password${passwordInput("password", registering ? "new-password" : "current-password", "Enter your password")}</label>${registering ? `<label>Confirm password${passwordInput("confirm", "new-password", "Repeat your password")}</label>` : ""}${message ? `<div class="login-error">! ${escapeHtml(message)}</div>` : ""}<button class="button button-primary login-button">${registering ? "Create finance user" : "Sign in securely"} <span>↗</span></button><small class="login-security-note">✓ Protected financial access</small></form><footer class="login-panel-footer">© 2026 Jixels Technologies</footer></div></section></main>`;
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
    const unpaidInvoices = data.payments.filter(payment => ["Pending", "Failed"].includes(payment.status)).length + data.accounts.filter(account => account.status !== "Completed" && Number(account.balance || 0) > 0).length;
    const overview = [
      ["Collections", money(collections), "Total money received from customers", "blue"],
      ["Outstanding Balance", money(outstanding), "Total amount customers still owe", "orange"],
      ["Overdue Accounts", overdue.length, "Accounts with overdue payments", "red"],
      ["Commissions", money(commissionRows().reduce((sum, row) => sum + row.commission, 0)), "Agent earnings from tracker sales", "green"],
      ["Due Today", money(sum(data.accounts.filter(account => account.status !== "Completed"), "dailyTarget")), "Total payments expected today", "orange"],
      ["Payments Today", money(sum(todayPayments, "amount")), "Total money actually received today", "green"],
      ["Unpaid Invoices", unpaidInvoices, "Tracker/service invoices awaiting payment", "red"],
      ["Monthly Revenue", money(sum(monthPayments, "amount")), "Total revenue collected this month", "blue"]
    ];
    return `<section><div class="section-heading"><div><div class="eyebrow"><i></i> FINANCE OPERATIONS</div><h2>Finance Overview</h2><p>Collections, balances, and account health at a glance.</p></div><span class="live-status"><i></i> Live workspace</span></div><div class="metrics">${overview.map(item => metric(...item)).join("")}</div><div class="dashboard-grid"><div class="card collections-card"><div class="card-header"><div><div class="card-title">Collections performance</div><div class="card-subtitle">Daily customer collections for the last seven days</div></div></div><div class="card-body">${collectionsGraph()}</div></div><div class="card"><div class="card-header"><div><div class="card-title">Overdue accounts</div><div class="card-subtitle">Accounts requiring collection attention</div></div></div>${overdue.length ? accountTable(overdue.slice(0, 5), false) : empty("No overdue accounts", "Overdue records will show here.")}</div></div></section>`;
  }

  function accountsPage() {
    const account = editingAccountId ? data.accounts.find(item => item.id === editingAccountId) || {} : {};
    const value = key => escapeHtml(account[key] ?? "");
    const selected = statusValue => account.status === statusValue ? "selected" : "";
    return `<section class="page-stack"><div class="section-heading"><div><h2>Finance Accounts</h2><p>Create and manage financing records.</p></div></div><div class="card"><div class="card-header"><div><div class="card-title">${editingAccountId ? "Modify finance account" : "Add finance account"}</div><div class="card-subtitle">${editingAccountId ? escapeHtml(editingAccountId) : "No sample accounts are included."}</div></div></div><div class="card-body"><form id="account-form"><div class="form-grid"><div class="field"><label>Customer name</label><input name="customer" value="${value("customer")}" required></div><div class="field"><label>Phone number</label><input name="phone" value="${value("phone")}"></div><div class="field"><label>Bike registration</label><input name="bike" value="${value("bike")}" required></div><div class="field"><label>Bike model</label><input name="model" value="${value("model")}"></div><div class="field"><label>Total finance amount</label><input name="total" type="number" min="0" value="${value("total")}" required></div><div class="field"><label>Amount paid</label><input name="paid" type="number" min="0" value="${value("paid") || 0}"></div><div class="field"><label>Status</label><select name="status"><option ${selected("On Track")}>On Track</option><option ${selected("Overdue")}>Overdue</option><option ${selected("Completed")}>Completed</option></select></div></div><div class="form-actions">${editingAccountId ? '<button class="button button-secondary" type="button" data-cancel-account-edit>Cancel</button>' : ""}<button class="button button-primary">${editingAccountId ? "Update account" : "Save account"}</button></div></form></div></div><div class="card"><div class="card-header"><div><div class="card-title">All finance accounts</div></div><div class="toolbar"><input id="account-search" placeholder="Search accounts"><select id="account-filter"><option value="">All statuses</option><option>On Track</option><option>Overdue</option><option>Completed</option></select>${bulkActions("accounts")}</div></div><div id="account-list">${accountTable(data.accounts, true)}</div></div></section>`;
  }

  function commissionsPage() {
    const rows = commissionRows();
    const totals = rows.reduce((sum, row) => ({ paid: sum.paid + row.total, commission: sum.commission + row.commission, customers: sum.customers + row.customerList.length, sold: sum.sold + row.sold }), { paid: 0, commission: 0, customers: 0, sold: 0 });
    const body = rows.map(row => `<tr><td><strong>${escapeHtml(row.agent)}</strong><small>${escapeHtml(row.phone || "No phone")}</small></td><td>${escapeHtml(row.code)}</td><td>${row.customerList.length}</td><td>${row.sold}</td><td>${money(row.total)}</td><td><strong>${money(row.commission)}</strong></td><td>${row.customerList.map(customer => `<span>${escapeHtml(customer.name)} - ${escapeHtml(customer.product || "No tracker")}</span>`).join("") || "<span>No customer sales yet</span>"}</td><td><div class="commission-actions"><button class="commission-action view" type="button" data-view-agent="${escapeHtml(row.code)}">View customers</button><button class="commission-action pay" type="button" data-pay-commission="${escapeHtml(row.code)}" ${row.commission ? "" : "disabled"}>Pay commission</button><button class="commission-action remove" type="button" data-delete-agent="${escapeHtml(row.code)}">Delete</button></div></td></tr>`).join("");
    return `<section class="commission-workspace"><div class="section-heading"><div><div class="eyebrow"><i></i> AGENT SALES</div><h2>Commissions</h2><p>Each agent can see commission earned from customers they sold trackers to.</p></div></div><div class="metrics">${metric("Commission due", money(totals.commission), `${data.settings.commissionRate}% of paid tracker sales`, "green")}${metric("Sales payments", money(totals.paid), "Money paid by sold customers", "blue")}${metric("Customers sold to", totals.customers, "Linked customer records", "orange")}${metric("Sold trackers", totals.sold, "Paid tracker/product sales", "blue")}</div><section class="card commission-panel"><div class="card-header commission-card-header"><div><div class="card-title">Agent commission register</div><div class="card-subtitle">Payments group by agent name and agent code.</div></div><label class="commission-search"><span aria-hidden="true">⌕</span><input id="commission-search" placeholder="Search agents, code, customers" aria-label="Search commission register"></label></div><div class="table-wrap commission-table-wrap"><table class="commission-table"><thead><tr><th>Agent</th><th>Code</th><th>Customers</th><th>Sold trackers</th><th>Sales paid</th><th>Commission</th><th>Customers / trackers</th><th>Actions</th></tr></thead><tbody>${body}</tbody></table></div></section></section>`;
  }

  function paymentRecords(query = "") {
    const visible = data.payments.filter(payment => `${payment.id || ""} ${payment.account || ""} ${payment.customer || ""} ${payment.phone || ""}`.toLowerCase().includes(query.toLowerCase()));
    const rows = visible.map(payment => `<tr><td>${rowCheck("payments", payment.id)}</td><td><strong>${escapeHtml(payment.customer || "Unlinked")}</strong></td><td>${escapeHtml(payment.phone || "-")}<small>${escapeHtml(payment.receipt || payment.id || "No receipt")}</small></td><td>${escapeHtml(payment.product || payment.account || "-")}</td><td>${escapeHtml(payment.health || "-")}</td><td>${money(payment.overdue || 0)}</td><td>${money(payment.deposit || payment.credit || 0)}</td><td>${money(payment.paygoPayment || payment.amount || 0)}</td><td><strong>${money(payment.amount || 0)}</strong></td><td>${money(payment.dailyTarget || 0)}</td><td>${money(payment.balance || 0)}</td><td>${escapeHtml(payment.date || "-")}</td><td>${escapeHtml(payment.agent || "Unassigned")}<small>${escapeHtml(payment.agentCode || "No code")}</small></td><td>${status(payment.status || "Completed")}</td><td>${escapeHtml(payment.paygoAccount || payment.account || "-")}</td><td><div class="row-actions"><button class="button payment-edit-button" data-edit-payment="${escapeHtml(payment.id)}" type="button">Modify</button><button class="button danger-button" data-delete-payment="${escapeHtml(payment.id)}" type="button">Delete</button></div></td></tr>`).join("");
    return `<div class="payment-scroll"><table class="payment-records-table"><thead><tr><th>${selectAll("payments")}</th><th>Customer</th><th>Phone / Receipt</th><th>Product identifier</th><th>Health</th><th>Overdue</th><th>Deposit / Credit</th><th>Paygo Payment</th><th>Payment Amount</th><th>Daily Target</th><th>Balance</th><th>Date</th><th>Agent / Agent code</th><th>Status</th><th>Paygo Account</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function paymentEditor() {
    if (!editingPaymentId) return "";
    const payment = editingPaymentId === "new" ? {} : data.payments.find(item => item.id === editingPaymentId) || {};
    const value = key => escapeHtml(payment[key] ?? "");
    return `<div class="payment-editor-backdrop" data-close-payment-editor><aside class="payment-editor" role="dialog" aria-modal="true" aria-labelledby="payment-editor-title"><div class="payment-editor-heading"><div><span>FINANCE PAYMENT</span><h3 id="payment-editor-title">${editingPaymentId === "new" ? "Add payment" : "Edit payment"}</h3><p>Update the customer payment and finance-account values.</p></div><button type="button" data-close-payment-editor aria-label="Close payment editor">×</button></div><form id="payment-editor-form"><div class="payment-editor-grid"><label>Customer name<input name="customer" value="${value("customer")}" required></label><label>Phone number<input name="phone" value="${value("phone")}"></label><label>Receipt number<input name="receipt" value="${value("receipt")}" required></label><label>Product identifier<input name="product" value="${value("product")}"></label><label>Account health<select name="health"><option ${payment.health === "Healthy" ? "selected" : ""}>Healthy</option><option ${payment.health === "At risk" ? "selected" : ""}>At risk</option><option ${payment.health === "Overdue" ? "selected" : ""}>Overdue</option></select></label><label>Status<select name="status"><option ${payment.status === "Completed" ? "selected" : ""}>Completed</option><option ${payment.status === "Pending" ? "selected" : ""}>Pending</option><option ${payment.status === "Failed" ? "selected" : ""}>Failed</option><option ${payment.status === "Reversed" ? "selected" : ""}>Reversed</option></select></label><label>Overdue amount (KES)<input name="overdue" type="number" min="0" step="1" value="${value("overdue") || 0}"></label><label>Deposit / credit (KES)<input name="deposit" type="number" min="0" step="1" value="${value("deposit") || 0}"></label><label>PAYGO payment (KES)<input name="paygoPayment" type="number" min="0" step="1" value="${value("paygoPayment") || 0}"></label><label>Payment amount (KES)<input name="amount" type="number" min="0" step="1" value="${value("amount") || 0}" required></label><label>Daily target (KES)<input name="dailyTarget" type="number" min="0" step="1" value="${value("dailyTarget") || 0}"></label><label>Balance (KES)<input name="balance" type="number" min="0" step="1" value="${value("balance") || 0}"></label><label>Payment date<input name="date" type="date" value="${value("date")}"></label><label>Agent name<input name="agent" value="${value("agent")}"></label><label>Agent code<input name="agentCode" value="${value("agentCode")}"></label><label>PAYGO account<input name="paygoAccount" value="${value("paygoAccount")}"></label></div><div class="payment-editor-actions"><button class="button button-secondary" type="button" data-close-payment-editor>Cancel</button><button class="button button-primary" type="submit">Save payment</button></div></form></aside></div>`;
  }

  function paymentsPage() {
    return `<section class="payments-workspace"><div class="section-heading payments-page-heading"><div><div class="eyebrow"><i></i> OPERATIONS</div><h2>Payments</h2><p>Review and correct customer finance payments.</p></div><button class="button button-primary payment-add" data-add-payment>+ Add payment</button></div><section class="card payment-panel"><div class="payment-heading"><div><h3>Payment records (<span id="payment-count">${data.payments.length}</span>)</h3><p>Scroll sideways to view every payment and account field.</p></div><div class="toolbar"><label class="payment-search"><span aria-hidden="true">⌕</span><input id="payment-search" placeholder="Search product payments" aria-label="Search product payments"></label>${bulkActions("payments")}</div></div>${data.payments.length ? "" : '<div class="payment-connect-note">No payments yet. Add a payment to begin managing customer finance records.</div>'}<div id="payment-list">${paymentRecords()}</div><div class="horizontal-scroll-hint">Scroll left and right to view all columns</div></section>${paymentEditor()}</section>`;
  }

  function reconciliationPage() {
    const rows = reconciliationRecords.map((record, index) => `<tr><td>${rowCheck("reconciliation", index)}</td><td><strong>${record[0]}</strong></td><td><strong>${record[1]}</strong></td><td>${record[2]}</td><td>${record[3]}</td><td><strong>${money(record[4])}</strong></td><td><strong>${money(record[5])}</strong></td><td><span class="match-status ${record[4] === record[5] ? "matched" : "mismatch"}">${record[4] === record[5] ? "Matched" : "Mismatch"}</span></td><td><button class="button danger-button" data-delete-reconciliation="${index}" type="button">Delete</button></td></tr>`).join("");
    return `<section class="reconciliation-workspace"><div class="reconcile-heading"><div><div class="reconcile-kicker"><i></i> Review activity</div><h2>Reconcile</h2><p>Match provider receipts with saved finance payment records.</p></div><div class="reconcile-actions"><button class="button reconcile-clear" data-clear-reconciliation ${reconciliationRecords.length ? "" : "disabled"}>Clear all</button><button class="button reconcile-run" data-run-reconciliation><span aria-hidden="true">↻</span> Run check</button></div></div>${reconciliationMessage ? `<div class="reconcile-message">${escapeHtml(reconciliationMessage)}</div>` : ""}<section class="card reconcile-panel"><div class="reconcile-panel-title"><span>Receipt comparison <b>${reconciliationRecords.length} records</b></span><div class="toolbar"><label class="table-search"><span aria-hidden="true">⌕</span><input id="reconciliation-search" placeholder="Search receipts, customers" aria-label="Search reconciliation"></label>${bulkActions("reconciliation")}</div></div>${reconciliationRecords.length ? `<div class="reconcile-table-wrap"><table class="reconcile-table searchable-table"><thead><tr><th>${selectAll("reconciliation")}</th><th>Receipt</th><th>Customer</th><th>Date</th><th>National ID</th><th>Provider</th><th>Recorded</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>` : empty("No receipts to reconcile", "Run a new check when provider receipts are available.")}</section></section>`;
  }

  function reportsPage() {
    return `<section class="reports-workspace"><section class="card reports-export-card"><div><h2>Reports & exports</h2><p>Choose a reporting period or use the third control for one specific day.</p><div class="report-controls"><select id="report-dataset" aria-label="Data to export"><option value="all">All operational data</option><option value="payments">Payments</option><option value="accounts">Finance accounts</option><option value="commissions">Commissions</option><option value="reconciliation">Reconciliation</option><option value="alerts">Alerts</option><option value="audit">Audit logs</option></select><select id="report-period" aria-label="Report period"><option value="day">Daily</option><option value="week">Weekly</option><option value="month" selected>Monthly</option><option value="year">Yearly</option></select><input id="report-date" type="date" aria-label="Specific report date" title="Choose one specific day"></div></div><div class="report-actions"><button class="button button-secondary" type="button" data-print-reconciliation>Reconciliation PDF</button><button class="button report-export-button" type="button" data-export-report>Export data</button></div></section><section class="card reports-reconciliation-card"><div class="card-header"><div><div class="card-title">Structured reconciliation PDF</div><div class="card-subtitle">Creates a print-ready page with receipts, customers, payments, commission totals, and mismatch status.</div></div></div>${reconciliationRecords.length ? reconciliationPage() : empty("No reconciliation data", "Run reconciliation before printing.")}</section></section>`;
  }

  function exportFinanceReport() {
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
    if (dataset === "all" || dataset === "reconciliation") reconciliationRecords.forEach(record => add("reconciliation", { receipt: record[0], customer: record[1], date: record[2], national_id: record[3], provider: record[4], recorded: record[5], status: record[4] === record[5] ? "Matched" : "Mismatch" }));
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
    data.auditLogs.unshift({ time: new Date().toLocaleString(), action: "Finance report exported", details: `${rows.length} ${dataset} record(s)` });
    saveData(data);
  }

  function printReconciliationPdf() {
    const rows = reconciliationRecords.map(record => `<tr><td>${escapeHtml(record[0])}</td><td>${escapeHtml(record[1])}</td><td>${escapeHtml(record[2])}</td><td>${escapeHtml(record[3])}</td><td>${money(record[4])}</td><td>${money(record[5])}</td><td>${record[4] === record[5] ? "Matched" : "Mismatch"}</td></tr>`).join("");
    const paid = data.payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const commission = commissionRows().reduce((sum, row) => sum + row.commission, 0);
    const win = window.open("", "_blank");
    win.document.write(`<!doctype html><html><head><title>Jixels Finance Reconciliation</title><style>body{font-family:Arial,sans-serif;margin:28px;color:#173e5b}h1{margin:0 0 4px;font-size:22px}.meta{color:#68808e;font-size:12px}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:20px 0}.card{border:1px solid #dce8f0;border-radius:8px;padding:12px}.card span{display:block;color:#7893a2;font-size:10px;text-transform:uppercase}.card strong{display:block;margin-top:6px;font-size:16px}table{width:100%;border-collapse:collapse;font-size:11px}th,td{padding:8px;border-bottom:1px solid #dce8f0;text-align:left}th{background:#f3f8fc;color:#58717f}@media print{button{display:none}}</style></head><body><h1>Jixels Finance Reconciliation</h1><p class="meta">Generated ${new Date().toLocaleString()}</p><section class="cards"><div class="card"><span>Payment rows</span><strong>${data.payments.length}</strong></div><div class="card"><span>Collections</span><strong>${money(paid)}</strong></div><div class="card"><span>Commission</span><strong>${money(commission)}</strong></div><div class="card"><span>Receipts checked</span><strong>${reconciliationRecords.length}</strong></div></section><table><thead><tr><th>Receipt</th><th>Customer</th><th>Date</th><th>National ID</th><th>Provider</th><th>Recorded</th><th>Status</th></tr></thead><tbody>${rows || "<tr><td colspan='7'>No reconciliation rows.</td></tr>"}</tbody></table><button onclick="window.print()">Print / Save PDF</button></body></html>`);
    win.document.close();
    data.auditLogs.unshift({ time: new Date().toLocaleString(), action: "Reconciliation PDF prepared", details: `${reconciliationRecords.length} receipt rows` });
    saveData(data);
  }

  function alertsPage() {
    const rows = data.alerts.map(alert => `<tr><td>${rowCheck("alerts", alert.id)}</td><td><strong>${escapeHtml(alert.title)}</strong><small>${escapeHtml(alert.detail)}</small></td><td>${escapeHtml(alert.severity)}</td><td>${alert.resolved ? "Resolved" : "Open"}</td><td>${escapeHtml(alert.time)}</td><td><div class="row-actions">${alert.resolved ? "" : `<button class="button button-secondary" data-resolve-alert="${escapeHtml(alert.id)}">Resolve</button>`}<button class="button danger-button" data-delete-alert="${escapeHtml(alert.id)}" type="button">Delete</button></div></td></tr>`).join("");
    const open = data.alerts.filter(alert => !alert.resolved);
    const critical = open.filter(alert => alert.severity === "critical");
    return `<section class="finance-module"><div class="section-heading"><div><div class="eyebrow"><i></i> ACTIVITY CENTER</div><h2>Alerts</h2><p>Resolve finance alerts only after payment, reconciliation, or commission review.</p></div></div><div class="metrics">${metric("Open alerts", open.length, "Finance items needing action", "orange")}${metric("Critical alerts", critical.length, "High-priority collection risk", "red")}${metric("Unread notices", data.notifications.filter(item => item.unread).length, "Topbar notification items", "blue")}${metric("Audit records", data.auditLogs.length, "Finance actions recorded", "green")}</div><section class="card module-table"><div class="card-header table-card-header"><div><div class="card-title">Finance alert register</div><div class="card-subtitle">Payments, reconciliation, overdue accounts, and commission approvals.</div></div><div class="toolbar"><label class="table-search"><span aria-hidden="true">⌕</span><input id="alerts-search" placeholder="Search alerts" aria-label="Search alerts"></label>${bulkActions("alerts")}</div></div><div class="table-wrap limited-table-wrap"><table class="searchable-table"><thead><tr><th>${selectAll("alerts")}</th><th>Alert</th><th>Severity</th><th>Status</th><th>Time</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div></section></section>`;
  }

  function settingsPage() {
    const checked = key => data.settings[key] ? "checked" : "";
    return `<section class="settings-layout"><div class="settings-intro"><div><span class="eyebrow">WORKSPACE CONTROLS</span><h2>Settings</h2><p>Manage finance account rules, commission rules, reconciliation notifications, security, and export controls.</p></div><button class="button button-primary" data-save-settings>Save changes</button></div><form id="settings-form" class="settings-grid"><article class="card settings-card"><div class="settings-card-title"><span>${icons.accounts}</span><div><h2>My account</h2></div></div><label>Display name<input name="displayName" value="${escapeHtml(session?.name || "")}"></label><label>Email<input value="${escapeHtml(session?.email || "")}" disabled></label><p class="settings-hint">Finance login, session, and audit controls are separated from operational admin access.</p></article><article class="card settings-card"><div class="settings-card-title"><span>${icons.dashboard}</span><div><h2>Workspace</h2></div></div><label>Workspace name<input name="workspaceName" value="${escapeHtml(data.settings.workspaceName)}"></label><label>Timezone<select name="timezone"><option ${data.settings.timezone === "Africa/Nairobi" ? "selected" : ""}>Africa/Nairobi</option><option ${data.settings.timezone === "UTC" ? "selected" : ""}>UTC</option><option ${data.settings.timezone === "Europe/London" ? "selected" : ""}>Europe/London</option></select></label><label>Default currency<select name="currency"><option ${data.settings.currency === "KES" ? "selected" : ""}>KES</option><option ${data.settings.currency === "USD" ? "selected" : ""}>USD</option><option ${data.settings.currency === "EUR" ? "selected" : ""}>EUR</option></select></label></article><article class="card settings-card"><div class="settings-card-title"><span>${icons.alerts}</span><div><h2>Notifications</h2></div></div><label class="setting-toggle"><span><strong>Payment updates</strong><small>Notify finance when customer payments are added or edited.</small></span><input name="notifyPayments" type="checkbox" ${checked("notifyPayments")}><i></i></label><label class="setting-toggle"><span><strong>Reconciliation results</strong><small>Notify finance after provider receipt matching.</small></span><input name="notifyReconciliation" type="checkbox" ${checked("notifyReconciliation")}><i></i></label><label class="setting-toggle"><span><strong>Commission approvals</strong><small>Notify agents and finance when commission totals change.</small></span><input name="notifyCommissions" type="checkbox" ${checked("notifyCommissions")}><i></i></label></article><article class="card settings-card"><div class="settings-card-title"><span>${icons.payments}</span><div><h2>Finance rules</h2></div></div><label>Commission rate (%)<input name="commissionRate" type="number" min="0" max="100" value="${escapeHtml(data.settings.commissionRate)}"></label><label>Daily collection target<input name="dailyCollectionTarget" type="number" min="0" value="${escapeHtml(data.settings.dailyCollectionTarget)}"></label><label>Overdue grace days<input name="overdueGraceDays" type="number" min="0" value="${escapeHtml(data.settings.overdueGraceDays)}"></label></article><article class="card settings-card"><div class="settings-card-title"><span>${icons.settings}</span><div><h2>Security</h2></div></div><label>Session timeout (minutes)<input name="sessionTimeoutMinutes" type="number" min="5" value="${escapeHtml(data.settings.sessionTimeoutMinutes)}"></label><p class="settings-hint">Finance actions remain in Audit Logs after payment edits, reconciliation checks, and settings changes.</p></article><article class="card settings-card"><div class="settings-card-title"><span>${icons.reports}</span><div><h2>Data & integrations</h2></div></div><label>Export retention (days)<input name="exportRetentionDays" type="number" min="1" value="${escapeHtml(data.settings.exportRetentionDays)}"></label><p class="settings-hint">Reports, reconciliation PDFs, and payment exports use the configured finance workspace rules.</p></article></form></section>`;
  }

  function auditPage() {
    const rows = data.auditLogs.map((log, index) => `<tr><td>${rowCheck("audit", index)}</td><td>${escapeHtml(log.action)}</td><td>${escapeHtml(log.details)}</td><td>${escapeHtml(log.time)}</td><td><button class="button danger-button" data-delete-audit="${index}" type="button">Delete</button></td></tr>`).join("");
    return `<section class="finance-module"><div class="section-heading"><div><h2>Audit Logs</h2><p>Immutable finance activity for payment edits, reconciliation, settings, alerts, and reports.</p></div></div><section class="card module-table"><div class="card-header table-card-header"><div><div class="card-title">Finance audit trail</div><div class="card-subtitle">Browser-local audit records until a backend is connected.</div></div><div class="toolbar"><label class="table-search"><span aria-hidden="true">⌕</span><input id="audit-search" placeholder="Search logs" aria-label="Search audit logs"></label>${bulkActions("audit")}</div></div>${data.auditLogs.length ? `<div class="table-wrap limited-table-wrap"><table class="searchable-table"><thead><tr><th>${selectAll("audit")}</th><th>Action</th><th>Details</th><th>Time</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>` : empty("No audit records yet", "Finance actions will appear here.")}</section></section>`;
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

  function view() { return page === "dashboard" ? dashboard() : page === "commissions" ? commissionsPage() : page === "accounts" ? accountsPage() : page === "payments" ? paymentsPage() : page === "reconciliation" ? reconciliationPage() : page === "reports" ? reportsPage() : page === "alerts" ? alertsPage() : page === "settings" ? settingsPage() : page === "audit" ? auditPage() : simplePage(); }

  function commissionModal() {
    if (!commissionDialog) return "";
    const items = commissionDialog.customers.map(customer => `<li><strong>${escapeHtml(customer.name)}</strong><span>${escapeHtml(customer.product || "No tracker")}</span></li>`).join("");
    return `<div class="finance-side-backdrop" data-close-commission-modal><aside class="finance-side-panel" role="dialog" aria-modal="true" aria-labelledby="commission-modal-title"><div class="finance-modal-heading"><div><span>AGENT CUSTOMERS</span><h3 id="commission-modal-title">${escapeHtml(commissionDialog.agent)}</h3><p>${escapeHtml(commissionDialog.code)}</p></div><button type="button" data-close-commission-modal aria-label="Close">×</button></div><div class="finance-modal-body">${items ? `<ul class="commission-customer-list">${items}</ul>` : `<div class="commission-empty">${escapeHtml(commissionDialog.agent)} has no customer sales yet.</div>`}</div><div class="finance-modal-actions"><button class="button button-primary" type="button" data-close-commission-modal>OK</button></div></aside></div>`;
  }

  function loadingView() {
    if (loadingMode === "page") return `<div class="finance-loading"><div class="finance-loading-brand"><strong>Jixels Finance</strong><small>Loading workspace records…</small></div><div class="finance-skeleton-heading skeleton"></div><div class="finance-skeleton-metrics">${Array.from({ length: 4 }, () => '<div class="skeleton"></div>').join("")}</div><div class="finance-skeleton-panel skeleton">${Array.from({ length: 5 }, () => '<span></span>').join("")}</div></div>`;
    return `<div class="finance-launch"><div class="finance-launch-stage"><div class="finance-launch-ring">⌖</div><div class="finance-launch-road"></div><span class="launch-finance-car">🚗</span><span class="launch-finance-bike">🏍</span><span class="launch-finance-tuktuk">TUK</span></div><small>WELCOME TO JIXELS FINANCE</small><h1>Connecting your finance workspace</h1><p>Please wait while accounts, payments, and live tracker records are prepared. You will be redirected in <strong id="finance-launch-countdown">${launchSeconds}</strong> seconds.</p><div class="finance-launch-dots"><i></i><i></i><i></i></div></div>`;
  }

  function offlineView() {
    return `<main class="finance-offline"><div class="finance-offline-icon">⌁</div><div class="finance-offline-road"><i class="vehicle-one">●</i><i class="vehicle-two">●</i><i class="vehicle-three">●</i></div><h1>Network is down</h1><p>Live finance records require an internet connection. Reconnect before opening the workspace.</p><button class="offline-retry" data-retry>Check connection</button></main>`;
  }

  function render() {
    if (!online) { root.innerHTML = offlineView(); bindOfflineEvents(); return; }
    if (loading) { root.innerHTML = loadingView(); return; }
    if (!session) { root.innerHTML = loginView(); bindLoginEvents(); return; }
    const currentLabel = navigation.find(item => item[0] === page)[2];
    const noticeRows = data.notifications.map(item => `<button class="notification-item ${item.unread ? "unread" : ""}" data-mark-notifications><span class="notification-dot"></span><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail)}</small><time>${escapeHtml(item.time)}</time></span></button>`).join("");
    const userEmail = session?.email || "";
    const userName = session?.name || userEmail.split("@")[0] || "Finance user";
    const initials = userName.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase() || "FU";
    root.innerHTML = `<div class="app ${sidebarCollapsed ? "sidebar-collapsed" : ""}"><aside class="sidebar ${sidebarOpen ? "open" : ""} ${sidebarCollapsed ? "collapsed" : ""}"><div class="sidebar-header"><button class="sidebar-toggle" data-collapse aria-label="Toggle navigation">${icons.menu}</button><div class="brand"><img class="finance-brand-logo" src="./assets/jixels-form-ni-tenje.svg?v=3" alt="Jixels Form Ni Tenje"></div></div><nav class="nav">${navigation.map(([id, navIcon, label], index) => `${index === 0 ? '<div class="nav-section">FINANCE</div>' : index === 6 ? '<div class="nav-section">REPORTING</div>' : index === 8 ? '<div class="nav-section">ADMIN</div>' : ''}<button data-go="${id}" class="${page === id ? "active" : ""}" title="${label}" aria-label="${label}"><span class="nav-icon">${navIcon}</span><span class="nav-label">${label}</span></button>`).join("")}</nav><div class="sidebar-footer"><button data-logout>${icons.logout}<span>Logout</span></button></div></aside>${sidebarOpen ? '<button class="scrim" data-close-menu aria-label="Close menu"></button>' : ""}<main class="main"><header class="topbar"><button class="menu-button" data-menu aria-label="Open navigation">${icons.menu}</button><div class="topbar-actions"><button class="notification-button ${data.notifications.some(item => item.unread) ? "has-unread" : ""}" data-notifications aria-label="Notifications">${icons.alerts}</button><div class="top-profile"><span class="user-avatar">${escapeHtml(initials)}</span><span><strong>${escapeHtml(userName)}</strong><small>${escapeHtml(userEmail || "Finance workspace")}</small></span></div></div>${notificationsOpen ? `<div class="notification-panel"><div class="notification-panel-heading"><strong>Notifications</strong><button data-mark-notifications>Mark all read</button></div><div class="notification-list">${noticeRows || "<p>No finance notifications.</p>"}</div><button data-go="alerts">View alert center</button></div>` : ""}</header><div class="content">${view()}</div><footer class="system-footer"><span><strong>JIXELS FINANCE</strong> · Form Ni Tenje · Finance workspace</span><span>© 2026 Jixels Technologies</span></footer></main></div>${commissionModal()}`;
    bindEvents();
  }

  function bindLoginEvents() {
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
          session = await registerFinanceUser({ name, email, phone, password });
        } else {
          session = await authenticateFinanceUser(email, password);
        }
        startWorkspaceLoading();
      } catch (error) {
        root.innerHTML = loginView(safeLoginMessage(error));
        bindLoginEvents();
      }
    });
  }

  function startWorkspaceLoading() {
    loading = true; loadingMode = "launch"; launchSeconds = 7; render();
    const launchCountdown = window.setInterval(() => {
      launchSeconds = Math.max(launchSeconds - 1, 0);
      const countdown = document.getElementById("finance-launch-countdown");
      if (countdown) countdown.textContent = String(launchSeconds);
      if (launchSeconds === 0) window.clearInterval(launchCountdown);
    }, 1000);
    window.setTimeout(() => {
      window.clearInterval(launchCountdown); loadingMode = "page"; render();
      window.setTimeout(() => { loading = false; render(); }, 1200);
    }, 7_000);
  }

  function bindOfflineEvents() {
    root.querySelector("[data-retry]")?.addEventListener("click", () => { online = navigator.onLine; render(); });
  }

  function openPage(nextPage) {
    page = nextPage; sidebarOpen = false; if (window.innerWidth > 760) sidebarCollapsed = true; loading = true; loadingMode = "page"; render();
    window.setTimeout(() => { loading = false; render(); }, 320);
  }

  function updateAccountList() {
    const search = document.getElementById("account-search").value.toLowerCase();
    const filter = document.getElementById("account-filter").value;
    const results = data.accounts.filter(account => `${account.customer} ${account.bike} ${account.id}`.toLowerCase().includes(search) && (!filter || account.status === filter));
    document.getElementById("account-list").innerHTML = accountTable(results, true);
    bindRemoveButtons();
    bindSelectionControls();
  }

  function bindRemoveButtons() {
    document.querySelectorAll("[data-remove-account]").forEach(button => button.addEventListener("click", () => {
      if (!window.confirm("Delete this finance account?")) return;
      data.accounts = data.accounts.filter(account => account.id !== button.dataset.removeAccount);
      data.auditLogs.unshift({ time: new Date().toLocaleString(), action: "Account deleted", details: button.dataset.removeAccount });
      saveData(data); updateAccountList();
    }));
    document.querySelectorAll("[data-edit-account]").forEach(button => button.addEventListener("click", () => {
      editingAccountId = button.dataset.editAccount;
      render();
    }));
  }

  function selectedRows(scope) {
    return [...document.querySelectorAll(`[data-select-row="${scope}"]:checked`)].map(input => input.value);
  }

  function deleteByScope(scope, ids) {
    if (!ids.length) return;
    if (scope === "accounts") data.accounts = data.accounts.filter(item => !ids.includes(item.id));
    if (scope === "payments") data.payments = data.payments.filter(item => !ids.includes(item.id));
    if (scope === "alerts") data.alerts = data.alerts.filter(item => !ids.includes(item.id));
    if (scope === "audit") data.auditLogs = data.auditLogs.filter((_, index) => !ids.includes(String(index)));
    if (scope === "reconciliation") {
      reconciliationRecords = reconciliationRecords.filter((_, index) => !ids.includes(String(index)));
      reconciliationMessage = `${ids.length} reconciliation record${ids.length === 1 ? "" : "s"} deleted.`;
    }
    if (scope !== "audit") data.auditLogs.unshift({ time: new Date().toLocaleString(), action: `${scope} deleted`, details: `${ids.length} record${ids.length === 1 ? "" : "s"}` });
    saveData(data);
    render();
  }

  function bindSelectionControls() {
    document.querySelectorAll("[data-select-all]").forEach(input => input.addEventListener("change", () => {
      document.querySelectorAll(`[data-select-row="${input.dataset.selectAll}"]`).forEach(rowInput => { rowInput.checked = input.checked; });
    }));
    document.querySelectorAll("[data-delete-selected]").forEach(button => button.addEventListener("click", () => {
      const scope = button.dataset.deleteSelected;
      const ids = selectedRows(scope);
      if (!ids.length) { window.alert("Select at least one record first."); return; }
      if (window.confirm(`Delete ${ids.length} selected ${scope} record${ids.length === 1 ? "" : "s"}?`)) deleteByScope(scope, ids);
    }));
    document.querySelectorAll("[data-delete-all]").forEach(button => button.addEventListener("click", () => {
      const scope = button.dataset.deleteAll;
      const ids = [...document.querySelectorAll(`[data-select-row="${scope}"]`)].map(input => input.value);
      if (!ids.length) return;
      if (window.confirm(`Delete all ${ids.length} ${scope} records shown on this page?`)) deleteByScope(scope, ids);
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
    document.querySelectorAll("[data-go]").forEach(button => button.addEventListener("click", () => openPage(button.dataset.go)));
    const menu = document.querySelector("[data-menu]");
    if (menu) menu.addEventListener("click", () => { sidebarOpen = true; render(); });
    document.querySelector("[data-close-menu]")?.addEventListener("click", () => { sidebarOpen = false; render(); });
    document.querySelector("[data-collapse]")?.addEventListener("click", () => { if (window.innerWidth <= 760) sidebarOpen = false; else sidebarCollapsed = !sidebarCollapsed; render(); });
    document.querySelector(".main")?.addEventListener("pointerdown", () => {
      if (window.innerWidth > 760 && !sidebarCollapsed) {
        sidebarCollapsed = true;
        document.querySelector(".app")?.classList.add("sidebar-collapsed");
        document.querySelector(".sidebar")?.classList.add("collapsed");
      }
    });
    document.querySelectorAll("[data-notifications]").forEach(button => button.addEventListener("click", () => { notificationsOpen = !notificationsOpen; render(); }));
    document.querySelectorAll("[data-mark-notifications]").forEach(button => button.addEventListener("click", () => {
      data.notifications = data.notifications.map(item => ({ ...item, unread: false }));
      saveData(data);
      render();
    }));
    document.querySelector("[data-logout]")?.addEventListener("click", () => { session = null; render(); });
    document.querySelector("[data-print-reconciliation]")?.addEventListener("click", printReconciliationPdf);
    document.querySelector("[data-export-report]")?.addEventListener("click", exportFinanceReport);
    document.querySelector(".commission-table")?.addEventListener("click", event => {
      const viewButton = event.target.closest("[data-view-agent]");
      const payButton = event.target.closest("[data-pay-commission]");
      const deleteButton = event.target.closest("[data-delete-agent]");
      const code = viewButton?.dataset.viewAgent || payButton?.dataset.payCommission || deleteButton?.dataset.deleteAgent;
      if (!code) return;
      const row = commissionRows().find(item => item.code === code);
      if (!row) return;
      if (viewButton) {
        if (!row.customerList.length) {
          window.alert(`${row.agent} has no customer sales yet.`);
          return;
        }
        commissionDialog = { agent: row.agent, code: row.code, customers: row.customerList };
        render();
      }
      if (payButton && row.commission && window.confirm(`Pay ${money(row.commission)} commission to ${row.agent}?`)) {
        data.auditLogs.unshift({ time: new Date().toLocaleString(), action: "Commission paid", details: `${row.agent} (${row.code}) - ${money(row.commission)}` });
        data.notifications.unshift({ id: `N-${Date.now()}`, title: "Commission paid", detail: `${row.agent} received ${money(row.commission)}.`, unread: true, time: "Just now" });
        saveData(data);
        render();
      }
      if (deleteButton && window.confirm(`Delete ${row.agent} from the commission register? This also removes linked payment rows for this agent.`)) {
        data.payments = data.payments.filter(payment => agentCode(payment) !== row.code);
        data.agents = data.agents.filter(agent => agent.code !== row.code);
        data.auditLogs.unshift({ time: new Date().toLocaleString(), action: "Commission records deleted", details: `${row.agent} (${row.code})` });
        saveData(data);
        render();
      }
    });
    document.getElementById("commission-search")?.addEventListener("input", event => {
      const query = event.currentTarget.value.trim().toLowerCase();
      document.querySelectorAll(".commission-table tbody tr").forEach(row => {
        row.hidden = query ? !row.textContent.toLowerCase().includes(query) : false;
      });
    });
    bindTableSearch("reconciliation-search", ".reconcile-table");
    bindTableSearch("alerts-search", ".module-table .searchable-table");
    bindTableSearch("audit-search", ".module-table .searchable-table");
    document.querySelectorAll("[data-resolve-alert]").forEach(button => button.addEventListener("click", () => {
      const alert = data.alerts.find(item => item.id === button.dataset.resolveAlert);
      data.alerts = data.alerts.map(item => item.id === button.dataset.resolveAlert ? { ...item, resolved: true } : item);
      data.auditLogs.unshift({ time: new Date().toLocaleString(), action: "Finance alert resolved", details: alert?.title || button.dataset.resolveAlert });
      data.notifications.unshift({ id: `N-${Date.now()}`, title: "Finance alert resolved", detail: alert?.title || "Alert closed", unread: true, time: "Just now" });
      saveData(data);
      render();
    }));
    document.querySelectorAll("[data-delete-alert]").forEach(button => button.addEventListener("click", () => {
      if (!window.confirm("Delete this finance alert?")) return;
      const alert = data.alerts.find(item => item.id === button.dataset.deleteAlert);
      data.alerts = data.alerts.filter(item => item.id !== button.dataset.deleteAlert);
      data.auditLogs.unshift({ time: new Date().toLocaleString(), action: "Finance alert deleted", details: alert?.title || button.dataset.deleteAlert });
      saveData(data);
      render();
    }));
    document.querySelectorAll("[data-close-commission-modal]").forEach(element => element.addEventListener("click", event => {
      if (event.target === element || element.tagName === "BUTTON") {
        commissionDialog = null;
        render();
      }
    }));
    document.getElementById("settings-form")?.addEventListener("submit", event => event.preventDefault());
    document.querySelector("[data-save-settings]")?.addEventListener("click", () => {
      const form = new FormData(document.getElementById("settings-form"));
      data.settings = {
        workspaceName: form.get("workspaceName"),
        timezone: form.get("timezone"),
        currency: form.get("currency"),
        commissionRate: form.get("commissionRate"),
        dailyCollectionTarget: form.get("dailyCollectionTarget"),
        overdueGraceDays: form.get("overdueGraceDays"),
        exportRetentionDays: form.get("exportRetentionDays"),
        sessionTimeoutMinutes: form.get("sessionTimeoutMinutes"),
        notifyPayments: form.has("notifyPayments"),
        notifyReconciliation: form.has("notifyReconciliation"),
        notifyCommissions: form.has("notifyCommissions")
      };
      session = { ...session, name: form.get("displayName") || session?.name || "" };
      data.auditLogs.unshift({ time: new Date().toLocaleString(), action: "Finance settings updated", details: `${data.settings.workspaceName} · ${data.settings.commissionRate}% commission` });
      data.notifications.unshift({ id: `N-${Date.now()}`, title: "Finance settings saved", detail: "Commission, reports, alerts, and security controls updated.", unread: true, time: "Just now" });
      saveData(data);
      render();
    });
    const form = document.getElementById("account-form");
    if (form) form.addEventListener("submit", event => {
      event.preventDefault();
      const formData = new FormData(form); const total = Number(formData.get("total")); const paid = Number(formData.get("paid") || 0);
      const account = { id: editingAccountId || `ACC-${Date.now()}`, customer: formData.get("customer"), phone: formData.get("phone"), bike: formData.get("bike"), model: formData.get("model"), total, paid, balance: Math.max(total - paid, 0), status: formData.get("status") };
      if (editingAccountId) data.accounts = data.accounts.map(item => item.id === editingAccountId ? account : item);
      else data.accounts.unshift(account);
      data.auditLogs.unshift({ time: new Date().toLocaleString(), action: editingAccountId ? "Account modified" : "Account created", details: account.id });
      editingAccountId = null;
      saveData(data); render();
    });
    document.querySelector("[data-cancel-account-edit]")?.addEventListener("click", () => { editingAccountId = null; render(); });
    const search = document.getElementById("account-search"); const filter = document.getElementById("account-filter");
    if (search) search.addEventListener("input", updateAccountList); if (filter) filter.addEventListener("change", updateAccountList);
    const paymentSearch = document.getElementById("payment-search");
    if (paymentSearch) paymentSearch.addEventListener("input", () => {
      const visible = data.payments.filter(payment => `${payment.id || ""} ${payment.account || ""} ${payment.customer || ""} ${payment.phone || ""}`.toLowerCase().includes(paymentSearch.value.toLowerCase()));
      document.getElementById("payment-count").textContent = String(visible.length);
      document.getElementById("payment-list").innerHTML = paymentRecords(paymentSearch.value);
    });
    document.querySelector("[data-add-payment]")?.addEventListener("click", () => { editingPaymentId = "new"; render(); });
    document.getElementById("payment-list")?.addEventListener("click", event => {
      const editButton = event.target.closest("[data-edit-payment]");
      const deleteButton = event.target.closest("[data-delete-payment]");
      if (editButton) { editingPaymentId = editButton.dataset.editPayment; render(); }
      if (deleteButton && window.confirm("Delete this payment record?")) {
        const payment = data.payments.find(item => item.id === deleteButton.dataset.deletePayment);
        data.payments = data.payments.filter(item => item.id !== deleteButton.dataset.deletePayment);
        data.auditLogs.unshift({ time: new Date().toLocaleString(), action: "Payment deleted", details: payment?.receipt || deleteButton.dataset.deletePayment });
        saveData(data);
        render();
      }
    });
    document.querySelectorAll("[data-close-payment-editor]").forEach(element => element.addEventListener("click", event => {
      if (event.target === element || element.tagName === "BUTTON") { editingPaymentId = null; render(); }
    }));
    document.querySelector(".payment-editor")?.addEventListener("click", event => event.stopPropagation());
    document.getElementById("payment-editor-form")?.addEventListener("submit", event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const numeric = key => Math.max(0, Number(form.get(key) || 0));
      const updated = { id: editingPaymentId === "new" ? `PAY-${Date.now()}` : editingPaymentId, customer: form.get("customer").trim(), phone: form.get("phone").trim(), receipt: form.get("receipt").trim(), product: form.get("product").trim(), health: form.get("health"), status: form.get("status"), overdue: numeric("overdue"), deposit: numeric("deposit"), paygoPayment: numeric("paygoPayment"), amount: numeric("amount"), dailyTarget: numeric("dailyTarget"), balance: numeric("balance"), date: form.get("date"), agent: form.get("agent").trim(), agentCode: form.get("agentCode").trim(), paygoAccount: form.get("paygoAccount").trim() };
      if (editingPaymentId === "new") data.payments.unshift(updated);
      else data.payments = data.payments.map(payment => payment.id === editingPaymentId ? { ...payment, ...updated } : payment);
      data.auditLogs.unshift({ time: new Date().toLocaleString(), action: editingPaymentId === "new" ? "Payment added" : "Payment edited", details: `${updated.receipt} • ${updated.customer}` });
      saveData(data); editingPaymentId = null; render();
    });
    document.querySelector("[data-run-reconciliation]")?.addEventListener("click", () => {
      const matched = reconciliationRecords.filter(record => record[4] === record[5]).length;
      reconciliationMessage = `Check complete: ${matched} of ${reconciliationRecords.length} receipts matched.`;
      render();
    });
    document.querySelector("[data-clear-reconciliation]")?.addEventListener("click", () => {
      if (!window.confirm("Delete all reconciliation records?")) return;
      reconciliationRecords = [];
      reconciliationMessage = "All reconciliation records cleared.";
      render();
    });
    document.querySelectorAll("[data-delete-reconciliation]").forEach(button => button.addEventListener("click", () => {
      if (!window.confirm("Delete this reconciliation row?")) return;
      reconciliationRecords = reconciliationRecords.filter((_, index) => index !== Number(button.dataset.deleteReconciliation));
      reconciliationMessage = "Reconciliation record deleted.";
      render();
    }));
    document.querySelectorAll("[data-delete-audit]").forEach(button => button.addEventListener("click", () => {
      if (!window.confirm("Delete this audit log entry?")) return;
      data.auditLogs = data.auditLogs.filter((_, index) => index !== Number(button.dataset.deleteAudit));
      saveData(data);
      render();
    }));
    bindRemoveButtons();
    bindSelectionControls();
  }

  window.addEventListener("online", () => { online = true; render(); });
  window.addEventListener("offline", () => { online = false; render(); });
  if (session) startWorkspaceLoading();
  else render();
})();
