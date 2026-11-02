// Real market data from Yahoo Finance's public JSON endpoints, normalized into the small
// shapes the terminal uses. Browsers can't call Yahoo directly (CORS), so serve.mjs runs
// this on the PC. Quotes, options and fundamentals need Yahoo's session cookie + crumb,
// which this module collects the way a browser would.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const Q1 = 'https://query1.finance.yahoo.com';
const Q2 = 'https://query2.finance.yahoo.com';

export class YahooError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function createYahoo({ fetchImpl = fetch } = {}) {
  const jar = new Map();
  let crumb = null;
  const cache = new Map();

  async function request(url) {
    const headers = { 'user-agent': UA, accept: 'application/json,text/plain,*/*' };
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetchImpl(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    for (const c of res.headers.getSetCookie?.() || []) {
      const [pair] = c.split(';');
      const eq = pair.indexOf('=');
      if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    return { status: res.status, text: await res.text() };
  }

  async function json(url) {
    const r = await request(url);
    if (r.status !== 200) throw new YahooError(`Yahoo answered ${r.status}`, r.status);
    try {
      return JSON.parse(r.text);
    } catch {
      throw new YahooError('Yahoo sent something that is not JSON', 502);
    }
  }

  async function getCrumb(refresh) {
    if (crumb && !refresh && Date.now() - crumb.at < 60 * 60e3) return crumb.value;
    await request('https://fc.yahoo.com/').catch(() => null); // only sets the session cookie
    const r = await request(`${Q2}/v1/test/getcrumb`);
    const value = String(r.text || '').trim();
    if (r.status !== 200 || !value || value.includes('<')) throw new YahooError('Yahoo refused to issue a session crumb', r.status || 502);
    crumb = { value, at: Date.now() };
    return value;
  }

  // For endpoints that need the crumb: retry once with a fresh one on 401/403.
  async function withCrumb(make) {
    try {
      return await json(make(await getCrumb(false)));
    } catch (err) {
      if (err.status !== 401 && err.status !== 403) throw err;
      return json(make(await getCrumb(true)));
    }
  }

  function cached(key, ttl, fn) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.p;
    const p = fn().catch((err) => {
      cache.delete(key);
      throw err;
    });
    cache.set(key, { at: Date.now(), p });
    return p;
  }

  const raw = (v) => (v && typeof v === 'object' ? (Number.isFinite(v.raw) ? v.raw : null) : Number.isFinite(v) ? v : null);
  const n = (v) => (Number.isFinite(v) ? v : null);

  // ---- charts ------------------------------------------------------------------------------

  async function chart(symbol, range, interval) {
    const key = `chart:${symbol}:${range}:${interval}`;
    const ttl = interval === '1d' ? 30 * 60e3 : 45e3;
    return cached(key, ttl, async () => {
      const data = await json(`${Q1}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`);
      const res = data?.chart?.result?.[0];
      if (!res) throw new YahooError(data?.chart?.error?.description || `No chart for ${symbol}`, 404);
      return normalizeChart(res, interval);
    });
  }

  function normalizeChart(res, interval) {
    const m = res.meta || {};
    const ts = res.timestamp || [];
    const q = res.indicators?.quote?.[0] || {};
    const bars = [];
    for (let i = 0; i < ts.length; i++) {
      const c = q.close?.[i];
      if (!Number.isFinite(c)) continue; // Yahoo pads gaps with nulls
      const o = n(q.open?.[i]) ?? c;
      bars.push({ ts: ts[i], o, h: n(q.high?.[i]) ?? Math.max(o, c), l: n(q.low?.[i]) ?? Math.min(o, c), c, v: n(q.volume?.[i]) ?? 0 });
    }
    const tz = m.exchangeTimezoneName || 'America/New_York';
    const day = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t * 1000));
    if (interval === '1d') for (const b of bars) b.t = day(b.ts);
    return {
      meta: {
        symbol: m.symbol, currency: m.currency, name: m.longName || m.shortName || m.symbol, type: m.instrumentType,
        price: n(m.regularMarketPrice), prevClose: n(m.chartPreviousClose ?? m.previousClose), high: n(m.regularMarketDayHigh), low: n(m.regularMarketDayLow),
        volume: n(m.regularMarketVolume), hi52: n(m.fiftyTwoWeekHigh), lo52: n(m.fiftyTwoWeekLow), time: n(m.regularMarketTime), tz,
        session: m.currentTradingPeriod?.regular ? { start: m.currentTradingPeriod.regular.start, end: m.currentTradingPeriod.regular.end } : null,
      },
      bars,
    };
  }

  // ---- quotes (batched; falls back to chart metadata when the quote API refuses) -----------

  async function quotes(symbols, { fallback = true } = {}) {
    const out = {};
    const chunks = [];
    for (let i = 0; i < symbols.length; i += 50) chunks.push(symbols.slice(i, i + 50));
    let failed = false;
    for (const chunk of chunks) {
      try {
        const data = await cached(`q:${chunk.join(',')}`, 10e3, () => withCrumb((c) => `${Q1}/v7/finance/quote?symbols=${encodeURIComponent(chunk.join(','))}&crumb=${encodeURIComponent(c)}`));
        for (const r of data?.quoteResponse?.result || []) out[r.symbol] = normalizeQuote(r);
      } catch {
        failed = true;
      }
    }
    const missing = symbols.filter((s) => !out[s]);
    if (missing.length && fallback) {
      // Slower path: one chart call per symbol, a few at a time.
      await pool(missing, 6, async (s) => {
        try {
          const ch = await chart(s, '1d', '5m');
          const m = ch.meta;
          const first = ch.bars[0];
          out[s] = { symbol: s, name: m.name, currency: m.currency, price: m.price, prevClose: m.prevClose, open: first?.o ?? null, high: m.high, low: m.low, volume: m.volume, hi52: m.hi52, lo52: m.lo52, time: m.time, source: 'chart' };
        } catch {
          // leave it out; the client keeps its last value
        }
      });
    }
    return { quotes: out, degraded: failed };
  }

  function normalizeQuote(r) {
    const divY = n(r.trailingAnnualDividendYield) != null ? r.trailingAnnualDividendYield * 100 : n(r.dividendYield);
    return {
      symbol: r.symbol, name: r.longName || r.shortName || r.symbol, currency: r.currency, type: r.quoteType,
      price: n(r.regularMarketPrice), prevClose: n(r.regularMarketPreviousClose), open: n(r.regularMarketOpen),
      high: n(r.regularMarketDayHigh), low: n(r.regularMarketDayLow), volume: n(r.regularMarketVolume), avgVolume: n(r.averageDailyVolume3Month),
      bid: n(r.bid) || null, ask: n(r.ask) || null, bidSize: n(r.bidSize), askSize: n(r.askSize),
      marketCap: n(r.marketCap), shares: n(r.sharesOutstanding), pe: n(r.trailingPE), eps: n(r.epsTrailingTwelveMonths), epsForward: n(r.epsForward),
      divYield: divY, hi52: n(r.fiftyTwoWeekHigh), lo52: n(r.fiftyTwoWeekLow), chg52: n(r.fiftyTwoWeekChangePercent),
      earnings: n(r.earningsTimestamp) ?? n(r.earningsTimestampStart), earningsStart: n(r.earningsTimestampStart), earningsEnd: n(r.earningsTimestampEnd),
      marketState: r.marketState || null, time: n(r.regularMarketTime), source: 'quote',
    };
  }

  // ---- news --------------------------------------------------------------------------------

  async function news(query, count = 20) {
    return cached(`news:${query}:${count}`, 5 * 60e3, async () => {
      const data = await json(`${Q2}/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=0&newsCount=${count}&enableFuzzyQuery=false`);
      return (data.news || []).map((x) => ({
        id: x.uuid, headline: x.title, source: x.publisher, link: x.link, t: (x.providerPublishTime || 0) * 1000, tickers: x.relatedTickers || [],
      }));
    });
  }

  // ---- symbol search -------------------------------------------------------------------------

  async function search(q) {
    return cached(`search:${q}`, 10 * 60e3, async () => {
      const data = await json(`${Q2}/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0&enableFuzzyQuery=false`);
      return (data.quotes || []).filter((x) => x.symbol && x.quoteType).map((x) => ({
        symbol: x.symbol, name: x.longname || x.shortname || x.symbol, type: x.quoteType, exchange: x.exchDisp || x.exchange || '',
      }));
    });
  }

  // ---- fundamentals --------------------------------------------------------------------------

  async function profile(symbol) {
    return cached(`profile:${symbol}`, 30 * 60e3, async () => {
      const modules = 'assetProfile,financialData,defaultKeyStatistics,recommendationTrend,upgradeDowngradeHistory,incomeStatementHistory,calendarEvents,summaryDetail';
      const data = await withCrumb((c) => `${Q2}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}&crumb=${encodeURIComponent(c)}`);
      const r = data?.quoteSummary?.result?.[0];
      if (!r) throw new YahooError(`No fundamentals for ${symbol}`, 404);
      const ap = r.assetProfile || {};
      const fd = r.financialData || {};
      const ks = r.defaultKeyStatistics || {};
      const sd = r.summaryDetail || {};
      const trend = (r.recommendationTrend?.trend || []).find((t) => t.period === '0m') || r.recommendationTrend?.trend?.[0] || null;
      return {
        summary: ap.longBusinessSummary || null, sector: ap.sector || null, industry: ap.industry || null, employees: n(ap.fullTimeEmployees),
        country: ap.country || null, website: ap.website || null,
        targetMean: raw(fd.targetMeanPrice), targetHigh: raw(fd.targetHighPrice), targetLow: raw(fd.targetLowPrice),
        recMean: raw(fd.recommendationMean), recKey: fd.recommendationKey || null, analysts: raw(fd.numberOfAnalystOpinions),
        revenue: raw(fd.totalRevenue), revenueGrowth: raw(fd.revenueGrowth), grossMargin: raw(fd.grossMargins), operatingMargin: raw(fd.operatingMargins),
        ebitdaMargin: raw(fd.ebitdaMargins), profitMargin: raw(fd.profitMargins), ebitda: raw(fd.ebitda), debt: raw(fd.totalDebt), cash: raw(fd.totalCash),
        fcf: raw(fd.freeCashflow), roe: raw(fd.returnOnEquity), debtToEquity: raw(fd.debtToEquity), earningsGrowth: raw(fd.earningsGrowth),
        beta: raw(sd.beta) ?? raw(ks.beta), priceToBook: raw(ks.priceToBook), ev: raw(ks.enterpriseValue), evEbitda: raw(ks.enterpriseToEbitda), forwardPE: raw(ks.forwardPE) ?? raw(sd.forwardPE),
        trend: trend ? { strongBuy: trend.strongBuy || 0, buy: trend.buy || 0, hold: trend.hold || 0, sell: trend.sell || 0, strongSell: trend.strongSell || 0 } : null,
        actions: (r.upgradeDowngradeHistory?.history || []).slice(0, 15).map((h) => ({ t: (h.epochGradeDate || 0) * 1000, firm: h.firm, to: h.toGrade, from: h.fromGrade, action: h.action, target: n(h.currentPriceTarget) })),
        income: (r.incomeStatementHistory?.incomeStatementHistory || []).map((s) => ({
          end: raw(s.endDate), revenue: raw(s.totalRevenue), grossProfit: raw(s.grossProfit), operatingIncome: raw(s.operatingIncome), netIncome: raw(s.netIncome), ebit: raw(s.ebit),
        })).reverse(),
        earningsDates: (r.calendarEvents?.earnings?.earningsDate || []).map(raw).filter(Boolean).map((s) => s * 1000),
        epsEstimate: raw(r.calendarEvents?.earnings?.earningsAverage), revenueEstimate: raw(r.calendarEvents?.earnings?.revenueAverage),
      };
    });
  }

  // ---- financial statements, earnings, ownership, dividends -----------------------------------

  // Line items per statement, as named in Yahoo's fundamentals time series (prefixed with
  // "annual" or "quarterly" in the request).
  const STATEMENTS = {
    income: ['TotalRevenue', 'CostOfRevenue', 'GrossProfit', 'ResearchAndDevelopment', 'SellingGeneralAndAdministration', 'OperatingIncome', 'InterestExpense', 'PretaxIncome', 'TaxProvision', 'NetIncome', 'EBITDA', 'DilutedEPS', 'DilutedAverageShares'],
    balance: ['CashAndCashEquivalents', 'CurrentAssets', 'TotalAssets', 'CurrentLiabilities', 'TotalDebt', 'NetDebt', 'TotalLiabilitiesNetMinorityInterest', 'StockholdersEquity', 'RetainedEarnings', 'WorkingCapital', 'OrdinarySharesNumber'],
    cashflow: ['OperatingCashFlow', 'CapitalExpenditure', 'FreeCashFlow', 'DepreciationAndAmortization', 'StockBasedCompensation', 'InvestingCashFlow', 'RepurchaseOfCapitalStock', 'CashDividendsPaid', 'FinancingCashFlow'],
  };

  // { periods: ['2022-09-30', ...] (oldest first), rows: { TotalRevenue: { '2022-09-30': 3.9e11 } } }
  async function statements(symbol, freq) {
    const f = freq === 'quarterly' ? 'quarterly' : 'annual';
    return cached(`stmt:${symbol}:${f}`, 6 * 60 * 60e3, async () => {
      const types = Object.values(STATEMENTS).flat().map((t) => f + t).join(',');
      const now = Math.floor(Date.now() / 1000);
      const make = (crumb) => `${Q2}/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?symbol=${encodeURIComponent(symbol)}&type=${types}&period1=${now - 7 * 365 * 86400}&period2=${now + 86400}${crumb ? `&crumb=${encodeURIComponent(crumb)}` : ''}`;
      let data;
      try {
        data = await json(make(null));
      } catch (err) {
        if (err.status !== 401 && err.status !== 403) throw err;
        data = await withCrumb(make);
      }
      const rows = {};
      const periods = new Set();
      let currency = null;
      for (const r of data?.timeseries?.result || []) {
        const type = r?.meta?.type?.[0];
        // the values sit under a key named after the type (fall back to any other array)
        const items = (type && r[type]) || Object.entries(r).find(([k, v]) => k !== 'meta' && k !== 'timestamp' && Array.isArray(v))?.[1] || [];
        if (!type) continue;
        const name = type.replace(/^(annual|quarterly)/, '');
        for (const it of items) {
          const v = raw(it?.reportedValue);
          if (!it?.asOfDate || v == null) continue;
          if (!currency && it.currencyCode && name !== 'DilutedAverageShares' && name !== 'OrdinarySharesNumber') currency = it.currencyCode;
          (rows[name] ||= {})[it.asOfDate] = v;
          periods.add(it.asOfDate);
        }
      }
      if (!periods.size) throw new YahooError(`Yahoo has no ${f} statements for ${symbol}`, 404);
      return { freq: f, periods: [...periods].sort().slice(f === 'annual' ? -5 : -8), rows, currency, layout: STATEMENTS };
    });
  }

  // SEC filings as Yahoo lists them: the backup for FILE when the SEC itself refuses.
  async function filings(symbol) {
    return cached(`filings:${symbol}`, 30 * 60e3, async () => {
      const data = await withCrumb((c) => `${Q2}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=secFilings,quoteType&crumb=${encodeURIComponent(c)}`);
      const r = data?.quoteSummary?.result?.[0];
      const list = (r?.secFilings?.filings || []).map((f) => ({
        form: f.type || '', date: f.date || (f.epochDate ? new Date(f.epochDate * 1000).toISOString().slice(0, 10) : null), reportDate: null,
        description: f.title || '', url: f.edgarUrl || f.exhibits?.[0]?.url || null,
      })).filter((f) => f.url);
      if (!list.length) throw new YahooError(`Yahoo lists no SEC filings for ${symbol}`, 404);
      return { company: r?.quoteType?.longName || r?.quoteType?.shortName || symbol, cik: null, filings: list, edgar: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(symbol)}`, source: 'Yahoo Finance' };
    });
  }

  // Earnings history and estimates, ownership, insider trades and key statistics.
  async function details(symbol) {
    return cached(`details:${symbol}`, 60 * 60e3, async () => {
      const modules = 'earningsHistory,earningsTrend,majorHoldersBreakdown,institutionOwnership,fundOwnership,insiderTransactions,defaultKeyStatistics,summaryDetail,financialData,calendarEvents';
      const data = await withCrumb((c) => `${Q2}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}&crumb=${encodeURIComponent(c)}`);
      const r = data?.quoteSummary?.result?.[0];
      if (!r) throw new YahooError(`No details for ${symbol}`, 404);
      const ks = r.defaultKeyStatistics || {};
      const sd = r.summaryDetail || {};
      const fd = r.financialData || {};
      const mh = r.majorHoldersBreakdown || {};
      const holders = (list) => (list || []).map((h) => ({ name: h.organization, pct: raw(h.pctHeld), shares: raw(h.position), value: raw(h.value), date: raw(h.reportDate) })).filter((h) => h.name);
      return {
        earnings: (r.earningsHistory?.history || []).map((h) => ({ quarter: raw(h.quarter), period: h.period, actual: raw(h.epsActual), estimate: raw(h.epsEstimate), surprise: raw(h.surprisePercent) })).filter((h) => h.quarter),
        estimates: (r.earningsTrend?.trend || []).map((t) => ({
          period: t.period, end: t.endDate, growth: raw(t.growth),
          eps: { avg: raw(t.earningsEstimate?.avg), low: raw(t.earningsEstimate?.low), high: raw(t.earningsEstimate?.high), analysts: raw(t.earningsEstimate?.numberOfAnalysts), yearAgo: raw(t.earningsEstimate?.yearAgoEps) },
          revenue: { avg: raw(t.revenueEstimate?.avg), low: raw(t.revenueEstimate?.low), high: raw(t.revenueEstimate?.high), analysts: raw(t.revenueEstimate?.numberOfAnalysts), yearAgo: raw(t.revenueEstimate?.yearAgoRevenue) },
        })),
        ownership: { insiders: raw(mh.insidersPercentHeld), institutions: raw(mh.institutionsPercentHeld), institutionsFloat: raw(mh.institutionsFloatPercentHeld), institutionCount: raw(mh.institutionsCount) },
        institutions: holders(r.institutionOwnership?.ownershipList),
        funds: holders(r.fundOwnership?.ownershipList),
        insiders: (r.insiderTransactions?.transactions || []).slice(0, 40).map((t) => ({ name: t.filerName, relation: t.filerRelation, text: t.transactionText, date: raw(t.startDate), shares: raw(t.shares), value: raw(t.value) })),
        stats: {
          marketCap: raw(sd.marketCap), ev: raw(ks.enterpriseValue), trailingPE: raw(sd.trailingPE), forwardPE: raw(sd.forwardPE) ?? raw(ks.forwardPE), peg: raw(ks.pegRatio),
          priceToSales: raw(sd.priceToSalesTrailing12Months), priceToBook: raw(ks.priceToBook), evRevenue: raw(ks.enterpriseToRevenue), evEbitda: raw(ks.enterpriseToEbitda),
          grossMargin: raw(fd.grossMargins), operatingMargin: raw(fd.operatingMargins), profitMargin: raw(fd.profitMargins), roe: raw(fd.returnOnEquity), roa: raw(fd.returnOnAssets),
          revenueGrowth: raw(fd.revenueGrowth), earningsGrowth: raw(fd.earningsGrowth), currentRatio: raw(fd.currentRatio), quickRatio: raw(fd.quickRatio), debtToEquity: raw(fd.debtToEquity),
          totalCash: raw(fd.totalCash), totalDebt: raw(fd.totalDebt), fcf: raw(fd.freeCashflow), ocf: raw(fd.operatingCashflow),
          beta: raw(sd.beta) ?? raw(ks.beta), high52: raw(sd.fiftyTwoWeekHigh), low52: raw(sd.fiftyTwoWeekLow), change52: raw(ks['52WeekChange']), ma50: raw(sd.fiftyDayAverage), ma200: raw(sd.twoHundredDayAverage),
          avgVolume: raw(sd.averageVolume), avgVolume10d: raw(sd.averageVolume10days), shares: raw(ks.sharesOutstanding), float: raw(ks.floatShares),
          sharesShort: raw(ks.sharesShort), shortRatio: raw(ks.shortRatio), shortFloat: raw(ks.shortPercentOfFloat), sharesShortPrior: raw(ks.sharesShortPriorMonth),
          dividendRate: raw(sd.dividendRate), dividendYield: raw(sd.dividendYield), payoutRatio: raw(sd.payoutRatio), exDividend: raw(sd.exDividendDate), avgYield5y: raw(sd.fiveYearAvgDividendYield),
          bookValue: raw(ks.bookValue), trailingEps: raw(ks.trailingEps), forwardEps: raw(ks.forwardEps), lastSplit: ks.lastSplitFactor || null, lastSplitDate: raw(ks.lastSplitDate),
          fiscalYearEnd: raw(ks.lastFiscalYearEnd), mostRecentQuarter: raw(ks.mostRecentQuarter),
        },
      };
    });
  }

  // Every dividend and split on record (the chart endpoint's corporate-action events).
  async function events(symbol) {
    return cached(`events:${symbol}`, 6 * 60 * 60e3, async () => {
      const data = await json(`${Q1}/v8/finance/chart/${encodeURIComponent(symbol)}?range=max&interval=1mo&events=div%2Csplit`);
      const res = data?.chart?.result?.[0];
      if (!res) throw new YahooError(`No history for ${symbol}`, 404);
      const ev = res.events || {};
      const dividends = Object.values(ev.dividends || {}).map((d) => ({ date: d.date, amount: n(d.amount) })).filter((d) => d.amount != null).sort((a, b) => b.date - a.date);
      const splits = Object.values(ev.splits || {}).map((x) => ({ date: x.date, ratio: x.splitRatio || `${x.numerator}:${x.denominator}`, factor: n(x.numerator) / (n(x.denominator) || 1) })).sort((a, b) => b.date - a.date);
      return { dividends, splits, currency: res.meta?.currency || null, price: n(res.meta?.regularMarketPrice) };
    });
  }

  // ---- options -----------------------------------------------------------------------------

  async function options(symbol, date) {
    return cached(`opt:${symbol}:${date || ''}`, 60e3, async () => {
      const data = await withCrumb((c) => `${Q2}/v7/finance/options/${encodeURIComponent(symbol)}?crumb=${encodeURIComponent(c)}${date ? `&date=${date}` : ''}`);
      const r = data?.optionChain?.result?.[0];
      if (!r) throw new YahooError(`No options listed for ${symbol}`, 404);
      const leg = (o) => ({ strike: n(o.strike), last: n(o.lastPrice), bid: n(o.bid), ask: n(o.ask), iv: n(o.impliedVolatility), volume: n(o.volume) ?? 0, oi: n(o.openInterest) ?? 0, itm: !!o.inTheMoney });
      const set = r.options?.[0] || {};
      return {
        expirations: r.expirationDates || [], expiration: set.expirationDate ?? null, spot: n(r.quote?.regularMarketPrice),
        calls: (set.calls || []).map(leg), puts: (set.puts || []).map(leg),
      };
    });
  }

  return { chart, quotes, news, search, profile, options, statements, details, events, filings, normalizeChart, normalizeQuote };
}

export async function pool(items, size, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      await fn(items[k], k);
    }
  });
  await Promise.all(workers);
}
