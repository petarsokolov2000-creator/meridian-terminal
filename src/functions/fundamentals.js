// Company financials on real data: full statements (FIN), earnings history and estimates
// (EPS), ownership and insider trades (HOLD), dividends and splits (DVD), key statistics
// (KEYS) and SEC filings (FILE). In the simulation these explain that they need real data
// (FIN keeps its simulated version there).

import { register, FUNCTIONS } from '../registry.js';
import { num, big, pct, signed, dir, esc, el } from '../fmt.js';
import { XYChart } from '../chart.js';
import { deferred, strip, kv } from './live-fns.js';

const needsReal = (what) => (ctx) => {
  ctx.el.innerHTML = `<div class="empty">${esc(what)} needs real company data. Switch with <kbd>MODE LIVE</kbd> (Meridian has to be running from its icon).</div>`;
};
const onlyStocks = (ctx, what) => {
  if (ctx.sec.cls === 'EQ' && !ctx.sec.etf) return false;
  ctx.el.innerHTML = `<div class="empty">${esc(what)} is only available for company stocks (${esc(ctx.sec.sym)} isn't one).</div>`;
  return true;
};
const date = (sec) => (sec ? new Date(sec * 1000).toISOString().slice(0, 10) : '—');
const pc = (x, dp = 1) => (x == null ? '—' : `${num(x * 100, dp)}%`);
const tabs = (opts, on) => opts.map(([k, label]) => `<button class="tb ${k === on ? 'on' : ''}" data-tab="${k}">${label}</button>`).join('');

// ---- FIN: income statement, balance sheet, cash flow --------------------------------------

const LINES = {
  income: [['TotalRevenue', 'Revenue'], ['CostOfRevenue', 'Cost of revenue'], ['GrossProfit', 'Gross profit'], ['ResearchAndDevelopment', 'R&D'], ['SellingGeneralAndAdministration', 'SG&A'],
    ['OperatingIncome', 'Operating income'], ['InterestExpense', 'Interest expense'], ['PretaxIncome', 'Pre-tax income'], ['TaxProvision', 'Tax'], ['NetIncome', 'Net income'],
    ['EBITDA', 'EBITDA'], ['DilutedEPS', 'Diluted EPS', 'eps'], ['DilutedAverageShares', 'Diluted shares', 'shares']],
  balance: [['CashAndCashEquivalents', 'Cash & equivalents'], ['CurrentAssets', 'Current assets'], ['TotalAssets', 'Total assets'], ['CurrentLiabilities', 'Current liabilities'],
    ['TotalDebt', 'Total debt'], ['NetDebt', 'Net debt'], ['TotalLiabilitiesNetMinorityInterest', 'Total liabilities'], ['StockholdersEquity', "Shareholders' equity"],
    ['RetainedEarnings', 'Retained earnings'], ['WorkingCapital', 'Working capital'], ['OrdinarySharesNumber', 'Shares outstanding', 'shares']],
  cashflow: [['OperatingCashFlow', 'Operating cash flow'], ['CapitalExpenditure', 'Capital expenditure'], ['FreeCashFlow', 'Free cash flow'], ['StockBasedCompensation', 'Stock-based comp.'],
    ['InvestingCashFlow', 'Investing cash flow'], ['RepurchaseOfCapitalStock', 'Share buybacks'], ['CashDividendsPaid', 'Dividends paid'], ['FinancingCashFlow', 'Financing cash flow']],
};
// Ratios computed from the statements, shown under the income statement.
const DERIVED = [
  ['Gross margin', (r, d) => r.GrossProfit?.[d] / r.TotalRevenue?.[d]],
  ['Operating margin', (r, d) => r.OperatingIncome?.[d] / r.TotalRevenue?.[d]],
  ['Net margin', (r, d) => r.NetIncome?.[d] / r.TotalRevenue?.[d]],
];

