// One "intrinsic value per share" number for a stock, for lists and summaries.
//
// Operating companies: the base case of the same DCF as the DCF screen (same inputs, same formula; if you
// edited the base case there, your numbers are used here). Banks and insurers have no free cash flow, so a
// DCF doesn't apply: they get the Graham number, sqrt(22.5 × EPS × book value per share), a rule of thumb
// that says a fair price is at most 15× earnings and 1.5× book. Nothing is invented: if an input is missing
// the answer is "n/a" with the reason.

import { dcf, dcfDefaults } from './functions/valuation.js';
import { store } from './fmt.js';

const done = new Map(); // sym -> { at, res }
const busy = new Map(); // sym -> Promise
const waiting = [];
let running = 0;
const TTL = 30 * 60000;
const SLOTS = 2; // each first load is several Yahoo requests, so only two at a time

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const none = (why) => ({ kind: 'none', why });

export function isStock(E, i) {
  return E.mode === 'live' && !!i && i.cls === 'EQ' && !i.etf;
}

// Pure part: from the valuation payload (and beta/rf for the discount rate) to a result.
//
// Several simple models each give a value per share; the fair price is their MEDIAN (one wild model can't drag it),
// shown with the low–high range and every model's own number:
//   operating companies: DCF (base case) · own-history P/E · own-history EV/EBITDA · own-history FCF yield · Graham number
//   banks / insurers:    Graham number · own-history P/E · own-history price-to-book
// "Own-history" = the company's usual multiple (median of the fiscal years Yahoo provides) applied to today's earnings,
// EBITDA, free cash flow or book value. A model that lacks an input is left out, never guessed.
const MODEL_NAMES = { dcf: 'DCF', graham: 'Graham number', pe: 'P/E at its own median', ev: 'EV/EBITDA at its own median', fcf: 'FCF yield at its own median', pb: 'P/B at its own median' };

