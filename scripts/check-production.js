const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");

const root = path.resolve(__dirname, "..");
const files = [
  "App.js",
  "app.config.js",
  "src/config.js",
  "src/hooks/useTracking.js",
  "src/services/api.js",
  "src/services/auth.js",
  "src/services/customer.js",
  "src/services/payments.js",
  "src/services/session.js",
  "src/services/tracking.js",
  "src/utils/validation.mjs",
];

for (const file of files) {
  parser.parse(fs.readFileSync(path.join(root, file), "utf8"), {
    sourceType: "module",
    plugins: ["jsx", "optionalChaining"],
  });
}

if (process.env.CI === "true" || process.env.NODE_ENV === "production") {
  const required = ["EXPO_PUBLIC_JIXELS_API_URL", "EXPO_PUBLIC_EAS_PROJECT_ID"];
  const missing = required.filter(name => !process.env[name]);
  if (missing.length) throw new Error(`Missing production environment variables: ${missing.join(", ")}`);
  if (!/^https:\/\//i.test(process.env.EXPO_PUBLIC_JIXELS_API_URL)) throw new Error("Production API URL must use HTTPS.");
  if (process.env.EXPO_PUBLIC_DEMO_MODE === "true") throw new Error("Demo mode must be disabled for production.");
}

console.log(`Production checks passed (${files.length} source files).`);