function finLive(ctx) {
  if (onlyStocks(ctx, 'Financial statements')) return;
  const s = ctx.sec;
  const E = ctx.engine;
  const st = { stmt: 'income', freq: 'annual' };
  const bar = el('div', 'toolbar');
  const body = el('div');
  ctx.el.append(bar, body);
  let gone = false;
  const drawBar = () => (bar.innerHTML = tabs([['income', 'INCOME'], ['balance', 'BALANCE SHEET'], ['cashflow', 'CASH FLOW']], st.stmt) + '<span class="sep"></span>' + tabs([['annual', 'ANNUAL'], ['quarterly', 'QUARTERLY']], st.freq));
  const draw = () => {
    body.innerHTML = '<div class="empty">Loading statements…</div>';
    E.statements(s.sym, st.freq).then((d) => {
      if (gone) return;
      const ps = d.periods;
      const label = (p) => (st.freq === 'annual' ? `FY${p.slice(0, 4)}` : `${p.slice(0, 7)}`);
      const fmt = (v, kind) => (v == null || !Number.isFinite(v) ? '<span class="dim">—</span>' : kind === 'eps' ? num(v, 2) : big(v));
      const growth = (row) => {
        const a = row?.[ps[ps.length - 2]];
        const b = row?.[ps[ps.length - 1]];
        return a && b != null ? b / Math.abs(a) - 1 + (a < 0 ? 2 : 0) : null;
      };
      const rows = LINES[st.stmt].filter(([k]) => d.rows[k]);
      body.innerHTML = rows.length ? `<div class="tbl-wrap"><table class="tbl fin"><thead><tr><th class="l">${esc(s.sym)} · ${st.freq === 'annual' ? 'fiscal years' : 'quarters'}</th>${ps.map((p) => `<th class="r">${label(p)}</th>`).join('')}<th class="r" title="Change from the previous ${st.freq === 'annual' ? 'year' : 'quarter'}">Δ last</th></tr></thead><tbody>
        ${rows.map(([k, name, kind]) => {
          const g = growth(d.rows[k]);
          const strong = ['TotalRevenue', 'GrossProfit', 'OperatingIncome', 'NetIncome', 'TotalAssets', 'StockholdersEquity', 'FreeCashFlow', 'OperatingCashFlow'].includes(k);
          return `<tr class="${strong ? 'strong' : ''}"><td class="l">${name}</td>${ps.map((p) => `<td class="r">${fmt(d.rows[k][p], kind)}</td>`).join('')}<td class="r ${g == null ? '' : dir(g)}">${g == null ? '' : pct(g, 1)}</td></tr>`;
        }).join('')}
        ${st.stmt === 'income' ? DERIVED.map(([name, f]) => `<tr class="ratio"><td class="l dim">${name}</td>${ps.map((p) => {
          const v = f(d.rows, p);
          return `<td class="r dim">${Number.isFinite(v) ? pc(v) : '—'}</td>`;
        }).join('')}<td></td></tr>`).join('') : ''}
        </tbody></table></div><p class="note">Source: Yahoo Finance (company filings). Δ last = change versus the previous ${st.freq === 'annual' ? 'fiscal year' : 'quarter'}. Use <kbd>${esc(s.sym)} FILE</kbd> for the original SEC reports.</p>`
        : '<div class="empty">Yahoo has none of these line items for this company.</div>';
    }).catch((err) => {
      if (!gone) body.innerHTML = `<div class="empty">Couldn't load statements: ${esc(err.message)}</div>`;
    });
  };
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    if (LINES[b.dataset.tab]) st.stmt = b.dataset.tab;
    else st.freq = b.dataset.tab;
    drawBar();
    draw();
  });
  drawBar();
  draw();
  return { destroy: () => (gone = true) };
}
FUNCTIONS.get('FIN').live = finLive;
FUNCTIONS.get('FIN').help = 'FIN — income statement, balance sheet and cash flow, annual and quarterly (real data)';

// ---- EPS: earnings history and estimates ----------------------------------------------------

