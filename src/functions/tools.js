// News, cross-asset analytics, screener, portfolio, alerts and help.

import { register, FUNCTIONS, CATEGORIES } from '../registry.js';
import { LiveTable, px, pct, chgText, dir, num, big, signed, secLink, esc, el, store, save } from '../fmt.js';
import { XYChart } from '../chart.js';
import { logReturns, corr } from '../studies.js';
import { SECTORS } from '../universe.js';

register({
  code: 'NEWS', aliases: ['TOP', 'N', 'NI'], name: 'News headlines', cat: 'News',
  help: 'NEWS [<category>|<sym>] — categories: Company Earnings Markets Economy Rates FX Commodities Crypto Central Banks',
  run(ctx) {
    const E = ctx.engine;
    const arg = (ctx.args.join(' ') || '').trim();
    const sym = ctx.filterSym || (E.get(arg) ? arg.toUpperCase() : null);
    const cats = ['All', 'Company', 'Earnings', 'Markets', 'Economy', 'Central Banks', 'Rates', 'FX', 'Commodities', 'Crypto'];
    let cat = !sym && arg ? cats.find((c) => c.toUpperCase() === arg.toUpperCase()) || 'All' : 'All';
    const bar = el('div', 'toolbar');
    if (!sym) ctx.el.appendChild(bar);
    const list = el('div', 'news-list');
    ctx.el.appendChild(list);
    const drawBar = () => (bar.innerHTML = cats.map((c) => `<button class="tb ${c === cat ? 'on' : ''}" data-c="${c}">${c}</button>`).join(''));
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('[data-c]');
      if (b) { cat = b.dataset.c; drawBar(); update(true); }
    });
    list.addEventListener('click', (e) => {
      if (e.target.closest('a.sec')) return;
      const r = e.target.closest('[data-story]');
      if (r) ctx.app.openStory(Number(r.dataset.story));
    });
    drawBar();
    let shown = -1;
    const update = (force) => {
      const items = E.news({ sym, category: cat === 'All' ? null : cat, limit: 150 });
      const top = items[0]?.id ?? 0;
      if (!force && top === shown) return;
      const fresh = shown >= 0 ? items.filter((s) => s.id > shown && s.minute >= 0).map((s) => s.id) : [];
      shown = top;
      list.innerHTML = items.length ? items.map((s) => `<div class="nrow ${fresh.includes(s.id) ? 'new' : ''}" data-story="${s.id}">
          <span class="time">${s.minute < 0 ? `<span class="dim">${E.storyTime(s)}</span>` : E.storyTime(s)}</span>
          <span class="hl" title="${esc(s.headline)}">${esc(s.headline)}</span>
          <span class="tags">${s.tickers.slice(0, 2).map((t) => (E.get(t) ? secLink(E.get(t)) : '')).join(' ')}</span>
          <span class="src dim">${esc(s.source)}</span></div>`).join('') : `<div class="empty">No stories${sym ? ` for ${esc(sym)}` : ''} yet today.</div>`;
    };
    update(true);
    return { update };
  },
});

register({
  code: 'CORR', aliases: ['CORRM'], name: 'Correlation matrix', cat: 'Analytics',
  help: 'CORR [<sym> …] [3M|6M|1Y] — daily returns',
  run(ctx) {
    const E = ctx.engine;
    const args = ctx.args.map((a) => a.toUpperCase());
    const lens = { '3M': 63, '6M': 126, '1Y': 259 };
    const len = lens[args.find((a) => a in lens)] || 126;
    let syms = args.filter((a) => E.get(a));
    if (syms.length < 2) syms = E.defaults.corr.filter((s) => E.get(s));
    const rets = syms.map((s) => {
      const i = E.get(s);
      const c = i.history.map((b) => b.c).slice(-(len + 1));
      return i.additive ? c.slice(1).map((v, k) => v - c[k]) : logReturns(c);
    });
    const cell = (v) => {
      const a = Math.min(1, Math.abs(v));
      const bg = v >= 0 ? `color-mix(in oklab, var(--heat-up) ${Math.round(a * 85)}%, transparent)` : `color-mix(in oklab, var(--heat-down) ${Math.round(a * 85)}%, transparent)`;
      return `<td class="r corr" style="background:${bg}">${v.toFixed(2)}</td>`;
    };
    ctx.el.innerHTML = `<p class="note">Correlation of daily ${'returns'} over ${Object.keys(lens).find((k) => lens[k] === len)} (yields use changes). Click a name to load it.</p>
      <div class="tbl-wrap"><table class="tbl mtx"><thead><tr><th></th>${syms.map((s) => `<th class="r">${esc(s)}</th>`).join('')}</tr></thead><tbody>
      ${syms.map((s, i) => `<tr><th class="l">${secLink(E.get(s))}</th>${syms.map((_, j) => (i === j ? '<td class="r dim">1.00</td>' : cell(corr(rets[i], rets[j])))).join('')}</tr>`).join('')}
      </tbody></table></div>`;
  },
});

