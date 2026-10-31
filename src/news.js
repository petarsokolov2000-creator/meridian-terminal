// Headline and story generation. Headlines are kept short (wire style, <= ~80 chars)
// so they sit on one line in every news list; the body carries the detail.

const SOURCES = ['MTN Wire', 'MTN First Word', 'MTN Markets', 'MTN Intelligence', 'MTN Briefs'];

const fmtPct = (x) => `${Math.abs(x * 100).toFixed(1)}%`;

// Each template returns { h, b } from (rng, company, size) where size > 0 is good news.
const COMPANY_GOOD = [
  (r, c, s) => ({
    h: `${c.name} Q${r.int(1, 4)} EPS Beats Estimates; Revenue Up ${r.int(6, 31)}%`,
    b: `${c.name} reported quarterly earnings ahead of the consensus estimate as ${pickDriver(r, c)} offset higher costs. Management said demand remained firm into the current quarter.`,
  }),
  (r, c) => ({
    h: `${c.name} Raises Full-Year Outlook on ${pickDriver(r, c, true)}`,
    b: `${c.name} lifted its full-year guidance, citing ${pickDriver(r, c)}. The new range sits above the top end of analyst forecasts.`,
  }),
  (r, c) => ({
    h: `${c.sym} Upgraded to Buy at ${pickBroker(r)}; Target Raised`,
    b: `${pickBroker(r)} upgraded ${c.name} to Buy from Hold, arguing the market is underestimating ${pickDriver(r, c)}. The broker raised its price target by ${r.int(10, 35)}%.`,
  }),
  (r, c) => ({
    h: `${c.name} Announces $${r.int(2, 25)}B Share Buyback`,
    b: `The board of ${c.name} authorized a new repurchase program. The company said the buyback reflects confidence in its cash generation.`,
  }),
  (r, c) => ({
    h: `${c.name} Said to Attract Takeover Interest, People Familiar Say`,
    b: `${c.name} has received approaches from at least one strategic buyer, according to people familiar with the matter who asked not to be identified. No decision has been made and talks may not lead to a deal.`,
  }),
  (r, c) => ({
    h: `${c.name} Wins ${pickContract(r, c)} Contract`,
    b: `${c.name} was selected for a multi-year agreement. Terms were not disclosed, though analysts estimate the award could add meaningfully to revenue from next year.`,
  }),
];

const COMPANY_BAD = [
  (r, c) => ({
    h: `${c.name} Misses Profit Estimates as Margins Narrow`,
    b: `${c.name} posted quarterly profit below expectations, hurt by ${pickHeadwind(r, c)}. Gross margin fell ${r.int(40, 260)} basis points from a year earlier.`,
  }),
  (r, c) => ({
    h: `${c.name} Cuts Guidance, Citing ${pickHeadwind(r, c, true)}`,
    b: `${c.name} lowered its outlook for the year, pointing to ${pickHeadwind(r, c)}. Executives said they expect conditions to remain difficult for several quarters.`,
  }),
  (r, c) => ({
    h: `${c.sym} Downgraded to Sell at ${pickBroker(r)}`,
    b: `${pickBroker(r)} cut ${c.name} to Sell, warning that ${pickHeadwind(r, c)} is not reflected in consensus numbers.`,
  }),
  (r, c) => ({
    h: `${c.name} Faces Regulatory Probe Over ${pickProbe(r)}`,
    b: `Regulators have opened an inquiry into ${c.name}. The company said it is cooperating fully and does not expect a material impact.`,
  }),
  (r, c) => ({
    h: `${c.name} CFO to Step Down; Search Under Way`,
    b: `${c.name} said its chief financial officer will leave at the end of the quarter. An interim replacement has been named while the board conducts a search.`,
  }),
  (r, c) => ({
    h: `${c.name} Recalls Products After Quality Review`,
    b: `${c.name} initiated a voluntary recall following an internal review. The company estimated the cost at up to ${r.int(50, 600)} million dollars.`,
  }),
];

