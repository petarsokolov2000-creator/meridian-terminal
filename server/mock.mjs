// Offline stand-in for Yahoo Finance, answering in Yahoo's response shapes. Used by
// `MERIDIAN_MOCK=1 node serve.mjs` and the tests, so the real-data path can be exercised
// without network access. Prices are random walks, not real data.

const BASE = { AAPL: 228, MSFT: 415, NVDA: 135, '^GSPC': 5800, '^VIX': 17, 'EURUSD=X': 1.08, 'BTC-USD': 68000, '^TNX': 4.28, '^IRX': 5.2, '^FVX': 4.1, '^TYX': 4.45, '2YY=F': 4.3, 'GC=F': 2650 };

function seedOf(s) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}
function rng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const base = (s) => BASE[s] ?? 20 + (seedOf(s) % 400);

// Insider trades and short interest that differ by symbol (the same shape Yahoo returns), so INSIDER
// and SI have something to rank: AAPL is selling-only, MSFT has cluster buying, and so on.
const dayAgo = (n) => Math.floor(Date.now() / 1000) - n * 86400;
function mockInsiders(sym, px) {
  const t = (name, rel, text, ago, shares, price) => ({ filerName: name, filerRelation: rel, transactionText: text, startDate: { raw: dayAgo(ago), fmt: '' }, shares: { raw: shares }, value: price ? { raw: Math.round(shares * price) } : { raw: 0 } });
  const buy = (name, rel, ago, shares) => t(name, rel, `Purchase at price ${(px * 0.98).toFixed(2)} per share.`, ago, shares, px * 0.98);
  const sell = (name, rel, ago, shares) => t(name, rel, `Sale at price ${(px * 1.03).toFixed(2)} per share.`, ago, shares, px * 1.03);
  const award = (name, rel, ago, shares) => t(name, rel, 'Stock Award(Grant) at price 0.00 per share.', ago, shares, 0);
  const gift = (name, rel, ago, shares) => t(name, rel, 'Stock Gift at price 0.00 per share.', ago, shares, 0);
  const exer = (name, rel, ago, shares) => t(name, rel, 'Conversion of Exercise of derivative security at price 50.00 per share.', ago, shares, 50);
  const q = Math.max(100, Math.round(2e5 / px));
  const kind = seedOf(sym) % 5;
  const common = [award('SMITH JANE', 'Director', 40, 2000), gift('LEE ROBERT', 'Director', 75, 500), exer('PARK DAVID', 'Chief Financial Officer', 33, 8000), buy('TINY BUYER', 'Director', 20, Math.max(1, Math.round(4000 / px)))];
  if (sym === 'AAPL') return [sell('COOK TIMOTHY D', 'Chief Executive Officer', 44, 108136), sell('MAESTRI LUCA', 'Chief Financial Officer', 70, 30000), sell('ADAMS KATE', 'General Counsel', 120, 20000), ...common];
  if (sym === 'MSFT') return [buy('NADELLA SATYA', 'Chief Executive Officer', 12, q), buy('HOOD AMY', 'Chief Financial Officer', 9, q * 0.4 | 0), buy('SMITH BRAD', 'President', 7, q * 0.6 | 0), buy('PAGE JOHN', 'Director', 20, q * 0.2 | 0), sell('TURNER BEN', 'Chief Operating Officer', 150, q * 2), ...common];
  if (kind === 0) return [buy('ROSS ALEX', 'Chief Executive Officer', 25, q), buy('KIM SORA', 'Director', 110, q * 0.5 | 0), ...common];
  if (kind === 1) return [sell('GREEN NOAH', 'Chief Executive Officer', 15, q * 3), sell('WOOD EMMA', 'Director', 60, q), buy('GRAY LEO', 'Director', 200, q * 0.3 | 0), ...common];
  if (kind === 2) return [sell('BLUE SAM', 'President', 30, q * 2), ...common];
  if (kind === 3) return [buy('DAY FRANK', 'Director', 55, q * 0.8 | 0), buy('NIGHT MIA', 'Director', 48, q * 0.6 | 0), buy('NOON PAUL', 'Chief Executive Officer', 40, q), sell('EVE KARL', 'Chief Operating Officer', 90, q * 0.5 | 0), ...common];
  return common;
}
function mockShort(sym) {
  const mv = (x) => ({ raw: x, fmt: String(x) });
  const r = (seedOf(`${sym}short`) % 1000) / 1000;
  const pf = sym === 'AAPL' ? 0.008 : sym === 'TSLA' ? 0.21 : 0.005 + r * r * 0.25;
  const short = Math.round(pf * 1.49e10);
  const dtc = sym === 'AAPL' ? 2.1 : 0.6 + ((seedOf(`${sym}d`) % 100) / 100) * 9;
  const prior = 0.7 + ((seedOf(`${sym}p`) % 100) / 100) * 0.7;
  return { sharesShort: mv(short), shortRatio: mv(+dtc.toFixed(2)), shortPercentOfFloat: mv(+pf.toFixed(4)), sharesShortPriorMonth: mv(Math.round(short * prior)), dateShortInterest: mv(dayAgo(12)) };
}

function series(s, n, stepSec, end, vol) {
  const r = rng(seedOf(s + stepSec));
  let p = base(s) * (0.85 + r() * 0.2);
  const ts = [];
  const o = [];
  const h = [];
  const l = [];
  const c = [];
  const v = [];
  for (let i = 0; i < n; i++) {
    const open = p;
    p *= Math.exp((r() - 0.5) * vol);
    ts.push(end - (n - 1 - i) * stepSec);
    o.push(open);
    c.push(p);
    h.push(Math.max(open, p) * (1 + r() * vol * 0.3));
    l.push(Math.min(open, p) * (1 - r() * vol * 0.3));
    v.push(Math.round(1e6 * (0.5 + r())));
  }
  // Yahoo pads gaps with nulls; make sure the client survives one
  if (n > 10) c[5] = null;
  const k = base(s) / p;
  const sc = (a) => a.map((x) => (x == null ? null : x * k));
  return { ts, o: sc(o), h: sc(h), l: sc(l), c: sc(c), v };
}

function chart(s, range, interval) {
  const now = Math.floor(Date.now() / 1000);
  const daily = interval === '1d' || interval === '1wk';
  const n = !daily ? 120 : { '2y': 504, '5y': 1260, max: 700 }[range] || 252;
  // weekly bars really are a week apart, so 'max' reaches back about 13 years
  const d = series(s, n, interval === '1wk' ? 7 * 86400 : daily ? 86400 : 60, now, daily ? 0.03 : 0.003);
  const last = d.c[d.c.length - 1];
  const events = interval === '1mo' ? { events: {
    dividends: Object.fromEntries([0, 1, 2, 3, 4, 5, 6, 7].map((k) => { const t = now - k * 91 * 86400; return [t, { amount: 0.26 - k * 0.005, date: t }]; })),
    splits: { 1598832000: { date: 1598832000, numerator: 4, denominator: 1, splitRatio: '4:1' } },
  } } : {};
  return {
    chart: {
      result: [{
        ...events,
        meta: {
          symbol: s, currency: 'USD', longName: `${s} Mock Corp`, instrumentType: 'EQUITY', exchangeTimezoneName: 'America/New_York',
          regularMarketPrice: last, chartPreviousClose: last * 0.99, regularMarketDayHigh: last * 1.01, regularMarketDayLow: last * 0.98,
          regularMarketVolume: 12345678, fiftyTwoWeekHigh: last * 1.3, fiftyTwoWeekLow: last * 0.7, regularMarketTime: now,
          currentTradingPeriod: { regular: { start: now - 3600, end: now + 3600 } },
        },
        timestamp: d.ts,
        indicators: { quote: [{ open: d.o, high: d.h, low: d.l, close: d.c, volume: d.v }] },
      }],
      error: null,
    },
  };
}

function quote(symbols) {
  return {
    quoteResponse: {
      result: symbols.map((s) => {
        const p = base(s) * (1 + (Math.random() - 0.5) * 0.002);
        return {
          symbol: s, shortName: `${s} Mock`, longName: `${s} Mock Corp`, currency: 'USD', quoteType: 'EQUITY',
          regularMarketPrice: p, regularMarketPreviousClose: base(s) * 0.99, regularMarketOpen: base(s) * 0.995,
          regularMarketDayHigh: p * 1.01, regularMarketDayLow: p * 0.98, regularMarketVolume: 9876543, averageDailyVolume3Month: 15000000,
          bid: p - 0.01, ask: p + 0.01, bidSize: 3, askSize: 5, marketCap: p * 2e9, sharesOutstanding: 2e9, trailingPE: 25, epsTrailingTwelveMonths: p / 25,
          trailingAnnualDividendYield: 0.012, fiftyTwoWeekHigh: p * 1.3, fiftyTwoWeekLow: p * 0.7, earningsTimestamp: Math.floor(Date.now() / 1000) + 86400 * (seedOf(s) % 20),
          marketState: 'REGULAR', regularMarketTime: Math.floor(Date.now() / 1000),
        };
      }),
      error: null,
    },
  };
}

