// QUAL: how good is the business? Returns on capital vs their cost, margins over ten years,
// debt load, cash conversion and growth. CAP: what management does with the cash: buybacks or
// dilution, payouts vs free cash flow, stock-based pay.
//
// Data: SEC EDGAR 10-K figures first, then Yahoo and Finnhub for gaps (each fallback cell is
// marked, see src/sources.js) via /api/annual; beta and the 10-year Treasury from Yahoo. Nothing
// is estimated: a ratio whose inputs weren't reported is n/a with the reason, and each formula
// is shown with the latest year's inputs. Banks and insurers
// get ROE, ROTCE, ROA and the efficiency ratio instead of ROIC, EBITDA and interest coverage.

import { register } from '../registry.js';
import { num, big, esc, el, dir } from '../fmt.js';
import { XYChart } from '../chart.js';
import { help } from '../glossary.js';
import { mark, why, na, srcNote, statusLine } from '../sources.js';

const NA = '<span class="dim">n/a</span>';
const fin = (v) => v != null && Number.isFinite(v);
const P = (v, dp = 1) => (fin(v) ? `${num(v * 100, dp)}%` : NA);
const X = (v, dp = 1) => (fin(v) ? `${num(v, dp)}×` : NA);
const B = (v) => (fin(v) ? big(v) : NA);
const N2 = (v) => (fin(v) ? num(v, 2) : NA);
const div = (a, b, { pos = true } = {}) => (fin(a) && fin(b) && b !== 0 && (!pos || b > 0) ? a / b : null);
const avg = (a, b) => (fin(a) && fin(b) ? (a + b) / 2 : fin(a) ? a : null);
const needsReal = (what) => (ctx) => {
  ctx.el.innerHTML = `<div class="empty">${esc(what)} needs real company data. Switch with <kbd>MODE LIVE</kbd> (Meridian has to be running from its icon).</div>`;
};

/** Compound annual growth from n years before the last year to the last year; null if either end isn't positive. */
export function cagr(years, key, n) {
  const ys = years.filter((y) => fin(y[key]));
  if (ys.length < 2) return { v: null, why: 'not reported' };
  const last = ys[ys.length - 1];
  const first = years.find((y) => y.fy === last.fy - n);
  if (!first || !fin(first[key])) {
    const reason = first?._y?.na?.[key] || first?.na?.[key];
    return { v: null, why: reason ? `FY${last.fy - n}: ${reason}` : `needs FY${last.fy - n} (${n + 1} fiscal years)` };
  }
  if (first[key] <= 0 || last[key] <= 0) return { v: null, why: 'negative or zero at one end' };
  return { v: (last[key] / first[key]) ** (1 / n) - 1, from: first.fy, to: last.fy, a: first[key], b: last[key] };
}

// The reported figures behind each per-year metric: [this year's, the prior year's (averages)].
const AVG3 = ['debt', 'equity', 'cashAll'];
export const Q_INPUTS = {
  grossMargin: [['grossProfit', 'revenue']], opMargin: [['ebit', 'revenue']], netMargin: [['netIncome', 'revenue']], fcfMargin: [['fcf', 'revenue']],
  taxRate: [['tax', 'pretax']], ic: [AVG3], icAvg: [AVG3, AVG3], nopat: [['ebit', 'tax', 'pretax']], roic: [['ebit', 'tax', 'pretax', ...AVG3], AVG3],
  coverage: [['ebit', 'interest']], netDebtEbitda: [['netDebt', 'ebitda']], fcfToNi: [['fcf', 'netIncome']], revenue: [['revenue']], epsDil: [['epsDil']], fcf: [['fcf']],
};
export const Q_INPUTS_FIN = {
  roe: [['netIncome', 'commonEquity'], ['commonEquity']], rotce: [['netIncome', 'tangibleEquity'], ['tangibleEquity']], roa: [['netIncome', 'assets'], ['assets']],
  efficiency: [['nonInterestExpense', 'revenue']], equityToAssets: [['commonEquity', 'assets']], netMargin: [['netIncome', 'revenue']], bvps: [['commonEquity', 'shares']], epsDil: [['epsDil']], revenue: [['revenue']],
};
export const capInputs = (financial) => {
  const base = financial ? 'netIncome' : 'fcf';
  return {
    shares: [['shares']], shareChg: [['shares'], ['shares']], buybacks: [['buybacks']], dividends: [['dividendsPaid']], returnedPct: [['buybacks', 'dividendsPaid', base]],
    buybackPct: [['buybacks', base]], dividendPct: [['dividendsPaid', base]], sbc: [['sbc']], sbcRevenue: [['sbc', 'revenue']], sbcFcf: [['sbc', 'fcf']], fcfLessSbc: [['fcf', 'sbc']],
  };
};
// why a metric is n/a when every input was reported
const NULL_WHY = {
  taxRate: (r) => (r._y?.tax != null && r._y?.pretax != null ? 'the effective tax rate is outside 0–60% (one-off items), so it isn’t used' : null),
  roic: (r) => (r.taxRate == null && r._y?.tax != null && r._y?.pretax != null ? 'the effective tax rate is outside 0–60%, so ROIC isn’t computed' : null),
  nopat: (r) => NULL_WHY.roic(r),
  shareChg: (r) => (!r._p ? 'no prior fiscal year in the data' : r.shares != null ? 'the share count switches between year-end and diluted-average counts here, so the change isn’t comparable' : null),
};

