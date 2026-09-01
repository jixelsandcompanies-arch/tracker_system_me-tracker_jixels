const fs = require("fs");
const path = require("path");
const root = __dirname;
const out = path.join(root, "dist");
fs.rmSync(out, { recursive: true, force: true });
function copy(relative) {
  const source = path.join(root, relative); const target = path.join(out, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.cpSync(source, target, { recursive: true });
}
["index.html", "css", "js", "assets"].forEach(copy);
