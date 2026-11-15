// PREVIEW: what to expect from a company's next earnings report, on one screen.
//   - when it reports and what analysts expect (EPS and revenue, with the range between them)
//   - how often it beat its estimate over the last 8 quarters
//   - how its share price actually moved around its past reports (from the user's own price history)
// The moves are measured over two trading days around the SEC filing date, because the SEC doesn't say
// whether the results came before the open or after the close; the screen says so. Nothing here predicts
// the next move: it shows what happened before, so a company that usually moves 8% is not a surprise at 8%.

import { register } from '../registry.js';
import { num, big, esc, el, dir } from '../fmt.js';
import { deferred } from './live-fns.js';
import { reactions, normalMove, pairUp, beatRecord, moveStats } from '../earnings-data.js';

const needsReal = (ctx) => {
  ctx.el.innerHTML = '<div class="empty">The earnings preview needs real company data. Switch with <kbd>MODE LIVE</kbd> (Meridian has to be running from its icon).</div>';
};
const dateOf = (sec) => (sec ? new Date(sec * 1000).toISOString().slice(0, 10) : '—');
const sgn = (x, dp = 1) => (x == null ? '—' : `${x > 0 ? '+' : ''}${num(x * 100, dp)}%`);
const NAMES = { '0q': 'this quarter', '+1q': 'next quarter' };

// The 5-year price history loads in the background; wait for it (up to 25 s).
function waitBars(E, sym) {
  return new Promise((resolve) => {
    let tries = 0;
    const tick = () => {
      const b = E.longHistory(sym, '5y');
      if (b || ++tries > 80) return resolve(b || null);
      setTimeout(tick, 300);
    };
    tick();
  });
}

/** Plain-English reading of the numbers; says what the data does and does not show. */
export function reading(sym, beats, ms, normal) {
  const out = [];
  if (beats) {
    const word = beats.beat === beats.n ? 'every one of' : `${beats.beat} of`;
    out.push(`${sym} beat its EPS estimate in ${word} the last ${beats.n} quarters${beats.avgSurprise != null ? `, by ${num(beats.avgSurprise * 100, 1)}% on average` : ''}. Companies are good at guiding analysts down, so beating is the usual outcome (about 3 in 4 S&P 500 companies do) and a beat alone is not news.`);
  }
  if (ms) {
    out.push(`Around its last ${ms.n} reports the share price moved ${num(ms.avgAbs * 100, 1)}% on average in either direction${ms.ratio ? `, ${num(ms.ratio, 1)}× a normal two-day move` : ''}. It rose after ${Math.round(ms.upShare * ms.n)} of ${ms.n}.`);
    if (ms.beats.n >= 3 && ms.beats.up / ms.beats.n < 0.7) out.push(`Even after beats the stock rose only ${ms.beats.up} of ${ms.beats.n} times: the price reacts to the outlook and to how much was already expected, not to the beat itself.`);
  }
  return out;
}