function median(xs) {
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// value per share if the company traded at its own median multiple (earnings, cash flow or book value held at today's level)
function histModels(v) {
  const c = v.current || {};
  const st = v.stats || {};
  const px = c.price;
  const med = (k) => (st[k]?.y5 && !st[k].y5.short && fin(st[k].y5.median) && st[k].y5.median > 0 ? st[k].y5.median : null);
  const out = [];
  if (!(px > 0)) return out;
  const ratio = (k, cur, m, flip) => {
    if (!(cur > 0) || !m) return;
    out.push({ key: k, value: px * (flip ? cur / m : m / cur), basis: `${flip ? 'yield' : 'multiple'} ${flip ? (cur * 100).toFixed(1) + '%' : cur.toFixed(1) + '×'} now vs median ${flip ? (m * 100).toFixed(1) + '%' : m.toFixed(1) + '×'}` });
  };
  ratio('pe', c.pe, med('pe'));
  if (v.financial) {
    ratio('pb', c.pb, med('pb'));
  } else {
    // EV/EBITDA: the median multiple on today's EBITDA, then net debt taken off and divided by the same share count
    const m = med('evEbitda');
    if (m && c.ev > 0 && c.evEbitda > 0 && c.marketCap > 0) {
      const equity = m * (c.ev / c.evEbitda) - (c.ev - c.marketCap);
      if (equity > 0) out.push({ key: 'ev', value: px * equity / c.marketCap, basis: `multiple ${c.evEbitda.toFixed(1)}× now vs median ${m.toFixed(1)}×` });
    }
    ratio('fcf', c.fcfYield, med('fcfYield'), true);
  }
  return out.filter((r) => fin(r.value) && r.value > 0);
}

export function compute(v, { beta, rf, sym }) {
  if (!v) return none('no company data');
  if (v.currencyMismatch) return none(v.currencyMismatch);
  // statements converted into the price currency, but the share count doesn't fit the price (usually an ADR): no number rather than a wrong one
  if (v.shareCheck?.suspect) return none(`the share count doesn't fit the price (an ADR with several shares per receipt?): price × shares is ${v.shareCheck.ratio.toFixed(1)}× the quoted market value`);
  const years = v.years || [];
  const models = [];
  const why = [];
  let fy = null;
  let edited = false;
  let tvShare = null;
  let dcfNote = '';
  // Graham number: √(22.5 × EPS × book value per share), a rule of thumb for "at most 15× earnings and 1.5× book"
  const y = [...years].reverse().find((r) => fin(r.epsDil) && fin(r.commonEquity) && fin(r.shares ?? r.sharesOut ?? r.sharesDil));
  if (y) {
    const bvps = y.commonEquity / (y.shares ?? y.sharesOut ?? y.sharesDil);
    if (y.epsDil > 0 && bvps > 0) {
      models.push({ key: 'graham', value: Math.sqrt(22.5 * y.epsDil * bvps), basis: `FY${y.fy}: EPS ${y.epsDil.toFixed(2)}, book value/share ${bvps.toFixed(2)}` });
      fy = y.fy;
    } else why.push(`Graham: ${y.epsDil > 0 ? 'book value' : 'earnings'} per share is not positive`);
  } else why.push('Graham: earnings per share or book value not reported');
  if (!v.financial) {
    const d = dcfDefaults(years, { beta, rf });
    if (!d) why.push('DCF: no revenue history');
    else {
      const saved = store(`dcf:${sym}`, null)?.scen?.base;
      const base = saved ? { growth: saved.growth, margin: saved.margin, discount: saved.discount, terminal: saved.terminal } : { growth: d.growth, margin: d.margin, discount: d.discount, terminal: d.terminal };
      const missing = [['growth', 'revenue growth'], ['margin', 'free-cash-flow margin'], ['discount', Number.isFinite(rf) ? 'discount rate' : 'the 10-year Treasury yield for the discount rate']].filter(([k]) => !fin(base[k])).map(([, n]) => n);
      const r = missing.length ? null : dcf({ revenue0: d.revenue0, netDebt: d.netDebt, shares: d.shares, ...base });
      if (missing.length) why.push(`DCF: missing ${missing.join(', ')}`);
      else if (r.error) why.push(`DCF: ${r.error}`);
      else if (!(r.perShare > 0)) why.push('DCF: comes out negative with these inputs (free cash flow too small for the debt)');
      else {
        models.unshift({ key: 'dcf', value: r.perShare, basis: `${saved ? 'your edited assumptions' : 'defaults from the last filings'}: growth ${(base.growth * 100).toFixed(1)}%/yr, FCF margin ${(base.margin * 100).toFixed(1)}%, discount ${(base.discount * 100).toFixed(1)}%, terminal ${(base.terminal * 100).toFixed(1)}%; ${Math.round(r.tvShare * 100)}% of the value comes from years beyond 10` });
        fy = d.fy;
        edited = !!saved;
        tvShare = r.tvShare;
        dcfNote = `Base-case DCF (${saved ? 'your edited assumptions' : 'defaults from the last filings'}): growth ${(base.growth * 100).toFixed(1)}%/yr, FCF margin ${(base.margin * 100).toFixed(1)}%, discount rate ${(base.discount * 100).toFixed(1)}%, terminal growth ${(base.terminal * 100).toFixed(1)}%. ${Math.round(r.tvShare * 100)}% of the value comes from years beyond 10.`;
      }
    }
  }
  models.push(...histModels(v));
  for (const m of models) m.name = MODEL_NAMES[m.key];
  if (!models.length) return none(why.join('; ') || 'no model has the inputs it needs');
  const vals = models.map((m) => m.value);
  const value = median(vals);
  const low = Math.min(...vals);
  const high = Math.max(...vals);
  const list = models.map((m) => `${m.name} ${m.value.toFixed(2)}`).join(' · ');
  const wide = models.length >= 2 && high / low > 2.5;
  if (models.length === 1) {
    const m = models[0];
    return {
      kind: m.key === 'graham' ? 'graham' : 'dcf', value, fy, edited, tvShare, models, low, high,
      note: m.key === 'graham' ? `Graham number FY${y.fy}: √(22.5 × EPS ${y.epsDil.toFixed(2)} × book value/share ${(y.commonEquity / (y.shares ?? y.sharesOut ?? y.sharesDil)).toFixed(2)}). Only this model had its inputs${why.length ? ` (${why.join('; ')})` : ''}.` : `${dcfNote || `${m.name}: ${m.basis}.`} Only this model had its inputs.`,
    };
  }
  return {
    kind: 'blend', value, fy, edited, tvShare, models, low, high, wide,
    note: `Median of ${models.length} models: ${list}. Range ${low.toFixed(2)}–${high.toFixed(2)}.${wide ? ' The models disagree widely: treat the number with extra caution.' : ''}${why.length ? ` Left out: ${why.join('; ')}.` : ''}`,
  };
}

async function load(E, sym, v) {
  const i = E.get(sym) || E.moreBySym?.get(String(sym).toUpperCase());
  if (!isStock(E, i)) return none('only for company stocks, with real data');
  const val = v || await E.valuation(i.sym);
  let beta = null;
  if (!val.financial && !val.currencyMismatch) beta = (await E.details(i.sym).catch(() => null))?.stats?.beta ?? null;
  const t = E.get('US10Y');
  return compute(val, { beta, rf: t?.last != null ? t.last / 100 : null, sym: i.sym });
}

function pump(E) {
  while (running < SLOTS && waiting.length) {
    const job = waiting.shift();
    running++;
    load(E, job.sym, job.v).then(job.ok, job.no).finally(() => { running--; pump(E); });
  }
}

// Promise of the result. `v` = valuation payload if the caller already has it (skips a request).
export function intrinsic(E, sym, v) {
  const hit = done.get(sym);
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.res);
  if (busy.has(sym)) return busy.get(sym);
  const p = new Promise((ok, no) => waiting.push({ sym, v, ok, no })).then((res) => {
    done.set(sym, { at: Date.now(), res });
    return res;
  }).finally(() => busy.delete(sym));
  busy.set(sym, p);
  pump(E);
  return p;
}

// Sync peek for tables: cached result, or null while it loads (and starts the load).
export function peek(E, sym, onReady) {
  const hit = done.get(sym);
  if (hit && Date.now() - hit.at < TTL) return hit.res;
  if (!busy.has(sym)) intrinsic(E, sym).then(() => onReady?.(), (err) => onReady?.(err));
  return null;
}

// The finished result if there is one: never starts a load (for sorting and filtering columns).
export function cachedResult(sym) {
  const hit = done.get(sym);
  return hit && Date.now() - hit.at < TTL ? hit.res : null;
}

// Fair price per share and how far the price is from it (+ = fair price above the price), or nulls.
export function fairOf(sym, price) {
  const r = cachedResult(sym);
  if (!r || r.kind === 'none' || !(r.value > 0)) return { fair: null, upside: null };
  return { fair: r.value, upside: fin(price) && price > 0 ? (r.value / price - 1) * 100 : null };
}

export function forget(sym) {
  done.delete(sym);
}

// value vs today's price: margin of safety = (value − price) ÷ value, positive = price below value (same as DCF)
export const marginOfSafety = (res, price) => (res?.value > 0 && fin(price) ? (res.value - price) / res.value : null);
