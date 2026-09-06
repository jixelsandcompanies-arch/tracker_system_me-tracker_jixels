import { useEffect, useState } from "react";
import { Search, ShieldCheck, Trash2, UserRound, X } from "lucide-react";
import { hasSupabaseConfig, invokeApi, listRecords, subscribeToTable, updateRecord } from "../lib/data";
import { recordAudit } from "../lib/security";

const statusLabel = (status) => status === "approved" ? "Approved" : status === "suspended" || status === "declined" ? "Suspended" : "Pending";
const applicationId = (application) => `APP-${application.id.replaceAll("-", "").slice(0, 10).toUpperCase()}`;

function Document({ src, label, fallback = "Not submitted" }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return <article className="screening-document"><span>{label}</span>{src && !failed ? <img src={src} alt={label} onError={() => setFailed(true)}/> : <div><UserRound size={24}/><small>{failed ? "Image unavailable" : fallback}</small></div>}</article>;
}

function ReviewDrawer({ application, agents, onClose, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [documents, setDocuments] = useState(null);
  const [documentsLoading, setDocumentsLoading] = useState(true);
  const agent = agents.find((item) => item.id === application.installer_agent_id)?.full_name || "Unassigned";
  useEffect(() => {
    let active = true;
    setDocumentsLoading(true);
    invokeApi(`/v1/admin/screening/${encodeURIComponent(application.id)}/documents`, null, "GET").then((result) => {
      if (!active) return;
      setDocuments(result.data?.documents || null);
      if (result.error) setMessage(result.error.message);
      setDocumentsLoading(false);
    }).catch(() => { if (active) setDocumentsLoading(false); });
    return () => { active = false; };
  }, [application.id]);
  const documentUrl = (field) => documents?.[field] || "";
  const approve = async () => {
    setBusy(true); setMessage("");
    const result = await invokeApi("/v1/admin/screening/approve", { applicationId: application.id });
    setBusy(false);
    if (result.error) return setMessage(result.error.message);
    recordAudit({ action: "approved customer and issued OTP", resource: "Screening", detail: application.full_name });
    setMessage(result.data?.message || "Approved. The one-time code was sent to the customer's registered contact.");
    onChanged();
  };
  const suspend = async () => {
    setBusy(true); setMessage("");
    const result = await updateRecord("screening_applications", application.id, { status: "suspended" });
    setBusy(false);
    if (result.error) return setMessage(result.error.message);
    recordAudit({ action: "suspended screening application", resource: "Screening", detail: application.full_name });
    setMessage("Application suspended."); onChanged();
  };
  const remove = async () => {
    if (!application.customer_id || !window.confirm(`Permanently delete ${application.full_name} and every linked record?`)) return;
    setBusy(true); setMessage("");
    const result = await invokeApi(`/v1/admin/users/${encodeURIComponent(application.customer_id)}`, null, "DELETE");
    setBusy(false);
    if (result.error) return setMessage(result.error.message);
    onChanged(); onClose();
  };
  return <div className="detail-backdrop" onClick={onClose}><aside className="detail-drawer screening-review-drawer" onClick={(event) => event.stopPropagation()}><div className="detail-heading"><div><span className="eyebrow">CUSTOMER SCREENING</span><h2>{application.full_name}</h2><p>{applicationId(application)} · {statusLabel(application.status)}</p></div><button className="icon-btn" onClick={onClose}><X size={18}/></button></div><div className="screening-documents"><Document src={documentUrl("customer_photo_url")} label="Customer photo" fallback={documentsLoading ? "Loading image" : "Not submitted"}/><Document src={documentUrl("id_front_url")} label="National ID — front" fallback={documentsLoading ? "Loading image" : "Not submitted"}/><Document src={documentUrl("id_back_url")} label="National ID — back" fallback={documentsLoading ? "Loading image" : "Not submitted"}/></div><section className="screening-review-details"><h3>Customer details</h3><dl><div><dt>National ID</dt><dd>{application.national_id || "—"}</dd></div><div><dt>Phone</dt><dd>{application.phone || "—"}</dd></div><div><dt>Email</dt><dd>{application.email || "—"}</dd></div><div><dt>Location</dt><dd>{application.location || "—"}</dd></div></dl><h3>Product and account</h3><dl><div><dt>Product identity</dt><dd>{application.product_type || "Product"} | {application.product_identifier || "—"}</dd></div><div><dt>Make / Model</dt><dd>{application.product_model || "—"}</dd></div><div><dt>Agent</dt><dd>{agent}</dd></div><div><dt>Deposit</dt><dd>KES {Number(application.deposit_amount || 0).toLocaleString()}</dd></div><div><dt>Tracker / IMEI</dt><dd>{application.tracker_identifier || "—"}</dd></div><div><dt>Service plan</dt><dd>KES {Number(application.monthly_service_amount || 700).toLocaleString()} per month</dd></div></dl></section>{message && <div className="import-message">{message}</div>}<div className="detail-actions"><button className="button secondary" onClick={onClose}>Close</button>{application.status !== "suspended" && application.status !== "declined" && <button className="button secondary" disabled={busy} onClick={suspend}>Suspend</button>}{application.status === "approved" ? <button className="button danger" disabled={busy} onClick={remove}><Trash2 size={15}/>{busy ? "Deleting…" : "Delete customer"}</button> : <button className="button primary" disabled={busy} onClick={approve}><ShieldCheck size={15}/>{busy ? "Processing…" : "Approve customer"}</button>}</div></aside></div>;
}

export default function ScreeningWorkflowView() {
  const [applications, setApplications] = useState([]);
  const [agents, setAgents] = useState([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("pending");
  const [selected, setSelected] = useState(null);
  const [message, setMessage] = useState("");
  const load = async () => {
    if (!hasSupabaseConfig) return setMessage("Connect Supabase to view screening applications.");
    const [apps, profiles] = await Promise.all([listRecords("screening_applications", { pageSize: 500 }), listRecords("profiles", { pageSize: 500 })]);
    const error = apps.error || profiles.error;
    if (error) return setMessage(error.message);
    setApplications(apps.data); setAgents(profiles.data); setMessage("");
  };
  useEffect(() => { load(); return subscribeToTable("screening_applications", load); }, []);
  const visible = applications.filter((application) => {
    const normalized = statusLabel(application.status).toLowerCase();
    return (!status || normalized === status) && JSON.stringify(application).toLowerCase().includes(query.toLowerCase());
  });
  return <><section className="panel module-table"><div className="panel-heading"><div><h2>Screening applications</h2><p>Applications submitted from the customer app for identity and account approval.</p></div></div><div className="directory-filters"><label className="table-search"><Search size={15}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search application, customer, tracker, or ID"/></label><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="suspended">Suspended</option></select></div>{message && <div className="import-message">{message}</div>}<div className="table-wrap"><table><thead><tr><th>Application ID</th><th>Customer</th><th>National ID</th><th>Agent</th><th>Tracker</th><th>Deposit</th><th>Status</th><th>Actions</th></tr></thead><tbody>{visible.map((application) => <tr key={application.id}><td>{applicationId(application)}</td><td><strong>{application.full_name}</strong></td><td>{application.national_id || "—"}</td><td>{agents.find((agent) => agent.id === application.installer_agent_id)?.full_name || "Unassigned"}</td><td>{application.tracker_identifier || application.tracker_serial_number || "—"}</td><td>KES {Number(application.deposit_amount || 0).toLocaleString()}</td><td><span className={`screening-status ${statusLabel(application.status).toLowerCase()}`}>{statusLabel(application.status)}</span></td><td><button className="text-button screening-open" onClick={() => setSelected(application)}>Open</button></td></tr>)}</tbody></table></div></section>{selected && <ReviewDrawer application={applications.find((item) => item.id === selected.id) || selected} agents={agents} onClose={() => setSelected(null)} onChanged={load}/>}</>;
}
