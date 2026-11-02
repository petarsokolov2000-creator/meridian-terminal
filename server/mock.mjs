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

function summary(s) {
  const v = (x) => ({ raw: x, fmt: String(x) });
  return {
    quoteSummary: {
      result: [{
        secFilings: { filings: [{ date: '2026-10-30', epochDate: 1793318400, type: '10-K', title: 'Annual report', edgarUrl: 'https://finance.yahoo.com/sec-filing/mock/10k' }, { date: '2026-08-01', epochDate: 1785542400, type: '10-Q', title: 'Quarterly report', edgarUrl: 'https://finance.yahoo.com/sec-filing/mock/10q' }] },
        quoteType: { longName: `${s} Mock Corp` },
        assetProfile: { longBusinessSummary: `${s} Mock Corp makes mock products for testing.`, sector: 'Technology', industry: 'Software', fullTimeEmployees: 12000, country: 'United States', website: 'https://example.com' },
        financialData: { targetMeanPrice: v(base(s) * 1.1), targetHighPrice: v(base(s) * 1.4), targetLowPrice: v(base(s) * 0.8), recommendationMean: v(2.1), recommendationKey: 'buy', numberOfAnalystOpinions: v(30), totalRevenue: v(3.9e11), revenueGrowth: v(0.06), grossMargins: v(0.46), operatingMargins: v(0.31), ebitdaMargins: v(0.34), profitMargins: v(0.25), ebitda: v(1.3e11), totalDebt: v(1.0e11), totalCash: v(6e10), freeCashflow: v(1.0e11), returnOnEquity: v(1.5), debtToEquity: v(150) },
        recommendationTrend: { trend: [{ period: '0m', strongBuy: 10, buy: 20, hold: 12, sell: 2, strongSell: 1 }] },
        upgradeDowngradeHistory: { history: [{ epochGradeDate: Math.floor(Date.now() / 1000) - 86400 * 3, firm: 'Mock Securities', toGrade: 'Buy', fromGrade: 'Hold', action: 'up', currentPriceTarget: base(s) * 1.2 }, { epochGradeDate: Math.floor(Date.now() / 1000) - 86400 * 9, firm: 'Needham', toGrade: 'Hold', fromGrade: 'Hold', action: 'main', currentPriceTarget: 0 }] },
        incomeStatementHistory: { incomeStatementHistory: [2025, 2024, 2023, 2022].map((y) => ({ endDate: v(Date.UTC(y, 8, 30) / 1000), totalRevenue: v(3.9e11 - (2025 - y) * 1e10), grossProfit: v(1.8e11), operatingIncome: v(1.2e11), netIncome: v(9.7e10), ebit: v(1.2e11) })) },
        calendarEvents: { earnings: { earningsDate: [v(Math.floor(Date.now() / 1000) + 86400 * 10)], earningsAverage: v(1.6), revenueAverage: v(9.4e10) } },
        earningsHistory: { history: [['4q', 1.4, 1.35], ['3q', 1.53, 1.5], ['2q', 1.4, 1.43], ['1q', 1.65, 1.6]].map(([p, a, e], i) => ({ period: `-${p}`, quarter: v(Math.floor(Date.UTC(2025, 9 + i * 3, 1) / 1000)), epsActual: v(a), epsEstimate: v(e), surprisePercent: v((a - e) / e) })) },
        earningsTrend: { trend: [['0q', 1.7], ['+1q', 1.85], ['0y', 7.1], ['+1y', 7.9]].map(([p, e]) => ({ period: p, endDate: '2026-12-31', growth: v(0.08), earningsEstimate: { avg: v(e), low: v(e * 0.9), high: v(e * 1.1), numberOfAnalysts: v(28), yearAgoEps: v(e * 0.92) }, revenueEstimate: { avg: v(e * 5.6e10), low: v(e * 5.2e10), high: v(e * 6e10), numberOfAnalysts: v(25), yearAgoRevenue: v(e * 5.1e10) } })) },
        majorHoldersBreakdown: { insidersPercentHeld: v(0.021), institutionsPercentHeld: v(0.612), institutionsFloatPercentHeld: v(0.625), institutionsCount: v(6800) },
        institutionOwnership: { ownershipList: [['Vanguard Group Inc', 0.092], ['Blackrock Inc.', 0.071], ['State Street Corp', 0.038]].map(([o, p]) => ({ organization: o, pctHeld: v(p), position: v(p * 1.5e10), value: v(p * 3.4e12), reportDate: v(Math.floor(Date.UTC(2026, 5, 30) / 1000)) })) },
        fundOwnership: { ownershipList: [{ organization: 'Vanguard Total Stock Market Index Fund', pctHeld: v(0.03), position: v(4.5e8), value: v(1e11), reportDate: v(Math.floor(Date.UTC(2026, 5, 30) / 1000)) }] },
        insiderTransactions: { transactions: [{ filerName: 'COOK TIMOTHY D', filerRelation: 'Chief Executive Officer', transactionText: 'Sale at price 228.00 per share.', startDate: v(Math.floor(Date.UTC(2026, 9, 2) / 1000)), shares: v(108136), value: v(24655008) }] },
        defaultKeyStatistics: { priceToBook: v(50), enterpriseValue: v(3.5e12), enterpriseToEbitda: v(26), enterpriseToRevenue: v(9), forwardPE: v(30), pegRatio: v(2.1), sharesOutstanding: v(1.5e10), floatShares: v(1.49e10), sharesShort: v(1.2e8), shortRatio: v(2.1), shortPercentOfFloat: v(0.008), sharesShortPriorMonth: v(1.1e8), bookValue: v(4.6), trailingEps: v(6.1), forwardEps: v(7.1), '52WeekChange': v(0.18), lastSplitFactor: '4:1', lastSplitDate: v(1598832000), lastFiscalYearEnd: v(1790985600), mostRecentQuarter: v(1790985600) },
        summaryDetail: { beta: v(1.2), marketCap: v(3.4e12), trailingPE: v(37), forwardPE: v(30), priceToSalesTrailing12Months: v(8.7), fiftyTwoWeekHigh: v(260), fiftyTwoWeekLow: v(169), fiftyDayAverage: v(225), twoHundredDayAverage: v(215), averageVolume: v(5.2e7), averageVolume10days: v(4.8e7), dividendRate: v(1.04), dividendYield: v(0.0046), payoutRatio: v(0.16), exDividendDate: v(1793318400), fiveYearAvgDividendYield: v(0.56) },
      }],
      error: null,
    },
  };
}

