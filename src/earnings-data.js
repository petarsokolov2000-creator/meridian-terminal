// Pure maths for the earnings preview (PREVIEW): how often a company beat its estimate, and how its
// share price moved around its past reports. No network, so it can be unit-tested.
//
// Report dates come from the SEC (the 8-K filed with the results). The SEC doesn't say whether the
// results came before the market opened or after the close, so the move is measured over two trading
// days: the close before the report date to the close after it. That window contains the reaction either
// way, plus one ordinary day of noise. It is an approximation, and the screen says so.

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const DAY = 86400;

/** Median of a list of numbers (null if empty). */
export function median(xs) {
  const a = xs.filter(fin).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Index of the first bar on or after `date` ('YYYY-MM-DD'); -1 if none. Bars are oldest first. */
export function barOn(bars, date) {
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].t < date) lo = mid + 1;
    else hi = mid;
  }
  return lo < bars.length ? lo : -1;
}

/**
 * The share price move around each report date: [{ date, move, day0, day1, i }] (move = close after the
 * next trading day ÷ close before the report date − 1). Dates without enough price history around them
 * (older than the history, or too recent for the next day's close) are left out.
 */
export function reactions(bars, dates) {
  const out = [];
  for (const date of dates || []) {
    const i = barOn(bars || [], date);
    if (i < 1 || i + 1 >= bars.length) continue;
    // the first bar must be within 5 days of the date, or the history has a gap there
    if (Date.parse(`${bars[i].t}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`) > 5 * DAY * 1000) continue;
    const before = bars[i - 1].c;
    out.push({ date, i, move: bars[i + 1].c / before - 1, day0: bars[i].c / before - 1, day1: bars[i + 1].c / bars[i].c - 1 });
  }
  return out;
}

/** The average size of an ordinary two-day move (days not touching a report), for comparison. */
export function normalMove(bars, reacts) {
  if (!bars || bars.length < 30) return null;
  const skip = new Set();
  for (const r of reacts) for (let k = r.i - 1; k <= r.i + 2; k++) skip.add(k);
  const xs = [];
  for (let k = 1; k + 1 < bars.length; k++) {
    if (skip.has(k)) continue;
    xs.push(Math.abs(bars[k + 1].c / bars[k - 1].c - 1));
  }
  return mean(xs);
}

/**
 * Pairs each report date with the quarter it reported: the latest quarter that ended before the date
 * and no more than 130 days earlier. details.earnings rows have `quarter` = quarter end in epoch seconds.
 * Returns the rows newest first: { date, quarter, estimate, actual, surprise, move }.
 */
export function pairUp(earnings, reacts, dates) {
  const rows = [...(earnings || [])].filter((e) => fin(e.quarter)).sort((a, b) => b.quarter - a.quarter);
  const used = new Set();
  const byDate = new Map((reacts || []).map((r) => [r.date, r]));
  const out = [];
  for (const date of dates || []) {
    const t = Date.parse(`${date}T00:00:00Z`) / 1000;
    const q = rows.find((e) => !used.has(e) && e.quarter < t && t - e.quarter <= 130 * DAY);
    if (q) used.add(q);
    const r = byDate.get(date);
    out.push({ date, quarter: q?.quarter ?? null, estimate: q?.estimate ?? null, actual: q?.actual ?? null, surprise: q?.surprise ?? null, move: r ? r.move : null });
  }
  return out;
}

/** Beat record of the latest `n` quarters (rows from details.earnings). */
export function beatRecord(earnings, n = 8) {
  const rows = [...(earnings || [])].filter((e) => fin(e.actual) && fin(e.estimate)).sort((a, b) => b.quarter - a.quarter).slice(0, n);
  if (!rows.length) return null;
  const beat = rows.filter((e) => e.actual > e.estimate).length;
  const miss = rows.filter((e) => e.actual < e.estimate).length;
  let streak = 0;
  for (const e of rows) { if (e.actual > e.estimate) streak++; else break; }
  const sur = rows.map((e) => (fin(e.surprise) ? e.surprise : (e.actual - e.estimate) / Math.abs(e.estimate || NaN))).filter(fin);
  return { n: rows.length, beat, miss, inline: rows.length - beat - miss, streak, avgSurprise: mean(sur) };
}

/** Summary of the moves: sizes, direction, and how the stock moved after beats versus misses. */
export function moveStats(paired, normal) {
  const mv = paired.filter((p) => fin(p.move));
  if (!mv.length) return null;
  const abs = mv.map((p) => Math.abs(p.move));
  const after = (cond) => mv.filter((p) => fin(p.surprise) && cond(p.surprise));
  const up = (xs) => xs.filter((p) => p.move > 0).length;
  const beats = after((s) => s > 0);
  const misses = after((s) => s < 0);
  return {
    n: mv.length, avgAbs: mean(abs), medianAbs: median(abs), maxAbs: Math.max(...abs), upShare: up(mv) / mv.length,
    ratio: fin(normal) && normal > 0 ? mean(abs) / normal : null,
    beats: { n: beats.length, up: up(beats) }, misses: { n: misses.length, up: up(misses) },
  };
}
