import { useEffect, useState } from "react";
import { Search, ShieldCheck, Trash2, X } from "lucide-react";
import { hasSupabaseConfig, invokeApi } from "../lib/data";
import { recordAudit } from "../lib/security";

const label = (status) => status === "approved" ? "Approved" : status === "rejected" ? "Rejected" : "Pending";

export default function AgentAccountsView() {
  const [accounts, setAccounts] = useState([]);
  const [query, setQuery] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null);
  const [message, setMessage] = useState("");
  const load = async () => {
    if (!hasSupabaseConfig) return setMessage("Connect Supabase to view agent registrations.");
    const result = await invokeApi("/v1/admin/account-approvals", null, "GET");
    if (result.error) return setMessage(result.error.message);
    setAccounts(result.data?.accounts || []);
    setMessage("");
  };
  useEffect(() => { load(); }, []);
  const visible = accounts.filter((account) => JSON.stringify(account).toLowerCase().includes(query.toLowerCase()));
  const change = async (account, account_status) => {
    const result = await invokeApi(`/v1/admin/account-approvals/${encodeURIComponent(account.id)}`, { status: account_status });
    if (result.error) return setMessage(result.error.message);
    recordAudit({ action: `${account_status} staff account`, resource: "Staff Accounts", detail: account.full_name });
    load();
  };
  const remove = async () => {
    const result = await invokeApi(`/v1/admin/users/${encodeURIComponent(pendingDelete.id)}`, null, "DELETE");
    if (result.error) return setMessage(result.error.message);
    recordAudit({ action: "deleted rejected staff account", resource: "Staff Accounts", detail: pendingDelete.full_name });
    setPendingDelete(null); load();
  };
  const pendingCount = accounts.filter((account) => (account.account_status || "pending") === "pending").length;
  return <><section className="panel module-table agent-accounts"><div className="panel-heading"><div><h2>Account approvals</h2><p>Pending Finance and Agent accounts require an administrator decision before portal access.</p></div><span className="account-status pending">{pendingCount} pending</span></div><div className="directory-filters"><label className="table-search"><Search size={15}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search pending accounts by name, email, or phone"/></label></div>{message && <div className="import-message">{message}</div>}<div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Registered</th><th>Status</th><th>Actions</th></tr></thead><tbody>{visible.map((account) => { const status = account.account_status || "pending"; return <tr key={account.id}><td><strong>{account.full_name}</strong></td><td>{account.email || "—"}</td><td>{account.phone || "—"}</td><td>{account.role === "support_agent" ? "Support agent" : account.role}</td><td>{account.created_at ? new Date(account.created_at).toLocaleString() : "—"}</td><td><span className={`account-status ${status}`}>{label(status)}</span></td><td><div className="account-actions">{status === "pending" && <><button className="button primary" onClick={() => change(account, "approved")}><ShieldCheck size={14}/> Approve</button><button className="button secondary" onClick={() => change(account, "rejected")}>Reject</button></>}{status === "approved" && <button className="button secondary" disabled><ShieldCheck size={14}/> Approved</button>}{status === "rejected" && <button className="button danger" onClick={() => setPendingDelete(account)}><Trash2 size={14}/> Delete</button>}</div></td></tr>; })}</tbody></table></div></section>{pendingDelete && <div className="detail-backdrop" onClick={() => setPendingDelete(null)}><aside className="detail-drawer confirm-drawer" onClick={(event) => event.stopPropagation()}><div className="detail-heading"><div><span className="eyebrow">DELETE REJECTED ACCOUNT</span><h2>{pendingDelete.full_name}</h2></div><button className="icon-btn" onClick={() => setPendingDelete(null)}><X size={18}/></button></div><p>This permanently removes the rejected staff profile. This action cannot be undone.</p><div className="detail-actions"><button className="button secondary" onClick={() => setPendingDelete(null)}>Cancel</button><button className="button danger" onClick={remove}><Trash2 size={14}/> Delete account</button></div></aside></div>}</>;
}
