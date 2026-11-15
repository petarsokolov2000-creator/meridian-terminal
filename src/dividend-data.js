// Dividend maths for DIVCAL. Pure functions, no screen code.
//
// Input is a company's dividend list as Yahoo gives it: [{ date (seconds, the EX-dividend date), amount }].
// The ex-date is the last day to buy and still get the payment; the money usually arrives a few weeks later.
// Nothing here knows pay dates, so every month below is the ex-dividend month.
//
// Everything is an estimate from past payments: a company can cut, skip or raise at any time.

const DAY = 86400;
const YEAR = 365 * DAY;

export const median = (a) => {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// a number for a calendar month: months since year 0, in UTC
export const monthKey = (sec) => {
  const d = new Date(sec * 1000);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
};

// n consecutive month keys, starting at the month of `fromSec`
export const monthKeys = (fromSec, n) => {
  const k0 = monthKey(fromSec);
  return Array.from({ length: n }, (_, i) => k0 + i);
};

export const monthLabel = (k) => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][((k % 12) + 12) % 12];

// Usual payments per year from the typical gap between payments (1, 2, 4 or 12).
function perYear(gapDays) {
  if (!gapDays) return null;
  const f = 365 / gapDays;
  return [1, 2, 4, 12].reduce((best, c) => (Math.abs(c - f) < Math.abs(best - f) ? c : best));
}

/**
 * What one stock's dividend record says.
 *   state  'none'   never paid
 *          'late'   the next payment is overdue (skipped, or the company stopped)
 *          'cut'    the latest regular payment is at least 5% below the one before
 *          'raised' ... at least 5% above
 *          'steady' otherwise
 *   latest, prev   the two newest regular payments ({date, amount})
 *   change         latest / prev − 1
 *   gapDays, freq  typical spacing and payments per year
 *   sinceDays      days since the latest payment
 *   trailing       regular payments in the last 12 months, per share
 *   forward        latest amount × payments per year, per share (what a year would pay at today's rate)
 *   special        one-off payments that were left out of the rate (an amount far above the usual)
 *   past, future   [{mk, date, amount}]: payments of the last 12 months, and the same dates one year on
 */
export function analyse(divs, nowSec) {
  const all = (divs || [])
    .filter((x) => x && x.amount > 0 && Number.isFinite(x.date) && x.date <= nowSec)
    .sort((a, b) => b.date - a.date);
  if (!all.length) return { state: 'none', past: [], future: [], special: [] };
  // an amount far above the recent typical one is a one-off, not a raise
  const med = all.length >= 4 ? median(all.slice(0, 8).map((x) => x.amount)) : null;
  const isSpecial = (x) => med != null && x.amount > 1.8 * med;
  const regular = all.filter((x) => !isSpecial(x));
  const special = all.filter(isSpecial);
  const latest = regular[0] || all[0];
  const prev = regular[1] || null;
  const gaps = [];
  for (let i = 0; i < Math.min(regular.length - 1, 6); i++) gaps.push((regular[i].date - regular[i + 1].date) / DAY);
  const gapDays = median(gaps);
  const freq = perYear(gapDays);
  const sinceDays = (nowSec - latest.date) / DAY;
  const change = prev ? latest.amount / prev.amount - 1 : null;
  let state = 'steady';
  if (gapDays && sinceDays > 1.5 * gapDays + 21) state = 'late';
  else if (change != null && change <= -0.05) state = 'cut';
  else if (change != null && change >= 0.05) state = 'raised';
  // the 12 calendar months ending with this one, then the 12 after it
  const k0 = monthKey(nowSec) - 11;
  const last12 = regular.filter((x) => monthKey(x.date) >= k0);
  const past = all.filter((x) => monthKey(x.date) >= k0).map((x) => ({ mk: monthKey(x.date), date: x.date, amount: x.amount, special: isSpecial(x) }));
  // next 12 months: every regular payment of the last 12 comes round again a year later, at the latest amount
  const future = state === 'late' ? [] : last12.map((x) => ({ mk: monthKey(x.date) + 12, date: x.date + YEAR, amount: latest.amount }));
  return {
    state, latest, prev, change, gapDays, freq, sinceDays,
    trailing: last12.reduce((a, x) => a + x.amount, 0),
    forward: freq ? latest.amount * freq : null,
    special, past, future,
  };
}

