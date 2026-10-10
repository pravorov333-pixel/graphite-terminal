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

  // ============================================================ RB in the Fibonacci discount — the order from the video
  // (393ticks, "Precise Rejection Block Entry Model", the Fib + RB workflow): the leg first, the RB inside its pullback.
  //  1. Leg: the swing of the last 4 h in the trend's direction — from its low to the highest high since (longs), at least
  //     3×ATR of 5m. The grid exists once a candle closes against the leg after its high ("wait for the first bearish
  //     close"); a new high redraws it.
  //  2. In the pullback, a 5m rejection block whose wick reaches the OTE zone (≥ 0.62 of the leg, not below its low) with
  //     its start (the body edge) in discount (≥ 0.5). The confirming close can be the RB candle or one of the next two
  //     (as long as the wick isn't broken). Context as in rbfib: liquidity swept by the wick, a same-way 15m OB / FVG,
  //     or the 00:00 / 10:00 open in the wick.
  //  3. Entry: limit at the start of the RB, live for the next 3 candles. Stop beyond the whole wick + 0.1×ATR.
  //  4. Exits kept side by side for research: targets 2R / 3R / 5R / the leg's high; break-even never, at +1R, or once
  //     the internal high (the highest high of the 6 candles before the RB) is taken. Flat by 16:55 NY, ≤ 8 h.
  //  The live default: 5R with break-even at the internal high (as in the video). Risk rules: QT.rbfibRisk.
  const PV0 = { wickPct: 0.5, wickATR: 0.5, legBars: 48, legATR: 3, oteLo: 0.62, discLo: 0.5, confirmBars: 2, wait: 3, ihBars: 6,
    stopBuf: 0.1, hold: 96, cost: 0.00004, rth: false, T: 5, be: "ih", zone: "ote" };
  QT.RBV_P = PV0;
  const VT = [2, 3, 5, "leg"], VB = ["none", "1R", "ih"];
  QT.rbvidRun = (k15, k5, proxy, opts = {}) => {
    const P = { ...PV0, ...opts };
    const n = k5.length, t5 = k5.map((k) => k[0]), o = k5.map((k) => +k[1]), h = k5.map((k) => +k[2]), l = k5.map((k) => +k[3]), c = k5.map((k) => +k[4]);
    const atr5 = new Array(n).fill(null);
    for (let i = 1, a = 0; i < n; i++) { const tr = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])); a = i <= 14 ? a + tr / 14 : a + (tr - a) / 14; if (i >= 14) atr5[i] = a; }
    const t15 = k15.map((k) => k[0]), c15 = k15.map((k) => +k[4]);
    const trendAt = (t) => {
      let lo = 0, hi = t15.length - 1, i = -1;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (t15[m] + 15 * 60e3 <= t) { i = m; lo = m + 1; } else hi = m - 1; }
      if (i < 50) return null;
      let s = 0; for (let q = i - 49; q <= i; q++) s += c15[q];
      return c15[i] > s / 50;
    };
    // the leg before bar j for a long (bull) or short: extreme, its bar, origin, and whether a counter close followed the extreme
    const legAt = (j, bull) => {
      const a = Math.max(0, j - P.legBars);
      let iX = -1; for (let q = a; q < j; q++) if (iX < 0 || (bull ? h[q] > h[iX] : l[q] < l[iX])) iX = q;
      if (iX <= a) return null;
      let iO = a; for (let q = a; q <= iX; q++) if (bull ? l[q] < l[iO] : h[q] > h[iO]) iO = q;
      const X = bull ? h[iX] : l[iX], O = bull ? l[iO] : h[iO];
      let counter = false; for (let q = iX + 1; q <= j; q++) if (bull ? c[q] < o[q] : c[q] > o[q]) { counter = true; break; }
      return { X, O, iX, iO, size: Math.abs(X - O), counter };
    };
    const out = [], live = [], pend = [], recent = [];
    const fin = (cd, v, how, px, k) => { const d = cd.bull ? 1 : -1; v.done = true; v.how = how; v.exitT = t5[k]; v.exitPx = px; v.res = ((px - cd.entry) * d) / cd.R - (P.cost * cd.entry) / cd.R; };
    const key = (T, be) => `${T}|${be}`, PK = key(P.T, P.be);
    const sync = (cd) => {
      const v = cd.v[PK]; if (!v) return;
      if (v.done) Object.assign(cd, { state: v.how === "be" ? "stop" : v.how, be: v.how === "be", res: v.res, exitT: v.exitT, exitPx: v.exitPx, target: v.tgt, evT: v.exitT });
      else { cd.state = "open"; cd.target = v.tgt; cd.res = ((c[cd.lastJ] - cd.entry) * (cd.bull ? 1 : -1)) / cd.R; cd.lastPx = c[cd.lastJ]; cd.beOn = v.stop !== cd.stop; }
    };

    const E = QT.ictRun(k15, k5, proxy, opts.trace || null, (x) => {
      const { j, e, zones, opens, swept } = x;
      recent.push({ j, swept }); while (recent.length && recent[0].j <= j - 3) recent.shift();
      const flatTime = P.rth ? e.min >= 955 || e.min < 570 : e.min >= 1015 && e.min < 1080, noFill = (e.min >= 1005 && e.min < 1080) || (P.rth && !(e.min >= 570 && e.min < 955));

      // ---- live orders and trades
      for (const cd of live) {
        const d = cd.bull ? 1 : -1; cd.lastJ = j;
        if (cd.state === "limit") {
          if (!P.rth && flatTime) { cd.state = "expired"; cd.exitT = cd.evT = t5[j]; continue; }
          if (!noFill && (d > 0 ? l[j] <= cd.entry : h[j] >= cd.entry)) {
            cd.fillJ = j; cd.fillT = cd.evT = t5[j]; cd.v = {};
            for (const T of VT) for (const be of VB) {
              const tgt = T === "leg" ? ((cd.legX - cd.entry) * d >= 1.5 * cd.R ? cd.legX : null) : cd.entry + d * T * cd.R;
              cd.v[key(T, be)] = { tgt, stop: cd.stop, be, done: tgt == null };
            }
            if (d > 0 ? l[j] <= cd.stop : h[j] >= cd.stop) for (const v of Object.values(cd.v)) if (!v.done) fin(cd, v, "stop", cd.stop, j);
            sync(cd); continue;
          }
          if (d > 0 ? l[j] <= cd.stop : h[j] >= cd.stop) { cd.state = "cancel"; cd.exitT = cd.evT = t5[j]; continue; }
          if (j - cd.armJ >= P.wait) { cd.state = "expired"; cd.exitT = cd.evT = t5[j]; continue; }
        } else if (cd.state === "open") {
          for (const v of Object.values(cd.v)) {
            if (v.done) continue;
            if (d > 0 ? l[j] <= v.stop : h[j] >= v.stop) fin(cd, v, v.stop === cd.stop ? "stop" : "be", v.stop, j);
            else if (d > 0 ? h[j] >= v.tgt : l[j] <= v.tgt) fin(cd, v, "target", v.tgt, j);
            else if (flatTime || j - cd.fillJ >= P.hold) fin(cd, v, "time", c[j], j);
            else if (v.stop === cd.stop && ((v.be === "1R" && (d > 0 ? h[j] - cd.entry : cd.entry - l[j]) >= cd.R) || (v.be === "ih" && cd.ih != null && (d > 0 ? h[j] > cd.ih : l[j] < cd.ih)))) v.stop = cd.entry;   // from the next bar
          }
          sync(cd);
        }
      }
      for (let i = live.length - 1; i >= 0; i--) if (!["limit", "open"].includes(live[i].state)) live.splice(i, 1);

      // ---- rejection blocks waiting for their confirming close
      const A5 = atr5[j];
      for (let i = pend.length - 1; i >= 0; i--) {
        const p = pend[i], d = p.bull ? 1 : -1;
        if (d > 0 ? l[j] < p.ext : h[j] > p.ext) { pend.splice(i, 1); continue; }          // wick broken: not a rejection
        if (d > 0 ? c[j] > o[j] : c[j] < o[j]) { pend.splice(i, 1); arm(p, j); }
        else if (j - p.j >= P.confirmBars) pend.splice(i, 1);
      }
      if (A5 == null) return;
      // ---- a new wick on bar j: needs the leg's discount, the OTE touch and context
      const rng = h[j] - l[j]; if (!(rng > 0)) return;
      const bodyTop = Math.max(o[j], c[j]), bodyBot = Math.min(o[j], c[j]);
      for (const bull of [true, false]) {
        const wick = bull ? bodyBot - l[j] : h[j] - bodyTop;
        if (wick < P.wickPct * rng || wick < P.wickATR * A5) continue;
        const L = legAt(j, bull); if (!L || L.size < P.legATR * A5 || !L.counter) continue;
        const ext = bull ? l[j] : h[j], entry = bull ? bodyBot : bodyTop;
        const fExt = Math.abs(L.X - ext) / L.size, fEntry = Math.abs(L.X - entry) / L.size;
        if (fExt > 1 || fEntry < P.discLo || (P.zone === "ote" && fExt < P.oteLo)) continue;
        const sw = recent.flatMap((r) => r.swept).filter((p) => p.kind === (bull ? "SSL" : "BSL"));
        const wLo = bull ? l[j] : bodyTop, wHi = bull ? bodyBot : h[j];
        const pda = zones.find((z) => (z.kind === "OB" || z.kind === "FVG") && z.bull === bull && z.created <= x.t && (() => {
          const zt = z.kind === "FVG" ? z.top : Math.max(z.wickExt, z.bodyExt), zb = z.kind === "FVG" ? z.bottom : Math.min(z.wickExt, z.bodyExt);
          return wLo <= zt && wHi >= zb;
        })());
        const ko = ["00:00", "10:00"].find((nm) => opens[nm] != null && opens[nm] >= wLo && opens[nm] <= wHi);
        const ctx = sw.length ? `свип ${sw[0].tag}` : pda ? `${pda.kind} 15m` : ko ? `открытие ${ko}` : null;
        if (!ctx) continue;
        let ih = null; for (let q = Math.max(0, j - P.ihBars); q < j; q++) ih = ih == null ? (bull ? h[q] : l[q]) : bull ? Math.max(ih, h[q]) : Math.min(ih, l[q]);
        const p = { setup: "RBV", bull, t: t5[j], j, ext, entry, stop: ext - (bull ? 1 : -1) * P.stopBuf * A5, atr: A5, ctx, ctxKind: sw.length ? "sweep" : pda ? "pda" : "open",
          legX: L.X, legO: L.O, fib: fExt, fibEntry: fEntry, ih: (ih - entry) * (bull ? 1 : -1) > 0 ? ih : null, trend: trendAt(t5[j] + 5 * 60e3) === bull, min: e.min };
        if (bull ? c[j] > o[j] : c[j] < o[j]) arm(p, j); else pend.push(p);
      }
    });
    // the limit goes in after the confirming close on bar k and lives for the next P.wait candles
    function arm(p, k) {
      const R = Math.abs(p.entry - p.stop); if (!(R > 0)) return;
      const cd = { ...p, R, target: p.entry + (p.bull ? 1 : -1) * P.T * R, armJ: k, lastJ: k, placeT: t5[k], evT: t5[k], state: "limit" };
      live.push(cd); out.push(cd);
    }
    return { sigs: out, E, VT, VB, key };
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
      let streak = 0; for (let i = closedBefore.length - 1; i >= 0 && closedBefore[i].res < -0.25; i--) streak++;   // a break-even exit isn't a loss
      const busy = taken.some((x) => x.sym === s.sym && (x.state === "open" || x.exitT > s.fillT));
      s.risk = today.length >= P.maxDay ? `лимит ${P.maxDay} сделки в день` : streak >= P.maxLossStreak ? `${P.maxLossStreak} стопа подряд — стоп на день` : busy ? "уже в позиции" : "ok";
      if (s.risk === "ok") taken.push(s);
    }
    return taken;
  };
})();
