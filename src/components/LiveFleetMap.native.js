import React, { useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { WebView } from "react-native-webview";

const DEFAULT_CENTER = { latitude: 0.0236, longitude: 37.9062 };
const validPoint = point => point?.latitude != null && point.latitude !== ""
  && point?.longitude != null && point.longitude !== ""
  && Number.isFinite(Number(point.latitude))
  && Number.isFinite(Number(point?.longitude))
  && Number(point.latitude) >= -90 && Number(point.latitude) <= 90
  && Number(point.longitude) >= -180 && Number(point.longitude) <= 180;
const safeJson = value => JSON.stringify(value).replace(/</g, "\\u003c");

const MAP_HTML = `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>
html,body,#map{margin:0;width:100%;height:100%;background:#e8f1fa;font-family:Arial,sans-serif}
.leaflet-popup-content{font-weight:700;color:#0d467d}
#status{position:absolute;z-index:500;left:12px;right:12px;bottom:12px;padding:10px 12px;border-radius:10px;background:#fff;color:#334155;font-size:13px;box-shadow:0 2px 10px #1233}
.bike-marker{width:25px;height:25px;border:3px solid white;border-radius:50%;box-shadow:0 1px 7px #1238}
.bike-online{background:#16865f}.bike-offline{background:#d98221}.bike-selected{width:31px;height:31px;background:#0d467d}
</style></head><body><div id="map"></div><div id="status">Loading map…</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" onerror="document.getElementById('status').textContent='Map unavailable. Check your internet connection and try again.'"></script>
<script>
if(window.L){
  var map=L.map('map',{zoomControl:true}).setView([0.0236,37.9062],6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map).on('tileerror',function(){document.getElementById('status').textContent='Map tiles unavailable. Check your internet connection.'});
  var markers={},routeLine=null,routePoint=null,firstUpdate=true,previousSelected=null,previousRouteKey='';
  function moveMarker(marker,target,duration){
    if(marker._motionFrame)cancelAnimationFrame(marker._motionFrame);
    var start=marker.getLatLng(),started=performance.now(),fromLat=start.lat,fromLng=start.lng;
    function step(now){var t=Math.min(1,(now-started)/duration),eased=t*t*(3-2*t);marker.setLatLng([fromLat+(target[0]-fromLat)*eased,fromLng+(target[1]-fromLng)*eased]);if(t<1)marker._motionFrame=requestAnimationFrame(step);else marker._motionFrame=null;}
    marker._motionFrame=requestAnimationFrame(step);
  }
  window.applyFleet=function(points,route,selectedId,center){
    var visible={};
    var pointBounds=[];
    points.forEach(function(p){
      visible[p.id]=true;
      var cls='bike-marker '+(p.status==='online'?'bike-online':'bike-offline')+(p.active?' bike-selected':'');
      var icon=L.divIcon({className:'',html:'<div class="'+cls+'"></div>',iconSize:[37,37],iconAnchor:[18,18]});
      var target=[p.latitude,p.longitude],marker=markers[p.id];
      if(marker){var distance=map.distance(marker.getLatLng(),target);if(distance>2)moveMarker(marker,target,Math.min(4500,Math.max(1200,distance/7)));marker.setIcon(icon);marker.setPopupContent(p.label);}
      else{marker=L.marker(target,{icon:icon}).addTo(map).bindPopup(p.label);marker.on('click',function(){if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(p.id)});markers[p.id]=marker;}
      pointBounds.push(target);
    });
    Object.keys(markers).forEach(function(id){if(!visible[id]){if(markers[id]._motionFrame)cancelAnimationFrame(markers[id]._motionFrame);map.removeLayer(markers[id]);delete markers[id];}});
    if(routeLine){map.removeLayer(routeLine);routeLine=null;}
    if(routePoint){map.removeLayer(routePoint);routePoint=null;}
    if(route.length>1)routeLine=L.polyline(route,{color:'#1f6feb',weight:5,opacity:.9}).addTo(map);
    else if(route.length===1)routePoint=L.circleMarker(route[0],{radius:8,color:'#fff',weight:3,fillColor:'#1f6feb',fillOpacity:1}).addTo(map).bindPopup('One GPS point in this range; a route line needs at least two points.');
    var routeKey=route.length?route.length+':'+route[0].join(',')+':'+route[route.length-1].join(','):'';
    if(firstUpdate){
      if(routeLine)map.fitBounds(routeLine.getBounds(),{padding:[35,35],maxZoom:16});
      else if(routePoint)map.setView(route[0],16);
      else if(selectedId&&markers[selectedId])map.setView(markers[selectedId].getLatLng(),16);
      else if(pointBounds.length>1)map.fitBounds(pointBounds,{padding:[35,35],maxZoom:16});
      else if(pointBounds.length===1)map.setView(pointBounds[0],16);
      firstUpdate=false;
    }else if(routeKey!==previousRouteKey&&routeLine){map.fitBounds(routeLine.getBounds(),{padding:[35,35],maxZoom:16});}
    else if(routeKey!==previousRouteKey&&routePoint){map.setView(route[0],16);}
    else if(routeKey!==previousRouteKey&&selectedId&&center){map.setView([center.latitude,center.longitude],Math.max(map.getZoom(),15));}
    else if(selectedId&&selectedId!==previousSelected&&center){map.setView([center.latitude,center.longitude],Math.max(map.getZoom(),15));}
    previousRouteKey=routeKey;previousSelected=selectedId;
    var routeStatus=route.length>1?' · '+route.length+' route points shown':route.length===1?' · one route point; another GPS point is needed for a line':'';
    document.getElementById('status').textContent=points.length+' customer bike'+(points.length===1?'':'s')+' with a location'+routeStatus;
    setTimeout(function(){map.invalidateSize();},100);
  };
}else{document.getElementById('status').textContent='Map unavailable. Check your internet connection and try again.'}
</script></body></html>`;

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
