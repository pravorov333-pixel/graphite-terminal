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

  // the strategy picked in BOT is shared with the bot charts (BOTGP), so stats and chart always show the same thing
  QT.botFlt = QT.load("botFlt", "ALL");
  QT.setBotFlt = (v) => { QT.botFlt = v; QT.save("botFlt", v); QT.emit("bot-filter", v); };
  const inFlt = (x) => QT.botFlt === "ALL" || x.setup === QT.botFlt;
  const FLTS = [["ALL", "ВСЕ"], ["RB", "RB CE"], ["10AM", "10:00"], ["RBF", "RB + ФИБО"], ["RBV", "RB ВИДЕО"]];
  const chipsHtml = () => FLTS.map(([v, t]) => `<span class="tag${QT.botFlt === v ? " on" : ""}" data-flt="${v}" style="cursor:pointer">${t}</span>`).join("");

  // what each strategy is, in plain words — shown in BOT when it's picked
  const STRATS = {
    RB: { name: "RB CE", status: "ПРОВЕРЕНА", idea: "Rejection block 15m — свеча с длинной тенью на локальном экстремуме и объёмом выше среднего. Когда цена возвращается к зоне, она обычно сначала проходит до её середины и только потом разворачивается, поэтому вход — лимитом в середину, а не на краю.",
      rules: [["Зона", "RB 15m по правилам индикатора ICT-QPS: тень ≥ 0.5 ATR и ≥ 35% свечи, экстремум 3 свечей, объём выше среднего"], ["Триггер", "цена коснулась края тела зоны"], ["Лимит", "в середину зоны (CE), живёт 4 часа; снимается, если цена раньше дошла до стопа"], ["Стоп", "за тенью зоны + 0.02 ATR"], ["Цель", "2R, выход по времени через 4 часа"], ["Фильтр", "только по тренду 15m (цена выше SMA50 — только лонги, ниже — только шорты)"]],
      bt: "+0.20R на сделку на NQ/ES (306 сделок, t 2.4), +0.24R на акциях; в плюсе на 11 из 12 инструментов и в обеих половинах периода. Вход от края зоны и вход после подтверждения — в минусе." },
    "10AM": { name: "10:00 реклейм", status: "КАНДИДАТ", idea: "Открытие 10:00 по Нью-Йорку — уровень, за который цену часто выносят за стопами и тут же возвращают. Вход на возврате, только в утреннюю сессию.",
      rules: [["Уровень", "цена открытия свечи 10:00 NY"], ["Триггер", "пробой уровня (≥ 0.15 ATR, объём) и закрытие 5m-свечи обратно за уровнем"], ["Окно", "свеча возврата закрылась с 10:00 до 12:00 NY"], ["Вход", "по рынку на закрытии свечи возврата; если цена ушла дальше 0.3R — пропуск"], ["Стоп", "0.5 ATR за уровнем"], ["Цель", "2R, выход по времени через 4 часа"]],
      bt: "+0.73R на сделку, но всего 49 сделок; работает только на NQ/ES (на акциях −0.10R); окно 10:00–12:00 найдено во время теста. Нужна проверка вперёд." },
    RBF: { name: "RB + фибо (ТЗ)", status: "НЕ ДОКАЗАНА", idea: "Стратегия из твоего ТЗ: rejection block на 5m в зоне ликвидности, Фибоначчи от тени RB на импульс, вход на откате к началу RB в зоне OTE.",
      rules: [["RB", "5m: тень ≥ 50% свечи и ≥ 0.5 ATR, закрытие в ту же сторону"], ["Контекст", "свип ликвидности (EQH/EQL, свинги, хаи/лои сессий, дня, недели), OB/FVG 15m или открытие 00:00/10:00 в тени"], ["Фибо", "от тени RB до экстремума импульса (≥ 2 ATR), перетягивается на каждом новом экстремуме"], ["Лимит", "на открытие RB, существует только пока оно в зоне 0.62–0.79"], ["Стоп / цель", "за тенью + 0.1 ATR / 5R, выход до 16:55 NY"], ["Риск", "≤ 3 сделок в день, после 2 стопов подряд — стоп на день; только по тренду"]],
      bt: "≈0R на NQ/ES (130 сделок), −0.15R на акциях. Уведомления по умолчанию выключены." },
    RBV: { name: "RB по видео", status: "КАНДИДАТ", idea: "Модель из видео 393ticks: сначала импульс и Фибоначчи на нём, потом в откате в дисконт — rejection block как точный триггер входа.",
      rules: [["Импульс", "свинг за 4 ч по тренду, ≥ 3 ATR; фибо рисуется после первого встречного закрытия, новый экстремум перерисовывает"], ["RB", "5m в откате: тень в OTE 0.62–0.79 (не ниже начала импульса), начало RB в дисконте ≥ 0.5, закрытие в сторону сделки (эта свеча или 2 следующих)"], ["Контекст", "свип ликвидности, OB/FVG 15m или открытие 00:00/10:00 в тени"], ["Лимит", "на начало RB, живёт 3 свечи"], ["Стоп / цель", "за всей тенью + 0.1 ATR / 5R, выход до 16:55 NY"], ["Сопровождение", "безубыток, когда цена снимает внутренний хай (макс. 6 свечей до RB) — придёт уведомление"], ["Риск", "≤ 3 сделок в день, после 2 стопов подряд — стоп на день"]],
      bt: "+0.20R на NQ/ES (132 сделки, t 1.0), но весь плюс в первой половине периода и только при цели 5R (20% прибыльных); на акциях −0.34R." },
  };
  QT.STRATS = STRATS;

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
        const flt = QT.botFlt;
        const cfg = QT.setupCfg(), start = cfg.acct, now = Date.now();
        const every = QT.botTrades(), all = every.filter(inFlt), closed = all.filter((t) => t.state !== "open"), open = all.filter((t) => t.state === "open");
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
        kpi.className = "kvwrap"; kpi.innerHTML = `<div class="tdsw" style="padding-bottom:6px">${chipsHtml()}</div><div class="kv">${k.map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join("")}</div>`;
        kpi.querySelectorAll("[data-flt]").forEach((x) => (x.onclick = () => QT.setBotFlt(x.dataset.flt)));

        // working orders and open positions right now, from the live scans
        const liveSigs = ["NQ", "ES"].flatMap((s) => ((QT.setups[s] || {}).sigs || []).filter((x) => x.valid && (x.state === "limit" || x.state === "open") && inFlt(x)));
        // per strategy, closed trades
        const per = ["RB", "10AM", "RBF", "RBV"].map((k0) => {
          const c0 = every.filter((t) => t.setup === k0 && t.state !== "open"), n0 = c0.length, w0 = c0.filter((t) => t.usd > 0).length;
          const r0 = n0 ? c0.reduce((a, t) => a + t.res, 0) / n0 : null, u0 = c0.reduce((a, t) => a + t.usd, 0), bt = (QT.SETUP_BACKTEST || {})[k0];
          return `<tr class="click${flt === k0 ? " hi" : ""}" data-pick="${k0}"><td class="l">${(QT.SETUP_RU || {})[k0]} <span class="tag">${STRATS[k0].status}</span></td><td>${n0}</td><td>${n0 ? Math.round((w0 / n0) * 100) + "%" : "—"}</td><td>${rTxt(r0)}</td><td>${n0 ? usd(u0) : "—"}</td><td class="dim">${bt ? bt.note : ""}</td></tr>`;
        }).join("");
        // live setups as cards: where the order goes, size, and the checklist of why it is valid
        const hmL = (ms) => new Date(ms).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
        const work = liveSigs.map((x) => {
          const z = QT.setupSize(x.R, x.sym), side = x.bull ? "BUY" : "SELL", checks = QT.setupChecks(x), good = checks.every((c) => c.ok !== false);
          const t = all.find((y) => y.id === x.id), until = x.setup === "RBV" ? x.placeT + 4 * 300e3 : x.setup === "RBF" ? x.t + 48 * 300e3 : x.t + 48 * 300e3;
          const head = x.state === "limit" ? `${side} LIMIT ${F.num(x.entry, 2)}` : `${x.bull ? "LONG" : "SHORT"} С ${F.num(x.entry, 2)}`;
          return `<div class="planbias ${x.bull ? "bull" : "bear"}"><span>${good ? "VALID SETUP" : "НЕ VALID"}</span><b style="font-size:16px">${head}</b><i>${x.sym} · ${(QT.SETUP_RU || {})[x.setup]} · ${z ? z.mini : 0} ${z ? z.nm : ""}</i></div>`
            + `<div class="kv"><div><span>СТОП</span><b>${F.num(x.stop, 2)}</b></div><div><span>ЦЕЛЬ ${x.setup === "RB" || x.setup === "10AM" ? "2R" : "5R"}</span><b>${F.num(x.target, 2)}</b></div><div><span>РИСК</span><b>${x.R.toFixed(2)} п</b></div><div><span>${x.state === "limit" ? "ЛИМИТ ДО" : "P&L"}</span><b>${x.state === "limit" ? hmL(until) : `${usd(t ? t.usd : null)} · ${rTxt(x.res)}`}</b></div></div>`
            + `<div class="note" style="line-height:1.7">${checks.map((c) => `${c.ok === false ? "✗" : c.ok === null ? "⚠" : "✓"} ${QT.esc(c.txt)}`).join("<br>")}</div>`;
        }).join("");
        const ncfg = QT.notifyCfg ? QT.notifyCfg() : {};
        const notif = `<div class="tdsw" style="padding:4px 8px 8px;flex-wrap:wrap">${FLTS.slice(1).map(([v, t]) => `<span class="tag${ncfg[v] !== false ? " on" : ""}" data-nt="${v}" style="cursor:pointer" title="Уведомления по ${t}: ${ncfg[v] !== false ? "включены" : "выключены"}">${ncfg[v] !== false ? "● ВКЛ" : "○ ВЫКЛ"} ${t}</span>`).join("")}<span class="tag" data-ntest style="cursor:pointer">ПРОВЕРИТЬ УВЕДОМЛЕНИЕ</span></div>`
          + `<div class="note" style="padding-top:0">Уведомление Windows приходит, когда сетап становится VALID: где ставить лимит (или вход по рынку для 10:00), стоп, цель, сколько контрактов, до какого времени держать лимит и список проверок ✓. Потом — «лимит исполнен», «перенеси стоп в безубыток» (RB по видео), «сними лимит», «сделка закрыта». ⚠ — важные новости США в ближайшие 15 минут. Работает, пока терминал открыт.</div>`;
        // the picked strategy's description, or a one-line overview of all four
        const S0 = STRATS[flt];
        const about = S0 ? `<div class="sec">${QT.esc(S0.name).toUpperCase()} · <span class="tag on">${S0.status}</span></div><div class="note" style="color:var(--fg)">${S0.idea}</div>`
          + `<table class="t td"><tbody>${S0.rules.map(([a, b]) => `<tr><td class="l dim" style="width:110px">${a.toUpperCase()}</td><td class="l" style="white-space:normal">${b}</td></tr>`).join("")}<tr><td class="l dim">БЭКТЕСТ</td><td class="l" style="white-space:normal">${S0.bt}</td></tr></tbody></table>`
          : `<div class="sec">СТРАТЕГИИ — НАЖМИ, ЧТОБЫ ПОСМОТРЕТЬ ПРАВИЛА</div><table class="t td"><tbody>${Object.entries(STRATS).map(([k0, S]) => `<tr class="click" data-pick="${k0}"><td class="l" style="width:130px">${S.name}</td><td class="l"><span class="tag${S.status === "ПРОВЕРЕНА" ? " on" : ""}">${S.status}</span></td><td class="l dim" style="white-space:normal">${S.idea.split(". ")[0]}.</td></tr>`).join("")}</tbody></table>`;
        const rows = all.slice().reverse().slice(0, 40).map((t) => `<tr data-bt="${t.fillT}" data-bs="${t.sym}" class="click${t.late ? " dim" : ""}" title="${t.late ? "Терминал был закрыт: сделка посчитана по правилам, но вживую ты бы её не получил. " : ""}Клик — показать на графике бота"><td class="l">${dt(t.fillT)}${t.late ? " ◦" : ""}</td><td class="l">${t.unit} ${t.bull ? "▲" : "▼"} ${t.qty}</td><td class="l">${(QT.SETUP_RU || {})[t.setup] || t.setup}</td><td>${F.num(t.entry, 2)}</td><td>${t.exitPx != null ? F.num(t.exitPx, 2) : t.lastPx != null ? F.num(t.lastPx, 2) : "—"}</td><td class="l">${STATE[t.state]}</td><td>${rTxt(t.res)}</td><td>${usd(t.usd)}</td></tr>`).join("");
        body.innerHTML = `<div class="sec">СЕЙЧАС${flt === "ALL" ? "" : " · " + QT.esc(STRATS[flt].name).toUpperCase()}</div>` + (work || `<div class="note">Нет VALID сетапов — ни ордеров, ни позиций. Ждём сигнал.</div>`)
          + about
          + `<div class="sec">УВЕДОМЛЕНИЯ О СЕТАПАХ</div>` + notif
          + `<div class="sec">ПО СТРАТЕГИЯМ</div><table class="t"><thead><tr><th class="l">СТРАТЕГИЯ</th><th>СДЕЛОК</th><th>WIN</th><th>СРЕДНИЙ</th><th>$</th><th>БЭКТЕСТ</th></tr></thead><tbody>${per}</tbody></table>`
          + `<div class="sec">СДЕЛКИ БОТА С ${new Date(QT.sigSince || now).toLocaleDateString("ru-RU")}</div>`
          + (rows ? `<table class="t"><thead><tr><th class="l">ВХОД</th><th class="l">КОНТРАКТЫ</th><th class="l">СЕТАП</th><th>ЦЕНА</th><th>ВЫХОД</th><th class="l">ИТОГ</th><th>R</th><th>$</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="note">Сделок ещё не было.</div>`)
          + `<div class="note">Бумажный счёт: ни одного реального ордера, нигде. Бот берёт <b>каждый</b> сигнал SETUP по тренду строго по правилам: RB CE — лимит в середину RB, цель 2R; 10:00 — вход по рынку на реклейме, цель 2R; RB + фибо — лимит на открытие RB в зоне 0.62–0.79, цель 5R, ≤ 3 сделок в день и стоп после 2 убытков подряд; RB по видео — RB в откате импульса (тень в OTE), лимит на начало RB, цель 5R, безубыток после внутреннего хая, те же дневные правила. Контракты — микро (MNQ / MES) на риск $${cfg.riskUsd} (меняется в SETUP), счёт $${F.num(start, 0)}. Издержки как у CME (~1 пункт NQ на круг). ◦ — сигнал пришёл, когда терминал был закрыт: по правилам он считается, но вживую ты бы его не взял. Цены — с перпов QQQ/SPY в пунктах фьючерса (±2–4 п.), поэтому P&L — оценка, а не выписка брокера. Сравнивай с <b>JOURNAL</b>: там твои реальные сделки.</div>`;
        body.querySelectorAll("tr[data-bt]").forEach((tr) => (tr.onclick = () => QT.emit("bot-focus", { sym: tr.dataset.bs, t: +tr.dataset.bt })));
        body.querySelectorAll("[data-pick]").forEach((tr) => (tr.onclick = () => QT.setBotFlt(tr.dataset.pick)));
        body.querySelectorAll("[data-nt]").forEach((x) => (x.onclick = () => QT.setNotify(x.dataset.nt, QT.notifyCfg()[x.dataset.nt] === false)));
        const nt = body.querySelector("[data-ntest]"); if (nt) nt.onclick = () => { QT.setupTestNotify(); nt.textContent = "✓ ОТПРАВЛЕНО"; };
        ctx.setMeta(`${flt === "ALL" ? "" : STRATS[flt].name + " · "}${usd(realized + unreal)} · ${closed.length} сделок${open.length ? " · в позиции" : ""}`);
      };
      paint();
      const offs = [QT.on("setups", paint), QT.on("siglog", paint), QT.on("bot-filter", paint), QT.on("notify-cfg", paint)];
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
      ctx.el.innerHTML = `<div class="chart"></div><div class="gtb"><span class="bflt" style="display:flex;gap:3px"></span><span class="ghint">△ вход · ▲ выход · ○ лимит</span></div>`;
      const fl = ctx.el.querySelector(".bflt");
      ctx.el.querySelector(".gtb").addEventListener("mousedown", (e) => e.stopPropagation());
      const paintChips = () => {
        fl.innerHTML = FLTS.map(([v, t]) => `<span class="gb${QT.botFlt === v ? " on" : ""}" data-flt="${v}">${t}</span>`).join("");
        fl.querySelectorAll("[data-flt]").forEach((x) => (x.onclick = (e) => { e.stopPropagation(); QT.setBotFlt(x.dataset.flt); }));
      };
      paintChips();
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
        const logged = QT.botTrades().filter((t) => t.sym === s && inFlt(t));
        const ids = new Set(logged.map((t) => t.id));
        const live = ((QT.setups[s] || {}).sigs || []).filter((x) => x.valid && x.fillT && !ids.has(x.id) && x.t >= (QT.sigSince || 0) && inFlt(x));
        trades = [...logged, ...live];
        lines.forEach((pl) => { try { candles.removePriceLine(pl); } catch {} }); lines = [];
        for (const x of ((QT.setups[s] || {}).sigs || []).filter((y) => y.valid && (y.state === "limit" || y.state === "open") && inFlt(y))) {
          lines.push(candles.createPriceLine({ price: x.entry, color: "#ffffff", lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title: x.state === "limit" ? `ЛИМИТ ${x.bull ? "BUY" : "SELL"}` : `${x.bull ? "LONG" : "SHORT"} ${x.res >= 0 ? "+" : ""}${(x.res || 0).toFixed(2)}R` }));
          lines.push(candles.createPriceLine({ price: x.stop, color: "#8a8a8a", lineWidth: 1, lineStyle: 0, axisLabelVisible: true, title: "СТОП" }));
          lines.push(candles.createPriceLine({ price: x.target, color: "#e6e6e6", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: x.setup === "RBF" || x.setup === "RBV" ? "ЦЕЛЬ 5R" : "ЦЕЛЬ 2R" }));
          // RB + Fibonacci: the current grid's OTE levels (re-anchored on new extremes)
          if (x.setup === "RBF" && x.state === "limit" && x.fibExt != null) for (const f of [0.62, 0.705, 0.79])
            lines.push(candles.createPriceLine({ price: x.fibExt - f * (x.fibExt - x.anchor), color: "#6a6a6a", lineWidth: 1, lineStyle: 1, axisLabelVisible: false, title: `фибо ${f}` }));
          // RB по видео: the leg's grid (discount 0.5 and the OTE levels) and the break-even trigger
          if (x.setup === "RBV" && x.legX != null) for (const f of [0.5, 0.62, 0.705, 0.79])
            lines.push(candles.createPriceLine({ price: x.legX - f * (x.legX - x.legO), color: "#6a6a6a", lineWidth: 1, lineStyle: 1, axisLabelVisible: false, title: `фибо ${f}` }));
          if (x.setup === "RBV" && x.state === "open" && x.ih != null && !x.beOn) lines.push(candles.createPriceLine({ price: x.ih, color: "#9a9a9a", lineWidth: 1, lineStyle: 3, axisLabelVisible: true, title: "БУ после" }));
        }
        const closed = trades.filter((t) => t.exitT != null && t.state !== "open"), pnl = closed.reduce((a, t) => a + (t.usd ?? 0), 0);
        ctx.setMeta(`${QT.botFlt === "ALL" ? "все стратегии" : STRATS[QT.botFlt].name} · ${closed.length} сделок · ${F.sgn(pnl, `${pnl >= 0 ? "+" : "−"}$${F.num(Math.abs(pnl), 0)}`)}`);
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
      const offs = [QT.on("setups", paintTrades), QT.on("siglog", paintTrades), QT.on("bot-filter", () => { paintChips(); paintTrades(); }), QT.on("bot-focus", (f) => { if (f.sym === s) focus(f.t); })];
      return () => { dead = true; unsub(); offs.forEach((f) => f()); try { candles.detachPrimitive(prim); } catch {} chart.remove(); };
    },
  };
})();
