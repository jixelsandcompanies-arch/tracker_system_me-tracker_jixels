import React, { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { WebView } from "react-native-webview";

const DEFAULT_CENTER = { latitude: 0.0236, longitude: 37.9062 };

export default function OpenStreetMap({ coordinate, label = "Current location" }) {
  const [loadError, setLoadError] = useState(false);
  const html = useMemo(() => {
    const center = coordinate ?? DEFAULT_CENTER;
    const marker = coordinate
      ? JSON.stringify({ latitude: coordinate.latitude, longitude: coordinate.longitude, label }).replace(/</g, "\\u003c")
      : "null";
    return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"><style>html,body,#map{margin:0;width:100%;height:100%;background:#e8f1fa;font-family:Arial,sans-serif}#status{position:absolute;z-index:500;left:12px;right:12px;bottom:12px;padding:10px 12px;border-radius:10px;background:#fff;color:#334155;font-size:13px;box-shadow:0 2px 10px #1233}.leaflet-popup-content{font-weight:700;color:#0d467d}</style></head><body><div id="map"></div><div id="status">Loading map…</div><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" onerror="document.getElementById('status').textContent='Map is unavailable. Check your internet connection and try again.'"></script><script>if(window.L){var point=${marker};var map=L.map('map',{zoomControl:true}).setView([${center.latitude},${center.longitude}],${coordinate ? 15 : 6});L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);if(point){L.marker([point.latitude,point.longitude]).addTo(map).bindPopup(point.label).openPopup();document.getElementById('status').textContent=point.label}else{document.getElementById('status').textContent='Allow location access to show your position.'}}else{document.getElementById('status').textContent='Map is unavailable. Check your internet connection and try again.'}</script></body></html>`;
  }, [coordinate?.latitude, coordinate?.longitude, label]);

  return <View style={{ flex: 1, backgroundColor: "#e8f1fa" }}>
    <WebView
      originWhitelist={["*"]}
      source={{ html }}
      javaScriptEnabled
      domStorageEnabled
      setSupportMultipleWindows={false}
      onError={() => setLoadError(true)}
      style={{ flex: 1, backgroundColor: "#e8f1fa" }}
    />
    {loadError && <View pointerEvents="none" style={{ position: "absolute", left: 12, right: 12, bottom: 12, padding: 12, borderRadius: 10, backgroundColor: "white" }}>
      <Text style={{ color: "#334155", fontSize: 13 }}>Map is unavailable. Check your internet connection and try again.</Text>
    </View>}
  </View>;
}
