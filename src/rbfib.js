(() => {
  const QT = window.QT;
  // ============================================================ RB + Fibonacci confluence (OTE) — strategy module
  // One implementation for the terminal (SETUP / BOT) and for research/step4_rbfib.js. Rules, all fixed in advance:
  //  1. Rejection block on 5m: a long wick (≥ 50% of the candle and ≥ 0.5×ATR14 of 5m) confirmed by a close the same way
  //     (long: lower wick + close > open; short: upper wick + close < open). Wicks without that close are ignored.
  //  2. Context, at least one, on the RB candle or the two before it:
  //     a liquidity sweep (the engine's pools: equal highs/lows, swings, session / day / week highs and lows), or
  //     the wick trading into a 15m order block / FVG of the same direction, or through the 00:00 / 10:00 NY open.
  //  3. Fibonacci on the impulse: from the RB wick (swing low for longs) to the highest high since (re-anchored on every
  //     new extreme). The impulse counts once it reaches 2×ATR. The order exists only while the RB's open lies in the
  //     OTE band 0.62–0.79 of that impulse — so a new extreme moves the grid and can cancel / re-arm the order.
  //  4. Entry: buy / sell limit at the RB's open (the start of the block). Stop beyond the wick + 0.1×ATR.
  //     Target 5R (2R / 3R / nearest liquidity pool ≥ 2R are kept for research). Flat by 16:55 NY (before the CME
  //     break), at most 8 h in the trade; no new fills 16:45–18:00 NY, unfilled orders pulled at 16:55. The setup
  //     lives 4 h after the RB candle and dies if the stop trades before the fill.
  //  5. Risk (rbfibRisk): ≤ 3 entries per CME day, stop for the day after 2 losses in a row, one position per symbol.
  //  Trend (15m close vs SMA50, like SETUP) is recorded per signal; whether it filters is a parameter.
  const P0 = { wickPct: 0.5, wickATR: 0.5, impATR: 2.0, fibLo: 0.62, fibHi: 0.79, stopBuf: 0.1, T: 5, wait: 48, hold: 96, ctxBars: 3,
    maxDay: 3, maxLossStreak: 2, cost: 0.00004, trend: true, rth: false, entryAt: "open" };
  QT.RBF_P = P0;
  const TS = [2, 3, 5, "pool"];

  QT.rbfibRun = (k15, k5, proxy, opts = {}) => {
    const P = { ...P0, ...opts };
    const n = k5.length, t5 = k5.map((k) => k[0]), o = k5.map((k) => +k[1]), h = k5.map((k) => +k[2]), l = k5.map((k) => +k[3]), c = k5.map((k) => +k[4]);
    const atr5 = new Array(n).fill(null);
    for (let i = 1, a = 0; i < n; i++) { const tr = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])); a = i <= 14 ? a + tr / 14 : a + (tr - a) / 14; if (i >= 14) atr5[i] = a; }
    const t15 = k15.map((k) => k[0]), c15 = k15.map((k) => +k[4]);
    const trendAt = (t) => {                      // last 15m bar closed by t: close vs SMA50
      let lo = 0, hi = t15.length - 1, i = -1;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (t15[m] + 15 * 60e3 <= t) { i = m; lo = m + 1; } else hi = m - 1; }
      if (i < 50) return null;
      let s = 0; for (let q = i - 49; q <= i; q++) s += c15[q];
      return c15[i] > s / 50;
    };
    const out = [], live = [], recent = [];

    const finishVariant = (cd, v, how, px, k) => { const d = cd.bull ? 1 : -1; v.done = true; v.how = how; v.exitT = t5[k]; v.exitPx = px; v.res = ((px - cd.entry) * d) / cd.R - (P.cost * cd.entry) / cd.R; };
    const syncPrimary = (cd) => {
      const v = cd.v[P.T];
      if (!v) return;
      if (v.done) Object.assign(cd, { state: v.how, res: v.res, exitT: v.exitT, exitPx: v.exitPx, target: v.tgt, evT: v.exitT });
      else { cd.state = "open"; cd.target = v.tgt; cd.res = ((c[cd.lastJ] - cd.entry) * (cd.bull ? 1 : -1)) / cd.R; cd.lastPx = c[cd.lastJ]; }
    };

    const E = QT.ictRun(k15, k5, proxy, opts.trace || null, (x) => {
      const { j, e, zones, pools, opens, swept } = x;
      recent.push({ j, swept }); while (recent.length && recent[0].j <= j - P.ctxBars) recent.shift();
      const flatTime = P.rth ? e.min >= 955 || e.min < 570 : e.min >= 1015 && e.min < 1080, noFill = (e.min >= 1005 && e.min < 1080) || (P.rth && !(e.min >= 570 && e.min < 955));

      // ---- advance every live candidate with bar j
      for (const cd of live) {
        const d = cd.bull ? 1 : -1;
        cd.lastJ = j;
        if (cd.state === "watch" || cd.state === "limit") {
          // no resting orders across the CME close / weekend: anything unfilled at 16:55 NY is pulled
          if (!P.rth && flatTime) { cd.state = cd.armedOnce ? "expired" : "dead"; cd.exitT = cd.evT = t5[j]; continue; }
          if (cd.state === "limit" && !noFill && (d > 0 ? l[j] <= cd.entry : h[j] >= cd.entry)) {
            // filled at the RB open; the fill bar may run on to the stop
            cd.fillJ = j; cd.fillT = t5[j]; cd.fib = cd.fNow; cd.evT = t5[j];
            const R = cd.R, poolPx = pools.filter((p) => p.kind === (d > 0 ? "BSL" : "SSL") && (p.price - cd.entry) * d >= 2 * R)
              .map((p) => p.price).sort((a, b) => (a - b) * d)[0];
            cd.v = {};
            for (const T of TS) cd.v[T] = { tgt: T === "pool" ? poolPx ?? null : cd.entry + d * T * R, done: false };
            if (d > 0 ? l[j] <= cd.stop : h[j] >= cd.stop) for (const T of TS) finishVariant(cd, cd.v[T], "stop", cd.stop, j);
            syncPrimary(cd);
            continue;
          }
          if (d > 0 ? l[j] <= cd.stop : h[j] >= cd.stop) { cd.state = "cancel"; cd.exitT = cd.evT = t5[j]; continue; }
          if (j - cd.j0 >= P.wait) { cd.state = cd.state === "limit" || cd.armedOnce ? "expired" : "dead"; cd.exitT = cd.evT = t5[j]; continue; }
          // re-anchor the grid on a new extreme, then decide whether the order exists for the next bar
          cd.ext = d > 0 ? Math.max(cd.ext, h[j]) : Math.min(cd.ext, l[j]);
          const imp = Math.abs(cd.ext - cd.anchor), f = imp > 0 ? Math.abs(cd.ext - cd.entry) / imp : 0;
          cd.fNow = f; cd.fibExt = cd.ext;
          const armed = imp >= P.impATR * cd.atr && f >= P.fibLo && f <= P.fibHi;
          if (armed && !cd.armedOnce) { cd.armedOnce = true; cd.placeT = t5[j]; out.push(cd); }
          const st = armed ? "limit" : "watch";
          if (st !== cd.state) cd.evT = t5[j];             // order placed / withdrawn (the grid moved) at this bar's close
          cd.state = st;
        } else if (cd.state === "open") {
          for (const T of TS) {
            const v = cd.v[T]; if (v.done) continue;
            if (d > 0 ? l[j] <= cd.stop : h[j] >= cd.stop) finishVariant(cd, v, "stop", cd.stop, j);
            else if (v.tgt != null && (d > 0 ? h[j] >= v.tgt : l[j] <= v.tgt)) finishVariant(cd, v, "target", v.tgt, j);
            else if (flatTime || j - cd.fillJ >= P.hold) finishVariant(cd, v, "time", c[j], j);
          }
          syncPrimary(cd);
        }
      }
      for (let i = live.length - 1; i >= 0; i--) if (!["watch", "limit", "open"].includes(live[i].state)) live.splice(i, 1);

      // ---- a new rejection block on bar j
      const A5 = atr5[j]; if (A5 == null) return;
      const rng = h[j] - l[j]; if (!(rng > 0)) return;
      const bodyTop = Math.max(o[j], c[j]), bodyBot = Math.min(o[j], c[j]);
      for (const bull of [true, false]) {
        const wick = bull ? bodyBot - l[j] : h[j] - bodyTop;
        if (!(bull ? c[j] > o[j] : c[j] < o[j]) || wick < P.wickPct * rng || wick < P.wickATR * A5) continue;
        const ext = bull ? l[j] : h[j];
        // context: liquidity swept on this bar or the two before, a same-way 15m OB / FVG under the wick, a key open in it
        const sw = recent.flatMap((r) => r.swept).filter((p) => p.kind === (bull ? "SSL" : "BSL"));
        const wLo = bull ? l[j] : bodyTop, wHi = bull ? bodyBot : h[j];
        const pda = zones.find((z) => (z.kind === "OB" || z.kind === "FVG") && z.bull === bull && z.created <= x.t && (() => {
          const zt = z.kind === "FVG" ? z.top : Math.max(z.wickExt, z.bodyExt), zb = z.kind === "FVG" ? z.bottom : Math.min(z.wickExt, z.bodyExt);
          return wLo <= zt && wHi >= zb;
        })());
        const ko = ["00:00", "10:00"].find((nm) => opens[nm] != null && opens[nm] >= wLo && opens[nm] <= wHi);
        const ctx = sw.length ? `свип ${sw[0].tag}` : pda ? `${pda.kind} 15m` : ko ? `открытие ${ko}` : null;
        if (!ctx) continue;
        // entry: the RB's open (the spec) or, as an option, the middle of the wick zone (CE)
        const d = bull ? 1 : -1, entry = P.entryAt === "ce" ? (ext + o[j]) / 2 : o[j], stop = ext - d * P.stopBuf * A5, R = Math.abs(entry - stop);
        if (!(R > 0)) continue;
        live.push({ setup: "RBF", bull, t: t5[j], j0: j, lastJ: j, entry, stop, R, target: entry + d * P.T * R, anchor: ext, ext: bull ? h[j] : l[j], atr: A5, ctx,
          ctxKind: sw.length ? "sweep" : pda ? "pda" : "open", trend: trendAt(t5[j] + 5 * 60e3) === bull, state: "watch", armedOnce: false });
      }
    });
    // what's still waiting for an impulse (not an order yet) — for the live panel
    const watching = live.filter((cd) => cd.state === "watch" && !cd.armedOnce);
    return { sigs: out, watching, E };
  };

  // ---- account rules over signals from one or more symbols (each needs .sym): marks .risk and returns the taken ones
  const cmeDay = (t) => QT.et(t + 6 * 3600e3).date;          // CME trading day: 18:00 NY → next calendar day
  QT.cmeDay = cmeDay;
  QT.rbfibRisk = (sigs, opts = {}) => {
    const P = { ...P0, ...opts };
    const filled = sigs.filter((s) => s.fillT != null && (!P.trend || s.trend)).sort((a, b) => a.fillT - b.fillT);
    const taken = [];
    for (const s of filled) {
      const day = cmeDay(s.fillT), today = taken.filter((x) => cmeDay(x.fillT) === day);
      const closedBefore = today.filter((x) => x.exitT != null && x.exitT <= s.fillT && x.state !== "open").sort((a, b) => a.exitT - b.exitT);
      let streak = 0; for (let i = closedBefore.length - 1; i >= 0 && closedBefore[i].res < 0; i--) streak++;
      const busy = taken.some((x) => x.sym === s.sym && (x.state === "open" || x.exitT > s.fillT));
      s.risk = today.length >= P.maxDay ? `лимит ${P.maxDay} сделки в день` : streak >= P.maxLossStreak ? `${P.maxLossStreak} стопа подряд — стоп на день` : busy ? "уже в позиции" : "ok";
      if (s.risk === "ok") taken.push(s);
    }
    return taken;
  };
})();
