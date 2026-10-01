(() => {
  const QT = window.QT, F = QT.f;
  const kvHtml = (pairs) => pairs.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("");
  const PAIR = { NQ: "ES", ES: "NQ", QQQ: "SPY", SPY: "QQQ", BTC: "ETH", ETH: "BTC", XAU: "XAG", XAG: "XAU", NVDA: "QQQ", TSLA: "QQQ", SOL: "ETH" };
  const SESS = (ms) => { const h = new Date(ms).getUTCHours(); return h < 7 ? "ASIA" : h < 12 ? "LONDON" : h < 20 ? "NEW YORK" : "LATE"; };

  // ------------------------------------------------------------ the study (pure function over OHLC arrays)
  // Outcome of every setup = a race from the trigger bar's close: +K·ATR in the setup's direction before −K·ATR, within H bars.
  // The same race from every bar gives the base rate, so EDGE is what the pattern adds over a coin flip on this market.
  function study(k, { K = 1, H = 48, minGap = 0.1, piv = 3 } = {}) {
    const n = k.length, t = k.map((r) => r[0]), o = k.map((r) => +r[1]), h = k.map((r) => +r[2]), l = k.map((r) => +r[3]), c = k.map((r) => +r[4]);
    const atr = new Array(n).fill(null);
    let a = 0;
    for (let i = 1; i < n; i++) {
      const tr = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
      a = i <= 14 ? a + tr / 14 : a + (tr - a) / 14;
      if (i >= 14) atr[i] = a;
    }
    const sma = new Array(n).fill(null);
    let s = 0;
    for (let i = 0; i < n; i++) { s += c[i]; if (i >= 50) s -= c[i - 50]; if (i >= 49) sma[i] = s / 50; }
    const race = (i, dir) => {
      if (atr[i] == null || i + 1 >= n) return null;
      const up = c[i] + K * atr[i], dn = c[i] - K * atr[i];
      for (let j = i + 1; j < Math.min(n, i + 1 + H); j++) {
        if (dir > 0) { if (l[j] <= dn) return 0; if (h[j] >= up) return 1; }
        else { if (h[j] >= up) return 0; if (l[j] <= dn) return 1; }
      }
      return null;
    };
    const acc = () => ({ n: 0, w: 0 });
    const add = (o2, r) => { if (r != null) { o2.n++; o2.w += r; } };
    const base = { 1: acc(), "-1": acc() };
    for (let i = 60; i < n - 1; i++) { add(base[1], race(i, 1)); add(base[-1], race(i, -1)); }

    const mk = () => ({ all: acc(), w: acc(), ct: acc(), sess: { ASIA: acc(), LONDON: acc(), "NEW YORK": acc(), LATE: acc() } });
    const S = { fvg: { 1: mk(), "-1": mk() }, ifvg: { 1: mk(), "-1": mk() }, sweep: { 1: mk(), "-1": mk() } };
    const rec = (bucket, dir, i, r) => {
      if (r == null) return;
      const b = bucket[dir], up = sma[i] != null && c[i] > sma[i];
      add(b.all, r); add(up === dir > 0 ? b.w : b.ct, r); add(b.sess[SESS(t[i])], r);
    };
    const fill = { n: 0, touched: 0, filled: 0 };

    // ---- fair value gaps, their first touch, invalidation and the inverse (IFVG) retest
    const zones = [];
    for (let i = 2; i < n; i++) {
      if (atr[i] == null) continue;
      if (l[i] > h[i - 2] && l[i] - h[i - 2] >= minGap * atr[i]) zones.push({ dir: 1, top: l[i], bot: h[i - 2], i });
      if (h[i] < l[i - 2] && l[i - 2] - h[i] >= minGap * atr[i]) zones.push({ dir: -1, top: l[i - 2], bot: h[i], i });
    }
    for (const z of zones) {
      z.touch = null; z.inv = null; z.full = false;
      for (let j = z.i + 1; j < n; j++) {
        const into = z.dir > 0 ? l[j] <= z.top : h[j] >= z.bot;
        if (into && z.touch == null) z.touch = j;
        if (z.dir > 0 ? l[j] <= z.bot : h[j] >= z.top) z.full = z.full || j - z.i <= H;
        if (z.dir > 0 ? c[j] < z.bot : c[j] > z.top) { z.inv = j; break; }
      }
      if (z.i + H < n) { fill.n++; if (z.touch != null && z.touch - z.i <= H) fill.touched++; if (z.full) fill.filled++; }
      if (z.touch != null) rec(S.fvg, z.dir, z.touch, race(z.touch, z.dir));
      if (z.inv != null) {   // now an inverse FVG pointing the other way: first retest from the other side
        for (let j = z.inv + 1; j < Math.min(n, z.inv + 1 + 3 * H); j++) {
          if (z.dir > 0 ? h[j] >= z.bot : l[j] <= z.top) { z.retest = j; rec(S.ifvg, -z.dir, j, race(j, -z.dir)); break; }
        }
      }
    }

    // ---- swing pivots as liquidity pools; a sweep = wick through the pool and close back inside
    const highs = [], lows = [], sweeps = [];
    for (let j = piv * 2; j < n; j++) {
      const p = j - piv;                     // pivot at p is confirmed at bar j
      let isH = true, isL = true;
      for (let q = p - piv; q <= p + piv; q++) { if (q === p) continue; if (h[q] >= h[p]) isH = false; if (l[q] <= l[p]) isL = false; }
      if (isH) highs.push({ px: h[p], i: p, live: true });
      if (isL) lows.push({ px: l[p], i: p, live: true });
      for (const sh of highs) if (sh.live && sh.i < p && h[j] > sh.px) {
        sh.live = false; sh.sweptAt = j;
        if (c[j] < sh.px && j - sh.i <= 300) { sweeps.push({ i: j, dir: -1, px: sh.px }); rec(S.sweep, -1, j, race(j, -1)); }
      }
      for (const sl of lows) if (sl.live && sl.i < p && l[j] < sl.px) {
        sl.live = false; sl.sweptAt = j;
        if (c[j] > sl.px && j - sl.i <= 300) { sweeps.push({ i: j, dir: 1, px: sl.px }); rec(S.sweep, 1, j, race(j, 1)); }
      }
    }
    return { t, o, h, l, c, atr, sma, base, S, fill, zones, highs, lows, sweeps, n, K, H };
  }
  QT.ictStudy = study;

  // ------------------------------------------------------------ SMT: one market takes the prior extreme, its pair doesn't
  const smt = (a, b, look = 20, prior = 100) => {
    const took = (k, hi) => {
      const n = k.length, r = k.slice(n - look), p = k.slice(n - look - prior, n - look);
      if (p.length < prior / 2) return null;
      return hi ? Math.max(...r.map((x) => +x[2])) > Math.max(...p.map((x) => +x[2])) : Math.min(...r.map((x) => +x[3])) < Math.min(...p.map((x) => +x[3]));
    };
    const hA = took(a, true), hB = took(b, true), lA = took(a, false), lB = took(b, false);
    return { bear: hA != null && hB != null && hA !== hB ? (hA ? "A" : "B") : null, bull: lA != null && lB != null && lA !== lB ? (lA ? "A" : "B") : null };
  };

  QT.smt = smt;

  QT.fn.ICT = {
    name: "ICT quant", desc: "ICT levels by the ICT-QPS indicator rules (RB, OB, FVG, key opens 00:00/09:30/10:00, PDH/PDL, PWH/PWL, Asia, London, AM, swings, EQH/EQL) with 20-day reaction / sweep / reversal rates vs base rate and 95% CI; plus the strict race test and SMT. Args: 5M 15M 1H 4H", sym: true, proxy: true,
    tfs: ["5m", "15m", "1h", "4h"],
    mount(ctx) {
      const b = ctx.sym, tf = QT.tfIn(ctx.args, "15m"), pair = PAIR[b];
      ctx.setTitle(`ICT quant · ${tf.toUpperCase()}`);
      ctx.el.innerHTML = `<div class="split"><div class="fix"><div class="kv"></div></div><div class="grow" style="min-height:160px"><div class="chart"></div></div><div class="fix" style="max-height:50%;overflow:auto"><div class="tbl"></div></div></div>`;
      const kv = ctx.el.querySelector(".kv"), tbl = ctx.el.querySelector(".tbl"), box = ctx.el.querySelector(".chart");
      const chart = QT.chart(box);
      const cs = chart.addCandlestickSeries(QT.candleStyle);
      let lines = [], dead = false, bars = [];
      const zov = QT.zoneOverlay(box, chart, cs, () => bars);
      const pc = (x) => (x == null ? "—" : (x * 100).toFixed(0) + "%");

      // ---- table 1: level authenticity by the indicator's own rules, judged against the base rate
      const engTable = (E) => {
        const sig = (st) => st.n >= 10 && Math.abs(st.p - E.base) > st.ci;     // fewer than 10 cases never earns a ✓
        const cell = (st) => (st.n ? `${pc(st.p)} <span class="dim">${st.n}</span>` : `<span class="dim">—</span>`);
        const row = (name, st, all) => {
          const e = all.p - E.base, ok = sig(all);
          return `<tr><td class="l hi">${name}</td><td>${all.n}</td><td class="b">${pc(all.p)}</td><td class="dim">${pc(E.base)}</td>`
            + `<td class="b ${ok ? "" : "dim"}">${all.n ? F.sgn(e, (e >= 0 ? "+" : "") + (e * 100).toFixed(1) + "pp") : "—"}</td><td class="dim">±${(all.ci * 100).toFixed(0)}${ok ? (e > 0 ? " ✓" : " ✗") : ""}</td>`
            + `<td>${cell(st.AM)}</td><td>${cell(st.PM)}</td><td>${cell(st.OTHER)}</td></tr>`;
        };
        const S = E.stats;
        const zonesRows = [["Rejection block (15m) · реакция", S.RB], ["Order block (15m) · реакция", S.OB], ["FVG (15m) · реакция", S.FVG],
          ["00:00 NY open · свип+реклейм", S.KO00], ["09:30 NY open · свип+реклейм", S.KO0930], ["10:00 NY open · свип+реклейм", S.KO1000]]
          .map(([n, st]) => row(n, st, st.all)).join("");
        const POOLS = [["PDH / PDL", "PD"], ["PWH / PWL", "PW"], ["ASIA H / L", "ASIA"], ["LDN H / L", "LDN"], ["AM H / L", "AM"], ["Свинги 15m (5/5)", "SW"], ["EQH / EQL", "EQ"]];
        const poolRows = POOLS.map(([name, k]) => {
          const sw = S[k].sweep, rv = S[k].rev, e = rv.p - E.base, ok = rv.n >= 10 && Math.abs(e) > rv.ci;
          return `<tr><td class="l hi">${name}</td><td>${cell(sw)}</td><td class="b">${cell(rv)}</td><td class="dim">${pc(E.base)}</td>`
            + `<td class="b ${ok ? "" : "dim"}">${rv.n ? F.sgn(e, (e >= 0 ? "+" : "") + (e * 100).toFixed(1) + "pp") : "—"}</td><td class="dim">±${(rv.ci * 100).toFixed(0)}${ok ? (e > 0 ? " ✓" : " ✗") : ""}</td></tr>`;
        }).join("");
        return `<div class="sec">ПОДЛИННОСТЬ УРОВНЕЙ · ПРАВИЛА ИНДИКАТОРА ICT-QPS v21 · ${P().statsDays} ДНЕЙ · ${E.nEvents} СОБЫТИЙ</div>`
          + `<table class="t"><thead><tr><th class="l">УРОВЕНЬ / ЗОНА</th><th>N</th><th>P</th><th>BASE</th><th>EDGE</th><th>95% CI</th><th>NY AM</th><th>NY PM</th><th>ДРУГОЕ</th></tr></thead><tbody>${zonesRows}</tbody></table>`
          + `<table class="t"><thead><tr><th class="l">ПУЛ ЛИКВИДНОСТИ</th><th>P(СВИП 72Ч)</th><th>P(РАЗВОРОТ)</th><th>BASE</th><th>EDGE</th><th>95% CI</th></tr></thead><tbody>${poolRows}</tbody></table>`
          + `<div class="note">P = (W+1)/(N+2), как в индикаторе. Реакция / разворот / вход по открытию = ход ≥ ${P().reactATR}×ATR(15m) в сторону уровня за ${P().reactMin} мин. BASE = вероятность такого же хода с любого 5-минутного бара. ✓ — уровень даёт преимущество больше погрешности (подлинный), ✗ — значимо хуже случайного, без значка — не отличим от шума на этой выборке (или меньше 10 случаев). P(свип) — доля пулов, которые сняли за 72 часа.</div>`;
      };
      const P = () => QT.ICTP;

      const load = async () => {
        try {
          const [k, kp, E] = await Promise.all([QT.klines(b, tf, 3000, 60000), pair ? QT.klines(pair, tf, 200, 60000).catch(() => null) : null, QT.ictEngine(b).catch((e) => { console.warn(e); return null; })]);
          if (dead) return;
          if (k.length < 300) throw new Error(`not enough ${tf} history for ${b} (${k.length} bars)`);
          const R = study(k), { n, c, atr, base, S, fill } = R, last = c[n - 1], A = atr[n - 1];
          bars = k.map((r) => ({ time: r[0] / 1000, open: +r[1], high: +r[2], low: +r[3], close: +r[4] }));
          cs.setData(bars);
          if (!lines.length) chart.timeScale().setVisibleLogicalRange({ from: n - 220, to: n + 8 });

          // ---- table 2: the strict race test (kept for comparison)
          const rate = (o2) => (o2.n ? o2.w / o2.n : null);
          const ci = (o2) => (o2.n ? 1.96 * Math.sqrt(Math.max(rate(o2) * (1 - rate(o2)), 0.01) / o2.n) : null);
          const b1 = rate(base[1]), bm = rate(base[-1]);
          const edgeCell = (o2, dir) => {
            if (!o2.n) return `<td class="dim">—</td><td class="dim">—</td>`;
            const e = rate(o2) - (dir > 0 ? b1 : bm), sig = Math.abs(e) > ci(o2);
            return `<td class="b ${sig ? "" : "dim"}">${F.sgn(e, (e >= 0 ? "+" : "") + (e * 100).toFixed(1) + "pp")}</td><td class="dim">±${(ci(o2) * 100).toFixed(1)}${sig ? " ✓" : ""}</td>`;
          };
          const sub = (o2) => (o2.n ? `${pc(rate(o2))} <span class="dim">${o2.n}</span>` : `<span class="dim">—</span>`);
          const ROWS = [["FVG bullish · first touch → long", S.fvg[1], 1], ["FVG bearish · first touch → short", S.fvg[-1], -1],
            ["IFVG bullish · retest → long", S.ifvg[1], 1], ["IFVG bearish · retest → short", S.ifvg[-1], -1],
            ["SSL sweep & reclaim → long", S.sweep[1], 1], ["BSL sweep & reject → short", S.sweep[-1], -1]];
          const sessHead = ["ASIA", "LONDON", "NEW YORK", "LATE"];
          const race = `<div class="sec">СТРОГИЙ ТЕСТ · ${tf.toUpperCase()} · +${R.K}×ATR РАНЬШЕ −${R.K}×ATR ЗА ${R.H} СВЕЧЕЙ</div><table class="t"><thead><tr><th class="l">SETUP</th><th>N</th><th>HIT</th><th>BASE</th><th>EDGE</th><th>95% CI</th><th>WITH TREND</th><th>COUNTER</th>${sessHead.map((s) => `<th>${s}</th>`).join("")}</tr></thead><tbody>`
            + ROWS.map(([name, o2, dir]) => `<tr><td class="l hi">${name}</td><td>${o2.all.n}</td><td class="b">${pc(rate(o2.all))}</td><td class="dim">${pc(dir > 0 ? b1 : bm)}</td>${edgeCell(o2.all, dir)}<td>${sub(o2.w)}</td><td>${sub(o2.ct)}</td>${sessHead.map((s) => `<td>${sub(o2.sess[s])}</td>`).join("")}</tr>`).join("")
            + `</tbody></table><div class="note">Жёстче, чем правила индикатора: засчитывается только если цена сначала прошла +${R.K}×ATR, а не −${R.K}×ATR (стоп). Сессии здесь по UTC: Азия 0–7, Лондон 7–12, Нью-Йорк 12–20. Выборка: ${n} свечей ${tf} с ${F.date(R.t[0])}.</div>`;
          tbl.innerHTML = (E ? engTable(E) : `<div class="msg">движок уровней недоступен</div>`) + race;

          // ---- chart: engine zones as boxes, pools + key opens as lines
          if (E) { lines = QT.ictLines(cs, E, lines); zov.set(tf === "4h" ? [] : E.zones); }

          let smtTxt = "—";
          if (kp && kp.length > 150) {
            const r = smt(k, kp), nm = (w) => (w === "A" ? b : pair), other = (w) => (w === "A" ? pair : b);
            smtTxt = [r.bear ? `МЕДВЕЖЬЯ: ${nm(r.bear)} обновил хай, ${other(r.bear)} нет` : "", r.bull ? `БЫЧЬЯ: ${nm(r.bull)} обновил лоу, ${other(r.bull)} нет` : ""].filter(Boolean).join(" · ") || `нет расхождения с ${pair}`;
          }
          const up = R.sma[n - 1] != null && last > R.sma[n - 1];
          const bsl = E ? E.pools.filter((p) => p.kind === "BSL").sort((x, y) => x.price - y.price)[0] : null;
          const ssl = E ? E.pools.filter((p) => p.kind === "SSL").sort((x, y) => y.price - x.price)[0] : null;
          const zb = E ? E.zones.filter((z) => z.bull).length : 0, zs = E ? E.zones.filter((z) => !z.bull).length : 0;
          kv.innerHTML = kvHtml([["ЦЕНА · ATR", `${F.px(last)} · ${F.px(A)}`], ["ТРЕНД (SMA50)", up ? "ВЫШЕ" : "НИЖЕ"],
            ["БЛИЖАЙШИЙ BSL", bsl ? `${bsl.tag} ${F.px(bsl.price)} · ${pc(bsl.pSweep)}` : "—"], ["БЛИЖАЙШИЙ SSL", ssl ? `${ssl.tag} ${F.px(ssl.price)} · ${pc(ssl.pSweep)}` : "—"],
            ["ЖИВЫЕ ЗОНЫ У ЦЕНЫ", `${zb} ▲ · ${zs} ▼`], ["BASE (1.5 ATR / 60 МИН)", E ? pc(E.base) : "—"]])
            + `<div style="grid-column:1/-1"><span>SMT ${pair ? "С " + pair : ""}</span><b>${smtTxt}</b></div>`;
          ctx.setMeta(E ? `${E.nEvents} событий за ${P().statsDays} дн · base ${pc(E.base)}` : `${n} bars`);
        } catch (e) { ctx.error(e); }
      };
      load();
      ctx.every(90000, load);
      return () => { dead = true; zov.destroy(); chart.remove(); };
    },
  };
})();
