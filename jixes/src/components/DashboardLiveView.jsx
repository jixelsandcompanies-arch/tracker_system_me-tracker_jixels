import { useEffect, useState } from "react";
import { AlertTriangle, Bell, ClipboardList, Radio } from "lucide-react";
import { hasSupabaseConfig, listRecords, subscribeToTable } from "../lib/data";

const tables = ["customers", "bikes", "trackers", "payments", "finance_accounts", "screening_applications", "support_cases", "alerts"];

export default function DashboardLiveView() {
  const [records, setRecords] = useState({});
  const [message, setMessage] = useState("");
  const load = async () => {
    if (!hasSupabaseConfig) return setMessage("Connect Supabase to show live workspace data.");
    const results = await Promise.all(tables.map((table) => listRecords(table, { pageSize: 1000 })));
    setRecords(Object.fromEntries(tables.map((table, index) => [table, results[index].error ? { data: [], count: 0 } : results[index]])));
    setMessage(results.some((result) => result.error) ? "Some dashboard records are not available to your current role." : "");
  };
  useEffect(() => { load(); const off = tables.map((table) => subscribeToTable(table, load)); return () => off.forEach((unsubscribe) => unsubscribe()); }, []);

  const customers = records.customers?.count || 0;
  const products = records.bikes?.count || 0;
  const trackers = records.trackers?.data || [];
  const payments = records.payments?.data || [];
  const accounts = records.finance_accounts?.data || [];
  const screening = records.screening_applications?.data || [];
  const cases = records.support_cases?.data || [];
  const alerts = (records.alerts?.data || []).filter((alert) => !alert.resolved_at);
  const today = new Date().toDateString();
  const isOutstanding = (account) => Number(account.outstanding) > 0;
  const activeFinance = accounts.filter((account) => account.status === "active" && isOutstanding(account));
  const paymentsToday = payments.filter((payment) => payment.paid_at && new Date(payment.paid_at).toDateString() === today).reduce((total, payment) => total + Number(payment.amount || 0), 0);
  const cards = [
    { label: "Total customers", value: customers, tone: "ink" },
    { label: "Total bikes", value: products, tone: "ink" },
    { label: "Active trackers", value: trackers.filter((tracker) => tracker.is_online).length, tone: "positive" },
    { label: "Offline trackers", value: trackers.filter((tracker) => !tracker.is_online).length, tone: "negative" },
    { label: "Overdue accounts", value: accounts.filter((account) => isOutstanding(account) && account.due_at && new Date(account.due_at) < new Date()).length, tone: "warning" },
    { label: "Payments today", value: `KES ${paymentsToday.toLocaleString()}`, tone: "ink" },
    { label: "Active financing", value: activeFinance.length, tone: "ink" },
    { label: "Completed financing", value: accounts.filter((account) => Number(account.outstanding) === 0).length, tone: "positive" }
  ];
  return <>
    <section className="dashboard-overview" aria-label="Fleet-wide numbers and system health">{cards.map((card) => <article className={`overview-card ${card.tone}`} key={card.label}><span>{card.label}</span><strong>{card.value}</strong></article>)}</section>
    {message && <div className="import-message">{message}</div>}
    <section className="dashboard-grid spec-dashboard-grid">
      <article className="panel"><div className="panel-heading"><div><h2>Tracker health</h2><p>Current status from real tracker heartbeats.</p></div></div>{trackers.length ? <div className="table-wrap"><table><thead><tr><th>Tracker</th><th>Last seen</th><th>Status</th></tr></thead><tbody>{trackers.slice(0, 8).map((tracker) => <tr key={tracker.id}><td><strong>{tracker.identifier}</strong></td><td>{tracker.last_seen_at ? new Date(tracker.last_seen_at).toLocaleString() : "Never"}</td><td><span className={`status ${tracker.is_online ? "moving" : "warning"}`}><span />{tracker.is_online ? "Online" : "Offline"}</span></td></tr>)}</tbody></table></div> : <div className="empty-state"><Radio size={22} /><strong>No tracker records yet</strong><span>Registered devices will appear when they are added.</span></div>}</article>
      <article className="panel recent-panel"><div className="panel-heading"><div><h2>Needs attention</h2><p>Open cases, alerts, and pending screening.</p></div></div><div className="recent-alerts">{alerts.slice(0, 3).map((alert) => <div className="alert-item" key={alert.id}><span className="alert-icon red"><AlertTriangle size={17} /></span><span><strong>{alert.title}</strong><small>{alert.detail || alert.severity}</small></span></div>)}{cases.filter((item) => !["closed", "resolved"].includes(item.status)).slice(0, 2).map((item) => <div className="alert-item" key={item.id}><span className="alert-icon orange"><Bell size={17} /></span><span><strong>{item.title}</strong><small>{item.priority} priority · {item.status}</small></span></div>)}{screening.filter((item) => ["new", "reviewing"].includes(item.status)).slice(0, 2).map((item) => <div className="alert-item" key={item.id}><span className="alert-icon blue"><ClipboardList size={17} /></span><span><strong>{item.full_name}</strong><small>Screening · {item.status}</small></span></div>)}{!alerts.length && !cases.length && !screening.length && <div className="empty-state"><Bell size={22} /><strong>No action items</strong><span>New operational items will appear here.</span></div>}</div></article>
    </section>
  </>;
}
