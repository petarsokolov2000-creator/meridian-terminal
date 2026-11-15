// DIVCAL: the dividend calendar of a portfolio. Which months pay, how much income a year, and a warning
// when a company cuts its dividend or stops paying.
//
// Like PRISK it works on the PAPER portfolio of PORT (the practice book in this app, not a brokerage
// account). To try any other mix: DIVCAL AAPL:100 JNJ:50 KO:200. The maths is in src/dividend-data.js.
// Months are EX-dividend months (the last day to buy and still receive it); the cash usually lands a few
// weeks later. Amounts are estimated from past payments and are not a promise.

import { register } from '../registry.js';
import { num, esc, el, secLink } from '../fmt.js';
import { loadBook, fxToUsd } from './tools.js';
import { analyse, income, alerts, monthLabel } from '../dividend-data.js';

const usd = (x, dp = 0) => (x == null || !Number.isFinite(x) ? '—' : `$${num(x, dp)}`);
const cell = (v) => (v > 0 ? `<td class="r">${usd(v)}</td>` : '<td class="r dim">·</td>');

function holdings(E, args) {
  const typed = args.filter((a) => /^[^:\s]+:\d+(\.\d+)?$/.test(a));
  const notes = [];
  const rows = [];
  let source = 'paper';
  if (typed.length) {
    source = 'typed';
    for (const t of typed) {
      const [s, q] = t.split(':');
      const i = E.get(s);
      if (!i) notes.push(`${s.toUpperCase()} isn't loaded, so it was left out (open it once with its ticker, then try again).`);
      else rows.push({ i, qty: Number(q), cost: null });
    }
  } else {
    const b = loadBook(E);
    for (const [s, p] of Object.entries(b.positions)) {
      const i = E.get(s);
      if (i && p.q > 0) rows.push({ i, qty: p.q, cost: p.cost });
    }
  }
  const stocks = rows.filter((r) => r.i.cls === 'EQ' && r.qty > 0);
  const skipped = rows.filter((r) => !stocks.includes(r)).map((r) => r.i.sym);
  if (skipped.length) notes.push(`${skipped.join(', ')} ${skipped.length === 1 ? "isn't a stock or fund" : "aren't stocks or funds"}, so ${skipped.length === 1 ? 'it pays' : 'they pay'} no dividend here.`);
  return { stocks, source, notes };
}