function options(s) {
  const spot = base(s);
  const exp = Math.floor(Date.now() / 1000) + 30 * 86400;
  const strikes = Array.from({ length: 21 }, (_, i) => Math.round(spot * (0.8 + i * 0.02)));
  const leg = (k, call) => {
    const intrinsic = Math.max(0, call ? spot - k : k - spot);
    const price = intrinsic + spot * 0.03;
    return { contractSymbol: `${s}${k}${call ? 'C' : 'P'}`, strike: k, lastPrice: price, bid: price * 0.98, ask: price * 1.02, impliedVolatility: 0.25 + Math.abs(k / spot - 1) * 0.5, volume: 100, openInterest: 1000, inTheMoney: intrinsic > 0 };
  };
  return { optionChain: { result: [{ underlyingSymbol: s, expirationDates: [exp, exp + 28 * 86400, exp + 91 * 86400], strikes, quote: { regularMarketPrice: spot }, options: [{ expirationDate: exp, calls: strikes.map((k) => leg(k, true)), puts: strikes.map((k) => leg(k, false)) }] }], error: null } };
}

// ETF test data: published expense ratios (SPY 0.0945%, QQQ 0.20%, XLK 0.08%); holdings weights are
// round numbers for testing, not the funds' current weights.
const ETFS = {
  SPY: { name: 'SPDR S&P 500 ETF Trust', family: 'SPDR State Street Global Advisors', category: 'Large Blend', er: 0.000945, assets: 6.3e11,
    h: [['NVDA', 0.075], ['MSFT', 0.065], ['AAPL', 0.064], ['AMZN', 0.039], ['META', 0.03], ['AVGO', 0.025], ['GOOGL', 0.021], ['GOOG', 0.017], ['TSLA', 0.017], ['BRK-B', 0.016]],
    s: { technology: 0.33, financial_services: 0.13, communication_services: 0.1, consumer_cyclical: 0.1, healthcare: 0.09, industrials: 0.08, consumer_defensive: 0.05, energy: 0.03, utilities: 0.025, realestate: 0.02, basic_materials: 0.02 } },
  QQQ: { name: 'Invesco QQQ Trust, Series 1', family: 'Invesco', category: 'Large Growth', er: 0.002, assets: 3.6e11,
    h: [['NVDA', 0.095], ['MSFT', 0.085], ['AAPL', 0.08], ['AMZN', 0.055], ['AVGO', 0.05], ['META', 0.035], ['NFLX', 0.03], ['TSLA', 0.03], ['COST', 0.028], ['GOOGL', 0.027]],
    s: { technology: 0.52, communication_services: 0.16, consumer_cyclical: 0.13, consumer_defensive: 0.05, healthcare: 0.05, industrials: 0.05, utilities: 0.015, basic_materials: 0.01, financial_services: 0.005 } },
  XLK: { name: 'Technology Select Sector SPDR Fund', family: 'SPDR State Street Global Advisors', category: 'Technology', er: 0.0008, assets: 7.5e10,
    h: [['NVDA', 0.15], ['MSFT', 0.13], ['AAPL', 0.12], ['AVGO', 0.05], ['ORCL', 0.035], ['PLTR', 0.03], ['CRM', 0.025], ['CSCO', 0.024], ['IBM', 0.022], ['AMD', 0.02]],
    s: { technology: 1.0 } },
};
function summary(s) {
  const v = (x) => ({ raw: x, fmt: String(x) });
  const e = ETFS[s];
  if (e) {
    return { quoteSummary: { result: [{
      quoteType: { quoteType: 'ETF', longName: e.name }, price: { longName: e.name },
      fundProfile: { family: e.family, categoryName: e.category, legalType: 'Exchange Traded Fund', feesExpensesInvestment: { annualReportExpenseRatio: v(e.er) } },
      summaryDetail: { totalAssets: v(e.assets), yield: v(0.012) }, defaultKeyStatistics: { fundInceptionDate: v(727660800) },
      topHoldings: { stockPosition: v(0.998), bondPosition: v(0), cashPosition: v(0.002), holdings: e.h.map(([sym, w]) => ({ symbol: sym, holdingName: `${sym} Mock Corp`, holdingPercent: v(w) })), sectorWeightings: Object.entries(e.s).map(([k, w]) => ({ [k]: v(w) })) },
    }], error: null } };
  }
  return {
    quoteSummary: {
      result: [{
        secFilings: { filings: [{ date: '2026-10-30', epochDate: 1793318400, type: '10-K', title: 'Annual report', edgarUrl: 'https://finance.yahoo.com/sec-filing/mock/10k' }, { date: '2026-08-01', epochDate: 1785542400, type: '10-Q', title: 'Quarterly report', edgarUrl: 'https://finance.yahoo.com/sec-filing/mock/10q' }] },
        quoteType: { longName: `${s} Mock Corp` },
        assetProfile: { longBusinessSummary: `${s} Mock Corp makes mock products for testing.`, ...(['JPM', 'BAC', 'WFC', 'C', 'USB', 'PNC'].includes(s) ? { sector: 'Financial Services', industry: 'Banks - Diversified' } : { sector: 'Technology', industry: 'Software' }), fullTimeEmployees: 12000, country: 'United States', website: 'https://example.com' },
        financialData: { targetMeanPrice: v(base(s) * 1.1), targetHighPrice: v(base(s) * 1.4), targetLowPrice: v(base(s) * 0.8), recommendationMean: v(2.1), recommendationKey: 'buy', numberOfAnalystOpinions: v(30), totalRevenue: v(3.9e11), revenueGrowth: v(0.06), grossMargins: v(0.46), operatingMargins: v(0.31), ebitdaMargins: v(0.34), profitMargins: v(0.25), ebitda: v(1.3e11), totalDebt: v(1.0e11), totalCash: v(6e10), freeCashflow: v(1.0e11), returnOnEquity: v(1.5), debtToEquity: v(150) },
        recommendationTrend: { trend: [{ period: '0m', strongBuy: 10, buy: 20, hold: 12, sell: 2, strongSell: 1 }] },
        upgradeDowngradeHistory: { history: [{ epochGradeDate: Math.floor(Date.now() / 1000) - 86400 * 3, firm: 'Mock Securities', toGrade: 'Buy', fromGrade: 'Hold', action: 'up', currentPriceTarget: base(s) * 1.2 }, { epochGradeDate: Math.floor(Date.now() / 1000) - 86400 * 9, firm: 'Needham', toGrade: 'Hold', fromGrade: 'Hold', action: 'main', currentPriceTarget: 0 }] },
        incomeStatementHistory: { incomeStatementHistory: [2025, 2024, 2023, 2022].map((y) => ({ endDate: v(Date.UTC(y, 8, 30) / 1000), totalRevenue: v(3.9e11 - (2025 - y) * 1e10), grossProfit: v(1.8e11), operatingIncome: v(1.2e11), netIncome: v(9.7e10), ebit: v(1.2e11) })) },
        calendarEvents: { earnings: { earningsDate: [v(Math.floor(Date.now() / 1000) + 86400 * 10)], earningsAverage: v(1.6), revenueAverage: v(9.4e10) } },
        earningsHistory: { history: [['4q', 1.4, 1.35], ['3q', 1.53, 1.5], ['2q', 1.4, 1.43], ['1q', 1.65, 1.6]].map(([p, a, e], i) => ({ period: `-${p}`, quarter: v(Math.floor(Date.UTC(2025, 9 + i * 3, 1) / 1000)), epsActual: v(a), epsEstimate: v(e), surprisePercent: v((a - e) / e) })) },
        earningsTrend: { trend: [['0q', 1.7], ['+1q', 1.85], ['0y', 7.1], ['+1y', 7.9]].map(([p, e]) => ({ period: p, endDate: '2026-12-31', growth: v(0.08), earningsEstimate: { avg: v(e), low: v(e * 0.9), high: v(e * 1.1), numberOfAnalysts: v(28), yearAgoEps: v(e * 0.92) }, revenueEstimate: { avg: v(e * 5.6e10), low: v(e * 5.2e10), high: v(e * 6e10), numberOfAnalysts: v(25), yearAgoRevenue: v(e * 5.1e10) }, epsTrend: { current: v(e), '7daysAgo': v(e * 0.998), '30daysAgo': v(e * 0.985), '60daysAgo': v(e * 0.97), '90daysAgo': v(e * 0.955) }, epsRevisions: { upLast7days: v(3), upLast30days: v(9), downLast7days: v(1), downLast30days: v(2), downLast90days: v(4) } })) },
        majorHoldersBreakdown: { insidersPercentHeld: v(0.021), institutionsPercentHeld: v(0.612), institutionsFloatPercentHeld: v(0.625), institutionsCount: v(6800) },
        institutionOwnership: { ownershipList: [['Vanguard Group Inc', 0.092], ['Blackrock Inc.', 0.071], ['State Street Corp', 0.038]].map(([o, p]) => ({ organization: o, pctHeld: v(p), position: v(p * 1.5e10), value: v(p * 3.4e12), reportDate: v(Math.floor(Date.UTC(2026, 5, 30) / 1000)) })) },
        fundOwnership: { ownershipList: [{ organization: 'Vanguard Total Stock Market Index Fund', pctHeld: v(0.03), position: v(4.5e8), value: v(1e11), reportDate: v(Math.floor(Date.UTC(2026, 5, 30) / 1000)) }] },
        insiderTransactions: { transactions: mockInsiders(s, base(s)) },
        defaultKeyStatistics: { priceToBook: v(50), enterpriseValue: v(3.5e12), enterpriseToEbitda: v(26), enterpriseToRevenue: v(9), forwardPE: v(30), pegRatio: v(2.1), sharesOutstanding: v(1.5e10), floatShares: v(1.49e10), ...mockShort(s), bookValue: v(4.6), trailingEps: v(6.1), forwardEps: v(7.1), '52WeekChange': v(0.18), lastSplitFactor: '4:1', lastSplitDate: v(1598832000), lastFiscalYearEnd: v(1790985600), mostRecentQuarter: v(1790985600) },
        summaryDetail: { beta: v(1.2), marketCap: v(3.4e12), trailingPE: v(37), forwardPE: v(30), priceToSalesTrailing12Months: v(8.7), fiftyTwoWeekHigh: v(260), fiftyTwoWeekLow: v(169), fiftyDayAverage: v(225), twoHundredDayAverage: v(215), averageVolume: v(5.2e7), averageVolume10days: v(4.8e7), dividendRate: v(1.04), dividendYield: v(0.0046), payoutRatio: v(0.16), exDividendDate: v(1793318400), fiveYearAvgDividendYield: v(0.56) },
      }],
      error: null,
    },
  };
}