/** A per-year cell: the value with its source marker, or n/a with the reason. */
export function qCell(r, key, text, spec) {
  const v = r[key];
  const sp = spec?.[key];
  if (!sp || !r._y) return text;
  if (v == null || !Number.isFinite(v)) return na(why(r._y, sp[0]) || NULL_WHY[key]?.(r));
  return `${text}${mark(r._y, sp[0], r._p, sp[1] || [])}`;
}

/** Per-year quality metrics (operating companies or banks). */
export function qualityRows(years, financial) {
  return years.map((y, k) => {
    const p = years[k - 1];
    const r = { fy: y.fy, _y: y, _p: p || null };
    if (financial) {
      const common = fin(y.netIncome) ? y.netIncome - (y.prefDividends ?? 0) : null;
      r.niCommon = common;
      r.ceAvg = p ? avg(y.commonEquity, p.commonEquity) : y.commonEquity;
      r.roe = div(common, r.ceAvg);
      r.rotce = div(common, p ? avg(y.tangibleEquity, p.tangibleEquity) : y.tangibleEquity);
      r.roa = div(y.netIncome, p ? avg(y.assets, p.assets) : y.assets);
      r.efficiency = div(y.nonInterestExpense, y.revenue);
      r.equityToAssets = div(y.commonEquity, y.assets);
      r.netMargin = div(y.netIncome, y.revenue);
      r.bvps = div(y.commonEquity, y.sharesOut ?? y.sharesDil);
      r.epsDil = y.epsDil;
      r.revenue = y.revenue;
      r.avgNote = p ? 'average of the start and end of the year' : 'end of year (no prior year)';
      return r;
    }
    r.grossMargin = div(y.grossProfit, y.revenue);
    r.opMargin = div(y.ebit, y.revenue);
    r.netMargin = div(y.netIncome, y.revenue);
    r.fcfMargin = div(y.fcf, y.revenue);
    const rate = div(y.tax, y.pretax);
    r.taxRate = fin(rate) && rate >= 0 && rate <= 0.6 ? rate : null;
    const ic = (z) => (z && fin(z.debt) && fin(z.equity) && fin(z.cashAll) ? z.debt + z.equity - z.cashAll : null);
    r.ic = ic(y);
    r.icAvg = p && fin(ic(p)) && fin(r.ic) ? (ic(p) + r.ic) / 2 : r.ic;
    r.icNote = p && fin(ic(p)) ? 'average of the start and end of the year' : 'end of year';
    r.nopat = fin(y.ebit) && fin(r.taxRate) ? y.ebit * (1 - r.taxRate) : null;
    r.roic = div(r.nopat, r.icAvg);
    r.coverage = div(y.ebit, y.interest);
    r.netDebtEbitda = fin(y.netDebt) && fin(y.ebitda) && y.ebitda > 0 ? y.netDebt / y.ebitda : null;
    r.fcfToNi = div(y.fcf, y.netIncome);
    r.revenue = y.revenue;
    r.epsDil = y.epsDil;
    r.fcf = y.fcf;
    return r;
  });
}

