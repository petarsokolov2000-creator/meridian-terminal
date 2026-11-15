// Fills the holes in a stock's key statistics (the KEYS page and everything that reads details.stats).
//
// Yahoo's quoteSummary is the richest source but also the one that gets throttled (HTTP 429) or leaves
// single fields empty. Instead of showing "n/a", the missing figure is worked out from sources that
// answer more reliably:
//   - the price history (52-week range, moving averages, average volume, 52-week change, beta vs S&P 500),
//   - the quote endpoint (market cap, share count, P/E, dividend yield),
//   - the company's reported figures (SEC EDGAR first, then Yahoo statements, then Finnhub; see
//     fundamentals.mjs) for margins, returns, cash, debt, book value, free cash flow and the multiples,
//   - Finnhub's ready-made metrics (free key) for whatever is still empty after that.
// Every filled figure is listed in stats.src (field -> where it came from), and every figure that stays
// empty gets a plain-language reason in stats.why. Nothing is invented: a value is only filled when its
// inputs exist, and Yahoo's own number always wins when it has one.

import { metricStats } from './finnhub-data.mjs';

const fin = (v) => v != null && Number.isFinite(v);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

/** Daily simple returns keyed by date. */
function returns(bars) {
  const out = new Map();
  for (let i = 1; i < bars.length; i++) if (bars[i].t && bars[i - 1].c) out.set(bars[i].t, bars[i].c / bars[i - 1].c - 1);
  return out;
}

/** Beta of a stock against the market from two daily bar lists (dates must line up). */
export function betaOf(stockBars, marketBars) {
  const a = returns(stockBars);
  const b = returns(marketBars);
  const xs = [];
  const ys = [];
  for (const [d, r] of a) if (b.has(d)) { xs.push(b.get(d)); ys.push(r); }
  if (xs.length < 60) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let cov = 0;
  let vx = 0;
  for (let i = 0; i < xs.length; i++) { cov += (xs[i] - mx) * (ys[i] - my); vx += (xs[i] - mx) ** 2; }
  return vx > 0 ? cov / vx : null;
}

/** What a year of daily bars tells about price: range, averages, volume, change. */
export function priceStats(bars) {
  if (!bars || bars.length < 20) return {};
  const last = bars[bars.length - 1];
  const yr = bars.slice(-252);
  const closes = bars.map((b) => b.c);
  const tail = (n) => (closes.length >= n ? mean(closes.slice(-n)) : null);
  const vol = (n) => (bars.length >= n ? mean(bars.slice(-n).map((b) => b.v).filter((v) => v > 0)) : null);
  return {
    price: last.c,
    high52: Math.max(...yr.map((b) => b.h)),
    low52: Math.min(...yr.map((b) => b.l)),
    ma50: tail(50),
    ma200: tail(200),
    avgVolume: vol(63),
    avgVolume10d: vol(10),
    // only when the history really reaches back a year
    change52: yr.length >= 240 ? last.c / yr[0].c - 1 : null,
  };
}

