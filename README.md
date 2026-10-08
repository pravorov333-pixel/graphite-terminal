# graphite-terminal

Graphite — trading terminal for top-down analysis. Monochrome, Bloomberg-style terminal for crypto and US index futures (NQ / ES): market data, derivatives, macro,
news with impact levels, company earnings, a top-down checklist and an ICT toolkit whose rules come from the
author's TradingView indicator (ICT Quantum Probability Suite v21). Everything runs on free, keyless public data.

It ships three ways:

| | Desktop (Electron) | Browser (Node / Docker) | Phone (Android app) |
|---|---|---|---|
| Run | `npm install` → `npm start` | `docker compose up` → http://localhost:8080 | install `Graphite.apk` from the [`android-latest`](../../releases/tag/android-latest) release |
| UI | native window, system notifications | same UI in a browser tab | phone layout: one panel per screen, Android notifications for alerts |
| Server needed | no | yes (`server.js` proxies the data requests) | no (requests go straight from the phone) |
| Demo-portfolio panels (PORT, SIG, RISK, ORD) | yes, if `../quant-sma-bot` sits next to it | no (they show a notice) | no |

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

**Phone.** The Android app is built by GitHub Actions (`.github/workflows/android.yml`) on every push that touches
the UI and published as the `android-latest` pre-release. Open that page on the phone, download `Graphite.apk`, allow
installs from the browser when Android asks. New builds install over the old one and keep the settings.
On an iPhone (or any phone) the browser version works too: open the server's address and use "Add to Home Screen".
Building the APK yourself (Node 22, JDK 21, Android SDK): `cd mobile && npm install && npm run apk` →
`mobile/android/app/build/outputs/apk/debug/app-debug.apk`.

## Using it

Type anywhere to get the command line. `HELP` lists every function, `? ГАЙД` (top right) is the in-app guide,
the `?` in each panel header explains that panel, `Ctrl+K` opens a searchable function menu.
A full learning guide in Russian is in [`ГАЙД.txt`](ГАЙД.txt).

Workspaces (tabs, `Alt+1…8`): ОБЗОР, ИНДЕКСЫ, ТРЕЙДИНГ (top-down for NQ), ДЕРИВАТИВЫ, ИДЕИ, МАКРО, ICT, ПОРТФЕЛЬ.
Panels can be swapped by dragging their header and resized by dragging the gaps.

A few commands: `NQ GP 5M` · `TOPDOWN ES` · `NQ ICT 15M` · `PLAN NQ` · `NEWS MARKETS HIGH` · `EARN NDX` · `COT ES` · `FR ALL` · `SCR VOL>50M CHG>5`.

## How it's built

- No framework, no bundler: plain scripts on a global `window.QT` namespace, loaded in order by `index.html`.
- `main.js` — Electron main process: window, HTTP for the renderer (Chromium `net.fetch`, so no CORS; Electron's
  bundled Node fetch stalls on FRED), spawns the demo-portfolio server if present.
- `server.js` — the browser version's server: static files + `/api/http` proxy limited to an allow-list of data hosts.
- `src/webapi.js` — in a browser, provides the same `window.api` the Electron preload does; in the Android app it
  routes requests through Capacitor's native HTTP (no CORS, no server) and turns alerts into Android notifications.
- `src/mobile.js` + the `html.mobile` block in `styles.css` — the phone layout: one panel per screen, a strip of the
  workspace's panels, swipe a panel's header to move between them; only the panel on screen runs. On by itself in the
  app and on screens up to 820px wide; `VIEW MOBILE` / `VIEW DESKTOP` / `VIEW AUTO` overrides it.
- `mobile/` — the Capacitor shell. `scripts/build-web.js` copies the root files into `mobile/www` (nothing is forked:
  edit the terminal as usual), `android/` is the native project, `scripts/icons.py` made its icons from `build/icon.png`.
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
