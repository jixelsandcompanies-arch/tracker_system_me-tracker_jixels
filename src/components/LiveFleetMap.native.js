import React, { useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { WebView } from "react-native-webview";

const DEFAULT_CENTER = { latitude: 0.0236, longitude: 37.9062 };
const validPoint = point => Number.isFinite(Number(point?.latitude))
  && Number.isFinite(Number(point?.longitude))
  && Number(point.latitude) >= -90 && Number(point.latitude) <= 90
  && Number(point.longitude) >= -180 && Number(point.longitude) <= 180;
const safeJson = value => JSON.stringify(value).replace(/</g, "\\u003c");

const MAP_HTML = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"><style>html,body,#map{margin:0;width:100%;height:100%;background:#e8f1fa;font-family:Arial,sans-serif}.leaflet-popup-content{font-weight:700;color:#0d467d}#status{position:absolute;z-index:500;left:12px;right:12px;bottom:12px;padding:10px 12px;border-radius:10px;background:#fff;color:#334155;font-size:13px;box-shadow:0 2px 10px #1233}.bike-marker{width:25px;height:25px;border:3px solid white;border-radius:50%;box-shadow:0 1px 7px #1238}.bike-online{background:#16865f}.bike-offline{background:#d98221}.bike-selected{width:31px;height:31px;background:#0d467d}</style></head><body><div id="map"></div><div id="status">Loading map…</div><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" onerror="document.getElementById('status').textContent='Map unavailable. Check your internet connection and try again.'"></script><script>if(window.L){var map=L.map('map',{zoomControl:true}).setView([0.0236,37.9062],6);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map).on('tileerror',function(){document.getElementById('status').textContent='Map tiles unavailable. Check your internet connection.'});var markers={};var routeLine=null;var firstUpdate=true;var previousSelected=null;window.applyFleet=function(points,route,selectedId,center){var visible={};var bounds=[];points.forEach(function(p){visible[p.id]=true;var cls='bike-marker '+(p.status==='online'?'bike-online':'bike-offline')+(p.active?' bike-selected':'');var icon=L.divIcon({className:'',html:'<div class="'+cls+'"></div>',iconSize:[37,37],iconAnchor:[18,18]});var marker=markers[p.id];if(marker){marker.setLatLng([p.latitude,p.longitude]);marker.setIcon(icon);marker.setPopupContent(p.label);}else{marker=L.marker([p.latitude,p.longitude],{icon:icon}).addTo(map).bindPopup(p.label);marker.on('click',function(){if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(p.id)});markers[p.id]=marker;}bounds.push([p.latitude,p.longitude]);});Object.keys(markers).forEach(function(id){if(!visible[id]){map.removeLayer(markers[id]);delete markers[id];}});if(routeLine){map.removeLayer(routeLine);routeLine=null;}if(route.length>1){routeLine=L.polyline(route,{color:'#1f6feb',weight:5,opacity:.9}).addTo(map);route.forEach(function(point){bounds.push(point);});}if(firstUpdate){if(bounds.length>1)map.fitBounds(bounds,{padding:[35,35],maxZoom:16});else if(bounds.length===1)map.setView(bounds[0],16);firstUpdate=false;}else if(selectedId&&selectedId!==previousSelected&&center){map.setView([center.latitude,center.longitude],Math.max(map.getZoom(),15));}previousSelected=selectedId;document.getElementById('status').textContent=points.length+' customer bike'+(points.length===1?'':'s')+' with a location'+(route.length>1?' · selected route shown':'');setTimeout(function(){map.invalidateSize();},100);};}else{document.getElementById('status').textContent='Map unavailable. Check your internet connection and try again.'}</script></body></html>`;

export default function LiveFleetMap({ selected, vehicles = [], route, onSelectVehicle }) {
  const [loadError, setLoadError] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const webView = useRef(null);
  const points = useMemo(() => vehicles
    .filter(vehicle => validPoint(vehicle.location))
    .map(vehicle => ({
      id: String(vehicle.id),
      latitude: Number(vehicle.location.latitude),
      longitude: Number(vehicle.location.longitude),
      label: `${vehicle.registration || vehicle.identifier || "Bike"} · ${vehicle.model || ""}`,
      status: vehicle.status === "online" ? "online" : "offline",
      active: String(vehicle.id) === String(selected?.id),
    })), [vehicles, selected?.id]);
  const center = useMemo(() => validPoint(selected?.location)
    ? { latitude: Number(selected.location.latitude), longitude: Number(selected.location.longitude) }
    : points.length ? { latitude: points[0].latitude, longitude: points[0].longitude } : DEFAULT_CENTER,
  [selected?.location?.latitude, selected?.location?.longitude, points]);
  const routePoints = useMemo(() => (route?.points ?? []).filter(validPoint).map(point => [Number(point.latitude), Number(point.longitude)]), [route?.points]);
  const payload = useMemo(() => safeJson([points, routePoints, String(selected?.id ?? ""), center]), [points, routePoints, selected?.id, center]);

  useEffect(() => {
    if (!mapReady) return;
    webView.current?.injectJavaScript(`window.applyFleet&&window.applyFleet(...${payload});true;`);
  }, [mapReady, payload]);

  return <View style={{ flex: 1, backgroundColor: "#e8f1fa" }}>
    <WebView
      ref={webView}
      originWhitelist={["*"]}
      source={{ html: MAP_HTML }}
      javaScriptEnabled
      domStorageEnabled
      setSupportMultipleWindows={false}
      onLoadEnd={() => setMapReady(true)}
      onMessage={event => onSelectVehicle?.(event.nativeEvent.data)}
      onError={() => setLoadError(true)}
      style={{ flex: 1, backgroundColor: "#e8f1fa" }}
    />
    {loadError && <View pointerEvents="none" style={{ position: "absolute", left: 12, right: 12, bottom: 12, padding: 12, borderRadius: 10, backgroundColor: "white" }}>
      <Text style={{ color: "#334155", fontSize: 13 }}>Map unavailable. Check your internet connection and try again.</Text>
    </View>}
  </View>;
}
