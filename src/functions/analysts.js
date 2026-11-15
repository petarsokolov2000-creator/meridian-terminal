// REV: what the analysts expect, and which way they are moving. CRED: how safe the company's debt looks.
//
// REV uses Yahoo's analyst data (profile + details): the average EPS estimate now and 7/30/60/90 days
// ago, how many analysts raised or cut in the last 30 days, the price target range, and the latest
// rating changes by firm. Rising estimates tend to go with rising prices and falling ones with falling
// prices (a tendency, not a promise). Yahoo's figures are a consensus of the analysts it tracks, not every
// analyst, and individual estimates are not published.
//
// CRED is a scorecard from the company's own filings (SEC, Yahoo, Finnhub): leverage, interest cover,
// cash flow against debt, cash against debt, short-term liquidity. The thresholds are common rules of
// thumb, shown next to each figure. It is NOT a credit rating: agency ratings (S&P, Moody's), bond
// prices, spreads and CDS are paid data Meridian doesn't have.

import { register } from '../registry.js';
import { num, big, pct, esc, el, secLink, store } from '../fmt.js';
import { help } from '../glossary.js';
import { qualityRows } from './quality.js';
import { loadBook } from './tools.js';

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const NA = '<span class="dim">n/a</span>';
const PERIODS = { '0q': 'Current quarter', '+1q': 'Next quarter', '0y': 'Current year', '+1y': 'Next year' };

const chgPct = (now, then) => (fin(now) && fin(then) && then !== 0 ? (now - then) / Math.abs(then) : null);
const cell = (v) => (v == null ? NA : `<span class="${v > 0.0005 ? 'up' : v < -0.0005 ? 'down' : 'dim'}">${v > 0 ? '+' : ''}${num(v * 100, 1)}%</span>`);

/** One word for where a company's estimates are heading, from the current-year estimate. */
export function revisionSignal(est) {
  const t = est?.trend;
  const r = est?.revisions;
  const d30 = chgPct(t?.now, t?.d30);
  if (d30 == null) return null;
  const up = r?.up30 ?? 0;
  const down = r?.down30 ?? 0;
  if (d30 > 0.01 && up >= down) return { word: 'Rising', cls: 'up', d30, up, down };
  if (d30 < -0.01 && down >= up) return { word: 'Falling', cls: 'down', d30, up, down };
  return { word: 'Mixed / flat', cls: 'dim', d30, up, down };
}

const currentYear = (d) => d?.estimates?.find((e) => e.period === '0y') || d?.estimates?.find((e) => e.period === '+1y') || d?.estimates?.[0] || null;

