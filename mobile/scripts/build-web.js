// Copies the terminal (the same files the desktop and browser versions run) into mobile/www for Capacitor, adding the
// Capacitor runtime and plugin builds in front of src/webapi.js. Nothing in the terminal is forked: edit the root
// files, then `npm run sync` here.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const MOB = path.resolve(__dirname, "..");
const WWW = path.join(MOB, "www");
const NM = path.join(MOB, "node_modules");

const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); };
const copyDir = (from, to) => {
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b); else if (e.name.endsWith(".js")) copy(a, b);
  }
};

fs.rmSync(WWW, { recursive: true, force: true });
copy(path.join(ROOT, "styles.css"), path.join(WWW, "styles.css"));
copy(path.join(ROOT, "build", "icon.png"), path.join(WWW, "build", "icon.png"));
copyDir(path.join(ROOT, "src"), path.join(WWW, "src"));
const LC = "node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js";
copy(path.join(NM, "lightweight-charts", "dist", path.basename(LC)), path.join(WWW, LC));

const VENDOR = {
  "vendor/capacitor.js": "@capacitor/core/dist/capacitor.js",
  "vendor/app.js": "@capacitor/app/dist/plugin.js",
  "vendor/local-notifications.js": "@capacitor/local-notifications/dist/plugin.js",
};
for (const [to, from] of Object.entries(VENDOR)) copy(path.join(NM, from), path.join(WWW, to));

let html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const tag = '<script src="src/webapi.js"></script>';
if (!html.includes(tag)) throw new Error("index.html: no " + tag);
html = html.replace(tag, Object.keys(VENDOR).map((f) => `<script src="${f}"></script>`).join("\n") + "\n" + tag);
// the web manifest is for "add to home screen" in a browser; the app has its own
html = html.replace(/<link rel="manifest"[^>]*>\n?/, "");
fs.writeFileSync(path.join(WWW, "index.html"), html);
console.log("www ready:", WWW);