register({
  code: 'EPS', aliases: ['EEB', 'ERNH'], name: 'Earnings history & estimates', cat: 'Equity', sec: true,
  run: needsReal('Earnings history'),
  live(ctx) {
    if (onlyStocks(ctx, 'Earnings history')) return;
    return deferred(ctx, ctx.engine.details(ctx.sec.sym), (d) => {
      const s = ctx.sec;
      const hist = [...d.earnings].sort((a, b) => a.quarter - b.quarter);
      const est = d.estimates.filter((t) => ['0q', '+1q', '0y', '+1y'].includes(t.period));
      const names = { '0q': 'This quarter', '+1q': 'Next quarter', '0y': 'This year', '+1y': 'Next year' };
      const beats = hist.filter((h) => h.actual != null && h.estimate != null && h.actual >= h.estimate).length;
      const top = el('div', 'split2');
      top.innerHTML = `<div class="pane"><h3>Reported vs expected EPS · beat ${beats} of ${hist.length}</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th class="l">Quarter</th><th class="r">Estimate</th><th class="r">Actual</th><th class="r">Surprise</th></tr></thead><tbody>
        ${hist.map((h) => `<tr><td class="l">${date(h.quarter).slice(0, 7)}</td><td class="r">${num(h.estimate, 2)}</td><td class="r">${num(h.actual, 2)}</td><td class="r ${dir(h.surprise)}">${h.surprise == null ? '—' : pct(h.surprise, 1)}</td></tr>`).join('')}
        </tbody></table></div><div class="chart-host short eps-chart"></div></div>
        <div class="pane"><h3>Analyst estimates</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th class="l">Period</th><th class="r">EPS est.</th><th class="r">Range</th><th class="r">Year ago</th><th class="r">Growth</th><th class="r">Revenue est.</th><th class="r">Analysts</th></tr></thead><tbody>
        ${est.map((t) => `<tr><td class="l">${names[t.period]}${t.end ? ` <span class="dim">${esc(t.end)}</span>` : ''}</td><td class="r">${num(t.eps.avg, 2)}</td><td class="r dim">${num(t.eps.low, 2)}–${num(t.eps.high, 2)}</td><td class="r dim">${num(t.eps.yearAgo, 2)}</td><td class="r ${dir(t.growth)}">${t.growth == null ? '—' : pct(t.growth, 1)}</td><td class="r">${big(t.revenue.avg)}</td><td class="r dim">${num(t.eps.analysts, 0)}</td></tr>`).join('')}
        </tbody></table></div>${s.earnings?.date ? `<p class="note">Next report: <b>${esc(s.earnings.date)}</b> ${esc(s.earnings.when || '')}</p>` : ''}<p class="note">Source: Yahoo Finance.</p></div>`;
      ctx.el.appendChild(top);
      let chart = null;
      if (hist.length) {
        chart = new XYChart(top.querySelector('.eps-chart'));
        chart.setData({
          series: [
            { name: 'Estimate', line: true, dash: [4, 3], points: hist.map((h, i) => ({ x: i, y: h.estimate, label: date(h.quarter).slice(0, 7) })).filter((p) => p.y != null) },
            { name: 'Actual', line: true, points: hist.map((h, i) => ({ x: i, y: h.actual, label: date(h.quarter).slice(0, 7), color: h.actual >= h.estimate ? 'var(--up)' : 'var(--down)' })).filter((p) => p.y != null) },
          ],
          xCat: hist.map((h, i) => [i, date(h.quarter).slice(2, 7)]), yFmt: (v) => v.toFixed(2), xFmt: () => '', yLabel: 'EPS',
        });
      }
      return { destroy: () => chart?.destroy() };
    });
  },
});

// ---- HOLD: who owns it ---------------------------------------------------------------------

