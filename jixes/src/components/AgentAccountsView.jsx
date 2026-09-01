import { useEffect, useState } from "react";
import { Search, ShieldCheck, Trash2, X } from "lucide-react";
import { deleteRecord, hasSupabaseConfig, listRecords, subscribeToTable, updateRecord } from "../lib/data";
import { recordAudit } from "../lib/security";

const label = (status) => status === "approved" ? "Approved" : status === "rejected" ? "Rejected" : "Pending";

export default function AgentAccountsView() {
  const [accounts, setAccounts] = useState([]);
  const [query, setQuery] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null);
  const [message, setMessage] = useState("");
  const load = async () => {
    if (!hasSupabaseConfig) return setMessage("Connect Supabase to view agent registrations.");
    const result = await listRecords("profiles", { pageSize: 1000 });
    if (result.error) return setMessage(result.error.message);
    setAccounts(result.data.filter((account) => ["support_agent", "agent", "finance", "finance_officer", "Support agent"].includes(account.role)));
    setMessage("");
  };
  useEffect(() => { load(); return subscribeToTable("profiles", load); }, []);
  const visible = accounts.filter((account) => JSON.stringify(account).toLowerCase().includes(query.toLowerCase()));
  const change = async (account, account_status) => {
    const result = await updateRecord("profiles", account.id, { account_status });
    if (result.error) return setMessage(result.error.message);
    recordAudit({ action: `${account_status} staff account`, resource: "Staff Accounts", detail: account.full_name });
    load();
  };
  const remove = async () => {
    const result = await deleteRecord("profiles", pendingDelete.id);
    if (result.error) return setMessage(result.error.message);
    recordAudit({ action: "deleted rejected staff account", resource: "Staff Accounts", detail: pendingDelete.full_name });
    setPendingDelete(null); load();
  };
  return <><section className="panel module-table agent-accounts"><div className="panel-heading"><div><h2>Staff accounts</h2><p>Review and approve staff registering for portal access.</p></div></div><div className="directory-filters"><label className="table-search"><Search size={15}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search staff by name, email, or phone"/></label></div>{message && <div className="import-message">{message}</div>}<div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead><tbody>{visible.map((account) => { const status = account.account_status || "pending"; return <tr key={account.id}><td><strong>{account.full_name}</strong></td><td>{account.email || "—"}</td><td>{account.phone || "—"}</td><td>{account.role === "support_agent" ? "Support agent" : account.role}</td><td><span className={`account-status ${status}`}>{label(status)}</span></td><td><div className="account-actions">{status === "pending" && <><button className="button primary" onClick={() => change(account, "approved")}><ShieldCheck size={14}/> Approve</button><button className="button secondary" onClick={() => change(account, "rejected")}>Reject</button></>}{status === "approved" && <button className="button secondary" disabled><ShieldCheck size={14}/> Approved</button>}{status === "rejected" && <button className="button danger" onClick={() => setPendingDelete(account)}><Trash2 size={14}/> Delete</button>}</div></td></tr>; })}</tbody></table></div></section>{pendingDelete && <div className="detail-backdrop" onClick={() => setPendingDelete(null)}><aside className="detail-drawer confirm-drawer" onClick={(event) => event.stopPropagation()}><div className="detail-heading"><div><span className="eyebrow">DELETE REJECTED ACCOUNT</span><h2>{pendingDelete.full_name}</h2></div><button className="icon-btn" onClick={() => setPendingDelete(null)}><X size={18}/></button></div><p>This permanently removes the rejected staff profile. This action cannot be undone.</p><div className="detail-actions"><button className="button secondary" onClick={() => setPendingDelete(null)}>Cancel</button><button className="button danger" onClick={remove}><Trash2 size={14}/> Delete account</button></div></aside></div>}</>;
}
