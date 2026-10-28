import { useEffect, useState } from "react";
import { Bike, Radio, Search, Trash2, UserRound, X } from "lucide-react";
import { createRecord, hasSupabaseConfig, invokeApi, listRecords, subscribeToTable, updateRecord } from "../lib/data";
import { recordAudit } from "../lib/security";

const empty = { product_type: "bike", custom_product_type: "", tracker_number: "", assigned_agent_id: "", payable_amount: "" };

function money(value) {
  return `KES ${Number(value || 0).toLocaleString("en-KE")}`;
}

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

  const agents = data.profiles.filter((profile) =>
    ["agent", "support_agent", "Support agent"].includes(profile.role)
    && ["active", "approved"].includes(profile.account_status || "active"),
  );
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const open = (product = null) => {
    setMessage("");
    setEditing(product);
    setForm(product ? {
      product_type: product.product_type,
      custom_product_type: product.custom_product_type || "",
      assigned_agent_id: product.assigned_agent_id || "",
      tracker_number: data.trackers.find((tracker) => tracker.bike_id === product.id)?.identifier || "",
      payable_amount: product.payable_amount == null ? "" : String(product.payable_amount),
    } : empty);
  };
  const inventoryStatus = (product) => {
    if (!product.customer_id) return "Available";
    const pending = data.screening_applications.some((screening) => screening.customer_id === product.customer_id && ["new", "reviewing", "pending"].includes(screening.status));
    return pending ? "Pending" : "Sold";
  };
  const trackerFor = (product) => data.trackers.find((tracker) => tracker.bike_id === product.id);
  const trackerLocation = (tracker) => tracker && tracker.latitude != null && tracker.longitude != null
    ? `${Number(tracker.latitude).toFixed(5)}, ${Number(tracker.longitude).toFixed(5)}`
    : "Location not received";
  const visibleProducts = data.bikes.filter((product) => {
    const tracker = data.trackers.find((item) => item.bike_id === product.id)?.identifier || "";
    const agent = data.profiles.find((profile) => profile.id === product.assigned_agent_id)?.full_name || "";
    return `${product.product_type} ${product.identifier} ${tracker} ${agent} ${product.payable_amount || ""}`.toLowerCase().includes(query.trim().toLowerCase());
  });

  async function save(event) {
    event.preventDefault();
    setMessage("");
    const trackerNumber = form.tracker_number.trim();
    const amountText = String(form.payable_amount).trim();
    const payableAmount = Number(amountText);
    const productType = form.product_type;
    const customProductType = form.custom_product_type.trim();
    if (!trackerNumber) return setMessage("Tracker number is required.");
    if (!/^\d+(?:\.\d{1,2})?$/.test(amountText) || !Number.isFinite(payableAmount) || payableAmount <= 0 || payableAmount > 9999999999.99) {
      return setMessage("Enter a payable amount above zero with no more than two decimal places.");
    }
    if (!["bike", "car", "tuktuk", "device", "other"].includes(productType)) {
      return setMessage("Choose a valid product type.");
    }
    if (productType === "other" && !customProductType) {
      return setMessage("Enter the product type.");
    }
    const existingTracker = data.trackers.find((tracker) => tracker.identifier.toLowerCase() === trackerNumber.toLowerCase());
    if (existingTracker?.bike_id && existingTracker.bike_id !== editing?.id) {
      return setMessage("This tracker is already linked to another product.");
    }
    setSaving(true);
    const identifier = trackerNumber;
    const model = productType === "other" ? customProductType : productType;
    const payload = {
      ...(editing ? {} : { identifier }),
      model,
      product_type: productType,
      custom_product_type: productType === "other" ? customProductType : null,
      payable_amount: payableAmount,
      assigned_agent_id: form.assigned_agent_id || null,
    };
    const result = editing ? await updateRecord("bikes", editing.id, payload) : await createRecord("bikes", payload);
    const productId = editing?.id || result.data?.id;
    if (!result.error && productId) {
      const previousTracker = data.trackers.find((item) => item.bike_id === productId && item.identifier !== trackerNumber);
      if (previousTracker) await updateRecord("trackers", previousTracker.id, { bike_id: null });
      if (trackerNumber) {
        const tracker = data.trackers.find((item) => item.identifier.toLowerCase() === trackerNumber.toLowerCase());
        const trackerPayload = { bike_id: productId };
        const trackerResult = tracker ? await updateRecord("trackers", tracker.id, trackerPayload) : await createRecord("trackers", { identifier: trackerNumber, ...trackerPayload, is_online: false });
        if (trackerResult.error) { setSaving(false); return setMessage(trackerResult.error.message); }
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
    for (const id of ids) {
      const result = await invokeApi(`/v1/admin/products/${encodeURIComponent(id)}`, null, "DELETE");
      if (result.error) { setMessage(result.error.message); return; }
    }
    recordAudit({ action: "deleted inventory products", resource: "Product Inventory", detail: `${ids.length} record(s)` });
    setSelectedIds([]);
    load();
  }

  return <>
    <section className="panel module-table">
      <div className="panel-heading">
        <div><h2>Product inventory</h2><p>Add tracker products and allocate agents. Use Customer vehicle assignments to sell to an existing customer.</p></div>
        <button className="button primary" onClick={() => open()}>+ Add product</button>
      </div>
      <div className="directory-filters inventory-filters"><label className="table-search"><Search size={15}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search products, trackers, or agents"/></label><button className="button secondary" onClick={() => remove(selectedIds)}>Delete selected</button><button className="button danger" onClick={() => remove(visibleProducts.map((product) => product.id))}>Delete all</button></div>
      {message && <div className="import-message">{message}</div>}
      <div className="table-wrap"><table>
        <thead><tr><th><input type="checkbox" checked={visibleProducts.length > 0 && visibleProducts.every((product) => selectedIds.includes(product.id))} onChange={(event) => setSelectedIds(event.target.checked ? visibleProducts.map((product) => product.id) : [])}/></th><th>Product</th><th>Payable amount</th><th>Assigned customer</th><th>GPS tracker & location</th><th>Assigned agent</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>{visibleProducts.map((product) => <tr key={product.id}>
          <td><input type="checkbox" checked={selectedIds.includes(product.id)} onChange={() => toggle(product.id)}/></td>
          <td><strong>{product.product_type}</strong><small>{product.identifier}</small></td>
          <td>{money(product.payable_amount)}</td>
          <td>{data.customers.find((customer) => customer.id === product.customer_id)?.full_name || "—"}</td>
          <td>{trackerFor(product) ? <div className="inventory-tracker-cell"><strong>{trackerFor(product).identifier}</strong><small>Plate: {trackerFor(product).plate_number || "Not recorded"}</small><small className={trackerFor(product).is_online ? "tracker-online" : "tracker-offline"}>{trackerFor(product).is_online ? "Online" : "Offline"}</small><small>{trackerLocation(trackerFor(product))}</small></div> : <span className="muted-cell">No GPS tracker linked</span>}</td>
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
          {message && <div className="import-message" role="alert">{message}</div>}
          <div className="customer-form-grid">
            <label>Product type<select required value={form.product_type} onChange={(event) => set("product_type", event.target.value)}><option value="bike">Bike</option><option value="car">Car</option><option value="tuktuk">Tuk-tuk</option><option value="device">Device</option><option value="other">Other</option></select></label>{form.product_type === "other" && <label>Custom product type<input required value={form.custom_product_type} onChange={(event) => set("custom_product_type", event.target.value)} placeholder="Enter product type"/></label>}
            <label><Radio size={14}/> Tracker number<input required value={form.tracker_number} onChange={(event) => set("tracker_number", event.target.value)} placeholder="Type tracker number"/></label>
            <label>Payable amount<input required type="number" min="0.01" max="9999999999.99" step="0.01" value={form.payable_amount} onChange={(event) => set("payable_amount", event.target.value)} placeholder="Total customer payable"/></label>
            <label className="wide"><UserRound size={14}/> Assigned agent<select value={form.assigned_agent_id} onChange={(event) => set("assigned_agent_id", event.target.value)}><option value="">No agent</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.full_name}</option>)}</select></label>
          </div>
          <div className="detail-actions"><button className="button secondary" type="button" onClick={() => setEditing(undefined)}>Cancel</button><button className="button primary" disabled={saving}><Bike size={15}/>{saving ? "Saving…" : editing ? "Update product" : "Add to inventory"}</button></div>
        </form>
      </aside>
    </div>}
  </>;
}