register({
  code: 'SCAT', aliases: ['RRG', 'RISKRET'], name: 'Risk vs return scatter', cat: 'Analytics',
  help: 'SCAT [<sector>|US|EU|ASIA] — 1Y return vs realized vol for equities',
  run(ctx) {
    const E = ctx.engine;
    const a = ctx.args.join(' ').toUpperCase();
    const sector = SECTORS.find((s) => s.toUpperCase().startsWith(a) && a);
    const set = E.equities.filter((i) => (!a ? true : sector ? i.sector === sector : i.region === a));
    const host = el('div', 'chart-host fill');
    ctx.el.appendChild(el('p', 'note', `${set.length} equities${sector ? ` in ${esc(sector)}` : a ? ` in ${esc(a)}` : ''} · hover a dot for its ticker`));
    ctx.el.appendChild(host);
    const chart = new XYChart(host);
    const by = new Map();
    for (const i of set) {
      const k = i.region;
      if (!by.has(k)) by.set(k, []);
      by.get(k).push({ x: i.realVol * 100, y: (i.last / i.history[0].c - 1) * 100, label: i.sym });
    }
    chart.setData({ series: [...by].map(([k, pts]) => ({ name: k, points: pts, labels: set.length < 25, r: 3.5 })), xFmt: (v) => `${v.toFixed(0)}%`, yFmt: (v) => `${v.toFixed(0)}%`, xLabel: 'Realized volatility (1Y)', yLabel: '1Y return', zeroLine: true });
    return { destroy: () => chart.destroy() };
  },
});

// ---- screener ----------------------------------------------------------------------------
// Point-and-click: pick a ready-made screen or set a minimum/maximum for any column, choose a
// sector or region, and tap a column header to sort. The typed form still works:
// SCRN pe<20 yld>2 sector=fin region=us sort=-chg

const hi52 = (i) => Math.max(...i.history.map((b) => b.h ?? b.c), i.high ?? i.last);
const rsiCache = new Map();
function rsiOf(i) {
  const key = `${i.sym}:${i.history.length}:${i.history[i.history.length - 1]?.t}`;
  let base = rsiCache.get(key);
  if (!base) {
    // Wilder's averages up to yesterday, so today's price only adds one step
    const c = i.history.map((b) => b.c);
    let g = 0;
    let l = 0;
    for (let k = 1; k < c.length; k++) {
      const d = c[k] - c[k - 1];
      if (k <= 14) {
        g += Math.max(d, 0) / 14;
        l += Math.max(-d, 0) / 14;
      } else {
        g = (g * 13 + Math.max(d, 0)) / 14;
        l = (l * 13 + Math.max(-d, 0)) / 14;
      }
    }
    base = { g, l, last: c[c.length - 1] };
    rsiCache.set(key, base);
  }
  const d = i.last - base.last;
  const g = (base.g * 13 + Math.max(d, 0)) / 14;
  const l = (base.l * 13 + Math.max(-d, 0)) / 14;
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}
const finite = (v) => (Number.isFinite(v) ? v : null);