function timeseries(u) {
  const types = (u.searchParams.get('type') || '').split(',').filter(Boolean);
  const quarterly = types[0]?.startsWith('quarterly');
  const dates = quarterly
    ? ['2024-09-30', '2024-12-31', '2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31', '2026-03-31', '2026-06-30', '2026-09-30']
    : ['2021-09-30', '2022-09-30', '2023-09-30', '2024-09-30', '2025-09-30', '2026-09-30'];
  const base = { TotalRevenue: 3.9e11, CostOfRevenue: 2.1e11, GrossProfit: 1.8e11, OperatingIncome: 1.2e11, NetIncome: 9.7e10, DilutedEPS: 6.1, TotalAssets: 3.5e11, StockholdersEquity: 7e10, OperatingCashFlow: 1.1e11, CapitalExpenditure: -1.1e10, FreeCashFlow: 9.9e10 };
  const result = types.map((t) => {
    const name = t.replace(/^(annual|quarterly)/, '');
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
      PaymentsToAcquirePropertyPlantAndEquipment: [21919, 24306], EarningsPerShareDiluted: [8.89, 7.84], WeightedAverageNumberOfDilutedSharesOutstanding: [4052, 4299] },
    i: { CashAndCashEquivalentsAtCarryingValue: [31539, 23029], LongTermDebtNoncurrent: [37483, 36755], ShortTermBorrowings: [4090, 4955], StockholdersEquity: [204802, 263705], CommonStockSharesOutstanding: [3973, 4343] },
  },
  JPM: { cik: 19617, sic: 6021, sicDescription: 'NATIONAL COMMERCIAL BANKS', fye: '1231', ends: ['2023-12-31', '2024-12-31'],
    d: { RevenuesNetOfInterestExpense: [158104, 177556], NetIncomeLoss: [49552, 58471], EarningsPerShareDiluted: [16.23, 19.75], CommonStockDividendsPerShareDeclared: [4.10, 4.80], WeightedAverageNumberOfDilutedSharesOutstanding: [2943, 2897] },
    i: { StockholdersEquity: [327878, 344758], PreferredStockValue: [27404, 20050], Goodwill: [52634, 52565], CommonStockSharesOutstanding: [2875, 2797] },
  },
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
  const isDur = !/^(Cash|Marketable|LongTermDebt|Commercial|ShortTerm|Stockholders|Preferred|Goodwill|CommonStockShares|Intangible)/.test(tag);
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
    return rows.length ? { cik, taxonomy: 'us-gaap', tag, units: { [unit]: rows } } : null;
  }
  // generated: 12 fiscal years ending 31 Dec, steady growth with noise
  const r = rng(seedOf(`${cik}${tag}`));
  const want = { RevenueFromContractWithCustomerExcludingAssessedTax: 40000, OperatingIncomeLoss: 8000, NetIncomeLoss: 6000, DepreciationDepletionAndAmortization: 1500, NetCashProvidedByUsedInOperatingActivities: 9000,
    PaymentsToAcquirePropertyPlantAndEquipment: 2000, EarningsPerShareDiluted: 4, WeightedAverageNumberOfDilutedSharesOutstanding: 1500, CashAndCashEquivalentsAtCarryingValue: 5000, LongTermDebt: 12000,
    StockholdersEquity: 20000, CommonStockSharesOutstanding: 1480, InterestExpense: 400, IncomeTaxExpenseBenefit: 1300, ShareBasedCompensation: 600, PaymentsForRepurchaseOfCommonStock: 2500, PaymentsOfDividends: 1500 }[tag];
  if (!want) return null;
  for (let k = 0; k < 12; k++) {
    const yr = 2014 + k;
    const g = tag.startsWith('Weighted') || tag.startsWith('CommonStockShares') ? 1 - 0.01 * k : (1 + 0.07) ** k;
    push(isDur ? `${yr}-01-01` : null, `${yr}-12-31`, want * g * (0.9 + r() * 0.2), `${yr + 1}-02-15`);
  }
  return { cik, taxonomy: 'us-gaap', tag, units: { [unit]: rows } };
}

