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

// Pure part: from the valuation payload (and beta/yield for the discount rate) to a result.
export function compute(v, { beta, rf, sym }) {
  if (!v) return none('no company data');
  if (v.currencyMismatch) return none(v.currencyMismatch);
  // statements converted into the price currency, but the share count doesn't fit the price (usually an ADR): no number rather than a wrong one
  if (v.shareCheck?.suspect) return none(`the share count doesn't fit the price (an ADR with several shares per receipt?): price × shares is ${v.shareCheck.ratio.toFixed(1)}× the quoted market value`);
  const years = v.years || [];
  if (v.financial) {
    const y = [...years].reverse().find((r) => fin(r.epsDil) && fin(r.commonEquity) && fin(r.shares ?? r.sharesOut ?? r.sharesDil));
    if (!y) return none('bank or insurer: earnings per share or book value not reported');
    const sh = y.shares ?? y.sharesOut ?? y.sharesDil;
    const bvps = y.commonEquity / sh;
    if (!(y.epsDil > 0) || !(bvps > 0)) return none(`bank or insurer: ${y.epsDil > 0 ? 'book value' : 'earnings'} per share is not positive, so the Graham number doesn't exist`);
    const value = Math.sqrt(22.5 * y.epsDil * bvps);
    return { kind: 'graham', value, fy: y.fy, note: `Graham number FY${y.fy}: √(22.5 × EPS ${y.epsDil.toFixed(2)} × book value/share ${bvps.toFixed(2)}). A DCF doesn't apply to banks and insurers.` };
  }
  const d = dcfDefaults(years, { beta, rf });
  if (!d) return none('no revenue history');
  const saved = store(`dcf:${sym}`, null)?.scen?.base;
  const base = saved ? { growth: saved.growth, margin: saved.margin, discount: saved.discount, terminal: saved.terminal } : { growth: d.growth, margin: d.margin, discount: d.discount, terminal: d.terminal };
  const missing = [['growth', 'revenue growth'], ['margin', 'free-cash-flow margin'], ['discount', Number.isFinite(rf) ? 'discount rate' : 'the 10-year Treasury yield for the discount rate']].filter(([k]) => !fin(base[k])).map(([, n]) => n);
  if (missing.length) return none(`missing ${missing.join(', ')}`);
  const r = dcf({ revenue0: d.revenue0, netDebt: d.netDebt, shares: d.shares, ...base });
  if (r.error) return none(r.error);
  if (!(r.perShare > 0)) return none('the DCF comes out negative with these inputs (free cash flow too small for the debt)');
  return {
    kind: 'dcf', value: r.perShare, fy: d.fy, edited: !!saved, tvShare: r.tvShare,
    note: `Base-case DCF (${saved ? 'your edited assumptions' : 'defaults from the last filings'}): growth ${(base.growth * 100).toFixed(1)}%/yr, FCF margin ${(base.margin * 100).toFixed(1)}%, discount rate ${(base.discount * 100).toFixed(1)}%, terminal growth ${(base.terminal * 100).toFixed(1)}%. ${Math.round(r.tvShare * 100)}% of the value comes from years beyond 10.`,
  };
}

async function load(E, sym, v) {
  const i = E.get(sym);
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

export function forget(sym) {
  done.delete(sym);
}

// value vs today's price: margin of safety = (value − price) ÷ value, positive = price below value (same as DCF)
export const marginOfSafety = (res, price) => (res?.value > 0 && fin(price) ? (res.value - price) / res.value : null);