// [label, value(inst), decimals, help]
const FIELDS = {
  px: ['Price', (i) => i.last, 2, 'Last price'],
  chg: ['Today %', (i) => i.pct * 100, 2, 'Change today'],
  // the extra companies (i.light) have no daily history loaded: their 1Y and 52-week figures
  // come from Yahoo's quote, and RSI, beta and volatility appear once a company is opened
  ret: ['1Y %', (i) => (i.light ? i.chg52 : (i.last / i.history[0].c - 1) * 100), 1, 'Price change over the past year'],
  off: ['Off high %', (i) => (i.light ? (i.hi52 ? (i.last / Math.max(i.hi52, i.last) - 1) * 100 : null) : (i.last / hi52(i) - 1) * 100), 1, 'Distance below the 52-week high (0 = at the high)'],
  rsi: ['RSI', (i) => (i.light ? null : rsiOf(i)), 0, '14-day RSI: under 30 oversold, over 70 overbought'],
  pe: ['P/E', (i) => (i.eps > 0 ? i.last / i.eps : null), 1, 'Price / earnings (left out when earnings are negative)'],
  cap: ['Mkt cap B', (i) => (i.light ? i.marketCap : i.marketCap ?? i.shares * i.last) / 1e9, 1, 'Market value in billions'],
  yld: ['Div yld %', (i) => i.divYield, 2, 'Dividend yield'],
  beta: ['Beta', (i) => (i.light ? null : i.histBeta), 2, 'Moves with the market: 1 = same, under 1 = calmer'],
  vol: ['Vol %', (i) => (i.light ? null : i.realVol * 100), 0, 'Volatility: how much it swings in a year'],
};
const val = (i, f) => (i.light && !i.priced && f !== 'px' ? null : finite(FIELDS[f][1](i)));

const PRESETS = {
  all: ['All stocks', {}],
  value: ['Cheap (low P/E)', { max: { pe: 15 }, min: { cap: 5 }, sort: { field: 'pe', desc: false } }],
  dividend: ['High dividends', { min: { yld: 3 }, sort: { field: 'yld', desc: true } }],
  momentum: ['Strong trend', { min: { ret: 25, off: -8 }, sort: { field: 'ret', desc: true } }],
  oversold: ['Oversold (RSI)', { max: { rsi: 35 }, sort: { field: 'rsi', desc: false } }],
  winners: ['Today\'s winners', { sort: { field: 'chg', desc: true } }],
  losers: ['Today\'s losers', { sort: { field: 'chg', desc: false } }],
  calm: ['Low risk', { max: { vol: 25, beta: 0.9 }, sort: { field: 'vol', desc: false } }],
  giants: ['Giants (>$200B)', { min: { cap: 200 }, sort: { field: 'cap', desc: true } }],
};
const blank = () => ({ preset: 'all', sector: '', region: '', min: {}, max: {}, sort: { field: 'cap', desc: true } });

export function parseScreen(args) {
  const q = { ...blank(), preset: null };
  let any = false;
  for (const raw of args) {
    const a = raw.toLowerCase();
    let m = a.match(/^(sector|region)=(.+)$/);
    if (m) {
      q[m[1]] = m[2].replace(/_/g, ' ');
      any = true;
      continue;
    }
    m = a.match(/^sort=(-?)(\w+)$/);
    if (m && FIELDS[m[2]]) {
      q.sort = { field: m[2], desc: m[1] === '-' };
      any = true;
      continue;
    }
    m = a.match(/^(\w+)(<=|>=|<|>)(-?[\d.]+)$/);
    if (m && FIELDS[m[1]]) {
      q[m[2][0] === '<' ? 'max' : 'min'][m[1]] = Number(m[3]);
      any = true;
    }
    if (PRESETS[a]) return { ...blank(), ...PRESETS[a][1], min: { ...PRESETS[a][1].min }, max: { ...PRESETS[a][1].max }, preset: a };
  }
  return any ? q : null;
}

