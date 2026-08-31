import { useEffect, useState } from "react";
import { Search, ShieldCheck, UserRound, X } from "lucide-react";
import { hasSupabaseConfig, invokeFunction, listRecords, subscribeToTable, updateRecord } from "../lib/data";
import { recordAudit } from "../lib/security";

const statusLabel = (status) => status === "approved" ? "Approved" : status === "suspended" || status === "declined" ? "Suspended" : "Pending";
const applicationId = (application) => `APP-${application.id.replaceAll("-", "").slice(0, 10).toUpperCase()}`;

function Document({ src, label, fallback = "Not submitted" }) {
  return <article className="screening-document"><span>{label}</span>{src ? <img src={src} alt={label}/> : <div><UserRound size={24}/><small>{fallback}</small></div>}</article>;
}

function ReviewDrawer({ application, agents, onClose, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const agent = agents.find((item) => item.id === application.installer_agent_id)?.full_name || "Unassigned";
  const approve = async () => {
    setBusy(true); setMessage("");
    const result = await invokeFunction("approve-screening", { applicationId: application.id });
    setBusy(false);
    if (result.error) return setMessage(result.error.message);
    recordAudit({ action: "approved customer and issued OTP", resource: "Screening", detail: application.full_name });
    setMessage("Approved. The customer notification and one-time login code were issued securely.");
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
  return <div className="detail-backdrop" onClick={onClose}><aside className="detail-drawer screening-review-drawer" onClick={(event) => event.stopPropagation()}><div className="detail-heading"><div><span className="eyebrow">CUSTOMER SCREENING</span><h2>{application.full_name}</h2><p>{applicationId(application)} · {statusLabel(application.status)}</p></div><button className="icon-btn" onClick={onClose}><X size={18}/></button></div><div className="screening-documents"><Document src={application.customer_photo_url} label="Customer photo"/><Document src={application.id_front_url} label="National ID — front"/><Document src={application.id_back_url} label="National ID — back"/><Document src={application.passport_url} label="Passport"/></div><section className="screening-review-details"><h3>Customer details</h3><dl><div><dt>National ID / Passport</dt><dd>{application.national_id || "—"}</dd></div><div><dt>Phone</dt><dd>{application.phone || "—"}</dd></div><div><dt>Email</dt><dd>{application.email || "—"}</dd></div><div><dt>Address / Town</dt><dd>{application.address_town || "—"}</dd></div></dl><h3>Product and account</h3><dl><div><dt>Product identity</dt><dd>{application.vehicle_type || "product"} | {application.registration_number || application.chassis_vin || "—"}</dd></div><div><dt>Make / Model</dt><dd>{[application.vehicle_make, application.vehicle_model].filter(Boolean).join(" ") || "—"}</dd></div><div><dt>Agent</dt><dd>{agent}</dd></div><div><dt>Deposit</dt><dd>KES {Number(application.deposit_amount || 0).toLocaleString()}</dd></div><div><dt>Tracker / IMEI</dt><dd>{application.tracker_identifier || application.tracker_serial_number || "—"}</dd></div><div><dt>Service plan</dt><dd>{application.service_plan || "—"}</dd></div></dl></section>{message && <div className="import-message">{message}</div>}<div className="detail-actions"><button className="button secondary" onClick={onClose}>Close</button>{application.status !== "suspended" && application.status !== "declined" && <button className="button secondary" disabled={busy} onClick={suspend}>Suspend</button>}{application.status !== "approved" && <button className="button primary" disabled={busy} onClick={approve}><ShieldCheck size={15}/>{busy ? "Processing…" : "Approve customer"}</button>}</div></aside></div>;
}

export default function ScreeningWorkflowView() {
  const [applications, setApplications] = useState([]);
  const [agents, setAgents] = useState([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
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
