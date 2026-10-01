(() => {
  const QT = window.QT, F = QT.f;
  const kvHtml = (pairs) => pairs.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("");
  const DAY = 864e5;
  const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
  const yearsAgo = (y) => isoDay(Date.now() - y * 365.25 * DAY);
  // last value at or before t in a time-sorted [{t, v}] series
  const asOf = (ser, t) => {
    let lo = 0, hi = ser.length - 1, r = null;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (ser[m].t <= t) { r = ser[m].v; lo = m + 1; } else hi = m - 1; }
    return r;
  };
  const corr = (a, b) => {
    const n = Math.min(a.length, b.length); if (n < 5) return null;
    let sa = 0, sb = 0; for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
    const ma = sa / n, mb = sb / n; let cov = 0, va = 0, vb = 0;
    for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; cov += x * y; va += x * x; vb += y * y; }
    return va && vb ? cov / Math.sqrt(va * vb) : null;
  };
  QT.corr = corr;
  const spark = (vals, w = 90, h = 18) => {
    const v = vals.filter((x) => x != null && isFinite(x)); if (v.length < 2) return "";
    const lo = Math.min(...v), hi = Math.max(...v), r = hi - lo || 1;
    const pts = v.map((x, i) => `${((i / (v.length - 1)) * w).toFixed(1)},${(h - 1 - ((x - lo) / r) * (h - 2)).toFixed(1)}`).join(" ");
    const up = v[v.length - 1] >= v[0];
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline fill="none" stroke="${up ? "#e6e6e6" : "#777"}" stroke-width="1" points="${pts}"/></svg>`;
  };
  const daily = (k) => k.map((r) => ({ t: r[0], day: isoDay(r[0]), c: +r[4] }));

  // US net liquidity in $B: Fed balance sheet − TGA − reverse repo, at each weekly Fed date (shared by NLIQ and TOPDOWN)
  QT.netLiq = async (years = 3.2) => {
    const from = yearsAgo(years);
    const [walcl, tga, rrp] = await Promise.all([QT.fred("WALCL", from), QT.fred("WTREGEN", from), QT.fred("RRPONTSYD", from)]);
    // WALCL and WTREGEN are in $ millions, RRPONTSYD in $ billions
    return walcl.map((w) => {
      const g = asOf(tga, w.t), r = asOf(rrp, w.t);
      return g == null || r == null ? null : { t: w.t, v: w.v / 1000 - g / 1000 - r, fed: w.v / 1000, tga: g / 1000, rrp: r };
    }).filter(Boolean);
  };

  // ============================================================ NLIQ — US net liquidity
  QT.fn.NLIQ = {
    name: "Net liquidity (US)", desc: "Fed balance sheet − Treasury General Account − reverse repo (FRED), against any perp. Weekly correlation of changes", sym: true, proxy: true,
    mount(ctx) {
      const b = ctx.sym;
      ctx.setTitle(`Net liquidity vs ${b}`);
      ctx.el.innerHTML = `<div class="split"><div class="fix"><div class="kv"></div></div><div class="grow"><div class="chart"></div></div><div class="fix note">Net liquidity = WALCL − WTREGEN − RRPONTSYD (FRED, $B). Fed data is weekly as of Wednesday, published Thursday. Line = ${b} daily close (right scale).</div></div>`;
      const kv = ctx.el.querySelector(".kv");
      const chart = QT.chart(ctx.el.querySelector(".chart"), { leftPriceScale: { visible: true, borderColor: "#1c1c1c" } });
      const nl = chart.addAreaSeries({ priceScaleId: "left", lineColor: "#ffffff", topColor: "rgba(255,255,255,0.14)", bottomColor: "rgba(255,255,255,0)", lineWidth: 2, title: "NET LIQ", priceFormat: { type: "custom", formatter: (v) => "$" + (v / 1000).toFixed(2) + "T" } });
      const px = chart.addLineSeries({ priceScaleId: "right", color: "#7a7a7a", lineWidth: 1, title: b });
      const load = async () => {
        try {
          const [net, k] = await Promise.all([QT.netLiq(), QT.klines(b, "1d", 1200, 3600e3)]);
          nl.setData(net.map((x) => ({ time: x.t / 1000, value: x.v })));
          const d = daily(k);
          px.setData(d.map((x) => ({ time: x.t / 1000, value: x.c })));
          chart.timeScale().fitContent();
          const L = net[net.length - 1], back = (n) => net[Math.max(0, net.length - 1 - n)];
          const dd = (key, n) => L[key] - back(n)[key];
          // weekly changes: net liquidity vs asset log return over the same weeks
          const ser = d.map((x) => ({ t: x.t, v: x.c }));
          const wk = net.slice(-53).map((x) => ({ n: x.v, a: asOf(ser, x.t) })).filter((x) => x.a != null);
          const dn = [], da = [];
          for (let i = 1; i < wk.length; i++) { dn.push(wk[i].n - wk[i - 1].n); da.push(Math.log(wk[i].a / wk[i - 1].a)); }
          const c52 = corr(dn, da);
          const bil = (v) => F.sgn(v, (v >= 0 ? "+" : "−") + "$" + Math.abs(v).toFixed(0) + "B");
          kv.innerHTML = kvHtml([["NET LIQUIDITY", "$" + (L.v / 1000).toFixed(3) + "T"], ["Δ 4W", bil(dd("v", 4))], ["Δ 13W", bil(dd("v", 13))],
            ["FED BALANCE SHEET", "$" + (L.fed / 1000).toFixed(2) + "T · " + bil(dd("fed", 4))], ["TGA", "$" + L.tga.toFixed(0) + "B · " + bil(dd("tga", 4))],
            ["REVERSE REPO", "$" + L.rrp.toFixed(0) + "B · " + bil(dd("rrp", 4))], [`CORR Δ WEEKLY 52W · ${b}`, c52 == null ? "—" : c52.toFixed(2)], ["AS OF", F.date(L.t)]]);
          ctx.setMeta(`$${(L.v / 1000).toFixed(2)}T · 4w ${dd("v", 4) >= 0 ? "+" : "−"}$${Math.abs(dd("v", 4)).toFixed(0)}B`);
        } catch (e) { ctx.error(e); }
      };
      load(); ctx.every(3600e3, load);
      return () => chart.remove();
    },
  };

  // ============================================================ YLD — US Treasury yields
  const MATS = { "1 Mo": 1 / 12, "1.5 Month": 1.5 / 12, "2 Mo": 2 / 12, "3 Mo": 0.25, "4 Mo": 4 / 12, "6 Mo": 0.5, "1 Yr": 1, "2 Yr": 2, "3 Yr": 3, "5 Yr": 5, "7 Yr": 7, "10 Yr": 10, "20 Yr": 20, "30 Yr": 30 };
  const ustYear = async (y) => {
    const txt = await QT.get(`https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${y}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${y}&page&_format=csv`, 3 * 3600e3);
    const lines = String(txt).trim().split("\n"), head = lines[0].split(",").map((h) => h.replace(/"/g, ""));
    return lines.slice(1).map((l) => {
      const c = l.split(","), [m, d, yy] = c[0].split("/");
      const pts = head.slice(1).map((h, i) => [MATS[h], c[i + 1] === "" ? null : +c[i + 1]]).filter(([x, v]) => x != null && v != null);
      return { t: Date.UTC(+yy, +m - 1, +d), pts };
    });
  };
  QT.fn.YLD = {
    name: "US yields", desc: "Treasury curve now vs 1M / 1Y ago, 2Y·10Y·real 10Y history, 2s10s spread, breakeven inflation", sym: false,
    mount(ctx) {
      ctx.el.innerHTML = `<div class="split"><div class="fix"><div class="kv"></div></div><div class="fix" style="height:34%;position:relative;border-bottom:1px solid #1c1c1c"><canvas class="fill"></canvas></div><div class="grow"><div class="chart"></div></div></div>`;
      const kv = ctx.el.querySelector(".kv"), cv = ctx.el.querySelector("canvas");
      const chart = QT.chart(ctx.el.querySelector(".chart"));
      const pf = { type: "custom", formatter: (v) => v.toFixed(2) + "%" };
      const s2 = chart.addLineSeries({ color: "#8a8a8a", lineWidth: 1, title: "2Y", priceFormat: pf });
      const s10 = chart.addLineSeries({ color: "#ffffff", lineWidth: 2, title: "10Y", priceFormat: pf });
      const sr = chart.addLineSeries({ color: "#8a8a8a", lineWidth: 1, lineStyle: 2, title: "REAL 10Y", priceFormat: pf });
      const sp = chart.addHistogramSeries({ priceScaleId: "spr", title: "2s10s", priceFormat: pf, priceLineVisible: false });
      chart.priceScale("spr").applyOptions({ scaleMargins: { top: 0.75, bottom: 0 } });
      chart.priceScale("right").applyOptions({ scaleMargins: { top: 0.05, bottom: 0.3 } });
      let curves = null;
      const X = (y) => Math.log(y * 12);
      const TICKS = [[1 / 12, "1M"], [0.25, "3M"], [0.5, "6M"], [1, "1Y"], [2, "2Y"], [5, "5Y"], [10, "10Y"], [30, "30Y"]].map(([y, l]) => [X(y), l]);
      const draw = () => {
        if (!curves) return;
        QT.plot(cv, [
          { pts: curves.now.pts.map(([x, v]) => [X(x), v]), color: "#ffffff", width: 2, label: "NOW " + F.date(curves.now.t) },
          { pts: curves.m1.pts.map(([x, v]) => [X(x), v]), color: "#8a8a8a", label: "1M AGO" },
          { pts: curves.y1.pts.map(([x, v]) => [X(x), v]), color: "#4a4a4a", dash: true, label: "1Y AGO" },
        ], { zero: false, yFmt: (v) => v.toFixed(2) + "%", xTicks: TICKS });
      };
      const load = async () => {
        try {
          const y = new Date().getUTCFullYear();
          const [cur, prev] = await Promise.all([ustYear(y), ustYear(y - 1)]);
          const rows = [...cur, ...prev].sort((a, b) => b.t - a.t);
          const near = (t) => rows.find((r) => r.t <= t) || rows[rows.length - 1];
          curves = { now: rows[0], m1: near(rows[0].t - 30 * DAY), y1: near(rows[0].t - 365 * DAY) };
          draw();
          const from = yearsAgo(4);
          const [d2, d10, r10, be, spr] = await Promise.all(["DGS2", "DGS10", "DFII10", "T10YIE", "T10Y2Y"].map((id) => QT.fred(id, from)));
          const ts = (s) => s.map((x) => ({ time: x.t / 1000, value: x.v }));
          s2.setData(ts(d2)); s10.setData(ts(d10)); sr.setData(ts(r10));
          sp.setData(spr.map((x) => ({ time: x.t / 1000, value: x.v, color: x.v >= 0 ? "#4a4a4a" : "#262626" })));
          chart.timeScale().fitContent();
          const at = (r, m) => { const p = r.pts.find(([x]) => Math.abs(x - m) < 1e-6); return p ? p[1] : null; };
          const n = curves.now, w1 = near(n.t - 7 * DAY);
          const y3m = at(n, 0.25), y2 = at(n, 2), y10 = at(n, 10), y30 = at(n, 30);
          const bp = (v) => F.sgn(v, (v >= 0 ? "+" : "") + v.toFixed(0) + "bp");
          kv.innerHTML = kvHtml([["3M", y3m + "%"], ["2Y", y2 + "%"], ["10Y", y10 + "%"], ["30Y", y30 + "%"],
            ["2s10s", bp((y10 - y2) * 100)], ["3M10Y", bp((y10 - y3m) * 100)], ["10Y Δ 1W", bp((y10 - at(w1, 10)) * 100)],
            ["REAL 10Y (TIPS)", r10.length ? r10[r10.length - 1].v.toFixed(2) + "%" : "—"], ["10Y BREAKEVEN", be.length ? be[be.length - 1].v.toFixed(2) + "%" : "—"]]);
          ctx.setMeta(`10Y ${y10}% · 2s10s ${((y10 - y2) * 100).toFixed(0)}bp`);
        } catch (e) { ctx.error(e); }
      };
      load(); ctx.every(3600e3, load);
      const ro = new ResizeObserver(draw); ro.observe(cv);
      return () => { ro.disconnect(); chart.remove(); };
    },
  };

  // ============================================================ MKTS — world markets monitor
  const YROWS = [
    ["US INDEX FUTURES · CME · ~10 MIN DELAY", [["ES=F", "S&P 500 fut"], ["NQ=F", "Nasdaq 100 fut"], ["YM=F", "Dow fut"], ["RTY=F", "Russell 2000 fut"]]],
    ["INDICES & VOLATILITY", [["^GSPC", "S&P 500"], ["^NDX", "Nasdaq 100"], ["^VIX", "VIX"], ["^MOVE", "MOVE · bond vol"]]],
    ["RATES & FX", [["^TNX", "US 10Y yield"], ["DX-Y.NYB", "Dollar index"], ["EURUSD=X", "EUR/USD"], ["USDJPY=X", "USD/JPY"]]],
    ["COMMODITIES", [["GC=F", "Gold"], ["CL=F", "WTI crude"], ["HG=F", "Copper"]]],
  ];
  const BROWS = [["QQQ", "Nasdaq 100 ETF"], ["SPY", "S&P 500 ETF"], ["XAU", "Gold"], ["CL", "WTI crude"], ["NVDA", "Nvidia"], ["TSLA", "Tesla"], ["MSTR", "Strategy"], ["COIN", "Coinbase"], ["BTC", "Bitcoin"], ["ETH", "Ether"]];
  QT.fn.MKTS = {
    name: "World markets", desc: "Index futures, VIX/MOVE, yields, dollar, FX, commodities (Yahoo) + real-time Binance TradFi perps (QQQ, SPY, gold, stocks)", sym: false,
    mount(ctx) {
      const yq = {}, bspark = {};
      const row = (name, sym, last, chg, sp, src, click) => `<tr${click ? ` class="click" data-s="${click}"` : ""}><td class="l">${name}</td><td class="l hi b">${sym}</td><td>${last}</td><td>${F.chg(chg)}</td><td>${sp || ""}</td><td class="dim">${src}</td></tr>`;
      const paint = () => {
        let h = `<table class="t"><thead><tr><th class="l">NAME</th><th class="l">SYMBOL</th><th>LAST</th><th>CHG</th><th>INTRADAY</th><th>SRC</th></tr></thead><tbody>`;
        for (const [sec, list] of YROWS) {
          h += `<tr><td colspan="6" class="sec">${sec}</td></tr>`;
          for (const [s, name] of list) {
            const q = yq[s];
            h += row(name, s, q ? (s === "^TNX" ? q.px.toFixed(3) + "%" : F.px(q.px)) : "—", q ? (q.px / q.prev - 1) * 100 : null, q && q.spark, "YAHOO");
          }
        }
        h += `<tr><td colspan="6" class="sec">BINANCE PERPS · REAL-TIME · 24/7 (OUTSIDE US HOURS THEY TRACK A MODEL PRICE)</td></tr>`;
        for (const [b, name] of BROWS) {
          const m = QT.mkt[b];
          h += row(name, b, m && m.last ? F.px(m.last) : "—", m ? m.chg : null, bspark[b], "BINANCE", b);
        }
        ctx.el.innerHTML = h + "</tbody></table>";
        ctx.el.querySelectorAll("tr[data-s]").forEach((tr) => (tr.onclick = () => QT.setFocus(tr.dataset.s)));
      };
      const loadY = async () => {
        await Promise.allSettled(YROWS.flatMap(([, l]) => l).map(async ([s]) => {
          const { meta, bars } = await QT.yahoo(s, "1d", "5m", 85000);
          yq[s] = { px: meta.regularMarketPrice, prev: meta.chartPreviousClose || meta.previousClose, spark: spark(bars.map((x) => x.c)) };
        }));
        await Promise.allSettled(BROWS.map(async ([b]) => {
          const k = await QT.get(`${QT.FAPI}/fapi/v1/klines?symbol=${b}USDT&interval=15m&limit=96`, 60000);
          bspark[b] = spark(k.map((r) => +r[4]));
        }));
        ctx.setMeta(`updated ${F.hm(Date.now())} UTC`);
        paint();
      };
      paint(); loadY();
      ctx.every(90000, loadY);      // Yahoo rate-limits aggressive polling
      ctx.every(2000, paint);
    },
  };

  // ============================================================ CORR — cross-asset correlations
  const CASSETS = [
    ["BTC", "bn", "BTC"], ["ETH", "bn", "ETH"], ["SOL", "bn", "SOL"],
    ["NDX", "y", "^NDX"], ["SPX", "y", "^GSPC"], ["GOLD", "y", "GC=F"], ["DXY", "y", "DX-Y.NYB"], ["US10Y", "y", "^TNX", true], ["VIX", "y", "^VIX"],
  ];
  QT.fn.CORR = {
    name: "Correlations", desc: "Cross-asset correlation matrix of daily returns (crypto vs Nasdaq, S&P, gold, dollar, yields, VIX) + rolling BTC correlations. Arg: window days 30 60 90 180 365", sym: false,
    mount(ctx) {
      const W = +ctx.args.find((a) => /^\d+$/.test(a)) || 90;
      ctx.setTitle(`Correlations · ${W}D daily returns`);
      ctx.el.innerHTML = `<div class="split"><div class="fix mx"></div><div class="grow" style="min-height:140px"><div class="chart"></div></div><div class="fix note">Trading days common to all markets. Yields use the change in level, everything else log returns. Chart: rolling ${W}-day correlation of BTC with NDX (white), gold (grey), dollar (dashed).</div></div>`;
      const mx = ctx.el.querySelector(".mx");
      const chart = QT.chart(ctx.el.querySelector(".chart"));
      const l1 = chart.addLineSeries({ color: "#ffffff", lineWidth: 2, title: "BTC·NDX" });
      const l2 = chart.addLineSeries({ color: "#8a8a8a", lineWidth: 1, title: "BTC·GOLD" });
      const l3 = chart.addLineSeries({ color: "#8a8a8a", lineWidth: 1, lineStyle: 2, title: "BTC·DXY" });
      const load = async () => {
        try {
          const series = await Promise.all(CASSETS.map(async ([n, src, s]) => {
            const m = new Map();
            if (src === "bn") (await QT.klines(s, "1d", 1100, 3600e3)).forEach((r) => m.set(isoDay(r[0]), +r[4]));
            else (await QT.yahoo(s, "5y", "1d", 3600e3)).bars.forEach((x) => m.set(x.day, x.c));
            return m;
          }));
          const days = [...series[3].keys()].filter((d) => series.every((m) => m.has(d))).sort();
          const ret = CASSETS.map(([, , , lvl], j) => days.slice(1).map((d, i) => {
            const a = series[j].get(days[i]), b = series[j].get(d);
            return lvl ? b - a : Math.log(b / a);
          }));
          const tail = (arr) => arr.slice(-W);
          const M = ret.map((a) => ret.map((b) => corr(tail(a), tail(b))));
          const cell = (c, i, j) => {
            if (i === j) return `<td class="dim">·</td>`;
            if (c == null) return "<td>—</td>";
            const a = Math.abs(c), bg = `rgba(255,255,255,${(a * 0.75).toFixed(2)})`, fg = a > 0.45 ? "#000" : c < 0 ? "#858585" : "#d9d9d9";
            return `<td style="background:${bg};color:${fg}">${c < 0 ? "−" : ""}${a.toFixed(2)}</td>`;
          };
          mx.innerHTML = `<table class="t corr"><thead><tr><th></th>${CASSETS.map(([n]) => `<th style="text-align:center">${n}</th>`).join("")}</tr></thead><tbody>`
            + CASSETS.map(([n], i) => `<tr><td class="hi b">${n}</td>${M[i].map((c, j) => cell(c, i, j)).join("")}</tr>`).join("") + "</tbody></table>";
          const roll = (j) => {
            const out = [];
            for (let i = W; i <= ret[0].length; i++) out.push({ time: Date.parse(days[i] + "T00:00:00Z") / 1000, value: corr(ret[0].slice(i - W, i), ret[j].slice(i - W, i)) });
            return out.filter((x) => x.value != null);
          };
          l1.setData(roll(3)); l2.setData(roll(5)); l3.setData(roll(6));
          chart.timeScale().fitContent();
          ctx.setMeta(`BTC·NDX ${M[0][3] != null ? M[0][3].toFixed(2) : "—"} · ${days.length} common days`);
        } catch (e) { ctx.error(e); }
      };
      load(); ctx.every(3600e3, load);
      return () => chart.remove();
    },
  };

  // ============================================================ DOM — dominance & stablecoins
  QT.fn.DOM = {
    name: "Dominance & stablecoins", desc: "Total crypto market cap, dominance by coin, ETH/BTC, stablecoin supply history (DefiLlama)", sym: false,
    mount(ctx) {
      ctx.el.innerHTML = `<div class="split"><div class="fix"><div class="kv"></div><table class="t dm"><tbody></tbody></table><div class="sec">TOTAL STABLECOIN SUPPLY</div></div><div class="grow"><div class="chart"></div></div></div>`;
      const kv = ctx.el.querySelector(".kv"), tb = ctx.el.querySelector(".dm tbody");
      const chart = QT.chart(ctx.el.querySelector(".chart"));
      const st = chart.addAreaSeries({ lineColor: "#ffffff", topColor: "rgba(255,255,255,0.14)", bottomColor: "rgba(255,255,255,0)", lineWidth: 1, priceFormat: { type: "custom", formatter: (v) => F.usd(v, 1) } });
      const load = async () => {
        try {
          const [g, ll] = await Promise.all([QT.get("https://api.coingecko.com/api/v3/global", 300000), QT.get("https://stablecoins.llama.fi/stablecoincharts/all", 3600e3)]);
          const d = g.data, pct = d.market_cap_percentage, tot = d.total_market_cap.usd;
          const stable = ll.map((x) => ({ t: +x.date * 1000, v: x.totalCirculatingUSD && x.totalCirculatingUSD.peggedUSD })).filter((x) => x.v && x.t > Date.now() - 4 * 365 * DAY);
          st.setData(stable.map((x) => ({ time: x.t / 1000, value: x.v }))); chart.timeScale().fitContent();
          const S = stable[stable.length - 1].v, ago = (n) => stable[Math.max(0, stable.length - 1 - n)].v;
          const stDom = (S / tot) * 100, eb = QT.mkt.ETH && QT.mkt.BTC ? QT.mkt.ETH.last / QT.mkt.BTC.last : null;
          kv.innerHTML = kvHtml([["TOTAL MARKET CAP", F.usd(tot)], ["24H", F.chg(d.market_cap_change_percentage_24h_usd)], ["24H VOLUME", F.usd(d.total_volume.usd)],
            ["BTC DOMINANCE", pct.btc.toFixed(2) + "%"], ["ETH DOMINANCE", pct.eth.toFixed(2) + "%"], ["ETH / BTC", eb ? eb.toFixed(5) : "—"],
            ["STABLECOINS", F.usd(S)], ["STABLE Δ 7D", F.sgn(S - ago(7), F.usd(S - ago(7), 1))], ["STABLE Δ 30D", F.sgn(S - ago(30), F.usd(S - ago(30), 1))],
            ["STABLE SHARE OF CAP", stDom.toFixed(2) + "%"], ["ALTS EX BTC/ETH/STABLES", (100 - pct.btc - pct.eth - stDom).toFixed(1) + "%"]]);
          const top = Object.entries(pct).sort((a, b) => b[1] - a[1]).slice(0, 10), mx = top[0][1];
          tb.innerHTML = top.map(([k, v]) => `<tr><td class="hi b" style="width:70px">${QT.esc(k.toUpperCase())}</td><td class="l"><div class="hbar"><i style="width:${(v / mx) * 100}%"></i></div></td><td style="width:70px">${v.toFixed(2)}%</td></tr>`).join("");
          ctx.setMeta(`BTC.D ${pct.btc.toFixed(1)}% · stables ${F.usd(S, 0)}`);
        } catch (e) { ctx.error(e); }
      };
      load(); ctx.every(300000, load);
      return () => chart.remove();
    },
  };

  // ============================================================ FNG — fear & greed with forward-return study
  QT.fn.FNG = {
    name: "Fear & greed", desc: "Crypto Fear & Greed index (alternative.me) vs BTC, and what BTC did over the next 30 days from each sentiment zone", sym: false,
    mount(ctx) {
      ctx.el.innerHTML = `<div class="split"><div class="fix"><div class="kv"></div></div><div class="grow" style="min-height:120px"><div class="chart"></div></div><div class="fix"><div class="sec">BTC NEXT 30 DAYS BY STARTING SENTIMENT · LAST 4 YEARS</div><table class="t zz"><thead><tr><th class="l">ZONE</th><th>DAYS</th><th>AVG RETURN</th><th>MEDIAN</th><th>UP %</th></tr></thead><tbody></tbody></table></div></div>`;
      const kv = ctx.el.querySelector(".kv"), tb = ctx.el.querySelector(".zz tbody");
      const chart = QT.chart(ctx.el.querySelector(".chart"), { leftPriceScale: { visible: true, borderColor: "#1c1c1c" } });
      const fs = chart.addAreaSeries({ priceScaleId: "left", lineColor: "#ffffff", topColor: "rgba(255,255,255,0.12)", bottomColor: "rgba(255,255,255,0)", lineWidth: 1, title: "F&G" });
      const bs = chart.addLineSeries({ priceScaleId: "right", color: "#6a6a6a", lineWidth: 1, title: "BTC" });
      [25, 75].forEach((p) => fs.createPriceLine({ price: p, color: "#333", lineWidth: 1, lineStyle: 2, axisLabelVisible: false }));
      const load = async () => {
        try {
          const [f, k] = await Promise.all([QT.get("https://api.alternative.me/fng/?limit=1500", 3600e3), QT.klines("BTC", "1d", 1500, 3600e3)]);
          const pts = f.data.map((x) => ({ t: +x.timestamp * 1000, v: +x.value, c: x.value_classification })).sort((a, b) => a.t - b.t);
          fs.setData(pts.filter((p) => p.t > Date.now() - 2 * 365 * DAY).map((p) => ({ time: p.t / 1000, value: p.v })));
          const px = new Map(k.map((r) => [isoDay(r[0]), +r[4]]));
          bs.setData(k.filter((r) => r[0] > Date.now() - 2 * 365 * DAY).map((r) => ({ time: r[0] / 1000, value: +r[4] })));
          chart.timeScale().fitContent();
          const L = pts[pts.length - 1], ago = (n) => pts[Math.max(0, pts.length - 1 - n)].v;
          const y1 = pts.slice(-365), avg = y1.reduce((a, p) => a + p.v, 0) / y1.length;
          kv.innerHTML = kvHtml([["NOW", `${L.v} · ${QT.esc(L.c).toUpperCase()}`], ["YESTERDAY", ago(1)], ["1W AGO", ago(7)], ["1M AGO", ago(30)], ["1Y AVERAGE", avg.toFixed(0)],
            ["EXTREME DAYS 30D", `${pts.slice(-30).filter((p) => p.v <= 25).length} fear · ${pts.slice(-30).filter((p) => p.v >= 75).length} greed`]]);
          const zones = [["EXTREME FEAR  0–24", 0, 24], ["FEAR  25–44", 25, 44], ["NEUTRAL  45–55", 45, 55], ["GREED  56–74", 56, 74], ["EXTREME GREED  75–100", 75, 100]];
          tb.innerHTML = zones.map(([name, lo, hi]) => {
            const r = pts.filter((p) => p.t > Date.now() - 4 * 365 * DAY && p.v >= lo && p.v <= hi).map((p) => {
              const a = px.get(isoDay(p.t)), b = px.get(isoDay(p.t + 30 * DAY));
              return a && b ? (b / a - 1) * 100 : null;
            }).filter((x) => x != null).sort((a, b) => a - b);
            if (!r.length) return `<tr><td class="l">${name}</td><td colspan="4" class="dim">—</td></tr>`;
            const m = r.reduce((a, x) => a + x, 0) / r.length, med = r[Math.floor(r.length / 2)], up = r.filter((x) => x > 0).length / r.length * 100;
            const now = L.v >= lo && L.v <= hi;
            return `<tr class="${now ? "inv" : ""}"><td class="l">${name}${now ? " ◀ NOW" : ""}</td><td>${r.length}</td><td>${F.sgn(m, F.pct(m, 1))}</td><td>${F.sgn(med, F.pct(med, 1))}</td><td>${up.toFixed(0)}%</td></tr>`;
          }).join("");
          ctx.setMeta(`${L.v} ${QT.esc(L.c)}`);
        } catch (e) { ctx.error(e); }
      };
      load(); ctx.every(3600e3, load);
      return () => chart.remove();
    },
  };

  // ============================================================ FEES — network fees & mining
  QT.fn.FEES = {
    name: "Network fees", desc: "Bitcoin mempool fees, congestion, hashrate, difficulty adjustment; Ethereum base fee and transfer / swap cost", sym: false,
    mount(ctx) {
      ctx.el.innerHTML = `<div class="split"><div class="fix"><div class="sec">BITCOIN</div><div class="kv k1"></div><div class="sec">ETHEREUM</div><div class="kv k2"></div><div class="sec">BITCOIN HASHRATE · 3M · EH/S</div></div><div class="grow"><div class="chart"></div></div></div>`;
      const k1 = ctx.el.querySelector(".k1"), k2 = ctx.el.querySelector(".k2");
      const chart = QT.chart(ctx.el.querySelector(".chart"));
      const hs = chart.addAreaSeries({ lineColor: "#ffffff", topColor: "rgba(255,255,255,0.12)", bottomColor: "rgba(255,255,255,0)", lineWidth: 1 });
      const rpc = (method, params) => QT.post("https://ethereum-rpc.publicnode.com", { jsonrpc: "2.0", id: 1, method, params }, 15000);
      const load = async () => {
        try {
          const [fee, mp, dif, hr, ht] = await Promise.all(["v1/fees/recommended", "mempool", "v1/difficulty-adjustment", "v1/mining/hashrate/3m", "blocks/tip/height"].map((p) => QT.get("https://mempool.space/api/" + p, 30000)));
          const btc = QT.mkt.BTC && QT.mkt.BTC.last;
          const txUsd = (satvb) => btc ? "$" + (satvb * 140 / 1e8 * btc).toFixed(2) : "—";    // ~140 vB typical segwit payment
          k1.innerHTML = kvHtml([["FASTEST", `${fee.fastestFee} sat/vB · ${txUsd(fee.fastestFee)}`], ["30 MIN", `${fee.halfHourFee} sat/vB`], ["1 HOUR", `${fee.hourFee} sat/vB`], ["ECONOMY", `${fee.economyFee} sat/vB`],
            ["MEMPOOL", `${F.num(mp.count, 0)} tx · ${(mp.vsize / 1e6).toFixed(1)} MvB`], ["BLOCKS TO CLEAR", (mp.vsize / 1e6).toFixed(0)], ["HEIGHT", F.num(+ht, 0)],
            ["HASHRATE", (hr.currentHashrate / 1e18).toFixed(0) + " EH/s"], ["NEXT DIFF ADJ", `${F.sgn(dif.difficultyChange, F.pct(dif.difficultyChange))} · ${dif.remainingBlocks} blocks · ${F.dur(dif.remainingTime)}`],
            ["EPOCH PROGRESS", dif.progressPercent.toFixed(1) + "%"]]);
          hs.setData(hr.hashrates.map((x) => ({ time: x.timestamp, value: x.avgHashrate / 1e18 }))); chart.timeScale().fitContent();
          const fh = (await rpc("eth_feeHistory", [20, "latest", [10, 50, 90]])).result;
          const gw = (h) => parseInt(h, 16) / 1e9;
          const base = gw(fh.baseFeePerGas[fh.baseFeePerGas.length - 1]);
          const tip = fh.reward.map((r) => gw(r[1])).sort((a, b) => a - b)[Math.floor(fh.reward.length / 2)];
          const util = fh.gasUsedRatio.reduce((a, x) => a + x, 0) / fh.gasUsedRatio.length * 100;
          const eth = QT.mkt.ETH && QT.mkt.ETH.last, cost = (gas) => eth ? "$" + ((base + tip) * gas / 1e9 * eth).toFixed(3) : "—";
          k2.innerHTML = kvHtml([["BASE FEE", base.toFixed(3) + " gwei"], ["PRIORITY P50", tip.toFixed(3) + " gwei"], ["BLOCK UTILIZATION 20B", util.toFixed(0) + "%"],
            ["ETH TRANSFER", cost(21000)], ["ERC-20 TRANSFER", cost(65000)], ["UNISWAP SWAP", cost(150000)]]);
          ctx.setMeta(`BTC ${fee.halfHourFee} sat/vB · ETH ${base.toFixed(2)} gwei`);
        } catch (e) { ctx.error(e); }
      };
      load(); ctx.every(30000, load);
      return () => chart.remove();
    },
  };
})();
