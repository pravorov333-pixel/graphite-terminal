// Step 5 — the rejection-block model in the order the video teaches it (393ticks, "Precise Rejection Block Entry
// Model"): the leg and its Fibonacci first, then a 5m rejection block inside the pullback — wick into the OTE zone,
// start of the block in discount, liquidity / PDA context, confirming close — limit at the start of the block for
// 3 candles, stop beyond the whole wick, 5R with break-even once the internal high is taken. Exactly as
// QT.rbvidRun runs in the terminal (src/rbfib.js). Exits compared side by side: 2R / 3R / 5R / the leg's high ×
// break-even never / at +1R / at the internal high; zone "OTE wick" vs "just discount"; 10:00–12:00 NY only.
// Same data and costs as steps 3–4 (QQQ / SPY = NQ / ES with CME costs; 10 stocks / ETFs with stock costs, US hours).
//   node research/step5_rb_video.js
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
const VT = [5, 3, 2, "leg"], VB = ["ih", "1R", "none"], BE_RU = { ih: "БУ после внутр. хая", "1R": "БУ после +1R", none: "без БУ" };
const asV = (s, k) => { const v = s.v && s.v[k]; if (!v || v.tgt == null || !v.done) return null; return { ...s, res: v.res, exitT: v.exitT, state: v.how }; };
const stat = (r) => {
  if (r.length < 8) return null;
  const n = r.length, m = r.reduce((a, x) => a + x, 0) / n, sd = Math.sqrt(r.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1));
  let eq = 0, pk = 0, dd = 0; for (const x of r) { eq += x; pk = Math.max(pk, eq); dd = Math.min(dd, eq - pk); }
  const half = Math.floor(n / 2), avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  return { n, win: (r.filter((x) => x > 0.05).length / n) * 100, avgR: m, t: sd ? m / (sd / Math.sqrt(n)) : 0, sumR: eq, maxDD: dd, first: avg(r.slice(0, half)), second: avg(r.slice(half)) };
};

(async () => {
  const all = { ote: [], disc: [] };
  let from = Infinity, to = 0;
  for (const sym of [...INDEX, ...STOCKS]) {
    process.stdout.write(`${sym} … `);
    const k15 = await klines(sym, "15m"), k5 = await klines(sym, "5m");
    if (k5.length < 3000) { console.log("мало истории"); continue; }
    from = Math.min(from, k5[0][0]); to = Math.max(to, k5[k5.length - 1][0]);
    const base = { cost: INDEX.includes(sym) ? 0.00004 : 0.0002, rth: !INDEX.includes(sym) };
    for (const zone of ["ote", "disc"]) {
      const { sigs } = QT.rbvidRun(k15, k5, true, { ...base, zone });
      for (const s of sigs) { s.sym = sym; s.group = GROUP(sym); all[zone].push(s); }
    }
    console.log(`${all.ote.filter((s) => s.sym === sym).length} ордеров (OTE)`);
  }

  const report = { period: [new Date(from).toISOString().slice(0, 10), new Date(to).toISOString().slice(0, 10)], rows: [] };
  const row = (group, name, list) => { const st = stat(list.map((s) => s.res)); if (st) report.rows.push({ group, name, ...st }); };
  const bot = (list) => [...new Set(list.map((s) => s.sym))].flatMap((sym) => QT.rbfibRisk(list.filter((s) => s.sym === sym), { trend: true })).sort((a, b) => a.fillT - b.fillT);
  for (const group of ["Индексы (NQ/ES)", "Акции и ETF"]) {
    const ote = all.ote.filter((s) => s.group === group), disc = all.disc.filter((s) => s.group === group);
    const pick = (list, k, f = () => true) => list.filter(f).map((s) => asV(s, k)).filter(Boolean).sort((a, b) => a.fillT - b.fillT);
    const K = "5|ih";
    row(group, "по видео (OTE, 5R, БУ после внутр. хая) · все исполненные", pick(ote, K));
    row(group, "по видео · по тренду", pick(ote, K, (s) => s.trend));
    row(group, "по видео · БОТ (тренд + ≤3 в день + стоп после 2 убытков)", bot(pick(ote, K)));
    row(group, "по видео · БОТ · только 10:00–12:00 NY", bot(pick(ote, K, (s) => s.min >= 600 && s.min < 720)));
    for (const ck of ["sweep", "pda", "open"]) row(group, `по видео · по тренду · контекст ${{ sweep: "свип ликвидности", pda: "OB/FVG 15m", open: "открытие 00:00/10:00" }[ck]}`, pick(ote, K, (s) => s.trend && s.ctxKind === ck));
    for (const T of VT) for (const be of VB) {
      if (T === 5 && be === "ih") continue;
      row(group, `БОТ · цель ${T === "leg" ? "хай волны" : T + "R"} · ${BE_RU[be]}`, bot(pick(ote, `${T}|${be}`)));
    }
    row(group, "БОТ · зона «просто дисконт ≥ 0.5» вместо OTE (5R, БУ внутр. хай)", bot(pick(disc, K)));
    row(group, "БОТ · зона «просто дисконт» · 3R без БУ", bot(pick(disc, "3|none")));
  }
  report.perInstrument = Object.fromEntries([...INDEX, ...STOCKS].map((sym) => {
    const st = stat(QT.rbfibRisk(all.ote.filter((s) => s.sym === sym).map((s) => asV(s, "5|ih")).filter(Boolean).sort((a, b) => a.fillT - b.fillT), { trend: true }).map((s) => s.res));
    return [sym, st ? { n: st.n, avgR: +st.avgR.toFixed(2), win: Math.round(st.win) } : null];
  }));
  fs.writeFileSync(path.join(OUT, "step5_rb_video.json"), JSON.stringify(report, null, 1));

  const f = (x, d = 2) => (x == null ? "—" : (x >= 0 ? "+" : "") + x.toFixed(d));
  console.log(`\nПериод ${report.period.join(" → ")}`);
  let g0 = null;
  for (const r of report.rows) {
    if (r.group !== g0) { console.log(`\n================ ${r.group}`); g0 = r.group; }
    console.log(`  ${r.name.padEnd(70)} n=${String(r.n).padStart(5)} win ${r.win.toFixed(0).padStart(2)}%  ${f(r.avgR)}R  t ${f(r.t, 1)}  сумма ${f(r.sumR, 0)}R  DD ${r.maxDD.toFixed(0)}R  половины ${f(r.first)}/${f(r.second)}`);
  }
  console.log("\n================ Бот по видео по инструментам: средний R / сделок / win%");
  console.log("  " + Object.entries(report.perInstrument).map(([s, v]) => `${s} ${v ? `${f(v.avgR)}/${v.n}/${v.win}%` : "—"}`).join("  "));
})();