register({
  code: 'DIVCAL', aliases: ['DIVC', 'DIVINC', 'INCOME'], name: 'Dividend calendar & income', cat: 'Equity',
  help: 'DIVCAL — which months your portfolio gets dividends, the income per year, and a warning when one is cut or stops. DIVCAL AAPL:100 KO:200 tests any basket',
  run(ctx) {
    ctx.el.innerHTML = '<div class="empty">The dividend calendar needs real dividend history. Switch with <kbd>MODE LIVE</kbd> (Meridian has to be running from its icon).</div>';
  },
  live(ctx) {
    const E = ctx.engine;
    const h = holdings(E, ctx.args);
    const host = el('div');
    ctx.el.appendChild(host);
    if (!h.stocks.length) {
      host.innerHTML = `<div class="empty">${h.source === 'typed' ? 'None of those tickers could be used.' : 'The paper portfolio holds no stocks.'} Buy something with <kbd>BUY KO 100</kbd>, or test a basket: <kbd>DIVCAL KO:200 JNJ:50</kbd>.${h.notes.length ? `<br>${h.notes.map(esc).join(' ')}` : ''}</div>`;
      return;
    }
    host.innerHTML = `<div class="empty">Loading ${h.stocks.length} dividend histories from Yahoo Finance…</div>`;
    let gone = false;
    Promise.allSettled(h.stocks.map((r) => E.events(r.i.sym))).then((res) => {
      if (gone) return;
      const now = Math.floor(Date.now() / 1000);
      const failed = [];
      const rows = [];
      res.forEach((x, n) => {
        const r = h.stocks[n];
        if (x.status !== 'fulfilled') {
          failed.push(r.i.sym);
          return;
        }
        const ccy = x.value.currency || r.i.ccy;
        rows.push({ key: r.i.sym, inst: r.i, qty: r.qty, cost: r.cost, last: r.i.last, fx: fxToUsd(E, ccy), px: fxToUsd(E, r.i.ccy), a: analyse(x.value.dividends, now) });
      });
      if (!rows.length) {
        host.innerHTML = `<div class="empty">Couldn't load dividend history from Yahoo Finance: ${failed.map(esc).join(', ')}. Try again in a minute.</div>`;
        return;
      }
      const inc = income(rows, now);
      const al = alerts(inc.rows);
      const payers = inc.rows.filter((r) => r.annual > 0).length;
      const link = (r) => secLink(r.inst);
      const head = [
        ['Expected income, next 12 months', `<b>${usd(inc.annual)}</b> <span class="dim small">${usd(inc.annual / 12)} a month</span>`],
        ['Received, last 12 months', `<b>${usd(inc.pastTotal)}</b> <span class="dim small">by ex-dividend date</span>`],
        ['Yield on today\'s value', inc.value > 0 ? `<b>${num((inc.annual / inc.value) * 100, 2)}%</b>` : '<span class="dim">n/a</span>'],
        ['Paying positions', `<b>${payers}</b> <span class="dim small">of ${inc.rows.length}</span>`],
      ];
      const grid = (title, mks, totals, pick) => `<div class="pane"><h3>${title}</h3><div class="tbl-wrap"><table class="tbl dc-grid"><thead><tr><th class="l">Position</th>${mks.map((k) => `<th class="r">${monthLabel(k)}</th>`).join('')}<th class="r">Total</th></tr></thead><tbody>
        ${inc.rows.map((r) => `<tr><td class="l">${link(r)}</td>${pick(r).map(cell).join('')}<td class="r"><b>${usd(pick(r).reduce((a, b) => a + b, 0))}</b></td></tr>`).join('')}
        <tr class="dc-tot"><td class="l"><b>All</b></td>${totals.map(cell).join('')}<td class="r"><b>${usd(totals.reduce((a, b) => a + b, 0))}</b></td></tr></tbody></table></div></div>`;
      const stateCell = (a) => ({
        none: '<span class="dim">no dividend</span>',
        late: '<span class="down" title="the next payment is overdue">overdue</span>',
        cut: '<span class="down">cut</span>',
        raised: '<span class="up">raised</span>',
        steady: '<span class="dim">steady</span>',
      })[a.state];
      host.innerHTML = `
        <div class="port-head">${head.map(([k, v]) => `<div><span class="dim">${k}</span>${v}</div>`).join('')}</div>
        <p class="note">${h.source === 'typed' ? `A basket you typed (${rows.length} positions).` : `Your <b>paper portfolio</b> from <kbd>PORT</kbd> (the practice book in this app, not a brokerage account), ${rows.length} stocks.`} Shares are assumed to have been held for the whole period.</p>
        <div class="pane"><h3>What stands out</h3>${al.length ? al.map((f) => `<p class="note ${f.level === 'warn' ? 'warn' : ''}">${esc(f.text)}</p>`).join('') : '<p class="note">Nothing unusual: every dividend is steady and the income is spread over several payers.</p>'}</div>
        ${grid('Next 12 months (estimate)', inc.next, inc.nextM, (r) => r.nextM)}
        ${grid('Last 12 months (by ex-dividend date)', inc.past, inc.pastM, (r) => r.pastM)}
        <div class="pane"><h3>By position</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th class="l">Position</th><th class="r">Shares</th><th class="r">Per share a year</th><th class="r">Income a year</th><th class="r" title="Income a year divided by what the position is worth today">Yield</th><th class="r" title="Income a year divided by what was paid for it (paper portfolio only)">Yield on cost</th><th class="r">Payments</th><th class="l">Latest</th></tr></thead><tbody>
        ${inc.rows.map((r) => `<tr><td class="l">${link(r)}</td><td class="r">${num(r.qty, r.qty % 1 ? 2 : 0)}</td><td class="r">${r.a.forward == null ? '—' : num(r.a.forward, 2)}</td><td class="r">${usd(r.annual)}</td><td class="r">${r.yld == null ? '—' : `${num(r.yld * 100, 2)}%`}</td><td class="r dim">${r.yoc == null ? '—' : `${num(r.yoc * 100, 2)}%`}</td><td class="r dim">${r.a.freq ? `${r.a.freq} a year` : '—'}</td><td class="l">${stateCell(r.a)}${r.a.change != null && r.a.state !== 'steady' && r.a.state !== 'late' ? ` <span class="dim small">${r.a.change > 0 ? '+' : '−'}${num(Math.abs(r.a.change) * 100, 0)}%</span>` : ''}</td></tr>`).join('')}
        </tbody></table></div></div>
        <p class="note">${h.notes.map(esc).join(' ')}${failed.length ? ` Couldn't load: ${failed.map(esc).join(', ')}.` : ''}
        Method: each regular payment of the last 12 months is assumed to come round again a year later, at the latest amount per share, so a company that raised its dividend recently is counted at the new rate. Months are ex-dividend months (the last day to buy and still receive the payment); the money usually arrives a few weeks later. Unusually large one-off payments are shown in the past, but left out of the estimate. Dividends in other currencies are converted at today's rate, before any tax. Nothing here is a promise: a company can cut, skip or raise its dividend at any time.</p>`;
    });
    return { destroy: () => (gone = true) };
  },
});
