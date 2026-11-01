// BT: test a simple trading rule on a security's past prices and compare it with buying and
// holding. Long-only, all-in or all-out. A signal is read at a day's close and traded at the
// next day's open (never with hindsight), paying a fee on every buy and sell.

import { register } from '../registry.js';
import { num, dir, esc, el, store, save } from '../fmt.js';
import { XYChart } from '../chart.js';
import { sma, rsi } from '../studies.js';

export const STRATEGIES = {
  trend: {
    label: 'Above moving average', short: 'TREND',
    params: [['n', 'Average (days)', 50, 5, 400]],
    explain: (p) => `Own it while the price closes above its ${p.n}-day average; sell when it closes below.`,
    // returns, for each bar, true (want to own), false (want cash) or null (no signal yet)
    signal(c, p) {
      const m = sma(c, p.n);
      return c.map((x, i) => (m[i] == null ? null : x > m[i]));
    },
  },
  cross: {
    label: 'Moving-average cross', short: 'CROSS',
    params: [['fast', 'Fast average', 50, 2, 300], ['slow', 'Slow average', 200, 5, 400]],
    explain: (p) => `Own it while the ${p.fast}-day average is above the ${p.slow}-day average (a "golden cross"); sell on the opposite cross.`,
    signal(c, p) {
      const f = sma(c, p.fast);
      const s = sma(c, p.slow);
      return c.map((_, i) => (f[i] == null || s[i] == null ? null : f[i] > s[i]));
    },
  },
  rsi: {
    label: 'RSI dip buying', short: 'RSI',
    params: [['lo', 'Buy below RSI', 30, 5, 50], ['hi', 'Sell above RSI', 70, 50, 95]],
    explain: (p) => `Buy when the 14-day RSI drops below ${p.lo} (oversold); sell when it rises above ${p.hi} (overbought).`,
    signal(c, p) {
      const r = rsi(c, 14);
      let want = false;
      return c.map((_, i) => {
        if (r[i] == null) return null;
        if (r[i] < p.lo) want = true;
        else if (r[i] > p.hi) want = false;
        return want;
      });
    },
  },
  breakout: {
    label: 'Breakout', short: 'BREAK',
    params: [['up', 'Buy at new high of (days)', 20, 5, 250], ['down', 'Sell at new low of (days)', 10, 3, 250]],
    explain: (p) => `Buy when the price closes above its highest close of the previous ${p.up} days; sell when it closes below its lowest close of the previous ${p.down} days.`,
    signal(c, p) {
      let want = false;
      const need = Math.max(p.up, p.down);
      return c.map((x, i) => {
        if (i < need) return null;
        const hi = Math.max(...c.slice(i - p.up, i));
        const lo = Math.min(...c.slice(i - p.down, i));
        if (x > hi) want = true;
        else if (x < lo) want = false;
        return want;
      });
    },
  },
};

/** Runs `strategy` over daily (or weekly) bars {t, o, c}. Returns the equity curves, trades and stats. */
export function backtest(bars, strategy, params, { fee = 0.001, capital = 10000 } = {}) {
  const c = bars.map((b) => b.c);
  const sig = STRATEGIES[strategy].signal(c, params);
  const start = sig.findIndex((s) => s != null);
  if (start < 0 || start >= bars.length - 1) return null;
  // Both curves start on the same day: the first day the rule has a signal.
  let cash = capital;
  let shares = 0;
  let entry = null;
  const trades = [];
  const equity = [];
  const hold = [];
  const holdShares = capital / c[start];
  let inMarket = 0;
  for (let i = start; i < bars.length; i++) {
    // yesterday's close decided what to do at today's open
    if (i > start) {
      const want = sig[i - 1];
      const open = bars[i].o > 0 ? bars[i].o : c[i - 1];
      if (want && !shares) {
        shares = (cash * (1 - fee)) / open;
        entry = { i, t: bars[i].t, px: open, cost: cash };
        cash = 0;
      } else if (!want && shares) {
        cash = shares * open * (1 - fee);
        trades.push({ in: entry.t, inPx: entry.px, out: bars[i].t, outPx: open, ret: cash / entry.cost - 1, bars: i - entry.i });
        shares = 0;
        entry = null;
      }
    }
    if (shares) inMarket++;
    equity.push({ t: bars[i].t, v: cash + shares * c[i] });
    hold.push({ t: bars[i].t, v: holdShares * c[i] });
  }
  const last = bars.length - 1;
  if (entry) trades.push({ in: entry.t, inPx: entry.px, out: null, outPx: c[last], ret: (shares * c[last]) / entry.cost - 1, bars: last - entry.i, open: true });

  const days = (Date.parse(bars[last].t) - Date.parse(bars[start].t)) / 86400e3;
  const years = Math.max(days / 365.25, 1 / 365.25);
  const perYear = (equity.length - 1) / years; // ~252 for daily bars, ~52 for weekly
  const stats = (curve) => {
    const v = curve.map((p) => p.v);
    const total = v[v.length - 1] / v[0] - 1;
    let peak = v[0];
    let mdd = 0;
    for (const x of v) {
      peak = Math.max(peak, x);
      mdd = Math.min(mdd, x / peak - 1);
    }
    const r = v.slice(1).map((x, i) => x / v[i] - 1);
    const mean = r.reduce((a, b) => a + b, 0) / (r.length || 1);
    const sd = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, r.length - 1));
    return {
      total, cagr: years >= 1 ? (1 + total) ** (1 / years) - 1 : null, mdd,
      vol: sd * Math.sqrt(perYear), sharpe: sd > 0 ? (mean / sd) * Math.sqrt(perYear) : null, end: v[v.length - 1],
    };
  };
  const closed = trades.filter((t) => !t.open);
  return {
    start: bars[start].t, end: bars[last].t, years, weekly: perYear < 120,
    equity, hold, trades,
    strat: { ...stats(equity), trades: trades.length, winRate: closed.length ? closed.filter((t) => t.ret > 0).length / closed.length : null, exposure: inMarket / equity.length, best: trades.length ? Math.max(...trades.map((t) => t.ret)) : null, worst: trades.length ? Math.min(...trades.map((t) => t.ret)) : null },
    bench: stats(hold),
  };
}

