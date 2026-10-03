// Step 3b — can the rejection block be traded right on entry into the zone (limit at the body edge, the first touch)?
// Step 3 showed the edge entry loses (−0.27R on NQ/ES) while the middle of the zone (CE) makes money. Here the edge
// entry gets every reasonable fix, one at a time, to see whether any of them turns it positive:
//   stop     beyond the wick (+0.02×ATR) · beyond the wick +0.25×ATR · beyond the wick +0.5×ATR
//   target   1R · 1.5R · 2R · 3R
//   manage   stop to break-even after +1R
//   split    half at the edge, half at CE, one stop beyond the wick, target = edge + 2R(edge); result per planned risk
// Same data, costs and rules as step 3 (time stop 4 h, stop and target in one bar = stop, stocks in US hours only).
// Klines are cached in research/cache/ so reruns don't hit Binance again.
//   node research/step3b_rb_edge.js
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
const HOLD = 48, WAIT = 48;
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
    const h = k5.map((k) => +k[2]), l = k5.map((k) => +k[3]), c = k5.map((k) => +k[4]);
    const c15 = k15.map((k) => +k[4]), t15 = k15.map((k) => k[0]);
    const trendAt = (t) => { const i = t15.findIndex((x) => x + 15 * 60e3 > t) - 1; if (i < 50) return null; const m = c15.slice(i - 49, i + 1).reduce((a, x) => a + x, 0) / 50; return c15[i] > m; };
    const hitStop = (dir, k, s) => (dir > 0 ? l[k] <= s : h[k] >= s), hitTgt = (dir, k, t) => (dir > 0 ? h[k] >= t : l[k] <= t);

    // price-space walk from the fill bar `from`: returns exit price. `be` = move stop to entry after +1R
    const walk = (dir, entry, stop, tgt, from, be) => {
      const R = Math.abs(entry - stop);
      if (hitStop(dir, from, stop)) return stop;               // the touch bar ran through the zone: filled and stopped
      let s = stop;
      for (let k = from + 1; k < Math.min(c.length, from + 1 + HOLD); k++) {
        if (hitStop(dir, k, s)) return s;
        if (hitTgt(dir, k, tgt)) return tgt;
        if (be && (dir > 0 ? h[k] >= entry + R : l[k] <= entry - R)) s = entry;   // takes effect from the next bar
      }
      return c[Math.min(c.length - 1, from + HOLD)];
    };

    for (const ev of trace) {
      if (ev.kind !== "RB") continue;
      const dir = ev.bull ? 1 : -1, A = ev.atr, j = ev.j, m = QT.et(k5[j][0]).min;
      if (!INDEX.includes(sym) && !RTH(m)) continue;
      const base = { sym, group: INDEX.includes(sym) ? "Индексы (NQ/ES)" : "Акции и ETF", t: k5[j][0], trend: trendAt(ev.t) === (dir > 0), kz: KZ(m) };
      const res = {};
      const one = (name, entry, stop, T, be) => {
        const R = Math.abs(entry - stop); if (!(R >= 0.05 * A && R <= 3 * A)) return;
        const exit = walk(dir, entry, stop, entry + dir * T * R, j, be);
        res[name] = ((exit - entry) * dir) / R - (COST(sym) * entry) / R;
      };
      const wick = ev.stop - dir * 0.02 * A;
      for (const T of [1, 1.5, 2, 3]) one(`стоп за тенью · цель ${T}R`, ev.entry, wick, T, false);
      one("стоп за тенью +0.25 ATR · 2R", ev.entry, wick - dir * 0.25 * A, 2, false);
      one("стоп за тенью +0.5 ATR · 2R", ev.entry, wick - dir * 0.5 * A, 2, false);
      one("стоп +0.5 ATR · 1.5R", ev.entry, wick - dir * 0.5 * A, 1.5, false);
      one("стоп за тенью · 2R · безубыток после 1R", ev.entry, wick, 2, true);

      // split: half at the edge now, half at CE if price gets there (before the stop, within 4 h); one stop, one target
      const Re = Math.abs(ev.entry - wick), Rc = Math.abs(ev.ce - wick);
      if (Re >= 0.05 * A && Re <= 3 * A) {
        const tgt = ev.entry + dir * 2 * Re, plan = 0.5 * Re + 0.5 * Rc;
        let pnl = 0.5 * ((walk(dir, ev.entry, wick, tgt, j, false) - ev.entry) * dir) - 0.5 * COST(sym) * ev.entry;
        for (let k = j; k < Math.min(c.length, j + WAIT); k++) {
          if (k > j && (hitStop(dir, k, wick) || hitTgt(dir, k, tgt))) break;
          if (dir > 0 ? l[k] <= ev.ce : h[k] >= ev.ce) { pnl += 0.5 * ((walk(dir, ev.ce, wick, tgt, k, false) - ev.ce) * dir) - 0.5 * COST(sym) * ev.ce; break; }
        }
        res["половина на краю + половина в CE · цель 2R края"] = pnl / plan;
      }
      // reference: CE only (step 3's winner) on the same events
      for (let k = j; k < Math.min(c.length, j + WAIT); k++) {
        if (hitStop(dir, k, wick)) break;
        if (dir > 0 ? l[k] <= ev.ce : h[k] >= ev.ce) { const R = Math.abs(ev.ce - wick); if (R >= 0.05 * A) res["для сравнения: только CE · 2R"] = ((walk(dir, ev.ce, wick, ev.ce + dir * 2 * R, k, false) - ev.ce) * dir) / R - (COST(sym) * ev.ce) / R; break; }
      }
      trades.push({ ...base, res });
    }
    console.log("ok");
  }

  const stat = (r) => {
    if (r.length < 8) return null;
    const n = r.length, m = r.reduce((a, x) => a + x, 0) / n, sd = Math.sqrt(r.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1));
    const half = Math.floor(n / 2), avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
    return { n, win: (r.filter((x) => x > 0).length / n) * 100, avgR: m, t: sd ? m / (sd / Math.sqrt(n)) : 0, first: avg(r.slice(0, half)), second: avg(r.slice(half)) };
  };
  const FILTERS = { "все": () => true, "по тренду": (x) => x.trend, "по тренду + киллзона": (x) => x.trend && x.kz };
  const sorted = [...trades].sort((a, b) => a.t - b.t), out = {};
  const names = [...new Set(trades.flatMap((x) => Object.keys(x.res)))];
  for (const group of ["Индексы (NQ/ES)", "Акции и ETF"]) {
    out[group] = {};
    for (const [fn, f] of Object.entries(FILTERS)) {
      out[group][fn] = {};
      for (const nm of names) out[group][fn][nm] = stat(sorted.filter((x) => x.group === group && f(x) && x.res[nm] != null).map((x) => x.res[nm]));
    }
  }
  fs.writeFileSync(path.join(OUT, "step3b_rb_edge.json"), JSON.stringify(out, null, 1));
  const f = (x, d = 2) => (x == null ? "—" : (x >= 0 ? "+" : "") + x.toFixed(d));
  for (const [g, byF] of Object.entries(out)) for (const [fn, byN] of Object.entries(byF)) {
    console.log(`\n=== ${g} · ${fn}`);
    for (const [nm, s] of Object.entries(byN)) if (s) console.log(`  ${nm.padEnd(46)} n=${String(s.n).padStart(5)}  ${f(s.avgR)}R  win ${s.win.toFixed(0)}%  t ${f(s.t, 1)}  половины ${f(s.first)}/${f(s.second)}`);
  }
})();