export function applyScreen(list, q) {
  return list.filter((i) => {
    if (q.sector && !i.sector.toLowerCase().startsWith(q.sector.toLowerCase())) return false;
    if (q.region && i.region.toLowerCase() !== q.region.toLowerCase()) return false;
    for (const [f, lo] of Object.entries(q.min)) if (lo != null && !(val(i, f) >= lo)) return false;
    for (const [f, hi] of Object.entries(q.max)) if (hi != null && !(val(i, f) <= hi)) return false;
    return true;
  });
}

register({
  code: 'SCRN', aliases: ['EQS', 'SCREEN', 'SCREENER'], name: 'Stock screener', cat: 'Equity',
  help: 'SCRN — pick a screen or set min/max filters; tap a column to sort. Typed: SCRN pe<20 yld>2 sector=fin sort=-chg',
  run(ctx) {
    const E = ctx.engine;
    const q = parseScreen(ctx.args) || { ...blank(), ...store('scrn', {}) };
    q.min ||= {};
    q.max ||= {};
    const persist = () => save('scrn', q);
    const list = () => (E.screenList ? E.screenList() : E.equities);
    const sectors = [...new Set(list().map((i) => i.sector))].filter((x) => x !== 'ETF').concat(E.equities.some((i) => i.etf) ? ['ETF'] : []).sort();
    const regions = [...new Set(list().map((i) => i.region))].sort();
    // the extra companies' prices: fetched now and refreshed every minute while the screener is open
    let more = null;
    const loadMore = () => E.moreQuotes?.().then((st) => {
      more = st;
      update();
    });
    loadMore();
    const moreTimer = E.moreQuotes ? setInterval(loadMore, 60e3) : null;

    const bar = el('div', 'toolbar');
    const form = el('div', 'scrn-form');
    const info = el('div', 'qstrip scrn-info');
    ctx.el.append(bar, form, info);
    // The filter boxes fold away (on phones by default) behind a button that counts the active ones.
    let open = store('scrn-open', window.innerWidth > 900);
    const active = () => Object.values(q.min).filter((v) => v != null).length + Object.values(q.max).filter((v) => v != null).length + (q.sector ? 1 : 0) + (q.region ? 1 : 0);
    const drawBar = () => {
      bar.innerHTML = Object.entries(PRESETS).map(([k, [label]]) => `<button class="tb ${q.preset === k ? 'on' : ''}" data-preset="${k}">${esc(label)}</button>`).join('') +
        `<span class="sep"></span><button class="tb ${open ? 'on' : ''}" data-toggle>Filters${active() ? ` (${active()})` : ''} ${open ? '▴' : '▾'}</button>`;
      form.hidden = !open;
    };
    const drawForm = () => {
      const opt = (list, cur) => list.map((x) => `<option value="${esc(x)}" ${x.toLowerCase() === String(cur).toLowerCase() ? 'selected' : ''}>${esc(x)}</option>`).join('');
      form.innerHTML = `<label class="wide">Sector <select data-sel="sector"><option value="">Any</option>${opt(sectors, q.sector)}</select></label>
        <label class="wide">Region <select data-sel="region"><option value="">Any</option>${opt(regions, q.region)}</select></label>` +
        Object.entries(FIELDS).filter(([k]) => k !== 'px').map(([k, [label, , , help]]) => `<label title="${esc(help)}">${esc(label)}
          <span><input type="number" inputmode="decimal" step="any" placeholder="min" data-min="${k}" value="${q.min[k] ?? ''}"><input type="number" inputmode="decimal" step="any" placeholder="max" data-max="${k}" value="${q.max[k] ?? ''}"></span></label>`).join('');
    };
    bar.addEventListener('click', (e) => {
      if (e.target.closest('[data-toggle]')) {
        open = !open;
        save('scrn-open', open);
        drawBar();
        return;
      }
      const b = e.target.closest('[data-preset]');
      if (!b) return;
      const p = PRESETS[b.dataset.preset][1];
      Object.assign(q, blank(), { preset: b.dataset.preset, min: { ...p.min }, max: { ...p.max }, sort: { ...(p.sort || blank().sort) } });
      persist();
      drawBar();
      drawForm();
      update();
    });
    form.addEventListener('change', (e) => {
      const t = e.target;
      const n = t.value === '' ? null : Number(t.value);
      if (t.dataset.sel) q[t.dataset.sel] = t.value;
      if (t.dataset.min) q.min[t.dataset.min] = Number.isFinite(n) ? n : null;
      if (t.dataset.max) q.max[t.dataset.max] = Number.isFinite(n) ? n : null;
      q.preset = null;
      persist();
      drawBar();
      update();
    });

    const keys = ['chg', 'ret', 'off', 'rsi', 'pe', 'cap', 'yld', 'beta', 'vol'];
    const t = new LiveTable(ctx.el, [
      { label: 'Ticker', value: (i) => secLink(i), cls: 'l' },
      { label: 'Name', value: (i) => esc(i.name), cls: 'l dim name' },
      { label: 'Sector', value: (i) => esc(i.sector), cls: 'l dim scrn-sector' },
      { label: 'Last', value: (i) => px(i), cls: 'r', flash: (i) => i.last, sort: 'px' },
      ...keys.map((k) => ({ label: FIELDS[k][0], title: FIELDS[k][3], sort: k, value: (i) => (val(i, k) == null ? '<span class="dim">—</span>' : num(val(i, k), FIELDS[k][2])), cls: 'r', cellCls: k === 'chg' || k === 'ret' || k === 'off' ? (i) => dir(val(i, k)) : undefined })),
      { label: '', value: (i) => `<a href="#" class="tb bt-link" data-bt="${esc(i.sym)}" title="Backtest a trading rule on ${esc(i.sym)}">Test ›</a>`, cls: 'r' },
    ], { onRow: (k) => ctx.app.load(k) });
    const cols = t.cols;
    const ths = [...t.table.querySelectorAll('th')];
    ths.forEach((th, idx) => {
      if (!cols[idx].sort) return;
      th.classList.add('sortable');
      th.addEventListener('click', () => {
        const f = cols[idx].sort;
        q.sort = q.sort.field === f ? { field: f, desc: !q.sort.desc } : { field: f, desc: f !== 'pe' && f !== 'vol' && f !== 'beta' && f !== 'rsi' };
        persist();
        update();
      });
    });
    t.table.addEventListener('click', (e) => {
      const a = e.target.closest('[data-bt]');
      if (!a) return;
      e.preventDefault();
      ctx.app.run(`${a.dataset.bt} BT`, ctx.panel);
    });
    const update = () => {
      const f = q.sort.field;
      // stocks with no value for the sort column go last whichever way it's sorted
      const all = list();
      const rows = applyScreen(all, q).sort((a, b) => {
        const x = val(a, f);
        const y = val(b, f);
        if (x == null || y == null) return (x == null) - (y == null);
        return q.sort.desc ? y - x : x - y;
      });
      ths.forEach((th, idx) => {
        const on = cols[idx].sort === f;
        th.classList.toggle('sorted', on);
        th.textContent = cols[idx].label + (on ? (q.sort.desc ? ' ↓' : ' ↑') : '');
      });
      const loading = E.moreQuotes && !more ? ` · loading prices for ${all.length - E.equities.length} more companies…` : more?.error ? ` · couldn't load the extra companies' prices (${esc(more.error)})` : '';
      info.innerHTML = `<b>${rows.length} of ${all.length}</b><span class="dim">match${loading} · tap a column to sort · <i>Test</i> = backtest</span>`;
      // a long list only renders its first 300 rows (sorting and filtering still use all of them)
      t.set(rows.slice(0, 300).map((i) => Object.assign(i, { key: i.sym, rowCls: '' })));
      if (rows.length > 300) info.insertAdjacentHTML('beforeend', '<span class="dim"> · showing the top 300: narrow it down with a screen or filters</span>');
    };
    drawBar();
    drawForm();
    update();
    return { update, every: 2, destroy: () => clearInterval(moreTimer) };
  },
});

