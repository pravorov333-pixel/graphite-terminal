(() => {
  const QT = window.QT, F = QT.f;
  // ============================================================ JOURNAL — your own trades in R and $, next to the terminal's
  // forward log of SETUP signals and the backtest, so after 2–3 months it's clear what works live and what doesn't.
  // Stored in localStorage ("qt.journal"); CSV export for a backup.
  const PV = { NQ: 20, MNQ: 2, ES: 50, MES: 5 };
  const SETUPS = [["RB", "RB CE"], ["10AM", "10:00 реклейм"], ["OTHER", "другое"]];
  const SET_RU = Object.fromEntries(SETUPS);
  QT.journal = QT.load("journal", []);
  const save = () => { QT.save("journal", QT.journal); QT.emit("journal"); };

  const calc = (x) => {
    const d = x.stop < x.entry ? 1 : -1, risk = Math.abs(x.entry - x.stop);
    const pts = x.exit != null && x.exit !== "" ? (x.exit - x.entry) * d : null;
    const usd = pts == null ? null : pts * (PV[x.inst] || 1) * x.qty - (x.fees || 0);
    const r = pts == null || !risk ? null : pts / risk - (x.fees || 0) / (risk * (PV[x.inst] || 1) * x.qty || 1);
    return { d, risk, pts, usd, r, open: pts == null };
  };
  const stats = (rs) => {
    if (!rs.length) return null;
    const n = rs.length, sum = rs.reduce((a, x) => a + x, 0);
    let eq = 0, peak = 0, dd = 0; for (const x of rs) { eq += x; peak = Math.max(peak, eq); dd = Math.min(dd, eq - peak); }
    return { n, win: (rs.filter((x) => x > 0).length / n) * 100, avg: sum / n, sum, dd };
  };
  const rTxt = (v, d = 2) => (v == null ? "—" : F.sgn(v, `${v >= 0 ? "+" : ""}${v.toFixed(d)}R`));
  const usdTxt = (v) => (v == null ? "—" : F.sgn(v, `${v >= 0 ? "+" : "−"}$${F.num(Math.abs(v), 0)}`));
  const dt = (ms) => new Date(ms).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const localInput = (ms) => { const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60e3); return d.toISOString().slice(0, 16); };
  const spark = (rs) => {
    if (rs.length < 2) return "";
    let eq = 0; const pts = [0, ...rs.map((x) => (eq += x))], lo = Math.min(...pts), hi = Math.max(...pts), W = 600, H = 60, span = hi - lo || 1;
    const xy = pts.map((v, i) => `${((i / (pts.length - 1)) * W).toFixed(1)},${(H - ((v - lo) / span) * H).toFixed(1)}`).join(" ");
    const zero = H - ((0 - lo) / span) * H;
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:60px;display:block;padding:4px 0"><line x1="0" x2="${W}" y1="${zero}" y2="${zero}" stroke="#333" stroke-dasharray="3 3"/><polyline points="${xy}" fill="none" stroke="#e8e8e8" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`;
  };

  QT.fn.JOURNAL = {
    name: "Trade journal", desc: "Your trades in R and $ by setup, equity curve, drawdown; the terminal's forward log of SETUP signals next to the backtest; CSV export", sym: false,
    mount(ctx) {
      let editId = null;
      const blank = () => ({ t: Date.now(), inst: "MNQ", setup: "RB", entry: "", stop: "", target: "", exit: "", qty: 1, fees: 0, note: "" });
      let form = blank();
      const fromSig = (s) => {
        const inst = s.sym === "ES" ? "MES" : "MNQ", z = QT.setupSize ? QT.setupSize(s.R, s.sym) : null;
        editId = null;
        form = { t: s.fillT || s.actT || s.t, inst, setup: s.setup, entry: +s.entry.toFixed(2), stop: +s.stop.toFixed(2), target: +s.target.toFixed(2), exit: "", qty: z && z.mini > 0 ? z.mini : 1, fees: 0, note: "", sigId: s.id };
      };
      if (QT.journalDraft) { fromSig(QT.journalDraft); QT.journalDraft = null; }

      const paint = () => {
        const rows = QT.journal.map((x) => ({ x, c: calc(x) })).sort((a, b) => b.x.t - a.x.t);
        const closed = rows.filter((r) => !r.c.open).sort((a, b) => a.x.t - b.x.t);
        const all = stats(closed.map((r) => r.c.r)), usd = closed.reduce((a, r) => a + r.c.usd, 0);
        // the terminal's own signals since the first start: valid ones, filled and resolved
        const sig = (QT.sigLog || []).filter((s) => s.valid && ["target", "stop", "time"].includes(s.state)).sort((a, b) => a.t - b.t);
        const BT = QT.SETUP_BACKTEST || {};
        const bySetup = SETUPS.map(([k, ru]) => {
          const mine = stats(closed.filter((r) => r.x.setup === k).map((r) => r.c.r));
          const term = stats(sig.filter((s) => s.setup === k).map((s) => s.res));
          return `<tr><td class="l">${ru}</td><td>${mine ? mine.n : 0}</td><td>${mine ? mine.win.toFixed(0) + "%" : "—"}</td><td>${mine ? rTxt(mine.avg) : "—"}</td><td>${mine ? rTxt(mine.sum, 1) : "—"}</td>`
            + `<td>${k === "OTHER" ? "" : term ? `${term.n} · ${rTxt(term.avg)}` : "0"}</td><td class="dim">${BT[k] ? BT[k].note : ""}</td></tr>`;
        }).join("");
        const f = form, fld = (k, label, type = "number", step = "any") => `<label><span>${label}</span><input data-f="${k}" type="${type}" step="${step}" value="${QT.esc(type === "datetime-local" ? localInput(f.t) : f[k] ?? "")}"></label>`;
        const sel = (k, label, opts) => `<label><span>${label}</span><select data-f="${k}">${opts.map(([v, t]) => `<option value="${v}" ${String(f[k]) === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>`;
        const pv = calc({ ...f, entry: +f.entry, stop: +f.stop, exit: f.exit === "" ? null : +f.exit, qty: +f.qty || 1, fees: +f.fees || 0 });
        const preview = +f.entry && +f.stop && +f.entry !== +f.stop
          ? `${pv.d > 0 ? "LONG" : "SHORT"} · риск ${pv.risk.toFixed(2)} п = $${F.num(pv.risk * (PV[f.inst] || 1) * (+f.qty || 1), 0)}${+f.target ? ` · цель ${(Math.abs(+f.target - +f.entry) / pv.risk).toFixed(1)}R` : ""}${pv.open ? " · открыта (впиши выход, когда закроешь)" : ` · итог ${rTxt(pv.r)} ${usdTxt(pv.usd)}`}`
          : "впиши вход и стоп: направление определяется по стопу";
        const list = rows.slice(0, 60).map(({ x, c }) => `<tr class="click" data-e="${x.id}"><td class="l">${dt(x.t)}</td><td class="l">${x.inst} ${c.d > 0 ? "▲" : "▼"}</td><td class="l">${SET_RU[x.setup] || x.setup}</td><td>${F.num(x.entry, 2)}</td><td>${F.num(x.stop, 2)}</td><td>${x.exit == null || x.exit === "" ? '<span class="tag">ОТКРЫТА</span>' : F.num(x.exit, 2)}</td><td>${x.qty}</td><td>${rTxt(c.r)}</td><td>${usdTxt(c.usd)}</td><td class="l dim" style="max-width:160px;overflow:hidden;text-overflow:ellipsis">${QT.esc(x.note || "")}</td><td><span class="tag" data-del="${x.id}" style="cursor:pointer" title="Удалить">×</span></td></tr>`).join("");
        const sigRows = (QT.sigLog || []).filter((s) => s.valid && s.state !== "cancel" && s.state !== "expired").slice(0, 15)
          .map((s) => `<tr><td class="l">${dt(s.t)}</td><td class="l">${s.sym} ${(QT.SETUP_RU || {})[s.setup] || s.setup} ${s.bull ? "▲" : "▼"}</td><td>${F.num(s.entry, 2)}</td><td class="l">${{ limit: "лимит", open: "в сделке", target: "цель", stop: "стоп", time: "по времени" }[s.state] || s.state}</td><td>${rTxt(s.res)}</td><td class="l dim">${s.late ? "пропущен (терминал был закрыт)" : ""}</td></tr>`).join("");

        ctx.el.innerHTML = `<div class="kv">${[["СДЕЛОК", all ? all.n : 0], ["ПРИБЫЛЬНЫХ", all ? all.win.toFixed(0) + "%" : "—"], ["СРЕДНИЙ R", all ? rTxt(all.avg) : "—"], ["СУММА R", all ? rTxt(all.sum, 1) : "—"], ["ИТОГ $", closed.length ? usdTxt(usd) : "—"], ["МАКС. ПРОСАДКА", all ? rTxt(all.dd, 1) : "—"]].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("")}</div>`
          + spark(closed.map((r) => r.c.r))
          + `<div class="sec">${editId ? "ПРАВКА СДЕЛКИ" : "НОВАЯ СДЕЛКА"}${f.sigId ? " · ИЗ СИГНАЛА SETUP" : ""}</div>`
          + `<div class="form" data-jform>${fld("t", "ВРЕМЯ ВХОДА", "datetime-local")}${sel("inst", "КОНТРАКТ", Object.keys(PV).map((k) => [k, k]))}${sel("setup", "СЕТАП", SETUPS)}${fld("qty", "КОНТРАКТОВ", "number", "1")}`
          + `${fld("entry", "ВХОД")}${fld("stop", "СТОП")}${fld("target", "ЦЕЛЬ")}${fld("exit", "ВЫХОД (ПУСТО = ОТКРЫТА)")}${fld("fees", "КОМИССИИ $", "number", "0.01")}${fld("note", "ЗАМЕТКА", "text")}`
          + `<label><span>&nbsp;</span><button class="tag" data-act="save" style="cursor:pointer;background:transparent">${editId ? "СОХРАНИТЬ" : "ДОБАВИТЬ"}</button>${editId || f.sigId ? ` <button class="tag" data-act="cancel" style="cursor:pointer;background:transparent">ОТМЕНА</button>` : ""}</label></div>`
          + `<div class="note jprev">${preview}</div>`
          + `<div class="sec">ПО СЕТАПАМ · ТЫ / ТЕРМИНАЛ / БЭКТЕСТ</div><table class="t"><thead><tr><th class="l">СЕТАП</th><th>СДЕЛОК</th><th>WIN</th><th>СРЕДНИЙ</th><th>СУММА</th><th>СИГНАЛЫ ТЕРМИНАЛА</th><th>БЭКТЕСТ</th></tr></thead><tbody>${bySetup}</tbody></table>`
          + `<div class="sec">СДЕЛКИ <span class="tag" data-act="csv" style="cursor:pointer;margin-left:8px">ЭКСПОРТ CSV</span></div>`
          + (list ? `<table class="t"><thead><tr><th class="l">ВРЕМЯ</th><th class="l">КОНТРАКТ</th><th class="l">СЕТАП</th><th>ВХОД</th><th>СТОП</th><th>ВЫХОД</th><th>КОЛ.</th><th>R</th><th>$</th><th class="l">ЗАМЕТКА</th><th></th></tr></thead><tbody>${list}</tbody></table>` : `<div class="note">Пока пусто. Добавь сделку вручную или нажми «→ В ЖУРНАЛ» на сигнале в SETUP.</div>`)
          + `<div class="sec">СИГНАЛЫ ТЕРМИНАЛА С ${new Date(QT.sigSince || Date.now()).toLocaleDateString("ru-RU")} (ПРОВЕРКА ВПЕРЁД)</div>`
          + (sigRows ? `<table class="t"><tbody>${sigRows}</tbody></table>` : `<div class="note">Сигналов по тренду ещё не было. Они пишутся сами, даже если ты их не торговал.</div>`)
          + `<div class="note"><b>R</b> — результат в рисках: +2R = заработал два своих риска, −1R = стоп. Считается от расстояния вход–стоп, комиссии вычитаются. <b>Сигналы терминала</b> — модельный результат каждого сигнала SETUP по тренду (так, как если бы он исполнялся строго по правилам), это и есть проверка вперёд. Сравни три колонки: если твой средний R заметно хуже сигналов терминала — проблема в исполнении (поздние входы, сдвиг стопа, ранний выход); если и сигналы терминала через 60–100 сделок хуже бэктеста — сетап не работает вживую. Клик по сделке — правка. Данные хранятся в этом терминале — делай экспорт CSV для копии.</div>`;

        // ---- wiring
        const read = () => {
          ctx.el.querySelectorAll("[data-f]").forEach((i) => {
            const k = i.dataset.f;
            if (k === "t") { const v = Date.parse(i.value); if (isFinite(v)) form.t = v; }
            else if (["inst", "setup", "note"].includes(k)) form[k] = i.value;
            else form[k] = i.value === "" ? "" : +i.value;
          });
        };
        ctx.el.querySelectorAll("[data-f]").forEach((i) => (i.oninput = i.onchange = () => {
          read();
          const p = calc({ ...form, entry: +form.entry, stop: +form.stop, exit: form.exit === "" ? null : +form.exit, qty: +form.qty || 1, fees: +form.fees || 0 });
          ctx.el.querySelector(".jprev").innerHTML = +form.entry && +form.stop && +form.entry !== +form.stop ? `${p.d > 0 ? "LONG" : "SHORT"} · риск ${p.risk.toFixed(2)} п = $${F.num(p.risk * (PV[form.inst] || 1) * (+form.qty || 1), 0)}${p.open ? " · открыта" : ` · итог ${rTxt(p.r)} ${usdTxt(p.usd)}`}` : "впиши вход и стоп: направление определяется по стопу";
        }));
        const act = (a) => ctx.el.querySelector(`[data-act="${a}"]`);
        act("save").onclick = () => {
          read();
          if (!(+form.entry > 0 && +form.stop > 0 && +form.entry !== +form.stop && +form.qty > 0)) { ctx.el.querySelector(".jprev").innerHTML = '<span class="inv" style="padding:1px 6px">нужны вход, стоп (не равный входу) и количество</span>'; return; }
          const rec = { ...form, entry: +form.entry, stop: +form.stop, target: form.target === "" ? null : +form.target, exit: form.exit === "" ? null : +form.exit, qty: +form.qty, fees: +form.fees || 0 };
          if (editId) { const i = QT.journal.findIndex((x) => x.id === editId); if (i >= 0) QT.journal[i] = { ...rec, id: editId }; }
          else QT.journal.push({ ...rec, id: Date.now() });
          editId = null; form = blank(); save();
        };
        if (act("cancel")) act("cancel").onclick = () => { editId = null; form = blank(); paint(); };
        act("csv").onclick = () => {
          const head = "time,contract,setup,direction,entry,stop,target,exit,qty,fees,points,R,usd,note";
          const lines = QT.journal.slice().sort((a, b) => a.t - b.t).map((x) => { const c = calc(x); return [new Date(x.t).toISOString(), x.inst, x.setup, c.d > 0 ? "LONG" : "SHORT", x.entry, x.stop, x.target ?? "", x.exit ?? "", x.qty, x.fees || 0, c.pts == null ? "" : c.pts.toFixed(2), c.r == null ? "" : c.r.toFixed(3), c.usd == null ? "" : c.usd.toFixed(2), `"${String(x.note || "").replace(/"/g, '""')}"`].join(","); });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(new Blob(["﻿" + [head, ...lines].join("\n")], { type: "text/csv" }));
          a.download = `journal-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        };
        ctx.el.querySelectorAll("[data-del]").forEach((t) => (t.onclick = (e) => {
          e.stopPropagation();
          const x = QT.journal.find((j) => String(j.id) === t.dataset.del);
          if (x && confirm(`Удалить сделку ${x.inst} от ${dt(x.t)}?`)) { QT.journal = QT.journal.filter((j) => j !== x); save(); }
        }));
        ctx.el.querySelectorAll("tr[data-e]").forEach((tr) => (tr.onclick = () => {
          const x = QT.journal.find((j) => String(j.id) === tr.dataset.e); if (!x) return;
          editId = x.id; form = { ...blank(), ...x, target: x.target ?? "", exit: x.exit ?? "" }; paint();
          ctx.el.querySelector("[data-jform]").scrollIntoView({ block: "nearest" });
        }));
        const openN = rows.filter((r) => r.c.open).length;
        ctx.setMeta(`${all ? all.n : 0} сделок${all ? " · " + (all.avg >= 0 ? "+" : "") + all.avg.toFixed(2) + "R" : ""}${openN ? ` · ${openN} открыта` : ""}`);
      };
      paint();
      const busy = () => ctx.el.contains(document.activeElement) && document.activeElement.matches("input,select");
      const offs = [QT.on("journal", paint), QT.on("siglog", () => { if (!busy()) paint(); }),
        QT.on("journal-draft", (s) => { fromSig(s); QT.journalDraft = null; paint(); })];
      return () => offs.forEach((f) => f());
    },
  };
})();