register({
  code: 'REV', aliases: ['EEO', 'REVISIONS', 'ESTREV', 'ANALYSTS', 'TARGETS'], name: 'Analyst estimates & revisions', cat: 'Equity', sec: true,
  help: 'REV — EPS estimates now vs 7/30/90 days ago, who raised or cut, price targets, rating changes. REV WATCH or REV PORT: the same for every stock on your list',
  run(ctx) {
    ctx.el.innerHTML = '<div class="empty">Analyst estimates need real data. Switch with <kbd>MODE LIVE</kbd> (Meridian has to be running from its icon).</div>';
  },
  live(ctx) {
    const E = ctx.engine;
    const a0 = String(ctx.args[0] || '').toUpperCase();
    if (a0 === 'WATCH' || a0 === 'PORT') return list(ctx, a0);
    const s = ctx.sec;
    if (s.cls !== 'EQ' || s.etf) {
      ctx.el.innerHTML = `<div class="empty">Analyst estimates are for company stocks (${esc(s.sym)} isn't one).</div>`;
      return;
    }
    const wait = el('div', 'empty', 'Loading analyst data from Yahoo Finance…');
    ctx.el.appendChild(wait);
    let gone = false;
    Promise.allSettled([E.details(s.sym), E.profile(s.sym)]).then(([d, p]) => {
      if (gone) return;
      wait.remove();
      const det = d.status === 'fulfilled' ? d.value : null;
      const prof = p.status === 'fulfilled' ? p.value : null;
      if (!det && !prof) {
        ctx.el.innerHTML = `<div class="empty">Couldn't load analyst data: ${esc(d.reason?.message || p.reason?.message || 'unknown error')}</div>`;
        return;
      }
      const ests = det?.estimates || [];
      const sig = revisionSignal(currentYear(det));
      const px = s.last;
      const upside = fin(prof?.targetMean) ? prof.targetMean / px - 1 : null;
      const tr = prof?.trend;
      const nTr = tr ? tr.strongBuy + tr.buy + tr.hold + tr.sell + tr.strongSell : 0;
      const bar = tr && nTr ? [['Strong buy', tr.strongBuy, 'up'], ['Buy', tr.buy, 'up'], ['Hold', tr.hold, 'dim'], ['Sell', tr.sell, 'down'], ['Strong sell', tr.strongSell, 'down']] : null;
      ctx.el.innerHTML = `
        <div class="port-head">
          <div><span class="dim">Estimates are</span><b class="${sig?.cls || 'dim'}">${sig ? sig.word : 'n/a'}</b></div>
          <div><span class="dim">Current-year EPS, 30 days</span><b>${sig ? cell(sig.d30) : NA}</b></div>
          <div><span class="dim">Raised / cut (30 days)</span><b>${sig ? `<span class="up">${sig.up}</span> / <span class="down">${sig.down}</span>` : NA}</b></div>
          <div><span class="dim">Consensus</span><b>${esc(prof?.recKey ? prof.recKey.replace(/_/g, ' ') : 'n/a')}${fin(prof?.recMean) ? ` <span class="dim">${num(prof.recMean, 2)}</span>` : ''}</b></div>
          <div><span class="dim">Mean target</span><b>${fin(prof?.targetMean) ? `${num(prof.targetMean, 2)} <span class="${upside >= 0 ? 'up' : 'down'}">${upside > 0 ? '+' : ''}${num(upside * 100, 1)}%</span>` : NA}</b></div>
          <div><span class="dim">Target range</span><b>${fin(prof?.targetLow) && fin(prof?.targetHigh) ? `${num(prof.targetLow, 0)} – ${num(prof.targetHigh, 0)}` : NA}</b></div>
          <div><span class="dim">Analysts</span><b>${fin(prof?.analysts) ? prof.analysts : NA}</b></div>
        </div>
        <div class="pane"><h3>EPS estimate and how it moved ${help('eps')}</h3>${ests.length ? `<div class="tbl-wrap"><table class="tbl compact"><thead><tr><th class="l">Period</th><th class="r" title="Average estimate today">Now</th><th class="r">7d ago</th><th class="r">30d ago</th><th class="r">60d ago</th><th class="r">90d ago</th><th class="r" title="Change in the average estimate over 30 days">Δ 30d</th><th class="r">Δ 90d</th><th class="r" title="Analysts who raised / cut their estimate in the last 30 days">Raised / cut</th><th class="r">Analysts</th><th class="r" title="Lowest to highest estimate">Range</th></tr></thead><tbody>
          ${ests.map((e) => { const t = e.trend || {}; const r = e.revisions || {}; const now = fin(t.now) ? t.now : e.eps?.avg; return `<tr><td class="l">${esc(PERIODS[e.period] || e.period)} <span class="dim small">${esc(e.end || '')}</span></td><td class="r"><b>${fin(now) ? num(now, 2) : NA}</b></td>${['d7', 'd30', 'd60', 'd90'].map((k) => `<td class="r dim">${fin(t[k]) ? num(t[k], 2) : '—'}</td>`).join('')}<td class="r">${cell(chgPct(now, t.d30))}</td><td class="r">${cell(chgPct(now, t.d90))}</td><td class="r">${fin(r.up30) || fin(r.down30) ? `<span class="up">${r.up30 ?? 0}</span> / <span class="down">${r.down30 ?? 0}</span>` : '—'}</td><td class="r dim">${e.eps?.analysts ?? '—'}</td><td class="r dim">${fin(e.eps?.low) && fin(e.eps?.high) ? `${num(e.eps.low, 2)} – ${num(e.eps.high, 2)}` : '—'}</td></tr>`; }).join('')}
          </tbody></table></div>` : '<p class="note">Yahoo lists no EPS estimates for this company.</p>'}</div>
        <div class="split2">
          ${bar ? `<div class="pane"><h3>Ratings now (${nTr} analysts)</h3><table class="tbl compact"><tbody>${bar.map(([l, n, c]) => `<tr><td class="l">${l}</td><td class="r ${c}">${n}</td><td class="l"><span class="bar ${c === 'dim' ? 'flat' : c}" style="display:inline-block;height:8px;width:${(n / nTr) * 100}%;min-width:${n ? 2 : 0}px"></span></td></tr>`).join('')}</tbody></table></div>` : ''}
          <div class="pane"><h3>Latest rating changes</h3>${prof?.actions?.length ? `<table class="tbl compact"><tbody>${prof.actions.slice(0, 12).map((a) => { const act = String(a.action || '').toLowerCase(); const c = /up/.test(act) ? 'up' : /down/.test(act) ? 'down' : 'dim'; return `<tr><td class="l dim">${new Date(a.t).toISOString().slice(0, 10)}</td><td class="l">${esc(a.firm || '')}</td><td class="l ${c}">${esc(a.from ? `${a.from} → ${a.to}` : a.to || '')}</td><td class="l dim small">${esc(act === 'up' ? 'upgrade' : act === 'down' ? 'downgrade' : act === 'main' ? 'maintains' : act === 'init' ? 'initiates' : act === 'reit' ? 'reiterates' : act)}${a.target > 0 ? ` · target ${num(a.target, 0)}` : ''}</td></tr>`; }).join('')}</tbody></table>` : '<p class="note">No recent rating changes listed.</p>'}</div>
        </div>
        <p class="note">"Estimates are <b>Rising</b>" = the average current-year EPS estimate is more than 1% above its level 30 days ago and at least as many analysts raised as cut; <b>Falling</b> is the mirror image. Rising estimates tend to go with rising prices, but a lot is already in the price: it's one input, not a signal to trade. Figures come from Yahoo Finance's consensus of the analysts it tracks (not every analyst), so individual analysts' estimates aren't available. Price targets are opinions that often lag the price. Open <kbd>${esc(s.sym)} ANLY</kbd> for the recommendation view, <kbd>${esc(s.sym)} EPS</kbd> for earnings history, <kbd>REV WATCH</kbd> for your whole list.</p>`;
    });
    return { destroy: () => { gone = true; } };
  },
});

