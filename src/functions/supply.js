// SUPP: a company's suppliers (left) and customers (right) as a map plus two lists, with each
// company's move today. Tap any company to see its own supply chain. Data: supply-chain.js.

import { register } from '../registry.js';
import { num, dir, esc, el, store, save } from '../fmt.js';
import { chainOf, tiersOf, covered, OUTSIDE, AS_OF } from '../supply-chain.js';

const BASIS = { disclosed: 'disclosed', reported: 'reported', yours: 'yours' };
const BASIS_HELP = { disclosed: 'Stated publicly by one of the two companies', reported: 'Widely reported in the financial press', yours: 'Added by you, saved on this device. Meridian has not checked it.' };
const TICKER = /^[A-Z0-9^][A-Z0-9^.=\-/]{0,15}$/;

register({
  code: 'SUPP', aliases: ['SPLC', 'SUPPLY', 'CHAIN', 'SUPPLIERS', 'CUSTOMERS'], name: 'Supply chain', cat: 'Equity', sec: true,
  help: '<ticker> SUPP — who the company buys from (suppliers) and sells to (customers). Tap a company to follow the chain.',
  run(ctx) {
    const E = ctx.engine;
    const s = ctx.sec;
    if (E.mode !== 'live') {
      ctx.el.innerHTML = '<div class="empty">The supply chain uses real companies. Switch with <kbd>MODE LIVE</kbd> (Meridian has to be running from its icon).</div>';
      return;
    }
    // SUPP ADD <supplier> <customer> [what it supplies] / SUPP DEL <supplier> <customer>: your own links
    const a0 = String(ctx.args[0] || '').toUpperCase();
    if ((a0 === 'ADD' || a0 === 'DEL') && ctx.args[1] && ctx.args[2]) {
      const from = String(ctx.args[1]).toUpperCase();
      const to = String(ctx.args[2]).toUpperCase();
      const mine = store('supp:custom', []);
      if (!TICKER.test(from) || !TICKER.test(to) || from === to) ctx.app.toast('Use two different tickers: SUPP ADD <supplier> <customer> <what it supplies>', 'err');
      else if (a0 === 'DEL') { save('supp:custom', mine.filter((l) => !(l[0] === from && l[1] === to))); ctx.app.toast(`Removed ${from} → ${to}`); } else if (mine.some((l) => l[0] === from && l[1] === to) || chainOf(to).suppliers.some((x) => x.sym === from)) ctx.app.toast(`${from} → ${to} is already on file`, 'err');
      else if (mine.length >= 500) ctx.app.toast('You have 500 links of your own, the most that fit. Remove some first.', 'err');
      else { save('supp:custom', [...mine, [from, to, ctx.args.slice(3).join(' ').slice(0, 120) || 'Added by you', 'yours']]); ctx.app.toast(`Added ${from} → ${to}. Tap either company to see it.`, 'ok'); }
    }
    const depth = Math.min(3, Math.max(2, Number(ctx.args.find((a) => /^[23]$/.test(String(a)))) || 2));
    const mineLinks = store('supp:custom', []);
    const addForm = `<div class="val-add supp-add"><b>Add a link of your own</b>: <input data-f="from" placeholder="Supplier ticker" size="11" maxlength="16" aria-label="Supplier ticker"> → <input data-f="to" placeholder="Customer ticker" size="11" maxlength="16" aria-label="Customer ticker"> <input data-f="what" placeholder="What it supplies (optional)" size="28" maxlength="120" aria-label="What it supplies"> <button class="tb" data-addlink>Add</button> <span class="dim small">${mineLinks.length ? `${mineLinks.length} of yours · ` : ''}saved on this device and marked “yours”; Meridian doesn't check them.</span></div>`;
    const onAdd = (e) => {
      const rm = e.target.closest('[data-rm]');
      if (rm) {
        const [f, t] = rm.dataset.rm.split('|');
        save('supp:custom', store('supp:custom', []).filter((l) => !(l[0] === f && l[1] === t)));
        ctx.app.run(`${s.sym} SUPP`, ctx.panel);
        return;
      }
      if (!e.target.closest('[data-addlink]')) return;
      const v = (k) => ctx.el.querySelector(`[data-f=${k}]`).value.trim();
      ctx.app.run(`${s.sym} SUPP ADD ${v('from').toUpperCase().replace(/\s+/g, '')} ${v('to').toUpperCase().replace(/\s+/g, '')} ${v('what')}`.trim(), ctx.panel);
    };
    ctx.el.addEventListener('click', onAdd);
    const { suppliers, customers } = chainOf(s.sym, store('supp:custom', []));
    if (!suppliers.length && !customers.length) {
      const list = covered().filter((x) => !OUTSIDE[x]);
      ctx.el.innerHTML = `<div class="empty">No supply links on file for ${esc(s.sym)} yet. Companies covered: ${list.map((x) => `<a href="#" class="sec" data-sup="${esc(x)}">${esc(x)}</a>`).join(' ')}</div>${addForm}`;
      ctx.el.addEventListener('click', go);
      return;
    }
    // companies from the 1,000+ list that haven't been opened yet: name and move from the light entry
    E.moreList?.();
    const light = (sym) => E.moreBySym?.get(sym);
    const name = (sym) => E.get(sym)?.name || light(sym)?.name || OUTSIDE[sym] || sym;
    const move = (sym) => {
      const i = E.get(sym) || light(sym);
      return i && Number.isFinite(i.pct) ? i.pct * 100 : null;
    };
    const needMore = [...suppliers, ...customers, { sym: s.sym }].some((x) => !E.get(x.sym) && light(x.sym));
    const movTxt = (v) => (v == null ? '' : `${v > 0 ? '+' : ''}${num(v, 2)}%`);

    const map = el('div', 'supp-map');
    const lists = el('div', 'split2 supp-lists');
    const note = el('p', 'note', `Suppliers on the left, customers on the right. A curated snapshot (${AS_OF}) of notable, publicly documented relationships, not a complete list: big companies have thousands of suppliers, and deals change. <b>disclosed</b> = stated by one of the companies; <b>reported</b> = widely reported in the press. Tap a company to follow its chain.`);
    ctx.el.append(map, lists, note);

    // ---- the map: an SVG scaled to the panel's width. Narrow panels (phones) get a compact
    // map at about real size, with tickers and moves only; the names are in the lists below.
    const compact = (ctx.el.clientWidth || window.innerWidth) < 560;
    const W = compact ? 360 : 640;
    const rowH = compact ? 28 : 30;
    const n = Math.max(suppliers.length, customers.length, 1);
    const H = Math.max(140, n * rowH + 30);
    const boxW = compact ? 118 : 196;
    const cW = compact ? 96 : 128;
    const xL = 4;
    const xR = W - boxW - 4;
    const cx = W / 2;
    const cy = H / 2 + 8;
    const ys = (k, count) => (H - count * rowH) / 2 + k * rowH + rowH / 2 + 8;
    const CH = 6.7; // average character width at 11px
    const node = (sym, x, y, side) => {
      const v = move(sym);
      const label = sym.length > 9 ? sym.slice(0, 9) : sym;
      const nm = name(sym);
      const symW = label.length * 7.6;
      const room = Math.floor((boxW - 12 - symW - 8 - 50) / CH);
      const shown = compact || room < 4 ? '' : nm.length > room ? `${nm.slice(0, room - 1)}…` : nm;
      return `<g class="supp-node" data-sup="${esc(sym)}" tabindex="0"><title>${esc(nm)}</title>
        <rect x="${x}" y="${y - 11}" width="${boxW}" height="22" rx="3"></rect>
        <text x="${x + 6}" y="${y + 4}" class="t-sym">${esc(label)}</text>
        ${shown ? `<text x="${x + 6 + symW + 6}" y="${y + 4}" class="t-name">${esc(shown)}</text>` : ''}
        <text x="${x + boxW - 6}" y="${y + 4}" text-anchor="end" class="t-mov ${dir(v)}">${movTxt(v)}</text></g>` + (side === 'L'
        ? `<path class="supp-edge" d="M${x + boxW},${y} C${cx - cW / 2 - 20},${y} ${cx - cW / 2 - 40},${cy} ${cx - cW / 2},${cy}"></path>`
        : `<path class="supp-edge out" d="M${cx + cW / 2},${cy} C${cx + cW / 2 + 40},${cy} ${cx + cW / 2 + 20},${y} ${x},${y}"></path>`);
    };
    const v0 = move(s.sym);
    map.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Supply chain of ${esc(s.sym)}">
      <text x="${xL}" y="12" class="t-head">SUPPLIERS · ${suppliers.length}</text>
      <text x="${xR + boxW}" y="12" text-anchor="end" class="t-head">CUSTOMERS · ${customers.length}</text>
      ${suppliers.map((x, k) => node(x.sym, xL, ys(k, suppliers.length), 'L')).join('')}
      ${customers.map((x, k) => node(x.sym, xR, ys(k, customers.length), 'R')).join('')}
      <g class="supp-center"><rect x="${cx - cW / 2}" y="${cy - 26}" width="${cW}" height="52" rx="4"></rect>
        <text x="${cx}" y="${cy - 2}" text-anchor="middle" class="t-csym">${esc(s.sym.length > 9 ? s.sym.slice(0, 9) : s.sym)}</text>
        <text x="${cx}" y="${cy + 16}" text-anchor="middle" class="t-mov ${dir(v0)}">${movTxt(v0)}</text></g>
    </svg>`;

    // ---- the lists
    const table = (title, rows, empty, side) => `<div class="pane"><h3>${title}</h3>${rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th class="l">Company</th><th class="l">What</th><th class="r">Today</th><th class="l">Basis</th></tr></thead><tbody>
      ${rows.map((x) => {
        const v = move(x.sym);
        return `<tr data-sup="${esc(x.sym)}" class="supp-row"><td class="l" title="${esc(name(x.sym))}"><a href="#" class="sec" data-sup="${esc(x.sym)}">${esc(x.sym)}</a>${!E.get(x.sym) ? ` <span class="dim">${esc(name(x.sym))}</span>` : ''}${x.basis === 'yours' ? ` <button class="tb" data-rm="${esc(side === 'S' ? `${x.sym}|${s.sym}` : `${s.sym}|${x.sym}`)}" title="Remove your own link (${esc(BASIS_HELP.yours)})" aria-label="Remove your link">× yours</button>` : ''}</td><td class="l supp-what">${esc(x.what)}</td><td class="r ${dir(v)}">${movTxt(v) || '<span class="dim">—</span>'}</td><td class="l dim" title="${esc(BASIS_HELP[x.basis])}">${BASIS[x.basis]}</td></tr>`;
      }).join('')}</tbody></table></div>` : `<p class="note">${empty}</p>`}</div>`;
    lists.innerHTML = table(`Suppliers — ${esc(s.sym)} buys from`, suppliers, `No suppliers of ${esc(s.sym)} on file.`, 'S') +
      table(`Customers — ${esc(s.sym)} sells to`, customers, `No customers of ${esc(s.sym)} on file.`, 'C');

    // the indirect chain: suppliers of suppliers, customers of customers
    const far = tiersOf(s.sym, depth, store('supp:custom', []));
    const tierTable = (title, rows, empty) => `<div class="pane"><h3>${title}</h3>${rows.length ? `<div class="tbl-wrap"><table class="tbl compact"><thead><tr><th class="l">Company</th><th class="l">Reaches ${esc(s.sym)} through</th><th class="l">What</th><th class="r">Today</th></tr></thead><tbody>${rows.map((x) => { const v = move(x.sym); return `<tr data-sup="${esc(x.sym)}" class="supp-row"><td class="l" title="${esc(name(x.sym))}"><a href="#" class="sec" data-sup="${esc(x.sym)}">${esc(x.sym)}</a> <span class="dim small">tier ${x.tier}</span></td><td class="l dim"><a href="#" class="sec" data-sup="${esc(x.via)}">${esc(x.via)}</a></td><td class="l supp-what">${esc(x.what)}</td><td class="r ${dir(v)}">${movTxt(v) || '<span class="dim">—</span>'}</td></tr>`; }).join('')}</tbody></table></div>` : `<p class="note">${empty}</p>`}</div>`;
    const tiers = el('div', 'split2 supp-lists');
    tiers.innerHTML = tierTable(`Indirect suppliers — supply the companies ${esc(s.sym)} buys from (to tier ${depth})`, far.suppliers, 'None on file beyond the direct suppliers.') + tierTable(`Indirect customers — sell to the companies ${esc(s.sym)} sells to (to tier ${depth})`, far.customers, 'None on file beyond the direct customers.');
    const addBox = el('div', '', addForm);
    note.before(tiers);
    ctx.el.append(addBox);

    function go(e) {
      if (e.target.closest('[data-rm]')) return;
      const t = e.target.closest('[data-sup]');
      if (!t) return;
      e.preventDefault();
      ctx.app.run(`${t.dataset.sup} SUPP`, ctx.panel);
    }
    map.addEventListener('click', go);
    map.addEventListener('keydown', (e) => e.key === 'Enter' && go(e));
    lists.addEventListener('click', go);

    // keep the day's moves current
    const update = () => {
      for (const t of map.querySelectorAll('.supp-node')) {
        const v = move(t.dataset.sup);
        const m = t.querySelector('.t-mov');
        m.textContent = movTxt(v);
        m.setAttribute('class', `t-mov ${dir(v)}`);
      }
      const c = map.querySelector('.supp-center .t-mov');
      c.textContent = movTxt(move(s.sym));
      c.setAttribute('class', `t-mov ${dir(move(s.sym))}`);
    };
    if (needMore) E.moreQuotes().then(update, () => {});
    return { update, every: 2 };
  },
});
