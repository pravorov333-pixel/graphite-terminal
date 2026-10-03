(() => {
  const QT = window.QT, F = QT.f;
  const kvHtml = (pairs) => pairs.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("");

  // ============================================================ SCR — live screener over every USDT perp
  const MULT = { K: 1e3, M: 1e6, B: 1e9 };
  const COLS = [
    ["b", "SYM", "l"], ["type", "TYPE", "l"], ["last", "LAST"], ["chg", "24H"], ["pos", "IN 24H RANGE"], ["vol", "VOL 24H"], ["fr", "FUND ANN"], ["prem", "PREM bp"],
  ];
  QT.fn.SCR = {
    name: "Screener", desc: "All Binance USDT perps, live. Filters: VOL>50M CHG>5 CHG<-5 FR>20 FR<0 PREM<-10 POS>90 · CRYPTO · TRADFI. Click a header to sort",
    sym: false,
    mount(ctx) {
      const filt = [], flags = new Set();
      for (const a of ctx.args) {
        const m = /^(VOL|CHG|FR|PREM|POS)([<>])(-?[\d.]+)([KMB])?$/.exec(a);
        if (m) filt.push({ k: { VOL: "vol", CHG: "chg", FR: "fr", PREM: "prem", POS: "pos" }[m[1]], op: m[2], v: +m[3] * (MULT[m[4]] || 1) });
        else if (a === "CRYPTO" || a === "TRADFI") flags.add(a);
      }
      if (ctx.args.length) ctx.setTitle("Screener · " + ctx.args.join(" "));
      let types = {}, sort = { k: "vol", dir: -1 };
      QT.get(QT.FAPI + "/fapi/v1/exchangeInfo", 3600e3).then((ei) => {
        for (const s of ei.symbols) if (s.quoteAsset === "USDT") types[s.baseAsset] = s.underlyingType === "COIN" ? "CRYPTO" : (s.underlyingSubType || []).includes("TradFi") ? "TRADFI" : s.underlyingType || "";
      }).catch(() => {});
      const rows = () => Object.entries(QT.mkt).filter(([, m]) => m.last && m.qvol).map(([b, m]) => ({
        b, type: types[b] || "", last: m.last, chg: m.chg, vol: m.qvol,
        pos: m.high > m.low ? ((m.last - m.low) / (m.high - m.low)) * 100 : null,
        fr: m.funding != null ? QT.fundAnn(b, m.funding) : null,
        prem: m.mark && m.index ? (m.mark / m.index - 1) * 1e4 : null,
      }));
      const paint = () => {
        let L = rows();
        if (flags.size) L = L.filter((r) => flags.has(r.type));
        for (const f of filt) L = L.filter((r) => r[f.k] != null && (f.op === ">" ? r[f.k] > f.v : r[f.k] < f.v));
        const n = L.length;
        L.sort((a, b) => {
          const x = a[sort.k], y = b[sort.k];
          if (typeof x === "string" || typeof y === "string") return String(x).localeCompare(String(y)) * -sort.dir;
          return ((x ?? -Infinity) - (y ?? -Infinity)) * sort.dir;
        });
        L = L.slice(0, 200);
        ctx.el.innerHTML = `<table class="t"><thead><tr>${COLS.map(([k, t, c]) => `<th class="sort ${c || ""} ${sort.k === k ? "on" : ""}" data-k="${k}">${t}${sort.k === k ? (sort.dir < 0 ? " ▼" : " ▲") : ""}</th>`).join("")}</tr></thead><tbody>`
          + L.map((r) => `<tr class="click" data-s="${r.b}"><td class="l hi b">${r.b}</td><td class="l dim">${r.type}</td><td>${F.px(r.last)}</td><td>${F.chg(r.chg)}</td>`
            + `<td><div class="sharebar"><div class="hbar"><i style="width:${r.pos ?? 0}%"></i></div><span>${r.pos == null ? "—" : r.pos.toFixed(0) + "%"}</span></div></td>`
            + `<td>${F.usd(r.vol, 1)}</td><td class="b">${r.fr == null ? "—" : F.sgn(r.fr, F.pct(r.fr, 1))}</td><td>${r.prem == null ? "—" : F.sgn(r.prem, r.prem.toFixed(1))}</td></tr>`).join("")
          + "</tbody></table>";
        ctx.el.querySelectorAll("th[data-k]").forEach((th) => (th.onclick = () => {
          const k = th.dataset.k; sort = { k, dir: sort.k === k ? -sort.dir : -1 }; paint();
        }));
        ctx.el.querySelectorAll("tr[data-s]").forEach((tr) => (tr.onclick = () => QT.setFocus(tr.dataset.s)));
        ctx.setMeta(`${n} match${n > 200 ? " · top 200 shown" : ""}`);
      };
      paint();
      ctx.every(3000, () => { if (!ctx.el.matches(":hover")) paint(); });   // don't reshuffle rows under the cursor
    },
  };

  // ============================================================ CALC — position sizing & risk
  QT.fn.CALC = {
    name: "Position calculator", desc: "Size from account risk %, stop and target: quantity, margin, R:R, fees, breakeven, approx. liquidation, funding cost", sym: true, proxy: true, fx: true,
    mount(ctx) {
      const b = ctx.sym, m = QT.mkt[b] || {}, last = m.last || 0;
      const saved = QT.load("calc", { acct: 5000, risk: 1, lev: 5, fee: 0.05 });
      const dp = last >= 1000 ? 1 : last >= 10 ? 3 : 5;
      const st = QT.PROXY[b] ? 0.003 : 0.02;      // index futures: ~0.3% stop by default, crypto: 2%
      const v0 = { entry: last.toFixed(dp), stop: (last * (1 - st)).toFixed(dp), target: (last * (1 + 2 * st)).toFixed(dp) };
      const field = (k, label, val, step) => `<label><span>${label}</span><input data-k="${k}" type="number" step="${step}" value="${val}"></label>`;
      ctx.el.innerHTML = `<div class="form">${field("acct", "ACCOUNT $", saved.acct, "100")}${field("risk", "RISK % OF ACCOUNT", saved.risk, "0.1")}${field("entry", `ENTRY · ${b}`, v0.entry, "any")}`
        + `${field("stop", "STOP", v0.stop, "any")}${field("target", "TARGET", v0.target, "any")}${field("lev", "LEVERAGE ×", saved.lev, "1")}${field("fee", "TAKER FEE %", saved.fee, "0.01")}`
        + `<label><span>&nbsp;</span><button class="tag" data-act="live" style="cursor:pointer;background:transparent">ENTRY = LIVE PRICE</button></label></div><div class="kv out"></div><div class="note warn"></div>`
        + `<div class="note">Direction comes from the stop: stop below entry = long, above = short. Liquidation is an isolated-margin estimate with 0.5% maintenance margin — the exchange's tiered figure will differ slightly. Funding uses the live Binance rate.</div>`;
      const out = ctx.el.querySelector(".out"), warn = ctx.el.querySelector(".warn");
      const val = (k) => +ctx.el.querySelector(`input[data-k="${k}"]`).value;
      const calc = () => {
        const acct = val("acct"), risk = val("risk"), entry = val("entry"), stop = val("stop"), target = val("target"), lev = Math.max(1, val("lev")), fee = val("fee") / 100;
        QT.save("calc", { acct, risk, lev, fee: fee * 100 });
        if (!(entry > 0 && stop > 0 && entry !== stop)) { out.innerHTML = ""; warn.textContent = "enter entry and stop"; return; }
        const long = stop < entry, dir = long ? 1 : -1;
        const riskUsd = acct * risk / 100;
        // loss per coin at the stop including round-trip taker fees
        const perCoin = Math.abs(entry - stop) + fee * (entry + stop);
        const qty = riskUsd / perCoin, notional = qty * entry, margin = notional / lev;
        const reward = target > 0 ? (dir * (target - entry) - fee * (entry + target)) * qty : null;
        const be = entry * (1 + dir * 2 * fee);
        const mmr = 0.005, liq = long ? entry * (1 - 1 / lev + mmr) : entry * (1 + 1 / lev - mmr);
        const fr = QT.mkt[b] && QT.mkt[b].funding, frInt = QT.fundInt[b] || 8;
        const fund = fr != null ? -dir * fr * notional : null;            // positive = you receive
        out.innerHTML = kvHtml([["DIRECTION", long ? "LONG" : "SHORT"], ["STOP DISTANCE", F.pct(Math.abs(entry - stop) / entry * 100) .replace("+", "")],
          ["QUANTITY", F.num(qty, qty < 1 ? 5 : 3) + " " + b], ["NOTIONAL", "$" + F.num(notional)], ["MARGIN @" + lev + "×", "$" + F.num(margin)],
          ["MAX LOSS (INCL FEES)", "−$" + F.num(riskUsd)], ["REWARD AT TARGET", reward == null ? "—" : F.sgn(reward, (reward >= 0 ? "+$" : "−$") + F.num(Math.abs(reward)))],
          ["R : R", reward == null ? "—" : (reward / riskUsd).toFixed(2) + "R"], ["BREAKEVEN", F.px(be)], ["LIQUIDATION ≈", F.px(liq)],
          [`FUNDING / ${frInt}H`, fund == null ? "—" : F.sgn(fund, (fund >= 0 ? "+$" : "−$") + F.num(Math.abs(fund)))], ["FUNDING / DAY", fund == null ? "—" : F.sgn(fund, (fund >= 0 ? "+$" : "−$") + F.num(Math.abs(fund * 24 / frInt)))]]);
        const P = QT.PROXY[b];
        if (P) {
          // CME futures: size in contracts — point value $20 NQ / $2 MNQ, $50 ES / $5 MES (exchange fees not included)
          const pts = Math.abs(entry - stop), [big, mini, nb, nm] = P.pv;
          const tgt = target > 0 ? Math.abs(target - entry) : null;
          out.innerHTML = kvHtml([["DIRECTION", long ? "LONG" : "SHORT"], ["STOP", pts.toFixed(2) + " pts"], ["TARGET", tgt == null ? "—" : tgt.toFixed(2) + " pts"],
            ["R : R", tgt == null ? "—" : (tgt / pts).toFixed(2) + "R"], [`CONTRACTS ${nb}`, (riskUsd / (pts * big)).toFixed(2)], [`CONTRACTS ${nm}`, (riskUsd / (pts * mini)).toFixed(1)],
            [`RISK 1 ${nb}`, "$" + F.num(pts * big)], [`RISK 1 ${nm}`, "$" + F.num(pts * mini)], ["MAX LOSS", "−$" + F.num(riskUsd)]]);
          warn.innerHTML = riskUsd < pts * mini ? `<span class="inv" style="padding:1px 6px">⚠ ДАЖЕ 1 ${nm} РИСКУЕТ БОЛЬШЕ $${F.num(riskUsd)} — сдвинь стоп ближе или увеличь риск.</span>` : "";
          ctx.setMeta(`${long ? "LONG" : "SHORT"} ${Math.floor(riskUsd / (pts * mini))} ${nm} · ${tgt == null ? "" : (tgt / pts).toFixed(1) + "R"}`);
          return;
        }
        const stopBeyondLiq = long ? stop <= liq : stop >= liq;
        warn.innerHTML = [
          stopBeyondLiq ? "⚠ STOP IS BEYOND THE LIQUIDATION PRICE — lower the leverage." : "",
          margin > acct ? "⚠ MARGIN EXCEEDS ACCOUNT — raise leverage or cut risk." : "",
          target > 0 && Math.sign(target - entry) !== dir ? "⚠ TARGET IS ON THE WRONG SIDE OF ENTRY." : "",
        ].filter(Boolean).map((s) => `<span class="inv" style="padding:1px 6px">${s}</span>`).join(" ");
        ctx.setMeta(`${long ? "LONG" : "SHORT"} ${F.num(qty, qty < 1 ? 4 : 2)} · ${reward == null ? "" : (reward / riskUsd).toFixed(1) + "R"}`);
      };
      ctx.el.querySelectorAll("input").forEach((i) => i.addEventListener("input", calc));
      ctx.el.querySelector('[data-act="live"]').onclick = () => {
        const p = QT.mkt[b] && QT.mkt[b].last; if (!p) return;
        ctx.el.querySelector('input[data-k="entry"]').value = p.toFixed(dp); calc();
      };
      calc();
      ctx.every(5000, calc);    // funding refresh
    },
  };
})();
