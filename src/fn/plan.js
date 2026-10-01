(() => {
  const QT = window.QT, F = QT.f;
  const kvHtml = (pairs) => pairs.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("");
  const pc = (x) => (x == null || !isFinite(x) ? "—" : Math.round(x * 100) + "%");
  const slotStr = (b) => `${String(Math.floor(b / 2)).padStart(2, "0")}:${b % 2 ? "30" : "00"}`;
  const DOW = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
  const PAIR = { NQ: "ES", ES: "NQ", QQQ: "SPY", SPY: "QQQ", BTC: "ETH", ETH: "BTC", XAU: "XAG", XAG: "XAU" };
  // news block: high-impact USD releases from the calendar; Pine's fixed 08:30 / 10:00 / 14:00 NY if the calendar is unavailable
  const PINE_NEWS = [510, 600, 840], BLOCK_MIN = 15;

  // ============================================================ PLAN — the indicator's day plan: bias, setup, size, day statistics
  QT.fn.PLAN = {
    name: "Day plan", desc: "ICT-QPS day plan: daily bias P(long/short) from 8 components, the current setup (RB / key-open anchor, stop, draw on liquidity, R:R, score, VALID), half-Kelly size, volatility regime, range and time-of-day statistics", sym: true, proxy: true,
    mount(ctx) {
      const b = ctx.sym, pair = PAIR[b], proxy = QT.PROXY[b];
      let dead = false;
      const load = async () => {
        try {
          const [E, k, kp, eco] = await Promise.all([
            QT.ictEngine(b), QT.klines(b, "5m", 300, 60000), pair ? QT.klines(pair, "5m", 300, 60000).catch(() => null) : null,
            QT.loadEco ? QT.loadEco().catch(() => null) : null,
          ]);
          if (dead) return;
          const P = E.plan, A = E.atr, px = E.price, now = Date.now(), etNow = QT.et(now), conf = (n) => Math.min(1, n / 20);

          // ---------------- bias (Pine section 9): weighted components around 0.5
          const s = P.struct;
          let cStruct = 0.5;
          if (s.sPh2 != null && s.sPl2 != null) { const hh = s.sPh1 > s.sPh2, hl = s.sPl1 > s.sPl2; cStruct = hh && hl ? 0.75 : !hh && !hl ? 0.25 : 0.5; }
          if (s.sPh1 != null && px > s.sPh1) cStruct = Math.max(cStruct, 0.8);
          if (s.sPl1 != null && px < s.sPl1) cStruct = Math.min(cStruct, 0.2);
          const sweepRecent = P.lastSweep && now - P.lastSweep.t <= 90 * 60e3;
          const cSweep = sweepRecent ? (P.lastSweep.kind === "SSL" ? 0.7 : 0.3) : 0.5;
          const cLiq = (P.liqAbove + 1) / (P.liqAbove + P.liqBelow + 2);
          const cDay = P.dayUp.p, cMid = P.today && P.today.mid != null ? (px < P.today.mid ? 0.6 : 0.4) : 0.5, cTime = P.slotUp.p;
          let smt = null;
          if (kp && kp.length > 150) { const r = QT.smt(k, kp); smt = r.bull ? "bull" : r.bear ? "bear" : null; }
          const smtQ = 1, cSMT = smt === "bull" ? 0.5 + 0.1 * smtQ : smt === "bear" ? 0.5 - 0.1 * smtQ : 0.5;
          // active HTF rejection block: in zone / within 0.3 ATR first, else nearest within range
          const rbs = E.zones.filter((z) => z.kind === "RB");
          const near = (z) => (px >= Math.min(z.wickExt, z.bodyExt) && px <= Math.max(z.wickExt, z.bodyExt)) || Math.abs(px - z.ce) <= 0.3 * A;
          const pickRB = (preferBull) => rbs.find((z) => z.bull === preferBull && near(z)) || rbs.find(near) || rbs.find((z) => z.bull === preferBull) || rbs[0] || null;
          const rbCtx = rbs.find(near) || rbs[0] || null;
          const cRB = rbCtx ? (rbCtx.bull ? 0.65 : 0.35) : 0.5;
          const comps = [
            ["Структура HTF (свинги 15m)", cStruct, 0.20, 1], ["Последний свип (90 мин)", cSweep, 0.15, 1], ["Ликвидность выше / ниже", cLiq, 0.15, 1],
            ["Дни, закрывшиеся выше 00:00", cDay, 0.10, conf(P.dayUp.n)], ["Цена против 00:00 open", cMid, 0.10, 1],
            ["Текущий 30-мин слот", cTime, 0.10, conf(P.slotUp.n)], ["SMT с " + (pair || "—"), cSMT, 0.10, 1], ["Активный rejection block", cRB, 0.10, 1],
          ];
          let pLong = 0.5 + comps.reduce((a, [, c, w, cf]) => a + w * cf * (c - 0.5), 0);
          pLong = Math.max(0.05, Math.min(0.95, pLong));
          const pShort = 1 - pLong, biasBull = pLong >= 0.5;

          // ---------------- setup (Pine section 10): anchor, stop, draw on liquidity, R:R, score
          let anchor = null;
          const rb = pickRB(biasBull);
          if (rb) anchor = { kind: "RB 15m", bull: rb.bull, entry: rb.ce, stop: rb.bull ? rb.wickExt - 0.02 * A : rb.wickExt + 0.02 * A, p: P.probS("RB") };
          else if (P.lastKO && now - P.lastKO.t <= 15 * 60e3) {
            const bull = P.lastKO.kind === "LONG", kt = { "00:00": "KO00", "09:30": "KO0930", "10:00": "KO1000" }[P.lastKO.name];
            anchor = { kind: `${P.lastKO.name} NY open`, bull, entry: P.lastKO.px, stop: bull ? P.lastKO.px - 0.5 * A : P.lastKO.px + 0.5 * A, p: P.probS(kt) };
          }
          const setupBull = anchor ? anchor.bull : biasBull;
          const dol = E.pools.find((p) => p.kind === (setupBull ? "BSL" : "SSL"));
          let target = null, rr = null, stopDist = null;
          if (anchor) {
            stopDist = Math.abs(anchor.entry - anchor.stop);
            target = dol ? dol.price : setupBull ? anchor.entry + 3 * stopDist : anchor.entry - 3 * stopDist;
            rr = stopDist > 0 ? Math.abs(target - anchor.entry) / stopDist : null;
          }
          const pSMT = smt && (smt === "bull") === setupBull ? 0.5 + 0.125 * smtQ : 0.4;
          const pDOL = dol ? dol.pSweep : 0.3, pTime = setupBull ? P.slotUp.p : 1 - P.slotUp.p;
          const pVol = { HIGH: 0.85, NEUTRAL: 0.6, LOW: 0.35 }[P.vol.regime] ?? 0.5, pBias = setupBull ? pLong : pShort;
          const pAnchor = anchor ? anchor.p : 0;
          const score = (0.25 * pAnchor + 0.15 * pSMT + 0.15 * pDOL + 0.10 * pTime + 0.10 * pVol + 0.25 * pBias) * 100;

          // news block ±15 min: real high-impact USD releases if the calendar loaded, Pine's fixed times otherwise
          let newsBlock = null;
          if (eco && eco.length) {
            const hit = eco.find((x) => x.country === "USD" && x.impact === "High" && Math.abs(x.t - now) <= BLOCK_MIN * 60e3);
            if (hit) newsBlock = `${hit.title} ${new Date(hit.t).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
          } else {
            const m = PINE_NEWS.find((x) => Math.abs(etNow.min - x) <= BLOCK_MIN);
            if (m != null) newsBlock = `${slotStr(m / 30)} NY`;
          }
          const rrOk = rr != null && rr >= 3, scoreOk = score >= 55;
          const valid = !!anchor && scoreOk && rrOk && !newsBlock;

          // half-Kelly size, capped at the CALC max risk
          const cs = QT.load("calc", { acct: 5000, risk: 1 });
          let riskPct = null, riskUsd = null, size = "—";
          if (anchor && rr) {
            const p = score / 100, kelly = p - (1 - p) / rr;
            riskPct = Math.max(0, Math.min(cs.risk, 0.5 * kelly * 100)); riskUsd = (cs.acct * riskPct) / 100;
            if (proxy) { const [big, mini, nb, nm] = proxy.pv; size = `${Math.floor(riskUsd / (stopDist * big))} ${nb} · ${Math.floor(riskUsd / (stopDist * mini))} ${nm}`; }
            else size = `${F.num(riskUsd / stopDist, 4)} ${b}`;
          }

          // ---------------- render
          const why = [!anchor ? "нет якоря (RB рядом или свежий вход по открытию)" : "", anchor && !scoreOk ? `оценка ${score.toFixed(0)}% < 55%` : "", anchor && !rrOk ? `R:R ${rr ? rr.toFixed(1) : "—"} < 3` : "", newsBlock ? `новости: ${QT.esc(newsBlock)}` : ""].filter(Boolean);
          const rng = P.range, td = P.today, done = td ? td.hi - td.lo : null;
          const lowT = P.lowTime.of ? `${slotStr(P.lowTime.i)} NY · ${P.lowTime.n} из ${P.lowTime.of} дн` : "—";
          const highT = P.highTime.of ? `${slotStr(P.highTime.i)} NY · ${P.highTime.n} из ${P.highTime.of} дн` : "—";
          ctx.el.innerHTML = `<div class="planbias ${biasBull ? "bull" : "bear"}"><span>BIAS ДНЯ</span><b>${biasBull ? "LONG" : "SHORT"} ${pc(Math.max(pLong, pShort))}</b><i>перевес +${pc(Math.abs(pLong - pShort))} · long ${pc(pLong)} / short ${pc(pShort)}</i></div>`
            + `<table class="t"><thead><tr><th class="l">КОМПОНЕНТ</th><th>ЗА LONG</th><th>ВЕС</th><th>ВКЛАД</th></tr></thead><tbody>`
            + comps.map(([n, c, w, cf]) => `<tr><td class="l">${n}${cf < 1 ? ` <span class="dim">(выборка ${Math.round(cf * 20)}/20)</span>` : ""}</td><td>${F.sgn(c - 0.5, pc(c))}</td><td class="dim">${Math.round(w * 100)}%</td><td>${F.sgn(c - 0.5, ((c - 0.5) * w * cf * 100 >= 0 ? "+" : "") + ((c - 0.5) * w * cf * 100).toFixed(1))}</td></tr>`).join("")
            + `</tbody></table>`
            + `<div class="sec">СЕТАП ${valid ? '<span class="tag on">VALID</span>' : '<span class="tag">НЕТ СИГНАЛА</span>'}</div>`
            + `<div class="kv">${kvHtml([["ЯКОРЬ", anchor ? `${anchor.kind} ${anchor.bull ? "▲" : "▼"}` : "—"], ["НАПРАВЛЕНИЕ", setupBull ? "LONG" : "SHORT"],
              ["ВХОД", anchor ? F.px(anchor.entry) : "—"], ["СТОП", anchor ? `${F.px(anchor.stop)} · ${stopDist.toFixed(2)}` : "—"],
              ["ЦЕЛЬ (DOL)", anchor ? `${dol ? dol.tag + " " : "3R "}${F.px(target)}` : "—"], ["R : R", rr ? rr.toFixed(2) + "R" : "—"],
              ["ОЦЕНКА", `${score.toFixed(0)}%`], ["РИСК ½ KELLY", riskPct != null ? `${riskPct.toFixed(2)}% · $${F.num(riskUsd, 0)}` : "—"], ["РАЗМЕР", size]])}</div>`
            + (why.length ? `<div class="note">Почему не VALID: ${why.join(" · ")}.</div>` : "")
            + `<div class="note">Оценка = 25% вероятность якоря (${pc(pAnchor)}) + 25% bias (${pc(pBias)}) + 15% SMT (${pc(pSMT)}) + 15% цель снимут (${pc(pDOL)}) + 10% слот времени (${pc(pTime)}) + 10% волатильность (${pc(pVol)}). Это взвешенная оценка из индикатора, а не откалиброванная вероятность: проверенные вероятности уровней — в ICT.</div>`
            + `<div class="sec">ДЕНЬ · ${P.dayUp.n} ДН СТАТИСТИКИ</div><div class="kv">${kvHtml([
              ["ВОЛАТИЛЬНОСТЬ 09:30–09:50", `${P.vol.regime}${P.vol.zTR != null ? ` · Z ${P.vol.zTR.toFixed(1)} · RVOL ${P.vol.rvol != null ? P.vol.rvol.toFixed(2) : "—"}` : ""}`],
              ["ДИАПАЗОН ДНЯ (МЕДИАНА)", rng.med != null ? `${F.num(rng.med, 1)} · P30–P70 ${F.num(rng.p30, 0)}–${F.num(rng.p70, 0)}` : "—"],
              ["ПРОЙДЕНО СЕГОДНЯ", done != null && rng.med ? `${F.num(done, 1)} (${Math.round((done / rng.med) * 100)}% медианы)` : "—"],
              ["ПРОЕКЦИЯ ХАЯ / ЛОЯ", td && rng.med ? `${F.px(td.lo + rng.med)} / ${F.px(td.hi - rng.med)}` : "—"],
              ["СТАТ. ЛОЙ ДНЯ", lowT], ["СТАТ. ХАЙ ДНЯ", highT],
              ["СЛОТ " + slotStr(P.slotUp.slot) + " NY ВВЕРХ", `${pc(P.slotUp.p)} · n ${P.slotUp.n}`], ["ДЕНЬ ВЫШЕ 00:00", `${pc(P.dayUp.p)} · n ${P.dayUp.n}`],
              ["ЛОЙ НЕДЕЛИ ЧАЩЕ", P.weekLow.of ? `${DOW[P.weekLow.i]} · ${P.weekLow.n} из ${P.weekLow.of} нед` : "—"],
              ["ОБЪЁМ", E.volSource]])}</div>`
            + `<div class="note">Правила индикатора ICT-QPS v21. Выборка 20 дней: время хая/лоя и дни недели на ней шаткие (смотри «n из …»). Проекция: хай ≈ лой дня + медианный диапазон, лой ≈ хай − медиана. Инструмент анализа, не торговая рекомендация.</div>`;
          ctx.setMeta(`${biasBull ? "LONG" : "SHORT"} ${pc(Math.max(pLong, pShort))} · ${valid ? "VALID" : "нет сигнала"}`);
        } catch (e) { ctx.error(e); }
      };
      load(); ctx.every(60000, load);
      return () => { dead = true; };
    },
  };
})();