/** Weighted average cost of capital for the latest year, with every input. */
export function wacc(years, { price, beta, rf, erp = 0.05 }) {
  const y = years[years.length - 1];
  const shares = y.sharesOut ?? y.sharesDil;
  const E = fin(price) && fin(shares) ? price * shares : null;
  const D = y.debt;
  const re = fin(beta) && fin(rf) ? rf + beta * erp : null;
  // cost of debt: interest ÷ average debt, from the latest year that reported interest
  let rd = null;
  let rdYear = null;
  for (let k = years.length - 1; k >= 0 && rd == null; k--) {
    const z = years[k];
    const zp = years[k - 1];
    const d = zp ? avg(z.debt, zp.debt) : z.debt;
    if (fin(z.interest) && z.interest > 0 && fin(d) && d > 0) {
      rd = z.interest / d;
      rdYear = z.fy;
    }
  }
  const rates = qualityRows(years, false);
  const t = rates[rates.length - 1].taxRate ?? rates.slice().reverse().find((r) => fin(r.taxRate))?.taxRate ?? null;
  const out = { E, D, re, rd, rdYear, t, beta, rf, erp };
  if (!fin(E) || !fin(re)) return { ...out, v: null, why: !fin(re) ? 'needs beta and the 10-year Treasury yield' : 'needs the share count' };
  if (!fin(D) || D === 0) return { ...out, v: re, why: 'no debt: cost of capital = cost of equity' };
  if (!fin(rd) || !fin(t)) return { ...out, v: null, why: !fin(rd) ? 'no interest expense reported' : 'no usable tax rate' };
  return { ...out, v: (E / (E + D)) * re + (D / (E + D)) * rd * (1 - t) };
}

/** Per-year capital allocation. */
export function capitalRows(years, financial) {
  return years.map((y, k) => {
    const p = years[k - 1];
    const sh = y.sharesOut ?? y.sharesDil;
    const psh = p ? p.sharesOut ?? p.sharesDil : null;
    const base = financial ? y.netIncome : y.fcf;
    const returned = fin(y.buybacks) || fin(y.dividendsPaid) ? (y.buybacks ?? 0) + (y.dividendsPaid ?? 0) : null;
    return {
      _y: y, _p: p || null,
      fy: y.fy, shares: sh, sharesBasis: y.sharesOut != null ? 'outstanding' : 'diluted average', sharesDil: y.sharesDil,
      shareChg: fin(sh) && fin(psh) && psh > 0 && (y.sharesOut != null) === (p.sharesOut != null) ? sh / psh - 1 : null,
      buybacks: y.buybacks, dividends: y.dividendsPaid, returned, base,
      buybackPct: div(y.buybacks, base), dividendPct: div(y.dividendsPaid, base), returnedPct: div(returned, base),
      sbc: y.sbc, sbcRevenue: div(y.sbc, y.revenue), sbcFcf: financial ? null : div(y.sbc, y.fcf), fcfLessSbc: !financial && fin(y.fcf) && fin(y.sbc) ? y.fcf - y.sbc : null,
    };
  });
}

// ---- shared view: summary cards, a years × metrics table, a chart, formulas -----------------

// which "?" belongs to each row and summary card
const ROW_HELP = { icAvg: 'investedCapital', epsDil: 'eps', shares: 'shareCount', shareChg: 'shareCount', dividends: 'payout', buybackPct: 'returnedPct', dividendPct: 'returnedPct', sbcFcf: 'sbc' };
const CARD_HELP = [[/^ROIC −/, 'wacc'], [/^ROIC/, 'roic'], [/WACC|Cost of capital/, 'wacc'], [/^ROE −|Cost of equity/, 'costOfEquity'], [/^ROE/, 'roe'], [/ROTCE/, 'rotce'], [/Efficiency/, 'efficiency'], [/Interest coverage/, 'coverage'], [/Net debt/, 'netDebtEbitda'], [/FCF \/ net/, 'fcfToNi'], [/growth/i, 'cagr'], [/Share count/, 'shareCount'], [/Returned/, 'returnedPct'], [/FCF after/, 'fcfLessSbc'], [/Stock-based/, 'sbcRevenue']];
const cardHelp = (label) => CARD_HELP.find(([re]) => re.test(label))?.[1] || null;

