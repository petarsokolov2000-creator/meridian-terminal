// MACRO: the US economy on one screen. The yield curve (does the bond market expect trouble?), then the
// official indicators from FRED, each with one plain sentence on what its level usually means for stocks.
//
// The curve needs no key. The indicators need a free FRED key (FRED <key>). The sentences are rules of
// thumb, not forecasts (see src/macro-data.js). FRED publishes no meeting calendar, so the date of the next
// Fed meeting is not shown here: it is on federalreserve.gov.

import { register } from '../registry.js';
import { num, esc, el } from '../fmt.js';
import { curveReading, read, tally, TONE_WORD } from '../macro-data.js';

const bp = (x) => (x == null || !Number.isFinite(x) ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(Math.round(x * 100))}`);
const cls = (x, flip) => (x == null || Math.abs(x) < 0.005 ? 'dim' : (x > 0) !== !!flip ? 'up' : 'down');
const TONE_CLS = { good: 'up', mid: 'dim', bad: 'down' };
const GROUPS = ['Inflation', 'Labor', 'Growth', 'Housing', 'Rates', 'Energy'];

function curveSvg(pts) {
  const W = 300;
  const H = 110;
  const pad = 22;
  const xs = pts.map((p) => Math.sqrt(p.years)); // spread the short end out
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const ys = pts.flatMap((p) => [p.y, p.mo]);
  const lo = Math.min(...ys) - 0.15;
  const hi = Math.max(...ys) + 0.15;
  const X = (p) => pad + ((Math.sqrt(p.years) - x0) / (x1 - x0 || 1)) * (W - 2 * pad);
  const Y = (v) => H - 18 - ((v - lo) / (hi - lo || 1)) * (H - 34);
  const line = (key) => pts.map((p) => `${X(p).toFixed(1)},${Y(p[key]).toFixed(1)}`).join(' ');
  return `<svg class="mc-curve" viewBox="0 0 ${W} ${H}" role="img" aria-label="Yield curve now and a month ago">
    <polyline points="${line('mo')}" fill="none" stroke="var(--dim)" stroke-width="1.5" stroke-dasharray="3 3"/>
    <polyline points="${line('y')}" fill="none" stroke="var(--accent, #ffb000)" stroke-width="2"/>
    ${pts.map((p) => `<circle cx="${X(p).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="3" fill="var(--accent, #ffb000)"/><text x="${X(p).toFixed(1)}" y="${H - 4}" text-anchor="middle" font-size="9" fill="var(--dim)">${esc(p.tenor)}</text><text x="${X(p).toFixed(1)}" y="${(Y(p.y) - 6).toFixed(1)}" text-anchor="middle" font-size="9" fill="var(--fg, #ddd)">${num(p.y, 2)}</text>`).join('')}
  </svg>`;
}

register({
  code: 'MACRO', aliases: ['ECONOMY', 'MACROD', 'MAC'], name: 'Macro dashboard', cat: 'Markets',
  help: 'MACRO — the yield curve and the main US economic numbers, each with one sentence on what it means for stocks (the numbers need a free FRED key: FRED <key>)',
  run(ctx) {
    ctx.el.innerHTML = '<div class="empty">The macro dashboard needs real rates and economic data. Switch with <kbd>MODE LIVE</kbd> (Meridian has to be running from its icon).</div>';
  },
  live(ctx) {
    const E = ctx.engine;
    const host = el('div');
    ctx.el.appendChild(host);
    const today = new Date().toISOString().slice(0, 10);

    const draw = () => {
      const pts = E.curve('US') || [];
      const cv = pts.length ? curveReading(pts) : { error: 'No US yields are loaded yet.' };
      const rows = E.fred.economy;
      const byId = new Map((rows || []).map((r) => [r.id, r]));
      const t = tally(rows, cv);
      const total = t.good + t.mid + t.bad;
      const val = (r, u) => (r?.actual == null ? '—' : `${num(r.actual, Math.abs(r.actual) >= 100 ? 0 : 2)}${u === '%' ? '%' : u === 'K' ? 'K' : ''}`);
      const card = (k, v) => `<div><span class="dim">${k}</span>${v}</div>`;
      const head = [];
      if (!cv.error) {
        head.push(card(`Yield curve (${cv.name})`, `<b class="${cv.tone === 'bad' ? 'down' : cv.tone === 'good' ? 'up' : ''}">${bp(cv.main.now)} bp</b> <span class="dim small">${cv.state}</span>`));
        head.push(card('10-year yield', `<b>${num(pts.find((p) => p.tenor === '10Y')?.y, 2)}%</b>`));
      }
      for (const [id, k] of [['UNRATE', 'Unemployment'], ['CPIAUCSL', 'Inflation (YoY)'], ['FEDFUNDS', 'Fed funds rate']]) {
        const r = byId.get(id);
        if (r && !r.error) head.push(card(k, `<b>${val(r, '%')}</b>`));
      }
      if (rows && total) head.push(card('Readings', `<b class="up">${t.good}</b> <span class="dim small">supportive</span> <b>${t.mid}</b> <span class="dim small">mixed</span> <b class="down">${t.bad}</b> <span class="dim small">worrying</span>`));

      const curvePane = cv.error
        ? `<div class="pane"><h3>Yield curve</h3><p class="note">${esc(cv.error)}</p></div>`
        : `<div class="pane"><h3>Yield curve (US Treasuries)</h3>
          <div class="split2"><div>${curveSvg(pts)}<p class="note"><span style="color:var(--accent,#ffb000)">━</span> today · <span class="dim">╌</span> a month ago</p></div>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th class="l">Maturity</th><th class="r">Yield</th><th class="r" title="basis points: 100 bp = 1 percentage point">Day bp</th><th class="r">Week bp</th><th class="r">Month bp</th></tr></thead><tbody>
          ${pts.map((p) => `<tr><td class="l">${esc(p.tenor)}</td><td class="r">${num(p.y, 3)}%</td><td class="r ${cls(p.y - p.prev)}">${bp(p.y - p.prev)}</td><td class="r ${cls(p.y - p.wk)}">${bp(p.y - p.wk)}</td><td class="r ${cls(p.y - p.mo)}">${bp(p.y - p.mo)}</td></tr>`).join('')}
          </tbody></table></div></div>
          <p class="note ${cv.tone === 'bad' ? 'warn' : ''}"><b>${esc(cv.name)}: ${bp(cv.main.now)} bp.</b> ${esc(cv.text)}</p>
          ${cv.s210 && cv.s103 ? `<p class="note">The 10-year minus 3-month gap (the one the New York Fed uses for recession odds) is ${bp(cv.s103.now)} bp; 10-year minus 2-year is ${bp(cv.s210.now)} bp.</p>` : ''}</div>`;

      let econ;
      if (!E.fred.configured) {
        econ = '<div class="pane"><h3>Economy</h3><p class="note warn">The economic numbers need a free FRED key: sign up at fredaccount.stlouisfed.org/apikeys, then type <kbd>FRED yourkey</kbd>. The key stays on this device. Until then only the yield curve above is shown.</p></div>';
      } else if (!rows) {
        econ = `<div class="pane"><h3>Economy</h3><p class="note">${E.fred.error ? `FRED didn't load: ${esc(E.fred.error)}` : 'Loading official data from FRED…'}</p></div>`;
      } else {
        econ = GROUPS.map((g) => {
          const gr = rows.filter((r) => r.group === g);
          if (!gr.length) return '';
          return `<div class="pane"><h3>${g}</h3><div class="tbl-wrap"><table class="tbl mc-tbl"><thead><tr><th class="l">Indicator</th><th class="r">Latest</th><th class="r">Prior</th><th class="l">What it means for stocks</th><th class="l">Next release</th></tr></thead><tbody>
          ${gr.map((r) => {
            if (r.error) return `<tr><td class="l">${esc(r.label)}</td><td class="l dim" colspan="4">${esc(r.error)}</td></tr>`;
            const x = read(r);
            const u = r.unit === '%' ? '%' : r.unit === 'K' ? 'K' : '';
            return `<tr><td class="l" title="${esc(r.release || '')} · period ${esc(r.period || '')}">${esc(r.label)}</td><td class="r"><b>${val(r, u)}</b></td><td class="r dim">${r.prior == null ? '—' : `${num(r.prior, Math.abs(r.prior) >= 100 ? 0 : 2)}${u}`}</td>
              <td class="l mc-read">${x ? `<span class="${TONE_CLS[x.tone]}" title="${TONE_WORD[x.tone]}">●</span> ${esc(x.text)}` : '<span class="dim">no data</span>'}</td>
              <td class="l ${r.nextRelease === today ? 'up' : 'dim'}">${r.nextRelease ? (r.nextRelease === today ? '<b>Today</b>' : esc(r.nextRelease)) : '—'}</td></tr>`;
          }).join('')}</tbody></table></div></div>`;
        }).join('');
      }
      host.innerHTML = `
        ${head.length ? `<div class="port-head">${head.join('')}</div>` : ''}
        ${curvePane}${econ}
        <p class="note">Sources: US Treasury and Yahoo Finance for yields; FRED (Federal Reserve Bank of St. Louis) for the economic numbers, refreshed hourly. The sentences are rules of thumb, not forecasts: they say where a number stands and how markets have usually reacted to that, but markets often move on surprises against what economists expected, and FRED carries no such forecasts. The count of supportive / mixed / worrying readings only tallies those rules. The date of the next Fed meeting is not shown: FRED does not publish it (see federalreserve.gov); the next release dates above are for the data, not for rate decisions.</p>`;
    };
    draw();
    return { update: draw, every: 30 };
  },
});
