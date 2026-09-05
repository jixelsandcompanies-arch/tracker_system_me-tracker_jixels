import React, { useEffect, useState } from "react";
import { getSession, signIn, signOut, touchSession } from "./lib/auth";
import { canAccess, recordAudit } from "./lib/security";
import { createRecord, hasSupabaseConfig, listRecords, subscribeToTable, updateRecord } from "./lib/data";
import EnhancedModuleView from "./components/EnhancedModuleView";
import DashboardLiveView from "./components/DashboardLiveView";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  BadgeDollarSign,
  Bike,
  CarFront,
  Bell,
  ClipboardList,
  CreditCard,
  Database,
  FileClock,
  Gauge,
  LayoutDashboard,
  Link2,
  LogOut,
  MapPin,
  MessageCircle,
  Menu,
  MoreHorizontal,
  Radio,
  Search,
  Settings,
  ShieldCheck,
  Users,
  Wifi,
  X,
  Zap
} from "lucide-react";
import "./styles/variables.css";
import "./styles/global.css";
import "./styles/palette.css";
import "./styles/responsive.css";
import "./styles/auth.css";
import "./styles/spec.css";
import "./styles/brand.css";
import "./styles/chrome.css";
import "./styles/device.css";
import "./styles/notifications.css";
import "./styles/directory.css";
import "./styles/details.css";
import "./styles/errors.css";

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    recordAudit({ action: "application error", resource: "Application", detail: error.message });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const detail = this.state.error instanceof Error ? this.state.error.message : "Unexpected workspace error";
    return <main className="app-error"><span className="brand-mark"><Zap size={17} fill="currentColor" /></span><h1>Something went wrong</h1><p>The workspace could not load this view. Your session is still protected.</p><code className="error-reference">{detail}</code><button className="button primary" onClick={() => window.location.reload()}>Reload workspace</button><button className="button secondary" onClick={() => { signOut(); window.location.reload(); }}>Sign out and retry</button></main>;
  }
}

const navigation = [
  { label: "Dashboard", icon: LayoutDashboard, key: "Dashboard", section: "OVERVIEW" },
  { label: "Customers", icon: Users, key: "Customers", section: "OPERATIONS" },
  { label: "Product inventory", icon: Bike, key: "Products", section: "OPERATIONS" },
  { label: "GPS Trackers", icon: Radio, key: "GPS Trackers", section: "OPERATIONS" },
  { label: "Screening", icon: ClipboardList, key: "Screening", section: "OPERATIONS" },
  { label: "Support cases", icon: MessageCircle, key: "Support Cases", section: "OPERATIONS" },
  { label: "Payments", icon: CreditCard, key: "Payments", section: "FINANCE" },
  { label: "Commissions", icon: BadgeDollarSign, key: "Commissions", section: "FINANCE" },
  { label: "Customer accounts", icon: Users, key: "Customer Accounts", section: "ADMIN" },
  { label: "Account approvals", icon: ShieldCheck, key: "Users", section: "ADMIN" },
  { label: "Staff accounts", icon: Users, key: "Staff Accounts", section: "ADMIN" },
  { label: "Alerts", icon: Bell, key: "Alerts", section: "ADMIN" },
  { label: "Reports", icon: BarChart3, key: "Reports", section: "ADMIN" },
  { label: "Settings", icon: Settings, key: "Settings", section: "SYSTEM" },
  { label: "Audit Logs", icon: FileClock, key: "Audit Logs", section: "SYSTEM" }
];

const quickAddPages = new Set(["Support Cases"]);
const ADMIN_NAVIGATION_KEY = "jixels.admin.navigation.v1";

function loadNavigation(role) {
  const fallback = canAccess(role, "Dashboard") ? "Dashboard" : "Payments";
  try {
    const saved = JSON.parse(localStorage.getItem(ADMIN_NAVIGATION_KEY) || "{}");
    const page = navigation.some((item) => item.key === saved.active) && canAccess(role, saved.active) ? saved.active : fallback;
    return { active: page, sidebarCollapsed: Boolean(saved.sidebarCollapsed) };
  } catch (error) {
    console.error("Could not restore admin navigation", error);
    return { active: fallback, sidebarCollapsed: false };
  }
}