/** amounts per month key (per share), summed */
export function byMonth(items, mks) {
  const m = new Map(mks.map((k) => [k, 0]));
  for (const x of items) if (m.has(x.mk)) m.set(x.mk, m.get(x.mk) + x.amount);
  return mks.map((k) => m.get(k));
}

/**
 * Put a basket together.
 *   rows  [{ key, qty, fx (to USD, dividend currency), px (to USD, price), last, cost?, a: analyse(...) }]
 *   returns per-position and total income for the last 12 months and the coming 12, in USD
 */
export function income(rows, nowSec) {
  const k = monthKey(nowSec);
  const past = Array.from({ length: 12 }, (_, i) => k - 11 + i); // the 12 months ending with this one
  const next = Array.from({ length: 12 }, (_, i) => k + 1 + i); // the 12 after it
  const out = rows.map((r) => {
    const q = r.qty * r.fx;
    const pastM = byMonth(r.a.past, past).map((v) => v * q);
    const nextM = byMonth(r.a.future, next).map((v) => v * q);
    const value = r.qty * r.last * r.px;
    const annual = nextM.reduce((a, b) => a + b, 0);
    return {
      ...r, pastM, nextM, value,
      pastTotal: pastM.reduce((a, b) => a + b, 0),
      annual,
      yld: value > 0 ? annual / value : null,
      yoc: r.cost > 0 ? annual / (r.qty * r.cost * r.px) : null,
    };
  });
  const sum = (f) => out.reduce((a, r) => a + f(r), 0);
  return {
    rows: out, past, next,
    pastM: past.map((_, i) => sum((r) => r.pastM[i])),
    nextM: next.map((_, i) => sum((r) => r.nextM[i])),
    pastTotal: sum((r) => r.pastTotal),
    annual: sum((r) => r.annual),
    value: sum((r) => r.value),
  };
}

/** plain-English warnings, worst first */
export function alerts(rows) {
  const out = [];
  for (const r of rows) {
    const a = r.a;
    if (a.state === 'cut') out.push({ level: 'warn', rank: 0, key: r.key, text: `${r.key} cut its dividend: the latest payment is ${Math.abs(a.change * 100).toFixed(0)}% below the one before. Cuts often come with bad news about earnings.` });
    else if (a.state === 'late') out.push({ level: 'warn', rank: 0, key: r.key, text: `${r.key} has not paid for ${Math.round(a.sinceDays)} days, although it usually pays about every ${Math.round(a.gapDays)}. It may have skipped or stopped the dividend, or the data may be late. Check its news.` });
    else if (a.state === 'raised') out.push({ level: 'info', rank: 2, key: r.key, text: `${r.key} raised its dividend by ${(a.change * 100).toFixed(0)}% with its latest payment.` });
    else if (a.state === 'none') out.push({ level: 'info', rank: 3, key: r.key, text: `${r.key} has no dividend on record, so it adds nothing to the income.` });
    if (a.special?.length) out.push({ level: 'info', rank: 4, key: r.key, text: `${r.key} also paid ${a.special.length === 1 ? 'a one-off payment' : `${a.special.length} one-off payments`} that is left out of the yearly estimate.` });
  }
  const top = rows.filter((r) => r.annual > 0).sort((x, y) => y.annual - x.annual)[0];
  const sumAnnual = rows.reduce((s, r) => s + (r.annual || 0), 0);
  if (top && rows.length > 1 && sumAnnual > 0 && top.annual / sumAnnual >= 0.5) out.push({ level: 'warn', rank: 1, key: top.key, text: `${top.key} supplies ${((top.annual / sumAnnual) * 100).toFixed(0)}% of the expected income: one cut there would hurt a lot.` });
  return out.sort((a, b) => a.rank - b.rank);
}