function view(ctx, { title, cards, rows, years, formulas, notes, spec }) {
  const head = el('div', 'port-head');
  head.innerHTML = cards.map(([a, b, tip]) => `<div${tip ? ` title="${esc(tip)}"` : ''}><span class="dim">${a}${help(cardHelp(a))}</span><b>${b}</b></div>`).join('');
  const table = el('div', 'tbl-wrap');
  const host = el('div', 'chart-host short val-chart');
  const f = el('div', 'val-formulas');
  const note = el('p', 'note', notes);
  ctx.el.append(head, table, host, f, note);
  const chart = new XYChart(host);
  const shown = years.slice(-10);
  let sel = rows.find((r) => !r.section)?.key;
  const draw = () => {
    table.innerHTML = `<table class="tbl q-tbl"><thead><tr><th class="l">${esc(title)}</th>${shown.map((y) => `<th class="r">FY${y.fy}</th>`).join('')}</tr></thead><tbody>
      ${rows.map((r) => (r.section ? `<tr class="q-sec"><td class="l" colspan="${shown.length + 1}">${esc(r.section)}</td></tr>` : `<tr data-k="${r.key}" class="${r.key === sel ? 'self' : ''}" style="cursor:pointer" title="${esc(r.formula)}"><td class="l">${esc(r.label)}${help(ROW_HELP[r.key] || r.key)}</td>${shown.map((y) => `<td class="r ${r.cls ? r.cls(y[r.key]) : ''}">${qCell(y, r.key, r.fmt(y[r.key]), spec)}</td>`).join('')}</tr>`)).join('')}
      </tbody></table>`;
    const r = rows.find((z) => z.key === sel);
    const scale = r.fmt === P ? 100 : 1;
    const pts = shown.filter((y) => fin(y[sel])).map((y) => ({ x: y.fy, y: y[sel] * scale, label: `FY${y.fy}` }));
    chart.setData(pts.length ? { series: [{ name: r.label, line: true, points: pts }], xFmt: (v) => (Math.abs(v - Math.round(v)) < 0.05 ? `FY${Math.round(v)}` : ''), yFmt: (v) => (r.fmt === P ? `${v.toFixed(1)}%` : r.fmt === B ? big(v) : v.toFixed(2)), yLabel: r.label, zeroLine: true } : { series: [] });
  };
  table.addEventListener('click', (e) => {
    const tr = e.target.closest('[data-k]');
    if (!tr) return;
    sel = tr.dataset.k;
    draw();
  });
  f.innerHTML = `<h3>Formulas, with the latest year's inputs</h3><table class="tbl small"><tbody>${formulas.map(([k, a, b]) => `<tr><td class="l"><b>${esc(k)}</b></td><td class="l val-formula">${esc(a)}${b ? `<br><span class="dim">${b}</span>` : ''}</td></tr>`).join('')}</tbody></table>`;
  draw();
  return chart;
}

export const cagrCell = (c, key, src) => {
  if (!fin(c.v)) return /sources disagree/.test(c.why) ? na(c.why) : `${NA} <span class="dim small">${esc(c.why)}</span>`;
  const at = (fy) => {
    const z = src?.find((r) => r.fy === fy);
    return z?._y || z;
  };
  const fields = key === 'bvps' ? ['commonEquity', 'shares'] : [key];
  return `${P(c.v)}${src ? mark(at(c.to), fields, at(c.from), fields, 'start of the period') : ''} <span class="dim small">FY${c.from}–${c.to}</span>`;
};
const sourceNote = (a, extra = '') => `${statusLine(a.status)}<br>Sources: ${esc(a.source)}, latest filing ${esc(a.asOf)}${extra}. Per-share figures and share counts are adjusted for stock splits. "Average" capital uses the start and end of each fiscal year. Tap an n/a for the reason (an input no source reported, a source that failed, or a negative number where a ratio needs a positive one).`;