/** Statistics worked out from the company's reported figures (the `now` block of fundamentals.annual). */
export function reportedStats(a, price) {
  const out = {};
  if (!a?.now?.fields) return out;
  const N = a.now.fields;
  const v = (k) => N[k]?.val ?? null;
  const set = (k, val, src) => { if (fin(val)) out[k] = { val, src }; };
  const srcOf = (...ks) => {
    const used = [...new Set(ks.map((k) => N[k]?.src).filter(Boolean))];
    return used.length ? used.join('+') : 'SEC';
  };
  const shares = v('shares');
  const cap = fin(price) && fin(shares) ? price * shares : null;
  const financial = !!a.financial;
  const rev = v('revenue');
  const ni = v('netIncome');
  const eq = v('commonEquity') ?? v('equity');
  // the latest fiscal year, for ratios the trailing block doesn't carry
  const ys = (a.years || []).filter((y) => y && fin(y.revenue));
  const L = ys[ys.length - 1];
  const P = ys[ys.length - 2];

  set('shares', shares, srcOf('shares'));
  set('sharesOut', shares, srcOf('shares'));
  set('marketCap', cap, srcOf('shares'));
  set('trailingEps', v('epsDil'), srcOf('epsDil'));
  if (fin(price) && v('epsDil') > 0) set('trailingPE', price / v('epsDil'), srcOf('epsDil'));
  set('dividendRate', v('dps'), srcOf('dps'));
  if (fin(price) && fin(v('dps'))) set('dividendYield', v('dps') / price, srcOf('dps'));
  if (fin(v('dps')) && v('epsDil') > 0) set('payoutRatio', v('dps') / v('epsDil'), srcOf('dps', 'epsDil'));
  if (fin(eq) && shares > 0) set('bookValue', eq / shares, srcOf('equity', 'shares'));
  if (cap && eq > 0) set('priceToBook', cap / eq, srcOf('equity', 'shares'));
  if (fin(rev) && rev > 0) {
    if (cap) set('priceToSales', cap / rev, srcOf('revenue', 'shares'));
    if (fin(ni)) set('profitMargin', ni / rev, srcOf('netIncome', 'revenue'));
    if (fin(v('opIncome'))) set('operatingMargin', v('opIncome') / rev, srcOf('opIncome', 'revenue'));
  }
  if (!financial) {
    set('totalCash', v('cashAll') ?? v('cash'), srcOf('cash', 'stInvest'));
    set('totalDebt', v('debt'), srcOf('debt'));
    set('ocf', v('ocf'), srcOf('ocf'));
    set('fcf', v('fcf'), srcOf('ocf', 'capex'));
    if (cap && fin(v('netDebt'))) {
      const ev = cap + v('netDebt');
      set('ev', ev, srcOf('shares', 'debt', 'cash'));
      if (rev > 0) set('evRevenue', ev / rev, srcOf('shares', 'debt', 'revenue'));
      if (v('ebitda') > 0) set('evEbitda', ev / v('ebitda'), srcOf('shares', 'debt', 'ebitda'));
    }
    if (fin(v('debt')) && eq > 0) set('debtToEquity', (v('debt') / eq) * 100, srcOf('debt', 'equity'));
  }
  if (L) {
    if (L.grossProfit != null && L.revenue > 0) set('grossMargin', L.grossProfit / L.revenue, 'SEC');
    else if (L.cogs != null && L.revenue > 0) set('grossMargin', (L.revenue - L.cogs) / L.revenue, 'SEC');
    if (L.assets > 0 && fin(ni)) set('roa', ni / L.assets, srcOf('netIncome'));
    if (eq > 0 && fin(ni)) set('roe', ni / eq, srcOf('netIncome', 'equity'));
    if (P && P.revenue > 0) set('revenueGrowth', L.revenue / P.revenue - 1, `FY${L.fy} vs FY${P.fy}`);
    if (P && P.netIncome > 0 && fin(L.netIncome)) set('earningsGrowth', L.netIncome / P.netIncome - 1, `FY${L.fy} vs FY${P.fy}`);
    const q = a.now.balanceEnd || a.now.ttmEnd;
    if (q) set('mostRecentQuarter', Date.parse(q) / 1000, 'SEC');
    if (L.end) set('fiscalYearEnd', Date.parse(L.end) / 1000, 'SEC');
  }
  return out;
}

