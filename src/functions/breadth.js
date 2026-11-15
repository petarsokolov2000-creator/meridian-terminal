// BREADTH: how many stocks are making new 52-week highs and lows, how many sit above their 20, 50
// and 200-day averages, and how many rose today: the health of the whole market rather than one
// stock. Everything is worked out from the daily prices Meridian already has loaded (about one year
// for each of its built-in stocks), so "new high" means above the highest price of that year.
// All-time records need the full price history, which isn't loaded for every stock: open
// <ticker> CHART MAX to see one.

import { register } from '../registry.js';
import { pct, num, secLink, esc, el } from '../fmt.js';
import { XYChart } from '../chart.js';
import { smaOf, hiLoOf } from '../metrics.js';

const REGIONS = ['US', 'EU', 'ASIA', 'ALL'];
const NEAR = 0.03; // "near" a high or low = within 3%

function stats(E, region) {
  const list = E.equities.filter((i) => !i.etf && i.history?.length >= 60 && Number.isFinite(i.last) && (region === 'ALL' || i.region === region));
  const rows = list.map((i) => {
    const hl = hiLoOf(i);
    const s20 = smaOf(i, 20);
    const s50 = smaOf(i, 50);
    const s200 = smaOf(i, 200);
    return { i, hl, a20: s20 != null ? i.last > s20 : null, a50: s50 != null ? i.last > s50 : null, a200: s200 != null ? i.last > s200 : null, pct: i.pct };
  });
  const share = (k) => {
    const have = rows.filter((r) => r[k] != null);
    return have.length ? have.filter((r) => r[k]).length / have.length : null;
  };
  return {
    rows,
    n: rows.length,
    up: rows.filter((r) => r.pct > 0).length,
    down: rows.filter((r) => r.pct < 0).length,
    flat: rows.filter((r) => !(r.pct > 0) && !(r.pct < 0)).length,
    a20: share('a20'), a50: share('a50'), a200: share('a200'),
    highs: rows.filter((r) => r.hl?.state === 'high'),
    lows: rows.filter((r) => r.hl?.state === 'low'),
    nearHigh: rows.filter((r) => r.hl && r.hl.state !== 'high' && r.hl.offHigh >= -NEAR).sort((a, b) => b.hl.offHigh - a.hl.offHigh),
    nearLow: rows.filter((r) => r.hl && r.hl.state !== 'low' && r.hl.aboveLow <= NEAR).sort((a, b) => a.hl.aboveLow - b.hl.aboveLow),
  };
}

/** Share of stocks above their own 50-day average on each of the last `days` dates. */
function aboveSeries(E, region, days = 120) {
  const by = new Map(); // date -> [above, total]
  for (const i of E.equities) {
    if (i.etf || (region !== 'ALL' && i.region !== region)) continue;
    const h = i.history || [];
    if (h.length < 60) continue;
    let sum = 0;
    for (let k = 0; k < h.length; k++) {
      sum += h[k].c;
      if (k >= 50) sum -= h[k - 50].c;
      if (k >= 49) {
        const slot = by.get(h[k].t) || [0, 0];
        slot[1]++;
        if (h[k].c > sum / 50) slot[0]++;
        by.set(h[k].t, slot);
      }
    }
  }
  const dates = [...by.keys()].sort();
  const need = Math.max(5, Math.floor(Math.max(...[...by.values()].map((v) => v[1]), 0) * 0.6)); // skip days most stocks didn't trade
  return dates.map((t) => ({ t, v: by.get(t) })).filter((d) => d.v[1] >= need).slice(-days).map((d) => ({ t: d.t, p: d.v[0] / d.v[1] }));
}

const tone = (p) => (p == null ? 'dim' : p >= 0.6 ? 'up' : p <= 0.4 ? 'down' : '');
const P0 = (v) => (v == null ? '<span class="dim">n/a</span>' : `${Math.round(v * 100)}%`);

