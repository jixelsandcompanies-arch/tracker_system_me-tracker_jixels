import assert from "node:assert/strict";
import { isPackageValid, WIFI_PACKAGES } from "../src/utils/wifiPackages.mjs";

assert.deepEqual(WIFI_PACKAGES.map((item) => [item.priceKes, item.durationMinutes]), [[10, 60], [15, 90], [20, 240], [30, 360], [60, 720], [80, 1440], [300, 10080], [800, 43200]]);
assert.equal(isPackageValid({ priceKes: 10, durationMinutes: 60 }), true);
assert.equal(isPackageValid({ priceKes: 0, durationMinutes: 60 }), false);
assert.equal(isPackageValid({ priceKes: 10, durationMinutes: 0 }), false);
console.log("PASS Wi-Fi package price and validity rules");
