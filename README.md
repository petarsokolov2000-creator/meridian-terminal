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
| `AAPL ALLOC` | Where the company puts its money: pie chart of dividends, buybacks, capex, R&D, acquisitions, debt repaid and what is kept, per fiscal year or summed over 5 years, with share history | SEC EDGAR, Yahoo, Finnhub |
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

## One data source: Yahoo Finance

All prices, company figures (annual and quarterly statements), ratios, valuation (`VAL`, `DCF`), peers, `KEYS`,
`SCRN` and the earnings screens come from **Yahoo Finance only**. Two sources never mix in one number, so two screens
can't show two different values for the same thing. If Yahoo lacks an item the cell says `n/a`; tap it for the reason.

Honest limits of this choice: Yahoo gives about 4-5 years of annual statements (10-year medians in `VAL` are shorter or
`n/a`), and its numbers are not audited the way an SEC filing is. Foreign companies are converted into the price currency
(see `VAL`/`DCF`).

Other sources are used only for things that don't overlap with the numbers above: SEC EDGAR for filing text and links
(`FILE`, `SEG`, `RISK`), FRED for macro series, and Finnhub (optional) for **news with summaries** and the **economic
calendar** (`ECO`, a paid Finnhub plan). Finnhub no longer provides prices, earnings or company figures.

**If Yahoo goes down for a while:** company figures that change slowly (profile, statements, filings, ETF data, events)
are served from the last good copy for up to 7 days. The top bar then says **SAVED FIGURES** and `STATUS` shows
"Saved copies" with how old they are. Prices and option chains are never saved copies, so an old price can't pass as
current. Meridian asks Yahoo again every minute and switches back by itself.

**Your own screens:** in `SCRN`, set filters or a preset, type a name next to **★ Save** and press Enter. Saved screens
appear as buttons (× deletes one); up to 20, kept in this browser or app.

Add a Finnhub key once with **`FINNHUB yourkey`** in the command line. The server checks the key and saves it to
`.finnhub-key` on this PC (git-ignored, never sent to the browser or kept in command history). `FINNHUB` shows the
status; `FINNHUB OFF` removes the key. Alternatively set the `FINNHUB_API_KEY` environment variable.

`SCRN` also lists ~1,150 extra companies. Their **Vol %, Beta and RSI** are worked out on the server from one year of
Yahoo daily closes (volatility = standard deviation of daily log returns x sqrt(252); beta against the S&P 500; Wilder
14-day RSI). The first load takes about a minute and fills in progressively (the line above the table shows the
progress); results are kept for 6 hours.

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

## Ships (SHIPS)

`SHIPS` shows ships from **AIS**, the radio signal ships broadcast so that others can see them. It is public data.

- **Whole world:** get a free key at **https://aisstream.io** (create an account, then an API key) and type
  **`AISKEY yourkey`** in the command line. The server checks it and saves it to the git-ignored `.ais-key` on this PC
  (never sent to the browser or kept in the command history). `AISKEY OFF` removes it; `STATUS` shows whether it is set and works.
  Alternatively set the `AISSTREAM_API_KEY` environment variable.
- **Without a key:** only ships near Finland and the Baltic Sea, from the open Digitraffic service (Fintraffic).
- **What it cannot be.** AIS is picked up by radio stations on land (and a few satellites), so coasts, ports and busy shipping
  lanes are well covered, while the open ocean is mostly empty, and the number shown is "ships heard in the last 2 hours",
  not "ships that exist". No free source shows every ship in the world. Names, types and destinations are typed in by the
  crews and can be wrong or out of date; a ship that switches its transponder off is not shown.
- The ship list builds up while Meridian is running (it is kept in memory only, not saved), so right after the start the map fills over a minute or two.
- On the phone app Meridian's server runs inside the app. AISStream may not accept connections from there; if it does not,
  `SHIPS` falls back to the Baltic feed and says so. Using the phone through the PC (phone access) should work, because the PC runs the server (not tested on a real phone).
- Coastline: Natural Earth (public domain), in the form published by the `world-atlas` package (ISC licence).

## Official rates (no key needed)

- **US Treasury** daily par yield curve: the official 2Y (Yahoo has no intraday 2Y index), and
  the full 1M–30Y curve drawn in `CURVE US`.
- **ECB** euro-area government curves (AAA issuers, and all issuers) in `CURVE` and `GOVT`.
- **Frankfurter** (ECB reference rates): backup for any FX pair Yahoo fails to quote.

These publish once a day after the close, so they don't tick intraday.

## Real data vs. simulation

The top bar shows the source. **YAHOO · 8s** means real quotes, refreshed every 15 seconds;
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
| Markets | `OVER` `WATCH` `INDX` `CMDY` `CRYP` `BREADTH` `SHIPS` `MACRO` |
| Equity | `MOVE` `HEAT` `SCRN` `DESC` `CHART` `INTRA` `HIST` `PEERS` `FIN` `EPS` `HOLD` `INSIDER` `SI` `ALLOC` `PREVIEW` `DVD` `DIVCAL` `KEYS` `ANLY` `REV` `CRED` `COMPARE` `BQL` |
| Rates & FX | `FX` `CURVE` `GOVT` |
| Calendars | `ECO` `EARN` `HOURS` |
| News | `NEWS` `CN` `FILE` |
| Analytics | `OPT` `OVME` `BETA` `VOLA` `CORR` `SCAT` `DCF` `BT` `PRISK` |
| Trading | `PORT` `MARS` `ALRT` `BOOK` `TAPE` |
| System | `HELP` `GAPS` |

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
- `GAPS` (also `NACHECK`, `COVERAGE`): data coverage of one stock (`AAPL GAPS`). Per area (key statistics, analysts and ownership,
  reported figures of the last year, latest 12 months) it shows how many figures exist, which are empty and the reason, and
  how many were filled from a second source. Figures that are often truly absent (dividends, buybacks, forward estimates,
  short interest) are listed but not counted against the score.