/** The plain-language reason a field that is still empty has no value. */
export function whyEmpty(field, stats, ctx) {
  const eps = stats.trailingEps;
  const reasons = {
    trailingPE: fin(eps) && eps <= 0 ? 'the company lost money over the last 12 months, so a P/E is not meaningful' : 'earnings per share were not reported',
    forwardPE: 'no analyst earnings estimate is published for this company',
    forwardEps: 'no analyst earnings estimate is published for this company',
    peg: 'needs both a P/E and an analyst growth estimate; one of them is missing',
    dividendRate: 'no dividend per share reported by any source (a company that pays none has none)',
    dividendYield: 'no dividend per share reported by any source (a company that pays none has none)',
    payoutRatio: 'needs a dividend and positive earnings; one of them is missing',
    avgYield5y: 'needs five years of dividends',
    exDividend: 'Yahoo lists no dividend date for this stock',
    lastSplit: 'Yahoo lists no stock split for this stock',
    lastSplitDate: 'Yahoo lists no stock split for this stock',
    sharesShort: ctx.us ? 'no short-interest figure from Yahoo (the exchanges publish it twice a month, and not for every stock)' : 'short interest is only reported for US-listed stocks',
    shortRatio: ctx.us ? 'no short-interest figure from Yahoo (the exchanges publish it twice a month, and not for every stock)' : 'short interest is only reported for US-listed stocks',
    shortFloat: ctx.us ? 'no short-interest figure from Yahoo (the exchanges publish it twice a month, and not for every stock)' : 'short interest is only reported for US-listed stocks',
    sharesShortPrior: 'needs two short-interest reports; only one (or none) exists',
    float: 'the free-float share count is only published by Yahoo and was not available',
    currentRatio: ctx.financial ? 'not used for banks and insurers (no current assets/liabilities)' : 'current assets or liabilities were not reported',
    quickRatio: ctx.financial ? 'not used for banks and insurers (no current assets/liabilities)' : 'current assets or liabilities were not reported',
    grossMargin: ctx.financial ? 'banks and insurers do not report a gross profit' : 'neither gross profit nor cost of revenue was reported',
    ev: ctx.financial ? 'enterprise value is not used for banks and insurers (debt is part of their business)' : 'debt, cash or share count was not reported',
    evEbitda: ctx.financial ? 'not used for banks and insurers' : 'EBITDA was negative or not reported',
    evRevenue: ctx.financial ? 'not used for banks and insurers' : 'revenue, debt or cash was not reported',
    fcf: ctx.financial ? 'not used for banks and insurers' : 'operating cash flow or capital expenditure was not reported',
    earningsGrowth: 'needs two profitable years to compare',
    beta: 'needs a year of daily price history for both the stock and the S&P 500',
  };
  return reasons[field] || 'not reported by any source';
}

export const STAT_FIELDS = [
  'marketCap', 'ev', 'trailingPE', 'forwardPE', 'peg', 'priceToSales', 'priceToBook', 'evRevenue', 'evEbitda',
  'grossMargin', 'operatingMargin', 'profitMargin', 'roe', 'roa', 'revenueGrowth', 'earningsGrowth', 'trailingEps', 'forwardEps',
  'totalCash', 'totalDebt', 'debtToEquity', 'currentRatio', 'quickRatio', 'ocf', 'fcf', 'bookValue',
  'shares', 'float', 'sharesShort', 'shortFloat', 'shortRatio', 'sharesShortPrior', 'avgVolume', 'avgVolume10d',
  'beta', 'change52', 'high52', 'low52', 'ma50', 'ma200',
  'dividendRate', 'dividendYield', 'avgYield5y', 'payoutRatio', 'exDividend', 'lastSplit', 'fiscalYearEnd', 'mostRecentQuarter',
];

/**
 * Fill `stats` (may be null/partial). `sources` are lazy loaders that may each fail:
 *   bars(): daily bars of the stock, mktBars(): daily bars of the S&P 500, quote(): normalized Yahoo quote,
 *   annual(): fundamentals.annual result.
 *   finnhub(): Finnhub's /stock/metric object (optional; only asked when something is still empty).
 * Returns { stats, src, why, notes } where stats has every field present (null if truly unavailable).
 */
