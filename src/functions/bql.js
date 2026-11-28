// BQL: ask your own questions of the stocks Meridian has loaded, in a small query language.
//
//   BQL <which stocks> : <column>, <column> AS name, ... WHERE <condition> SORT <column> DESC TOP 20
//
// Which stocks: ALL, ETF, WATCH, PORT, a region (US EU ASIA), a sector (TECHNOLOGY...), or tickers.
// Columns and conditions are formulas over the fields below: + - * / ^ ( ), abs() sqrt() log() round()
// min(a,b) max(a,b), comparisons < <= > >= == != and, or, not. A missing number (a negative P/E, say)
// never matches a condition. The query is read by Meridian's own parser; nothing is evaluated as code.
// It works on the daily prices and quote figures already loaded, not on company filings.

import { register } from '../registry.js';
import { num, secLink, esc, el, store, save } from '../fmt.js';
import { smaOf, retOf, hiLoOf, rsiOf } from '../metrics.js';
import { loadBook } from './tools.js';
import { peek, isStock, fairOf } from '../intrinsic.js';

const fin = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const pc = (v) => (v == null ? null : v * 100);

// name -> [label, help, (instrument) => number|null]
export const FIELDS = {
  px: ['Price', 'Last price', (i) => fin(i.last)],
  chg: ['Today %', 'Change today, %', (i) => pc(fin(i.pct))],
  ret1w: ['1W %', 'Return over the last 5 trading days, %', (i) => pc(retOf(i, 5))],
  ret1m: ['1M %', 'Return over the last 21 trading days, %', (i) => pc(retOf(i, 21))],
  ret3m: ['3M %', 'Return over the last 63 trading days, %', (i) => pc(retOf(i, 63))],
  ret6m: ['6M %', 'Return over the last 126 trading days, %', (i) => pc(retOf(i, 126))],
  ret1y: ['1Y %', 'Return over the loaded year (about 250 trading days), %', (i) => pc(retOf(i, Math.min(250, (i.history?.length || 1) - 1)))],
  rsi: ['RSI', '14-day RSI: under 30 oversold, over 70 overbought', (i) => rsiOf(i)],
  sma50: ['50-day avg', '50-day average price', (i) => smaOf(i, 50)],
  sma200: ['200-day avg', '200-day average price', (i) => smaOf(i, 200)],
  vs50: ['vs 50-day %', 'Price above (+) or below (−) its 50-day average, %', (i) => { const s = smaOf(i, 50); return s ? (i.last / s - 1) * 100 : null; }],
  vs200: ['vs 200-day %', 'Price above (+) or below (−) its 200-day average, %', (i) => { const s = smaOf(i, 200); return s ? (i.last / s - 1) * 100 : null; }],
  hi52: ['52W high', 'Highest price of the loaded year', (i) => hiLoOf(i)?.hi ?? null],
  lo52: ['52W low', 'Lowest price of the loaded year', (i) => hiLoOf(i)?.lo ?? null],
  offhigh: ['Off high %', 'Distance below the 52-week high, % (0 = at the high)', (i) => pc(hiLoOf(i)?.offHigh ?? null)],
  offlow: ['Above low %', 'Distance above the 52-week low, %', (i) => pc(hiLoOf(i)?.aboveLow ?? null)],
  vol: ['Vol %', 'Volatility: how much the price swings in a year, %', (i) => pc(fin(i.realVol))],
  beta: ['Beta', 'Moves with the S&P 500: 1 = same, below 1 = calmer', (i) => fin(i.histBeta)],
  pe: ['P/E', 'Price / earnings (empty when earnings are negative)', (i) => (i.eps > 0 ? i.last / i.eps : null)],
  eps: ['EPS', 'Earnings per share, last 12 months', (i) => fin(i.eps)],
  cap: ['Mkt cap B', 'Market value in billions', (i) => { const c = i.marketCap ?? i.shares * i.last; return fin(c) ? c / 1e9 : null; }],
  yld: ['Div yld %', 'Dividend yield, %', (i) => fin(i.divYield)],
  volume: ['Volume', 'Shares traded today', (i) => fin(i.volume)],
  fair: ['Fair price', 'Median of several models of what a share is worth (DCF, Graham, own-history P/E, EV/EBITDA, FCF yield). Loaded on demand for the 40 biggest stocks of the query; an estimate, not a fact', (i) => fairOf(i.sym, i.last).fair],
  upside: ['Upside %', 'Fair price vs price, %: + = price below the model estimate. Only for stocks whose fair price has loaded', (i) => fairOf(i.sym, i.last).upside],
  volx: ['Vol × avg', 'Today\'s volume compared with the usual daily volume', (i) => (i.adv > 0 && i.volume > 0 ? i.volume / i.adv : null)],
};
const FUNCS = {
  abs: [1, (a) => Math.abs(a)], sqrt: [1, (a) => (a >= 0 ? Math.sqrt(a) : null)], log: [1, (a) => (a > 0 ? Math.log(a) : null)], round: [1, (a) => Math.round(a)],
  min: [2, Math.min], max: [2, Math.max],
};

