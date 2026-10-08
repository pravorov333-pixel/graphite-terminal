(() => {
  const QT = window.QT, F = QT.f;

  // ------------------------------------------------------------ clock (UTC + local, funding countdown)
  const clock = document.getElementById("clock");
  const tick = () => {
    const now = Date.now(), m = QT.mkt.BTC;
    const fund = m && m.nextFunding ? ` · FUND ${F.dur(m.nextFunding - now)}` : "";
    clock.textContent = `${F.hms(now)} UTC${fund}`;
  };
  setInterval(tick, 1000); tick();

  // ------------------------------------------------------------ ticker tape: watchlist + recent big liquidations
  const track = document.getElementById("tape-track");
  const BIG_LIQ = 250000;
  const paintTape = () => {
    const parts = QT.watch.map((b) => {
      const m = QT.mkt[b];
      return m && m.last ? `<span><b>${b}</b> ${F.px(m.last)} ${F.chg(m.chg)}</span>` : "";
    });
    const now = Date.now();
    const big = QT.liqs.filter((l) => l.usd >= BIG_LIQ && now - l.t < 1800e3).slice(0, 6)
      .map((l) => `<span class="liq">LIQ ${l.sym} ${l.side} ${F.usd(l.usd, 1)} @ ${F.px(l.px)}</span>`);
    const heads = (QT.news || []).filter((x) => now - x.t < 2700e3 && (x.lvl ?? 1) >= 2).slice(0, 3)
      .map((x) => `<span class="dim">${["", "■□□", "■■□", "■■■"][x.lvl] || ""} ${QT.esc(x.tag || x.src)}</span> <span class="hi">${QT.esc(x.title)}</span>`).map((h) => `<span>${h}</span>`);
    const html = [...big, ...heads, ...parts].join("");
    if (html && track.innerHTML !== html) track.innerHTML = html;
  };
  // repaint only when the strip restarts, so text doesn't jump mid-scroll; first paint asap
  track.addEventListener("animationiteration", paintTape);
  const first = setInterval(() => { paintTape(); if (track.textContent) clearInterval(first); }, 500);
  QT.on("liq", (ev) => { if (ev.usd >= BIG_LIQ) paintTape(); });

  // ------------------------------------------------------------ brand: the app name lives only in package.json "productName"
  window.api.appName().then((name) => {
    QT.appName = name; document.title = name;
    const words = String(name).split(/\s+/).filter(Boolean);
    const brand = document.querySelector(".brand");
    brand.innerHTML = words.length > 1 ? `<b>${QT.esc(words.map((w) => w[0]).join("").toUpperCase())}</b><span>${QT.esc(name.toUpperCase())}</span>` : `<b>${QT.esc(name.toUpperCase())}</b>`;
  }).catch(() => {});

  // ------------------------------------------------------------ go
  if (window.api.askNotify) window.api.askNotify();
  else if ("Notification" in window && Notification.permission === "default") { try { Notification.requestPermission(); } catch {} }
  QT.startMarket();
  QT.startProxies();
  QT.startFx();
  // headlines for the tape even when no NEWS panel is open
  setTimeout(() => QT.loadNews().catch(() => {}), 4000);
  setInterval(() => QT.loadNews().catch(() => {}), 180000);
  QT.initUI();
  if (QT.mobile) QT.initMobile();
  else document.getElementById("cmd").focus();       // on a phone that would pop the keyboard up over the screen
})();
