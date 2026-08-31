export const demoMotorcycle = {
  id: "demo-bike",
  name: "My Motorcycle",
  model: "Bajaj Boxer 150",
  registrationNumber: "KMEP ••• 1234",
  location: {
    latitude: -1.2864,
    longitude: 36.8172,
    speedKph: 45,
    heading: 42,
    accuracyMeters: 8,
    recordedAt: new Date().toISOString(),
  },
};

const offsets = [
  [0, 0], [0.002, 0.001], [0.0035, 0.003], [0.004, 0.006],
  [0.0025, 0.008], [0.001, 0.01], [-0.001, 0.012],
];

export const demoRoute = {
  points: offsets.map(([lat, lng], index) => ({
    latitude: demoMotorcycle.location.latitude + (lat ?? 0),
    longitude: demoMotorcycle.location.longitude + (lng ?? 0),
    speedKph: 30 + index * 3,
    heading: 45,
    recordedAt: new Date(Date.now() - (offsets.length - index) * 10 * 60_000).toISOString(),
  })),
  distanceKm: 18.4,
  durationMinutes: 82,
  stops: 3,
};
