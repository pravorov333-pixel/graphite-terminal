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

      const paint = () => {
        if (dead) return;
        const cfg = QT.setupCfg(), start = cfg.acct, now = Date.now();
        const all = QT.botTrades(), closed = all.filter((t) => t.state !== "open"), open = all.filter((t) => t.state === "open");
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
        kpi.className = "kv"; kpi.innerHTML = k.map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join("");

        // working orders and open positions right now, from the live scans
        const liveSigs = ["NQ", "ES"].flatMap((s) => ((QT.setups[s] || {}).sigs || []).filter((x) => x.valid && (x.state === "limit" || x.state === "open")));
        const work = liveSigs.map((x) => {
          const z = QT.setupSize(x.R, x.sym), side = x.bull ? "BUY" : "SELL";
          if (x.state === "limit") return `<tr><td class="l">ОРДЕР</td><td class="l hi">${side} LIMIT ${z ? z.mini : 0} ${z ? z.nm : ""}</td><td>${F.num(x.entry, 2)}</td><td>${F.num(x.stop, 2)}</td><td>${F.num(x.target, 2)}</td><td class="l dim">${(QT.SETUP_RU || {})[x.setup]} · снять в ${new Date(x.t + 48 * 300e3).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</td></tr>`;
          const t = all.find((y) => y.id === x.id), pnl = t ? t.usd : null;
          return `<tr><td class="l">ПОЗИЦИЯ</td><td class="l hi">${x.bull ? "LONG" : "SHORT"} ${t ? t.qty : z ? z.mini : 0} ${z ? z.nm : ""}</td><td>${F.num(x.entry, 2)}</td><td>${F.num(x.stop, 2)}</td><td>${F.num(x.target, 2)}</td><td class="l">${usd(pnl)} · ${rTxt(x.res)}</td></tr>`;
        }).join("");
        const rows = all.slice().reverse().slice(0, 40).map((t) => `<tr${t.late ? ' class="dim" title="Терминал был закрыт: сделка посчитана по правилам, но вживую ты бы её не получил"' : ""}><td class="l">${dt(t.fillT)}${t.late ? " ◦" : ""}</td><td class="l">${t.unit} ${t.bull ? "▲" : "▼"} ${t.qty}</td><td class="l">${(QT.SETUP_RU || {})[t.setup] || t.setup}</td><td>${F.num(t.entry, 2)}</td><td>${t.exitPx != null ? F.num(t.exitPx, 2) : t.lastPx != null ? F.num(t.lastPx, 2) : "—"}</td><td class="l">${STATE[t.state]}</td><td>${rTxt(t.res)}</td><td>${usd(t.usd)}</td></tr>`).join("");
        body.innerHTML = `<div class="sec">СЕЙЧАС</div>` + (work ? `<table class="t"><thead><tr><th class="l"></th><th class="l">ЧТО</th><th>ЦЕНА</th><th>СТОП</th><th>ЦЕЛЬ</th><th class="l"></th></tr></thead><tbody>${work}</tbody></table>` : `<div class="note">Ни ордеров, ни позиций — ждём сигнал по тренду (касание края RB или реклейм 10:00).</div>`)
          + `<div class="sec">СДЕЛКИ БОТА С ${new Date(QT.sigSince || now).toLocaleDateString("ru-RU")}</div>`
          + (rows ? `<table class="t"><thead><tr><th class="l">ВХОД</th><th class="l">КОНТРАКТЫ</th><th class="l">СЕТАП</th><th>ЦЕНА</th><th>ВЫХОД</th><th class="l">ИТОГ</th><th>R</th><th>$</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="note">Сделок ещё не было.</div>`)
          + `<div class="note">Бумажный счёт: ни одного реального ордера, нигде. Бот берёт <b>каждый</b> сигнал SETUP по тренду строго по правилам: лимит в середину RB (или вход по рынку на реклейме 10:00), стоп, цель 2R, выход через 4 часа. Контракты — микро (MNQ / MES) на риск $${cfg.riskUsd} (меняется в SETUP), счёт $${F.num(start, 0)}. Издержки как у CME (~1 пункт NQ на круг). ◦ — сигнал пришёл, когда терминал был закрыт: по правилам он считается, но вживую ты бы его не взял. Цены — с перпов QQQ/SPY в пунктах фьючерса (±2–4 п.), поэтому P&L — оценка, а не выписка брокера. Сравнивай с <b>JOURNAL</b>: там твои реальные сделки.</div>`;
        ctx.setMeta(`${usd(realized + unreal)} · ${closed.length} сделок${open.length ? " · в позиции" : ""}`);
      };
      paint();
      const offs = [QT.on("setups", paint), QT.on("siglog", paint)];
      return () => offs.forEach((f) => f());
    },
  };
})();
