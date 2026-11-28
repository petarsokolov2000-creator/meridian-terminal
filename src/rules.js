// FIND's brain: turns rules typed in plain English into checkable rules, and works out the
// company-filing figures (margins, growth, debt, returns) the rules can ask about.
//
//   "profitable, debt under 2x EBITDA, below fair price, above 200-day average"
//
// Nothing is guessed. Every phrase Meridian understands is listed in PHRASES / METRICS below and is
// shown back to you as the exact test it will run ("Net debt / EBITDA < 2"). A part it can't read is
// reported as not understood and is NOT applied: it never silently drops out.
//
// No DOM and no imports here, so it can be tested on its own.

const fin = (v) => typeof v === 'number' && Number.isFinite(v);

// ---- what a rule can be about ----------------------------------------------------------------
// kind 'q': a figure Meridian already holds from prices (field = the BQL field name)
// kind 'f': a figure worked out from the company's filings (loaded per company, a few at a time)
// kind 'fair': the fair price estimate (needs the filings too)
// words: how you might say it; longest phrases are tried first.
export const METRICS = {
  pe: { kind: 'q', field: 'pe', label: 'P/E', unit: '×', words: ['price to earnings', 'price/earnings', 'p/e', 'pe ratio', 'pe'] },
  cap: { kind: 'q', field: 'cap', label: 'Market cap', unit: 'B', words: ['market capitalization', 'market capitalisation', 'market cap', 'marketcap', 'cap'] },
  yld: { kind: 'q', field: 'yld', label: 'Dividend yield', unit: '%', words: ['dividend yield', 'dividends yield', 'yield'] },
  beta: { kind: 'q', field: 'beta', label: 'Beta', unit: '', words: ['beta'] },
  vol: { kind: 'q', field: 'vol', label: 'Volatility', unit: '%', words: ['volatility', 'vol'] },
  rsi: { kind: 'q', field: 'rsi', label: 'RSI', unit: '', words: ['rsi'] },
  ret1m: { kind: 'q', field: 'ret1m', label: '1-month return', unit: '%', words: ['1 month return', '1-month return', 'one month return', 'monthly return', 'month return'] },
  ret3m: { kind: 'q', field: 'ret3m', label: '3-month return', unit: '%', words: ['3 month return', '3-month return', 'three month return', 'quarter return', 'quarterly return'] },
  ret6m: { kind: 'q', field: 'ret6m', label: '6-month return', unit: '%', words: ['6 month return', '6-month return', 'six month return', 'half year return'] },
  ret1y: { kind: 'q', field: 'ret1y', label: '1-year return', unit: '%', words: ['1 year return', '1-year return', 'one year return', 'yearly return', '1y return', 'year return', 'annual return', 'return'] },
  vs50: { kind: 'q', field: 'vs50', label: 'vs 50-day average', unit: '%', words: [] },
  vs200: { kind: 'q', field: 'vs200', label: 'vs 200-day average', unit: '%', words: [] },
  offhigh: { kind: 'q', field: 'offhigh', label: 'Off 52-week high', unit: '%', words: [] },
  eps: { kind: 'q', field: 'eps', label: 'EPS (earnings per share)', unit: '', words: ['earnings per share', 'eps'] },
  netMargin: { kind: 'f', label: 'Net margin', unit: '%', words: ['net profit margin', 'net margin', 'profit margin'] },
  opMargin: { kind: 'f', label: 'Operating margin', unit: '%', words: ['operating profit margin', 'operating margin', 'op margin'] },
  grossMargin: { kind: 'f', label: 'Gross margin', unit: '%', words: ['gross profit margin', 'gross margin'] },
  fcfMargin: { kind: 'f', label: 'Free cash flow margin', unit: '%', words: ['free cash flow margin', 'fcf margin'] },
  revGrowth: { kind: 'f', label: 'Revenue growth (last fiscal year)', unit: '%', words: ['revenue growth', 'sales growth', 'growth in revenue', 'growth in sales', 'revenue grew', 'sales grew', 'growth'] },
  epsGrowth: { kind: 'f', label: 'EPS growth (last fiscal year)', unit: '%', words: ['earnings growth', 'eps growth', 'profit growth', 'growth in earnings'] },
  roe: { kind: 'f', label: 'Return on equity', unit: '%', words: ['return on equity', 'roe'] },
  debtEbitda: { kind: 'f', label: 'Net debt / EBITDA', unit: '×', words: ['net debt to ebitda', 'net debt/ebitda', 'debt to ebitda', 'debt/ebitda', 'leverage'] },
  evEbitda: { kind: 'f', label: 'EV/EBITDA', unit: '×', words: ['enterprise value to ebitda', 'ev to ebitda', 'ev/ebitda', 'ev ebitda'] },
  pfcf: { kind: 'f', label: 'P/FCF', unit: '×', words: ['price to free cash flow', 'price/free cash flow', 'p/fcf', 'p/cf'] },
  fcfYield: { kind: 'f', label: 'FCF yield', unit: '%', words: ['free cash flow yield', 'fcf yield'] },
  pb: { kind: 'f', label: 'P/B', unit: '×', words: ['price to book', 'price/book', 'p/b'] },
  ps: { kind: 'f', label: 'P/S', unit: '×', words: ['price to sales', 'price/sales', 'p/s'] },
  netCash: { kind: 'f', label: 'Net cash (cash − debt)', unit: 'B', words: [] },
  fcfNow: { kind: 'f', label: 'Free cash flow', unit: 'B', words: ['free cash flow', 'fcf'] },
  minProfit: { kind: 'f', label: 'Worst year\'s net income', unit: 'B', words: [] },
  discount: { kind: 'fair', label: 'Discount to fair price', unit: '%', words: [] },
  upside: { kind: 'fair', label: 'Upside to fair price', unit: '%', words: ['upside to fair price', 'upside'] },
};

