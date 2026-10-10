const { app, BrowserWindow, ipcMain, nativeTheme, shell, net, screen } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

// --shot=<png> [--wait=<sec>] [--run=<cmd;cmd>] [--size=WxH]: render, run commands, save a screenshot, quit
const argv = Object.fromEntries(process.argv.slice(1).filter((a) => a.startsWith("--"))
  .map((a) => { const [k, ...v] = a.slice(2).split("="); return [k, v.length ? v.join("=") : true]; }));

// screenshot runs get a throwaway profile so they never touch the real layout, alerts and history
if (argv.shot) app.setPath("userData", path.join(require("os").tmpdir(), "quant-terminal-shot-" + process.pid));

const BOOK_DIR = path.resolve(__dirname, "..", "quant-sma-bot");
const BOOK_PORTS = [5055, 5077];
// settings live in %APPDATA%\Graphite; carry over watchlist, alerts and layouts from the old "quant-terminal" folder once
if (!argv.shot) {
  const dir = path.join(app.getPath("appData"), "Graphite"), old = path.join(app.getPath("appData"), "quant-terminal", "Local Storage");
  if (!fs.existsSync(dir) && fs.existsSync(old)) { try { fs.cpSync(old, path.join(dir, "Local Storage"), { recursive: true }); } catch {} }
  app.setPath("userData", dir);
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
let bookProc = null;
let bookBase = null;

async function probe(base) {
  try {
    const r = await fetch(base + "/", { signal: AbortSignal.timeout(1500) });
    return r.ok && (await r.text()).includes("Cosmic Quant");
  } catch { return false; }
}

// reuse a running Cosmic Quant server if there is one, otherwise start our own on a spare port
async function ensureBookServer() {
  for (const p of BOOK_PORTS) {
    if (await probe(`http://127.0.0.1:${p}`)) return (bookBase = `http://127.0.0.1:${p}`);
  }
  if (!fs.existsSync(path.join(BOOK_DIR, "dashboard_app.py"))) return null;
  const port = BOOK_PORTS[BOOK_PORTS.length - 1];
  bookProc = spawn("python", ["dashboard_app.py"], { cwd: BOOK_DIR, env: { ...process.env, PORT: String(port) }, windowsHide: true, stdio: "ignore" });
  bookProc.on("exit", () => { bookProc = null; });
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await probe(`http://127.0.0.1:${port}`)) return (bookBase = `http://127.0.0.1:${port}`);
  }
  return null;
}

