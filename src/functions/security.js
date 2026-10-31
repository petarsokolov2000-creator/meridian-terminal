// Single-security functions. Each needs a loaded security (ctx.sec).

import { register } from '../registry.js';
import { LiveTable, px, pct, chgText, netText, dir, num, big, signed, secLink, esc, el } from '../fmt.js';
import { PriceChart, XYChart, fmtVol } from '../chart.js';
import { logReturns, diffs, linreg, corr } from '../studies.js';
import { Rng, hashString } from '../rng.js';
import { SESSION_MIN } from '../engine.js';

const CLS_NAME = { EQ: 'Equity', IDX: 'Index', FX: 'Currency', CMDTY: 'Commodity', CRYPTO: 'Crypto', BOND: 'Govt bond' };

function only(ctx, classes, what) {
  if (classes.includes(ctx.sec.cls)) return false;
  ctx.el.innerHTML = `<div class="empty">${esc(what)} is not available for ${esc(ctx.sec.sym)} (${CLS_NAME[ctx.sec.cls]}).</div>`;
  return true;
}

function quoteStrip(ctx) {
  const s = ctx.sec;
  const strip = el('div', 'qstrip');
  ctx.el.appendChild(strip);
  const update = () => {
    strip.innerHTML = `<span class="q-sym">${esc(s.sym)}</span><span class="q-name">${esc(s.name)}</span>
      <span class="q-last ${dir(s.chg)}">${px(s)}</span><span class="${dir(s.chg)}">${netText(s)} ${chgText(s)}</span>
      <span class="dim">O</span> ${px(s, s.open)} <span class="dim">H</span> ${px(s, s.high)} <span class="dim">L</span> ${px(s, s.low)}
      ${s.volume ? `<span class="dim">Vol</span> ${big(s.volume)}` : ''} <span class="dim">Bid/Ask</span> ${num(s.bid, s.dp)} / ${num(s.ask, s.dp)}`;
  };
  update();
  return update;
}

const RANGES = { '1M': 21, '3M': 63, '6M': 126, '1Y': 261, YTD: null, '5D': 5, '2Y': 522, '5Y': 1305, MAX: null };
// Ranges beyond the year of history loaded at start: real data only, fetched on demand.
const LONG = { '2Y': '2y', '5Y': '5y', MAX: 'max' };

register({
  code: 'DESC', aliases: ['DES', 'D'], name: 'Description & key data', cat: 'Equity', sec: true,
  run(ctx) {
    const s = ctx.sec;
    const E = ctx.engine;
    const strip = quoteStrip(ctx);
    const body = el('div', 'desc');
    ctx.el.appendChild(body);
    const chartHost = el('div', 'chart-host short');
    const kv = (k, v, cls = '') => `<div class="kv"><span>${k}</span><b class="${cls}">${v}</b></div>`;
    const ret = (n) => s.last / s.history[Math.max(0, s.history.length - n)].c - 1;
    const render = () => {
      const facts = [];
      if (s.cls === 'EQ') {
        const cap = s.shares * s.last;
        facts.push(kv('Market cap', `${big(cap)} ${s.ccy}`), kv('Shares out', big(s.shares)), kv('P/E (ttm)', num(s.last / s.eps, 1)), kv('EPS (ttm)', num(s.eps, 2)),
          kv('Dividend yield', `${num(s.divYield, 2)}%`), kv('Beta vs US 500', num(s.histBeta, 2)), kv('Sector', esc(s.sector)), kv('Region', s.region),
          kv('Next earnings', s.earnings?.date ? `${s.earnings.date} ${s.earnings.when}` : '—'), kv('Avg daily vol', big(s.adv)));
      } else if (s.cls === 'BOND') {
        facts.push(kv('Country', s.country), kv('Tenor', s.tenor), kv('Yield', `${num(s.last, 3)}%`), kv('Change', signed(s.chgBp, 1, 'bp'), dir(s.chg)), kv('Currency', s.ccy));
      } else {
        facts.push(kv('Asset class', CLS_NAME[s.cls]), kv('Currency', s.ccy), kv('Realized vol (1Y)', pct(s.realVol, 1)));
        if (s.unit) facts.push(kv('Unit', s.unit));
        if (s.histBeta != null) facts.push(kv('Beta vs US 500', num(s.histBeta, 2)));
      }
      const r1 = [['1W', 5], ['1M', 21], ['3M', 63], ['6M', 126], ['1Y', 259]];
      body.innerHTML = `
        <div class="desc-text">${esc(s.desc || `${s.name}. Simulated ${CLS_NAME[s.cls].toLowerCase()} market.`)}</div>
        <div class="desc-grid">
          <div class="facts">${facts.join('')}${kv('52W high', px(s, s.hi52))}${kv('52W low', px(s, s.lo52))}</div>
          <div class="facts">${r1.map(([k, n]) => (s.additive ? kv(`${k} change`, signed((s.last - s.history[Math.max(0, s.history.length - n)].c) * 100, 0, 'bp')) : kv(`${k} return`, pct(ret(n), 1), dir(ret(n))))).join('')}
            <div class="range52"><span>52W range</span><div class="rbar"><i style="left:${(((s.last - s.lo52) / (s.hi52 - s.lo52 || 1)) * 100).toFixed(1)}%"></i></div></div>
          </div>
        </div>`;
      body.appendChild(chartHost);
    };
    render();
    const chart = new PriceChart(chartHost);
    const draw = () => chart.setData(E.daily(s.sym).slice(-126), { type: 'area', dp: s.dp, studies: { vol: false }, label: (i) => E.daily(s.sym).slice(-126)[i]?.t.slice(5) ?? '', keepView: true });
    draw();
    const related = el('div', 'pane', '<h3>Related functions</h3>');
    const fns = s.cls === 'EQ' ? ['CHART', 'INTRA', 'CN', 'FIN', 'ANLY', 'PEERS', 'OPT', 'BOOK', 'BETA'] : ['CHART', 'INTRA', 'HIST', 'CN', 'VOLA', 'BOOK'];
    related.innerHTML += `<div class="chips">${fns.map((f) => `<button class="chip" data-fn="${f}">${f}</button>`).join('')}</div>`;
    related.addEventListener('click', (e) => {
      const b = e.target.closest('[data-fn]');
      if (b) ctx.app.run(`${s.sym} ${b.dataset.fn}`);
    });
    ctx.el.appendChild(related);
    return { update: () => { strip(); draw(); }, every: 2, destroy: () => chart.destroy() };
  },
});

