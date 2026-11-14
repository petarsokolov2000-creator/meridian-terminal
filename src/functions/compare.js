// COMPARE: two to five companies you choose, side by side: valuation now, growth, margins,
// returns, debt and what happens to the share count.
//
// Every number is the one VAL and QUAL show for that company (same data, same formulas, same
// source markers; see server/fundamentals.mjs and quality.js), so nothing is estimated and a
// figure that's missing says why. Banks and insurers get their own measures; a row that doesn't
// apply to a company says so. The colours only mark the lowest and highest value in a row: they
// are not a recommendation.

import { register } from '../registry.js';
import { num, big, esc, el, store, save, secLink, px } from '../fmt.js';
import { help } from '../glossary.js';
import { na, nowMark, statusLine } from '../sources.js';
import { METRICS, NOW_INPUTS } from './valuation.js';
import { qualityRows, cagr, cagrCell, qCell, Q_INPUTS, Q_INPUTS_FIN } from './quality.js';

const MAX = 5;
const fin = (v) => v != null && Number.isFinite(v);
const P = (v, dp = 1) => `${num(v * 100, dp)}%`;
const X = (v, dp = 1) => `${num(v, dp)}×`;
const BANK = 'not applicable to banks and insurers (debt and deposits are their raw material)';
const NOT_BANK = 'a bank measure; this company is not a bank or insurer';

// A row: who it applies to ('op' = operating companies, 'fin' = banks/insurers, 'all'), which
// end is marked green ('low' or 'high'), and cell(c) -> { v: number|null, html }.
const nowRow = (k, forWho) => ({
  label: `${METRICS[k][0]}${help(k)}`, for: forWho, better: METRICS[k][3] ? 'low' : 'high',
  cell: (c) => {
    const cur = c.v.current;
    if (c.v.currencyMismatch) return { v: null, html: na(c.v.currencyMismatch) };
    if (!fin(cur[k])) return { v: null, html: na(cur.meta?.[k]?.why) };
    return { v: cur[k], html: `${METRICS[k][1](cur[k])}${nowMark(c.v.now.fields, NOW_INPUTS[k], cur.meta?.[k])}` };
  },
});
const qRow = (key, label, fmt, forWho, better) => ({
  label, for: forWho, better,
  cell: (c) => {
    const r = c.last;
    return { v: fin(r[key]) ? r[key] : null, html: qCell(r, key, fin(r[key]) ? fmt(r[key]) : '', c.financial ? Q_INPUTS_FIN : Q_INPUTS) };
  },
});
const growthRow = (key, label, forWho, better, src = (c) => c.q) => ({
  label, for: forWho, better,
  cell: (c) => {
    const rows = src(c);
    const g = cagr(rows, key, 5);
    return { v: fin(g.v) ? g.v : null, html: cagrCell(g, key, rows) };
  },
});

