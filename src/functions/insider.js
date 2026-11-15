// INSIDER: what the people who run a company do with its stock (open-market buys and sales).
// SI: how many shares are sold short, and how crowded that bet is.
//
// Both read Yahoo Finance's company details (the same call HOLD and KEYS use): insider trades come
// from SEC Forms 4, short interest from the exchanges' twice-monthly reports. Both can be shown for
// one stock, for your WATCH list, your PORT portfolio, or the whole MARKET list of Meridian.
// Neither is a trading signal on its own: see the notes on each screen.

import { altNote } from '../sources.js';
import { register } from '../registry.js';
import { num, big, esc, el, secLink, store, save } from '../fmt.js';
import { normalize, windowStats, signal, monthly, coverage, shortStats, addSnapshot, LEVEL_WORD, LEVEL_CLS, COVER_WORD, MIN_TRADE } from '../insider-data.js';
import { stocksOf, positionOf, scan } from '../detail-scan.js';

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const NA = '<span class="dim">n/a</span>';
const usd = (v) => (fin(v) ? `$${big(Math.abs(v))}` : '—');
const sgnUsd = (v) => (!fin(v) || v === 0 ? '$0' : `${v < 0 ? '−' : '+'}$${big(Math.abs(v))}`);
const day = (sec) => (sec ? new Date(sec * 1000).toISOString().slice(0, 10) : '—');
const ago = (sec, nowMs = Date.now()) => {
  const d = Math.floor((nowMs - sec * 1000) / 86400e3);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 60 ? `${d} days ago` : `${Math.round(d / 30)} months ago`;
};
const pctTxt = (v, dp = 1) => (fin(v) ? `${v > 0 ? '+' : ''}${num(v * 100, dp)}%` : '—');
const isReal = (ctx) => (ctx.engine.lookup ? true : (ctx.el.innerHTML = '<div class="empty">This needs real company data. Switch with <kbd>MODE LIVE</kbd> (Meridian has to be running from its icon).</div>', false));
const notStock = (ctx, what) => {
  if (ctx.sec.cls === 'EQ' && !ctx.sec.etf) return false;
  ctx.el.innerHTML = `<div class="empty">${esc(what)} is for company stocks (${esc(ctx.sec.sym)} isn't one).</div>`;
  return true;
};
const WHICH = { WATCH: 'WATCH', PORT: 'PORT', PORTFOLIO: 'PORT', MARKET: 'MARKET', MKT: 'MARKET', ALL: 'MARKET' };
const whichOf = (ctx) => WHICH[String(ctx.args[0] || '').toUpperCase()] || null;
const WHERE = { WATCH: 'Your watchlist', PORT: 'Your portfolio', MARKET: 'All stocks in Meridian' };

// ---------------------------------------------------------------------------------------------
// list screens (WATCH / PORT / MARKET), shared by INSIDER and SI

function listScreen(ctx, which, cfg) {
  const E = ctx.engine;
  const stocks = stocksOf(E, which);
  if (!stocks.length) {
    ctx.el.innerHTML = `<div class="empty">No company stocks on your ${which === 'WATCH' ? 'watchlist' : 'portfolio'} yet.</div>`;
    return;
  }
  const state = new Map(stocks.map((i) => [i.sym, { state: 'idle' }]));
  const host = el('div', 'revlist');
  ctx.el.appendChild(host);
  let job = null;
  let gone = false;
  const draw = () => {
    const rows = stocks.map((i) => cfg.row(i, state.get(i.sym), E));
    rows.sort((a, b) => b.key - a.key);
    const done = [...state.values()].filter((x) => x.state === 'ok' || x.state === 'failed').length;
    const running = job && done < stocks.length;
    const start = which === 'MARKET' && !job ? `<p><button class="tb" data-scan>Scan all ${stocks.length} stocks</button> <span class="dim small">One Yahoo request per stock (answers are kept for an hour, so ${cfg.other} reuses them). Takes a few minutes; the table fills as results arrive.</span></p>` : '';
    host.innerHTML = `<p class="note">${WHERE[which]}${running ? ` — loading ${done} of ${stocks.length}…` : ''} ${cfg.intro}</p>${start}
      <div class="tbl-wrap"><table class="tbl compact"><thead><tr>${cfg.head}</tr></thead><tbody>${rows.map((r) => r.html).join('')}</tbody></table></div><p class="note">${cfg.foot}</p>`;
  };
  const begin = () => {
    for (const s of state.values()) s.state = 'loading';
    job = scan(E, stocks, (i, out) => {
      if (gone) return;
      state.set(i.sym, out.det ? { state: 'ok', det: out.det } : { state: 'failed', error: out.error });
      if (cfg.onLoaded && out.det) cfg.onLoaded(i, out.det);
      draw();
    }, 2);
    draw();
  };
  ctx.el.addEventListener('click', (e) => { if (e.target.closest('[data-scan]')) begin(); });
  draw();
  if (which !== 'MARKET') begin();
  return { destroy: () => { gone = true; job?.stop(); } };
}

