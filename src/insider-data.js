// Insider trades and short interest: the pure calculations behind INSIDER and SI.
//
// Source: Yahoo Finance's copy of SEC Forms 3/4/5 (insiderTransactions) and the twice-monthly
// short-interest reports (defaultKeyStatistics). Yahoo gives each insider trade as free text
// ("Sale at price 228.00 per share.", "Stock Award(Grant) ..."), so the kind of trade is worked
// out from that text. Only real open-market purchases and sales say anything about what an
// insider thinks of the price; grants, option exercises, tax withholding and gifts do not.

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const DAY = 86400e3;

/** Open-market trades under this value are shown but left out of the totals (noise). */
export const MIN_TRADE = 10000;

/** BUY / SELL (open market) or AWARD, EXERCISE, GIFT, OTHER (not a view on the price). */
export function classify(text) {
  const t = String(text || '');
  if (/gift/i.test(t)) return 'GIFT';
  if (/award|grant/i.test(t)) return 'AWARD';
  if (/conversion|exercise|tax liability|withh/i.test(t)) return 'EXERCISE';
  if (/purchase|\bbuy\b|bought/i.test(t)) return 'BUY';
  if (/\bsale\b|\bsold\b|\bsell\b/i.test(t)) return 'SELL';
  return 'OTHER';
}

/** Price per share: value ÷ shares if both are known, else the price in the text (mid of a range). */
export function priceOf(t) {
  if (fin(t.value) && t.value > 0 && fin(t.shares) && t.shares > 0) return t.value / t.shares;
  const m = /price\s+([\d,.]+)(?:\s*-\s*([\d,.]+))?/i.exec(t.text || '');
  if (!m) return null;
  const a = parseFloat(m[1].replace(/,/g, ''));
  const b = m[2] ? parseFloat(m[2].replace(/,/g, '')) : a;
  const p = (a + b) / 2;
  return fin(p) && p > 0 ? p : null;
}

const EXEC = /chief|officer|\bceo\b|\bcfo\b|\bcoo\b|\bcto\b|president|chair|founder|treasurer|counsel|\b[se]vp\b/i;
/** Short role label and whether the insider runs the company (executive) or only sits on its board. */
export function roleOf(relation) {
  const r = String(relation || '');
  if (/director/i.test(r) && !EXEC.test(r)) return { label: 'Director', exec: false };
  if (EXEC.test(r)) return { label: r.replace(/\s+/g, ' ').slice(0, 28), exec: true };
  if (/10%|owner/i.test(r)) return { label: '10% owner', exec: false };
  return { label: r.slice(0, 28) || '—', exec: false };
}

/** Raw Yahoo rows → tidy rows (newest first). `date` is in epoch seconds, as Yahoo gives it. */
export function normalize(list) {
  return (list || []).filter((t) => t && fin(t.date)).map((t) => {
    const kind = classify(t.text);
    const price = priceOf(t);
    const value = fin(t.value) && t.value > 0 ? t.value : fin(t.shares) && price ? t.shares * price : null;
    const role = roleOf(t.relation);
    return { name: t.name || '—', relation: t.relation || '', role: role.label, exec: role.exec, text: t.text || '', date: t.date, kind, shares: fin(t.shares) ? t.shares : null, price, value, small: value != null && value < MIN_TRADE && (kind === 'BUY' || kind === 'SELL') };
  }).sort((a, b) => b.date - a.date);
}

const counted = (t, kind) => t.kind === kind && !t.small;

/**
 * Totals for the last `days` days, open-market trades of at least MIN_TRADE only.
 * (A trade with no known value still counts as a trade, but adds nothing to the dollar totals.)
 */
export function windowStats(rows, days, nowMs) {
  const from = nowMs - days * DAY;
  const inWin = rows.filter((t) => t.date * 1000 >= from && t.date * 1000 <= nowMs + DAY);
  const sum = (kind) => {
    const xs = inWin.filter((t) => counted(t, kind));
    return { n: xs.length, people: new Set(xs.map((t) => t.name)).size, value: xs.reduce((a, t) => a + (t.value || 0), 0), shares: xs.reduce((a, t) => a + (t.shares || 0), 0), exec: xs.some((t) => t.exec) };
  };
  const buy = sum('BUY');
  const sell = sum('SELL');
  return { days, buy, sell, net: buy.value - sell.value };
}

/** The most distinct insiders who bought within any 30 days of the last `days` days. */
export function cluster(rows, days, nowMs) {
  const buys = rows.filter((t) => counted(t, 'BUY') && t.date * 1000 >= nowMs - days * DAY).sort((a, b) => a.date - b.date);
  let best = { people: 0, from: null, to: null };
  for (let i = 0; i < buys.length; i++) {
    const end = buys[i].date + 30 * 86400;
    const grp = buys.filter((t) => t.date >= buys[i].date && t.date <= end);
    const people = new Set(grp.map((t) => t.name)).size;
    if (people > best.people) best = { people, from: buys[i].date, to: grp[grp.length - 1].date };
  }
  return best;
}