// ---- figures from the company filings (valuation payload) -------------------------------------
/** Filing-based figures for one company, from the /api/valuation payload. Missing inputs give null (never a guess). */
export function metricsOf(v) {
  const f = v?.now?.fields || {};
  const cur = v?.current || {};
  const g = (k) => (fin(f[k]?.val) ? f[k].val : null);
  const ys = v?.years || [];
  const last = ys.at(-1);
  const prev = ys.at(-2);
  const pct = (a, b) => (fin(a) && fin(b) && b > 0 ? (a / b) * 100 : null);
  const revenue = g('revenue');
  const ni = g('netIncome');
  const ebitda = g('ebitda');
  const netDebt = g('netDebt');
  const equity = g('commonEquity');
  const consecutive = last && prev && Number(last.fy) - Number(prev.fy) === 1;
  const sameCcy = !v?.currencyMismatch;
  const growth = (k) => (consecutive && fin(last[k]) && fin(prev[k]) && prev[k] > 0 && last[k] > 0 ? (last[k] / prev[k] - 1) * 100 : null);
  const niYears = ys.map((y) => y.netIncome).filter(fin);
  return {
    netMargin: pct(ni, revenue),
    opMargin: pct(g('opIncome'), revenue),
    grossMargin: last ? pct(last.grossProfit, last.revenue) : null,
    fcfMargin: fin(g('fcf')) ? pct(g('fcf'), revenue) : null,
    revGrowth: growth('revenue'),
    epsGrowth: growth('epsDil'),
    roe: fin(ni) && fin(equity) && equity > 0 ? (ni / equity) * 100 : null,
    debtEbitda: fin(netDebt) && fin(ebitda) && ebitda > 0 ? netDebt / ebitda : null,
    evEbitda: fin(cur.evEbitda) && sameCcy ? cur.evEbitda : null,
    pfcf: fin(cur.pfcf) && sameCcy ? cur.pfcf : null,
    fcfYield: fin(cur.fcfYield) && sameCcy ? cur.fcfYield * 100 : null,
    pb: fin(cur.pb) && sameCcy ? cur.pb : null,
    ps: fin(cur.ps) && sameCcy ? cur.ps : null,
    netCash: fin(netDebt) ? -netDebt / 1e9 : null,
    fcfNow: fin(g('fcf')) ? g('fcf') / 1e9 : null,
    // needs at least 3 reported years, otherwise "profitable every year" would rest on too little
    minProfit: niYears.length >= 3 ? Math.min(...niYears) / 1e9 : null,
    financial: !!v?.financial,
  };
}