const DRIVERS = {
  Technology: ['cloud subscription growth', 'AI software demand', 'enterprise renewals'],
  Semiconductors: ['data-center chip demand', 'advanced-node orders', 'memory pricing'],
  Financials: ['net interest income', 'trading revenue', 'fee growth'],
  'Health Care': ['late-stage trial data', 'new drug launches', 'procedure volumes'],
  Energy: ['higher realized prices', 'production growth', 'refining margins'],
  Industrials: ['backlog strength', 'aftermarket services', 'defense orders'],
  'Consumer Disc.': ['resilient consumer spending', 'pricing power', 'online sales'],
  'Consumer Staples': ['volume recovery', 'pricing gains', 'emerging-market demand'],
  Materials: ['firm metal prices', 'cost cuts', 'specialty volumes'],
  Utilities: ['rate-base growth', 'data-center power demand', 'regulatory approvals'],
  Communication: ['subscriber gains', 'advertising recovery', 'pricing increases'],
  'Real Estate': ['occupancy gains', 'rent growth', 'asset sales'],
};
const HEADWINDS = {
  Technology: ['longer sales cycles', 'weaker IT budgets'],
  Semiconductors: ['an inventory correction', 'export restrictions'],
  Financials: ['higher credit provisions', 'deposit costs'],
  'Health Care': ['a failed trial', 'pricing pressure'],
  Energy: ['lower realized prices', 'maintenance downtime'],
  Industrials: ['supply-chain delays', 'softer orders'],
  'Consumer Disc.': ['weaker discretionary demand', 'heavy discounting'],
  'Consumer Staples': ['input-cost inflation', 'volume declines'],
  Materials: ['falling commodity prices', 'energy costs'],
  Utilities: ['an adverse rate ruling', 'storm costs'],
  Communication: ['subscriber losses', 'advertising softness'],
  'Real Estate': ['rising vacancies', 'refinancing costs'],
};
const BROKERS = ['Halvorsen & Co', 'Kestrel Securities', 'Brightwater Research', 'Larchmont Partners', 'Ostrander Capital'];
const PROBES = ['Pricing Practices', 'Data Handling', 'Accounting Disclosures', 'Safety Reporting'];

function cap(s) {
  return s.replace(/(^|\s)\w/g, (m) => m.toUpperCase());
}
function pickDriver(r, c, title = false) {
  const s = r.pick(DRIVERS[c.sector] || ['strong demand']);
  return title ? cap(s) : s;
}
function pickHeadwind(r, c, title = false) {
  const s = r.pick(HEADWINDS[c.sector] || ['softer demand']);
  return title ? cap(s) : s;
}
function pickBroker(r) {
  return r.pick(BROKERS);
}
function pickProbe(r) {
  return r.pick(PROBES);
}
function pickContract(r, c) {
  const m = { Industrials: 'Defense', Energy: 'LNG Supply', Technology: 'Government Cloud', Semiconductors: 'Foundry' };
  return m[c.sector] || 'Multi-Year Supply';
}

// Templates that only make sense for some sectors.
const PHYSICAL = ['Industrials', 'Energy', 'Technology', 'Semiconductors', 'Materials', 'Utilities', 'Health Care', 'Consumer Disc.', 'Consumer Staples'];
const ONLY = new Map([[COMPANY_GOOD[5], PHYSICAL], [COMPANY_BAD[5], PHYSICAL.filter((s) => !['Utilities', 'Energy'].includes(s))]]);

// `used` holds "SYM:template" keys so a company never gets the same story twice a day.
export function companyStory(r, c, sentiment, used = new Set()) {
  const all = sentiment > 0 ? COMPANY_GOOD : COMPANY_BAD;
  const key = (f) => `${c.sym}:${sentiment > 0 ? 'g' : 'b'}${all.indexOf(f)}`;
  const pool = all.filter((f) => (!ONLY.has(f) || ONLY.get(f).includes(c.sector)) && !used.has(key(f)));
  if (!pool.length) return null;
  const f = r.pick(pool);
  used.add(key(f));
  const t = f(r, c);
  return { headline: t.h, body: t.b, source: r.pick(SOURCES) };
}

