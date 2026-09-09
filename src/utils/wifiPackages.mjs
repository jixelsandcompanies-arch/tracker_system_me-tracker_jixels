export const WIFI_PACKAGES = Object.freeze([
  { name: "1 Hour", priceKes: 10, durationMinutes: 60 },
  { name: "1.5 Hours", priceKes: 15, durationMinutes: 90 },
  { name: "4 Hours", priceKes: 20, durationMinutes: 240 },
  { name: "6 Hours", priceKes: 30, durationMinutes: 360 },
  { name: "12 Hours", priceKes: 60, durationMinutes: 720 },
  { name: "24 Hours", priceKes: 80, durationMinutes: 1440 },
  { name: "Weekly", priceKes: 300, durationMinutes: 10080 },
  { name: "Monthly", priceKes: 800, durationMinutes: 43200 },
]);

export function isPackageValid(pkg) {
  return Number.isFinite(Number(pkg?.priceKes)) && Number(pkg.priceKes) > 0 && Number.isInteger(Number(pkg?.durationMinutes)) && Number(pkg.durationMinutes) > 0;
}
