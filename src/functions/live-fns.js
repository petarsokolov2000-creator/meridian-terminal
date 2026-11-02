// Real-data versions of the functions whose simulated versions generate their data.
// A function's `live` handler runs instead of `run` when the terminal is on real data.

import { FUNCTIONS } from '../registry.js';
import { px, pct, chgText, netText, dir, num, big, signed, esc, el } from '../fmt.js';
import { XYChart } from '../chart.js';
import { bs } from './security.js';

const live = (code, fn) => (FUNCTIONS.get(code).live = fn);

// Shows "Loading" until `promise` settles, then renders; update/destroy reach the result.
export function deferred(ctx, promise, render, source = 'Yahoo Finance') {
  const wait = el('div', 'empty', `Loading from ${source}…`);
  ctx.el.appendChild(wait);
  let inner = null;
  let gone = false;
  promise.then((data) => {
    if (gone) return;
    wait.remove();
    inner = render(data) || null;
  }).catch((err) => {
    if (!gone) wait.textContent = `Couldn't load this from ${source}: ${err.message}`;
  });
  return {
    update: () => inner?.update?.(),
    get every() {
      return inner?.every || 1;
    },
    destroy: () => {
      gone = true;
      inner?.destroy?.();
    },
  };
}

function notEquity(ctx, what) {
  ctx.el.innerHTML = `<div class="empty">${esc(what)} is only available for stocks (${esc(ctx.sec.sym)} is not one).</div>`;
}

export function strip(ctx) {
  const s = ctx.sec;
  const node = el('div', 'qstrip');
  ctx.el.appendChild(node);
  const update = () => {
    node.innerHTML = `<span class="q-sym">${esc(s.sym)}</span><span class="q-name">${esc(s.name)}</span>
      <span class="q-last ${dir(s.chg)}">${px(s)}</span><span class="${dir(s.chg)}">${netText(s)} ${chgText(s)}</span>
      <span class="dim">Bid/Ask</span> ${num(s.bid, s.dp)} / ${num(s.ask, s.dp)}`;
  };
  update();
  return update;
}

export const kv = (k, v, cls = '') => `<div class="kv"><span>${k}</span><b class="${cls}">${v}</b></div>`;
const pctOf = (x, dp = 1) => (x == null ? '—' : `${num(x * 100, dp)}%`);

live('DESC', (ctx) => {
  if (ctx.sec.cls !== 'EQ') return FUNCTIONS.get('DESC').run(ctx);
  // Load the business summary first so the description isn't empty, then reuse the shared view.
  return deferred(ctx, ctx.engine.profile(ctx.sec.sym).catch(() => null), () => {
    ctx.el.innerHTML = '';
    return FUNCTIONS.get('DESC').run(ctx);
  });
});