// ---- reading the sentence --------------------------------------------------------------------
const NUM = '(-?\\d+(?:[.,]\\d+)?)';
const UNIT = '(?:\\s*(x|times|×|%|percent|pct|t|tn|trillion|b|bn|billion|m|mn|million))?';
const LT = '(?:under|below|less than|lower than|smaller than|beneath|at most|no more than|max(?:imum)?|up to|<=|<)';
const GT = '(?:over|above|more than|greater than|higher than|bigger than|at least|no less than|min(?:imum)?|>=|>|\\+)';
const rxLT2 = new RegExp(`${LT}\\s*${NUM}${UNIT}`, 'i');
const rxGT2 = new RegExp(`${GT}\\s*${NUM}${UNIT}`, 'i');
const rxBetween = new RegExp(`between\\s*${NUM}${UNIT}\\s*(?:and|to|&|-)\\s*${NUM}${UNIT}`, 'i');
const rxTail = new RegExp(`${NUM}${UNIT}\\s*(?:or|and)\\s*(more|higher|above|over|less|lower|below|under)`, 'i');

const toNum = (s) => Number(String(s).replace(',', '.'));
/** A number with its unit, in the metric's own unit (cap in billions, margins in %...). */
function scaled(n, unit, metric) {
  const u = (unit || '').toLowerCase();
  const m = METRICS[metric];
  if (m.unit === 'B' || metric === 'cap') {
    if (/^(t|tn|trillion)$/.test(u)) return n * 1000;
    if (/^(m|mn|million)$/.test(u)) return n / 1000;
    return n;
  }
  return n;
}

// whole-phrase rules: [regex on the cleaned clause, rule(s)]
const rule = (metric, op, a, b, label) => ({ metric, op, a, b, label });
const FLAGS = [
  [/^(profitable|making (a )?profit|has earnings|positive earnings|earning money|positive eps)$/, () => [rule('eps', '>', 0, null, 'Profitable (EPS > 0)')]],
  [/^(profitable every year|always profitable|consistently profitable|profitable (in )?(each|all) years?|never lost money|no (loss|losses))$/, () => [rule('minProfit', '>', 0, null, 'Profitable in every reported year')]],
  [/^(debt[- ]?free|no debt|zero debt|net cash|more cash than debt|cash exceeds debt)$/, () => [rule('netCash', '>', 0, null, 'Net cash (cash > debt)')]],
  [/^(low debt|little debt|not much debt|small debt|conservative(ly)? financed|healthy balance sheet|strong balance sheet)$/, () => [rule('debtEbitda', '<', 2, null, 'Net debt / EBITDA < 2')]],
  [/^(positive (free )?cash ?flow|(free )?cash ?flow positive|generates cash|cash generative|positive fcf)$/, () => [rule('fcfMargin', '>', 0, null, 'Free cash flow margin > 0')]],
  [/^(growing|growing revenue|revenue growing|growing sales|sales growing|revenue growth|growth|grows|revenue is growing)$/, () => [rule('revGrowth', '>', 0, null, 'Revenue growth (last fiscal year) > 0')]],
  [/^(fast[- ]growing|high growth|growing fast|strong growth|high revenue growth)$/, () => [rule('revGrowth', '>', 15, null, 'Revenue growth (last fiscal year) > 15%')]],
  [/^(undervalued|cheap vs? (its )?(fair|intrinsic) (price|value)|(below|under|beneath) (its |the |our )?(fair|intrinsic)( price| value| valuation)?|trading below (its )?(fair|intrinsic)( price| value)?|price below (fair|intrinsic)( price| value)?)$/, () => [rule('discount', '>', 0, null, 'Price below fair price')]],
  [/^(overvalued|(above|over) (its |the |our )?(fair|intrinsic)( price| value| valuation)?)$/, () => [rule('discount', '<', 0, null, 'Price above fair price')]],
  [/^(oversold)$/, () => [rule('rsi', '<', 30, null, 'RSI < 30 (oversold)')]],
  [/^(overbought)$/, () => [rule('rsi', '>', 70, null, 'RSI > 70 (overbought)')]],
  [/^(pays (a )?dividends?|dividend payer|pays out dividends?|has (a )?dividends?|with dividends?)$/, () => [rule('yld', '>', 0, null, 'Pays a dividend')]],
  [/^(uptrend|in an uptrend|trending up|rising trend)$/, () => [rule('vs50', '>', 0, null, 'Above its 50-day average'), rule('vs200', '>', 0, null, 'Above its 200-day average')]],
  [/^(downtrend|in a downtrend|trending down)$/, () => [rule('vs50', '<', 0, null, 'Below its 50-day average'), rule('vs200', '<', 0, null, 'Below its 200-day average')]],
  [/^((near|close to|at) (its |the )?(52[- ]?week|yearly|1[- ]?year|annual) high|near highs|near (its )?high)$/, () => [rule('offhigh', '>', -10, null, 'Within 10% of its 52-week high')]],
  [/^(low beta|defensive|calm)$/, () => [rule('beta', '<', 1, null, 'Beta < 1')]],
  [/^(low volatility|stable|steady|not volatile)$/, () => [rule('vol', '<', 25, null, 'Volatility < 25%')]],
  [/^(mega[- ]?caps?|huge)$/, () => [rule('cap', '>', 200, null, 'Market cap > 200 B')]],
  [/^(large[- ]?caps?|big|large)$/, () => [rule('cap', '>', 10, null, 'Market cap > 10 B')]],
  [/^(mid[- ]?caps?)$/, () => [rule('cap', 'between', 2, 10, 'Market cap 2–10 B')]],
  [/^(small[- ]?caps?|small)$/, () => [rule('cap', '<', 2, null, 'Market cap < 2 B')]],
];
const flagMatch = (c) => { for (const [rx, mk] of FLAGS) if (rx.test(c)) return mk(); return null; };

