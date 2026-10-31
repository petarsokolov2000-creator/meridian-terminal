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
  const n = daily ? 252 : 120;
  const d = series(s, n, daily ? 86400 : 60, now, daily ? 0.03 : 0.003);
  const last = d.c[d.c.length - 1];
  return {
    chart: {
      result: [{
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
        assetProfile: { longBusinessSummary: `${s} Mock Corp makes mock products for testing.`, sector: 'Technology', industry: 'Software', fullTimeEmployees: 12000, country: 'United States', website: 'https://example.com' },
        financialData: { targetMeanPrice: v(base(s) * 1.1), targetHighPrice: v(base(s) * 1.4), targetLowPrice: v(base(s) * 0.8), recommendationMean: v(2.1), recommendationKey: 'buy', numberOfAnalystOpinions: v(30), totalRevenue: v(3.9e11), revenueGrowth: v(0.06), grossMargins: v(0.46), operatingMargins: v(0.31), ebitdaMargins: v(0.34), profitMargins: v(0.25), ebitda: v(1.3e11), totalDebt: v(1.0e11), totalCash: v(6e10), freeCashflow: v(1.0e11), returnOnEquity: v(1.5), debtToEquity: v(150) },
        defaultKeyStatistics: { priceToBook: v(50), enterpriseValue: v(3.5e12), enterpriseToEbitda: v(26), forwardPE: v(30) },
        summaryDetail: { beta: v(1.2) },
        recommendationTrend: { trend: [{ period: '0m', strongBuy: 10, buy: 20, hold: 12, sell: 2, strongSell: 1 }] },
        upgradeDowngradeHistory: { history: [{ epochGradeDate: Math.floor(Date.now() / 1000) - 86400 * 3, firm: 'Mock Securities', toGrade: 'Buy', fromGrade: 'Hold', action: 'up', currentPriceTarget: base(s) * 1.2 }] },
        incomeStatementHistory: { incomeStatementHistory: [2025, 2024, 2023, 2022].map((y) => ({ endDate: v(Date.UTC(y, 8, 30) / 1000), totalRevenue: v(3.9e11 - (2025 - y) * 1e10), grossProfit: v(1.8e11), operatingIncome: v(1.2e11), netIncome: v(9.7e10), ebit: v(1.2e11) })) },
        calendarEvents: { earnings: { earningsDate: [v(Math.floor(Date.now() / 1000) + 86400 * 10)], earningsAverage: v(1.6), revenueAverage: v(9.4e10) } },
      }],
      error: null,
    },
  };
}

function news(q) {
  const now = Math.floor(Date.now() / 1000);
  return { news: Array.from({ length: 8 }, (_, i) => ({ uuid: `${q}-${i}`, title: `Mock headline ${i + 1} about ${q}`, publisher: 'Mock Wire', link: 'https://example.com/story', providerPublishTime: now - i * 1800, relatedTickers: [q] })) };
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
  if (u.hostname === 'fc.yahoo.com') return new Response('', { status: 404, headers: { 'set-cookie': 'A3=mock; Path=/' } });
  if (u.pathname === '/v1/test/getcrumb') return new Response('mockcrumb', { status: 200 });
  let m;
  if ((m = u.pathname.match(/^\/v8\/finance\/chart\/(.+)$/)) && decodeURIComponent(m[1]) === 'KRW=X' && u.searchParams.get('range') === '1d') return new Response('{}', { status: 500 });
  if ((m = u.pathname.match(/^\/v8\/finance\/chart\/(.+)$/))) return ok(chart(decodeURIComponent(m[1]), u.searchParams.get('range'), u.searchParams.get('interval')));
  if (u.pathname === '/v7/finance/quote') return ok(quote(u.searchParams.get('symbols').split(',').filter((x) => x !== 'KRW=X')));
  if ((m = u.pathname.match(/^\/v7\/finance\/options\/(.+)$/))) return ok(options(decodeURIComponent(m[1])));
  if ((m = u.pathname.match(/^\/v10\/finance\/quoteSummary\/(.+)$/))) return ok(summary(decodeURIComponent(m[1])));
  if (u.pathname === '/v1/finance/search') return ok(news(u.searchParams.get('q')));
  return new Response('not found', { status: 404 });
}