// Yahoo statements for AAPL, XOM and JPM (USD millions, shares in millions). AAPL FY2021-2024 and
// the annual XOM/JPM figures follow their 10-Ks, except that Yahoo's XOM "total revenue" is
// sales and other operating revenue (it leaves out other income), as Yahoo really does: the
// fallback's 2% check has to catch that. AAPL's total assets exist only here (the SEC test data
// leaves them out), to exercise an unchecked fill. Trailing and quarterly rows: test values.
const YH = {
  AAPL: {
    annual: { dates: ['2021-09-30', '2022-09-30', '2023-09-30', '2024-09-30'], v: {
      TotalRevenue: [365817, 394328, 383285, 391035], GrossProfit: [152836, 170782, 169148, 180683], CostOfRevenue: [212981, 223546, 214137, 210352], OperatingIncome: [108949, 119437, 114301, 123216],
      PretaxIncome: [109207, 119103, 113736, 123485], TaxProvision: [14527, 19300, 16741, 29749], NetIncome: [94680, 99803, 96995, 93736], DilutedEPS: [5.61, 6.11, 6.13, 6.08],
      DilutedAverageShares: [16864.919, 16325.819, 15812.547, 15408.095], OperatingCashFlow: [104038, 122151, 110543, 118254], CapitalExpenditure: [-11085, -10708, -10959, -9447],
      DepreciationAndAmortization: [11284, 11104, 11519, 11445], StockBasedCompensation: [7906, 9038, 10833, 11688], RepurchaseOfCapitalStock: [-85971, -89402, -77550, -94949], CashDividendsPaid: [-14467, -14841, -15025, -15234],
      CashAndCashEquivalents: [34940, 23646, 29965, 29943], OtherShortTermInvestments: [27699, 24658, 31590, 35228], TotalDebt: [124719, 120069, 111088, 106629],
      StockholdersEquity: [63090, 50672, 62146, 56950], OrdinarySharesNumber: [16426.786, 15943.425, 15550.061, 15116.786], TotalAssets: [351002, 352755, 352583, 364980] } },
    trailing: { dates: ['2025-06-30'], v: { TotalRevenue: [408625], NetIncome: [99280], DilutedEPS: [6.61], OperatingIncome: [130214], OperatingCashFlow: [108565], CapitalExpenditure: [-12381], DepreciationAndAmortization: [11543] } },
    quarterly: { dates: ['2025-06-30'], v: { CashAndCashEquivalents: [36269], OtherShortTermInvestments: [19103], TotalDebt: [101698], StockholdersEquity: [65830], OrdinarySharesNumber: [14935.826] } },
  },
  XOM: {
    annual: { dates: ['2022-12-31', '2023-12-31', '2024-12-31'], v: {
      TotalRevenue: [398675, 334697, 339247], NetIncome: [55740, 36010, 33680], DilutedEPS: [13.26, 8.89, 7.84], DilutedAverageShares: [4205, 4052, 4299], OperatingCashFlow: [76797, 55369, 55022],
      CapitalExpenditure: [-18407, -21919, -24306], DepreciationAndAmortization: [24040, 20641, 23442], CashAndCashEquivalents: [29640, 31539, 23029], TotalDebt: [41193, 41573, 41710],
      StockholdersEquity: [195049, 204802, 263705], OrdinarySharesNumber: [4080, 3973, 4343] } },
  },
  JPM: {
    annual: { dates: ['2022-12-31', '2023-12-31', '2024-12-31'], v: {
      TotalRevenue: [128695, 158104, 177556], NetIncome: [37676, 49552, 58471], DilutedEPS: [12.09, 16.23, 19.75], DilutedAverageShares: [2970, 2943, 2897], OperatingCashFlow: [107119, 12974, -42012],
      StockholdersEquity: [292332, 327878, 344758], PreferredStock: [27404, 27404, 20050], Goodwill: [51662, 52634, 52565], OrdinarySharesNumber: [2934, 2875, 2797], TotalAssets: [3665743, 3875393, 4002814] } },
  },
};
function realTimeseries(u, types) {
  const sym = decodeURIComponent(u.pathname.split('/').pop());
  const freq = (types[0] || '').match(/^(annual|quarterly|trailing)/)?.[1];
  const set = YH[sym]?.[freq];
  if (!YH[sym]) return null;
  const result = types.map((t) => {
    const name = t.replace(/^(annual|quarterly|trailing)/, '');
    const vals = set?.v[name];
    if (!vals) return { meta: { symbol: [sym], type: [t] }, timestamp: [] };
    const scale = /EPS$/.test(name) ? 1 : 1e6;
    return { meta: { symbol: [sym], type: [t] }, timestamp: set.dates.map((d) => Date.parse(d) / 1000), [t]: set.dates.map((d, i) => (vals[i] == null ? null : { asOfDate: d, periodType: freq === 'quarterly' ? '3M' : '12M', currencyCode: 'USD', reportedValue: { raw: vals[i] * scale, fmt: 'x' } })) };
  });
  return { timeseries: { result, error: null } };
}

function timeseries(u) {
  const types = (u.searchParams.get('type') || '').split(',').filter(Boolean);
  const real = realTimeseries(u, types);
  if (real) return real;
  const quarterly = types[0]?.startsWith('quarterly');
  const dates = quarterly
    ? ['2024-09-30', '2024-12-31', '2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31', '2026-03-31', '2026-06-30', '2026-09-30']
    : ['2021-09-30', '2022-09-30', '2023-09-30', '2024-09-30', '2025-09-30', '2026-09-30'];
  const base = { TotalRevenue: 3.9e11, CostOfRevenue: 2.1e11, GrossProfit: 1.8e11, OperatingIncome: 1.2e11, NetIncome: 9.7e10, DilutedEPS: 6.1, TotalAssets: 3.5e11, StockholdersEquity: 7e10, OperatingCashFlow: 1.1e11, CapitalExpenditure: -1.1e10, FreeCashFlow: 9.9e10 };
  const result = types.map((t) => {
    const name = t.replace(/^(annual|quarterly|trailing)/, '');
    // a type Yahoo has no data for comes back as just a meta block
    if (!(name in base)) return { meta: { symbol: [u.pathname.split('/').pop()], type: [t] }, timestamp: [] };
    const scale = quarterly && name !== 'DilutedEPS' ? 0.25 : 1;
    return {
      meta: { symbol: [u.pathname.split('/').pop()], type: [t] },
      timestamp: dates.map((d) => Date.parse(d) / 1000),
      [t]: dates.map((d, i) => (i === 1 ? null : { asOfDate: d, periodType: quarterly ? '3M' : '12M', currencyCode: 'USD', reportedValue: { raw: base[name] * scale * (0.8 + i * 0.05), fmt: 'x' } })),
    };
  });
  return { timeseries: { result, error: null } };
}

