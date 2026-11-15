# Meridian Terminal

A four-panel market terminal in the browser, built from scratch with no dependencies
and no build step. It runs on **real market data** from Yahoo Finance when started with
its local server, and falls back to a **built-in simulation** otherwise.

## Install or update (Windows), the quick way

Press **Win + R**, paste this line, press **Enter**:

```
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/petarsokolov2000-creator/meridian-terminal/main/update.ps1 | iex"
```

It downloads the newest Meridian, installs it (keeping your keys and settings) and puts the
icon on your Desktop. You only need it once: after that Meridian updates itself.

## Install (Windows), from the ZIP

1. Download **[Meridian (ZIP)](https://github.com/petarsokolov2000-creator/meridian-terminal/archive/refs/heads/main.zip)**.
2. Right-click the ZIP → **Extract All…**, open the extracted folder and double-click
   **`Install Meridian.cmd`**. (If Windows says it protected your PC: **More info → Run anyway**.)
3. Open **Meridian** from the new Desktop icon. You can delete the download afterwards.

**Updates are automatic:** each time you open Meridian it checks this repository and, if
there's a newer version, asks whether to install it. Type `UPDATE` in the terminal to see
your version.

## Any ticker

Type any symbol Yahoo Finance knows and press Enter: `PLTR`, `SHOP.TO` (Toronto), `7203.T`
(Tokyo), `VOD.L` (London), `^IXIC`, `BTC-EUR`, `CL=F`… Meridian loads it on the spot and
remembers it. Don't know the symbol? Start typing the company name; the suggestions include
matches from every exchange (marked "add"). `WATCH ADD <symbol>` works for any of them too.

Built in: about 117 stocks, 13 ETFs, 19 indices, 20 FX pairs, 19 commodities, 11 coins and the
US and euro-area yield curves. Charts go back 1 year by default; `2Y`, `5Y` and `MAX` load
longer history when you pick them.

## Company financials (real data)

| Command | What you get | Source |
| --- | --- | --- |
| `AAPL FIN` | Income statement, balance sheet and cash flow, **annual (5 years) or quarterly (8 quarters)**, with margins and change vs the prior period | Yahoo Finance |
| `AAPL EPS` | Reported vs expected EPS (beats/misses), analysts' EPS and revenue estimates for this/next quarter and year | Yahoo Finance |
| `AAPL HOLD` | Insider and institutional ownership, top institutions and funds, recent insider buys and sales (`INSIDER` goes deeper) | Yahoo Finance |
| `AAPL DVD` | Every dividend on record, yearly totals and growth, trailing yield, stock splits | Yahoo Finance |
| `AAPL KEYS` | Valuation multiples, margins and returns, balance-sheet ratios, short interest (`SI` goes deeper), moving averages, dividend data | Yahoo Finance |
| `AAPL FILE` | Official SEC filings (10-K, 10-Q, 8-K, insider Forms 3/4/5, proxies, 13D/G) with links to the documents | SEC EDGAR |

These also work for any ticker you add. SEC filings exist for companies listed in the US.

## Start it (Windows): details

**Install (once):** double-click **`Install Meridian.cmd`**, from wherever you downloaded or
extracted Meridian. It checks for [Node.js](https://nodejs.org) (offering to install it with
winget if missing), copies Meridian to `%LOCALAPPDATA%\Meridian\app`, builds `Meridian.exe`
with the C# compiler that ships with Windows, and adds a **Meridian** icon to your Desktop
and Start menu. Afterwards you can delete the downloaded folder.

**Every day:** double-click the **Meridian** icon. The terminal opens in its own window, with
no console and no browser tabs; closing the window stops it. For your phone, use
**Meridian (phone access)** in the Start menu: it shows (and copies) an address like
`http://192.168.1.20:8173/?key=123456` to open on a phone on the same Wi-Fi. Windows may ask
to let Node.js through the firewall; allow it on private networks.

**Update:** happens when you open Meridian (it asks first). Manually: close Meridian, download
the ZIP again and run its `Install Meridian.cmd`. Either way the program is replaced and your
API keys, settings and cache stay.

**Releasing a new version** (for the maintainer): change the program, bump `VERSION`, push to
`main`. Every installed copy offers the update the next time it opens.

If something goes wrong, `Start Meridian.cmd` (in the installed folder) runs the server in a
visible console; its output is also saved to `.cache\server.log`.

From a terminal: `node serve.mjs` (`--open` opens the browser, `--lan` enables phone access).

The first start each day loads a year of history for ~120 instruments (20–40 s). After
that it's cached in `.cache/` and starts instantly.

## Finnhub (optional, recommended)

A free [Finnhub](https://finnhub.io) key adds **real-time trades** for US stocks and crypto
(prices tick live, and `TAPE` shows actual trades with sizes), **news with summaries**, and an
**earnings calendar with EPS/revenue estimates and actuals** (`EARN`).

Add it once: start Meridian, then type **`FINNHUB yourkey`** in the command line. The server
checks the key with Finnhub and saves it to `.finnhub-key` on this PC (git-ignored, never sent
to the browser or kept in command history). `FINNHUB` shows the status; `FINNHUB OFF` removes
the key. Alternatively set the `FINNHUB_API_KEY` environment variable.

Free-plan limits: 50 streamed symbols at a time (what's on screen goes first), 60 requests a
minute. The economic calendar (`ECO`) is on Finnhub's paid plans; with a free key `ECO` says so.

## FRED (optional, free): official US economic data

A free [FRED](https://fred.stlouisfed.org) key from the St. Louis Fed turns `ECO` into a table of
official releases: US CPI, core CPI and core PCE, euro-area inflation, payrolls, unemployment,
jobless claims, JOLTS openings, GDP, retail sales, industrial production, the Philly Fed
manufacturing index (ISM isn't on FRED), consumer sentiment, housing starts, mortgage rates,
fed funds and weekly crude stocks. Each row
shows the latest reading, the prior one, and the next scheduled release date.

1. Create a free account and request a key at **https://fredaccount.stlouisfed.org/apikeys**
   (the key is 32 lower-case letters and digits).
2. Type **`FRED yourkey`** in the command line. It is checked with FRED and saved to the
   git-ignored `.fred-key` on this PC, like the Finnhub key. `FRED OFF` removes it.

FRED has the actual numbers and release dates but no economists' forecasts, so `ECO` has no
"survey" or "surprise" column. If you have a Finnhub plan with its economic calendar, `ECO`
uses that instead.

## Official rates (no key needed)

- **US Treasury** daily par yield curve: the official 2Y (Yahoo has no intraday 2Y index), and
  the full 1M–30Y curve drawn in `CURVE US`.
- **ECB** euro-area government curves (AAA issuers, and all issuers) in `CURVE` and `GOVT`.
- **Frankfurter** (ECB reference rates): backup for any FX pair Yahoo fails to quote.

These publish once a day after the close, so they don't tick intraday.

## Real data vs. simulation

The top bar shows the source. **YAHOO · 8s** means real quotes, refreshed every 15 seconds;
**FH RT 50** means Finnhub is streaming real-time trades for 50 symbols (hover for details).
**STALE DATA** or **DATA ERROR** means Yahoo stopped answering. **SIMULATED** means the built-in
simulation. Switch with `MODE LIVE` / `MODE SIM`.

What real mode has, and what free data can't provide:

| Real (Yahoo Finance) | Not available free, so handled honestly |
| --- | --- |
| Quotes for ~117 large-cap stocks, 13 ETFs, 19 indices, 20 FX pairs, 19 futures, 11 coins, plus any ticker you type; US and euro-area yield curves | Individual euro countries' curves (the ECB publishes euro-area aggregates); UK/Japan curves |
| Daily history up to the full record (`CHART MAX`), today's 1-minute bars; US economic releases with FRED | Economists' consensus forecasts for releases |
| Headlines with links to the full article | Market depth (`BOOK` shows best bid/ask only) and trade-by-trade prints (`TAPE` shows observed price changes) |
| Option chains with quoted IV (`OPT`), fundamentals (`FIN`), analyst ratings (`ANLY`), business descriptions | |

Yahoo's data can be delayed (often 15 min for some exchanges) and its unofficial API can
change or rate-limit without notice. **Not investment advice.**

For testing without internet: `MERIDIAN_MOCK=1 node serve.mjs` answers with fixtures in
Yahoo's, Finnhub's, the Treasury's, the ECB's and FRED's formats (fake data; mock keys:
Finnhub `mockkey12345`, FRED `abcdefghijklmnopqrstuvwxyz012345`).

## What's in it

- **Live engine** (`src/live.js`, `server/yahoo.mjs`). The server fetches Yahoo Finance
  (cookie + crumb like a browser) and normalizes it; the browser engine exposes it through
  the same interface as the simulation, so every function works on both.
- **Simulation engine** (`src/engine.js`). One seed per calendar date generates 145
  instruments: 75 equities, 10 indices, 12 FX pairs, 12 commodities, 6 crypto and
  6 government curves × 5 tenors. It also generates a year of daily history, overnight
  news and gaps, and a full 390-minute session with intraday news and economic releases.
  Returns come from a factor model (global risk, region, sector, USD, commodity groups,
  crypto, rate level/slope), so assets move together the way real markets do. Indices are
  cap-weighted from their constituents, so the heat map and the index always agree. Live
  ticks follow a Brownian bridge, so they land exactly on each precomputed minute bar.
- **Shell** (`src/app.js`). A command line with autocomplete, four panels with link
  groups, per-panel back history, ticker tape, session clock, toasts and a story reader.
  Panel layout, watchlist, portfolio and alerts persist in `localStorage`.
- **Charts** (`src/chart.js`). Canvas candles, OHLC bars, lines and areas with SMA, EMA,
  Bollinger, RSI, MACD, VWAP and volume. Includes crosshair, wheel zoom, drag pan,
  comparison mode, and an XY plot for curves and scatters.

## Functions

| Area | Codes |
| --- | --- |
| Markets | `OVER` `WATCH` `INDX` `CMDY` `CRYP` `BREADTH` |
| Equity | `MOVE` `HEAT` `SCRN` `DESC` `CHART` `INTRA` `HIST` `PEERS` `FIN` `EPS` `HOLD` `INSIDER` `SI` `DVD` `KEYS` `ANLY` `REV` `CRED` `COMPARE` `BQL` |
| Rates & FX | `FX` `CURVE` `GOVT` |
| Calendars | `ECO` `EARN` `HOURS` |
| News | `NEWS` `CN` `FILE` |
| Analytics | `OPT` `OVME` `BETA` `VOLA` `CORR` `SCAT` `DCF` `BT` |
| Trading | `PORT` `MARS` `ALRT` `BOOK` `TAPE` |
| System | `HELP` |

New in this release, in plain words:

- `BREADTH [US|EU|ASIA|ALL]`: new 52-week highs and lows, how many stocks sit above their 20/50/200-day average, advancers
  against decliners, by sector, and a chart of the share above the 50-day average over time. All-time records need the full
  price history, which isn't loaded for every stock (`<ticker> CHART MAX`).
- `OVME`: value an option or a whole strategy (long call/put, covered call, collar, bull/bear spread, straddle, strangle, iron
  condor, or your own legs): Greeks, profit/loss chart, break-evens, a model chance of profit. Black-Scholes with one
  volatility per strategy, so type real quotes into the Price boxes for a realistic picture.
- `MARS`: risk of your `PORT` book: long/short/gross/net and beta-adjusted exposure, 1-day Value-at-Risk (historical), risk by
  position, stress tests, long book against short book. `PORT` can now sell short (stocks and ETFs; `SELL` more than you hold,
  `BUY` covers; all shorts together can't exceed the net value).
- `BQL`: your own screens as formulas: `BQL ALL: px, ret6m / vol AS ratio WHERE pe < 20 SORT ratio DESC TOP 15`.
- `REV`: analyst EPS estimates now against 7/30/60/90 days ago, who raised or cut, price targets, latest rating changes;
  `REV WATCH` or `REV PORT` ranks your whole list by how estimates are moving.
- `INSIDER`: insider trades of one stock (`AAPL INSIDER`): only real open-market buys and sells count (awards, option
  exercises, tax withholding and gifts are hidden unless you tick the box). Totals for 30/90/180 days, a 12-month chart, a
  one-word signal (cluster buying = 3+ different insiders within 30 days, executive buying, net buying, mixed, selling only)
  and what each purchase is worth now. Trades under $10,000 are shown but not counted. Selling is never marked as a warning:
  insiders sell for many reasons, they buy for one. `INSIDER WATCH`, `INSIDER PORT` or `INSIDER MARKET` ranks a whole list.
  Limits: Yahoo lists at most the latest 120 filings and does not mark pre-planned (10b5-1) sales.
- `SI`: short interest of one stock (`TSLA SI`): shares sold short, percent of the float, days to cover, change against the
  report a month earlier, a squeeze check (15%+ of the float and 4+ days to cover) and a history that builds up on your
  device. If you hold the stock short in `PORT`, it says so. `SI WATCH`, `SI PORT` or `SI MARKET` ranks a list.
  Limits: the exchanges publish short interest twice a month, so the numbers are 1-3 weeks old; borrow cost is paid data.
- `CRED`: debt-safety scorecard from the filings (leverage, interest cover, cash flow and cash against debt, liquidity).
  Not a credit rating: agency ratings, bond prices and CDS are paid data.
- **Percent alerts** (`ALRT`): `ALRT AAPL -8% HIGH` (falls 8% from its high; the level follows new highs while Meridian is open),
  `ALRT AAPL +5%` / `-5%` (from the price now), `ALRT AAPL DAY -3%` (a one-day move; `DAY 3%` = either way), or the form on
  the ALRT screen. Price-level and "from now" alerts are also watched by the phone app while it is closed; one-day moves are
  only checked while Meridian is open.
- `NOTE` / `NOTES`: your own note per security (long, short or watching; why; entry, target, stop; a dated journal) with your
  profit/loss from your side of the trade, a button that sets price alerts for target and stop, a note line in `DES`, a Note
  column in `WATCH`, and `NOTES` for all of them with a backup box. Typed: `AAPL NOTE LONG target 280 stop 210 why`.
  Notes stay on the device; the PC and phone don't share them.
- `SUPP` now also draws the indirect chain on the map (suppliers of suppliers, customers of customers: `SUPP TSM 3`, or the 1/2/3 tiers buttons; the map stops where no links are on file) and
  lets you add your own links (`SUPP ADD <supplier> <customer> <what>`), saved on your device and marked "yours".
  The built-in list is a hand-checked snapshot of notable relationships, not a data feed with hundreds of links per company.

Commands: `UPDATE` (version / update check), `AAPL`, `AAPL CHART 1Y RSI MACD`, `CHART AAPL VS MSFT`, `SCRN pe<20 yld>2 sort=-chg`,
`BUY AAPL 100` (paper trading), `ALRT AAPL > 250`, `MODE LIVE|SIM`, `THEME` (looks: DESK is the default, plus DARK and LIGHT; `THEME DESK|DARK|LIGHT`), `LAYOUT 6|4|2|1|TABS`, `LAYOUT TABS` (one big panel with tabs; phones start this way; `+` or `TAB` opens more tabs, up to 12, which start empty, `×` or `TAB CLOSE` closes one; the four-panel view shows the first four) or `LAYOUT 4` (four panels on one screen; the button at the top switches too), `RESET`.
`SECID you@example.com` sets the contact address the SEC asks every client to send (stays on this PC, goes only to the SEC);
try it if `STATUS` shows the SEC answering HTTP 403. `STATUS` tests every data source right now and shows each real answer, plus your version, API keys and
notifications. `COMPARE AAPL MSFT GOOGL` puts two to five companies side by side (valuation, growth, margins,
returns, debt, and an intrinsic value). Real company stocks also show an **intrinsic value** per share:
in `WATCH` (columns Intrinsic and Safety), at the top of `DES`, and in `COMPARE`. It is the base case of the `DCF` screen
(if you changed the assumptions there, yours are used); banks and insurers get the Graham number instead, because a
DCF doesn't apply to them. It is an estimate from stated assumptions, not a fact. The main news lists and pop-ups no
longer fill up with crypto stories: those are under `NEWS` → Crypto. A price alert that is reached also shows a system notification: on the PC while the Meridian
window is open, in the Android app also while it is closed (checked about every 15 minutes).
Keys: `/` jumps to the command line, `Ctrl+1–9` focuses a panel (or opens that tab), `Tab` completes,
`Alt+←` goes back.

## Simulation clock

In `MODE SIM`, during real US market hours the session tracks New York time (`LIVE`);
outside them it replays the day from 10:45 (`REPLAY`) at 5× speed (`SPEED 1–60`).
