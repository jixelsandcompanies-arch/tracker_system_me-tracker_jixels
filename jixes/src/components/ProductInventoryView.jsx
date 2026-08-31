import { useEffect, useState } from "react";
import { Bike, Radio, Search, Trash2, UserRound, X } from "lucide-react";
import { createRecord, deleteRecord, hasSupabaseConfig, listRecords, subscribeToTable, updateRecord } from "../lib/data";
import { recordAudit } from "../lib/security";

const empty = { product_type: "bike", tracker_number: "", assigned_agent_id: "" };

export default function ProductInventoryView() {
  const [data, setData] = useState({ bikes: [], trackers: [], customers: [], profiles: [], screening_applications: [] });
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(undefined);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);

  const load = async () => {
    if (!hasSupabaseConfig) return setMessage("Connect Supabase to manage inventory.");
    const names = ["bikes", "trackers", "customers", "profiles", "screening_applications"];
    const results = await Promise.all(names.map((table) => listRecords(table, { pageSize: 1000 })));
    const error = results.find((result) => result.error)?.error;
    if (error) return setMessage(error.message);
    setData(Object.fromEntries(names.map((name, index) => [name, results[index].data])));
    setMessage("");
  };

  useEffect(() => {
    load();
    const unsubscribers = ["bikes", "trackers", "profiles", "screening_applications"].map((table) => subscribeToTable(table, load));
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, []);

  const agents = data.profiles.filter((profile) => ["support_agent", "Support agent"].includes(profile.role));
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const open = (product = null) => {
    setEditing(product);
    setForm(product ? {
      product_type: product.product_type,
      assigned_agent_id: product.assigned_agent_id || "",
      tracker_number: data.trackers.find((tracker) => tracker.bike_id === product.id)?.identifier || "",
    } : empty);
  };
  const inventoryStatus = (product) => {
    if (!product.customer_id) return "Available";
    const pending = data.screening_applications.some((screening) => screening.customer_id === product.customer_id && ["new", "reviewing", "pending"].includes(screening.status));
    return pending ? "Pending" : "Sold";
  };
  const visibleProducts = data.bikes.filter((product) => {
    const tracker = data.trackers.find((item) => item.bike_id === product.id)?.identifier || "";
    const agent = data.profiles.find((profile) => profile.id === product.assigned_agent_id)?.full_name || "";
    return `${product.product_type} ${product.identifier} ${tracker} ${agent}`.toLowerCase().includes(query.trim().toLowerCase());
  });

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    const trackerNumber = form.tracker_number.trim();
    const identifier = trackerNumber || `${form.product_type.toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
    const payload = {
      ...(editing ? {} : { identifier, model: form.product_type }),
      product_type: form.product_type,
      assigned_agent_id: form.assigned_agent_id || null,
    };
    const result = editing ? await updateRecord("bikes", editing.id, payload) : await createRecord("bikes", payload);
    const productId = editing?.id || result.data?.id;
    if (!result.error && productId) {
      const previousTracker = data.trackers.find((item) => item.bike_id === productId && item.identifier !== trackerNumber);
      if (previousTracker) await updateRecord("trackers", previousTracker.id, { bike_id: null });
      if (trackerNumber) {
        const tracker = data.trackers.find((item) => item.identifier.toLowerCase() === trackerNumber.toLowerCase());
        if (tracker) await updateRecord("trackers", tracker.id, { bike_id: productId });
        else await createRecord("trackers", { identifier: trackerNumber, bike_id: productId, is_online: false });
      }
    }
    setSaving(false);
    if (result.error) return setMessage(result.error.message);
    recordAudit({ action: editing ? "updated inventory assignment" : "registered inventory product", resource: "Product Inventory", detail: editing?.identifier || identifier });
    setEditing(undefined);
    setForm(empty);
    load();
  }
  const toggle = (id) => setSelectedIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
  async function remove(ids) {
    if (!ids.length || !window.confirm(`Delete ${ids.length} product record${ids.length === 1 ? "" : "s"}?`)) return;
    for (const id of ids) await deleteRecord("bikes", id);
    recordAudit({ action: "deleted inventory products", resource: "Product Inventory", detail: `${ids.length} record(s)` });
    setSelectedIds([]);
    load();
  }

  return <>
    <section className="panel module-table">
      <div className="panel-heading">
        <div><h2>Product inventory</h2><p>Add product types, link tracker numbers, and allocate agents. Customer and status update automatically.</p></div>
        <button className="button primary" onClick={() => open()}>+ Add product</button>
      </div>
      <div className="directory-filters inventory-filters"><label className="table-search"><Search size={15}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search products, trackers, or agents"/></label><button className="button secondary" onClick={() => remove(selectedIds)}>Delete selected</button><button className="button danger" onClick={() => remove(visibleProducts.map((product) => product.id))}>Delete all</button></div>
      {message && <div className="import-message">{message}</div>}
      <div className="table-wrap"><table>
        <thead><tr><th><input type="checkbox" checked={visibleProducts.length > 0 && visibleProducts.every((product) => selectedIds.includes(product.id))} onChange={(event) => setSelectedIds(event.target.checked ? visibleProducts.map((product) => product.id) : [])}/></th><th>Product</th><th>Assigned customer</th><th>Tracker</th><th>Assigned agent</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>{visibleProducts.map((product) => <tr key={product.id}>
          <td><input type="checkbox" checked={selectedIds.includes(product.id)} onChange={() => toggle(product.id)}/></td>
          <td><strong>{product.product_type}</strong><small>{product.identifier}</small></td>
          <td>{data.customers.find((customer) => customer.id === product.customer_id)?.full_name || "—"}</td>
          <td>{data.trackers.find((tracker) => tracker.bike_id === product.id)?.identifier || "Unlinked"}</td>
          <td>{data.profiles.find((profile) => profile.id === product.assigned_agent_id)?.full_name || "Unassigned"}</td>
          <td><span className={`inventory-status ${inventoryStatus(product).toLowerCase()}`}>{inventoryStatus(product)}</span></td>
          <td><div className="account-actions"><button className="button secondary" onClick={() => open(product)}>Update</button><button className="button danger" onClick={() => remove([product.id])}><Trash2 size={14}/> Delete</button></div></td>
        </tr>)}</tbody>
      </table></div>
    </section>

    {editing !== undefined && <div className="detail-backdrop inventory-backdrop" onClick={() => setEditing(undefined)}>
      <aside className="detail-drawer workflow-drawer inventory-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="detail-heading">
          <div><span className="eyebrow">INVENTORY ASSIGNMENT</span><h2>{editing ? "Update product" : "Add product"}</h2>{editing && <p className="inventory-record-id">{editing.identifier}</p>}</div>
          <button className="icon-btn" onClick={() => setEditing(undefined)}><X size={18}/></button>
        </div>
        <form className="customer-record-form" onSubmit={save}>
          <div className="customer-form-grid">
            <label>Product type<select value={form.product_type} onChange={(event) => set("product_type", event.target.value)}><option>bike</option><option>car</option><option>tuktuk</option><option>device</option><option>other</option></select></label>
            <label><Radio size={14}/> Tracker number<input value={form.tracker_number} onChange={(event) => set("tracker_number", event.target.value)} placeholder="Type tracker number"/></label>
            <label className="wide"><UserRound size={14}/> Assigned agent<select value={form.assigned_agent_id} onChange={(event) => set("assigned_agent_id", event.target.value)}><option value="">No agent</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.full_name}</option>)}</select></label>
          </div>
          <div className="detail-actions"><button className="button secondary" type="button" onClick={() => setEditing(undefined)}>Cancel</button><button className="button primary" disabled={saving}><Bike size={15}/>{saving ? "Saving…" : editing ? "Update product" : "Add to inventory"}</button></div>
        </form>
      </aside>
    </div>}
  </>;
}