// REV WATCH / REV PORT: one row per stock on the list
function list(ctx, which) {
  const E = ctx.engine;
  const syms = which === 'WATCH' ? store(`watch:${E.mode}`, E.defaults.watch) : Object.keys(loadBook(E).positions);
  const stocks = syms.map((x) => E.get(x)).filter((i) => i && i.cls === 'EQ' && !i.etf);
  if (!stocks.length) {
    ctx.el.innerHTML = `<div class="empty">No company stocks on your ${which === 'WATCH' ? 'watchlist' : 'portfolio'} yet.</div>`;
    return;
  }
  const state = new Map(stocks.map((i) => [i.sym, { state: 'loading' }]));
  const host = el('div', 'revlist');
  ctx.el.appendChild(host);
  let gone = false;
  const draw = () => {
    const rows = stocks.map((i) => {
      const x = state.get(i.sym);
      if (x.state === 'loading') return { i, key: -Infinity, html: `<tr><td class="l">${secLink(i)}</td><td class="l dim" colspan="9">loading…</td></tr>` };
      if (x.state === 'failed') return { i, key: -Infinity, html: `<tr><td class="l">${secLink(i)}</td><td class="l dim" colspan="9">${esc(x.error)}</td></tr>` };
      const e = currentYear(x.det);
      const sig = revisionSignal(e);
      const t = e?.trend;
      const up = fin(x.prof?.targetMean) ? x.prof.targetMean / i.last - 1 : null;
      return { i, key: sig?.d30 ?? -1, html: `<tr><td class="l">${secLink(i)}</td><td class="r">${num(i.last, i.dp)}</td><td class="r">${fin(t?.now) ? num(t.now, 2) : NA}</td><td class="r">${cell(chgPct(t?.now, t?.d30))}</td><td class="r">${cell(chgPct(t?.now, t?.d90))}</td><td class="r">${sig ? `<span class="up">${sig.up}</span> / <span class="down">${sig.down}</span>` : '—'}</td><td class="l ${sig?.cls || 'dim'}">${sig ? sig.word : 'n/a'}</td><td class="l dim">${esc(x.prof?.recKey ? x.prof.recKey.replace(/_/g, ' ') : 'n/a')}</td><td class="r">${cell(up)}</td></tr>` };
    }).sort((a, b) => b.key - a.key);
    const done = [...state.values()].filter((x) => x.state !== 'loading').length;
    host.innerHTML = `<p class="note">${which === 'WATCH' ? 'Your watchlist' : 'Your portfolio'}, sorted by how much the current-year EPS estimate moved in 30 days${done < stocks.length ? ` (loading ${done} of ${stocks.length}…)` : ''}. Long ideas tend to sit at the top with rising estimates, short ideas at the bottom with falling ones. One input among many.</p>
      <div class="tbl-wrap"><table class="tbl compact"><thead><tr><th class="l">Ticker</th><th class="r">Price</th><th class="r" title="Average estimate for the current year">EPS est.</th><th class="r">Δ 30d</th><th class="r">Δ 90d</th><th class="r" title="Analysts who raised / cut in 30 days">Raised / cut</th><th class="l">Estimates</th><th class="l">Consensus</th><th class="r" title="Mean price target vs price">Target</th></tr></thead><tbody>${rows.map((r) => r.html).join('')}</tbody></table></div>`;
  };
  draw();
  (async () => {
    const queue = [...stocks];
    await Promise.all([0, 1, 2].map(async () => {
      while (queue.length && !gone) {
        const i = queue.shift();
        const [d, p] = await Promise.allSettled([E.details(i.sym), E.profile(i.sym)]);
        state.set(i.sym, d.status === 'fulfilled' || p.status === 'fulfilled' ? { state: 'ok', det: d.value || null, prof: p.value || null } : { state: 'failed', error: d.reason?.message || 'no data' });
        if (!gone) draw();
      }
    }));
  })();
  return { destroy: () => { gone = true; } };
}

