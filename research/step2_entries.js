// Step 2 — do the ICT entries (the indicator's rejection blocks, order blocks, FVGs and key-open sweep-and-reclaims)
// make money as actual trades, with stops and costs? Simulated on the Binance QQQ / SPY perps (NQ / ES in ETF units)
// over their whole history, CME hours only. Rules fixed in advance:
//   entry at the level (key opens: close of the reclaim bar) · stop beyond the wick / far edge (+0.02×ATR) ·
//   target 2R (1R and 3R reported for robustness) · time stop 4 h · stop and target in the same bar = stop ·
//   costs: Binance perp (0.02% maker in + 0.05% taker out) and CME futures (~1 NQ point round trip incl. slippage).
// Filters tested one at a time and stacked: trend (15m SMA50), kill zones, step 1's macro regime.
//   node research/step2_entries.js   (run step1_regime.js first for the regime filter)
const fs = require("fs");
const path = require("path");
const OUT = path.join(__dirname, "results");

// ---- load the terminal's ICT engine with the bits of QT it needs
const etFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });
const QT = { PROXY: {}, et: (ms) => { const o = {}; for (const p of etFmt.formatToParts(ms)) o[p.type] = p.value; return { date: `${o.year}-${o.month}-${o.day}`, min: +o.hour * 60 + +o.minute, dow: o.weekday }; } };
global.window = { QT };
eval(fs.readFileSync(path.join(__dirname, "..", "src", "ictengine.js"), "utf8"));