- **Fewer n/a**: `KEYS` no longer depends on Yahoo's statistics page alone. What Yahoo leaves out (or all of it, when Yahoo
  answers HTTP 429) is worked out from the price history (52-week range, moving averages, volume, beta), the quote feed and
  the company's reported Yahoo figures: margins, returns, cash, debt, book value, free cash flow and
  the multiples. Such figures carry an `alt` marker (tap it for the source) and a figure that stays empty says why when you
  tap `n/a`. 
- `ALLOC` (also `WHERE`, `USES`, `MONEY`, `PIE`): where the money goes. Base is operating cash flow plus R&D (net income for banks);
  slices are dividends, buybacks, capex, R&D, acquisitions, debt repaid and the rest kept. Uses a source did not report count as 0,
  debt repaid is gross (new borrowing is not netted). Tabs switch the fiscal year, the **12 months** just reported (latest annual report + the quarters since, from Yahoo's trailing figures; a use for which no source has a 12-month figure counts as 0 and is listed) or the 5-year sum.
- `PREVIEW` (also `EARNPREV`, `EPV`, `ERNP`): earnings preview of one stock (`AAPL PREVIEW`): the next report date, expected EPS and revenue, how often it beat in the past, how far the share typically moves over a report (the 2-day move around the report date, measured from the company's SEC 8-K filings against the price history) and a plain-English reading. Limits: Yahoo supplies only about 4 quarters of EPS history, so the beat rate is of those 4; the report time (before open / after close) is unknown, so the move is an approximation; companies outside the SEC show no moves. A history, not a forecast.
- `PRISK` (also `PVAR`, `PRSK`; overlaps with `MARS`, which also measures the `PORT` book and adds stress tests): how risky the portfolio is. Volatility, "a bad day" (the 1-in-20 loss), the average of the worst days, which positions carry the risk (weight vs share of risk), which positions move together, sectors and market beta. It measures the **paper portfolio of `PORT`** (the practice book, not a brokerage account); test any mix with `PRISK AAPL:100 MSFT:50 JPM:-20` (a minus is a short). Based on the last year of daily prices: a calm year hides risk, and a real crash can be worse than any day in the window.
- `DIVCAL` (also `DIVC`, `DIVINC`, `INCOME`): dividend calendar and income of the portfolio. A 12-month grid of the dividends expected (each regular payment of the last 12 months is assumed to come round again, at the latest amount) and the ones received in the last 12 months, income per year, yield and yield on cost, and a warning when a company **cut** its dividend, stopped paying, or one payer supplies half the income. Uses the paper portfolio of `PORT` or a typed basket (`DIVCAL KO:200 JNJ:50`). Months are ex-dividend months (the money arrives a few weeks later); one-off special dividends are left out of the estimate; nothing is a promise.
- `MACRO` (also `ECONOMY`, `MAC`): the US economy on one screen: the yield curve (10-year minus 2-year, minus 3-month; inverted or not) and, with a free FRED key, the official indicators (inflation, jobs, growth, housing, rates), each with one plain sentence on what it usually means for stocks. The sentences are rules of thumb, not forecasts. The date of the next Fed meeting is not shown (FRED does not publish it).
- `WATCH` now also has an **Insiders** column (signal and net dollars bought or sold by the company's own officers in the last 180 days) and a **Short %** column (short interest as a share of the float, with an arrow when it moved by more than 10%). They fill in as each stock's details load, two at a time; funds, indices, bonds and crypto show a dash. Hints for further research, not buy signals (`INSIDER WATCH` and `SI WATCH` rank a list).
- `SHIPS` (also `VESSELS`, `AIS`, `MARITIME`, `SEA`): a world map of ships with each one's position and ID. Click or tap a ship (or a table row) for its card: name, MMSI (the radio ID every ship transmits), IMO (the hull's permanent number), type, speed, course, status, destination and when it was last heard. Search by name, MMSI or IMO; tap a type in the legend to hide it; scroll or pinch to zoom, drag to move. Needs `MODE LIVE`. See "Ships (SHIPS)" below for what it can and cannot show.
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
DCF doesn't apply to them. It is an estimate from stated assumptions, not a fact.
**Foreign companies:** when a company reports in one currency and its share (or ADR) is quoted in another, `VAL`, `DCF`, the
peer table and the intrinsic value convert the reported figures into the price currency (Yahoo's currency charts; the ECB
rate of today if Yahoo has none) and say so on the screen, with the rate and its source. One rate (today's) is used for all
years, so growth and margins are those of the original currency; the history of multiples uses each year-end's rate. Prices
in pence or agorot are shown in pounds or shekels. Two limits: an ADR that stands for several ordinary shares is only
*detected* (price × shares against Yahoo's market value) and flagged, not corrected, and the DCF discount rate still starts
from the US 10-year yield, which fits non-dollar companies less well. The main news lists and pop-ups no
longer fill up with crypto stories: those are under `NEWS` → Crypto. A price alert that is reached also shows a system notification: on the PC while the Meridian
window is open, in the Android app also while it is closed (checked about every 15 minutes).
Keys: `/` jumps to the command line, `Ctrl+1–9` focuses a panel (or opens that tab), `Tab` completes,
`Alt+←` goes back.

## Simulation clock

In `MODE SIM`, during real US market hours the session tracks New York time (`LIVE`);
outside them it replays the day from 10:45 (`REPLAY`) at 5× speed (`SPEED 1–60`).
