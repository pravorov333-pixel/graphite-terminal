(() => {
  const QT = window.QT;
  // ============================================================ ICT engine — port of "ICT Quantum Probability Suite v21" (Pine)
  // Same definitions and defaults as the indicator: levels on 15m (RB / OB / FVG / swings / ATR14), touches and reactions
  // measured on 5m bars, New York time, rolling 20-day statistics with Laplace probability (W+1)/(N+2).
  // Added on top of the Pine version: a base rate for every "reaction" type (same 1.5×ATR-in-60-min test from every bar)
  // and a 95% interval, so a level type only counts as genuine when its edge over the base is larger than the noise.
  const MIN = 60e3, HR = 3600e3, DAY = 864e5;
  const P = {
    rbL: 3, wickATR: 0.5, wickPct: 35, volZ: 0.5, volBase: 20, rbMaxH: 24,
    obDispATR: 1.0, obVolZ: 0.5, obMaxH: 48, fvgMinATR: 0.3, fvgMaxH: 24,
    piv: 5, poolMaxH: 72, maxPools: 60, reactATR: 1.5, reactMin: 60, statsDays: 20,
    koMinExcATR: 0.15, koVolZ: 0.3, maxDistATR: 6, perSide: 3,
  };
  QT.ICTP = P;
  const POOL_TYPE = { PDH: "PD", PDL: "PD", PWH: "PW", PWL: "PW", "ASIA H": "ASIA", "ASIA L": "ASIA", "LDN H": "LDN", "LDN L": "LDN", "AM H": "AM", "AM L": "AM", SH: "SW", SL: "SW", EQH: "EQ", EQL: "EQ" };
  const sessOf = (m) => (m >= 570 && m < 720 ? "AM" : m >= 780 && m < 960 ? "PM" : "OTHER");   // NY AM 09:30–12:00, NY PM 13:00–16:00
  // Pine kill zones (2h each, New York): Asia 20–22, London 02–04, NY AM 08:30–10:30, NY PM 13:30–15:30
  QT.KILLZONES = [["ASIA", 1200, 1320, 0.04], ["LONDON", 120, 240, 0.055], ["NY AM", 510, 630, 0.08], ["NY PM", 810, 930, 0.05]];

  function run(k15, k5, proxy) {
    const n15 = k15.length, t15 = k15.map((k) => k[0]), o = k15.map((k) => +k[1]), h = k15.map((k) => +k[2]), l = k15.map((k) => +k[3]), c = k15.map((k) => +k[4]), v = k15.map((k) => +k[5]);
    // ATR14 (Wilder) and volume baseline on 15m
    const atr = new Array(n15).fill(null);
    for (let i = 1, a = 0; i < n15; i++) {
      const tr = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
      a = i <= 14 ? a + tr / 14 : a + (tr - a) / 14;
      if (i >= 14) atr[i] = a;
    }
    // baseline of the previous `len` known values (missing volume = NaN is skipped, not counted)
    const meanSd = (arr, i, len) => {
      let s = 0, s2 = 0, n = 0;
      for (let k = i - 1; k >= 0 && n < len && k >= i - 3 * len; k--) { const x = arr[k]; if (Number.isFinite(x)) { s += x; s2 += x * x; n++; } }
      if (n < len) return null;
      const m = s / n; return { m, sd: Math.sqrt(Math.max(0, s2 / n - m * m)) };
    };
    const z15 = v.map((x, i) => { if (!Number.isFinite(x)) return NaN; const b = meanSd(v, i, P.volBase); return b && b.sd > 0 ? (x - b.m) / b.sd : 0; });

    const t5 = k5.map((k) => k[0]), o5 = k5.map((k) => +k[1]), h5 = k5.map((k) => +k[2]), l5 = k5.map((k) => +k[3]), c5 = k5.map((k) => +k[4]), v5 = k5.map((k) => +k[5]);
    const z5 = v5.map((x, i) => { if (!Number.isFinite(x)) return NaN; const b = meanSd(v5, i, 20); return b && b.sd > 0 ? (x - b.m) / b.sd : 0; });
    const et5 = t5.map((t) => QT.et(t));
    // CME index futures: no Saturday, Sunday before 18:00 ET, Friday after 17:00 or the daily 17:00–18:00 break — the perp
    // still prints then, but NQ / ES don't trade, so those bars are left out of every statistic
    const closed = (e) => proxy && (e.dow === "Sat" || (e.dow === "Sun" && e.min < 1080) || (e.dow === "Fri" && e.min >= 1020) || (e.min >= 1020 && e.min < 1080));

    let p15 = 0, atrNow = null;
    const tol = () => 0.03 * (atrNow || 1);
    const events = [];                     // {type, kind: react|sweep|rev|ko, t, win, sess}
    const ev = (type, kind, t, win, sess) => events.push({ type, kind, t, win, sess });
    const zones = [], pools = [], sweeps = [], trials = [];
    let lastPh = null, lastPl = null, sPh1 = null, sPh2 = null, sPl1 = null, sPl2 = null, lastSweep = null, lastKO = null;

    const addPool = (price, kind, tag, start, now) => {
      if (price == null || !isFinite(price)) return;
      for (const p of pools) {
        if (p.kind === kind && Math.abs(p.price - price) <= tol()) {
          p.touches++; p.price = (p.price * (p.touches - 1) + price) / p.touches;
          const swing = tag === "SH" || tag === "SL";
          if (swing) { if (["SH", "SL", "EQH", "EQL"].includes(p.tag)) p.tag = kind === "BSL" ? "EQH" : "EQL"; } else p.tag = tag;
          return;
        }
      }
      pools.push({ kind, tag, price, touches: 1, start, created: now });
      if (pools.length > P.maxPools) {
        const score = (p) => p.touches * 10 + ((now - p.created) / HR) * 0.5;
        let wi = 0; pools.forEach((p, i) => { if (score(p) < score(pools[wi])) wi = i; });
        pools.splice(wi, 1);
      }
    };
    const dupZone = (kind, bull, ce) => zones.some((z) => z.kind === kind && z.bull === bull && Math.abs(z.ce - ce) <= tol() * 5);

    // 15m detection at the bar's close
    const detect15 = (i, now) => {
      const A = atr[i - 1]; if (A == null || i < 22) return;
      atrNow = A;
      // Rejection block: left-only extreme over rbL bars, long wick, volume
      const hiAll = Math.max(...h.slice(i - P.rbL, i + 1)), loAll = Math.min(...l.slice(i - P.rbL, i + 1));
      const bodyTop = Math.max(o[i], c[i]), bodyBot = Math.min(o[i], c[i]), rng = h[i] - l[i];
      const wickOk = (w) => w >= P.wickATR * A && rng > 0 && (w / rng) * 100 >= P.wickPct;
      if (h[i] >= hiAll && wickOk(h[i] - bodyTop) && z15[i] >= P.volZ && !dupZone("RB", false, (h[i] + bodyTop) / 2))
        zones.push({ kind: "RB", bull: false, wickExt: h[i], bodyExt: bodyTop, ce: (h[i] + bodyTop) / 2, start: t15[i], created: now, maxH: P.rbMaxH });
      if (l[i] <= loAll && wickOk(bodyBot - l[i]) && z15[i] >= P.volZ && !dupZone("RB", true, (l[i] + bodyBot) / 2))
        zones.push({ kind: "RB", bull: true, wickExt: l[i], bodyExt: bodyBot, ce: (l[i] + bodyBot) / 2, start: t15[i], created: now, maxH: P.rbMaxH });
      // Order block: last opposite candle before a displacement candle that closes beyond it
      if (c[i - 1] < o[i - 1] && c[i] > h[i - 1] && c[i] - l[i - 1] >= P.obDispATR * A && z15[i] >= P.obVolZ && !dupZone("OB", true, (h[i - 1] + l[i - 1]) / 2))
        zones.push({ kind: "OB", bull: true, wickExt: l[i - 1], bodyExt: h[i - 1], ce: (h[i - 1] + l[i - 1]) / 2, start: t15[i - 1], created: now, maxH: P.obMaxH });
      if (c[i - 1] > o[i - 1] && c[i] < l[i - 1] && h[i - 1] - c[i] >= P.obDispATR * A && z15[i] >= P.obVolZ && !dupZone("OB", false, (h[i - 1] + l[i - 1]) / 2))
        zones.push({ kind: "OB", bull: false, wickExt: h[i - 1], bodyExt: l[i - 1], ce: (h[i - 1] + l[i - 1]) / 2, start: t15[i - 1], created: now, maxH: P.obMaxH });
      // FVG: three-candle gap, displacement candle with above-average volume
      const vb = meanSd(v, i - 1, P.volBase), volOk = vb && Number.isFinite(v[i - 1]) && v[i - 1] > vb.m;
      if (volOk && h[i - 2] < l[i] && l[i] - h[i - 2] >= P.fvgMinATR * A)
        zones.push({ kind: "FVG", bull: true, top: l[i], bottom: h[i - 2], ce: (l[i] + h[i - 2]) / 2, start: t15[i - 2], created: now, maxH: P.fvgMaxH });
      if (volOk && l[i - 2] > h[i] && l[i - 2] - h[i] >= P.fvgMinATR * A)
        zones.push({ kind: "FVG", bull: false, top: l[i - 2], bottom: h[i], ce: (l[i - 2] + h[i]) / 2, start: t15[i - 2], created: now, maxH: P.fvgMaxH });
      // swing pivots 5/5 → liquidity pools (confirmed piv bars later)
      const p = i - P.piv;
      if (p >= P.piv) {
        let isH = true, isL = true;
        for (let q = p - P.piv; q <= p + P.piv; q++) { if (q === p) continue; if (h[q] >= h[p]) isH = false; if (l[q] <= l[p]) isL = false; }
        if (isH && lastPh !== t15[p]) { lastPh = t15[p]; sPh2 = sPh1; sPh1 = h[p]; addPool(h[p], "BSL", "SH", t15[p], now); }
        if (isL && lastPl !== t15[p]) { lastPl = t15[p]; sPl2 = sPl1; sPl1 = l[p]; addPool(l[p], "SSL", "SL", t15[p], now); }
      }
    };

    // session / day / week aggregation on 5m bars (New York time)
    const dayKey = (e) => (proxy && e.min >= 1080 ? new Date(Date.parse(e.date + "T12:00:00Z") + DAY).toISOString().slice(0, 10) : e.date);
    const weekKey = (dk) => { const d = new Date(dk + "T12:00:00Z"), dow = (d.getUTCDay() + 6) % 7; return new Date(d.getTime() - dow * DAY).toISOString().slice(0, 10); };
    let curDay = null, dH = null, dL = null, prevDay = null, curWeek = null, wH = null, wL = null;
    const sess = { ASIA: { a: 1200, b: 1440, in: false }, LDN: { a: 120, b: 300, in: false }, AM: { a: 570, b: 720, in: false } };
    const opens = { "00:00": null, "09:30": null, "10:00": null };
    const ko = {}; let midDate = null;
    // day-plan statistics (Pine section 3): 30-min slot direction, time of the day's low/high, day vs 00:00 open,
    // day range, week low/high weekday, opening volatility (09:30–09:50 true range + volume vs the last 20 days)
    const slotEv = [], dayEv = [], weekEv = [], volDays = [];
    let slot = null, slotOpen = null, slotDate = null, lastC = null, day = null, wk = null, vw = null, prevC5 = null;
    const KO_T = { "00:00": "KO00", "09:30": "KO0930", "10:00": "KO1000" };

    for (let j = 0; j < k5.length; j++) {
      const t = t5[j], e = et5[j];
      while (p15 < n15 && t15[p15] + 15 * MIN <= t) { detect15(p15, t15[p15] + 15 * MIN); p15++; }
      if (atrNow == null) continue;
      if (closed(e)) continue;
      const A = atrNow, H5 = h5[j], L5 = l5[j], C5 = c5[j], S = sessOf(e.min);
      const sl = Math.floor(e.min / 30);
      if (sl !== slot || e.date !== slotDate) { if (slot != null && lastC != null) slotEv.push({ t, slot, up: lastC > slotOpen }); slot = sl; slotDate = e.date; slotOpen = o5[j]; }
      if (!day || day.date !== e.date) {
        if (day && day.mid != null) dayEv.push({ t, date: day.date, lowSlot: day.lowSlot, highSlot: day.highSlot, range: day.hi - day.lo, up: lastC > day.mid });
        day = { date: e.date, hi: H5, lo: L5, lowSlot: sl, highSlot: sl, mid: e.min === 0 ? o5[j] : null };
      }
      if (H5 > day.hi) { day.hi = H5; day.highSlot = sl; } if (L5 < day.lo) { day.lo = L5; day.lowSlot = sl; }
      if (e.min === 0) day.mid = o5[j];
      const wkk = weekKey(e.date), dw = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(e.dow);
      if (!wk || wk.key !== wkk) { if (wk) weekEv.push({ t, lowDow: wk.lowDow, highDow: wk.highDow }); wk = { key: wkk, hi: H5, lo: L5, lowDow: dw, highDow: dw }; }
      if (H5 > wk.hi) { wk.hi = H5; wk.highDow = dw; } if (L5 < wk.lo) { wk.lo = L5; wk.lowDow = dw; }
      if (e.min >= 570 && e.min < 590) {
        if (!vw || vw.date !== e.date) vw = { date: e.date, tr: 0, vol: 0, done: false };
        vw.tr += Math.max(H5 - L5, prevC5 == null ? 0 : Math.abs(H5 - prevC5), prevC5 == null ? 0 : Math.abs(L5 - prevC5));
        vw.vol += Number.isFinite(v5[j]) ? v5[j] : 0;
      } else if (vw && !vw.done && vw.date === e.date && e.min >= 590) { vw.done = true; volDays.push({ t, date: vw.date, tr: vw.tr, vol: vw.vol }); }
      lastC = C5; prevC5 = C5;

      // new NY midnight: key opens reset (Pine newMid)
      if (e.date !== midDate) { midDate = e.date; for (const kk in opens) opens[kk] = null; for (const kk in ko) delete ko[kk]; }
      if (e.min === 0) opens["00:00"] = o5[j];
      if (e.min === 570) opens["09:30"] = o5[j];
      if (e.min === 600) opens["10:00"] = o5[j];

      // day / week pools
      const dk = dayKey(e);
      if (dk !== curDay) {
        if (curDay != null && dH != null) { addPool(dH, "BSL", "PDH", t, t); addPool(dL, "SSL", "PDL", t, t); prevDay = { h: dH, l: dL }; }
        curDay = dk; dH = H5; dL = L5;
        const wk = weekKey(dk);
        if (wk !== curWeek) { if (curWeek != null && wH != null) { addPool(wH, "BSL", "PWH", t, t); addPool(wL, "SSL", "PWL", t, t); } curWeek = wk; wH = H5; wL = L5; }
      }
      dH = Math.max(dH, H5); dL = Math.min(dL, L5); wH = Math.max(wH, H5); wL = Math.min(wL, L5);
      for (const [name, s] of Object.entries(sess)) {
        const inS = e.min >= s.a && e.min < s.b;
        if (inS && !s.in) { s.hi = H5; s.lo = L5; }
        else if (inS) { s.hi = Math.max(s.hi, H5); s.lo = Math.min(s.lo, L5); }
        if (!inS && s.in) { addPool(s.hi, "BSL", name === "LDN" ? "LDN H" : name + " H", t, t); addPool(s.lo, "SSL", name === "LDN" ? "LDN L" : name + " L", t, t); }
        s.in = inS;
      }

      // pools: swept → sweep win; expired after 72h → loss
      for (let i = pools.length - 1; i >= 0; i--) {
        const p = pools[i], type = POOL_TYPE[p.tag] || "SW";
        const swept = p.kind === "BSL" ? H5 > p.price : L5 < p.price, expired = t - p.created > P.poolMaxH * HR;
        if (swept) { lastSweep = { kind: p.kind, t, tag: p.tag, price: p.price }; ev(type, "sweep", t, true, S); sweeps.push({ kind: p.kind, price: p.price, t, ext: p.price, type, tag: p.tag }); }
        else if (expired) ev(type, "sweep", t, false, S);
        if (swept || expired) pools.splice(i, 1);
      }
      // reversal after a sweep: ≥ 1.5×ATR back within 60 min
      for (let i = sweeps.length - 1; i >= 0; i--) {
        const s = sweeps[i];
        s.ext = s.kind === "BSL" ? Math.min(s.ext, L5) : Math.max(s.ext, H5);
        if (Math.abs(s.price - s.ext) >= P.reactATR * A) { ev(s.type, "rev", s.t, true, sessOf(QT.et(s.t).min)); s.done = true; sweeps.splice(i, 1); }
        else if (t - s.t > P.reactMin * MIN) { ev(s.type, "rev", s.t, false, sessOf(QT.et(s.t).min)); sweeps.splice(i, 1); }
      }
      // zones: touch → reaction (MFE ≥ 1.5×ATR) / fail (60 min) / invalidation / expiry
      for (let i = zones.length - 1; i >= 0; i--) {
        const z = zones[i];
        if (t < z.created) continue;
        const isF = z.kind === "FVG", edge = isF ? (z.bull ? z.top : z.bottom) : z.bodyExt;
        if (!z.touched && (z.bull ? L5 <= edge : H5 >= edge)) { z.touched = true; z.touchT = t; z.sess = S; }
        if (z.touched) {
          z.mfe = Math.max(z.mfe || 0, z.bull ? H5 - edge : edge - L5);
          if (!z.reacted && z.mfe >= P.reactATR * A) { z.reacted = true; ev(z.kind, "react", z.touchT, true, z.sess); }
        }
        const invalid = isF ? (z.bull ? C5 < z.bottom : C5 > z.top) : (z.bull ? C5 < z.wickExt : C5 > z.wickExt);
        const failed = z.touched && !z.reacted && t - z.touchT > P.reactMin * MIN;
        const expired = (!z.touched && t - z.created > z.maxH * HR) || t - z.created > 3 * z.maxH * HR;
        if (invalid || failed || expired) { if (z.touched && !z.reacted) ev(z.kind, "react", z.touchT, false, z.sess); zones.splice(i, 1); }
      }
      // key opens: sweep through the level one way, then reclaim it the other way (Pine 9c)
      for (const [name, px] of Object.entries(opens)) {
        if (px == null) continue;
        const s = (ko[name] ||= { side: null, armed: false, dir: null, ext: null });
        const cur = C5 > px ? "above" : "below";
        if (s.side == null) s.side = cur;
        else if (cur !== s.side) {
          const depth = s.ext == null ? 0 : Math.abs(s.ext - px), zOk = z5[j] >= P.koVolZ;
          let fire = null;
          if (cur === "above") { if (s.armed && s.dir === "down" && depth >= P.koMinExcATR * A && zOk) { fire = "LONG"; s.armed = false; } else { s.armed = true; s.dir = "up"; s.ext = H5; } }
          else { if (s.armed && s.dir === "up" && depth >= P.koMinExcATR * A && zOk) { fire = "SHORT"; s.armed = false; } else { s.armed = true; s.dir = "down"; s.ext = L5; } }
          s.side = cur;
          if (fire) { trials.push({ kind: fire, price: px, t, ext: px, type: KO_T[name], sess: S }); lastKO = { name, kind: fire, t, px }; }
        } else if (s.armed) s.ext = s.dir === "down" ? Math.min(s.ext, L5) : Math.max(s.ext, H5);
      }
      for (let i = trials.length - 1; i >= 0; i--) {
        const s = trials[i];
        s.ext = s.kind === "LONG" ? Math.max(s.ext, H5) : Math.min(s.ext, L5);
        if (Math.abs(s.ext - s.price) >= P.reactATR * A) { ev(s.type, "ko", s.t, true, s.sess); trials.splice(i, 1); }
        else if (t - s.t > P.reactMin * MIN) { ev(s.type, "ko", s.t, false, s.sess); trials.splice(i, 1); }
      }
    }

    // ---- base rate: the same "≥ 1.5×ATR within 60 min" move from every bar, each direction
    const now = t5[t5.length - 1], from = now - P.statsDays * DAY;
    let bn = 0, bw = 0, q15 = 0;
    for (let j = 0; j < k5.length - 12; j++) {
      if (t5[j] < from || closed(et5[j])) continue;
      while (q15 + 1 < n15 && t15[q15 + 1] + 15 * MIN <= t5[j]) q15++;
      const A = atr[q15]; if (A == null) continue;
      let up = 0, dn = 0;
      for (let k = j + 1; k <= j + 12; k++) { up = Math.max(up, h5[k] - c5[j]); dn = Math.max(dn, c5[j] - l5[k]); }
      bn += 2; bw += (up >= P.reactATR * A ? 1 : 0) + (dn >= P.reactATR * A ? 1 : 0);
    }
    const base = (bw + 1) / (bn + 2);

    // ---- rolling 20-day statistics
    const agg = (type, kind, sess) => {
      const E = events.filter((x) => x.type === type && x.kind === kind && x.t >= from && (!sess || x.sess === sess));
      const w = E.filter((x) => x.win).length, n = E.length, p = (w + 1) / (n + 2);
      return { n, w, p, ci: 1.96 * Math.sqrt((p * (1 - p)) / (n + 2)) };
    };
    const stats = {};
    for (const type of ["RB", "OB", "FVG"]) stats[type] = { all: agg(type, "react"), AM: agg(type, "react", "AM"), PM: agg(type, "react", "PM"), OTHER: agg(type, "react", "OTHER") };
    for (const type of ["KO00", "KO0930", "KO1000"]) stats[type] = { all: agg(type, "ko"), AM: agg(type, "ko", "AM"), PM: agg(type, "ko", "PM"), OTHER: agg(type, "ko", "OTHER") };
    for (const type of ["PD", "PW", "ASIA", "LDN", "AM", "SW", "EQ"]) stats[type] = { sweep: agg(type, "sweep"), rev: agg(type, "rev") };

    // ---- live picture
    const price = c5[c5.length - 1], A = atrNow, maxDist = P.maxDistATR * A;
    const live = zones.filter((z) => Math.abs(z.ce - price) <= maxDist).map((z) => ({ ...z, p: stats[z.kind].all.p }));
    const score = (p) => p.touches * 10 + ((now - p.created) / HR) * 0.5;
    const pick = (kind) => pools.filter((p) => p.kind === kind && (kind === "BSL" ? p.price > price : p.price < price) && Math.abs(p.price - price) <= maxDist)
      .sort((a, b) => score(b) - score(a)).slice(0, P.perSide)
      .map((p) => { const type = POOL_TYPE[p.tag] || "SW", distF = Math.max(0.5, 1 - Math.abs(p.price - price) / (2 * maxDist)); return { ...p, type, pSweep: stats[type].sweep.p * distF, pRev: stats[type].rev.p }; });
    const openList = Object.entries(opens).filter(([, px]) => px != null).map(([name, px]) => ({ name, px, p: stats[KO_T[name]].all.p, armed: ko[name] && ko[name].armed ? (ko[name].dir === "down" ? "⇧" : "⇩") : "" }));
    // ---- day plan inputs
    const lap = (w, n) => (w + 1) / (n + 2);
    const sNow = sessOf(QT.et(now).min);
    const probS = (type) => { const st = stats[type]; if (!st) return null; const ss = st[sNow]; return ss && ss.n >= 10 ? ss.p : st.all.p; };
    const recentSlots = slotEv.filter((x) => x.t >= from), curSlot = Math.floor(QT.et(now).min / 30);
    const sl = recentSlots.filter((x) => x.slot === curSlot);
    const days = dayEv.filter((x) => x.t >= from), weeks = weekEv.slice(-12);
    const argmax = (arr, key, n) => { const c = new Array(n).fill(0); arr.forEach((x) => c[x[key]]++); let b = 0; c.forEach((v, i) => { if (v > c[b]) b = i; }); return { i: b, n: c[b], of: arr.length }; };
    const ranges = days.map((d) => d.range).sort((a, b) => a - b), pct = (q) => (ranges.length ? ranges[Math.min(ranges.length - 1, Math.floor(ranges.length * q))] : null);
    const vd = volDays.slice(-21), todayVol = vd.length && vd[vd.length - 1].date === QT.et(now).date ? vd[vd.length - 1] : null;
    const hist = (todayVol ? vd.slice(0, -1) : vd).slice(-20);
    let regime = "PENDING", zTR = null, rvol = null;
    if (todayVol && hist.length >= 5) {
      const m = hist.reduce((a, x) => a + x.tr, 0) / hist.length, sd = Math.sqrt(hist.reduce((a, x) => a + (x.tr - m) ** 2, 0) / hist.length);
      const vols = hist.map((x) => x.vol).sort((a, b) => a - b), med = vols[vols.length >> 1];
      zTR = sd > 0 ? (todayVol.tr - m) / sd : 0; rvol = med > 0 ? todayVol.vol / med : null;
      regime = zTR < -1 && rvol != null && rvol < 0.8 ? "LOW" : zTR > 0.5 && rvol != null && rvol > 1.2 ? "HIGH" : "NEUTRAL";
    } else if (hist.length < 5) regime = "WARMUP";
    let liqAbove = 0, liqBelow = 0;
    for (const p of pools) { const d = p.kind === "BSL" ? p.price - price : price - p.price; if (d > 0 && d <= maxDist) { const sc = score(p) * Math.max(0.3, 1 - d / maxDist); if (p.kind === "BSL") liqAbove += sc; else liqBelow += sc; } }
    const plan = {
      sess: sNow, probS, slotUp: { p: lap(sl.filter((x) => x.up).length, sl.length), n: sl.length, slot: curSlot },
      lowTime: argmax(days, "lowSlot", 48), highTime: argmax(days, "highSlot", 48),
      dayUp: { p: lap(days.filter((d) => d.up).length, days.length), n: days.length },
      range: { p30: pct(0.3), med: pct(0.5), p70: pct(0.7), n: ranges.length },
      today: day ? { hi: day.hi, lo: day.lo, mid: day.mid } : null,
      weekLow: argmax(weeks, "lowDow", 7), weekHigh: argmax(weeks, "highDow", 7),
      vol: { regime, zTR, rvol }, struct: { sPh1, sPh2, sPl1, sPl2 }, lastSweep, lastKO, liqAbove, liqBelow,
    };
    return { stats, base, zones: live, pools: [...pick("BSL"), ...pick("SSL")], opens: openList, atr: A, price, from, to: now, nEvents: events.filter((x) => x.t >= from).length, plan, volSource: proxy ? "CME" : "Binance" };
  }

  // shared, cached per symbol: GP and ICT panels on the same symbol reuse one computation
  const cache = {};
  QT.ictEngine = (sym) => {
    const c = cache[sym];
    if (c && Date.now() - c.t < 90e3) return c.p;
    const p = (async () => {
      const days = P.statsDays + 6;
      let [k15, k5] = await Promise.all([QT.klines(sym, "15m", days * 96, 120e3), QT.klines(sym, "5m", days * 288, 120e3)]);
      const px = QT.PROXY[sym];
      if (px) {
        // the perp's own volume is a few-thousandth of CME and agrees with it only about half the time:
        // use real futures volume, matched by bar time; bars Yahoo hasn't published yet get NaN (no volume signal yet)
        let y = null;
        try { y = await QT.yahoo(px.yf, "1mo", "5m", 240e3); } catch (e) { console.warn("CME volume unavailable, using perp volume", e); }
        if (y && y.bars.length > 500) {
          const vm = new Map(y.bars.map((b) => [b.t, b.v]));
          const vol = (t) => (vm.has(t) && vm.get(t) != null ? vm.get(t) : NaN);
          k5 = k5.map((k) => { const r = k.slice(); r[5] = vol(k[0]); return r; });
          k15 = k15.map((k) => { const r = k.slice(); r[5] = vol(k[0]) + vol(k[0] + 300e3) + vol(k[0] + 600e3); return r; });
          return { ...run(k15, k5, true), volSource: "CME" };
        }
        // Yahoo rate-limited or down: fall back to the perp's volume and say so
        return { ...run(k15, k5, true), volSource: "Binance (CME недоступен)" };
      }
      return run(k15, k5, false);
    })();
    cache[sym] = { t: Date.now(), p };
    p.catch(() => delete cache[sym]);
    return p;
  };
  QT.ictPct = (p) => (p == null ? "—" : Math.round(p * 100) + "%");
})();