live('ANLY', (ctx) => {
  if (ctx.sec.cls !== 'EQ') return notEquity(ctx, 'Analyst coverage');
  const s = ctx.sec;
  return deferred(ctx, ctx.engine.profile(s.sym), (p) => {
    const t = p.trend || { strongBuy: 0, buy: 0, hold: 0, sell: 0, strongSell: 0 };
    const buy = t.strongBuy + t.buy;
    const sell = t.sell + t.strongSell;
    const total = buy + t.hold + sell;
    const w = (x) => (total ? (x / total) * 100 : 0);
    // Yahoo's mean runs 1 (strong buy) to 5 (strong sell).
    const tgt = (v) => (v > 0 ? num(v, 2) : '<span class="dim">n/a</span>');
    const mean = p.targetMean > 0 ? p.targetMean : null;
    const label = p.recKey ? p.recKey.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '—';
    ctx.el.innerHTML = `<div class="anr">
      <div class="anr-head"><div><span class="dim">Consensus</span><b class="big">${esc(label)}</b><span class="dim">${p.recMean ? `${num(p.recMean, 2)} (1 = strong buy, 5 = strong sell)` : ''} · ${p.analysts ?? total} analysts</span></div>
        <div><span class="dim">12M target (mean)</span><b class="big ${dir((mean ?? s.last) - s.last)}">${tgt(mean)}</b><span class="${dir((mean ?? s.last) - s.last)}">${mean ? `${pct(mean / s.last - 1, 1)} vs last` : ''}</span></div>
        <div><span class="dim">Range</span><b>${tgt(p.targetLow)} – ${tgt(p.targetHigh)}</b></div></div>
      ${total ? `<div class="stack"><span class="up-bg" style="width:${w(buy)}%">Buy ${buy}</span><span class="mid-bg" style="width:${w(t.hold)}%">Hold ${t.hold}</span><span class="down-bg" style="width:${w(sell)}%">Sell ${sell}</span></div>` : ''}
      <h3 class="dim" style="font-size:11px;margin:8px 0 4px">RECENT RATING CHANGES</h3>
      ${p.actions.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th class="l">Date</th><th class="l">Firm</th><th class="l">Action</th><th class="l">Rating</th><th class="r">Target</th></tr></thead><tbody>
      ${p.actions.map((a) => `<tr><td class="l dim">${new Date(a.t).toISOString().slice(0, 10)}</td><td class="l">${esc(a.firm)}</td><td class="l ${a.action === 'up' ? 'up' : a.action === 'down' ? 'down' : ''}">${esc(a.action || '')}</td><td class="l">${esc(a.from ? `${a.from} → ${a.to}` : a.to)}</td><td class="r" ${a.target > 0 ? '' : 'title="This firm published no price target with this rating change"'}>${tgt(a.target)}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="note">No recent rating changes reported.</p>'}
      <p class="note">Source: Yahoo Finance (financialData, recommendationTrend, upgradeDowngradeHistory), as of ${new Date().toISOString().slice(0, 10)}. Targets are 12-month analyst price targets; "n/a" means the firm gave no target with that rating change (Yahoo reports those as 0).</p></div>`;
  });
});

live('OPT', (ctx) => {
  const s = ctx.sec;
  const E = ctx.engine;
  if (!['EQ', 'IDX'].includes(s.cls)) {
    ctx.el.innerHTML = `<div class="empty">Yahoo lists option chains for stocks and some indices, not for ${esc(s.sym)}.</div>`;
    return;
  }
  const head = strip(ctx);
  const bar = el('div', 'toolbar');
  ctx.el.appendChild(bar);
  const split = el('div', 'opt-split');
  ctx.el.appendChild(split);
  const chainHost = el('div', 'pane', '<div class="empty">Loading option chain…</div>');
  const smileHost = el('div', 'chart-host');
  split.append(chainHost, smileHost);
  const smile = new XYChart(smileHost);
  let gone = false;
  const load = (date) => E.options(s.sym, date).then((c) => !gone && draw(c)).catch((err) => {
    if (!gone) chainHost.innerHTML = `<div class="empty">Couldn't load options: ${esc(err.message)}</div>`;
  });
  const draw = (c) => {
    bar.innerHTML = c.expirations.slice(0, 12).map((d) => `<button class="tb ${d === c.expiration ? 'on' : ''}" data-d="${d}">${new Date(d * 1000).toISOString().slice(2, 10)}</button>`).join('');
    const spot = s.last;
    const T = Math.max(1 / 365, (c.expiration * 1000 - Date.now()) / (365 * 86400e3));
    const r = (E.get('US3M')?.last ?? 4) / 100;
    const q = (s.divYield || 0) / 100;
    // the 15 strikes nearest the money
    const strikes = [...new Set([...c.calls, ...c.puts].map((o) => o.strike))].sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot)).slice(0, 15).sort((a, b) => a - b);
    const byK = (legs) => new Map(legs.map((o) => [o.strike, o]));
    const C = byK(c.calls);
    const P = byK(c.puts);
    const g = (o, call) => (o?.iv ? bs(spot, o.strike, T, r, q, o.iv, call) : null);
    const cell = (o, call) => {
      const gr = g(o, call);
      const itm = o?.itm ? 'itm' : '';
      return `<td class="r ${itm}">${num(o?.bid, 2)}</td><td class="r ${itm}">${num(o?.ask, 2)}</td><td class="r ${itm} dim">${o?.iv ? num(o.iv * 100, 1) : '—'}</td><td class="r ${itm}">${num(gr?.delta, 2)}</td><td class="r ${itm} dim">${o ? o.oi.toLocaleString('en-US') : '—'}</td>`;
    };
    chainHost.innerHTML = `<div class="tbl-wrap"><table class="tbl opt"><thead><tr><th colspan="5" class="c up">Calls</th><th></th><th colspan="5" class="c down">Puts</th></tr>
      <tr><th class="r">Bid</th><th class="r">Ask</th><th class="r">IV</th><th class="r">Δ</th><th class="r">OI</th><th class="c">Strike</th><th class="r">Bid</th><th class="r">Ask</th><th class="r">IV</th><th class="r">Δ</th><th class="r">OI</th></tr></thead><tbody>
      ${strikes.map((k) => `<tr>${cell(C.get(k), true)}<td class="c strike">${num(k, k % 1 ? 2 : 0)}</td>${cell(P.get(k), false)}</tr>`).join('')}</tbody></table></div>
      <p class="note">Real chain from Yahoo Finance (may be delayed). Δ from Black–Scholes using each contract's quoted IV · ${Math.round(T * 365)} days to expiry.</p>`;
    // Smile: OTM options only, where IV quotes are most reliable.
    const pts = [...c.puts.filter((o) => o.strike < spot), ...c.calls.filter((o) => o.strike >= spot)]
      .filter((o) => o.iv > 0.01 && o.iv < 3 && Math.abs(o.strike / spot - 1) < 0.35).map((o) => ({ x: (o.strike / spot) * 100, y: o.iv * 100 }));
    if (pts.length > 2) smile.setData({ series: [{ name: 'Quoted IV', line: true, points: pts, r: 2 }], xFmt: (v) => `${v.toFixed(0)}%`, yFmt: (v) => v.toFixed(0), xLabel: 'Strike / spot', yLabel: 'Implied vol %' });
  };
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-d]');
    if (b) load(Number(b.dataset.d));
  });
  load(null);
  return { update: head, destroy: () => { gone = true; smile.destroy(); } };
});