register({
  code: 'CHART', aliases: ['GP', 'G', 'GPO'], name: 'Price chart with studies', cat: 'Equity', sec: true,
  help: 'CHART [5D|1M|3M|6M|YTD|1Y|2Y|5Y|MAX] [CANDLE|OHLC|LINE|AREA] [SMA20 SMA50 EMA20 BB RSI MACD] [VS <sym>…]',
  run(ctx) {
    const s = ctx.sec;
    const E = ctx.engine;
    const st = { range: '6M', type: 'candle', sma: [20, 50], ema: [], bb: false, rsi: false, macd: false, compare: [] };
    const args = ctx.args.map((a) => a.toUpperCase());
    for (let k = 0; k < args.length; k++) {
      const a = args[k];
      if (a in RANGES) st.range = a;
      else if (['CANDLE', 'OHLC', 'LINE', 'AREA'].includes(a)) st.type = a.toLowerCase();
      else if (/^SMA\d+$/.test(a)) { if (!st.userSma) { st.sma = []; st.userSma = true; } st.sma.push(Number(a.slice(3))); }
      else if (/^EMA\d+$/.test(a)) st.ema.push(Number(a.slice(3)));
      else if (a === 'BB') st.bb = true;
      else if (a === 'RSI') st.rsi = true;
      else if (a === 'MACD') st.macd = true;
      else if (a === 'VS' || a === 'COMP') continue;
      else if (E.get(a)) st.compare.push(a);
    }
    const strip = quoteStrip(ctx);
    const bar = el('div', 'toolbar');
    ctx.el.appendChild(bar);
    const host = el('div', 'chart-host fill');
    ctx.el.appendChild(host);
    const chart = new PriceChart(host);
    const btn = (k, label, on) => `<button class="tb ${on ? 'on' : ''}" data-k="${k}">${label}</button>`;
    const drawBar = () => {
      bar.innerHTML = Object.keys(RANGES).filter((r) => !LONG[r] || E.longHistory).map((r) => btn(`r:${r}`, r, st.range === r)).join('') +
        (LONG[st.range] && !E.longHistory?.(s.sym, LONG[st.range]) ? '<span class="dim"> loading…</span>' : '') + '<span class="sep"></span>' +
        ['candle', 'ohlc', 'line', 'area'].map((t) => btn(`t:${t}`, t.toUpperCase(), st.type === t)).join('') + '<span class="sep"></span>' +
        btn('s:sma', 'SMA 20/50', st.sma.length > 0) + btn('s:bb', 'BOLL', st.bb) + btn('s:rsi', 'RSI', st.rsi) + btn('s:macd', 'MACD', st.macd) +
        (st.compare.length ? `<span class="sep"></span><span class="dim">vs ${st.compare.join(', ')}</span>` : '');
    };
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('[data-k]');
      if (!b) return;
      const [kind, v] = b.dataset.k.split(':');
      if (kind === 'r') st.range = v;
      if (kind === 't') st.type = v;
      if (kind === 's') {
        if (v === 'sma') st.sma = st.sma.length ? [] : [20, 50];
        else st[v] = !st[v];
      }
      drawBar();
      draw(false);
    });
    // Daily bars for the chosen range: the long ranges come from a separate, larger download
    // (weekly bars for MAX) and fall back to the year already loaded until it arrives.
    const source = (sym) => {
      const today = E.daily(sym);
      const long = LONG[st.range] && E.longHistory ? E.longHistory(sym, LONG[st.range]) : null;
      return long ? [...long, today[today.length - 1]] : today;
    };
    let hadLong = false;
    const draw = (keep = true) => {
      const all = source(s.sym);
      const isLong = all.length > E.daily(s.sym).length;
      if (isLong && !hadLong) {
        // the long history just arrived: show its full window, not the one-year view
        hadLong = true;
        keep = false;
        drawBar();
      }
      if (!LONG[st.range]) hadLong = false;
      const n = st.range === 'YTD' ? all.filter((b) => b.t >= `${E.date.slice(0, 4)}-01-01`).length : st.range === 'MAX' ? all.length : Math.min(all.length, RANGES[st.range]);
      // Load extra history in front of the window so moving averages start on screen.
      const lead = Math.max(0, ...st.sma, ...st.ema, st.bb ? 20 : 0, st.macd ? 35 : 0);
      const data = all.slice(-(n + lead));
      const compare = st.compare.map((c) => ({ name: c, closes: source(c).slice(-(n + lead)).map((b) => b.c) }));
      chart.setData(data, {
        type: st.type, dp: s.dp, window: n, keepView: keep, ref: s.prevClose,
        studies: { sma: st.sma, ema: st.ema, bb: st.bb, rsi: st.rsi, macd: st.macd },
        compare, label: (i, full) => (full ? data[i]?.t : n > 300 ? data[i]?.t.slice(0, 7) : data[i]?.t.slice(5)) ?? '',
      });
    };
    drawBar();
    draw(false);
    return { update: () => { strip(); draw(); }, destroy: () => chart.destroy() };
  },
});