/** Metric named in a clause: the longest matching phrase wins. */
function findMetric(c) {
  let best = null;
  for (const [key, m] of Object.entries(METRICS)) {
    for (const w of m.words) {
      const rx = new RegExp(`(^|[^a-z0-9/])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}(?![a-z0-9])`, 'i');
      if (rx.test(c) && (!best || w.length > best.w.length)) best = { key, w };
    }
  }
  return best?.key || null;
}

const trendMatch = (c) => {
  let m = /(above|over|higher than|beats?|crossed above)\s+(?:its\s+|the\s+)?(50|200)[- ]?(?:day|d)(?:\s+(?:moving\s+)?(?:average|avg|ma|sma|line))?/.exec(c);
  if (m) return [rule(m[2] === '50' ? 'vs50' : 'vs200', '>', 0, null, `Above its ${m[2]}-day average`)];
  m = /(below|under|beneath|lower than)\s+(?:its\s+|the\s+)?(50|200)[- ]?(?:day|d)(?:\s+(?:moving\s+)?(?:average|avg|ma|sma|line))?/.exec(c);
  if (m) return [rule(m[2] === '50' ? 'vs50' : 'vs200', '<', 0, null, `Below its ${m[2]}-day average`)];
  m = /within\s*(\d+(?:[.,]\d+)?)\s*%?\s*of\s+(?:its\s+|the\s+)?(?:52[- ]?week|yearly|1[- ]?year|annual)?\s*high/.exec(c);
  if (m) return [rule('offhigh', '>', -toNum(m[1]), null, `Within ${toNum(m[1])}% of its 52-week high`)];
  m = /(\d+(?:[.,]\d+)?)\s*%\s*(?:or more\s+)?(?:below|under|beneath|off)\s+(?:its\s+|the\s+|our\s+)?(?:fair|intrinsic)(?:\s+(?:price|value|valuation))?/.exec(c)
    || /(?:below|under|beneath)\s+(?:its\s+|the\s+|our\s+)?(?:fair|intrinsic)(?:\s+(?:price|value|valuation))?\s+by\s+(?:at least\s+|more than\s+|over\s+)?(\d+(?:[.,]\d+)?)\s*%?/.exec(c);
  if (m) return [rule('discount', '>', toNum(m[1]), null, `Price at least ${toNum(m[1])}% below fair price`)];
  return null;
};