function load(ctx, what, render) {
  const s = ctx.sec;
  if (s.cls !== 'EQ' || s.etf) {
    ctx.el.innerHTML = `<div class="empty">${esc(what)} is only for company stocks (${esc(s.sym)} isn't one).</div>`;
    return;
  }
  const wait = el('div', 'empty', 'Loading 10-K history from the SEC (first time takes about 10 seconds)…');
  ctx.el.appendChild(wait);
  let gone = false;
  let chart = null;
  Promise.all([ctx.engine.annual(s.sym), ctx.engine.details(s.sym).catch(() => null)]).then(([a, det]) => {
    if (gone) return;
    wait.remove();
    if (a.years.length < 2) {
      ctx.el.appendChild(el('div', 'empty', 'Fewer than two fiscal years of figures: nothing to compare.'));
      return;
    }
    chart = render(a, det);
  }).catch((err) => {
    if (!gone) wait.textContent = `Couldn't load the 10-K figures: ${err.message}`;
  });
  return { destroy: () => { gone = true; chart?.destroy(); } };
}

// ---- QUAL -----------------------------------------------------------------------------------

register({
  code: 'QUAL', aliases: ['QUALITY', 'ROIC', 'MOAT'], name: 'Business quality', cat: 'Equity', sec: true,
  help: '<ticker> QUAL — ROIC vs cost of capital, 10-year margins, interest coverage, net debt/EBITDA, FCF/net income, 5y/10y growth',
  run: needsReal('Business quality'),
  live(ctx) {
    const s = ctx.sec;
    const E = ctx.engine;
    return load(ctx, 'Business quality', (a, det) => {
      const years = a.years;
      const financial = a.financial ?? false;
      const q = qualityRows(years, financial);
      const last = q[q.length - 1];
      const y = years[years.length - 1];
      const tsy = E.get('US10Y');
      const rf = tsy?.last != null ? tsy.last / 100 : null;
      const beta = det?.stats?.beta ?? null;
      const growth = (key, label, src = years) => [label, `5y ${cagrCell(cagr(src, key, 5), key, src)}<br>10y ${cagrCell(cagr(src, key, 10), key, src)}`];
      if (financial) {
        const re = fin(beta) && fin(rf) ? rf + beta * 0.05 : null;
        const spread = fin(last.roe) && fin(re) ? last.roe - re : null;
        return view(ctx, {
          title: 'Bank / insurer', years: q, spec: Q_INPUTS_FIN,
          cards: [
            ['ROE (FY' + last.fy + ')', qCell(last, 'roe', P(last.roe), Q_INPUTS_FIN)], ['Cost of equity', fin(re) ? P(re) : NA, 'CAPM: 10-year Treasury + beta × 5% equity risk premium'],
            ['ROE − cost of equity', fin(spread) ? `<span class="${dir(spread)}">${spread > 0 ? '+' : ''}${num(spread * 100, 1)} pts</span>` : NA],
            ['ROTCE', qCell(last, 'rotce', P(last.rotce), Q_INPUTS_FIN)], ['Efficiency ratio', qCell(last, 'efficiency', P(last.efficiency), Q_INPUTS_FIN), 'Non-interest expense ÷ revenue: lower is better'],
            growth('revenue', 'Revenue growth / yr'), growth('epsDil', 'EPS growth / yr'), growth('bvps', 'Book value / share growth / yr', q),
          ],
          rows: [
            { section: 'Returns' },
            { key: 'roe', label: 'Return on equity', fmt: P, formula: '(Net income − preferred dividends) ÷ average common equity' },
            { key: 'rotce', label: 'Return on tangible common equity', fmt: P, formula: '(Net income − preferred dividends) ÷ average tangible common equity' },
            { key: 'roa', label: 'Return on assets', fmt: P, formula: 'Net income ÷ average total assets' },
            { section: 'Efficiency and strength' },
            { key: 'efficiency', label: 'Efficiency ratio', fmt: P, formula: 'Non-interest expense ÷ revenue (net of interest expense)' },
            { key: 'equityToAssets', label: 'Common equity / assets', fmt: P, formula: 'Common equity ÷ total assets' },
            { key: 'netMargin', label: 'Net margin', fmt: P, formula: 'Net income ÷ revenue' },
            { section: 'Per share' },
            { key: 'epsDil', label: 'Diluted EPS', fmt: N2, formula: 'As reported (split-adjusted)' },
            { key: 'bvps', label: 'Book value / share', fmt: N2, formula: 'Common equity ÷ shares outstanding' },
          ],
          formulas: [
            ['ROE', '(Net income − preferred dividends) ÷ average common equity', `= (${B(y.netIncome)} − ${B(y.prefDividends ?? 0)}) ÷ ${B(last.ceAvg)} (common equity, ${last.avgNote}) = ${P(last.roe)}${y.prefDividends == null ? ' (no preferred dividends reported, so none subtracted)' : ''}${srcNote(y, ['netIncome', 'commonEquity'], last._p, ['commonEquity'])}`],
            ['Cost of equity', '10-year Treasury yield + beta × equity risk premium (5%, an assumption)', fin(re) ? `= ${P(rf, 2)} + ${N2(beta)} × 5% = ${P(re)}` : 'needs beta and the Treasury yield'],
            ['Efficiency ratio', 'Non-interest expense ÷ revenue', `= ${B(y.nonInterestExpense)} ÷ ${B(y.revenue)} = ${P(last.efficiency)}${srcNote(y, ['nonInterestExpense', 'revenue'])}`],
            ['Not shown for banks', 'ROIC, EBITDA, interest coverage, net debt / EBITDA and free cash flow', 'For a bank, borrowing and lending is the business itself, so these measures have no meaning.'],
          ],
          notes: sourceNote(a, '; beta and Treasury yield: Yahoo Finance'),
        });
      }
      const w = wacc(years, { price: s.last, beta, rf });
      const spread = fin(last.roic) && fin(w.v) ? last.roic - w.v : null;
      return view(ctx, {
        title: 'Operating company', years: q, spec: Q_INPUTS,
        cards: [
          [`ROIC (FY${last.fy})`, qCell(last, 'roic', P(last.roic), Q_INPUTS)], ['Cost of capital (WACC)', fin(w.v) ? P(w.v) : `${NA} <span class="dim small">${esc(w.why)}</span>`],
          ['ROIC − WACC', fin(spread) ? `<span class="${dir(spread)}">${spread > 0 ? '+' : ''}${num(spread * 100, 1)} pts</span>` : NA, 'Positive = the business earns more on its capital than that capital costs'],
          ['Interest coverage', qCell(last, 'coverage', X(last.coverage), Q_INPUTS), 'EBIT ÷ interest expense: how many times profits cover interest'], ['Net debt / EBITDA', qCell(last, 'netDebtEbitda', X(last.netDebtEbitda), Q_INPUTS), 'Negative = more cash than debt'],
          ['FCF / net income', qCell(last, 'fcfToNi', X(last.fcfToNi, 2), Q_INPUTS), 'Above 1 = profits come with at least as much cash'],
          growth('revenue', 'Revenue growth / yr'), growth('epsDil', 'EPS growth / yr'), growth('fcf', 'FCF growth / yr'),
        ],
        rows: [
          { section: 'Returns on capital' },
          { key: 'roic', label: 'ROIC', fmt: P, formula: 'EBIT × (1 − tax rate) ÷ average (debt + equity − cash & short-term investments)' },
          { key: 'taxRate', label: 'Effective tax rate', fmt: P, formula: 'Income tax ÷ pre-tax income (n/a if outside 0–60%)' },
          { key: 'icAvg', label: 'Invested capital (avg)', fmt: B, formula: 'Debt + equity − cash & short-term investments' },
          { section: 'Margins' },
          { key: 'grossMargin', label: 'Gross margin', fmt: P, formula: 'Gross profit ÷ revenue' },
          { key: 'opMargin', label: 'Operating margin', fmt: P, formula: 'EBIT (operating income) ÷ revenue' },
          { key: 'netMargin', label: 'Net margin', fmt: P, formula: 'Net income ÷ revenue' },
          { key: 'fcfMargin', label: 'FCF margin', fmt: P, formula: '(Operating cash flow − capex) ÷ revenue' },
          { section: 'Debt and cash quality' },
          { key: 'coverage', label: 'Interest coverage', fmt: X, formula: 'EBIT ÷ interest expense' },
          { key: 'netDebtEbitda', label: 'Net debt / EBITDA', fmt: X, formula: '(Debt − cash & short-term investments) ÷ EBITDA' },
          { key: 'fcfToNi', label: 'FCF / net income', fmt: (v) => X(v, 2), formula: 'Free cash flow ÷ net income' },
          { section: 'Growth inputs' },
          { key: 'revenue', label: 'Revenue', fmt: B, formula: 'As reported' },
          { key: 'epsDil', label: 'Diluted EPS', fmt: N2, formula: 'As reported (split-adjusted)' },
          { key: 'fcf', label: 'Free cash flow', fmt: B, formula: 'Operating cash flow − capital expenditure' },
        ],
        formulas: [
          ['ROIC', 'NOPAT ÷ average invested capital; NOPAT = EBIT × (1 − effective tax rate); invested capital = debt + equity − cash & short-term investments',
            `= ${B(y.ebit)} × (1 − ${P(last.taxRate)}) ÷ ${B(last.icAvg)} (${esc(last.icNote)}) = ${P(last.roic)}${y.formulas?.ebit && !/^Operating/.test(y.formulas.ebit) ? ` · EBIT = ${esc(y.formulas.ebit.toLowerCase())}` : ''}${srcNote(y, Q_INPUTS.roic[0], last._p, Q_INPUTS.roic[1])}`],
          ['WACC', 'E/(D+E) × cost of equity + D/(D+E) × cost of debt × (1 − tax rate)',
            `E = market value ${B(w.E)}, D = debt ${B(w.D)}; cost of equity = ${P(rf, 2)} Treasury + beta ${N2(beta)} × 5% = ${P(w.re)}; cost of debt = interest ÷ average debt = ${P(w.rd)}${w.rdYear && w.rdYear !== y.fy ? ` (from FY${w.rdYear}, the latest year interest was reported)` : ''}; tax ${P(w.t)} → ${fin(w.v) ? P(w.v) : `n/a (${esc(w.why)})`}`],
          ['Interest coverage', 'EBIT ÷ interest expense', `= ${B(y.ebit)} ÷ ${B(y.interest)} = ${X(last.coverage)}${srcNote(y, ['ebit', 'interest'])}`],
          ['Net debt / EBITDA', '(Debt − cash & short-term investments) ÷ (EBIT + depreciation & amortization)', `= (${B(y.debt)} − ${B(y.cashAll)}) ÷ ${B(y.ebitda)} = ${X(last.netDebtEbitda)}${srcNote(y, ['netDebt', 'ebitda'])}`],
          ['FCF / net income', '(Operating cash flow − capex) ÷ net income', `= ${B(y.fcf)} ÷ ${B(y.netIncome)} = ${X(last.fcfToNi, 2)}${srcNote(y, ['fcf', 'netIncome'])}`],
          ['Growth per year (CAGR)', '(Last value ÷ value n years earlier)^(1/n) − 1', '5-year needs 6 fiscal years, 10-year needs 11; n/a if either end is zero or negative'],
        ],
        notes: sourceNote(a, '; beta, Treasury yield and price: Yahoo Finance. Equity risk premium 5% is an assumption. Debt excludes leases'),
      });
    });
  },
});