register({
  code: 'INTRA', aliases: ['GIP', 'IGP'], name: 'Intraday chart', cat: 'Equity', sec: true,
  help: 'INTRA [1|5|15] — bar size in minutes',
  run(ctx) {
    const s = ctx.sec;
    const E = ctx.engine;
    let size = Number(ctx.args[0]) || 1;
    let type = 'line';
    const strip = quoteStrip(ctx);
    const bar = el('div', 'toolbar');
    ctx.el.appendChild(bar);
    const host = el('div', 'chart-host fill');
    ctx.el.appendChild(host);
    const chart = new PriceChart(host);
    const drawBar = () => {
      bar.innerHTML = [1, 5, 15].map((n) => `<button class="tb ${size === n ? 'on' : ''}" data-s="${n}">${n}m</button>`).join('') +
        '<span class="sep"></span>' + ['line', 'candle'].map((t) => `<button class="tb ${type === t ? 'on' : ''}" data-t="${t}">${t.toUpperCase()}</button>`).join('') +
        `<span class="sep"></span><span class="dim">VWAP dotted · prev close ${px(s, s.prevClose)}</span>`;
    };
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.s) size = Number(b.dataset.s);
      if (b.dataset.t) type = b.dataset.t;
      drawBar();
      draw(false);
    });
    const agg = (bars) => {
      if (size === 1) return bars;
      const out = [];
      for (let i = 0; i < bars.length; i += size) {
        const g = bars.slice(i, i + size);
        out.push({ m: g[0].m, o: g[0].o, h: Math.max(...g.map((b) => b.h)), l: Math.min(...g.map((b) => b.l)), c: g[g.length - 1].c, v: g.reduce((a, b) => a + b.v, 0) });
      }
      return out;
    };
    const draw = (keep = true) => {
      const data = agg(E.intraday(s.sym));
      // pad to the full session so the x axis shows the whole day
      const full = [...data];
      chart.setData(full, {
        type, dp: s.dp, keepView: keep, ref: s.prevClose, window: Math.ceil(SESSION_MIN / size),
        studies: { vwap: true, vol: true }, label: (i) => E.minuteLabel(full[i]?.m ?? 0),
      });
    };
    drawBar();
    draw(false);
    return { update: () => { strip(); draw(); }, destroy: () => chart.destroy() };
  },
});

register({
  code: 'HIST', aliases: ['HP', 'HCP'], name: 'Historical prices', cat: 'Equity', sec: true,
  run(ctx) {
    const s = ctx.sec;
    const E = ctx.engine;
    quoteStrip(ctx);
    const t = new LiveTable(ctx.el, [
      { label: 'Date', value: (b) => b.t, cls: 'l' },
      { label: 'Open', value: (b) => px(s, b.o), cls: 'r' },
      { label: 'High', value: (b) => px(s, b.h), cls: 'r' },
      { label: 'Low', value: (b) => px(s, b.l), cls: 'r' },
      { label: 'Close', value: (b) => px(s, b.c), cls: 'r' },
      { label: 'Chg', value: (b) => (s.additive ? signed((b.c - b.pc) * 100, 1, 'bp') : pct(b.c / b.pc - 1)), cls: 'r', cellCls: (b) => dir(b.c - b.pc) },
      { label: 'Volume', value: (b) => (b.v ? big(b.v) : '—'), cls: 'r dim' },
    ]);
    const update = () => {
      const d = E.daily(s.sym);
      t.set(d.slice(1).map((b, i) => ({ ...b, pc: d[i].c, key: b.t })).reverse().slice(0, 120));
    };
    update();
    return { update, every: 5 };
  },
});

