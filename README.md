# graphite-terminal

Graphite — trading terminal for top-down analysis. Monochrome, Bloomberg-style terminal for crypto and US index futures (NQ / ES): market data, derivatives, macro,
news with impact levels, company earnings, a top-down checklist and an ICT toolkit whose rules come from the
author's TradingView indicator (ICT Quantum Probability Suite v21). Everything runs on free, keyless public data.

It ships two ways:

| | Desktop (Electron) | Browser (Node / Docker) |
|---|---|---|
| Run | `npm install` → `npm start` | `docker compose up` → http://localhost:8080 |
| UI | native window, system notifications | same UI in a browser tab |
| Demo-portfolio panels (PORT, SIG, RISK, ORD) | yes, if `../quant-sma-bot` sits next to it | no (they show a notice) |

## Run

**Docker** (nothing else to install):

```bash
docker compose up --build
# or
docker build -t graphite . && docker run --rm -p 8080:8080 graphite
```

Open http://localhost:8080.

**Node without Docker** (Node 20+): `npm install --omit=dev` then `npm run web`.

**Desktop** (Node 20+): `npm install` then `npm start`.
Screenshot / self-test mode: `npx electron . --shot=out.png --wait=15 --run="WS TRADE"` renders the app headless,
runs commands, saves a PNG plus a `.log` of console errors, and quits.

## Using it

Type anywhere to get the command line. `HELP` lists every function, `? ГАЙД` (top right) is the in-app guide,
the `?` in each panel header explains that panel, `Ctrl+K` opens a searchable function menu.
A full learning guide in Russian is in [`ГАЙД.txt`](ГАЙД.txt).

Workspaces (tabs, `Alt+1…9`): ОБЗОР, ИНДЕКСЫ, ТРЕЙДИНГ (top-down for NQ), ДЕРИВАТИВЫ, ИДЕИ, МАКРО, ICT, СЕТАПЫ
(live signals for the two backtested NQ/ES entries + a trade journal, see [`research/`](research/README.md)), ПОРТФЕЛЬ.
Panels can be swapped by dragging their header and resized by dragging the gaps.

A few commands: `NQ GP 5M` · `TOPDOWN ES` · `NQ ICT 15M` · `PLAN NQ` · `NEWS MARKETS HIGH` · `EARN NDX` · `COT ES` · `FR ALL` · `SCR VOL>50M CHG>5`.

## How it's built

- No framework, no bundler: plain scripts on a global `window.QT` namespace, loaded in order by `index.html`.
- `main.js` — Electron main process: window, HTTP for the renderer (Chromium `net.fetch`, so no CORS; Electron's
  bundled Node fetch stalls on FRED), spawns the demo-portfolio server if present.
- `server.js` — the browser version's server: static files + `/api/http` proxy limited to an allow-list of data hosts.
- `src/webapi.js` — in a browser, provides the same `window.api` the Electron preload does.
- `src/core.js` — formatting, cached HTTP, shared WebSockets, alerts, charts, NQ/ES proxy (see below).
- `src/ui.js` — panels, workspaces, command line, palette, drag-to-swap, resizable grid.
- `src/ictengine.js` — the ICT engine (port of the Pine indicator): RB / OB / FVG, liquidity pools, key opens, 20-day
  reaction statistics vs a base rate with 95% intervals, day-plan inputs.
- `src/fn/*.js` — one file per area; each function registers as `QT.fn.CODE = { name, desc, sym, mount(ctx) }`.
- `src/help_ru.js`, `src/fn/guide.js` — Russian explanations and the in-app guide.

### NQ / ES in real time

There is no free real-time CME feed. Binance lists perpetuals on QQQ and SPY that trade 24/7; the terminal rescales
them into NQ / ES points with a ratio calibrated every 15 minutes against Yahoo's (delayed) NQ=F / ES=F on
timestamp-matched 5-minute bars, so the delay cancels out. Typical error is ±2–4 points and is shown in the chart header.
Only the price is used this way: the perps' own flow (funding, OI, tape, book) is a tiny Binance market and is blocked
for NQ / ES. Volume for the ICT filters comes from the real futures (Yahoo, ~10 min delay).

### Data sources (all public, no API keys)

Binance futures & spot (REST + WebSocket), Bybit, OKX, Hyperliquid, Deribit, FRED, US Treasury, Yahoo Finance,
CFTC (COT), Nasdaq.com (earnings), ForexFactory calendar, CoinGecko, DefiLlama, alternative.me, mempool.space,
a public Ethereum RPC, and RSS from CNBC, MarketWatch, Yahoo Finance, Nasdaq, Investing.com, the Federal Reserve,
CoinDesk, The Block, Cointelegraph, Decrypt. Yahoo and ForexFactory rate-limit heavy polling; the app caches and
falls back to the last good copy.

## Notes for review

- Analysis and statistics only — the terminal places no orders. The demo-portfolio panels read a separate local bot
  (`quant-sma-bot`, not in this repo; it holds exchange keys and stays private).
- Probabilities in ICT / PLAN are measured on a rolling 20-day window and judged against a base rate; PLAN's setup
  score is the indicator's weighted formula, not a calibrated probability — the UI says so.
- News impact levels are rule-based keyword scoring, not a model.
