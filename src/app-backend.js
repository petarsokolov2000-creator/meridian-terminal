// Inside the Android app there is no PC server, so Meridian's backend (server/backend.mjs, the
// same code serve.mjs runs) runs right here in the page. Requests to /api/... are answered by
// it, and its own network calls go through the app's native bridge (window.AndroidNet), which
// isn't limited by the browser's cross-site rules. In a normal browser this file does nothing.

const native = window.AndroidNet;
if (native) install();

function install() {
  let seq = 0;
  const waiting = new Map();
  window.__meridianNetDone = (id, json) => {
    const p = waiting.get(id);
    if (!p) return;
    waiting.delete(id);
    try {
      p.resolve(JSON.parse(json));
    } catch {
      p.resolve({ error: 'The app sent an unreadable response' });
    }
  };

  // fetch() for the backend's data sources, made natively by the app.
  function nativeFetch(url, opts = {}) {
    const headers = {};
    const h = opts.headers instanceof Headers ? Object.fromEntries(opts.headers.entries()) : opts.headers || {};
    for (const [k, v] of Object.entries(h)) headers[k] = String(v);
    return new Promise((resolve) => {
      const id = String(++seq);
      waiting.set(id, { resolve });
      native.request(id, JSON.stringify({ url: String(url), method: opts.method || 'GET', headers, body: opts.body ?? null, redirect: opts.redirect || 'follow', timeout: 30000 }));
    }).then((r) => {
      if (r.error) throw new TypeError(r.error);
      const status = r.status >= 200 && r.status <= 599 ? r.status : 502;
      const hs = new Headers();
      for (const [k, v] of Object.entries(r.headers || {})) {
        try {
          hs.append(k, v);
        } catch {
          // a header the browser won't let a page set
        }
      }
      return new Response([101, 204, 205, 304].includes(status) ? null : r.text, { status, headers: hs });
    });
  }

  // API keys live in the app's private storage on the phone.
  const KEY = (id) => `meridian:apikey:${id}`;
  const memory = {};
  const keyStore = {
    get: (id) => (id in memory ? memory[id] : localStorage.getItem(KEY(id))),
    set(id, value, { tentative = false } = {}) {
      memory[id] = value || null;
      if (tentative) return;
      delete memory[id];
      if (value) localStorage.setItem(KEY(id), value);
      else localStorage.removeItem(KEY(id));
    },
  };

  // The day's history is a few MB: the Cache API holds it (localStorage is too small).
  const historyStore = {
    async read(day) {
      if (!window.caches) return null;
      const r = await (await caches.open('meridian-history')).match(`/__history/${day}`);
      return r ? r.json() : null;
    },
    async write(day, data) {
      if (!window.caches) return;
      const c = await caches.open('meridian-history');
      for (const k of await c.keys()) await c.delete(k);
      await c.put(`/__history/${day}`, new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } }));
    },
  };

  const pageFetch = window.fetch.bind(window);
  const ready = (async () => {
    const [{ createBackend }, { liveSymbols }] = await Promise.all([import('../server/backend.mjs'), import('./live-universe.js')]);
    return createBackend({
      fetchImpl: nativeFetch,
      keyStore,
      historyStore,
      currentVersion: async () => (await (await pageFetch('/VERSION', { cache: 'no-store' })).text()).trim(),
      universe: liveSymbols(),
    });
  })();
  ready.catch((err) => console.error('Meridian backend failed to start', err));

  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return pageFetch(input, init);
    const post = String(init.method || 'GET').toUpperCase() === 'POST';
    try {
      const be = await ready;
      return reply(200, post ? await be.post(url.pathname, JSON.parse(init.body || '{}')) : await be.get(url.pathname, url.searchParams));
    } catch (err) {
      return reply(err.status && err.status < 500 ? err.status : post ? 400 : 502, { error: err.message });
    }
  };

  // Finnhub's live trades: the page listens on an EventSource; here they come straight from
  // the backend, batched every 250 ms like the PC server does.
  const PageEventSource = window.EventSource;
  window.EventSource = function EventSource(url, cfg) {
    if (new URL(url, location.href).pathname !== '/api/stream') return new PageEventSource(url, cfg);
    const es = { onmessage: null, readyState: 1, close: () => off?.() };
    let pending = [];
    let off = null;
    ready.then((be) => (off = be.onTrades((t) => pending.push(...t)))).catch(() => {});
    setInterval(() => {
      if (!pending.length || !es.onmessage) return;
      const data = JSON.stringify(pending);
      pending = [];
      es.onmessage({ data });
    }, 250);
    return es;
  };
}