// ---------------------------------------------------------------------------------------------
// CRED

// [key, label, help id, lower is better?, thresholds [strong, ok, watch], format, formula]
const SCORE = ['Weak', 'Watch', 'OK', 'Strong'];
const SCLS = ['down', 'down', '', 'up'];
function grade(v, [a, b, c], lowerBetter) {
  if (!fin(v)) return null;
  if (lowerBetter) return v < a ? 3 : v < b ? 2 : v < c ? 1 : 0;
  return v >= a ? 3 : v >= b ? 2 : v >= c ? 1 : 0;
}

export function creditScorecard(years, details) {
  const q = qualityRows(years, false);
  const y = years[years.length - 1];
  const r = q[q.length - 1];
  const old = q[Math.max(0, q.length - 4)];
  const debt = y.debt;
  const nd = fin(y.netDebt) ? y.netDebt : fin(debt) && fin(y.cashAll) ? debt - y.cashAll : null;
  const m = [];
  const add = (key, label, value, text, g, rule, formula) => m.push({ key, label, value, text, g, rule, formula });
  // leverage
  if (fin(nd) && nd <= 0) add('lev', 'Net debt / EBITDA', nd, 'net cash', 3, 'below 1× strong · below 2.5× OK · below 4× watch · else weak', '(debt − cash) ÷ EBITDA');
  else if (fin(nd) && fin(y.ebitda) && y.ebitda <= 0) add('lev', 'Net debt / EBITDA', null, 'EBITDA is not positive', 0, 'below 1× strong · below 2.5× OK · below 4× watch · else weak', '(debt − cash) ÷ EBITDA');
  else add('lev', 'Net debt / EBITDA', r.netDebtEbitda, fin(r.netDebtEbitda) ? `${num(r.netDebtEbitda, 1)}×` : null, grade(r.netDebtEbitda, [1, 2.5, 4], true), 'below 1× strong · below 2.5× OK · below 4× watch · else weak', '(debt − cash) ÷ EBITDA');
  // interest cover
  if (fin(r.coverage)) add('cov', 'Interest cover (EBIT / interest)', r.coverage, `${num(r.coverage, 1)}×`, grade(r.coverage, [10, 5, 2], false), '10× or more strong · 5× OK · 2× watch · else weak', 'Operating income ÷ interest expense');
  else add('cov', 'Interest cover (EBIT / interest)', null, fin(y.interest) && y.interest === 0 ? 'no interest expense' : null, fin(y.interest) && y.interest === 0 ? 3 : null, '10× or more strong · 5× OK · 2× watch · else weak', 'Operating income ÷ interest expense');
  // cash flow vs debt
  const fcfDebt = fin(y.fcf) && fin(debt) && debt > 0 ? y.fcf / debt : null;
  add('fcf', 'Free cash flow / debt', fcfDebt, fin(fcfDebt) ? `${num(fcfDebt * 100, 0)}%` : fin(debt) && debt === 0 ? 'no debt' : null, fin(debt) && debt === 0 ? 3 : grade(fcfDebt, [0.4, 0.2, 0.1], false), '40% or more strong · 20% OK · 10% watch · else weak (negative cash flow is weak)', '(operating cash flow − capex) ÷ total debt');
  // cash vs debt
  const cashDebt = fin(y.cashAll) && fin(debt) && debt > 0 ? y.cashAll / debt : null;
  add('cash', 'Cash / debt', cashDebt, fin(cashDebt) ? `${num(cashDebt * 100, 0)}%` : fin(debt) && debt === 0 ? 'no debt' : null, fin(debt) && debt === 0 ? 3 : grade(cashDebt, [1, 0.5, 0.2], false), '100% or more strong · 50% OK · 20% watch · else weak', 'Cash and short-term investments ÷ total debt');
  // debt / equity
  const de = fin(debt) && fin(y.equity) ? (y.equity > 0 ? debt / y.equity : null) : null;
  add('de', 'Debt / equity', de, fin(de) ? `${num(de, 2)}×` : fin(y.equity) && y.equity <= 0 ? 'equity is negative' : null, fin(y.equity) && y.equity <= 0 ? 0 : grade(de, [0.5, 1.5, 3], true), 'below 0.5× strong · below 1.5× OK · below 3× watch · else weak', 'Total debt ÷ shareholders\' equity');
  // liquidity
  const cr = details?.stats?.currentRatio;
  add('cr', 'Current ratio (liquidity)', cr, fin(cr) ? `${num(cr, 2)}×` : null, grade(cr, [1.5, 1.0, 0.8], false), '1.5× or more strong · 1.0× OK · 0.8× watch · else weak', 'Current assets ÷ current liabilities (Yahoo, latest quarter)');
  const scored = m.filter((x) => x.g != null);
  const avg = scored.length ? scored.reduce((a, x) => a + x.g, 0) / scored.length : null;
  const overall = scored.length < 3 ? null : avg >= 2.5 ? 'Strong' : avg >= 1.75 ? 'Solid' : avg >= 1 ? 'Watch' : 'Weak';
  const trend = fin(r.netDebtEbitda) && fin(old?.netDebtEbitda) && old !== r ? { from: old.netDebtEbitda, to: r.netDebtEbitda, fy: old.fy } : null;
  return { m, overall, avg, n: scored.length, fy: y.fy, trend, q };
}