class QueryError extends Error {}

// ---- tokens and parser ----------------------------------------------------------------------
function tokenize(src) {
  const out = [];
  const re = /\s*(?:(\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(<=|>=|==|!=|<>|[=<>+\-*/^(),]))/gy;
  let m;
  let pos = 0;
  while (pos < src.length && (m = re.exec(src))) {
    pos = re.lastIndex;
    if (m[1] != null) out.push({ t: 'num', v: Number(m[1]) });
    else if (m[2] != null) out.push({ t: 'id', v: m[2].toLowerCase() });
    else out.push({ t: 'op', v: m[3] === '=' ? '==' : m[3] === '<>' ? '!=' : m[3] });
  }
  if (src.slice(pos).trim()) throw new QueryError(`Can't read "${src.slice(pos).trim().slice(0, 20)}" in "${src.trim().slice(0, 60)}"`);
  return out;
}

function parse(src, names) {
  const toks = tokenize(src);
  let k = 0;
  const peek = () => toks[k];
  const eatOp = (v) => (peek()?.t === 'op' && peek().v === v ? (k++, true) : false);
  const eatId = (v) => (peek()?.t === 'id' && peek().v === v ? (k++, true) : false);
  const fail = (msg) => { throw new QueryError(`${msg} in "${src.trim().slice(0, 60)}"`); };
  function or() { let l = and(); while (eatId('or')) l = { t: 'bin', o: 'or', l, r: and() }; return l; }
  function and() { let l = not(); while (eatId('and')) l = { t: 'bin', o: 'and', l, r: not() }; return l; }
  function not() { return eatId('not') ? { t: 'not', a: not() } : cmp(); }
  function cmp() {
    const l = add();
    const p = peek();
    if (p?.t === 'op' && ['<', '<=', '>', '>=', '==', '!='].includes(p.v)) { k++; return { t: 'bin', o: p.v, l, r: add() }; }
    return l;
  }
  function add() { let l = mul(); for (;;) { if (eatOp('+')) l = { t: 'bin', o: '+', l, r: mul() }; else if (eatOp('-')) l = { t: 'bin', o: '-', l, r: mul() }; else return l; } }
  function mul() { let l = pow(); for (;;) { if (eatOp('*')) l = { t: 'bin', o: '*', l, r: pow() }; else if (eatOp('/')) l = { t: 'bin', o: '/', l, r: pow() }; else return l; } }
  function pow() { const l = unary(); return eatOp('^') ? { t: 'bin', o: '^', l, r: pow() } : l; }
  function unary() { return eatOp('-') ? { t: 'neg', a: unary() } : primary(); }
  function primary() {
    const p = peek();
    if (!p) fail('The formula ends too early');
    k++;
    if (p.t === 'num') return { t: 'num', v: p.v };
    if (p.t === 'op' && p.v === '(') { const e = or(); if (!eatOp(')')) fail('Missing )'); return e; }
    if (p.t === 'id') {
      if (peek()?.t === 'op' && peek().v === '(') {
        const f = FUNCS[p.v];
        if (!f) fail(`Unknown function ${p.v}()`);
        k++;
        const args = [];
        if (!eatOp(')')) { do args.push(or()); while (eatOp(',')); if (!eatOp(')')) fail('Missing )'); }
        if (args.length !== f[0]) fail(`${p.v}() takes ${f[0]} value${f[0] === 1 ? '' : 's'}`);
        return { t: 'fn', f: p.v, args };
      }
      if (!(p.v in FIELDS) && !names.has(p.v)) fail(`Unknown field "${p.v}". Fields: ${Object.keys(FIELDS).join(', ')}`);
      return { t: 'id', v: p.v };
    }
    return fail(`Unexpected "${p.v}"`);
  }
  const ast = or();
  if (k < toks.length) fail(`Unexpected "${toks[k].v}"`);
  return ast;
}

/** Value of a formula for one stock: a number, a boolean for comparisons, or null (missing). */
function evaluate(n, env) {
  switch (n.t) {
    case 'num': return n.v;
    case 'id': return env(n.v);
    case 'neg': { const a = evaluate(n.a, env); return a == null ? null : -a; }
    case 'not': { const a = evaluate(n.a, env); return a == null ? null : !a; }
    case 'fn': {
      const a = n.args.map((x) => evaluate(x, env));
      return a.some((v) => v == null || typeof v === 'boolean') ? null : fin(FUNCS[n.f][1](...a));
    }
    case 'bin': {
      const l = evaluate(n.l, env);
      const r = evaluate(n.r, env);
      if (n.o === 'and') return l === true && r === true ? true : l === null || r === null ? (l === false || r === false ? false : null) : false;
      if (n.o === 'or') return l === true || r === true ? true : l === null || r === null ? null : false;
      if (l == null || r == null || typeof l === 'boolean' || typeof r === 'boolean') return null;
      switch (n.o) {
        case '+': return l + r;
        case '-': return l - r;
        case '*': return l * r;
        case '/': return r === 0 ? null : l / r;
        case '^': return fin(l ** r);
        case '<': return l < r;
        case '<=': return l <= r;
        case '>': return l > r;
        case '>=': return l >= r;
        case '==': return l === r;
        case '!=': return l !== r;
        default: return null;
      }
    }
    default: return null;
  }
}

// ---- query ----------------------------------------------------------------------------------
const splitTop = (s) => {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((x) => x.trim()).filter(Boolean);
};

const DEFAULT_COLS = 'px, chg, ret1m, ret1y, offhigh, rsi, pe, cap';

export function parseQuery(text) {
  let universe = '';
  let rest = text.trim();
  const colon = rest.indexOf(':');
  if (colon >= 0) { universe = rest.slice(0, colon).trim(); rest = rest.slice(colon + 1).trim(); } else {
    const m = rest.search(/\b(where|sort|top)\b/i);
    universe = (m >= 0 ? rest.slice(0, m) : rest).trim();
    rest = m >= 0 ? rest.slice(m) : '';
  }
  const parts = { cols: '', where: '', sort: '', top: '' };
  const segs = rest.split(/\b(where|sort|top)\b/i);
  parts.cols = segs[0].trim();
  for (let k = 1; k < segs.length; k += 2) {
    const kw = segs[k].toLowerCase();
    parts[kw] = (segs[k + 1] || '').trim();
    if (!parts[kw]) throw new QueryError(`${kw.toUpperCase()} needs something after it${kw === 'where' ? ', e.g. WHERE pe < 20' : kw === 'sort' ? ', e.g. SORT ret1y DESC' : ', e.g. TOP 20'}`);
  }
  if (!parts.cols) parts.cols = DEFAULT_COLS;
  const names = new Set();
  const cols = splitTop(parts.cols).map((c) => {
    const m = /^(.*)\s+as\s+([A-Za-z_][A-Za-z0-9_]*)$/i.exec(c);
    const src = m ? m[1].trim() : c;
    const name = m ? m[2].toLowerCase() : null;
    if (name && name in FIELDS) throw new QueryError(`"${name}" is a field name: pick another name after AS`);
    const ast = parse(src, new Set(names));
    if (name) names.add(name);
    return { src, name, ast, label: name || (src in FIELDS ? FIELDS[src][0] : src) };
  });
  if (!cols.length) throw new QueryError('Name at least one column');
  const where = parts.where ? parse(parts.where, names) : null;
  let sort = null;
  if (parts.sort) {
    const m = /^(.*?)(?:\s+(asc|desc))?$/i.exec(parts.sort);
    sort = { ast: parse(m[1].trim(), names), desc: (m[2] || 'desc').toLowerCase() === 'desc', src: m[1].trim() };
  }
  const top = parts.top ? Number(parts.top) : null;
  if (parts.top && !(top >= 1)) throw new QueryError('TOP needs a number, e.g. TOP 20');
  return { universe, cols, where, sort, top: top ? Math.min(500, Math.floor(top)) : 200 };
}

function pickUniverse(E, text) {
  const toks = text.split(/[\s,]+/).filter(Boolean);
  const all = E.equities.filter((i) => !i.etf && i.history?.length >= 20);
  let list = null;
  const sectors = [...new Set(E.equities.map((i) => i.sector))];
  const filters = [];
  const named = [];
  for (const raw of toks) {
    const t = raw.toUpperCase();
    if (t === 'ALL' || t === 'STOCKS') continue;
    if (t === 'ETF' || t === 'ETFS') { list = E.equities.filter((i) => i.etf); continue; }
    if (t === 'WATCH') { named.push(...store(`watch:${E.mode}`, E.defaults.watch)); continue; }
    if (t === 'PORT') { named.push(...Object.keys(loadBook(E).positions)); continue; }
    if (['US', 'EU', 'ASIA'].includes(t)) { filters.push((i) => i.region === t); continue; }
    const sec = sectors.find((s) => s && s.toUpperCase().replace(/[^A-Z]/g, '').startsWith(t.replace(/[^A-Z]/g, '')) && t.length >= 4);
    if (sec) { filters.push((i) => i.sector === sec); continue; }
    if (E.get(raw)) { named.push(E.get(raw).sym); continue; }
    throw new QueryError(`"${raw}" is not a ticker, a sector, a region or WATCH / PORT / ALL / ETF`);
  }
  const base = named.length ? named.map((s) => E.get(s)).filter(Boolean) : list || all;
  return base.filter((i) => filters.every((f) => f(i)));
}

export function runQuery(E, q) {
  const insts = pickUniverse(E, q.universe);
  const rows = [];
  for (const i of insts) {
    const memo = {};
    const cols = {};
    const env = (name) => {
      if (name in cols) return cols[name];
      if (!(name in memo)) memo[name] = FIELDS[name][2](i);
      return memo[name];
    };
    const vals = q.cols.map((c) => {
      const v = evaluate(c.ast, env);
      if (c.name) cols[c.name] = typeof v === 'number' ? v : null;
      return typeof v === 'number' ? v : null;
    });
    if (q.where && evaluate(q.where, env) !== true) continue;
    rows.push({ i, vals, sort: q.sort ? evaluate(q.sort.ast, env) : i.marketCap ?? i.shares * i.last });
  }
  const dir = q.sort ? (q.sort.desc ? -1 : 1) : -1;
  rows.sort((a, b) => (a.sort == null) - (b.sort == null) || (a.sort == null ? 0 : dir * (a.sort - b.sort)));
  return { rows: rows.slice(0, q.top), total: rows.length, universe: insts.length };
}

const EXAMPLES = [
  ['Cheap and rising', 'ALL: px, pe, ret1y, vol WHERE pe > 0 and pe < 20 and ret1y > 10 SORT ret1y DESC TOP 20'],
  ['Oversold tech', 'TECHNOLOGY: px, rsi, vs200, ret3m WHERE rsi < 40 SORT rsi ASC'],
  ['Near 52-week highs', 'US: px, offhigh, ret3m WHERE offhigh > -3 SORT offhigh DESC TOP 25'],
  ['Return per unit of risk', 'ALL: px, ret6m, vol, ret6m / vol AS ratio WHERE vol > 0 SORT ratio DESC TOP 15'],
  ['Below fair price', 'WATCH: px, fair, upside WHERE upside > 15 SORT upside DESC'],
  ['My watchlist', 'WATCH: px, chg, ret1m, offhigh, rsi'],
  ['My portfolio', 'PORT: px, chg, ret1m, vs50, vs200'],
];

register({
  code: 'BQL', aliases: ['QUERY', 'FORMULA', 'QL'], name: 'Query language (your own formulas)', cat: 'Equity',
  help: 'BQL <stocks>: <columns> WHERE <condition> SORT <col> DESC TOP n — e.g. BQL ALL: px, pe, ret1y WHERE pe<20 SORT ret1y DESC',
  run(ctx) {
    const E = ctx.engine;
    const typed = ctx.args.join(' ').trim();
    let text = typed || store('bql:last', EXAMPLES[0][1]);
    const box = el('div', 'bql');
    ctx.el.appendChild(box);
    box.innerHTML = `<div class="bql-in"><textarea rows="2" spellcheck="false" aria-label="Query"></textarea><button class="tb on" data-run>Run</button></div>
      <div class="chips bql-ex">${EXAMPLES.map(([l], k) => `<button class="chip" data-ex="${k}">${esc(l)}</button>`).join('')}</div>
      <div class="bql-out"></div>
      <details class="bql-help"><summary>Fields and syntax</summary><p class="note">Write <b>which stocks : columns WHERE condition SORT column DESC TOP n</b>. Stocks: <kbd>ALL</kbd> <kbd>ETF</kbd> <kbd>WATCH</kbd> <kbd>PORT</kbd>, a region (<kbd>US</kbd> <kbd>EU</kbd> <kbd>ASIA</kbd>), a sector (<kbd>TECHNOLOGY</kbd>, <kbd>FINANCIALS</kbd>…) or tickers. Columns are formulas: <kbd>ret6m / vol AS ratio</kbd>. Maths: <kbd>+ - * / ^ ( )</kbd>, <kbd>abs() sqrt() log() round() min(a,b) max(a,b)</kbd>; conditions: <kbd>&lt; &lt;= &gt; &gt;= == !=</kbd>, <kbd>and or not</kbd>. A number that doesn't exist (like a P/E when earnings are negative) never matches a condition.</p>
      <table class="tbl compact"><thead><tr><th class="l">Field</th><th class="l">Meaning</th></tr></thead><tbody>${Object.entries(FIELDS).map(([k, [, h]]) => `<tr><td class="l"><kbd>${k}</kbd></td><td class="l dim">${esc(h)}</td></tr>`).join('')}</tbody></table></details>
      <p class="note">Works on the daily prices and quote figures Meridian already holds for its built-in stocks (about one year of history). The one exception is <kbd>fair</kbd> / <kbd>upside</kbd> (a model estimate from company filings, loaded on demand for the 40 biggest stocks of the query). Other filing figures (revenue growth, margins, debt) are not fields here: see <kbd>COMPARE</kbd>, <kbd>QUAL</kbd> and <kbd>VAL</kbd>. It's a screening tool, not advice.</p>`;
    const ta = box.querySelector('textarea');
    const out = box.querySelector('.bql-out');
    ta.value = text;
    let sortCol = null; // clicked header: { k, desc }
    // fair / upside need each company's filings: loaded for the 40 biggest stocks of the query (two at a time), the table redraws as they arrive
    const fairTried = new Set();
    let fairTimer = null;
    let fairNote = '';
    const loadFair = (q) => {
      fairNote = '';
      if (E.mode !== 'live' || !/\b(fair|upside)\b/i.test(text)) return;
      let insts;
      try { insts = pickUniverse(E, q.universe); } catch { return; }
      const stocks = insts.filter((i) => isStock(E, i));
      const cand = stocks.sort((a, b) => (b.marketCap ?? b.shares * b.last ?? 0) - (a.marketCap ?? a.shares * a.last ?? 0)).slice(0, 40);
      let got = 0;
      for (const i of cand) {
        if (fairOf(i.sym, i.last).fair != null) got++;
        if (fairTried.has(i.sym)) continue;
        fairTried.add(i.sym);
        peek(E, i.sym, () => { clearTimeout(fairTimer); fairTimer = setTimeout(draw, 600); });
      }
      fairNote = `Fair price: ${got} of ${cand.length} loaded${stocks.length > cand.length ? ` (only the ${cand.length} biggest of ${stocks.length} stocks are loaded: name a sector, region or tickers to cover others)` : ''}; the others show “—” and never match a condition. It is a model estimate from stated assumptions, not a fact.`;
    };
    const draw = () => {
      let q;
      try { q = parseQuery(text); } catch (err) {
        out.innerHTML = `<div class="empty st-bad">${esc(err.message)}</div>`;
        return;
      }
      loadFair(q);
      let res;
      try { res = runQuery(E, q); } catch (err) {
        out.innerHTML = `<div class="empty st-bad">${esc(err.message)}</div>`;
        return;
      }
      let rows = res.rows;
      if (sortCol) rows = [...rows].sort((a, b) => (a.vals[sortCol.k] == null) - (b.vals[sortCol.k] == null) || (sortCol.desc ? -1 : 1) * ((a.vals[sortCol.k] ?? 0) - (b.vals[sortCol.k] ?? 0)));
      const dpOf = (c, v) => (Math.abs(v) >= 1000 ? 0 : Math.abs(v) >= 100 ? 1 : 2);
      out.innerHTML = `${fairNote ? `<p class="note">${esc(fairNote)}</p>` : ''}<p class="note">${res.total} of ${res.universe} stocks match${res.total > rows.length ? `, showing ${rows.length}` : ''}. Tap a column to sort; tap a ticker to open it.</p>
        <div class="tbl-wrap"><table class="tbl compact"><thead><tr><th class="l">Ticker</th><th class="l dim qname">Name</th>${q.cols.map((c, k) => `<th class="r" data-col="${k}" title="${esc(c.src)}" style="cursor:pointer">${esc(c.label)}${sortCol?.k === k ? (sortCol.desc ? ' ▼' : ' ▲') : ''}</th>`).join('')}</tr></thead><tbody>
        ${rows.map((r) => `<tr><td class="l">${secLink(r.i)}</td><td class="l dim qname">${esc(r.i.name)}</td>${r.vals.map((v) => `<td class="r">${v == null ? '<span class="dim">—</span>' : num(v, dpOf(null, v))}</td>`).join('')}</tr>`).join('') || `<tr><td class="l dim" colspan="${q.cols.length + 2}">No stock matches.</td></tr>`}
        </tbody></table></div>`;
      out.querySelector('thead').addEventListener('click', (e) => {
        const th = e.target.closest('[data-col]');
        if (!th) return;
        const k = Number(th.dataset.col);
        sortCol = sortCol?.k === k ? { k, desc: !sortCol.desc } : { k, desc: true };
        draw();
      });
    };
    const run = () => { text = ta.value.trim(); save('bql:last', text); sortCol = null; draw(); };
    box.addEventListener('click', (e) => {
      if (e.target.closest('[data-run]')) run();
      const ex = e.target.closest('[data-ex]');
      if (ex) { ta.value = EXAMPLES[Number(ex.dataset.ex)][1]; run(); }
    });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !e.shiftKey)) { e.preventDefault(); run(); } });
    draw();
    return { update: draw, every: 15 };
  },
});
