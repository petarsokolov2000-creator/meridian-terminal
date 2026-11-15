// Numbers worked out from an instrument's loaded daily history (about one year), shared by
// BREADTH, BQL and MARS. Nothing is fetched here.

import { rsi as rsiSeries } from './studies.js';

const fin = (v) => typeof v === 'number' && Number.isFinite(v);

/** Daily closes with today's price appended. */
export function closesOf(i) {
  const c = (i.history || []).map((b) => b.c);
  if (fin(i.last)) c.push(i.last);
  return c;
}

export function smaOf(i, n) {
  const c = closesOf(i);
  if (c.length < n) return null;
  let s = 0;
  for (let k = c.length - n; k < c.length; k++) s += c[k];
  return s / n;
}

/** Return over the last n trading days (0.1 = +10%), or null without enough history. */
export function retOf(i, n) {
  const c = closesOf(i);
  if (c.length <= n) return null;
  const a = c[c.length - 1 - n];
  return a > 0 ? c[c.length - 1] / a - 1 : null;
}

/** Highest and lowest price of the loaded year, not counting today (so "new high" can be told). */
export function priorRange(i) {
  const h = i.history || [];
  if (h.length < 20) return null;
  let hi = -Infinity;
  let lo = Infinity;
  for (const b of h) {
    hi = Math.max(hi, b.h ?? b.c);
    lo = Math.min(lo, b.l ?? b.c);
  }
  return { hi, lo };
}

/** 'high' / 'low' when today's price is beyond the loaded year's range, else null; plus distances. */
export function hiLoOf(i) {
  const r = priorRange(i);
  if (!r || !fin(i.last)) return null;
  const hi = Math.max(r.hi, i.last);
  const lo = Math.min(r.lo, i.last);
  return { hi, lo, offHigh: i.last / hi - 1, aboveLow: i.last / lo - 1, state: i.last > r.hi ? 'high' : i.last < r.lo ? 'low' : null };
}

export function rsiOf(i, n = 14) {
  const c = closesOf(i);
  if (c.length < n + 2) return null;
  const r = rsiSeries(c, n);
  const v = Array.isArray(r) ? r[r.length - 1] : r;
  return fin(v) ? v : null;
}

/** Daily returns (fractions) from closes; used for risk. */
export function dailyReturns(closes) {
  const out = [];
  for (let k = 1; k < closes.length; k++) out.push(closes[k - 1] > 0 ? closes[k] / closes[k - 1] - 1 : 0);
  return out;
}

export const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
export const stdev = (xs) => {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