const SECTIONS = [
  ['Price and size', [
    { label: 'Price', for: 'all', cell: (c) => ({ v: null, html: `<span data-px="${esc(c.inst.sym)}">${px(c.inst)}</span> <span class="dim small">${esc(c.v.priceCurrency || '')}</span>` }) },
    { label: `Market value${help('marketCap')}`, for: 'all', cell: (c) => ({ v: null, html: fin(c.v.current.marketCap) ? big(c.v.current.marketCap) : na(c.v.currencyMismatch || 'share count: not reported') }) },
    {
      label: 'Price change, 1 year', for: 'all', better: 'high',
      cell: (c) => {
        const h = c.inst.history || [];
        const first = h[0]?.c;
        if (!fin(first) || first <= 0 || h.length < 200) return { v: null, html: na('less than a year of price history loaded') };
        const v = c.inst.last / first - 1;
        return { v, html: `<span title="from ${esc(h[0].t || '')}">${v > 0 ? '+' : ''}${P(v)}</span>` };
      },
    },
    {
      label: `Figures up to${help('ttm')}`, for: 'all',
      cell: (c) => ({ v: null, html: c.v.now?.ttmEnd ? `${esc(c.v.now.ttmEnd.slice(0, 7))} <span class="dim small">12 months</span>` : `FY${c.v.latestFy} <span class="dim small">fiscal year</span>` }),
    },
  ]],
  ['Valuation now (today’s price, last 12 months)', [
    nowRow('pe', 'all'), nowRow('evEbitda', 'op'), nowRow('ps', 'op'), nowRow('pfcf', 'op'), nowRow('fcfYield', 'op'),
    nowRow('pb', 'all'),
    { ...nowRow('ptbv', 'fin'), na: NOT_BANK }, { ...nowRow('divYield', 'fin'), na: NOT_BANK },
    {
      label: `P/E vs its own 5-year median${help('median5y')}`, for: 'all', better: 'low',
      cell: (c) => {
        const now = c.v.current.pe;
        const med = c.v.stats?.pe?.y5?.median;
        if (!fin(now)) return { v: null, html: na(c.v.currencyMismatch || c.v.current.meta?.pe?.why) };
        if (!fin(med)) return { v: null, html: na(c.v.stats?.pe?.y5?.short ? 'fewer than 5 fiscal years of data' : 'no positive P/E in the last 5 fiscal years') };
        const d = now / med - 1;
        return { v: d, html: `${d > 0 ? '+' : ''}${P(d, 0)} <span class="dim small">${X(now)} vs ${X(med)}</span>` };
      },
    },
  ]],
  ['Growth per year, last 5 fiscal years', [
    growthRow('revenue', `Revenue${help('cagr')}`, 'all', 'high'),
    growthRow('epsDil', `Earnings per share${help('eps')}`, 'all', 'high'),
    { ...growthRow('fcf', `Free cash flow${help('fcf')}`, 'op', 'high'), na: BANK },
  ]],
  ['Profitability, latest fiscal year', [
    { ...qRow('grossMargin', `Gross margin${help('grossMargin')}`, P, 'op', 'high'), na: BANK },
    { ...qRow('opMargin', `Operating margin${help('opMargin')}`, P, 'op', 'high'), na: BANK },
    qRow('netMargin', `Net margin${help('netMargin')}`, P, 'all', 'high'),
    { ...qRow('fcfMargin', `Free-cash-flow margin${help('fcfMargin')}`, P, 'op', 'high'), na: BANK },
    {
      label: `Return on capital${help('roic')}`, for: 'all', better: 'high',
      cell: (c) => {
        const key = c.financial ? 'roe' : 'roic';
        const r = c.last;
        return { v: fin(r[key]) ? r[key] : null, html: qCell(r, key, fin(r[key]) ? `${P(r[key])} <span class="dim small">${c.financial ? 'ROE' : 'ROIC'}</span>` : '', c.financial ? Q_INPUTS_FIN : Q_INPUTS) };
      },
    },
    { ...qRow('efficiency', `Efficiency ratio${help('efficiency')}`, P, 'fin', 'low'), na: NOT_BANK },
  ]],
  ['Debt and cash', [
    { ...qRow('netDebtEbitda', `Net debt / EBITDA${help('netDebtEbitda')}`, X, 'op', 'low'), na: BANK },
    { ...qRow('coverage', `Interest coverage${help('coverage')}`, X, 'op', 'high'), na: BANK },
    { ...qRow('fcfToNi', `FCF / net income${help('fcfToNi')}`, X, 'op', 'high'), na: BANK },
    { ...qRow('equityToAssets', `Common equity / assets${help('equityToAssets')}`, P, 'fin', 'high'), na: NOT_BANK },
  ]],
  ['Shareholders', [
    growthRow('shares', `Share count per year, 5 years${help('shareCount')}`, 'all', 'low', (c) => c.v.years),
  ]],
];

const needsReal = (ctx) => {
  ctx.el.innerHTML = '<div class="empty">Comparing companies needs real company data. Switch with <kbd>MODE LIVE</kbd> (Meridian has to be running from its icon).</div>';
};

