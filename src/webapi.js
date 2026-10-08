// Browser mode (server.js / Docker): the desktop app's preload provides window.api; in a plain browser the same
// calls go to the local web server. In Electron this file does nothing.
// Android app (mobile/): Capacitor's native HTTP does the requests, so there is no CORS and no server to run.
(() => {
  if (window.api) return;
  const cap = window.Capacitor;
  const native = !!(cap && cap.isNativePlatform && cap.isNativePlatform());

  if (native) {
    // capacitorExports / capacitorLocalNotifications are the plugins' browser builds, copied in by mobile/scripts/build-web.js
    const core = window.capacitorExports || {};
    const Http = core.CapacitorHttp || cap.Plugins.CapacitorHttp;
    const LN = (window.capacitorLocalNotifications || {}).LocalNotifications;
    const UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
    let nid = 1, asked = false;
    window.api = {
      http: async (method, url, body, timeout) => {
        try {
          const t = Math.min(Number(timeout) || 15000, 60000);
          const r = await Http.request({
            method: method === "POST" ? "POST" : "GET", url,
            // FRED and Yahoo refuse requests without a browser user agent
            headers: { "User-Agent": UA, ...(body ? { "Content-Type": "application/json" } : {}) },
            data: body || undefined, connectTimeout: t, readTimeout: t, responseType: "text",
          });
          let data = r.data;
          if (typeof data === "string") { try { data = JSON.parse(data); } catch {} }
          return { ok: r.status >= 200 && r.status < 300, status: r.status, data };
        } catch (e) {
          return { ok: false, status: 0, error: String((e && e.message) || e) };
        }
      },
      bookBase: async () => null,
      // links leave the app: Capacitor turns any navigation off the app's own origin into an Android "open URL" intent
      open: (url) => { if (/^https?:\/\//i.test(String(url))) window.location.href = String(url); },
      appName: async () => "Graphite",
      // alerts become Android notifications
      notify: async (title, body) => {
        if (!LN) return;
        try {
          if (!asked) { asked = true; await LN.requestPermissions(); }
          await LN.schedule({ notifications: [{ id: nid++, title, body }] });
        } catch (e) { console.warn("notify", e); }
      },
      askNotify: () => { if (LN && !asked) { asked = true; LN.requestPermissions().catch(() => {}); } },
    };
    return;
  }

  window.api = {
    http: (method, url, body, timeout) =>
      fetch("api/http", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ method, url, body, timeout }) })
        .then((r) => r.json())
        .catch((e) => ({ ok: false, status: 0, error: String(e) })),
    bookBase: async () => null,          // the demo-portfolio server (quant-sma-bot) only runs next to the desktop app
    open: (url) => { if (/^https?:\/\//i.test(String(url))) window.open(String(url), "_blank", "noopener"); },
    appName: async () => "Graphite",
  };
})();
