// Pure maths for PRISK, the portfolio risk screen: volatility, the size of a bad day, how much each
// position adds to the total risk, which positions move together, and how concentrated the book is.
// Everything is computed from past daily prices, so it describes how this mix of positions behaved over
// the last year. It is an estimate, not a limit: markets can fall further than any of its past days.

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
export const MIN_DAYS = 60;      // fewer shared price days than this and a position can't be measured
export const WINDOW = 250;       // about one trading year
export const CLUSTER_CORR = 0.7; // pairs at least this correlated "move together"

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const cov = (a, b) => {
  const ma = mean(a);
  const mb = mean(b);
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - ma) * (b[i] - mb);
  return s / (a.length - 1);
};
const sd = (xs) => Math.sqrt(cov(xs, xs));
const corrOf = (a, b) => {
  const d = sd(a) * sd(b);
  return d > 0 ? cov(a, b) / d : 0;
};

/**
 * Aligns price series on the dates they all share (exchanges have different holidays) and returns the
 * daily simple returns of each, newest WINDOW days. `series` = [{ key, bars: [{t, c}] }].
 * A series with fewer than MIN_DAYS dates in common with the first MIN is dropped (listed in `dropped`).
 */
export function alignReturns(series) {
  let dates = null;
  const keep = [];
  const dropped = [];
  // start from the series with the longest history so one short one doesn't shrink the window for everyone
  const order = [...series].sort((a, b) => (b.bars?.length || 0) - (a.bars?.length || 0));
  for (const s of order) {
    const set = new Set((s.bars || []).filter((b) => fin(b.c) && b.c > 0).map((b) => b.t));
    const next = dates ? [...dates].filter((t) => set.has(t)) : [...set];
    if (next.length < MIN_DAYS + 1) { dropped.push(s.key); continue; }
    dates = new Set(next);
    keep.push(s);
  }
  if (!keep.length) return { dates: [], rets: new Map(), dropped };
  const ds = [...dates].sort().slice(-(WINDOW + 1));
  const rets = new Map();
  for (const s of keep) {
    const px = new Map(s.bars.map((b) => [b.t, b.c]));
    const r = [];
    for (let k = 1; k < ds.length; k++) r.push(px.get(ds[k]) / px.get(ds[k - 1]) - 1);
    rets.set(s.key, r);
  }
  return { dates: ds.slice(1), rets, dropped };
}

/**
 * positions: [{ key, mv (signed, in the reporting currency), sector, bars }]; cash: number; bench: bars or null.
 * Returns null if nothing can be measured.
 */
