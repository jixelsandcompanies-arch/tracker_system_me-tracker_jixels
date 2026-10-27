import { AppState } from "react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { trackingApi } from "../services/tracking";

// Refresh the customer map automatically every three seconds, including when
// a socket remains connected without delivering reports. The API separately
// rate-limits actual Tramigo reads and returns the newest saved point meanwhile.
const POLL_INTERVAL_MS = 3_000;

function keepNewestLocation(incoming, existing) {
  if (!existing?.location) return incoming;
  if (!incoming?.location) return { ...incoming, location: existing.location };
  const incomingTime = new Date(incoming.location.recordedAt ?? 0).getTime();
  const existingTime = new Date(existing.location.recordedAt ?? 0).getTime();
  return Number.isFinite(existingTime) && (!Number.isFinite(incomingTime) || existingTime > incomingTime)
    ? { ...incoming, location: existing.location }
    : incoming;
}

function locationIsOlder(incoming, existing) {
  if (!existing) return false;
  const incomingTime = new Date(incoming?.recordedAt ?? 0).getTime();
  const existingTime = new Date(existing.recordedAt ?? 0).getTime();
  return Number.isFinite(existingTime) && (!Number.isFinite(incomingTime) || incomingTime < existingTime);
}

export function useTracking({ motorcycleId, accessToken }) {
  const [loadedMotorcycle, setLoadedMotorcycle] = useState(null);
  const motorcycle = loadedMotorcycle?.id === motorcycleId ? loadedMotorcycle.value : null;
  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(true);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState(null);
  const [error, setError] = useState(null);
  const mounted = useRef(true);
  const appIsActive = useRef(AppState.currentState === "active");
  const routeSequence = useRef(0);
  const refreshInFlight = useRef(new Map());
  const activeMotorcycleId = useRef(motorcycleId);
  activeMotorcycleId.current = motorcycleId;

  const refresh = useCallback(async () => {
    const requestedId = motorcycleId;
    const pending = refreshInFlight.current.get(requestedId);
    if (pending) return pending;
    const request = Promise.resolve().then(async () => {
      try {
        if (mounted.current && activeMotorcycleId.current === requestedId) setError(null);
        if (!accessToken) throw new Error("Please sign in to view your motorcycle.");
        const result = await trackingApi.getMotorcycle(motorcycleId, accessToken);
        if (mounted.current && activeMotorcycleId.current === requestedId) {
          setLoadedMotorcycle(current => ({ id: requestedId, value: keepNewestLocation(result, current?.id === requestedId ? current.value : null) }));
        }
        return result;
      } catch (cause) {
        if (mounted.current && activeMotorcycleId.current === requestedId) setError(cause instanceof Error ? cause.message : "Location temporarily unavailable");
        return null;
      } finally {
        refreshInFlight.current.delete(requestedId);
        if (mounted.current && activeMotorcycleId.current === requestedId) setLoading(false);
      }
    });
    refreshInFlight.current.set(requestedId, request);
    return request;
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
    setLoadedMotorcycle(null);
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
          setLoadedMotorcycle(current => {
            const currentValue = current?.id === motorcycleId ? current.value : null;
            if (locationIsOlder(location, currentValue?.location)) return current;
            return { id: motorcycleId, value: { ...(currentValue ?? {}), location } };
          });
          setLoading(false);
          setError(null);
        }
      });
    } catch {
      // REST polling continues if the socket cannot be created.
    }

    return () => {
      mounted.current = false;
      routeSequence.current += 1;
      if (pollTimer) clearInterval(pollTimer);
      appStateSubscription.remove();
      socket?.disconnect();
    };
  }, [accessToken, motorcycleId, refresh]);

  return { motorcycle, route, setRoute, loading, routeLoading, routeError, error, refresh, loadRoute };
}