register({
  code: 'CN', aliases: ['NEWS-S'], name: 'Company / security news', cat: 'News', sec: true,
  run(ctx) {
    ctx.args = [ctx.sec.sym];
    return ctx.app.fn('NEWS').run({ ...ctx, filterSym: ctx.sec.sym });
  },
});

register({
  code: 'PEERS', aliases: ['RV', 'COMP'], name: 'Peer comparison', cat: 'Equity', sec: true,
  run(ctx) {
    if (only(ctx, ['EQ'], 'Peer comparison')) return;
    const s = ctx.sec;
    const E = ctx.engine;
    const peers = E.equities.filter((i) => i.sector === s.sector);
    const ret = (i, n) => i.last / i.history[Math.max(0, i.history.length - n)].c - 1;
    const t = new LiveTable(ctx.el, [
      { label: 'Ticker', value: (i) => secLink(i), cls: 'l' },
      { label: 'Name', value: (i) => esc(i.name), cls: 'l dim name' },
      { label: 'Rgn', value: (i) => i.region, cls: 'l dim' },
      { label: 'Last', value: (i) => px(i), cls: 'r', flash: (i) => i.last },
      { label: 'Chg', value: (i) => pct(i.pct), cls: 'r', cellCls: (i) => dir(i.pct) },
      { label: 'Mkt cap', value: (i) => big(i.shares * i.last), cls: 'r' },
      { label: 'P/E', value: (i) => num(i.last / i.eps, 1), cls: 'r' },
      { label: 'Div yld', value: (i) => `${num(i.divYield, 2)}%`, cls: 'r' },
      { label: 'Margin', value: (i) => pct(i.margin, 1).replace('+', ''), cls: 'r' },
      { label: '3M', value: (i) => pct(ret(i, 63), 1), cls: 'r', cellCls: (i) => dir(ret(i, 63)) },
      { label: '1Y', value: (i) => pct(ret(i, 259), 1), cls: 'r', cellCls: (i) => dir(ret(i, 259)) },
      { label: 'Beta', value: (i) => num(i.histBeta, 2), cls: 'r dim' },
    ], { onRow: (k) => ctx.app.load(k) });
    const update = () => t.set(peers.map((i) => Object.assign(i, { key: i.sym, rowCls: i === s ? 'self' : '' })));
    update();
    const median = (f) => {
      const v = peers.map(f).sort((a, b) => a - b);
      return v[v.length >> 1];
    };
    ctx.el.appendChild(el('p', 'note', `${esc(s.sector)} median P/E ${num(median((i) => i.last / i.eps), 1)} · ${esc(s.sym)} trades at ${num((s.last / s.eps) / median((i) => i.last / i.eps), 2)}× the peer median.`));
    return { update };
  },
});

// ---- options ---------------------------------------------------------------------------

const N = (x) => {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
};
const npdf = (x) => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);

export function bs(S, K, T, r, q, v, call) {
  const sq = v * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + v * v / 2) * T) / sq;
  const d2 = d1 - sq;
  const dq = Math.exp(-q * T);
  const dr = Math.exp(-r * T);
  const price = call ? S * dq * N(d1) - K * dr * N(d2) : K * dr * N(-d2) - S * dq * N(-d1);
  return {
    price,
    delta: call ? dq * N(d1) : dq * (N(d1) - 1),
    gamma: (dq * npdf(d1)) / (S * sq),
    vega: (S * dq * npdf(d1) * Math.sqrt(T)) / 100,
    theta: (call ? -(S * dq * npdf(d1) * v) / (2 * Math.sqrt(T)) - r * K * dr * N(d2) + q * S * dq * N(d1) : -(S * dq * npdf(d1) * v) / (2 * Math.sqrt(T)) + r * K * dr * N(-d2) - q * S * dq * N(-d1)) / 365,
  };
}

function volSurface(s) {
  const atm = (s.realVol || s.vol) * 1.08;
  const skew = s.cls === 'CRYPTO' ? -0.05 : s.cls === 'CMDTY' ? 0.05 : -0.22;
  return (K, T) => {
    // moneyness in standard deviations, clamped so far wings stay finite
    const m = Math.max(-3, Math.min(3, Math.log(K / s.last) / (atm * Math.sqrt(Math.max(T, 0.02)))));
    return Math.max(0.05, atm * (1 + skew * 0.35 * m + 0.03 * m * m) * (1 + 0.04 * Math.log(T * 12 + 1)));
  };
}

