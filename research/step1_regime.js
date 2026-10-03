// Step 1 — does the macro regime (TOPDOWN's factors) improve a simple index strategy?
// Daily data 2006→today: Nasdaq-100 / S&P 500 (Yahoo), FRED macro series, VIX, VIX3M, DXY.
// No look-ahead: every macro series is used only after its publication lag. Thresholds are TOPDOWN's,
// fixed in advance (not optimised). Split: 2008–2016 (where the rules come from) vs 2017–now (unseen).
//   node research/step1_regime.js            → research/results/step1_*.json + printed report
const fs = require("fs");
const path = require("path");
const H = { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36" } };
const DAY = 864e5;
const OUT = path.join(__dirname, "results");
fs.mkdirSync(OUT, { recursive: true });

const fred = async (id) => {
  const t = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=2005-01-01`, H).then((r) => r.text());
  return t.trim().split("\n").slice(1).map((l) => l.split(",")).filter(([, v]) => v && v !== "." && isFinite(+v)).map(([d, v]) => ({ t: Date.parse(d + "T00:00:00Z"), v: +v }));
};
const yahoo = async (sym) => {
  const p1 = Math.floor(Date.parse("2006-01-01") / 1000), p2 = Math.floor(Date.now() / 1000);
  const j = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${p1}&period2=${p2}&interval=1d`, H).then((r) => r.json());
  const r = j.chart.result[0], q = r.indicators.quote[0], off = (r.meta.gmtoffset || 0) * 1000;
  return r.timestamp.map((t, i) => ({ day: new Date(t * 1000 + off).toISOString().slice(0, 10), c: q.close[i] })).filter((b) => b.c != null);
};
// value of a dated series as known on `t` given a publication lag
const asOf = (s, t, lagDays = 0) => {
  const lim = t - lagDays * DAY; let lo = 0, hi = s.length - 1, r = null;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (s[m].t <= lim) { r = s[m]; lo = m + 1; } else hi = m - 1; }
  return r;
};

