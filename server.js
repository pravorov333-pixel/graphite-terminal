// Graphite in a browser: the same UI as the desktop app, served by a tiny Node server (no dependencies).
// The desktop app fetches data from its main process; here /api/http does the same job. Only the data sources the
// terminal actually uses are reachable through it, so the server is not an open proxy.
//   node server.js            → http://localhost:8080
//   PORT=9000 HOST=0.0.0.0 node server.js
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "127.0.0.1";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const ALLOWED_HOSTS = new Set([
  // markets & derivatives
  "fapi.binance.com", "api.binance.com", "api.bybit.com", "www.okx.com", "api.hyperliquid.xyz", "www.deribit.com",
  // macro, rates, positioning, earnings, calendar
  "fred.stlouisfed.org", "home.treasury.gov", "query1.finance.yahoo.com", "publicreporting.cftc.gov", "api.nasdaq.com", "nfs.faireconomy.media",
  // crypto background
  "api.coingecko.com", "stablecoins.llama.fi", "api.alternative.me", "mempool.space", "ethereum-rpc.publicnode.com",
  // news feeds
  "www.cnbc.com", "feeds.content.dowjones.io", "finance.yahoo.com", "www.nasdaq.com", "www.investing.com", "www.federalreserve.gov",
  "www.coindesk.com", "www.theblock.co", "cointelegraph.com", "decrypt.co",
]);

// static files the page needs — nothing else on disk is served
const STATIC = {
  "/": "index.html", "/index.html": "index.html", "/styles.css": "styles.css", "/build/icon.png": "build/icon.png",
  "/node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js": "node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js",
};
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".png": "image/png" };

function sendFile(res, rel) {
  const file = path.join(ROOT, rel);
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
    res.end(buf);
  });
}

async function proxy(req, res) {
  let raw = "";
  for await (const chunk of req) { raw += chunk; if (raw.length > 64 * 1024) { res.writeHead(413); return res.end(); } }
  const reply = (obj) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
  try {
    const { method, url, body, timeout } = JSON.parse(raw || "{}");
    const u = new URL(url);
    if (u.protocol !== "https:" || !ALLOWED_HOSTS.has(u.hostname)) return reply({ ok: false, status: 0, error: `host not allowed: ${u.hostname}` });
    const r = await fetch(u, {
      method: method === "POST" ? "POST" : "GET",
      headers: { "User-Agent": UA, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(Math.min(Number(timeout) || 15000, 60000)),
    });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    reply({ ok: r.ok, status: r.status, data });
  } catch (e) {
    reply({ ok: false, status: 0, error: String((e && e.message) || e) });
  }
}

http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (req.method === "POST" && p === "/api/http") return proxy(req, res);
  if (STATIC[p]) return sendFile(res, STATIC[p]);
  if (/^\/src\/[\w/-]+\.js$/.test(p) && !p.includes("..")) return sendFile(res, p.slice(1));
  res.writeHead(404); res.end("not found");
}).listen(PORT, HOST, () => console.log(`Graphite web: http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`));
