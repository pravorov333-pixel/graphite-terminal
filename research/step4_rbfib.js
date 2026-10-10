// Step 4 — "Rejection Blocks + Fibonacci confluence": the strategy exactly as src/rbfib.js runs it in the terminal.
// 5m rejection block with a confirming close, liquidity / PDA context, limit at the RB open only while it sits in the
// 0.62–0.79 retracement of the impulse (grid re-anchored on new extremes), stop beyond the wick, target 5R,
// ≤ 3 trades a day, stop for the day after 2 losses in a row. Compared with: no Fibonacci filter (limit at the RB
// open as soon as the block forms), the same rules with the limit at the middle of the wick zone (CE, step 3's only
// robust entry), other targets (2R, 3R, nearest liquidity pool), each context type, each instrument.
// Same data and costs as step 3: QQQ / SPY perps = NQ / ES with CME costs; 10 stocks / ETFs with stock costs, US hours.
//   node research/step4_rbfib.js
const fs = require("fs");
const path = require("path");
const OUT = path.join(__dirname, "results"), CACHE = path.join(__dirname, "cache");
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(CACHE, { recursive: true });

const etFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });
const QT = { PROXY: {}, et: (ms) => { const o = {}; for (const p of etFmt.formatToParts(ms)) o[p.type] = p.value; return { date: `${o.year}-${o.month}-${o.day}`, min: +o.hour * 60 + +o.minute, dow: o.weekday }; } };
global.window = { QT };
eval(fs.readFileSync(path.join(__dirname, "..", "src", "ictengine.js"), "utf8"));
eval(fs.readFileSync(path.join(__dirname, "..", "src", "rbfib.js"), "utf8"));

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
const GROUP = (s) => (INDEX.includes(s) ? "Индексы (NQ/ES)" : "Акции и ETF");
const asT = (s, T) => { const v = s.v && s.v[T]; if (!v || v.tgt == null || !v.done) return null; return { ...s, res: v.res, exitT: v.exitT, state: v.how }; };
const stat = (r) => {
  if (r.length < 8) return null;
  const n = r.length, m = r.reduce((a, x) => a + x, 0) / n, sd = Math.sqrt(r.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1));
  let eq = 0, pk = 0, dd = 0; for (const x of r) { eq += x; pk = Math.max(pk, eq); dd = Math.min(dd, eq - pk); }
  const half = Math.floor(n / 2), avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  return { n, win: (r.filter((x) => x > 0).length / n) * 100, avgR: m, t: sd ? m / (sd / Math.sqrt(n)) : 0, sumR: eq, maxDD: dd, first: avg(r.slice(0, half)), second: avg(r.slice(half)) };
};

(async () => {
  const all = { fib: [], nofib: [], ce: [] }, armed = { fib: 0, nofib: 0, ce: 0 };
  let from = Infinity, to = 0;
  for (const sym of [...INDEX, ...STOCKS]) {
    process.stdout.write(`${sym} … `);
    const k15 = await klines(sym, "15m"), k5 = await klines(sym, "5m");
    if (k5.length < 3000) { console.log("мало истории"); continue; }
    from = Math.min(from, k5[0][0]); to = Math.max(to, k5[k5.length - 1][0]);
    const base = { cost: INDEX.includes(sym) ? 0.00004 : 0.0002, rth: !INDEX.includes(sym) };
    for (const [key, opts] of [["fib", base], ["nofib", { ...base, fibLo: 0, fibHi: 1, impATR: 0 }], ["ce", { ...base, entryAt: "ce" }]]) {
      const { sigs } = QT.rbfibRun(k15, k5, true, opts);
      armed[key] += sigs.length;
      for (const s of sigs) { s.sym = sym; s.group = GROUP(sym); all[key].push(s); }
    }
    console.log(`${all.fib.filter((s) => s.sym === sym).length} ордеров (с фибой)`);
  }

  const report = { period: [new Date(from).toISOString().slice(0, 10), new Date(to).toISOString().slice(0, 10)], ordersPlaced: armed, rows: [] };
  const row = (group, name, list, T) => {
    const st = stat(list.map((s) => s.res));
    if (st) report.rows.push({ group, name, T, ...st });
  };
  for (const group of ["Индексы (NQ/ES)", "Акции и ETF"]) {
    for (const key of ["fib", "nofib", "ce"]) {
      const sigs = all[key].filter((s) => s.group === group);
      const label = { fib: "с фибой OTE", nofib: "без фибы", ce: "с фибой, вход в середину RB (CE)" }[key];
      for (const T of [5, 3, 2, "pool"]) {
        const tr = (filt) => sigs.filter(filt).map((s) => asT(s, T)).filter(Boolean).sort((a, b) => a.fillT - b.fillT);
        row(group, `${label} · все исполненные`, tr(() => true), T);
        row(group, `${label} · по тренду`, tr((s) => s.trend), T);
        // the full bot: trend + daily rules, applied per instrument (each its own account)
        const bot = [...new Set(sigs.map((s) => s.sym))].flatMap((sym) => QT.rbfibRisk(tr((s) => s.sym === sym), { trend: true }));
        row(group, `${label} · БОТ ПО ТЗ (тренд + ≤3 в день + стоп после 2 убытков)`, bot.sort((a, b) => a.fillT - b.fillT), T);
        if (key === "fib" && T === 5) for (const ck of ["sweep", "pda", "open"]) row(group, `с фибой · по тренду · контекст ${{ sweep: "свип ликвидности", pda: "OB/FVG 15m", open: "открытие 00:00/10:00" }[ck]}`, tr((s) => s.trend && s.ctxKind === ck), T);
      }
    }
  }
  // per instrument, the bot as specified (5R)
  report.perInstrument = Object.fromEntries([...INDEX, ...STOCKS].map((sym) => {
    const tr = all.fib.filter((s) => s.sym === sym).map((s) => asT(s, 5)).filter(Boolean).sort((a, b) => a.fillT - b.fillT);
    const st = stat(QT.rbfibRisk(tr, { trend: true }).map((s) => s.res));
    return [sym, st ? { n: st.n, avgR: +st.avgR.toFixed(2), win: Math.round(st.win) } : null];
  }));
  fs.writeFileSync(path.join(OUT, "step4_rbfib.json"), JSON.stringify(report, null, 1));

  const f = (x, d = 2) => (x == null ? "—" : (x >= 0 ? "+" : "") + x.toFixed(d));
  console.log(`\nПериод ${report.period.join(" → ")} · ордеров выставлено: с фибой ${armed.fib}, без фибы ${armed.nofib}, CE ${armed.ce}`);
  let g0 = null;
  for (const r of report.rows) {
    if (r.group !== g0) { console.log(`\n================ ${r.group}`); g0 = r.group; }
    console.log(`  ${String(r.T === "pool" ? "пул" : r.T + "R").padEnd(4)} ${r.name.padEnd(70)} n=${String(r.n).padStart(5)} win ${r.win.toFixed(0).padStart(2)}%  ${f(r.avgR)}R  t ${f(r.t, 1)}  сумма ${f(r.sumR, 0)}R  DD ${r.maxDD.toFixed(0)}R  половины ${f(r.first)}/${f(r.second)}`);
  }
  console.log("\n================ Бот по ТЗ (5R) по инструментам: средний R / сделок / win%");
  console.log("  " + Object.entries(report.perInstrument).map(([s, v]) => `${s} ${v ? `${f(v.avgR)}/${v.n}/${v.win}%` : "—"}`).join("  "));
})();