// Chromium's network stack first (some CDNs, e.g. FRED's, stall Electron's bundled Node fetch), Node fetch as fallback
async function get(url, opts) {
  try { return await net.fetch(url, opts); } catch (e) { if (e && e.name === "TimeoutError") throw e; return fetch(url, opts); }
}
ipcMain.handle("http", async (_e, { method, url, body, timeout }) => {
  try {
    const r = await get(url, {
      method: method || "GET",
      // FRED and Yahoo refuse requests without a browser user agent
      headers: { "User-Agent": UA, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout || 15000),
    });
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    return { ok: false, status: 0, error: String(e && e.message || e) };
  }
});
// news links open in the system browser; only plain web URLs are allowed through
ipcMain.handle("open", (_e, url) => { if (/^https?:\/\//i.test(String(url))) shell.openExternal(String(url)); });
ipcMain.handle("app-name", () => app.getName());
ipcMain.handle("book-base", async () => bookBase || (await ensureBookServer()));

// ------------------------------------------------------------ alert cards: small frameless windows above every other
// window (a browser, a full-screen app), bottom-right of the screen, stacked; they never take the focus. A click on a
// card brings the terminal forward. VALID SETUP cards stay 60 s, others 15 s. The taskbar button flashes until the
// terminal is focused again.
let mainWin = null;
const pops = [];
const POP_W = 400;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function layoutPops() {
  const wa = screen.getPrimaryDisplay().workArea;
  let y = wa.y + wa.height - 10;
  for (const p of pops.slice().reverse()) {
    if (p.isDestroyed()) continue;
    const [, h] = p.getSize(); y -= h;
    if (y < wa.y) { p.close(); continue; }
    p.setPosition(wa.x + wa.width - POP_W - 10, y); y -= 8;
  }
}
function closePop(p) { const i = pops.indexOf(p); if (i >= 0) pops.splice(i, 1); if (!p.isDestroyed()) p.close(); layoutPops(); }
ipcMain.handle("alert", (_e, { title, body, level, app: name } = {}) => {
  const setup = level === "setup";
  const lines = String(body || "").split("\n").filter(Boolean).map((l) => {
    const m = /^([✓✗⚠])\s*(.*)$/.exec(l);
    return m ? `<div class="ck ${m[1] === "✗" ? "bad" : m[1] === "⚠" ? "warn" : ""}"><b>${m[1]}</b>${esc(m[2])}</div>` : `<div class="ln">${esc(l)}</div>`;
  }).join("");
  const html = `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;background:#000;color:#cfcfcf;font:12px/1.45 "IBM Plex Mono",Consolas,monospace;cursor:pointer;user-select:none;overflow:hidden}
    .card{border:1px solid ${setup ? "#fff" : "#555"};padding:10px 12px 11px}
    .top{display:flex;justify-content:space-between;color:#777;font-size:10px;letter-spacing:.14em;margin-bottom:6px}
    .t{color:#000;background:${setup ? "#fff" : "#bdbdbd"};font-weight:600;padding:3px 7px;font-size:13px;margin-bottom:7px;white-space:normal}
    .ln{color:#fff;font-size:12.5px}.ck{color:#a8a8a8;font-size:11.5px}.ck b{display:inline-block;width:16px;color:#fff}
    .ck.bad,.ck.bad b{color:#fff;text-decoration:underline}.ck.warn b{color:#fff}
  </style><div class="card"><div class="top"><span>${esc(name || "GRAPHITE")}</span><span>${new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })} · клик — открыть</span></div><div class="t">${esc(title || "")}</div>${lines}</div>`;
  const p = new BrowserWindow({ width: POP_W, height: 90, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false,
    alwaysOnTop: true, skipTaskbar: true, show: false, backgroundColor: "#000000", webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, javascript: true } });
  p.setAlwaysOnTop(true, "screen-saver");
  p.setVisibleOnAllWorkspaces(true);
  pops.push(p);
  p.webContents.once("did-finish-load", async () => {
    try { const h = await p.webContents.executeJavaScript("document.querySelector('.card').getBoundingClientRect().height"); p.setSize(POP_W, Math.ceil(h) + 2); } catch {}
    layoutPops();
    // screenshot runs (--shot) never put a card on the real screen: it is saved next to the screenshot instead
    if (argv.shot) { try { fs.writeFileSync(String(argv.shot) + ".alert.png", (await p.webContents.capturePage()).toPNG()); } catch {} closePop(p); return; }
    p.showInactive();
  });
  p.on("focus", () => { if (mainWin && !mainWin.isDestroyed()) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.show(); mainWin.focus(); } closePop(p); });
  p.on("closed", () => { const i = pops.indexOf(p); if (i >= 0) { pops.splice(i, 1); layoutPops(); } });
  setTimeout(() => closePop(p), setup ? 60000 : 15000);
  p.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  if (mainWin && !mainWin.isDestroyed() && !mainWin.isFocused()) mainWin.flashFrame(true);
  while (pops.length > 4) closePop(pops[0]);
  return true;
});

async function createWindow() {
  nativeTheme.themeSource = "dark";
  const [w, h] = String(argv.size || "1680x1000").split("x").map(Number);
  const win = new BrowserWindow({
    width: w, height: h, minWidth: 1100, minHeight: 680, backgroundColor: "#000000",
    title: app.getName(), autoHideMenuBar: true, show: !argv.shot, icon: path.join(__dirname, "build", "icon.ico"),
    // alert sounds must play while the terminal sits in the background
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, autoplayPolicy: "no-user-gesture-required", backgroundThrottling: false },
  });
  win.removeMenu();
  mainWin = win;
  win.on("focus", () => win.flashFrame(false));
  win.on("closed", () => { pops.slice().forEach((p) => { if (!p.isDestroyed()) p.close(); }); app.quit(); });

  if (argv.shot) {
    const log = [];
    win.webContents.on("console-message", (e) => log.push(`[${e.level}] ${e.message}`));
    win.webContents.once("did-finish-load", async () => {
      const wait = Number(argv.wait || 10) * 1000;
      if (argv.run) {
        await new Promise((r) => setTimeout(r, 2500));
        for (const cmd of String(argv.run).split(";")) {
          await win.webContents.executeJavaScript(`window.QT && QT.exec(${JSON.stringify(cmd)})`).catch((e) => log.push("run error " + e));
          await new Promise((r) => setTimeout(r, 400));
        }
      }
      await new Promise((r) => setTimeout(r, wait));
      // --js=<code>: test hook, evaluated in the page right before the capture (screenshot mode only)
      if (argv.jsfile) argv.js = fs.readFileSync(String(argv.jsfile), "utf8");
      if (argv.js) { await win.webContents.executeJavaScript(String(argv.js)).catch((e) => log.push("js error " + e)); await new Promise((r) => setTimeout(r, 1500)); }
      const img = await win.webContents.capturePage();
      fs.writeFileSync(String(argv.shot), img.toPNG());
      fs.writeFileSync(String(argv.shot) + ".log", log.join("\n"));
      app.quit();
    });
  }
  await win.loadFile("index.html");
}

app.setAppUserModelId(app.getName());
app.whenReady().then(async () => {
  ensureBookServer();          // don't block the window on it
  await createWindow();
});
app.on("window-all-closed", () => app.quit());
app.on("quit", () => { if (bookProc) bookProc.kill(); });
