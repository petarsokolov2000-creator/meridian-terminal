// MARS: how risky is the portfolio (PORT)? Long and short exposure, beta-adjusted exposure, how much
// it could lose in a day (historical Value-at-Risk), what each position contributes to the risk,
// and a few stress tests.
//
// The method is plain historical simulation: take TODAY's positions, replay the last year of daily
// price changes through them, and look at the worst days of that replay. It assumes the past year
// is a fair guide (it isn't in a crisis the year didn't contain), counts price moves only (no
// currency moves, no costs), and says nothing about what the stock will do tomorrow.

import { register } from '../registry.js';
import { num, big, pct, signed, secLink, esc, el } from '../fmt.js';
import { XYChart } from '../chart.js';
import { loadBook, fxToUsd } from './tools.js';
import { mean, stdev } from '../metrics.js';

const MIN_DAYS = 60;

/**
 * pos: [{ sym, qty, fx, beta, series: Map(date -> close) }]  (qty < 0 = short)
 * Returns the risk numbers, or { error } if there isn't enough price history.
 */
export function riskModel(pos, nav) {
  const dates = [...new Set(pos.flatMap((p) => [...p.series.keys()]))].sort().slice(-261);
  if (dates.length < MIN_DAYS) return { error: `only ${dates.length} days of price history, need ${MIN_DAYS}` };
  // forward-fill each close so a closed market counts as "no move"
  const filled = pos.map((p) => {
    let last = null;
    return dates.map((d) => {
      const v = p.series.get(d);
      if (v != null) last = v;
      return last;
    });
  });
  // USD profit/loss of each position on each day, with today's quantities
  const pnl = pos.map((p, k) => dates.slice(1).map((_, d) => {
    const a = filled[k][d];
    const b = filled[k][d + 1];
    return a == null || b == null ? 0 : p.qty * p.fx * (b - a);
  }));
  const total = dates.slice(1).map((_, d) => pnl.reduce((a, row) => a + row[d], 0));
  const sorted = [...total].sort((a, b) => a - b);
  const q = (frac) => sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor(frac * sorted.length)))];
  const var95 = -q(0.05);
  const var99 = -q(0.01);
  const tail = sorted.filter((x) => x <= q(0.05));
  const es95 = tail.length ? -mean(tail) : var95;
  let cum = 0;
  let peak = 0;
  let maxDd = 0;
  const curve = total.map((x) => {
    cum += x;
    peak = Math.max(peak, cum);
    maxDd = Math.max(maxDd, peak - cum);
    return cum;
  });
  const worstI = total.indexOf(sorted[0]);
  const bestI = total.indexOf(sorted[sorted.length - 1]);
  let worst5 = 0;
  for (let d = 0; d + 5 <= total.length; d++) worst5 = Math.min(worst5, total.slice(d, d + 5).reduce((a, b) => a + b, 0));
  const varT = (stdev(total) || 0) ** 2;
  const rows = pos.map((p, k) => {
    const mv = p.qty * p.fx * (p.series.get(dates[dates.length - 1]) ?? [...p.series.values()].pop());
    const s = [...pnl[k]].sort((a, b) => a - b);
    const covWithTotal = (() => {
      const mp = mean(pnl[k]);
      const mt = mean(total);
      return pnl[k].reduce((a, x, d) => a + (x - mp) * (total[d] - mt), 0) / (total.length - 1);
    })();
    return { sym: p.sym, mv, beta: p.beta, betaAssumed: p.betaAssumed, vol: (stdev(pnl[k].map((x) => (mv ? x / Math.abs(mv) : 0))) || 0) * Math.sqrt(252), var95: -s[Math.floor(0.05 * s.length)], share: varT > 0 ? covWithTotal / varT : 0 };
  });
  const long = rows.filter((r) => r.mv > 0).reduce((a, r) => a + r.mv, 0);
  const short = -rows.filter((r) => r.mv < 0).reduce((a, r) => a + r.mv, 0);
  const longBook = dates.slice(1).map((_, d) => pnl.reduce((a, row, k) => a + (pos[k].qty > 0 ? row[d] : 0), 0));
  const shortBook = dates.slice(1).map((_, d) => pnl.reduce((a, row, k) => a + (pos[k].qty < 0 ? row[d] : 0), 0));
  const corr = (() => {
    const a = stdev(longBook);
    const b = stdev(shortBook);
    if (!a || !b) return null;
    const ma = mean(longBook);
    const mb = mean(shortBook);
    return longBook.reduce((s, x, d) => s + (x - ma) * (shortBook[d] - mb), 0) / (longBook.length - 1) / (a * b);
  })();
  return {
    days: total.length, from: dates[0], to: dates[dates.length - 1],
    long, short, gross: long + short, net: long - short, nav,
    betaNet: rows.reduce((a, r) => a + r.mv * r.beta, 0),
    var95, var99, es95, var10: var95 * Math.sqrt(10), vol: (stdev(total) || 0) * Math.sqrt(252), maxDd,
    worst: { v: sorted[0], t: dates[worstI + 1] }, best: { v: sorted[sorted.length - 1], t: dates[bestI + 1] }, worst5,
    rows, curve, dates: dates.slice(1), corr, longVol: (stdev(longBook) || 0) * Math.sqrt(252), shortVol: (stdev(shortBook) || 0) * Math.sqrt(252), netVol: (stdev(total) || 0) * Math.sqrt(252),
  };
}