const MACRO = [
  (r) => ({ h: 'Fed Officials Signal Patience on Rate Cuts as Inflation Lingers', t: ['US10Y', 'MTUS500'], s: -1, cat: 'Central Banks' }),
  (r) => ({ h: 'ECB Policymakers Keep June Move on the Table', t: ['EURUSD', 'DE10Y'], s: 1, cat: 'Central Banks' }),
  (r) => ({ h: 'Bank of Japan Weighs Faster Bond-Buying Taper', t: ['USDJPY', 'JP10Y'], s: -1, cat: 'Central Banks' }),
  (r) => ({ h: `OPEC+ Delegates Discuss Extending Output Cuts`, t: ['CL1', 'CO1'], s: 1, cat: 'Commodities' }),
  (r) => ({ h: 'Oil Slips as US Crude Stockpiles Unexpectedly Climb', t: ['CL1', 'CO1'], s: -1, cat: 'Commodities' }),
  (r) => ({ h: 'Gold Holds Near Record as Central-Bank Buying Persists', t: ['XAU'], s: 1, cat: 'Commodities' }),
  (r) => ({ h: 'Copper Rallies on Smelter Outages and Grid Spending', t: ['HG1'], s: 1, cat: 'Commodities' }),
  (r) => ({ h: 'Treasury Auction Draws Soft Demand; Yields Edge Higher', t: ['US10Y', 'US30Y'], s: -1, cat: 'Rates' }),
  (r) => ({ h: 'Bitcoin Swings as ETF Flows Turn Negative for Third Day', t: ['XBTUSD'], s: -1, cat: 'Crypto' }),
  (r) => ({ h: 'Yen Weakens Past Key Level; Traders Watch for Intervention', t: ['USDJPY'], s: 1, cat: 'FX' }),
  (r) => ({ h: 'Emerging-Market Currencies Firm as Dollar Retreats', t: ['USDMXN', 'USDBRL'], s: -1, cat: 'FX' }),
  (r) => ({ h: 'Global Stocks Steady With Earnings in Focus', t: ['MTUS500', 'MTEU350'], s: 1, cat: 'Markets' }),
  (r) => ({ h: 'Chip Stocks Lead Asian Markets Higher', t: ['MTKR200', 'MTJP225'], s: 1, cat: 'Markets' }),
  (r) => ({ h: 'European Shares Slip as Luxury Names Weigh', t: ['MTEU350'], s: -1, cat: 'Markets' }),
  (r) => ({ h: 'Hedge Funds Pare Tech Exposure, Prime-Broker Data Show', t: ['MTUSTEC'], s: -1, cat: 'Markets' }),
  (r) => ({ h: 'Corporate Bond Sales Set Weekly Record as Spreads Tighten', t: ['US10Y'], s: 1, cat: 'Credit' }),
  (r) => ({ h: 'China Unveils Property Support Measures; Developers Jump', t: ['MTHK50', 'USDCNH'], s: 1, cat: 'Economy' }),
  (r) => ({ h: 'UK Gilts Rally as Wage Growth Cools More Than Expected', t: ['UK10Y', 'GBPUSD'], s: 1, cat: 'Rates' }),
  (r) => ({ h: 'Italian Spreads Widen Ahead of Budget Talks', t: ['IT10Y'], s: -1, cat: 'Rates' }),
  (r) => ({ h: 'Natural Gas Jumps on Hotter Weather Forecasts', t: ['NG1'], s: 1, cat: 'Commodities' }),
  (r) => ({ h: 'Wheat Climbs as Dry Weather Threatens Black Sea Crop', t: ['W 1'], s: 1, cat: 'Commodities' }),
  (r) => ({ h: 'Volatility Sellers Return as Implied Vol Sinks', t: ['MTVOL'], s: -1, cat: 'Markets' }),
];

// Draws macro stories without repeats; returns null once the day's pool is used up.
export function macroStory(r, used) {
  const left = MACRO.map((_, i) => i).filter((i) => !used.has(i));
  if (!left.length) return null;
  const k = r.pick(left);
  used.add(k);
  const t = MACRO[k](r);
  return {
    headline: t.h,
    body: `${t.h}. Traders said positioning was light heading into the session, which could amplify moves. Analysts flagged upcoming data releases as the next catalyst.`,
    tickers: t.t,
    sentiment: t.s,
    category: t.cat,
    source: r.pick(SOURCES),
  };
}

export function ecoStory(e) {
  const dir = e.actual > e.survey ? 'Above' : e.actual < e.survey ? 'Below' : 'In Line With';
  return {
    headline: `${e.country} ${e.event} ${fmtVal(e.actual, e.unit)} vs. ${fmtVal(e.survey, e.unit)} Est.; ${dir} Forecast`,
    body: `${e.country} ${e.event} came in at ${fmtVal(e.actual, e.unit)} versus the median economist estimate of ${fmtVal(e.survey, e.unit)}. The prior reading was ${fmtVal(e.prior, e.unit)}.`,
    category: 'Economy',
    source: 'MTN First Word',
  };
}

export function fmtVal(v, unit) {
  if (unit === 'K') return `${Math.round(v)}K`;
  if (unit === '%') return `${v.toFixed(1)}%`;
  if (unit === 'idx') return v.toFixed(1);
  if (unit === 'y') return `${v.toFixed(3)}%`;
  return v.toFixed(2);
}

export { fmtPct };
