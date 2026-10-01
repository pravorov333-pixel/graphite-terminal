const { app, BrowserWindow, ipcMain, nativeTheme, shell, net } = require("electron");
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

async function createWindow() {
  nativeTheme.themeSource = "dark";
  const [w, h] = String(argv.size || "1680x1000").split("x").map(Number);
  const win = new BrowserWindow({
    width: w, height: h, minWidth: 1100, minHeight: 680, backgroundColor: "#000000",
    title: app.getName(), autoHideMenuBar: true, show: !argv.shot, icon: path.join(__dirname, "build", "icon.ico"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  win.removeMenu();

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
