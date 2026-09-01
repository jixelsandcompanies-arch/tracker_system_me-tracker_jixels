import { io } from "socket.io-client";
import { requireApiUrl } from "../config";
import { apiRequest } from "./api";

const request = (path, token) => apiRequest(path, { token });

function normalizeLocation(location) {
  if (!location) return location;
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  const rawAccuracy = location.accuracyMeters
    ?? location.accuracy
    ?? location.horizontalAccuracy
    ?? (Number.isFinite(Number(location.hdop)) ? Number(location.hdop) * 5 : null);
  return {
    ...location,
    latitude,
    longitude,
    speedKph: Number(location.speedKph ?? location.speed ?? 0),
    accuracyMeters: Number.isFinite(Number(rawAccuracy)) ? Math.max(0, Math.round(Number(rawAccuracy))) : null,
    recordedAt: location.recordedAt ?? location.timestamp ?? new Date().toISOString(),
  };
}

function normalizeMotorcycle(payload) {
  const motorcycle = payload?.motorcycle ?? payload;
  return motorcycle ? { ...motorcycle, location: normalizeLocation(motorcycle.location ?? motorcycle.lastLocation) } : motorcycle;
}

export const trackingApi = {
  getFleetSecurityStatus: token => request("/v1/customer/motorcycles/security-status", token),
  getMotorcycle: async (id, token) =>
    normalizeMotorcycle(await request(`/v1/customer/motorcycles/${encodeURIComponent(id)}/location`, token)),
  getRoute: (id, range, token) =>
    request(
      `/v1/customer/motorcycles/${encodeURIComponent(id)}/route?range=${encodeURIComponent(range)}`,
      token,
    ),
  setMonitoring: (id, armed, token) => apiRequest(
    `/v1/customer/motorcycles/${encodeURIComponent(id)}/monitoring`,
    { method: "POST", token, body: { armed } },
  ),
  setImmobilizer: (id, immobilized, token) => apiRequest(
    `/v1/customer/motorcycles/${encodeURIComponent(id)}/immobilizer`,
    { method: "POST", token, body: { immobilized } },
  ),
  getSecurityStatus: (id, token) => request(
    `/v1/customer/motorcycles/${encodeURIComponent(id)}/security-status`,
    token,
  ),
  connect(id, token, onLocation) {
    const socket = io(requireApiUrl(), {
      transports: ["websocket"],
      auth: { token },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 15_000,
      timeout: 10_000,
    });
    socket.on("connect", () => socket.emit("tracker:subscribe", { motorcycleId: id }));
    socket.on("tracker:location", payload => onLocation(normalizeLocation(payload?.location ?? payload)));
    return socket;
  },
};
