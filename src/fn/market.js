(() => {
  const QT = window.QT, F = QT.f;
  const ticker24 = () => QT.get(QT.FAPI + "/fapi/v1/ticker/24hr", 15000)
    .then((arr) => arr.filter((t) => t.symbol.endsWith("USDT") && !t.symbol.includes("_") && +t.quoteVolume > 0)
      .map((t) => ({ b: t.symbol.slice(0, -4), last: +t.lastPrice, chg: +t.priceChangePercent, qv: +t.quoteVolume, high: +t.highPrice, low: +t.lowPrice })));

  // ============================================================ WL — watchlist
  QT.fn.WL = {
    name: "Watchlist", desc: "Realtime quotes, funding, open interest and premium for your list. WL ADD/DEL <SYM>", sym: false,
    mount(ctx) {
      ctx.el.innerHTML = `<table class="t"><thead><tr><th>SYM</th><th>LAST</th><th>24H</th><th>HIGH</th><th>LOW</th><th>VOL 24H</th>
        <th>FUND ANN</th><th>NEXT FUND</th><th>OI</th><th>PREM bp</th></tr></thead><tbody></tbody></table>
        <div class="note">click a row to focus it · WL ADD SOL · WL DEL SOL</div>`;
      const tb = ctx.el.querySelector("tbody"), rows = {}, prev = {}, oi = {};
      const build = () => {
        tb.innerHTML = QT.watch.map((b) => `<tr class="click" data-s="${b}"><td class="hi b">${b}</td>${"<td></td>".repeat(9)}</tr>`).join("");
        tb.querySelectorAll("tr").forEach((tr) => { rows[tr.dataset.s] = tr.children; tr.onclick = () => QT.setFocus(tr.dataset.s); });
        ctx.setMeta(`${QT.watch.length} symbols`);
      };
      const loadOI = async () => {
        await Promise.all(QT.watch.map(async (b) => {
          try { oi[b] = +(await QT.get(`${QT.FAPI}/fapi/v1/openInterest?symbol=${b}USDT`, 25000)).openInterest; } catch {}
        }));
        paint();
      };
      const paint = () => {
        for (const b of QT.watch) {
          const m = QT.mkt[b], c = rows[b];
          if (!m || !c) continue;
          QT.flash(c[1], F.px(m.last), m.last, prev[b]); prev[b] = m.last;
          c[2].innerHTML = F.chg(m.chg);
          c[3].textContent = F.px(m.high); c[4].textContent = F.px(m.low);
          c[5].textContent = F.usd(m.qvol);
          const fa = QT.fundAnn(b);
          c[6].innerHTML = fa == null ? "—" : F.sgn(fa, F.pct(fa, 1));
          c[7].textContent = m.nextFunding ? F.dur(m.nextFunding - Date.now()) : "—";
          c[8].textContent = oi[b] && m.mark ? F.usd(oi[b] * m.mark) : "—";
          const prem = m.mark && m.index ? (m.mark / m.index - 1) * 1e4 : null;
          c[9].innerHTML = prem == null ? "—" : F.sgn(prem, prem.toFixed(1));
        }
      };
      build(); paint(); loadOI();
      ctx.every(30000, loadOI);
      const offs = [QT.on("ticker", paint), QT.on("mark", paint), QT.on("watch", () => { build(); loadOI(); })];
      return () => offs.forEach((f) => f());
    },
  };

  // ============================================================ ICT session helpers (New York time, DST-aware)
  const etFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });
  QT.et = (ms) => { const o = {}; for (const p of etFmt.formatToParts(ms)) o[p.type] = p.value; return { date: `${o.year}-${o.month}-${o.day}`, min: +o.hour * 60 + +o.minute, dow: o.weekday }; };
  // ICT zones (RB / OB / FVG) as real boxes, drawn by the chart itself (series primitive) so they stay glued to
  // price and time while panning or zooming: boxes under the candles, labels on top
  QT.zoneOverlay = (box, chart, series, getBars) => {
    let zones = [], req = null;
    const idxOf = (tSec) => { const b = getBars(); let lo = 0, hi = b.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (b[m].time < tSec) lo = m + 1; else hi = m; } return lo; };
    const geo = (z, w) => {
      const hi = z.kind === "FVG" ? z.top : Math.max(z.wickExt, z.bodyExt), lo = z.kind === "FVG" ? z.bottom : Math.min(z.wickExt, z.bodyExt);
      const y1 = series.priceToCoordinate(hi), y2 = series.priceToCoordinate(lo);
      if (y1 == null || y2 == null || !getBars().length) return null;
      let x = chart.timeScale().logicalToCoordinate(idxOf(z.start / 1000)); if (x == null || x < 0) x = 0;
      return x > w ? null : { x, top: Math.min(y1, y2), ht: Math.max(2, Math.abs(y2 - y1)) };
    };
    const boxes = { draw(target) { target.useMediaCoordinateSpace(({ context: g, mediaSize: { width: w } }) => {
      for (const z of zones) {
        const r = geo(z, w); if (!r) continue;
        g.fillStyle = z.bull ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.045)";
        g.fillRect(r.x, r.top, w - r.x, r.ht);
        g.setLineDash(z.bull ? [] : [4, 3]); g.lineWidth = z.reacted ? 1.5 : 1;
        g.strokeStyle = z.bull ? "rgba(230,230,230,0.75)" : "rgba(150,150,150,0.8)";
        g.strokeRect(r.x + 0.5, r.top + 0.5, w - r.x - 1, r.ht - 1);
        const ce = series.priceToCoordinate(z.ce);
        if (ce != null && z.kind !== "FVG") { g.setLineDash([2, 3]); g.beginPath(); g.moveTo(r.x, ce); g.lineTo(w, ce); g.stroke(); }
        g.setLineDash([]);
      }
    }); } };
    const labels = { draw(target) { target.useMediaCoordinateSpace(({ context: g, mediaSize: { width: w, height: hh } }) => {
      g.font = "10px IBM Plex Mono, Consolas"; g.textAlign = "left";
      for (const z of zones) {
        const r = geo(z, w); if (!r) continue;
        const lab = `${z.kind}${z.bull ? "▲" : "▼"} ${QT.ictPct(z.p)}${z.reacted ? " ✓" : z.touched ? " · тест" : ""}`;
        // label at the zone's left edge (the right edge belongs to the price-line titles)
        const lw = g.measureText(lab).width, ty = Math.max(10, Math.min(hh - 3, r.top + Math.min(r.ht, 14) - 3)), lx = Math.max(2, Math.min(r.x + 4, w - lw - 70));
        g.fillStyle = "rgba(0,0,0,0.7)"; g.fillRect(lx - 2, ty - 10, lw + 4, 12);
        g.fillStyle = z.bull ? "#ffffff" : "#a8a8a8"; g.fillText(lab, lx, ty);
      }
    }); } };
    const prim = {
      attached(p) { req = p.requestUpdate; }, detached() { req = null; }, updateAllViews() {},
      paneViews: () => [{ zOrder: () => "bottom", renderer: () => boxes }, { zOrder: () => "top", renderer: () => labels }],
    };
    series.attachPrimitive(prim);
    return { set(z) { zones = z || []; if (req) req(); }, destroy() { try { series.detachPrimitive(prim); } catch {} } };
  };
  // liquidity pools and key opens as labelled price lines, titled with the probabilities from the engine
  QT.ictLines = (series, eng, old = []) => {
    old.forEach((pl) => { try { series.removePriceLine(pl); } catch {} });
    const out = [];
    for (const p of eng.pools) out.push(series.createPriceLine({ price: p.price, color: p.kind === "BSL" ? "#ffffff" : "#9a9a9a", lineWidth: 1, lineStyle: 1, axisLabelVisible: true, title: `${p.tag}${p.touches > 1 ? "×" + p.touches : ""} ${QT.ictPct(p.pSweep)}` }));
    for (const o of eng.opens) out.push(series.createPriceLine({ price: o.px, color: o.name === "00:00" ? "#bdbdbd" : "#e6e6e6", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: `${o.name} NY ${QT.ictPct(o.p)}${o.armed}` }));
    return out;
  };

  // ============================================================ user lines (per symbol) + crossing alerts
  QT.lines = QT.load("lines", {});
  const saveLines = () => { QT.save("lines", QT.lines); QT.emit("lines"); };
  const lastPx = {}, lastFire = {};
  QT.on("ticker", () => {
    for (const [sym, arr] of Object.entries(QT.lines)) {
      const m = QT.mkt[sym]; if (!m || !m.last || !arr.length) continue;
      const p0 = lastPx[sym]; lastPx[sym] = m.last;
      if (p0 == null || p0 === m.last) continue;
      for (const ln of arr) {
        if ((p0 - ln.p) * (m.last - ln.p) > 0) continue;
        const key = sym + ":" + ln.p;
        if (Date.now() - (lastFire[key] || 0) < 120000) continue;
        lastFire[key] = Date.now();
        QT.notify(`${sym} пересёк твою линию ${F.px(ln.p)} — сейчас ${F.px(m.last)}`);
      }
    }
  });

  // ============================================================ GP — price chart
  const TFMIN = { "1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "2h": 120, "4h": 240 };
  QT.fn.GP = {
    name: "Price chart", desc: "Candles, SMA50, session VWAP, volume, ICT levels and zones from the ICT-QPS engine, kill zones, your own lines with alerts. NQ / ES = CME futures points in real time. Args: 1M 5M 15M 1H 4H 1D", sym: true, proxy: true,
    tfs: ["1m", "5m", "15m", "1h", "4h", "1d"],
    mount(ctx) {
      const tf = QT.tfIn(ctx.args, "1h"), s = ctx.sym, src = QT.src(s), proxy = QT.PROXY[s];
      ctx.setTitle(`${proxy ? proxy.name + " · " : ""}${tf.toUpperCase()} · SMA50 · VWAP`);
      ctx.el.innerHTML = `<div class="chart"></div><div class="gtb"><span class="gb" data-a="lv" title="Пулы ликвидности и ключевые открытия (00:00 / 09:30 / 10:00 NY) с вероятностями">УРОВНИ</span><span class="gb" data-a="zn" title="Rejection / order blocks и FVG (15m) с вероятностью реакции">ЗОНЫ</span><span class="gb" data-a="kz" title="Киллзоны: Азия 20–22, Лондон 02–04, NY AM 08:30–10:30, NY PM 13:30–15:30 (время NY)">КИЛЛЗОНЫ</span><span class="gb" data-a="add">＋ ЛИНИЯ</span><span class="gb" data-a="clr"></span><span class="ghint"></span></div>`;
      const box = ctx.el.firstChild, tb = ctx.el.querySelector(".gtb");
      const chart = QT.chart(box);
      // CLEAN charts (trading / index screens) keep their own toggle set, all ICT layers off by default
      const clean = ctx.args.includes("CLEAN"), optKey = clean ? "gp.opt.clean" : "gp.opt";
      const opt = clean ? { lv: false, zn: false, kz: false, ...QT.load(optKey, {}) } : { lv: true, zn: true, kz: true, ...QT.load(optKey, {}) };
      const tfMin = TFMIN[tf];
      // killzone shading sits behind everything: a full-height histogram on its own hidden scale
      const kz = chart.addHistogramSeries({ priceScaleId: "kz", lastValueVisible: false, priceLineVisible: false, priceFormat: { type: "volume" } });
      chart.priceScale("kz").applyOptions({ scaleMargins: { top: 0, bottom: 0 }, visible: false });
      const candles = chart.addCandlestickSeries({ ...QT.candleStyle, priceLineColor: "#666" });
      candles.priceScale().applyOptions({ scaleMargins: { top: 0.06, bottom: 0.22 } });
      const vol = chart.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      const sma = chart.addLineSeries({ color: "#777", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      const vwap = chart.addLineSeries({ color: "#ffffff", lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      const intraday = !/d|w/.test(tf);
      let bars = [], r = 1, lvLines = [], userLines = [], arming = false, dead = false;

      const smaAt = (i) => { if (i < 49) return null; let x = 0; for (let k = i - 49; k <= i; k++) x += bars[k].close; return x / 50; };
      const vwapSeries = () => {
        const out = []; let day = null, pv = 0, v = 0;
        for (const b of bars) {
          const d = Math.floor(b.time / 86400);
          if (d !== day) { day = d; pv = 0; v = 0; }
          pv += ((b.high + b.low + b.close) / 3) * b.vol; v += b.vol;
          out.push({ time: b.time, value: v ? pv / v : b.close });
        }
        return out;
      };
      const volBar = (b) => ({ time: b.time, value: b.qv, color: b.close >= b.open ? "#3c3c3c" : "#1e1e1e" });
      const kzBar = (b) => {
        const e = QT.et(b.time * 1000);
        if (proxy && (e.dow === "Sat" || e.dow === "Sun")) return { time: b.time, value: 0, color: "rgba(0,0,0,0)" };
        const z = QT.KILLZONES.find(([, a, z2]) => e.min + tfMin > a && e.min < z2);
        return { time: b.time, value: z ? 1 : 0, color: z ? `rgba(255,255,255,${z[3]})` : "rgba(0,0,0,0)" };
      };
      const toBar = (k) => ({ time: k[0] / 1000, open: k[1] * r, high: k[2] * r, low: k[3] * r, close: k[4] * r, vol: +k[5], qv: +k[7] });
      const meta = () => {
        const m = QT.mkt[s], q = QT.ratio[s];
        ctx.setMeta((m && m.last ? `${F.px(m.last)} ${F.chg(m.chg)}` : "") + (proxy && q ? ` · <span class="dim" title="Цена = перп ${src} × ${q.r.toFixed(4)} (калибровка по Yahoo ${proxy.yf}, ${q.n} свечей по 5 мин)">≈${src}×${q.r.toFixed(3)} ±${q.err.toFixed(1)}</span>` : ""));
      };
      const paintTb = () => {
        tb.querySelector('[data-a="lv"]').classList.toggle("on", opt.lv);
        tb.querySelector('[data-a="zn"]').classList.toggle("on", opt.zn);
        tb.querySelector('[data-a="kz"]').classList.toggle("on", opt.kz && intraday && !!tfMin);
        tb.querySelector('[data-a="add"]').classList.toggle("on", arming);
        const n = (QT.lines[s] || []).length;
        const clr = tb.querySelector('[data-a="clr"]'); clr.textContent = n ? `✕ ЛИНИИ ${n}` : ""; clr.style.display = n ? "" : "none";
        tb.querySelector(".ghint").textContent = arming ? "кликни по графику — линия встанет на эту цену" : n ? "Alt+клик по линии — удалить" : "";
        box.style.cursor = arming ? "crosshair" : "";
      };
      const drawUser = () => {
        userLines.forEach((pl) => candles.removePriceLine(pl));
        userLines = (QT.lines[s] || []).map((ln) => candles.createPriceLine({ price: ln.p, color: "#ffffff", lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title: "◆" }));
        paintTb();
      };
      // ICT-QPS engine: pools + key opens as price lines, RB / OB / FVG as boxes
      const zov = QT.zoneOverlay(box, chart, candles, () => bars);
      const drawLevels = async () => {
        if (!opt.lv && !opt.zn) { lvLines = QT.ictLines(candles, { pools: [], opens: [] }, lvLines); zov.set([]); return; }
        try {
          const eng = await QT.ictEngine(s);
          if (dead) return;
          lvLines = QT.ictLines(candles, opt.lv ? eng : { pools: [], opens: [] }, lvLines);
          zov.set(opt.zn && tfMin && tfMin <= 60 ? eng.zones : []);
        } catch (e) { console.warn("ict engine", e); }
      };
      const paintKz = () => kz.setData(opt.kz && intraday && tfMin ? bars.map(kzBar) : []);

      (async () => {
        try {
          r = await QT.ensureRatio(s);
          const k = await QT.get(`${QT.FAPI}/fapi/v1/klines?symbol=${src}USDT&interval=${tf}&limit=600`);
          if (dead) return;
          bars = k.map(toBar);
          candles.setData(bars);
          vol.setData(bars.map(volBar));
          paintKz();
          sma.setData(bars.map((b, i) => ({ time: b.time, value: smaAt(i) })).filter((p) => p.value != null));
          if (intraday) vwap.setData(vwapSeries());
          chart.timeScale().setVisibleLogicalRange({ from: bars.length - 160, to: bars.length + 4 });
          drawUser(); drawLevels(); meta();
        } catch (e) { ctx.error(e); }
      })();

      const unsub = QT.ws(`${QT.BN_WS}${src.toLowerCase()}usdt@kline_${tf}`, (d) => {
        const k = d.k; if (!k || !bars.length) return;
        const b = toBar([k.t, +k.o, +k.h, +k.l, +k.c, k.v, 0, k.q]);
        const isNew = b.time > bars[bars.length - 1].time;
        if (bars[bars.length - 1].time === b.time) bars[bars.length - 1] = b; else if (isNew) bars.push(b); else return;
        candles.update(b); vol.update(volBar(b));
        if (isNew && opt.kz && intraday && tfMin) kz.update(kzBar(b));
        const sv = smaAt(bars.length - 1); if (sv) sma.update({ time: b.time, value: sv });
        if (intraday) { const vs = vwapSeries(); vwap.update(vs[vs.length - 1]); }
      });

      tb.addEventListener("mousedown", (e) => e.stopPropagation());
      tb.querySelectorAll(".gb").forEach((btn) => (btn.onclick = (e) => {
        e.stopPropagation();
        const a = btn.dataset.a;
        if (a === "lv") { opt.lv = !opt.lv; QT.save(optKey, opt); drawLevels(); }
        if (a === "zn") { opt.zn = !opt.zn; QT.save(optKey, opt); drawLevels(); }
        if (a === "kz") { opt.kz = !opt.kz; QT.save(optKey, opt); paintKz(); }
        if (a === "add") arming = !arming;
        if (a === "clr") { delete QT.lines[s]; saveLines(); }
        paintTb();
      }));
      box.addEventListener("click", (e) => {
        const y = e.clientY - box.getBoundingClientRect().top, p = candles.coordinateToPrice(y);
        if (p == null) return;
        if (arming) {
          (QT.lines[s] ||= []).push({ p: +p.toPrecision(8) });
          arming = false; saveLines(); return;
        }
        if (e.altKey && QT.lines[s]) {
          // remove the line nearest to the click if it's within 8px
          let best = -1, bd = 9;
          QT.lines[s].forEach((ln, i) => { const d = Math.abs(candles.priceToCoordinate(ln.p) - y); if (d < bd) { bd = d; best = i; } });
          if (best >= 0) { QT.lines[s].splice(best, 1); if (!QT.lines[s].length) delete QT.lines[s]; saveLines(); }
        }
      });
      paintTb(); meta();
      const offs = [QT.on("ticker", meta), QT.on("lines", drawUser)];
      ctx.every(90000, drawLevels);
      return () => { dead = true; unsub(); offs.forEach((f) => f()); zov.destroy(); chart.remove(); };
    },
  };

  // ============================================================ DUO — two synced charts (NQ / ES by default) with SMT read-out
  QT.fn.DUO = {
    name: "Twin charts", desc: "Two charts with synced time axis and crosshair, SMT read-out between them. Default NQ ES. Args: two symbols + timeframe, e.g. DUO BTC ETH 15M", sym: false,
    tfs: ["1m", "5m", "15m", "1h", "4h"],
    mount(ctx) {
      const syms = ctx.args.filter((a) => QT.isSymbolToken(a)).map(QT.base);
      const A = syms[0] || "NQ", B = syms[1] || (A === "NQ" ? "ES" : A === "ES" ? "NQ" : "ETH"), tf = QT.tfIn(ctx.args, "5m");
      ctx.setTitle(`${A} · ${B} · ${tf.toUpperCase()} · synced`);
      ctx.el.innerHTML = `<div class="split"><div class="fix"><div class="kv"></div></div><div class="grow" style="border-bottom:1px solid #1c1c1c"><div class="chart c1"></div></div><div class="grow"><div class="chart c2"></div></div></div>`;
      const kv = ctx.el.querySelector(".kv");
      const mk = (el, sym) => {
        const ch = QT.chart(el, { watermark: { visible: true, text: sym, color: "rgba(255,255,255,0.06)", fontSize: 42 } });
        const c = ch.addCandlestickSeries({ ...QT.candleStyle, priceLineColor: "#666" });
        return { ch, c, sym, bars: [], map: new Map() };
      };
      const P = [mk(ctx.el.querySelector(".c1"), A), mk(ctx.el.querySelector(".c2"), B)];
      let syncing = false, first = true, dead = false;
      P.forEach((p, i) => {
        const o = P[1 - i];
        p.ch.timeScale().subscribeVisibleLogicalRangeChange((rg) => { if (dead || syncing || !rg) return; syncing = true; o.ch.timeScale().setVisibleLogicalRange(rg); syncing = false; });
        p.ch.subscribeCrosshairMove((prm) => {
          if (dead || syncing) return; syncing = true;
          if (prm.time && o.map.has(prm.time)) o.ch.setCrosshairPosition(o.map.get(prm.time), prm.time, o.c); else o.ch.clearCrosshairPosition();
          syncing = false;
        });
      });
      const load = async () => {
        try {
          const ks = await Promise.all(P.map((p) => QT.klines(p.sym, tf, 600, 20000)));
          if (dead) return;
          // align both on common bar times so logical ranges match bar for bar
          const t2 = new Set(ks[1].map((k) => k[0]));
          const common = new Set(ks[0].map((k) => k[0]).filter((t) => t2.has(t)));
          const ka = ks.map((k) => k.filter((x) => common.has(x[0])));
          ka.forEach((k, i) => {
            const p = P[i];
            p.bars = k.map((x) => ({ time: x[0] / 1000, open: +x[1], high: +x[2], low: +x[3], close: +x[4] }));
            p.map = new Map(p.bars.map((b) => [b.time, b.close]));
            p.c.setData(p.bars);
          });
          const n = P[0].bars.length;
          if (first) { P.forEach((p) => p.ch.timeScale().setVisibleLogicalRange({ from: n - 140, to: n + 3 })); first = false; }
          const r = QT.smt(ka[0], ka[1]);
          const who = (w) => (w === "A" ? A : B), other = (w) => (w === "A" ? B : A);
          const txt = [r.bear ? `МЕДВЕЖЬЯ: ${who(r.bear)} обновил хай, ${other(r.bear)} нет` : "", r.bull ? `БЫЧЬЯ: ${who(r.bull)} обновил лоу, ${other(r.bull)} нет` : ""].filter(Boolean).join(" · ") || "нет расхождения";
          const per = { "1m": 60, "5m": 12, "15m": 4, "1h": 1 }[tf] || 1;
          const ret = (p) => { const b = p.bars; return b.length > per ? (b[b.length - 1].close / b[b.length - 1 - per].close - 1) * 100 : null; };
          kv.innerHTML = [[A, n ? F.px(P[0].bars[n - 1].close) : "—"], [B, n ? F.px(P[1].bars[n - 1].close) : "—"], ["Δ 1H " + A, F.chg(ret(P[0]))], ["Δ 1H " + B, F.chg(ret(P[1]))]]
            .map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("")
            + `<div style="grid-column:1/-1"><span>SMT · последние 20 свечей против 100 до них</span><b>${txt}</b></div>`;
          ctx.setMeta(txt);
        } catch (e) { ctx.error(e); }
      };
      load(); ctx.every(tf === "1m" ? 15000 : 30000, load);
      return () => { dead = true; P.forEach((p) => p.ch.remove()); };
    },
  };

  // ============================================================ HMAP — market heatmap (squarified treemap)
  function squarify(items, x, y, w, h) {
    const out = [], total = items.reduce((a, b) => a + b.v, 0);
    let rest = items.map((it) => ({ ...it, a: (it.v / total) * w * h }));
    while (rest.length) {
      const short = Math.min(w, h);
      let row = [], best = Infinity;
      for (const it of rest) {
        const r = [...row, it], s = r.reduce((a, b) => a + b.a, 0);
        const worst = Math.max(...r.map((q) => Math.max((short * short * q.a) / (s * s), (s * s) / (short * short * q.a))));
        if (worst > best) break;
        best = worst; row = r;
      }
      const s = row.reduce((a, b) => a + b.a, 0), thick = s / short;
      let off = 0;
      for (const it of row) {
        const len = it.a / thick;
        out.push(w >= h ? { ...it, x, y: y + off, w: thick, h: len } : { ...it, x: x + off, y, w: len, h: thick });
        off += len;
      }
      if (w >= h) { x += thick; w -= thick; } else { y += thick; h -= thick; }
      rest = rest.slice(row.length);
    }
    return out;
  }
  QT.fn.HMAP = {
    name: "Market heatmap", desc: "Top perps by 24h volume; brightness = 24h change (white = up, black = down). Arg: count", sym: false,
    mount(ctx) {
      const n = Math.min(150, +ctx.args[0] || 60);
      ctx.el.innerHTML = '<div class="hm"></div>';
      const box = ctx.el.firstChild;
      let data = [];
      const draw = () => {
        const w = box.clientWidth, h = box.clientHeight;
        if (!data.length || !w) return;
        const tiles = squarify(data.map((d) => ({ ...d, v: Math.sqrt(d.qv) })), 0, 0, w, h);
        box.innerHTML = tiles.map((t) => {
          const L = Math.max(4, Math.min(92, 46 + (t.chg / 8) * 46));
          const ink = L > 55 ? "#000" : "#e6e6e6", big = t.w > 70 && t.h > 38;
          return `<div data-s="${t.b}" style="left:${t.x}px;top:${t.y}px;width:${t.w}px;height:${t.h}px;background:hsl(0 0% ${L}%);color:${ink}">`
            + (t.w > 34 && t.h > 18 ? `<b>${t.b}</b>${t.chg > 0 ? "+" : ""}${t.chg.toFixed(2)}%${big ? `<br><span style="opacity:.7">${F.px(t.last)}</span>` : ""}` : "")
            + "</div>";
        }).join("");
      };
      box.onclick = (e) => { const t = e.target.closest("[data-s]"); if (t) QT.setFocus(t.dataset.s); };
      const load = async () => {
        try {
          data = (await ticker24()).sort((a, b) => b.qv - a.qv).slice(0, n);
          const up = data.filter((d) => d.chg > 0).length;
          ctx.setMeta(`${up}▲ ${data.length - up}▼ · top ${n} by volume`);
          draw();
        } catch (e) { ctx.error(e); }
      };
      load(); ctx.every(20000, load);
      const ro = new ResizeObserver(draw); ro.observe(box);
      return () => ro.disconnect();
    },
  };

  // ============================================================ MOV — movers
  QT.fn.MOV = {
    name: "Movers", desc: "Top gainers, losers and volume across all USDT perps", sym: false,
    mount(ctx) {
      ctx.el.style.overflow = "hidden";
      const load = async () => {
        try {
          const d = await ticker24();
          const liquid = d.filter((x) => x.qv > 5e6);
          const tbl = (title, list) => `<div style="overflow:auto;min-height:0"><div class="sec">${title}</div><table class="t"><thead><tr><th>SYM</th><th>24H</th><th>VOL</th></tr></thead><tbody>`
            + list.map((x) => `<tr class="click" data-s="${x.b}" title="${F.px(x.last)}"><td class="hi">${x.b}</td><td class="b">${F.sgn(x.chg, F.pct(x.chg, 1))}</td><td>${F.usd(x.qv, 1)}</td></tr>`).join("")
            + "</tbody></table></div>";
          ctx.el.innerHTML = `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1px;background:#1c1c1c;height:100%">`
            + tbl("GAINERS · VOL > $5M", [...liquid].sort((a, b) => b.chg - a.chg).slice(0, 25))
            + tbl("LOSERS · VOL > $5M", [...liquid].sort((a, b) => a.chg - b.chg).slice(0, 25))
            + tbl("VOLUME", [...d].sort((a, b) => b.qv - a.qv).slice(0, 25)) + "</div>";
          ctx.el.querySelectorAll("tr[data-s]").forEach((tr) => (tr.onclick = () => QT.setFocus(tr.dataset.s)));
          ctx.setMeta(`${d.length} perps`);
        } catch (e) { ctx.error(e); }
      };
      load(); ctx.every(20000, load);
    },
  };

  // ============================================================ DEPTH — order book ladder + liquidity heatmap
  QT.fn.DEPTH = {
    name: "Order book", desc: "Top-15 ladder with cumulative depth, spread, imbalance and a 5-minute heatmap that lights up only real walls", sym: true,
    mount(ctx) {
      const s0 = ctx.sym, s = QT.src(s0);
      const K = () => QT.scale(s0) || 1;          // NQ / ES: show prices in futures points, keep $ sizes from the perp
      if (QT.PROXY[s0]) { ctx.setTitle(`Order book · ${s} perp in ${s0} points`); QT.ensureRatio(s0).catch(() => {}); }
      ctx.el.style.overflow = "hidden";
      ctx.el.innerHTML = `<div style="display:grid;grid-template-columns:minmax(250px,0.9fr) 1fr;height:100%">
        <div style="overflow:auto;border-right:1px solid #1c1c1c"><table class="t ladder"><thead><tr><th class="l">PRICE</th><th>SIZE</th><th>SUM $</th></tr></thead><tbody></tbody></table></div>
        <div style="position:relative"><canvas class="fill"></canvas></div></div>`;
      const tb = ctx.el.querySelector("tbody"), cv = ctx.el.querySelector("canvas");
      let book = null, dirty = false;
      const cols = [], NCOL = 150, NROW = 110;
      let lo = null, hi = null;

      const unsub = QT.ws(`${QT.BN_WS_PUB}${s.toLowerCase()}usdt@depth20@100ms`, (d) => {
        book = { b: d.b.map(([p, q]) => [+p, +q]), a: d.a.map(([p, q]) => [+p, +q]) };
        dirty = true;
      });

      const paintLadder = () => {
        if (!dirty || !book || !book.b.length || !book.a.length) return;
        dirty = false;
        const k = K(), asks = book.a.slice(0, 15), bids = book.b.slice(0, 15);
        let cum = 0; const ac = asks.map(([p, q]) => (cum += p * q));
        cum = 0; const bc = bids.map(([p, q]) => (cum += p * q));
        const max = Math.max(ac[ac.length - 1], bc[bc.length - 1]);
        const row = (cls, p, q, c) => `<tr class="${cls}"><td class="l"><div class="lvl" style="width:${(c / max) * 100}%"></div><span class="${cls === "ask" ? "dn" : "hi"}">${F.px(p * k)}</span></td><td><span>${F.num(q, q < 10 ? 3 : 1)}</span></td><td><span>${F.usd(c, 1)}</span></td></tr>`;
        const bid = bids[0][0], ask = asks[0][0], mid = (bid + ask) / 2, spr = ((ask - bid) / mid) * 1e4;
        const bn = bc[bc.length - 1], an = ac[ac.length - 1], imb = ((bn - an) / (bn + an)) * 100;
        tb.innerHTML = asks.map((x, i) => row("ask", x[0], x[1], ac[i])).reverse().join("")
          + `<tr><td class="l hi b" colspan="3">MID ${F.px(mid * k)} · SPREAD ${spr.toFixed(2)} bp · IMB ${F.sgn(imb, F.pct(imb, 1))}</td></tr>`
          + bids.map((x, i) => row("bid", x[0], x[1], bc[i])).join("");
        ctx.setMeta(`spread ${spr.toFixed(2)}bp · imb ${F.pct(imb, 1)}`);
      };

      // heatmap: 500-level REST snapshots every 2s; raw levels are kept so the window can recenter without losing history
      const snapshot = async () => {
        let d;
        try { d = await QT.get(`${QT.FAPI}/fapi/v1/depth?symbol=${s}USDT&limit=500`, 1500); } catch { return; }
        const bids = d.bids.map(([p, q]) => [+p, +p * +q]), asks = d.asks.map(([p, q]) => [+p, +p * +q]);
        if (!bids.length || !asks.length) return;
        const mid = (bids[0][0] + asks[0][0]) / 2;
        const half = Math.min(mid - bids[bids.length - 1][0], asks[asks.length - 1][0] - mid) * 0.95;
        if (lo == null || mid < lo + (hi - lo) * 0.2 || mid > lo + (hi - lo) * 0.8 || hi - lo > half * 2.6) { lo = mid - half; hi = mid + half; }
        cols.push({ lv: [...bids, ...asks], mid });
        if (cols.length > NCOL) cols.shift();
        drawHeat();
      };
      const drawHeat = () => {
        const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
        if (!w || !h || lo == null) return;
        cv.width = w * dpr; cv.height = h * dpr;
        const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.fillStyle = "#060606"; g.fillRect(0, 0, w, h);
        const AX = 64, W = w - AX;                 // right strip for the price axis and wall labels
        const grid = cols.map((c) => {
          const col = new Float32Array(NROW);
          for (const [p, v] of c.lv) { const r = Math.floor(((p - lo) / (hi - lo)) * NROW); if (r >= 0 && r < NROW) col[r] += v; }
          return col;
        });
        // brightness is relative to the TYPICAL level: the even market-maker grid stays dark, only levels several
        // times bigger than usual light up (8x the median = white). That is what a "wall" is.
        const all = grid.flatMap((c) => Array.from(c)).filter((v) => v > 0).sort((x, y) => x - y);
        const med = all.length ? all[all.length >> 1] : 1;
        const cw = W / NCOL, rh = h / NROW, x0 = W - cols.length * cw;
        grid.forEach((col, i) => {
          for (let r = 0; r < NROW; r++) {
            const v = col[r]; if (!v) continue;
            const x = v / med, L = x <= 1 ? Math.round(16 + 34 * x) : Math.round(50 + 190 * Math.min(1, Math.log(x) / Math.log(8)));
            g.fillStyle = `rgb(${L},${L},${L})`;
            g.fillRect(x0 + i * cw, h - (r + 1) * rh, cw + 0.5, rh + 0.5);
          }
        });
        g.strokeStyle = "#ffffff"; g.lineWidth = 1.5; g.beginPath();
        cols.forEach((c, i) => { const y = h - ((c.mid - lo) / (hi - lo)) * h; i ? g.lineTo(x0 + (i + 0.5) * cw, y) : g.moveTo(x0 + (i + 0.5) * cw, y); });
        g.stroke();
        // price axis
        const k = K();
        g.fillStyle = "#0a0a0a"; g.fillRect(W, 0, AX, h);
        g.strokeStyle = "#1c1c1c"; g.beginPath(); g.moveTo(W + 0.5, 0); g.lineTo(W + 0.5, h); g.stroke();
        g.font = "10px IBM Plex Mono, Consolas"; g.textAlign = "left";
        for (let i = 0; i <= 6; i++) {
          const y = 8 + (i / 6) * (h - 16), p = hi - ((y / h) * (hi - lo));
          g.fillStyle = "#666"; g.fillText(F.px(p * k), W + 5, y + 3);
        }
        // label the three biggest walls in the latest snapshot
        const last = grid[grid.length - 1];
        if (last) {
          [...last].map((v, r) => [v, r]).filter(([v]) => v >= 3 * med).sort((a, b) => b[0] - a[0]).slice(0, 3).forEach(([v, r]) => {
            const y = h - (r + 0.5) * rh, p = lo + ((r + 0.5) / NROW) * (hi - lo);
            g.fillStyle = "#ffffff"; g.fillRect(W - 3, y - 1, 3, 2);
            g.fillStyle = "#000"; g.fillRect(W + 1, y - 7, AX - 2, 13);
            g.fillStyle = "#fff"; g.fillText(F.usd(v, 1), W + 5, y + 3);
          });
          const mid = cols[cols.length - 1].mid, my = h - ((mid - lo) / (hi - lo)) * h;
          g.fillStyle = "#fff"; g.fillRect(W + 1, my - 7, AX - 2, 13); g.fillStyle = "#000"; g.fillText(F.px(mid * k), W + 5, my + 3);
        }
        g.fillStyle = "#8a8a8a";
        g.fillText("КАРТА СТАКАНА · 5 МИН · ЯРКО = ЗАЯВКА В РАЗЫ КРУПНЕЕ ОБЫЧНОЙ · ЛИНИЯ = ЦЕНА", 6, 12);
      };
      ctx.every(250, paintLadder);
      snapshot(); ctx.every(2000, snapshot);
      const ro = new ResizeObserver(drawHeat); ro.observe(cv);
      return () => { unsub(); ro.disconnect(); };
    },
  };

  // ============================================================ TAPE — time & sales
  QT.fn.TAPE = {
    name: "Time & sales", desc: "Aggressor-side trade tape with large-print highlight and rolling buy/sell delta. Arg: min $ to highlight", sym: true,
    mount(ctx) {
      const s = ctx.sym, big = +ctx.args[0] || (["BTC", "ETH"].includes(s) ? 100000 : 25000);
      ctx.el.innerHTML = `<div class="kv"></div><table class="t"><thead><tr><th>TIME</th><th>SIDE</th><th>PRICE</th><th>SIZE</th><th>$</th></tr></thead><tbody></tbody></table>`;
      const kv = ctx.el.querySelector(".kv"), tb = ctx.el.querySelector("tbody");
      const trades = []; let dirty = false;
      const unsub = QT.ws(`${QT.BN_WS}${s.toLowerCase()}usdt@aggTrade`, (d) => {
        trades.unshift({ t: d.T, side: d.m ? "SELL" : "BUY", px: +d.p, q: +d.q, usd: +d.p * +d.q });
        if (trades.length > 5000) trades.pop();
        dirty = true;
      });
      const paint = () => {
        if (!dirty) return; dirty = false;
        const now = Date.now(), win = (ms) => {
          let b = 0, s2 = 0; for (const t of trades) { if (now - t.t > ms) break; t.side === "BUY" ? (b += t.usd) : (s2 += t.usd); } return [b, s2];
        };
        const [b1, s1] = win(60e3), [b5, s5] = win(300e3);
        kv.innerHTML = [["BUY 1M", F.usd(b1)], ["SELL 1M", F.usd(s1)], ["DELTA 1M", F.sgn(b1 - s1, F.usd(b1 - s1))],
          ["BUY 5M", F.usd(b5)], ["SELL 5M", F.usd(s5)], ["DELTA 5M", F.sgn(b5 - s5, F.usd(b5 - s5))]]
          .map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("");
        tb.innerHTML = trades.slice(0, 150).map((t) => `<tr class="${t.usd >= big ? "inv" : ""}"><td>${F.hms(t.t)}</td><td class="${t.usd >= big ? "" : t.side === "BUY" ? "up" : "dn"}">${t.side}</td><td>${F.px(t.px)}</td><td>${F.num(t.q, t.q < 10 ? 3 : 1)}</td><td>${F.usd(t.usd, 1)}</td></tr>`).join("");
        ctx.setMeta(`highlight ≥ ${F.usd(big, 0)}`);
      };
      ctx.every(300, paint);
      return unsub;
    },
  };
})();
