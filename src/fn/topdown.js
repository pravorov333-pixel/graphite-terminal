(() => {
  const QT = window.QT, F = QT.f, E = QT.esc;
  const kvHtml = (pairs) => pairs.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("");
  const DAY = 864e5;
  const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
  const pctCh = (a, b) => (a && b ? (a / b - 1) * 100 : null);
  const mark = (s) => (s > 0 ? `<span class="tdok">✓</span>` : s < 0 ? `<span class="tdno">✗</span>` : `<span class="dim">·</span>`);

  // daily closes: the Binance TradFi perp when one exists (real-time, no rate limit), Yahoo otherwise
  const perps = async () => {
    const ei = await QT.get(QT.FAPI + "/fapi/v1/exchangeInfo", 3600e3);
    return new Set(ei.symbols.filter((s) => s.quoteAsset === "USDT" && (s.underlyingSubType || []).includes("TradFi")).map((s) => s.baseAsset));
  };
  const daily = async (sym, set) => {
    if (set && set.has(sym)) return (await QT.klines(sym, "1d", 120, 600e3)).map((k) => ({ day: isoDay(k[0]), c: +k[4] }));
    return (await QT.yahoo(sym, "6mo", "1d", 1800e3)).bars.map((b) => ({ day: b.day, c: b.c }));
  };
  const sma = (arr, n, i = arr.length - 1) => (i + 1 >= n ? arr.slice(i - n + 1, i + 1).reduce((a, x) => a + x, 0) / n : null);

  // ============================================================ EARN data: Nasdaq.com earnings calendar (keyless)
  const NDX = new Set(["NVDA", "MSFT", "AAPL", "AMZN", "META", "AVGO", "GOOGL", "GOOG", "TSLA", "NFLX", "COST", "AMD", "PLTR", "TMUS", "CSCO", "ADBE", "PEP", "INTU", "QCOM", "TXN", "AMAT", "ISRG", "BKNG", "MU", "LRCX", "PANW", "ARM", "INTC", "SBUX", "ADP"]);
  const money = (s) => { const x = parseFloat(String(s || "").replace(/[$,()]/g, "")); return isFinite(x) ? (String(s).includes("(") ? -x : x) : null; };
  const dayRows = async (date) => {
    const past = Date.parse(date + "T23:59:59Z") < Date.now();
    const j = await QT.get(`https://api.nasdaq.com/api/calendar/earnings?date=${date}`, past ? 6 * 3600e3 : 3600e3);
    return ((j && j.data && j.data.rows) || []).map((r) => ({
      date, sym: String(r.symbol || "").toUpperCase(), name: r.name || "", mcap: money(r.marketCap), time: r.time || "",
      epsF: money(r.epsForecast), eps: money(r.eps), surprise: r.surprise != null && r.surprise !== "N/A" ? parseFloat(r.surprise) : null,
      lastEps: money(r.lastYearEPS), nEst: parseInt(r.noOfEsts) || null,
    }));
  };
  QT.earnings = async (back = 7, fwd = 10) => {
    const dates = [];
    for (let d = -back; d <= fwd; d++) { const t = new Date(Date.now() + d * DAY); if (t.getUTCDay() % 6) dates.push(isoDay(t.getTime())); }
    const all = (await Promise.allSettled(dates.map(dayRows))).flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    return all.filter((r) => r.sym);
  };
  const whenTxt = (t) => (/pre/.test(t) ? "до открытия" : /after/.test(t) ? "после закрытия" : "—");

  QT.fn.EARN = {
    name: "Earnings", desc: "Company earnings: who reports this week (time, EPS consensus, last year), who reported (actual EPS, surprise %, price reaction), beat rate. Args: ALL · 50B (min market cap, default 10B) · NDX", sym: false,
    mount(ctx) {
      const a = ctx.args, onlyNdx = a.includes("NDX"), minArg = a.map((x) => /^(\d+)B$/.exec(x)).find(Boolean);
      const minCap = a.includes("ALL") ? 0 : (minArg ? +minArg[1] : 10) * 1e9;
      let dead = false;
      const load = async () => {
        try {
          const [rows, set] = await Promise.all([QT.earnings(), perps().catch(() => new Set())]);
          if (dead) return;
          const today = isoDay(Date.now()), keep = (r) => (onlyNdx ? NDX.has(r.sym) : (r.mcap || 0) >= minCap || NDX.has(r.sym));
          const up = rows.filter((r) => r.date >= today && r.eps == null && keep(r)).sort((x, y) => (x.date === y.date ? (y.mcap || 0) - (x.mcap || 0) : x.date < y.date ? -1 : 1));
          const done = rows.filter((r) => r.eps != null && keep(r)).sort((x, y) => (x.date === y.date ? (y.mcap || 0) - (x.mcap || 0) : x.date > y.date ? -1 : 1));
          // price reaction for the largest recent reporters: report day's move (before the open) or next day's (after the close)
          const react = {};
          await Promise.allSettled(done.slice(0, 14).map(async (r) => {
            const d = await daily(r.sym, set), i = d.findIndex((x) => x.day >= r.date);
            if (i < 0) return;
            const after = /after/.test(r.time), j = after ? i + 1 : i;
            if (j < d.length && j - 1 >= 0) react[r.sym + r.date] = pctCh(d[j].c, d[j - 1].c);
          }));
          if (dead) return;
          const beats = done.filter((r) => r.surprise != null), beatRate = beats.length ? beats.filter((r) => r.surprise > 0).length / beats.length : null;
          const avgS = beats.length ? beats.reduce((s, r) => s + r.surprise, 0) / beats.length : null;
          const nextStar = up.find((r) => NDX.has(r.sym));
          const dLabel = (d) => (d === today ? "СЕГОДНЯ" : d === isoDay(Date.now() + DAY) ? "ЗАВТРА" : new Date(d + "T12:00:00Z").toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "short" }).toUpperCase());
          let h = `<div class="kv">${kvHtml([["ОТЧИТАЛИСЬ ЗА 7 ДН", `${done.length} комп.`], ["ПОБИЛИ ПРОГНОЗ EPS", beatRate != null ? `${Math.round(beatRate * 100)}%` : "—"],
            ["СРЕДНИЙ СЮРПРИЗ", avgS != null ? F.sgn(avgS, (avgS >= 0 ? "+" : "") + avgS.toFixed(1) + "%") : "—"],
            ["СЛЕДУЮЩИЙ ★ NASDAQ", nextStar ? `${E(nextStar.sym)} · ${dLabel(nextStar.date).toLowerCase()} ${whenTxt(nextStar.time)}` : "—"]])}</div>`;
          h += `<div class="sec">ОТЧИТАЮТСЯ · КАПИТАЛИЗАЦИЯ ≥ ${minCap ? F.usd(minCap, 0) : "любая"} ${onlyNdx ? "· NASDAQ" : ""}</div><table class="t news"><thead><tr><th class="l">ДЕНЬ</th><th class="l">КОГДА</th><th class="l">ТИКЕР</th><th class="l">КОМПАНИЯ</th><th>КАП.</th><th>EPS ПРОГНОЗ</th><th>ГОД НАЗАД</th><th>ОЦЕНОК</th></tr></thead><tbody>`;
          let lastD = null;
          for (const r of up.slice(0, 60)) {
            const star = NDX.has(r.sym), soon = r.date === today || r.date === isoDay(Date.now() + DAY);
            h += `<tr class="click ${soon ? "fresh" : ""}" data-s="${E(r.sym)}"><td class="l ${soon ? "hi b" : "dim"}">${r.date !== lastD ? dLabel(r.date) : ""}</td><td class="l dim">${whenTxt(r.time)}</td>`
              + `<td class="l hi b">${star ? "★ " : ""}${E(r.sym)}</td><td class="l" style="white-space:normal">${E(r.name)}</td><td>${F.usd(r.mcap, 0)}</td>`
              + `<td>${r.epsF != null ? "$" + r.epsF.toFixed(2) : "—"}</td><td class="dim">${r.lastEps != null ? "$" + r.lastEps.toFixed(2) : "—"}</td><td class="dim">${r.nEst || "—"}</td></tr>`;
            lastD = r.date;
          }
          h += (up.length ? "" : `<tr><td colspan="8" class="dim l">нет отчётов крупных компаний в ближайшие дни</td></tr>`) + `</tbody></table>`;
          h += `<div class="sec">ОТЧИТАЛИСЬ ЗА 7 ДНЕЙ</div><table class="t news"><thead><tr><th class="l">ДЕНЬ</th><th class="l">ТИКЕР</th><th class="l">КОМПАНИЯ</th><th>КАП.</th><th>EPS ФАКТ</th><th>ПРОГНОЗ</th><th>СЮРПРИЗ</th><th>РЕАКЦИЯ ЦЕНЫ</th></tr></thead><tbody>`;
          lastD = null;
          for (const r of done.slice(0, 40)) {
            const rc = react[r.sym + r.date];
            h += `<tr class="click" data-s="${E(r.sym)}"><td class="l dim">${r.date !== lastD ? dLabel(r.date) : ""}</td><td class="l hi b">${NDX.has(r.sym) ? "★ " : ""}${E(r.sym)}</td><td class="l" style="white-space:normal">${E(r.name)}</td><td>${F.usd(r.mcap, 0)}</td>`
              + `<td class="b">$${r.eps.toFixed(2)}</td><td class="dim">${r.epsF != null ? "$" + r.epsF.toFixed(2) : "—"}</td>`
              + `<td class="b">${r.surprise != null ? F.sgn(r.surprise, (r.surprise >= 0 ? "+" : "") + r.surprise.toFixed(1) + "%") : "—"}</td><td>${rc != null ? F.chg(rc, 1) : '<span class="dim">—</span>'}</td></tr>`;
            lastD = r.date;
          }
          h += (done.length ? "" : `<tr><td colspan="8" class="dim l">нет данных</td></tr>`) + `</tbody></table>`
            + `<div class="note">Источник — календарь отчётов Nasdaq.com (EPS на акцию, без выручки). ★ — крупнейшие компании Nasdaq-100: их отчёты двигают весь индекс. Реакция цены — изменение за день отчёта (до открытия) или за следующий день (после закрытия), для 14 крупнейших. Клик по строке — страница отчётов компании на Nasdaq.com.</div>`;
          ctx.el.innerHTML = h;
          ctx.el.querySelectorAll("tr[data-s]").forEach((tr) => (tr.onclick = () => QT.open(`https://www.nasdaq.com/market-activity/stocks/${tr.dataset.s.toLowerCase()}/earnings`)));
          ctx.setMeta(`${up.length} впереди · ${done.length} отчитались${beatRate != null ? ` · побили ${Math.round(beatRate * 100)}%` : ""}`);
        } catch (e) { ctx.error(e); }
      };
      load(); ctx.every(30 * 60e3, load);
      return () => { dead = true; };
    },
  };

  // ============================================================ TOPDOWN — macro → index trend → sectors → leaders
  const SECTORS = [["XLK", "Технологии"], ["SMH", "Полупроводники"], ["XLC", "Коммуникации"], ["XLY", "Потреб. (цикл.)"], ["XLF", "Финансы"], ["XLI", "Промышленность"],
    ["XLE", "Энергетика"], ["XLV", "Здравоохранение"], ["XLP", "Потреб. (защитн.)"], ["XLU", "Коммунальные"], ["IWM", "Малые компании"]];
  // the ten heaviest names of each index: they decide where the index goes
  const IDX = {
    NQ: { w: "^NDX", name: "Nasdaq-100", leaders: ["NVDA", "MSFT", "AAPL", "AMZN", "META", "AVGO", "GOOGL", "TSLA", "NFLX", "COST"] },
    ES: { w: "^GSPC", name: "S&P 500", leaders: ["NVDA", "MSFT", "AAPL", "AMZN", "META", "GOOGL", "AVGO", "BRK-B", "TSLA", "JPM"] },
  };

  QT.fn.TOPDOWN = {
    name: "Top-down", desc: "Top-down checklist, 17 factors: macro & liquidity → rates, inflation, credit spreads, VIX structure, financial conditions → index trend 1W/1D/4H/1H → sector rotation & breadth → index leaders → verdict and today's risks. Arg: NQ (default) or ES", sym: false,
    mount(ctx) {
      const ix = ctx.args.includes("ES") ? "ES" : "NQ", I = IDX[ix];
      ctx.setTitle(`Top-down · ${I.name}`);
      let dead = false;
      const load = async () => {
        try {
          const set = await perps().catch(() => new Set());
          const yd = (s, range = "6mo", iv = "1d") => QT.yahoo(s, range, iv, 1800e3).then((r) => r).catch(() => null);
          const fr = (id, from = "2025-06-01") => QT.fred(id, from).catch(() => []);
          const [nl, tnx, dxy, vix, wk, d1, h4, h1, eco, earn, dff, dgs2, real, hy, nfci, cpce, vix3] = await Promise.all([
            QT.netLiq(1).catch(() => null), yd("^TNX", "1mo"), yd("DX-Y.NYB", "1mo"), yd("^VIX", "1mo"), yd(I.w, "2y", "1wk"),
            QT.klines(ix, "1d", 200, 600e3).catch(() => null), QT.klines(ix, "4h", 200, 300e3).catch(() => null), QT.klines(ix, "1h", 200, 120e3).catch(() => null),
            QT.loadEco ? QT.loadEco().catch(() => null) : null, QT.earnings(0, 3).catch(() => []),
            fr("DFF"), fr("DGS2"), fr("DFII10"), fr("BAMLH0A0HYM2"), fr("NFCI", "2025-01-01"), fr("PCEPILFE", "2023-01-01"), yd("^VIX3M", "1mo"),
          ]);
          const secs = await Promise.all([...SECTORS.map(([s]) => s), "RSP", "SPY"].map((s) => yd(s, "3mo").then((r) => [s, r])));
          const leaders = await Promise.all(I.leaders.map((s) => daily(s, set).then((d) => [s, d]).catch(() => [s, null])));
          if (dead) return;
          const rows = [];
          const add = (sec, name, val, score, why) => rows.push({ sec, name, val, score, why });
          const closes = (y) => (y ? y.bars.map((b) => b.c) : []);
          const chN = (arr, n) => (arr.length > n ? pctCh(arr[arr.length - 1], arr[arr.length - 1 - n]) : null);

          // 1 · macro & liquidity
          if (nl && nl.length > 5) {
            const L = nl[nl.length - 1], d4 = L.v - nl[Math.max(0, nl.length - 5)].v;
            add(1, "Ликвидность ФРС (4 нед)", `$${(L.v / 1000).toFixed(2)}T · ${d4 >= 0 ? "+" : "−"}$${Math.abs(d4).toFixed(0)}B`, d4 > 25 ? 1 : d4 < -25 ? -1 : 0, d4 > 25 ? "долларов в системе больше — попутный ветер" : d4 < -25 ? "ликвидность сжимается — встречный ветер" : "без заметных изменений");
          }
          const t = closes(tnx);
          if (t.length > 5) { const bp = (t[t.length - 1] - t[t.length - 6]) * 100; add(1, "Доходность US 10Y (5 дн)", `${t[t.length - 1].toFixed(2)}% · ${bp >= 0 ? "+" : ""}${bp.toFixed(0)}bp`, bp <= -5 ? 1 : bp >= 5 ? -1 : 0, bp >= 5 ? "растёт — давит на техакции" : bp <= -5 ? "падает — поддержка для роста" : "стабильна"); }
          const dx = closes(dxy);
          if (dx.length > 5) { const c = chN(dx, 5); add(1, "Доллар DXY (5 дн)", `${dx[dx.length - 1].toFixed(2)} · ${F.pct(c, 1)}`, c <= -0.3 ? 1 : c >= 0.3 ? -1 : 0, c >= 0.3 ? "сильный доллар — риск-офф" : c <= -0.3 ? "слабый доллар — за риск" : "нейтрально"); }
          const vx = closes(vix);
          if (vx.length > 5) { const lv = vx[vx.length - 1], c = chN(vx, 5); add(1, "Волатильность VIX", `${lv.toFixed(1)} · 5 дн ${F.pct(c, 0)}`, lv < 20 && c <= 0 ? 1 : lv > 25 || c >= 20 ? -1 : 0, lv > 25 ? "страх на рынке" : lv < 20 && c <= 0 ? "спокойно, страх уходит" : "повышенная осторожность"); }

          // 2 · rates, inflation, credit, volatility structure, financial conditions
          const lv = (s, back = 0) => (s && s.length > back ? s[s.length - 1 - back].v : null);
          if (lv(dff) != null && lv(dgs2) != null) {
            const sp = lv(dgs2) - lv(dff), ch = lv(dgs2) - lv(dgs2, 20);
            add(2, "Ожидания по ставке ФРС (2Y − ставка)", `ставка ${lv(dff).toFixed(2)}% · 2Y ${lv(dgs2).toFixed(2)}% · ${sp >= 0 ? "+" : ""}${sp.toFixed(2)}`, sp < -0.25 ? 1 : sp > 0.25 ? -1 : 0,
              sp > 0.25 ? `рынок ждёт повышений ставки${ch > 0.2 ? ", ожидания растут" : ""}` : sp < -0.25 ? "рынок ждёт снижений ставки — за риск" : "ставка без изменений");
          }
          if (lv(real) != null && lv(real, 5) != null) {
            const ch = (lv(real) - lv(real, 5)) * 100;
            add(2, "Реальная доходность 10Y (5 дн)", `${lv(real).toFixed(2)}% · ${ch >= 0 ? "+" : ""}${ch.toFixed(0)}bp`, ch <= -5 ? 1 : ch >= 5 ? -1 : 0, ch >= 5 ? "растёт — главный враг оценок техакций" : ch <= -5 ? "падает — поддержка для роста" : "стабильна");
          }
          const it = QT.inflTrend ? QT.inflTrend(cpce) : null;
          if (it) add(2, "Инфляция: тренд core PCE", `${it.yoy.toFixed(2)}% за год · ${it.m3.toFixed(2)}% темп 3 мес`, it.m3 < it.yoy - 0.3 && it.m3 < 3 ? 1 : it.m3 > it.yoy + 0.3 ? -1 : 0,
            it.m3 < it.yoy - 0.3 ? "остывает — простор для мягкой ФРС" : it.m3 > it.yoy + 0.3 ? "ускоряется — ФРС будет жёстче" : "стабильна");
          if (lv(hy) != null && lv(hy, 20) != null) {
            const ch = lv(hy) - lv(hy, 20);
            add(2, "Кредитные спреды HY (20 дн)", `${lv(hy).toFixed(2)}% · ${ch >= 0 ? "+" : ""}${ch.toFixed(2)}`, ch <= -0.15 ? 1 : ch >= 0.25 ? -1 : 0, ch >= 0.25 ? "расширяются — аппетит к риску падает (ранний сигнал)" : ch <= -0.15 ? "сужаются — аппетит к риску растёт" : "стабильны");
          }
          const v3 = closes(vix3);
          if (vx.length && v3.length) {
            const ratio = vx[vx.length - 1] / v3[v3.length - 1];
            add(2, "Структура VIX (VIX / VIX 3 мес)", ratio.toFixed(2), ratio < 0.9 ? 1 : ratio > 1 ? -1 : 0, ratio > 1 ? "краткосрочный страх выше долгосрочного — стресс" : ratio < 0.9 ? "спокойная структура" : "напряжение растёт");
          }
          if (lv(nfci) != null && lv(nfci, 4) != null) {
            const ch = lv(nfci) - lv(nfci, 4);
            add(2, "Финансовые условия NFCI (4 нед)", `${lv(nfci).toFixed(2)} · ${ch >= 0 ? "+" : ""}${ch.toFixed(2)}`, lv(nfci) < 0 && ch <= 0 ? 1 : lv(nfci) > 0 || ch > 0.15 ? -1 : 0, lv(nfci) > 0 ? "жёстче среднего — деньги дорогие" : ch > 0.15 ? "быстро ужесточаются" : lv(nfci) < 0 && ch <= 0 ? "мягкие и смягчаются" : "мягкие, но ужесточаются");
          }

          // 3 · index trend across timeframes (price vs SMA and its slope)
          const tr = (k, n, label) => {
            if (!k || k.length < n + 6) return;
            const c = k.map((x) => +x[4]), m = sma(c, n), m5 = sma(c, n, c.length - 6), last = c[c.length - 1];
            const sc = last > m && m > m5 ? 1 : last < m && m < m5 ? -1 : 0;
            add(3, `${ix} ${label}`, `${F.px(last)} · ${last > m ? "выше" : "ниже"} SMA${n} ${F.pct(pctCh(last, m), 1)}`, sc, sc > 0 ? "восходящий тренд" : sc < 0 ? "нисходящий тренд" : "без чёткого тренда");
          };
          if (wk && wk.bars.length > 26) {
            const c = closes(wk), m = sma(c, 20), last = c[c.length - 1], hi52 = wk.meta.fiftyTwoWeekHigh;
            add(3, `${I.name} неделя`, `${last > m ? "выше" : "ниже"} SMA20н · ${hi52 ? F.pct(pctCh(last, hi52), 1) + " от макс. года" : ""}`, last > m ? 1 : -1, last > m ? "долгосрочный тренд вверх" : "долгосрочный тренд вниз");
          }
          tr(d1, 50, "день (1D)"); tr(h4, 50, "4 часа"); tr(h1, 50, "час (1H)");

          // 4 · sectors, rotation, breadth
          const sm = Object.fromEntries(secs.map(([s, y]) => [s, closes(y)]));
          const secRows = SECTORS.map(([s, n]) => ({ s, n, d1: chN(sm[s] || [], 1), d5: chN(sm[s] || [], 5), d20: chN(sm[s] || [], 20) })).filter((x) => x.d5 != null);
          const avg = (list) => { const v = list.map((s) => chN(sm[s] || [], 5)).filter((x) => x != null); return v.length ? v.reduce((a, x) => a + x, 0) / v.length : null; };
          const growth = avg(["XLK", "SMH", "XLY", "XLC"]), def = avg(["XLP", "XLU", "XLV"]);
          if (growth != null && def != null) { const sp = growth - def; add(4, "Ротация: рост против защиты (5 дн)", `${sp >= 0 ? "+" : ""}${sp.toFixed(1)}pp`, sp > 0.5 ? 1 : sp < -0.5 ? -1 : 0, sp > 0.5 ? "деньги идут в техно и рост — risk-on" : sp < -0.5 ? "деньги уходят в защитные — risk-off" : "ротации нет"); }
          const rsp = chN(sm.RSP || [], 20), spy = chN(sm.SPY || [], 20);
          if (rsp != null && spy != null) { const br = rsp - spy; add(4, "Ширина рынка: RSP против SPY (20 дн)", `${br >= 0 ? "+" : ""}${br.toFixed(1)}pp`, br > 0 ? 1 : br < -1 ? -1 : 0, br > 0 ? "растёт широкий рынок, не только гиганты" : br < -1 ? "рост держится на нескольких гигантах — хрупко" : "нейтрально"); }

          // 5 · index leaders
          const ld = leaders.filter(([, d]) => d && d.length > 51).map(([s, d]) => { const c = d.map((x) => x.c), m = sma(c, 50); return { s, last: c[c.length - 1], d1: pctCh(c[c.length - 1], c[c.length - 2]), above: c[c.length - 1] > m }; });
          if (ld.length >= 5) {
            const ab = ld.filter((x) => x.above).length, upn = ld.filter((x) => x.d1 > 0).length;
            add(5, `Лидеры ${I.name} выше SMA50`, `${ab} из ${ld.length} · растут сегодня ${upn}`, ab >= 0.7 * ld.length ? 1 : ab <= 0.3 * ld.length ? -1 : 0, ab >= 0.7 * ld.length ? "гиганты в тренде — индекс поддержан" : ab <= 0.3 * ld.length ? "гиганты слабые — индексу тяжело" : "лидеры разошлись");
          }

          // verdict
          const total = rows.reduce((a, r) => a + r.score, 0), n = rows.length;
          const th = Math.max(3, Math.round(n * 0.22));      // 17 factors → ±4
          const verdict = total >= th ? ["ФОН ЗА ЛОНГИ", "bull"] : total <= -th ? ["ФОН ПРОТИВ ЛОНГОВ", "bear"] : ["ФОН СМЕШАННЫЙ", "mix"];
          // today's risks: high-impact US releases and big earnings within ~1 day
          const now = Date.now(), soonEco = (eco || []).filter((x) => x.country === "USD" && x.impact === "High" && x.t > now - 3600e3 && x.t < now + 30 * 3600e3);
          const soonEarn = (earn || []).filter((r) => NDX.has(r.sym) && r.eps == null && r.date <= isoDay(now + DAY));
          const SECN = { 1: "1 · МАКРО И ЛИКВИДНОСТЬ", 2: "2 · СТАВКИ, ИНФЛЯЦИЯ, КРЕДИТ", 3: `3 · ТРЕНД ${ix} ПО ТАЙМФРЕЙМАМ`, 4: "4 · СЕКТОРЫ И ШИРИНА РЫНКА", 5: `5 · ЛИДЕРЫ ${I.name.toUpperCase()}` };
          // index switch right in the panel
          let h = `<div class="tdsw">${Object.entries(IDX).map(([k, v]) => `<span class="tag ${k === ix ? "on" : ""}" data-ix="${k}">${v.name} · ${k}</span>`).join("")}</div>`;
          h += `<div class="planbias ${verdict[1] === "bull" ? "bull" : verdict[1] === "bear" ? "bear" : ""}"><span>СВЕРХУ ВНИЗ · ${I.name.toUpperCase()}</span><b>${verdict[0]}</b><i>${total >= 0 ? "+" : ""}${total} из ±${n} факторов · порог ±${th}</i></div>`;
          h += `<table class="t td"><thead><tr><th class="l">ФАКТОР · ЧТО ЗНАЧИТ</th><th class="l">СЕЙЧАС</th><th></th></tr></thead><tbody>`;
          let sec = 0;
          for (const r of rows) {
            if (r.sec !== sec) { sec = r.sec; h += `<tr><td colspan="3" class="sec">${SECN[sec]}</td></tr>`; }
            h += `<tr><td class="l" style="white-space:normal"><span class="hi">${r.name}</span><br><span class="dim tdwhy">${r.why}</span></td><td class="l" style="white-space:normal">${r.val}</td><td style="text-align:center;width:28px">${mark(r.score)}</td></tr>`;
          }
          h += `</tbody></table>`;
          h += `<div class="sec">РИСКИ БЛИЖАЙШИХ 24 ЧАСОВ</div><div class="note">`
            + ([...soonEco.map((x) => `■ ${new Date(x.t).toLocaleString("ru-RU", { weekday: "short", hour: "2-digit", minute: "2-digit" })} — ${E(x.title)} (USD)`), ...soonEarn.map((r) => `★ ${E(r.sym)} отчёт ${r.date === isoDay(now) ? "сегодня" : "завтра"} ${whenTxt(r.time)}`)].join("<br>") || "важных релизов США и отчётов гигантов нет")
            + `</div>`;
          h += `<div class="sec">СЕКТОРЫ · 1 ДН / 5 ДН / 20 ДН</div><table class="t"><tbody>`
            + secRows.sort((a, b) => b.d5 - a.d5).map((x) => `<tr><td class="l hi" style="width:60px">${x.s}</td><td class="l mid">${x.n}</td><td>${F.chg(x.d1, 1)}</td><td class="b">${F.chg(x.d5, 1)}</td><td>${F.chg(x.d20, 1)}</td></tr>`).join("") + `</tbody></table>`;
          if (ld.length) h += `<div class="sec">ЛИДЕРЫ ${I.name.toUpperCase()} · СЕГОДНЯ · ТРЕНД</div><table class="t"><tbody>`
            + ld.map((x) => `<tr><td class="l hi b" style="width:60px">${x.s}</td><td>${F.px(x.last)}</td><td>${F.chg(x.d1, 2)}</td><td class="l ${x.above ? "hi" : "dim"}">${x.above ? "выше SMA50" : "ниже SMA50"}</td></tr>`).join("") + `</tbody></table>`;
          h += `<div class="note">Анализ сверху вниз: сначала фон (деньги, доллар, страх), потом ставки, инфляция и кредит, потом тренд индекса на старших и младших таймфреймах, потом куда текут деньги внутри рынка и держат ли рынок гиганты. Каждый фактор даёт ✓ (+1), ✗ (−1) или · (0). Это контекст для направления и размера позиции, а не сигнал входа и не проверенная на истории модель. Данные: FRED (ставки, инфляция, спреды, финансовые условия), Yahoo (ETF, VIX, доходности — с задержкой), Binance (NQ/ES в реальном времени).</div>`;
          ctx.el.innerHTML = h;
          ctx.el.querySelectorAll(".tdsw [data-ix]").forEach((el) => (el.onclick = () => { if (el.dataset.ix !== ix) QT.exec(`${ctx.index + 1} TOPDOWN ${el.dataset.ix}`); }));
          ctx.setMeta(`${verdict[0]} · ${total >= 0 ? "+" : ""}${total}/${n}`);
        } catch (e) { ctx.error(e); }
      };
      load(); ctx.every(10 * 60e3, load);
      return () => { dead = true; };
    },
  };
})();
