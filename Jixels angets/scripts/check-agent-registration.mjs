import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeKenyanAgentPhone } from "../src/utils/kenyanPhone.js";

assert.equal(normalizeKenyanAgentPhone("0712 345 678"), "254712345678");
assert.equal(normalizeKenyanAgentPhone("0112-345-678"), "254112345678");
assert.equal(normalizeKenyanAgentPhone("+254 712 345 678"), "254712345678");
assert.equal(normalizeKenyanAgentPhone("254112345678"), "254112345678");
assert.equal(normalizeKenyanAgentPhone("712345678"), "254712345678");
assert.equal(normalizeKenyanAgentPhone("0712"), null);
assert.equal(normalizeKenyanAgentPhone("+1 202 555 0100"), null);

const app = readFileSync(new URL("../App.js", import.meta.url), "utf8");
assert.match(app, /useWindowDimensions\(\)/);
assert.match(app, /viewportWidth < 360/);
assert.match(app, /authScroll: \{ flex: 1, minHeight: 0 \}/);
console.log("Agent registration phone and small-screen checks passed.");