// ---- portfolio & trading -----------------------------------------------------------------


export function loadBook(E) {
  const b = store(`book:${E.mode}`, null);
  if (b) return b;
  // Starting book: positions bought 60 trading days ago, plus cash.
  const seed = { cash: 250000, positions: {}, trades: [] };
  for (const [s, q] of Object.entries(E.defaults.book)) {
    const i = E.get(s);
    if (i) seed.positions[s] = { q, cost: i.history[Math.max(0, i.history.length - 60)].c };
  }
  save(`book:${E.mode}`, seed);
  return seed;
}

export function trade(E, side, sym, qty) {
  const i = E.get(sym);
  if (!i) return `Unknown security ${sym}`;
  if (i.cls === 'BOND' || i.cls === 'IDX') return `${sym} is not tradable here (${i.cls === 'BOND' ? 'yield' : 'index'})`;
  if (!(qty > 0)) return 'Quantity must be positive';
  const b = loadBook(E);
  const p = side > 0 ? i.ask : i.bid;
  const fx = fxToUsd(E, i.ccy);
  const cost = p * qty * fx;
  if (side > 0 && cost > b.cash) return `Not enough cash: need ${big(cost)} USD, have ${big(b.cash)}`;
  const pos = b.positions[sym] || { q: 0, cost: 0 };
  if (side < 0 && pos.q < qty) return `Short selling is off: you hold ${pos.q} ${sym}`;
  if (side > 0) pos.cost = (pos.cost * pos.q + p * qty) / (pos.q + qty);
  pos.q += side * qty;
  b.cash -= side * cost;
  if (pos.q === 0) delete b.positions[sym];
  else b.positions[sym] = pos;
  b.trades.unshift({ t: E.timeLabel(), d: E.date, side: side > 0 ? 'BUY' : 'SELL', sym, qty, p });
  b.trades = b.trades.slice(0, 200);
  save(`book:${E.mode}`, b);
  return `${side > 0 ? 'Bought' : 'Sold'} ${qty.toLocaleString('en-US')} ${sym} @ ${num(p, i.dp)}`;
}

