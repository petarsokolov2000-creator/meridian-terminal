// FIND: type your rules in plain English, get the stocks that fit.
//
//   FIND profitable, debt under 2x EBITDA, below fair price, above 200-day average
//
// Meridian first shows what it understood (the exact tests it will run) and says so for any part it
// could not read, which is then NOT applied. Price rules are checked at once on every stock. Rules about
// the company's finances (margins, debt, growth, returns, fair price) need each company's filings, so
// those are loaded for the biggest stocks that pass your price rules, two at a time; the list fills in
// as they arrive. Stocks that pass every rule come first, then the ones that miss exactly one.
// Nothing is invented: a figure that isn't reported shows "n/a" with the reason and never counts as a pass.

import { register } from '../registry.js';
import { num, secLink, esc, el, store, save } from '../fmt.js';
import { FIELDS } from './bql.js';
import { isStock, intrinsic, cachedResult } from '../intrinsic.js';
import { METRICS, parseRules, metricsOf, check, show, EXAMPLES, VOCAB } from '../rules.js';

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const STEP = 60; // how many companies' filings one run loads
const TTL = 30 * 60000;
const NOT_FOR_BANKS = new Set(['debtEbitda', 'evEbitda', 'pfcf', 'fcfYield', 'fcfMargin', 'fcfNow', 'netCash', 'grossMargin']);

// ---- loading company filings, two at a time -----------------------------------------------------
const filings = new Map(); // sym -> { at, m, err }
const queue = [];
let active = 0;
function pump(E, onDone) {
  while (active < 2 && queue.length) {
    const sym = queue.shift();
    active++;
    (async () => {
      try {
        const v = await E.valuation(sym);
        filings.set(sym, { at: Date.now(), m: metricsOf(v) });
      } catch (err) {
        filings.set(sym, { at: Date.now(), err: err.message || 'could not load' });
      }
    })().finally(() => { active--; onDone(); pump(E, onDone); });
  }
}
function ensure(E, sym, onDone) {
  const hit = filings.get(sym);
  if ((hit && Date.now() - hit.at < TTL) || queue.includes(sym)) return;
  filings.set(sym, undefined);
  queue.push(sym);
  pump(E, onDone);
}

// ---- one rule on one stock -----------------------------------------------------------------------
/** { s: 'pass'|'fail'|'na'|'wait', v: number|null, why?: string } */
function judge(E, r, i) {
  const mt = METRICS[r.metric];
  if (mt.kind === 'q') {
    const v = FIELDS[mt.field][2](i);
    return fin(v) ? { s: check(r, v) ? 'pass' : 'fail', v } : { s: 'na', v: null, why: 'no figure for this stock' };
  }
  if (E.mode !== 'live') return { s: 'na', v: null, why: 'needs real company data (MODE LIVE)' };
  const f = filings.get(i.sym);
  if (!f) return { s: 'wait', v: null };
  if (f.err) return { s: 'na', v: null, why: `filings not loaded: ${f.err}` };
  if (mt.kind === 'f') {
    const v = f.m[r.metric];
    if (fin(v)) return { s: check(r, v) ? 'pass' : 'fail', v };
    return { s: 'na', v: null, why: f.m.financial && NOT_FOR_BANKS.has(r.metric) ? 'not applicable to banks and insurers' : 'not reported, or not meaningful (negative or zero base)' };
  }
  // fair price
  const res = cachedResult(i.sym);
  if (!res) return { s: 'wait', v: null };
  if (res.kind === 'none' || !(res.value > 0)) return { s: 'na', v: null, why: res.why || 'no fair price could be worked out' };
  const upside = fin(i.last) && i.last > 0 ? (res.value / i.last - 1) * 100 : null;
  const v = r.metric === 'upside' ? upside : fin(i.last) ? ((res.value - i.last) / res.value) * 100 : null;
  return fin(v) ? { s: check(r, v) ? 'pass' : 'fail', v } : { s: 'na', v: null, why: 'no price' };
}

