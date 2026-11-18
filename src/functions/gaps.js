// GAPS: how complete is the data for this stock, and why is each missing figure missing?
//
// Meridian takes each figure from the best source that has it (SEC, then Yahoo, then Finnhub, plus the price
// history and the quote feed for market statistics). What is still empty after that is listed here with the
// reason, so "n/a" is never a mystery. Some figures are legitimately empty (a company that pays no dividend has
// no dividend per share; a bank has no gross profit): those are counted apart and not held against coverage.

import { register } from '../registry.js';
import { esc, el } from '../fmt.js';
import { LABEL } from '../sources.js';

const fin = (v) => v != null && Number.isFinite(v);
const needsReal = (what) => (ctx) => {
  ctx.el.innerHTML = `<div class="empty">${esc(what)} needs real company data. Switch with <kbd>MODE LIVE</kbd> (Meridian has to be running from its icon).</div>`;
};

// reported figures every company has: a gap here is a real data gap
const CORE = ['revenue', 'netIncome', 'epsDil', 'sharesOut', 'sharesDil', 'assets', 'equity', 'cash', 'debt', 'ocf', 'capex', 'da', 'opIncome', 'grossProfit'];
// banks and insurers don't report these
const BANK_NA = new Set(['capex', 'da', 'debt', 'cash', 'opIncome', 'grossProfit', 'cogs']);
// figures that are often truly absent: no dividend, no buyback, no research, no acquisition
const OPTIONAL = ['dps', 'dividendsPaid', 'buybacks', 'sbc', 'rnd', 'acquisitions', 'debtRepaid'];

function group(title, items, note = '') {
  // items: { label, ok, how, why, optional }
  const need = items.filter((i) => !i.optional);
  const have = need.filter((i) => i.ok).length;
  const miss = items.filter((i) => !i.ok);
  const alt = items.filter((i) => i.ok && i.how).length;
  const pct = need.length ? Math.round((have / need.length) * 100) : 100;
  const rows = miss.map((i) => `<tr><td class="l">${esc(i.label)}</td><td class="l dim">${i.optional ? '<span class="dim">may be genuinely none</span> · ' : ''}${esc(i.why || 'not reported by any source')}</td></tr>`).join('');
  return `<div class="pane gaps-pane"><h3>${esc(title)} <span class="gaps-pct ${pct >= 95 ? 'up' : pct >= 75 ? '' : 'dn'}">${have}/${need.length} · ${pct}%</span></h3>
    <p class="note">${alt ? `${alt} filled from a second source. ` : ''}${miss.length ? `${miss.length} empty:` : 'Nothing missing.'}${note ? ` ${esc(note)}` : ''}</p>
    ${rows ? `<div class="tbl-wrap"><table class="tbl"><tbody>${rows}</tbody></table></div>` : ''}</div>`;
}

const STAT_LABELS = {
  marketCap: 'Market cap', ev: 'Enterprise value', trailingPE: 'P/E (trailing)', forwardPE: 'P/E (forward)', peg: 'PEG ratio', priceToSales: 'Price / sales', priceToBook: 'Price / book', evRevenue: 'EV / revenue', evEbitda: 'EV / EBITDA',
  grossMargin: 'Gross margin', operatingMargin: 'Operating margin', profitMargin: 'Profit margin', roe: 'Return on equity', roa: 'Return on assets', revenueGrowth: 'Revenue growth', earningsGrowth: 'Earnings growth', trailingEps: 'EPS (trailing)', forwardEps: 'EPS (forward)',
  totalCash: 'Total cash', totalDebt: 'Total debt', debtToEquity: 'Debt / equity', currentRatio: 'Current ratio', quickRatio: 'Quick ratio', ocf: 'Operating cash flow', fcf: 'Free cash flow', bookValue: 'Book value / share',
  shares: 'Shares outstanding', float: 'Float', sharesShort: 'Shares short', shortFloat: 'Short % of float', shortRatio: 'Days to cover', sharesShortPrior: 'Short interest a month ago', avgVolume: 'Avg volume (3 mo)', avgVolume10d: 'Avg volume (10 d)',
  beta: 'Beta', change52: '52-week change', high52: '52-week high', low52: '52-week low', ma50: '50-day average', ma200: '200-day average',
  dividendRate: 'Dividend / share', dividendYield: 'Dividend yield', avgYield5y: '5-yr avg yield', payoutRatio: 'Payout ratio', exDividend: 'Ex-dividend date', lastSplit: 'Last split', fiscalYearEnd: 'Fiscal year end', mostRecentQuarter: 'Latest quarter',
};
// statistics that are legitimately empty for many healthy companies
const STAT_OPTIONAL = new Set(['forwardPE', 'forwardEps', 'peg', 'dividendRate', 'dividendYield', 'avgYield5y', 'payoutRatio', 'exDividend', 'lastSplit', 'earningsGrowth', 'sharesShort', 'shortFloat', 'shortRatio', 'sharesShortPrior', 'float']);

