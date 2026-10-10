(() => {
  const QT = window.QT, F = QT.f;
  // ============================================================ BOT — the paper bot: every SETUP signal with the trend, traded
  // by the rules on a virtual account (no real orders anywhere). Contracts are fixed when the signal is first logged
  // (risk $ from SETUP, micro contracts MNQ / MES), results in $ include the CME cost model of the backtest.
  // It reads the forward log (QT.sigLog), so it counts from the terminal's first start, including signals that fired
  // while the terminal was closed (marked ◦ — you couldn't have taken them, the rules could).
  const usd = (v, sign = true) => (v == null || !isFinite(v) ? "—" : F.sgn(v, `${sign ? (v >= 0 ? "+" : "−") : ""}$${F.num(Math.abs(v), 0)}`));
  const rTxt = (v) => (v == null ? "—" : F.sgn(v, `${v >= 0 ? "+" : ""}${v.toFixed(2)}R`));
  const dt = (ms) => new Date(ms).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const STATE = { target: "ЦЕЛЬ", stop: "СТОП", time: "ПО ВРЕМЕНИ", open: "ОТКРЫТА" };

  // paper trades from the log: valid, filled (open or closed), with contracts
  QT.botTrades = () => (QT.sigLog || []).filter((s) => s.valid && s.fillT && STATE[s.state] && s.qty > 0)
    .map((s) => ({ ...s, usd: s.res * s.R * s.qty * s.pv }))
    .sort((a, b) => a.fillT - b.fillT);

  QT.fn.BOT = {
    name: "Paper bot", desc: "Paper bot: trades every SETUP signal with the trend by the rules on a virtual account — balance, P&L today / week / total, open position, working orders, equity curve, trade list. No real orders.", sym: false,
    mount(ctx) {
      QT.startSetups && QT.startSetups();
      ctx.el.innerHTML = `<div class="bkpi"></div><div class="bcurve" style="height:150px;position:relative;border-bottom:1px solid var(--l)"></div><div class="bbody"></div>`;
      const kpi = ctx.el.querySelector(".bkpi"), curveEl = ctx.el.querySelector(".bcurve"), body = ctx.el.querySelector(".bbody");
      const chart = QT.chart(curveEl, { rightPriceScale: { borderColor: "#1c1c1c", scaleMargins: { top: 0.12, bottom: 0.08 } } });
      const line = chart.addLineSeries({ color: "#e8e8e8", lineWidth: 2, priceLineVisible: false, lastValueVisible: true, priceFormat: { type: "price", precision: 0, minMove: 1 } });
      const base = chart.addLineSeries({ color: "#444", lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      let dead = false;
      ctx.onCleanup(() => { dead = true; try { chart.remove(); } catch {} });

      let flt = QT.load("botFlt", "ALL");
      const paint = () => {
        if (dead) return;
        const cfg = QT.setupCfg(), start = cfg.acct, now = Date.now();
        const every = QT.botTrades(), all = flt === "ALL" ? every : every.filter((t) => t.setup === flt), closed = all.filter((t) => t.state !== "open"), open = all.filter((t) => t.state === "open");
        const realized = closed.reduce((a, t) => a + t.usd, 0), unreal = open.reduce((a, t) => a + t.usd, 0);
        const day0 = new Date(); day0.setHours(0, 0, 0, 0);
        const wk0 = new Date(day0); wk0.setDate(wk0.getDate() - ((wk0.getDay() + 6) % 7));
        const sumSince = (t0) => closed.filter((t) => t.exitT >= t0).reduce((a, t) => a + t.usd, 0);
        let eq = start, peak = start, dd = 0;
        const pts = [{ time: Math.floor((QT.sigSince || now) / 1000), value: start }];
        for (const t of closed.slice().sort((a, b) => a.exitT - b.exitT)) { eq += t.usd; peak = Math.max(peak, eq); dd = Math.min(dd, eq - peak); pts.push({ time: Math.floor(t.exitT / 1000), value: eq }); }
        if (open.length) pts.push({ time: Math.floor(now / 1000), value: eq + unreal });
        // one point per second at most (lightweight-charts needs strictly increasing times)
        const curve = []; for (const p of pts) { if (curve.length && p.time <= curve[curve.length - 1].time) curve[curve.length - 1].value = p.value; else curve.push(p); }
        line.setData(curve);
        base.setData(curve.length > 1 ? [{ time: curve[0].time, value: start }, { time: curve[curve.length - 1].time, value: start }] : []);
        chart.timeScale().fitContent();

        const wins = closed.filter((t) => t.usd > 0).length, avgR = closed.length ? closed.reduce((a, t) => a + t.res, 0) / closed.length : null;
        const k = [["БАЛАНС", `$${F.num(start + realized + unreal, 0)}`], ["P&L ВСЕГО", usd(realized + unreal)], ["СЕГОДНЯ", usd(sumSince(day0.getTime()))], ["ЭТА НЕДЕЛЯ", usd(sumSince(wk0.getTime()))],
          ["СДЕЛОК", `${closed.length}${open.length ? ` + ${open.length} откр.` : ""}`], ["ПРИБЫЛЬНЫХ", closed.length ? `${Math.round((wins / closed.length) * 100)}%` : "—"], ["СРЕДНИЙ R", rTxt(avgR)], ["МАКС. ПРОСАДКА", dd ? usd(dd) : "$0"]];
        const chips = [["ALL", "ВСЕ"], ["RB", "RB CE"], ["10AM", "10:00"], ["RBF", "RB + ФИБО"], ["RBV", "RB ВИДЕО"]].map(([v, t]) => `<span class="tag${flt === v ? " on" : ""}" data-flt="${v}">${t}</span>`).join("");
        kpi.className = "kvwrap"; kpi.innerHTML = `<div class="tdsw" style="padding-bottom:6px">${chips}</div><div class="kv">${k.map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join("")}</div>`;
        kpi.querySelectorAll("[data-flt]").forEach((x) => (x.onclick = () => { flt = x.dataset.flt; QT.save("botFlt", flt); paint(); }));

        // working orders and open positions right now, from the live scans
        const liveSigs = ["NQ", "ES"].flatMap((s) => ((QT.setups[s] || {}).sigs || []).filter((x) => x.valid && (x.state === "limit" || x.state === "open") && (flt === "ALL" || x.setup === flt)));
        // per strategy, closed trades
        const per = ["RB", "10AM", "RBF", "RBV"].map((k0) => {
          const c0 = every.filter((t) => t.setup === k0 && t.state !== "open"), n0 = c0.length, w0 = c0.filter((t) => t.usd > 0).length;
          const r0 = n0 ? c0.reduce((a, t) => a + t.res, 0) / n0 : null, u0 = c0.reduce((a, t) => a + t.usd, 0), bt = (QT.SETUP_BACKTEST || {})[k0];
          return `<tr><td class="l">${(QT.SETUP_RU || {})[k0]}</td><td>${n0}</td><td>${n0 ? Math.round((w0 / n0) * 100) + "%" : "—"}</td><td>${rTxt(r0)}</td><td>${n0 ? usd(u0) : "—"}</td><td class="dim">${bt ? bt.note : ""}</td></tr>`;
        }).join("");
        const work = liveSigs.map((x) => {
          const z = QT.setupSize(x.R, x.sym), side = x.bull ? "BUY" : "SELL";
          if (x.state === "limit") return `<tr><td class="l">ОРДЕР</td><td class="l hi">${side} LIMIT ${z ? z.mini : 0} ${z ? z.nm : ""}</td><td>${F.num(x.entry, 2)}</td><td>${F.num(x.stop, 2)}</td><td>${F.num(x.target, 2)}</td><td class="l dim">${(QT.SETUP_RU || {})[x.setup]} · снять в ${new Date(x.t + 48 * 300e3).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</td></tr>`;
          const t = all.find((y) => y.id === x.id), pnl = t ? t.usd : null;
          return `<tr><td class="l">ПОЗИЦИЯ</td><td class="l hi">${x.bull ? "LONG" : "SHORT"} ${t ? t.qty : z ? z.mini : 0} ${z ? z.nm : ""}</td><td>${F.num(x.entry, 2)}</td><td>${F.num(x.stop, 2)}</td><td>${F.num(x.target, 2)}</td><td class="l">${usd(pnl)} · ${rTxt(x.res)}</td></tr>`;
        }).join("");
        const rows = all.slice().reverse().slice(0, 40).map((t) => `<tr data-bt="${t.fillT}" data-bs="${t.sym}" class="click${t.late ? " dim" : ""}" title="${t.late ? "Терминал был закрыт: сделка посчитана по правилам, но вживую ты бы её не получил. " : ""}Клик — показать на графике бота"><td class="l">${dt(t.fillT)}${t.late ? " ◦" : ""}</td><td class="l">${t.unit} ${t.bull ? "▲" : "▼"} ${t.qty}</td><td class="l">${(QT.SETUP_RU || {})[t.setup] || t.setup}</td><td>${F.num(t.entry, 2)}</td><td>${t.exitPx != null ? F.num(t.exitPx, 2) : t.lastPx != null ? F.num(t.lastPx, 2) : "—"}</td><td class="l">${STATE[t.state]}</td><td>${rTxt(t.res)}</td><td>${usd(t.usd)}</td></tr>`).join("");
        body.innerHTML = `<div class="sec">ПО СТРАТЕГИЯМ</div><table class="t"><thead><tr><th class="l">СТРАТЕГИЯ</th><th>СДЕЛОК</th><th>WIN</th><th>СРЕДНИЙ</th><th>$</th><th>БЭКТЕСТ</th></tr></thead><tbody>${per}</tbody></table>`
          + `<div class="sec">СЕЙЧАС</div>` + (work ? `<table class="t"><thead><tr><th class="l"></th><th class="l">ЧТО</th><th>ЦЕНА</th><th>СТОП</th><th>ЦЕЛЬ</th><th class="l"></th></tr></thead><tbody>${work}</tbody></table>` : `<div class="note">Ни ордеров, ни позиций — ждём сигнал по тренду (касание края RB или реклейм 10:00).</div>`)
          + `<div class="sec">СДЕЛКИ БОТА С ${new Date(QT.sigSince || now).toLocaleDateString("ru-RU")}</div>`
          + (rows ? `<table class="t"><thead><tr><th class="l">ВХОД</th><th class="l">КОНТРАКТЫ</th><th class="l">СЕТАП</th><th>ЦЕНА</th><th>ВЫХОД</th><th class="l">ИТОГ</th><th>R</th><th>$</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="note">Сделок ещё не было.</div>`)
          + `<div class="note">Бумажный счёт: ни одного реального ордера, нигде. Бот берёт <b>каждый</b> сигнал SETUP по тренду строго по правилам: RB CE — лимит в середину RB, цель 2R; 10:00 — вход по рынку на реклейме, цель 2R; RB + фибо — лимит на открытие RB в зоне 0.62–0.79, цель 5R, ≤ 3 сделок в день и стоп после 2 убытков подряд; RB по видео — RB в откате импульса (тень в OTE), лимит на начало RB, цель 5R, безубыток после внутреннего хая, те же дневные правила. Контракты — микро (MNQ / MES) на риск $${cfg.riskUsd} (меняется в SETUP), счёт $${F.num(start, 0)}. Издержки как у CME (~1 пункт NQ на круг). ◦ — сигнал пришёл, когда терминал был закрыт: по правилам он считается, но вживую ты бы его не взял. Цены — с перпов QQQ/SPY в пунктах фьючерса (±2–4 п.), поэтому P&L — оценка, а не выписка брокера. Сравнивай с <b>JOURNAL</b>: там твои реальные сделки.</div>`;
        body.querySelectorAll("tr[data-bt]").forEach((tr) => (tr.onclick = () => QT.emit("bot-focus", { sym: tr.dataset.bs, t: +tr.dataset.bt })));
        ctx.setMeta(`${usd(realized + unreal)} · ${closed.length} сделок${open.length ? " · в позиции" : ""}`);
      };
      paint();
      const offs = [QT.on("setups", paint), QT.on("siglog", paint)];
      return () => offs.forEach((f) => f());
    },
  };

  // ============================================================ BOTGP — the bot's own chart: every paper trade drawn on the candles
  // Triangles point the way of the order (▲ buy, ▼ sell), their tip sits exactly on the fill price:
  // hollow = entry, filled = exit; a dotted line joins them, labelled with the result in R. A small ring = the moment the
  // RB limit was placed (first touch of the zone's edge). Working limit / open position: price lines entry, stop, target.
  const TFSEC = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600 };
  QT.fn.BOTGP = {
    name: "Bot chart", desc: "The paper bot's chart for NQ / ES: candles with every bot trade — hollow triangle = entry, filled = exit (▲ buy, ▼ sell), dotted line with the result in R; working limit / position as lines. Click a trade in BOT to jump to it.", sym: true, proxy: true,
    tfs: ["1m", "5m", "15m", "1h"],
    mount(ctx) {
      const s = ctx.sym, proxy = QT.PROXY[s];
      if (!proxy) { ctx.el.innerHTML = `<div class="note">Бот торгует только NQ и ES. Открой <b>BOTGP NQ</b> или <b>BOTGP ES</b>.</div>`; return; }
      QT.startSetups && QT.startSetups();
      const tf = QT.tfIn(ctx.args, "5m"), step = TFSEC[tf] || 300, src = QT.src(s);
      ctx.setTitle(`${proxy.name} · сделки бота · ${tf.toUpperCase()}`);
      ctx.el.innerHTML = `<div class="chart"></div><div class="gtb"><span class="ghint">△ вход · ▲ выход · ▲ покупка ▼ продажа · ○ лимит выставлен</span></div>`;
      const box = ctx.el.firstChild;
      const chart = QT.chart(box);
      const candles = chart.addCandlestickSeries({ ...QT.candleStyle, priceLineColor: "#666" });
      let bars = [], r = 1, trades = [], lines = [], dead = false, req = null;

      const idxAt = (tSec) => { let lo = 0, hi = bars.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (bars[m].time <= tSec) { ans = m; lo = m + 1; } else hi = m - 1; } return ans; };
      const xAt = (ms) => { const i = idxAt(Math.floor(ms / 1000)); return i < 0 ? null : chart.timeScale().logicalToCoordinate(i); };
      const tri = (g, x, y, up, filled, color) => {
        const w = 6, h = 10, yb = up ? y + h : y - h;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x - w, yb); g.lineTo(x + w, yb); g.closePath();
        if (filled) { g.fillStyle = color; g.fill(); } else { g.fillStyle = "#060606"; g.fill(); g.lineWidth = 1.5; g.strokeStyle = color; g.stroke(); }
      };
      const view = { draw(target) { target.useMediaCoordinateSpace(({ context: g }) => {
        g.font = "10px IBM Plex Mono, Consolas"; g.textAlign = "left";
        for (const t of trades) {
          const buyIn = t.bull, cIn = buyIn ? "#f2f2f2" : "#a8a8a8", cOut = buyIn ? "#a8a8a8" : "#f2f2f2";
          const x1 = xAt(t.fillT), y1 = candles.priceToCoordinate(t.entry);
          const x0 = t.setup === "RB" || t.setup === "RBF" || t.setup === "RBV" ? xAt(t.t) : null;
          if (x0 != null && y1 != null && t.t < t.fillT) { g.beginPath(); g.arc(x0, y1, 3, 0, Math.PI * 2); g.lineWidth = 1; g.strokeStyle = "#8a8a8a"; g.stroke(); }
          const out = t.exitT != null && t.exitPx != null;
          const x2 = out ? xAt(t.exitT) : null, y2 = out ? candles.priceToCoordinate(t.exitPx) : null;
          if (x1 != null && y1 != null && x2 != null && y2 != null) {
            g.setLineDash([2, 3]); g.lineWidth = 1; g.strokeStyle = t.res >= 0 ? "rgba(255,255,255,0.7)" : "rgba(150,150,150,0.7)";
            g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); g.setLineDash([]);
          }
          if (x1 != null && y1 != null) tri(g, x1, y1, buyIn, false, cIn);
          if (x2 != null && y2 != null) {
            tri(g, x2, y2, !buyIn, true, cOut);
            const lab = `${t.res >= 0 ? "+" : ""}${t.res.toFixed(1)}R`, ly = buyIn ? y2 - 13 : y2 + 21;
            g.fillStyle = "rgba(0,0,0,0.7)"; g.fillRect(x2 + 7, ly - 9, g.measureText(lab).width + 4, 12);
            g.fillStyle = t.res >= 0 ? "#ffffff" : "#9a9a9a"; g.fillText(lab, x2 + 9, ly);
          }
        }
      }); } };
      const prim = { attached(p) { req = p.requestUpdate; }, detached() { req = null; }, updateAllViews() {}, paneViews: () => [{ zOrder: () => "top", renderer: () => view }] };
      candles.attachPrimitive(prim);

      const paintTrades = () => {
        if (dead) return;
        // closed and open trades from the forward log, plus this scan's live ones that aren't logged yet
        const logged = QT.botTrades().filter((t) => t.sym === s);
        const ids = new Set(logged.map((t) => t.id));
        const live = ((QT.setups[s] || {}).sigs || []).filter((x) => x.valid && x.fillT && !ids.has(x.id) && x.t >= (QT.sigSince || 0));
        trades = [...logged, ...live];
        lines.forEach((pl) => { try { candles.removePriceLine(pl); } catch {} }); lines = [];
        for (const x of ((QT.setups[s] || {}).sigs || []).filter((y) => y.valid && (y.state === "limit" || y.state === "open"))) {
          lines.push(candles.createPriceLine({ price: x.entry, color: "#ffffff", lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title: x.state === "limit" ? `ЛИМИТ ${x.bull ? "BUY" : "SELL"}` : `${x.bull ? "LONG" : "SHORT"} ${x.res >= 0 ? "+" : ""}${(x.res || 0).toFixed(2)}R` }));
          lines.push(candles.createPriceLine({ price: x.stop, color: "#8a8a8a", lineWidth: 1, lineStyle: 0, axisLabelVisible: true, title: "СТОП" }));
          lines.push(candles.createPriceLine({ price: x.target, color: "#e6e6e6", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: x.setup === "RBF" ? "ЦЕЛЬ 5R" : "ЦЕЛЬ 2R" }));
          // RB + Fibonacci: the current grid's OTE levels (re-anchored on new extremes)
          if (x.setup === "RBF" && x.state === "limit" && x.fibExt != null) for (const f of [0.62, 0.705, 0.79])
            lines.push(candles.createPriceLine({ price: x.fibExt - f * (x.fibExt - x.anchor), color: "#6a6a6a", lineWidth: 1, lineStyle: 1, axisLabelVisible: false, title: `фибо ${f}` }));
          // RB по видео: the leg's grid (discount 0.5 and the OTE levels) and the break-even trigger
          if (x.setup === "RBV" && x.legX != null) for (const f of [0.5, 0.62, 0.705, 0.79])
            lines.push(candles.createPriceLine({ price: x.legX - f * (x.legX - x.legO), color: "#6a6a6a", lineWidth: 1, lineStyle: 1, axisLabelVisible: false, title: `фибо ${f}` }));
          if (x.setup === "RBV" && x.state === "open" && x.ih != null && !x.beOn) lines.push(candles.createPriceLine({ price: x.ih, color: "#9a9a9a", lineWidth: 1, lineStyle: 3, axisLabelVisible: true, title: "БУ после" }));
        }
        const closed = trades.filter((t) => t.exitT != null && t.state !== "open"), pnl = closed.reduce((a, t) => a + (t.usd ?? 0), 0);
        ctx.setMeta(`${closed.length} сделок · ${F.sgn(pnl, `${pnl >= 0 ? "+" : "−"}$${F.num(Math.abs(pnl), 0)}`)}`);
        if (req) req();
      };
      const focus = (t) => { const i = idxAt(Math.floor(t / 1000)); if (i >= 0) chart.timeScale().setVisibleLogicalRange({ from: i - 70, to: i + 50 }); };

      (async () => {
        try {
          r = await QT.ensureRatio(s);
          const n = Math.max(600, Math.min(5000, Math.ceil((Date.now() - (QT.sigSince || Date.now())) / 1000 / step) + 200));
          const k = await QT.klines(src, tf, n, 60e3);
          if (dead) return;
          bars = k.map((x) => ({ time: x[0] / 1000, open: x[1] * r, high: x[2] * r, low: x[3] * r, close: x[4] * r }));
          candles.applyOptions({ priceFormat: { type: "price", precision: 2, minMove: 0.01 } });
          candles.setData(bars);
          chart.timeScale().setVisibleLogicalRange({ from: bars.length - 220, to: bars.length + 6 });
          paintTrades();
        } catch (e) { ctx.error(e); }
      })();
      const unsub = QT.ws(`${QT.BN_WS}${src.toLowerCase()}usdt@kline_${tf}`, (d) => {
        const k = d.k; if (!k || !bars.length) return;
        const b = { time: k.t / 1000, open: k.o * r, high: k.h * r, low: k.l * r, close: k.c * r }, last = bars[bars.length - 1];
        if (b.time === last.time) bars[bars.length - 1] = b; else if (b.time > last.time) bars.push(b); else return;
        candles.update(b);
      });
      const offs = [QT.on("setups", paintTrades), QT.on("siglog", paintTrades), QT.on("bot-focus", (f) => { if (f.sym === s) focus(f.t); })];
      return () => { dead = true; unsub(); offs.forEach((f) => f()); try { candles.detachPrimitive(prim); } catch {} chart.remove(); };
    },
  };
})();