export async function fillStats(stats0, symbol, sources) {
  const stats = { ...(stats0 || {}) };
  const src = {};
  const notes = [];
  const settle = async (name, fn) => {
    try {
      return await fn();
    } catch (err) {
      notes.push(`${name}: ${err.message || err}`);
      return null;
    }
  };
  const [barsRes, mktRes, quote] = await Promise.all([
    settle('price history', () => sources.bars()),
    settle('market history', () => sources.mktBars()),
    settle('quote', () => sources.quote()),
  ]);
  const bars = barsRes?.bars || [];
  const take = (k, val, from) => {
    if (!fin(val) && !(typeof val === 'string' && val)) return;
    if (stats[k] != null) return;
    stats[k] = val;
    src[k] = from;
  };

  // 1. price history
  const ps = priceStats(bars);
  const price = quote?.price ?? ps.price ?? barsRes?.meta?.price ?? null;
  for (const k of ['high52', 'low52', 'ma50', 'ma200', 'avgVolume', 'avgVolume10d', 'change52']) take(k, ps[k], 'Yahoo price history');
  if (stats.beta == null && bars.length && mktRes?.bars?.length) take('beta', betaOf(bars, mktRes.bars), 'computed: 1Y daily vs S&P 500');

  // 2. the quote endpoint
  if (quote) {
    take('marketCap', quote.marketCap, 'Yahoo quote');
    take('shares', quote.shares, 'Yahoo quote');
    take('sharesOut', quote.shares, 'Yahoo quote');
    take('trailingPE', quote.pe, 'Yahoo quote');
    take('trailingEps', quote.eps, 'Yahoo quote');
    take('forwardEps', quote.epsForward, 'Yahoo quote');
    if (fin(quote.divYield)) take('dividendYield', quote.divYield / 100, 'Yahoo quote');
    take('high52', quote.hi52, 'Yahoo quote');
    take('low52', quote.lo52, 'Yahoo quote');
    if (fin(quote.chg52)) take('change52', quote.chg52 / 100, 'Yahoo quote');
    take('avgVolume', quote.avgVolume, 'Yahoo quote');
  }

  // 3. the company's reported figures (only looked up when something they can fill is still missing)
  const REPORTED = ['marketCap', 'trailingEps', 'trailingPE', 'bookValue', 'priceToBook', 'priceToSales', 'profitMargin', 'operatingMargin', 'grossMargin', 'roe', 'roa', 'totalCash', 'totalDebt', 'ocf', 'fcf', 'ev', 'evRevenue', 'evEbitda', 'debtToEquity', 'revenueGrowth', 'earningsGrowth', 'dividendRate', 'dividendYield', 'payoutRatio', 'shares'];
  const annual = REPORTED.some((k) => stats[k] == null) ? await settle('reported figures', () => sources.annual()) : null;
  const rs = annual ? reportedStats(annual, price) : {};
  for (const [k, { val, src: s }] of Object.entries(rs)) take(k, val, `reported figures (${s})`);
  if (!fin(stats.forwardPE) && fin(stats.forwardEps) && stats.forwardEps > 0 && fin(price)) take('forwardPE', price / stats.forwardEps, 'computed: price ÷ forward EPS');
  if (!fin(stats.dividendYield) && fin(stats.dividendRate) && fin(price) && price > 0) take('dividendYield', stats.dividendRate / price, 'computed: dividend ÷ price');

  // 4. Finnhub's metrics, only when a key is set and something is still empty
  const ASKABLE = STAT_FIELDS.filter((k) => !['forwardPE', 'forwardEps', 'peg', 'exDividend', 'lastSplit', 'fiscalYearEnd', 'mostRecentQuarter', 'sharesShort', 'shortFloat', 'shortRatio', 'sharesShortPrior', 'float', 'ma50', 'ma200', 'fcf', 'ocf', 'totalCash', 'totalDebt', 'evRevenue', 'evEbitda', 'shares'].includes(k));
  let finnhubUsed = false;
  let finnhubAsked = false;
  if (sources.finnhub && ASKABLE.some((k) => stats[k] == null)) {
    const m = await settle('Finnhub metrics', () => sources.finnhub());
    if (m) {
      finnhubAsked = true;
      const fs = metricStats(m);
      for (const [k, val] of Object.entries(fs)) {
        const before = stats[k];
        take(k, val, 'Finnhub metrics');
        if (before == null && stats[k] === val) finnhubUsed = true;
      }
    }
  }

  // 5. reasons for what is still empty
  const ctx = { financial: !!annual?.financial, us: !/\.[A-Z]{1,3}$/.test(symbol), finnhub: !sources.finnhub ? 'off' : finnhubAsked ? 'asked' : 'failed' };
  const why = {};
  for (const k of STAT_FIELDS) {
    if (stats[k] != null) continue;
    const r = whyEmpty(k, stats, ctx);
    // a free Finnhub key can supply many of these; say so, or say that it was asked and had none
    why[k] = ASKABLE.includes(k) ? `${r}${ctx.finnhub === 'asked' ? ' (Finnhub has no figure for it either)' : ctx.finnhub === 'failed' ? ' (Finnhub could not be asked just now)' : '. A free Finnhub key can fill this: FINNHUB yourkey'}` : r;
  }
  return { stats, src, why, notes, price, finnhubUsed };
}
