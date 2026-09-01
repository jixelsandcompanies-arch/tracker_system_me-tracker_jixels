const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");

const root = path.resolve(__dirname, "..");
const files = [
  "App.js",
  "app.config.js",
  "src/config.js",
  "src/services/api.js",
  "src/services/auth.js"
];

for (const file of files) {
  parser.parse(fs.readFileSync(path.join(root, file), "utf8"), {
    sourceType: "module",
    plugins: ["jsx", "optionalChaining"]
  });
}

if (process.env.CI === "true" || process.env.NODE_ENV === "production") {
  const apiUrl = process.env.EXPO_PUBLIC_JIXELS_AGENT_API_URL || process.env.EXPO_PUBLIC_JIXELS_API_URL;
  if (!apiUrl) throw new Error("Missing production environment variable: EXPO_PUBLIC_JIXELS_AGENT_API_URL or EXPO_PUBLIC_JIXELS_API_URL");
  if (!/^https:\/\//i.test(apiUrl)) throw new Error("Production API URL must use HTTPS.");
}

console.log(`Production checks passed (${files.length} source files).`);