const stateRow = (i, x, cols) => (x.state === 'ok' ? null : { key: -Infinity, html: `<tr><td class="l">${secLink(i)}</td><td class="l dim" colspan="${cols}">${x.state === 'failed' ? esc(x.error) : x.state === 'loading' ? 'loading…' : 'not scanned yet'}</td></tr>` });

// ---------------------------------------------------------------------------------------------
// INSIDER

const KIND = { BUY: ['Buy', 'up'], SELL: ['Sell', 'down'], AWARD: ['Award (grant)', 'dim'], EXERCISE: ['Option exercise / tax', 'dim'], GIFT: ['Gift', 'dim'], OTHER: ['Other', 'dim'] };

function barChart(months) {
  const W = 480; const H = 130; const mid = 62;
  const top = Math.max(1, ...months.map((m) => Math.max(m.buy, m.sell)));
  const bw = (W / months.length) * 0.58;
  const bars = months.map((m, k) => {
    const x = (W / months.length) * k + ((W / months.length) - bw) / 2;
    const hb = (m.buy / top) * (mid - 10);
    const hs = (m.sell / top) * (H - mid - 20);
    const label = new Date(`${m.key}-15T00:00:00Z`).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
    return `<g><title>${m.key}: bought ${usd(m.buy)}, sold ${usd(m.sell)}</title>
      ${m.buy ? `<rect x="${x.toFixed(1)}" y="${(mid - hb).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(hb, 1.5).toFixed(1)}" style="fill:var(--up)"/>` : ''}
      ${m.sell ? `<rect x="${x.toFixed(1)}" y="${mid}" width="${bw.toFixed(1)}" height="${Math.max(hs, 1.5).toFixed(1)}" style="fill:var(--down)"/>` : ''}
      <text x="${(x + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="12" style="fill:var(--dim)">${label}</text></g>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="ins-chart" role="img" aria-label="Insider purchases above the line and sales below it, per month, last 12 months"><line x1="0" x2="${W}" y1="${mid}" y2="${mid}" style="stroke:var(--line)"/>${bars}</svg>`;
}

function insiderOne(ctx) {
  const s = ctx.sec;
  const E = ctx.engine;
  const wait = el('div', 'empty', 'Loading insider trades from Yahoo Finance…');
  ctx.el.appendChild(wait);
  let gone = false;
  let showAll = false;
  E.details(s.sym).then((d) => {
    if (gone) return;
    wait.remove();
    const now = Date.now();
    const rows = normalize(d.insiders);
    const sig = signal(rows, now);
    const w90 = windowStats(rows, 90, now);
    const w365 = windowStats(rows, 365, now);
    const cov = coverage(rows);
    const lastBuy = rows.find((t) => t.kind === 'BUY' && !t.small);
    const px = s.last;
    const sinceBuy = lastBuy?.price ? px / lastBuy.price - 1 : null;
    const draw = () => {
      const shown = rows.filter((t) => showAll || t.kind === 'BUY' || t.kind === 'SELL').slice(0, 60);
      ctx.el.innerHTML = `
        <div class="port-head">
          <div><span class="dim">Insiders (180 days)</span><b class="${sig.cls}" title="${esc(sig.why)}">${esc(sig.word)}</b></div>
          <div><span class="dim">Bought, 90 days</span><b class="${w90.buy.n ? 'up' : 'dim'}">${w90.buy.n ? `${usd(w90.buy.value)} <span class="dim small">${w90.buy.n} buys · ${w90.buy.people} ${w90.buy.people === 1 ? 'person' : 'people'}</span>` : 'none'}</b></div>
          <div><span class="dim">Sold, 90 days</span><b class="${w90.sell.n ? 'down' : 'dim'}">${w90.sell.n ? `${usd(w90.sell.value)} <span class="dim small">${w90.sell.n} sales · ${w90.sell.people} ${w90.sell.people === 1 ? 'person' : 'people'}</span>` : 'none'}</b></div>
          <div><span class="dim">Net, 12 months</span><b class="${w365.net > 0 ? 'up' : w365.net < 0 ? 'down' : 'dim'}">${sgnUsd(w365.net)}</b></div>
          <div><span class="dim">Last purchase</span><b>${lastBuy ? `${day(lastBuy.date)} <span class="dim small">${ago(lastBuy.date, now)}${lastBuy.price ? ` · at ${num(lastBuy.price, 2)}, now <span class="${sinceBuy >= 0 ? 'up' : 'down'}">${pctTxt(sinceBuy)}</span>` : ''}</span>` : '<span class="dim">none listed</span>'}</b></div>
        </div>
        <div class="pane"><h3>Purchases (up) and sales (down) per month, USD</h3>${barChart(monthly(rows, now, 12))}</div>
        <div class="pane"><h3>Trades ${rows.length ? `<label class="dim small ins-all"><input type="checkbox" data-all ${showAll ? 'checked' : ''}> also show awards, option exercises and gifts</label>` : ''}</h3>
          ${shown.length ? `<div class="tbl-wrap"><table class="tbl compact"><thead><tr><th class="l">Date</th><th class="l">Insider</th><th class="l">Role</th><th class="l">Type</th><th class="r">Shares</th><th class="r">Price</th><th class="r">Value</th><th class="r" title="For purchases: today's price against the price paid">Since</th></tr></thead><tbody>
          ${shown.map((t) => { const [word, cls] = KIND[t.kind]; const since = t.kind === 'BUY' && t.price ? px / t.price - 1 : null; return `<tr class="${t.small ? 'dim' : ''}"><td class="l dim">${day(t.date)}</td><td class="l">${esc(t.name)}</td><td class="l dim" title="${esc(t.relation)}">${esc(t.role)}</td><td class="l ${cls}" title="${esc(t.text)}">${word}${t.small ? ` <span class="small" title="Under $${MIN_TRADE.toLocaleString('en-US')}: shown, but left out of the totals">(small)</span>` : ''}</td><td class="r">${t.shares == null ? '—' : big(t.shares)}</td><td class="r">${t.price ? num(t.price, 2) : '—'}</td><td class="r">${t.value ? usd(t.value) : '—'}</td><td class="r ${since == null ? 'dim' : since >= 0 ? 'up' : 'down'}">${since == null ? '' : pctTxt(since)}</td></tr>`; }).join('')}
          </tbody></table></div>` : `<p class="note">${rows.length ? 'No open-market purchases or sales listed (tick the box to see awards and exercises).' : 'Yahoo lists no insider filings for this company. Non-US companies, for instance, don\'t file Form 4.'}</p>`}
        </div>
        ${altNote(d, 'insiders', 'The insider trades', !rows.length)}
        <p class="note">${cov ? `Yahoo lists ${cov.n} filings from ${day(cov.from)} to ${day(cov.to)}; the totals only count what is listed. ` : ''}Only <b>open-market purchases and sales</b> count: grants, option exercises, tax withholding and gifts don't say what an insider thinks of the price, and trades under $${MIN_TRADE.toLocaleString('en-US')} are shown but left out of the totals.</p>
        <p class="note"><b>How to read it:</b> buying is the stronger signal, because insiders sell for many reasons (taxes, a house, diversifying, a pre-arranged plan) but buy for one. <b>Cluster buying</b> = three or more different insiders buying within 30 days; <b>Executive buying</b> = an officer (not just a director) bought and bought more than was sold. Studies have mostly found modest outperformance after insider buying, especially in smaller companies and clusters, but it is no guarantee for any single stock, and the information is already public. Figures are in USD. Pre-arranged (10b5-1) sales aren't marked by Yahoo. Original forms: <kbd>${esc(s.sym)} FILE</kbd>. Your whole list: <kbd>INSIDER WATCH</kbd>, <kbd>INSIDER PORT</kbd>, <kbd>INSIDER MARKET</kbd>.</p>`;
    };
    draw();
    ctx.el.addEventListener('change', (e) => { if (e.target.matches('[data-all]')) { showAll = e.target.checked; draw(); } });
  }).catch((err) => { if (!gone) wait.textContent = `Couldn't load insider trades: ${err.message}`; });
  return { destroy: () => { gone = true; } };
}

const insiderList = (ctx, which) => listScreen(ctx, which, {
  other: 'SI',
  intro: 'ranked by how bullish the insiders\' open-market trading of the last 180 days looks (cluster buying first, then executive buying, then net buying), then by dollars bought. Selling alone is a weak signal and is never ranked as a warning.',
  head: '<th class="l">Ticker</th><th class="r">Price</th><th class="l">Insiders, 180 days</th><th class="r" title="Open-market purchases of $10,000 or more in the last 90 days">Bought 90d</th><th class="r">Buyers</th><th class="r">Sold 90d</th><th class="r" title="Bought minus sold, last 12 months">Net 12m</th><th class="l">Last purchase</th>',
  foot: 'Open-market trades of $10,000 or more only. Open a ticker\'s own <kbd>INSIDER</kbd> screen to see every trade.',
  row(i, x) {
    const pending = stateRow(i, x, 7);
    if (pending) return pending;
    const now = Date.now();
    const rows = normalize(x.det.insiders);
    const sig = signal(rows, now);
    const w90 = windowStats(rows, 90, now);
    const w365 = windowStats(rows, 365, now);
    const lb = rows.find((t) => t.kind === 'BUY' && !t.small);
    return { key: sig.rank * 1e12 + sig.w.buy.value, html: `<tr><td class="l">${secLink(i)}</td><td class="r">${num(i.last, i.dp)}</td><td class="l ${sig.cls}" title="${esc(sig.why)}">${esc(sig.word)}</td><td class="r ${w90.buy.n ? 'up' : 'dim'}">${w90.buy.n ? usd(w90.buy.value) : '—'}</td><td class="r dim">${w90.buy.people || '—'}</td><td class="r ${w90.sell.n ? 'down' : 'dim'}">${w90.sell.n ? usd(w90.sell.value) : '—'}</td><td class="r ${w365.net > 0 ? 'up' : w365.net < 0 ? 'down' : 'dim'}">${w365.buy.n || w365.sell.n ? sgnUsd(w365.net) : '—'}</td><td class="l dim">${lb ? `${day(lb.date)}${lb.price ? ` <span class="${i.last / lb.price >= 1 ? 'up' : 'down'}">${pctTxt(i.last / lb.price - 1)}</span>` : ''}` : '—'}</td></tr>` };
  },
});

register({
  code: 'INSIDER', aliases: ['INSB', 'INSBUY', 'FORM4', 'IBUY'], name: 'Insider buying & selling', cat: 'Equity', sec: true,
  help: 'INSIDER — open-market buys and sales by executives and directors, cluster buying, 12-month chart. INSIDER WATCH / PORT / MARKET: the same ranked for a list of stocks',
  run(ctx) { isReal(ctx); },
  live(ctx) {
    const which = whichOf(ctx);
    if (which) return insiderList(ctx, which);
    if (notStock(ctx, 'Insider trades')) return;
    return insiderOne(ctx);
  },
});

// ---------------------------------------------------------------------------------------------
// SI

const levelHtml = (st) => (st.level == null ? '<span class="dim">n/a</span>' : `<span class="${LEVEL_CLS[st.level]}">${LEVEL_WORD[st.level]}</span>`);
const snapshot = (sym, st) => {
  if (!st?.date) return;
  const key = `si:${sym}`;
  const before = store(key, []);
  const after = addSnapshot(before, st, Date.now());
  if (after.length !== (Array.isArray(before) ? before.length : 0)) save(key, after);
};

function siOne(ctx) {
  const s = ctx.sec;
  const E = ctx.engine;
  const wait = el('div', 'empty', 'Loading short interest from Yahoo Finance…');
  ctx.el.appendChild(wait);
  let gone = false;
  E.details(s.sym).then((d) => {
    if (gone) return;
    wait.remove();
    const st = shortStats(d.stats);
    if (!st) {
      ctx.el.innerHTML = `<div class="empty">Yahoo lists no short interest for ${esc(s.sym)}. It only has it for US-listed stocks.</div>`;
      return;
    }
    snapshot(s.sym, st);
    const hist = store(`si:${s.sym}`, []);
    const q = positionOf(E, s.sym);
    const widthOf = (v) => `${Math.max(2, Math.min(100, (v / 0.3) * 100))}%`;
    const tone = st.level == null ? 'flat' : st.level >= 2 ? 'down' : st.level === 1 ? 'flat' : 'up';
    ctx.el.innerHTML = `
      <div class="port-head">
        <div><span class="dim">Short % of float</span><b>${fin(st.pf) ? `${num(st.pf * 100, 1)}%` : NA} <span class="small">${levelHtml(st)}</span></b></div>
        <div><span class="dim">Days to cover</span><b>${fin(st.dtc) ? `${num(st.dtc, 1)} <span class="dim small">${COVER_WORD[st.cover]}</span>` : NA}</b></div>
        <div><span class="dim">Shares short</span><b>${big(st.shares)}</b></div>
        <div><span class="dim">Since previous report</span><b class="${st.change > 0.1 ? 'down' : st.change < -0.1 ? 'up' : 'dim'}">${st.change == null ? 'n/a' : `${pctTxt(st.change)} <span class="dim small">${st.trend}</span>`}</b></div>
        <div><span class="dim">Report date</span><b>${day(st.date)} <span class="dim small">${st.date ? ago(st.date) : ''}</span></b></div>
      </div>
      ${st.squeeze ? '<div class="pane"><p class="note"><b class="down">Crowded and slow to cover.</b> Many shares are sold short and it would take days of normal trading to buy them back. If good news arrives, shorts rushing to cover can push the price up sharply (a squeeze); if nothing happens, nothing happens. It needs a catalyst, and short sellers are right more often than not.</p></div>' : ''}
      ${q < 0 ? `<div class="pane"><p class="note"><b class="down">You are short ${num(-q, 0)} shares of ${esc(s.sym)} in PORT.</b> ${st.level >= 2 ? 'With this much short interest you are in a crowded trade: a squeeze would work against you.' : 'Short interest is not extreme, so a squeeze is less of a worry.'}</p></div>` : ''}
      <div class="pane"><h3>How crowded is the bet?</h3>
        <table class="tbl compact si-facts"><tbody>
          <tr><td class="l">Short % of float<div class="dim small">under 3% low · 3–10% moderate · 10–20% high · over 20% very high (bar ends at 30%)</div><span class="si-bar" style="width:${fin(st.pf) ? widthOf(st.pf) : '0%'};background:var(--${tone})"></span></td><td class="r"><b>${fin(st.pf) ? `${num(st.pf * 100, 2)}%` : 'n/a'}</b></td></tr>
          <tr><td class="l">Days to cover (Yahoo)<div class="dim small">shares short ÷ average daily volume · under 2 quick · 2–5 moderate · over 5 slow</div></td><td class="r"><b>${fin(st.dtc) ? num(st.dtc, 2) : 'n/a'}</b></td></tr>
          <tr><td class="l">Days to cover, last 10 days' volume<div class="dim small">the same with recent volume: higher than the line above when trading has dried up</div></td><td class="r"><b>${fin(st.dtc10) ? num(st.dtc10, 2) : 'n/a'}</b></td></tr>
          <tr><td class="l">Short % of all shares<div class="dim small">against shares outstanding instead of the float (shares that can trade)</div></td><td class="r"><b>${fin(st.ofOut) ? `${num(st.ofOut * 100, 2)}%` : 'n/a'}</b></td></tr>
          <tr><td class="l">Previous report<div class="dim small">shares short about a month earlier${st.change == null ? '' : `; now ${pctTxt(st.change)}`}</div></td><td class="r"><b>${st.prior ? big(st.prior) : 'n/a'}</b></td></tr>
        </tbody></table>
      </div>
      <div class="pane"><h3>Saved on this device</h3>${hist.length > 1 ? `<table class="tbl compact"><thead><tr><th class="l">Report date</th><th class="r">Shares short</th><th class="r">% of float</th><th class="r">Days to cover</th><th class="r">Change</th></tr></thead><tbody>${hist.map((h, k) => { const prev = hist[k + 1]; const ch = prev && prev.s > 0 ? h.s / prev.s - 1 : null; return `<tr><td class="l dim">${esc(h.d)}</td><td class="r">${big(h.s)}</td><td class="r">${fin(h.p) ? `${num(h.p * 100, 1)}%` : '—'}</td><td class="r">${fin(h.c) ? num(h.c, 1) : '—'}</td><td class="r ${ch > 0.1 ? 'down' : ch < -0.1 ? 'up' : 'dim'}">${ch == null ? '' : pctTxt(ch)}</td></tr>`; }).join('')}</tbody></table>` : '<p class="note">Yahoo only provides the latest report and the one a month before. Every time you open this screen the newest report is saved here, so a history builds up over the weeks.</p>'}</div>
      <p class="note"><b>How to read it:</b> short interest is how many shares investors have borrowed and sold, betting on a fall. It is reported twice a month and published about a week after the reporting date, so it is typically <b>1–3 weeks old</b> when you see it. High short interest means many people are betting against the company (often for good reasons), not that the price will rise. It becomes interesting when it is high <i>and</i> the stock is slow to cover <i>and</i> something changes the story. Rising short interest into earnings is a warning sign, falling short interest means those bets are being closed. What shorts pay to borrow the shares (a strong clue to how crowded it really is) is not free data and isn't shown. Your whole list: <kbd>SI WATCH</kbd>, <kbd>SI PORT</kbd>, <kbd>SI MARKET</kbd>.</p>`;
  }).catch((err) => { if (!gone) wait.textContent = `Couldn't load short interest: ${err.message}`; });
  return { destroy: () => { gone = true; } };
}

const siList = (ctx, which) => listScreen(ctx, which, {
  other: 'INSIDER',
  intro: 'ranked by short interest as a share of the float. High is not "good" or "bad": it shows where the bets against the stock are crowded.',
  head: '<th class="l">Ticker</th><th class="r">Price</th><th class="r" title="Shares sold short as a share of the float">Short % float</th><th class="l">Level</th><th class="r" title="Shares short divided by average daily volume">Days to cover</th><th class="r" title="Against the report a month earlier">Change</th><th class="r">Shares short</th><th class="l">Flags</th>',
  foot: 'Reports are published twice a month, about a week after the reporting date. SQUEEZE = at least 15% of the float short and 4 or more days to cover. YOU SHORT = a short position in your PORT book.',
  onLoaded: (i, det) => snapshot(i.sym, shortStats(det.stats)),
  row(i, x, E) {
    const pending = stateRow(i, x, 7);
    if (pending) return pending;
    const st = shortStats(x.det.stats);
    if (!st) return { key: -1, html: `<tr><td class="l">${secLink(i)}</td><td class="r">${num(i.last, i.dp)}</td><td class="l dim" colspan="6">no short interest listed</td></tr>` };
    const q = positionOf(E, i.sym);
    return { key: fin(st.pf) ? st.pf : -0.5, html: `<tr><td class="l">${secLink(i)}</td><td class="r">${num(i.last, i.dp)}</td><td class="r"><b>${fin(st.pf) ? `${num(st.pf * 100, 1)}%` : 'n/a'}</b></td><td class="l">${levelHtml(st)}</td><td class="r">${fin(st.dtc) ? num(st.dtc, 1) : 'n/a'}</td><td class="r ${st.change > 0.1 ? 'down' : st.change < -0.1 ? 'up' : 'dim'}">${st.change == null ? '—' : pctTxt(st.change)}</td><td class="r dim">${big(st.shares)}</td><td class="l">${st.squeeze ? '<span class="tag down">SQUEEZE</span> ' : ''}${q < 0 ? '<span class="tag">YOU SHORT</span>' : ''}</td></tr>` };
  },
});

register({
  code: 'SI', aliases: ['SHORTINT', 'SHRT', 'SHORTI'], name: 'Short interest', cat: 'Equity', sec: true,
  help: 'SI — shares sold short, % of float, days to cover, change since the last report, squeeze check. SI WATCH / PORT / MARKET: the same ranked for a list of stocks',
  run(ctx) { isReal(ctx); },
  live(ctx) {
    const which = whichOf(ctx);
    if (which) return siList(ctx, which);
    if (notStock(ctx, 'Short interest')) return;
    return siOne(ctx);
  },
});
