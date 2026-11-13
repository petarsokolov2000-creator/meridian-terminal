// CHECK <ticker>: a plain checklist (moat, growth, margins, cash flow, debt, valuation,
// shareholders, risks). Every line shows the value, the rule (with a threshold you can edit),
// and ✓ / ✗ / n/a. There is deliberately no overall score: the lines aren't equally important,
// and adding them up would hide that.
//
// The numbers come from the same calculations as VAL, DCF, QUAL, CAP, SEG and RISK (SEC 10-K
// figures, Yahoo prices), so a value here always matches the screen it comes from.

import { register } from '../registry.js';
import { num, esc, el, store, save } from '../fmt.js';
import { help } from '../glossary.js';
import { qualityRows, capitalRows, cagr, wacc } from './quality.js';
import { dcf, dcfDefaults } from './valuation.js';

const fin = (v) => v != null && Number.isFinite(v);
const median = (xs) => {
  const v = xs.filter(fin).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
// value formats: % (stored as a fraction), pts (fraction, shown as points), x (multiple), n (count)
const SHOW = {
  pct: (v) => `${num(v * 100, 1)}%`,
  pts: (v) => `${v > 0 ? '+' : ''}${num(v * 100, 1)} pts`,
  rel: (v) => `${v > 0 ? '+' : ''}${num(v * 100, 1)}%`,
  x: (v) => `${num(v, 2)}×`,
  n: (v) => String(v),
};
const TO_INPUT = { pct: (v) => +(v * 100).toFixed(2), pts: (v) => +(v * 100).toFixed(2), rel: (v) => +(v * 100).toFixed(2), x: (v) => v, n: (v) => v };
const FROM_INPUT = { pct: (v) => v / 100, pts: (v) => v / 100, rel: (v) => v / 100, x: (v) => v, n: (v) => Math.round(v) };
const UNIT = { pct: '%', pts: 'pts', rel: '%', x: '×', n: '' };

/** The checklist rules: [id, section, label, help key, op, default threshold, format]. */
export const RULES = {
  operating: [
    ['roic', 'Moat', 'ROIC, latest year', 'roic', '>=', 0.15, 'pct'],
    ['roicYears', 'Moat', 'Years of the last 5 with ROIC at or above the ROIC threshold', 'roic', '>=', 4, 'n'],
    ['roicSpread', 'Moat', 'ROIC minus cost of capital (WACC)', 'wacc', '>=', 0, 'pts'],
    ['gmRange', 'Moat', 'Gross margin range over 5 years (max − min)', 'grossMargin', '<=', 0.05, 'pts'],
    ['rev5', 'Growth', 'Revenue growth per year, 5 years', 'cagr', '>=', 0.05, 'pct'],
    ['eps5', 'Growth', 'EPS growth per year, 5 years', 'cagr', '>=', 0.07, 'pct'],
    ['fcf5', 'Growth', 'Free cash flow growth per year, 5 years', 'cagr', '>=', 0.05, 'pct'],
    ['opm', 'Margins', 'Operating margin, latest year', 'opMargin', '>=', 0.15, 'pct'],
    ['opmTrend', 'Margins', 'Operating margin vs its 5-year median', 'opMargin', '>=', 0, 'pts'],
    ['fcfPos', 'Free cash flow', 'Years of the last 5 with positive free cash flow', 'fcf', '>=', 5, 'n'],
    ['fcfNi', 'Free cash flow', 'FCF / net income, 5-year median', 'fcfToNi', '>=', 0.8, 'x'],
    ['sbc', 'Free cash flow', 'Stock-based pay / revenue, latest year', 'sbcRevenue', '<=', 0.05, 'pct'],
    ['ndEbitda', 'Debt', 'Net debt / EBITDA, latest year', 'netDebtEbitda', '<=', 2.5, 'x'],
    ['coverage', 'Debt', 'Interest coverage, latest year with interest reported', 'coverage', '>=', 8, 'x'],
    ['pePrem', 'Valuation', 'P/E now vs its own 5-year median (premium)', 'pe', '<=', 0, 'rel'],
    ['evPrem', 'Valuation', 'EV / EBITDA now vs its own 5-year median (premium)', 'evEbitda', '<=', 0, 'rel'],
    ['fcfYield', 'Valuation', 'FCF yield now', 'fcfYield', '>=', 0.04, 'pct'],
    ['dcfMos', 'Valuation', 'Margin of safety vs the base-case DCF', 'marginOfSafety', '>=', 0, 'rel'],
    ['shares5', 'Shareholders', 'Share count change over 5 years', 'shareCount', '<=', 0, 'rel'],
    ['customer', 'Risks', 'Largest single customer, share of revenue', 'customerConcentration', '<=', 0.1, 'pct'],
    ['topLine', 'Risks', 'Largest product or segment, share of revenue', 'segmentShare', '<=', 0.6, 'pct'],
  ],
  financial: [
    ['roe', 'Moat', 'Return on equity, latest year', 'roe', '>=', 0.1, 'pct'],
    ['roeYears', 'Moat', 'Years of the last 5 with ROE at or above the ROE threshold', 'roe', '>=', 4, 'n'],
    ['roeSpread', 'Moat', 'ROE minus cost of equity', 'costOfEquity', '>=', 0, 'pts'],
    ['rotce', 'Moat', 'Return on tangible common equity, latest year', 'rotce', '>=', 0.12, 'pct'],
    ['rev5', 'Growth', 'Revenue growth per year, 5 years', 'cagr', '>=', 0.03, 'pct'],
    ['eps5', 'Growth', 'EPS growth per year, 5 years', 'cagr', '>=', 0.05, 'pct'],
    ['bvps5', 'Growth', 'Book value per share growth per year, 5 years', 'bvps', '>=', 0.04, 'pct'],
    ['efficiency', 'Margins', 'Efficiency ratio, latest year (lower is better)', 'efficiency', '<=', 0.6, 'pct'],
    ['equityAssets', 'Debt', 'Common equity / total assets', 'equityToAssets', '>=', 0.07, 'pct'],
    ['pbPrem', 'Valuation', 'P/B now vs its own 5-year median (premium)', 'pb', '<=', 0, 'rel'],
    ['pePrem', 'Valuation', 'P/E now vs its own 5-year median (premium)', 'pe', '<=', 0, 'rel'],
    ['divYield', 'Valuation', 'Dividend yield (latest fiscal year’s dividends)', 'divYield', '>=', 0.02, 'pct'],
    ['shares5', 'Shareholders', 'Share count change over 5 years', 'shareCount', '<=', 0, 'rel'],
  ],
};

/**
 * Values for every rule, each { v, why?, detail? }. `extra` carries what VAL/QUAL/SEG/DCF need:
 * { beta, rf, price, segments, dcfBase }.
 */
export function checkValues(v, extra) {
  const years = v.years;
  const financial = v.financial;
  const q = qualityRows(years, financial);
  const c = capitalRows(years, financial);
  const last = q[q.length - 1];
  const out = {};
  const NA = (why) => ({ v: null, why });
  const g = (key, src = years) => {
    const r = cagr(src, key, 5);
    return fin(r.v) ? { v: r.v, detail: `FY${r.from}–FY${r.to}` } : NA(r.why);
  };
  const prem = (k) => {
    const st = v.stats[k]?.y5;
    if (!st || st.short) return NA(`needs 5 fiscal years (${years.length} available)`);
    if (!fin(v.current[k]) || !fin(st.median) || st.median === 0) return NA('not computable (negative or missing figures)');
    return { v: v.current[k] / st.median - 1, detail: `now ${num(v.current[k], 1)}× vs median ${num(st.median, 1)}×` };
  };
  const yearsWith = (key, thr) => {
    const l5 = q.slice(-5);
    if (l5.length < 5) return NA(`needs 5 fiscal years (${q.length} available)`);
    if (l5.some((r) => !fin(r[key]))) return NA('some years are missing an input');
    return { v: l5.filter((r) => r[key] >= thr).length, detail: `FY${l5[0].fy}–FY${l5[4].fy}` };
  };
  const shares5 = () => {
    const r = cagr(c.map((x) => ({ fy: x.fy, s: x.shares })), 's', 5);
    return fin(r.v) ? { v: r.b / r.a - 1, detail: `FY${r.from}–FY${r.to}` } : NA(r.why);
  };
  const thr = extra.thresholds;
  if (financial) {
    const re = fin(extra.beta) && fin(extra.rf) ? extra.rf + extra.beta * 0.05 : null;
    out.roe = fin(last.roe) ? { v: last.roe, detail: `FY${last.fy}` } : NA('not reported');
    out.roeYears = yearsWith('roe', thr.roe);
    out.roeSpread = fin(last.roe) && fin(re) ? { v: last.roe - re, detail: `cost of equity ${num(re * 100, 1)}%` } : NA(fin(re) ? 'ROE not available' : 'needs beta and the Treasury yield');
    out.rotce = fin(last.rotce) ? { v: last.rotce, detail: `FY${last.fy}` } : NA('not reported');
    out.rev5 = g('revenue');
    out.eps5 = g('epsDil');
    out.bvps5 = g('bvps', q);
    out.efficiency = fin(last.efficiency) ? { v: last.efficiency, detail: `FY${last.fy}` } : NA('non-interest expense not reported');
    out.equityAssets = fin(last.equityToAssets) ? { v: last.equityToAssets, detail: `FY${last.fy}` } : NA('total assets not reported');
    out.pbPrem = prem('pb');
    out.pePrem = prem('pe');
    out.divYield = fin(v.current.divYield) ? { v: v.current.divYield, detail: `FY${v.latestFy} dividends ÷ today’s price` } : NA('dividends per share not reported');
    out.shares5 = shares5();
    return out;
  }
  const w = wacc(years, { price: extra.price, beta: extra.beta, rf: extra.rf });
  out.roic = fin(last.roic) ? { v: last.roic, detail: `FY${last.fy}` } : NA('an input (EBIT, tax rate or capital) is missing');
  out.roicYears = yearsWith('roic', thr.roic);
  out.roicSpread = fin(last.roic) && fin(w.v) ? { v: last.roic - w.v, detail: `WACC ${num(w.v * 100, 1)}%` } : NA(!fin(w.v) ? `WACC n/a: ${w.why}` : 'ROIC n/a');
  const gm = q.slice(-5).map((r) => r.grossMargin);
  out.gmRange = q.length >= 5 && gm.every(fin) ? { v: Math.max(...gm) - Math.min(...gm), detail: `${num(Math.min(...gm) * 100, 1)}%–${num(Math.max(...gm) * 100, 1)}%` } : NA(q.length < 5 ? 'needs 5 fiscal years' : 'gross profit not reported every year');
  out.rev5 = g('revenue');
  out.eps5 = g('epsDil');
  out.fcf5 = g('fcf');
  out.opm = fin(last.opMargin) ? { v: last.opMargin, detail: `FY${last.fy}` } : NA('operating income not reported');
  const opMed = median(q.slice(-5).map((r) => r.opMargin));
  out.opmTrend = q.length >= 5 && fin(last.opMargin) && fin(opMed) ? { v: last.opMargin - opMed, detail: `median ${num(opMed * 100, 1)}%` } : NA('needs 5 years of operating margins');
  const f5 = years.slice(-5).map((y) => y.fcf);
  out.fcfPos = years.length >= 5 && f5.every(fin) ? { v: f5.filter((x) => x > 0).length, detail: `FY${years[years.length - 5].fy}–FY${years[years.length - 1].fy}` } : NA('needs 5 years of free cash flow');
  const fn = median(q.slice(-5).map((r) => r.fcfToNi));
  out.fcfNi = fin(fn) ? { v: fn, detail: `median of ${q.slice(-5).filter((r) => fin(r.fcfToNi)).length} years` } : NA('needs positive net income');
  const lc = c[c.length - 1];
  out.sbc = fin(lc.sbcRevenue) ? { v: lc.sbcRevenue, detail: `FY${lc.fy}` } : NA('stock-based pay not reported');
  out.ndEbitda = fin(last.netDebtEbitda) ? { v: last.netDebtEbitda, detail: `FY${last.fy}` } : NA('debt, cash or EBITDA not reported');
  const cov = [...q].reverse().find((r) => fin(r.coverage));
  out.coverage = cov ? { v: cov.coverage, detail: `FY${cov.fy}` } : NA('interest expense not reported');
  out.pePrem = prem('pe');
  out.evPrem = prem('evEbitda');
  out.fcfYield = fin(v.current.fcfYield) ? { v: v.current.fcfYield, detail: `FY${v.latestFy} FCF ÷ today’s market value` } : NA('free cash flow not available');
  if (extra.dcfBase && extra.dcfInputs) {
    const r = dcf({ ...extra.dcfInputs, ...extra.dcfBase });
    out.dcfMos = !r.error && r.perShare > 0 && fin(extra.price) ? { v: (r.perShare - extra.price) / r.perShare, detail: `fair value ${num(r.perShare, 2)} (${extra.dcfSaved ? 'your saved DCF base case' : 'DCF default base case'})` } : NA(r.error || 'the DCF gives no positive value');
  } else out.dcfMos = NA('no DCF inputs');
  out.shares5 = shares5();
  const sg = extra.segments;
  if (!sg) {
    out.customer = NA('loading the 10-K…');
    out.topLine = NA('loading the 10-K…');
  } else if (sg.error || sg.unsupported) {
    out.customer = NA(sg.error || sg.unsupported);
    out.topLine = NA(sg.error || sg.unsupported);
  } else {
    const lastEnd = sg.ends[sg.ends.length - 1];
    const total = sg.totals[lastEnd];
    // none tagged: no customer at 10%+ was disclosed, which only answers rules of 10% or more
    out.customer = sg.customers.length ? { v: sg.customers[0].share, detail: `${sg.customers[0].customer} (as tagged in the 10-K)` } : { v: null, noneTagged: true, why: 'none tagged in the 10-K; only customers at 10% or more have to be disclosed, so a stricter rule can’t be checked' };
    const rows = sg.product.length ? sg.product : sg.segment;
    const top = rows[0];
    out.topLine = top && fin(top.values[lastEnd]) && total ? { v: top.values[lastEnd] / total, detail: `${top.label}, FY ended ${lastEnd}` } : NA('no segment or product revenue tagged');
  }
  return out;
}

register({
  code: 'CHECK', aliases: ['CHECKLIST', 'CL'], name: 'Investor checklist', cat: 'Equity', sec: true,
  help: '<ticker> CHECK — moat, growth, margins, cash flow, debt, valuation, shareholders and risks, each against a threshold you can edit; no overall score',
  run(ctx) {
    ctx.el.innerHTML = '<div class="empty">The checklist needs real company data. Switch with <kbd>MODE LIVE</kbd> (Meridian has to be running from its icon).</div>';
  },
  live(ctx) {
    const s = ctx.sec;
    const E = ctx.engine;
    if (s.cls !== 'EQ' || s.etf) {
      ctx.el.innerHTML = `<div class="empty">The checklist is for company stocks (${esc(s.sym)} isn't one).</div>`;
      return;
    }
    const wait = el('div', 'empty', 'Loading 10-K history from the SEC (first time takes about 10 seconds)…');
    ctx.el.appendChild(wait);
    let gone = false;
    Promise.all([E.valuation(s.sym), E.details(s.sym).catch(() => null)]).then(([v, det]) => {
      if (gone) return;
      wait.remove();
      const kind = v.financial ? 'financial' : 'operating';
      const rules = RULES[kind];
      const tkey = `check-thr:${kind}`;
      const thresholds = () => ({ ...Object.fromEntries(rules.map((r) => [r[0], r[5]])), ...store(tkey, {}) });
      const tsy = E.get('US10Y');
      const rf = tsy?.last != null ? tsy.last / 100 : null;
      const beta = det?.stats?.beta ?? null;
      const saved = store(`dcf:${s.sym}`, null)?.scen?.base || null;
      const d = v.financial || v.currencyMismatch ? null : dcfDefaults(v.years, { beta, rf });
      const extra = {
        beta, rf, price: v.current.price, segments: null,
        dcfInputs: d ? { revenue0: d.revenue0, netDebt: d.netDebt, shares: d.shares } : null,
        dcfBase: saved || (d ? { growth: d.growth, margin: d.margin, discount: d.discount, terminal: d.terminal } : null), dcfSaved: !!saved,
      };
      const head = el('div', 'port-head');
      head.innerHTML = [['Company', `${esc(s.sym)} <span class="dim small">${esc(s.name || '')}</span>`], ['Checked as', v.financial ? 'bank / insurer' : 'operating company'], ['Latest fiscal year', `FY${v.latestFy}`], ['Price', num(v.current.price, 2)]]
        .map(([a, b]) => `<div><span class="dim">${a}</span><b>${b}</b></div>`).join('');
      const table = el('div', 'tbl-wrap');
      const risks = el('div', 'val-formulas');
      const note = el('p', 'note');
      ctx.el.append(head, table, risks, note);
      const draw = () => {
        const t = thresholds();
        const vals = checkValues(v, { ...extra, thresholds: t });
        let section = null;
        table.innerHTML = `<table class="tbl chk-tbl"><thead><tr><th class="l">Check</th><th class="r">Value</th><th class="l">Rule (edit the number)</th><th class="c">Result</th><th class="l">Detail</th></tr></thead><tbody>
          ${rules.map(([id, sec, label, hk, op, , fmt]) => {
            const val = vals[id] || { v: null, why: 'n/a' };
            const thr = t[id];
            let ok = fin(val.v) ? (op === '>=' ? val.v >= thr - 1e-12 : val.v <= thr + 1e-12) : null;
            if (val.noneTagged && thr >= 0.1 - 1e-12) ok = true;
            const head2 = sec !== section ? `<tr class="q-sec"><td class="l" colspan="5">${esc((section = sec))}</td></tr>` : '';
            const detail = esc(fin(val.v) ? val.detail || '' : val.noneTagged && ok ? 'no customer at 10% or more is disclosed in the 10-K' : val.why || '');
            return `${head2}<tr><td class="l chk-label">${esc(label)}${help(hk)}<div class="chk-sub dim small">${detail}</div></td><td class="r"><b>${fin(val.v) ? SHOW[fmt](val.v) : val.noneTagged ? 'none tagged' : '<span class="dim">n/a</span>'}</b></td>
              <td class="l chk-rule">${op === '>=' ? '≥' : '≤'} <input type="number" step="any" inputmode="decimal" data-id="${id}" data-fmt="${fmt}" value="${TO_INPUT[fmt](thr)}"> ${UNIT[fmt]}</td>
              <td class="c chk-res ${ok == null ? 'dim' : ok ? 'up' : 'down'}" title="${ok == null ? 'not enough data' : ok ? 'meets the rule' : 'misses the rule'}">${ok == null ? 'n/a' : ok ? '✓' : '✗'}</td>
              <td class="l dim small chk-detail">${detail}</td></tr>`;
          }).join('')}</tbody></table>
          <div class="val-add"><button class="tb" data-reset>Reset thresholds to defaults</button> <span class="dim small">Thresholds are saved on this device and apply to every ${v.financial ? 'bank and insurer' : 'company'} you check.</span></div>`;
      };
      table.addEventListener('change', (e) => {
        const inp = e.target.closest('[data-id]');
        if (!inp) return;
        const n = Number(inp.value);
        if (!Number.isFinite(n)) return;
        save(tkey, { ...store(tkey, {}), [inp.dataset.id]: FROM_INPUT[inp.dataset.fmt](n) });
        draw();
      });
      table.addEventListener('click', (e) => {
        if (!e.target.closest('[data-reset]')) return;
        save(tkey, {});
        draw();
      });
      draw();
      // risks: the company's own list, to read (not scored)
      risks.innerHTML = `<h3>Risks to read ${help('riskFactors')}</h3><p class="note">Loading the risk factors from the latest 10-K…</p>`;
      E.risks(s.sym).then((r) => {
        if (gone) return;
        const items = (r.headings || []).filter((h) => !h.group);
        const link = r.filing ? `<a class="doc" href="${esc(r.filing.url)}" target="_blank" rel="noopener noreferrer">${esc(r.filing.form)} filed ${esc(r.filing.filed || '')} ↗</a>` : '';
        risks.innerHTML = `<h3>Risks to read ${help('riskFactors')}</h3>${items.length ? `<p class="note">${items.length} risk factors in the company's own list (${link}). The first few: </p><ol class="chk-risks">${items.slice(0, 6).map((h) => `<li>${esc(h.text)}</li>`).join('')}</ol><p class="note">See them all with <kbd>${esc(s.sym)} RISK</kbd>. Not scored: which risks matter is your call.</p>` : `<p class="note">${esc(r.unsupported || 'No risk-factor headings could be read from the filing.')} ${link}</p>`}`;
      }).catch((err) => {
        if (!gone) risks.innerHTML = `<h3>Risks to read</h3><p class="note">Couldn't load the risk factors: ${esc(err.message)}</p>`;
      });
      if (!v.financial) {
        E.segments(s.sym).then((sg) => {
          extra.segments = sg;
        }).catch((err) => {
          extra.segments = { error: err.message };
        }).finally(() => !gone && draw());
      }
      note.innerHTML = `Sources: ${esc(v.source)}, latest filing ${esc(v.asOf)}; prices, beta and Treasury yield: Yahoo Finance; customers and segments: the latest 10-K. Each line uses the same calculation as ${v.financial ? 'VAL and QUAL' : 'VAL, DCF, QUAL, CAP and SEG'} (tap ? for the definition). The default thresholds are common rules of thumb, not recommendations; they suit some industries better than others, so change them to your own. <b>There is no overall score on purpose:</b> the lines aren't equally important, and a stock can fail several and still be a good investment (or pass them all and be a poor one). n/a means the data needed isn't reported.`;
    }).catch((err) => {
      if (!gone) wait.textContent = `Couldn't load the checklist data: ${err.message}`;
    });
    return { destroy: () => { gone = true; } };
  },
});
