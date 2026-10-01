(() => {
  const QT = (window.QT = { fn: {}, mkt: {}, liqs: [], fundInt: {}, focusSym: "BTC" });
  // log where uncaught errors come from (shows up in the screenshot-mode log)
  // (the browser's harmless "ResizeObserver loop" notice is skipped)
  window.addEventListener("error", (e) => { if (/ResizeObserver loop/.test(e.message)) return; console.error("UNCAUGHT " + ((e.error && e.error.stack) || e.message).split("\n").slice(0, 6).join(" | ")); });
  // Binance split USDⓈ-M streams by route: order-book streams on /public, all other market data on /market
  QT.BN_WS = "wss://fstream.binance.com/market/ws/";
  QT.BN_WS_PUB = "wss://fstream.binance.com/public/ws/";
  QT.FAPI = "https://fapi.binance.com";

  // ------------------------------------------------------------ formatting
  const F = (QT.f = {
    px(v) {
      if (v == null || !isFinite(v)) return "—";
      const a = Math.abs(v);
      const d = a >= 1000 ? 2 : a >= 10 ? 3 : a >= 1 ? 4 : a >= 0.01 ? 5 : 7;
      return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
    },
    num(v, d = 2) { return v == null || !isFinite(v) ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); },
    big(v, d = 2) {
      if (v == null || !isFinite(v)) return "—";
      const a = Math.abs(v), s = v < 0 ? "-" : "";
      if (a >= 1e12) return s + (a / 1e12).toFixed(d) + "T";
      if (a >= 1e9) return s + (a / 1e9).toFixed(d) + "B";
      if (a >= 1e6) return s + (a / 1e6).toFixed(d) + "M";
      if (a >= 1e3) return s + (a / 1e3).toFixed(1) + "K";
      return s + a.toFixed(0);
    },
    usd(v, d = 2) { return v == null || !isFinite(v) ? "—" : (v < 0 ? "-$" : "$") + F.big(Math.abs(v), d); },
    pct(v, d = 2) { return v == null || !isFinite(v) ? "—" : (v > 0 ? "+" : "") + v.toFixed(d) + "%"; },
    cls(v) { return v > 0 ? "up" : v < 0 ? "dn" : ""; },
    chg(v, d = 2) {
      if (v == null || !isFinite(v)) return '<span class="dim">—</span>';
      return `<span class="${F.cls(v)}">${v > 0 ? "▲" : v < 0 ? "▼" : "·"} ${Math.abs(v).toFixed(d)}%</span>`;
    },
    sgn(v, txt) { return `<span class="${F.cls(v)}">${txt}</span>`; },
    hms(ms) { return new Date(ms).toISOString().slice(11, 19); },
    hm(ms) { return new Date(ms).toISOString().slice(11, 16); },
    date(ms) { return new Date(ms).toISOString().slice(0, 10); },
    dur(ms) {
      if (!isFinite(ms)) return "—";
      const s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
      return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(s % 60).padStart(2, "0")}s`;
    },
  });

  // ------------------------------------------------------------ events
  const subs = {};
  QT.on = (evt, cb) => { (subs[evt] ||= new Set()).add(cb); return () => subs[evt].delete(cb); };
  QT.emit = (evt, data) => (subs[evt] || []).forEach((cb) => { try { cb(data); } catch (e) { console.error(evt, e); } });

  // ------------------------------------------------------------ source status
  const STATUS = { BINANCE: null, STREAM: null, BYBIT: null, OKX: null, HYPERLIQUID: null, DERIBIT: null, MACRO: null, NEWS: null, BOOK: null };
  const sourceOf = (url) =>
    url.includes("binance") ? "BINANCE" : url.includes("bybit") ? "BYBIT" : url.includes("okx") ? "OKX"
      : url.includes("hyperliquid") ? "HYPERLIQUID" : url.includes("deribit") ? "DERIBIT"
      : url.includes("127.0.0.1") ? "BOOK"
      : /rss|feed|federalreserve\.gov\/feeds|faireconomy/.test(url) ? "NEWS" : "MACRO";
  const STATUS_TIP = {
    BINANCE: "Binance REST: свечи, фандинг, OI, стакан", STREAM: "живые потоки Binance: цены, ликвидации, сделки",
    BYBIT: "Bybit: фандинг и OI", OKX: "OKX: фандинг и OI", HYPERLIQUID: "Hyperliquid: фандинг и OI", DERIBIT: "Deribit: опционы и фьючерсы",
    MACRO: "FRED, Казначейство США, Yahoo, CoinGecko, DefiLlama, mempool", NEWS: "новостные ленты и экономический календарь",
    BOOK: "сервер нашего демо-портфеля (quant-sma-bot)",
  };
  QT.setStatus = (k, ok) => {
    if (STATUS[k] === ok) return;
    STATUS[k] = ok;
    const el = document.getElementById("status");
    if (el) el.innerHTML = Object.entries(STATUS).filter(([, v]) => v !== null)
      .map(([n, v]) => `<span class="st ${v ? "ok" : "bad"}" title="${STATUS_TIP[n]}${v ? "" : " — сейчас недоступен, панели покажут последние данные"}"><i></i>${n}</span>`).join("");
  };

  // ------------------------------------------------------------ http (via main process: no CORS) with TTL cache
  const cache = new Map();
  async function request(method, url, body, ttl, key, timeout) {
    const now = Date.now(), c = cache.get(key);
    if (c && c.inflight) return c.inflight;
    if (c && c.v !== undefined && now - c.t < ttl) return c.v;
    const inflight = (async () => {
      const r = await window.api.http(method, url, body, timeout);
      if (!r.ok) throw new Error(`${r.status || "ERR"} ${r.error || ""} ${url}`);
      return r.data;
    })();
    cache.set(key, { ...(c || {}), inflight });
    try {
      const v = await inflight;
      cache.set(key, { v, t: Date.now() });
      QT.setStatus(sourceOf(url), true);
      return v;
    } catch (e) {
      cache.set(key, { v: c && c.v, t: c ? c.t : 0 });
      QT.setStatus(sourceOf(url), false);
      if (c && c.v !== undefined) return c.v;   // serve stale rather than blank the panel
      throw e;
    }
  }
  QT.get = (url, ttl = 0, timeout) => request("GET", url, null, ttl, url, timeout);
  QT.post = (url, body, ttl = 0) => request("POST", url, body, ttl, url + JSON.stringify(body));

  // ------------------------------------------------------------ websockets: shared per URL, auto-reconnect
  const conns = {};
  QT.ws = (url, cb) => {
    let c = conns[url];
    if (!c) { c = conns[url] = { subs: new Set(), retry: 0, closed: false }; openWs(c, url); }
    c.subs.add(cb);
    return () => {
      c.subs.delete(cb);
      if (!c.subs.size) { c.closed = true; try { c.sock.close(); } catch {} delete conns[url]; }
    };
  };
  function openWs(c, url) {
    const s = (c.sock = new WebSocket(url));
    s.onopen = () => { c.retry = 0; QT.setStatus("STREAM", true); };
    s.onmessage = (m) => {
      let d; try { d = JSON.parse(m.data); } catch { return; }
      c.subs.forEach((f) => { try { f(d); } catch (e) { console.error(e); } });
    };
    s.onclose = () => {
      if (c.closed) return;
      QT.setStatus("STREAM", false);
      setTimeout(() => !c.closed && openWs(c, url), Math.min(15000, 500 * 2 ** c.retry++));
    };
  }

  // ------------------------------------------------------------ symbols
  QT.base = (s) => String(s || "BTC").toUpperCase().replace(/[-_]?(USDT|USDC|PERP|USD)$/, "");
  QT.isSymbolToken = (t) => /^[A-Z0-9]{2,12}$/.test(t) && !/^\d+$/.test(t) && !/^\d+(M|H|D|W)$/.test(t);
  QT.tf = (t, def = "1h") => {
    if (!t) return def;
    const m = /^(\d+)(M|H|D|W)$/.exec(String(t).toUpperCase());
    return m ? m[1] + m[2].toLowerCase() : def;
  };
  // the timeframe token anywhere in a command's arguments ("GP NQ 5M", "DUO NQ ES 15M")
  QT.isTf = (a) => /^\d+[MHDW]$/i.test(String(a));
  QT.tfIn = (args, def) => QT.tf((args || []).find(QT.isTf), def);
  QT.fundAnn = (b, rate) => {
    const r = rate ?? (QT.mkt[b] && QT.mkt[b].funding);
    return r == null ? null : r * (24 / (QT.fundInt[b] || 8)) * 365 * 100;
  };

  // ------------------------------------------------------------ global market state (all-market streams)
  QT.startMarket = async () => {
    QT.ws(QT.BN_WS + "!miniTicker@arr", (arr) => {
      for (const t of arr) {
        if (!t.s.endsWith("USDT")) continue;
        const b = t.s.slice(0, -4), m = (QT.mkt[b] ||= {});
        m.last = +t.c; m.open = +t.o; m.high = +t.h; m.low = +t.l; m.qvol = +t.q;
        m.chg = (m.last / m.open - 1) * 100; m.ts = t.E;
      }
      QT.emit("ticker");
    });
    QT.ws(QT.BN_WS + "!markPrice@arr@1s", (arr) => {
      for (const t of arr) {
        if (!t.s.endsWith("USDT")) continue;
        const m = (QT.mkt[t.s.slice(0, -4)] ||= {});
        m.mark = +t.p; m.index = +t.i; m.funding = +t.r; m.nextFunding = +t.T;
      }
      QT.emit("mark");
    });
    QT.ws(QT.BN_WS + "!forceOrder@arr", (d) => {
      const o = d.o; if (!o || !o.s.endsWith("USDT")) return;
      const px = +o.ap || +o.p, qty = +o.z || +o.q;
      // a SELL liquidation order closes a long position, a BUY closes a short
      const ev = { t: o.T, sym: o.s.slice(0, -4), side: o.S === "SELL" ? "LONG" : "SHORT", px, qty, usd: px * qty };
      QT.liqs.unshift(ev);
      if (QT.liqs.length > 5000) QT.liqs.pop();
      QT.emit("liq", ev);
    });
    try {
      const fi = await QT.get(QT.FAPI + "/fapi/v1/fundingInfo", 3600e3);
      for (const x of fi) if (x.symbol.endsWith("USDT")) QT.fundInt[x.symbol.slice(0, -4)] = +x.fundingIntervalHours || 8;
    } catch (e) { console.warn("fundingInfo", e); }
  };

  // ------------------------------------------------------------ external sources
  // escape any text that comes from third parties (news feeds, calendars) before it touches innerHTML
  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  QT.esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
  QT.open = (url) => window.api.open(url);

  // FRED series via the public CSV endpoint (no key): [{t, v}] with missing values dropped
  QT.fred = async (id, from = "2019-01-01", ttl = 6 * 3600e3) => {
    // FRED sits behind a CDN that occasionally stalls: long timeout, one retry
    const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${from}`;
    const txt = await QT.get(url, ttl, 40000).catch(() => QT.get(url, ttl, 40000));
    return String(txt).trim().split("\n").slice(1).map((l) => l.split(","))
      .filter(([, v]) => v !== "" && v !== "." && isFinite(+v)).map(([d, v]) => ({ t: Date.parse(d + "T00:00:00Z"), v: +v }));
  };

  // Yahoo chart API: meta + bars; `day` is the exchange-local calendar day
  QT.yahoo = async (sym, range = "1d", interval = "5m", ttl = 60000) => {
    const d = await QT.get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${interval}`, ttl);
    const r = d && d.chart && d.chart.result && d.chart.result[0];
    if (!r) throw new Error("yahoo: no data for " + sym);
    const q = (r.indicators.quote || [])[0] || {}, off = (r.meta.gmtoffset || 0) * 1000;
    const bars = (r.timestamp || []).map((t, i) => ({ t: t * 1000, day: new Date(t * 1000 + off).toISOString().slice(0, 10),
      o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] })).filter((b) => b.c != null);
    return { meta: r.meta, bars };
  };

  // Binance perp klines, paging back past the 1500-bar limit
  QT.klines = async (sym, tf, total = 1500, ttl = 30000) => {
    if (QT.PROXY[sym]) {
      const r = await QT.ensureRatio(sym);
      return (await QT.klines(QT.PROXY[sym].perp, tf, total, ttl)).map((k) => [k[0], k[1] * r, k[2] * r, k[3] * r, k[4] * r, ...k.slice(5)]);
    }
    let out = [], end = null;
    while (out.length < total) {
      const lim = Math.min(1500, total - out.length);
      const k = await QT.get(`${QT.FAPI}/fapi/v1/klines?symbol=${sym}USDT&interval=${tf}&limit=${lim}${end ? "&endTime=" + end : ""}`, ttl);
      if (!k.length) break;
      out = k.concat(out);
      end = k[0][0] - 1;
      if (k.length < lim) break;
    }
    return out;
  };

  // ------------------------------------------------------------ CME index futures in real time, via Binance TradFi perps
  // NQ = QQQ perp x (NQ=F / QQQ), ES = SPY perp x (ES=F / SPY). The ratio is the median over the last ~6.5h of 5-minute
  // bars matched by timestamp, so Yahoo's ~10-minute delay cancels out; it drifts only with futures fair value.
  QT.PROXY = {
    NQ: { perp: "QQQ", yf: "NQ=F", name: "Nasdaq-100 E-mini", pv: [20, 2, "NQ", "MNQ"] },
    ES: { perp: "SPY", yf: "ES=F", name: "S&P 500 E-mini", pv: [50, 5, "ES", "MES"] },
  };
  QT.ratio = {};
  QT.src = (sym) => (QT.PROXY[sym] ? QT.PROXY[sym].perp : sym);
  QT.scale = (sym) => (QT.PROXY[sym] ? (QT.ratio[sym] || {}).r || null : 1);
  QT.calibrate = async (sym) => {
    const p = QT.PROXY[sym]; if (!p) return null;
    const [y, k] = await Promise.all([QT.yahoo(p.yf, "5d", "5m", 240000), QT.get(`${QT.FAPI}/fapi/v1/klines?symbol=${p.perp}USDT&interval=5m&limit=1500`, 240000)]);
    const pm = new Map(k.map((r) => [r[0], +r[4]]));
    const rs = y.bars.filter((b) => pm.has(b.t)).slice(-78).map((b) => b.c / pm.get(b.t)).sort((a, b) => a - b);
    if (rs.length < 10) throw new Error(`cannot calibrate ${sym}: not enough matching bars`);
    const r = rs[rs.length >> 1], mad = rs.map((x) => Math.abs(x - r)).sort((a, b) => a - b)[rs.length >> 1] * 1.4826;
    QT.ratio[sym] = { r, err: mad * (pm.get(k[k.length - 1][0]) || 0), n: rs.length, t: Date.now() };
    return QT.ratio[sym];
  };
  QT.ensureRatio = async (sym) => {
    if (!QT.PROXY[sym]) return 1;
    const c = QT.ratio[sym];
    if (!c || Date.now() - c.t > 15 * 60e3) { try { await QT.calibrate(sym); } catch (e) { if (!c) throw e; } }
    return QT.ratio[sym].r;
  };
  // keep QT.mkt.NQ / QT.mkt.ES alive so watchlist, focus bar, alerts and CALC treat them like any symbol
  const feedProxies = () => {
    for (const [sym, p] of Object.entries(QT.PROXY)) {
      const q = QT.mkt[p.perp], r = QT.scale(sym);
      if (!q || !q.last || !r) continue;
      QT.mkt[sym] = { ...(QT.mkt[sym] || {}), last: q.last * r, open: q.open * r, high: q.high * r, low: q.low * r, qvol: q.qvol, chg: q.chg, ts: q.ts, proxy: true };
    }
  };
  QT.on("ticker", feedProxies);
  QT.startProxies = () => {
    const run = () => Object.keys(QT.PROXY).forEach((s) => QT.calibrate(s).catch((e) => console.warn("calibrate", s, e)));
    run(); setInterval(run, 15 * 60e3);
  };

  // ------------------------------------------------------------ book server (Cosmic Quant API)
  QT.bookGet = async (path, ttl = 10000) => {
    const base = await window.api.bookBase();
    if (!base) { QT.setStatus("BOOK", false); throw new Error("book server offline"); }
    return QT.get(base + path, ttl);
  };

  // ------------------------------------------------------------ persistence
  QT.load = (k, def) => { try { const v = JSON.parse(localStorage.getItem("qt." + k)); return v ?? def; } catch { return def; } };
  QT.save = (k, v) => { try { localStorage.setItem("qt." + k, JSON.stringify(v)); } catch {} };

  QT.watch = QT.load("watch", ["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "ADA", "AVAX", "LINK", "SUI", "LTC", "TON"]);
  QT.setWatch = (list) => { QT.watch = list; QT.save("watch", list); QT.emit("watch"); };

  // ------------------------------------------------------------ alerts
  QT.alerts = QT.load("alerts", []);
  QT.alertLog = QT.load("alertLog", []);
  const saveAlerts = () => { QT.save("alerts", QT.alerts); QT.save("alertLog", QT.alertLog.slice(0, 100)); QT.emit("alerts"); };
  QT.addAlert = (a) => { QT.alerts.push({ id: Date.now(), active: true, ...a }); saveAlerts(); };
  QT.delAlert = (n) => { QT.alerts.splice(n, 1); saveAlerts(); };
  QT.describeAlert = (a) =>
    a.kind === "LIQ" ? `LIQ ${a.sym ? a.sym + " " : ""}> ${F.usd(a.val)}`
      : a.kind === "FR" ? `${a.sym} FUNDING ANN ${a.op} ${a.val}%` : `${a.sym} ${a.op} ${a.val}`;
  // system notification + fired-alert log; also used by the economic calendar
  QT.notify = (text) => {
    QT.alertLog.unshift({ t: Date.now(), text });
    saveAlerts();
    try { new Notification(QT.appName || "Terminal", { body: text, silent: false }); } catch {}
    QT.emit("alert-fired", text);
  };
  function fire(a, text) {
    a.active = false;
    QT.notify(text);
  }
  const cmp = (op, x, v) => (op === ">" ? x > v : x < v);
  function checkAlerts() {
    for (const a of QT.alerts) {
      if (!a.active) continue;
      const m = QT.mkt[a.sym];
      if (a.kind === "PX" && m && m.last && cmp(a.op, m.last, a.val)) fire(a, `${a.sym} ${a.op} ${a.val}: last ${F.px(m.last)}`);
      if (a.kind === "FR" && m && m.funding != null) {
        const ann = QT.fundAnn(a.sym);
        if (cmp(a.op, ann, a.val)) fire(a, `${a.sym} funding ${F.pct(ann)} annualized (${a.op} ${a.val}%)`);
      }
    }
  }
  QT.on("ticker", checkAlerts);
  QT.on("mark", checkAlerts);
  QT.on("liq", (ev) => {
    for (const a of QT.alerts) {
      if (a.active && a.kind === "LIQ" && (!a.sym || a.sym === ev.sym) && ev.usd >= a.val)
        fire(a, `${ev.side} liquidation ${ev.sym} ${F.usd(ev.usd)} @ ${F.px(ev.px)}`);
    }
  });

  // ------------------------------------------------------------ charts (lightweight-charts, monochrome)
  // chart axes in the viewer's local time (lightweight-charts works in UTC by default)
  const localTick = (t, type) => {
    if (typeof t !== "number") return null;
    const d = new Date(t * 1000);
    if (type === 0) return String(d.getFullYear());
    if (type === 1) return d.toLocaleString("ru-RU", { month: "short" });
    if (type === 2) return d.toLocaleString("ru-RU", { day: "numeric", month: "short" });
    return d.toLocaleString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  };
  QT.chart = (el, extra = {}) => {
    const LC = window.LightweightCharts;
    return LC.createChart(el, {
      autoSize: true,
      layout: { background: { type: "solid", color: "#060606" }, textColor: "#777", fontFamily: "IBM Plex Mono, Consolas, monospace", fontSize: 10 },
      grid: { vertLines: { color: "#101010" }, horzLines: { color: "#101010" } },
      rightPriceScale: { borderColor: "#1c1c1c" },
      leftPriceScale: { borderColor: "#1c1c1c" },
      timeScale: { borderColor: "#1c1c1c", timeVisible: true, secondsVisible: false, tickMarkFormatter: localTick },
      localization: { locale: "ru-RU", timeFormatter: (t) => typeof t === "number" ? new Date(t * 1000).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : String(t) },
      crosshair: { mode: LC.CrosshairMode.Normal,
        vertLine: { color: "#555", labelBackgroundColor: "#2a2a2a" }, horzLine: { color: "#555", labelBackgroundColor: "#2a2a2a" } },
      handleScroll: true, handleScale: true,
      ...extra,
    });
  };
  QT.candleStyle = {
    upColor: "#000000", borderUpColor: "#e6e6e6", wickUpColor: "#e6e6e6",
    downColor: "#8a8a8a", borderDownColor: "#8a8a8a", wickDownColor: "#8a8a8a",
  };

  // tiny canvas line/scatter plot for things that aren't time series (term structures)
  QT.plot = (canvas, series, { xFmt = (v) => v, yFmt = (v) => v.toFixed(1), zero = true, xTicks = null } = {}) => {
    const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const g = canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const pts = series.flatMap((s) => s.pts);
    if (!pts.length) return;
    let x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0]));
    let y0 = Math.min(...pts.map((p) => p[1]), zero ? 0 : Infinity), y1 = Math.max(...pts.map((p) => p[1]), zero ? 0 : -Infinity);
    for (const s of series) if (s.hline != null) { y0 = Math.min(y0, s.hline); y1 = Math.max(y1, s.hline); }
    if (x1 === x0) x1 = x0 + 1;
    const pad = (y1 - y0) * 0.12 || 1; y0 -= pad; y1 += pad;
    const L = 46, R = w - 10, T = 8, B = h - 18;
    const X = (v) => L + ((v - x0) / (x1 - x0)) * (R - L), Y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (B - T);
    g.font = "10px IBM Plex Mono, Consolas, monospace"; g.fillStyle = "#666"; g.strokeStyle = "#151515";
    for (let i = 0; i <= 4; i++) {
      const v = y0 + ((y1 - y0) * i) / 4, y = Y(v);
      g.beginPath(); g.moveTo(L, y); g.lineTo(R, y); g.stroke();
      g.textAlign = "right"; g.fillText(yFmt(v), L - 6, y + 3);
    }
    g.textAlign = "center";
    if (xTicks) xTicks.forEach(([v, lab]) => g.fillText(lab, X(v), h - 4));
    else for (let i = 0; i <= 4; i++) { const v = x0 + ((x1 - x0) * i) / 4; g.fillText(xFmt(v), X(v), h - 4); }
    if (zero && y0 < 0 && y1 > 0) { g.strokeStyle = "#444"; g.beginPath(); g.moveTo(L, Y(0)); g.lineTo(R, Y(0)); g.stroke(); }
    for (const s of series) {
      g.strokeStyle = s.color || "#fff"; g.fillStyle = s.color || "#fff"; g.lineWidth = s.width || 1.5;
      g.setLineDash(s.dash ? [4, 4] : []);
      if (s.hline != null) { g.beginPath(); g.moveTo(L, Y(s.hline)); g.lineTo(R, Y(s.hline)); g.stroke(); }
      if (s.pts.length) {
        g.beginPath(); s.pts.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])))); g.stroke();
        s.pts.forEach((p) => { g.beginPath(); g.arc(X(p[0]), Y(p[1]), 2.5, 0, Math.PI * 2); g.fill(); });
      }
      if (s.label) { g.textAlign = "left"; g.fillText(s.label, L + 6, T + 10 + 12 * series.indexOf(s)); }
    }
    g.setLineDash([]);
  };

  // set a cell's text and flash it on a price change
  QT.flash = (el, html, val, prev) => {
    if (el.innerHTML !== html) el.innerHTML = html;
    if (prev != null && val != null && val !== prev) {
      el.classList.remove("flash-up", "flash-dn"); void el.offsetWidth;
      el.classList.add(val > prev ? "flash-up" : "flash-dn");
    }
  };
})();
