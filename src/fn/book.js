(() => {
  const QT = window.QT, F = QT.f;
  const kvHtml = (pairs) => pairs.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("");
  const offline = (ctx, e) => {
    ctx.el.innerHTML = `<div class="msg">Book server unavailable — ${String(e && e.message || e)}.<br><br>`
      + `Эти панели показывают демо-счёт бота <b>quant-sma-bot</b> (dashboard_app.py). Десктоп-версия запускает его сама, если папка бота лежит рядом; в веб-версии и без бота они недоступны. Повтор каждые 15 с.</div>`;
  };
  const STRATS = ["trend", "portvol", "carry"];

  // ============================================================ PORT — our book
  QT.fn.PORT = {
    name: "Portfolio · our book", desc: "Binance demo futures book: account, equity curve, strategy sleeves, open positions", sym: false,
    mount(ctx) {
      let chart = null, area = null, built = false;
      const build = () => {
        ctx.el.innerHTML = `<div class="split"><div class="fix"><div class="kv"></div></div><div class="grow" style="min-height:110px"><div class="chart"></div></div><div class="fix" style="max-height:52%;overflow:auto"><div class="sec">STRATEGIES</div><table class="t st"><thead><tr><th>SLEEVE</th><th>CAPITAL</th><th>EQUITY</th><th>P&L</th><th>%</th><th>UNREAL</th><th>MAX DD</th></tr></thead><tbody></tbody></table><div class="sec">POSITIONS</div><table class="t ps"><thead><tr><th>ASSET</th><th class="l">STRATEGY</th><th>QTY</th><th>ENTRY</th><th>MARK</th><th>NOTIONAL</th><th>LEV</th><th>UNREAL</th></tr></thead><tbody></tbody></table></div></div>`;
        chart = QT.chart(ctx.el.querySelector(".chart"), { timeScale: { borderColor: "#1c1c1c", timeVisible: true } });
        area = chart.addAreaSeries({ lineColor: "#ffffff", topColor: "rgba(255,255,255,0.16)", bottomColor: "rgba(255,255,255,0)", lineWidth: 1, priceFormat: { type: "custom", formatter: (v) => "$" + v.toFixed(0) } });
        built = true;
      };
      const load = async () => {
        try {
          const s = await QT.bookGet("/api/status", 10000);
          if (!built) build();
          const a = s.account;
          ctx.el.querySelector(".kv").innerHTML = kvHtml([["EQUITY", "$" + F.num(a.total)], ["WALLET", "$" + F.num(a.wallet)], ["AVAILABLE", "$" + F.num(a.available)],
            ["UNREALIZED", F.sgn(a.unrealized_pnl, F.usd(a.unrealized_pnl))], ["DAY P&L", F.sgn(a.day_pnl, `${a.day_pnl >= 0 ? "+" : "-"}$${F.num(Math.abs(a.day_pnl))} (${F.pct(a.day_pnl_pct)})`)]]);
          // equity curve: strictly increasing timestamps for lightweight-charts
          const e = s.equity || {}, pts = [];
          (e.t || []).forEach((t, i) => { const v = e.book_usd && e.book_usd[i]; if (v != null) pts.push({ time: Math.floor(t), value: v }); });
          pts.sort((x, y) => x.time - y.time);
          area.setData(pts.filter((p, i) => !i || p.time > pts[i - 1].time));
          chart.timeScale().fitContent();
          const st = s.strategies || {};
          ctx.el.querySelector(".st tbody").innerHTML = STRATS.filter((k) => st[k]).map((k) => {
            const x = st[k];
            return `<tr><td class="hi b">${k.toUpperCase()}</td><td>$${F.num(x.capital, 0)}</td><td>$${F.num(x.equity)}</td><td>${F.sgn(x.pnl, F.usd(x.pnl))}</td><td class="b">${F.sgn(x.pnl_pct, F.pct(x.pnl_pct))}</td><td>${F.sgn(x.unrealized, F.usd(x.unrealized))}</td><td class="dn">${F.pct(x.max_dd)}</td></tr>`;
          }).join("");
          const rows = [];
          for (const [asset, x] of Object.entries(s.assets || {})) {
            for (const m of x.moons || []) {
              if (m.legs) {
                for (const l of m.legs) rows.push(`<tr><td class="hi b">${asset}</td><td class="l">carry · ${l.side} ${l.symbol}</td><td>${F.num(l.qty, 4)}</td><td>${F.px(l.avg_price)}</td><td>${F.px(l.mark)}</td><td>${F.usd(l.notional)}</td><td class="dim">—</td><td>${F.sgn(l.unrealized, F.usd(l.unrealized))}</td></tr>`);
              } else {
                rows.push(`<tr class="click" data-s="${asset}"><td class="hi b">${asset}</td><td class="l">${m.strategy}</td><td>${F.num(m.qty, 4)}</td><td>${F.px(m.avg_price)}</td><td>${F.px(x.mark)}</td><td>${F.usd(m.notional)}</td><td>${m.leverage.toFixed(2)}x</td><td>${F.sgn(m.unrealized, F.usd(m.unrealized))}</td></tr>`);
              }
            }
          }
          const tb = ctx.el.querySelector(".ps tbody");
          tb.innerHTML = rows.join("") || `<tr><td colspan="8" class="dim l">flat</td></tr>`;
          tb.querySelectorAll("tr[data-s]").forEach((tr) => (tr.onclick = () => QT.setFocus(tr.dataset.s)));
          ctx.setMeta(`$${F.num(a.total)} · day ${F.sgn(a.day_pnl_pct, F.pct(a.day_pnl_pct))}`);
        } catch (e) { built = false; if (chart) { chart.remove(); chart = null; } offline(ctx, e); }
      };
      load(); ctx.every(15000, load);
      return () => chart && chart.remove();
    },
  };

  // ============================================================ SIG — model signals
  QT.fn.SIG = {
    name: "Signals · our models", desc: "Trend (SMA50 regime), portfolio-vol leverage, carry trade state, historical edge at today's SMA distance", sym: false,
    mount(ctx) {
      const load = async () => {
        try {
          const [s, q] = await Promise.all([QT.bookGet("/api/status", 10000), QT.bookGet("/api/quant", 120000).catch(() => null)]);
          const H = ctx.args.find((x) => ["7", "30", "90"].includes(x)) || "30";
          const rows = Object.entries(s.assets || {}).map(([asset, x]) => {
            const g = x.signal || {}, ed = q && q.edge && q.edge[asset] && q.edge[asset][H];
            return `<tr class="click" data-s="${asset}"><td class="hi b">${asset}</td><td>${F.px(x.mark)}</td><td>${F.chg(x.chg24)}</td>`
              + `<td class="${g.is_long ? "inv" : "dim"}" style="text-align:center">${g.is_long ? "LONG" : "FLAT"}</td><td>${F.sgn(g.dist_pct, F.pct(g.dist_pct, 1))}</td>`
              + `<td>${g.vol != null ? (g.vol * 100).toFixed(0) + "%" : "—"}</td><td>${g.leverage != null ? g.leverage.toFixed(2) + "x" : "—"}</td>`
              + `<td>${g.portvol_long ? "LONG" : "FLAT"}</td>`
              + (ed ? `<td>${(ed.hit * 100).toFixed(0)}%</td><td>${F.sgn(ed.mean, F.pct(ed.mean * 100, 1))}</td><td class="b">${F.sgn(ed.edge_pp, (ed.edge_pp > 0 ? "+" : "") + ed.edge_pp.toFixed(1) + "pp")}</td><td class="dim">${ed.n}</td>` : `<td colspan="4" class="dim">—</td>`)
              + "</tr>";
          });
          const c = s.carry || {}, pv = s.portvol || {};
          ctx.el.innerHTML = `<table class="t"><thead><tr><th>ASSET</th><th>MARK</th><th>24H</th><th style="text-align:center">TREND</th><th>VS SMA50</th><th>VOL ANN</th><th>TREND LEV</th><th>PORTVOL</th><th>HIT ${H}D</th><th>MEAN ${H}D</th><th>EDGE</th><th>N</th></tr></thead><tbody>${rows.join("")}</tbody></table>`
            + `<div class="sec">PORTFOLIO VOL TARGET</div><div class="kv">${kvHtml([["BOOK VOL", pv.portfolio_vol != null ? (pv.portfolio_vol * 100).toFixed(1) + "%" : "—"], ["TARGET", pv.target_vol != null ? (pv.target_vol * 100).toFixed(0) + "%" : "—"], ["LEVERAGE", pv.leverage != null ? pv.leverage.toFixed(2) + "x" : "—"]])}</div>`
            + `<div class="sec">CARRY · ${c.quarterly || "—"}</div><div class="kv">${kvHtml([["STATE", c.in_position ? "IN POSITION" : "FLAT"], ["FUNDING ANN", F.sgn(c.funding_ann_pct, F.pct(c.funding_ann_pct, 2))], ["BASIS ANN", F.sgn(c.basis_ann_pct, F.pct(c.basis_ann_pct, 2))], ["NET ANN", F.sgn(c.net_ann_pct, F.pct(c.net_ann_pct, 2))], ["EXPIRY", `${c.expiry || "—"} · ${c.days_to_expiry != null ? c.days_to_expiry.toFixed(0) + "d" : ""}`]])}</div>`
            + `<div class="note">EDGE = hit rate at today's SMA50 distance minus the unconditional hit rate, ${H}-day forward, Binance daily history. Type <b>SIG 7</b> / <b>SIG 90</b> for other horizons.</div>`;
          ctx.el.querySelectorAll("tr[data-s]").forEach((tr) => (tr.onclick = () => QT.setFocus(tr.dataset.s)));
          const longs = Object.values(s.assets || {}).filter((x) => x.signal && x.signal.is_long).length;
          ctx.setMeta(`${longs}/${Object.keys(s.assets || {}).length} long · carry ${c.in_position ? "on" : "off"}`);
        } catch (e) { offline(ctx, e); }
      };
      load(); ctx.every(30000, load);
    },
  };

  // ============================================================ RISK — Monte Carlo + exposure
  QT.fn.RISK = {
    name: "Risk · our book", desc: "Monte Carlo (block bootstrap) VaR/CVaR, drawdown odds, profit probability, exposure by asset", sym: false,
    mount(ctx) {
      const load = async () => {
        try {
          const [s, q] = await Promise.all([QT.bookGet("/api/status", 10000), QT.bookGet("/api/quant", 120000)]);
          const mc = q.mc || {}, meta = mc.meta || {}, hz = mc.horizons || {};
          const eq = s.account.total;
          const hrows = Object.values(hz).sort((a, b) => a.days - b.days).map((h) => {
            const pdd = Object.entries(h.p_dd || {}).map(([k, v]) => `${k}%: ${(v * 100).toFixed(0)}%`).join(" · ");
            return `<tr><td class="hi b">${h.days}D</td><td class="b">${(h.p_profit * 100).toFixed(0)}%</td><td>${F.sgn(h.end_median, F.usd(h.end_median))}</td><td>${F.sgn(h.end_p5, F.usd(h.end_p5))}</td><td>${F.sgn(h.end_p95, F.usd(h.end_p95))}</td><td class="dn">-$${F.num(h.var95, 0)}</td><td class="dn">-$${F.num(h.cvar95, 0)}</td><td>${(h.dd_median * 100).toFixed(1)}%</td><td>${(h.dd_p95 * 100).toFixed(1)}%</td><td class="mid l">${pdd}</td></tr>`;
          }).join("");
          const ex = Object.entries(meta.exposure || {}).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
          const exMax = Math.max(1, ...ex.map(([, v]) => Math.abs(v)));
          ctx.el.innerHTML = `<div class="kv">${kvHtml([["EQUITY", "$" + F.num(eq)], ["GROSS EXPOSURE", F.usd(meta.gross_exposure)], ["NET EXPOSURE", F.usd(meta.net_exposure)],
            ["GROSS LEVERAGE", meta.gross_exposure ? (meta.gross_exposure / eq).toFixed(2) + "x" : "—"], ["BOOK VOL ANN", meta.book_vol_ann != null ? (meta.book_vol_ann * 100).toFixed(1) + "%" : "—"],
            ["1D 1σ", meta.book_vol_ann != null ? "±$" + F.num(eq * meta.book_vol_ann / Math.sqrt(365), 0) : "—"]])}</div>`
            + `<div class="sec">MONTE CARLO · ${meta.n_sims || "—"} PATHS · BLOCK ${meta.block || "—"}D · HISTORY ${meta.from || ""} → ${meta.to || ""}</div>`
            + `<table class="t"><thead><tr><th>HORIZON</th><th>P(PROFIT)</th><th>MEDIAN</th><th>P5</th><th>P95</th><th>VAR95</th><th>CVAR95</th><th>DD MED</th><th>DD P95</th><th class="l">P(DRAWDOWN ≥)</th></tr></thead><tbody>${hrows}</tbody></table>`
            + `<div class="sec">EXPOSURE BY ASSET</div><table class="t"><tbody>${ex.map(([k, v]) => `<tr><td class="hi b" style="width:70px">${k}</td><td style="width:110px">${F.usd(v)}</td><td class="l"><div class="hbar"><i style="width:${Math.abs(v) / exMax * 100}%"></i></div></td><td style="width:70px">${(v / eq * 100).toFixed(0)}%</td></tr>`).join("")}</tbody></table>`
            + `<div class="note">Simulation resamples 5-day blocks of joint daily returns at today's exposures. It assumes positions stay as they are — the live models rebalance, so treat it as a stress picture, not a forecast.</div>`;
          const h30 = Object.values(hz).find((h) => h.days === 30);
          ctx.setMeta(h30 ? `30D VaR95 -$${F.num(h30.var95, 0)} · P(profit) ${(h30.p_profit * 100).toFixed(0)}%` : "");
        } catch (e) { offline(ctx, e); }
      };
      load(); ctx.every(60000, load);
    },
  };

  // ============================================================ ORD — order log
  QT.fn.ORD = {
    name: "Orders · our book", desc: "Order ledger of the demo book: time, strategy, side, size, price. Args: TREND PORTVOL CARRY or a symbol", sym: false,
    mount(ctx) {
      const f = ctx.args[0] ? ctx.args[0].toLowerCase() : null;
      const load = async () => {
        try {
          const s = await QT.bookGet("/api/status", 10000);
          let o = [...(s.orders || [])].sort((a, b) => (a.ts < b.ts ? 1 : -1));
          if (f) o = o.filter((x) => x.strategy === f || (x.asset || "").toLowerCase() === f);
          ctx.el.innerHTML = `<table class="t"><thead><tr><th>TIME UTC</th><th class="l">STRATEGY</th><th class="l">SYMBOL</th><th style="text-align:center">SIDE</th><th>QTY</th><th>PRICE</th><th>NOTIONAL</th></tr></thead><tbody>`
            + (o.map((x) => {
              const sell = /SELL|SHORT|CLOSE/.test(x.side);
              return `<tr><td>${x.ts.slice(0, 10)} ${x.ts.slice(11, 19)}</td><td class="l">${x.strategy}</td><td class="l hi">${x.symbol}</td><td style="text-align:center" class="${sell ? "dn" : x.side === "ADOPT" ? "dim" : "inv"}">${x.side}</td><td>${F.num(x.qty, 4)}</td><td>${F.px(x.price)}</td><td>${F.usd(x.notional)}</td></tr>`;
            }).join("") || `<tr><td colspan="7" class="dim l">no orders</td></tr>`) + "</tbody></table>"
            + `<div class="note">ADOPT = an existing exchange position taken into a sleeve's ledger without trading.</div>`;
          const last = o[0];
          ctx.setMeta(`${o.length} orders${last ? " · last " + last.ts.slice(0, 16).replace("T", " ") : ""}`);
        } catch (e) { offline(ctx, e); }
      };
      load(); ctx.every(30000, load);
    },
  };
})();
