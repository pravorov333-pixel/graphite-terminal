(() => {
  const QT = window.QT, F = QT.f;
  const COUNT = { L1: 4, L2: 6, L3: 3, L4: 4, L5: 9 };
  const LAYOUT_NAME = { L1: "2×2", L2: "3×2", L3: "1+2", L4: "1+3", L5: "3×3" };

  // ------------------------------------------------------------ workspaces: ready-made screens for one job each
  const WS = [
    { id: "OVERVIEW", ru: "ОБЗОР", layout: "L5", panels: ["LIVE", "HMAP", "NEWS MARKETS", "WL", "GP 4H", "ECO", "FNG", "DOM", "MOV"] },
    { id: "INDEX", ru: "ИНДЕКСЫ", layout: "L4", panels: ["GP NQ 5M CLEAN", "GP ES 5M CLEAN", "MKTS", "ECO"] },
    { id: "TRADE", ru: "ТРЕЙДИНГ", layout: "L2", panels: ["TOPDOWN", "GP NQ 1H CLEAN", "NEWS MARKETS", "EARN", "NLIQ NQ", "ECO"], sizes: { L2: { c: [1.25, 1, 1], r: [1.25, 1] } } },
    { id: "DERIVS", ru: "ДЕРИВАТИВЫ", layout: "L2", panels: ["FR", "OI", "BASIS", "LS", "LIQ", "OPT"] },
    { id: "IDEAS", ru: "ИДЕИ", layout: "L1", panels: ["SCR VOL>20M", "FR ALL", "MOV", "HMAP"] },
    { id: "MACRO", ru: "МАКРО", layout: "L5", panels: ["INFL", "YLD", "NLIQ NQ", "COT", "SEAS", "CORR", "MKTS", "DOM", "ECO"] },
    { id: "ICT", ru: "ICT", layout: "L2", panels: ["ICT NQ 15M", "GP NQ 5M", "PLAN NQ", "DUO NQ ES 5M", "CALC NQ", "ECO"] },
    { id: "SETUP", ru: "СЕТАПЫ", layout: "L2", panels: ["SETUP NQ", "BOTGP NQ 5M", "BOT", "SETUP ES", "BOTGP ES 5M", "JOURNAL"], sizes: { L2: { c: [1, 1.15, 1.35], r: [1, 1] } } },
    { id: "BOOK", ru: "ПОРТФЕЛЬ", layout: "L2", panels: ["PORT", "SIG", "RISK", "ORD", "ALRT", "BASIS"] },
  ];
  const FILL = ["WL", "GP", "FR", "NEWS", "ECO", "MKTS", "LIQ", "GUIDE", "HELP"];
  const TFDEF = { GP: "1h", DUO: "5m", ICT: "15m", OI: "1h", LS: "1h", CVD: "5m" };
  const SIZES = { L1: { c: [1, 1], r: [1, 1] }, L2: { c: [1, 1, 1], r: [1, 1] }, L3: { c: [1.7, 1], r: [1, 1] }, L4: { c: [1, 1, 1], r: [1.5, 1] }, L5: { c: [1, 1, 1], r: [1, 1, 1] } };
  // "ICT QQQ 15M" -> pinned to QQQ; "SCR VOL>20M" -> args
  const spec = (s) => {
    const [code, ...rest] = s.split(" ");
    const def = QT.fn[code];
    if (def && def.sym && rest[0] && QT.isSymbolToken(rest[0]) && !(def.words || []).includes(rest[0])) return { code, sym: rest[0], pinned: true, args: rest.slice(1) };
    return { code, args: rest };
  };
  const preset = (id) => {
    const w = WS.find((x) => x.id === id) || WS[0];
    const panels = w.panels.map(spec);
    for (const c of FILL) if (panels.length < 9 && !panels.some((p) => p.code === c)) panels.push({ code: c, args: [] });
    return { layout: w.layout, panels, ...(w.sizes ? { sizes: JSON.parse(JSON.stringify(w.sizes)) } : {}) };
  };

  const store = QT.load("ws2", null) || { cur: "OVERVIEW", spaces: {}, firstRun: true, v: 2 };
  // v2: the ICT workspace moved from QQQ/SPY to NQ/ES futures points — rebuild it from the new preset
  if ((store.v || 1) < 2) { delete store.spaces.ICT; store.v = 2; }
  // v3: TRADE became the deep-analysis screen, INDEX got the day plan
  if (store.v < 3) { delete store.spaces.TRADE; delete store.spaces.INDEX; store.v = 3; }
  // v4: TRADE = top-down (macro, earnings, news, liquidity); every ICT tool lives in the ICT workspace
  if (store.v < 4) { delete store.spaces.TRADE; delete store.spaces.INDEX; delete store.spaces.ICT; store.v = 4; }
  // v5: MACRO got inflation, COT positioning and seasonality
  if (store.v < 5) { delete store.spaces.MACRO; store.v = 5; }
  // v6: OVERVIEW opens with the real-time world board
  if (store.v < 6) { delete store.spaces.OVERVIEW; store.v = 6; }
  // v7: СЕТАПЫ got the paper bot
  if (store.v < 7) { delete store.spaces.SETUP; store.v = 7; }
  // v8: СЕТАПЫ shows the bot's own charts with its trades
  if (store.v < 8) { delete store.spaces.SETUP; store.v = 8; }
  let state = store.spaces[store.cur] || preset(store.cur);
  QT.focusSym = QT.load("focus", "BTC");
  let active = 0, prev = null;
  const live = [];        // mounted panels for the current layout
  const grid = () => document.getElementById("grid");
  const persist = () => { store.spaces[store.cur] = state; QT.save("ws2", store); QT.save("focus", QT.focusSym); };

  // ------------------------------------------------------------ panels
  function mountPanel(i) {
    const cfg = state.panels[i], p = live[i];
    if (p.cleanup) { try { p.cleanup(); } catch (e) { console.error(e); } }
    p.extra.forEach((f) => { try { f(); } catch {} });
    p.extra = [];
    closeHelp(i);
    const def = QT.fn[cfg.code];
    const sym = def && def.sym ? (cfg.pinned && cfg.sym ? cfg.sym : QT.focusSym) : null;
    if (def && def.sym && !cfg.pinned) cfg.sym = sym;
    // NQ / ES are QQQ / SPY perps rescaled to futures points: price is genuine, but the perp's own flow (funding, OI,
    // tape, book, CVD, long/short) is a tiny Binance market that says nothing about CME — those functions don't run on them
    const blocked = sym && QT.PROXY[sym] && def && !def.proxy;
    const fxBlocked = sym && QT.isFx(sym) && def && !def.fx;
    const tfNow = def && def.tfs ? ((cfg.args || []).find(QT.isTf) || TFDEF[cfg.code] || def.tfs[1]).toLowerCase() : null;
    p.head.innerHTML = `<span class="no">${i + 1}</span><span class="code" title="Сменить функцию в этой панели">${cfg.code} ▾</span>`
      + (sym ? `<span class="sym">${sym}</span>` : "")
      + `<span class="ttl">${def ? QT.ruName(cfg.code) : "неизвестная функция"}</span>`
      + (tfNow ? `<span class="tfs">${def.tfs.map((t) => `<span class="tfc ${t === tfNow ? "on" : ""}" data-tf="${t}">${t.toUpperCase()}</span>`).join("")}</span>` : "")
      + `<span class="meta"></span>`
      + (def && def.sym ? `<span class="link ${cfg.pinned ? "pinned" : ""}" title="${cfg.pinned ? "PIN: панель держит свою монету. Нажми, чтобы снова следовать фокусу" : "LINK: панель следует за фокусом. Нажми, чтобы закрепить текущую монету"}">${cfg.pinned ? "PIN" : "LINK"}</span>` : "")
      + `<span class="qbtn" title="Что это и как читать">?</span>`;
    const meta = p.head.querySelector(".meta"), ttl = p.head.querySelector(".ttl");
    const link = p.head.querySelector(".link");
    if (link) link.onclick = (e) => { e.stopPropagation(); cfg.pinned = !cfg.pinned; persist(); mountPanel(i); };
    p.head.querySelector(".code").onclick = (e) => { e.stopPropagation(); setActive(i); openPalette(i); };
    const symEl = p.head.querySelector(".sym");
    if (symEl) {
      symEl.title = "Клик — сменить инструмент только в этой панели";
      symEl.onclick = (e) => {
        e.stopPropagation(); setActive(i);
        const inp = document.createElement("input");
        inp.className = "symin"; inp.value = sym; inp.spellcheck = false;
        symEl.replaceWith(inp); inp.focus(); inp.select();
        const done = (ok) => { const v = inp.value.trim().toUpperCase(); if (ok && QT.isSymbolToken(v)) QT.exec(`${i + 1} ${v}`); else mountPanel(i); };
        inp.onkeydown = (ev) => { ev.stopPropagation(); if (ev.key === "Enter") done(true); if (ev.key === "Escape") done(false); };
        inp.onblur = () => done(false);
      };
    }
    p.head.querySelector(".qbtn").onclick = (e) => { e.stopPropagation(); toggleHelp(i); };
    p.head.querySelectorAll(".tfc").forEach((c) => (c.onclick = (e) => {
      e.stopPropagation();
      cfg.args = [...(cfg.args || []).filter((a) => !QT.isTf(a)), c.dataset.tf.toUpperCase()];
      persist(); mountPanel(i);
    }));
    p.body.innerHTML = "";
    p.body.scrollTop = 0;
    if (!def) { p.body.innerHTML = `<div class="msg">Нет функции <b>${QT.esc(cfg.code)}</b>. Нажми ☰ ФУНКЦИИ или набери HELP.</div>`; return; }
    if (fxBlocked) {
      p.body.innerHTML = `<div class="msg"><b>${cfg.code}</b> для ${sym} не показывается.<br><br>${sym} — валютная пара: цена в реальном времени идёт с ${QT.FX[sym] ? "Kraken" : "Yahoo (с небольшой задержкой)"}. Фандинга, OI, стакана Binance у неё нет, а бесплатной истории (около 720 свечей) не хватает для статистики ICT за 20 дней.<br><br>Для валют работают: <b>GP</b> (график), <b>DUO</b> (два графика, например DUO EURUSD GBPUSD), <b>CALC</b>, вотчлист и алерты.</div>`;
      return;
    }
    if (blocked) {
      p.body.innerHTML = `<div class="msg"><b>${cfg.code}</b> для ${sym} не показывается.<br><br>${sym} в терминале — это перп ${QT.src(sym)} на Binance, пересчитанный в пункты фьючерса. Цена у него настоящая (совпадает с ${sym} на 99%), а собственный поток — фандинг, OI, лента, стакан, CVD, лонг/шорт — это маленький рынок Binance, примерно в 2 500 раз меньше CME, и на Nasdaq / S&P он не влияет.<br><br>Ордерфлоу ${sym} смотри в своей торговой платформе (Apex / Tradovate — там данные CME).<br>Для ${sym} в терминале работают: <b>GP</b>, <b>PLAN</b>, <b>ICT</b>, <b>DUO</b>, <b>CALC</b>, <b>NLIQ</b>.</div>`;
      return;
    }
    const ctx = {
      sym, args: cfg.args || [], el: p.body, index: i,
      setMeta: (h) => { meta.innerHTML = h; },
      setTitle: (t) => { ttl.textContent = t; },
      onCleanup: (f) => p.extra.push(f),
      every: (ms, f) => { const id = setInterval(f, ms); p.extra.push(() => clearInterval(id)); },
      error: (e) => { p.body.innerHTML = `<div class="msg">⚠ ${QT.esc(String(e && e.message || e))}</div>`; },
    };
    try {
      const r = def.mount(ctx);
      p.cleanup = typeof r === "function" ? r : null;
      if (r && typeof r.then === "function") r.then((c) => { p.cleanup = typeof c === "function" ? c : null; }).catch(ctx.error);
    } catch (e) { console.error(e); ctx.error(e); }
  }

  // "?" explainer over a panel's body
  function toggleHelp(i) {
    const p = live[i]; if (!p) return;
    if (p.help) return closeHelp(i);
    const code = state.panels[i].code, r = QT.ru[code] || {};
    const block = (t, h) => (h ? `<div class="hsec">${t}</div><p>${h}</p>` : "");
    const ov = document.createElement("div");
    ov.className = "hov";
    ov.innerHTML = `<div class="hhead"><b>${code}</b> ${r.name || ""}<span class="hx" title="Закрыть">✕</span></div>`
      + (r.short ? `<p class="mid">${r.short}</p>` : "")
      + block("ЧТО ПОКАЗЫВАЕТ", r.what) + block("КАК ЧИТАТЬ", r.read) + block("КАК ИСПОЛЬЗОВАТЬ", r.use)
      + (!r.what && !r.read ? `<p class="mid">Пояснения не нужны — это справочная панель.</p>` : "");
    ov.querySelector(".hx").onclick = () => closeHelp(i);
    p.el.appendChild(ov); p.help = ov;
    p.head.querySelector(".qbtn").classList.add("on");
  }
  function closeHelp(i) {
    const p = live[i]; if (!p || !p.help) return;
    p.help.remove(); p.help = null;
    const q = p.head.querySelector(".qbtn"); if (q) q.classList.remove("on");
  }

  function render() {
    live.forEach((p) => { if (p.cleanup) try { p.cleanup(); } catch {} p.extra.forEach((f) => { try { f(); } catch {} }); });
    live.length = 0;
    const g = grid();
    g.className = state.layout;
    g.innerHTML = "";
    const n = COUNT[state.layout];
    if (active >= n) active = 0;
    prev = null;
    for (let i = 0; i < n; i++) {
      const el = document.createElement("section");
      el.className = "pn" + (i === active ? " active" : "");
      el.innerHTML = "<header></header><div class=\"pb\"></div>";
      el.addEventListener("mousedown", () => setActive(i));
      el.firstChild.addEventListener("mousedown", (e) => startDrag(e, i));
      g.appendChild(el);
      live.push({ el, head: el.firstChild, body: el.lastChild, cleanup: null, extra: [], help: null });
      mountPanel(i);
    }
    applySizes();
    renderKeys();
    renderFocus();
    renderWs();
  }

  // ------------------------------------------------------------ resizable tracks: drag the gaps between panels
  const sizesOf = () => { state.sizes ||= {}; return (state.sizes[state.layout] ||= JSON.parse(JSON.stringify(SIZES[state.layout]))); };
  function applySizes() {
    const g = grid(), z = sizesOf();
    g.style.gridTemplateColumns = z.c.map((f) => `minmax(0,${f}fr)`).join(" ");
    g.style.gridTemplateRows = z.r.map((f) => `minmax(0,${f}fr)`).join(" ");
    placeSplitters();
  }
  function placeSplitters() {
    const g = grid();
    g.querySelectorAll(".spl").forEach((x) => x.remove());
    const cs = getComputedStyle(g), W = cs.gridTemplateColumns.split(" ").map(parseFloat), H = cs.gridTemplateRows.split(" ").map(parseFloat);
    if (W.some(isNaN) || H.some(isNaN)) return;
    const gap = 1, edge = (arr, k) => arr.slice(0, k + 1).reduce((a, b) => a + b, 0) + k * gap;
    const mk = (axis, k, pos, from) => {
      const d = document.createElement("div");
      d.className = "spl " + axis;
      d.title = "Тяни, чтобы изменить размер · двойной клик — вернуть как было";
      if (axis === "v") Object.assign(d.style, { left: pos - 3 + "px", top: from + "px", bottom: "0" });
      else Object.assign(d.style, { top: pos - 3 + "px", left: from + "px", right: "0" });
      d.addEventListener("mousedown", (e) => startResize(e, axis, k));
      d.addEventListener("dblclick", () => { state.sizes[state.layout] = JSON.parse(JSON.stringify(SIZES[state.layout])); persist(); applySizes(); });
      g.appendChild(d);
    };
    // L4's first panel spans the top row, so column gaps only exist below it; L3's spans the left column
    for (let k = 0; k < W.length - 1; k++) mk("v", k, edge(W, k), state.layout === "L4" ? H[0] + gap : 0);
    for (let k = 0; k < H.length - 1; k++) mk("h", k, edge(H, k), state.layout === "L3" ? W[0] + gap : 0);
  }
  function startResize(e, axis, k) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const g = grid(), z = sizesOf(), fr = axis === "v" ? z.c : z.r;
    const cs = getComputedStyle(g), px = (axis === "v" ? cs.gridTemplateColumns : cs.gridTemplateRows).split(" ").map(parseFloat);
    const start = axis === "v" ? e.clientX : e.clientY, a0 = px[k], b0 = px[k + 1], sumFr = fr[k] + fr[k + 1], MIN = axis === "v" ? 160 : 90;
    document.body.classList.add(axis === "v" ? "resizing-v" : "resizing-h");
    const move = (ev) => {
      const d = (axis === "v" ? ev.clientX : ev.clientY) - start;
      const a = Math.max(MIN, Math.min(a0 + b0 - MIN, a0 + d));
      fr[k] = +(sumFr * a / (a0 + b0)).toFixed(4); fr[k + 1] = +(sumFr - fr[k]).toFixed(4);
      applySizes();
    };
    const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); document.body.classList.remove("resizing-v", "resizing-h"); persist(); };
    document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
  }
  new ResizeObserver(() => placeSplitters()).observe(document.getElementById("grid"));

  // ------------------------------------------------------------ drag a panel by its header onto another to swap them
  function startDrag(e, i) {
    if (e.button !== 0 || e.target.closest(".code,.link,.qbtn,.tfc,.sym,.symin")) return;
    const x0 = e.clientX, y0 = e.clientY;
    let ghost = null, target = -1;
    const move = (ev) => {
      if (!ghost) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
        ghost = document.createElement("div"); ghost.className = "dghost";
        ghost.textContent = `⇄ ${state.panels[i].code} — отпусти на другой панели, чтобы поменять местами`;
        document.body.appendChild(ghost); document.body.classList.add("dragging");
        live[i].el.classList.add("dragsrc");
      }
      ghost.style.left = ev.clientX + 14 + "px"; ghost.style.top = ev.clientY + 12 + "px";
      const el = document.elementFromPoint(ev.clientX, ev.clientY), pn = el && el.closest(".pn");
      const t = pn ? live.findIndex((p) => p.el === pn) : -1;
      if (t !== target) { live.forEach((p, k) => p.el.classList.toggle("droptarget", k === t && t !== i)); target = t; }
    };
    const up = () => {
      document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up);
      if (!ghost) return;
      ghost.remove(); document.body.classList.remove("dragging");
      live.forEach((p) => p.el.classList.remove("droptarget", "dragsrc"));
      if (target >= 0 && target !== i) {
        [state.panels[i], state.panels[target]] = [state.panels[target], state.panels[i]];
        active = target; persist(); render();
        say(`панели ${i + 1} и ${target + 1} поменялись местами`);
      }
    };
    document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
  }

  function setActive(i) {
    if (i >= live.length) return;
    if (i !== active) prev = active;
    active = i;
    live.forEach((p, k) => p.el.classList.toggle("active", k === i));
  }

  // run a command on behalf of panel `from` (guide, help) without replacing that panel
  QT.execFrom = (from, cmd) => {
    const t = prev != null && prev !== from && prev < live.length ? prev : from === 0 ? 1 : 0;
    QT.exec(`${t + 1} ${cmd}`);
  };

  QT.setFocus = (sym) => {
    sym = QT.base(sym);
    if (sym === QT.focusSym) return;
    QT.focusSym = sym;
    persist();
    live.forEach((p, i) => {
      const cfg = state.panels[i], def = QT.fn[cfg.code];
      if (def && def.sym && !cfg.pinned) mountPanel(i);
    });
    renderFocus();
  };

  function renderFocus() {
    const m = QT.mkt[QT.focusSym];
    document.getElementById("focus").innerHTML = `<span title="Монета, которую показывают все панели с меткой LINK. Сменить: набери тикер и Enter">ФОКУС</span> <b>${QT.focusSym}</b> `
      + (m && m.last ? `${F.px(m.last)} ${F.chg(m.chg)}` : "");
  }
  QT.on("ticker", renderFocus);

  // ------------------------------------------------------------ workspaces bar
  function renderWs() {
    const el = document.getElementById("ws");
    el.innerHTML = WS.map((w, i) => `<span class="wtab ${w.id === store.cur ? "on" : ""}" data-ws="${w.id}" title="Alt+${i + 1}">${w.ru}</span>`).join("")
      + `<span class="wsp"></span><span class="wbtn" data-act="reset" title="Вернуть это пространство к исходному виду">СБРОС</span>`
      + `<span class="wbtn" data-act="menu" title="Все функции с поиском (Ctrl+K)">☰ ФУНКЦИИ</span><span class="wbtn hi" data-act="guide" title="Как пользоваться терминалом">? ГАЙД</span>`;
    el.querySelectorAll("[data-ws]").forEach((t) => (t.onclick = () => QT.switchWs(t.dataset.ws)));
    el.querySelector('[data-act="reset"]').onclick = resetWs;
    el.querySelector('[data-act="menu"]').onclick = () => openPalette(active);
    el.querySelector('[data-act="guide"]').onclick = () => QT.exec(`${active + 1} GUIDE`);
  }
  QT.switchWs = (id) => {
    const w = WS.find((x) => x.id === id || x.ru === id);
    if (!w) return say(`нет пространства ${id}`);
    persist();
    store.cur = w.id;
    state = store.spaces[w.id] || preset(w.id);
    active = 0;
    persist(); render();
    say(`пространство ${w.ru}`);
  };
  function resetWs() {
    state = preset(store.cur); active = 0; persist(); render();
    say("пространство сброшено к исходному виду");
  }

  // ------------------------------------------------------------ function palette (Ctrl+K or click a panel's code)
  let pal = null;
  function openPalette(target) {
    closePalette();
    pal = document.createElement("div");
    pal.className = "pal";
    pal.innerHTML = `<div class="pbox"><div class="ptop">ФУНКЦИЯ ДЛЯ ПАНЕЛИ ${target + 1} <span class="dim">· ↑↓ выбрать · Enter открыть · Esc закрыть</span></div>`
      + `<input class="pin" placeholder="поиск: график, фандинг, ICT, новости…" spellcheck="false"><div class="plist"></div></div>`;
    document.body.appendChild(pal);
    const inp = pal.querySelector(".pin"), list = pal.querySelector(".plist");
    let items = [], sel = 0;
    const draw = () => {
      const q = inp.value.trim().toLowerCase();
      items = [];
      let h = "";
      for (const [sec, codes] of QT.SECTIONS) {
        const hit = codes.filter((c) => QT.fn[c] && (!q || (c + " " + (QT.ru[c] || {}).name + " " + (QT.ru[c] || {}).short + " " + QT.fn[c].name).toLowerCase().includes(q)));
        if (!hit.length) continue;
        h += `<div class="psec">${sec}</div>`;
        for (const c of hit) {
          const r = QT.ru[c] || {};
          h += `<div class="pitem ${items.length === sel ? "on" : ""}" data-i="${items.length}"><b>${c}</b><span class="pn1">${r.name || QT.fn[c].name}</span><span class="pd">${r.short || ""}</span></div>`;
          items.push(c);
        }
      }
      list.innerHTML = h || `<div class="psec">ничего не найдено</div>`;
      list.querySelectorAll(".pitem").forEach((it) => {
        it.onmousemove = () => { if (sel !== +it.dataset.i) { sel = +it.dataset.i; mark(); } };
        it.onclick = () => choose(+it.dataset.i);
      });
    };
    const mark = () => list.querySelectorAll(".pitem").forEach((it) => it.classList.toggle("on", +it.dataset.i === sel));
    const choose = (k) => { const c = items[k]; closePalette(); if (c) QT.exec(`${target + 1} ${c}`); };
    inp.addEventListener("input", () => { sel = 0; draw(); });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { sel = Math.min(items.length - 1, sel + 1); mark(); scroll(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { sel = Math.max(0, sel - 1); mark(); scroll(); e.preventDefault(); }
      else if (e.key === "Enter") choose(sel);
      else if (e.key === "Escape") closePalette();
      e.stopPropagation();
    });
    const scroll = () => { const it = list.querySelector(".pitem.on"); if (it) it.scrollIntoView({ block: "nearest" }); };
    pal.addEventListener("mousedown", (e) => { if (e.target === pal) closePalette(); });
    draw(); inp.focus();
  }
  function closePalette() { if (pal) { pal.remove(); pal = null; } }

  // ------------------------------------------------------------ command line
  const history = QT.load("history", []);
  let hpos = -1;

  QT.exec = (raw) => {
    const toks = String(raw || "").trim().toUpperCase().split(/\s+/).filter((t) => t && t !== "GO" && t !== "<GO>");
    if (!toks.length) return;
    history.unshift(toks.join(" ")); history.length = Math.min(history.length, 50); QT.save("history", history);
    // a leading panel number targets that panel: "4 ETH OI"
    if (/^[1-9]$/.test(toks[0]) && +toks[0] <= live.length) {
      setActive(+toks.shift() - 1);
      if (!toks.length) return say(`панель ${active + 1}`);
    }
    const [t0, ...rest] = toks;

    if (/^F[1-5]$/.test(t0)) return setLayout("L" + t0[1]);
    if (t0 === "LAYOUT" && /^[1-5]$/.test(rest[0])) return setLayout("L" + rest[0]);
    if (t0 === "WS" && rest[0]) return rest[0] === "RESET" ? resetWs() : QT.switchWs(rest[0]);
    if (t0 === "MENU") return openPalette(active);
    if (t0 === "FOCUS" && rest[0] && QT.isSymbolToken(rest[0])) { QT.setFocus(rest[0]); return say(`фокус ${QT.base(rest[0])}: все панели с LINK переключились`); }
    if (t0 === "?") return toggleHelp(active);
    if (t0 === "WL" && (rest[0] === "ADD" || rest[0] === "DEL")) {
      const syms = rest.slice(1).map(QT.base);
      const list = rest[0] === "ADD" ? [...new Set([...QT.watch, ...syms])] : QT.watch.filter((s) => !syms.includes(s));
      QT.setWatch(list);
      return say(`вотчлист: ${list.join(" ")}`);
    }
    if (t0 === "ALRT" && rest.length) return alertCommand(rest);

    let code, sym = null, args;
    if (QT.fn[t0]) {
      code = t0; args = rest;
      const def = QT.fn[code];
      if (def.sym && args[0] && QT.isSymbolToken(args[0]) && !(def.words || []).includes(args[0])) sym = QT.base(args.shift());
    } else if (QT.isSymbolToken(t0)) {
      sym = QT.base(t0);
      if (rest[0] && QT.fn[rest[0]]) { code = rest[0]; args = rest.slice(1); }
      else {
        const cur = QT.fn[state.panels[active].code];
        code = cur && cur.sym ? state.panels[active].code : "GP";
        args = cur && cur.sym ? rest.length ? rest : state.panels[active].args || [] : rest;
      }
    } else return say(`не понял команду: ${toks.join(" ")} · ☰ ФУНКЦИИ или HELP`);

    const cfg = state.panels[active];
    // a symbol typed for a panel changes only that panel (it gets pinned to it); the rest of the screen stays put.
    // To move every linked panel use FOCUS <SYM> or click a row in WL / HMAP / SCR / MOV.
    const d = QT.fn[code];
    if (d.sym && sym) state.panels[active] = { code, args, pinned: true, sym };
    else state.panels[active] = { code, args, pinned: !!(cfg.pinned && d.sym), sym: cfg.sym };
    mountPanel(active);
    persist();
    say(d.sym && sym ? `${sym} — только в панели ${active + 1} (закреплена). FOCUS ${sym} — переключить все панели` : "");
  };

  function alertCommand(a) {
    if (a[0] === "DEL" && /^\d+$/.test(a[1])) { QT.delAlert(+a[1] - 1); return say("алерт удалён"); }
    if (a[0] === "CLR") { QT.alerts.length = 0; QT.save("alerts", []); QT.emit("alerts"); return say("алерты очищены"); }
    // ALRT LIQ > 1000000 · ALRT LIQ BTC > 500000 · ALRT BTC > 90000 · ALRT ETH FR > 30
    const op = a.find((x) => x === ">" || x === "<"), val = +a[a.length - 1];
    if (!op || !isFinite(val)) return say("формат: ALRT BTC > 90000 · ALRT ETH FR > 30 · ALRT LIQ > 1000000");
    if (a[0] === "LIQ") QT.addAlert({ kind: "LIQ", sym: a[1] !== op ? QT.base(a[1]) : null, op: ">", val });
    else if (a[1] === "FR") QT.addAlert({ kind: "FR", sym: QT.base(a[0]), op, val });
    else QT.addAlert({ kind: "PX", sym: QT.base(a[0]), op, val });
    say(`алерт: ${QT.describeAlert(QT.alerts[QT.alerts.length - 1])}`);
  }

  function setLayout(l) {
    state.layout = l; persist(); render();
    say(`сетка ${LAYOUT_NAME[l]}`);
  }

  const sugg = () => document.getElementById("suggest");
  function say(text) { sugg().textContent = text; }

  function suggest(v) {
    const toks = v.trim().toUpperCase().split(/\s+/), last = toks[toks.length - 1] || "";
    if (!last) return say("");
    const hits = Object.keys(QT.fn).filter((k) => k.startsWith(last)).slice(0, 6);
    sugg().innerHTML = hits.map((k) => `<b>${k}</b> ${QT.ruName(k).toLowerCase()}`).join(" · ");
  }

  function renderKeys() {
    document.getElementById("keys").innerHTML = [
      ...["L1", "L2", "L3", "L4", "L5"].map((l, i) => `<span><b>F${i + 1}</b>${LAYOUT_NAME[l]}${state.layout === l ? " ●" : ""}</span>`),
      "<span><b>ALT+1-9</b>пространства</span>", "<span><b>ТЯНИ</b>заголовок — поменять панели, щель — размер</span>", "<span><b>CTRL+K</b>функции</span>", "<span><b>CTRL+1-9</b>панель</span>",
      "<span><b>TAB</b>след. панель</span>", "<span><b>↑↓</b>история</span>", "<span><b>?</b>в панели — пояснение</span>",
    ].join("");
  }

  QT.initUI = () => {
    const cmd = document.getElementById("cmd");
    cmd.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { QT.exec(cmd.value); cmd.value = ""; hpos = -1; }
      else if (e.key === "Escape") { cmd.value = ""; say(""); cmd.blur(); }
      else if (e.key === "ArrowUp") { hpos = Math.min(history.length - 1, hpos + 1); cmd.value = history[hpos] || ""; e.preventDefault(); }
      else if (e.key === "ArrowDown") { hpos = Math.max(-1, hpos - 1); cmd.value = hpos < 0 ? "" : history[hpos]; e.preventDefault(); }
      else if (e.key === "Tab") {
        e.preventDefault();
        const toks = cmd.value.toUpperCase().split(/\s+/), last = toks.pop() || "";
        const hit = Object.keys(QT.fn).find((k) => k.startsWith(last));
        if (hit) cmd.value = [...toks, hit, ""].join(" ").trimStart();
      }
    });
    cmd.addEventListener("input", () => suggest(cmd.value));
    document.addEventListener("keydown", (e) => {
      if (pal) return;                                   // the palette handles its own keys
      if (e.ctrlKey && (e.key === "k" || e.key === "K" || e.code === "KeyK")) { e.preventDefault(); return openPalette(active); }
      if (e.altKey && /^Digit[1-9]$/.test(e.code) && WS[+e.code.slice(5) - 1]) { e.preventDefault(); return QT.switchWs(WS[+e.code.slice(5) - 1].id); }
      if (/^F[1-5]$/.test(e.key)) { e.preventDefault(); return setLayout("L" + e.key[1]); }
      if (e.key === "Escape") { live.forEach((_, i) => closeHelp(i)); return; }
      if (e.target === cmd) return;
      // form fields inside panels (CALC) keep their own keystrokes
      if (e.target.closest && e.target.closest(".pb") && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (e.ctrlKey && /^[1-9]$/.test(e.key)) { e.preventDefault(); return setActive(+e.key - 1); }
      if (e.key === "Tab") { e.preventDefault(); return setActive((active + 1) % live.length); }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) cmd.focus();
    });
    QT.on("alert-fired", (t) => say(`АЛЕРТ ▶ ${t}`));
    render();
    if (store.firstRun) {
      store.firstRun = false; persist();
      say("Впервые здесь? Нажми «? ГАЙД» справа вверху — там всё по шагам. Ctrl+K — меню функций.");
    }
  };
})();