// ---- SEC XBRL test data ----------------------------------------------------------------------
// AAPL: Apple's published 10-K figures (USD millions; shares in millions), fiscal 2015-2024. FY2015-
// 2017 appear only in their original pre-split filings (EPS before the 2020 4-for-1 split), so the
// split adjustment is exercised; FY2018-2019 are also restated in the FY2020 10-K, as Apple did.
// XOM and JPM: their published 2023 and 2024 figures. Everything else: generated numbers.
const APPLE_ENDS = ['2015-09-26', '2016-09-24', '2017-09-30', '2018-09-29', '2019-09-28', '2020-09-26', '2021-09-25', '2022-09-24', '2023-09-30', '2024-09-28'];
const REAL = {
  AAPL: { cik: 320193, sic: 3571, sicDescription: 'ELECTRONIC COMPUTERS', fye: '0928', ends: APPLE_ENDS,
    d: {
      SalesRevenueNet: [233715, 215639, 229234, 265595, null, null, null, null, null, null],
      RevenueFromContractWithCustomerExcludingAssessedTax: [null, null, null, 265595, 260174, 274515, 365817, 394328, 383285, 391035],
      OperatingIncomeLoss: [71230, 60024, 61344, 70898, 63930, 66288, 108949, 119437, 114301, 123216],
      NetIncomeLoss: [53394, 45687, 48351, 59531, 55256, 57411, 94680, 99803, 96995, 93736],
      DepreciationDepletionAndAmortization: [11257, 10505, 10157, 10903, 12547, 11056, 11284, 11104, 11519, 11445],
      NetCashProvidedByUsedInOperatingActivities: [81266, 65824, 64225, 77434, 69391, 80674, 104038, 122151, 110543, 118254],
      PaymentsToAcquirePropertyPlantAndEquipment: [11247, 12734, 12451, 13313, 10495, 7309, 11085, 10708, 10959, 9447],
      EarningsPerShareDiluted: [9.22, 8.31, 9.21, 11.91, 11.89, 3.28, 5.61, 6.11, 6.13, 6.08],
      WeightedAverageNumberOfDilutedSharesOutstanding: [5793.069, 5500.281, 5251.692, 5000.109, 4648.913, 17528.214, 16864.919, 16325.819, 15812.547, 15408.095],
      GrossProfit: [93626, 84263, 88186, 101839, 98392, 104956, 152836, 170782, 169148, 180683],
      IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest: [72515, 61372, 64089, 72903, 65737, 67091, 109207, 119103, 113736, 123485],
      IncomeTaxExpenseBenefit: [19121, 15685, 15738, 13372, 10481, 9680, 14527, 19300, 16741, 29749],
      InterestExpense: [733, 1456, 2323, 3240, 3576, 2873, 2645, 2931, 3933, null],
      ShareBasedCompensation: [3586, 4210, 4840, 5340, 6068, 6829, 7906, 9038, 10833, 11688],
      PaymentsForRepurchaseOfCommonStock: [35253, 29722, 32900, 72738, 66897, 72358, 85971, 89402, 77550, 94949],
      PaymentsOfDividends: [11561, 12150, 12769, 13712, 14119, 14081, 14467, 14841, 15025, 15234],
      // research, acquisitions and debt repaid: test values (rounded), not copied from the filings
      ResearchAndDevelopmentExpense: [8067, 10045, 11581, 14236, 16217, 18752, 21914, 26251, 29915, 31370],
      PaymentsToAcquireBusinessesNetOfCashAcquired: [343, 297, 329, 721, 624, 1524, 33, 306, null, null],
      RepaymentsOfLongTermDebt: [2500, 2500, 3500, 6500, 8805, 12629, 8750, 9543, 11151, 9958],
    },
    i: {
      CashAndCashEquivalentsAtCarryingValue: [null, null, null, 25913, 48844, 38016, 34940, 23646, 29965, 29943],
      MarketableSecuritiesCurrent: [null, null, null, 40388, 51713, 52927, 27699, 24658, 31590, 35228],
      LongTermDebtNoncurrent: [null, null, null, 93735, 91807, 98667, 109106, 98959, 95281, 85750],
      LongTermDebtCurrent: [null, null, null, 8784, 10260, 8773, 9613, 11128, 9822, 10912],
      CommercialPaper: [null, null, null, 11964, 5980, 4996, 6000, 9982, 5985, 9967],
      StockholdersEquity: [null, null, null, 107147, 90488, 65339, 63090, 50672, 62146, 56950],
      CommonStockSharesOutstanding: [null, null, null, 4754.986, 4443.236, 16976.763, 16426.786, 15943.425, 15550.061, 15116.786],
    },
    // FY2018-2019 restated (split-adjusted) in the FY2020 10-K
    restated: { EarningsPerShareDiluted: { 3: 2.98, 4: 2.97 }, WeightedAverageNumberOfDilutedSharesOutstanding: { 3: 20000.436, 4: 18595.651 } },
  },
  XOM: { cik: 34088, sic: 2911, sicDescription: 'PETROLEUM REFINING', fye: '1231', ends: ['2023-12-31', '2024-12-31'],
    d: { Revenues: [344582, 349585], NetIncomeLoss: [36010, 33680], DepreciationDepletionAndAmortization: [20641, 23442], NetCashProvidedByUsedInOperatingActivities: [55369, 55022],
      PaymentsToAcquirePropertyPlantAndEquipment: [21919, 24306], EarningsPerShareDiluted: [8.89, 7.84], WeightedAverageNumberOfDilutedSharesOutstanding: [4052, 4299],
      PaymentsForRepurchaseOfCommonStock: [17748, 19629], PaymentsOfDividendsCommonStock: [14941, 16704],
      PaymentsToAcquireBusinessesNetOfCashAcquired: [null, 450], RepaymentsOfLongTermDebt: [2800, 1900] },
    i: { CashAndCashEquivalentsAtCarryingValue: [31539, 23029], LongTermDebtNoncurrent: [37483, 36755], ShortTermBorrowings: [4090, 4955], StockholdersEquity: [204802, 263705], CommonStockSharesOutstanding: [3973, 4343] },
  },
  JPM: { cik: 19617, sic: 6021, sicDescription: 'NATIONAL COMMERCIAL BANKS', fye: '1231', ends: ['2023-12-31', '2024-12-31'],
    d: { RevenuesNetOfInterestExpense: [158104, 177556], NetIncomeLoss: [49552, 58471], NoninterestExpense: [87172, 91797], EarningsPerShareDiluted: [16.23, 19.75], CommonStockDividendsPerShareDeclared: [4.10, 4.80], WeightedAverageNumberOfDilutedSharesOutstanding: [2943, 2897] },
    i: { StockholdersEquity: [327878, 344758], PreferredStockValue: [27404, 20050], Goodwill: [52634, 52565], CommonStockSharesOutstanding: [2875, 2797], Assets: [3875393, 4002814] },
  },
};
// AAPL 10-Q data for the trailing-12-month tests: nine months to 2025-06-28 and the same nine
// months a year earlier, and the balance sheet on 2025-06-28. TEST VALUES, close to Apple's
// but not checked line by line against its 10-Q.
const AAPL_Q = {
  cur: ['2024-09-29', '2025-06-28', '2025-08-01'], prior: ['2023-10-01', '2024-06-29'],
  d: { RevenueFromContractWithCustomerExcludingAssessedTax: [313695, 296105], OperatingIncomeLoss: [100623, 93625], NetIncomeLoss: [84544, 79000], DepreciationDepletionAndAmortization: [8632, 8534],
    NetCashProvidedByUsedInOperatingActivities: [81754, 91443], PaymentsToAcquirePropertyPlantAndEquipment: [9473, 6539], EarningsPerShareDiluted: [5.64, 5.11],
    IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest: [101290, 93975], IncomeTaxExpenseBenefit: [16746, 14975] },
  i: { CashAndCashEquivalentsAtCarryingValue: 36269, MarketableSecuritiesCurrent: 19103, LongTermDebtNoncurrent: 82430, LongTermDebtCurrent: 9345, CommercialPaper: 9923, StockholdersEquity: 65830, CommonStockSharesOutstanding: 14935.826 },
  dei: [['2024-10-18', 15115.823, '2024-11-01'], ['2025-07-11', 14935.826, '2025-08-01']],
};
const MOCK_SIC = { DELL: 3571, HPQ: 3571, SMCI: 3571, HPE: 3571, CVX: 2911, COP: 2911, PSX: 2911, MPC: 2911, VLO: 2911, BAC: 6021, WFC: 6021, C: 6021, USB: 6021, PNC: 6021, MSFT: 7372, ORCL: 7372 };
const PER_SHARE = /PerShare/;
const SHARES = /Shares/;
let tickerList = null;
async function mockTickers() {
  if (tickerList) return tickerList;
  const u = await import('../src/live-universe.js');
  const m = await import('../src/companies.js');
  const syms = [...u.LIVE_EQUITIES.map((e) => e[0]), ...m.MORE_COMPANIES.map((c) => c[0])];
  tickerList = syms.map((t, k) => ({ cik_str: REAL[t]?.cik ?? 1000000 + k, ticker: t, title: `${t} Mock Corp` }));
  return tickerList;
}
function secConcept(cik, tag) {
  const real = Object.entries(REAL).find(([, r]) => r.cik === cik);
  const isDur = !/^(Cash|Marketable|LongTermDebt|Commercial|ShortTerm|Stockholders|PreferredStockValue|Goodwill|CommonStockShares|Intangible|Assets$)/.test(tag);
  const unit = PER_SHARE.test(tag) ? 'USD/shares' : SHARES.test(tag) && !/^Payments/.test(tag) ? 'shares' : 'USD';
  const scale = unit === 'USD/shares' ? 1 : 1e6;
  const rows = [];
  const push = (start, end, val, filed) => rows.push({ ...(start ? { start } : {}), end, val: Math.round(val * scale * 100) / 100, form: '10-K', fy: Number(filed.slice(0, 4)), fp: 'FY', filed });
  if (real) {
    const [, r] = real;
    const vals = (isDur ? r.d : r.i)[tag];
    if (!vals) return null;
    r.ends.forEach((end, k) => {
      if (vals[k] == null) return;
      const start = isDur ? new Date(Date.parse(end) - 364 * 86400e3).toISOString().slice(0, 10) : null;
      const filed = new Date(Date.parse(end) + 35 * 86400e3).toISOString().slice(0, 10);
      push(start, end, vals[k], filed);
      const re = r.restated?.[tag]?.[k];
      if (re != null) push(start, end, re, '2020-10-30');
    });
    if (r === REAL.AAPL) {
      const q = AAPL_Q;
      const qpush = (start, end, val, filed) => rows.push({ ...(start ? { start } : {}), end, val: Math.round(val * scale * 100) / 100, form: '10-Q', fy: 2025, fp: 'Q3', filed });
      if (isDur && q.d[tag]) {
        qpush(q.cur[0], q.cur[1], q.d[tag][0], q.cur[2]);
        qpush(q.prior[0], q.prior[1], q.d[tag][1], q.cur[2]);
      }
      if (!isDur && q.i[tag] != null) qpush(null, q.cur[1], q.i[tag], q.cur[2]);
    }
    return rows.length ? { cik, taxonomy: 'us-gaap', tag, units: { [unit]: rows } } : null;
  }
  // generated: 12 fiscal years ending 31 Dec, steady growth with noise
  const r = rng(seedOf(`${cik}${tag}`));
  const want = { RevenueFromContractWithCustomerExcludingAssessedTax: 40000, OperatingIncomeLoss: 8000, NetIncomeLoss: 6000, DepreciationDepletionAndAmortization: 1500, NetCashProvidedByUsedInOperatingActivities: 9000,
    PaymentsToAcquirePropertyPlantAndEquipment: 2000, EarningsPerShareDiluted: 4, WeightedAverageNumberOfDilutedSharesOutstanding: 1500, CashAndCashEquivalentsAtCarryingValue: 5000, LongTermDebt: 12000,
    StockholdersEquity: 20000, CommonStockSharesOutstanding: 1480, InterestExpense: 400, IncomeTaxExpenseBenefit: 1300, ShareBasedCompensation: 600, PaymentsForRepurchaseOfCommonStock: 2500, PaymentsOfDividends: 1500, ResearchAndDevelopmentExpense: 900, PaymentsToAcquireBusinessesNetOfCashAcquired: 600, RepaymentsOfLongTermDebt: 1100,
    GrossProfit: 18000, IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest: 7600, Assets: 60000 }[tag];
  if (!want) return null;
  for (let k = 0; k < 12; k++) {
    const yr = 2014 + k;
    const g = tag.startsWith('Weighted') || tag.startsWith('CommonStockShares') ? 1 - 0.01 * k : (1 + 0.07) ** k;
    push(isDur ? `${yr}-01-01` : null, `${yr}-12-31`, want * g * (0.9 + r() * 0.2), `${yr + 1}-02-15`);
  }
  return { cik, taxonomy: 'us-gaap', tag, units: { [unit]: rows } };
}

