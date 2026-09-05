import { useEffect, useState } from "react";
import { Search, ShieldCheck, Trash2, X } from "lucide-react";
import { hasSupabaseConfig, invokeApi } from "../lib/data";
import { recordAudit } from "../lib/security";

const label = (status) => status === "approved" ? "Approved" : status === "rejected" ? "Rejected" : "Pending";

export default function AgentAccountsView({ directory = false }) {
  const [accounts, setAccounts] = useState([]);
  const [query, setQuery] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null);
  const [message, setMessage] = useState("");
  const load = async () => {
    if (!hasSupabaseConfig) return setMessage("Connect Supabase to view agent registrations.");
    const result = await invokeApi(`/v1/admin/account-approvals?status=${directory ? "directory" : "pending"}`, null, "GET");
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
    recordAudit({ action: "deleted staff account and linked records", resource: "Staff Accounts", detail: pendingDelete.full_name });
    setPendingDelete(null); load();
  };
  const pageTitle = directory ? "Staff accounts" : "Account approvals";
  const pageCopy = directory ? "Approved and rejected Finance and Agent accounts. Delete an account only when its access and linked workspace data must be removed." : "Pending Finance and Agent accounts require an administrator decision before portal access.";
  return <><section className="panel module-table agent-accounts"><div className="panel-heading"><div><h2>{pageTitle}</h2><p>{pageCopy}</p></div>{!directory && <span className="account-status pending">{accounts.length} pending</span>}</div><div className="directory-filters"><label className="table-search"><Search size={15}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${directory ? "staff" : "pending"} accounts by name, email, or phone`}/></label></div>{message && <div className="import-message">{message}</div>}<div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Registered</th><th>Status</th><th>Actions</th></tr></thead><tbody>{visible.map((account) => { const status = account.account_status || "pending"; return <tr key={account.id}><td><strong>{account.full_name}</strong></td><td>{account.email || "—"}</td><td>{account.phone || "—"}</td><td>{account.role === "support_agent" ? "Support agent" : account.role}</td><td>{account.created_at ? new Date(account.created_at).toLocaleString() : "—"}</td><td><span className={`account-status ${status}`}>{label(status)}</span></td><td><div className="account-actions">{!directory && <><button className="button primary" onClick={() => change(account, "approved")}><ShieldCheck size={14}/> Approve</button><button className="button secondary" onClick={() => change(account, "rejected")}>Reject</button></>}{directory && <button className="button danger" onClick={() => setPendingDelete(account)}><Trash2 size={14}/> Delete</button>}</div></td></tr>; })}</tbody></table></div></section>{pendingDelete && <div className="detail-backdrop" onClick={() => setPendingDelete(null)}><aside className="detail-drawer confirm-drawer" onClick={(event) => event.stopPropagation()}><div className="detail-heading"><div><span className="eyebrow">DELETE STAFF ACCOUNT</span><h2>{pendingDelete.full_name}</h2></div><button className="icon-btn" onClick={() => setPendingDelete(null)}><X size={18}/></button></div><p>This permanently deletes this user and the records linked to their workspace. This action cannot be undone.</p><div className="detail-actions"><button className="button secondary" onClick={() => setPendingDelete(null)}>Cancel</button><button className="button danger" onClick={remove}><Trash2 size={14}/> Delete account</button></div></aside></div>}</>;
}
