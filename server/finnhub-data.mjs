// Turns Finnhub's free-plan answers into the shapes Meridian already uses for Yahoo data, so the same
// screens (KEYS, EPS, ANLY, REV, INSIDER, GAPS) can show them when Yahoo is throttled or has gaps.
//
// Free plan: /stock/metric, /stock/recommendation, /stock/earnings, /stock/insider-transactions, /stock/profile2.
// Not on the free plan (HTTP 403): price targets, analyst estimates, upgrade/downgrade history, institutional
// and fund holders. Those stay empty, with that reason shown.
//
// Everything here is defensive: a missing or oddly typed field just leaves that figure out.

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v) => (fin(v) ? v : null);
const pct = (v) => (fin(v) ? v / 100 : null); // Finnhub gives margins and returns in percent
const mil = (v) => (fin(v) ? v * 1e6 : null); // market cap, EV and volumes are in millions
const FH = 'Finnhub';

/** /stock/metric → key statistics (same field names as details.stats). Only fields that exist are returned. */
export function metricStats(m) {
  if (!m || typeof m !== 'object') return {};
  const first = (...ks) => { for (const k of ks) if (fin(m[k])) return m[k]; return null; };
  const out = {
    marketCap: mil(first('marketCapitalization')),
    ev: mil(first('enterpriseValue')),
    trailingPE: num(first('peTTM', 'peBasicExclExtraTTM', 'peNormalizedAnnual')),
    priceToBook: num(first('pbQuarterly', 'pbAnnual')),
    priceToSales: num(first('psTTM', 'psAnnual')),
    grossMargin: pct(first('grossMarginTTM', 'grossMarginAnnual')),
    operatingMargin: pct(first('operatingMarginTTM', 'operatingMarginAnnual')),
    profitMargin: pct(first('netProfitMarginTTM', 'netProfitMarginAnnual')),
    roe: pct(first('roeTTM', 'roeRfy')),
    roa: pct(first('roaTTM', 'roaRfy')),
    revenueGrowth: pct(first('revenueGrowthTTMYoy', 'revenueGrowthQuarterlyYoy')),
    earningsGrowth: pct(first('epsGrowthTTMYoy', 'epsGrowthQuarterlyYoy')),
    trailingEps: num(first('epsTTM', 'epsBasicExclExtraItemsTTM', 'epsInclExtraItemsTTM')),
    currentRatio: num(first('currentRatioQuarterly', 'currentRatioAnnual')),
    quickRatio: num(first('quickRatioQuarterly', 'quickRatioAnnual')),
    bookValue: num(first('bookValuePerShareQuarterly', 'bookValuePerShareAnnual')),
    // Yahoo shows debt/equity as a percentage (150 = 1.5×); Finnhub gives the plain ratio
    debtToEquity: fin(first('totalDebt/totalEquityQuarterly', 'totalDebt/totalEquityAnnual')) ? first('totalDebt/totalEquityQuarterly', 'totalDebt/totalEquityAnnual') * 100 : null,
    beta: num(first('beta')),
    high52: num(first('52WeekHigh')),
    low52: num(first('52WeekLow')),
    change52: pct(first('52WeekPriceReturnDaily')),
    avgVolume: mil(first('3MonthAverageTradingVolume')),
    avgVolume10d: mil(first('10DayAverageTradingVolume')),
    dividendRate: num(first('dividendPerShareAnnual', 'dividendPerShareTTM')),
    dividendYield: pct(first('dividendYieldIndicatedAnnual', 'currentDividendYieldTTM')),
    payoutRatio: pct(first('payoutRatioTTM', 'payoutRatioAnnual')),
    avgYield5y: pct(first('dividendYield5Y')),
  };
  for (const k of Object.keys(out)) if (out[k] == null) delete out[k];
  return out;
}

