const toRadians = degrees => degrees * Math.PI / 180;

export function estimateSpeedKph(current, previous) {
  if (!current || !previous) return null;
  const currentTime = new Date(current.recordedAt ?? 0).getTime();
  const previousTime = new Date(previous.recordedAt ?? 0).getTime();
  const elapsedSeconds = (currentTime - previousTime) / 1000;
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 2 || elapsedSeconds > 120) return null;

  const currentLatitude = Number(current.latitude);
  const currentLongitude = Number(current.longitude);
  const previousLatitude = Number(previous.latitude);
  const previousLongitude = Number(previous.longitude);
  if (![currentLatitude, currentLongitude, previousLatitude, previousLongitude].every(Number.isFinite)
    || Math.abs(currentLatitude) > 90 || Math.abs(previousLatitude) > 90
    || Math.abs(currentLongitude) > 180 || Math.abs(previousLongitude) > 180) return null;

  const latitudeDelta = toRadians(currentLatitude - previousLatitude);
  const longitudeDelta = toRadians(currentLongitude - previousLongitude);
  const previousLatitudeRadians = toRadians(previousLatitude);
  const currentLatitudeRadians = toRadians(currentLatitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(previousLatitudeRadians) * Math.cos(currentLatitudeRadians) * Math.sin(longitudeDelta / 2) ** 2;
  const distanceMeters = 6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  const accuracyValues = [current.accuracyMeters, previous.accuracyMeters]
    .map(Number).filter(value => Number.isFinite(value) && value > 0);
  const noiseThresholdMeters = Math.max(6, Math.min(20, Math.max(0, ...accuracyValues) * 0.5));
  if (distanceMeters <= noiseThresholdMeters) return 0;

  const speedKph = distanceMeters / elapsedSeconds * 3.6;
  return Number.isFinite(speedKph) && speedKph <= 300 ? Math.round(speedKph * 10) / 10 : null;
}
