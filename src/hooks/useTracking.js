import { useCallback, useEffect, useRef, useState } from "react";
import { trackingApi } from "../services/tracking";

const POLL_INTERVAL_MS = 30_000;

export function useTracking({ motorcycleId, accessToken }) {
  const [motorcycle, setMotorcycle] = useState(null);
  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(true);
  const [routeLoading, setRouteLoading] = useState(false);
  const [error, setError] = useState(null);
  const mounted = useRef(true);
  const activeMotorcycleId = useRef(motorcycleId);
  activeMotorcycleId.current = motorcycleId;

  const refresh = useCallback(async () => {
    const requestedId = motorcycleId;
    try {
      setError(null);
      if (!accessToken) throw new Error("Please sign in to view your motorcycle.");
      const result = await trackingApi.getMotorcycle(motorcycleId, accessToken);
      if (mounted.current && activeMotorcycleId.current === requestedId) setMotorcycle(result);
    } catch (cause) {
      if (mounted.current && activeMotorcycleId.current === requestedId) setError(cause instanceof Error ? cause.message : "Location temporarily unavailable");
    } finally {
      if (mounted.current && activeMotorcycleId.current === requestedId) setLoading(false);
    }
  }, [accessToken, motorcycleId]);

  const loadRoute = useCallback(async (range) => {
    setRouteLoading(true);
    try {
      setError(null);
      if (!accessToken) throw new Error("Please sign in to view route history.");
      const result = await trackingApi.getRoute(motorcycleId, range.toLowerCase().replace(" ", "-"), accessToken);
      if (mounted.current) setRoute(result);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Route history is unavailable");
    } finally {
      if (mounted.current) setRouteLoading(false);
    }
  }, [accessToken, motorcycleId]);

  useEffect(() => {
    mounted.current = true;
    refresh();
    if (!accessToken) return () => { mounted.current = false; };

    let socket;
    let pollTimer;
    try {
      socket = trackingApi.connect(motorcycleId, accessToken, (location) => {
        if (mounted.current && activeMotorcycleId.current === motorcycleId && location) {
          setMotorcycle((current) => current ? { ...current, location } : current);
          setError(null);
        }
      });
      socket.on("connect_error", () => {
        if (!pollTimer) pollTimer = setInterval(refresh, POLL_INTERVAL_MS);
      });
      socket.on("connect", () => {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = undefined;
      });
    } catch {
      pollTimer = setInterval(refresh, POLL_INTERVAL_MS);
    }

    return () => {
      mounted.current = false;
      if (pollTimer) clearInterval(pollTimer);
      socket?.disconnect();
    };
  }, [accessToken, motorcycleId, refresh]);

  return { motorcycle, route, setRoute, loading, routeLoading, error, refresh, loadRoute };
}
