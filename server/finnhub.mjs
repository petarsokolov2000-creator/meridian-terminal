// Finnhub (finnhub.io): real-time trades over WebSocket plus news with summaries, an
// earnings calendar with estimates/actuals and, on plans that include it, the economic
// calendar. Optional: everything works without a key. The key stays on this PC (env var
// FINNHUB_API_KEY or the git-ignored .finnhub-key file) and is never sent to the browser.

const REST = 'https://finnhub.io/api/v1';
const WS = 'wss://ws.finnhub.io';
const MAX_STREAM = 50; // free plan limit on WebSocket symbols

export class FinnhubError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function createFinnhub({ getKey, fetchImpl = fetch, WebSocketImpl = globalThis.WebSocket } = {}) {
  const cache = new Map();
  const listeners = new Set();
  let calls = []; // timestamps of recent REST calls, for the 60/min free limit
  let ws = null;
  let wanted = [];
  let subscribed = new Set();
  let state = { stream: 'off', error: null, trades: 0, lastTrade: null };
  let retry = 0;
  let retryTimer = null;

  async function rest(path, params = {}) {
    const key = getKey();
    if (!key) throw new FinnhubError('No Finnhub API key set', 401);
    const now = Date.now();
    calls = calls.filter((t) => now - t < 60000);
    if (calls.length >= 55) throw new FinnhubError('Finnhub rate limit (60 calls/min) reached; try again shortly', 429);
    calls.push(now);
    const qs = new URLSearchParams({ ...params, token: key });
    const res = await fetchImpl(`${REST}${path}?${qs}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    if (res.status === 401) throw new FinnhubError('Finnhub rejected the API key', 401);
    if (res.status === 403) throw new FinnhubError("Your Finnhub plan doesn't include this data", 403);
    if (res.status === 429) throw new FinnhubError('Finnhub rate limit reached', 429);
    if (!res.ok) throw new FinnhubError(`Finnhub answered ${res.status}`, res.status);
    try {
      return JSON.parse(text);
    } catch {
      throw new FinnhubError('Finnhub sent something that is not JSON', 502);
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

  const day = (offset) => new Date(Date.now() + offset * 86400e3).toISOString().slice(0, 10);
  const story = (n) => ({ id: `fh-${n.id}`, headline: n.headline, body: n.summary || '', source: n.source, link: n.url, t: (n.datetime || 0) * 1000, tickers: String(n.related || '').split(',').map((s) => s.trim()).filter(Boolean), category: n.category });

  const api = {
    status: () => ({ configured: !!getKey(), ...state, streaming: [...subscribed] , streamSupported: !!WebSocketImpl }),

    async check() {
      const q = await rest('/quote', { symbol: 'AAPL' });
      if (!Number.isFinite(q?.c)) throw new FinnhubError('Finnhub answered without a price', 502);
      return true;
    },

    news: (category) => cached(`news:${category}`, 3 * 60e3, async () => (await rest('/news', { category })).map(story)),
    companyNews: (symbol) => cached(`cnews:${symbol}`, 5 * 60e3, async () => (await rest('/company-news', { symbol, from: day(-7), to: day(0) })).slice(0, 40).map(story)),
    earnings: () => cached('earnings', 30 * 60e3, async () => {
      const r = await rest('/calendar/earnings', { from: day(-10), to: day(21) });
      return (r.earningsCalendar || []).map((e) => ({ symbol: e.symbol, date: e.date, hour: e.hour, epsEstimate: e.epsEstimate, epsActual: e.epsActual, revenueEstimate: e.revenueEstimate, revenueActual: e.revenueActual, quarter: e.quarter, year: e.year }));
    }),
    economic: () => cached('eco', 15 * 60e3, async () => {
      const r = await rest('/calendar/economic', { from: day(-1), to: day(7) });
      return (r.economicCalendar || []).map((e) => ({ time: e.time, country: e.country, event: e.event, impact: e.impact, prev: e.prev, estimate: e.estimate, actual: e.actual, unit: e.unit }));
    }),

    // ---- WebSocket trade stream ----------------------------------------------------------

    onTrades(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    // Replace the streamed set (first MAX_STREAM symbols, in priority order).
    setStream(symbols) {
      wanted = [...new Set(symbols)].slice(0, MAX_STREAM);
      if (!getKey() || !WebSocketImpl) {
        state.stream = !WebSocketImpl ? 'unsupported' : 'off';
        return;
      }
      if (!ws) return connect();
      if (ws.readyState === 1) syncSubs();
    },

    restart() {
      retry = 0;
      clearTimeout(retryTimer);
      try {
        ws?.close();
      } catch {
        // already closed
      }
      ws = null;
      subscribed = new Set();
      state = { stream: 'off', error: null, trades: 0, lastTrade: null };
      cache.clear();
      if (getKey() && wanted.length) connect();
    },
  };

  function syncSubs() {
    const want = new Set(wanted);
    for (const s of subscribed) if (!want.has(s)) ws.send(JSON.stringify({ type: 'unsubscribe', symbol: s }));
    for (const s of want) if (!subscribed.has(s)) ws.send(JSON.stringify({ type: 'subscribe', symbol: s }));
    subscribed = want;
  }

  function connect() {
    const key = getKey();
    if (!key || !WebSocketImpl) return;
    state.stream = 'connecting';
    const sock = new WebSocketImpl(`${WS}?token=${encodeURIComponent(key)}`);
    ws = sock;
    sock.onopen = () => {
      retry = 0;
      state.stream = 'live';
      state.error = null;
      subscribed = new Set();
      syncSubs();
    };
    sock.onmessage = (ev) => {
      let m;
      try {
        m = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data));
      } catch {
        return;
      }
      if (m.type === 'trade' && Array.isArray(m.data)) {
        state.trades += m.data.length;
        state.lastTrade = Date.now();
        const trades = m.data.map((d) => ({ s: d.s, p: d.p, v: d.v, t: d.t }));
        for (const fn of listeners) fn(trades);
      } else if (m.type === 'error') {
        state.error = m.msg || 'Finnhub stream error';
      }
    };
    sock.onerror = () => {
      state.error = 'Finnhub stream connection failed';
    };
    sock.onclose = () => {
      if (ws !== sock) return; // replaced by restart()
      ws = null;
      subscribed = new Set();
      state.stream = 'reconnecting';
      // back off: 2 s, 4 s, ... up to a minute
      retryTimer = setTimeout(connect, Math.min(60000, 2000 * 2 ** retry++));
    };
  }

  return api;
}
