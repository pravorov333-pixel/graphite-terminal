(() => {
  const QT = window.QT, F = QT.f, E = QT.esc;
  const kvHtml = (pairs) => pairs.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("");
  const DAY = 864e5;
  const pc2 = (x) => (x == null || !isFinite(x) ? "—" : x.toFixed(2) + "%");
  const last = (s) => (s && s.length ? s[s.length - 1] : null);

  // monthly index → YoY and annualized n-month pace
  const infl = (s) => {
    if (!s || s.length < 14) return null;
    const n = s.length - 1, v = s[n].v;
    const ann = (m) => (Math.pow(v / s[n - m].v, 12 / m) - 1) * 100;
    return { t: s[n].t, yoy: (v / s[n - 12].v - 1) * 100, prevYoy: (s[n - 1].v / s[n - 13].v - 1) * 100, m3: ann(3), m6: ann(6) };
  };
  const yoySeries = (s) => s.slice(12).map((x, i) => ({ time: x.t / 1000, value: (x.v / s[i].v - 1) * 100 }));
  const MONTHLY = new Set(["CPIAUCSL", "CPILFESL", "PCEPI", "PCEPILFE", "MICH"]);
  const trendWord = (r) => (r.m3 < r.yoy - 0.3 ? "остывает" : r.m3 > r.yoy + 0.3 ? "ускоряется" : "стабильна");
  QT.inflTrend = infl;

  // ============================================================ INFL — inflation dashboard
  QT.fn.INFL = {
    name: "Inflation", desc: "US inflation: CPI, core CPI, PCE, core PCE — YoY and 3/6-month annualized pace, expectations (breakevens, 5y5y, Michigan), Fed rate vs inflation, next CPI / PCE releases", sym: false,
    mount(ctx) {
      ctx.el.innerHTML = `<div class="split"><div class="fix top"></div><div class="grow" style="min-height:130px"><div class="chart"></div></div><div class="fix bot"></div></div>`;
      const top = ctx.el.querySelector(".top"), bot = ctx.el.querySelector(".bot");
      const chart = QT.chart(ctx.el.querySelector(".chart"));
      const pf = { type: "custom", formatter: (v) => v.toFixed(1) + "%" };
      const sCpi = chart.addLineSeries({ color: "#7a7a7a", lineWidth: 1, title: "CPI", priceFormat: pf });
      const sCore = chart.addLineSeries({ color: "#bdbdbd", lineWidth: 1, lineStyle: 2, title: "CORE CPI", priceFormat: pf });
      const sPce = chart.addLineSeries({ color: "#ffffff", lineWidth: 2, title: "CORE PCE", priceFormat: pf });
      sPce.createPriceLine({ price: 2, color: "#555", lineWidth: 1, lineStyle: 1, axisLabelVisible: true, title: "цель ФРС 2%" });
      let dead = false;
      const load = async () => {
        try {
          const from = "2018-01-01";
          const [cpi, core, pce, cpce, be5, f5y5, mich, dff, d2] = await Promise.all(
            // monthly series need years of history for YoY; daily ones only the recent tail
            ["CPIAUCSL", "CPILFESL", "PCEPI", "PCEPILFE", "T5YIE", "T5YIFR", "MICH", "DFF", "DGS2"].map((id) => QT.fred(id, MONTHLY.has(id) ? from : "2025-01-01").catch(() => [])));
          const eco = QT.loadEco ? await QT.loadEco().catch(() => null) : null;
          if (dead) return;
          sCpi.setData(yoySeries(cpi)); sCore.setData(yoySeries(core)); sPce.setData(yoySeries(cpce));
          chart.timeScale().fitContent();
          const rows = [["CPI (общий)", infl(cpi)], ["Core CPI (без еды и энергии)", infl(core)], ["PCE", infl(pce)], ["Core PCE — главный ориентир ФРС", infl(cpce)]];
          const cp = infl(cpce), fr = last(dff), two = last(d2);
          const verdict = cp ? trendWord(cp) : "—";
          top.innerHTML = `<div class="planbias ${verdict === "остывает" ? "bull" : verdict === "ускоряется" ? "bear" : ""}"><span>ИНФЛЯЦИЯ США</span><b>${verdict.toUpperCase()}</b><i>core PCE ${pc2(cp && cp.yoy)} за год · ${pc2(cp && cp.m3)} в темпе последних 3 мес</i></div>`
            + `<table class="t"><thead><tr><th class="l">ПОКАЗАТЕЛЬ</th><th>ЗА ГОД</th><th>МЕС. НАЗАД</th><th>3 МЕС (ГОДОВЫХ)</th><th>6 МЕС (ГОДОВЫХ)</th><th class="l">ТРЕНД</th><th>ДАННЫЕ ЗА</th></tr></thead><tbody>`
            + rows.map(([n, r]) => r ? `<tr><td class="l hi">${n}</td><td class="b">${pc2(r.yoy)}</td><td class="dim">${pc2(r.prevYoy)}</td><td>${F.sgn(r.yoy - r.m3, pc2(r.m3))}</td><td>${pc2(r.m6)}</td><td class="l">${trendWord(r)}</td><td class="dim">${new Date(r.t).toLocaleDateString("ru-RU", { month: "short", year: "numeric" })}</td></tr>` : "").join("")
            + `</tbody></table>`
            + `<div class="kv">${kvHtml([["СТАВКА ФРС", fr ? pc2(fr.v) : "—"], ["2-ЛЕТНЯЯ ДОХОДНОСТЬ", two ? pc2(two.v) : "—"],
              ["РЫНОК ЖДЁТ", fr && two ? (two.v - fr.v > 0.25 ? "повышений ставки" : two.v - fr.v < -0.25 ? "снижений ставки" : "ставку без изменений") : "—"],
              ["РЕАЛЬНАЯ СТАВКА (ФРС − core PCE)", fr && cp ? pc2(fr.v - cp.yoy) : "—"],
              ["ОЖИДАНИЯ 5 ЛЕТ (breakeven)", last(be5) ? pc2(last(be5).v) : "—"], ["ОЖИДАНИЯ 5y5y", last(f5y5) ? pc2(last(f5y5).v) : "—"],
              ["ОЖИДАНИЯ НАСЕЛЕНИЯ 1 ГОД", last(mich) ? pc2(last(mich).v) : "—"]])}</div>`;
          const now = Date.now(), next = (eco || []).filter((x) => x.country === "USD" && /\b(CPI|PCE|PPI)\b/.test(x.title) && x.t > now - 3600e3);
          bot.innerHTML = `<div class="sec">БЛИЖАЙШИЕ РЕЛИЗЫ ИНФЛЯЦИИ (ЭТА НЕДЕЛЯ)</div><div class="note">`
            + (next.length ? next.map((x) => `${x.impact === "High" ? "■■■" : "■■□"} ${new Date(x.t).toLocaleString("ru-RU", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} — ${E(x.title)} · прогноз ${E(x.forecast) || "—"} · было ${E(x.previous) || "—"}`).join("<br>") : "на этой неделе релизов CPI / PCE / PPI нет")
            + `</div><div class="note">Как читать: важна не сама цифра, а <b>тренд</b> (темп последних 3 месяцев против годового) и <b>сюрприз</b> в день релиза против прогноза. Инфляция выше прогноза → рынок ждёт более жёсткую ФРС → растут 2-летняя и реальная доходность → давление на Nasdaq. Ниже прогноза — наоборот. Ожидания 5y5y показывают, верит ли рынок в цель 2%: пока они стабильны, ФРС не паникует. Данные FRED (месячные выходят с задержкой ~2 недели).</div>`;
          ctx.setMeta(`core PCE ${pc2(cp && cp.yoy)} · ${verdict}`);
        } catch (e) { ctx.error(e); }
      };
      load(); ctx.every(3600e3, load);
      return () => { dead = true; chart.remove(); };
    },
  };

  // ============================================================ COT — CFTC Traders in Financial Futures
  const COT_CODE = { NQ: ["209742", "Nasdaq-100 E-mini"], ES: ["13874A", "S&P 500 E-mini"] };
  QT.cot = async (ix) => {
    const [code] = COT_CODE[ix];
    const j = await QT.get(`https://publicreporting.cftc.gov/resource/gpe5-46if.json?cftc_contract_market_code=${code}&$order=report_date_as_yyyy_mm_dd%20DESC&$limit=170`, 6 * 3600e3);
    return (j || []).map((r) => ({
      t: Date.parse(r.report_date_as_yyyy_mm_dd), oi: +r.open_interest_all,
      am: +r.asset_mgr_positions_long - +r.asset_mgr_positions_short, lev: +r.lev_money_positions_long - +r.lev_money_positions_short,
      dl: +r.dealer_positions_long_all - +r.dealer_positions_short_all,
      amL: +r.asset_mgr_positions_long, amS: +r.asset_mgr_positions_short, levL: +r.lev_money_positions_long, levS: +r.lev_money_positions_short,
      dlL: +r.dealer_positions_long_all, dlS: +r.dealer_positions_short_all,
    })).filter((x) => isFinite(x.t)).sort((a, b) => a.t - b.t);
  };
  const cotIndex = (arr, key) => { const v = arr.map((x) => x[key]), lo = Math.min(...v), hi = Math.max(...v); return hi > lo ? ((v[v.length - 1] - lo) / (hi - lo)) * 100 : 50; };
  QT.cotIndex = cotIndex;

  QT.fn.COT = {
    name: "COT positioning", desc: "CFTC Commitments of Traders for NQ / ES: asset managers, leveraged funds (hedge funds, CTAs), dealers — net positions, weekly change, 3-year COT index and extremes. Arg: NQ (default) or ES", sym: false,
    mount(ctx) {
      const ix = ctx.args.includes("ES") ? "ES" : "NQ", [, nm] = COT_CODE[ix];
      ctx.setTitle(`COT · ${nm}`);
      ctx.el.innerHTML = `<div class="split"><div class="fix top"></div><div class="grow" style="min-height:130px"><div class="chart"></div></div><div class="fix note">Отчёт CFTC по позициям на вторник, выходит в пятницу. COT-индекс = где нетто-позиция сейчас в диапазоне 3 лет (0 — минимум, 100 — максимум). Управляющие активами (пенсионные, взаимные фонды) — медленные деньги, держат тренд. Хедж-фонды и CTA — быстрые деньги: их крайние позиции (индекс ≥ 90 или ≤ 10) часто бывают у разворотов, потому что «все уже вошли» и при движении против них начинаются вынужденные закрытия (сквиз). Дилеры обычно на другой стороне сделок клиентов.</div></div>`;
      const top = ctx.el.querySelector(".top");
      const chart = QT.chart(ctx.el.querySelector(".chart"));
      const nf = { type: "custom", formatter: (v) => (v / 1000).toFixed(0) + "K" };
      const sAm = chart.addLineSeries({ color: "#ffffff", lineWidth: 2, title: "УПРАВЛЯЮЩИЕ", priceFormat: nf });
      const sLev = chart.addLineSeries({ color: "#9a9a9a", lineWidth: 2, title: "ХЕДЖ-ФОНДЫ", priceFormat: nf });
      const sDl = chart.addLineSeries({ color: "#5a5a5a", lineWidth: 1, lineStyle: 2, title: "ДИЛЕРЫ", priceFormat: nf });
      let dead = false;
      const load = async () => {
        try {
          const c = await QT.cot(ix);
          if (dead) return;
          if (c.length < 10) throw new Error("CFTC не вернул данные");
          const ser = (k) => c.map((x) => ({ time: x.t / 1000, value: x[k] }));
          sAm.setData(ser("am")); sLev.setData(ser("lev")); sDl.setData(ser("dl")); chart.timeScale().fitContent();
          const L = c[c.length - 1], P = c[c.length - 2];
          const row = (n, k, l, s) => {
            const idx = cotIndex(c, k), ext = idx >= 90 ? "крайний лонг" : idx <= 10 ? "крайний шорт" : "";
            return `<tr><td class="l hi">${n}</td><td>${F.num(L[l], 0)}</td><td>${F.num(L[s], 0)}</td><td class="b">${F.sgn(L[k], F.num(L[k], 0))}</td><td>${F.sgn(L[k] - P[k], (L[k] - P[k] >= 0 ? "+" : "") + F.num(L[k] - P[k], 0))}</td><td><div class="sharebar"><div class="hbar"><i style="width:${idx}%"></i></div><span>${idx.toFixed(0)}</span></div></td><td class="l ${ext ? "hi b" : "dim"}">${ext || "—"}</td></tr>`;
          };
          const levIdx = cotIndex(c, "lev");
          top.innerHTML = `<div class="kv">${kvHtml([["ОТЧЁТ НА", new Date(L.t).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })], ["ОТКРЫТЫЙ ИНТЕРЕС", F.num(L.oi, 0) + " контр."],
            ["ХЕДЖ-ФОНДЫ (COT-ИНДЕКС)", `${levIdx.toFixed(0)} · ${levIdx >= 90 ? "толпа в лонге — риск слива" : levIdx <= 10 ? "толпа в шорте — топливо для сквиза" : "без крайностей"}`]])}</div>`
            + `<table class="t"><thead><tr><th class="l">ГРУППА</th><th>ЛОНГ</th><th>ШОРТ</th><th>НЕТТО</th><th>ЗА НЕДЕЛЮ</th><th style="width:28%">COT-ИНДЕКС 3 ГОДА</th><th class="l">КРАЙНОСТЬ</th></tr></thead><tbody>`
            + row("Управляющие активами", "am", "amL", "amS") + row("Хедж-фонды и CTA", "lev", "levL", "levS") + row("Дилеры", "dl", "dlL", "dlS") + `</tbody></table>`;
          ctx.setMeta(`хедж-фонды: индекс ${levIdx.toFixed(0)} · ${new Date(L.t).toLocaleDateString("ru-RU")}`);
        } catch (e) { ctx.error(e); }
      };
      load(); ctx.every(6 * 3600e3, load);
      return () => { dead = true; chart.remove(); };
    },
  };

  // ============================================================ SEAS — seasonality of the index
  const SEAS_SYM = { NQ: ["^NDX", "Nasdaq-100"], ES: ["^GSPC", "S&P 500"] };
  const thirdFriday = (y, m) => { const d = new Date(Date.UTC(y, m, 1)); const off = (5 - d.getUTCDay() + 7) % 7; return new Date(Date.UTC(y, m, 1 + off + 14)); };
  QT.fn.SEAS = {
    name: "Seasonality", desc: "Index seasonality over 10 years: average daily return and up-days by weekday, month, turn of month, options-expiry week and triple witching, vs the all-days baseline with 95% significance; today's context. Arg: NQ (default) or ES", sym: false,
    mount(ctx) {
      const ix = ctx.args.includes("ES") ? "ES" : "NQ", [ys, nm] = SEAS_SYM[ix];
      ctx.setTitle(`Сезонность · ${nm}`);
      let dead = false;
      const load = async () => {
        try {
          const { bars } = await QT.yahoo(ys, "10y", "1d", 24 * 3600e3);
          if (dead) return;
          const d = bars.map((b, i) => (i ? { day: b.day, r: (b.c / bars[i - 1].c - 1) * 100 } : null)).filter(Boolean);
          const all = d.map((x) => x.r), mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
          const base = mean(all), sd = Math.sqrt(mean(all.map((x) => (x - base) ** 2)));
          const days = d.map((x, i) => {
            const dt = new Date(x.day + "T12:00:00Z"), y = dt.getUTCFullYear(), m = dt.getUTCMonth();
            const tf = thirdFriday(y, m), wkStart = new Date(tf.getTime() - 4 * DAY), opex = dt >= wkStart && dt < new Date(tf.getTime() + DAY);
            const nextDay = d[i + 1] ? new Date(d[i + 1].day + "T12:00:00Z") : null, monthEnd = nextDay ? nextDay.getUTCMonth() !== m : false;
            return { ...x, dow: dt.getUTCDay(), m, opex, triple: opex && m % 3 === 2, monthEnd };
          });
          // turn of month: last trading day of the month + first three of the next
          let k = 0;
          days.forEach((x, i) => { if (i && days[i - 1].m !== x.m) k = 0; x.dom = ++k; });
          days.forEach((x) => { x.tom = x.monthEnd || x.dom <= 3; });
          const stat = (f) => { const a = days.filter(f).map((x) => x.r); if (!a.length) return null; const m = mean(a); return { m, up: a.filter((x) => x > 0).length / a.length, n: a.length, sig: Math.abs(m - base) > 1.96 * sd / Math.sqrt(a.length) }; };
          const row = (name, st, now) => st ? `<tr class="${now ? "fresh" : ""}"><td class="l ${now ? "hi b" : ""}">${name}${now ? " ◀ сейчас" : ""}</td><td class="b">${F.sgn(st.m, (st.m >= 0 ? "+" : "") + st.m.toFixed(3) + "%")}</td><td>${(st.up * 100).toFixed(0)}%</td><td class="dim">${st.n}</td><td>${F.sgn(st.m - base, (st.m - base >= 0 ? "+" : "") + (st.m - base).toFixed(3))}</td><td>${st.sig ? "✓" : '<span class="dim">шум</span>'}</td></tr>` : "";
          const today = new Date(), tdow = today.getUTCDay(), tm = today.getUTCMonth();
          const tfNow = thirdFriday(today.getUTCFullYear(), tm), inOpex = today >= new Date(tfNow.getTime() - 4 * DAY) && today <= new Date(tfNow.getTime() + DAY);
          let nextTW = null; for (let mm = tm; mm < tm + 12 && !nextTW; mm++) { const y = today.getUTCFullYear() + Math.floor(mm / 12), mo = mm % 12; if (mo % 3 === 2) { const f = thirdFriday(y, mo); if (f > today) nextTW = f; } }
          const DOWN = ["", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница"], MON = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
          const head = `<thead><tr><th class="l">ПЕРИОД</th><th>СРЕДНИЙ ДЕНЬ</th><th>ДНЕЙ РОСТА</th><th>N</th><th>ПРОТИВ БАЗЫ</th><th>ЗНАЧИМО</th></tr></thead>`;
          ctx.el.innerHTML = `<div class="kv">${kvHtml([["ВСЕ ДНИ (БАЗА)", `${(base >= 0 ? "+" : "") + base.toFixed(3)}% · рост ${(all.filter((x) => x > 0).length / all.length * 100).toFixed(0)}%`], ["ИСТОРИЯ", `${d.length} торговых дней с ${d[0].day.slice(0, 4)}`],
              ["СЕЙЧАС", `${DOWN[tdow] || "выходной"} · ${MON[tm].toLowerCase()}${inOpex ? " · неделя экспирации" : ""}`], ["СЛЕД. TRIPLE WITCHING", nextTW ? nextTW.toLocaleDateString("ru-RU", { day: "numeric", month: "long" }) : "—"]])}</div>`
            + `<div class="sec">ДНИ НЕДЕЛИ</div><table class="t">${head}<tbody>${[1, 2, 3, 4, 5].map((w) => row(DOWN[w], stat((x) => x.dow === w), w === tdow)).join("")}</tbody></table>`
            + `<div class="sec">ОСОБЫЕ ДНИ</div><table class="t">${head}<tbody>${row("Смена месяца (последний + 3 первых дня)", stat((x) => x.tom), false)}${row("Остальные дни месяца", stat((x) => !x.tom), false)}${row("Неделя экспирации опционов", stat((x) => x.opex), inOpex)}${row("Неделя triple witching (мар/июн/сен/дек)", stat((x) => x.triple), inOpex && tm % 3 === 2)}</tbody></table>`
            + `<div class="sec">МЕСЯЦЫ (СРЕДНИЙ ДЕНЬ МЕСЯЦА)</div><table class="t">${head}<tbody>${MON.map((n, i) => row(n, stat((x) => x.m === i), i === tm)).join("")}</tbody></table>`
            + `<div class="note">Индекс ${nm} (${ys}), закрытие к закрытию, 10 лет. «Против базы» — насколько средний день периода отличается от среднего дня вообще. ✓ — отличие больше статистической погрешности; «шум» — сезонность на этой выборке не подтверждается. Сезонность — слабый фактор: только как фон, никогда как причина для сделки.</div>`;
          ctx.setMeta(`база ${(base >= 0 ? "+" : "") + base.toFixed(3)}%/день · ${d.length} дней`);
        } catch (e) { ctx.error(e); }
      };
      load(); ctx.every(6 * 3600e3, load);
      return () => { dead = true; };
    },
  };
})();
