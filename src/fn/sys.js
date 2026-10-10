(() => {
  const QT = window.QT, F = QT.f;

  const SECTIONS = [
    ["MARKET", ["LIVE", "WL", "GP", "DUO", "HMAP", "MOV", "DEPTH", "TAPE"]],
    ["DERIVATIVES", ["FR", "OI", "BASIS", "LIQ", "LS", "CVD", "OPT"]],
    ["MACRO & BACKGROUND", ["MKTS", "INFL", "NLIQ", "YLD", "COT", "SEAS", "CORR", "DOM", "FNG", "FEES"]],
    ["NEWS & CALENDAR", ["NEWS", "ECO"]],
    ["ANALYTICS & TOOLS", ["TOPDOWN", "EARN", "PLAN", "ICT", "SCR", "CALC"]],
    ["SETUPS & JOURNAL", ["SETUP", "BOT", "BOTGP", "JOURNAL"]],
    ["OUR BOOK", ["PORT", "SIG", "RISK", "ORD"]],
    ["SYSTEM", ["ALRT", "GUIDE", "HELP"]],
  ];
  const EXAMPLES = [
    ["ETH FR", "symbol first: function on ETH in the active panel"],
    ["GP SOL 4H", "function first works too; 1M 5M 15M 1H 4H 1D 1W"],
    ["SOL", "ticker only: changes just the active panel (it gets pinned) · FOCUS SOL — every LINK panel"],
    ["4 ETH OI", "leading panel number: run into panel 4 instead of the active one"],
    ["FR ALL", "funding screener across all perps"],
    ["LIQ 100000", "only liquidations ≥ $100k · LIQ BTC for one symbol"],
    ["CVD BTC 1H", "spot vs perp cumulative delta, hourly"],
    ["SIG 90", "model signals with 90-day historical edge"],
    ["F1 … F5", "layouts: 2×2 · 3×2 · 1+2 · 1+3 · 3×3"],
    ["QQQ ICT 15M", "ICT study on the Nasdaq-100 perp · SPY ICT 5M · BTC ICT 1H"],
    ["SCR VOL>50M CHG>5", "screener filters · SCR TRADFI · SCR FR<0 · click headers to sort"],
    ["NEWS FED", "filtered headlines · NEWS BTC · NEWS ETF · ECO HIGH · ECO EUR"],
    ["CORR 180", "correlation window in days · NLIQ QQQ: net liquidity vs any perp"],
    ["WL ADD PEPE WIF", "add to watchlist · WL DEL PEPE"],
    ["ALRT BTC > 90000", "price alert · ALRT ETH FR > 30 (funding ann %) · ALRT LIQ > 1000000"],
    ["ALRT DEL 2 · ALRT CLR", "delete one alert · clear all"],
  ];

  QT.fn.HELP = {
    name: "Help", desc: "All functions, commands and keys", sym: false,
    mount(ctx) {
      const fnRows = SECTIONS.map(([sec, codes]) => `<tr><td colspan="2" class="sec" style="padding-top:9px">${sec}</td></tr>`
        + codes.filter((c) => QT.fn[c]).map((c) => `<tr class="click" data-c="${c}"><td class="hi b" style="width:70px">${c}</td><td class="l mid" style="white-space:normal"><span class="hi">${QT.ruName(c)}</span> — ${(QT.ru[c] || {}).short || QT.fn[c].desc}</td></tr>`).join("")).join("");
      ctx.el.innerHTML = `<table class="t"><tbody>${fnRows}</tbody></table>`
        + `<div class="sec">COMMANDS</div><table class="t"><tbody>${EXAMPLES.map(([c, d]) => `<tr><td class="hi" style="width:190px">${c}</td><td class="l mid" style="white-space:normal">${d}</td></tr>`).join("")}</tbody></table>`
        + `<div class="sec">KEYS</div><div class="note">Just start typing — the command line grabs the keys. <b>Enter</b> runs into the active panel, <b>Tab</b> in the command line completes a function, <b>↑↓</b> history, <b>Esc</b> clears. Outside it: <b>Tab</b> next panel, <b>Ctrl+1…9</b> select panel, <b>F1…F5</b> layouts. Click a panel to make it active. <b>LINK/PIN</b> in a panel header: LINK follows the focus symbol, PIN keeps its own. Click a row in WL, HMAP, MOV, FR ALL, PORT, SIG to focus that symbol.</div>`
        + `<div class="note">Data, all public and keyless: Binance futures & spot incl. TradFi perps (QQQ, SPY, gold, stocks), Bybit, OKX, Hyperliquid, Deribit, FRED, US Treasury, Yahoo (CME futures ~10 min delayed), CoinGecko, DefiLlama, alternative.me, mempool.space, Ethereum RPC, crypto & Fed RSS, ForexFactory calendar. Our book: local Cosmic Quant API. Not available for free: ETF flows, exchange netflows, token unlocks, real-time pro news.</div>`;
      ctx.el.querySelectorAll("tr[data-c]").forEach((tr) => (tr.onclick = () => QT.execFrom(ctx.index, tr.dataset.c)));
      ctx.setMeta(`${Object.keys(QT.fn).length} functions`);
    },
  };

  QT.fn.ALRT = {
    name: "Alerts", desc: "Active alerts and fired history; system notifications on trigger", sym: false,
    mount(ctx) {
      const paint = () => {
        const act = QT.alerts.map((a, i) => `<tr><td class="dim">${i + 1}</td><td class="l hi">${QT.describeAlert(a)}</td><td class="l ${a.active ? "hi" : "dim"}">${a.active ? "ARMED" : "FIRED"}</td><td>${F.date(a.id)} ${F.hm(a.id)}</td></tr>`).join("");
        const log = QT.alertLog.slice(0, 50).map((x) => `<tr><td>${F.date(x.t)} ${F.hms(x.t)}</td><td class="l hi">${x.text}</td></tr>`).join("");
        ctx.el.innerHTML = `<table class="t"><thead><tr><th>#</th><th class="l">CONDITION</th><th class="l">STATE</th><th>CREATED</th></tr></thead><tbody>${act || `<tr><td colspan="4" class="dim l">no alerts — e.g. ALRT BTC > 90000</td></tr>`}</tbody></table>`
          + `<div class="sec">FIRED</div><table class="t"><tbody>${log || `<tr><td class="dim l">nothing yet</td></tr>`}</tbody></table>`
          + `<div class="note">Alerts fire once, then stay as FIRED until deleted. Price alerts use Binance perp last price; funding alerts use the annualized rate. They work while the terminal is open.</div>`;
        ctx.setMeta(`${QT.alerts.filter((a) => a.active).length} armed`);
      };
      paint();
      const off1 = QT.on("alerts", paint), off2 = QT.on("alert-fired", paint);
      return () => { off1(); off2(); };
    },
  };
})();