/**
 * One word for the last 180 days. Buying is the stronger signal (insiders sell for many
 * reasons: taxes, a house, diversification, a pre-set plan; they buy for one), so selling is
 * never coloured as a warning on its own.
 */
export function signal(rows, nowMs) {
  const w = windowStats(rows, 180, nowMs);
  const c = cluster(rows, 180, nowMs);
  if (c.people >= 3) return { word: 'Cluster buying', cls: 'up', rank: 4, why: `${c.people} different insiders bought within 30 days`, w, c };
  if (w.buy.n && w.buy.exec && w.buy.value >= w.sell.value) return { word: 'Executive buying', cls: 'up', rank: 3, why: 'a company officer bought on the open market', w, c };
  if (w.buy.n && w.buy.value >= w.sell.value) return { word: 'Net buying', cls: 'up', rank: 2, why: 'more bought than sold', w, c };
  if (w.buy.n) return { word: 'Mixed', cls: 'dim', rank: 1, why: 'some buying, but more sold', w, c };
  if (w.sell.n) return { word: 'Selling only', cls: 'dim', rank: 0, why: 'sales are a weak signal on their own', w, c };
  return { word: 'No open-market trades', cls: 'dim', rank: 0, why: 'no purchases or sales of $10,000 or more in 180 days', w, c };
}

/** Month buckets for the bar chart, oldest first: [{ key: '2026-10', buy, sell }]. */
export function monthly(rows, nowMs, months = 12) {
  const now = new Date(nowMs);
  const out = [];
  for (let k = months - 1; k >= 0; k--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1));
    out.push({ key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, buy: 0, sell: 0 });
  }
  const at = new Map(out.map((m) => [m.key, m]));
  for (const t of rows) {
    if (t.small || (t.kind !== 'BUY' && t.kind !== 'SELL')) continue;
    const m = at.get(new Date(t.date * 1000).toISOString().slice(0, 7));
    if (m) m[t.kind === 'BUY' ? 'buy' : 'sell'] += t.value || 0;
  }
  return out;
}

/** The oldest and newest trade Yahoo lists, so the screen can say how far back the numbers reach. */
export function coverage(rows) {
  if (!rows.length) return null;
  return { from: rows[rows.length - 1].date, to: rows[0].date, n: rows.length };
}

// ---- short interest --------------------------------------------------------------------------

/**
 * Short interest from Yahoo's key statistics: shares sold short, % of float, days to cover
 * (shares short ÷ average daily volume) and the change against the report a month earlier.
 */
export function shortStats(k) {
  if (!k || !fin(k.sharesShort)) return null;
  const prior = fin(k.sharesShortPrior) && k.sharesShortPrior > 0 ? k.sharesShortPrior : null;
  const pf = fin(k.shortFloat) ? k.shortFloat : fin(k.float) && k.float > 0 ? k.sharesShort / k.float : null;
  const dtc = fin(k.shortRatio) ? k.shortRatio : fin(k.avgVolume) && k.avgVolume > 0 ? k.sharesShort / k.avgVolume : null;
  const dtc10 = fin(k.avgVolume10d) && k.avgVolume10d > 0 ? k.sharesShort / k.avgVolume10d : null;
  const change = prior ? k.sharesShort / prior - 1 : null;
  const level = !fin(pf) ? null : pf < 0.03 ? 0 : pf < 0.1 ? 1 : pf < 0.2 ? 2 : 3;
  const cover = !fin(dtc) ? null : dtc < 2 ? 0 : dtc < 5 ? 1 : 2;
  return {
    shares: k.sharesShort, prior, pf, dtc, dtc10, change, level, cover, date: fin(k.shortDate) ? k.shortDate : null,
    ofOut: fin(k.sharesOut) && k.sharesOut > 0 ? k.sharesShort / k.sharesOut : null,
    squeeze: fin(pf) && fin(dtc) && pf >= 0.15 && dtc >= 4,
    trend: change == null ? null : change > 0.1 ? 'rising' : change < -0.1 ? 'falling' : 'steady',
  };
}
export const LEVEL_WORD = ['Low', 'Moderate', 'High', 'Very high'];
export const LEVEL_CLS = ['dim', '', 'txt-warn', 'down'];
export const COVER_WORD = ['quick to cover', 'moderate to cover', 'slow to cover'];

/** Keep one snapshot per report date (newest first, at most 24) so the history builds up over time. */
export function addSnapshot(list, st, nowMs) {
  const hist = Array.isArray(list) ? list.slice() : [];
  if (!st || !st.date) return hist;
  const day = new Date(st.date * 1000).toISOString().slice(0, 10);
  if (hist.some((h) => h.d === day)) return hist;
  hist.push({ d: day, s: st.shares, p: fin(st.pf) ? st.pf : null, c: fin(st.dtc) ? st.dtc : null, seen: new Date(nowMs).toISOString().slice(0, 10) });
  hist.sort((a, b) => (a.d < b.d ? 1 : -1));
  return hist.slice(0, 24);
}