register({
  code: 'GAPS', aliases: ['NACHECK', 'COVERAGE', 'DATAQ'], name: 'Data coverage (what is n/a and why)', cat: 'System', sec: true,
  help: '<ticker> GAPS — how complete the data is for this stock: which figures are empty, why, and which were filled from a second source',
  run: needsReal('Data coverage'),
  live(ctx) {
    const s = ctx.sec;
    if (s.cls !== 'EQ' || s.etf) {
      ctx.el.innerHTML = `<div class="empty">The coverage check is for company stocks (${esc(s.sym)} isn't one).</div>`;
      return;
    }
    const host = el('div', 'empty', 'Checking every data source for this stock (first time takes about 10 seconds)…');
    ctx.el.appendChild(host);
    let gone = false;
    Promise.allSettled([ctx.engine.details(s.sym), ctx.engine.annual(s.sym)]).then(([dr, ar]) => {
      if (gone) return;
      const d = dr.status === 'fulfilled' ? dr.value : null;
      const a = ar.status === 'fulfilled' ? ar.value : null;
      const parts = [];
      const fail = [];
      if (d) {
        const k = d.stats || {};
        const how = d.statsSrc || {};
        const why = d.statsWhy || {};
        parts.push(group('Key statistics (KEYS)', Object.keys(STAT_LABELS).map((f) => ({ label: STAT_LABELS[f], ok: fin(k[f]) || (typeof k[f] === 'string' && !!k[f]), how: how[f], why: why[f], optional: STAT_OPTIONAL.has(f) }))));
        const yWhy = d.partial ? "Yahoo's statistics page did not answer" : 'Yahoo has no data of this kind for this stock';
        const noData = `${yWhy}`;
        const premium = noData;
        const area = (label, n, why, optional = false, how = '') => ({ label, ok: n > 0, how: n > 0 ? how : '', why, optional });
        parts.push(group('Analysts, ownership and insiders', [
          area('Earnings history (EPS)', (d.earnings || []).length, noData, false, d.altSrc?.earnings || ''), area('Analyst estimates (EPS, REV)', (d.estimates || []).length, premium),
          area('Institutional holders (HOLD)', (d.institutions || []).length, premium), area('Fund holders (HOLD)', (d.funds || []).length, premium),
          area('Insider transactions (INSIDER)', (d.insiders || []).length, noData, true, d.altSrc?.insiders || ''),
        ], 'Everything here comes from Yahoo Finance.'));
      } else fail.push(`Key statistics: ${dr.reason?.message || 'failed'}`);
      if (a) {
        const bank = !!a.financial;
        const ys = (a.years || []).filter((y) => y.revenue != null || y.netIncome != null || y.ocf != null);
        const L = ys[ys.length - 1];
        if (L) {
          const core = CORE.filter((f) => !(bank && BANK_NA.has(f)));
          const item = (f, optional) => ({ label: LABEL[f] || f, ok: fin(L[f]), how: L.src?.[f]?.s && L.src[f].s !== 'SEC' ? L.src[f].s : '', why: L.na?.[f], optional });
          parts.push(group(`Reported figures, FY${L.fy} (FIN, ALLOC, valuation)`, [...core.map((f) => item(f, false)), ...OPTIONAL.map((f) => item(f, true))], bank ? 'Bank/insurer: gross profit, capex, debt and similar are not applicable and not counted.' : ''));
        }
        parts.push(group('History depth', [{ label: `${ys.length} fiscal year${ys.length === 1 ? '' : 's'} of figures`, ok: ys.length >= 5, why: 'fewer than 5 years found (young company, or the SEC list was incomplete)' }]));
        const N = a.now?.fields || {};
        const nowKeys = ['revenue', 'netIncome', 'epsDil', 'shares', 'equity', ...(bank ? [] : ['cash', 'debt', 'ocf', 'capex', 'ebitda', 'fcf', 'netDebt'])];
        parts.push(group('Latest 12 months (valuation multiples, P/E, EV/EBITDA)', nowKeys.map((f) => ({ label: LABEL[f] || f, ok: fin(N[f]?.val), how: N[f]?.src && N[f].src !== 'SEC' ? N[f].src : '', why: N[f]?.why }))));
      } else fail.push(`Reported figures: ${ar.reason?.message || 'failed'}`);

      host.remove();
      const html = `${d?.partial ? `<p class="note warn">${esc(d.partial)}.</p>` : ''}${fail.length ? `<p class="note warn">${fail.map(esc).join('<br>')}</p>` : ''}<div class="keys">${parts.join('')}</div>
        <p class="note">Coverage counts only figures every company of this kind should have; those marked "may be genuinely none" (dividends, buybacks, R&amp;D, acquisitions, forward estimates, short interest) are shown but not counted against it. Order of sources: SEC EDGAR, Yahoo, Finnhub (with a free key: <kbd>FINNHUB yourkey</kbd>), plus the price history and quote feed for market figures. This is a snapshot of what the sources answered right now. If a source was blocked or throttled, run it again later; when something you need stays empty, tell me which stock and function.</p>`;
      ctx.el.insertAdjacentHTML('beforeend', html);
    });
    return { destroy: () => { gone = true; } };
  },
});
