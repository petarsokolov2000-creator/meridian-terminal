// PRISK: how risky is this portfolio? Volatility, the size of a bad day, which positions carry the risk,
// which ones move together, and how concentrated the book is.
//
// It measures the PAPER portfolio of PORT (the practice book kept in this app), not a brokerage account.
// To test any other mix, give shares: PRISK AAPL:100 MSFT:50 JPM:-20 (a minus sign is a short). The maths
// is in src/risk-data.js. Every figure comes from the last year of daily prices: it describes how this mix
// behaved, it does not limit how it can behave.

import { register } from '../registry.js';
import { num, esc, el, secLink } from '../fmt.js';
import { loadBook, fxToUsd } from './tools.js';
import { portfolioRisk, flags } from '../risk-data.js';

const pc = (x, dp = 1) => (x == null || !Number.isFinite(x) ? '—' : `${num(x * 100, dp)}%`);
const usd = (x) => (x == null ? '—' : `$${num(Math.abs(x), 0)}`);

function holdings(E, args) {
  const typed = args.filter((a) => /^[^:\s]+:-?\d+(\.\d+)?$/.test(a));
  const notes = [];
  let source = 'paper';
  let cash = 0;
  const rows = [];
  if (typed.length) {
    source = 'typed';
    for (const t of typed) {
      const [s, q] = t.split(':');
      const i = E.get(s);
      if (!i) {
        notes.push(`${s.toUpperCase()} isn't loaded, so it was left out (open it once with its ticker, then try again).`);
        continue;
      }
      rows.push({ i, q: Number(q) });
    }
  } else {
    const b = loadBook(E);
    cash = b.cash;
    for (const [s, p] of Object.entries(b.positions)) {
      const i = E.get(s);
      if (i) rows.push({ i, q: p.q });
    }
  }
  const out = rows
    .filter((r) => r.q !== 0 && r.i.history?.length > 1 && r.i.cls !== 'BOND' && r.i.cls !== 'IDX')
    .map((r) => ({ key: r.i.sym, mv: r.q * r.i.last * fxToUsd(E, r.i.ccy), sector: r.i.cls === 'EQ' ? (r.i.etf ? 'ETF' : r.i.sector) : r.i.cls, bars: r.i.history }));
  return { rows: out, cash, source, notes };
}