/** /stock/recommendation (newest period first) → the same trend counts Yahoo's recommendationTrend has. */
export function trendFrom(list) {
  const r = (Array.isArray(list) ? list : []).filter((x) => x && typeof x === 'object').sort((a, b) => String(b.period).localeCompare(String(a.period)))[0];
  if (!r) return null;
  const c = (v) => (fin(v) && v > 0 ? Math.round(v) : 0);
  const trend = { strongBuy: c(r.strongBuy), buy: c(r.buy), hold: c(r.hold), sell: c(r.sell), strongSell: c(r.strongSell) };
  const n = trend.strongBuy + trend.buy + trend.hold + trend.sell + trend.strongSell;
  if (!n) return null;
  // Yahoo's scale: 1 = strong buy … 5 = strong sell
  const recMean = (trend.strongBuy * 1 + trend.buy * 2 + trend.hold * 3 + trend.sell * 4 + trend.strongSell * 5) / n;
  const recKey = recMean <= 1.5 ? 'strong_buy' : recMean <= 2.5 ? 'buy' : recMean <= 3.5 ? 'hold' : recMean <= 4.5 ? 'underperform' : 'sell';
  return { trend, recMean, recKey, analysts: n, period: r.period || null };
}

/** /stock/earnings (EPS actual vs estimate per quarter) → details.earnings rows (surprise as a fraction). */
export function earningsFrom(list) {
  return (Array.isArray(list) ? list : []).map((e) => {
    const t = Date.parse(`${e?.period}T00:00:00Z`);
    if (!Number.isFinite(t)) return null;
    const actual = num(e.actual);
    const estimate = num(e.estimate);
    let surprise = fin(e.surprisePercent) ? e.surprisePercent / 100 : null;
    if (surprise == null && actual != null && estimate) surprise = (actual - estimate) / Math.abs(estimate);
    return { quarter: Math.floor(t / 1000), period: e.quarter && e.year ? `${e.year} Q${e.quarter}` : String(e.period).slice(0, 10), actual, estimate, surprise };
  }).filter(Boolean).sort((a, b) => a.quarter - b.quarter);
}

// SEC Form 4 transaction codes → the wording INSIDER classifies
const CODES = {
  P: 'Purchase at price', S: 'Sale at price', A: 'Stock Award(Grant) at price', G: 'Gift at price', M: 'Conversion of Exercise of derivative security at price',
  F: 'Payment of exercise price or tax liability by delivering securities at price', X: 'Conversion of Exercise of derivative security at price', C: 'Conversion of derivative security at price',
  D: 'Disposition to the issuer at price', J: 'Other acquisition or disposition at price',
};

/** /stock/insider-transactions → details.insiders rows. `date` in epoch seconds, `value` = shares × price when a price is given. */
export function insidersFrom(resp) {
  const rows = Array.isArray(resp?.data) ? resp.data : Array.isArray(resp) ? resp : [];
  return rows.map((t) => {
    const date = Date.parse(`${String(t?.transactionDate || t?.filingDate || '').slice(0, 10)}T00:00:00Z`);
    if (!Number.isFinite(date)) return null;
    const change = num(t.change);
    const shares = change != null ? Math.abs(change) : null;
    const price = num(t.transactionPrice);
    const code = String(t.transactionCode || '').toUpperCase();
    const label = CODES[code] || (change > 0 ? 'Acquisition' : change < 0 ? 'Disposition' : 'Transaction');
    // an open-market sale/purchase must read as one even when the code is missing
    return {
      name: t.name || null, relation: '', date: Math.floor(date / 1000), shares,
      value: shares != null && price > 0 ? shares * price : null,
      text: `${label}${price > 0 ? ` ${price}` : ''} per share.`,
    };
  }).filter(Boolean).sort((a, b) => b.date - a.date).slice(0, 120);
}

/** /stock/profile2 → the few profile fields Finnhub has (no business summary on the free plan). */
export function profileFrom(p) {
  if (!p || typeof p !== 'object' || !Object.keys(p).length) return {};
  return { sector: null, industry: p.finnhubIndustry || null, country: p.country || null, website: p.weburl || null, name: p.name || null, currency: p.currency || null };
}

export const SOURCE = FH;
