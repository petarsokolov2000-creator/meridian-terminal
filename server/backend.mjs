// Meridian's data backend: every /api/* route, shared by the PC server (serve.mjs, Node) and
// the Android app (src/app-backend.js, inside the app's WebView). Only storage and networking
// are supplied by the host:
//   fetchImpl       how to make HTTP requests (Node's fetch, or the app's native bridge)
//   WebSocketImpl   for Finnhub's live trades
//   keyStore        { get(id), set(id, value|null) } for the Finnhub/FRED keys
//   historyStore    { read(day), write(day, data) } for the day's history cache
//   currentVersion  async () => the installed version string
//   hostInfo        async () => what STATUS shows about where Meridian runs (PC: the update log)

import { createYahoo, pool } from './yahoo.mjs';
import { createFinnhub } from './finnhub.mjs';
import { createFred } from './fred.mjs';
import { createRates } from './rates.mjs';
import { createSec } from './sec.mjs';
import { MORE_COMPANIES } from '../src/companies.js';
import { LIVE_EQUITIES } from '../src/live-universe.js';
import { createFundamentals } from './fundamentals.mjs';
import { createTenK } from './tenk.mjs';

export const KEYS = {
  finnhub: { label: 'Finnhub', pattern: /^[A-Za-z0-9]{10,64}$/ },
  fred: { label: 'FRED', pattern: /^[a-z0-9]{32}$/ },
};
const REPO = 'petarsokolov2000-creator/meridian-terminal';

export class RouteError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const oneSym = (v) => (/^[\w^=.\-/:]{1,24}$/.test(v || '') ? v : null);
const needSym = (q) => {
  const s = oneSym(q.get('symbol'));
  if (!s) throw new RouteError('Bad symbol', 400);
  return s;
};
// Any well-formed Yahoo symbol: the built-in list plus whatever tickers the user added.
const syms = (v) => String(v || '').split(',').map((s) => s.trim()).filter((s) => oneSym(s)).slice(0, 320);

