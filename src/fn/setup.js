(() => {
  const QT = window.QT, F = QT.f;
  // ============================================================ SETUP — the two entries that held up in the backtest (research/)
  //   RB CE      first touch of a 15m rejection block's body edge → limit at the middle of the zone (CE), stop beyond
  //              the wick (+0.02×ATR), target 2R, time stop 4 h. The limit lives 4 h and is cancelled if the stop
  //              trades first. Counts only with the trend (15m close vs SMA50 at the touch): +0.20R / trade in research.
  //   10:00      sweep through the 10:00 NY open and reclaim (indicator rules), reclaim bar closing 10:00–12:00 NY →
  //              enter at its close, stop 0.5×ATR beyond the level, target 2R: +0.73R / trade on ~50 trades (a candidate).
  // Same rules and the same data as research/step3 (the engine on the QQQ / SPY perps rescaled to NQ / ES, with the
  // perp's own volume — not the delayed CME volume the ICT panels use), run live on NQ / ES every minute. Every signal since the first start goes into a
  // log (also the ones that fired while the terminal was closed — marked "пропущен"), so the journal can compare
  // the live results with the backtest.
  const SYMS = ["NQ", "ES"], HOLD = 48, WAIT = 48, TGT = 2, BAR = 300e3;
  const COST = 0.00004;                      // ~1 NQ point round trip incl. slippage, as in the backtest
  const FINAL = new Set(["target", "stop", "time", "cancel", "expired"]);
  const BACKTEST = { RB: { r: 0.20, note: "+0.20R · 306 сделок" }, "10AM": { r: 0.73, note: "+0.73R · 49 сделок" } };
  QT.SETUP_BACKTEST = BACKTEST;
  const SETUP_RU = { RB: "RB CE", "10AM": "10:00 реклейм" };
  QT.SETUP_RU = SETUP_RU;
  const STATE_RU = { limit: "ЛИМИТ СТОИТ", open: "В СДЕЛКЕ", target: "ЦЕЛЬ", stop: "СТОП", time: "ПО ВРЕМЕНИ", cancel: "ОТМЕНА", expired: "НЕ ИСПОЛНЕН" };

  QT.setups = {};                                            // sym -> last scan
  QT.sigLog = QT.load("sigLog", []);
  if (!QT.load("sigSince", null)) QT.save("sigSince", Date.now());
  QT.sigSince = QT.load("sigSince", Date.now());
  QT.setupCfg = () => QT.load("setupCfg", { acct: QT.load("calc", { acct: 50000 }).acct || 50000, riskUsd: 250 });

  // ---------------------------------------------------------------- one scan: signals from the engine's trace
  async function scan(sym) {
    const days = QT.ICTP.statsDays + 6, trace = [];
    const [k15, k5] = await Promise.all([QT.klines(sym, "15m", days * 96, 45e3), QT.klines(sym, "5m", days * 288, 45e3)]);
    const E = QT.ictRun(k15, k5, true, trace), n = k5.length, now = Date.now();
    const h = k5.map((k) => +k[2]), l = k5.map((k) => +k[3]), c = k5.map((k) => +k[4]);
    const c15 = k15.map((k) => +k[4]), t15 = k15.map((k) => k[0]);
    const closedTo = k5[n - 1][0] + BAR <= now ? n - 1 : n - 2;          // last closed 5m bar
    const trendAt = (t) => { let i = t15.findIndex((x) => x + 15 * 60e3 > t) - 1; if (i < 0) i = t15.length - 2; if (i < 50) return null; const m = c15.slice(i - 49, i + 1).reduce((a, x) => a + x, 0) / 50; return c15[i] > m; };
    const hitStop = (d, k, s) => (d > 0 ? l[k] <= s : h[k] >= s), hitTgt = (d, k, t) => (d > 0 ? h[k] >= t : l[k] <= t);
    // a trade filled at bar `from` (the fill bar may already run into the stop when `firstBarStop`)
    const follow = (sig, from, firstBarStop) => {
      const d = sig.bull ? 1 : -1, cost = (COST * sig.entry) / sig.R;
      sig.fillT = k5[from][0];
      if (firstBarStop && hitStop(d, from, sig.stop)) return Object.assign(sig, { state: "stop", res: -1 - cost, exitT: k5[from][0] });
      for (let k = from + 1; k < Math.min(n, from + 1 + HOLD); k++) {
        if (hitStop(d, k, sig.stop)) return Object.assign(sig, { state: "stop", res: -1 - cost, exitT: k5[k][0] });
        if (hitTgt(d, k, sig.target)) return Object.assign(sig, { state: "target", res: TGT - cost, exitT: k5[k][0] });
      }
      if (from + HOLD <= closedTo) { const k = from + HOLD; return Object.assign(sig, { state: "time", res: ((c[k] - sig.entry) * d) / sig.R - cost, exitT: k5[k][0] }); }
      return Object.assign(sig, { state: "open", res: ((c[n - 1] - sig.entry) * d) / sig.R });
    };

    const sigs = [];
    for (const ev of trace) {
      const d = ev.bull ? 1 : -1, A = ev.atr, m = QT.et(ev.t).min;
      if (ev.kind === "RB") {
        const stop = ev.stop - d * 0.02 * A, R = Math.abs(ev.ce - stop);
        if (!(R >= 0.05 * A && R <= 3 * A)) continue;
        const sig = { id: `${sym}|RB|${ev.t}|${d}`, sym, setup: "RB", bull: ev.bull, t: ev.t, edge: ev.entry, entry: ev.ce, stop, R, target: ev.ce + d * TGT * R, trend: trendAt(ev.t) === ev.bull, state: "limit" };
        sig.valid = sig.trend;
        let filled = false;
        for (let k = ev.j; k < Math.min(n, ev.j + WAIT); k++) {
          if (hitStop(d, k, stop)) { Object.assign(sig, { state: "cancel", exitT: k5[k][0] }); filled = true; break; }
          if (d > 0 ? l[k] <= ev.ce : h[k] >= ev.ce) { follow(sig, k, true); filled = true; break; }
        }
        if (!filled && ev.j + WAIT <= closedTo) Object.assign(sig, { state: "expired", exitT: k5[ev.j + WAIT][0] });
        sig.actT = sig.state === "limit" ? ev.t : sig.fillT || ev.t;
        sigs.push(sig);
      } else if (ev.kind === "KO1000") {
        if (ev.j > closedTo || m < 600 || m >= 720) continue;          // reclaim bar must be closed, 10:00–12:00 NY
        const R = Math.abs(ev.entry - ev.stop);
        if (!(R >= 0.05 * A && R <= 3 * A)) continue;
        const sig = { id: `${sym}|10AM|${ev.t}|${d}`, sym, setup: "10AM", bull: ev.bull, t: ev.t, level: ev.level, entry: ev.entry, stop: ev.stop, R, target: ev.entry + d * TGT * R, trend: trendAt(ev.t) === ev.bull, valid: true };
        follow(sig, ev.j, false);
        sig.actT = ev.t + BAR;
        sigs.push(sig);
      }
    }
    // waiting list: untouched rejection blocks with the trend, nearest first; the 10:00 open while its window is open
    const trendNow = c15[c15.length - 2] > c15.slice(-51, -1).reduce((a, x) => a + x, 0) / 50;
    const px = c[n - 1], etNow = QT.et(now);
    const watch = E.zones.filter((z) => z.kind === "RB" && !z.touched && z.bull === trendNow)
      .map((z) => { const d = z.bull ? 1 : -1, stop = z.wickExt - d * 0.02 * E.atr, R = Math.abs(z.ce - stop); return { bull: z.bull, edge: z.bodyExt, ce: z.ce, stop, R, target: z.ce + d * TGT * R, dist: Math.abs(px - z.bodyExt) }; })
      .filter((w) => w.R >= 0.05 * E.atr && w.R <= 3 * E.atr).sort((a, b) => a.dist - b.dist).slice(0, 3);
    const open10 = E.opens.find((o) => o.name === "10:00");
    return { sym, t: now, px, atr: E.atr, trendNow, sigs, watch, open10, win10: etNow.min >= 600 && etNow.min < 720, etMin: etNow.min };
  }

  // ---------------------------------------------------------------- log + notifications
  const size = (R, sym) => {
    const cfg = QT.setupCfg(), P = QT.PROXY[sym]; if (!P || !(R > 0)) return null;
    const [big, mini, nb, nm] = P.pv;
    return { big: Math.floor(cfg.riskUsd / (R * big)), mini: Math.floor(cfg.riskUsd / (R * mini)), nb, nm, riskMini: R * mini };
  };
  QT.setupSize = size;
  const arrow = (b) => (b ? "▲ LONG" : "▼ SHORT");
  const msg = (s) => {
    const z = size(s.R, s.sym), sz = z ? ` · ${z.mini} ${z.nm}` : "", lv = `стоп ${F.num(s.stop, 2)} · цель ${F.num(s.target, 2)}${sz}`;
    const name = `${s.sym} ${SETUP_RU[s.setup]} ${arrow(s.bull)}`;
    if (s.state === "limit") return `${name}: поставь лимит ${F.num(s.entry, 2)} · ${lv}`;
    if (s.state === "open") return s.setup === "10AM" ? `${name}: вход по рынку ~${F.num(s.entry, 2)} · ${lv}` : `${name}: лимит исполнен ${F.num(s.entry, 2)} · ${lv}`;
    if (s.state === "cancel") return `${name}: отмени лимит — цена дошла до стопа раньше входа`;
    if (s.state === "expired") return `${name}: сними лимит — 4 часа прошли без исполнения`;
    return `${name}: сделка закрыта — ${STATE_RU[s.state]} ${s.res >= 0 ? "+" : ""}${s.res.toFixed(2)}R`;
  };
  function record(r) {
    const now = Date.now(), byId = new Map(QT.sigLog.map((x) => [x.id, x]));
    let changed = false;
    for (const s of r.sigs) {
      if (s.t < QT.sigSince) continue;
      const old = byId.get(s.id);
      if (old && FINAL.has(old.state)) continue;               // frozen once resolved
      if (old && old.state === s.state && Math.abs((old.res ?? 0) - (s.res ?? 0)) < 0.005) continue;
      const fresh = now - (s.exitT || s.actT) < 15 * 60e3;
      const entry = { ...s, seen: old ? old.seen : now, late: old ? old.late : now - s.actT > 15 * 60e3 };
      if (old) Object.assign(old, entry); else QT.sigLog.unshift(entry);
      changed = true;
      if (s.valid && fresh && (!old || old.state !== s.state) && !entry.late) QT.notify(msg(s));
    }
    if (changed) { QT.sigLog.sort((a, b) => b.t - a.t); QT.sigLog.length = Math.min(QT.sigLog.length, 3000); QT.save("sigLog", QT.sigLog); QT.emit("siglog"); }
  }

  let started = false;
  QT.startSetups = () => {
    if (started) return; started = true;
    const tick = async () => {
      for (const sym of SYMS) {
        try {
          const r = await scan(sym);
          QT.setups[sym] = r;
          record(r);
        } catch (e) { QT.setups[sym] = { ...(QT.setups[sym] || {}), error: e.message || String(e) }; }
      }
      QT.emit("setups");
    };
    setTimeout(tick, 6000); setInterval(tick, 60000);
  };
  QT.setupScan = scan;
  QT.setupMsg = msg;

  // ---------------------------------------------------------------- panel
  const kvHtml = (pairs) => pairs.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("");
  const hm = (ms) => new Date(ms).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const dm = (ms) => new Date(ms).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
  const resTxt = (s) => (s.res == null ? "—" : F.sgn(s.res, `${s.res >= 0 ? "+" : ""}${s.res.toFixed(2)}R`));

  QT.fn.SETUP = {
    name: "Setups", desc: "Live signals for the two backtested entries on NQ/ES: rejection block limit at CE with the trend, 10:00 NY open reclaim 10:00–12:00; size in contracts, notifications, forward log", sym: true, proxy: true,
    mount(ctx) {
      const b = ctx.sym;
      if (!QT.PROXY[b]) { ctx.el.innerHTML = `<div class="note">Сетапы проверены только на фьючерсах NQ и ES. Открой <b>SETUP NQ</b> или <b>SETUP ES</b>.</div>`; ctx.setMeta("только NQ / ES"); return; }
      QT.startSetups();
      const paint = () => {
        const r = QT.setups[b];
        if (!r || !r.sigs) { ctx.el.innerHTML = `<div class="note">${r && r.error ? "Ошибка: " + QT.esc(r.error) : "Считаю сигналы… (первый расчёт ~10 секунд)"}</div>`; return; }
        const cfg = QT.setupCfg(), now = Date.now();
        const live = r.sigs.filter((s) => s.valid && (s.state === "limit" || s.state === "open")).sort((a, x) => x.actT - a.actT);
        const recent = r.sigs.filter((s) => now - s.t < 36 * 3600e3 && !(s.valid && (s.state === "limit" || s.state === "open"))).sort((a, x) => x.t - a.t).slice(0, 8);
        const card = (s) => {
          const z = size(s.R, b), d = s.bull ? 1 : -1, drift = ((r.px - s.entry) * d) / s.R;
          const late = s.setup === "10AM" && s.state === "open" && drift > 0.3 ? `<div class="note warn"><span class="inv" style="padding:1px 6px">⚠ цена уже ушла на ${drift.toFixed(1)}R от входа — не догоняй, пропусти</span></div>` : "";
          const head = s.state === "limit" ? "ПОСТАВЬ ЛИМИТ" : s.setup === "10AM" && now - s.actT < 15 * 60e3 ? "ВХОД ПО РЫНКУ" : "В СДЕЛКЕ";
          return `<div class="planbias ${s.bull ? "bull" : "bear"}"><span>${head}</span><b>${arrow(s.bull)}</b><i>${SETUP_RU[s.setup]} · ${hm(s.t)}${s.trend ? " · по тренду" : ""}</i></div>`
            + `<div class="kv">${kvHtml([[s.state === "limit" ? "ЛИМИТ (CE)" : "ВХОД", F.num(s.entry, 2)], ["СТОП", `${F.num(s.stop, 2)} · ${s.R.toFixed(2)} п`], ["ЦЕЛЬ 2R", F.num(s.target, 2)],
              [`КОНТРАКТЫ (РИСК $${cfg.riskUsd})`, z ? `${z.mini} ${z.nm}${z.big ? " / " + z.big + " " + z.nb : ""}` : "—"], ["ВЫХОД ПО ВРЕМЕНИ", hm((s.fillT || s.t) + HOLD * BAR)],
              [s.state === "limit" ? "СНЯТЬ ЛИМИТ В" : "СЕЙЧАС", s.state === "limit" ? hm(s.t + WAIT * BAR) : resTxt(s)]])}</div>${late}`
            + (z && z.mini < 1 ? `<div class="note"><span class="inv" style="padding:1px 6px">⚠ даже 1 ${z.nm} рискует $${F.num(z.riskMini, 0)} — больше заданного риска, пропусти</span></div>` : "")
            + `<div class="note" style="padding-top:0"><span class="tag click" data-j="${QT.esc(s.id)}" style="cursor:pointer">→ В ЖУРНАЛ</span></div>`;
        };
        const watchRows = r.watch.map((w) => `<tr><td class="l">RB ${w.bull ? "▲" : "▼"}</td><td>${F.num(w.edge, 2)}</td><td class="hi">${F.num(w.ce, 2)}</td><td>${F.num(w.stop, 2)}</td><td>${F.num(w.target, 2)}</td><td class="dim">${F.num(w.dist, 1)} п</td></tr>`).join("");
        const o10 = r.open10, w10 = r.win10 ? (o10 ? `открытие 10:00 = <b>${F.num(o10.px, 2)}</b>${o10.armed ? ` · пробит, ждём реклейм ${o10.armed === "⇧" ? "вверх (LONG)" : "вниз (SHORT)"}` : " · ждём пробой и возврат"} · окно до 12:00 NY` : "окно 10:00–12:00 NY открыто") : r.etMin < 600 ? "окно 10:00 откроется в 10:00 NY" : "окно 10:00–12:00 NY на сегодня закрыто";
        const recRows = recent.map((s) => `<tr class="${s.valid ? "" : "dim"}"><td class="l">${dm(s.t)} ${hm(s.t)}</td><td class="l">${SETUP_RU[s.setup]} ${s.bull ? "▲" : "▼"}${s.valid ? "" : " · против тренда"}</td><td>${F.num(s.entry, 2)}</td><td class="l">${STATE_RU[s.state]}</td><td>${s.state === "cancel" || s.state === "expired" ? "—" : resTxt(s)}</td></tr>`).join("");
        ctx.el.innerHTML = (live.length ? live.map(card).join("") : `<div class="planbias"><span>СИГНАЛА НЕТ</span><b style="font-size:15px">ЖДЁМ</b><i>тренд 15m: ${r.trendNow ? "вверх — ищем LONG" : "вниз — ищем SHORT"}</i></div>`)
          + `<div class="sec">ЖДЁМ КАСАНИЯ · RB ПО ТРЕНДУ</div>`
          + (watchRows ? `<table class="t"><thead><tr><th class="l">ЗОНА</th><th>КРАЙ</th><th>ЛИМИТ CE</th><th>СТОП</th><th>ЦЕЛЬ</th><th>ДО КРАЯ</th></tr></thead><tbody>${watchRows}</tbody></table>` : `<div class="note">Нетронутых RB по тренду рядом нет.</div>`)
          + `<div class="sec">10:00 NY</div><div class="note">${w10}</div>`
          + `<div class="sec">ПОСЛЕДНИЕ 36 ЧАСОВ</div>` + (recRows ? `<table class="t"><tbody>${recRows}</tbody></table>` : `<div class="note">Сигналов не было.</div>`)
          + `<div class="form"><label><span>РИСК НА СДЕЛКУ $</span><input data-k="riskUsd" type="number" step="25" value="${cfg.riskUsd}"></label><label><span>СЧЁТ $</span><input data-k="acct" type="number" step="1000" value="${cfg.acct}"></label></div>`
          + `<div class="note"><b>RB CE</b>: цена коснулась края rejection block → лимит на середину зоны, стоп за тенью, цель 2R, лимит живёт 4 ч и снимается, если цена раньше дошла до стопа. Только по тренду (бэктест ${BACKTEST.RB.note} на сделку). <b>10:00 реклейм</b>: пробой открытия 10:00 NY и возврат, свеча возврата закрылась с 10:00 до 12:00 → вход по рынку, стоп 0.5 ATR за уровнем, цель 2R (${BACKTEST["10AM"].note} — кандидат, выборка мала). Выход по времени — через 4 ч. Уведомления приходят, пока терминал открыт; все сигналы пишутся в <b>JOURNAL</b>. Сигналы считаются по тем же данным, что и бэктест (объём перпа), поэтому набор RB здесь может немного отличаться от зон в ICT и на графике. Данные — перпы QQQ/SPY в пунктах NQ/ES (±2–4 п.): уровни сверяй со своим графиком фьючерса.</div>`;
        ctx.el.querySelectorAll("input[data-k]").forEach((i) => (i.onchange = () => { const v = { ...QT.setupCfg(), [i.dataset.k]: Math.max(1, +i.value || 1) }; QT.save("setupCfg", v); paint(); }));
        // the draft waits in QT.journalDraft: an open JOURNAL picks it up now, a closed one when it's opened
        ctx.el.querySelectorAll("[data-j]").forEach((t) => (t.onclick = () => { const s = r.sigs.find((x) => x.id === t.dataset.j); if (!s) return; QT.journalDraft = s; QT.emit("journal-draft", s); t.textContent = document.querySelector("[data-jform]") ? "✓ ЗАПОЛНЕНО В JOURNAL" : "✓ ОТКРОЙ JOURNAL — СДЕЛКА УЖЕ ЗАПОЛНЕНА"; }));
        const top = live[0];
        ctx.setMeta(top ? `${top.state === "limit" ? "ЛИМИТ" : "В СДЕЛКЕ"} ${top.bull ? "▲" : "▼"} ${F.num(top.entry, 2)}` : `ждём · тренд ${r.trendNow ? "▲" : "▼"}`);
      };
      paint();
      const off = QT.on("setups", paint);
      ctx.every(15000, () => { if (QT.setups[b] && !ctx.el.contains(document.activeElement)) paint(); });
      return () => off();
    },
  };
})();
