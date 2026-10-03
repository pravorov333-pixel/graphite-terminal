// Step 3 — a closer look at rejection blocks and the 10:00 NY open (key opens 00:00 / 09:30 for comparison).
// Entry variants follow the indicator (ICT-QPS v21) and common ICT practice; nothing is optimised.
//   RB  edge     limit at the body edge (step 2's entry)            · stop beyond the wick
//   RB  CE       limit at the zone's middle (the indicator's anchor) · stop beyond the wick
//   RB  confirm  after the touch, wait ≤30 min for a 5m close back out of the zone in the setup's direction, enter there
//   KO  pine     enter on the reclaim close, stop 0.5×ATR beyond the level (the indicator's synthetic stop)
//   KO  sweep    enter on the reclaim close, stop beyond the sweep's extreme
//   KO  retest   after the reclaim, limit back at the level (≤30 min), stop beyond the sweep's extreme
// Targets 2R and 3R, time stop 4 h, stop and target in one bar = stop. Index perps (QQQ/SPY = NQ/ES) with CME
// futures costs; stock perps with stock costs (2 bp round trip) and regular US hours only (overnight perp prices
// are model prices). Every instrument has ~6 months of 5-minute history on Binance.
//   node research/step3_rb_10am.js
const fs = require("fs");
const path = require("path");
const OUT = path.join(__dirname, "results");
fs.mkdirSync(OUT, { recursive: true });

const etFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });
const QT = { PROXY: {}, et: (ms) => { const o = {}; for (const p of etFmt.formatToParts(ms)) o[p.type] = p.value; return { date: `${o.year}-${o.month}-${o.day}`, min: +o.hour * 60 + +o.minute, dow: o.weekday }; } };
global.window = { QT };
eval(fs.readFileSync(path.join(__dirname, "..", "src", "ictengine.js"), "utf8"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const klines = async (sym, tf) => {
  let out = [], end = null;
  for (;;) {
    let r = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}USDT&interval=${tf}&limit=1500${end ? "&endTime=" + end : ""}`);
    if (r.status === 429 || r.status === 418) { await sleep(30000); continue; }
    const k = await r.json();
    if (!Array.isArray(k) || !k.length) break;
    out = k.concat(out); end = k[0][0] - 1;
    await sleep(250);                                   // stay well under Binance's weight limit
    if (k.length < 1500) break;
  }
  return out;
};

const INDEX = ["QQQ", "SPY"], STOCKS = ["IWM", "SMH", "NVDA", "AAPL", "MSFT", "META", "AMZN", "GOOGL", "TSLA", "AVGO"];
const COST = (sym) => (INDEX.includes(sym) ? 0.00004 : 0.0002);
const HOLD = 48, WAIT = 6, TARGETS = [2, 3];
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
    const trendAt = (t) => { let i = t15.findIndex((x) => x + 15 * 60e3 > t) - 1; if (i < 50) return null; const m = c15.slice(i - 49, i + 1).reduce((a, x) => a + x, 0) / 50; return c15[i] > m; };
    const etOf = (j) => QT.et(k5[j][0]);

    // walk a trade from bar `from` (entry already filled at `entry`); `firstBarStop` = the fill bar may hit the stop too
    const walk = (dir, entry, stop, from, T, firstBarStop) => {
      const R = Math.abs(entry - stop), tgt = entry + dir * T * R;
      if (firstBarStop && (dir > 0 ? l[from] <= stop : h[from] >= stop)) return -1;
      for (let k = from + 1; k < Math.min(c.length, from + 1 + HOLD); k++) {
        if (dir > 0 ? l[k] <= stop : h[k] >= stop) return -1;
        if (dir > 0 ? h[k] >= tgt : l[k] <= tgt) return T;
      }
      const k = Math.min(c.length - 1, from + HOLD); return ((c[k] - entry) * dir) / R;
    };
    const add = (ev, variant, dir, entry, stop, from, firstBarStop) => {
      const R = Math.abs(entry - stop);
      if (!(R >= 0.05 * ev.atr && R <= 3 * ev.atr)) return;
      const m = etOf(from).min;
      const res = {}; for (const T of TARGETS) res[T] = walk(dir, entry, stop, from, T, firstBarStop) - (COST(sym) * entry) / R;
      trades.push({ sym, group: INDEX.includes(sym) ? "Индексы (NQ/ES)" : "Акции и ETF", kind: ev.kind.startsWith("KO") ? ev.kind : "RB", variant, bull: dir > 0, t: k5[from][0], res,
        trend: trendAt(ev.t) === (dir > 0), kz: KZ(m), rth: RTH(m), am: m >= 600 && m < 720, inMacro: ev.inMacro, swept: ev.swept });
    };

    for (const ev of trace) {
      const dir = ev.bull ? 1 : -1;
      if (ev.kind === "RB") {
        const buf = 0.02 * ev.atr, stop = ev.stop - dir * buf;
        add(ev, "край зоны", dir, ev.entry, stop, ev.j, true);
        // CE: the limit fills only if price reaches the middle of the zone within the waiting window
        for (let k = ev.j; k < Math.min(c.length, ev.j + WAIT * 8); k++) {
          if (dir > 0 ? l[k] <= stop : h[k] >= stop) break;                     // stopped before reaching CE → no fill
          if (dir > 0 ? l[k] <= ev.ce : h[k] >= ev.ce) { add(ev, "середина (CE)", dir, ev.ce, stop, k, true); break; }
        }
        // confirmation: a 5m close back out of the zone in the setup's direction, before the stop is touched
        for (let k = ev.j; k < Math.min(c.length, ev.j + WAIT); k++) {
          if (dir > 0 ? l[k] <= stop : h[k] >= stop) break;
          if (dir > 0 ? c[k] > ev.entry && c[k] > o[k] : c[k] < ev.entry && c[k] < o[k]) { add(ev, "подтверждение", dir, c[k], stop, k, false); break; }
        }
      } else if (ev.kind.startsWith("KO")) {
        add(ev, "pine (0.5 ATR)", dir, ev.entry, ev.stop, ev.j, false);
        if (ev.ext != null) {
          const sStop = ev.ext - dir * 0.02 * ev.atr;
          add(ev, "стоп за свипом", dir, ev.entry, sStop, ev.j, false);
          for (let k = ev.j + 1; k < Math.min(c.length, ev.j + 1 + WAIT); k++) {
            if (dir > 0 ? l[k] <= sStop : h[k] >= sStop) break;
            if (dir > 0 ? l[k] <= ev.level : h[k] >= ev.level) { add(ev, "ретест уровня", dir, ev.level, sStop, k, true); break; }
          }
        }
      }
    }
    console.log(`${trace.length} событий`);
  }

  // ---- statistics
  const stat = (list, T) => {
    const r = list.map((x) => x.res[T]); if (r.length < 8) return null;
    const n = r.length, m = r.reduce((a, x) => a + x, 0) / n, sd = Math.sqrt(r.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1));
    const half = Math.floor(n / 2), avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
    return { n, win: (r.filter((x) => x > 0).length / n) * 100, avgR: m, t: sd ? m / (sd / Math.sqrt(n)) : 0, first: avg(r.slice(0, half)), second: avg(r.slice(half)) };
  };
  const FILTERS = {
    RB: { "все": () => true, "по тренду": (x) => x.trend, "по тренду + киллзона": (x) => x.trend && x.kz, "RB в макро-окне 09:50–10:10": (x) => x.inMacro, "RB со снятием ликвидности": (x) => x.swept, "по тренду + (макро или снятие)": (x) => x.trend && (x.inMacro || x.swept) },
    KO: { "все": () => true, "по тренду": (x) => x.trend, "реклейм 10:00–12:00": (x) => x.am, "по тренду + 10:00–12:00": (x) => x.trend && x.am },
  };
  const out = {};
  const sorted = [...trades].sort((a, b) => a.t - b.t);
  for (const group of ["Индексы (NQ/ES)", "Акции и ETF"]) {
    out[group] = {};
    for (const kind of ["RB", "KO1000", "KO00", "KO0930"]) {
      const base = sorted.filter((x) => x.group === group && x.kind === kind && (group === "Индексы (NQ/ES)" || x.rth));
      for (const variant of [...new Set(base.map((x) => x.variant))]) {
        for (const [fn, f] of Object.entries(FILTERS[kind === "RB" ? "RB" : "KO"])) {
          const list = base.filter((x) => x.variant === variant && f(x));
          const s2 = stat(list, 2), s3 = stat(list, 3);
          if (s2) (out[group][kind] ||= []).push({ variant, filter: fn, r2: s2, r3: s3 });
        }
      }
    }
  }
  // per-instrument consistency for the headline variants
  const perSym = {};
  for (const [kind, variant] of [["RB", "середина (CE)"], ["KO1000", "стоп за свипом"], ["KO00", "стоп за свипом"]]) {
    perSym[`${kind} · ${variant} · по тренду`] = Object.fromEntries([...INDEX, ...STOCKS].map((s) => {
      const st = stat(sorted.filter((x) => x.sym === s && x.kind === kind && x.variant === variant && x.trend && (INDEX.includes(s) || x.rth)), 2);
      return [s, st ? { n: st.n, avgR: +st.avgR.toFixed(2) } : null];
    }));
  }
  fs.writeFileSync(path.join(OUT, "step3_rb_10am.json"), JSON.stringify({ results: out, perInstrument: perSym, trades: trades.length }, null, 1));

  const f = (x, d = 2) => (x == null ? "  —  " : (x >= 0 ? "+" : "") + x.toFixed(d));
  for (const [group, byKind] of Object.entries(out)) {
    console.log(`\n================ ${group}`);
    for (const [kind, rows] of Object.entries(byKind)) {
      console.log(`--- ${kind}`);
      for (const r of rows) console.log(`  ${r.variant.padEnd(15)} ${r.filter.padEnd(31)} n=${String(r.r2.n).padStart(5)}  2R ${f(r.r2.avgR)} (win ${r.r2.win.toFixed(0)}%, t ${f(r.r2.t, 1)}, половины ${f(r.r2.first)}/${f(r.r2.second)})   3R ${f(r.r3.avgR)} (t ${f(r.r3.t, 1)})`);
    }
  }
  console.log("\n================ По инструментам (цель 2R, средний R, n)");
  for (const [k, m] of Object.entries(perSym)) console.log(`  ${k}: ` + Object.entries(m).map(([s, v]) => `${s} ${v ? f(v.avgR) + "/" + v.n : "—"}`).join("  "));
})();
