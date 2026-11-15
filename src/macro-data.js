// MACRO: one plain sentence per economic indicator on what it usually means for stocks, plus a reading of the
// yield curve. Pure functions, no screen code.
//
// These are RULES OF THUMB, not forecasts: the thresholds are round numbers that economists commonly quote
// (a 2% inflation goal, unemployment under 4.5% being "low", ...). They describe where an indicator stands,
// and the usual way markets have reacted to that. Markets often react to a surprise against expectations,
// which FRED does not carry. Tone: 'good' supportive for stocks, 'bad' worrying, 'mid' mixed.

const fx = (x, dp = 1) => (Math.abs(x) >= 100 ? Math.round(x).toLocaleString('en-US') : x.toFixed(dp));

// words for how far it moved since the reading before
const trend = (d, eps, up = 'up', down = 'down') => (d == null || Math.abs(d) < eps ? '' : d > 0 ? up : down);

/**
 * The yield curve from [{tenor, years, y, prev, wk, mo}] (US).
 * spread = long minus short, in percentage points. Negative = inverted.
 */
export function curveReading(pts) {
  const by = (t) => pts.find((p) => p.tenor === t);
  const t3m = by('3M');
  const t2 = by('2Y');
  const t10 = by('10Y');
  if (!t10 || !(t2 || t3m)) return { error: 'The curve needs at least the 10-year and the 2-year or 3-month yield.' };
  const sp = (a) => (a ? { now: t10.y - a.y, mo: t10.mo - a.mo, wk: t10.wk - a.wk } : null);
  const s210 = sp(t2);
  const s103 = sp(t3m);
  const main = s210 || s103;
  const name = s210 ? '10-year minus 2-year' : '10-year minus 3-month';
  let state;
  let tone;
  let text;
  if (main.now < 0) {
    state = 'inverted';
    tone = 'bad';
    text = 'Short-term rates are higher than long-term rates (an inverted curve). Before most US recessions the curve has been inverted, usually 6 to 18 months earlier, but the timing is loose and it has given false alarms. For stocks it is a caution flag, not a sell signal.';
  } else if (main.now < 0.5) {
    state = 'flat';
    tone = 'mid';
    text = 'Long-term rates are barely above short-term rates (a flat curve). Banks earn little from lending, and the market is unsure about growth. Stocks usually manage, but it is a less friendly backdrop than a normal curve.';
  } else {
    state = 'normal';
    tone = 'good';
    text = 'Long-term rates are clearly above short-term rates (a normal curve). That usually goes with an economy the bond market expects to keep growing, which is a supportive backdrop for stocks.';
  }
  if (s103 && s103.now < 0 && main.now >= 0) {
    text += ' But the 3-month yield is above the 10-year (inverted), the gap the New York Fed uses for recession odds, so treat it as a caution.';
    if (tone === 'good') tone = 'mid';
  }
  const moved = main.now - main.mo; // the gap now minus the gap a month ago
  const note = Math.abs(moved) >= 0.15 ? ` Over the last month the gap ${moved > 0 ? 'widened' : 'narrowed'} by ${Math.abs(moved).toFixed(2)} points.` : '';
  return { name, state, tone, text: text + note, s210, s103, main };
}

const INFL = (label) => (a, d) => {
  const t = trend(d, 0.1, `Up from ${fx(a - d, 1)}% last time.`, `Down from ${fx(a - d, 1)}% last time.`);
  if (a < 1) return { tone: 'mid', text: `${label} is well below the Fed's 2% goal. That leaves room for rate cuts (good for stocks), but inflation this low can also mean weak demand, which hurts company sales. ${t}` };
  if (a <= 2.3) return { tone: 'good', text: `${label} is close to the Fed's 2% goal. That lets the Fed hold rates steady or cut them, which usually helps stocks. ${t}` };
  if (a <= 3.2) return { tone: 'mid', text: `${label} is above the Fed's 2% goal. The Fed stays cautious about cutting rates, which can cap how much stocks rise. ${t}` };
  return { tone: 'bad', text: `${label} is well above the Fed's 2% goal. Hot inflation tends to keep interest rates high, which usually weighs on stocks, growth stocks most. ${t}` };
};