const klines = async (sym, tf) => {
  let out = [], end = null;
  for (;;) {
    const k = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}USDT&interval=${tf}&limit=1500${end ? "&endTime=" + end : ""}`).then((r) => r.json());
    if (!Array.isArray(k) || !k.length) break;
    out = k.concat(out); end = k[0][0] - 1;
    if (k.length < 1500) break;
  }
  return out;
};
const scores = (ix) => { try { return JSON.parse(fs.readFileSync(path.join(OUT, `step1_scores_${ix}.json`), "utf8")); } catch { return null; } };

const COSTS = { "Binance перп": 0.0007, "CME фьючерс": 0.00004 };
const TARGETS = [1, 2, 3], HOLD = 48;   // 48 five-minute bars = 4 hours

(async () => {
  const report = {};
  for (const [sym, ix] of [["QQQ", "NDX"], ["SPY", "SPX"]]) {
    const [k15, k5] = await Promise.all([klines(sym, "15m"), klines(sym, "5m")]);
    const trace = [];
    QT.ictRun(k15, k5, true, trace);           // proxy=true → CME trading hours only
    const h = k5.map((k) => +k[2]), l = k5.map((k) => +k[3]), c = k5.map((k) => +k[4]);
    const c15 = k15.map((k) => +k[4]), t15 = k15.map((k) => k[0]);
    const sc = scores(ix), scoreDays = sc ? Object.keys(sc).sort() : [];
    const prevScore = (date) => { let lo = 0, hi = scoreDays.length - 1, r = null; while (lo <= hi) { const m = (lo + hi) >> 1; if (scoreDays[m] < date) { r = sc[scoreDays[m]]; lo = m + 1; } else hi = m - 1; } return r; };
    const trendAt = (t) => {   // last closed 15m bar before t: close vs SMA50
      let i = t15.findIndex((x) => x + 15 * 60e3 > t) - 1; if (i < 0) i = t15.length - 1;
      if (i < 50) return null;
      const m = c15.slice(i - 49, i + 1).reduce((a, x) => a + x, 0) / 50;
      return c15[i] > m;
    };
    const inKz = (min) => QT.KILLZONES.some(([, a, b]) => min >= a && min < b);

    // ---- simulate every traced setup
    const trades = [];
    for (const ev of trace) {
      const dir = ev.bull ? 1 : -1, buf = ev.atClose ? 0 : 0.02 * ev.atr;
      const entry = ev.entry, stop = ev.stop - dir * buf, R = Math.abs(entry - stop);
      if (!(R >= 0.05 * ev.atr && R <= 3 * ev.atr)) continue;
      const res = {};
      for (const T of TARGETS) {
        const tgt = entry + dir * T * R;
        let out = null;
        // the touch bar may already have run through the stop: count it (we can't know the order inside the bar)
        if (!ev.atClose && (dir > 0 ? l[ev.j] <= stop : h[ev.j] >= stop)) out = -1;
        for (let k = ev.j + 1; out == null && k < Math.min(c.length, ev.j + 1 + HOLD); k++) {
          if (dir > 0 ? l[k] <= stop : h[k] >= stop) out = -1;
          else if (dir > 0 ? h[k] >= tgt : l[k] <= tgt) out = T;
        }
        if (out == null) { const k = Math.min(c.length - 1, ev.j + HOLD); out = ((c[k] - entry) * dir) / R; }
        res[T] = out;
      }
      const date = QT.et(ev.t).date, s = prevScore(date);
      trades.push({ ...ev, R, res, trend: trendAt(ev.t), kz: inKz(ev.min), macro: s == null ? null : (ev.bull ? s >= 0 : s <= 0), costR: Object.fromEntries(Object.entries(COSTS).map(([k, pct]) => [k, (pct * entry) / R])) });
    }

    // ---- statistics per setup and filter
    const stats = (list, T, costKey) => {
      const r = list.map((x) => x.res[T] - x.costR[costKey]);
      if (!r.length) return null;
      const n = r.length, mean = r.reduce((a, x) => a + x, 0) / n, sd = Math.sqrt(r.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, n - 1));
      const win = r.filter((x) => x > 0), loss = r.filter((x) => x <= 0);
      let eq = 0, peak = 0, dd = 0; for (const x of r) { eq += x; peak = Math.max(peak, eq); dd = Math.min(dd, eq - peak); }
      const half = Math.floor(n / 2), m1 = r.slice(0, half), m2 = r.slice(half);
      const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
      return { n, win: (win.length / n) * 100, avgR: mean, t: sd ? mean / (sd / Math.sqrt(n)) : 0, pf: loss.length ? win.reduce((a, x) => a + x, 0) / -loss.reduce((a, x) => a + x, 0) : null, totalR: eq, maxDD: dd, firstHalf: avg(m1), secondHalf: avg(m2) };
    };
    const kinds = ["RB", "OB", "FVG", "KO00", "KO0930", "KO1000"];
    const FILTERS = {
      "все сигналы": () => true,
      "по тренду": (x) => x.trend === x.bull,
      "против тренда": (x) => x.trend != null && x.trend !== x.bull,
      "в киллзону": (x) => x.kz,
      "тренд + киллзона": (x) => x.trend === x.bull && x.kz,
      "тренд + макро": (x) => x.trend === x.bull && x.macro === true,
      "тренд + киллзона + макро": (x) => x.trend === x.bull && x.kz && x.macro === true,
    };
    const R = { from: new Date(k5[0][0]).toISOString().slice(0, 10), to: new Date(k5[k5.length - 1][0]).toISOString().slice(0, 10), traced: trace.length, simulated: trades.length, table: {} };
    for (const kind of [...kinds, "ВСЕ"]) {
      const base = kind === "ВСЕ" ? trades : trades.filter((x) => x.kind === kind);
      R.table[kind] = {};
      for (const [fn, f] of Object.entries(FILTERS)) {
        const list = base.filter(f);
        R.table[kind][fn] = Object.fromEntries(Object.keys(COSTS).map((ck) => [ck, Object.fromEntries(TARGETS.map((T) => [T + "R", stats(list, T, ck)]))]));
      }
    }
    report[sym] = R;
  }
  fs.writeFileSync(path.join(OUT, "step2_entries.json"), JSON.stringify(report, null, 1));

  // ---- printed summary: 2R target, both cost models
  const f = (x, d = 2) => (x == null ? "—" : (x >= 0 ? "+" : "") + x.toFixed(d));
  for (const [sym, R] of Object.entries(report)) {
    console.log(`\n================ ${sym} (${sym === "QQQ" ? "NQ" : "ES"})  ${R.from} → ${R.to}  · событий ${R.traced}, сделок ${R.simulated}`);
    for (const ck of Object.keys(COSTS)) {
      console.log(`--- цель 2R · издержки: ${ck}`);
      for (const [kind, byF] of Object.entries(R.table)) {
        for (const [fn, byC] of Object.entries(byF)) {
          const s = byC[ck]["2R"]; if (!s || s.n < 5) continue;
          const r1 = byC[ck]["1R"], r3 = byC[ck]["3R"];
          console.log(`  ${kind.padEnd(7)} ${fn.padEnd(26)} n=${String(s.n).padStart(4)} win ${s.win.toFixed(0).padStart(3)}%  ср ${f(s.avgR)}R  t=${f(s.t, 1)}  PF ${s.pf == null ? "—" : s.pf.toFixed(2)}  итог ${f(s.totalR, 1)}R  DD ${s.maxDD.toFixed(1)}R  1-я/2-я половина ${f(s.firstHalf)}/${f(s.secondHalf)}   [1R ${f(r1.avgR)} · 3R ${f(r3.avgR)}]`);
        }
      }
    }
  }
})();
