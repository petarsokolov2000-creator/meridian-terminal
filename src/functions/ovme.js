// OVME: value an option, or a whole strategy of up to six legs (calls, puts, shares), with the
// Greeks, the profit/loss picture, break-evens and a model estimate of the chance of profit.
//
// This is a model, not a quote: Black-Scholes with ONE volatility for every strike (European
// exercise, a continuous dividend yield). Real options trade at their own implied volatility per
// strike and American options can be exercised early, so type the price you can really get into
// the Price box and the numbers follow it. Option contracts are 100 shares each.

import { register } from '../registry.js';
import { num, esc, el, signed } from '../fmt.js';
import { XYChart } from '../chart.js';
import { bs } from './security.js';

const MULT = 100;
const MAX_LEGS = 6;

function stepFor(p) {
  return p < 5 ? 0.5 : p < 25 ? 1 : p < 100 ? 2.5 : p < 250 ? 5 : p < 1000 ? 10 : 25;
}

// legs: [side (+1 buy / -1 sell), type, strike offset from price, days]
const PRESETS = {
  'long call': { label: 'Long call', legs: [[1, 'C', 0]] },
  'long put': { label: 'Long put', legs: [[1, 'P', 0]] },
  'short put': { label: 'Cash-secured put (sell a put)', legs: [[-1, 'P', -0.05]] },
  'covered call': { label: 'Covered call (shares + sell a call)', legs: [[1, 'S'], [-1, 'C', 0.05]] },
  'protective put': { label: 'Protective put (shares + buy a put)', legs: [[1, 'S'], [1, 'P', -0.05]] },
  collar: { label: 'Collar (shares + put + sell a call)', legs: [[1, 'S'], [1, 'P', -0.05], [-1, 'C', 0.05]] },
  'bull call spread': { label: 'Bull call spread', legs: [[1, 'C', 0], [-1, 'C', 0.05]] },
  'bear put spread': { label: 'Bear put spread', legs: [[1, 'P', 0], [-1, 'P', -0.05]] },
  straddle: { label: 'Long straddle (call + put, same strike)', legs: [[1, 'C', 0], [1, 'P', 0]] },
  strangle: { label: 'Long strangle', legs: [[1, 'C', 0.05], [1, 'P', -0.05]] },
  'iron condor': { label: 'Iron condor (collect premium, range-bound)', legs: [[1, 'P', -0.1], [-1, 'P', -0.05], [-1, 'C', 0.05], [1, 'C', 0.1]] },
};
const ALIAS = { LONGCALL: 'long call', CALL: 'long call', PUT: 'long put', LONGPUT: 'long put', CSP: 'short put', SHORTPUT: 'short put', CC: 'covered call', COVERED: 'covered call', PROTECTIVE: 'protective put', COLLAR: 'collar', BULL: 'bull call spread', BEAR: 'bear put spread', STRADDLE: 'straddle', STRANGLE: 'strangle', CONDOR: 'iron condor', IC: 'iron condor' };

const N = (x) => {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
};

/** Value and Greeks of one option; at zero time left it is just what it's worth if exercised. */
export function optionValue(S, K, days, r, q, v, call) {
  const T = days / 365;
  if (!(T > 1e-9) || !(v > 0)) {
    const intr = call ? Math.max(0, S - K) : Math.max(0, K - S);
    return { price: intr, delta: intr > 0 ? (call ? 1 : -1) : 0, gamma: 0, vega: 0, theta: 0 };
  }
  const g = bs(S, K, T, r, q, v, call);
  return { ...g, theta: g.theta / 365 };
}

/** P&L of the strategy if the price is S after `h` days (legs expiring before h are worth their payoff). */
export function strategyPnl(legs, S, h, p) {
  let total = 0;
  for (const l of legs) {
    if (l.type === 'S') {
      total += l.side * l.qty * (S - l.entry);
      continue;
    }
    const left = Math.max(0, l.days - h);
    const val = optionValue(S, l.strike, left, p.r, p.q, p.v, l.type === 'C').price;
    total += l.side * l.qty * MULT * (val - l.price);
  }
  return total;
}

export function breakevens(f, lo, hi, n = 800) {
  const out = [];
  let prev = f(lo);
  for (let k = 1; k <= n; k++) {
    const x = lo + ((hi - lo) * k) / n;
    const y = f(x);
    if ((prev < 0 && y >= 0) || (prev > 0 && y <= 0)) {
      const x0 = lo + ((hi - lo) * (k - 1)) / n;
      out.push(x0 + ((x - x0) * (0 - prev)) / (y - prev));
    }
    prev = y;
  }
  return out;
}

