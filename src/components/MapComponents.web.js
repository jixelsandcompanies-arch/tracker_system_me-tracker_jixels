import React, { forwardRef, useImperativeHandle, useMemo } from "react";
import { MapContainer, Marker as LeafletMarker, Polyline as LeafletPolyline, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

const DEFAULT_CENTER = [-0.0236, 37.9062];

function point(value) {
  const latitude = Number(value?.latitude);
  const longitude = Number(value?.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? [latitude, longitude] : DEFAULT_CENTER;
}

function MapController({ mapRef }) {
  const map = useMap();
  useImperativeHandle(mapRef, () => ({
    animateCamera: ({ center, zoom }) => map.setView(point(center), zoom ?? map.getZoom()),
    fitToCoordinates: (coordinates) => {
      const bounds = coordinates?.map(point);
      if (bounds?.length > 1) map.fitBounds(bounds, { padding: [42, 42] });
      else if (bounds?.length === 1) map.setView(bounds[0], 16);
    },
  }), [map]);
  return null;
}

const MapView = forwardRef(function MapView({ initialRegion, style, children }, ref) {
  const center = point(initialRegion);
  const zoom = initialRegion?.latitudeDelta > 1 ? 6 : 15;
  return <MapContainer center={center} zoom={zoom} style={{ height: "100%", width: "100%", ...style }}>
    <MapController mapRef={ref} />
    <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
    {children}
  </MapContainer>;
});

function Marker({ coordinate }) {
  return <LeafletMarker position={point(coordinate)} />;
}
Marker.Animated = Marker;

function Polyline({ coordinates, strokeColor, strokeWidth }) {
  const positions = useMemo(() => coordinates?.map(point) ?? [], [coordinates]);
  return positions.length > 1 ? <LeafletPolyline positions={positions} pathOptions={{ color: strokeColor, weight: strokeWidth }} /> : null;
}

class AnimatedRegion {
  constructor(value) { Object.assign(this, value); }
  timing(value) { Object.assign(this, value); return { start: (callback) => callback?.() }; }
}

const PROVIDER_GOOGLE = undefined;

export { AnimatedRegion, Marker, Polyline, PROVIDER_GOOGLE };
export default MapView;