function strikeStep(p) {
  if (p > 20000) return 500;
  if (p > 2000) return 50;
  if (p > 500) return 10;
  if (p > 100) return 5;
  if (p > 30) return 1;
  if (p > 5) return 0.5;
  return 0.05;
}

register({
  code: 'OPT', aliases: ['OMON', 'OPTS'], name: 'Option chain & Greeks', cat: 'Analytics', sec: true,
  help: 'OPT [1W|1M|3M|6M|1Y]',
  run(ctx) {
    if (only(ctx, ['EQ', 'IDX', 'CMDTY', 'CRYPTO'], 'The option monitor')) return;
    const s = ctx.sec;
    const E = ctx.engine;
    const tenors = { '1W': 7, '1M': 30, '2M': 60, '3M': 91, '6M': 182, '1Y': 365 };
    let exp = (ctx.args[0] || '1M').toUpperCase();
    if (!(exp in tenors)) exp = '1M';
    const strip = quoteStrip(ctx);
    const bar = el('div', 'toolbar');
    ctx.el.appendChild(bar);
    const split = el('div', 'opt-split');
    ctx.el.appendChild(split);
    const chainHost = el('div', 'pane');
    const smileHost = el('div', 'chart-host');
    split.append(chainHost, smileHost);
    const smile = new XYChart(smileHost);
    const drawBar = () => (bar.innerHTML = Object.keys(tenors).map((k) => `<button class="tb ${k === exp ? 'on' : ''}" data-e="${k}">${k}</button>`).join('') + '<span class="sep"></span><span class="dim">Black–Scholes on a simulated vol surface</span>');
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('[data-e]');
      if (b) { exp = b.dataset.e; drawBar(); update(); }
    });
    drawBar();
    const update = () => {
      strip();
      const T = tenors[exp] / 365;
      const r = E.get('US3M').last / 100;
      const q = (s.divYield || 0) / 100;
      const iv = volSurface(s);
      const step = strikeStep(s.last);
      const atmK = Math.round(s.last / step) * step;
      const strikes = Array.from({ length: 15 }, (_, k) => +(atmK + (k - 7) * step).toFixed(4));
      const dp = s.last > 1000 ? 1 : 2;
      chainHost.innerHTML = `<div class="tbl-wrap"><table class="tbl opt"><thead><tr><th colspan="5" class="c up">Calls</th><th></th><th colspan="5" class="c down">Puts</th></tr>
        <tr><th class="r">Bid</th><th class="r">Ask</th><th class="r">IV</th><th class="r">Δ</th><th class="r">Θ</th><th class="c">Strike</th><th class="r">Bid</th><th class="r">Ask</th><th class="r">IV</th><th class="r">Δ</th><th class="r">Θ</th></tr></thead><tbody>
        ${strikes.map((K) => {
          const v = iv(K, T);
          const c = bs(s.last, K, T, r, q, v, true);
          const p = bs(s.last, K, T, r, q, v, false);
          const sp = (x) => Math.max(0.01, x.price * 0.03);
          const itmC = K < s.last ? 'itm' : '';
          const itmP = K > s.last ? 'itm' : '';
          return `<tr><td class="r ${itmC}">${num(Math.max(0, c.price - sp(c) / 2), dp)}</td><td class="r ${itmC}">${num(c.price + sp(c) / 2, dp)}</td><td class="r ${itmC} dim">${num(v * 100, 1)}</td><td class="r ${itmC}">${num(c.delta, 2)}</td><td class="r ${itmC} dim">${num(c.theta, 3)}</td>
            <td class="c strike">${num(K, step < 1 ? 2 : 0)}</td>
            <td class="r ${itmP}">${num(Math.max(0, p.price - sp(p) / 2), dp)}</td><td class="r ${itmP}">${num(p.price + sp(p) / 2, dp)}</td><td class="r ${itmP} dim">${num(v * 100, 1)}</td><td class="r ${itmP}">${num(p.delta, 2)}</td><td class="r ${itmP} dim">${num(p.theta, 3)}</td></tr>`;
        }).join('')}</tbody></table></div>
        <p class="note">ATM ${exp} IV ${num(iv(s.last, T) * 100, 1)}% · implied 1σ move ±${num(s.last * iv(s.last, T) * Math.sqrt(T), dp)} (${pct(iv(s.last, T) * Math.sqrt(T), 1).replace('+', '')}) · r ${num(r * 100, 2)}% · q ${num(q * 100, 2)}%</p>`;
      const series = ['1M', '3M', '1Y'].map((k) => ({
        name: k, line: true, dots: false,
        points: Array.from({ length: 41 }, (_, j) => 0.7 + j * 0.015).map((m) => ({ x: m * 100, y: iv(s.last * m, tenors[k] / 365) * 100 })),
      }));
      smile.setData({ series, xFmt: (v) => `${v.toFixed(0)}%`, yFmt: (v) => `${v.toFixed(0)}`, xLabel: 'Strike / spot', yLabel: 'Implied vol %' });
    };
    update();
    return { update, every: 2, destroy: () => smile.destroy() };
  },
});