export function portfolioRisk(positions, cash, bench) {
  const series = positions.map((p) => ({ key: p.key, bars: p.bars }));
  if (bench) series.push({ key: '__bench', bars: bench });
  const al = alignReturns(series);
  const held = positions.filter((p) => al.rets.has(p.key));
  const dropped = al.dropped.filter((k) => k !== '__bench');
  const nDays = al.dates.length;
  if (!held.length || nDays < MIN_DAYS) return { error: 'not enough shared price history', dropped };

  const nav = positions.reduce((a, p) => a + p.mv, 0) + cash;
  if (!(nav > 0)) return { error: 'the portfolio has no positive net value', dropped };
  // weights on the whole portfolio value (cash counts as zero risk); dropped positions are left out of the risk
  const w = new Map(held.map((p) => [p.key, p.mv / nav]));
  const rp = Array.from({ length: nDays }, (_, t) => held.reduce((a, p) => a + w.get(p.key) * al.rets.get(p.key)[t], 0));

  const vol = sd(rp);
  const sorted = [...rp].sort((a, b) => a - b);
  const cut = Math.max(1, Math.floor(sorted.length * 0.05));
  const worstFifth = sorted.slice(0, cut);
  const var95 = -sorted[cut - 1];
  const es95 = -mean(worstFifth);
  const contrib = held.map((p) => {
    const r = al.rets.get(p.key);
    const share = vol > 0 ? (w.get(p.key) * cov(r, rp)) / (vol * vol) : 0;
    return { key: p.key, weight: w.get(p.key), vol: sd(r) * Math.sqrt(252), share };
  });

  // which positions move together (long/long or short/short pairs of the same sign of exposure behave alike)
  const pairs = [];
  for (let i = 0; i < held.length; i++) {
    for (let j = i + 1; j < held.length; j++) pairs.push({ a: held[i].key, b: held[j].key, c: corrOf(al.rets.get(held[i].key), al.rets.get(held[j].key)) });
  }
  const parent = new Map(held.map((p) => [p.key, p.key]));
  const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));
  for (const q of pairs) if (q.c >= CLUSTER_CORR) parent.set(find(q.a), find(q.b));
  const groups = new Map();
  for (const p of held) {
    const g = find(p.key);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(p.key);
  }
  const clusters = [...groups.values()].filter((g) => g.length > 1).map((keys) => ({
    keys, weight: keys.reduce((a, k) => a + w.get(k), 0),
    corr: mean(pairs.filter((q) => keys.includes(q.a) && keys.includes(q.b)).map((q) => q.c)),
  })).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));

  // concentration, on gross exposure so shorts count as positions too
  const gross = positions.reduce((a, p) => a + Math.abs(p.mv), 0);
  const gw = positions.map((p) => ({ key: p.key, w: gross > 0 ? Math.abs(p.mv) / gross : 0, sector: p.sector || null })).sort((a, b) => b.w - a.w);
  const hhi = gw.reduce((a, g) => a + g.w * g.w, 0);
  const sectors = new Map();
  for (const g of gw) sectors.set(g.sector || 'Other', (sectors.get(g.sector || 'Other') || 0) + g.w);

  let beta = null;
  let marketCorr = null;
  if (al.rets.has('__bench')) {
    const m = al.rets.get('__bench');
    const vm = cov(m, m);
    if (vm > 0) { beta = cov(rp, m) / vm; marketCorr = corrOf(rp, m); }
  }
  const worst = Math.min(...rp);
  const best = Math.max(...rp);
  return {
    nav, cashW: cash / nav, days: nDays, from: al.dates[0], to: al.dates[nDays - 1], vol, annVol: vol * Math.sqrt(252), var95, var95Param: 1.645 * vol, es95, worst, best,
    contrib: contrib.sort((a, b) => Math.abs(b.share) - Math.abs(a.share)), clusters, pairs, avgCorr: pairs.length ? mean(pairs.map((q) => q.c)) : null,
    top1: gw[0] || null, top3: gw.slice(0, 3).reduce((a, g) => a + g.w, 0), effN: hhi > 0 ? 1 / hhi : null,
    sectors: [...sectors].map(([name, wt]) => ({ name, w: wt })).sort((a, b) => b.w - a.w),
    beta, marketCorr, dropped, gross,
  };
}

/** Plain-language flags, most important first. Each: { level: 'warn'|'info', text }. */
export function flags(r, label = (k) => k) {
  const out = [];
  if (!r || r.error) return out;
  if (r.top1 && r.top1.w >= 0.3) out.push({ level: 'warn', text: `${label(r.top1.key)} is ${Math.round(r.top1.w * 100)}% of your invested positions. One bad day for that stock is a bad day for the whole portfolio.` });
  if (r.cashW >= 0.3) out.push({ level: 'info', text: `${Math.round(r.cashW * 100)}% of the portfolio is cash, which doesn't move. That is why the risk figures are low: they would be about ${(1 / (1 - r.cashW)).toFixed(1)}× higher if the same positions made up the whole portfolio.` });
  const sec = r.sectors.find((s) => s.name !== 'Other' && s.name !== 'ETF' && s.w >= 0.4);
  if (sec) out.push({ level: 'warn', text: `${Math.round(sec.w * 100)}% sits in one sector (${sec.name}). Those stocks tend to rise and fall for the same reasons.` });
  for (const c of r.clusters.slice(0, 2)) {
    if (Math.abs(c.weight) >= 0.2) out.push({ level: 'warn', text: `${c.keys.map(label).join(', ')} moved together over the last year (average correlation ${c.corr.toFixed(2)}) and are ${Math.round(Math.abs(c.weight) * 100)}% of the portfolio: in practice they are closer to one big position than ${c.keys.length} separate ones.` });
  }
  const heavy = r.contrib.find((c) => Math.abs(c.weight) > 0.02 && c.share >= 2 * Math.abs(c.weight) && c.share >= 0.25);
  if (heavy) out.push({ level: 'info', text: `${label(heavy.key)} is ${Math.round(Math.abs(heavy.weight) * 100)}% of the value but ${Math.round(heavy.share * 100)}% of the risk, because it swings much more than the rest.` });
  if (r.effN != null && r.effN < 3) out.push({ level: 'info', text: `Counted by size, the portfolio behaves like about ${r.effN.toFixed(1)} equal positions.` });
  if (r.beta != null && r.beta > 1.3) out.push({ level: 'info', text: `A market beta of ${r.beta.toFixed(2)} means it has fallen about ${Math.round(r.beta * 10)}% when the S&P 500 fell 10%.` });
  return out;
}
