// Phone layout: the same workspaces and panels, one panel per screen. A strip under the tape lists the panels of the
// workspace; tap a chip or swipe a panel's header sideways to move between them. Only the panel on screen runs
// (ui.js mounts the others when they're opened). Turned on by core.js (QT.mobile); styles are under html.mobile.
(() => {
  const QT = window.QT;

  QT.initMobile = () => {
    const U = QT.ui, grid = document.getElementById("grid");

    // ------------------------------------------------------------ panel strip
    const strip = document.createElement("nav");
    strip.id = "pstrip";
    grid.before(strip);
    const paint = () => {
      const n = U.count(), a = U.active();
      let h = "";
      for (let i = 0; i < n; i++) {
        const c = U.panel(i) || {}, def = QT.fn[c.code];
        const sym = def && def.sym ? (c.pinned && c.sym ? c.sym : QT.focusSym) : "";
        h += `<span class="pchip ${i === a ? "on" : ""}" data-i="${i}"><i>${i + 1}</i>${QT.esc(c.code)}${sym ? ` <em>${QT.esc(sym)}</em>` : ""}</span>`;
      }
      if (strip.innerHTML !== h) strip.innerHTML = h;
      const on = strip.querySelector(".pchip.on");
      if (on) on.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    strip.addEventListener("click", (e) => { const c = e.target.closest(".pchip"); if (c) U.setActive(+c.dataset.i); });
    QT.on("ui-panels", paint);
    paint();

    // ------------------------------------------------------------ swipe a panel header to change panel
    // (only the header: charts pan and tables scroll sideways inside the body)
    let sx = null, sy = 0;
    grid.addEventListener("touchstart", (e) => {
      const t = e.touches[0];
      sx = e.touches.length === 1 && e.target.closest(".pn > header") ? t.clientX : null; sy = t.clientY;
    }, { passive: true });
    grid.addEventListener("touchend", (e) => {
      if (sx == null) return;
      const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      sx = null;
      if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx)) return;
      const n = U.count(), i = U.active() + (dx < 0 ? 1 : -1);
      if (i >= 0 && i < n) U.setActive(i);
    }, { passive: true });

    // ------------------------------------------------------------ command line: menu and run buttons, tappable completions
    const line = document.getElementById("cmdline"), cmd = document.getElementById("cmd"), sugg = document.getElementById("suggest");
    cmd.placeholder = "команда: ETH · BTC FR · NQ ICT 15M";
    cmd.setAttribute("enterkeyhint", "go");
    cmd.setAttribute("autocapitalize", "characters");
    const menu = document.createElement("span");
    menu.className = "mbtn"; menu.textContent = "☰";
    menu.onclick = () => U.menu();
    line.prepend(menu);
    const go = document.createElement("span");
    go.className = "mbtn go"; go.textContent = "▶";
    // keep the keyboard up while tapping ▶
    go.addEventListener("mousedown", (e) => e.preventDefault());
    go.onclick = () => { if (cmd.value.trim()) { QT.exec(cmd.value); cmd.value = ""; cmd.blur(); } };
    line.append(go);
    cmd.addEventListener("keydown", (e) => { if (e.key === "Enter") cmd.blur(); });
    sugg.addEventListener("mousedown", (e) => e.preventDefault());
    sugg.addEventListener("click", (e) => {
      const b = e.target.closest("b"); if (!b) return;
      const toks = cmd.value.toUpperCase().split(/\s+/); toks.pop();
      cmd.value = [...toks, b.textContent, ""].join(" ").trimStart();
      cmd.focus();
    });

    // tap the focus symbol to change it
    document.getElementById("focus").addEventListener("click", () => { cmd.value = "FOCUS "; cmd.focus(); });

    // ------------------------------------------------------------ Android back button: close what's open, then leave
    const App = (window.capacitorApp || {}).App;
    if (QT.native && App) {
      App.addListener("backButton", () => {
        if (document.activeElement === cmd) return cmd.blur();
        if (QT.closeOverlays()) return;
        App.minimizeApp().catch(() => App.exitApp());
      });
    }
  };
})();