register({
  code: 'PREVIEW', aliases: ['EARNPREV', 'EPV', 'ERNP'], name: 'Earnings preview', cat: 'Equity', sec: true,
  help: 'PREVIEW — next report date, analyst estimates, beat rate over 8 quarters and the typical price move around reports (real data)',
  run: needsReal,
  live(ctx) {
    const s = ctx.sec;
    const E = ctx.engine;
    if (s.cls !== 'EQ' || s.etf) {
      ctx.el.innerHTML = `<div class="empty">An earnings preview is only available for company stocks (${esc(s.sym)} isn't one).</div>`;
      return;
    }
    const all = Promise.all([
      E.details(s.sym),
      E.reportDates(s.sym).catch((err) => ({ dates: [], error: err.message })),
      waitBars(E, s.sym),
    ]);
    return deferred(ctx, all, ([d, rd, bars]) => {
      const beats = beatRecord(d.earnings, 8);
      const dates = rd.dates || [];
      const reacts = bars && dates.length ? reactions(bars, dates) : [];
      const normal = bars ? normalMove(bars, reacts) : null;
      const rows = pairUp(d.earnings, reacts, dates).slice(0, 8);
      const ms = moveStats(rows, normal);
      const est = (p) => d.estimates.find((t) => t.period === p);
      const q = est('0q') || est('+1q');
      const next = s.earnings?.date ? `<b>${esc(s.earnings.date)}</b> <span class="dim">${esc(s.earnings.when || '')}</span>` : '<span class="dim">not announced yet</span>';
      const cells = [
        ['Next report', next],
        ['EPS expected', q ? `<b>${num(q.eps.avg, 2)}</b> <span class="dim small">${num(q.eps.low, 2)}–${num(q.eps.high, 2)} · ${num(q.eps.analysts, 0)} analysts</span>` : '<span class="dim">n/a</span>'],
        ['vs. a year ago', q && q.eps.yearAgo ? `<b class="${dir(q.eps.avg - q.eps.yearAgo)}">${sgn(q.eps.avg / q.eps.yearAgo - 1)}</b> <span class="dim small">(${num(q.eps.yearAgo, 2)})</span>` : '<span class="dim">n/a</span>'],
        ['Revenue expected', q?.revenue?.avg ? `<b>${big(q.revenue.avg)}</b>` : '<span class="dim">n/a</span>'],
        ['Beat rate', beats ? `<b class="${beats.beat / beats.n >= 0.5 ? 'up' : 'down'}">${beats.beat} of ${beats.n}</b> <span class="dim small">${beats.streak ? `${beats.streak} in a row` : 'last one missed or matched'}</span>` : '<span class="dim">n/a</span>'],
        ['Typical move', ms ? `<b>±${num(ms.avgAbs * 100, 1)}%</b> <span class="dim small">${ms.ratio ? `${num(ms.ratio, 1)}× a normal two-day move` : ''}</span>` : '<span class="dim">n/a</span>'],
        ['Price range', ms && s.last ? `<b>${num(s.last * (1 - ms.avgAbs), 2)}–${num(s.last * (1 + ms.avgAbs), 2)}</b> <span class="dim small">if it moves the usual amount</span>` : '<span class="dim">n/a</span>'],
      ];
      const head = el('div', 'port-head', cells.map(([k, v]) => `<div><span class="dim">${k}${q && k === 'EPS expected' ? ` <span class="small">(${NAMES[q.period] || q.period})</span>` : ''}</span>${v}</div>`).join(''));
      ctx.el.appendChild(head);

      const why = !dates.length ? `Report dates aren't available${rd.error ? `: ${esc(rd.error)}` : ''}, so the price moves can't be measured.` : !bars ? 'The 5-year price history did not load, so the price moves cannot be measured.' : !reacts.length ? 'The price history doesn\'t cover those report dates.' : '';
      const body = el('div', 'pane');
      body.innerHTML = `<h3>The last ${rows.length || (d.earnings || []).length} reports</h3>
        ${rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th class="l">Reported</th><th class="l">Quarter</th><th class="r">Estimate</th><th class="r">Actual</th><th class="r">Surprise</th><th class="r" title="Close before the report date to the close after the next trading day">Price move (2 days)</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td class="l">${esc(r.date)}</td><td class="l dim">${dateOf(r.quarter).slice(0, 7)}</td><td class="r">${num(r.estimate, 2)}</td><td class="r">${num(r.actual, 2)}</td><td class="r ${dir(r.surprise)}">${sgn(r.surprise)}</td><td class="r ${dir(r.move)}">${sgn(r.move)}</td></tr>`).join('')}
        </tbody></table></div>` : `<p class="note">${beats ? 'Reported EPS and estimates are in <kbd>EPS</kbd>.' : 'No earnings history is available for this stock.'}</p>`}
        ${why ? `<p class="note warn">${why}</p>` : ''}
        ${reading(s.sym, beats, ms, normal).map((t) => `<p class="note">${esc(t)}</p>`).join('')}
        <p class="note">Estimates and EPS: Yahoo Finance (Finnhub when Yahoo is limited). Report dates: the company's 8-K filings with the results (SEC). The price move runs from the close before the report date to the close after the next trading day, because the SEC doesn't say whether results came before the open or after the close: it contains the reaction either way, plus about one ordinary day. It describes what happened before. It does not forecast the next report. Beat and miss are against analysts' consensus, which companies help set; the full history is in <kbd>${esc(s.sym)} EPS</kbd>.</p>`;
      ctx.el.appendChild(body);
      return null;
    });
  },
});