(async () => {
  const [walcl, tga, rrp, d10, d2, dff, real, baa, nfci, pce] = await Promise.all(
    ["WALCL", "WTREGEN", "RRPONTSYD", "DGS10", "DGS2", "DFF", "DFII10", "BAA10Y", "NFCI", "PCEPILFE"].map(fred));
  const [vixS, vix3S, dxyS] = await Promise.all(["^VIX", "^VIX3M", "DX-Y.NYB"].map(yahoo));
  const mapOf = (s) => new Map(s.map((b) => [b.day, b.c]));
  const vixM = mapOf(vixS), vix3M = mapOf(vix3S), dxyM = mapOf(dxyS);
  // net liquidity ($B) at each weekly Fed date; WALCL / WTREGEN in $M, RRPONTSYD in $B
  const nl = walcl.map((w) => { const g = asOf(tga, w.t), r = asOf(rrp, w.t); return g && r ? { t: w.t, v: w.v / 1000 - g.v / 1000 - r.v } : null; }).filter(Boolean);
  const pceAvail = pce.map((x) => ({ t: x.t + 60 * DAY, v: x.v, obs: x.t }));   // a month's PCE is public ~2 months after its first day

  const report = {};
  for (const [IX, sym] of [["NDX", "^NDX"], ["SPX", "^GSPC"]]) {
    const px = await yahoo(sym);
    const days = px.map((b) => b.day), close = px.map((b) => b.c), n = px.length;
    const T = days.map((d) => Date.parse(d + "T00:00:00Z"));
    const sma = (i, len) => (i + 1 >= len ? close.slice(i - len + 1, i + 1).reduce((a, x) => a + x, 0) / len : null);

    // ---- the ten macro factors, each −1 / 0 / +1, exactly TOPDOWN's thresholds (credit uses BAA−10Y, see notes)
    const series = (map) => days.map((d) => map.get(d) ?? null);
    const vix = series(vixM), vix3 = series(vix3M), dxy = series(dxyM);
    const back = (arr, i, k) => (i - k >= 0 ? arr[i - k] : null);
    const F = days.map((d, i) => {
      const t = T[i], f = {};
      const a = asOf(nl, t, 2), b = asOf(nl, t - 28 * DAY, 2);
      if (a && b) { const ch = a.v - b.v; f.liq = ch > 25 ? 1 : ch < -25 ? -1 : 0; }
      const y = asOf(d10, t, 1), y5 = asOf(d10, t - 7 * DAY, 1);
      if (y && y5) { const bp = (y.v - y5.v) * 100; f.y10 = bp <= -5 ? 1 : bp >= 5 ? -1 : 0; }
      const dx = dxy[i], dx5 = back(dxy, i, 5);
      if (dx && dx5) { const c = (dx / dx5 - 1) * 100; f.dxy = c <= -0.3 ? 1 : c >= 0.3 ? -1 : 0; }
      const v = vix[i], v5 = back(vix, i, 5);
      if (v && v5) { const c = (v / v5 - 1) * 100; f.vix = v < 20 && c <= 0 ? 1 : v > 25 || c >= 20 ? -1 : 0; }
      const two = asOf(d2, t, 1), ff = asOf(dff, t, 1);
      if (two && ff) { const sp = two.v - ff.v; f.fed = sp < -0.25 ? 1 : sp > 0.25 ? -1 : 0; }
      const r0 = asOf(real, t, 1), r5 = asOf(real, t - 7 * DAY, 1);
      if (r0 && r5) { const bp = (r0.v - r5.v) * 100; f.real = bp <= -5 ? 1 : bp >= 5 ? -1 : 0; }
      const pa = pceAvail.filter((x) => x.t <= t);
      if (pa.length > 13) { const L = pa.length - 1, yoy = (pa[L].v / pa[L - 12].v - 1) * 100, m3 = (Math.pow(pa[L].v / pa[L - 3].v, 4) - 1) * 100; f.infl = m3 < yoy - 0.3 && m3 < 3 ? 1 : m3 > yoy + 0.3 ? -1 : 0; }
      const c0 = asOf(baa, t, 1), c20 = asOf(baa, t - 28 * DAY, 1);
      if (c0 && c20) { const ch = c0.v - c20.v; f.credit = ch <= -0.10 ? 1 : ch >= 0.15 ? -1 : 0; }
      if (v && vix3[i]) { const ratio = v / vix3[i]; f.vixts = ratio < 0.9 ? 1 : ratio > 1 ? -1 : 0; }
      const nf = asOf(nfci, t, 7), nf4 = asOf(nfci, t - 28 * DAY, 7);
      if (nf && nf4) { const ch = nf.v - nf4.v; f.nfci = nf.v < 0 && ch <= 0 ? 1 : nf.v > 0 || ch > 0.15 ? -1 : 0; }
      f.score = Object.values(f).reduce((a, x) => a + x, 0); f.k = Object.keys(f).length - 1;
      return f;
    });

    // ---- strategies: signal at close of day i, position held over day i+1 (close to close), 2 bp per unit of turnover
    const COST = 0.0002;
    const start = days.findIndex((d) => d >= "2008-01-02");
    const trendOn = (i) => close[i] > sma(i, 50);
    const S = {
      "Buy & hold": () => 1,
      "Тренд (цена > SMA50)": (i) => (trendOn(i) ? 1 : 0),
      "Только макро (счёт ≥ 0)": (i) => (F[i].score >= 0 ? 1 : 0),
      "Тренд + макро-фильтр (счёт ≥ 0)": (i) => (trendOn(i) && F[i].score >= 0 ? 1 : 0),
      "Тренд + размер по макро": (i) => (!trendOn(i) ? 0 : F[i].score >= 2 ? 1 : F[i].score <= -2 ? 0 : 0.5),
    };
    const run = (fn, from, to) => {
      const eq = [1]; let pos = 0, turn = 0, days_in = 0, nDays = 0;
      for (let i = from; i < to - 1; i++) {
        const want = fn(i), r = close[i + 1] / close[i] - 1;
        turn += Math.abs(want - pos); const cost = Math.abs(want - pos) * COST; pos = want;
        eq.push(eq[eq.length - 1] * (1 + pos * r - cost)); days_in += pos > 0 ? 1 : 0; nDays++;
      }
      const rets = eq.slice(1).map((x, k) => x / eq[k] - 1), yrs = nDays / 252;
      const mean = rets.reduce((a, x) => a + x, 0) / rets.length, sd = Math.sqrt(rets.reduce((a, x) => a + (x - mean) ** 2, 0) / rets.length);
      let peak = 1, mdd = 0; for (const x of eq) { peak = Math.max(peak, x); mdd = Math.min(mdd, x / peak - 1); }
      return { cagr: (Math.pow(eq[eq.length - 1], 1 / yrs) - 1) * 100, vol: sd * Math.sqrt(252) * 100, sharpe: sd ? (mean / sd) * Math.sqrt(252) : 0, mdd: mdd * 100, exposure: (days_in / nDays) * 100, switchesPerYear: turn / yrs, total: (eq[eq.length - 1] - 1) * 100 };
    };
    const split = days.findIndex((d) => d >= "2017-01-01");
    const periods = { "2008–2016 (правила)": [start, split], "2017–сейчас (проверка)": [split, n], "Всё время": [start, n] };
    const strat = {};
    for (const [name, fn] of Object.entries(S)) { strat[name] = {}; for (const [pn, [a, b]] of Object.entries(periods)) strat[name][pn] = run(fn, a, b); }

    // ---- does the score predict the next 20 trading days? (non-overlapping samples every 20 days → honest t-stats)
    const fwd = (i, h) => (i + h < n ? (close[i + h] / close[i] - 1) * 100 : null);
    const bucket = (s) => (s <= -3 ? "≤ −3" : s <= -1 ? "−2…−1" : s === 0 ? "0" : s <= 2 ? "+1…+2" : "≥ +3");
    const stat = (arr) => { const m = arr.reduce((a, x) => a + x, 0) / arr.length, sd = Math.sqrt(arr.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, arr.length - 1)); return { n: arr.length, mean: m, up: arr.filter((x) => x > 0).length / arr.length * 100, t: sd ? m / (sd / Math.sqrt(arr.length)) : 0 }; };
    const buckets = {}, factorTest = {};
    const base = [];
    for (let i = start; i < n - 20; i += 20) {
      const r = fwd(i, 20); if (r == null) continue; base.push(r);
      (buckets[bucket(F[i].score)] ||= []).push(r);
      for (const k of ["liq", "y10", "dxy", "vix", "fed", "real", "infl", "credit", "vixts", "nfci"]) {
        if (F[i][k] == null) continue;
        ((factorTest[k] ||= { "+1": [], "0": [], "−1": [] })[F[i][k] > 0 ? "+1" : F[i][k] < 0 ? "−1" : "0"]).push(r);
      }
    }
    const bOut = Object.fromEntries(["≤ −3", "−2…−1", "0", "+1…+2", "≥ +3"].filter((k) => buckets[k]).map((k) => [k, stat(buckets[k])]));
    const fOut = Object.fromEntries(Object.entries(factorTest).map(([k, g]) => {
      const p = stat(g["+1"].length ? g["+1"] : [0]), m = stat(g["−1"].length ? g["−1"] : [0]);
      // Welch t for the difference of means (+1 vs −1)
      const se = Math.sqrt((p.n > 1 ? (g["+1"].reduce((a, x) => a + (x - p.mean) ** 2, 0) / (p.n - 1)) / p.n : 0) + (m.n > 1 ? (g["−1"].reduce((a, x) => a + (x - m.mean) ** 2, 0) / (m.n - 1)) / m.n : 0));
      return [k, { plus: p, minus: m, diff: p.mean - m.mean, t: se ? (p.mean - m.mean) / se : 0 }];
    }));
    report[IX] = { from: days[start], to: days[n - 1], strategies: strat, scoreBuckets: bOut, base: stat(base), factors: fOut, today: F[n - 1] };
    // daily macro score (known at that day's close) for step 2's regime filter
    fs.writeFileSync(path.join(OUT, `step1_scores_${IX}.json`), JSON.stringify(Object.fromEntries(days.map((d, i) => [d, F[i].score]))));
  }
  fs.writeFileSync(path.join(OUT, "step1_regime.json"), JSON.stringify(report, null, 1));

  // ---- printed summary
  const f1 = (x) => (x >= 0 ? " " : "") + x.toFixed(1);
  for (const [IX, R] of Object.entries(report)) {
    console.log(`\n================ ${IX}  ${R.from} → ${R.to}`);
    for (const [name, per] of Object.entries(R.strategies)) {
      console.log(name);
      for (const [pn, m] of Object.entries(per)) console.log(`   ${pn.padEnd(22)} CAGR ${f1(m.cagr)}%  vol ${m.vol.toFixed(1)}%  Sharpe ${m.sharpe.toFixed(2)}  maxDD ${f1(m.mdd)}%  в рынке ${m.exposure.toFixed(0)}%  смен/год ${m.switchesPerYear.toFixed(1)}`);
    }
    console.log(`Счёт макро → доходность следующих 20 дней (база: ${R.base.mean.toFixed(2)}%, рост ${R.base.up.toFixed(0)}%, n=${R.base.n})`);
    for (const [k, s] of Object.entries(R.scoreBuckets)) console.log(`   счёт ${k.padEnd(7)} n=${String(s.n).padStart(3)}  средн ${f1(s.mean)}%  рост ${s.up.toFixed(0)}%  t=${s.t.toFixed(2)}`);
    console.log("Факторы по отдельности: +1 против −1, доходность 20 дней");
    for (const [k, s] of Object.entries(R.factors)) console.log(`   ${k.padEnd(7)} +1: ${f1(s.plus.mean)}% (n ${s.plus.n})   −1: ${f1(s.minus.mean)}% (n ${s.minus.n})   разница ${f1(s.diff)}pp  t=${s.t.toFixed(2)}`);
    console.log("Сегодня:", JSON.stringify(R.today));
  }
})();