export function createBackend({ fetchImpl = fetch, WebSocketImpl = globalThis.WebSocket, keyStore, historyStore, kvStore = null, currentVersion, hostInfo = null, universe, mock = false, log = console.warn }) {
  const opts = { fetchImpl };
  const yahoo = createYahoo(opts);
  const finnhub = createFinnhub({ getKey: () => keyStore.get('finnhub'), ...opts, WebSocketImpl });
  const fred = createFred({ getKey: () => keyStore.get('fred'), ...opts });
  const rates = createRates(opts);
  const sec = createSec({ ...opts, getContact: () => keyStore.get('sec') });
  const fundamentals = createFundamentals({ sec, yahoo, finnhub, kvStore, log });
  const tenk = createTenK({ sec });
  // peer candidates: Meridian's companies in the same sector, largest first (built-in list first)
  const SECTOR_OF = new Map([...LIVE_EQUITIES.map((e) => [e[0], e[2]]), ...MORE_COMPANIES.map((c) => [c[0], c[2]])]);
  const peerCandidates = (sym) => {
    const sector = SECTOR_OF.get(sym);
    return [...SECTOR_OF].filter(([s, sec2]) => s !== sym && (!sector || sec2 === sector)).map(([s]) => s);
  };
  const providers = { finnhub: { check: () => finnhub.check(), restart: () => finnhub.restart() }, fred: { check: () => fred.check(), restart: () => fred.reset() } };
  const UNIVERSE = new Set(universe);

  // ---- daily history: cached per day, since it only changes once a day --------------------

  const today = () => new Date().toISOString().slice(0, 10);
  let historyMem = null;
  const historyFailed = new Map(); // symbol -> day it failed, so a bad symbol isn't retried all day

  async function allHistory() {
    let data = historyMem?.day === today() ? historyMem.data : null;
    if (!data) data = (await historyStore.read(today()).catch(() => null)) || {};
    // Fetch whatever today's cache lacks (all of it on the first start of the day, or symbols
    // a newer version added), skipping ones that already failed today.
    const missing = [...UNIVERSE].filter((s) => !data[s] && historyFailed.get(s) !== today());
    if (missing.length) {
      const errors = {};
      await pool(missing, 6, async (s) => {
        try {
          const ch = await yahoo.chart(s, '1y', '1d');
          data[s] = { meta: ch.meta, bars: ch.bars.map(({ t, o, h, l, c, v }) => ({ t, o, h, l, c, v })) };
        } catch (err) {
          errors[s] = err.message;
          historyFailed.set(s, today());
        }
      });
      if (Object.keys(errors).length) log(`History missing for ${Object.keys(errors).length} symbols:`, Object.entries(errors).slice(0, 5));
      if (Object.keys(data).length > UNIVERSE.size * 0.8) await historyStore.write(today(), data).catch((err) => log(`Couldn't cache history: ${err.message}`));
    }
    historyMem = { day: today(), data };
    return data;
  }

  // ---- version: compare with the newest one published on GitHub ----------------------------

  let latestCache = null;
  async function versionInfo() {
    const current = await currentVersion().catch(() => null);
    if (!latestCache || Date.now() - latestCache.at > 60 * 60e3) {
      let latest = null;
      if (!mock) {
        try {
          const res = await fetchImpl(`https://raw.githubusercontent.com/${REPO}/main/VERSION?t=${Date.now()}`, { signal: AbortSignal.timeout(5000) });
          if (res.ok) latest = (await res.text()).trim().slice(0, 40) || null;
        } catch {
          // offline: no update check
        }
      }
      latestCache = { at: Date.now(), latest };
    }
    const latest = latestCache.latest;
    return { current, latest, updateAvailable: !!(current && latest && latest !== current) };
  }

  // ---- STATUS: a fresh test of every data source, with the real answer of each --------------

  const CHECKS = [
    { id: 'yahoo-prices', name: 'Yahoo Finance · price history', used: 'Charts, the watchlist and every price', run: () => yahoo.probe.prices() },
    { id: 'yahoo-quotes', name: 'Yahoo Finance · live quotes', used: 'Prices that refresh every few seconds', run: () => yahoo.probe.quotes(), ifFails: 'Meridian then reads prices from the chart data instead, which is slower.' },
    { id: 'yahoo-financials', name: 'Yahoo Finance · company financials', used: 'FA, KEYS, EPS, HOLD, PEERS margins; fills gaps in VAL, QUAL, CHECK', run: () => yahoo.probe.financials() },
    { id: 'sec-list', name: 'SEC EDGAR · company list (www.sec.gov)', used: 'Needed before any SEC figure; also FILE, SEG, RISK', run: () => sec.probe.list() },
    { id: 'sec-figures', name: 'SEC EDGAR · reported figures (data.sec.gov)', used: 'VAL, DCF, QUAL, CAP, CHECK, COMPARE', run: () => sec.probe.figures(), ifFails: 'Those screens then use Yahoo and Finnhub (about 4 years of history instead of 10+). If it stays at HTTP 403, set your own contact address for the SEC with SECID <your email>.' },
    { id: 'finnhub', key: 'finnhub', name: 'Finnhub · real-time price', used: 'Real-time trades, news summaries, earnings estimates', run: () => finnhub.probe.quote() },
    { id: 'finnhub-financials', key: 'finnhub', name: 'Finnhub · financial statements', used: 'Third source for older years in VAL and QUAL', run: () => finnhub.probe.reported() },
    { id: 'fred', key: 'fred', name: 'FRED · US economic data', used: 'ECO', run: async () => (await fred.check()) && 'the key works' },
    { id: 'treasury', name: 'US Treasury · yield curve', used: 'CURVE, GOVT and US yields', run: async () => `curve of ${(await rates.treasury()).rows.at(-1).date}` },
    { id: 'ecb', name: 'ECB · euro yield curve', used: 'CURVE (euro area)', run: async () => (await rates.ecb()) && 'answered' },
    {
      id: 'github', name: 'GitHub · Meridian updates', used: 'UPDATE and the automatic update',
      run: async () => {
        const res = await fetchImpl(`https://raw.githubusercontent.com/${REPO}/main/VERSION?t=${Date.now()}`, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw Object.assign(new Error(`GitHub answered HTTP ${res.status}`), { http: res.status });
        const v = (await res.text()).trim().slice(0, 40);
        if (!v) throw Object.assign(new Error('GitHub answered without a version number'), { http: 'empty' });
        return { detail: `newest published version: ${v}`, latest: v };
      },
    },
  ];
  const httpOf = (err) => err?.http ?? (err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'timeout' : Number.isFinite(err?.status) ? err.status : 'network');

  async function runCheck(c) {
    const base = { id: c.id, name: c.name, used: c.used };
    if (c.key && !keyStore.get(c.key)) return { ...base, state: 'off', detail: `no ${KEYS[c.key].label} key set (optional). Add one with ${c.key.toUpperCase()} <key>.` };
    const t0 = Date.now();
    try {
      const limit = new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error("didn't answer within 30 s (timeout)"), { http: 'timeout' })), 30e3));
      const r = await Promise.race([c.run(), limit]);
      return { ...base, state: 'ok', ms: Date.now() - t0, detail: typeof r === 'string' ? r : r?.detail || 'answered', ...(r?.latest ? { latest: r.latest } : {}) };
    } catch (err) {
      return { ...base, state: 'failed', ms: Date.now() - t0, http: httpOf(err), error: String(err?.message || err).slice(0, 300), ifFails: c.ifFails || null };
    }
  }

  let diagCache = null;
  function diag() {
    // a second panel (or a double tap) within 10 s shares the same run
    if (diagCache && Date.now() - diagCache.at < 10e3) return diagCache.p;
    const p = (async () => {
      const [checks, current, host] = await Promise.all([
        Promise.all(CHECKS.map(runCheck)),
        currentVersion().catch(() => null),
        hostInfo ? hostInfo().catch((err) => ({ error: err.message })) : null,
      ]);
      const latest = checks.find((c) => c.id === 'github')?.latest || null;
      return {
        at: new Date().toISOString(), mock,
        version: { current, latest, updateAvailable: !!(current && latest && latest !== current) },
        keys: { ...Object.fromEntries(Object.keys(KEYS).map((k) => [k, !!keyStore.get(k)])), secContact: !!keyStore.get('sec') },
        checks, host,
      };
    })();
    diagCache = { at: Date.now(), p };
    return p;
  }

  let moreCache = null;
  function moreQuotes() {
    if (moreCache && Date.now() - moreCache.at < 60e3) return moreCache.p;
    const p = yahoo.quotes(MORE_COMPANIES.map((c) => c[0]), { fallback: false }).then((r) => {
      const out = {};
      for (const [s, q] of Object.entries(r.quotes)) {
        if (q.price == null) continue;
        out[s] = [q.price, q.prevClose, q.marketCap, q.eps, q.divYield, q.hi52, q.chg52, q.name, q.currency];
      }
      return { fields: ['price', 'prevClose', 'marketCap', 'eps', 'divYield', 'hi52', 'chg52', 'name', 'currency'], quotes: out, degraded: r.degraded };
    });
    moreCache = { at: Date.now(), p };
    p.catch(() => (moreCache = null));
    return p;
  }

  // ---- GET routes ----------------------------------------------------------------------------

  const routes = {
    '/api/status': async () => ({ ok: true, live: true, mock }),
    '/api/history': async () => allHistory(),
    '/api/search': async (q) => {
      const term = String(q.get('q') || '').trim().slice(0, 40);
      return term.length < 1 ? [] : yahoo.search(term);
    },
    // One instrument outside the built-in list: a year of daily bars plus its metadata.
    '/api/instrument': async (q) => {
      const s = needSym(q);
      const ch = await yahoo.chart(s, '1y', '1d');
      if (!ch.bars.length) throw new RouteError(`Yahoo has no price history for ${s}`, 404);
      return { meta: ch.meta, bars: ch.bars.map(({ t, o, h, l, c, v }) => ({ t, o, h, l, c, v })) };
    },
    '/api/quotes': async (q) => {
      const want = syms(q.get('symbols'));
      const r = await yahoo.quotes(want);
      // FX pairs Yahoo didn't price: fall back to the ECB reference rate (published once a day).
      const missingFx = want.filter((s) => s.endsWith('=X') && !r.quotes[s]);
      if (missingFx.length) {
        try {
          const fx = await rates.fx();
          for (const s of missingFx) {
            // EURUSD=X style quotes USD per unit of the first currency; JPY=X style quotes units per USD
            const base = /^[A-Z]{6}=X$/.test(s);
            const ccy = s.slice(0, 3).replace('CNH', 'CNY');
            const perUsd = fx.rates[ccy];
            if (!perUsd) continue;
            r.quotes[s] = { symbol: s, price: base ? 1 / perUsd : perUsd, prevClose: null, source: 'ecb', asOf: fx.date };
          }
        } catch {
          // no backup available either
        }
      }
      return r;
    },
    '/api/intraday': async (q) => {
      const ch = await yahoo.chart(needSym(q), '1d', q.get('interval') === '5m' ? '5m' : '1m');
      return { meta: ch.meta, bars: ch.bars };
    },
    '/api/chart': async (q) => {
      const s = needSym(q);
      const range = ['5y', '10y', 'max', '2y', '1y'].includes(q.get('range')) ? q.get('range') : '2y';
      const ch = await yahoo.chart(s, range, range === 'max' || range === '10y' ? '1wk' : '1d');
      return { meta: ch.meta, bars: ch.bars };
    },
    '/api/news': async (q) => yahoo.news(String(q.get('q') || 'stock market').slice(0, 60), Math.min(30, Number(q.get('n')) || 20)),
    '/api/profile': async (q) => yahoo.profile(needSym(q)),
    '/api/finnhub/status': async () => finnhub.status(),
    '/api/rates': async () => {
      // Each source on its own: one failing leaves the other.
      const [t, e] = await Promise.allSettled([rates.treasury(), rates.ecb()]);
      return { treasury: t.value ?? null, treasuryError: t.reason?.message ?? null, ecb: e.value ?? null, ecbError: e.reason?.message ?? null };
    },
    '/api/fred/status': async () => ({ configured: !!keyStore.get('fred') }),
    '/api/version': async () => versionInfo(),
    '/api/diag': async () => diag(),
    '/api/fred/economy': async () => fred.economy(),
    '/api/finnhub/news': async (q) => finnhub.news(['general', 'forex', 'crypto', 'merger'].includes(q.get('category')) ? q.get('category') : 'general'),
    '/api/finnhub/company-news': async (q) => finnhub.companyNews(needSym(q)),
    '/api/finnhub/earnings': async () => finnhub.earnings(),
    '/api/finnhub/economic': async () => finnhub.economic(),
    // Company financials: statements (annual/quarterly), earnings & ownership, dividends, filings.
    '/api/statements': async (q) => yahoo.statements(needSym(q), q.get('freq')),
    '/api/details': async (q) => yahoo.details(needSym(q)),
    '/api/events': async (q) => yahoo.events(needSym(q)),
    // The SEC first (official, complete); if it refuses or is unreachable, Yahoo's list.
    '/api/filings': async (q) => {
      const s = needSym(q);
      try {
        return await sec.filings(s);
      } catch (err) {
        try {
          return { ...(await yahoo.filings(s)), secError: err.message };
        } catch {
          throw err;
        }
      }
    },
    // Quotes for the 1,000+ extra companies (src/companies.js), for the screener: one Yahoo
    // request per 50 companies, at most once a minute, and only the fields the screener uses.
    '/api/more-quotes': async () => moreQuotes(),
    // valuation and fundamentals (VAL, DCF): SEC 10-K figures, Yahoo prices
    '/api/annual': async (q) => fundamentals.annual(needSym(q), 'full'),
    '/api/valuation': async (q) => fundamentals.valuation(needSym(q)),
    '/api/peers': async (q) => fundamentals.peers(needSym(q), peerCandidates(needSym(q)), 6),
    '/api/peer-row': async (q) => fundamentals.peerRow(needSym(q)),
    // SEG, RISK (the latest 10-K itself) and ETF (Yahoo fund data)
    '/api/segments': async (q) => tenk.segments(needSym(q)),
    '/api/risks': async (q) => tenk.risks(needSym(q)),
    '/api/etf': async (q) => yahoo.etf(needSym(q)),
    '/api/options': async (q) => yahoo.options(needSym(q), Number(q.get('date')) || null),
  };

  // ---- POST routes ---------------------------------------------------------------------------

  async function setKey(id, raw) {
    const k = KEYS[id];
    const value = String(raw || '').trim();
    if (!value) {
      await keyStore.set(id, null);
      providers[id].restart();
      return { ok: true, removed: true };
    }
    if (!k.pattern.test(value)) throw new RouteError(`That doesn't look like a ${k.label} API key${id === 'fred' ? ' (32 lower-case letters and digits)' : ' (letters and digits only)'}.`, 400);
    const previous = keyStore.get(id);
    await keyStore.set(id, value, { tentative: true });
    try {
      await providers[id].check();
    } catch (err) {
      await keyStore.set(id, previous);
      throw new RouteError(`${k.label} didn't accept it: ${err.message}`, 400);
    }
    await keyStore.set(id, value);
    providers[id].restart();
    return { ok: true };
  }

  return {
    // GET /api/...: resolves to the JSON body, or throws a RouteError / data-source error
    async get(pathname, searchParams) {
      const route = routes[pathname];
      if (!route) throw new RouteError('Not found', 404);
      return route(searchParams);
    },
    async post(pathname, body) {
      if (pathname === '/api/finnhub/stream') {
        finnhub.setStream((Array.isArray(body?.symbols) ? body.symbols : []).filter((s) => typeof s === 'string' && oneSym(s)));
        return finnhub.status();
      }
      if (pathname === '/api/sec/contact') {
        // the contact the SEC asks every client to give; kept on this PC, never shown back
        const v = String(body?.contact || '').trim();
        if (v && !/^[^\s@<>"']{1,64}@[A-Za-z0-9.-]{1,80}\.[A-Za-z]{2,}$/.test(v)) throw new RouteError("That doesn't look like an email address.", 400);
        await keyStore.set('sec', v || null);
        return { ok: true, removed: !v };
      }
      const keyRoute = /^\/api\/(finnhub|fred)\/key$/.exec(pathname);
      if (keyRoute) return setKey(keyRoute[1], body?.key);
      throw new RouteError('Not found', 404);
    },
    has: (pathname) => pathname in routes,
    onTrades: (fn) => finnhub.onTrades(fn),
  };
}