register({
  code: 'MARS', aliases: ['RISK', 'PORTRISK', 'VAR', 'EXPOSURE'], name: 'Portfolio risk & stress tests', cat: 'Trading',
  help: 'MARS — long/short exposure, beta-adjusted exposure, 1-day Value-at-Risk, risk by position and stress tests for your PORT book',
  run(ctx) {
    const E = ctx.engine;
    const head = el('div', 'port-head');
    const chartPane = el('div', 'pane', '<h3>What the last year would have done to today\'s positions (cumulative profit/loss)</h3>');
    const host = el('div', 'chart-host short');
    chartPane.appendChild(host);
    const body = el('div', 'mars');
    ctx.el.append(head, chartPane, body);
    const chart = new XYChart(host);

    const update = () => {
      const book = loadBook(E);
      const held = Object.entries(book.positions).map(([sym, p]) => ({ sym, p, i: E.get(sym) })).filter((x) => x.i && x.i.history?.length);
      if (!held.length) {
        head.innerHTML = '';
        chartPane.hidden = true;
        body.innerHTML = '<div class="empty">No positions yet. Buy with <kbd>BUY AAPL 100</kbd>, short with <kbd>SELL TSLA 50</kbd> (selling more than you hold opens a short). Then MARS shows the risk.</div>';
        return;
      }
      chartPane.hidden = false;
      const spx = E.get('SPX');
      const pos = held.map(({ sym, p, i }) => {
        const bars = E.daily(sym);
        const beta = Number.isFinite(i.histBeta) ? i.histBeta : null;
        return { sym, qty: p.q, fx: fxToUsd(E, i.ccy), beta: beta ?? (i.cls === 'EQ' ? 1 : 0), betaAssumed: beta == null && i.cls === 'EQ', series: new Map(bars.map((b) => [b.t, b.c])) };
      });
      const inv = held.reduce((a, { p, i }) => a + p.q * i.last * fxToUsd(E, i.ccy), 0);
      const nav = book.cash + inv;
      const m = riskModel(pos, nav);
      if (m.error) {
        head.innerHTML = '';
        chartPane.hidden = true;
        body.innerHTML = `<div class="empty">Not enough price history to measure the risk: ${esc(m.error)}.</div>`;
        return;
      }
      const P = (v) => `${num((v / nav) * 100, 1)}%`;
      head.innerHTML = [
        ['NAV', num(nav, 0)],
        ['Long', `${num(m.long, 0)} <span class="dim">${P(m.long)}</span>`],
        ['Short', `${num(m.short, 0)} <span class="dim">${P(m.short)}</span>`],
        ['Gross', `${num(m.gross, 0)} <span class="dim">${num(m.gross / nav, 2)}×</span>`],
        ['Net', `${signed(m.net, 0)} <span class="dim">${P(m.net)}</span>`, m.net >= 0 ? 'up' : 'down'],
        [`Beta-adj. net${spx ? '' : ' (no index)'}`, `${signed(m.betaNet, 0)} <span class="dim">${P(m.betaNet)}</span>`, m.betaNet >= 0 ? 'up' : 'down'],
        ['1-day VaR 95%', `${num(m.var95, 0)} <span class="dim">${P(m.var95)}</span>`, 'down'],
        ['1-day VaR 99%', `${num(m.var99, 0)} <span class="dim">${P(m.var99)}</span>`, 'down'],
        ['Volatility / yr', `${num((m.vol / nav) * 100, 1)}%`],
        ['Worst drawdown', `${num(m.maxDd, 0)} <span class="dim">${P(m.maxDd)}</span>`, 'down'],
      ].map(([k, v, c = '']) => `<div><span class="dim">${k}</span><b class="${c}">${v}</b></div>`).join('');

      chart.setData({
        series: [{ points: m.curve.map((y, x) => ({ x, y })), line: true, dots: false, width: 2 }],
        xFmt: (v) => m.dates[Math.max(0, Math.min(m.dates.length - 1, Math.round(v)))]?.slice(5) ?? '',
        yFmt: (v) => signed(v, 0), xLabel: `${m.from} to ${m.to}`, yLabel: 'USD', zeroLine: true,
      });

      const rows = [...m.rows].sort((a, b) => Math.abs(b.mv) - Math.abs(a.mv));
      const top3 = rows.slice(0, 3).reduce((a, r) => a + Math.abs(r.mv), 0) / (m.gross || 1);
      const shocks = [-0.2, -0.1, -0.05, 0.1];
      body.innerHTML = `
        <div class="pane"><h3>Risk by position</h3><div class="tbl-wrap"><table class="tbl compact"><thead><tr><th class="l">Ticker</th><th class="l">Side</th><th class="r">Value</th><th class="r">% NAV</th><th class="r" title="Moves with the market: 1 = same, 2 = twice as much">Beta</th><th class="r" title="Annual volatility of the position">Vol</th><th class="r" title="Worst-5%-of-days loss of this position alone">1d VaR 95%</th><th class="r" title="Share of the whole portfolio's day-to-day swings that comes from this position. Negative = it hedges the rest.">Share of risk</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td class="l">${secLink(E.get(r.sym))}</td><td class="l ${r.mv >= 0 ? 'up' : 'down'}">${r.mv >= 0 ? 'Long' : 'Short'}</td><td class="r">${num(r.mv, 0)}</td><td class="r dim">${P(r.mv)}</td><td class="r" ${r.betaAssumed ? 'title="Beta not available: 1 assumed"' : ''}>${num(r.beta, 2)}${r.betaAssumed ? '*' : ''}</td><td class="r dim">${num(r.vol * 100, 0)}%</td><td class="r">${num(r.var95, 0)}</td><td class="r ${r.share < 0 ? 'up' : ''}">${num(r.share * 100, 0)}%</td></tr>`).join('')}
        </tbody></table></div></div>
        <div class="split2">
          <div class="pane"><h3>Stress tests (profit/loss in USD)</h3><table class="tbl compact"><tbody>
            ${shocks.map((s) => { const v = m.betaNet * s; return `<tr><td class="l">Market ${s > 0 ? '+' : '−'}${Math.abs(s * 100)}% <span class="dim small">(beta-weighted)</span></td><td class="r ${v >= 0 ? 'up' : 'down'}">${signed(v, 0)}</td><td class="r dim">${P(v)}</td></tr>`; }).join('')}
            <tr><td class="l">Worst day of the replay <span class="dim small">${esc(m.worst.t)}</span></td><td class="r down">${signed(m.worst.v, 0)}</td><td class="r dim">${P(m.worst.v)}</td></tr>
            <tr><td class="l">Worst 5 days in a row</td><td class="r down">${signed(m.worst5, 0)}</td><td class="r dim">${P(m.worst5)}</td></tr>
            <tr><td class="l">Best day of the replay <span class="dim small">${esc(m.best.t)}</span></td><td class="r up">${signed(m.best.v, 0)}</td><td class="r dim">${P(m.best.v)}</td></tr>
            <tr><td class="l">10-day VaR 95% <span class="dim small">(1-day × √10)</span></td><td class="r down">${num(m.var10, 0)}</td><td class="r dim">${P(m.var10)}</td></tr>
            <tr><td class="l">Average loss on the worst 5% of days</td><td class="r down">${num(m.es95, 0)}</td><td class="r dim">${P(m.es95)}</td></tr>
          </tbody></table></div>
          <div class="pane"><h3>Long book vs short book</h3><table class="tbl compact"><tbody>
            <tr><td class="l">Long book volatility / yr</td><td class="r">${num((m.longVol / nav) * 100, 1)}%</td></tr>
            <tr><td class="l">Short book volatility / yr</td><td class="r">${num((m.shortVol / nav) * 100, 1)}%</td></tr>
            <tr><td class="l">Whole portfolio volatility / yr</td><td class="r">${num((m.netVol / nav) * 100, 1)}%</td></tr>
            <tr><td class="l">Correlation of the two books' daily P&amp;L</td><td class="r">${m.corr == null ? '<span class="dim">n/a (needs both)</span>' : num(m.corr, 2)}</td></tr>
            <tr><td class="l">Three biggest positions, share of gross</td><td class="r ${top3 > 0.6 ? 'down' : ''}">${num(top3 * 100, 0)}%</td></tr>
          </tbody></table>
          <p class="note">A shorts' P&amp;L moves opposite to the stock, so a hedge shows a <b>negative correlation</b> between the books. If both books move together (correlation near +1), the shorts aren't hedging the longs.</p></div>
        </div>
        <p class="note">Method: your <b>current</b> positions replayed through ${m.days} days of real daily price changes (${esc(m.from)} to ${esc(m.to)}); VaR 95% = the loss that was exceeded on 5% of those days. <b>This is a look back, not a forecast</b>: a year without a crash will understate crash risk, the shape of the tail is not captured, and short positions can lose more than they were worth. Price moves only: no currency moves, dividends, borrowing costs or trading costs. Beta is each stock's own 1-year beta against the S&amp;P 500${rows.some((r) => r.betaAssumed) ? ' (* = not available, 1 assumed)' : ''}. Not investment advice.</p>`;
    };
    update();
    return { update, every: 10, destroy: () => chart.destroy() };
  },
});
