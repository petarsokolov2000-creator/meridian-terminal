// Currency conversion for the valuation screens (VAL, DCF, peers, the fair-value column).
//
// A foreign company reports in its own currency (euros, Taiwan dollars, kroner) while its share or ADR price
// is quoted in another (usually US dollars). Dividing one by the other gives nonsense, so the reported
// figures are converted into the price currency first.
//
// Rates come from Yahoo Finance's currency charts (weekly closes back to 2003): either the pair itself, its
// inverse, or two legs through the US dollar. If Yahoo has none, the ECB reference rate of today is used
// (spot only: no history, so the year-end multiples of the past stay n/a rather than being guessed).
//
// Two ways to convert, on purpose:
//  - today's rate for the "now" figures and for the DCF's starting numbers, one rate for every year, so
//    growth rates and margins are exactly those of the original currency (an exchange-rate swing is not
//    mistaken for growth);
//  - the rate of each fiscal year end for the history of multiples, because the price on that day is
//    paired with that year's figures.

// Prices quoted in a minor unit (pence, agorot, cents): { code: [major currency, size of the unit] }
const MINOR = { GBp: ['GBP', 0.01], GBX: ['GBP', 0.01], ILA: ['ILS', 0.01], ZAc: ['ZAR', 0.01], ZAC: ['ZAR', 0.01] };

/** The major currency of a code, and the factor that turns a minor-unit amount into it. */
export function major(code) {
  if (!code) return { ccy: null, scale: 1 };
  const m = MINOR[code];
  return m ? { ccy: m[0], scale: m[1] } : { ccy: String(code).toUpperCase(), scale: 1 };
}

const STALE = 21 * 86400; // a weekly bar older than three weeks before the date means no data for it
const FRESH = 14 * 86400; // the newest bar must be recent, or the pair isn't really trading

const iso = (sec) => new Date(sec * 1000).toISOString().slice(0, 10);

function atFrom(bars, invert) {
  return (date) => {
    const t = Date.parse(date) / 1000 + 86400;
    if (!Number.isFinite(t)) return null;
    let best = null;
    for (const b of bars) {
      if (b.ts > t) break;
      best = b;
    }
    if (!best || t - best.ts >= STALE) return null;
    return invert ? 1 / best.c : best.c;
  };
}

// units of `b` for one unit of `a`
async function leg(getChart, a, b) {
  if (a === b) return { at: () => 1, spot: 1, route: [], asOf: null };
  for (const [sym, inv] of [[`${a}${b}=X`, false], [`${b}${a}=X`, true]]) {
    let ch;
    try {
      ch = await getChart(sym);
    } catch {
      continue;
    }
    const bars = (ch?.bars || []).filter((x) => Number.isFinite(x.c) && x.c > 0 && Number.isFinite(x.ts));
    if (!bars.length) continue;
    const last = bars[bars.length - 1];
    if (Date.now() / 1000 - last.ts > FRESH) continue;
    const px = ch.meta?.price > 0 ? ch.meta.price : last.c;
    return { at: atFrom(bars, inv), spot: inv ? 1 / px : px, route: [sym], asOf: iso(ch.meta?.time > 0 ? ch.meta.time : last.ts) };
  }
  return null;
}

/**
 * The exchange rate from one currency to another, or null when no source has it.
 *   spot    units of `to` for one unit of `from`, today
 *   at(d)   the same on a past date 'YYYY-MM-DD' (null when unknown)
 * getChart(symbol) -> { meta, bars: [{ts, c}] } oldest first; ecb() -> { date, rates: { CCY: per USD } }.
 */
export async function lookupFx({ getChart, ecb = null }, from, to) {
  if (from === to) return { from, to, spot: 1, at: () => 1, route: [], asOf: null, source: 'same currency' };
  const direct = await leg(getChart, from, to);
  if (direct) return { from, to, ...direct, source: 'Yahoo Finance (weekly closes)' };
  if (from !== 'USD' && to !== 'USD') {
    const a = await leg(getChart, from, 'USD');
    const b = a && (await leg(getChart, 'USD', to));
    if (a && b) {
      return {
        from, to, spot: a.spot * b.spot, route: [...a.route, ...b.route], asOf: a.asOf,
        at: (d) => {
          const x = a.at(d);
          const y = b.at(d);
          return x == null || y == null ? null : x * y;
        },
        source: 'Yahoo Finance (weekly closes, through the US dollar)',
      };
    }
  }
  if (ecb) {
    try {
      const fx = await ecb();
      const perUsd = (c) => (c === 'USD' ? 1 : fx?.rates?.[c]);
      const f = perUsd(from);
      const t = perUsd(to);
      if (f > 0 && t > 0) return { from, to, spot: t / f, at: () => null, route: [], asOf: fx.date || null, source: "the ECB's reference rate (today's rate only, no history)" };
    } catch {
      // nothing left to try
    }
  }
  return null;
}

/** A copy of one fiscal year with every money figure multiplied (share counts, dates and notes stay). */
export function scaleYear(y, money, f) {
  const o = { ...y };
  for (const k of money) if (typeof o[k] === 'number') o[k] *= f;
  return o;
}

/** A copy of the trailing-12-month block with every money figure multiplied. */
export function scaleNow(now, money, f) {
  if (!now?.fields) return now;
  const fields = {};
  for (const [k, n] of Object.entries(now.fields)) fields[k] = money.has(k) && n && typeof n.val === 'number' ? { ...n, val: n.val * f } : n;
  return { ...now, fields };
}

/**
 * Is the share count consistent with the price? Compares price × shares with the market value Yahoo quotes.
 * A ratio far from 1 usually means the price is per depositary receipt (1 ADR = 5 shares, say) while the
 * statements count ordinary shares, so every per-share number would be off by that factor.
 */
export function shareCheck(calcCap, quotedCap) {
  if (!(calcCap > 0) || !(quotedCap > 0)) return null;
  const ratio = calcCap / quotedCap;
  const suspect = ratio < 0.8 || ratio > 1.25;
  return {
    ratio, calc: calcCap, quoted: quotedCap, suspect,
    text: suspect
      ? `The share count doesn't fit the share price: price × reported shares comes to ${ratio.toFixed(2)}× the market value Yahoo quotes. That usually means the price is per depositary receipt (ADR) while the statements count ordinary shares (for example 1 ADR = 5 shares), so every per-share figure would be off by about that factor. Don't rely on the per-share values here.`
      : null,
  };
}
