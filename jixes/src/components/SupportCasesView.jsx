import { useEffect, useState } from "react";
import { MessageCircle, ShieldCheck, Wifi, X } from "lucide-react";
import { createRecord, hasSupabaseConfig, listRecords, subscribeToTable, updateRecord } from "../lib/data";
import { getSession } from "../lib/auth";
import { recordAudit } from "../lib/security";

const emptyCase = { title: "", priority: "normal", assigned_to: "", notes: "" };

function CaseDrawer({ item, staff, history, onClose, onSaved }) {
  const creating = !item;
  const [form, setForm] = useState(creating ? emptyCase : { ...item, assigned_to: item.assigned_to || "" });
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const saveNew = async (event) => {
    event.preventDefault();
    if (!form.title.trim()) return setMessage("Case title is required.");
    setSaving(true);
    const result = await createRecord("support_cases", { title: form.title.trim(), priority: form.priority, assigned_to: form.assigned_to || null, notes: form.notes.trim() || null, created_by: getSession()?.userId || null });
    setSaving(false);
    if (result.error) return setMessage(result.error.message);
    recordAudit({ action: "created support case", resource: "Support Cases", detail: form.title });
    onSaved(); onClose();
  };
  const change = async (changes, action) => {
    setSaving(true);
    const result = await updateRecord("support_cases", item.id, changes);
    if (!result.error) await createRecord("support_case_history", { case_id: item.id, action, note: changes.notes || null, actor_id: getSession()?.userId || null });
    setSaving(false);
    if (result.error) return setMessage(result.error.message);
    setForm((current) => ({ ...current, ...changes }));
    recordAudit({ action, resource: "Support Cases", detail: item.title }); onSaved();
  };
  return <div className="detail-backdrop" onClick={onClose}><aside className="detail-drawer workflow-drawer support-case-drawer" onClick={(event) => event.stopPropagation()}><div className="detail-heading"><div><span className="eyebrow">{creating ? "NEW SUPPORT CASE" : "CASE WORKFLOW"}</span><h2>{creating ? "Add case" : item.title}</h2></div><button className="icon-btn" onClick={onClose}><X size={18}/></button></div>{creating ? <form className="case-form support-create-form" onSubmit={saveNew}><label>Case title<input value={form.title} onChange={(event) => set("title", event.target.value)} placeholder="Describe the support issue" required/></label><label>Priority<select value={form.priority} onChange={(event) => set("priority", event.target.value)}><option>low</option><option>normal</option><option>high</option><option>urgent</option></select></label><label>Assigned staff<select value={form.assigned_to} onChange={(event) => set("assigned_to", event.target.value)}><option value="">Unassigned</option>{staff.map((person) => <option key={person.id} value={person.id}>{person.full_name}</option>)}</select></label><label>Notes<textarea value={form.notes} onChange={(event) => set("notes", event.target.value)} placeholder="Add case details"/></label>{message && <div className="import-message">{message}</div>}<div className="detail-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving}><MessageCircle size={15}/>{saving ? "Saving…" : "Create case"}</button></div></form> : <div className="case-form"><label>Assigned staff<select value={form.assigned_to || ""} onChange={(event) => change({ assigned_to: event.target.value || null }, "assigned case")}><option value="">Unassigned</option>{staff.map((person) => <option key={person.id} value={person.id}>{person.full_name}</option>)}</select></label><label>Priority<select value={form.priority} onChange={(event) => change({ priority: event.target.value }, "changed priority")}><option>low</option><option>normal</option><option>high</option><option>urgent</option></select></label><label>Case note<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add an operational note"/></label><button className="button secondary" disabled={!note.trim() || saving} onClick={() => { change({ notes: note.trim() }, "added note"); setNote(""); }}>Add note</button><section className="history"><h3>Resolution history</h3>{history.map((entry) => <p key={entry.id}><strong>{entry.action}</strong><span>{entry.note || ""} · {new Date(entry.created_at).toLocaleString()}</span></p>)}</section>{message && <div className="import-message">{message}</div>}<div className="detail-actions">{!["resolved", "closed"].includes(form.status) && <button className="button primary" disabled={saving} onClick={() => change({ status: "closed", resolved_at: new Date().toISOString() }, "closed case")}>Close case</button>}<button className="button secondary" onClick={onClose}>Done</button></div></div>}</aside></div>;
}

export default function SupportCasesView() {
  const [cases, setCases] = useState([]), [staff, setStaff] = useState([]), [history, setHistory] = useState([]), [selected, setSelected] = useState(undefined), [message, setMessage] = useState("");
  const load = async () => { if (!hasSupabaseConfig) return setMessage("Connect Supabase to view support cases."); const results = await Promise.all([listRecords("support_cases", { pageSize: 500 }), listRecords("profiles", { pageSize: 500 }), listRecords("support_case_history", { pageSize: 1000 })]); const error = results.find((result) => result.error)?.error; if (error) return setMessage(error.message); setCases(results[0].data); setStaff(results[1].data.filter((person) => ["super_admin", "operations_manager", "support_agent"].includes(person.role))); setHistory(results[2].data); setMessage(""); };
  useEffect(() => { load(); return subscribeToTable("support_cases", load); }, []);
  return <><section className="module-layout"><article className="panel module-summary"><div className="module-summary-icon"><ShieldCheck size={22}/></div><span>Open cases</span><strong>{cases.filter((item) => !["resolved", "closed"].includes(item.status)).length}</strong><small><Wifi size={13}/> Assignment and resolution history</small></article><article className="panel module-table"><div className="panel-heading"><div><h2>Support cases</h2><p>Assign staff, set priority, add notes, and retain the resolution trail.</p></div><button className="button primary" onClick={() => setSelected(null)}>+ Add case</button></div>{message && <div className="import-message">{message}</div>}<div className="table-wrap"><table><thead><tr><th>Case</th><th>Priority</th><th>Assignee</th><th>Status</th><th>Action</th></tr></thead><tbody>{cases.map((item) => <tr key={item.id}><td><strong>{item.title}</strong><small>{item.notes}</small></td><td>{item.priority}</td><td>{staff.find((person) => person.id === item.assigned_to)?.full_name || "Unassigned"}</td><td>{item.status}</td><td><button className="button secondary" onClick={() => setSelected(item)}>Open</button></td></tr>)}</tbody></table></div></article></section>{selected !== undefined && <CaseDrawer item={selected} staff={staff} history={history.filter((entry) => entry.case_id === selected?.id)} onClose={() => setSelected(undefined)} onSaved={load}/>}</>;
}
