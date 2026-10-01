(() => {
  const QT = window.QT, F = QT.f, E = QT.esc;
  const kvHtml = (pairs) => pairs.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("");

  // ============================================================ news feeds (RSS)
  // [source, url, category]: MARKETS = stocks / indices / macro wires, CRYPTO, FED = Federal Reserve press releases
  const FEEDS = [
    ["CNBC", "https://www.cnbc.com/id/100003114/device/rss/rss.html", "MARKETS"],
    ["CNBC MARKETS", "https://www.cnbc.com/id/20910258/device/rss/rss.html", "MARKETS"],
    ["MARKETWATCH", "https://feeds.content.dowjones.io/public/rss/mw_topstories", "MARKETS"],
    ["MW PULSE", "https://feeds.content.dowjones.io/public/rss/mw_marketpulse", "MARKETS"],
    ["YAHOO FIN", "https://finance.yahoo.com/news/rssindex", "MARKETS"],
    ["NASDAQ", "https://www.nasdaq.com/feed/rssoutbound?category=Markets", "MARKETS"],
    ["INVESTING", "https://www.investing.com/rss/news_25.rss", "MARKETS"],
    ["FED", "https://www.federalreserve.gov/feeds/press_all.xml", "FED"],
    ["COINDESK", "https://www.coindesk.com/arc/outboundfeeds/rss/", "CRYPTO"],
    ["THE BLOCK", "https://www.theblock.co/rss.xml", "CRYPTO"],
    ["COINTELEGRAPH", "https://cointelegraph.com/rss", "CRYPTO"],
    ["DECRYPT", "https://decrypt.co/feed", "CRYPTO"],
  ];
  // feed HTML is parsed in an inert document and reduced to plain text — nothing from a feed is ever rendered as markup
  const text = (html) => (new DOMParser().parseFromString(String(html || ""), "text/html").body.textContent || "").replace(/\s+/g, " ").trim();
  const parseFeed = (src, xml, cat) => {
    const doc = new DOMParser().parseFromString(String(xml), "text/xml");
    return [...doc.querySelectorAll("item")].map((it) => {
      const g = (tag) => (it.querySelector(tag) || {}).textContent || "";
      const link = g("link").trim();
      return { src, cat, title: text(g("title")), link: /^https?:\/\//.test(link) ? link : "", t: Date.parse(g("pubDate")) || 0, desc: text(g("description")).slice(0, 300) };
    }).filter((x) => x.title);
  };
  // ============================================================ market impact of a headline (rule-based, not AI)
  // 3 = high (moves NQ / ES or BTC on its own), 2 = medium (context, can move a sector or add to a move), 1 = low,
  // 0 = noise (listicles, personal finance, evergreen explainers) — hidden unless NEWS ALL.
  const MEGA = /\b(nvidia|nvda|apple|aapl|microsoft|msft|amazon|amzn|meta platforms|meta\b|alphabet|google|googl|broadcom|avgo|tesla|tsla|netflix|nflx)\b/i;
  const NOISE = /(better buy|should you buy|\bis [\w .&'-]{1,40}(a buy|a good buy|stock a buy)\b|stocks? to buy|millionaire|retire(ment)?\b|dividend stocks?|explained\b|my favorite|could beat|could soar|here'?s why|\b(top|best|\d+) (stocks|reasons|ways)\b|buy and hold|forever|passive income|\bvs\.? |review and outlook|personal finance|mortgage rates? today|credit cards?|savings account|sneakers?|\bshoes\b|celebrit|recipe|vacation|\bwedding|survive a (stock )?market crash|\(hint|insider buying report)/i;
  const RULES = {
    MARKETS: [
      // other central banks first, so "Japan's rate hike" isn't read as the Fed
      [2, "ЦБ", /\b(ecb|bank of japan|boj|bank of england|pboc|lagarde|ueda|japan'?s? central bank)\b/i],
      [3, "ФРС", /\b(fomc|powell|federal reserve|fed (chair|raises|cuts|holds|decision|minutes|meeting)|rate (cut|hike|decision)s?)\b/i],
      // US inflation is high impact; another country's print is context
      [2, "ИНФЛЯЦИЯ МИРА", (t) => /\b(cpi|inflation|consumer prices)\b/i.test(t) && /\b(uk|britain|british|euro ?zone|europe|japan|china|germany|canada|australia)\b/i.test(t)],
      [3, "ИНФЛЯЦИЯ", /\b(cpi|pce|inflation|consumer prices|producer prices|ppi)\b/i],
      [3, "ЗАНЯТОСТЬ", /\b(jobs report|payrolls|nonfarm|non-farm|unemployment rate)\b/i],
      [3, "ЭКОНОМИКА", /\b(gdp|recession|stagflation)\b/i],
      [3, "ТАРИФЫ", /\b(tariffs?|trade war|trade deal|export ban)\b/i],
      [3, "ГЕОПОЛИТИКА", /\b(war\b|missiles?|airstrikes?|invasion|attack(s|ed)?|military|aircraft carrier|troops|nuclear|ceasefire)\b/i],
      [3, "БЮДЖЕТ", /\b(government shutdown|shutdown|debt ceiling|default)\b/i],
      [3, "РЫНОК", /\b(stocks? (plunge|plunges|tumble|tumbles|crash|crashes|sink|sinks)|sell-?off|market crash|circuit breaker|bear market|correction territory)\b/i],
      [3, "БАНКИ", /\b(bank (failure|run|collapse)|bailout|credit crunch)\b/i],
      [3, "ОТЧЁТ ГИГАНТА", (t) => MEGA.test(t) && /\b(earnings|results|guidance|outlook|forecast|revenue|quarter(ly)?)\b/i.test(t)],
      [3, "ДОХОДНОСТИ", (t) => /\b(treasury yields?|bond (market|yields)|10-year)\b/i.test(t) && /\b(surge|jump|spike|soar|plunge|tumble|record|highest|lowest)/i.test(t)],
      [2, "ДОХОДНОСТИ", /\b(treasury yields?|bond (market|yields)|10-year|treasury auction)\b/i],
      [2, "НЕФТЬ", /\b(oil|crude|opec|brent|gasoline)\b/i],
      [2, "ВАЛЮТЫ", /\b(dollar|yen|euro\b|currenc(y|ies))\b/i],
      [2, "ДАННЫЕ", /\b(ism|pmi|retail sales|consumer (sentiment|confidence)|housing starts|home sales|jobless claims|jolts|job openings|durable goods|trade deficit|factory orders)\b/i],
      [2, "ФРС", /\b(fed governors?|fed officials?|fed independence|fed president|kashkari|waller|williams|bowman|jefferson|goolsbee|daly|logan|hammack|musalem|warsh|\bfed\b)\b/i],
      [2, "ЦБ", /\bcentral bank\b/i],
      [2, "САНКЦИИ", /\b(sanctions?|iran|israel|taiwan|russia|ukraine|middle east)\b/i],
      [2, "КИТАЙ", /\b(china|beijing|stimulus|export controls?|chip curbs?)\b/i],
      [2, "ГИГАНТ", MEGA],
      [2, "ОТЧЁТ", /\b(earnings|beats?|miss(es|ed)?|guidance|outlook|quarterly (results|profit|revenue)|profit warning|sales (drop|fall|rise|jump))\b/i],
      [2, "ЧИПЫ / ИИ", /\b(semiconductors?|chips?|chipmakers?|ai (spending|capex|bubble|model))\b/i],
      [2, "РЫНОК", /\b(s&p 500|nasdaq|dow jones|stock market|wall street|stock futures|futures)\b/i],
      [1, "IPO", /\b(ipo|goes public|went public|listing)\b/i],
    ],
    CRYPTO: [
      [3, "ETF", /\betfs?\b.*\b(approv|inflow|outflow|filing)|\b(approv|inflow|outflow)\w*\b.*\betfs?\b/i],
      [3, "РЕГУЛЯТОР", /\b(sec (sues|lawsuit|charges|approves)|cftc|ban(s|ned)?\b|crackdown)\b/i],
      [3, "ВЗЛОМ / КРАХ", /\b(hack(ed)?|exploit(ed)?|drain(ed)?|insolven|bankrupt|collapse|halts? withdrawals)\b/i],
      [3, "ФРС", /\b(fomc|powell|federal reserve|rate (cut|hike))\b/i],
      [2, "ЗАКОН", /\b(regulat|legislation|bill\b|congress|senate|mica|stablecoin rules?)\b/i],
      [2, "КИТЫ", /\b(treasury|strategy|microstrategy|saylor|blackrock|fidelity|whales?)\b/i],
      [2, "BTC / ETH", /\b(bitcoin|btc|ether(eum)?|eth)\b/i],
      [1, "СТЕЙБЛЫ", /\b(stablecoins?|usdt|usdc|tether|circle)\b/i],
    ],
    FED: [
      [3, "ФРС", /\b(fomc|monetary policy|interest rates?|federal funds|discount rate|balance sheet)\b/i],
      [1, "ФРС", /\b(enforcement action|application|termination)\b/i],
    ],
  };
  QT.newsImpact = (x) => {
    const t = `${x.title} ${x.desc || ""}`;
    if (NOISE.test(x.title)) return { lvl: 0, tag: "шум" };
    for (const [lvl, tag, re] of RULES[x.cat] || RULES.MARKETS) if (typeof re === "function" ? re(t) : re.test(t)) return { lvl, tag };
    return x.cat === "FED" ? { lvl: 2, tag: "ФРС" } : { lvl: 1, tag: "" };
  };
  const IMPB = ["", "■□□", "■■□", "■■■"];

  QT.news = [];
  const alerted = new Set(); let lastNewsAlert = 0, newsPrimed = false;
  QT.loadNews = async () => {
    const all = (await Promise.allSettled(FEEDS.map(async ([src, url, cat]) => parseFeed(src, await QT.get(url, 110000), cat))))
      .flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    const seen = new Set();
    QT.news = all.filter((x) => x.t <= Date.now() + 600e3 && !seen.has(x.title) && seen.add(x.title)).sort((a, b) => b.t - a.t)
      .map((x) => ({ ...x, ...QT.newsImpact(x) }));
    const fresh = QT.news.filter((x) => x.lvl === 3 && x.cat !== "CRYPTO" && Date.now() - x.t < 20 * 60e3 && !alerted.has(x.title));
    fresh.forEach((x) => alerted.add(x.title));
    if (fresh.length && newsPrimed && Date.now() - lastNewsAlert > 10 * 60e3) { lastNewsAlert = Date.now(); QT.notify(`■■■ ${fresh[0].tag}: ${fresh[0].title}`); }
    newsPrimed = true;
    QT.emit("news", QT.news);
    return QT.news;
  };
  const KEYS = {
    BTC: /bitcoin|\bbtc\b/i, ETH: /ether(eum)?\b|\beth\b/i, SOL: /solana|\bsol\b/i, XRP: /\bxrp\b|ripple/i,
    FED: /\bfed\b|fomc|powell|federal reserve|rate (cut|hike)/i, SEC: /\bsec\b|securities and exchange/i,
    ETF: /\betf/i, MACRO: /inflation|cpi|jobs|payroll|gdp|tariff|treasur|yield|recession/i,
  };
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? m + "m" : m < 1440 ? Math.floor(m / 60) + "h" : Math.floor(m / 1440) + "d"; };

  QT.fn.NEWS = {
    name: "News", desc: "Headlines: markets (CNBC, MarketWatch, Yahoo Finance, Nasdaq, Investing.com), Federal Reserve, crypto (CoinDesk, The Block, Cointelegraph, Decrypt). NEWS MARKETS · CRYPTO · FED, or a word: NVDA, CPI, FOMC… Click opens the article", sym: false,
    mount(ctx) {
      const CATS = ["MARKETS", "CRYPTO", "FED"], LV = { ALL: 0, LOW: 1, MED: 2, HIGH: 3 };
      const cats = ctx.args.filter((w) => CATS.includes(w)), words = ctx.args.filter((w) => !CATS.includes(w) && !(w in LV));
      const minLvl = LV[ctx.args.find((w) => w in LV)] ?? 1;      // noise hidden unless NEWS ALL
      const match = (x) => (x.lvl ?? 1) >= minLvl && (!cats.length || cats.includes(x.cat)) && (!words.length || words.every((w) => {
        if (FEEDS.some(([s]) => s.replace(" ", "") === w)) return x.src.replace(" ", "") === w;
        const re = KEYS[w] || new RegExp("\\b" + w.replace(/[^A-Z0-9]/g, "") + "\\b", "i");
        return re.test(x.title) || re.test(x.desc);
      }));
      if (ctx.args.length) ctx.setTitle("News · " + ctx.args.join(" "));
      const paint = () => {
        const L = QT.news.filter(match).slice(0, 150);
        ctx.el.innerHTML = `<table class="t news"><tbody>` + (L.map((x, i) =>
          `<tr class="${Date.now() - x.t < 3600e3 ? "fresh" : ""} imp${x.lvl}"><td style="width:40px" class="${Date.now() - x.t < 3600e3 ? "hi" : "dim"}">${ago(x.t)}</td>`
          + `<td style="width:34px" class="l impb" title="${["шум", "слабое влияние", "среднее влияние", "сильное влияние"][x.lvl]}">${IMPB[x.lvl] || "·"}</td>`
          + `<td style="width:96px" class="l imptag">${E(x.tag || "")}</td>`
          + `<td class="l" style="white-space:normal"><a data-i="${i}" title="${E(x.src)} · ${E(x.desc)}">${E(x.title)}</a></td></tr>`).join("")
          || `<tr><td class="dim l">${QT.news.length ? "no headlines match" : "loading feeds…"}</td></tr>`) + "</tbody></table>";
        ctx.el.querySelectorAll("a[data-i]").forEach((a) => (a.onclick = () => { const x = L[+a.dataset.i]; if (x && x.link) QT.open(x.link); }));
        const hiN = L.filter((x) => x.lvl === 3 && Date.now() - x.t < 6 * 3600e3).length;
        ctx.setMeta(`${L.length} новостей · ■■■ за 6ч: ${hiN}${minLvl === 1 ? " · шум скрыт" : ""}`);
      };
      paint();
      const off = QT.on("news", paint);
      QT.loadNews().catch(ctx.error);
      ctx.every(120000, () => QT.loadNews().catch(() => {}));
      ctx.every(60000, paint);
      return off;
    },
  };

  // ============================================================ ECO — economic calendar (ForexFactory weekly feed)
  const IMP = { High: "■■■", Medium: "■■□", Low: "■□□", Holiday: "HOL" };
  // ForexFactory's weekly XML: same events as the JSON plus a link to each event's page (times are UTC).
  // The feed is rate-limited (429 after a few hits): keep the last good copy and fall back to it.
  let ecoStale = null;
  const parseEco = (xml) => {
    const doc = new DOMParser().parseFromString(String(xml), "text/xml");
    return [...doc.querySelectorAll("event")].map((ev) => {
      const g = (tag) => ((ev.querySelector(tag) || {}).textContent || "").trim();
      const [mm, dd, yy] = g("date").split("-").map(Number), tm = /^(\d{1,2}):(\d{2})(am|pm)$/i.exec(g("time"));
      let h = 0, mi = 0;
      if (tm) { h = +tm[1] % 12 + (tm[3].toLowerCase() === "pm" ? 12 : 0); mi = +tm[2]; }
      const url = g("url");
      return { title: g("title"), country: g("country"), impact: g("impact"), forecast: g("forecast"), previous: g("previous"),
        url: /^https:\/\/www\.forexfactory\.com\//.test(url) ? url : "", allDay: !tm, date: new Date(Date.UTC(yy, mm - 1, dd, h, mi)).toISOString() };
    }).filter((x) => x.title && isFinite(Date.parse(x.date)));
  };
  const loadEco = async () => {
    let d;
    try {
      d = parseEco(await QT.get("https://nfs.faireconomy.media/ff_calendar_thisweek.xml", 1800e3));
      if (!d.length) throw new Error("calendar feed returned no data");
      QT.save("ecoCache", { t: Date.now(), d }); ecoStale = null;
    } catch (e) {
      const c = QT.load("ecoCache", null);
      if (!c) throw e;
      d = c.d; ecoStale = c.t;
    }
    return d.map((x) => ({ ...x, t: Date.parse(x.date) })).sort((a, b) => a.t - b.t);
  };
  QT.loadEco = loadEco;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const local = (t, o) => new Date(t).toLocaleString("en-GB", { timeZone: tz, ...o });

  QT.fn.ECO = {
    name: "Economic calendar", desc: "This week's macro releases with forecast / previous and countdown. Default: USD + high-impact majors. Args: ALL · HIGH · USD EUR GBP JPY CNY …", sym: false,
    mount(ctx) {
      const a = ctx.args, cur = a.filter((x) => /^[A-Z]{3}$/.test(x) && x !== "ALL");
      const keep = (x) => {
        if (a.includes("HIGH") && x.impact !== "High") return false;
        if (cur.length) return cur.includes(x.country);
        if (a.includes("ALL")) return true;
        return (x.country === "USD" && x.impact !== "Low") || x.impact === "High";
      };
      const paint = (list) => {
        // earlier days drop off; today's finished releases stay (dimmed) for context
        const now = Date.now(), today = local(now, { year: "numeric", month: "2-digit", day: "2-digit" });
        const L = list.filter(keep).filter((x) => x.t >= now || local(x.t, { year: "numeric", month: "2-digit", day: "2-digit" }) === today || a.includes("ALL"));
        const next = L.find((x) => x.t > now && x.impact === "High");
        let h = `<div class="kv">${kvHtml([["NEXT HIGH IMPACT", next ? `${E(next.country)} ${E(next.title)}` : "none this week"], ["IN", next ? F.dur(next.t - now) : "—"], ["TIMES", tz], ...(ecoStale ? [["SOURCE", "cached " + local(ecoStale, { weekday: "short", hour: "2-digit", minute: "2-digit" })]] : [])])}</div>`
          + `<table class="t"><thead><tr><th class="l">TIME</th><th class="l">CUR</th><th class="l">IMPACT</th><th class="l">EVENT</th><th>FORECAST</th><th>PREVIOUS</th><th>IN</th></tr></thead><tbody>`;
        let day = "";
        for (const x of L) {
          const dd = local(x.t, { weekday: "long", day: "2-digit", month: "short" });
          if (dd !== day) { day = dd; h += `<tr><td colspan="7" class="sec">${dd.toUpperCase()}</td></tr>`; }
          const past = x.t < now, hi = x.impact === "High";
          h += `<tr class="${past ? "dim" : ""}"><td class="l">${x.allDay ? "весь день" : local(x.t, { hour: "2-digit", minute: "2-digit" })}</td><td class="l ${past ? "" : "hi"} b">${E(x.country)}</td>`
            + `<td class="l ${hi && !past ? "hi" : ""}">${IMP[x.impact] || E(x.impact)}</td><td class="l ${hi && !past ? "hi" : ""}" style="white-space:normal">${x.url ? `<a class="ecol" data-u="${E(x.url)}" title="Открыть событие на Forex Factory: описание, история, фактическое значение после выхода">${E(x.title)}</a>` : E(x.title)}</td>`
            + `<td>${E(x.forecast) || "—"}</td><td>${E(x.previous) || "—"}</td><td>${past ? "done" : F.dur(x.t - now)}</td></tr>`;
        }
        ctx.el.innerHTML = h + (L.length ? "" : `<tr><td colspan="7" class="dim l">no events for this filter</td></tr>`) + "</tbody></table>"
          + `<div class="note">Календарь Forex Factory. Клик по событию — его страница на Forex Factory (описание, история, фактическое значение после выхода). За 10 минут до важных релизов США приходит уведомление, пока терминал открыт.</div>`;
        ctx.setMeta(next ? `next: ${E(next.country)} ${E(next.title).slice(0, 28)} in ${F.dur(next.t - now)}` : `${L.length} events`);
        ctx.el.querySelectorAll("a.ecol").forEach((el) => (el.onclick = () => QT.open(el.dataset.u)));
      };
      let list = [];
      const load = async () => { try { list = await loadEco(); paint(list); } catch (e) { ctx.error(e); } };
      load();
      ctx.every(1800e3, load);
      ctx.every(30000, () => list.length && paint(list));
    },
  };

  // background: warn 10 minutes before high-impact USD releases
  const warned = new Set(QT.load("ecoWarned", []));
  const ecoWatch = async () => {
    try {
      const now = Date.now();
      for (const x of await loadEco()) {
        const key = x.date + x.title;
        if (x.country === "USD" && x.impact === "High" && x.t - now > 0 && x.t - now <= 10 * 60e3 && !warned.has(key)) {
          warned.add(key); QT.save("ecoWarned", [...warned].slice(-200));
          QT.notify(`USD ${x.title} in ${Math.round((x.t - now) / 60000)} min · forecast ${x.forecast || "—"} · previous ${x.previous || "—"}`);
        }
      }
    } catch {}
  };
  setInterval(ecoWatch, 60000); setTimeout(ecoWatch, 8000);
})();
