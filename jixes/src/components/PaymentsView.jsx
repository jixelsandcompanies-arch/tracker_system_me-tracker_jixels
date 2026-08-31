import { useEffect, useRef, useState } from "react";
import { CreditCard, Search, Trash2, X } from "lucide-react";
import { deleteRecord, hasSupabaseConfig, listRecords, subscribeToTable } from "../lib/data";
import { recordAudit } from "../lib/security";

const money = (value, currency = "KES") => `${currency} ${Number(value || 0).toLocaleString()}`;

export default function PaymentsView() {
  const [data, setData] = useState({ payments: [], customers: [], bikes: [], profiles: [], finance_accounts: [] });
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [message, setMessage] = useState("");
  const scrollRef = useRef(null);
  const horizontalWheel = () => {};
  const load = async () => {
    if (!hasSupabaseConfig) return setMessage("Connect Supabase to view payment records.");
    const names = ["payments", "customers", "bikes", "profiles", "finance_accounts"];
    const results = await Promise.all(names.map((table) => listRecords(table, { pageSize: 1000 })));
    const error = results.find((result) => result.error)?.error;
    if (error) return setMessage(error.message);
    setData(Object.fromEntries(names.map((name, index) => [name, results[index].data])));
    setMessage("");
  };
  useEffect(() => { load(); return subscribeToTable("payments", load); }, []);
  const details = (payment) => {
    const customer = data.customers.find((item) => item.id === payment.customer_id);
    const product = data.bikes.find((item) => item.id === payment.product_id || item.customer_id === payment.customer_id);
    const account = data.finance_accounts.find((item) => item.customer_id === payment.customer_id);
    const agent = data.profiles.find((item) => item.id === payment.agent_id || item.id === product?.assigned_agent_id);
    return { customer, product, account, agent };
  };
  const visible = data.payments.filter((payment) => {
    const linked = details(payment);
    return `${linked.customer?.full_name || ""} ${linked.customer?.phone || ""} ${payment.receipt_number || payment.mpesa_receipt || ""} ${linked.product?.identifier || ""}`.toLowerCase().includes(query.toLowerCase());
  });
  const toggle = (id) => setSelectedIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
  const remove = async (ids) => {
    if (!ids.length || !window.confirm(`Delete ${ids.length} payment record${ids.length === 1 ? "" : "s"}?`)) return;
    for (const id of ids) await deleteRecord("payments", id);
    recordAudit({ action: "deleted payments", resource: "Payments", detail: `${ids.length} record(s)` });
    setSelectedIds([]);
    load();
  };
  return <><section className="panel payment-panel"><div className="payment-heading"><div><h2>Payment records ({visible.length})</h2><p>Scroll sideways to view every payment and account field.</p></div><div className="table-tools"><label className="table-search"><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search product payments"/></label><button className="button secondary" onClick={() => remove(selectedIds)}>Delete selected</button><button className="button danger" onClick={() => remove(visible.map((payment) => payment.id))}>Delete all</button></div></div>{message && <div className="import-message">{message}</div>}<div ref={scrollRef} className="payment-scroll" onWheel={horizontalWheel}><table className="payment-records-table"><thead><tr><th><input type="checkbox" checked={visible.length > 0 && visible.every((payment) => selectedIds.includes(payment.id))} onChange={(event) => setSelectedIds(event.target.checked ? visible.map((payment) => payment.id) : [])}/></th><th>Customer</th><th>Phone / Receipt</th><th>Product identifier</th><th>Health</th><th>Overdue</th><th>Deposit / Credit</th><th>Paygo Payment</th><th>Payment Amount</th><th>Daily Target</th><th>Balance</th><th>Date</th><th>Agent / Agent code</th><th>Status</th><th>Paygo Account</th><th>Actions</th></tr></thead><tbody>{visible.map((payment) => { const { customer, product, account, agent } = details(payment); return <tr key={payment.id}><td><input type="checkbox" checked={selectedIds.includes(payment.id)} onChange={() => toggle(payment.id)}/></td><td><strong>{customer?.full_name || "Unlinked"}</strong></td><td>{customer?.phone || "—"}<small>{payment.receipt_number || payment.mpesa_receipt || "No receipt"}</small></td><td>{product?.identifier || "—"}</td><td>{payment.health || account?.health || "—"}</td><td>{money(payment.overdue_amount || account?.overdue, payment.currency)}</td><td>{money(payment.deposit_amount || payment.credit_amount, payment.currency)}</td><td>{money(payment.paygo_payment || payment.amount, payment.currency)}</td><td>{money(payment.amount, payment.currency)}</td><td>{money(payment.daily_target || account?.daily_target, payment.currency)}</td><td>{money(payment.balance || account?.outstanding, payment.currency)}</td><td>{new Date(payment.paid_at || payment.created_at).toLocaleDateString()}</td><td>{agent?.full_name || "Unassigned"}<small>{agent?.agent_code || "No code"}</small></td><td>{payment.status}</td><td>{payment.paygo_account || account?.id?.slice(0, 8).toUpperCase() || "—"}</td><td><div className="account-actions"><button className="button secondary" onClick={() => setSelected(payment)}>View</button><button className="button danger" onClick={() => remove([payment.id])}><Trash2 size={14}/> Delete</button></div></td></tr>; })}</tbody></table></div><div className="horizontal-scroll-hint">Scroll left and right to view all columns</div></section>{selected && <div className="detail-backdrop" onClick={() => setSelected(null)}><aside className="detail-drawer payment-detail-drawer" onClick={(event) => event.stopPropagation()}><div className="detail-heading"><div><span className="eyebrow">PAYMENT RECORD</span><h2>{money(selected.amount, selected.currency)}</h2></div><button className="icon-btn" onClick={() => setSelected(null)}><X size={18}/></button></div><div className="detail-fields"><div><span>Customer</span><strong>{details(selected).customer?.full_name || "Unlinked"}</strong></div><div><span>Product</span><strong>{details(selected).product?.identifier || "—"}</strong></div><div><span>Status</span><strong>{selected.status}</strong></div><div><span>Date</span><strong>{new Date(selected.paid_at || selected.created_at).toLocaleString()}</strong></div><div><span>Receipt</span><strong>{selected.receipt_number || selected.mpesa_receipt || "—"}</strong></div></div><div className="detail-actions"><button className="button secondary" onClick={() => setSelected(null)}>Done</button></div></aside></div>}</>;
}