register({
  code: 'FIN', aliases: ['FA', 'FS'], name: 'Financial statements', cat: 'Equity', sec: true,
  run(ctx) {
    if (only(ctx, ['EQ'], 'Financial analysis')) return;
    const s = ctx.sec;
    const r = new Rng(hashString(`fin:${s.sym}`));
    const yr = Number(ctx.engine.date.slice(0, 4));
    const years = [yr - 4, yr - 3, yr - 2, yr - 1];
    const g = years.map(() => r.float(-0.04, 0.22));
    const rev = [];
    let x = s.revenue;
    for (let k = 3; k >= 0; k--) {
      rev[k] = x;
      x = x / (1 + g[k]);
    }
    const rows = years.map((y, k) => {
      const gm = Math.min(0.85, s.margin + r.float(0.15, 0.4));
      const om = s.margin * r.float(0.85, 1.15);
      const ni = rev[k] * om * 0.79;
      return { y, rev: rev[k], gp: rev[k] * gm, op: rev[k] * om, ni, eps: ni / s.shares, ebitda: rev[k] * om * 1.25, fcf: ni * r.float(0.7, 1.2), debt: rev[k] * r.float(0.1, 0.8), growth: k ? rev[k] / rev[k - 1] - 1 : g[0] };
    });
    const cap = s.shares * s.last;
    const last = rows[3];
    const equity = cap / r.float(1.5, 9);
    const lines = [
      ['Revenue', (q) => big(q.rev)], ['  growth', (q) => pct(q.growth, 1)], ['Gross profit', (q) => big(q.gp)], ['Gross margin', (q) => pct(q.gp / q.rev, 1).replace('+', '')],
      ['Operating income', (q) => big(q.op)], ['Operating margin', (q) => pct(q.op / q.rev, 1).replace('+', '')], ['EBITDA', (q) => big(q.ebitda)],
      ['Net income', (q) => big(q.ni)], ['Diluted EPS', (q) => num(q.eps, 2)], ['Free cash flow', (q) => big(q.fcf)], ['Total debt', (q) => big(q.debt)],
    ];
    ctx.el.innerHTML = `<div class="split2"><div class="pane"><h3>Income statement (${s.ccy}, fiscal years)</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th class="l"></th>${years.map((y) => `<th class="r">FY${y}</th>`).join('')}</tr></thead><tbody>
      ${lines.map(([k, f]) => `<tr><td class="l ${k.startsWith('  ') ? 'dim' : ''}">${k.trim()}</td>${rows.map((q) => `<td class="r">${f(q)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>
      <div class="pane"><h3>Valuation & returns</h3><div class="facts">
        ${[['Market cap', big(cap)], ['Enterprise value', big(cap + last.debt * 0.6)], ['P/E', num(cap / last.ni, 1)], ['EV/EBITDA', num((cap + last.debt * 0.6) / last.ebitda, 1)], ['P/S', num(cap / last.rev, 2)], ['P/B', num(cap / equity, 2)], ['FCF yield', `${num((last.fcf / cap) * 100, 1)}%`], ['ROE', `${num((last.ni / equity) * 100, 1)}%`], ['Net debt / EBITDA', num((last.debt * 0.6) / last.ebitda, 2)], ['Dividend yield', `${num(s.divYield, 2)}%`]]
          .map(([k, v]) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`).join('')}
      </div><p class="note">Statements are generated for this simulated company and scale with its live market cap.</p></div></div>`;
  },
});

register({
  code: 'ANLY', aliases: ['ANR', 'EE'], name: 'Analyst recommendations', cat: 'Equity', sec: true,
  run(ctx) {
    if (only(ctx, ['EQ'], 'Analyst coverage')) return;
    const s = ctx.sec;
    const r = new Rng(hashString(`anr:${s.sym}`));
    const brokers = ['Halvorsen & Co', 'Kestrel Securities', 'Brightwater Research', 'Larchmont Partners', 'Ostrander Capital', 'Pemberton Bank', 'Arden Equity', 'Northgate Research', 'Vesper Capital', 'Crane & Wilde', 'Solis Markets', 'Tidewater Securities'];
    const bias = r.float(-0.3, 0.6);
    const recs = brokers.slice(0, r.int(7, 12)).map((b) => {
      const z = bias + r.normal() * 0.7;
      const rating = z > 0.35 ? 'Buy' : z < -0.45 ? 'Sell' : 'Hold';
      const tgt = s.last * (1 + z * 0.12 + r.normal() * 0.05);
      return { b, rating, tgt, date: `${r.int(1, 28)}d ago` };
    });
    const cnt = (k) => recs.filter((x) => x.rating === k).length;
    const avg = recs.reduce((a, x) => a + x.tgt, 0) / recs.length;
    const hi = Math.max(...recs.map((x) => x.tgt));
    const lo = Math.min(...recs.map((x) => x.tgt));
    const score = (cnt('Buy') * 5 + cnt('Hold') * 3 + cnt('Sell')) / recs.length;
    const w = (k) => (cnt(k) / recs.length) * 100;
    ctx.el.innerHTML = `<div class="anr">
      <div class="anr-head"><div><span class="dim">Consensus</span><b class="big">${score > 4 ? 'Buy' : score > 3.2 ? 'Overweight' : score > 2.6 ? 'Hold' : 'Underweight'}</b><span class="dim">${num(score, 2)} / 5 · ${recs.length} analysts</span></div>
        <div><span class="dim">12M target (avg)</span><b class="big ${dir(avg - s.last)}">${num(avg, 2)}</b><span class="${dir(avg - s.last)}">${pct(avg / s.last - 1, 1)} vs last</span></div>
        <div><span class="dim">Range</span><b>${num(lo, 2)} – ${num(hi, 2)}</b></div></div>
      <div class="stack"><span class="up-bg" style="width:${w('Buy')}%">Buy ${cnt('Buy')}</span><span class="mid-bg" style="width:${w('Hold')}%">Hold ${cnt('Hold')}</span><span class="down-bg" style="width:${w('Sell')}%">Sell ${cnt('Sell')}</span></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th class="l">Firm</th><th class="l">Rating</th><th class="r">Target</th><th class="r">Upside</th><th class="r">Updated</th></tr></thead><tbody>
      ${recs.map((x) => `<tr><td class="l">${x.b}</td><td class="l ${x.rating === 'Buy' ? 'up' : x.rating === 'Sell' ? 'down' : ''}">${x.rating}</td><td class="r">${num(x.tgt, 2)}</td><td class="r ${dir(x.tgt - s.last)}">${pct(x.tgt / s.last - 1, 1)}</td><td class="r dim">${x.date}</td></tr>`).join('')}
      </tbody></table></div></div>`;
  },
});

register({
  code: 'BOOK', aliases: ['DOM', 'MBO', 'DEPTH'], name: 'Order book depth', cat: 'Trading', sec: true,
  run(ctx) {
    const s = ctx.sec;
    const E = ctx.engine;
    const strip = quoteStrip(ctx);
    const host = el('div', 'book');
    ctx.el.appendChild(host);
    const update = () => {
      strip();
      const b = E.book(s.sym, 12);
      const max = Math.max(...b.bids.map((x) => x.q), ...b.asks.map((x) => x.q));
      const cumB = [];
      const cumA = [];
      b.bids.reduce((a, x, i) => (cumB[i] = a + x.q), 0);
      b.asks.reduce((a, x, i) => (cumA[i] = a + x.q), 0);
      const dpx = s.cls === 'EQ' ? 2 : s.dp + 1;
      const row = (x, side, cum) => `<tr><td class="r dim">${x.n}</td><td class="r">${big(x.q)}</td><td class="r dim">${big(cum)}</td><td class="r ${side}">${num(x.p, dpx)}</td><td class="depth"><span class="${side}-bg" style="width:${(x.q / max) * 100}%"></span></td></tr>`;
      host.innerHTML = `<div class="split2"><div class="pane"><h3 class="up">Bids</h3><table class="tbl"><thead><tr><th class="r">#</th><th class="r">Size</th><th class="r">Cum</th><th class="r">Price</th><th></th></tr></thead><tbody>${b.bids.map((x, i) => row(x, 'up', cumB[i])).join('')}</tbody></table></div>
        <div class="pane"><h3 class="down">Asks</h3><table class="tbl"><thead><tr><th class="r">#</th><th class="r">Size</th><th class="r">Cum</th><th class="r">Price</th><th></th></tr></thead><tbody>${b.asks.map((x, i) => row(x, 'down', cumA[i])).join('')}</tbody></table></div></div>
        <p class="note">Spread ${num(s.ask - s.bid, dpx)} · Imbalance ${pct((cumB[11] - cumA[11]) / (cumB[11] + cumA[11]), 0)} (bids vs asks, top 12 levels)</p>`;
    };
    update();
    return { update };
  },
});

register({
  code: 'TAPE', aliases: ['TAS', 'QR'], name: 'Time & sales', cat: 'Trading', sec: true,
  run(ctx) {
    if (only(ctx, ['EQ'], 'Time & sales')) return;
    const s = ctx.sec;
    const E = ctx.engine;
    const strip = quoteStrip(ctx);
    const host = el('div');
    ctx.el.appendChild(host);
    const update = () => {
      strip();
      const pr = s.prints.slice(0, 60);
      const buyV = pr.filter((p) => p.side > 0).reduce((a, p) => a + p.q, 0);
      const tot = pr.reduce((a, p) => a + p.q, 0) || 1;
      host.innerHTML = `<p class="note">Last ${pr.length} prints · buy-side ${pct(buyV / tot, 0).replace('+', '')} of volume${pr.length ? '' : ' · prints appear as the clock runs'}</p>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th class="l">Time</th><th class="r">Price</th><th class="r">Size</th><th class="l">Cond</th></tr></thead><tbody>
        ${pr.map((p) => `<tr><td class="l dim">${tLabel(p.s)}</td><td class="r ${p.side > 0 ? 'up' : 'down'}">${num(p.p, 2)}</td><td class="r ${p.q >= 5000 ? 'hl-big' : ''}">${p.q.toLocaleString('en-US')}</td><td class="l dim">${p.q >= 5000 ? 'BLK' : p.side > 0 ? 'AT ASK' : 'AT BID'}</td></tr>`).join('')}</tbody></table></div>`;
    };
    update();
    return { update };
  },
});

function tLabel(simSec) {
  const s = Math.round(9.5 * 3600 + simSec);
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

register({
  code: 'BETA', aliases: ['REG', 'HRA'], name: 'Beta regression', cat: 'Analytics', sec: true,
  help: 'BETA [<benchmark>] — 1Y daily returns regression (default: the main US index)',
  run(ctx) {
    const s = ctx.sec;
    const E = ctx.engine;
    const bm = E.get(ctx.args[0]) || E.get(E.defaults.bench);
    const ys = s.additive ? diffs(s.history.map((b) => b.c)).map((x) => x * 100) : logReturns(s.history.map((b) => b.c)).map((x) => x * 100);
    const xs = logReturns(bm.history.map((b) => b.c)).map((x) => x * 100);
    const n = Math.min(xs.length, ys.length);
    const fit = linreg(xs.slice(-n), ys.slice(-n));
    const host = el('div', 'chart-host fill');
    ctx.el.appendChild(el('div', 'qstrip', `<span class="q-sym">${esc(s.sym)}</span> vs <b>${esc(bm.sym)}</b> · β <b>${num(fit.slope, 2)}</b> · α ${signed(fit.intercept * 252, 2, s.additive ? 'bp/yr' : '%/yr')} · R² <b>${num(fit.r * fit.r, 2)}</b> · corr ${num(fit.r, 2)} · n=${n}`));
    ctx.el.appendChild(host);
    const chart = new XYChart(host);
    const xr = [Math.min(...xs), Math.max(...xs)];
    chart.setData({
      series: [
        { name: 'Daily returns', points: xs.slice(-n).map((x, i) => ({ x, y: ys[ys.length - n + i] })), r: 2.2 },
        { name: `Fit β=${fit.slope.toFixed(2)}`, line: true, dots: false, points: xr.map((x) => ({ x, y: fit.intercept + fit.slope * x })) },
      ],
      xFmt: (v) => `${v.toFixed(1)}%`, yFmt: (v) => `${v.toFixed(1)}${s.additive ? 'bp' : '%'}`, xLabel: `${bm.sym} daily return`, yLabel: `${s.sym} daily ${s.additive ? 'change' : 'return'}`, zeroLine: true,
    });
    return { destroy: () => chart.destroy() };
  },
});

register({
  code: 'VOLA', aliases: ['HVG', 'HVT'], name: 'Realized volatility', cat: 'Analytics', sec: true,
  run(ctx) {
    const s = ctx.sec;
    const E = ctx.engine;
    const closes = s.history.map((b) => b.c);
    const r = s.additive ? diffs(closes).map((x) => x * 100) : logReturns(closes);
    const roll = (n) => r.map((_, i) => {
      if (i < n - 1) return null;
      const w = r.slice(i - n + 1, i + 1);
      const m = w.reduce((a, b) => a + b, 0) / n;
      return Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)) * Math.sqrt(252) * (s.additive ? 1 : 100);
    });
    const v20 = roll(20);
    const v60 = roll(60);
    const host = el('div', 'chart-host fill');
    const last = (a) => a[a.length - 1];
    ctx.el.appendChild(el('div', 'qstrip', `<span class="q-sym">${esc(s.sym)}</span> realized vol · 20D <b>${num(last(v20), 1)}</b> · 60D <b>${num(last(v60), 1)}</b> · 1Y <b>${num(s.additive ? null : s.realVol * 100, 1)}</b> ${s.additive ? 'bp/yr' : '%'}`));
    ctx.el.appendChild(host);
    const chart = new XYChart(host);
    const pts = (a) => a.map((y, i) => (y == null ? null : { x: i, y })).filter(Boolean);
    const dates = s.history.slice(1).map((b) => b.t);
    chart.setData({
      series: [{ name: '20D', line: true, dots: false, points: pts(v20) }, { name: '60D', line: true, dots: false, points: pts(v60) }],
      xFmt: (v) => dates[Math.round(v)]?.slice(5) ?? '', yFmt: (v) => v.toFixed(0), yLabel: s.additive ? 'bp / yr' : 'Annualized %', xLabel: '',
    });
    return { destroy: () => chart.destroy() };
  },
});

export { corr };