register({
  code: 'BREADTH', aliases: ['HILO', 'NHNL', 'MBR', 'BRD', 'HIGHS', 'LOWS', 'RECORDS'], name: 'Highs, lows & market breadth', cat: 'Markets',
  help: 'BREADTH [US|EU|ASIA|ALL] — new 52-week highs and lows, % of stocks above their 20/50/200-day average, advancers vs decliners, by sector',
  run(ctx) {
    const E = ctx.engine;
    let region = REGIONS.find((r) => ctx.args.some((a) => String(a).toUpperCase() === r)) || 'US';
    const bar = el('div', 'toolbar');
    const body = el('div', 'brd');
    ctx.el.append(bar, body);
    const draw = () => (bar.innerHTML = REGIONS.map((r) => `<button class="tb ${r === region ? 'on' : ''}" data-r="${r}">${r}</button>`).join('') + '<span class="dim small"> stocks Meridian has loaded</span>');
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('[data-r]');
      if (b) { region = b.dataset.r; draw(); build(); }
    });
    draw();

    let chart;
    let series = [];
    let host;
    let tables;
    let kpi;
    let note;
    function build() {
      chart?.destroy();
      body.innerHTML = '';
      kpi = el('div', 'port-head');
      const ch = el('div', 'pane', '<h3>Share of stocks above their 50-day average (last 120 trading days)</h3>');
      host = el('div', 'chart-host short');
      ch.appendChild(host);
      tables = el('div', 'split2');
      note = el('p', 'note');
      body.append(kpi, ch, tables, note);
      series = aboveSeries(E, region);
      chart = new XYChart(host);
      update();
    }

    function update() {
      const s = stats(E, region);
      if (!s.n) {
        body.innerHTML = `<div class="empty">No stocks with enough price history for ${esc(region)}.</div>`;
        return;
      }
      const net = s.highs.length - s.lows.length;
      kpi.innerHTML = [
        ['Stocks', s.n],
        ['Up today', `${s.up} <span class="dim">/ ${s.down} down</span>`, s.up >= s.down ? 'up' : 'down'],
        ['New 52W highs', s.highs.length, 'up'],
        ['New 52W lows', s.lows.length, 'down'],
        ['Highs − lows', `${net > 0 ? '+' : ''}${net}`, net > 0 ? 'up' : net < 0 ? 'down' : ''],
        ['Above 20-day', P0(s.a20), tone(s.a20)],
        ['Above 50-day', P0(s.a50), tone(s.a50)],
        ['Above 200-day', P0(s.a200), tone(s.a200)],
      ].map(([k, v, c = '']) => `<div><span class="dim">${k}</span><b class="${c}">${v}</b></div>`).join('');

      if (series.length > 5) {
        const pts = series.map((d, k) => ({ x: k, y: d.p * 100 }));
        if (s.a50 != null) pts[pts.length - 1] = { x: pts.length - 1, y: s.a50 * 100 }; // today, with live prices
        chart.setData({
          series: [
            { points: pts, line: true, width: 2 },
            { points: [{ x: 0, y: 50 }, { x: pts.length - 1, y: 50 }], line: true, dash: [4, 4], color: '#888', width: 1 },
          ],
          xFmt: (v) => series[Math.max(0, Math.min(series.length - 1, Math.round(v)))]?.t.slice(5) ?? '',
          yFmt: (v) => `${Math.round(v)}%`, xLabel: '', yLabel: '% above 50-day',
        });
      }

      const list = (title, cls, rows, key) => `<div class="pane"><h3 class="${cls}">${title}</h3>${rows.length ? `<table class="tbl compact"><thead><tr><th class="l">Ticker</th><th class="r">Last</th><th class="r">Today</th><th class="r">${key === 'hi' ? 'Off high' : 'Above low'}</th></tr></thead><tbody>${rows.slice(0, 15).map((r) => `<tr><td class="l">${secLink(r.i)}${r.hl.state ? ' <span class="tag">NEW</span>' : ''}</td><td class="r">${num(r.i.last, r.i.dp)}</td><td class="r ${r.pct >= 0 ? 'up' : 'down'}">${pct(r.pct)}</td><td class="r dim">${key === 'hi' ? pct(r.hl.offHigh, 1) : pct(r.hl.aboveLow, 1)}</td></tr>`).join('')}</tbody></table>${rows.length > 15 ? `<p class="dim small">${rows.length - 15} more not shown</p>` : ''}` : '<p class="dim small">None.</p>'}</div>`;
      const hi = [...s.highs.sort((a, b) => b.pct - a.pct), ...s.nearHigh];
      const lo = [...s.lows.sort((a, b) => a.pct - b.pct), ...s.nearLow];
      const sectors = [...new Set(s.rows.map((r) => r.i.sector))].sort().map((sec) => {
        const m = s.rows.filter((r) => r.i.sector === sec);
        const a50 = m.filter((r) => r.a50 != null);
        return { sec, n: m.length, up: m.filter((r) => r.pct > 0).length / m.length, a50: a50.length ? a50.filter((r) => r.a50).length / a50.length : null, h: m.filter((r) => r.hl?.state === 'high').length, l: m.filter((r) => r.hl?.state === 'low').length };
      });
      tables.innerHTML = list(`At or near 52-week highs (within ${NEAR * 100}%)`, 'up', hi, 'hi') + list(`At or near 52-week lows (within ${NEAR * 100}%)`, 'down', lo, 'lo')
        + `<div class="pane wide"><h3>By sector</h3><table class="tbl compact"><thead><tr><th class="l">Sector</th><th class="r">Stocks</th><th class="r">Up today</th><th class="r">Above 50-day</th><th class="r">New highs</th><th class="r">New lows</th></tr></thead><tbody>${sectors.map((x) => `<tr><td class="l">${esc(x.sec)}</td><td class="r dim">${x.n}</td><td class="r ${tone(x.up)}">${P0(x.up)}</td><td class="r ${tone(x.a50)}">${P0(x.a50)}</td><td class="r up">${x.h || '<span class="dim">0</span>'}</td><td class="r down">${x.l || '<span class="dim">0</span>'}</td></tr>`).join('')}</tbody></table></div>`;
      note.innerHTML = 'A <b>new 52-week high</b> here means today\'s price is above the highest price of the past year loaded (about 250 trading days), a new low the opposite. Many new highs and most stocks above their averages = a broad, healthy market; a rising index with few stocks above their averages = a narrow one, which often comes before weakness (a tendency, not a rule). <b>All-time records</b> need the full price history, which isn\'t loaded for every stock: open <kbd>&lt;ticker&gt; CHART MAX</kbd>. Counts cover the stocks Meridian has loaded for the region, not every listed company.';
    }
    build();
    return { update, every: 5, destroy: () => chart?.destroy() };
  },
});