function numeric(c) {
  // "debt under 2x ebitda", "net debt below 3 times earnings"
  let m = new RegExp(`(?:net\\s+)?debt[^,]*?${LT}\\s*${NUM}\\s*(?:x|times|×)?\\s*(?:of\\s+)?(?:its\\s+)?(?:ebitda|earnings)`, 'i').exec(c)
    || new RegExp(`${LT}\\s*${NUM}\\s*(?:x|times|×)?\\s*(?:of\\s+)?(?:its\\s+)?ebitda[^,]*?debt`, 'i').exec(c);
  if (m) return [rule('debtEbitda', '<', toNum(m[1]), null, `Net debt / EBITDA < ${toNum(m[1])}`)];
  m = new RegExp(`(?:net\\s+)?debt[^,]*?${GT}\\s*${NUM}\\s*(?:x|times|×)?\\s*(?:of\\s+)?(?:its\\s+)?(?:ebitda|earnings)`, 'i').exec(c);
  if (m) return [rule('debtEbitda', '>', toNum(m[1]), null, `Net debt / EBITDA > ${toNum(m[1])}`)];
  const key = findMetric(c);
  if (!key) return null;
  const mt = METRICS[key];
  let b = rxBetween.exec(c);
  if (b) {
    const lo = scaled(toNum(b[1]), b[2] || b[4], key);
    const hi = scaled(toNum(b[3]), b[4] || b[2], key);
    const [x, y] = lo <= hi ? [lo, hi] : [hi, lo];
    return [rule(key, 'between', x, y, `${mt.label} ${x}–${y}${suffix(mt)}`)];
  }
  b = rxLT2.exec(c);
  if (b) { const n = scaled(toNum(b[1]), b[2], key); return [rule(key, '<', n, null, `${mt.label} < ${n}${suffix(mt)}`)]; }
  b = rxGT2.exec(c);
  if (b) { const n = scaled(toNum(b[1]), b[2], key); return [rule(key, '>', n, null, `${mt.label} > ${n}${suffix(mt)}`)]; }
  b = rxTail.exec(c);
  if (b) {
    const n = scaled(toNum(b[1]), b[2], key);
    const up = /more|higher|above|over/.test(b[3]);
    return [rule(key, up ? '>' : '<', n, null, `${mt.label} ${up ? '>' : '<'} ${n}${suffix(mt)}`)];
  }
  return null;
}
const suffix = (m) => (m.unit === '%' ? '%' : m.unit === 'B' ? ' B' : '');

const FILLER = /^(and |also |plus |but |with |that |which |who |whose |where |stocks that |companies that |stocks with |companies with |stocks |companies |show me |find me |find |give me |i want |i need |only |it |is |are |has |have |being |be |a |an |the |its |their |should |must |needs? to |to )+/i;

// universe words
const REGIONS = [[/^(?:in\s+|from\s+|only\s+)?(?:the\s+)?(us|usa|u\.s\.|united states|american|america)(?:\s+(?:stocks|companies|only))?$/, 'US'],
  [/^(?:in\s+|from\s+|only\s+)?(?:the\s+)?(eu|europe|european)(?:\s+(?:stocks|companies|only))?$/, 'EU'],
  [/^(?:in\s+|from\s+|only\s+)?(?:the\s+)?(asia|asian|japan|japanese|china|chinese)(?:\s+(?:stocks|companies|only))?$/, 'ASIA']];

/**
 * Read the typed rules.
 * @param {string} text
 * @param {{sectors?: string[]}} [opts] sector names to recognise ("tech", "health"…)
 * @returns {{rules: object[], region: string|null, sectors: string[], unknown: string[]}}
 */
