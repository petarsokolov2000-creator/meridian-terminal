// Annual fundamentals, trailing-12-month figures and valuation history, for VAL, DCF, QUAL,
// CAP and CHECK.
//
// Every figure (each line item, each fiscal year) comes from the first source that has it:
//   1. SEC EDGAR XBRL (the companyconcept API: the company's own 10-K/10-Q tags, 10+ years).
//      For each fiscal year the most recently filed value wins, so restated and split-adjusted
//      comparatives replace the originals.
//   2. Yahoo Finance annual statements (about 4-5 years), for an item/year the SEC data lacks.
//   3. Finnhub "financials as reported" (needs the user's free key), only when 1 and 2 are both
//      empty for core figures.
// A fallback number is accepted only after a cross-check: in the overlapping fiscal year nearest
// to the gap, it must be within 2% of the SEC's number for the same item. Further apart, the
// cell says "sources disagree" (both numbers kept) instead of picking one; with no overlapping
// year the number is used and marked "unchecked". Nothing is estimated or interpolated: a figure
// no source reported is null, with the reason ("not reported", the HTTP status of a source that
// failed, "not applicable to banks and insurers"). Every value records its source; derived
// figures record the formula and every source behind them. Banks and insurers (SEC industry
// codes 6000-6499) get no fallback for what feeds free cash flow, EBITDA or enterprise value.
//
// "Now" figures for multiples are the last 12 months (TTM): the latest 10-K year + the 10-Q
// year-to-date − the same period a year earlier, then Yahoo's trailing figures; if neither
// exists, the latest fiscal year, labelled "FY".

import { pool } from './yahoo.mjs';
import { major, lookupFx, scaleYear, scaleNow, shareCheck } from './fx.mjs';

const DAY = 86400e3;