// ---- 10-K documents (inline XBRL) for SEG and RISK -------------------------------------------
// AAPL: Apple's published FY2022-2024 revenue by reportable segment (geographic), by product and
// by country (USD millions; each set adds up to total net sales). XOM, JPM and others: generated
// segment numbers. Risk-factor headings: written for these tests, not taken from any filing.
const APPLE_SEG = {
  ends: ['2022-09-24', '2023-09-30', '2024-09-28'], starts: ['2021-09-26', '2022-09-25', '2023-10-01'], total: [394328, 383285, 391035],
  segment: { 'aapl:AmericasSegmentMember': [169658, 162560, 167045], 'aapl:EuropeSegmentMember': [95118, 94294, 101328], 'aapl:GreaterChinaSegmentMember': [74200, 72559, 66952], 'aapl:JapanSegmentMember': [25977, 24257, 25052], 'aapl:RestOfAsiaPacificSegmentMember': [29375, 29615, 30658] },
  product: { 'us-gaap:IPhoneMember': [205489, 200583, 201183], 'us-gaap:MacMember': [40177, 29357, 29984], 'us-gaap:IPadMember': [29292, 28300, 26694], 'aapl:WearablesHomeandAccessoriesMember': [41241, 39845, 37005], 'us-gaap:ServiceMember': [78129, 85200, 96169] },
  geography: { 'country:US': [147859, 138573, 142196], 'country:CN': [74200, 72559, 66952], 'aapl:OtherCountriesMember': [172269, 172153, 181887] },
};
function tenkHtml(ticker) {
  const real = ticker === 'AAPL' ? APPLE_SEG : null;
  const r = rng(seedOf(`10k${ticker}`));
  const ends = real ? real.ends : ['2022-12-31', '2023-12-31', '2024-12-31'];
  const starts = real ? real.starts : ['2022-01-01', '2023-01-01', '2024-01-01'];
  const gen = (names) => Object.fromEntries(names.map((n, k) => [n, ends.map((_, j) => Math.round((20000 - k * 3000) * (1 + 0.05 * j) * (0.9 + r() * 0.2)))]));
  const set = real || {
    segment: gen(ticker === 'XOM' ? ['xom:UpstreamMember', 'xom:EnergyProductsMember', 'xom:ChemicalProductsMember', 'xom:SpecialtyProductsMember'] : ticker === 'JPM' ? ['jpm:ConsumerCommunityBankingMember', 'jpm:CommercialInvestmentBankMember', 'jpm:AssetWealthManagementMember', 'us-gaap:CorporateNonSegmentMember'] : ['mock:AlphaSegmentMember', 'mock:BetaSegmentMember']),
    geography: gen(['country:US', 'srt:EuropeMember', 'srt:AsiaPacificMember']),
  };
  const total = real ? real.total : ends.map((_, j) => Object.values(set.segment).reduce((a, v) => a + v[j], 0));
  const tag = ticker === 'JPM' ? 'us-gaap:RevenuesNetOfInterestExpense' : 'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax';
  const ctxs = [];
  const facts = [];
  let n = 0;
  const ctx = (j, dims) => {
    const id = `c-${++n}`;
    ctxs.push(`<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">0</xbrli:identifier>${dims.length ? `<xbrli:segment>${dims.map(([a, m]) => `<xbrldi:explicitMember dimension="${a}">${m}</xbrldi:explicitMember>`).join('')}</xbrli:segment>` : ''}</xbrli:entity><xbrli:period><xbrli:startDate>${starts[j]}</xbrli:startDate><xbrli:endDate>${ends[j]}</xbrli:endDate></xbrli:period></xbrli:context>`);
    return id;
  };
  const fact = (id, v) => facts.push(`<td><ix:nonFraction name="${tag}" contextRef="${id}" unitRef="usd" decimals="-6" scale="6" format="ixt:num-dot-decimal">${v.toLocaleString('en-US')}</ix:nonFraction></td>`);
  ends.forEach((_, j) => fact(ctx(j, []), total[j]));
  for (const [axis, key] of [['us-gaap:StatementBusinessSegmentsAxis', 'segment'], ['srt:ProductOrServiceAxis', 'product'], ['srt:StatementGeographicalAxis', 'geography']]) {
    for (const [member, vals] of Object.entries(set[key] || {})) ends.forEach((_, j) => fact(ctx(j, axis === 'us-gaap:StatementBusinessSegmentsAxis' ? [[axis, member], ['srt:ConsolidationItemsAxis', 'us-gaap:OperatingSegmentsMember']] : [[axis, member]]), vals[j]));
  }
  // generated companies: one tagged major customer (12% of revenue)
  if (!real && !['XOM', 'JPM'].includes(ticker)) {
    const id = `c-${++n}`;
    ctxs.push(`<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="x">0</xbrli:identifier><xbrli:segment><xbrldi:explicitMember dimension="srt:MajorCustomersAxis">mock:CustomerAMember</xbrldi:explicitMember><xbrldi:explicitMember dimension="us-gaap:ConcentrationRiskByBenchmarkAxis">us-gaap:RevenueFromContractWithCustomerMember</xbrldi:explicitMember></xbrli:segment></xbrli:entity><xbrli:period><xbrli:startDate>${starts[2]}</xbrli:startDate><xbrli:endDate>${ends[2]}</xbrli:endDate></xbrli:period></xbrli:context>`);
    facts.push(`<td><ix:nonFraction name="us-gaap:ConcentrationRiskPercentage1" contextRef="${id}" unitRef="pure" scale="-2" decimals="2">12</ix:nonFraction>%</td>`);
  }
  const B = (t) => `<div><span style="font-weight:700;font-style:italic">${t}</span></div>`;
  const P = (t) => `<div><span style="font-weight:400">${t}</span></div>`;
  const risks = [
    '<div><span style="font-weight:700">Macroeconomic and Industry Risks</span></div>',
    B('Weak economic conditions in major markets could reduce demand for the company&#8217;s products.'), P('Ordinary paragraph explaining the risk in more detail, which is not a heading. '.repeat(4)),
    B('Competition could lower prices and margins.'), P('More detail. '.repeat(20)),
    '<div><span style="font-weight:700">Operational Risks</span></div>',
    B('Disruption at key suppliers or manufacturing partners could delay shipments.'), P('Detail. '.repeat(20)),
    B('Cyberattacks or system failures could harm the business and its reputation.'), P('Detail. '.repeat(20)),
    '<div><span style="font-weight:700">Legal and Regulatory Risks</span></div>',
    B('Changes in tax laws or new regulations could increase costs.'), P('Detail. '.repeat(20)),
  ];
  return `<html><body><ix:header><ix:resources>${ctxs.join('')}</ix:resources></ix:header>
    <div>Table of contents</div><div>Item 1A. Risk Factors ..... 5</div><div>Item 1B. Unresolved Staff Comments ..... 17</div>
    <div>Item 1. Business</div>${P('About the business. '.repeat(30))}
    <div><span style="font-weight:700">Item 1A.&#160;&#160;&#160;&#160;Risk Factors</span></div>${risks.join('')}${P('Closing text. '.repeat(100))}
    <div><span style="font-weight:700">Item 1B.&#160;&#160;&#160;&#160;Unresolved Staff Comments</span></div>${P('None.')}
    <table><tr>${facts.join('')}</tr></table></body></html>`;
}