register({
  code: 'PRISK', aliases: ['PVAR', 'PRSK'], name: 'Portfolio risk', cat: 'Analytics',
  help: 'PRISK — volatility, size of a bad day, which positions carry the risk and which move together. PRISK AAPL:100 MSFT:50 tests any basket (minus = short)',
  run(ctx) {
    const E = ctx.engine;
    const host = el('div');
    ctx.el.appendChild(host);
    const draw = () => {
      const h = holdings(E, ctx.args);
      if (!h.rows.length) {
        host.innerHTML = `<div class="empty">${h.source === 'typed' ? 'None of those tickers could be used.' : 'The paper portfolio is empty.'} Buy something with <kbd>BUY ${esc(E.defaults.sec)} 100</kbd>, or test a basket: <kbd>PRISK AAPL:100 MSFT:50</kbd>.</div>`;
        return;
      }
      const bench = E.get(E.defaults.bench)?.history || null;
      const r = portfolioRisk(h.rows, h.cash, bench);
      if (r.error) {
        host.innerHTML = `<div class="empty">Portfolio risk can't be measured: ${esc(r.error)}.${r.dropped?.length ? ` ${r.dropped.map(esc).join(', ')} had too little price history.` : ''}</div>`;
        return;
      }
      const cells = [
        ['Portfolio value', `<b>${usd(r.nav)}</b>`],
        ['Volatility (a year)', `<b>${pc(r.annVol)}</b> <span class="dim small">${pc(r.vol, 2)} a day</span>`],
        ['A bad day (1 in 20)', `<b class="down">−${pc(r.var95, 1)}</b> <span class="dim small">${usd(r.var95 * r.nav)}</span>`],
        ['Average of the worst days', `<b class="down">−${pc(r.es95, 1)}</b> <span class="dim small">${usd(r.es95 * r.nav)}</span>`],
        ['Worst day in the year', `<b class="down">${pc(r.worst, 1)}</b> <span class="dim small">${usd(r.worst * r.nav)}</span>`],
        ['Market beta', r.beta == null ? '<span class="dim">n/a</span>' : `<b>${num(Math.abs(r.beta) < 0.005 ? 0 : r.beta, 2)}</b> <span class="dim small">vs ${esc(E.defaults.bench)}</span>`],
        ['Behaves like', r.effN == null ? '<span class="dim">n/a</span>' : `<b>${num(r.effN, 1)}</b> <span class="dim small">equal positions (of ${h.rows.length})</span>`],
        ['Avg. correlation', r.avgCorr == null ? '<span class="dim">n/a</span>' : `<b>${num(r.avgCorr, 2)}</b>`],
      ];
      const maxW = Math.max(...r.contrib.map((c) => Math.max(Math.abs(c.weight), Math.abs(c.share))), 0.01);
      const bar = (v, cls) => `<span class="pr-bar ${cls}" style="width:${Math.max(1, Math.round((Math.abs(v) / maxW) * 100))}%"></span>`;
      const fl = flags(r);
      const link = (k) => (E.get(k) ? secLink(E.get(k)) : esc(k));
      host.innerHTML = `
        <div class="port-head">${cells.map(([k, v]) => `<div><span class="dim">${k}</span>${v}</div>`).join('')}</div>
        <p class="note">${h.source === 'typed' ? `A basket you typed (${h.rows.length} positions), valued at today's prices.` : `Your <b>paper portfolio</b> from <kbd>PORT</kbd> (the practice book in this app, not a brokerage account), ${h.rows.length} positions.`} Based on ${r.days} trading days, ${esc(r.from)} to ${esc(r.to)}.</p>
        <div class="pane"><h3>What stands out</h3>${fl.length ? fl.map((f) => `<p class="note ${f.level === 'warn' ? 'warn' : ''}">${esc(f.text)}</p>`).join('') : '<p class="note">Nothing unusual: no single position, sector or group of look-alike stocks dominates.</p>'}</div>
        <div class="split2">
          <div class="pane"><h3>Where the risk comes from</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th class="l">Position</th><th class="r">Weight</th><th class="r">Own volatility</th><th class="r" title="How much of the portfolio's daily swings this position accounts for">Share of risk</th><th class="l">Weight vs risk</th></tr></thead><tbody>
          ${r.contrib.map((c) => `<tr><td class="l">${link(c.key)}</td><td class="r">${pc(c.weight)}</td><td class="r dim">${pc(c.vol, 0)}</td><td class="r ${c.share > 1.5 * Math.abs(c.weight) && c.share > 0.2 ? 'down' : ''}">${pc(c.share, 0)}</td><td class="l pr-cell">${bar(c.weight, 'w')}${bar(c.share, 'r')}</td></tr>`).join('')}
          </tbody></table></div><p class="note"><span class="pr-key w"></span> share of the portfolio's value · <span class="pr-key r"></span> share of its risk. A position whose red bar is longer than its grey one is riskier than it is large.</p></div>
          <div class="pane"><h3>What moves together</h3>${r.clusters.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th class="l">Group</th><th class="r">Weight</th><th class="r">Correlation</th></tr></thead><tbody>${r.clusters.map((c) => `<tr><td class="l">${c.keys.map(link).join(', ')}</td><td class="r">${pc(Math.abs(c.weight), 0)}</td><td class="r">${num(c.corr, 2)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="note">No two positions were correlated at 0.7 or more, so none of them is a copy of another.</p>'}
          <h3>By sector</h3><div class="tbl-wrap"><table class="tbl"><tbody>${r.sectors.slice(0, 8).map((s) => `<tr><td class="l">${esc(s.name)}</td><td class="r">${pc(s.w, 0)}</td></tr>`).join('')}</tbody></table></div></div>
        </div>
        <p class="note">${h.notes.map(esc).join(' ')}${r.dropped.length ? ` ${r.dropped.map(esc).join(', ')} left out: too little price history.` : ''}
        Method: daily returns over the trading days all positions share. "A bad day" is the 5th-worst of every 100 days in that window: the portfolio lost at least this much on 1 day in 20. "Average of the worst days" is what those worst 5% of days averaged. Returns are in each security's own currency, and positions are weighted by today's value as if they had been held all year. These figures describe the past year. A calm year hides risk, a stormy one overstates it, and a real crash can be far worse than any day in the window.</p>`;
    };
    draw();
    return { update: draw, every: 60 };
  },
});