live('BOOK', (ctx) => {
  const s = ctx.sec;
  const head = strip(ctx);
  const box = el('div', 'pane');
  ctx.el.appendChild(box);
  const update = () => {
    head();
    box.innerHTML = `<div class="split2"><div class="pane"><h3 class="up">Best bid</h3><div class="big up" style="padding:0 6px">${num(s.bid, s.dp)}</div><p class="note">size ${s.bidSize ?? '—'}</p></div>
      <div class="pane"><h3 class="down">Best ask</h3><div class="big down" style="padding:0 6px">${num(s.ask, s.dp)}</div><p class="note">size ${s.askSize ?? '—'}</p></div></div>
      <p class="note">Spread ${num(s.ask - s.bid, s.dp)}. Free data has the top of book only; full market depth is a paid exchange feed. Use <kbd>MODE SIM</kbd> to see the simulated depth ladder.</p>`;
  };
  update();
  return { update };
});

live('TAPE', (ctx) => {
  const s = ctx.sec;
  const head = strip(ctx);
  const box = el('div');
  ctx.el.appendChild(box);
  const update = () => {
    head();
    const real = s.prints.filter((p) => p.real);
    if (real.length || (ctx.engine.fh.stream === 'live' && s.fhsym)) {
      const buyV = real.filter((p) => p.side > 0).reduce((a, p) => a + p.q, 0);
      const tot = real.reduce((a, p) => a + p.q, 0) || 1;
      box.innerHTML = `<p class="note">Real-time trades from Finnhub · last ${real.length} · buy-side ${num((buyV / tot) * 100, 0)}% of volume (tick rule)</p>
        ${real.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th class="l">Time ET</th><th class="r">Price</th><th class="r">Size</th></tr></thead><tbody>
        ${real.slice(0, 80).map((p) => `<tr><td class="l dim">${ctx.engine.minuteLabel(p.s / 60)}:${String(Math.floor(((p.s % 60) + 60) % 60)).padStart(2, '0')}</td><td class="r ${p.side > 0 ? 'up' : 'down'}">${num(p.p, s.dp)}</td><td class="r ${p.q >= 1000 ? 'hl-big' : ''}">${p.q.toLocaleString('en-US')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Streaming. Waiting for the first trade (US stocks trade 09:30–16:00 ET; crypto around the clock).</div>'}`;
      return;
    }
    box.innerHTML = `<p class="note">${ctx.engine.fh.configured ? `${esc(s.sym)} isn't on the Finnhub stream (US stocks and crypto only, 50 at a time).` : 'Free Yahoo data has no trade-by-trade feed; add a Finnhub key (<kbd>FINNHUB &lt;key&gt;</kbd>) for real-time US stock trades.'} Below: price changes seen at each 15-second quote refresh.</p>
      ${s.prints.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th class="l">Time ET</th><th class="r">Price</th><th class="r">Move</th></tr></thead><tbody>
      ${s.prints.slice(0, 60).map((p, i, a) => `<tr><td class="l dim">${ctx.engine.minuteLabel(p.s / 60)}</td><td class="r ${p.side > 0 ? 'up' : 'down'}">${num(p.p, s.dp)}</td><td class="r dim">${a[i + 1] ? signed(p.p - a[i + 1].p, s.dp) : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Waiting for the first price change…</div>'}`;
  };
  update();
  return { update };
});

live('ECO', (ctx) => {
  const E = ctx.engine;
  const host = el('div');
  ctx.el.appendChild(host);
  const update = () => {
    const fh = E.fh;
    if (!fh.eco && E.fred.economy) return fredView(E, host);
    if (!fh.eco) {
      host.innerHTML = `<div class="empty">${fh.configured
        ? `Finnhub's economic calendar didn't load: ${esc(fh.ecoError || 'still loading')}.${/plan/.test(fh.ecoError || '') ? ' On Finnhub it is part of the paid plans.' : ''}`
        : 'No economic data source is connected.'}${E.fred.configured ? `<br>FRED: ${esc(E.fred.error || 'loading…')}` : '<br>Add a free FRED key for official US releases and their next dates: <kbd>FRED &lt;key&gt;</kbd> (sign up at fredaccount.stlouisfed.org/apikeys).'}<br>Real economic headlines: <kbd>NEWS ECONOMY</kbd>.</div>`;
      return;
    }
    const imp = { high: 3, medium: 2, low: 1 };
    const stars = (n) => `<span class="stars">${'●'.repeat(n)}<span class="dim">${'●'.repeat(3 - n)}</span></span>`;
    const v = (x, u) => (x == null ? '<span class="dim">—</span>' : `${num(x, Math.abs(x) >= 100 ? 0 : 2)}${esc(u || '')}`);
    const rows = [...fh.eco].sort((a, b) => String(a.time).localeCompare(String(b.time)));
    host.innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th class="l">Date</th><th class="l">Time UTC</th><th class="l">Ctry</th><th class="l">Event</th><th>Imp</th><th class="r">Prior</th><th class="r">Estimate</th><th class="r">Actual</th></tr></thead><tbody>
      ${rows.map((e) => {
        const d = e.actual != null && e.estimate != null ? e.actual - e.estimate : null;
        return `<tr class="${e.actual == null ? 'pending' : ''}"><td class="l dim">${esc(String(e.time).slice(5, 10))}</td><td class="l">${esc(String(e.time).slice(11, 16))}</td><td class="l">${esc(e.country)}</td><td class="l">${esc(e.event)}</td><td class="c">${stars(imp[e.impact] || 1)}</td><td class="r dim">${v(e.prev, e.unit)}</td><td class="r">${v(e.estimate, e.unit)}</td><td class="r ${d == null ? '' : dir(d)}">${v(e.actual, e.unit)}</td></tr>`;
      }).join('')}</tbody></table></div><p class="note">Source: Finnhub.</p>`;
  };
  update();
  return { update, every: 10 };
});

// Official US releases from FRED: latest reading, prior, and the next scheduled release.
// FRED publishes no economists' forecasts, so there is no survey or surprise column.
function fredView(E, host) {
  const today = new Date().toISOString().slice(0, 10);
  const v = (x, u) => (x == null ? '<span class="dim">—</span>' : `${u === 'K' ? num(x, Math.abs(x) >= 100 ? 0 : 1) : num(x, Math.abs(x) >= 100 ? 1 : 2)}${u === 'K' ? 'K' : esc(u)}`);
  const rows = [...E.fred.economy].sort((a, b) => String(a.nextRelease || '9').localeCompare(String(b.nextRelease || '9')));
  host.innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th class="l">Area</th><th class="l">Indicator</th><th class="l">Period</th><th class="r">Latest</th><th class="r">Prior</th><th class="r">Change</th><th class="l">Released</th><th class="l">Next release</th></tr></thead><tbody>
    ${rows.map((r) => r.error ? `<tr><td class="l dim">${esc(r.group || '')}</td><td class="l">${esc(r.label)}</td><td class="l dim" colspan="6">${esc(r.error)}</td></tr>` : `<tr>
      <td class="l dim">${esc(r.group || '')}</td><td class="l" title="${esc(r.release || '')} · FRED ${esc(r.id)}">${esc(r.label)}</td><td class="l dim">${esc(r.period)}</td>
      <td class="r">${v(r.actual, r.unit)}</td><td class="r dim">${v(r.prior, r.unit)}</td>
      <td class="r ${r.actual != null && r.prior != null ? dir(r.actual - r.prior) : ''}">${r.actual != null && r.prior != null ? signed(r.actual - r.prior, r.unit === 'K' ? 0 : 2) : ''}</td>
      <td class="l dim">${esc(r.lastRelease || '—')}</td>
      <td class="l ${r.nextRelease === today ? 'up' : ''}">${r.nextRelease ? (r.nextRelease === today ? '<b>Today</b>' : esc(r.nextRelease)) : '—'}</td></tr>`).join('')}
    </tbody></table></div><p class="note">Official US data from FRED (Federal Reserve Bank of St. Louis), refreshed hourly. FRED has no consensus forecasts, so there is no survey or surprise column. Hover an indicator for its release.</p>`;
}