// [field, kind, unit, tags in priority order (a company may switch tags over the years)]
const TAGS = [
  ['revenue', 'd', 'USD', ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'RevenuesNetOfInterestExpense', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueGoodsNet']],
  ['opIncome', 'd', 'USD', ['OperatingIncomeLoss']],
  ['grossProfit', 'd', 'USD', ['GrossProfit'], 'full'],
  ['cogs', 'd', 'USD', ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold'], 'full'],
  ['nonInterestExpense', 'd', 'USD', ['NoninterestExpense'], 'full'],
  ['prefDividends', 'd', 'USD', ['PreferredStockDividendsAndOtherAdjustments', 'DividendsPreferredStock'], 'full'],
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
  // where the cash goes (ALLOC): research, acquisitions, debt repaid
  ['rnd', 'd', 'USD', ['ResearchAndDevelopmentExpense', 'ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost', 'ResearchAndDevelopmentExpenseSoftwareExcludingAcquiredInProcessCost'], 'full'],
  ['acquisitions', 'd', 'USD', ['PaymentsToAcquireBusinessesNetOfCashAcquired', 'PaymentsToAcquireBusinessesGross'], 'full'],
  ['debtRepaid', 'd', 'USD', ['RepaymentsOfDebt', 'RepaymentsOfLongTermDebt', 'RepaymentsOfSeniorDebt', 'RepaymentsOfNotesPayable'], 'full'],
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
  ['assets', 'i', 'USD', ['Assets'], 'full'],
  ['equity', 'i', 'USD', ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest']],
  ['preferred', 'i', 'USD', ['PreferredStockValue']],
  ['goodwill', 'i', 'USD', ['Goodwill']],
  ['intangibles', 'i', 'USD', ['IntangibleAssetsNetExcludingGoodwill', 'FiniteLivedIntangibleAssetsNet']],
];
const VAL_FIELDS = new Set(TAGS.filter((t) => t[4] !== 'full').map((t) => t[0]));
const UNIT_OF = Object.fromEntries(TAGS.map((t) => [t[0], t[2]]));
// every figure that is an amount of money (per-share ones included), the others are counts and dates:
// these are what a currency conversion multiplies
const MONEY = new Set([...TAGS.filter((t) => t[2].startsWith('USD')).map((t) => t[0]), 'debt', 'cashAll', 'netDebt', 'ebit', 'ebitda', 'grossProfit', 'fcf', 'commonEquity', 'tangibleEquity']);

// Plain names, for "n/a" reasons.
export const LABEL = {
  revenue: 'revenue', opIncome: 'operating income', grossProfit: 'gross profit', cogs: 'cost of revenue', nonInterestExpense: 'non-interest expense', prefDividends: 'preferred dividends',
  pretax: 'pre-tax income', interest: 'interest expense', tax: 'income tax', netIncome: 'net income', da: 'depreciation & amortization', ocf: 'operating cash flow', capex: 'capital expenditure',
  sbc: 'stock-based pay', buybacks: 'buybacks', dividendsPaid: 'dividends paid', rnd: 'research & development', acquisitions: 'acquisitions', debtRepaid: 'debt repaid', epsDil: 'diluted EPS', dps: 'dividends per share', sharesDil: 'diluted shares', sharesOut: 'shares outstanding',
  cash: 'cash', stInvest: 'short-term investments', ltdTotal: 'long-term debt', ltdNoncurrent: 'long-term debt', ltdCurrent: 'current long-term debt', shortDebt: 'short-term borrowings',
  assets: 'total assets', equity: "shareholders' equity", preferred: 'preferred stock', goodwill: 'goodwill', intangibles: 'intangible assets', debt: 'debt',
  ebit: 'EBIT', ebitda: 'EBITDA', fcf: 'free cash flow', cashAll: 'cash & short-term investments', netDebt: 'net debt', commonEquity: 'common equity', tangibleEquity: 'tangible common equity', shares: 'share count',
};

// The Yahoo line item for each figure a fallback may fill (Yahoo shows cash outflows as negatives).
const YAHOO = {
  revenue: 'TotalRevenue', cogs: 'CostOfRevenue', grossProfit: 'GrossProfit', opIncome: 'OperatingIncome', pretax: 'PretaxIncome', interest: 'InterestExpense', tax: 'TaxProvision', netIncome: 'NetIncome',
  da: 'DepreciationAndAmortization', ocf: 'OperatingCashFlow', capex: 'CapitalExpenditure', sbc: 'StockBasedCompensation', buybacks: 'RepurchaseOfCapitalStock', dividendsPaid: 'CashDividendsPaid',
  rnd: 'ResearchAndDevelopment', acquisitions: 'PurchaseOfBusiness', debtRepaid: 'RepaymentOfDebt',
  epsDil: 'DilutedEPS', sharesDil: 'DilutedAverageShares', sharesOut: 'OrdinarySharesNumber', cash: 'CashAndCashEquivalents', stInvest: 'OtherShortTermInvestments', assets: 'TotalAssets',
  equity: 'StockholdersEquity', goodwill: 'Goodwill', intangibles: 'OtherIntangibleAssets', preferred: 'PreferredStock', debt: 'TotalDebt',
};
const ABS = new Set(['capex', 'buybacks', 'dividendsPaid', 'acquisitions', 'debtRepaid']);
const FILL = Object.keys(YAHOO);
// Banks and insurers: no fallback for what feeds free cash flow, EBITDA and enterprise value.
const BANK_SKIP = new Set(['ocf', 'capex', 'da', 'debt', 'cash', 'stInvest']);
// Finnhub is asked only when one of these still has a gap after the SEC and Yahoo.
const CORE = ['revenue', 'netIncome', 'opIncome', 'epsDil', 'ocf', 'capex', 'debt', 'cash', 'sharesOut', 'sharesDil', 'equity'];
const TOLERANCE = 0.02;
const PER_SHARE = new Set(['epsDil', 'dps']);
const SHARE_COUNT = new Set(['sharesDil', 'sharesOut', 'deiShares']);
const DEBT_PARTS = ['ltdTotal', 'ltdNoncurrent', 'ltdCurrent', 'shortDebt'];
const ORDER = ['SEC', 'Yahoo', 'Finnhub'];
const DERIVED = new Set(['cashAll', 'netDebt', 'ebit', 'ebitda', 'fcf', 'commonEquity', 'tangibleEquity', 'shares']);

export const isFinancialSic = (sic) => sic >= 6000 && sic <= 6499;

const median = (xs) => {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const near = (a, b, days = 10) => Math.abs(Date.parse(a) - Date.parse(b)) <= days * DAY;
const nearKey = (map, end, days = 10) => {
  if (map.has(end)) return end;
  for (const k of map.keys()) if (near(k, end, days)) return k;
  return null;
};
const plusDays = (date, n) => new Date(Date.parse(date) + n * DAY).toISOString().slice(0, 10);
const dur = (r) => (Date.parse(r.end) - Date.parse(r.start)) / DAY;
const latestFiled = (rows) => rows.reduce((a, r) => (!a || r.filed > a.filed ? r : a), null);
/** 'SEC', 'Yahoo', 'SEC+Yahoo'... from a list of sources, in a fixed order. */
const combine = (list) => ORDER.filter((s) => list.some((x) => String(x || '').split('+').includes(s))).join('+');
const debtOf = (v) => {
  const lt = v.ltdTotal ?? (v.ltdNoncurrent != null ? v.ltdNoncurrent + (v.ltdCurrent ?? 0) : null);
  return lt == null && v.shortDebt == null ? null : (lt ?? 0) + (v.shortDebt ?? 0);
};
/** "HTTP 403", "timeout"... for a failed source. */
export const failText = (err) => (err?.http === 'timeout' ? 'timed out' : err?.http === 'network' ? 'unreachable' : Number.isFinite(err?.http) ? `HTTP ${err.http}` : err?.message || 'failed');
const failed = (err) => ({ state: 'failed', http: err?.http ?? null, message: err?.message || String(err) });

// Shares and per-share figures reported before a later stock split are restated to today's
// share count: a 4-for-1 split after the value was filed multiplies shares by 4, divides EPS by 4.
const factorAfter = (splits, date) => splits.filter((s) => s.date * 1000 > Date.parse(date)).reduce((a, s) => a * (s.factor || 1), 1);
const adjust = (field, val, filed, splits) => (PER_SHARE.has(field) ? val / factorAfter(splits, filed) : SHARE_COUNT.has(field) ? val * factorAfter(splits, filed) : val);

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
    if (!prev || r.filed > prev.filed) out.set(r.end, { val: r.val, filed: r.filed, tag, form: r.form });
  }
  return { out, currency: unit === 'USD' ? 'USD' : null };
}

// ---- the per-source "frames": Map period end -> { field: { val, info } } -------------------------

function secFrame(series, splits) {
  const ends = new Set();
  for (const f of ['revenue', 'netIncome', 'ocf']) for (const e of series[f]?.keys() || []) ends.add(e);
  const frame = new Map();
  for (const end of [...ends].sort()) {
    const row = {};
    for (const [f, m] of Object.entries(series)) {
      const k = nearKey(m, end, 8);
      if (!k) continue;
      const v = m.get(k);
      row[f] = { val: adjust(f, v.val, v.filed, splits), info: { tag: v.tag, filed: v.filed, form: v.form || '10-K' } };
    }
    frame.set(end, row);
  }
  return frame;
}

function yahooFrame(st) {
  const frame = new Map();
  for (const [field, name] of Object.entries(YAHOO)) {
    for (const [end, v] of Object.entries(st.rows[name] || {})) {
      if (!Number.isFinite(v)) continue;
      if (!frame.has(end)) frame.set(end, {});
      frame.get(end)[field] = { val: ABS.has(field) ? Math.abs(v) : v, info: { item: name } };
    }
  }
  return frame;
}

// Finnhub's as-reported 10-Ks carry the same XBRL concepts as the SEC's API.
const BY_TAG = new Map();
for (const [field, , , tags] of TAGS) tags.forEach((t, prio) => BY_TAG.set(t, [...(BY_TAG.get(t) || []), { field, prio }]));
function finnhubFrame(reports, splits) {
  const frame = new Map();
  for (const r of reports) {
    if (!/^10-K/.test(r.form || '')) continue;
    const end = String(r.endDate || '').slice(0, 10);
    const filed = String(r.filedDate || '').slice(0, 10) || end;
    if (!/^\d{4}-\d\d-\d\d$/.test(end)) continue;
    const best = {};
    for (const part of ['ic', 'cf', 'bs']) {
      for (const item of r.report?.[part] || []) {
        const tag = String(item?.concept || '').replace(/^us-gaap_/, '');
        if (!Number.isFinite(item?.value)) continue;
        for (const { field, prio } of BY_TAG.get(tag) || []) if (!best[field] || prio < best[field].prio) best[field] = { prio, val: item.value, tag };
      }
    }
    const row = frame.get(end) || {};
    for (const [f, b] of Object.entries(best)) {
      if (row[f] && row[f].info.filed >= filed) continue; // keep the latest filing (amendments)
      row[f] = { val: adjust(f, b.val, filed, splits), info: { tag: b.tag, filed, form: r.form }, raw: b.val };
    }
    const parts = Object.fromEntries(DEBT_PARTS.filter((k) => row[k]).map((k) => [k, row[k].val]));
    const d = debtOf(parts);
    if (d != null) row.debt = { val: d, info: { filed, form: r.form, tag: 'debt components' } };
    if (Object.keys(row).length) frame.set(end, row);
  }
  return frame;
}

// ---- merging: SEC first, then each fallback fills gaps that pass the cross-check ----------------

/** The overlapping year nearest to `fy` where the primary source and the fallback both have `field`. */
function crossCheck(years, field, fb, fy) {
  let primary = 'SEC';
  if (!years.some((z) => z.src[field]?.s === 'SEC')) primary = fb.name === 'Finnhub' && years.some((z) => z.src[field]?.s === 'Yahoo') ? 'Yahoo' : null;
  if (!primary) return null;
  let best = null;
  for (const z of years) {
    if (z.src[field]?.s !== primary || z[field] == null) continue;
    const k = nearKey(fb.frame, z.end);
    const x = k && fb.frame.get(k)[field];
    if (!x) continue;
    const dist = Math.abs(z.fy - fy);
    if (!best || dist < best.dist || (dist === best.dist && z.fy > best.fy)) best = { dist, fy: z.fy, primary, primaryVal: z[field], fallbackVal: x.val };
  }
  if (!best) return null;
  const p = best.primaryVal;
  const q = best.fallbackVal;
  return { fy: best.fy, primary, primaryVal: p, fallbackVal: q, diff: p === 0 ? (q === 0 ? 0 : 99) : Math.abs(q - p) / Math.abs(p) };
}

function mergeYears(secF, fallbacks, { financial, fields }) {
  const make = (end) => ({ end, fy: Number(end.slice(0, 4)), src: {}, na: {}, conflict: {} });
  const years = [];
  for (const [end, row] of secF) {
    const y = make(end);
    for (const [f, x] of Object.entries(row)) {
      y[f] = x.val;
      y.src[f] = { s: 'SEC', ...x.info };
    }
    const d = debtOf(y);
    if (d != null) y.src.debt = { s: 'SEC', tag: DEBT_PARTS.filter((k) => y[k] != null).map((k) => y.src[k].tag).join(' + ') };
    y.debt = d;
    years.push(y);
  }
  const anchor = years.length ? years[years.length - 1].end : null;
  // a fallback period becomes a new row only if it fits the company's fiscal calendar
  const fits = (end) => {
    if (!anchor) return true;
    const d = (((Date.parse(end) - Date.parse(anchor)) / DAY) % 365.2425 + 365.2425) % 365.2425;
    return Math.min(d, 365.2425 - d) <= 10;
  };
  const fill = FILL.filter((f) => fields.has(f) || f === 'debt');
  for (const fb of fallbacks) {
    for (const end of fb.frame.keys()) {
      if (years.some((y) => near(y.end, end)) || !fits(end) || years.some((y) => y.fy === Number(end.slice(0, 4)))) continue;
      years.push(make(end));
    }
    years.sort((a, b) => a.end.localeCompare(b.end));
    for (const field of fill) {
      if (financial && BANK_SKIP.has(field)) continue;
      for (const y of years) {
        if (y[field] != null || y.conflict[field]) continue;
        const k = nearKey(fb.frame, y.end);
        const x = k && fb.frame.get(k)[field];
        if (!x) continue;
        const check = crossCheck(years, field, fb, y.fy);
        if (check && check.diff > TOLERANCE) {
          y.conflict[field] = { source: fb.name, val: x.val, period: k, check };
          continue;
        }
        y[field] = x.val;
        y.src[field] = { s: fb.name, period: k, ...x.info, check };
        fb.used++;
      }
    }
  }
  return years;
}

// ---- derived figures: formula, sources and (when missing) why ----------------------------------

function derive(y, financial) {
  const f = {};
  const why = (inputs) => {
    for (const k of inputs) {
      if (y[k] != null) continue;
      if (y.conflict[k]) return `${LABEL[k]}: sources disagree`;
      return DERIVED.has(k) ? y.na[k] || 'not reported' : `${LABEL[k]}: ${y.na[k] || 'not reported'}`;
    }
    return 'not meaningful';
  };
  const put = (key, val, inputs, optional, formula) => {
    y[key] = Number.isFinite(val) ? val : null;
    f[key] = formula;
    if (y[key] != null) y.src[key] = { s: combine([...inputs, ...optional].filter((k) => y[k] != null).map((k) => y.src[k]?.s)), derived: true };
    else y.na[key] = financial && ['fcf', 'ebitda', 'netDebt'].includes(key) ? 'not applicable to banks and insurers' : why(inputs);
  };
  put('cashAll', y.cash == null ? null : y.cash + (y.stInvest ?? 0), ['cash'], ['stInvest'], 'Cash & equivalents + short-term investments');
  put('netDebt', y.debt == null || y.cashAll == null ? null : y.debt - y.cashAll, ['debt', 'cashAll'], [], 'Debt − cash & short-term investments');
  if (y.opIncome != null) put('ebit', y.opIncome, ['opIncome'], [], 'Operating income');
  else put('ebit', y.pretax != null && y.interest != null ? y.pretax + y.interest : null, ['pretax', 'interest'], [], 'Pre-tax income + interest expense (no operating income reported)');
  if (y.ebit == null && !financial) y.na.ebit = `neither operating income nor pre-tax income + interest expense is available (operating income: ${y.na.opIncome || 'not reported'})`;
  put('ebitda', y.ebit != null && y.da != null ? y.ebit + y.da : null, ['ebit', 'da'], [], `EBIT (${f.ebit.toLowerCase()}) + depreciation & amortization`);
  if (y.grossProfit == null && y.revenue != null && y.cogs != null) put('grossProfit', y.revenue - y.cogs, ['revenue', 'cogs'], [], 'Revenue − cost of revenue');
  else f.grossProfit = 'Gross profit (as reported)';
  put('fcf', y.ocf == null || y.capex == null ? null : y.ocf - y.capex, ['ocf', 'capex'], [], 'Operating cash flow − capital expenditure');
  put('commonEquity', y.equity == null ? null : y.equity - (y.preferred ?? 0), ['equity'], ['preferred'], "Shareholders' equity − preferred stock");
  put('tangibleEquity', y.commonEquity == null ? null : y.commonEquity - (y.goodwill ?? 0) - (y.intangibles ?? 0), ['commonEquity'], ['goodwill', 'intangibles'], 'Common equity − goodwill − other intangible assets');
  put('shares', y.sharesOut ?? y.sharesDil, [y.sharesOut != null ? 'sharesOut' : 'sharesDil'], [], y.sharesOut != null ? 'Shares outstanding at year end' : 'Diluted average shares (no year-end count)');
  f.debt = y.src.debt?.s && y.src.debt.s !== 'SEC' ? `Total debt (${y.src.debt.s})` : y.ltdTotal != null ? 'Long-term debt (incl. current part) + short-term borrowings / commercial paper' : 'Long-term debt + current part of long-term debt + short-term borrowings / commercial paper';
  y.formulas = f;
  return y;
}

// ---- trailing 12 months from the SEC's 10-Q data ------------------------------------------------

// the uses of cash shown by ALLOC for the last 12 months
const USE_NOW = ['rnd', 'acquisitions', 'buybacks', 'dividendsPaid', 'debtRepaid'];
const FLOW_NOW = ['revenue', 'opIncome', 'pretax', 'interest', 'netIncome', 'da', 'ocf', 'capex', 'epsDil', 'dps', 'prefDividends'];
const BAL_NOW = ['cash', 'stInvest', 'ltdTotal', 'ltdNoncurrent', 'ltdCurrent', 'shortDebt', 'equity', 'preferred', 'goodwill', 'intangibles', 'sharesOut'];

/** TTM = latest fiscal year + year-to-date (10-Q) − the same period a year earlier. */
function secNow(raw, fyEnd, splits) {
  const rowsOf = (field) => (raw[field] || []).map(({ tag, json }) => ({ tag, rows: json?.units?.[UNIT_OF[field]] || [] }));
  const fyRow = (rows) => latestFiled(rows.filter((r) => /^10-K/.test(r.form || '') && r.start && dur(r) > 350 && dur(r) < 380 && near(r.end, fyEnd, 8)));
  const ytdRows = (rows, fy) => rows.filter((r) => /^10-Q/.test(r.form || '') && r.start && near(r.start, plusDays(fy.end, 1), 8) && Date.parse(r.end) > Date.parse(fy.end) + 20 * DAY);
  const adj = (f, r) => adjust(f, r.val, r.filed, splits);
  let q = null;
  for (const f of ['revenue', 'netIncome']) {
    for (const { rows } of rowsOf(f)) {
      const fy = fyRow(rows);
      if (fy) for (const r of ytdRows(rows, fy)) if (!q || r.end > q) q = r.end;
    }
  }
  const flow = {};
  for (const f of [...FLOW_NOW, ...USE_NOW]) {
    for (const { tag, rows } of rowsOf(f)) {
      const fy = fyRow(rows);
      if (!fy) continue;
      if (!q) {
        flow[f] = { val: adj(f, fy), end: fy.end, tag, filed: fy.filed, formula: `FY ending ${fy.end} (the latest report is that 10-K, so the last 12 months are that fiscal year)` };
        break;
      }
      const cur = latestFiled(ytdRows(rows, fy).filter((r) => near(r.end, q, 8)));
      if (!cur) continue;
      const prior = latestFiled(rows.filter((r) => r.start && Math.abs(dur(r) - dur(cur)) < 15 && near(r.start, plusDays(cur.start, -365), 10) && near(r.end, plusDays(cur.end, -365), 10)));
      if (!prior) continue;
      flow[f] = {
        val: adj(f, fy) + adj(f, cur) - adj(f, prior), end: cur.end, tag, filed: cur.filed,
        formula: `FY ending ${fy.end} + ${Math.round(dur(cur) / 30.4)} months to ${cur.end} − ${Math.round(dur(prior) / 30.4)} months to ${prior.end}`,
        parts: [adj(f, fy), adj(f, cur), adj(f, prior)],
      };
      break;
    }
  }
  // the balance sheet of the latest report
  let b = null;
  for (const f of ['equity', 'cash']) for (const { rows } of rowsOf(f)) for (const r of rows) if (!r.start && /^10-[KQ]/.test(r.form || '') && Date.parse(r.end) >= Date.parse(fyEnd) - 8 * DAY && (!b || r.end > b)) b = r.end;
  const bal = {};
  if (b) {
    for (const f of BAL_NOW) {
      for (const { tag, rows } of rowsOf(f)) {
        const r = latestFiled(rows.filter((x) => !x.start && /^10-[KQ]/.test(x.form || '') && near(x.end, b, 8)));
        if (r) {
          bal[f] = { val: adj(f, r), end: r.end, tag, filed: r.filed, form: r.form };
          break;
        }
      }
    }
  }
  // the latest share count, from the cover page of the latest 10-K or 10-Q (summed over share classes)
  let dei = null;
  const drows = raw.deiShares?.units?.shares || [];
  const lastEnd = drows.reduce((a, r) => (!a || r.end > a ? r.end : a), null);
  if (lastEnd) {
    const same = drows.filter((r) => r.end === lastEnd);
    const accn = latestFiled(same).accn;
    const vals = [...new Set(same.filter((r) => r.accn === accn).map((r) => r.val))];
    const filed = latestFiled(same).filed;
    dei = { val: adjust('deiShares', vals.reduce((a, v) => a + v, 0), filed, splits), end: lastEnd, filed, classes: vals.length };
  }
  return { q, flow, b, bal, dei };
}

export function createFundamentals({ sec, yahoo, finnhub = null, rates = null, kvStore = null, log = () => {} }) {
  const cache = new Map();
  // ttl: milliseconds, or a function of the result (a result with a failed source: 60 s at most)
  const cached = (key, ttl, fn) => {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < hit.ttl) return hit.p;
    const entry = { at: Date.now(), ttl: 10 * 60e3, p: null };
    entry.p = fn().then((r) => {
      entry.at = Date.now();
      entry.ttl = typeof ttl === 'function' ? ttl(r) : ttl;
      return r;
    }, (err) => {
      cache.delete(key);
      throw err;
    });
    cache.set(key, entry);
    return entry.p;
  };

  // ---- SEC: one company's figures, one request per tag ---------------------------------------
  async function fromSec(cik, fields, latestOnly) {
    const want = TAGS.filter((t) => fields.has(t[0]));
    const series = {};
    const raw = {};
    const errs = {};
    let foreignUnit = null;
    await pool(want, 4, async ([field, kind, unit, tags]) => {
      const merged = new Map();
      raw[field] = [];
      try {
        for (const tag of tags) {
          const j = await sec.concept(cik, tag);
          if (!j) continue;
          raw[field].push({ tag, json: j });
          const { out, unitFound } = annualSeries(j, unit, kind, tag);
          if (!out.size && unitFound && unit === 'USD' && unitFound !== 'USD') foreignUnit ||= unitFound;
          // fill only the years a higher-priority tag didn't cover
          for (const [end, v] of out) if (!merged.has(end)) merged.set(end, v);
          if (merged.size >= 10) break;
          // peers only need the latest year: stop at the first tag that has it
          if (latestOnly && [...merged.keys()].some((e) => Date.now() - Date.parse(e) < 550 * DAY)) break;
        }
      } catch (err) {
        errs[field] = err;
      }
      series[field] = merged;
    });
    try {
      raw.deiShares = await sec.concept(cik, 'EntityCommonStockSharesOutstanding', 'dei');
    } catch (err) {
      errs.deiShares = err;
    }
    return { series, raw, errs, foreignUnit };
  }

  /** Annual fundamentals for one company. set 'val' = what valuation needs; 'full' = everything. */
  function annual(symbol, set = 'full') {
    return cached(`annual:${symbol}:${set}`, (r) => (r.partial ? 60e3 : 6 * 60 * 60e3), async () => {
      const fields = set === 'full' ? new Set(TAGS.map((t) => t[0])) : VAL_FIELDS;
      const status = { sec: { state: 'ok' }, yahoo: { state: 'not needed' }, finnhub: { state: finnhub?.configured() ? 'not needed' : 'no key' } };
      let partial = false;
      // splits, for restating per-share figures filed before a split
      let splits = [];
      try {
        splits = (await yahoo.events(symbol)).splits || [];
      } catch (err) {
        status.splits = failed(err);
        partial = true;
      }
      // 1. SEC
      let hit = null;
      let profile = null;
      let secData = null;
      let note = null;
      try {
        hit = await sec.cikOf(symbol);
        if (!hit) status.sec = { state: 'none', message: `${symbol} isn't in the SEC's list of US filers` };
      } catch (err) {
        status.sec = failed(err);
      }
      if (hit) {
        try {
          profile = await sec.profile(hit.cik);
        } catch (err) {
          status.profile = failed(err);
          partial = true;
        }
        secData = await fromSec(hit.cik, fields, set === 'val');
        const bad = Object.entries(secData.errs).filter(([k]) => k !== 'deiShares');
        if (bad.length && bad.length >= Object.keys(secData.series).length) status.sec = failed(bad[0][1]);
        else if (bad.length) status.sec = { state: 'partial', http: bad[0][1].http ?? null, message: `${bad.length} of ${Object.keys(secData.series).length} items failed: ${bad[0][1].message}`, items: bad.map(([k]) => k) };
        if (secData.foreignUnit) note = `It reports in ${secData.foreignUnit}, not US dollars.`;
      }
      if (status.sec.state === 'failed' || status.sec.state === 'partial') partial = true;
      let financial = profile?.sic ? isFinancialSic(profile.sic) : null;
      let industrySource = profile?.sic ? 'SEC' : null;
      if (financial == null) {
        // no SEC industry code (not a filer, or the SEC failed): Yahoo's industry instead
        try {
          const yp = await yahoo.profile(symbol);
          if (yp?.industry || yp?.sector) {
            financial = /^(Banks|Insurance|Capital Markets|Mortgage Finance|Financial Conglomerates|Asset Management)/i.test(yp.industry || '');
            industrySource = `Yahoo (${yp.sector || ''}${yp.industry ? ` · ${yp.industry}` : ''})`;
          }
        } catch (err) {
          status.yahooProfile = failed(err);
        }
      }
      const secF = secData && status.sec.state !== 'failed' ? secFrame(secData.series, splits) : new Map();
      const latestSec = [...secF.keys()].pop() || null;

      // 2./3. fallbacks, only for gaps
      const fill = FILL.filter((f) => fields.has(f) || f === 'debt');
      const gaps = (keys, years) => years.length === 0 || years.some((y) => keys.some((k) => y[k] == null && !(financial && BANK_SKIP.has(k))));
      const pre = [...secF].map(([end, row]) => ({ end, ...Object.fromEntries(Object.entries(row).map(([k, x]) => [k, x.val])), debt: debtOf(Object.fromEntries(Object.entries(row).map(([k, x]) => [k, x.val]))) }));
      const fallbacks = [];
      let currency = secF.size ? 'USD' : null;
      let yahooYears = null;
      if (gaps(fill, pre)) {
        try {
          const st = await yahoo.statements(symbol, 'annual');
          if (secF.size && st.currency && st.currency !== 'USD') {
            status.yahoo = { state: 'other currency', message: `Yahoo's statements are in ${st.currency}; the SEC figures are in USD, so they aren't mixed` };
          } else {
            const fb = { name: 'Yahoo', frame: yahooFrame(st), used: 0 };
            fallbacks.push(fb);
            status.yahoo = { state: 'ok', fb };
            yahooYears = [...fb.frame.keys()].sort();
            currency ||= st.currency;
          }
        } catch (err) {
          status.yahoo = err.http === 'empty' ? { state: 'none', message: err.message } : failed(err);
          if (status.yahoo.state === 'failed') partial = true;
        }
      }
      let years = mergeYears(secF, fallbacks, { financial, fields });
      // Finnhub: for gaps in core figures, and for the history the SEC would have given
      if (finnhub?.configured() && (!secF.size || gaps(CORE.filter((k) => fill.includes(k) || fields.has(k)), years))) {
        try {
          const reports = await finnhub.reported(symbol, 'annual');
          const fb = { name: 'Finnhub', frame: finnhubFrame(reports, splits), used: 0 };
          if (fb.frame.size) {
            fallbacks.push(fb);
            status.finnhub = { state: 'ok', fb };
            years = mergeYears(secF, fallbacks, { financial, fields });
          } else status.finnhub = { state: 'none', message: 'Finnhub has no 10-K figures for it' };
        } catch (err) {
          status.finnhub = failed(err);
          partial = true;
        }
      }
      for (const s of Object.values(status)) if (s.fb) {
        s.filled = s.fb.used;
        delete s.fb;
      }
      if (!years.length) {
        const why = [status.sec, status.yahoo].filter((s) => s.state === 'failed').map((s) => s.message);
        throw Object.assign(new Error(`no annual financial statements found for ${symbol}${why.length ? `: ${why.join('; ')}` : ''}${note ? ` (${note})` : ''}`), { status: why.length ? 502 : 404 });
      }
      years = years.slice(-12);

      // why each missing figure is missing
      const secWhy = (k) => (status.sec.state === 'failed' ? `SEC: ${failText(status.sec)}` : secData?.errs[k] ? `SEC: ${failText(secData.errs[k])}` : status.sec.state === 'none' ? 'not an SEC filer' : null);
      const yRange = yahooYears?.length ? `FY${yahooYears[0].slice(0, 4)}–FY${yahooYears[yahooYears.length - 1].slice(0, 4)}` : null;
      for (const y of years) {
        for (const k of [...TAGS.map((t) => t[0]).filter((t) => fields.has(t)), 'debt']) {
          if (y[k] != null) continue;
          if (y.conflict[k]) {
            const c = y.conflict[k];
            y.na[k] = `sources disagree: ${c.source} has a number, but in FY${c.check.fy} the ${c.check.primary} and ${c.source} figures are ${(c.check.diff * 100).toFixed(1)}% apart (more than 2%)`;
            continue;
          }
          if (financial && BANK_SKIP.has(k)) {
            y.na[k] = 'not applicable to banks and insurers';
            continue;
          }
          const parts = [];
          const sw = secWhy(k);
          parts.push(sw || 'SEC: not reported');
          if (fill.includes(k)) {
            const ys = status.yahoo;
            parts.push(ys.state === 'failed' ? `Yahoo: ${failText(ys)}` : ys.state === 'other currency' ? `Yahoo: in another currency` : yRange && !yahooYears.some((e) => near(e, y.end)) ? `Yahoo: covers ${yRange} only` : 'Yahoo: not reported');
            const fs = status.finnhub;
            parts.push(fs.state === 'no key' ? 'Finnhub: no API key set' : fs.state === 'failed' ? `Finnhub: ${failText(fs)}` : fs.state === 'not needed' ? null : 'Finnhub: not reported');
          }
          const list = parts.filter(Boolean);
          y.na[k] = list.every((p) => /not reported$/.test(p)) ? `not reported (${list.map((p) => p.split(':')[0]).join(', ')})` : list.join('; ');
        }
        derive(y, financial);
      }

      // "now": trailing 12 months
      const now = await nowFigures(symbol, { secData, latestSec, years, splits, financial, status, set });
      if (now.partial) partial = true;

      const filedDates = years.flatMap((y) => Object.values(y.src).map((s) => s.filed).filter(Boolean)).sort();
      const usedOther = ['Yahoo', 'Finnhub'].filter((n) => status[n.toLowerCase()]?.filled);
      return {
        symbol, currency, profile, years, financial, industrySource, partial, status,
        asOf: filedDates[filedDates.length - 1] || years[years.length - 1].end,
        source: secF.size
          ? `SEC EDGAR (XBRL, 10-K and 10-Q filings)${usedOther.length ? `; gaps filled from ${usedOther.map((n) => `${n} (${status[n.toLowerCase()].filled})`).join(' and ')}` : ''}`
          : `${usedOther.join(' and ') || 'Yahoo Finance'} (no SEC data: ${status.sec.state === 'failed' ? `SEC ${failText(status.sec)}` : status.sec.message || 'not an SEC filer'})`,
        now,
        note,
        splits: splits.map((s) => ({ date: new Date(s.date * 1000).toISOString().slice(0, 10), ratio: s.ratio })),
      };
    });
  }

  // ---- "now" figures: TTM flows and the latest balance sheet ---------------------------------
  async function nowFigures(symbol, { secData, latestSec, years, splits, financial, status }) {
    const last = years[years.length - 1];
    const s = secData && latestSec && status.sec.state !== 'failed' ? secNow(secData.raw, latestSec, splits) : { flow: {}, bal: {} };
    const N = {};
    let partial = false;
    const flows = financial ? ['revenue', 'netIncome', 'epsDil', 'dps', 'prefDividends', 'dividendsPaid', 'buybacks', 'acquisitions'] : [...FLOW_NOW, ...USE_NOW];
    const bals = financial ? ['equity', 'preferred', 'goodwill', 'intangibles'] : ['cash', 'stInvest', 'equity', 'preferred', 'goodwill', 'intangibles'];
    for (const f of flows) {
      const x = s.flow[f];
      if (x) N[f] = { val: x.val, basis: 'TTM', src: 'SEC', end: x.end, formula: x.formula, filed: x.filed, tag: x.tag };
    }
    for (const f of bals) {
      const x = s.bal[f];
      if (x) N[f] = { val: x.val, basis: 'latest', src: 'SEC', end: x.end, filed: x.filed, tag: x.tag, formula: `${x.form} balance sheet, ${x.end}` };
    }
    if (!financial && s.bal && DEBT_PARTS.some((k) => s.bal[k])) {
      const d = debtOf(Object.fromEntries(DEBT_PARTS.filter((k) => s.bal[k]).map((k) => [k, s.bal[k].val])));
      const r = s.bal[DEBT_PARTS.find((k) => s.bal[k])];
      N.debt = { val: d, basis: 'latest', src: 'SEC', end: r.end, filed: r.filed, formula: `${r.form} balance sheet, ${r.end}` };
    }
    if (s.dei) N.shares = { val: s.dei.val, basis: 'latest', src: 'SEC', end: s.dei.end, filed: s.dei.filed, formula: `cover page of the filing of ${s.dei.filed}: shares outstanding on ${s.dei.end}${s.dei.classes > 1 ? ` (${s.dei.classes} share classes added)` : ''}` };
    else if (s.bal?.sharesOut) N.shares = { val: s.bal.sharesOut.val, basis: 'latest', src: 'SEC', end: s.bal.sharesOut.end, filed: s.bal.sharesOut.filed, formula: `shares outstanding, ${s.bal.sharesOut.form} balance sheet ${s.bal.sharesOut.end}` };

    // Yahoo's trailing figures and latest quarterly balance sheet, for what the SEC lacks
    const wantFlows = flows.filter((f) => !N[f] && YAHOO[f]);
    const wantBals = [...bals, ...(financial ? [] : ['debt']), 'shares'].filter((f) => !N[f]);
    const target = s.q || latestSec || null;
    const take = async (freq, list, make) => {
      if (!list.length) return;
      try {
        const st = await yahoo.statements(symbol, freq);
        if (latestSec && st.currency && st.currency !== 'USD') return;
        const ends = Object.keys(Object.assign({}, ...Object.values(st.rows))).sort();
        const end = ends[ends.length - 1];
        if (!end || (target && !near(end, target, 10) && Date.parse(end) < Date.parse(target))) return;
        for (const f of list) {
          const name = f === 'shares' ? 'OrdinarySharesNumber' : YAHOO[f];
          let v = st.rows[name]?.[end];
          if (!Number.isFinite(v)) continue;
          if (ABS.has(f)) v = Math.abs(v);
          // sanity check against the SEC: the annual figures of the latest overlapping year
          const ann = await yahooAnnualCheck(symbol, f === 'shares' ? 'sharesOut' : f, years);
          if (ann && ann.diff > TOLERANCE) {
            N[f] = { val: null, conflict: { source: 'Yahoo', val: v, period: end, check: ann }, why: `sources disagree: in FY${ann.fy} the SEC and Yahoo figures are ${(ann.diff * 100).toFixed(1)}% apart (more than 2%)` };
            continue;
          }
          N[f] = { val: v, basis: freq === 'trailing' ? 'TTM' : 'latest', src: 'Yahoo', end, check: ann, formula: make(name, end) };
        }
      } catch (err) {
        if (err.http !== 'empty') {
          status[`yahoo${freq}`] = failed(err);
          partial = true;
        }
      }
    };
    await take('trailing', wantFlows, (name, end) => `Yahoo trailing 12 months to ${end} (${name})`);
    await take('quarterly', wantBals.filter((f) => f === 'shares' || YAHOO[f]), (name, end) => `Yahoo quarterly balance sheet, ${end} (${name})`);

    // still missing: the latest fiscal year, labelled FY
    for (const f of [...flows, ...bals, ...(financial ? [] : ['debt']), 'shares']) {
      if (N[f] && (N[f].val != null || N[f].conflict)) continue;
      if (last[f] != null) N[f] = { val: last[f], basis: 'FY', src: last.src[f]?.s || 'SEC', end: last.end, formula: `FY${last.fy} (no trailing-12-month or later figure)` };
      else N[f] = { val: null, why: last.na[f] || 'not reported' };
    }

    // derived
    const get = (k) => N[k]?.val ?? null;
    const der = (key, val, inputs, optional, formula) => {
      const used = [...inputs, ...optional].filter((k) => get(k) != null);
      if (Number.isFinite(val)) N[key] = { val, basis: inputs.some((k) => N[k]?.basis === 'FY') ? 'FY' : inputs.some((k) => N[k]?.basis === 'TTM') ? 'TTM' : 'latest', src: combine(used.map((k) => N[k].src)), formula, derived: true };
      else {
        const miss = inputs.find((k) => get(k) == null);
        N[key] = { val: null, why: financial && ['fcf', 'ebitda', 'netDebt'].includes(key) ? 'not applicable to banks and insurers' : miss ? (DERIVED.has(miss) ? N[miss]?.why : `${LABEL[miss] || miss}: ${N[miss]?.why || 'not reported'}`) : 'not meaningful' };
      }
    };
    if (!financial) {
      der('cashAll', get('cash') == null ? null : get('cash') + (get('stInvest') ?? 0), ['cash'], ['stInvest'], 'Cash & equivalents + short-term investments');
      der('netDebt', get('debt') == null || get('cashAll') == null ? null : get('debt') - get('cashAll'), ['debt', 'cashAll'], [], 'Debt − cash & short-term investments');
      if (get('opIncome') != null) der('ebit', get('opIncome'), ['opIncome'], [], 'Operating income');
      else der('ebit', get('pretax') != null && get('interest') != null ? get('pretax') + get('interest') : null, ['pretax', 'interest'], [], 'Pre-tax income + interest expense');
      if (get('ebit') == null) N.ebit.why = `neither operating income nor pre-tax income + interest expense is available (operating income: ${N.opIncome?.why || 'not reported'})`;
      der('ebitda', get('ebit') != null && get('da') != null ? get('ebit') + get('da') : null, ['ebit', 'da'], [], 'EBIT + depreciation & amortization');
      der('fcf', get('ocf') != null && get('capex') != null ? get('ocf') - get('capex') : null, ['ocf', 'capex'], [], 'Operating cash flow − capital expenditure');
    }
    der('commonEquity', get('equity') == null ? null : get('equity') - (get('preferred') ?? 0), ['equity'], ['preferred'], "Shareholders' equity − preferred stock");
    der('tangibleEquity', get('commonEquity') == null ? null : get('commonEquity') - (get('goodwill') ?? 0) - (get('intangibles') ?? 0), ['commonEquity'], ['goodwill', 'intangibles'], 'Common equity − goodwill − other intangible assets');
    // the period "now" covers: the SEC's 10-Q quarter, else Yahoo's trailing quarter
    const yEnds = flows.map((f) => N[f]).filter((x) => x?.src === 'Yahoo' && x.basis === 'TTM').map((x) => x.end).sort();
    // only the items the multiples use count for the "(some items: FY)" label
    const fyOnly = (financial ? ['epsDil', 'dps'] : ['revenue', 'epsDil', 'ocf', 'capex', 'da', N.opIncome?.val != null ? 'opIncome' : 'pretax']).some((f) => N[f]?.basis === 'FY');
    return { fields: N, ttmEnd: s.q || yEnds[yEnds.length - 1] || null, ttmSource: s.q ? 'SEC 10-Q' : yEnds.length ? 'Yahoo' : null, fyOnly, balanceEnd: s.b || null, partial };
  }

  // The annual cross-check of Yahoo against the SEC for one item, in the latest overlapping year.
  async function yahooAnnualCheck(symbol, field, years) {
    let st;
    try {
      st = await yahoo.statements(symbol, 'annual');
    } catch {
      return null;
    }
    const frame = yahooFrame(st);
    return crossCheck(years, field, { name: 'Yahoo', frame }, years[years.length - 1]?.fy ?? 0);
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

  // ---- reporting currency vs price currency ---------------------------------------------------
  // A foreign company's statements are in its own currency, its (ADR) price in another: convert the figures.
  const fxPair = (from, to) => cached(`fx:${from}>${to}`, (r) => (r ? 6 * 60 * 60e3 : 60e3), () => lookupFx({ getChart: (s) => weekly(s), ecb: rates ? () => rates.fx() : null }, from, to));

  /** How to put one company's figures and its price in the same currency. `error` when no rate could be loaded. */
  async function fxPlan(a, w) {
    const st = major(a.currency);
    const px = major(w.meta?.currency);
    const plan = { stCcy: st.ccy, pxCcy: px.ccy, stScale: st.scale, pxScale: px.scale, same: !st.ccy || !px.ccy || st.ccy === px.ccy, fx: null, error: null };
    if (!plan.same) {
      plan.fx = await fxPair(st.ccy, px.ccy);
      if (!plan.fx) plan.error = `The financial statements are in ${a.currency} but the share price is in ${w.meta.currency}, and no exchange rate between them could be loaded (Yahoo Finance and the ECB were tried), so the multiples show n/a. Try again in a minute.`;
    }
    // factor for today's figures (one rate for all years), and for the figures of one fiscal year end
    plan.spot = plan.error ? null : plan.stScale * (plan.same ? 1 : plan.fx.spot);
    plan.at = (date) => {
      if (plan.error) return null;
      if (plan.same) return plan.stScale;
      const r = plan.fx.at(date);
      return r == null ? null : plan.stScale * r;
    };
    plan.price = (p) => (p == null ? null : p * plan.pxScale);
    plan.changed = !plan.same || plan.pxScale !== 1 || plan.stScale !== 1;
    return plan;
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

  // The figures each multiple uses (for its sources and, when it's n/a, the reason).
  const INPUTS = {
    pe: ['epsDil'], evEbitda: ['shares', 'netDebt', 'ebitda'], ps: ['shares', 'revenue'], pfcf: ['shares', 'fcf'], fcfYield: ['shares', 'fcf'],
    pb: ['shares', 'commonEquity'], ptbv: ['shares', 'tangibleEquity'], divYield: ['dps'],
  };

  // The multiples one fiscal year's figures give at a given price, with the sources behind each.
  function multiples(y, price, financial) {
    const shares = y.shares;
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
    m.src = {};
    for (const [k, inputs] of Object.entries(INPUTS)) if (m[k] != null) m.src[k] = combine(inputs.map((f) => y.src[f]?.s));
    return m;
  }

  // "Now" multiples: today's price with trailing-12-month flows and the latest balance sheet.
  function nowMultiples(now, price, financial) {
    const N = now.fields;
    const v = (k) => N[k]?.val ?? null;
    const shares = v('shares');
    const cap = price != null && shares ? price * shares : null;
    const m = { price, marketCap: cap, shares, sharesBasis: N.shares?.formula || 'shares', meta: {} };
    const set = (k, val, inputs, bad) => {
      m[k] = Number.isFinite(val) ? val : null;
      const used = inputs.filter((f) => v(f) != null);
      const miss = inputs.find((f) => v(f) == null);
      m.meta[k] = {
        basis: inputs.some((f) => N[f]?.basis === 'FY') ? 'FY' : 'TTM',
        src: combine(used.map((f) => N[f].src)),
        why: m[k] != null ? null : miss ? (DERIVED.has(miss) ? N[miss]?.why || 'not reported' : `${LABEL[miss] || miss}: ${N[miss]?.why || 'not reported'}`) : bad || 'not meaningful (negative or zero)',
        conflict: inputs.some((f) => N[f]?.conflict) || undefined,
      };
    };
    set('pe', v('epsDil') > 0 && price != null ? price / v('epsDil') : null, ['epsDil'], 'negative earnings');
    if (financial) {
      set('pb', cap && v('commonEquity') > 0 ? cap / v('commonEquity') : null, ['shares', 'commonEquity']);
      set('ptbv', cap && v('tangibleEquity') > 0 ? cap / v('tangibleEquity') : null, ['shares', 'tangibleEquity']);
      set('divYield', v('dps') != null && price ? v('dps') / price : null, ['dps']);
    } else {
      m.ev = cap != null && v('netDebt') != null ? cap + v('netDebt') : null;
      set('evEbitda', m.ev != null && v('ebitda') > 0 ? m.ev / v('ebitda') : null, ['shares', 'netDebt', 'ebitda'], 'EBITDA negative');
      set('ps', cap && v('revenue') > 0 ? cap / v('revenue') : null, ['shares', 'revenue']);
      set('pfcf', cap && v('fcf') > 0 ? cap / v('fcf') : null, ['shares', 'fcf'], 'free cash flow negative');
      set('fcfYield', cap && v('fcf') != null ? v('fcf') / cap : null, ['shares', 'fcf']);
      set('pb', cap && v('commonEquity') > 0 ? cap / v('commonEquity') : null, ['shares', 'commonEquity']);
    }
    return m;
  }

  const KEYS = { normal: ['pe', 'evEbitda', 'ps', 'pfcf', 'fcfYield'], financial: ['pe', 'pb', 'ptbv', 'divYield'] };

  /** Valuation now (today's price, trailing 12 months) vs the company's own 5y/10y history. */
  function valuation(symbol) {
    return cached(`val:${symbol}`, (r) => (r.partial ? 60e3 : 60 * 60e3), async () => {
      const a0 = await annual(symbol, 'full');
      const w = await weekly(symbol);
      const plan = await fxPlan(a0, w);
      const ccyOk = !plan.error;
      // the figures in the price currency, at today's rate (one rate for every year: growth and margins stay those of the original currency)
      const a = ccyOk && plan.spot !== 1 ? { ...a0, years: a0.years.map((y) => scaleYear(y, MONEY, plan.spot)), now: scaleNow(a0.now, MONEY, plan.spot) } : a0;
      const priceCcy = plan.pxCcy || w.meta?.currency || null;
      const financial = a.financial ?? false;
      const keys = financial ? KEYS.financial : KEYS.normal;
      const pxOn = (d) => plan.price(priceOn(w.bars, d));
      // each fiscal year's multiples use the rate of that year end, because the price on that day goes with that year's figures
      const hist = a0.years.map((y) => {
        const f = plan.at(y.end);
        const yy = !ccyOk || f == null ? null : f === 1 ? y : scaleYear(y, MONEY, f);
        return { fy: y.fy, end: y.end, ...(yy ? multiples(yy, pxOn(y.end), financial) : { price: pxOn(y.end) }) };
      });
      const latest = a.years[a.years.length - 1];
      const price = plan.price(w.meta?.price ?? w.bars[w.bars.length - 1]?.c ?? null);
      const current = ccyOk ? nowMultiples(a.now, price, financial) : { price, meta: {} };
      // price × shares against the market value Yahoo quotes: catches an ADR price paired with ordinary-share statements
      let check = null;
      if (ccyOk && !plan.same && plan.pxScale === 1 && typeof yahoo.quotes === 'function') {
        try {
          const q = await yahoo.quotes([symbol], { fallback: false });
          check = shareCheck(current.marketCap, q?.quotes?.[symbol]?.marketCap);
        } catch {
          check = null;
        }
      }
      const fx = plan.changed && ccyOk ? {
        from: a0.currency, to: priceCcy, rate: plan.same ? plan.stScale : plan.fx.spot * plan.stScale, asOf: plan.fx?.asOf || null, source: plan.fx?.source || null,
        route: plan.fx?.route || [], priceQuotedIn: w.meta?.currency || null, historyOk: plan.same || plan.fx.at(a0.years[a0.years.length - 1].end) != null,
      } : null;
      const stats = {};
      for (const k of keys) {
        const s = (n) => {
          const rows = hist.slice(-n);
          const ok = rows.filter((h) => Number.isFinite(h[k]));
          const other = ok.filter((h) => h.src?.[k] && h.src[k] !== 'SEC').map((h) => `FY${h.fy}: ${h.src[k]}`);
          // n/a when fewer years than the window: no padding with estimates
          if (a.years.length < n) return { n: ok.length, short: true };
          return { n: ok.length, median: median(ok.map((h) => h[k])), min: ok.length ? Math.min(...ok.map((h) => h[k])) : null, max: ok.length ? Math.max(...ok.map((h) => h[k])) : null, src: other.length ? other : null };
        };
        stats[k] = { y5: s(5), y10: s(10) };
      }
      return {
        symbol, source: a.source, asOf: a.asOf, priceSource: 'Yahoo Finance (weekly closes, split-adjusted)', currency: ccyOk && plan.changed ? priceCcy : a.currency, priceCurrency: priceCcy, partial: a.partial, status: a.status,
        // the figures are in the price currency; `fx` says what was converted and at which rate; `shareCheck.suspect` = per-share figures may be off (ADR ratio)
        fx, shareCheck: check, currencyMismatch: ccyOk ? null : plan.error,
        financial, industrySource: a.industrySource, keys, profile: a.profile, current, now: a.now, latestFy: latest.fy, latestEnd: latest.end, history: hist, stats, splits: a.splits, years: a.years,
      };
    });
  }

  // ---- peers by SEC industry code --------------------------------------------------------------
  // SIC codes are looked up from EDGAR once and kept (they rarely change). Only answers are kept:
  // a failed lookup is retried next time, never stored.
  let sicMap = null;
  async function sicOf(sym) {
    sicMap ||= (await Promise.resolve(kvStore?.get('sic-map')).catch(() => null)) || {};
    if (sym in sicMap && sicMap[sym] != null) return sicMap[sym];
    const hit = await sec.cikOf(sym); // throws if the SEC fails
    if (!hit) {
      sicMap[sym] = null;
      return null;
    }
    const p = await sec.profile(hit.cik);
    sicMap[sym] = p?.sic ?? null;
    return sicMap[sym];
  }
  const saveSic = () => Promise.resolve(kvStore?.set('sic-map', sicMap)).catch(() => {});

  /** Up to `limit` peers: same 4-digit SIC, else 3-digit, else 2-digit, among `candidates`. */
  function peers(symbol, candidates, limit = 8) {
    return cached(`peers:${symbol}`, (r) => (r.partial ? 60e3 : 6 * 60 * 60e3), async () => {
      let own;
      try {
        own = await sicOf(symbol);
      } catch (err) {
        throw Object.assign(new Error(`the SEC lookup of ${symbol}'s industry code failed (${failText(err)}), so peers can't be matched right now`), { status: 502 });
      }
      if (!own) throw Object.assign(new Error(`${symbol} isn't in the SEC's list of US filers, so it has no SEC industry code to match peers by`), { status: 404 });
      const cands = candidates.filter((c) => c !== symbol).slice(0, 80);
      const sics = {};
      let lookupErr = null;
      let lookupFails = 0;
      await pool(cands, 4, async (c) => {
        try {
          sics[c] = await sicOf(c);
        } catch (err) {
          lookupErr = err;
          lookupFails++;
        }
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
      const failNote = lookupFails ? `${lookupFails} of ${cands.length} industry-code lookups failed (SEC ${failText(lookupErr)})` : null;
      if (chosen.length < 3) throw Object.assign(new Error(`fewer than 3 companies in Meridian's list share ${symbol}'s SEC industry code (${own})${failNote ? `; ${failNote}` : ''}`), { status: failNote ? 502 : 404 });
      const rows = [];
      await pool(chosen.slice(0, limit), 2, async (c) => rows.push({ ...(await peerRow(c)), sic: sics[c] }));
      const ok = rows.filter((r) => !r.error && !r.currencyMismatch);
      const med = {};
      for (const k of [...KEYS.normal, 'pb', 'ptbv', 'divYield']) med[k] = median(ok.map((r) => r[k]));
      return {
        symbol, sic: own, rule, peers: rows.sort((x, y) => (y.marketCap || 0) - (x.marketCap || 0)), median: med, failNote,
        partial: !!failNote || rows.some((r) => r.error || r.partial), source: 'SEC EDGAR (industry codes, 10-K/10-Q figures) and Yahoo Finance (prices; gap fills)',
      };
    });
  }

  /** One company's current multiples (trailing 12 months, today's price), for a peer table. */
  async function peerRow(c) {
    try {
      const a0 = await annual(c, 'val');
      const w = await weekly(c);
      const plan = await fxPlan(a0, w);
      const a = !plan.error && plan.spot !== 1 ? { ...a0, now: scaleNow(a0.now, MONEY, plan.spot) } : a0;
      const y = a.years[a.years.length - 1];
      const now = plan.price(w.meta?.price ?? w.bars[w.bars.length - 1]?.c ?? null);
      return { symbol: c, fy: y.fy, ttmEnd: a.now?.ttmEnd || null, financial: a.financial ?? false, source: a.source, partial: a.partial, ...(!plan.error ? nowMultiples(a.now, now, a.financial ?? false) : { price: now, currencyMismatch: true }) };
    } catch (err) {
      return { symbol: c, error: err.message };
    }
  }

  // FIN's annual statements built from the reported figures (SEC, then Finnhub), the same shape Yahoo's statements
  // have, for when Yahoo refuses. Only line items the filings give are present; outflows are negative like Yahoo's.
  async function statementsFromReported(symbol) {
    const a = await annual(symbol, 'full');
    const years = (a.years || []).filter((y) => y && FILL.some((f) => y[f] != null)).slice(-5);
    if (!years.length) throw Object.assign(new Error(`No reported annual figures for ${symbol}`), { status: 404 });
    const rows = {};
    const put = (name, end, val) => { if (val != null && Number.isFinite(val)) (rows[name] ||= {})[end] = val; };
    for (const y of years) {
      for (const f of FILL) put(YAHOO[f], y.end, ABS.has(f) && y[f] != null ? -Math.abs(y[f]) : y[f]);
      if (y.ocf != null && y.capex != null) put('FreeCashFlow', y.end, y.ocf - Math.abs(y.capex));
      if (y.debt != null && y.cash != null) put('NetDebt', y.end, y.debt - y.cash);
      if (y.opIncome != null && y.da != null) put('EBITDA', y.end, y.opIncome + y.da);
    }
    return { freq: 'annual', periods: years.map((y) => y.end), rows, currency: a.currency || null, layout: null, substitute: `reported company figures (${a.source || 'SEC EDGAR'}), because Yahoo's statements did not answer` };
  }

  return { annual, valuation, peers, peerRow, statementsFromReported };
}
