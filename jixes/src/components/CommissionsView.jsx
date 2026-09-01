import { useEffect, useMemo, useState } from "react";
import { BadgeDollarSign, Search, Users, X } from "lucide-react";
import { getSession } from "../lib/auth";
import { hasSupabaseConfig, listRecords, subscribeToTable } from "../lib/data";

const money = (value, currency = "KES") => `${currency} ${Number(value || 0).toLocaleString()}`;
const commissionRate = 0.05;
const agentRoles = new Set(["support_agent", "agent", "Support agent"]);

export default function CommissionsView() {
  const session = getSession();
  const [data, setData] = useState({ profiles: [], bikes: [], customers: [], payments: [] });
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [message, setMessage] = useState("");

  const load = async () => {
    if (!hasSupabaseConfig) return setMessage("Connect Supabase to view commission records.");
    const tables = ["profiles", "bikes", "customers", "payments"];
    const results = await Promise.all(tables.map((table) => listRecords(table, { pageSize: 1000 })));
    const error = results.find((result) => result.error)?.error;
    if (error) return setMessage(error.message);
    setData(Object.fromEntries(tables.map((table, index) => [table, results[index].data || []])));
    setMessage("");
  };

  useEffect(() => {
    load();
    const unsubscribers = ["profiles", "bikes", "customers", "payments"].map((table) => subscribeToTable(table, load));
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, []);

  const rows = useMemo(() => {
    const agents = data.profiles.filter((profile) => agentRoles.has(profile.role) || profile.agent_code);
    const visibleAgents = session?.role === "Support agent" || session?.role === "support_agent" ? agents.filter((agent) => agent.id === session.userId) : agents;
    return visibleAgents.map((agent) => {
      const products = data.bikes.filter((product) => product.assigned_agent_id === agent.id);
      const customers = data.customers.filter((customer) => products.some((product) => product.customer_id === customer.id));
      const payments = data.payments.filter((payment) => products.some((product) => product.id === payment.product_id || product.customer_id === payment.customer_id));
      const soldProducts = products.filter((product) => product.status === "sold" || payments.some((payment) => payment.product_id === product.id || payment.customer_id === product.customer_id));
      const paid = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
      const saleValue = soldProducts.reduce((sum, product) => sum + Number(product.sale_price || product.price || product.tracker_price || 0), 0);
      return { agent, products, customers, payments, soldProducts, paid, saleValue, commission: paid * commissionRate };
    });
  }, [data, session?.role, session?.userId]);

  const filtered = rows.filter((row) => `${row.agent.full_name || ""} ${row.agent.email || ""} ${row.agent.agent_code || ""}`.toLowerCase().includes(query.toLowerCase()));
  const totals = filtered.reduce((sum, row) => ({ sold: sum.sold + row.soldProducts.length, customers: sum.customers + row.customers.length, paid: sum.paid + row.paid, commission: sum.commission + row.commission }), { sold: 0, customers: 0, paid: 0, commission: 0 });

  return <><section className="commission-grid"><article className="panel module-summary"><div className="module-summary-icon"><BadgeDollarSign size={22}/></div><span>Total commission</span><strong>{money(totals.commission)}</strong><small>{Math.round(commissionRate * 100)}% of confirmed tracker sales payments</small></article><article className="panel module-summary"><div className="module-summary-icon"><Users size={22}/></div><span>Customers sold to</span><strong>{totals.customers}</strong><small>{totals.sold} tracker/product sale records</small></article></section><section className="panel module-table commission-panel"><div className="panel-heading"><div><h2>Agent commissions</h2><p>Track each agent's customers, sold trackers, received sales payments, and earned commission.</p></div><label className="table-search"><Search size={15}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search agent, code, or email"/></label></div>{message && <div className="import-message">{message}</div>}<div className="table-wrap"><table><thead><tr><th>Agent</th><th>Agent code</th><th>Customers</th><th>Sold trackers</th><th>Sales paid</th><th>Commission</th><th>Status</th><th/></tr></thead><tbody>{filtered.map((row) => <tr key={row.agent.id}><td><strong>{row.agent.full_name || "Unnamed agent"}</strong><small>{row.agent.email || row.agent.phone || "No contact"}</small></td><td>{row.agent.agent_code || "No code"}</td><td>{row.customers.length}</td><td>{row.soldProducts.length}</td><td>{money(row.paid)}</td><td><strong>{money(row.commission)}</strong></td><td><span className="account-status approved">Earned</span></td><td><button className="button secondary" onClick={() => setSelected(row)}>View</button></td></tr>)}</tbody></table></div></section>{selected && <div className="detail-backdrop" onClick={() => setSelected(null)}><aside className="detail-drawer commission-drawer" onClick={(event) => event.stopPropagation()}><div className="detail-heading"><div><span className="eyebrow">AGENT COMMISSION</span><h2>{selected.agent.full_name || "Unnamed agent"}</h2></div><button className="icon-btn" onClick={() => setSelected(null)}><X size={18}/></button></div><div className="detail-fields"><div><span>Commission earned</span><strong>{money(selected.commission)}</strong></div><div><span>Sales payments received</span><strong>{money(selected.paid)}</strong></div><div><span>Customers</span><strong>{selected.customers.length}</strong></div><div><span>Sold trackers/products</span><strong>{selected.soldProducts.length}</strong></div></div><section className="commission-customers"><h3>Customers sold to</h3>{selected.customers.length ? selected.customers.map((customer) => <p key={customer.id}><strong>{customer.full_name}</strong><span>{customer.phone || "No phone"} · {customer.tracker_number || "No tracker"}</span></p>) : <p>No customers linked to this agent yet.</p>}</section><div className="detail-actions"><button className="button secondary" onClick={() => setSelected(null)}>Done</button></div></aside></div>}</>;
}