register({
  code: 'HOLD', aliases: ['HDS', 'OWN', 'INSD'], name: 'Ownership & insider trades', cat: 'Equity', sec: true,
  run: needsReal('Ownership data'),
  live(ctx) {
    if (onlyStocks(ctx, 'Ownership data')) return;
    return deferred(ctx, ctx.engine.details(ctx.sec.sym), (d) => {
      const o = d.ownership;
      const holders = (list) => (list.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th class="l">Holder</th><th class="r">% held</th><th class="r">Shares</th><th class="r">Value</th><th class="r">As of</th></tr></thead><tbody>
        ${list.map((h) => `<tr><td class="l name" title="${esc(h.name)}">${esc(h.name)}</td><td class="r">${pc(h.pct, 2)}</td><td class="r">${big(h.shares)}</td><td class="r">${big(h.value)}</td><td class="r dim">${date(h.date)}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="note">None reported.</p>');
      ctx.el.innerHTML = `<div class="port-head">${[['Insiders', pc(o.insiders)], ['Institutions', pc(o.institutions)], ['Institutions (of float)', pc(o.institutionsFloat)], ['Institutional holders', num(o.institutionCount, 0)]].map(([k, v]) => `<div><span class="dim">${k}</span><b>${v}</b></div>`).join('')}</div>
        <div class="split2"><div class="pane"><h3>Top institutions</h3>${holders(d.institutions)}</div><div class="pane"><h3>Top funds</h3>${holders(d.funds)}</div></div>
        <div class="pane"><h3>Insider transactions</h3>${d.insiders.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th class="l">Date</th><th class="l">Insider</th><th class="l">Role</th><th class="l">Transaction</th><th class="r">Shares</th><th class="r">Value</th></tr></thead><tbody>
        ${d.insiders.map((t) => {
          const kind = /sale|sold/i.test(t.text || '') ? 'down' : /purchase|buy|bought/i.test(t.text || '') ? 'up' : '';
          return `<tr><td class="l dim">${date(t.date)}</td><td class="l">${esc(t.name)}</td><td class="l dim">${esc(t.relation || '')}</td><td class="l ${kind}">${esc(t.text || 'Award / exercise')}</td><td class="r">${big(t.shares)}</td><td class="r">${t.value ? big(t.value) : '—'}</td></tr>`;
        }).join('')}</tbody></table></div>` : '<p class="note">No insider transactions reported.</p>'}
        <p class="note">Source: Yahoo Finance (from SEC Forms 3/4/5 and 13F). Holdings are reported quarterly, so "As of" dates lag. Original insider forms: <kbd>${esc(ctx.sec.sym)} FILE</kbd>.</p></div>`;
    });
  },
});

// ---- DVD: dividends and splits -------------------------------------------------------------

register({
  code: 'DVD', aliases: ['DIV', 'DVDS'], name: 'Dividends & splits', cat: 'Equity', sec: true,
  run: needsReal('Dividend history'),
  live(ctx) {
    const s = ctx.sec;
    if (s.cls !== 'EQ') {
      ctx.el.innerHTML = `<div class="empty">Dividends and splits apply to stocks and funds (${esc(s.sym)} isn't one).</div>`;
      return;
    }
    return deferred(ctx, ctx.engine.events(s.sym), (d) => {
      const divs = d.dividends;
      const byYear = new Map();
      for (const x of divs) {
        const y = new Date(x.date * 1000).getUTCFullYear();
        byYear.set(y, (byYear.get(y) || 0) + x.amount);
      }
      const years = [...byYear.keys()].sort((a, b) => a - b);
      const thisYear = new Date().getUTCFullYear();
      const full = years.filter((y) => y < thisYear);
      const last12 = divs.filter((x) => Date.now() / 1000 - x.date < 365 * 86400).reduce((a, x) => a + x.amount, 0);
      const cagr = (n) => {
        const a = byYear.get(full[full.length - 1 - n]);
        const b = byYear.get(full[full.length - 1]);
        return a && b && full.length > n ? (b / a) ** (1 / n) - 1 : null;
      };
      const head = el('div', 'port-head', [['Last 12 months', divs.length ? num(last12, 3) : '—'], ['Trailing yield', last12 && s.last ? pc(last12 / s.last, 2) : '—'], ['Payments on record', String(divs.length)], ['Paying since', years.length ? String(years[0]) : '—'], ['5-year growth (per yr)', cagr(5) == null ? '—' : pct(cagr(5), 1)], ['Last split', d.splits[0] ? `${esc(d.splits[0].ratio)} · ${date(d.splits[0].date)}` : 'none']]
        .map(([k, v]) => `<div><span class="dim">${k}</span><b>${v}</b></div>`).join(''));
      ctx.el.appendChild(head);
      if (!divs.length && !d.splits.length) {
        ctx.el.appendChild(el('div', 'empty', `${esc(s.sym)} has paid no dividends and had no splits on record.`));
        return;
      }
      const split = el('div', 'split2');
      split.innerHTML = `<div class="pane"><h3>Dividends paid per year (${esc(d.currency || '')})</h3><div class="chart-host short dvd-chart"></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th class="l">Ex-date</th><th class="r">Amount</th><th class="r">Change</th></tr></thead><tbody>
        ${divs.slice(0, 40).map((x, i) => {
          const prev = divs[i + 1]?.amount;
          return `<tr><td class="l">${date(x.date)}</td><td class="r">${num(x.amount, 4)}</td><td class="r ${prev ? dir(x.amount - prev) : ''}">${prev ? pct(x.amount / prev - 1, 1) : ''}</td></tr>`;
        }).join('')}</tbody></table></div></div>
        <div class="pane"><h3>Stock splits</h3>${d.splits.length ? `<table class="tbl"><thead><tr><th class="l">Date</th><th class="r">Ratio</th></tr></thead><tbody>${d.splits.map((x) => `<tr><td class="l">${date(x.date)}</td><td class="r">${esc(x.ratio)}</td></tr>`).join('')}</tbody></table>` : '<p class="note">No splits on record.</p>'}
        <p class="note">Source: Yahoo Finance. Amounts are per share as paid (not adjusted for later splits). The current year is partial.</p></div>`;
      ctx.el.appendChild(split);
      let chart = null;
      if (years.length > 1) {
        chart = new XYChart(split.querySelector('.dvd-chart'));
        chart.setData({ series: [{ name: 'Per share per year', line: true, points: years.map((y) => ({ x: y, y: byYear.get(y), label: String(y), color: y === thisYear ? 'var(--dim)' : undefined })) }], xFmt: (v) => String(Math.round(v)), yFmt: (v) => v.toFixed(2), yLabel: 'Dividends' });
      }
      return { destroy: () => chart?.destroy() };
    });
  },
});

// ---- KEYS: key statistics ------------------------------------------------------------------

register({
  code: 'KEYS', aliases: ['KS', 'STATS', 'RATIO'], name: 'Key statistics', cat: 'Equity', sec: true,
  run: needsReal('Key statistics'),
  live(ctx) {
    if (onlyStocks(ctx, 'Key statistics')) return;
    const s = ctx.sec;
    const head = strip(ctx);
    const host = el('div');
    ctx.el.appendChild(host);
    ctx.engine.details(s.sym).then((d) => {
      const k = d.stats;
      const vsMa = (ma) => (ma && s.last ? pct(s.last / ma - 1, 1) : '—');
      const shortChg = k.sharesShort && k.sharesShortPrior ? pct(k.sharesShort / k.sharesShortPrior - 1, 1) : '—';
      const groups = [
        ['Valuation', [['Market cap', big(k.marketCap)], ['Enterprise value', big(k.ev)], ['P/E (trailing)', num(k.trailingPE, 1)], ['P/E (forward)', num(k.forwardPE, 1)], ['PEG ratio', num(k.peg, 2)], ['Price / sales', num(k.priceToSales, 2)], ['Price / book', num(k.priceToBook, 2)], ['EV / revenue', num(k.evRevenue, 2)], ['EV / EBITDA', num(k.evEbitda, 1)]]],
        ['Profitability & growth', [['Gross margin', pc(k.grossMargin)], ['Operating margin', pc(k.operatingMargin)], ['Profit margin', pc(k.profitMargin)], ['Return on equity', pc(k.roe)], ['Return on assets', pc(k.roa)], ['Revenue growth (yoy)', pc(k.revenueGrowth)], ['Earnings growth (yoy)', pc(k.earningsGrowth)], ['EPS (trailing)', num(k.trailingEps, 2)], ['EPS (forward)', num(k.forwardEps, 2)]]],
        ['Balance sheet & cash', [['Total cash', big(k.totalCash)], ['Total debt', big(k.totalDebt)], ['Debt / equity', num(k.debtToEquity, 0)], ['Current ratio', num(k.currentRatio, 2)], ['Quick ratio', num(k.quickRatio, 2)], ['Operating cash flow', big(k.ocf)], ['Free cash flow', big(k.fcf)], ['Book value / share', num(k.bookValue, 2)]]],
        ['Shares & short interest', [['Shares outstanding', big(k.shares)], ['Float', big(k.float)], ['Shares short', big(k.sharesShort)], ['Short % of float', pc(k.shortFloat, 2)], ['Days to cover', num(k.shortRatio, 1)], ['Short change (1 mo)', shortChg], ['Avg volume (3 mo)', big(k.avgVolume)], ['Avg volume (10 d)', big(k.avgVolume10d)]]],
        ['Price & trend', [['Beta', num(k.beta, 2)], ['52-week change', pc(k.change52)], ['52-week range', `${num(k.low52, 2)} – ${num(k.high52, 2)}`], ['50-day average', `${num(k.ma50, 2)} (${vsMa(k.ma50)})`], ['200-day average', `${num(k.ma200, 2)} (${vsMa(k.ma200)})`]]],
        ['Dividends & dates', [['Dividend / share', num(k.dividendRate, 2)], ['Dividend yield', pc(k.dividendYield, 2)], ['5-yr avg yield', k.avgYield5y == null ? '—' : `${num(k.avgYield5y, 2)}%`], ['Payout ratio', pc(k.payoutRatio)], ['Ex-dividend date', date(k.exDividend)], ['Last split', k.lastSplit ? `${esc(k.lastSplit)} (${date(k.lastSplitDate)})` : '—'], ['Fiscal year end', date(k.fiscalYearEnd)], ['Latest quarter', date(k.mostRecentQuarter)]]],
      ];
      host.innerHTML = `<div class="keys">${groups.map(([title, rows]) => `<div class="pane"><h3>${title}</h3><div class="facts">${rows.map(([a, b]) => kv(a, b)).join('')}</div></div>`).join('')}</div><p class="note">Source: Yahoo Finance. Short interest is reported twice a month.</p>`;
    }).catch((err) => (host.innerHTML = `<div class="empty">Couldn't load statistics: ${esc(err.message)}</div>`));
    host.innerHTML = '<div class="empty">Loading…</div>';
    return { update: head };
  },
});

// ---- FILE: SEC filings ---------------------------------------------------------------------

const FORM_GROUPS = [
  ['ALL', 'ALL', () => true],
  ['REPORTS', '10-K / 10-Q', (f) => /^(10-K|10-Q|20-F|40-F|6-K)/.test(f)],
  ['8-K', 'CURRENT (8-K)', (f) => /^8-K/.test(f)],
  ['INSIDER', 'INSIDER (3/4/5)', (f) => /^[345]$|^[345]\/A$/.test(f)],
  ['PROXY', 'PROXY', (f) => /^(DEF 14A|DEFA14A|PRE 14A)/.test(f)],
  ['OWNERS', '13D / 13G', (f) => /^(SC 13|SCHEDULE 13)/.test(f)],
];
const FORM_INFO = { '10-K': 'Annual report', '10-Q': 'Quarterly report', '8-K': 'Current report (material event)', 4: 'Insider trade', 3: 'Initial insider ownership', 5: 'Annual insider statement', 'DEF 14A': 'Proxy statement', '20-F': 'Annual report (foreign issuer)', '6-K': 'Report (foreign issuer)', 'S-1': 'Registration (IPO)', 144: 'Planned insider sale' };

register({
  code: 'FILE', aliases: ['CF', 'SEC', 'FILINGS'], name: 'SEC filings', cat: 'News', sec: true,
  run: needsReal('SEC filings'),
  live(ctx) {
    if (ctx.sec.cls !== 'EQ') {
      ctx.el.innerHTML = `<div class="empty">SEC filings exist for company stocks and funds (${esc(ctx.sec.sym)} isn't one).</div>`;
      return;
    }
    return deferred(ctx, ctx.engine.filings(ctx.sec.sym), (d) => {
      let group = 'ALL';
      const bar = el('div', 'toolbar');
      const list = el('div');
      ctx.el.append(bar, list);
      const draw = () => {
        bar.innerHTML = tabs(FORM_GROUPS.map(([k, l]) => [k, l]), group) + `<span class="sep"></span><a class="chip" href="${esc(d.edgar)}" target="_blank" rel="noopener noreferrer">All on EDGAR ↗</a>`;
        const test = FORM_GROUPS.find(([k]) => k === group)[2];
        const rows = d.filings.filter((f) => test(f.form || '')).slice(0, 80);
        list.innerHTML = rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th class="l">Filed</th><th class="l">Form</th><th class="l">What it is</th><th class="l">Period</th><th class="l"></th></tr></thead><tbody>
          ${rows.map((f) => `<tr><td class="l">${esc(f.date)}</td><td class="l"><b>${esc(f.form)}</b></td><td class="l dim">${esc(FORM_INFO[f.form] || f.description || '')}</td><td class="l dim">${esc(f.reportDate || '')}</td><td class="l"><a class="doc" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">Open ↗</a></td></tr>`).join('')}
          </tbody></table></div>` : '<div class="empty">No filings of this kind in the recent list.</div>';
        list.insertAdjacentHTML('beforeend', `<p class="note">${esc(d.company)} · SEC CIK ${d.cik} · source: SEC EDGAR (official). Documents open in your browser.</p>`);
      };
      bar.addEventListener('click', (e) => {
        const b = e.target.closest('[data-tab]');
        if (!b) return;
        group = b.dataset.tab;
        draw();
      });
      draw();
    }, 'the SEC');
  },
});