/** Chance that the strategy ends in profit after h days, if the price follows the lognormal model. */
export function profitChance(f, S, h, p) {
  const T = h / 365;
  if (!(T > 1e-9)) return null;
  let win = 0;
  let tot = 0;
  for (let k = -500; k <= 500; k++) {
    const z = k / 100;
    const w = Math.exp((-z * z) / 2);
    const ST = S * Math.exp((p.r - p.q - (p.v * p.v) / 2) * T + p.v * Math.sqrt(T) * z);
    tot += w;
    if (f(ST) > 0) win += w;
  }
  return win / tot;
}

register({
  code: 'OVME', aliases: ['OPTVAL', 'STRAT', 'STRATEGY', 'OPTCALC'], name: 'Option & strategy valuation', cat: 'Analytics', sec: true,
  help: 'OVME [strategy] — value an option or a strategy (spreads, straddle, iron condor, covered call…): Greeks, profit/loss, break-evens. Strategies: ' + Object.keys(PRESETS).join(', '),
  run(ctx) {
    const s = ctx.sec;
    const E = ctx.engine;
    if (!['EQ', 'IDX', 'CMDTY', 'CRYPTO'].includes(s.cls)) {
      ctx.el.innerHTML = `<div class="empty">Option valuation is for stocks, indices, commodities and crypto, not ${esc(s.sym)}.</div>`;
      return;
    }
    const spot = s.last;
    const step = stepFor(spot);
    const roundK = (x) => Math.max(step, Math.round(x / step) * step);
    const arg = ctx.args.map((a) => String(a).toLowerCase()).join(' ').trim();
    const flat = arg.replace(/[\s-]+/g, '');
    const wantKey = Object.keys(PRESETS).find((k) => k.replace(/\s+/g, '') === flat) || ALIAS[flat.toUpperCase()] || 'bull call spread';
    const tsy = E.get('US3M');
    const p = {
      v: Math.min(2, Math.max(0.05, s.realVol || s.vol || 0.3)),
      r: tsy?.last != null ? tsy.last / 100 : 0.04,
      q: (s.divYield || 0) / 100,
    };
    let legs = [];
    const mk = (side, type, off = 0, days = 30) => {
      const l = { side, type, qty: type === 'S' ? 100 : 1, days, strike: roundK(spot * (1 + off)), entry: spot, price: null, auto: true };
      l.price = type === 'S' ? spot : optionValue(spot, l.strike, days, p.r, p.q, p.v, type === 'C').price;
      return l;
    };
    const load = (key) => { legs = PRESETS[key].legs.map(([side, type, off]) => mk(side, type, off)); };
    load(wantKey);

    const dp = spot < 1 ? 4 : 2;
    const wrap = el('div', 'ovme');
    ctx.el.appendChild(wrap);
    wrap.innerHTML = `
      <div class="ovme-top">
        <label>Strategy <select data-k="preset">${Object.entries(PRESETS).map(([k, v]) => `<option value="${k}" ${k === wantKey ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></label>
        <label>Price <input data-k="spot" type="number" step="any" value="${num(spot, dp).replace(/,/g, '')}" inputmode="decimal"></label>
        <label title="Annual volatility used for every strike. Starts at the stock's own volatility over the past year; the options market may price something else (implied volatility).">Volatility % <input data-k="v" type="number" step="0.5" value="${(p.v * 100).toFixed(1)}" inputmode="decimal"></label>
        <label title="Risk-free rate (US 3-month)">Rate % <input data-k="r" type="number" step="0.05" value="${(p.r * 100).toFixed(2)}" inputmode="decimal"></label>
        <label>Dividend % <input data-k="q" type="number" step="0.1" value="${(p.q * 100).toFixed(2)}" inputmode="decimal"></label>
      </div>
      <div class="tbl-wrap"><table class="tbl ovme-legs"><thead><tr><th class="l">Leg</th><th class="l">Type</th><th class="r">Strike</th><th class="r">Days</th><th class="r" title="Option contracts (100 shares each); shares for a share leg">Qty</th><th class="r" title="Model value, or type the price you can really trade at">Price</th><th class="r">Δ</th><th class="r">Γ</th><th class="r" title="Value lost per day">Θ/day</th><th class="r" title="Value change per 1 point of volatility">Vega</th><th></th></tr></thead><tbody></tbody></table></div>
      <div class="val-add"><button class="tb" data-add>+ Add leg</button> <span class="dim small">Buy = you pay the price, Sell = you receive it. Option legs are 100 shares per contract.</span></div>
      <div class="port-head ovme-kpi"></div>
      <div class="pane"><h3>Profit / loss by price after the first leg expires</h3><div class="chart-host short ovme-chart"></div></div>
      <p class="note ovme-note"></p>`;
    const tbody = wrap.querySelector('tbody');
    const kpi = wrap.querySelector('.ovme-kpi');
    const note = wrap.querySelector('.ovme-note');
    const chart = new XYChart(wrap.querySelector('.ovme-chart'));
    const sel = wrap.querySelector('[data-k=preset]');

    const drawLegs = () => {
      tbody.innerHTML = legs.map((l, k) => `<tr data-i="${k}">
        <td class="l"><select data-f="side"><option value="1" ${l.side > 0 ? 'selected' : ''}>Buy</option><option value="-1" ${l.side < 0 ? 'selected' : ''}>Sell</option></select></td>
        <td class="l"><select data-f="type"><option value="C" ${l.type === 'C' ? 'selected' : ''}>Call</option><option value="P" ${l.type === 'P' ? 'selected' : ''}>Put</option><option value="S" ${l.type === 'S' ? 'selected' : ''}>Shares</option></select></td>
        <td class="r">${l.type === 'S' ? '<span class="dim">—</span>' : `<input data-f="strike" type="number" step="any" value="${l.strike}" inputmode="decimal">`}</td>
        <td class="r">${l.type === 'S' ? '<span class="dim">—</span>' : `<input data-f="days" type="number" step="1" min="0" value="${l.days}" inputmode="numeric">`}</td>
        <td class="r"><input data-f="qty" type="number" step="1" min="0" value="${l.qty}" inputmode="numeric"></td>
        <td class="r"><input data-f="price" type="number" step="any" value="${+l.price.toFixed(4)}" inputmode="decimal"></td>
        <td class="r dim" data-g="delta"></td><td class="r dim" data-g="gamma"></td><td class="r dim" data-g="theta"></td><td class="r dim" data-g="vega"></td>
        <td><button class="tb" data-del title="Remove this leg" aria-label="Remove leg">×</button></td></tr>`).join('');
    };

    const read = () => {
      const g = (k) => Number(wrap.querySelector(`[data-k=${k}]`).value);
      const sp = g('spot');
      return { spot: sp > 0 ? sp : spot, v: g('v') / 100, r: g('r') / 100, q: g('q') / 100 };
    };

    // refresh the model price of every leg you haven't overridden
    const reprice = (P) => {
      legs.forEach((l, k) => {
        if (l.type === 'S') { l.price = P.spot; l.entry = P.spot; } else if (l.auto) l.price = optionValue(P.spot, l.strike, l.days, P.r, P.q, P.v, l.type === 'C').price;
        const inp = tbody.querySelector(`tr[data-i="${k}"] [data-f=price]`);
        if (inp && document.activeElement !== inp) inp.value = +l.price.toFixed(4);
      });
    };

    const compute = () => {
      const P = read();
      reprice(P);
      const pp = { r: P.r, q: P.q, v: P.v };
      const live = legs.filter((l) => l.qty > 0);
      const optDays = live.filter((l) => l.type !== 'S').map((l) => l.days);
      const h = optDays.length ? Math.min(...optDays) : 0;
      // Greeks per leg and total
      const tot = { delta: 0, gamma: 0, theta: 0, vega: 0 };
      legs.forEach((l, k) => {
        const row = tbody.querySelector(`tr[data-i="${k}"]`);
        const gk = l.type === 'S' ? { delta: 1, gamma: 0, theta: 0, vega: 0 } : optionValue(P.spot, l.strike, l.days, P.r, P.q, P.v, l.type === 'C');
        const m = l.side * l.qty * (l.type === 'S' ? 1 : MULT);
        for (const f of ['delta', 'gamma', 'theta', 'vega']) {
          const val = gk[f] * m;
          if (l.qty > 0) tot[f] += val;
          const c = row.querySelector(`[data-g=${f}]`);
          if (c) c.textContent = l.type === 'S' && f !== 'delta' ? '—' : num(gk[f] * l.side, f === 'gamma' ? 4 : 3);
        }
      });
      const net = live.reduce((a, l) => a + l.side * l.qty * (l.type === 'S' ? 0 : MULT) * l.price, 0); // + = you pay
      const fExp = (S) => strategyPnl(live, S, h, pp);
      const fNow = (S) => strategyPnl(live, S, 0, pp);
      // statistics over a very wide range (so a far-away strike isn't missed); the chart over a sensible one
      const wide = Array.from({ length: 1201 }, (_, k) => P.spot * (0.02 + (k / 1200) * 3.98));
      const wy = wide.map(fExp);
      const maxP = Math.max(...wy);
      const minP = Math.min(...wy);
      const w = Math.min(0.9, Math.max(0.2, 3 * P.v * Math.sqrt(Math.max(h, 30) / 365)));
      const lo = P.spot * (1 - w);
      const hi = P.spot * (1 + w);
      const grid = Array.from({ length: 161 }, (_, k) => lo + ((hi - lo) * k) / 160);
      const ys = grid.map(fExp);
      const far = (m) => fExp(P.spot * m);
      const upUnlimited = far(6) > far(3) + 1e-6;
      const upLoss = far(6) < far(3) - 1e-6;
      const be = breakevens(fExp, P.spot * 0.02, P.spot * 4);
      const pop = live.length ? profitChance(fExp, P.spot, h, pp) : null;
      const cc = s.ccy || '';
      kpi.innerHTML = [
        [net >= 0 ? 'You pay (debit)' : 'You receive (credit)', `${num(Math.abs(net), 2)} ${cc}`, ''],
        ['Max profit', upUnlimited ? 'Unlimited' : `${signed(maxP, 0)}`, 'up'],
        ['Max loss', upLoss ? 'Unlimited' : `${signed(minP, 0)}`, 'down'],
        ['Break-even', be.length ? be.map((x) => num(x, dp)).join(' · ') : '—', ''],
        ['Chance of profit', pop == null ? '<span class="dim">n/a</span>' : `${Math.round(pop * 100)}%`, ''],
        ['Net Δ (shares)', num(tot.delta, 1), ''],
        ['Net Γ', num(tot.gamma, 3), ''],
        ['Net Θ/day', signed(tot.theta, 2), tot.theta >= 0 ? 'up' : 'down'],
        ['Net vega', signed(tot.vega, 2), ''],
      ].map(([k, v, c]) => `<div><span class="dim">${k}</span><b class="${c}">${v}</b></div>`).join('');
      chart.setData({
        series: [
          { points: grid.map((x, k) => ({ x, y: ys[k] })), line: true, dots: false, width: 2.2 },
          { points: grid.map((x) => ({ x, y: fNow(x) })), line: true, dots: false, dash: [5, 4], width: 1.4 },
        ],
        xFmt: (v) => num(v, v >= 100 ? 0 : 2), yFmt: (v) => signed(v, 0), xLabel: `price of ${s.sym} (solid: when the first leg expires in ${h} days · dashed: today)`, yLabel: `profit / loss (${cc})`, zeroLine: true,
      });
      note.innerHTML = `Model: Black-Scholes, ${num(P.v * 100, 1)}% volatility for every strike, rate ${num(P.r * 100, 2)}%, dividend ${num(P.q * 100, 2)}%. <b>The chance of profit is the model's estimate, not a forecast</b>: it assumes the price moves randomly with that volatility and ignores events, early exercise and trading costs. Max profit and max loss are taken over prices from nearly zero to four times today's, at the first expiry. Real options have bid/ask spreads and their own implied volatility per strike: replace the Price boxes with real quotes for a realistic picture. Short options can lose far more than you receive. Not investment advice.`;
    };

    drawLegs();
    compute();
    wrap.addEventListener('input', (e) => {
      const t = e.target;
      if (t.dataset.k) { if (t.dataset.k !== 'preset') compute(); return; }
      const row = t.closest('tr[data-i]');
      if (!row) return;
      const l = legs[Number(row.dataset.i)];
      const f = t.dataset.f;
      const n = Number(t.value);
      if (f === 'price') { l.price = Number.isFinite(n) ? n : 0; l.auto = false; } else if (f === 'strike' && n > 0) { l.strike = n; l.auto = true; } else if (f === 'days' && n >= 0) { l.days = Math.round(n); l.auto = true; } else if (f === 'qty' && n >= 0) l.qty = Math.round(n);
      compute();
    });
    wrap.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.k === 'preset') {
        load(t.value);
        drawLegs();
        compute();
        return;
      }
      const row = t.closest('tr[data-i]');
      if (!row) return;
      const l = legs[Number(row.dataset.i)];
      if (t.dataset.f === 'side') l.side = Number(t.value);
      if (t.dataset.f === 'type') {
        l.type = t.value;
        l.qty = l.type === 'S' ? 100 : 1;
        l.auto = true;
        if (l.type !== 'S' && !(l.strike > 0)) l.strike = roundK(read().spot);
      }
      if (t.dataset.f === 'type' || t.dataset.f === 'side') { drawLegs(); compute(); }
    });
    wrap.addEventListener('click', (e) => {
      if (e.target.closest('[data-add]')) {
        if (legs.length >= MAX_LEGS) return ctx.app.toast(`At most ${MAX_LEGS} legs.`, 'err');
        legs.push(mk(1, 'C', 0));
        drawLegs();
        compute();
      }
      const d = e.target.closest('[data-del]');
      if (d) {
        legs.splice(Number(d.closest('tr').dataset.i), 1);
        drawLegs();
        compute();
      }
    });
    return { destroy: () => chart.destroy() };
  },
});