const RANGES = { '1Y': null, '2Y': '2y', '5Y': '5y', MAX: 'max' };
const pc = (v, dp = 1) => (v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${num(v * 100, dp)}%`);
const money = (v) => (v == null ? '—' : `$${num(v, 0)}`);

register({
  code: 'BT', aliases: ['BACKTEST', 'BTST'], name: 'Strategy backtest', cat: 'Analytics', sec: true,
  help: 'BT [TREND|CROSS|RSI|BREAK] [1Y|2Y|5Y|MAX] — test a trading rule on past prices against buy & hold',
  run(ctx) {
    const E = ctx.engine;
    const s = ctx.sec;
    const saved = store('bt', {});
    const st = { strategy: saved.strategy in STRATEGIES ? saved.strategy : 'trend', range: E.longHistory ? saved.range || '5Y' : '1Y', fee: saved.fee ?? 0.1, params: saved.params || {} };
    for (const a of ctx.args.map((x) => x.toUpperCase())) {
      const k = Object.keys(STRATEGIES).find((key) => STRATEGIES[key].short === a || key.toUpperCase() === a);
      if (k) st.strategy = k;
      if (a in RANGES && (a === '1Y' || E.longHistory)) st.range = a;
    }
    const paramsOf = (k) => Object.fromEntries(STRATEGIES[k].params.map(([id, , def, lo, hi]) => [id, Math.min(hi, Math.max(lo, Math.round(Number(st.params[k]?.[id] ?? def)) || def))]));
    const persist = () => save('bt', st);

    const bar = el('div', 'toolbar');
    const form = el('div', 'bt-form');
    const head = el('div', 'port-head');
    const host = el('div', 'chart-host bt-chart');
    const note = el('p', 'note');
    const trades = el('div', 'tbl-wrap bt-trades');
    ctx.el.append(bar, form, head, host, note, trades);
    ctx.el.classList.add('bt');
    const chart = new XYChart(host);
    const btn = (k, label, on) => `<button class="tb ${on ? 'on' : ''}" data-k="${k}">${label}</button>`;

    const drawBar = () => {
      bar.innerHTML = Object.entries(STRATEGIES).map(([k, d]) => btn(`s:${k}`, d.label, st.strategy === k)).join('') + '<span class="sep"></span>' +
        Object.keys(RANGES).filter((r) => r === '1Y' || E.longHistory).map((r) => btn(`r:${r}`, r, st.range === r)).join('');
      const p = paramsOf(st.strategy);
      form.innerHTML = STRATEGIES[st.strategy].params.map(([id, label, , lo, hi]) => `<label>${esc(label)} <input type="number" inputmode="numeric" data-p="${id}" min="${lo}" max="${hi}" value="${p[id]}"></label>`).join('') +
        `<label>Fee per trade % <input type="number" inputmode="decimal" data-fee step="0.05" min="0" max="2" value="${st.fee}"></label>`;
    };
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('[data-k]');
      if (!b) return;
      const [kind, v] = b.dataset.k.split(':');
      if (kind === 's') st.strategy = v;
      if (kind === 'r') st.range = v;
      persist();
      drawBar();
      run();
    });
    form.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.p) {
        st.params[st.strategy] = { ...paramsOf(st.strategy), [t.dataset.p]: Number(t.value) };
        t.value = paramsOf(st.strategy)[t.dataset.p];
      }
      if ('fee' in t.dataset) st.fee = Math.min(2, Math.max(0, Number(t.value) || 0));
      persist();
      run();
    });

    let lastKey = '';
    const bars = () => {
      const year = E.daily(s.sym);
      if (!RANGES[st.range]) return { bars: year, loading: false };
      const long = E.longHistory(s.sym, RANGES[st.range]);
      return long ? { bars: [...long, year[year.length - 1]], loading: false } : { bars: year, loading: true };
    };
    const run = (force = true) => {
      const { bars: data, loading } = bars();
      const p = paramsOf(st.strategy);
      const key = `${st.strategy}:${JSON.stringify(p)}:${st.fee}:${st.range}:${data.length}:${loading}`;
      if (!force && key === lastKey) return;
      lastKey = key;
      const r = data.length > 30 ? backtest(data, st.strategy, p, { fee: st.fee / 100 }) : null;
      if (!r) {
        head.innerHTML = '';
        chart.setData({ series: [] });
        note.innerHTML = loading ? 'Loading price history…' : `Not enough history for this rule: it needs more days than the ${data.length} available. Pick a shorter average or a longer range.`;
        trades.innerHTML = '';
        return;
      }
      const a = r.strat;
      const b = r.bench;
      const beat = a.total - b.total;
      const cell = (k, v, cls = '') => `<div><span class="dim">${k}</span><b class="${cls}">${v}</b></div>`;
      head.innerHTML = [
        cell('Strategy return', pc(a.total), dir(a.total)), cell('Buy & hold', pc(b.total), dir(b.total)), cell('Difference', pc(beat), dir(beat)),
        cell('$10,000 became', `${money(a.end)} <span class="dim">vs ${money(b.end)}</span>`),
        a.cagr == null ? '' : cell('Per year', `${pc(a.cagr)} <span class="dim">vs ${pc(b.cagr)}</span>`),
        cell('Worst drop', `${pc(a.mdd)} <span class="dim">vs ${pc(b.mdd)}</span>`, 'down'),
        cell('Sharpe', `${a.sharpe == null ? '—' : num(a.sharpe, 2)} <span class="dim">vs ${b.sharpe == null ? '—' : num(b.sharpe, 2)}</span>`),
        cell('Trades', `${a.trades}${a.winRate == null ? '' : ` · ${num(a.winRate * 100, 0)}% won`}`),
        cell('Time invested', `${num(a.exposure * 100, 0)}%`),
      ].join('');
      const t0 = Date.parse(r.start);
      const X = (t) => (Date.parse(t) - t0) / (365.25 * 86400e3);
      const pts = (curve) => curve.map((q) => ({ x: X(q.t), y: q.v }));
      const y0 = new Date(r.start).getUTCFullYear();
      chart.setData({
        series: [
          { name: `${STRATEGIES[st.strategy].label}`, line: true, dots: false, width: 2, points: pts(r.equity) },
          { name: 'Buy & hold', line: true, dots: false, dash: [4, 3], points: pts(r.hold) },
        ],
        xFmt: (v) => (r.years > 3 ? String(Math.round(y0 + v)) : new Date(t0 + v * 365.25 * 86400e3).toISOString().slice(0, 7)),
        yFmt: (v) => (v >= 1e5 ? `$${num(v / 1000, 0)}k` : `$${num(v, 0)}`), yLabel: 'Value of $10,000',
      });
      note.innerHTML = `${esc(STRATEGIES[st.strategy].explain(p))} ${esc(s.sym)}, ${r.start} to ${r.end}${r.weekly ? ' (weekly prices)' : ''}. ` +
        'Trades happen at the next open after a signal, with the fee on each buy and sell. Prices exclude dividends (buy & hold would earn them too), taxes and slippage. Past results don\'t predict future ones.';
      const rows = r.trades.slice().reverse().slice(0, 200);
      trades.innerHTML = rows.length ? `<table class="tbl"><thead><tr><th class="l">Bought</th><th class="r">Price</th><th class="l">Sold</th><th class="r">Price</th><th class="r">Return</th><th class="r">${r.weekly ? 'Weeks' : 'Days'} held</th></tr></thead><tbody>
        ${rows.map((t) => `<tr><td class="l">${t.in}</td><td class="r">${num(t.inPx, s.dp)}</td><td class="l">${t.open ? '<span class="dim">still open</span>' : t.out}</td><td class="r">${num(t.outPx, s.dp)}</td><td class="r ${dir(t.ret)}">${pc(t.ret)}</td><td class="r">${t.bars}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">The rule never bought in this period.</div>';
    };
    drawBar();
    run();
    return { update: () => run(false), every: 5, destroy: () => chart.destroy() };
  },
});
