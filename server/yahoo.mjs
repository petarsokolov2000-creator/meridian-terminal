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

  async function quotes(symbols) {
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
    if (missing.length) {
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
      divYield: divY, hi52: n(r.fiftyTwoWeekHigh), lo52: n(r.fiftyTwoWeekLow),
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

  return { chart, quotes, news, search, profile, options, normalizeChart, normalizeQuote };
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
