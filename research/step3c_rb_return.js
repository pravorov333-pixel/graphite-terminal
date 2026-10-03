// Step 3c — rejection block entered on the way back out: price trades into the zone, and while a 5m bar closes inside
// it an order rests at the zone's edge (body edge); it fills when price comes back out through the edge in the setup's
// direction (a stop order technically: a bar opening beyond the edge fills at its open, i.e. with slippage).
//   stop     beyond the wick (+0.02×ATR) · beyond the deepest point price reached inside the zone (+0.02×ATR)
//   deep     the order is armed only after price has reached the middle of the zone (CE)
//   window   the order lives up to 2 h after the first touch; a close beyond the wick cancels the setup
// Targets 2R and 3R, time stop 4 h, stop and target in one bar = stop, the fill bar may hit the stop too.
// Same instruments, costs and hours as step 3 (klines from research/cache/ when fresh).
//   node research/step3c_rb_return.js
const fs = require("fs");
const path = require("path");
const OUT = path.join(__dirname, "results"), CACHE = path.join(__dirname, "cache");
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(CACHE, { recursive: true });

const etFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });
const QT = { PROXY: {}, et: (ms) => { const o = {}; for (const p of etFmt.formatToParts(ms)) o[p.type] = p.value; return { date: `${o.year}-${o.month}-${o.day}`, min: +o.hour * 60 + +o.minute, dow: o.weekday }; } };
global.window = { QT };
eval(fs.readFileSync(path.join(__dirname, "..", "src", "ictengine.js"), "utf8"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const klines = async (sym, tf) => {
  const file = path.join(CACHE, `${sym}_${tf}.json`);
  if (fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < 12 * 3600e3) return JSON.parse(fs.readFileSync(file, "utf8"));
  let out = [], end = null;
  for (;;) {
    const r = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}USDT&interval=${tf}&limit=1500${end ? "&endTime=" + end : ""}`);
    if (r.status === 429 || r.status === 418) { await sleep(30000); continue; }
    const k = await r.json();
    if (!Array.isArray(k) || !k.length) break;
    out = k.concat(out); end = k[0][0] - 1;
    await sleep(250);
    if (k.length < 1500) break;
  }
  fs.writeFileSync(file, JSON.stringify(out));
  return out;
};

const INDEX = ["QQQ", "SPY"], STOCKS = ["IWM", "SMH", "NVDA", "AAPL", "MSFT", "META", "AMZN", "GOOGL", "TSLA", "AVGO"];
const COST = (sym) => (INDEX.includes(sym) ? 0.00004 : 0.0002);
const HOLD = 48, WAIT = 24, TARGETS = [2, 3];
const KZ = (min) => QT.KILLZONES.some(([, a, b]) => min >= a && min < b);
const RTH = (min) => min >= 570 && min < 960;

(async () => {
  const trades = [];
  for (const sym of [...INDEX, ...STOCKS]) {
    process.stdout.write(`${sym} … `);
    const k15 = await klines(sym, "15m"), k5 = await klines(sym, "5m");
    if (k5.length < 3000) { console.log("мало истории, пропуск"); continue; }
    const trace = [];
    QT.ictRun(k15, k5, true, trace);
    const o = k5.map((k) => +k[1]), h = k5.map((k) => +k[2]), l = k5.map((k) => +k[3]), c = k5.map((k) => +k[4]);
    const c15 = k15.map((k) => +k[4]), t15 = k15.map((k) => k[0]);
    const trendAt = (t) => { const i = t15.findIndex((x) => x + 15 * 60e3 > t) - 1; if (i < 50) return null; const m = c15.slice(i - 49, i + 1).reduce((a, x) => a + x, 0) / 50; return c15[i] > m; };

    const walk = (dir, entry, stop, T, from) => {
      const R = Math.abs(entry - stop), tgt = entry + dir * T * R;
      if (dir > 0 ? l[from] <= stop : h[from] >= stop) return -1;
      for (let k = from + 1; k < Math.min(c.length, from + 1 + HOLD); k++) {
        if (dir > 0 ? l[k] <= stop : h[k] >= stop) return -1;
        if (dir > 0 ? h[k] >= tgt : l[k] <= tgt) return T;
      }
      return ((c[Math.min(c.length - 1, from + HOLD)] - entry) * dir) / R;
    };

    let n = 0;
    for (const ev of trace) {
      if (ev.kind !== "RB") continue;
      const dir = ev.bull ? 1 : -1, A = ev.atr, j = ev.j, edge = ev.entry, wick = ev.stop, buf = 0.02 * A;
      const m0 = QT.et(k5[j][0]).min;
      if (!INDEX.includes(sym) && !RTH(m0)) continue;
      const inside = (x) => (dir > 0 ? x < edge && x > wick : x > edge && x < wick);
      const beyondWick = (x) => (dir > 0 ? x <= wick : x >= wick);
      // follow the zone bar by bar: track the deepest point, arm the order on a close inside, fill on the way out
      let deep = dir > 0 ? l[j] : h[j], reachedCE = dir > 0 ? l[j] <= ev.ce : h[j] >= ev.ce, armed = inside(c[j]), fill = null;
      if (beyondWick(c[j])) continue;
      for (let k = j + 1; k < Math.min(c.length, j + 1 + WAIT); k++) {
        if (armed) {
          const px = dir > 0 ? (o[k] >= edge ? o[k] : h[k] >= edge ? edge : null) : (o[k] <= edge ? o[k] : l[k] <= edge ? edge : null);
          if (px != null) { fill = { k, px, deep, reachedCE }; break; }
        }
        deep = dir > 0 ? Math.min(deep, l[k]) : Math.max(deep, h[k]);
        if (dir > 0 ? l[k] <= ev.ce : h[k] >= ev.ce) reachedCE = true;
        if (beyondWick(c[k])) break;                       // closed through the whole zone: setup dead
        armed = inside(c[k]);
      }
      if (!fill) continue;
      const m = QT.et(k5[fill.k][0]).min;
      const base = { sym, group: INDEX.includes(sym) ? "Индексы (NQ/ES)" : "Акции и ETF", t: k5[fill.k][0], trend: trendAt(ev.t) === (dir > 0), kz: KZ(m), deepCE: fill.reachedCE, res: {} };
      for (const [name, stop] of [["стоп за тенью RB", wick - dir * buf], ["стоп за глубиной захода", fill.deep - dir * buf]]) {
        const R = Math.abs(fill.px - stop);
        if (!(R >= 0.05 * A && R <= 3 * A)) continue;
        base.res[name] = Object.fromEntries(TARGETS.map((T) => [T, walk(dir, fill.px, stop, T, fill.k) - (COST(sym) * fill.px) / R]));
      }
      trades.push(base); n++;
    }
    console.log(`${n} входов`);
  }

  const stat = (r) => {
    if (r.length < 8) return null;
    const n = r.length, m = r.reduce((a, x) => a + x, 0) / n, sd = Math.sqrt(r.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1));
    const half = Math.floor(n / 2), avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
    return { n, win: (r.filter((x) => x > 0).length / n) * 100, avgR: m, t: sd ? m / (sd / Math.sqrt(n)) : 0, first: avg(r.slice(0, half)), second: avg(r.slice(half)) };
  };
  const FILTERS = { "все": () => true, "по тренду": (x) => x.trend, "по тренду + киллзона": (x) => x.trend && x.kz, "дошла до CE": (x) => x.deepCE, "дошла до CE + по тренду": (x) => x.deepCE && x.trend };
  const sorted = [...trades].sort((a, b) => a.t - b.t), out = {};
  for (const group of ["Индексы (NQ/ES)", "Акции и ETF"]) {
    out[group] = {};
    for (const [fn, f] of Object.entries(FILTERS)) for (const stopName of ["стоп за тенью RB", "стоп за глубиной захода"]) {
      const list = sorted.filter((x) => x.group === group && f(x) && x.res[stopName]);
      const s2 = stat(list.map((x) => x.res[stopName][2])), s3 = stat(list.map((x) => x.res[stopName][3]));
      if (s2) (out[group][fn] ||= {})[stopName] = { r2: s2, r3: s3 };
    }
  }
  fs.writeFileSync(path.join(OUT, "step3c_rb_return.json"), JSON.stringify(out, null, 1));
  const f = (x, d = 2) => (x == null ? "—" : (x >= 0 ? "+" : "") + x.toFixed(d));
  for (const [g, byF] of Object.entries(out)) {
    console.log(`\n=== ${g}`);
    for (const [fn, byS] of Object.entries(byF)) for (const [sn, { r2, r3 }] of Object.entries(byS))
      console.log(`  ${fn.padEnd(24)} ${sn.padEnd(24)} n=${String(r2.n).padStart(5)}  2R ${f(r2.avgR)} (win ${r2.win.toFixed(0)}%, t ${f(r2.t, 1)}, половины ${f(r2.first)}/${f(r2.second)})  3R ${f(r3.avgR)} (t ${f(r3.t, 1)})`);
  }
})();