// A fault in one database-backed module must not take down the entire admin
// workspace. Keeping this boundary at page scope means staff can continue to
// use the other menu items and retry the affected module.
class ModuleErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    recordAudit({ action: "module error", resource: this.props.module, detail: error.message });
  }

  componentDidUpdate(previousProps) {
    if (previousProps.module !== this.props.module && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <section className="panel module-table"><div className="panel-heading"><div><h2>{this.props.module} is unavailable</h2><p>This module could not be displayed. Your other admin modules are still available.</p></div></div><div className="import-message">{this.state.error.message || "The database response could not be displayed."}</div><button className="button primary" onClick={() => this.setState({ error: null })}>Retry {this.props.module}</button></section>;
  }
}

function useHorizontalTableScroll() {
  useEffect(() => {
    let drag = null;
    const findScroller = (target) => target instanceof Element ? target.closest(".table-wrap, .payment-scroll") : null;
    const wheel = (event) => {
      const scroller = findScroller(event.target);
      if (!scroller || scroller.scrollWidth <= scroller.clientWidth) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (!delta) return;
      event.preventDefault();
      scroller.scrollLeft += delta;
    };
    const pointerDown = (event) => {
      const scroller = findScroller(event.target);
      if (!scroller || scroller.scrollWidth <= scroller.clientWidth || event.pointerType !== "mouse" || event.target.closest("button, input, select, textarea, a")) return;
      drag = { scroller, pointerId: event.pointerId, x: event.clientX, left: scroller.scrollLeft };
      scroller.classList.add("is-dragging");
      scroller.setPointerCapture(event.pointerId);
    };
    const pointerMove = (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      drag.scroller.scrollLeft = drag.left - (event.clientX - drag.x);
    };
    const pointerUp = (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      drag.scroller.classList.remove("is-dragging");
      if (drag.scroller.hasPointerCapture(event.pointerId)) drag.scroller.releasePointerCapture(event.pointerId);
      drag = null;
    };
    document.addEventListener("wheel", wheel, { passive: false });
    document.addEventListener("pointerdown", pointerDown);
    document.addEventListener("pointermove", pointerMove);
    document.addEventListener("pointerup", pointerUp);
    document.addEventListener("pointercancel", pointerUp);
    return () => {
      document.removeEventListener("wheel", wheel);
      document.removeEventListener("pointerdown", pointerDown);
      document.removeEventListener("pointermove", pointerMove);
      document.removeEventListener("pointerup", pointerUp);
      document.removeEventListener("pointercancel", pointerUp);
    };
  }, []);
}

function WorkspaceSkeleton() {
  return <div className="admin-gps-launch" aria-label="Connecting admin workspace" aria-busy="true"><div className="admin-gps-stage"><div className="admin-gps-ring"><MapPin size={38}/></div><div className="admin-launch-road"/><span className="admin-moving-car"><CarFront size={24}/></span><span className="admin-moving-bike"><Bike size={24}/></span><span className="admin-moving-tuktuk">TUK</span></div><small>WELCOME TO JIXELS ADMIN</small><h1>Connecting to your trackers</h1><p>Please wait while we securely prepare customers, trackers, payments, and operations.</p><div className="admin-launch-dots"><i/><i/><i/></div></div>;
}

function DashboardSkeleton() {
  return <div className="page-loading-overlay"><main className="workspace-skeleton page-content" aria-label="Loading Dashboard" aria-busy="true"><section className="skeleton-heading"><span/><strong/><i/></section><section className="skeleton-cards">{Array.from({ length: 8 }, (_, index) => <div key={index}><span/><strong/><i/></div>)}</section><section className="skeleton-panel"><header><strong/><span/></header>{Array.from({ length: 5 }, (_, row) => <p key={row}>{Array.from({ length: 4 }, (_, column) => <span key={column}/>)}</p>)}</section></main></div>;
}

