import { useEffect, useRef, useState } from "react";
import { ExternalLink, MapPin, Search, X } from "lucide-react";
import { hasSupabaseConfig, invokeApi, listRecords, subscribeToTable } from "../lib/data";

const capitalize = (value) =>
  value.replace(/^./, (letter) => letter.toUpperCase());

export default function TrackerView() {
  const [trackers, setTrackers] = useState([]);
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const singleMapHost = useRef(null);
  const allMapHost = useRef(null);
  const singleMap = useRef(null);
  const allMap = useRef(null);

  const load = async () => {
    if (!hasSupabaseConfig)
      return setMessage("Connect Supabase to view live tracker data.");
    const [trackerResult, productResult, customerResult] = await Promise.all([
      listRecords("trackers", { pageSize: 500 }),
      listRecords("bikes", { pageSize: 500 }),
      listRecords("customers", { pageSize: 500 }),
    ]);
    const error = trackerResult.error || productResult.error || customerResult.error;
    if (error) return setMessage(error.message);
    setTrackers(trackerResult.data);
    setProducts(productResult.data);
    setCustomers(customerResult.data);
    setMessage("");
  };

  const refreshLiveStatus = async ({ silent = false } = {}) => {
    setRefreshing(true);
    const result = await invokeApi("/v1/admin/trackers/refresh", {});
    setRefreshing(false);
    if (result.error) return setMessage(result.error.message);
    const unavailable = (result.data?.trackers ?? []).filter((tracker) => tracker.status === "not_configured" || tracker.status === "unreachable" || tracker.status === "invalid_report");
    if (!silent || unavailable.length) setMessage(unavailable.length ? `${unavailable.length} tracker(s) need attention. ${unavailable[0].message || "Check their Tramigo device IDs."}` : "Live Tramigo tracker status refreshed.");
    await load();
  };

  useEffect(() => {
    load();
    refreshLiveStatus({ silent: true });
    const unsubscribers = ["trackers", "bikes", "customers"].map((table) => subscribeToTable(table, load));
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, []);

  const trackerStatus = (tracker) =>
    tracker.operational_status === "immobilized"
      ? "immobilized"
      : tracker.is_online
        ? "online"
        : "offline";
  const trackerCondition = (tracker) => tracker.device_condition || "normal";
  const productFor = (tracker) =>
    products.find((product) => product.id === tracker.bike_id);
  const customerFor = (tracker) =>
    customers.find((customer) => customer.id === productFor(tracker)?.customer_id);
  const linkedTrackers = trackers.filter((tracker) => productFor(tracker));
  const rows = linkedTrackers.filter((tracker) => {
    const text =
      `${productFor(tracker)?.identifier || "Unlinked"} ${tracker.identifier}`.toLowerCase();
    return (
      text.includes(query.trim().toLowerCase()) &&
      (!status || status === trackerStatus(tracker))
    );
  });

  useEffect(() => {
    if (
      !selected ||
      !singleMapHost.current ||
      !window.L ||
      selected.latitude == null ||
      selected.longitude == null
    )
      return;
    const point = [Number(selected.latitude), Number(selected.longitude)];
    singleMap.current?.remove();
    singleMap.current = window.L.map(singleMapHost.current, {
      dragging: true,
      touchZoom: true,
      scrollWheelZoom: true,
      worldCopyJump: true,
    }).setView(point, 16);
    singleMap.current.dragging.enable();
    singleMap.current.touchZoom.enable();
    singleMap.current.boxZoom.enable();
    singleMap.current.keyboard.enable();
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors",
    }).addTo(singleMap.current);
    window.L.circleMarker(point, {
      radius: 12,
      color: "#d92d20",
      fillColor: "#f04438",
      weight: 3,
      fillOpacity: 1,
    })
      .addTo(singleMap.current)
      .bindTooltip(`LIVE · ${selected.identifier}`, {
        permanent: true,
        direction: "top",
        className: "live-location-label",
      });
    setTimeout(() => singleMap.current?.invalidateSize(), 0);
    return () => {
      singleMap.current?.remove();
      singleMap.current = null;
    };
  }, [selected]);

  useEffect(() => {
    if (!showAll || !allMapHost.current || !window.L) return;
    const located = linkedTrackers.filter(
      (tracker) => tracker.latitude != null && tracker.longitude != null,
    );
    allMap.current?.remove();
    allMap.current = window.L.map(allMapHost.current, {
      dragging: true,
      touchZoom: true,
      scrollWheelZoom: true,
      worldCopyJump: true,
    }).setView([-1.286389, 36.817223], 7);
    allMap.current.dragging.enable();
    allMap.current.touchZoom.enable();
    allMap.current.boxZoom.enable();
    allMap.current.keyboard.enable();
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors",
    }).addTo(allMap.current);
    const points = located.map((tracker) => {
      const point = [Number(tracker.latitude), Number(tracker.longitude)];
      window.L.circleMarker(point, {
        radius: 9,
        color: trackerStatus(tracker) === "online" ? "#16865f" : "#d98221",
        fillOpacity: 0.9,
      })
        .addTo(allMap.current)
        .bindTooltip(
          `${productFor(tracker)?.identifier || "Unlinked"} · ${tracker.identifier}`,
        );
      return point;
    });
    if (points.length)
      allMap.current.fitBounds(points, { padding: [35, 35], maxZoom: 15 });
    setTimeout(() => allMap.current?.invalidateSize(), 0);
    return () => {
      allMap.current?.remove();
      allMap.current = null;
    };
  }, [showAll, linkedTrackers, products]);

  return (
    <>
      <section className="panel module-table">
        <div className="panel-heading">
          <div>
            <h2>GPS Trackers</h2>
            <p>Monitor tracker health and open the latest live location.</p>
          </div>
          <div className="button-row"><button className="button secondary" disabled={refreshing} onClick={refreshLiveStatus}>{refreshing ? "Refreshing…" : "Refresh live status"}</button><button className="button primary" onClick={() => setShowAll(true)}><MapPin size={15} /> View all trackers</button></div>
        </div>
        <div className="directory-filters tracker-filters">
          <label className="table-search">
            <Search size={15} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search product or tracker code"
            />
          </label>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">All tracker status</option>
            <option value="online">Online</option>
            <option value="offline">Offline</option>
            <option value="immobilized">Immobilized</option>
          </select>
        </div>
        {message && <div className="import-message">{message}</div>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Customer</th>
                <th>Tracker code</th>
                <th>Last seen</th>
                <th>Status</th>
                <th>Condition</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((tracker) => (
                <tr key={tracker.id} className="tracker-row">
                  <td>
                    <strong>
                      {productFor(tracker)?.identifier || "Unlinked"}
                    </strong>
                  </td>
                  <td>
                    {customerFor(tracker)?.full_name || "Unassigned"}
                    <small>{customerFor(tracker)?.customer_code || ""}</small>
                  </td>
                  <td>{tracker.identifier}</td>
                  <td>
                    {tracker.last_seen_at
                      ? new Date(tracker.last_seen_at).toLocaleString()
                      : "Never"}
                  </td>
                  <td>{capitalize(trackerStatus(tracker))}</td>
                  <td>
                    <span
                      className={`tracker-condition ${trackerCondition(tracker)}`}
                    >
                      {capitalize(trackerCondition(tracker))}
                    </span>
                  </td>
                  <td>
                    <button
                      className="button secondary"
                      onClick={() => setSelected(tracker)}
                    >
                      <MapPin size={14} /> Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {selected && (
        <div className="detail-backdrop" onClick={() => setSelected(null)}>
          <aside
            className="detail-drawer tracker-location-drawer"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="detail-heading">
              <div>
                <span className="eyebrow">TRACKER RECORD</span>
                <h2>{selected.identifier}</h2>
                <p>{customerFor(selected)?.full_name || "No customer assigned"}</p>
              </div>
              <button className="icon-btn" onClick={() => setSelected(null)}>
                <X size={18} />
              </button>
            </div>
            {selected.latitude != null && selected.longitude != null ? (
              <>
                <div ref={singleMapHost} className="tracker-location-map" />
                <div className="tracker-location-facts">
                  <p>
                    <b>Status</b>
                    <span className={`map-state ${trackerStatus(selected)}`}>
                      {capitalize(trackerStatus(selected))}
                    </span>
                  </p>
                  <p>
                    <b>Condition</b>
                    {capitalize(trackerCondition(selected))}
                  </p>
                  <p>
                    <b>Customer</b>
                    {customerFor(selected)?.full_name || "Unassigned"}
                  </p>
                  <p>
                    <b>Linked product</b>
                    {productFor(selected)?.identifier || "Unlinked"}
                  </p>
                  <p>
                    <b>Last seen</b>
                    {selected.last_seen_at
                      ? new Date(selected.last_seen_at).toLocaleString()
                      : "Never"}
                  </p>
                  <p>
                    <b>Coordinates</b>
                    {Number(selected.latitude).toFixed(6)},{" "}
                    {Number(selected.longitude).toFixed(6)}
                  </p>
                </div>
                <a
                  className="button primary tracker-route"
                  target="_blank"
                  rel="noreferrer"
                  href={`https://www.openstreetmap.org/?mlat=${selected.latitude}&mlon=${selected.longitude}#map=17/${selected.latitude}/${selected.longitude}`}
                >
                  <MapPin size={15} /> Open live route{" "}
                  <ExternalLink size={14} />
                </a>
              </>
            ) : (
              <div className="empty-state">
                <MapPin size={22} />
                <strong>No live location yet</strong>
                <span>This tracker has not sent GPS coordinates.</span>
              </div>
            )}
          </aside>
        </div>
      )}
      {showAll && (
        <div className="detail-backdrop" onClick={() => setShowAll(false)}>
          <aside
            className="detail-drawer all-trackers-drawer"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="detail-heading">
              <div>
                <span className="eyebrow">LIVE FLEET MAP</span>
                <h2>All GPS trackers</h2>
                <p>
                  {
                    linkedTrackers.filter(
                      (tracker) =>
                        tracker.latitude != null && tracker.longitude != null,
                    ).length
                  }{" "}
                  trackers with location
                </p>
              </div>
              <button className="icon-btn" onClick={() => setShowAll(false)}>
                <X size={18} />
              </button>
            </div>
            <div ref={allMapHost} className="all-trackers-map" />
          </aside>
        </div>
      )}
    </>
  );
}