export function parseRules(text, { sectors = [] } = {}) {
  const rules = [];
  const unknown = [];
  let region = null;
  const sectorPicks = [];
  // "between 10 and 20" must survive the split on "and"
  const protect = String(text || '').replace(/between\s*(-?\d[\d.,]*\s*\w*)\s*(?:and|to)\s*(-?\d[\d.,]*)/gi, (_, a, b2) => `between ${a} to ${b2}`);
  const clauses = protect.split(/[,;\n]+|\s+(?:and|plus|&|but also|also)\s+|\s+\+\s+/i).map((s) => s.trim()).filter(Boolean);
  for (const raw of clauses) {
    let c = raw.toLowerCase().replace(/[.!?]+$/g, '').replace(/\s+/g, ' ').trim();
    if (!c) continue;
    let prev;
    do { prev = c; c = c.replace(FILLER, '').trim(); } while (c !== prev && c);
    c = c.replace(/^(?:stocks|companies)$/, '').trim();
    if (!c) continue;
    // "US stocks that are profitable": the where-part comes off first, the rest is read as a rule
    const lead = /^(?:in\s+|from\s+|only\s+)?(?:the\s+)?(us|usa|united states|american|europe|european|eu|asia|asian)(?:\s+(?:stocks|companies))?\s+(?:that\s+|which\s+|with\s+|who\s+)?(?:are\s+|is\s+)?(.+)$/.exec(c);
    if (lead && !REGIONS.some(([rx]) => rx.test(c))) { region = /^(us|usa|united states|american)$/.test(lead[1]) ? 'US' : /^(europe|european|eu)$/.test(lead[1]) ? 'EU' : 'ASIA'; c = lead[2]; }
    const reg = REGIONS.find(([rx]) => rx.test(c));
    if (reg) { region = reg[1]; continue; }
    const secWord = c.replace(/^(?:in\s+|from\s+|only\s+)?(?:the\s+)?/, '').replace(/\s+(?:stocks|companies|sector|industry|firms)$/, '').trim();
    const sec = secWord.length >= 4 ? sectors.find((s) => norm(s) === norm(secWord) || norm(s).startsWith(norm(secWord)) || (secWord === 'tech' && /tech/i.test(s)) || (secWord === 'health' && /health/i.test(s)) || (secWord === 'finance' && /financ/i.test(s)) || (secWord === 'banks' && /financ/i.test(s))) : null;
    if (sec) { sectorPicks.push(sec); continue; }
    if (secWord === 'tech') { const t = sectors.find((s) => /tech/i.test(s)); if (t) { sectorPicks.push(t); continue; } }
    const got = flagMatch(c) || trendMatch(c) || numeric(c);
    if (got) { for (const r of got) if (!rules.some((x) => x.label === r.label)) rules.push(r); } else unknown.push(raw.trim());
  }
  return { rules, region, sectors: [...new Set(sectorPicks)], unknown };
}
const norm = (s) => String(s).toLowerCase().replace(/[^a-z]/g, '');

// ---- checking a rule ---------------------------------------------------------------------------
/** true / false for a value against a rule; null when there is no value. */
export function check(r, val) {
  if (!fin(val)) return null;
  if (r.op === '<') return val < r.a;
  if (r.op === '>') return val > r.a;
  return val >= r.a && val <= r.b;
}

/** Display a value the way the rule is phrased. */
export function show(metric, v) {
  if (!fin(v)) return null;
  const m = METRICS[metric];
  const a = Math.abs(v);
  const s = a >= 1000 ? v.toFixed(0) : a >= 100 ? v.toFixed(1) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
  return `${s}${m.unit === '%' ? '%' : m.unit === '×' ? '×' : m.unit === 'B' ? ' B' : ''}`;
}

export const EXAMPLES = [
  ['Quality at a fair price', 'profitable, debt under 2x EBITDA, below fair price, above 200-day average'],
  ['Cash machines', 'net margin over 15%, positive free cash flow, ROE above 15%, revenue growth above 5%, debt under 1.5x EBITDA'],
  ['Cheap and healthy', 'profitable every year, P/E under 20, EV/EBITDA under 12, FCF yield over 5%, low debt'],
  ['Dividend payers', 'dividend yield over 2.5%, profitable every year, net debt/EBITDA under 3, large cap'],
  ['Beaten down, still sound', 'US stocks, oversold, profitable, below fair price, debt under 2x EBITDA'],
  ['Strong trend', 'uptrend, within 5% of 52-week high, revenue growth above 10%, profitable'],
];

/** What can be said, for the help box. */
export const VOCAB = [
  ['Quality & health', 'profitable · profitable every year · net margin over 15% · operating margin · gross margin · FCF margin · ROE over 15% · revenue growth over 10% · EPS growth · growing · fast growing · positive free cash flow'],
  ['Debt', 'debt under 2x EBITDA · net debt/EBITDA under 3 · low debt · debt free / net cash'],
  ['Valuation', 'P/E under 20 · EV/EBITDA under 12 · P/FCF under 20 · FCF yield over 5% · P/B under 3 · P/S under 5 · dividend yield over 3% · below fair price · 20% below fair price · upside over 30%'],
  ['Price & trend', 'above 200-day average · above 50-day average · uptrend · within 10% of 52-week high · oversold · overbought · RSI under 40 · 1 year return over 20% · low beta · low volatility'],
  ['Size & where', 'large cap · mid cap · small cap · market cap over 50 billion · US / Europe / Asia · a sector (technology, health care…)'],
];