async function sec(u) {
  // MERIDIAN_MOCK_SEC=403 imitates the SEC refusing automated requests
  if (process.env.MERIDIAN_MOCK_SEC) return new Response('Forbidden', { status: Number(process.env.MERIDIAN_MOCK_SEC) });
  let m;
  if ((m = u.pathname.match(/^\/api\/xbrl\/companyconcept\/CIK(\d{10})\/dei\/EntityCommonStockSharesOutstanding\.json$/))) {
    if (Number(m[1]) !== REAL.AAPL.cik) return new Response('{}', { status: 404 });
    return ok({ cik: REAL.AAPL.cik, taxonomy: 'dei', tag: 'EntityCommonStockSharesOutstanding', units: { shares: AAPL_Q.dei.map(([end, v, filed], k) => ({ end, val: v * 1e6, accn: `0000320193-2${k}-000001`, form: k ? '10-Q' : '10-K', filed })) } });
  }
  if ((m = u.pathname.match(/^\/api\/xbrl\/companyconcept\/CIK(\d{10})\/us-gaap\/(\w+)\.json$/))) {
    const j = secConcept(Number(m[1]), m[2]);
    return j ? ok(j) : new Response('{}', { status: 404 });
  }
  if (u.pathname === '/files/company_tickers.json') return ok(Object.fromEntries((await mockTickers()).map((t, k) => [k, t])));
  if ((m = u.pathname.match(/^\/Archives\/edgar\/data\/(\d+)\/(\d+)\/[\w.-]+\.htm$/))) {
    const t = (await mockTickers()).find((x) => x.cik_str === Number(m[1]));
    return new Response(tenkHtml(t ? t.ticker : 'X'), { status: 200, headers: { 'content-type': 'text/html' } });
  }
  if ((m = u.pathname.match(/^\/submissions\/CIK(\d{10})\.json$/)) && m[1] !== '0000320193') {
    const cik = Number(m[1]);
    const t = (await mockTickers()).find((x) => x.cik_str === cik);
    const real = t && REAL[t.ticker];
    return ok({ name: t ? `${t.ticker} Mock Corp` : 'Unknown', sic: String(real?.sic ?? MOCK_SIC[t?.ticker] ?? 9999), sicDescription: real?.sicDescription ?? 'MOCK INDUSTRY', fiscalYearEnd: real?.fye ?? '1231', filings: { recent: { accessionNumber: [`000${cik}-25-000010`], filingDate: ['2025-02-14'], reportDate: ['2024-12-31'], form: ['10-K'], primaryDocument: [`${(t?.ticker || 'x').toLowerCase()}-20241231.htm`], primaryDocDescription: ['10-K'] } } });
  }
  if (u.pathname === '/submissions/CIK0000320193.json') {
    return ok({ name: 'Apple Inc.', sic: '3571', sicDescription: 'ELECTRONIC COMPUTERS', fiscalYearEnd: '0928', filings: { recent: {
      accessionNumber: ['0000320193-26-000105', '0000320193-26-000090', '0001140361-26-038000'], filingDate: ['2026-10-30', '2026-08-01', '2026-07-15'],
      reportDate: ['2026-09-27', '2026-06-28', ''], form: ['10-K', '10-Q', '4'], primaryDocument: ['aapl-20260927.htm', 'aapl-20260628.htm', 'xslF345X05/form4.xml'], primaryDocDescription: ['10-K', '10-Q', 'FORM 4'],
    } } });
  }
  return new Response('{}', { status: 404 });
}

function news(q, wantQuotes) {
  const now = Math.floor(Date.now() / 1000);
  const quotes = wantQuotes ? [{ symbol: q.toUpperCase(), shortname: `${q.toUpperCase()} Mock Inc`, quoteType: 'EQUITY', exchDisp: 'NASDAQ' }, { symbol: `${q.toUpperCase()}.TO`, shortname: `${q.toUpperCase()} Mock Canada`, quoteType: 'EQUITY', exchDisp: 'Toronto' }] : [];
  return { quotes, news: Array.from({ length: 8 }, (_, i) => ({ uuid: `${q}-${i}`, title: `Mock headline ${i + 1} about ${q}`, publisher: 'Mock Wire', link: 'https://example.com/story', providerPublishTime: now - i * 1800, relatedTickers: [q] })) };
}

// ---- official rates (Treasury CSV, ECB CSV, Frankfurter) and FRED ----------------------------

export const MOCK_FRED_KEY = 'abcdefghijklmnopqrstuvwxyz012345';

function businessDays(n) {
  const out = [];
  const d = new Date();
  while (out.length < n) {
    d.setUTCDate(d.getUTCDate() - 1);
    if (d.getUTCDay() % 6) out.push(new Date(d));
  }
  return out; // newest first
}