function OfflineGate({ onRetry, onContinue }) {
  return <main className="admin-offline-gate" aria-live="assertive"><div className="offline-cloud"><Wifi size={34}/><X size={16}/></div><div className="offline-road"><span className="offline-car">●</span><span className="offline-bike">●</span><span className="offline-tuktuk">●</span></div><h1>Network is down</h1><p>Check your internet connection.</p><button className="offline-retry" onClick={onRetry}>Check connection</button><button className="offline-continue" onClick={onContinue}>Continue offline <ArrowUpRight size={16}/></button></main>;
}

function addLabel(page) {
  if (page === "Dashboard") return "customer";
  if (page === "Screening") return "application";
  if (page === "Support Cases") return "support case";
  return page.endsWith("s") ? page.slice(0, -1).toLowerCase() : page.toLowerCase();
}

function AppContent() {
  useHorizontalTableScroll();
  const [session, setSession] = useState(getSession);
  const [workspaceLoading, setWorkspaceLoading] = useState(() => getSession() ? "animation" : null);
  const [navigationState] = useState(() => loadNavigation(getSession()?.role));
  const [active, setActive] = useState(() => navigationState.active);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => navigationState.sidebarCollapsed);
  const [showAdd, setShowAdd] = useState(false);
  const [systemOnline, setSystemOnline] = useState(() => navigator.onLine);
  const [offlineAcknowledged, setOfflineAcknowledged] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const emptyRecord = { name: "", email: "", phone: "", nationalId: "", address: "", county: "", town: "", status: "active", trackerStatus: "online", trackerNumber: "", notes: "", productType: "bike", otherType: "", customerId: "", trackerId: "", agentId: "", bikeId: "" };
  const [newRecord, setNewRecord] = useState(emptyRecord);
  const [productLinks, setProductLinks] = useState({ customers: [], trackers: [], agents: [], products: [] });
  const [saveState, setSaveState] = useState("");

  useEffect(() => {
    if (!session) return undefined;
    const refresh = () => setSession(touchSession());
    const events = ["click", "keydown", "pointerdown"];
    events.forEach((event) => window.addEventListener(event, refresh));
    const interval = window.setInterval(() => {
      if (!touchSession()) setSession(null);
    }, 60_000);
    return () => {
      events.forEach((event) => window.removeEventListener(event, refresh));
      window.clearInterval(interval);
    };
  }, [session]);

  useEffect(() => {
    if (!session) return;
    try { localStorage.setItem(ADMIN_NAVIGATION_KEY, JSON.stringify({ active, sidebarCollapsed })); }
    catch (error) { console.error("Could not persist admin navigation", error); }
  }, [active, sidebarCollapsed, session]);

  useEffect(() => {
    const updateConnection = () => setSystemOnline(navigator.onLine);
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    return () => { window.removeEventListener("online", updateConnection); window.removeEventListener("offline", updateConnection); };
  }, []);
  useEffect(() => { if (systemOnline) setOfflineAcknowledged(false); }, [systemOnline]);

  useEffect(() => {
    if (!session || !hasSupabaseConfig) return undefined;
    const watch = (table, title, matches = (event) => event.eventType === "INSERT") => subscribeToTable(table, (event) => {
      if (!matches(event)) return;
      const record = event.new;
      setNotifications((items) => [{ id: `${table}-${record.id}`, title, detail: record.title || record.full_name || record.identifier || "New workspace activity", time: "Just now", unread: true }, ...items].slice(0, 20));
    });
    const unsubscribers = [
      watch("support_cases", "New support case"),
      watch("screening_applications", "Screening decision", (event) => event.eventType === "UPDATE" && ["approved", "declined"].includes(event.new.status) && event.old?.status !== event.new.status),
      watch("trackers", "Tracker offline", (event) => event.eventType === "UPDATE" && event.old?.is_online && !event.new.is_online),
      watch("alerts", "New alert")
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [session]);

  useEffect(() => {
    if (!session) { setWorkspaceLoading(null); return undefined; }
    let cancelled = false;
    setWorkspaceLoading("animation");
    const animationTimer = window.setTimeout(() => {
      if (!cancelled) setWorkspaceLoading("skeleton");
    }, 7_000);
    const skeletonTimer = window.setTimeout(() => {
      if (!cancelled) setWorkspaceLoading(null);
    }, 9_000);
    return () => {
      cancelled = true;
      window.clearTimeout(animationTimer);
      window.clearTimeout(skeletonTimer);
    };
  }, [session?.email]);

  useEffect(() => {
    const reportOffline = () => setSystemOnline(false);
    window.addEventListener("jixels:data-offline", reportOffline);
    return () => {
      window.removeEventListener("jixels:data-offline", reportOffline);
    };
  }, []);

  useEffect(() => {
    if (!showAdd || active !== "Products" || !hasSupabaseConfig) return undefined;
    let mounted = true;
    Promise.all([listRecords("customers", { pageSize: 100 }), listRecords("trackers", { pageSize: 100 }), listRecords("profiles", { pageSize: 100 }), listRecords("bikes", { pageSize: 500 })]).then(([customers, trackers, profiles, products]) => {
      if (mounted) setProductLinks({ customers: customers.data || [], trackers: trackers.data || [], agents: (profiles.data || []).filter((profile) => ["support_agent", "Support agent"].includes(profile.role)), products: products.data || [] });
    });
    return () => { mounted = false; };
  }, [showAdd, active]);

  if (!session) {
    return <LoginScreen onSignIn={(nextSession) => { setWorkspaceLoading("animation"); setSession(nextSession); }} />;
  }
  if (!systemOnline && !offlineAcknowledged) return <OfflineGate onRetry={() => setSystemOnline(navigator.onLine)} onContinue={() => setOfflineAcknowledged(true)}/>;
  if (workspaceLoading === "animation") return <WorkspaceSkeleton/>;
  if (workspaceLoading === "skeleton") return <DashboardSkeleton/>;
  const sessionName = typeof session.name === "string" && session.name.trim() ? session.name.trim() : "Administrator";
  const sessionRole = typeof session.role === "string" ? session.role : "";

  function choosePage(label) {
    setActive(label);
    setShowAdd(false);
    recordAudit({ action: "viewed", resource: label });
    setSidebarOpen(false);
    if (window.innerWidth > 760) setSidebarCollapsed(true);
  }
  async function saveNewRecord() {
    const table = active === "Products" ? "bikes" : active === "GPS Trackers" ? "trackers" : active === "Payments" ? "payments" : active === "Support Cases" ? "support_cases" : "customers";
    const isOtherProduct = newRecord.productType === "other";
    const selectedTrackerStatus = ["online", "offline", "immobilized"].includes(newRecord.status) ? newRecord.status : newRecord.trackerStatus;
    const record = table === "bikes" ? { identifier: newRecord.name, model: newRecord.email.trim() || "Unspecified", product_type: newRecord.productType, custom_product_type: isOtherProduct ? newRecord.otherType.trim() : null, customer_id: newRecord.customerId || null, assigned_agent_id: newRecord.agentId || null } : table === "trackers" ? { identifier: newRecord.name.trim(), bike_id: newRecord.bikeId || null, operational_status: selectedTrackerStatus, is_online: selectedTrackerStatus === "online" } : table === "support_cases" ? { title: newRecord.name, notes: newRecord.notes || null, priority: "normal", created_by: session?.userId || null } : table === "payments" ? { amount: Number(newRecord.notes || 0), currency: "KES" } : { full_name: newRecord.name, email: newRecord.email || null, phone: newRecord.phone || null, national_id: newRecord.nationalId || null, address: newRecord.address || null, county: newRecord.county || null, town: newRecord.town || null, status: newRecord.status, tracker_number: newRecord.trackerNumber || null };
    if (!newRecord.name) { setSaveState("Enter a name or identifier."); return; }
    if (table === "bikes" && isOtherProduct && !newRecord.otherType.trim()) { setSaveState("Enter the product type."); return; }
    if (table === "bikes" && !newRecord.customerId) { setSaveState("Select the customer for this product."); return; }
    const result = await createRecord(table, record);
    if (result.error) { setSaveState(`Could not save: ${result.error.message}`); return; }
    if (table === "bikes" && newRecord.trackerId && result.data?.id) {
      const linkResult = await updateRecord("trackers", newRecord.trackerId, { bike_id: result.data.id });
      if (linkResult.error) { setSaveState(`Product saved, but tracker could not be linked: ${linkResult.error.message}`); return; }
    }
    recordAudit({ action: "created record", resource: active, detail: newRecord.name }); setNewRecord(emptyRecord); setSaveState(""); setShowAdd(false);
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "is-open" : ""} ${sidebarCollapsed ? "is-collapsed" : ""}`}>
        <div className="sidebar-header"><button className="sidebar-collapse icon-btn" onClick={() => window.innerWidth <= 760 ? setSidebarOpen(false) : setSidebarCollapsed((collapsed) => !collapsed)} aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}><Menu size={19}/></button><div className="brand"><img className="brand-logo" src="https://www.jixels.com/assets/jixels-logo-form-ni-tenje-cropped.jpeg" alt="Jixels Form Ni Tenje" /></div></div>
        <nav>
          {navigation.filter((item) => canAccess(sessionRole, item.key)).map((item, index, visibleNavigation) => (
            <div key={item.section + item.label}>
              {(index === 0 || visibleNavigation[index - 1].section !== item.section) && <p className="nav-section">{item.section}</p>}
              <button className={`nav-item ${active === item.key ? "active" : ""}`} onClick={() => choosePage(item.key)} title={item.label} aria-label={item.label} data-tooltip={item.label}><item.icon size={17} strokeWidth={active === item.key ? 2.3 : 1.8} /><span>{item.label}</span>{item.count && <em>{item.count}</em>}{item.live && <i />}</button>
            </div>
          ))}
        </nav>
        <div className="sidebar-footer"><button className="sidebar-logout" onClick={() => setConfirmSignOut(true)}><LogOut size={17}/><span>Logout</span></button></div>
      </aside>
      {sidebarOpen && <button className="scrim" aria-label="Close menu" onClick={() => setSidebarOpen(false)} />}
      <main className="main-content" onPointerDown={() => { if (window.innerWidth > 760 && !sidebarCollapsed) setSidebarCollapsed(true); }}>
        <header className="topbar"><button className="menu-button icon-btn" onClick={() => setSidebarOpen(true)} aria-label="Open navigation"><Menu size={20} /></button><div className="topbar-actions"><button className="icon-btn notification" onClick={() => setNotificationsOpen((open) => !open)} aria-label="Open notifications"><Bell size={18}/>{notifications.some((item) => item.unread) && <span/>}</button><div className="top-profile"><span className="user-avatar">{sessionName.slice(0, 2).toUpperCase()}</span><span><strong>{sessionName}</strong><small>{sessionRole || "Administrator"}</small></span></div></div>{notificationsOpen && <NotificationPanel notifications={notifications} onClose={() => setNotificationsOpen(false)} onRead={() => setNotifications((items) => items.map((item) => ({ ...item, unread: false })))} />}</header>
        <div className="page-content">
          {workspaceLoading ? <WorkspaceSkeleton/> : <>{active !== "Support Cases" && <section className="page-heading"><div><div className="eyebrow"><span className="pulse" />OPERATIONS</div><h1>{active === "Dashboard" ? "Dashboard Overview" : active === "Products" ? "Product Inventory" : active}</h1><p>{active === "Dashboard" ? "Fleet-wide numbers and system health, at a glance." : active === "Products" ? "Register products, link trackers, and allocate agents." : `${active} workspace.`}</p></div><div className="heading-actions">{hasSupabaseConfig && <span className="sync-status"><span />Live data</span>}</div></section>}<ModuleErrorBoundary module={active}>{active === "Dashboard" ? <DashboardLiveView /> : <EnhancedModuleView title={active} setShowAdd={setShowAdd} />}</ModuleErrorBoundary></>}
          <footer className="system-footer"><span><strong>JIXELS ADMIN</strong> · Form Ni Tenje · Operations workspace</span><span>© 2026 Jixels Technologies</span></footer>
        </div>
      </main>
      {confirmSignOut && <ConfirmDialog title="Sign out of workspace?" detail="This session will close and the Admin portal will refresh to the secure sign-in page." confirmLabel="Sign out" onCancel={() => setConfirmSignOut(false)} onConfirm={() => { recordAudit({ action: "signed out", resource: "Authentication" }); signOut(); window.location.reload(); }} />}
      {showAdd && <div className="modal-backdrop" onClick={() => setShowAdd(false)}><div className="modal" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><span className="eyebrow">QUICK ACTION</span><h2>Add {active === "Dashboard" ? "customer" : active.slice(0, -1).toLowerCase()}</h2></div><button className="icon-btn" onClick={() => setShowAdd(false)} aria-label="Close"><X size={18} /></button></div><label>{active === "GPS Trackers" ? "Tracker code" : active === "Products" ? "Product name or ID" : "Full name or identifier"}<input value={newRecord.name} onChange={(e) => setNewRecord((r) => ({ ...r, name: e.target.value }))} placeholder={active === "GPS Trackers" ? "Enter tracker code" : active === "Products" ? "Enter a product name or ID" : "Enter a name or ID"} /></label>{active === "GPS Trackers" && <><label>Product<select value={newRecord.bikeId} onChange={(e) => setNewRecord((r) => ({ ...r, bikeId: e.target.value }))}><option value="">Unlinked product</option>{productLinks.products.map((product) => <option key={product.id} value={product.id}>{product.identifier}</option>)}</select></label><label>Status<select value={newRecord.status} onChange={(e) => setNewRecord((r) => ({ ...r, status: e.target.value }))}><option value="online">Online</option><option value="offline">Offline</option><option value="immobilized">Immobilized</option></select></label></>}{active !== "GPS Trackers" && <><label>{active === "Products" ? "Product model" : "Email address"}<input value={newRecord.email} onChange={(e) => setNewRecord((r) => ({ ...r, email: e.target.value }))} placeholder={active === "Products" ? "Optional product model" : "name@company.com"} type={active === "Products" ? "text" : "email"} /></label>{active !== "Products" && <label>Notes / model / amount<textarea value={newRecord.notes} onChange={(e) => setNewRecord((r) => ({ ...r, notes: e.target.value }))} placeholder="Add optional notes" rows="3" /></label>}</>}{saveState && <p className="import-message">{saveState}</p>}<div className="modal-actions"><button className="button secondary" onClick={() => setShowAdd(false)}>Cancel</button><button className="button primary" onClick={saveNewRecord}>Create record</button></div></div></div>}
    </div>
  );
}

function App() {
  return <AppErrorBoundary><AppContent /></AppErrorBoundary>;
}

function NotificationPanel({ notifications, onClose, onRead }) {
  return <div className="notification-panel"><div className="notification-panel-heading"><div><span className="eyebrow">ACTIVITY CENTER</span><h2>Notifications</h2></div><button className="text-button" onClick={onRead}>Mark all read</button></div><div className="notification-list">{notifications.map((item) => <button className={`notification-item ${item.unread ? "unread" : ""}`} key={item.id} onClick={onRead}><span className="notification-icon"><Bell size={14} /></span><span><strong>{item.title}</strong><small>{item.detail}</small><time>{item.time}</time></span>{item.unread && <i />}</button>)}</div><button className="notification-footer" onClick={() => { onRead(); onClose(); }}>View alert center <ArrowUpRight size={14} /></button></div>;
}

function ConfirmDialog({ title, detail, confirmLabel, onCancel, onConfirm }) {
  return <div className="modal-backdrop" role="presentation"><div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title"><div className="modal-header"><div><span className="eyebrow">CONFIRM ACTION</span><h2 id="confirm-title">{title}</h2></div></div><p>{detail}</p><div className="modal-actions"><button className="button secondary" onClick={onCancel}>Cancel</button><button className="button primary" onClick={onConfirm}>{confirmLabel}</button></div></div></div>;
}

function exportCsv(filename, headers, rows) {
  const escapeCell = (value) => `"${String(value).replaceAll('"', '""')}"`;
  const csv = [headers, ...rows].map((row) => row.map(escapeCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function parseCsv(text) {
  return text.trim().split(/\r?\n/).map((line) => {
    const cells = [];
    let cell = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (character === '"' && line[index + 1] === '"') { cell += '"'; index += 1; }
      else if (character === '"') quoted = !quoted;
      else if (character === "," && !quoted) { cells.push(cell.trim()); cell = ""; }
      else cell += character;
    }
    cells.push(cell.trim());
    return cells;
  });
}

function LoginScreen({ onSignIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const clearAutofill = () => {
      const form = document.querySelector(".login-card");
      if (!form) return;
      form.setAttribute("autocomplete", "off");
      const emailInput = form.querySelector('input[type="email"]');
      const passwordInput = form.querySelector('input[type="password"]');
      if (emailInput) { emailInput.setAttribute("autocomplete", "off"); emailInput.value = ""; }
      if (passwordInput) { passwordInput.setAttribute("autocomplete", "new-password"); passwordInput.value = ""; }
    };
    clearAutofill();
    const timer = window.setTimeout(clearAutofill, 50);
    return () => window.clearTimeout(timer);
  }, []);

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    const result = await signIn(email, password);
    if (result.error) setError(result.error);
    else { recordAudit({ action: "signed in", resource: "Authentication" }); onSignIn(result.data); }
    setLoading(false);
  }

  return <main className="login-screen"><section className="login-shell"><div className="login-story"><div className="login-brand"><img className="login-logo" src="https://www.jixels.com/assets/jixels-logo-form-ni-tenje-cropped.jpeg" alt="Jixels Form Ni Tenje" /></div><div className="login-story-copy"><span className="login-kicker"><span/> FLEET OPERATIONS PLATFORM</span><h1>Every tracker.<br/>One clear view.</h1><p>Manage customers, connected products, tracker health, payments, and support from one secure operations workspace.</p><div className="login-feature-grid"><div><span className="login-feature-icon"><Radio size={19}/></span><strong>Live operations</strong><small>Tracker health and last-seen status</small></div><div><span className="login-feature-icon"><ShieldCheck size={19}/></span><strong>Controlled access</strong><small>Role-based staff permissions</small></div></div></div><div className="login-system-status"><span><i/> Systems operational</span><small>Secure Jixels workspace</small></div></div><div className="login-form-panel"><form className="login-card" onSubmit={submit}><div className="login-form-mark"><ShieldCheck size={20}/></div><div className="eyebrow">ADMIN WORKSPACE</div><h2>Welcome back</h2><p>Enter your details to continue to Jixels Admin.</p><label>Email address<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="you@jixels.com" autoComplete="email" required /></label><label>Password<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="Enter your password" autoComplete="current-password" required /></label>{error && <div className="login-error"><AlertTriangle size={15} />{error}</div>}<button className="button primary login-button" disabled={loading}>{loading ? "Signing in..." : "Sign in securely"}<ArrowUpRight size={16}/></button><small className="login-security-note"><ShieldCheck size={13}/> Protected administrative access</small></form><footer className="login-panel-footer">© 2026 Jixels Technologies</footer></div></section></main>;
}

export default App;
