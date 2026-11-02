// SUPP: a company's suppliers (left) and customers (right) as a map plus two lists, with each
// company's move today. Tap any company to see its own supply chain. Data: supply-chain.js.

import { register } from '../registry.js';
import { num, dir, esc, el } from '../fmt.js';
import { chainOf, covered, OUTSIDE, AS_OF } from '../supply-chain.js';

const BASIS = { disclosed: 'disclosed', reported: 'reported' };
const BASIS_HELP = { disclosed: 'Stated publicly by one of the two companies', reported: 'Widely reported in the financial press' };

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
    const { suppliers, customers } = chainOf(s.sym);
    if (!suppliers.length && !customers.length) {
      const list = covered().filter((x) => !OUTSIDE[x]);
      ctx.el.innerHTML = `<div class="empty">No supply links on file for ${esc(s.sym)} yet. Companies covered: ${list.map((x) => `<a href="#" class="sec" data-sup="${esc(x)}">${esc(x)}</a>`).join(' ')}</div>`;
      ctx.el.addEventListener('click', go);
      return;
    }
    const name = (sym) => E.get(sym)?.name || OUTSIDE[sym] || sym;
    const move = (sym) => {
      const i = E.get(sym);
      return i && Number.isFinite(i.pct) ? i.pct * 100 : null;
    };
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
    const table = (title, rows, empty) => `<div class="pane"><h3>${title}</h3>${rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th class="l">Company</th><th class="l">What</th><th class="r">Today</th><th class="l">Basis</th></tr></thead><tbody>
      ${rows.map((x) => {
        const v = move(x.sym);
        return `<tr data-sup="${esc(x.sym)}" class="supp-row"><td class="l" title="${esc(name(x.sym))}"><a href="#" class="sec" data-sup="${esc(x.sym)}">${esc(x.sym)}</a>${OUTSIDE[x.sym] ? ` <span class="dim">${esc(OUTSIDE[x.sym])}</span>` : ''}</td><td class="l supp-what">${esc(x.what)}</td><td class="r ${dir(v)}">${movTxt(v) || '<span class="dim">—</span>'}</td><td class="l dim" title="${esc(BASIS_HELP[x.basis])}">${BASIS[x.basis]}</td></tr>`;
      }).join('')}</tbody></table></div>` : `<p class="note">${empty}</p>`}</div>`;
    lists.innerHTML = table(`Suppliers — ${esc(s.sym)} buys from`, suppliers, `No suppliers of ${esc(s.sym)} on file.`) +
      table(`Customers — ${esc(s.sym)} sells to`, customers, `No customers of ${esc(s.sym)} on file.`);

    function go(e) {
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
    return { update, every: 2 };
  },
});
