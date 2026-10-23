import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../App.js", import.meta.url), "utf8");
const trackingHook = readFileSync(new URL("../src/hooks/useTracking.js", import.meta.url), "utf8");
const nativeMap = readFileSync(new URL("../src/components/OpenStreetMap.native.js", import.meta.url), "utf8");
const appConfig = readFileSync(new URL("../app.config.js", import.meta.url), "utf8");

assert.match(app, /import OpenStreetMap from "\.\/src\/components\/OpenStreetMap"/);
assert.doesNotMatch(app, /import MapView, .*PROVIDER_GOOGLE/);
assert.match(app, /error\.status === 403 && error\.code === "ACCOUNT_INACTIVE"/);
assert.doesNotMatch(app, /error\.status === 404 \|\|/);
assert.match(nativeMap, /react-native-webview/);
assert.match(nativeMap, /openstreetmap\.org/);
assert.match(appConfig, /"expo-channel-name": "production"/);
assert.match(appConfig, /version: "1\.0\.9"/);
assert.match(app, /const navigate = key =>/);
assert.match(app, /setScreen\(key\)/);
assert.match(app, /setSession\(null\)/);
assert.match(trackingHook, /requestSequence\.current === sequence/);
assert.match(trackingHook, /setMotorcycle\(null\)/);
assert.match(trackingHook, /socket\?\.disconnect\(\)/);

console.log("Customer map and session regression checks passed.");