const capOf = (i) => { const c = i.marketCap ?? i.shares * i.last; return fin(c) ? c : 0; };

register({
  code: 'FIND', aliases: ['RULES', 'FINDER', 'MATCH'], name: 'Find stocks by my rules (plain English)', cat: 'Equity',
  help: 'FIND <rules in plain English> — e.g. FIND profitable, debt under 2x EBITDA, below fair price, above 200-day average',
  run(ctx) {
    const E = ctx.engine;
    const typed = ctx.args.join(' ').trim();
    let text = typed || store('find:last', EXAMPLES[0][1]);
    let limit = STEP;
    let sortKey = null; // { k: rule index, desc }
    const box = el('div', 'bql find');
    ctx.el.appendChild(box);
    box.innerHTML = `<div class="bql-in"><textarea rows="3" spellcheck="false" aria-label="Your rules in plain English" placeholder="e.g. profitable, debt under 2x EBITDA, below fair price, above 200-day average"></textarea><button class="tb on" data-run>Find</button></div>
      <div class="chips bql-ex">${EXAMPLES.map(([l], k) => `<button class="chip" data-ex="${k}">${esc(l)}</button>`).join('')}</div>
      <div class="chips find-saved"></div>
      <div class="bql-out"></div>
      <details class="bql-help"><summary>What can I say?</summary><p class="note">Separate rules with commas or “and”. Numbers go after <b>under / below / over / above / at least / at most / between … and …</b>. Anything Meridian doesn't understand is listed and <b>not applied</b>.</p>
      <table class="tbl compact"><tbody>${VOCAB.map(([h, t]) => `<tr><td class="l"><b>${esc(h)}</b></td><td class="l dim">${esc(t)}</td></tr>`).join('')}</tbody></table>
      <p class="note">Words with no number (“cheap”, “good company”) are not understood on purpose: they mean different things to different people. Say what you mean (“P/E under 15”). Fair price is a model estimate from company filings, see <kbd>SYM DCF</kbd>. Price rules use the daily prices Meridian already holds; finance rules (margins, debt, growth, ROE, valuation multiples, fair price) load each company's filings.</p></details>`;
    const ta = box.querySelector('textarea');
    const out = box.querySelector('.bql-out');
    const savedBox = box.querySelector('.find-saved');
    ta.value = text;
    let timer = null;
    const redraw = () => { clearTimeout(timer); timer = setTimeout(draw, 500); };

    const drawSaved = () => {
      const list = store('find:saved', []);
      savedBox.innerHTML = `${list.map((t, k) => `<span class="chip"><a href="#" data-load="${k}" title="${esc(t)}">${esc(t.length > 42 ? `${t.slice(0, 40)}…` : t)}</a> <a href="#" data-del="${k}" title="Remove" aria-label="Remove saved rules">×</a></span>`).join('')}<button class="chip" data-save>＋ Save these rules</button>`;
    };

    function draw() {
      const stocksAll = E.equities.filter((i) => !i.etf && i.history?.length >= 20);
      const sectors = [...new Set(E.equities.filter((i) => !i.etf).map((i) => i.sector).filter(Boolean))];
      const P = parseRules(text, { sectors });
      const bad = P.unknown.length ? `<p class="note st-bad">Not understood, so <b>not applied</b>: ${P.unknown.map((u) => `“${esc(u)}”`).join(', ')}. Say it with a number, e.g. “P/E under 15” or “net margin over 10%”. See “What can I say?”.</p>` : '';
      if (!P.rules.length) {
        out.innerHTML = `${bad}<div class="empty">${text.trim() ? 'No rule could be read.' : 'Type your rules above.'} Try one of the examples.</div>`;
        return;
      }
      const where = [P.region ? `region ${P.region}` : '', ...P.sectors.map((s) => `sector ${s}`)].filter(Boolean);
      const stocks = stocksAll.filter((i) => (!P.region || i.region === P.region) && (!P.sectors.length || P.sectors.includes(i.sector)));
      const understood = `<p class="note">I understood: ${P.rules.map((r) => `<span class="chip">${esc(r.label)}</span>`).join(' ')}${where.length ? ` · only ${esc(where.join(', '))}` : ''} · searching ${stocks.length} stocks.</p>`;
      const needF = P.rules.some((r) => METRICS[r.metric].kind !== 'q');
      const needFair = P.rules.some((r) => METRICS[r.metric].kind === 'fair');
      // 1) price rules on every stock; 2) filings for the biggest stocks that miss at most one price rule
      const rows = stocks.map((i) => ({ i, j: P.rules.map((r) => judge(E, r, i)) }));
      let cand = rows;
      let skippedByPrice = 0;
      if (needF && E.mode === 'live') {
        const qIdx = P.rules.map((r, k) => (METRICS[r.metric].kind === 'q' ? k : -1)).filter((k) => k >= 0);
        const qFails = (row) => qIdx.filter((k) => row.j[k].s !== 'pass').length;
        const pool = rows.filter((r) => qFails(r) <= (qIdx.length ? 1 : 0));
        skippedByPrice = rows.length - pool.length;
        pool.sort((a, b) => qFails(a) - qFails(b) || capOf(b.i) - capOf(a.i));
        cand = pool.slice(0, limit);
        cand.forEach((row) => ensure(E, row.i.sym, redraw));
        if (needFair) for (const row of cand) { if (filings.get(row.i.sym) && !filings.get(row.i.sym).err && !cachedResult(row.i.sym)) intrinsic(E, row.i.sym).then(redraw, redraw); }
        cand.forEach((row) => { row.j = P.rules.map((r) => judge(E, r, row.i)); });
        cand._pool = pool;
      }
      const shown = needF && E.mode === 'live' ? cand : rows;
      const waiting = shown.filter((row) => row.j.some((x) => x.s === 'wait')).length;
      const done = shown.length - waiting;
      const hitAll = shown.filter((row) => row.j.every((x) => x.s === 'pass'));
      const hitOne = shown.filter((row) => !row.j.some((x) => x.s === 'wait') && row.j.filter((x) => x.s !== 'pass').length === 1);
      const rank = (a, b) => {
        if (sortKey) {
          const x = a.j[sortKey.k].v; const y = b.j[sortKey.k].v;
          return (x == null) - (y == null) || (sortKey.desc ? -1 : 1) * ((x ?? 0) - (y ?? 0));
        }
        return capOf(b.i) - capOf(a.i);
      };
      hitAll.sort(rank);
      hitOne.sort(rank);
      const cell = (r, x) => {
        if (x.s === 'wait') return '<td class="r dim" title="loading this company\'s filings">…</td>';
        if (x.s === 'na') return `<td class="r dim" title="${esc(x.why || '')}">n/a</td>`;
        const t = show(r.metric, x.v) ?? '—';
        return `<td class="r ${x.s === 'pass' ? 'up' : 'down'}" title="${x.s === 'pass' ? 'passes' : 'fails'}: ${esc(r.label)}">${esc(t)} ${x.s === 'pass' ? '✓' : '✗'}</td>`;
      };
      const head = `<th class="l">Ticker</th><th class="l dim qname">Name</th><th class="r">Cap B</th>${P.rules.map((r, k) => `<th class="r" data-col="${k}" title="${esc(r.label)} (tap to sort)" style="cursor:pointer">${esc(shortLabel(r))}${sortKey?.k === k ? (sortKey.desc ? ' ▼' : ' ▲') : ''}</th>`).join('')}`;
      const body = (list) => list.map((row) => `<tr><td class="l">${secLink(row.i)}</td><td class="l dim qname">${esc(row.i.name)}</td><td class="r">${fin(capOf(row.i)) && capOf(row.i) ? num(capOf(row.i) / 1e9, 1) : '<span class="dim">—</span>'}</td>${P.rules.map((r, k) => cell(r, row.j[k])).join('')}</tr>`).join('');
      const progress = needF && E.mode === 'live'
        ? `<p class="note">${waiting ? `Loading company filings: ${done} of ${shown.length} done… ` : `Checked the filings of ${shown.length} companies. `}${skippedByPrice ? `${skippedByPrice} stocks already missed two or more of your price rules and were skipped. ` : ''}${cand._pool && cand._pool.length > limit ? `Only the ${limit} biggest of ${cand._pool.length} possible stocks were checked. <button class="chip" data-more>Check ${Math.min(STEP, cand._pool.length - limit)} more</button>` : ''}</p>`
        : needF ? '<p class="note st-bad">Rules about company finances need real data (<kbd>MODE LIVE</kbd>); they are shown as n/a and nothing can pass them.</p>' : '';
      const fairNote = needFair ? '<p class="note dim">Fair price is a model estimate (median of several valuation models), not a forecast: check it with <kbd>SYM DCF</kbd> before you act.</p>' : '';
      const t1 = hitAll.length ? `<div class="tbl-wrap"><table class="tbl compact"><thead><tr>${head}</tr></thead><tbody>${body(hitAll)}</tbody></table></div>`
        : `<div class="empty">${waiting ? 'No match so far…' : 'No stock passes all of your rules.'}${hitOne.length ? ' The closest ones are below.' : ' Loosen one rule and try again.'}</div>`;
      const t2 = hitOne.length ? `<details ${hitAll.length ? '' : 'open'}><summary>${hitOne.length} pass all but one rule (that one fails, or can't be checked: see ✗ / n/a)</summary><div class="tbl-wrap"><table class="tbl compact"><thead><tr>${head}</tr></thead><tbody>${body(hitOne)}</tbody></table></div></details>` : '';
      out.innerHTML = `${bad}${understood}${progress}<p class="note"><b>${hitAll.length}</b> pass all ${P.rules.length} rule${P.rules.length === 1 ? '' : 's'}${waiting ? ' so far' : ''}. ✓ = passes, ✗ = fails, n/a = not reported (never counts as a pass). Tap a column to sort; tap a ticker to open it.</p>${fairNote}${t1}${t2}`;
      out.querySelector('thead')?.addEventListener('click', onSort(P.rules.length));
    }
    const onSort = () => (e) => {
      const th = e.target.closest('[data-col]');
      if (!th) return;
      const k = Number(th.dataset.col);
      sortKey = sortKey?.k === k ? { k, desc: !sortKey.desc } : { k, desc: true };
      draw();
    };
    const run = () => { text = ta.value.trim(); save('find:last', text); sortKey = null; limit = STEP; draw(); };
    box.addEventListener('click', (e) => {
      if (e.target.closest('[data-run]')) run();
      const ex = e.target.closest('[data-ex]');
      if (ex) { ta.value = EXAMPLES[Number(ex.dataset.ex)][1]; run(); }
      if (e.target.closest('[data-more]')) { limit += STEP; draw(); }
      const ld = e.target.closest('[data-load]');
      if (ld) { e.preventDefault(); ta.value = store('find:saved', [])[Number(ld.dataset.load)] || ''; run(); }
      const del = e.target.closest('[data-del]');
      if (del) { e.preventDefault(); const l = store('find:saved', []); l.splice(Number(del.dataset.del), 1); save('find:saved', l); drawSaved(); }
      if (e.target.closest('[data-save]')) {
        const t = ta.value.trim();
        const l = store('find:saved', []);
        if (t && !l.includes(t)) { l.unshift(t); save('find:saved', l.slice(0, 12)); }
        drawSaved();
      }
    });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run(); } });
    drawSaved();
    draw();
    return { update: () => {}, destroy: () => clearTimeout(timer) };
  },
});

function shortLabel(r) {
  const l = r.label;
  return l.length > 26 ? `${l.slice(0, 24)}…` : l;
}