register({
  code: 'CRED', aliases: ['CREDIT', 'DEBT', 'LEVERAGE', 'SOLVENCY'], name: 'Credit health (debt safety)', cat: 'Equity', sec: true,
  help: 'CRED — how safe the company\'s debt looks from its filings: leverage, interest cover, cash flow and cash against debt, liquidity. Not a credit rating.',
  run(ctx) {
    ctx.el.innerHTML = '<div class="empty">Credit health needs real company data. Switch with <kbd>MODE LIVE</kbd> (Meridian has to be running from its icon).</div>';
  },
  live(ctx) {
    const E = ctx.engine;
    const s = ctx.sec;
    if (s.cls !== 'EQ' || s.etf) {
      ctx.el.innerHTML = `<div class="empty">Credit health is for company stocks (${esc(s.sym)} isn't one).</div>`;
      return;
    }
    const wait = el('div', 'empty', 'Loading the company\'s filings…');
    ctx.el.appendChild(wait);
    let gone = false;
    Promise.all([E.valuation(s.sym), E.details(s.sym).catch(() => null)]).then(([v, det]) => {
      if (gone) return;
      wait.remove();
      if (v.currencyMismatch) {
        ctx.el.innerHTML = `<div class="empty">${esc(v.currencyMismatch)}</div>`;
        return;
      }
      if (v.financial) {
        const q = qualityRows(v.years, true);
        const r = q[q.length - 1];
        ctx.el.innerHTML = `<div class="empty">${esc(s.sym)} is a bank or insurer, and a leverage scorecard built on debt, EBITDA and free cash flow doesn't fit it: its debt and deposits are its raw material. Banks are judged on capital, asset quality and funding, which the filings Meridian reads don't fully cover. What is available (FY${r.fy}): common equity / assets ${fin(r.equityToAssets) ? pct(r.equityToAssets, 1).replace('+', '') : 'n/a'}, return on equity ${fin(r.roe) ? pct(r.roe, 1).replace('+', '') : 'n/a'}, efficiency ratio ${fin(r.efficiency) ? pct(r.efficiency, 0).replace('+', '') : 'n/a'}. Open <kbd>${esc(s.sym)} QUAL</kbd> for the full bank figures and <kbd>${esc(s.sym)} VAL</kbd> for P/B.</div>`;
        return;
      }
      const c = creditScorecard(v.years, det);
      ctx.el.innerHTML = `
        <div class="port-head">
          <div><span class="dim">Credit health (FY${c.fy})</span><b class="${c.overall === 'Strong' || c.overall === 'Solid' ? 'up' : c.overall ? 'down' : 'dim'}">${c.overall || 'n/a'}</b></div>
          <div><span class="dim">Measures scored</span><b>${c.n} of ${c.m.length}</b></div>
          <div><span class="dim">Net debt / EBITDA, ${c.trend ? `FY${c.trend.fy} → FY${c.fy}` : 'trend'}</span><b>${c.trend ? `${num(c.trend.from, 1)}× → ${num(c.trend.to, 1)}× <span class="${c.trend.to < c.trend.from ? 'up' : 'down'}">${c.trend.to < c.trend.from ? 'improving' : 'worsening'}</span>` : NA}</b></div>
        </div>
        <div class="pane"><h3>Scorecard</h3><div class="tbl-wrap"><table class="tbl compact"><thead><tr><th class="l">Measure</th><th class="r">Value</th><th class="l">Verdict</th><th class="l">Rule of thumb</th></tr></thead><tbody>
          ${c.m.map((x) => `<tr><td class="l" title="${esc(x.formula)}">${esc(x.label)}</td><td class="r">${x.text ? esc(x.text) : NA}</td><td class="l ${x.g == null ? 'dim' : SCLS[x.g]}">${x.g == null ? 'n/a' : SCORE[x.g]}</td><td class="l dim small">${esc(x.rule)}</td></tr>`).join('')}
        </tbody></table></div></div>
        <div class="pane"><h3>Five years</h3><div class="tbl-wrap"><table class="tbl compact"><thead><tr><th class="l">Fiscal year</th>${c.q.slice(-5).map((r) => `<th class="r">FY${r.fy}</th>`).join('')}</tr></thead><tbody>
          ${[['Net debt / EBITDA', 'netDebtEbitda', (x) => `${num(x, 1)}×`], ['Interest cover', 'coverage', (x) => `${num(x, 1)}×`], ['Free cash flow / net income', 'fcfToNi', (x) => `${num(x, 2)}×`]].map(([l, k, f]) => `<tr><td class="l">${l}</td>${c.q.slice(-5).map((r) => `<td class="r">${fin(r[k]) ? f(r[k]) : '<span class="dim">—</span>'}</td>`).join('')}</tr>`).join('')}
          <tr><td class="l">Total debt</td>${c.q.slice(-5).map((r) => `<td class="r">${fin(r._y.debt) ? big(r._y.debt) : '<span class="dim">—</span>'}</td>`).join('')}</tr>
          <tr><td class="l">Cash and short-term investments</td>${c.q.slice(-5).map((r) => `<td class="r">${fin(r._y.cashAll) ? big(r._y.cashAll) : '<span class="dim">—</span>'}</td>`).join('')}</tr>
        </tbody></table></div></div>
        <p class="note"><b>This is not a credit rating.</b> The overall word is the average of the scored measures (Strong 3 · OK 2 · Watch 1 · Weak 0; at least three needed): Strong at 2.5 or more, Solid at 1.75, Watch at 1.0, otherwise Weak. The rules of thumb are common yardsticks, not laws: capital-hungry industries carry more debt than software firms, and one weak measure can be harmless. It uses last fiscal year's filings, so recent borrowing isn't included. What it can't see: debt maturities, covenants, off-balance-sheet obligations, and the market's view. Agency ratings (S&amp;P, Moody's), bond prices, credit spreads and CDS are paid data Meridian doesn't have. Hover a measure for its formula. Sources: ${esc(v.source || 'SEC / Yahoo / Finnhub')}.</p>`;
    }, (err) => {
      if (!gone) { wait.remove(); ctx.el.innerHTML = `<div class="empty">Couldn't load the filings: ${esc(err.message)}</div>`; }
    });
    return { destroy: () => { gone = true; } };
  },
});
