// Annual fundamentals and valuation history, for VAL and DCF (and later QUAL/CAP).
//
// Source, in order:
//   1. SEC EDGAR XBRL (companyconcept API): every figure a US filer reported in its 10-Ks, 10+
//      years back. For each fiscal year the most recently filed value wins (so restated and
//      split-adjusted comparatives replace the originals).
//   2. Yahoo Finance annual statements (~4-5 years) for companies that don't file XBRL 10-Ks
//      with the SEC (most foreign companies).
// Nothing is estimated: a figure the company didn't report is null, and every derived figure
// records the formula used. Banks and insurers (SEC industry codes 6000-6499) get bank metrics.

import { pool } from './yahoo.mjs';

const DAY = 86400e3;

// [field, kind, unit, tags in priority order (a company may switch tags over the years)]
const TAGS = [
  ['revenue', 'd', 'USD', ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'RevenuesNetOfInterestExpense', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueGoodsNet']],
  ['opIncome', 'd', 'USD', ['OperatingIncomeLoss']],
  ['pretax', 'd', 'USD', ['IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments']],
  ['interest', 'd', 'USD', ['InterestExpense', 'InterestExpenseNonoperating', 'InterestExpenseDebt']],
  ['tax', 'd', 'USD', ['IncomeTaxExpenseBenefit'], 'full'],
  ['netIncome', 'd', 'USD', ['NetIncomeLoss', 'ProfitLoss']],
  ['da', 'd', 'USD', ['DepreciationDepletionAndAmortization', 'DepreciationAmortizationAndAccretionNet', 'DepreciationAndAmortization', 'Depreciation']],
  ['ocf', 'd', 'USD', ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations']],
  ['capex', 'd', 'USD', ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets']],
  ['sbc', 'd', 'USD', ['ShareBasedCompensation', 'AllocatedShareBasedCompensationExpense'], 'full'],
  ['buybacks', 'd', 'USD', ['PaymentsForRepurchaseOfCommonStock'], 'full'],
  ['dividendsPaid', 'd', 'USD', ['PaymentsOfDividendsCommonStock', 'PaymentsOfDividends'], 'full'],
  ['epsDil', 'd', 'USD/shares', ['EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted']],
  ['dps', 'd', 'USD/shares', ['CommonStockDividendsPerShareDeclared', 'CommonStockDividendsPerShareCashPaid']],
  ['sharesDil', 'd', 'shares', ['WeightedAverageNumberOfDilutedSharesOutstanding', 'WeightedAverageNumberOfShareOutstandingBasicAndDiluted']],
  ['sharesOut', 'i', 'shares', ['CommonStockSharesOutstanding']],
  ['cash', 'i', 'USD', ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents', 'Cash']],
  ['stInvest', 'i', 'USD', ['MarketableSecuritiesCurrent', 'ShortTermInvestments', 'AvailableForSaleSecuritiesDebtSecuritiesCurrent']],
  ['ltdTotal', 'i', 'USD', ['LongTermDebt']],
  ['ltdNoncurrent', 'i', 'USD', ['LongTermDebtNoncurrent']],
  ['ltdCurrent', 'i', 'USD', ['LongTermDebtCurrent']],
  ['shortDebt', 'i', 'USD', ['CommercialPaper', 'ShortTermBorrowings', 'DebtCurrent']],
  ['equity', 'i', 'USD', ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest']],
  ['preferred', 'i', 'USD', ['PreferredStockValue']],
  ['goodwill', 'i', 'USD', ['Goodwill']],
  ['intangibles', 'i', 'USD', ['IntangibleAssetsNetExcludingGoodwill', 'FiniteLivedIntangibleAssetsNet']],
];
const VAL_FIELDS = new Set(TAGS.filter((t) => t[4] !== 'full').map((t) => t[0]));

export const isFinancialSic = (sic) => sic >= 6000 && sic <= 6499;

const median = (xs) => {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

/** Pulls one annual series out of a companyconcept answer: Map fiscal-year-end -> {val, filed, tag}. */
export function annualSeries(json, unit, kind, tag) {
  const out = new Map();
  const rows = json?.units?.[unit];
  if (!rows) return { out, currency: null, unitFound: Object.keys(json?.units || {})[0] || null };
  for (const r of rows) {
    if (!/^10-K/.test(r.form || '') || r.val == null || !r.end) continue;
    if (kind === 'd') {
      if (!r.start) continue;
      const days = (Date.parse(r.end) - Date.parse(r.start)) / DAY;
      if (days < 350 || days > 380) continue; // a full fiscal year, not a quarter
    }
    const prev = out.get(r.end);
    if (!prev || r.filed > prev.filed) out.set(r.end, { val: r.val, filed: r.filed, tag });
  }
  return { out, currency: unit === 'USD' ? 'USD' : null };
}

export function createFundamentals({ sec, yahoo, kvStore = null, log = () => {} }) {
  const cache = new Map();
  const cached = (key, ttl, fn) => {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.p;
    const p = fn().catch((err) => {
      cache.delete(key);
      throw err;
    });
    cache.set(key, { at: Date.now(), p });
    return p;
  };

  // ---- SEC: one company's annual figures ------------------------------------------------------
  async function fromSec(cik, fields, latestOnly = false) {
    const want = TAGS.filter((t) => fields.has(t[0]));
    const series = {};
    let foreignUnit = null;
    // one request per tag; a field stops at the first tag that has annual data
    await pool(want, 4, async ([field, kind, unit, tags]) => {
      const merged = new Map();
      for (const tag of tags) {
        const j = await sec.concept(cik, tag);
        if (!j) continue;
        const { out, unitFound } = annualSeries(j, unit, kind, tag);
        if (!out.size && unitFound && unit === 'USD' && unitFound !== 'USD') foreignUnit ||= unitFound;
        // fill only the years a higher-priority tag didn't cover
        for (const [end, v] of out) if (!merged.has(end)) merged.set(end, v);
        if (merged.size >= 10) break;
        // peers only need the latest year: stop at the first tag that has it
        if (latestOnly && [...merged.keys()].some((e) => Date.now() - Date.parse(e) < 550 * DAY)) break;
      }
      series[field] = merged;
    });
    // fiscal years = the year ends of the main duration series
    const ends = new Set();
    for (const f of ['revenue', 'netIncome', 'ocf']) for (const e of series[f]?.keys() || []) ends.add(e);
    // a 52/53-week year can end a few days apart from the balance-sheet date: match within a week
    const near = (m, end) => {
      if (!m) return null;
      if (m.has(end)) return m.get(end);
      for (const [e, v] of m) if (Math.abs(Date.parse(e) - Date.parse(end)) < 8 * DAY) return v;
      return null;
    };
    const years = [...ends].sort().map((end) => {
      const y = { end, fy: Number(end.slice(0, 4)), sources: {} }; // named after the year it ends in, as companies do
      for (const f of Object.keys(series)) {
        const v = near(series[f], end);
        y[f] = v ? v.val : null;
        if (v) y.sources[f] = { tag: v.tag, filed: v.filed };
      }
      return y;
    });
    return { years, foreignUnit };
  }

  // ---- Yahoo fallback ------------------------------------------------------------------------
  async function fromYahoo(symbol) {
    const st = await yahoo.statements(symbol, 'annual');
    const R = st.rows;
    const g = (k, p) => (R[k] && R[k][p] != null ? R[k][p] : null);
    const years = st.periods.map((p) => {
      const capex = g('CapitalExpenditure', p);
      return {
        end: p, fy: Number(p.slice(0, 4)), sources: {},
        revenue: g('TotalRevenue', p), opIncome: g('OperatingIncome', p), pretax: g('PretaxIncome', p), interest: g('InterestExpense', p), tax: g('TaxProvision', p),
        netIncome: g('NetIncome', p), da: g('DepreciationAndAmortization', p), ocf: g('OperatingCashFlow', p), capex: capex == null ? null : Math.abs(capex),
        sbc: g('StockBasedCompensation', p), buybacks: g('RepurchaseOfCapitalStock', p) == null ? null : Math.abs(g('RepurchaseOfCapitalStock', p)),
        dividendsPaid: g('CashDividendsPaid', p) == null ? null : Math.abs(g('CashDividendsPaid', p)),
        epsDil: g('DilutedEPS', p), dps: null, sharesDil: g('DilutedAverageShares', p), sharesOut: g('OrdinarySharesNumber', p),
        cash: g('CashAndCashEquivalents', p), stInvest: null, debtYahoo: g('TotalDebt', p), equity: g('StockholdersEquity', p), preferred: null, goodwill: null, intangibles: null,
        ebitdaYahoo: g('EBITDA', p),
      };
    });
    return { years, currency: st.currency };
  }

  // ---- derived figures, each with its formula -------------------------------------------------
  function derive(y) {
    const f = {};
    // debt
    if (y.debtYahoo != null) {
      y.debt = y.debtYahoo;
      f.debt = 'Total debt (Yahoo)';
    } else {
      const lt = y.ltdTotal ?? (y.ltdNoncurrent != null ? y.ltdNoncurrent + (y.ltdCurrent ?? 0) : null);
      y.debt = lt == null && y.shortDebt == null ? null : (lt ?? 0) + (y.shortDebt ?? 0);
      f.debt = y.ltdTotal != null ? 'Long-term debt (incl. current part) + short-term borrowings / commercial paper' : 'Long-term debt + current part of long-term debt + short-term borrowings / commercial paper';
    }
    y.cashAll = y.cash == null ? null : y.cash + (y.stInvest ?? 0);
    f.cashAll = 'Cash & equivalents + short-term investments';
    y.netDebt = y.debt == null || y.cashAll == null ? null : y.debt - y.cashAll;
    f.netDebt = 'Debt − cash & short-term investments';
    // EBIT / EBITDA
    if (y.opIncome != null) {
      y.ebit = y.opIncome;
      f.ebit = 'Operating income';
    } else if (y.pretax != null && y.interest != null) {
      y.ebit = y.pretax + y.interest;
      f.ebit = 'Pre-tax income + interest expense (no operating income reported)';
    } else y.ebit = null;
    if (y.ebit != null && y.da != null) {
      y.ebitda = y.ebit + y.da;
      f.ebitda = `EBIT (${f.ebit.toLowerCase()}) + depreciation & amortization`;
    } else if (y.ebitdaYahoo != null) {
      y.ebitda = y.ebitdaYahoo;
      f.ebitda = 'EBITDA (Yahoo)';
    } else y.ebitda = null;
    y.fcf = y.ocf == null || y.capex == null ? null : y.ocf - y.capex;
    f.fcf = 'Operating cash flow − capital expenditure';
    y.commonEquity = y.equity == null ? null : y.equity - (y.preferred ?? 0);
    f.commonEquity = "Shareholders' equity − preferred stock";
    y.tangibleEquity = y.commonEquity == null ? null : y.commonEquity - (y.goodwill ?? 0) - (y.intangibles ?? 0);
    f.tangibleEquity = 'Common equity − goodwill − other intangible assets';
    y.formulas = f;
    return y;
  }

  // Shares and per-share figures reported before a later stock split are restated to today's
  // share count: a 4-for-1 split after the value was filed multiplies shares by 4, divides EPS by 4.
  function splitAdjust(y, splits) {
    const filed = (field) => y.sources[field]?.filed || y.end;
    const factorAfter = (date) => splits.filter((s) => s.date * 1000 > Date.parse(date)).reduce((a, s) => a * (s.factor || 1), 1);
    for (const field of ['sharesDil', 'sharesOut']) if (y[field] != null) y[field] *= factorAfter(filed(field));
    for (const field of ['epsDil', 'dps']) if (y[field] != null) y[field] /= factorAfter(filed(field));
  }

  /** Annual fundamentals for one company. set 'val' = what valuation needs; 'full' = everything. */
  function annual(symbol, set = 'full') {
    return cached(`annual:${symbol}:${set}`, 6 * 60 * 60e3, async () => {
      const fields = set === 'full' ? new Set(TAGS.map((t) => t[0])) : VAL_FIELDS;
      let hit = null;
      try {
        hit = await sec.cikOf(symbol);
      } catch (err) {
        log(`SEC lookup failed for ${symbol}: ${err.message}`);
      }
      let years = [];
      let source = null;
      let currency = null;
      let profile = null;
      let note = null;
      if (hit) {
        profile = await sec.profile(hit.cik).catch(() => null);
        const r = await fromSec(hit.cik, fields, set === 'val');
        years = r.years;
        source = 'SEC EDGAR (XBRL, 10-K filings)';
        currency = 'USD';
        if (years.length < 2 && r.foreignUnit) note = `It reports in ${r.foreignUnit}, not US dollars.`;
      }
      if (years.length < 2) {
        // not an SEC 10-K filer (or nothing usable): Yahoo's shorter history
        const y = await fromYahoo(symbol).catch(() => null);
        if (y?.years.length) {
          years = y.years;
          currency = y.currency;
          source = 'Yahoo Finance annual statements (about 4-5 years; this company has no usable SEC 10-K data)';
        }
      }
      if (!years.length) throw Object.assign(new Error(`no annual financial statements found for ${symbol}${note ? ` (${note})` : ''}`), { status: 404 });
      const ev = await yahoo.events(symbol).catch(() => ({ splits: [] }));
      for (const y of years) {
        splitAdjust(y, ev.splits || []);
        derive(y);
      }
      const latestFiled = years.map((y) => Object.values(y.sources).map((s) => s.filed)).flat().sort().pop() || years[years.length - 1].end;
      return {
        symbol, source, currency, profile, years: years.slice(-12), asOf: latestFiled,
        financial: profile?.sic ? isFinancialSic(profile.sic) : null,
        splits: (ev.splits || []).map((s) => ({ date: new Date(s.date * 1000).toISOString().slice(0, 10), ratio: s.ratio })),
      };
    });
  }

  // ---- prices at each fiscal year end ---------------------------------------------------------
  const weekly = (symbol) => cached(`weekly:${symbol}`, 6 * 60 * 60e3, () => yahoo.chart(symbol, 'max', '1wk'));
  function priceOn(bars, date) {
    const t = Date.parse(date) / 1000 + 86400;
    let best = null;
    for (const b of bars) {
      if (b.ts > t) break;
      if (b.c != null) best = b;
    }
    // more than three weeks before the date means there was no trading data yet
    return best && t - best.ts < 21 * 86400 ? best.c : null;
  }

  // The multiples one fiscal year's figures give at a given price.
  function multiples(y, price, financial) {
    const shares = y.sharesOut ?? y.sharesDil;
    const cap = price != null && shares ? price * shares : null;
    const m = { price, marketCap: cap, shares, sharesBasis: y.sharesOut != null ? 'shares outstanding at year end' : 'diluted average shares' };
    m.pe = y.epsDil > 0 && price != null ? price / y.epsDil : null;
    if (financial) {
      m.pb = cap && y.commonEquity > 0 ? cap / y.commonEquity : null;
      m.ptbv = cap && y.tangibleEquity > 0 ? cap / y.tangibleEquity : null;
      m.divYield = y.dps != null && price ? y.dps / price : null;
      m.evEbitda = m.ps = m.pfcf = m.fcfYield = null;
    } else {
      m.ev = cap != null && y.netDebt != null ? cap + y.netDebt : null;
      m.evEbitda = m.ev != null && y.ebitda > 0 ? m.ev / y.ebitda : null;
      m.ps = cap && y.revenue > 0 ? cap / y.revenue : null;
      m.pfcf = cap && y.fcf > 0 ? cap / y.fcf : null;
      m.fcfYield = cap && y.fcf != null ? y.fcf / cap : null;
      m.pb = cap && y.commonEquity > 0 ? cap / y.commonEquity : null;
    }
    return m;
  }

  const KEYS = { normal: ['pe', 'evEbitda', 'ps', 'pfcf', 'fcfYield'], financial: ['pe', 'pb', 'ptbv', 'divYield'] };

  /** Valuation now (today's price, latest fiscal year) vs the company's own 5y/10y history. */
  function valuation(symbol) {
    return cached(`val:${symbol}`, 60 * 60e3, async () => {
      const a = await annual(symbol, 'full');
      const w = await weekly(symbol);
      const priceCcy = w.meta?.currency || null;
      const ccyOk = !a.currency || !priceCcy || a.currency === priceCcy;
      const financial = a.financial ?? false;
      const keys = financial ? KEYS.financial : KEYS.normal;
      const hist = a.years.map((y) => ({ fy: y.fy, end: y.end, ...(ccyOk ? multiples(y, priceOn(w.bars, y.end), financial) : { price: priceOn(w.bars, y.end) }) }));
      const latest = a.years[a.years.length - 1];
      const now = w.meta?.price ?? w.bars[w.bars.length - 1]?.c ?? null;
      const current = ccyOk ? multiples(latest, now, financial) : { price: now };
      const stats = {};
      for (const k of keys) {
        const vals = (n) => hist.slice(-n).map((h) => h[k]);
        const s = (n) => {
          const v = vals(n);
          const ok = v.filter((x) => Number.isFinite(x));
          // n/a when fewer years than the window: no padding with estimates
          return a.years.length < n ? { n: ok.length, short: true } : { n: ok.length, median: median(ok), min: ok.length ? Math.min(...ok) : null, max: ok.length ? Math.max(...ok) : null };
        };
        stats[k] = { y5: s(5), y10: s(10) };
      }
      return {
        symbol, source: a.source, asOf: a.asOf, priceSource: 'Yahoo Finance (weekly closes, split-adjusted)', currency: a.currency, priceCurrency: priceCcy,
        currencyMismatch: ccyOk ? null : `The financial statements are in ${a.currency} but the share price is in ${priceCcy}; Meridian doesn't convert currencies, so the multiples show n/a.`,
        financial, keys, profile: a.profile, current, latestFy: latest.fy, latestEnd: latest.end, history: hist, stats, splits: a.splits, years: a.years,
      };
    });
  }

  // ---- peers by SEC industry code --------------------------------------------------------------
  // SIC codes are looked up from EDGAR once and kept (they rarely change).
  let sicMap = null;
  async function sicOf(sym) {
    sicMap ||= (await Promise.resolve(kvStore?.get('sic-map')).catch(() => null)) || {};
    if (sym in sicMap) return sicMap[sym];
    const hit = await sec.cikOf(sym).catch(() => null);
    const p = hit ? await sec.profile(hit.cik).catch(() => null) : null;
    sicMap[sym] = p?.sic ?? null;
    return sicMap[sym];
  }
  const saveSic = () => Promise.resolve(kvStore?.set('sic-map', sicMap)).catch(() => {});

  /** Up to `limit` peers: same 4-digit SIC, else 3-digit, else 2-digit, among `candidates`. */
  function peers(symbol, candidates, limit = 8) {
    return cached(`peers:${symbol}`, 6 * 60 * 60e3, async () => {
      const own = await sicOf(symbol);
      if (!own) throw Object.assign(new Error(`${symbol} has no SEC industry code (it doesn't file with the SEC), so peers can't be matched`), { status: 404 });
      const cands = candidates.filter((c) => c !== symbol).slice(0, 80);
      const sics = {};
      await pool(cands, 4, async (c) => {
        sics[c] = await sicOf(c);
      });
      await saveSic();
      let rule = null;
      let chosen = [];
      for (const [digits, label] of [[4, 'same 4-digit SEC industry code'], [3, 'same 3-digit SEC industry group'], [2, 'same 2-digit SEC major group']]) {
        const div = 10 ** (4 - digits);
        chosen = cands.filter((c) => sics[c] && Math.floor(sics[c] / div) === Math.floor(own / div));
        if (chosen.length >= 3) {
          rule = `${label} (${Math.floor(own / div)}${'x'.repeat(4 - digits)})`;
          break;
        }
      }
      if (chosen.length < 3) throw Object.assign(new Error(`fewer than 3 companies in Meridian's list share ${symbol}'s SEC industry code (${own})`), { status: 404 });
      const rows = [];
      await pool(chosen.slice(0, limit), 2, async (c) => rows.push({ ...(await peerRow(c)), sic: sics[c] }));
      const ok = rows.filter((r) => !r.error && !r.currencyMismatch);
      const med = {};
      for (const k of [...KEYS.normal, 'pb', 'ptbv', 'divYield']) med[k] = median(ok.map((r) => r[k]));
      return { symbol, sic: own, rule, peers: rows.sort((x, y) => (y.marketCap || 0) - (x.marketCap || 0)), median: med, source: 'SEC EDGAR (industry codes, 10-K figures) and Yahoo Finance (prices)' };
    });
  }

  /** One company's current multiples (latest fiscal year, today's price), for a peer table. */
  async function peerRow(c) {
    try {
      const a = await annual(c, 'val');
      const w = await weekly(c);
      const y = a.years[a.years.length - 1];
      const now = w.meta?.price ?? w.bars[w.bars.length - 1]?.c ?? null;
      const ccyOk = !a.currency || !w.meta?.currency || a.currency === w.meta.currency;
      return { symbol: c, fy: y.fy, financial: a.financial ?? false, source: a.source, ...(ccyOk ? multiples(y, now, a.financial ?? false) : { price: now, currencyMismatch: true }) };
    } catch (err) {
      return { symbol: c, error: err.message };
    }
  }

  return { annual, valuation, peers, peerRow };
}
