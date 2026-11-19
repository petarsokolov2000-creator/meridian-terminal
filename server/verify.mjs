// Cross-check: do Yahoo's company figures match the company's own SEC filing?
//
// Nothing from the SEC is ever mixed into a Yahoo number. This only compares the two and reports.
// A figure that differs by more than 5% is flagged so you know to doubt it; both values are shown.
// Only US filers reporting in US dollars can be checked (the SEC has nothing for the others).

import { annualSeries } from './fundamentals.mjs';

const DAY = 86400e3;
// [key, label, kind ('d' = a full year, 'i' = a balance-sheet date), SEC unit, SEC tags in priority order, Yahoo line]
export const ITEMS = [
  ['revenue', 'Revenue', 'd', 'USD', ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'RevenuesNetOfInterestExpense', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueGoodsNet'], 'TotalRevenue'],
  ['opIncome', 'Operating income', 'd', 'USD', ['OperatingIncomeLoss'], 'OperatingIncome'],
  ['netIncome', 'Net income', 'd', 'USD', ['NetIncomeLoss', 'ProfitLoss'], 'NetIncome'],
  ['epsDil', 'Diluted EPS', 'd', 'USD/shares', ['EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted'], 'DilutedEPS', 'perShare'],
  ['ocf', 'Operating cash flow', 'd', 'USD', ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'], 'OperatingCashFlow'],
  ['capex', 'Capital spending', 'd', 'USD', ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'], 'CapitalExpenditure', 'abs'],
  ['assets', 'Total assets', 'i', 'USD', ['Assets'], 'TotalAssets'],
  ['equity', 'Shareholders\' equity', 'i', 'USD', ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'], 'StockholdersEquity'],
];
export const AGREE = 0.02; // within 2%: the same figure (rounding, small restatements)
export const DOUBT = 0.05; // beyond 5%: flagged

const near = (a, b, days = 8) => Math.abs(Date.parse(a) - Date.parse(b)) <= days * DAY;

/** Compare one pair of values. `diff` is the relative gap to the SEC value. */
export function compare(yv, sv) {
  if (!Number.isFinite(yv) || !Number.isFinite(sv)) return { state: 'missing', diff: null };
  const diff = sv === 0 ? (yv === 0 ? 0 : 1) : Math.abs(yv - sv) / Math.abs(sv);
  return { state: diff <= AGREE ? 'agree' : diff <= DOUBT ? 'close' : 'differs', diff };
}

export function createVerify({ sec, yahoo, log = () => {} }) {
  const memo = new Map();
  async function run(symbol) {
    let st;
    try {
      st = await yahoo.statements(symbol, 'annual');
    } catch (err) {
      return { symbol, state: 'skipped', reason: `Yahoo has no annual statements for ${symbol} right now (${err.message}).` };
    }
    if (st.currency && st.currency !== 'USD') return { symbol, state: 'skipped', reason: `${symbol} reports in ${st.currency}. The SEC check only works for figures in US dollars.` };
    let hit;
    try {
      hit = await sec.cikOf(symbol);
    } catch (err) {
      return { symbol, state: 'skipped', reason: `The SEC could not be reached (${err.message}), so nothing could be checked.` };
    }
    if (!hit) return { symbol, state: 'skipped', reason: `${symbol} isn't in the SEC's list of US filers (foreign companies file different forms), so there is nothing to check against.` };
    let splits = [];
    try {
      splits = (await yahoo.events(symbol)).splits || [];
    } catch { /* without split data per-share figures are skipped for safety below */ }
    const ends = [...st.periods].sort().slice(-2).reverse();
    const rows = [];
    let secErr = null;
    for (const [key, label, kind, unit, tags, yline, flag] of ITEMS) {
      const secBy = new Map();
      try {
        for (const tag of tags) {
          const j = await sec.concept(hit.cik, tag);
          if (!j) continue;
          for (const [end, v] of annualSeries(j, unit, kind, tag).out) if (![...secBy.keys()].some((k) => near(k, end))) secBy.set(end, { ...v, tag });
          if (secBy.size >= 3) break;
        }
      } catch (err) {
        secErr = err;
      }
      for (const end of ends) {
        let yv = st.rows[yline]?.[end];
        const k = [...secBy.keys()].find((e) => near(e, end));
        const s = k ? secBy.get(k) : null;
        let sv = s?.val;
        if (flag === 'abs' && Number.isFinite(yv)) yv = Math.abs(yv);
        // per-share figures filed before a later split are not comparable
        const splitAfter = flag === 'perShare' && splits.some((x) => x.date * 1000 > Date.parse(end));
        const c = splitAfter ? { state: 'skipped', diff: null } : compare(yv, sv);
        rows.push({ key, label, end, yahoo: Number.isFinite(yv) ? yv : null, sec: Number.isFinite(sv) ? sv : null, tag: s?.tag || null, filed: s?.filed || null, state: c.state, diff: c.diff, note: splitAfter ? 'a share split happened after this year, so the filed per-share figure is not comparable' : null });
      }
    }
    const done = rows.filter((r) => r.state === 'agree' || r.state === 'close' || r.state === 'differs');
    const latest = ends[0];
    const lr = done.filter((r) => r.end === latest);
    if (!done.length) return { symbol, state: 'skipped', reason: secErr ? `The SEC could not be reached (${secErr.message}).` : `The SEC filing and Yahoo have no figure for the same year to compare.` };
    return {
      symbol, state: 'ok', cik: hit.cik, latest, rows,
      summary: { checked: lr.length, agree: lr.filter((r) => r.state === 'agree').length, close: lr.filter((r) => r.state === 'close').length, differs: lr.filter((r) => r.state === 'differs').length },
      limits: { agree: AGREE, doubt: DOUBT },
    };
  }
  return {
    verify(symbol) {
      const key = String(symbol).toUpperCase();
      const hit = memo.get(key);
      if (hit && Date.now() - hit.at < 6 * 3600e3) return hit.p;
      const p = run(key).catch((err) => { memo.delete(key); throw err; });
      memo.set(key, { at: Date.now(), p });
      return p;
    },
  };
}