export function fxToUsd(E, ccy) {
  if (ccy === 'USD') return 1;
  const d = E.get(`${ccy}USD`);
  if (d) return d.last;
  const iv = E.get(`USD${ccy}`);
  return iv ? 1 / iv.last : 1;
}

register({
  code: 'PORT', aliases: ['PRTU', 'PF', 'POS'], name: 'Portfolio & P&L', cat: 'Trading',
  help: 'PORT · trade with BUY <sym> <qty> / SELL <sym> <qty> · PORT RESET',
  run(ctx) {
    const E = ctx.engine;
    if ((ctx.args[0] || '').toUpperCase() === 'RESET') {
      save(`book:${E.mode}`, null);
      ctx.app.toast('Portfolio reset to the starting book');
    }
    const head = el('div', 'port-head');
    ctx.el.appendChild(head);
    const t = new LiveTable(ctx.el, [
      { label: 'Ticker', value: (r) => secLink(r.i), cls: 'l' },
      { label: 'Qty', value: (r) => r.q.toLocaleString('en-US'), cls: 'r' },
      { label: 'Avg cost', value: (r) => num(r.cost, r.i.dp), cls: 'r dim' },
      { label: 'Last', value: (r) => px(r.i), cls: 'r', flash: (r) => r.i.last },
      { label: 'Chg', value: (r) => chgText(r.i), cls: 'r', cellCls: (r) => dir(r.i.chg) },
      { label: 'Value USD', value: (r) => num(r.mv, 0), cls: 'r' },
      { label: 'Weight', value: (r) => `${num(r.w * 100, 1)}%`, cls: 'r dim' },
      { label: 'Day P&L', value: (r) => signed(r.day, 0), cls: 'r', cellCls: (r) => dir(r.day) },
      { label: 'Total P&L', value: (r) => signed(r.tot, 0), cls: 'r', cellCls: (r) => dir(r.tot) },
      { label: 'Return', value: (r) => pct(r.tot / (r.cost * r.q * r.fx), 1), cls: 'r', cellCls: (r) => dir(r.tot) },
    ], { onRow: (k) => ctx.app.load(k) });
    const trades = el('div', 'pane', '<h3>Blotter</h3><div class="blotter"></div>');
    ctx.el.appendChild(trades);
    const bl = trades.querySelector('.blotter');
    const update = () => {
      const b = loadBook(E);
      const rows = Object.entries(b.positions).map(([s, p]) => {
        const i = E.get(s);
        const fx = fxToUsd(E, i.ccy);
        return { key: s, i, q: p.q, cost: p.cost, fx, mv: i.last * p.q * fx, day: (i.last - i.prevClose) * p.q * fx, tot: (i.last - p.cost) * p.q * fx };
      });
      const inv = rows.reduce((a, r) => a + r.mv, 0);
      const nav = inv + b.cash;
      rows.forEach((r) => (r.w = r.mv / nav));
      rows.sort((a, z) => z.mv - a.mv);
      const day = rows.reduce((a, r) => a + r.day, 0);
      const tot = rows.reduce((a, r) => a + r.tot, 0);
      head.innerHTML = [['NAV', num(nav, 0)], ['Invested', num(inv, 0)], ['Cash', num(b.cash, 0)], ['Day P&L', signed(day, 0), dir(day)], ['Day %', pct(day / (nav - day)), dir(day)], ['Unrealized', signed(tot, 0), dir(tot)]]
        .map(([k, v, c = '']) => `<div><span class="dim">${k}</span><b class="${c}">${v}</b></div>`).join('');
      t.set(rows);
      bl.innerHTML = b.trades.length ? `<table class="tbl"><tbody>${b.trades.slice(0, 12).map((x) => `<tr><td class="l dim">${x.d.slice(5)} ${x.t}</td><td class="l ${x.side === 'BUY' ? 'up' : 'down'}">${x.side}</td><td class="r">${x.qty.toLocaleString('en-US')}</td><td class="l">${esc(x.sym)}</td><td class="r">${num(x.p, 2)}</td></tr>`).join('')}</tbody></table>` : `<p class="note">No trades yet. Type <kbd>BUY ${esc(E.defaults.sec)} 100</kbd> in the command line.</p>`;
    };
    update();
    return { update };
  },
});