// ---- CAP ------------------------------------------------------------------------------------

register({
  code: 'CAP', aliases: ['CAPALLOC', 'BUYBACK', 'SBC'], name: 'Capital allocation', cat: 'Equity', sec: true,
  help: '<ticker> CAP — share count (buybacks vs dilution), buybacks + dividends as % of FCF, stock-based pay as % of revenue',
  run: needsReal('Capital allocation'),
  live(ctx) {
    return load(ctx, 'Capital allocation', (a) => {
      const years = a.years;
      const financial = a.financial ?? false;
      const c = capitalRows(years, financial);
      const last = c[c.length - 1];
      const y = years[years.length - 1];
      const baseName = financial ? 'net income' : 'free cash flow';
      const shareTrend = (n) => {
        const cc = cagr(c.map((r) => ({ fy: r.fy, s: r.shares })), 's', n);
        if (!fin(cc.v)) return `${NA} <span class="dim small">${esc(cc.why)}</span>`;
        const tot = cc.b / cc.a - 1;
        return `<span class="${tot < 0 ? 'up' : 'down'}">${tot > 0 ? '+' : ''}${num(tot * 100, 1)}%</span> <span class="dim small">(${cc.v > 0 ? '+' : ''}${num(cc.v * 100, 1)}%/yr, ${tot < 0 ? 'net buybacks' : 'net dilution'})</span>`;
      };
      const sum = (key, n) => c.slice(-n).reduce((acc, r) => (fin(r[key]) ? acc + r[key] : acc), 0);
      const fiveBase = c.slice(-5).every((r) => fin(r.base)) ? sum('base', 5) : null;
      const fivePct = fin(fiveBase) && fiveBase > 0 && c.length >= 5 ? sum('returned', 5) / fiveBase : null;
      return view(ctx, {
        title: 'Capital allocation', years: c, spec: capInputs(financial),
        cards: [
          ['Share count, 5 years', shareTrend(5)], ['Share count, 10 years', shareTrend(10)],
          [`Returned / ${baseName} (FY${last.fy})`, qCell(last, 'returnedPct', P(last.returnedPct, 0), capInputs(financial)), `Buybacks + dividends ÷ ${baseName}`],
          [`Returned / ${baseName}, last 5 yrs`, c.length >= 5 ? P(fivePct, 0) : NA],
          ['Stock-based pay / revenue', qCell(last, 'sbcRevenue', P(last.sbcRevenue), capInputs(financial))], ...(financial ? [] : [['FCF after stock-based pay', qCell(last, 'fcfLessSbc', B(last.fcfLessSbc), capInputs(financial)), 'Free cash flow − stock-based compensation']]),
        ],
        rows: [
          { section: 'Share count' },
          { key: 'shares', label: 'Shares', fmt: (v) => B(v), formula: 'Split-adjusted shares outstanding at year end; years without a year-end count use diluted average shares (the change vs prior year is n/a where the two kinds meet)' },
          { key: 'shareChg', label: 'Change vs prior year', fmt: P, formula: 'Shares ÷ prior year − 1 (negative = buybacks shrank the count)', cls: (v) => (fin(v) ? (v < 0 ? 'up' : v > 0 ? 'down' : '') : '') },
          { section: `Cash returned (vs ${baseName})` },
          { key: 'buybacks', label: 'Buybacks', fmt: B, formula: 'Cash paid to repurchase common stock' },
          { key: 'dividends', label: 'Dividends', fmt: B, formula: 'Cash dividends paid' },
          { key: 'returnedPct', label: `Buybacks + dividends / ${baseName}`, fmt: (v) => P(v, 0), formula: `(Buybacks + dividends) ÷ ${baseName}` },
          { key: 'buybackPct', label: `Buybacks / ${baseName}`, fmt: (v) => P(v, 0), formula: `Buybacks ÷ ${baseName}` },
          { key: 'dividendPct', label: `Dividends / ${baseName}`, fmt: (v) => P(v, 0), formula: `Dividends ÷ ${baseName}` },
          { section: 'Stock-based compensation' },
          { key: 'sbc', label: 'Stock-based pay', fmt: B, formula: 'Share-based compensation expense (cash flow statement)' },
          { key: 'sbcRevenue', label: 'Stock-based pay / revenue', fmt: P, formula: 'Stock-based compensation ÷ revenue' },
          ...(financial ? [] : [{ key: 'sbcFcf', label: 'Stock-based pay / FCF', fmt: P, formula: 'Stock-based compensation ÷ free cash flow' }, { key: 'fcfLessSbc', label: 'FCF after stock-based pay', fmt: B, formula: 'Free cash flow − stock-based compensation' }]),
        ],
        formulas: [
          ['Share count change', 'Shares at year end ÷ shares a year earlier − 1', `FY${last.fy}: ${B(last.shares)} (${esc(last.sharesBasis)}) → ${P(last.shareChg)}`],
          [`Buybacks + dividends / ${baseName}`, `(Buybacks + dividends) ÷ ${baseName}`, `= (${B(y.buybacks)} + ${B(y.dividendsPaid)}) ÷ ${B(last.base)} = ${P(last.returnedPct, 0)}${financial ? ' (banks: vs net income, since free cash flow has no meaning for them)' : ''}${srcNote(y, ['buybacks', 'dividendsPaid', financial ? 'netIncome' : 'fcf'])}`],
          ['Stock-based pay / revenue', 'Stock-based compensation ÷ revenue', `= ${B(y.sbc)} ÷ ${B(y.revenue)} = ${P(last.sbcRevenue)}${srcNote(y, ['sbc', 'revenue'])}`],
          ['Why it matters', 'Above 100% of free cash flow means paying out more than the business generates (funded by debt or cash on hand)', 'Stock-based pay is a real cost: it dilutes shareholders unless buybacks offset it, which is why a falling share count can still hide heavy stock pay.'],
        ],
        notes: sourceNote(a),
      });
    });
  },
});
