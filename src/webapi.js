// Browser mode (server.js / Docker): the desktop app's preload provides window.api; in a plain browser the same
// calls go to the local web server. In Electron this file does nothing.
if (!window.api) {
  window.api = {
    http: (method, url, body, timeout) =>
      fetch("api/http", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ method, url, body, timeout }) })
        .then((r) => r.json())
        .catch((e) => ({ ok: false, status: 0, error: String(e) })),
    bookBase: async () => null,          // the demo-portfolio server (quant-sma-bot) only runs next to the desktop app
    open: (url) => { if (/^https?:\/\//i.test(String(url))) window.open(String(url), "_blank", "noopener"); },
    appName: async () => "Graphite",
  };
}
