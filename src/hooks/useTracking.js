import { AppState } from "react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { trackingApi } from "../services/tracking";

// Keep REST refresh active even while the socket is connected: some provider
// integrations keep a socket open without delivering every fresh GPS report.
// The API permits four provider reads per vehicle per minute. Match that
// cadence and do not start a second request while Tramigo is still answering.
const POLL_INTERVAL_MS = 15_000;

export function useTracking({ motorcycleId, accessToken }) {
  const [motorcycle, setMotorcycle] = useState(null);
  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(true);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState(null);
  const [error, setError] = useState(null);
  const mounted = useRef(true);
  const appIsActive = useRef(AppState.currentState === "active");
  const requestSequence = useRef(0);
  const routeSequence = useRef(0);
  const refreshInFlight = useRef(false);
  const activeMotorcycleId = useRef(motorcycleId);
  activeMotorcycleId.current = motorcycleId;

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    const requestedId = motorcycleId;
    const sequence = ++requestSequence.current;
    try {
      if (mounted.current && activeMotorcycleId.current === requestedId) setError(null);
      if (!accessToken) throw new Error("Please sign in to view your motorcycle.");
      const result = await trackingApi.getMotorcycle(motorcycleId, accessToken);
      if (mounted.current && activeMotorcycleId.current === requestedId && requestSequence.current === sequence) setMotorcycle(result);
    } catch (cause) {
      if (mounted.current && activeMotorcycleId.current === requestedId && requestSequence.current === sequence) setError(cause instanceof Error ? cause.message : "Location temporarily unavailable");
    } finally {
      refreshInFlight.current = false;
      if (mounted.current && activeMotorcycleId.current === requestedId && requestSequence.current === sequence) setLoading(false);
    }
  }, [accessToken, motorcycleId]);

  const loadRoute = useCallback(async (range) => {
    const requestedId = motorcycleId;
    const sequence = ++routeSequence.current;
    setRouteLoading(true);
    setRouteError(null);
    setRoute(null);
    try {
      if (!accessToken) throw new Error("Please sign in to view route history.");
      const result = await trackingApi.getRoute(motorcycleId, range.toLowerCase().replace(" ", "-"), accessToken);
      if (mounted.current && activeMotorcycleId.current === requestedId && routeSequence.current === sequence) setRoute(result);
    } catch (cause) {
      if (mounted.current && activeMotorcycleId.current === requestedId && routeSequence.current === sequence) setRouteError(cause instanceof Error ? cause.message : "Route history is unavailable");
    } finally {
      if (mounted.current && activeMotorcycleId.current === requestedId && routeSequence.current === sequence) setRouteLoading(false);
    }
  }, [accessToken, motorcycleId]);

  useEffect(() => {
    mounted.current = true;
    appIsActive.current = AppState.currentState === "active";
    setLoading(true);
    setMotorcycle(null);
    setRoute(null);
    setRouteError(null);
    routeSequence.current += 1;
    refresh();
    if (!accessToken) return () => { mounted.current = false; };

    let socket;
    const appStateSubscription = AppState.addEventListener("change", state => {
      appIsActive.current = state === "active";
      if (appIsActive.current) refresh();
    });
    const poll = () => { if (appIsActive.current) refresh(); };
    const pollTimer = setInterval(poll, POLL_INTERVAL_MS);
    try {
      socket = trackingApi.connect(motorcycleId, accessToken, (location) => {
        if (mounted.current && activeMotorcycleId.current === motorcycleId && location) {
          setMotorcycle((current) => current ? { ...current, location } : current);
          setError(null);
        }
      });
    } catch {
      // REST polling continues if the socket cannot be created.
    }

    return () => {
      mounted.current = false;
      requestSequence.current += 1;
      routeSequence.current += 1;
      if (pollTimer) clearInterval(pollTimer);
      appStateSubscription.remove();
      socket?.disconnect();
    };
  }, [accessToken, motorcycleId, refresh]);

  return { motorcycle, route, setRoute, loading, routeLoading, routeError, error, refresh, loadRoute };
}