register({
  code: 'COMPARE', aliases: ['CMP', 'SIDE', 'VERSUS'], name: 'Compare companies side by side', cat: 'Equity',
  help: 'COMPARE <ticker> <ticker> … — 2 to 5 companies side by side: valuation, growth, margins, returns, debt (same numbers as VAL and QUAL)',
  run: needsReal,
  live(ctx) {
    const E = ctx.engine;
    const typed = [...new Set(ctx.args.map((a) => String(a).toUpperCase()).filter((a) => /^[A-Z0-9^=.\-/:]{1,24}$/.test(a) && !['VS', 'AND', 'COMPARE'].includes(a)))];
    const syms = (typed.length ? typed : store('compare', [])).slice(0, MAX);
    if (typed.length) save('compare', syms);
    const rerun = (list) => {
      save('compare', list);
      ctx.app.run(`COMPARE ${list.join(' ')}`.trim(), ctx.panel);
    };

    const bar = el('div', 'val-add cmp-add', `<input placeholder="Add a company (ticker)" maxlength="12" data-add> <button class="tb" data-addbtn>Add</button> <span class="dim small">${syms.length}/${MAX} companies${typed.length > MAX ? ` (only the first ${MAX} are shown)` : ''}</span>`);
    const host = el('div');
    ctx.el.append(bar, host);
    bar.addEventListener('click', (e) => {
      if (!e.target.closest('[data-addbtn]')) return;
      const t = bar.querySelector('[data-add]').value.trim().toUpperCase();
      if (!t) return;
      if (syms.length >= MAX) return ctx.app.toast(`COMPARE shows up to ${MAX} companies. Remove one first (the × next to its name).`, 'err');
      if (!syms.includes(t)) rerun([...syms, t]);
    });
    bar.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('[data-add]')) bar.querySelector('[data-addbtn]').click();
    });
    host.addEventListener('click', (e) => {
      const b = e.target.closest('[data-drop]');
      if (b) rerun(syms.filter((s) => s !== b.dataset.drop));
    });

    if (syms.length < 2) {
      host.innerHTML = `<div class="empty">${syms.length ? `Add at least one more company to compare with ${esc(syms[0])}.` : 'Pick two to five companies.'} Example: <kbd>COMPARE AAPL MSFT GOOGL</kbd></div>`;
      return;
    }

    let gone = false;
    let done = 0;
    const cols = syms.map((sym) => ({ sym, state: 'loading' }));
    const progress = el('div', 'empty');
    host.appendChild(progress);
    const say = () => (progress.textContent = `Loading 10 years of filings for ${syms.length} companies: ${done} of ${syms.length} done (first time takes about 10 seconds each)…`);
    say();

    const loadOne = async (col) => {
      try {
        const inst = E.get(col.sym) || await E.lookup(col.sym, { quiet: true });
        col.inst = inst;
        if (inst.cls !== 'EQ' || inst.etf) throw new Error(`${inst.sym} isn't a company stock (funds, indices and currencies have no financial statements)`);
        const v = await E.valuation(inst.sym);
        const financial = !!v.financial;
        const q = qualityRows(v.years, financial);
        Object.assign(col, { state: 'ok', v, financial, q, last: q[q.length - 1] });
      } catch (err) {
        col.state = 'failed';
        col.error = err.message;
      }
      done++;
      if (!gone) say();
    };

    const render = () => {
      const ok = cols.filter((c) => c.state === 'ok');
      const kinds = new Set(ok.map((c) => (c.financial ? 'fin' : 'op')));
      const applies = (row, c) => row.for === 'all' || row.for === (c.financial ? 'fin' : 'op');
      const headCell = (c) => {
        const name = c.inst?.name ? `<span class="cmp-name"><br><span class="dim small">${esc(c.inst.name.slice(0, 26))}</span></span>` : '';
        const kind = c.state === 'ok' && kinds.size > 1 ? `<br><span class="dim small">${c.financial ? 'bank / insurer' : 'operating company'}</span>` : '';
        return `<th class="r">${c.inst ? secLink(c.inst) : esc(c.sym)} <button class="tb cmp-x" data-drop="${esc(c.sym)}" title="Remove ${esc(c.sym)}" aria-label="Remove ${esc(c.sym)}">×</button>${name}${kind}</th>`;
      };
      let body = '';
      for (const [title, rows] of SECTIONS) {
        const shown = rows.filter((r) => r.for === 'all' || kinds.has(r.for));
        if (!shown.length) continue;
        body += `<tr class="cmp-sec"><td class="l" colspan="${cols.length + 1}">${esc(title)}</td></tr>`;
        for (const row of shown) {
          const cells = cols.map((c) => {
            if (c.state !== 'ok') return { v: null, html: '<span class="dim">—</span>' };
            if (!applies(row, c)) return { v: null, html: na(row.na || (c.financial ? BANK : NOT_BANK)) };
            try {
              return row.cell(c);
            } catch (err) {
              return { v: null, html: na(`couldn't be worked out (${err.message})`) };
            }
          });
          const vals = cells.map((x) => x.v).filter(fin);
          let best = null;
          let worst = null;
          if (row.better && vals.length >= 2 && Math.max(...vals) !== Math.min(...vals)) {
            best = row.better === 'low' ? Math.min(...vals) : Math.max(...vals);
            if (vals.length >= 3) worst = row.better === 'low' ? Math.max(...vals) : Math.min(...vals);
          }
          body += `<tr><td class="l">${row.label}</td>${cells.map((x) => `<td class="r${fin(x.v) && x.v === best ? ' cmp-best' : fin(x.v) && x.v === worst ? ' cmp-worst' : ''}">${x.html}</td>`).join('')}</tr>`;
        }
      }
      const failed = cols.filter((c) => c.state === 'failed');
      const partial = ok.filter((c) => c.v.partial);
      host.innerHTML = `
        ${failed.map((c) => `<p class="note st-bad">${esc(c.sym)} couldn't be loaded: ${esc(c.error)}</p>`).join('')}
        ${ok.length ? `<div class="tbl-wrap"><table class="tbl cmp-tbl"><thead><tr><th class="l">Measure</th>${cols.map(headCell).join('')}</tr></thead><tbody>${body}</tbody></table></div>` : ''}
        <p class="note"><span class="cmp-best">Green</span> = the lowest multiple, or the highest growth, margin or return in the row${cols.length >= 3 ? '; <span class="cmp-worst">red</span> = the other end' : ''}. This only orders the numbers: a low multiple can mean a cheap stock or a business in trouble. "Now" multiples use today's price and the last 12 months; margins, returns and debt use each company's latest fiscal year, and fiscal years end in different months, so the periods don't line up exactly. Growth is per year over 5 fiscal years. Tap a company for its own screens (<kbd>VAL</kbd>, <kbd>QUAL</kbd>), a marker for a number's source, an n/a for the reason.</p>
        ${partial.map((c) => `<p class="note"><b>${esc(c.inst.sym)}</b>: ${statusLine(c.v.status)}</p>`).join('')}
        <p class="note">Sources: SEC EDGAR 10-K/10-Q figures first, then Yahoo and Finnhub for gaps (marked Y / F); prices from Yahoo Finance. Nothing is estimated.</p>`;
    };

    // two companies at a time: each one is dozens of SEC requests the first time
    (async () => {
      const queue = [...cols];
      await Promise.all([0, 1].map(async () => {
        while (queue.length && !gone) await loadOne(queue.shift());
      }));
      if (!gone) render();
    })();

    return {
      every: 2,
      update: () => {
        for (const n of host.querySelectorAll('[data-px]')) {
          const i = E.get(n.dataset.px);
          if (i) n.textContent = px(i);
        }
      },
      destroy: () => { gone = true; },
    };
  },
});