function treasuryCsv() {
  const cols = ['1 Mo', '1.5 Month', '2 Mo', '3 Mo', '4 Mo', '6 Mo', '1 Yr', '2 Yr', '3 Yr', '5 Yr', '7 Yr', '10 Yr', '20 Yr', '30 Yr'];
  const base = [4.6, 4.58, 4.55, 4.5, 4.45, 4.35, 4.2, 4.05, 4.0, 4.02, 4.1, 4.25, 4.55, 4.5];
  const rows = businessDays(150).map((d, i) => {
    const date = `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;
    return [date, ...base.map((b, k) => (k === 1 && i > 100 ? '' : (b + Math.sin(i / 9 + k) * 0.08).toFixed(2)))].join(',');
  });
  return `Date,${cols.map((c) => `"${c}"`).join(',')}\n${rows.join('\n')}\n`;
}

function ecbCsv() {
  const lines = ['KEY,FREQ,REF_AREA,CURRENCY,PROVIDER_FM,INSTRUMENT_FM,PROVIDER_FM_ID,DATA_TYPE_FM,TIME_PERIOD,OBS_VALUE,TITLE'];
  const lvl = { '3M': 2.0, '2Y': 2.1, '5Y': 2.3, '10Y': 2.6, '30Y': 2.9 };
  for (const g of ['G_N_A', 'G_N_C']) {
    for (const [t, b] of Object.entries(lvl)) {
      for (const [i, d] of businessDays(120).entries()) {
        const v = b + (g === 'G_N_C' ? 0.4 : 0) + Math.cos(i / 7) * 0.05;
        lines.push(`YC.B.U2.EUR.4F.${g}.SV_C_YM.SR_${t},B,U2,EUR,4F,${g},SV_C_YM,SR_${t},${d.toISOString().slice(0, 10)},${v.toFixed(6)},"Yield curve spot rate, ${t}"`);
      }
    }
  }
  return lines.join('\r\n');
}

function fred(u) {
  const key = u.searchParams.get('api_key');
  const bad = () => new Response(JSON.stringify({ error_code: 400, error_message: 'Bad Request.  The value for variable api_key is not registered.' }), { status: 400 });
  if (key !== MOCK_FRED_KEY) return bad();
  const p = u.pathname.replace('/fred', '');
  const id = u.searchParams.get('series_id');
  if (p === '/series') return ok({ seriess: [{ id }] });
  if (p === '/series/observations') {
    const lvl = { CPIAUCSL: 315, CPILFESL: 320, PCEPILFE: 124, PAYEMS: 159000, UNRATE: 4.1, ICSA: 220000, A191RL1Q225SBEA: 2.8, RSAFS: 710000, INDPRO: 103, HOUST: 1350, UMCSENT: 70, FEDFUNDS: 4.33 }[id] ?? 100;
    const growth = ['CPIAUCSL', 'CPILFESL', 'PCEPILFE', 'PAYEMS', 'RSAFS'].includes(id) ? 0.0025 : 0;
    const obs = Array.from({ length: 14 }, (_, i) => ({ date: `2026-${String(Math.max(1, 10 - i)).padStart(2, '0')}-01`, value: i === 13 && id === 'UMCSENT' ? '.' : String(+(lvl * (1 - growth * i) + (growth ? 0 : Math.sin(i) * lvl * 0.01)).toFixed(3)) }));
    return ok({ observations: obs });
  }
  if (p === '/series/release') return ok({ releases: [{ id: id.length, name: `${id} Release` }] });
  if (p === '/release/dates') {
    const day = (o) => new Date(Date.now() + o * 86400e3).toISOString().slice(0, 10);
    const rid = Number(u.searchParams.get('release_id'));
    return ok({ release_dates: [{ release_id: rid, date: day(rid % 9) }, { release_id: rid, date: day(-20 - rid) }, { release_id: rid, date: day(30) }] });
  }
  return new Response('{}', { status: 404 });
}

// ---- Finnhub -------------------------------------------------------------------------------

function finnhub(u) {
  const now = Math.floor(Date.now() / 1000);
  if (u.searchParams.get('token') !== 'mockkey12345') return new Response('{"error":"Invalid API key"}', { status: 401 });
  const p = u.pathname.replace('/api/v1', '');
  if (p === '/quote') return ok({ c: 228.1, d: 1.2, dp: 0.53, h: 229, l: 226, o: 227, pc: 226.9, t: now });
  const item = (i, cat, rel) => ({ category: cat, datetime: now - i * 900, headline: `Finnhub mock ${cat} story ${i + 1}`, id: 1000 + i + (rel ? rel.length * 100 : 0), image: '', related: rel || '', source: 'MockSource', summary: `Summary text for mock story ${i + 1}. It carries the first paragraph of the article.`, url: 'https://example.com/fh' });
  if (p === '/news') return ok(Array.from({ length: 6 }, (_, i) => item(i, u.searchParams.get('category'), i === 0 ? 'AAPL' : '')));
  if (p === '/company-news') return ok(Array.from({ length: 4 }, (_, i) => item(i, 'company', u.searchParams.get('symbol'))));
  if (p === '/calendar/earnings') {
    const today = new Date().toISOString().slice(0, 10);
    return ok({ earningsCalendar: [
      { date: today, epsActual: 1.65, epsEstimate: 1.6, hour: 'bmo', quarter: 3, revenueActual: 9.5e10, revenueEstimate: 9.4e10, symbol: 'AAPL', year: 2026 },
      { date: today, epsActual: null, epsEstimate: 3.1, hour: 'amc', quarter: 3, revenueActual: null, revenueEstimate: 6.5e10, symbol: 'MSFT', year: 2026 },
      { date: today, epsActual: null, epsEstimate: 0.5, hour: 'amc', quarter: 3, revenueActual: null, revenueEstimate: 1e9, symbol: 'ZZZZ', year: 2026 },
    ] });
  }
  if (p === '/stock/financials-reported') return ok({ symbol: u.searchParams.get('symbol'), data: u.searchParams.get('symbol') === 'AAPL' && u.searchParams.get('freq') === 'annual' ? finnhubAapl() : [] });
  const sym = u.searchParams.get('symbol') || '';
  // free-plan company data in Finnhub's documented shapes (percent values, volumes in millions, YYYY-MM-DD periods)
  if (p === '/stock/metric') return ok({ symbol: sym, metricType: 'all', metric: {
    '52WeekHigh': 260.1, '52WeekLow': 164.1, beta: 1.21, '10DayAverageTradingVolume': 48.2, '3MonthAverageTradingVolume': 55.4, marketCapitalization: 3480000, enterpriseValue: 3520000,
    peTTM: 36.2, pbQuarterly: 52.1, psTTM: 8.9, grossMarginTTM: 46.2, operatingMarginTTM: 31.5, netProfitMarginTTM: 26.4, roeTTM: 150.8, roaTTM: 22.6, currentRatioQuarterly: 0.87, quickRatioQuarterly: 0.83,
    epsTTM: 6.31, bookValuePerShareQuarterly: 4.38, 'totalDebt/totalEquityQuarterly': 1.67, dividendPerShareAnnual: 1.0, dividendYieldIndicatedAnnual: 0.44, payoutRatioTTM: 15.8,
    revenueGrowthTTMYoy: 5.1, epsGrowthTTMYoy: 9.4, '52WeekPriceReturnDaily': 18.7 }, series: {} });
  if (p === '/stock/recommendation') return ok([
    { buy: 22, hold: 15, period: '2026-11-01', sell: 2, strongBuy: 12, strongSell: 1, symbol: sym },
    { buy: 21, hold: 16, period: '2026-10-01', sell: 2, strongBuy: 11, strongSell: 1, symbol: sym }]);
  if (p === '/stock/earnings') return ok([
    { actual: 1.65, estimate: 1.6, period: '2026-09-30', quarter: 3, surprise: 0.05, surprisePercent: 3.125, symbol: sym, year: 2026 },
    { actual: 1.4, estimate: 1.43, period: '2026-06-30', quarter: 2, surprise: -0.03, surprisePercent: -2.0979, symbol: sym, year: 2026 },
    { actual: 2.4, estimate: 2.31, period: '2026-03-31', quarter: 1, surprise: 0.09, surprisePercent: 3.8961, symbol: sym, year: 2026 },
    { actual: 1.64, estimate: 1.6, period: '2025-12-31', quarter: 4, surprise: 0.04, surprisePercent: 2.5, symbol: sym, year: 2025 }]);
  if (p === '/stock/insider-transactions') return ok({ symbol: sym, data: [
    { name: 'Mock CEO', share: 3280000, change: -45000, filingDate: '2026-11-05', transactionDate: '2026-11-03', transactionCode: 'S', transactionPrice: 228.4 },
    { name: 'Mock Director', share: 51000, change: 2000, filingDate: '2026-10-20', transactionDate: '2026-10-17', transactionCode: 'P', transactionPrice: 219.8 },
    { name: 'Mock CFO', share: 120000, change: 18000, filingDate: '2026-10-02', transactionDate: '2026-10-01', transactionCode: 'A', transactionPrice: 0 },
    { name: 'Mock COO', share: 90000, change: -9000, filingDate: '2026-10-02', transactionDate: '2026-10-01', transactionCode: 'F', transactionPrice: 225.0 }] });
  if (p === '/stock/profile2') return ok({ country: 'US', currency: 'USD', exchange: 'NASDAQ NMS - GLOBAL MARKET', finnhubIndustry: 'Technology', ipo: '1980-12-12', marketCapitalization: 3480000, name: 'Mock Company Inc', shareOutstanding: 15200, ticker: sym, weburl: 'https://example.com/' });
  if (p === '/calendar/economic') return new Response('{"error":"You don\'t have access to this resource."}', { status: 403 });
  return new Response('not found', { status: 404 });
}

// Finnhub "as reported" 10-Ks for AAPL: the same figures as the SEC test data (as originally
// filed, before the 2020 split), plus Apple's published FY2015-2017 balance sheets, which the SEC
// test data leaves out, so the fallback has old gaps to fill and FY2018 to cross-check against.
const AAPL_OLD_BS = { CashAndCashEquivalentsAtCarryingValue: [21120, 20484, 20289], MarketableSecuritiesCurrent: [20481, 46671, 53892], LongTermDebtNoncurrent: [53463, 75427, 97207],
  LongTermDebtCurrent: [2500, 3500, 6496], CommercialPaper: [8499, 8105, 11977], StockholdersEquity: [119355, 128249, 134047], CommonStockSharesOutstanding: [5578.753, 5336.166, 5126.201] };
function finnhubAapl() {
  const r = REAL.AAPL;
  return r.ends.map((end, k) => {
    const filed = new Date(Date.parse(end) + 35 * 86400e3).toISOString().slice(0, 10);
    const item = (tag, v) => ({ concept: `us-gaap_${tag}`, unit: 'usd', label: tag, value: /PerShare/.test(tag) ? v : v * 1e6 });
    const ic = Object.entries(r.d).filter(([, vals]) => vals[k] != null).map(([tag, vals]) => item(tag, vals[k]));
    const bs = Object.entries(r.i).filter(([, vals]) => vals[k] != null).map(([tag, vals]) => item(tag, vals[k]));
    if (k < 3) for (const [tag, vals] of Object.entries(AAPL_OLD_BS)) bs.push(item(tag, vals[k]));
    return { accessNumber: `0000320193-${k}`, symbol: 'AAPL', cik: '320193', year: Number(end.slice(0, 4)), quarter: 0, form: '10-K', startDate: `${new Date(Date.parse(end) - 364 * 86400e3).toISOString().slice(0, 10)} 00:00:00`, endDate: `${end} 00:00:00`, filedDate: `${filed} 00:00:00`, report: { ic, cf: [], bs } };
  });
}

// Fake Finnhub trade stream: a trade for a random subscribed symbol every ~300 ms.
export class MockWebSocket {
  constructor(url) {
    if (new URL(url).hostname === 'stream.aisstream.io') return new MockAis();
    this.readyState = 0;
    this.subs = new Set();
    this.ok = new URL(url).searchParams.get('token') === 'mockkey12345';
    setTimeout(() => {
      if (!this.ok) {
        this.onmessage?.({ data: JSON.stringify({ type: 'error', msg: 'Invalid API key' }) });
        return this.close();
      }
      this.readyState = 1;
      this.onopen?.();
      this.timer = setInterval(() => {
        const list = [...this.subs];
        if (!list.length) return;
        const s = list[Math.floor(Math.random() * list.length)];
        const p = (BASE[s] ?? (s.startsWith('BINANCE:') ? 68000 : base(s))) * (1 + (Math.random() - 0.5) * 0.002);
        this.onmessage?.({ data: JSON.stringify({ type: 'trade', data: [{ s, p, v: Math.ceil(Math.random() * 500), t: Date.now(), c: ['1'] }] }) });
      }, 300);
    }, 50);
  }
  send(msg) {
    const m = JSON.parse(msg);
    if (m.type === 'subscribe') this.subs.add(m.symbol);
    if (m.type === 'unsubscribe') this.subs.delete(m.symbol);
  }
  close() {
    clearInterval(this.timer);
    this.readyState = 3;
    this.onclose?.();
  }
}


// ---- ships (AISStream and Digitraffic stand-ins) ------------------------------------------------------
// A made-up fleet along the real sea lanes, so SHIPS can be tested offline. Not real vessels.
export const MOCK_AIS_KEY = 'mockaiskey1234567';
const LANES = [
  [[-74, 40.5], [-60, 41], [-40, 46], [-20, 49], [-5, 49.6], [1.5, 51]], // New York - English Channel
  [[1.5, 51], [4, 52], [8, 54]], [[-6, 36], [10, 37.5], [25, 34], [32.5, 31.3]], // Channel, Gibraltar - Suez
  [[32.5, 29.9], [34, 27], [43, 13], [52, 12.5], [60, 20], [72, 18], [80, 8], [95, 5.5], [101, 2.5], [104, 1.2]], // Suez - Singapore
  [[104, 1.2], [110, 10], [114, 22], [122, 31], [130, 33], [141, 35.5]], // Singapore - Japan
  [[141, 35.5], [170, 42], [-170, 45], [-140, 40], [-125, 36], [-118, 33.7]], // Japan - Los Angeles
  [[-118, 33.7], [-110, 22], [-90, 8], [-79.5, 8.9]], [[-79.5, 9.3], [-70, 15], [-80, 25], [-76, 36], [-74, 40.5]], // Panama
  [[-46, -23.9], [-35, -8], [-25, 5], [-17, 14.7]], [[18.4, -34], [10, -20], [5, 2], [-5, 5]], // Brazil, West Africa
  [[100, 13], [108, 10], [104, 1.2]], [[151, -33.8], [153, -27], [145, -14], [130, -10], [116, -20]], // Thailand, Australia
  [[56, 26], [60, 24.5], [72, 18], [72.8, 19]], [[-90, 29], [-85, 26], [-80, 25]], // Gulf, Mexico Gulf
  [[23, 60], [20, 58], [14, 55], [10, 56.5], [8, 54]], // Baltic
];
const WORDS = ['ATLANTIC', 'PACIFIC', 'NORDIC', 'ORIENT', 'GLOBAL', 'STAR', 'HARBOUR', 'OCEAN', 'GRAND', 'BLUE', 'IRON', 'SILVER', 'NORTHERN', 'EASTERN', 'MARINE', 'TRADER'];
const NOUNS = ['SPIRIT', 'VOYAGER', 'PRIDE', 'GLORY', 'PIONEER', 'CARRIER', 'EXPRESS', 'HOPE', 'TIDE', 'WAVE', 'FORTUNE', 'LEGEND'];
const DESTS = ['ROTTERDAM', 'SINGAPORE', 'SHANGHAI', 'LOS ANGELES', 'HAMBURG', 'DUBAI', 'NEW YORK', 'BUSAN', 'ANTWERP', 'SANTOS'];
function mockFleet(n = 3200) {
  const r = rng(424242);
  const out = [];
  for (let i = 0; i < n; i++) {
    const lane = LANES[Math.floor(r() * LANES.length)];
    const k = Math.floor(r() * (lane.length - 1));
    const f = r();
    const a = lane[k];
    const b = lane[k + 1];
    const roll = r();
    const type = roll < 0.4 ? 70 + Math.floor(r() * 10) : roll < 0.62 ? 80 + Math.floor(r() * 10) : roll < 0.67 ? 60 + Math.floor(r() * 10) : roll < 0.77 ? 30 : roll < 0.82 ? 52 : roll < 0.9 ? 36 : roll < 0.92 ? 35 : 90;
    out.push({
      mmsi: 200000000 + Math.floor(r() * 599999999), imo: 9000000 + Math.floor(r() * 999999), type,
      name: `${WORDS[Math.floor(r() * WORDS.length)]} ${NOUNS[Math.floor(r() * NOUNS.length)]}`,
      lat: a[1] + (b[1] - a[1]) * f + (r() - 0.5) * 2.4, lon: a[0] + (b[0] - a[0]) * f + (r() - 0.5) * 2.4,
      sog: type === 30 || type === 52 ? 3 + r() * 5 : 8 + r() * 14, cog: Math.floor(r() * 360), dest: DESTS[Math.floor(r() * DESTS.length)],
    });
  }
  return out;
}

class MockAis {
  constructor() {
    this.readyState = 0;
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
    }, 30);
  }
  send(msg) {
    const sub = JSON.parse(msg);
    if (sub.APIKey !== MOCK_AIS_KEY) {
      setTimeout(() => {
        this.emit({ error: 'Api Key Is Not Valid' });
        this.close();
      }, 30);
      return;
    }
    const fleet = mockFleet();
    let i = 0;
    this.timer = setInterval(() => {
      for (let k = 0; k < 250 && i < fleet.length; k++, i++) {
        const v = fleet[i];
        const meta = { MMSI: v.mmsi, ShipName: `${v.name}@@ `, latitude: v.lat, longitude: v.lon, time_utc: new Date().toISOString() };
        this.emit({ MessageType: 'ShipStaticData', MetaData: meta, Message: { ShipStaticData: { ImoNumber: v.imo, Name: v.name, Type: v.type, Destination: `${v.dest}@@`, CallSign: 'MOCK' } } });
        this.emit({ MessageType: 'PositionReport', MetaData: meta, Message: { PositionReport: { Sog: v.sog, Cog: v.cog, TrueHeading: v.cog, NavigationalStatus: 0, Latitude: v.lat, Longitude: v.lon } } });
      }
      if (i >= fleet.length) {
        // afterwards: a few ships keep moving
        for (let k = 0; k < 20; k++) {
          const v = fleet[Math.floor(Math.random() * fleet.length)];
          v.lon += 0.02;
          this.emit({ MessageType: 'PositionReport', MetaData: { MMSI: v.mmsi, ShipName: v.name, latitude: v.lat, longitude: v.lon }, Message: { PositionReport: { Sog: v.sog, Cog: v.cog, TrueHeading: 511, NavigationalStatus: 0 } } });
        }
      }
    }, 40);
  }
  // AISStream sends binary frames, which a browser hands over as a Blob
  emit(o) {
    if (this.readyState === 1) this.onmessage?.({ data: new Blob([JSON.stringify(o)]) });
  }
  close() {
    clearInterval(this.timer);
    this.readyState = 3;
    this.onclose?.();
  }
}

function digitraffic(u) {
  if (process.env.MERIDIAN_MOCK_NO_DIGI) return new Response('Service Unavailable', { status: 503 });
  const fleet = mockFleet(400).filter((v) => v.lon > 8 && v.lon < 31 && v.lat > 53 && v.lat < 66).slice(0, 150);
  if (u.pathname.endsWith('/locations')) {
    return ok({ type: 'FeatureCollection', dataUpdatedTime: new Date().toISOString(), features: fleet.map((v) => ({ type: 'Feature', mmsi: v.mmsi, geometry: { type: 'Point', coordinates: [v.lon, v.lat] }, properties: { mmsi: v.mmsi, sog: v.sog, cog: v.cog, navStat: 0, heading: 511, timestamp: 1700000000000, timestampExternal: Date.now() } })) });
  }
  return ok(fleet.map((v) => ({ mmsi: v.mmsi, name: v.name, imo: v.imo, shipType: v.type, destination: v.dest, callSign: 'MOCK' })));
}

const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', 'set-cookie': 'A3=mock; Path=/' } });

export async function mockFetch(url) {
  const u = new URL(url);
  if (u.hostname === 'raw.githubusercontent.com') return new Response('2026.12.31.1\n', { status: 200 }); // STATUS's update check (test value)
  if (u.hostname === 'finnhub.io') return finnhub(u);
  if (u.hostname === 'meri.digitraffic.fi') return digitraffic(u);
  if (u.hostname === 'home.treasury.gov') return new Response(treasuryCsv(), { status: 200 });
  if (u.hostname === 'data-api.ecb.europa.eu') return new Response(ecbCsv(), { status: 200 });
  if (u.hostname === 'api.frankfurter.dev') return ok({ amount: 1, base: 'USD', date: '2026-10-30', rates: { EUR: 0.925, JPY: 151.3, KRW: 1360.5, CNY: 7.21, GBP: 0.78 } });
  if (u.hostname === 'api.stlouisfed.org') return fred(u);
  if (u.hostname === 'www.sec.gov' || u.hostname === 'data.sec.gov') return sec(u);
  if (u.pathname.startsWith('/ws/fundamentals-timeseries/')) return process.env.MERIDIAN_MOCK_THROTTLE ? new Response('Too Many Requests', { status: 429 }) : ok(timeseries(u));
  if (u.hostname === 'fc.yahoo.com') return new Response('', { status: 404, headers: { 'set-cookie': 'A3=mock; Path=/' } });
  if (u.pathname === '/v1/test/getcrumb') return new Response('mockcrumb', { status: 200 });
  let m;
  if ((m = u.pathname.match(/^\/v8\/finance\/chart\/(.+)$/)) && decodeURIComponent(m[1]) === 'KRW=X' && u.searchParams.get('range') === '1d') return new Response('{}', { status: 500 });
  if ((m = u.pathname.match(/^\/v8\/finance\/chart\/(.+)$/))) return ok(chart(decodeURIComponent(m[1]), u.searchParams.get('range'), u.searchParams.get('interval')));
  if (u.pathname === '/v7/finance/quote') return ok(quote(u.searchParams.get('symbols').split(',').filter((x) => x !== 'KRW=X')));
  if ((m = u.pathname.match(/^\/v7\/finance\/options\/(.+)$/))) return ok(options(decodeURIComponent(m[1])));
  // MERIDIAN_MOCK_THROTTLE=1 answers 429 on the statistics page, as a throttled Yahoo does, to test the gap-filling fallback
  if (process.env.MERIDIAN_MOCK_THROTTLE && /^\/v10\/finance\/quoteSummary\//.test(u.pathname)) return new Response('Too Many Requests', { status: 429 });
  if ((m = u.pathname.match(/^\/v10\/finance\/quoteSummary\/(.+)$/))) return ok(summary(decodeURIComponent(m[1])));
  if (u.pathname === '/v1/finance/search') return ok(news(u.searchParams.get('q'), Number(u.searchParams.get('quotesCount')) > 0));
  return new Response('not found', { status: 404 });
}
