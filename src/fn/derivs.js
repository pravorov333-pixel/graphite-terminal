(() => {
  const QT = window.QT, F = QT.f;
  const ann = (rate, hours) => rate * (24 / hours) * 365 * 100;
  const HL = () => QT.post("https://api.hyperliquid.xyz/info", { type: "metaAndAssetCtxs" }, 10000);
  const hlCtx = async (b) => {
    const [meta, ctxs] = await HL();
    const i = meta.universe.findIndex((u) => u.name === b);
    return i < 0 ? null : ctxs[i];
  };
  const MON = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
  // Deribit expiry code like 26DEC26 -> settlement 08:00 UTC
  const deribitExpiry = (code) => {
    const m = /^(\d{1,2})([A-Z]{3})(\d{2})$/.exec(code);
    return m ? Date.UTC(2000 + +m[3], MON[m[2]], +m[1], 8) : null;
  };
  const kvHtml = (pairs) => pairs.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("");

  // ============================================================ FR — funding across venues
  QT.fn.FR = {
    name: "Funding", desc: "Funding on Binance, Bybit, OKX, Hyperliquid: rate, interval, annualized, countdown, history. FR ALL = screener", sym: true, words: ["ALL"],
    async mount(ctx) {
      if (ctx.args[0] === "ALL") return screener(ctx);
      const b = ctx.sym;
      ctx.el.innerHTML = `<div class="split"><div class="fix"><table class="t"><thead><tr><th>VENUE</th><th>RATE</th><th>INTERVAL</th><th>PER 8H</th><th>ANNUALIZED</th><th>NEXT</th></tr></thead><tbody></tbody></table><div class="kv"></div><div class="sec">BINANCE FUNDING HISTORY · ANNUALIZED %</div></div><div class="grow"><div class="chart"></div></div></div>`;
      const tb = ctx.el.querySelector("tbody"), kv = ctx.el.querySelector(".kv");
      const chart = QT.chart(ctx.el.querySelector(".chart"));
      const hist = chart.addHistogramSeries({ priceFormat: { type: "custom", formatter: (v) => v.toFixed(1) + "%" } });

      const venues = async () => {
        const out = [];
        const tasks = [
          (async () => {
            const d = await QT.get(`${QT.FAPI}/fapi/v1/premiumIndex?symbol=${b}USDT`, 5000);
            out.push({ v: "BINANCE", r: +d.lastFundingRate, h: QT.fundInt[b] || 8, next: +d.nextFundingTime });
          })(),
          (async () => {
            const d = (await QT.get(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${b}USDT`, 5000)).result.list[0];
            if (d) out.push({ v: "BYBIT", r: +d.fundingRate, h: +d.fundingIntervalHour || 8, next: +d.nextFundingTime });
          })(),
          (async () => {
            const d = (await QT.get(`https://www.okx.com/api/v5/public/funding-rate?instId=${b}-USDT-SWAP`, 5000)).data[0];
            if (d) out.push({ v: "OKX", r: +d.fundingRate, h: (+d.nextFundingTime - +d.fundingTime) / 3.6e6 || 8, next: +d.fundingTime });
          })(),
          (async () => {
            const c = await hlCtx(b);
            const nh = new Date(); nh.setUTCMinutes(60, 0, 0);
            if (c) out.push({ v: "HYPERLIQUID", r: +c.funding, h: 1, next: nh.getTime() });
          })(),
        ];
        await Promise.allSettled(tasks);
        return out.sort((a, b2) => ["BINANCE", "BYBIT", "OKX", "HYPERLIQUID"].indexOf(a.v) - ["BINANCE", "BYBIT", "OKX", "HYPERLIQUID"].indexOf(b2.v));
      };

      const refresh = async () => {
        const rows = await venues();
        if (!rows.length) return ctx.error("no venue lists this symbol");
        tb.innerHTML = rows.map((x) => {
          const a = ann(x.r, x.h);
          return `<tr><td class="hi">${x.v}</td><td>${F.sgn(x.r, (x.r * 100).toFixed(4) + "%")}</td><td>${x.h}h</td><td>${F.sgn(x.r, ((x.r * 8) / x.h * 100).toFixed(4) + "%")}</td><td class="b">${F.sgn(a, F.pct(a, 2))}</td><td>${F.dur(x.next - Date.now())}</td></tr>`;
        }).join("");
        const anns = rows.map((x) => ann(x.r, x.h)), avg = anns.reduce((a, c) => a + c, 0) / anns.length;
        const spread = Math.max(...anns) - Math.min(...anns);
        ctx.setMeta(`avg ${F.pct(avg, 1)} ann · spread ${spread.toFixed(1)}pp`);
        return { avg, spread };
      };

      const loadHist = async () => {
        const h = await QT.get(`${QT.FAPI}/fapi/v1/fundingRate?symbol=${b}USDT&limit=200`, 60000);
        const hrs = QT.fundInt[b] || 8;
        const pts = h.map((x) => ({ time: Math.floor(+x.fundingTime / 1000), value: ann(+x.fundingRate, hrs) }));
        hist.setData(pts.map((p) => ({ ...p, color: p.value >= 0 ? "#cfcfcf" : "#555" })));
        chart.timeScale().fitContent();
        const mean = (n) => { const s = pts.slice(-n); return s.reduce((a, c) => a + c.value, 0) / s.length; };
        const evDay = 24 / hrs, pos = pts.slice(-Math.round(30 * evDay)).filter((p) => p.value > 0).length / Math.min(pts.length, Math.round(30 * evDay)) * 100;
        return { d7: mean(Math.round(7 * evDay)), d30: mean(Math.round(30 * evDay)), pos };
      };

      const all = async () => {
        try {
          const [cur, h] = await Promise.all([refresh(), loadHist()]);
          kv.innerHTML = kvHtml([["AVG NOW ANN", cur ? F.sgn(cur.avg, F.pct(cur.avg, 1)) : "—"], ["VENUE SPREAD", cur ? cur.spread.toFixed(1) + "pp" : "—"],
            ["BINANCE 7D ANN", F.sgn(h.d7, F.pct(h.d7, 1))], ["BINANCE 30D ANN", F.sgn(h.d30, F.pct(h.d30, 1))], ["30D POSITIVE", h.pos.toFixed(0) + "%"]]);
        } catch (e) { ctx.error(e); }
      };
      all();
      ctx.every(15000, () => refresh().catch(() => {}));
      return () => chart.remove();
    },
  };

  async function screener(ctx) {
    ctx.setTitle("Funding screener · all Binance USDT perps");
    const load = async () => {
      try {
        const [pi, tk] = await Promise.all([QT.get(QT.FAPI + "/fapi/v1/premiumIndex", 10000), QT.get(QT.FAPI + "/fapi/v1/ticker/24hr", 15000)]);
        const vol = Object.fromEntries(tk.map((t) => [t.symbol, +t.quoteVolume]));
        const rows = pi.filter((x) => x.symbol.endsWith("USDT") && (vol[x.symbol] || 0) > 2e6).map((x) => {
          const b = x.symbol.slice(0, -4); return { b, a: ann(+x.lastFundingRate, QT.fundInt[b] || 8), h: QT.fundInt[b] || 8, vol: vol[x.symbol] };
        });
        const tbl = (title, list) => `<div style="overflow:auto"><div class="sec">${title}</div><table class="t"><thead><tr><th>SYM</th><th>ANN</th><th>INT</th><th>VOL 24H</th></tr></thead><tbody>`
          + list.map((x) => `<tr class="click" data-s="${x.b}"><td class="hi">${x.b}</td><td class="b">${F.sgn(x.a, F.pct(x.a, 1))}</td><td>${x.h}h</td><td>${F.usd(x.vol)}</td></tr>`).join("") + "</tbody></table></div>";
        ctx.el.innerHTML = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:1px;background:#1c1c1c;height:100%">`
          + tbl("HIGHEST · LONGS PAY", [...rows].sort((a, b) => b.a - a.a).slice(0, 30))
          + tbl("LOWEST · SHORTS PAY", [...rows].sort((a, b) => a.a - b.a).slice(0, 30)) + "</div>";
        ctx.el.querySelectorAll("tr[data-s]").forEach((tr) => (tr.onclick = () => QT.setFocus(tr.dataset.s)));
        const med = rows.map((r) => r.a).sort((a, b) => a - b)[Math.floor(rows.length / 2)];
        ctx.setMeta(`${rows.length} perps · median ${F.pct(med, 1)} ann`);
      } catch (e) { ctx.error(e); }
    };
    ctx.el.style.overflow = "hidden";
    load(); ctx.every(30000, load);
  }

  // ============================================================ OI — open interest by venue + history
  QT.fn.OI = {
    name: "Open interest", desc: "OI on Binance, Bybit, OKX, Hyperliquid + Binance OI history vs price and positioning regime. Args: 5M 15M 1H 4H 1D", sym: true,
    tfs: ["5m", "15m", "1h", "4h", "1d"],
    mount(ctx) {
      const b = ctx.sym, period = QT.tfIn(ctx.args, "1h");
      ctx.setTitle(`Open interest · ${period.toUpperCase()}`);
      ctx.el.innerHTML = `<div class="split"><div class="fix"><table class="t"><thead><tr><th>VENUE</th><th>OI $</th><th style="width:50%">SHARE</th></tr></thead><tbody></tbody></table><div class="kv"></div></div><div class="grow"><div class="chart"></div></div></div>`;
      const tb = ctx.el.querySelector("tbody"), kv = ctx.el.querySelector(".kv");
      const chart = QT.chart(ctx.el.querySelector(".chart"), { leftPriceScale: { visible: true, borderColor: "#1c1c1c" } });
      const oiS = chart.addAreaSeries({ priceScaleId: "left", lineColor: "#bdbdbd", topColor: "rgba(255,255,255,0.18)", bottomColor: "rgba(255,255,255,0.0)", lineWidth: 1, priceFormat: { type: "custom", formatter: (v) => F.usd(v, 2) } });
      const pxS = chart.addLineSeries({ priceScaleId: "right", color: "#ffffff", lineWidth: 1, lineStyle: 2 });

      const venues = async () => {
        const out = [];
        await Promise.allSettled([
          (async () => { const d = await QT.get(`${QT.FAPI}/fapi/v1/openInterest?symbol=${b}USDT`, 10000); const m = QT.mkt[b]; out.push({ v: "BINANCE", usd: +d.openInterest * (m && m.mark || 0) }); })(),
          (async () => { const d = (await QT.get(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${b}USDT`, 10000)).result.list[0]; if (d) out.push({ v: "BYBIT", usd: +d.openInterestValue }); })(),
          (async () => { const d = (await QT.get(`https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=${b}-USDT-SWAP`, 10000)).data[0]; if (d) out.push({ v: "OKX", usd: +d.oiUsd }); })(),
          (async () => { const c = await hlCtx(b); if (c) out.push({ v: "HYPERLIQUID", usd: +c.openInterest * +c.markPx }); })(),
        ]);
        return out.filter((x) => x.usd > 0).sort((a, c) => c.usd - a.usd);
      };
      const load = async () => {
        try {
          const rows = await venues(), tot = rows.reduce((a, c) => a + c.usd, 0);
          tb.innerHTML = rows.map((x) => `<tr><td class="hi">${x.v}</td><td>${F.usd(x.usd)}</td><td><div class="sharebar"><div class="hbar"><i style="width:${(x.usd / tot) * 100}%"></i></div><span>${((x.usd / tot) * 100).toFixed(1)}%</span></div></td></tr>`).join("")
            + `<tr><td class="b">TOTAL</td><td class="b hi">${F.usd(tot)}</td><td></td></tr>`;
          const [oh, kl] = await Promise.all([
            QT.get(`${QT.FAPI}/futures/data/openInterestHist?symbol=${b}USDT&period=${period}&limit=200`, 60000),
            QT.get(`${QT.FAPI}/fapi/v1/klines?symbol=${b}USDT&interval=${period}&limit=200`, 60000),
          ]);
          oiS.setData(oh.map((x) => ({ time: Math.floor(x.timestamp / 1000), value: +x.sumOpenInterestValue })));
          pxS.setData(kl.map((k) => ({ time: k[0] / 1000, value: +k[4] })));
          chart.timeScale().fitContent();
          const per = { "5m": 288, "15m": 96, "1h": 24, "4h": 6, "1d": 1 }[period] || 24;
          const n = Math.min(per, oh.length - 1);
          const dOI = (+oh[oh.length - 1].sumOpenInterestValue / +oh[oh.length - 1 - n].sumOpenInterestValue - 1) * 100;
          const dPx = (+kl[kl.length - 1][4] / +kl[kl.length - 1 - n][4] - 1) * 100;
          // classic price/OI quadrants
          const regime = dPx >= 0 ? (dOI >= 0 ? "NEW LONGS — trend backed by fresh positions" : "SHORT COVERING — rally on closing shorts")
            : (dOI >= 0 ? "NEW SHORTS — selling with fresh positions" : "LONG UNWIND — longs closing / liquidating");
          kv.innerHTML = kvHtml([["Δ OI 24H", F.sgn(dOI, F.pct(dOI))], ["Δ PRICE 24H", F.sgn(dPx, F.pct(dPx))], ["OI / VOL 24H", QT.mkt[b] && QT.mkt[b].qvol ? (tot / QT.mkt[b].qvol).toFixed(2) + "x" : "—"]])
            + `<div style="grid-column:1/-1"><span>REGIME (24H)</span><b>${regime}</b></div>`;
          ctx.setMeta(`total ${F.usd(tot)}`);
        } catch (e) { ctx.error(e); }
      };
      load(); ctx.every(60000, load);
      return () => chart.remove();
    },
  };

  // ============================================================ BASIS — term structure of futures premium
  QT.fn.BASIS = {
    name: "Basis / term structure", desc: "Quarterly & dated futures premium (Binance, Deribit), annualized curve vs perp funding — the carry trade view", sym: true,
    mount(ctx) {
      const b = ctx.sym;
      ctx.el.innerHTML = `<div class="split"><div class="fix"><div class="kv"></div></div><div class="fix" style="max-height:52%;overflow:auto"><table class="t"><thead><tr><th>VENUE</th><th>CONTRACT</th><th>EXPIRY</th><th>DAYS</th><th>MARK</th><th>PREMIUM</th><th>ANNUALIZED</th></tr></thead><tbody></tbody></table></div><div class="grow" style="min-height:140px"><canvas class="fill"></canvas></div></div>`;
      const tb = ctx.el.querySelector("tbody"), kv = ctx.el.querySelector(".kv"), cv = ctx.el.querySelector("canvas");
      let last = null;
      const load = async () => {
        try {
          const now = Date.now(), rows = [];
          const pi = await QT.get(`${QT.FAPI}/fapi/v1/premiumIndex?symbol=${b}USDT`, 5000);
          const index = +pi.indexPrice, fundAnn = ann(+pi.lastFundingRate, QT.fundInt[b] || 8);
          const ei = await QT.get(QT.FAPI + "/fapi/v1/exchangeInfo", 3600e3);
          const qs = ei.symbols.filter((s) => s.baseAsset === b && s.quoteAsset === "USDT" && /QUARTER/.test(s.contractType) && s.status === "TRADING");
          for (const q of qs) {
            const m = +(await QT.get(`${QT.FAPI}/fapi/v1/premiumIndex?symbol=${q.symbol}`, 5000)).markPrice;
            const days = (q.deliveryDate - now) / 864e5, prem = (m / index - 1) * 100;
            rows.push({ v: "BINANCE", c: q.symbol, exp: q.deliveryDate, days, mark: m, prem, ann: prem * 365 / days });
          }
          if (["BTC", "ETH"].includes(b)) {
            const [fut, ix] = await Promise.all([
              QT.get(`https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${b}&kind=future`, 15000),
              QT.get(`https://www.deribit.com/api/v2/public/get_index_price?index_name=${b.toLowerCase()}_usd`, 5000),
            ]);
            const di = ix.result.index_price;
            for (const f of fut.result) {
              const exp = deribitExpiry(f.instrument_name.split("-")[1]);
              if (!exp) continue;
              const days = (exp - now) / 864e5; if (days < 2) continue;      // last days annualize to noise
              const prem = (f.mark_price / di - 1) * 100;
              rows.push({ v: "DERIBIT", c: f.instrument_name, exp, days, mark: f.mark_price, prem, ann: prem * 365 / days });
            }
          }
          rows.sort((a, c) => a.days - c.days);
          tb.innerHTML = rows.length ? rows.map((r) => `<tr><td class="hi">${r.v}</td><td>${r.c}</td><td>${F.date(r.exp)}</td><td>${r.days.toFixed(0)}</td><td>${F.px(r.mark)}</td><td>${F.sgn(r.prem, F.pct(r.prem, 3))}</td><td class="b">${F.sgn(r.ann, F.pct(r.ann, 2))}</td></tr>`).join("")
            : `<tr><td colspan="7" class="dim l">No dated futures for ${b} on Binance/Deribit — only BTC and ETH have them. Perp premium: ${F.pct((+pi.markPrice / index - 1) * 100, 3)}</td></tr>`;
          const near = rows.find((r) => r.days > 30) || rows[0];
          const net = near ? fundAnn - near.ann : null;
          kv.innerHTML = kvHtml([["INDEX", F.px(index)], ["PERP FUNDING ANN", F.sgn(fundAnn, F.pct(fundAnn, 2))],
            ["BASIS ANN (>30D)", near ? F.sgn(near.ann, F.pct(near.ann, 2)) : "—"],
            ["NET CARRY", net == null ? "—" : F.sgn(net, F.pct(net, 2))],
            ["CARRY VERDICT", net == null ? "—" : net >= 2 ? "short perp / long future" : net <= -2 ? "long perp / short future" : "no edge"]]);
          ctx.setMeta(near ? `basis ${F.pct(near.ann, 1)} · funding ${F.pct(fundAnn, 1)}` : "");
          last = { rows, fundAnn };
          draw();
        } catch (e) { ctx.error(e); }
      };
      const draw = () => {
        if (!last) return;
        const pts = (v) => last.rows.filter((r) => r.v === v).map((r) => [r.days, r.ann]);
        QT.plot(cv, [
          { pts: pts("DERIBIT"), color: "#ffffff", label: "DERIBIT annualized basis" },
          { pts: pts("BINANCE"), color: "#8a8a8a", label: "BINANCE annualized basis" },
          { pts: [], hline: last.fundAnn, color: "#5a5a5a", dash: true, label: "perp funding annualized" },
        ], { xFmt: (v) => v.toFixed(0) + "d", yFmt: (v) => v.toFixed(1) + "%" });
      };
      load(); ctx.every(30000, load);
      const ro = new ResizeObserver(draw); ro.observe(cv);
      return () => ro.disconnect();
    },
  };

  // ============================================================ LIQ — liquidations
  QT.fn.LIQ = {
    name: "Liquidations", desc: "Live forced liquidations across Binance perps: feed, per-minute bars, rolling totals. Args: symbol, min $ (LIQ BTC 50000)", sym: false,
    mount(ctx) {
      const filt = ctx.args.find((a) => QT.isSymbolToken(a)), minUsd = +ctx.args.find((a) => /^\d+$/.test(a)) || 0;
      if (filt) ctx.setTitle(`Liquidations · ${filt}`);
      ctx.el.innerHTML = `<div class="split"><div class="fix"><div class="kv"></div></div><div class="fix" style="height:90px;position:relative;border-bottom:1px solid #1c1c1c"><canvas class="fill"></canvas></div><div class="grow" style="overflow:auto"><table class="t"><thead><tr><th>TIME</th><th class="l">SYM</th><th class="l">LIQUIDATED</th><th>PRICE</th><th>$</th></tr></thead><tbody></tbody></table><div class="note">Since the terminal started. Binance streams at most one liquidation per symbol per second, so totals are a floor.</div></div></div>`;
      const kv = ctx.el.querySelector(".kv"), tb = ctx.el.querySelector("tbody"), cv = ctx.el.querySelector("canvas");
      let dirty = true;
      const sel = () => QT.liqs.filter((l) => (!filt || l.sym === QT.base(filt)) && l.usd >= minUsd);
      const paint = () => {
        if (!dirty) return; dirty = false;
        const L = sel(), now = Date.now();
        const sum = (ms, side) => L.reduce((a, l) => a + (now - l.t <= ms && l.side === side ? l.usd : 0), 0);
        const big = L.filter((l) => now - l.t <= 3600e3).sort((a, b) => b.usd - a.usd)[0];
        const bySym = {}; L.forEach((l) => { if (now - l.t <= 3600e3) bySym[l.sym] = (bySym[l.sym] || 0) + l.usd; });
        const top = Object.entries(bySym).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s, v]) => `${s} ${F.usd(v, 1)}`).join(" · ");
        kv.innerHTML = kvHtml([["LONGS 5M", F.usd(sum(300e3, "LONG"))], ["SHORTS 5M", F.usd(sum(300e3, "SHORT"))],
          ["LONGS 1H", F.usd(sum(3600e3, "LONG"))], ["SHORTS 1H", F.usd(sum(3600e3, "SHORT"))],
          ["LARGEST 1H", big ? `${big.sym} ${F.usd(big.usd, 1)}` : "—"], ["TOP 1H", top || "—"]]);
        tb.innerHTML = L.slice(0, 200).map((l) => `<tr class="${l.usd >= 100000 ? "inv" : ""}"><td>${F.hms(l.t)}</td><td class="l b">${l.sym}</td><td class="l">${l.side}</td><td>${F.px(l.px)}</td><td>${F.usd(l.usd, 1)}</td></tr>`).join("");
        ctx.setMeta(`${L.length} events`);
        // per-minute bars: longs up (white), shorts down (grey)
        const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
        cv.width = w * dpr; cv.height = h * dpr;
        const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
        const N = 60, bins = Array.from({ length: N }, () => [0, 0]);
        for (const l of L) { const k = Math.floor((now - l.t) / 60e3); if (k < N) bins[N - 1 - k][l.side === "LONG" ? 0 : 1] += l.usd; }
        const max = Math.max(1, ...bins.flat()), bw = w / N, mid = h / 2;
        g.fillStyle = "#1c1c1c"; g.fillRect(0, mid, w, 1);
        bins.forEach(([lg, sh], i) => {
          g.fillStyle = "#e6e6e6"; g.fillRect(i * bw + 1, mid - (lg / max) * (mid - 4), bw - 2, (lg / max) * (mid - 4));
          g.fillStyle = "#6a6a6a"; g.fillRect(i * bw + 1, mid + 1, bw - 2, (sh / max) * (mid - 4));
        });
        g.font = "10px IBM Plex Mono, Consolas"; g.fillStyle = "#777";
        g.fillText("LONGS LIQUIDATED ▲  ·  60 MIN  ·  ▼ SHORTS LIQUIDATED", 6, 11);
      };
      const off = QT.on("liq", () => (dirty = true));
      ctx.every(500, paint);
      ctx.every(15000, () => (dirty = true));
      return off;
    },
  };

  // ============================================================ LS — long/short positioning
  QT.fn.LS = {
    name: "Long / short", desc: "Binance account & top-trader long/short ratios and taker buy/sell ratio. Args: 5M 15M 1H 4H 1D", sym: true,
    tfs: ["5m", "15m", "1h", "4h", "1d"],
    mount(ctx) {
      const b = ctx.sym, period = QT.tfIn(ctx.args, "1h");
      ctx.setTitle(`Long / short · ${period.toUpperCase()}`);
      ctx.el.innerHTML = `<div class="split"><div class="fix"><div class="kv"></div></div><div class="grow"><div class="chart"></div></div></div>`;
      const kv = ctx.el.querySelector(".kv");
      const chart = QT.chart(ctx.el.querySelector(".chart"));
      const s1 = chart.addLineSeries({ color: "#ffffff", lineWidth: 2, title: "ALL ACCOUNTS" });
      const s2 = chart.addLineSeries({ color: "#9a9a9a", lineWidth: 1, title: "TOP ACCOUNTS" });
      const s3 = chart.addLineSeries({ color: "#9a9a9a", lineWidth: 1, lineStyle: 2, title: "TOP POSITIONS" });
      const s4 = chart.addHistogramSeries({ priceScaleId: "taker", title: "TAKER B/S", priceLineVisible: false });
      chart.priceScale("taker").applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
      chart.priceScale("right").applyOptions({ scaleMargins: { top: 0.06, bottom: 0.26 } });
      const load = async () => {
        try {
          const q = (p) => QT.get(`${QT.FAPI}/futures/data/${p}?symbol=${b}USDT&period=${period}&limit=200`, 60000);
          const [g, ta, tp, tk] = await Promise.all([q("globalLongShortAccountRatio"), q("topLongShortAccountRatio"), q("topLongShortPositionRatio"), q("takerlongshortRatio")]);
          if (![g, ta, tp, tk].every((x) => Array.isArray(x) && x.length)) throw new Error(`Binance не публикует соотношения лонг/шорт для ${b} — функция работает для монет с этой статистикой`);
          const ser = (arr, k = "longShortRatio") => arr.map((x) => ({ time: Math.floor(x.timestamp / 1000), value: +x[k] }));
          s1.setData(ser(g)); s2.setData(ser(ta)); s3.setData(ser(tp));
          s4.setData(tk.map((x) => ({ time: Math.floor(x.timestamp / 1000), value: +x.buySellRatio, color: +x.buySellRatio >= 1 ? "#5a5a5a" : "#262626" })));
          chart.timeScale().fitContent();
          const lg = g[g.length - 1];
          kv.innerHTML = kvHtml([["ACCOUNTS L/S", (+lg.longShortRatio).toFixed(2)], ["LONG ACCOUNTS", (+lg.longAccount * 100).toFixed(1) + "%"],
            ["TOP ACC L/S", (+ta[ta.length - 1].longShortRatio).toFixed(2)], ["TOP POS L/S", (+tp[tp.length - 1].longShortRatio).toFixed(2)],
            ["TAKER B/S", (+tk[tk.length - 1].buySellRatio).toFixed(2)]]);
          ctx.setMeta(`retail ${(+lg.longAccount * 100).toFixed(0)}% long`);
        } catch (e) { ctx.error(e); }
      };
      load(); ctx.every(60000, load);
      return () => chart.remove();
    },
  };

  // ============================================================ CVD — spot vs perp cumulative volume delta
  QT.fn.CVD = {
    name: "CVD", desc: "Cumulative volume delta, Binance spot vs perp, with price — who is driving the move. Args: 1M 5M 15M 1H", sym: true,
    tfs: ["1m", "5m", "15m", "1h"],
    mount(ctx) {
      const b = ctx.sym, tf = QT.tfIn(ctx.args, "5m");
      const limit = { "1m": 720, "5m": 288, "15m": 192, "1h": 168 }[tf] || 288;
      ctx.setTitle(`CVD · ${tf.toUpperCase()} · spot vs perp`);
      ctx.el.innerHTML = `<div class="split"><div class="fix"><div class="kv"></div></div><div class="grow"><div class="chart"></div></div></div>`;
      const kv = ctx.el.querySelector(".kv");
      const chart = QT.chart(ctx.el.querySelector(".chart"), { leftPriceScale: { visible: true, borderColor: "#1c1c1c" } });
      const px = chart.addLineSeries({ priceScaleId: "right", color: "#ffffff", lineWidth: 1, title: "PRICE" });
      chart.priceScale("right").applyOptions({ scaleMargins: { top: 0.04, bottom: 0.55 } });
      const perp = chart.addLineSeries({ priceScaleId: "left", color: "#bdbdbd", lineWidth: 2, title: "PERP CVD", priceFormat: { type: "custom", formatter: (v) => F.usd(v, 1) } });
      const spot = chart.addLineSeries({ priceScaleId: "left", color: "#6a6a6a", lineWidth: 2, lineStyle: 2, title: "SPOT CVD", priceFormat: { type: "custom", formatter: (v) => F.usd(v, 1) } });
      chart.priceScale("left").applyOptions({ scaleMargins: { top: 0.5, bottom: 0.04 } });
      const cvd = (k) => { let c = 0; return k.map((r) => ({ time: r[0] / 1000, value: (c += 2 * +r[10] - +r[7]) })); };
      const load = async () => {
        try {
          const kp = await QT.get(`${QT.FAPI}/fapi/v1/klines?symbol=${b}USDT&interval=${tf}&limit=${limit}`, 20000);
          let ks = null;
          try { ks = await QT.get(`https://api.binance.com/api/v3/klines?symbol=${b}USDT&interval=${tf}&limit=${limit}`, 20000); } catch {}
          px.setData(kp.map((r) => ({ time: r[0] / 1000, value: +r[4] })));
          const cp = cvd(kp); perp.setData(cp);
          const cs = ks && ks.length ? cvd(ks) : []; spot.setData(cs);
          chart.timeScale().fitContent();
          const dPx = (+kp[kp.length - 1][4] / +kp[0][1] - 1) * 100, dP = cp[cp.length - 1].value, dS = cs.length ? cs[cs.length - 1].value : null;
          const lead = dS == null ? "no spot market" : Math.abs(dS) > Math.abs(dP) * 0.6 ? "SPOT-LED" : "PERP-LED";
          const agree = Math.sign(dP) === Math.sign(dPx) ? "flow confirms price" : "flow diverges from price";
          kv.innerHTML = kvHtml([["Δ PRICE", F.sgn(dPx, F.pct(dPx))], ["PERP CVD", F.sgn(dP, F.usd(dP, 1))], ["SPOT CVD", dS == null ? "—" : F.sgn(dS, F.usd(dS, 1))], ["READ", `${lead} · ${agree}`]]);
          ctx.setMeta(lead);
        } catch (e) { ctx.error(e); }
      };
      load(); ctx.every(30000, load);
      return () => chart.remove();
    },
  };

  // ============================================================ OPT — Deribit options
  QT.fn.OPT = {
    name: "Options (Deribit)", desc: "DVOL, ATM IV term structure, 10% OTM skew, put/call open interest, max pain — BTC and ETH", sym: true,
    mount(ctx) {
      const b = ctx.sym;
      if (!["BTC", "ETH"].includes(b)) { ctx.el.innerHTML = `<div class="msg">Deribit lists liquid options for BTC and ETH only. Type <b>BTC OPT</b> or <b>ETH OPT</b>.</div>`; return; }
      ctx.el.innerHTML = `<div class="split"><div class="fix"><div class="kv"></div></div><div class="fix" style="height:38%;position:relative;border-bottom:1px solid #1c1c1c"><div class="chart"></div></div><div class="grow" style="overflow:auto"><table class="t"><thead><tr><th>EXPIRY</th><th>DAYS</th><th>ATM IV</th><th>SKEW 10%</th><th>OI CALLS</th><th>OI PUTS</th><th>P/C</th><th>MAX PAIN</th></tr></thead><tbody></tbody></table><div class="note">SKEW 10% = IV of the ~10% OTM put minus the ~10% OTM call (positive = downside protection is richer). OI in ${b}.</div></div></div>`;
      const kv = ctx.el.querySelector(".kv"), tb = ctx.el.querySelector("tbody");
      const chart = QT.chart(ctx.el.querySelector(".chart"));
      const dv = chart.addAreaSeries({ lineColor: "#e6e6e6", topColor: "rgba(255,255,255,0.15)", bottomColor: "rgba(255,255,255,0)", lineWidth: 1, title: "DVOL" });
      const load = async () => {
        try {
          const now = Date.now();
          const [opts, ix, dvol] = await Promise.all([
            QT.get(`https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${b}&kind=option`, 60000),
            QT.get(`https://www.deribit.com/api/v2/public/get_index_price?index_name=${b.toLowerCase()}_usd`, 10000),
            QT.get(`https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=${b}&start_timestamp=${now - 30 * 864e5}&end_timestamp=${now}&resolution=3600`, 300000),
          ]);
          const spot = ix.result.index_price;
          const pts = dvol.result.data.map((r) => ({ time: Math.floor(r[0] / 1000), value: r[4] }));
          dv.setData(pts); chart.timeScale().fitContent();
          const byExp = {};
          for (const o of opts.result) {
            const [, code, k, cp] = o.instrument_name.split("-");
            const exp = deribitExpiry(code); if (!exp || exp < now) continue;
            (byExp[exp] ||= []).push({ k: +k, cp, iv: o.mark_iv, oi: o.open_interest, F: o.underlying_price });
          }
          let totC = 0, totP = 0;
          const rows = Object.entries(byExp).map(([exp, list]) => {
            exp = +exp;
            const Fw = list[0].F, near = (target, cp) => list.filter((x) => x.cp === cp).sort((a, c) => Math.abs(a.k - target) - Math.abs(c.k - target))[0];
            const ac = near(Fw, "C"), ap = near(Fw, "P");
            const atm = ac && ap ? (ac.iv + ap.iv) / 2 : (ac || ap || {}).iv;
            const p90 = near(Fw * 0.9, "P"), c110 = near(Fw * 1.1, "C");
            const oc = list.filter((x) => x.cp === "C").reduce((a, x) => a + x.oi, 0), op = list.filter((x) => x.cp === "P").reduce((a, x) => a + x.oi, 0);
            totC += oc; totP += op;
            // max pain: settlement price at which option holders' total intrinsic value is smallest
            const strikes = [...new Set(list.map((x) => x.k))];
            let mp = null, best = Infinity;
            for (const S of strikes) {
              const pay = list.reduce((a, x) => a + x.oi * (x.cp === "C" ? Math.max(0, S - x.k) : Math.max(0, x.k - S)), 0);
              if (pay < best) { best = pay; mp = S; }
            }
            return { exp, days: (exp - now) / 864e5, atm, skew: p90 && c110 ? p90.iv - c110.iv : null, oc, op, pc: oc ? op / oc : null, mp, oiTot: oc + op };
          }).filter((r) => r.oiTot > 50).sort((a, c) => a.exp - c.exp);
          tb.innerHTML = rows.map((r) => `<tr><td class="hi">${F.date(r.exp)}</td><td>${r.days.toFixed(1)}</td><td class="b">${r.atm != null ? r.atm.toFixed(1) + "%" : "—"}</td><td>${r.skew != null ? F.sgn(r.skew, (r.skew > 0 ? "+" : "") + r.skew.toFixed(1)) : "—"}</td><td>${F.num(r.oc, 0)}</td><td>${F.num(r.op, 0)}</td><td>${r.pc != null ? r.pc.toFixed(2) : "—"}</td><td>${F.px(r.mp)}</td></tr>`).join("");
          const lastDv = pts[pts.length - 1].value, hi = Math.max(...pts.map((p) => p.value)), lo = Math.min(...pts.map((p) => p.value));
          const front = rows[0];
          const move = lastDv / Math.sqrt(365);   // DVOL is annualized: one-day 1-sigma move in %
          kv.innerHTML = kvHtml([["INDEX", F.px(spot)], ["DVOL", lastDv.toFixed(1)], ["DVOL 30D RANGE", `${lo.toFixed(1)} – ${hi.toFixed(1)}`],
            ["IMPLIED 1D MOVE", "±" + move.toFixed(2) + "%"], ["P/C OI TOTAL", (totP / totC).toFixed(2)],
            ["FRONT MAX PAIN", front ? `${F.px(front.mp)} (${F.pct((front.mp / spot - 1) * 100, 1)})` : "—"]]);
          ctx.setMeta(`DVOL ${lastDv.toFixed(1)} · ±${move.toFixed(2)}%/day`);
        } catch (e) { ctx.error(e); }
      };
      load(); ctx.every(60000, load);
      return () => chart.remove();
    },
  };
})();
