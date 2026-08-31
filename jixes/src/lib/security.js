const AUDIT_KEY = "jixels_admin_audit";

const rolePermissions = {
  "Super administrator": ["*"],
  "Operations manager": ["Dashboard", "Customers", "Products", "GPS Trackers", "Screening", "Support Cases", "Alerts", "Reports"],
  "Finance officer": ["Dashboard", "Customers", "Payments", "Commissions", "Reports"],
  "Support agent": ["Dashboard", "Customers", "Products", "GPS Trackers", "Screening", "Support Cases", "Alerts", "Commissions"],
  "Read-only auditor": ["Dashboard", "Reports", "Audit Logs"]
};

const roleAliases = {
  super_admin: "Super administrator",
  operations_manager: "Operations manager",
  finance_officer: "Finance officer",
  support_agent: "Support agent",
  read_only_auditor: "Read-only auditor"
};

export function canAccess(role, resource) {
  const permissions = rolePermissions[roleAliases[role] || role] || [];
  return permissions.includes("*") || permissions.includes(resource);
}

export function recordAudit({ action, resource, detail = "" }) {
  const entry = {
    id: crypto.randomUUID(),
    action,
    resource,
    detail,
    timestamp: new Date().toISOString()
  };
  try {
    const existing = JSON.parse(localStorage.getItem(AUDIT_KEY) || "[]");
    localStorage.setItem(AUDIT_KEY, JSON.stringify([entry, ...existing].slice(0, 500)));
  } catch {
    // Audit persistence must not prevent the primary action from completing.
  }
  // The browser cache is a resilience fallback; the database is the source of truth.
  import("./data").then(({ createRecord, hasSupabaseConfig }) => {
    if (hasSupabaseConfig) createRecord("audit_logs", { action, resource, detail: typeof detail === "string" ? { message: detail } : detail });
  }).catch(() => {});
  return entry;
}

export function getAuditEvents() {
  try {
    return JSON.parse(localStorage.getItem(AUDIT_KEY) || "[]");
  } catch {
    return [];
  }
}
