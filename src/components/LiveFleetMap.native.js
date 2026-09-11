import React, { useMemo } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";

const escape = value => String(value ?? "").replace(/[<>&"]/g, char => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[char]));

export default function LiveFleetMap({ selected, vehicles = [] }) {
  const html = useMemo(() => {
    const points = vehicles.filter(vehicle => Number.isFinite(vehicle.location?.latitude) && Number.isFinite(vehicle.location?.longitude)).map(vehicle => ({ latitude: vehicle.location.latitude, longitude: vehicle.location.longitude, label: `${vehicle.registration} · ${vehicle.model}`, active: vehicle.id === selected.id }));
    const center = { latitude: selected.location.latitude, longitude: selected.location.longitude };
    const markers = JSON.stringify(points.length ? points : [{ ...center, label: `${selected.registration} · ${selected.model}`, active: true }]).replace(/</g, "\\u003c");
    return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"><style>html,body,#map{margin:0;width:100%;height:100%;background:#e8f1fa}.label{font:700 12px Arial;color:#0d467d}.dot{width:18px;height:18px;background:#1479c9;border:3px solid #fff;border-radius:50%;box-shadow:0 1px 7px #1238}.active{background:#0d467d;width:22px;height:22px}</style></head><body><div id="map"></div><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><script>var points=${markers};var map=L.map('map',{zoomControl:false}).setView([${center.latitude},${center.longitude}],15);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);var bounds=[];points.forEach(function(p){var icon=L.divIcon({className:'',html:'<div class="dot '+(p.active?'active':'')+'"></div>',iconSize:[24,24],iconAnchor:[12,12]});L.marker([p.latitude,p.longitude],{icon:icon}).addTo(map).bindPopup('<span class="label">${escape(" ")}'+p.label+'</span>');bounds.push([p.latitude,p.longitude]);});if(bounds.length>1)map.fitBounds(bounds,{padding:[35,35]});</script></body></html>`;
  }, [selected, vehicles]);
  return <View style={{ flex: 1 }}><WebView originWhitelist={["*"]} source={{ html }} javaScriptEnabled domStorageEnabled setSupportMultipleWindows={false} style={{ flex: 1, backgroundColor: "#e8f1fa" }} /></View>;
}