async function sec(u) {
  // MERIDIAN_MOCK_SEC=403 imitates the SEC refusing automated requests
  if (process.env.MERIDIAN_MOCK_SEC) return new Response('Forbidden', { status: Number(process.env.MERIDIAN_MOCK_SEC) });
  let m;
  if ((m = u.pathname.match(/^\/api\/xbrl\/companyconcept\/CIK(\d{10})\/us-gaap\/(\w+)\.json$/))) {
    const j = secConcept(Number(m[1]), m[2]);
    return j ? ok(j) : new Response('{}', { status: 404 });
  }
  if (u.pathname === '/files/company_tickers.json') return ok(Object.fromEntries((await mockTickers()).map((t, k) => [k, t])));
  if ((m = u.pathname.match(/^\/submissions\/CIK(\d{10})\.json$/)) && m[1] !== '0000320193') {
    const cik = Number(m[1]);
    const t = (await mockTickers()).find((x) => x.cik_str === cik);
    const real = t && REAL[t.ticker];
    return ok({ name: t ? `${t.ticker} Mock Corp` : 'Unknown', sic: String(real?.sic ?? MOCK_SIC[t?.ticker] ?? 9999), sicDescription: real?.sicDescription ?? 'MOCK INDUSTRY', fiscalYearEnd: real?.fye ?? '1231', filings: { recent: {} } });
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
  if (p === '/calendar/economic') return new Response('{"error":"You don\'t have access to this resource."}', { status: 403 });
  return new Response('not found', { status: 404 });
}

// Fake Finnhub trade stream: a trade for a random subscribed symbol every ~300 ms.
export class MockWebSocket {
  constructor(url) {
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

const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', 'set-cookie': 'A3=mock; Path=/' } });

export async function mockFetch(url) {
  const u = new URL(url);
  if (u.hostname === 'finnhub.io') return finnhub(u);
  if (u.hostname === 'home.treasury.gov') return new Response(treasuryCsv(), { status: 200 });
  if (u.hostname === 'data-api.ecb.europa.eu') return new Response(ecbCsv(), { status: 200 });
  if (u.hostname === 'api.frankfurter.dev') return ok({ amount: 1, base: 'USD', date: '2026-10-30', rates: { EUR: 0.925, JPY: 151.3, KRW: 1360.5, CNY: 7.21, GBP: 0.78 } });
  if (u.hostname === 'api.stlouisfed.org') return fred(u);
  if (u.hostname === 'www.sec.gov' || u.hostname === 'data.sec.gov') return sec(u);
  if (u.pathname.startsWith('/ws/fundamentals-timeseries/')) return ok(timeseries(u));
  if (u.hostname === 'fc.yahoo.com') return new Response('', { status: 404, headers: { 'set-cookie': 'A3=mock; Path=/' } });
  if (u.pathname === '/v1/test/getcrumb') return new Response('mockcrumb', { status: 200 });
  let m;
  if ((m = u.pathname.match(/^\/v8\/finance\/chart\/(.+)$/)) && decodeURIComponent(m[1]) === 'KRW=X' && u.searchParams.get('range') === '1d') return new Response('{}', { status: 500 });
  if ((m = u.pathname.match(/^\/v8\/finance\/chart\/(.+)$/))) return ok(chart(decodeURIComponent(m[1]), u.searchParams.get('range'), u.searchParams.get('interval')));
  if (u.pathname === '/v7/finance/quote') return ok(quote(u.searchParams.get('symbols').split(',').filter((x) => x !== 'KRW=X')));
  if ((m = u.pathname.match(/^\/v7\/finance\/options\/(.+)$/))) return ok(options(decodeURIComponent(m[1])));
  if ((m = u.pathname.match(/^\/v10\/finance\/quoteSummary\/(.+)$/))) return ok(summary(decodeURIComponent(m[1])));
  if (u.pathname === '/v1/finance/search') return ok(news(u.searchParams.get('q'), Number(u.searchParams.get('quotesCount')) > 0));
  return new Response('not found', { status: 404 });
}