// id -> (actual, change since prior, unit) => { tone, text }
const RULES = {
  CPIAUCSL: INFL('Consumer inflation'),
  CPILFESL: INFL('Core inflation (without food and energy)'),
  PCEPILFE: INFL('Core PCE inflation (the Fed\'s preferred gauge)'),
  CP0000EZ19M086NEST: (a, d) => {
    const t = trend(d, 0.1, ` Up from ${fx(a - d, 1)}% last time.`, ` Down from ${fx(a - d, 1)}% last time.`);
    if (a < 1) return { tone: 'mid', text: `Euro-area inflation is well below the ECB's 2% goal. That leaves room for lower rates, but it can also mean weak demand in Europe.${t}` };
    return a <= 2.3
      ? { tone: 'good', text: `Euro-area inflation is near the ECB's 2% goal, which leaves room for lower rates in Europe and helps European stocks.${t}` }
      : { tone: a <= 3.2 ? 'mid' : 'bad', text: `Euro-area inflation is above the ECB's 2% goal, so European rates stay higher for longer, which weighs on stocks there.${t}` };
  },
  UNRATE: (a, d) => {
    if (d != null && d >= 0.3) return { tone: 'bad', text: `Unemployment jumped by ${d.toFixed(1)} points to ${a.toFixed(1)}%. A quick rise like this has often marked the start of a recession, and stocks tend to fall when it does.` };
    if (a < 4.5) return { tone: 'good', text: `Unemployment is low at ${a.toFixed(1)}%. A strong job market keeps people spending, which supports company profits. The catch: a very tight market can keep inflation and rates up.` };
    if (a < 5.5) return { tone: 'mid', text: `Unemployment is ${a.toFixed(1)}%, in the middle range. The job market is softening, which can ease inflation (good for rates) but also dampens spending.` };
    return { tone: 'bad', text: `Unemployment is high at ${a.toFixed(1)}%. Fewer people earning means less spending and weaker profits, which usually weighs on stocks, though rate cuts can follow.` };
  },
  PAYEMS: (a) => (a >= 150
    ? { tone: 'good', text: `The economy added ${fx(a, 0)}K jobs, a solid month. Growing employment supports spending and profits.` }
    : a >= 50
      ? { tone: 'mid', text: `The economy added ${fx(a, 0)}K jobs, a slow month. Hiring is cooling, which eases inflation worries but also signals slower growth.` }
      : { tone: 'bad', text: a < 0 ? `The economy lost ${fx(-a, 0)}K jobs. Falling employment is a recession warning and usually bad for stocks.` : `Only ${fx(a, 0)}K jobs were added, very weak. That is a warning sign for growth, though bad news can also bring hopes of rate cuts.` }),
  ICSA: (a) => (a < 230
    ? { tone: 'good', text: `Weekly jobless claims are low (${fx(a, 0)}K). Few people are being laid off, a healthy sign for the economy.` }
    : a < 280
      ? { tone: 'mid', text: `Weekly jobless claims are ${fx(a, 0)}K, a normal level. Layoffs are not a problem yet.` }
      : { tone: 'bad', text: `Weekly jobless claims are elevated (${fx(a, 0)}K). Rising layoffs are one of the earliest signs of a weakening economy.` }),
  JTSJOL: (a, d) => ({ tone: d != null && d < -300 ? 'bad' : a >= 7000 ? 'good' : 'mid', text: `Job openings are ${fx(a / 1000, 1)} million${d == null ? '' : d > 0 ? ', more than last time' : ', fewer than last time'}. ${a >= 7000 ? 'Plenty of openings mean employers still want to hire.' : 'Employers are posting fewer jobs, a sign the labor market is cooling.'}` }),
  A191RL1Q225SBEA: (a) => (a < 0
    ? { tone: 'bad', text: `The economy shrank at a ${Math.abs(a).toFixed(1)}% annual pace last quarter. Two shrinking quarters in a row are the usual definition of a recession, and stocks generally suffer.` }
    : a < 1.5
      ? { tone: 'mid', text: `The economy grew at only a ${a.toFixed(1)}% annual pace, slow. Company sales growth is likely to be modest.` }
      : { tone: 'good', text: `The economy grew at a ${a.toFixed(1)}% annual pace, healthy. Growth like this supports company sales and profits.` }),
  RSAFS: (a) => (a < 0
    ? { tone: 'bad', text: `Retail sales fell ${Math.abs(a).toFixed(1)}% in the month. Consumers are about two thirds of the US economy, so falling spending is a worry for retailers and for growth.` }
    : a < 0.4
      ? { tone: 'mid', text: `Retail sales rose a modest ${a.toFixed(1)}%. Consumers are still spending, but not eagerly.` }
      : { tone: 'good', text: `Retail sales rose ${a.toFixed(1)}%, a strong month. Consumers are about two thirds of the US economy, so this supports growth and retail profits.` }),
  INDPRO: (a) => (a < 0
    ? { tone: 'bad', text: `Factory, mining and utility output fell ${Math.abs(a).toFixed(1)}%. Weak production hurts industrial companies and hints at slowing demand.` }
    : { tone: a < 0.3 ? 'mid' : 'good', text: `Industrial output rose ${a.toFixed(1)}%. ${a < 0.3 ? 'Production is about flat.' : 'Rising production supports industrial companies and signals solid demand.'}` }),
  GACDFSA066MSFRBPHI: (a) => (a > 0
    ? { tone: 'good', text: `The Philadelphia Fed survey of factories reads ${fx(a, 1)}: above zero means more factories report growth than decline, a regional hint of healthy manufacturing.` }
    : { tone: 'bad', text: `The Philadelphia Fed survey of factories reads ${fx(a, 1)}: below zero means more factories report decline than growth, a regional warning for manufacturing.` }),
  UMCSENT: (a) => (a >= 80
    ? { tone: 'good', text: `Consumer sentiment is upbeat (${fx(a, 0)}). Confident households tend to spend, which supports retailers and growth.` }
    : a >= 60
      ? { tone: 'mid', text: `Consumer sentiment is subdued (${fx(a, 0)}). Households are cautious, which can restrain spending.` }
      : { tone: 'bad', text: `Consumer sentiment is gloomy (${fx(a, 0)}). Worried households cut back, a risk for retailers, though sentiment is a poor timing tool for stocks.` }),
  HOUST: (a) => (a >= 1400
    ? { tone: 'good', text: `Builders started ${fx(a / 1000, 2)} million homes (annual pace), a healthy level. Housing is a large part of the economy and supports homebuilders and suppliers.` }
    : { tone: a >= 1150 ? 'mid' : 'bad', text: `Builders started ${fx(a / 1000, 2)} million homes (annual pace), ${a >= 1150 ? 'a moderate level' : 'a weak level'}. High mortgage rates are usually the reason, which weighs on homebuilders and suppliers.` }),
  MORTGAGE30US: (a) => (a < 5
    ? { tone: 'good', text: `The 30-year mortgage rate is ${a.toFixed(2)}%, low. Cheap mortgages support home buying and housing-related companies.` }
    : a < 6.5
      ? { tone: 'mid', text: `The 30-year mortgage rate is ${a.toFixed(2)}%, elevated. It makes housing expensive and slows home sales.` }
      : { tone: 'bad', text: `The 30-year mortgage rate is ${a.toFixed(2)}%, high. Expensive mortgages freeze home sales and weigh on homebuilders, banks and consumers.` }),
  FEDFUNDS: (a, d) => ({ tone: d != null && d < -0.05 ? 'good' : d != null && d > 0.05 ? 'bad' : 'mid', text: `The Fed's policy rate averaged ${a.toFixed(2)}%${d == null || Math.abs(d) < 0.05 ? ', unchanged' : d < 0 ? `, down from ${(a - d).toFixed(2)}%` : `, up from ${(a - d).toFixed(2)}%`}. Falling rates usually lift stocks (borrowing gets cheaper and bonds pay less); rising rates usually weigh on them.` }),
  WCESTUS1: (a) => ({ tone: 'mid', text: `US crude oil stocks ${a > 0 ? `rose by ${fx(a / 1000, 1)} million` : `fell by ${fx(-a / 1000, 1)} million`} barrels in the week. Stock builds point to supply beating demand (lower oil prices), draws to the opposite. It matters mostly for energy companies.` }),
};

/** { tone, text } for one FRED row, or null when it has no value */
export function read(row) {
  if (!row || row.error || row.actual == null) return null;
  const d = row.prior == null ? null : row.actual - row.prior;
  const f = RULES[row.id];
  if (f) return f(row.actual, d, row.unit);
  return { tone: 'mid', text: `${row.label}: ${fx(row.actual, 2)}${row.unit || ''}${d == null ? '' : d > 0 ? ' (up)' : ' (down)'}.` };
}

export const TONE_WORD = { good: 'supportive', mid: 'mixed', bad: 'worrying' };

/** how many readings are supportive / mixed / worrying */
export function tally(rows, curve) {
  const t = { good: 0, mid: 0, bad: 0 };
  for (const r of rows || []) {
    const x = read(r);
    if (x) t[x.tone]++;
  }
  if (curve && !curve.error) t[curve.tone]++;
  return t;
}
