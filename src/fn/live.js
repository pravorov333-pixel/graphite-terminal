(() => {
  const QT = window.QT, F = QT.f;
  // ============================================================ LIVE — real-time world board
  const GROUPS = [
    ["ИНДЕКСЫ", [["NQ", "Nasdaq-100 фьючерс"], ["ES", "S&P 500 фьючерс"], ["QQQ", "Nasdaq-100 ETF"], ["SPY", "S&P 500 ETF"], ["IWM", "Малые компании"], ["SMH", "Полупроводники"]]],
    ["ГИГАНТЫ", [["NVDA", "Nvidia"], ["MSFT", "Microsoft"], ["AAPL", "Apple"], ["AMZN", "Amazon"], ["META", "Meta"], ["GOOGL", "Alphabet"], ["AVGO", "Broadcom"], ["TSLA", "Tesla"], ["NFLX", "Netflix"], ["JPM", "JPMorgan"], ["LLY", "Eli Lilly"], ["XOM", "Exxon"]]],
    ["СЫРЬЁ", [["CL", "Нефть WTI"], ["BZ", "Нефть Brent"], ["NATGAS", "Газ"], ["XAU", "Золото"], ["XAG", "Серебро"], ["COPPER", "Медь"]]],
    ["ВАЛЮТЫ", [["EURUSD", "Евро / доллар"], ["GBPUSD", "Фунт / доллар"], ["USDJPY", "Доллар / йена"], ["USDCAD", "Доллар / канадский"], ["USDCHF", "Доллар / франк"], ["AUDUSD", "Австралийский / доллар"], ["USDBRL", "Доллар / реал"]]],
    ["КРИПТА", [["BTC", "Bitcoin"], ["ETH", "Ether"], ["SOL", "Solana"]]],
  ];
  const srcOf = (s) => (QT.FXY[s] ? "YAHOO ~" : QT.FX[s] ? "KRAKEN" : QT.PROXY[s] ? "CME≈" : "BINANCE");
  const dpOf = (s, v) => (QT.isFx(s) ? (v > 50 ? 3 : 5) : null);

  QT.fn.LIVE = {
    name: "Live world", desc: "Real-time board: index futures (NQ/ES), ETFs, mega-cap stocks, oil, gas, metals, FX pairs, crypto — last, change, position in the day's range, source. Click a row to put it in focus", sym: false,
    mount(ctx) {
      const prev = {};
      const rowsHtml = () => GROUPS.map(([g, list]) => `<tr><td colspan="6" class="sec">${g}</td></tr>`
        + list.map(([s, n]) => `<tr class="click" data-s="${s}"><td class="l hi b" style="width:74px">${s}</td><td class="l mid">${n}</td><td class="px"></td><td class="ch"></td><td style="width:22%"><div class="sharebar"><div class="hbar"><i></i></div><span class="pos"></span></div></td><td class="dim src" style="width:70px">${srcOf(s)}</td></tr>`).join("")).join("");
      ctx.el.innerHTML = `<table class="t live"><thead><tr><th class="l">СИМВОЛ</th><th class="l">НАЗВАНИЕ</th><th>ЦЕНА</th><th>ЗА 24Ч</th><th>В ДНЕВНОМ ДИАПАЗОНЕ</th><th>ИСТОЧНИК</th></tr></thead><tbody>${rowsHtml()}</tbody></table>`
        + `<div class="note">Всё в реальном времени, кроме YAHOO ~ (с небольшой задержкой). Акции, ETF и сырьё — перпы Binance: торгуются 24/7, в часы биржи США идут вплотную к рынку, вне их цена модельная. NQ/ES — пересчёт с перпов QQQ/SPY в пункты фьючерса (±2–4 пункта). Валюты — Kraken. «В дневном диапазоне»: 0% — у минимума дня, 100% — у максимума. Клик по строке — инструмент в фокус.</div>`;
      const rows = [...ctx.el.querySelectorAll("tr[data-s]")];
      rows.forEach((tr) => (tr.onclick = () => QT.setFocus(tr.dataset.s)));
      const paint = () => {
        let n = 0;
        for (const tr of rows) {
          const s = tr.dataset.s, m = QT.mkt[s];
          if (!m || !m.last) continue;
          n++;
          const dp = dpOf(s, m.last), txt = dp ? m.last.toFixed(dp) : F.px(m.last);
          QT.flash(tr.querySelector(".px"), txt, m.last, prev[s]); prev[s] = m.last;
          tr.querySelector(".ch").innerHTML = F.chg(m.chg);
          const pos = m.high > m.low ? ((m.last - m.low) / (m.high - m.low)) * 100 : null;
          tr.querySelector(".hbar i").style.width = (pos ?? 0) + "%";
          tr.querySelector(".pos").textContent = pos == null ? "—" : pos.toFixed(0) + "%";
        }
        ctx.setMeta(`${n} инструментов онлайн`);
      };
      paint();
      const off = QT.on("ticker", paint);
      ctx.every(5000, paint);     // the yen pair updates outside the ticker stream
      return off;
    },
  };
})();