register({
  code: 'ALRT', aliases: ['ALERT', 'ALERTS'], name: 'Price alerts', cat: 'Trading',
  help: 'ALRT <sym> >|< <level> · ALRT DEL <n> · ALRT',
  run(ctx) {
    const E = ctx.engine;
    const a = ctx.args.map((x) => x.toUpperCase());
    let list = store('alerts', []);
    if (a[0] === 'DEL' && a[1]) {
      list.splice(Number(a[1]) - 1, 1);
      save('alerts', list);
    } else if (a.length >= 3 && E.get(a[0]) && (a[1] === '>' || a[1] === '<') && !Number.isNaN(Number(a[2]))) {
      list.push({ sym: a[0], op: a[1], v: Number(a[2]), hit: false });
      save('alerts', list);
      ctx.app.toast(`Alert set: ${a[0]} ${a[1]} ${a[2]}`);
    } else if (a.length >= 2 && E.get(a[0])) {
      const m = a.slice(1).join('').match(/^([<>])(-?[\d.]+)$/);
      if (m) {
        list.push({ sym: a[0], op: m[1], v: Number(m[2]), hit: false });
        save('alerts', list);
        ctx.app.toast(`Alert set: ${a[0]} ${m[1]} ${m[2]}`);
      }
    }
    const host = el('div');
    ctx.el.appendChild(host);
    const update = () => {
      list = store('alerts', []);
      host.innerHTML = list.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th class="r">#</th><th class="l">Ticker</th><th class="l">Condition</th><th class="r">Last</th><th class="r">Distance</th><th class="l">Status</th></tr></thead><tbody>
        ${list.map((x, k) => {
          const i = E.get(x.sym);
          const dist = i.additive ? (x.v - i.last) * 100 : (x.v / i.last - 1) * 100;
          return `<tr><td class="r dim">${k + 1}</td><td class="l">${secLink(i)}</td><td class="l">${x.op} ${num(x.v, i.dp)}</td><td class="r">${px(i)}</td><td class="r dim">${signed(dist, i.additive ? 1 : 2, i.additive ? 'bp' : '%')}</td><td class="l ${x.hit ? 'up' : 'dim'}">${x.hit ? `TRIGGERED ${x.hitAt}` : 'watching'}</td></tr>`;
        }).join('')}</tbody></table></div>` : `<div class="empty">No alerts. Example: <kbd>ALRT ${esc(E.defaults.sec)} &gt; ${Math.round(E.get(E.defaults.sec).last * 1.05)}</kbd></div>`;
    };
    update();
    return { update };
  },
});

export function checkAlerts(E, toast) {
  const list = store('alerts', []);
  let changed = false;
  for (const x of list) {
    if (x.hit) continue;
    const i = E.get(x.sym);
    if (!i) continue;
    if ((x.op === '>' && i.last > x.v) || (x.op === '<' && i.last < x.v)) {
      x.hit = true;
      x.hitAt = E.timeLabel();
      changed = true;
      toast(`ALERT ${x.sym} ${x.op} ${num(x.v, i.dp)} — last ${px(i)}`, 'alert');
    }
  }
  if (changed) save('alerts', list);
}

register({
  code: 'HELP', aliases: ['H', '?', 'FN'], name: 'Function directory', cat: 'System',
  run(ctx) {
    const X = esc(ctx.engine.defaults.sec);
    const groups = CATEGORIES.map((c) => [c, [...FUNCTIONS.values()].filter((f) => f.cat === c)]).filter(([, l]) => l.length);
    ctx.el.innerHTML = `<div class="help">
      <section class="help-intro">
        <p><b>Type a command and press Enter.</b> A ticker on its own loads it (<kbd>${X}</kbd>); add a function after it (<kbd>${X} CHART 1Y RSI</kbd>) or use a market function directly (<kbd>HEAT</kbd>). The command line acts on the <b>focused panel</b>, outlined in amber.</p>
        <p><kbd>Ctrl</kbd>+<kbd>1</kbd>–<kbd>4</kbd> or a click focuses a panel · <kbd>Tab</kbd> completes · <kbd>↑</kbd>/<kbd>↓</kbd> pick a suggestion · <kbd>Alt</kbd>+<kbd>←</kbd> goes back · <kbd>Esc</kbd> clears · <kbd>/</kbd> jumps to the command line.</p>
        <p>Panels sharing a link colour follow each other's security. Other commands: <kbd>BUY ${X} 100</kbd>, <kbd>SELL ${X} 50</kbd>, <kbd>MODE LIVE</kbd> / <kbd>MODE SIM</kbd> (real or simulated data), <kbd>FINNHUB &lt;key&gt;</kbd> (adds real-time trades, news summaries and earnings estimates; the key stays on your PC), <kbd>FRED &lt;key&gt;</kbd> (official US economic releases in <kbd>ECO</kbd>; free key at fredaccount.stlouisfed.org/apikeys), <kbd>SPEED 10</kbd> (simulation clock 1–60×), <kbd>THEME</kbd>, <kbd>LAYOUT 1|2|4</kbd>.</p>
      </section>
      ${groups.map(([c, l]) => `<section><h3>${c}</h3><table class="tbl"><tbody>${l.map((f) => `<tr data-fn="${f.code}"><td class="l code">${f.code}</td><td class="l">${esc(f.name)}${f.sec ? ' <span class="dim">· needs a security</span>' : ''}</td><td class="l dim">${esc(f.help || (f.aliases || []).join(' '))}</td></tr>`).join('')}</tbody></table></section>`).join('')}
    </div>`;
    ctx.el.querySelector('.help').addEventListener('click', (e) => {
      const r = e.target.closest('[data-fn]');
      if (r) ctx.app.run(r.dataset.fn);
    });
  },
});
