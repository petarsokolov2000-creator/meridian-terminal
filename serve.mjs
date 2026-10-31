// Meridian Terminal server: serves the app and fetches real market data for it
// (browsers can't read Yahoo Finance directly). No dependencies.
//
//   node serve.mjs            http://localhost:8173 on this PC
//   node serve.mjs --open     ...and open the browser
//   node serve.mjs --lan      also reachable from your phone on the same Wi-Fi, with an access key
//   MERIDIAN_MOCK=1 node serve.mjs   offline fixtures instead of Yahoo (for testing)

import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { randomInt, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createYahoo, pool } from './server/yahoo.mjs';
import { createFinnhub } from './server/finnhub.mjs';
import { createFred } from './server/fred.mjs';
import { createRates } from './server/rates.mjs';
import { liveSymbols } from './src/live-universe.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8173;
const LAN = process.argv.includes('--lan');
// Mock runs keep their own cache so fixtures never stand in for real history.
const CACHE_DIR = path.join(ROOT, '.cache', process.env.MERIDIAN_MOCK ? 'mock' : 'yahoo');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

const mock = process.env.MERIDIAN_MOCK ? await import('./server/mock.mjs') : null;
const yahoo = mock ? createYahoo({ fetchImpl: mock.mockFetch }) : createYahoo();

// ---- API keys: an env var, or a git-ignored file next to this script ------------------------
// Keys never leave this PC: the browser only learns whether one is set.

const KEYS = {
  finnhub: { env: 'FINNHUB_API_KEY', file: '.finnhub-key', label: 'Finnhub', pattern: /^[A-Za-z0-9]{10,64}$/ },
  fred: { env: 'FRED_API_KEY', file: '.fred-key', label: 'FRED', pattern: /^[a-z0-9]{32}$/ },
};
const keys = {};
for (const [id, k] of Object.entries(KEYS)) {
  keys[id] = process.env[k.env] || null;
  if (!keys[id]) {
    try {
      keys[id] = readFileSync(path.join(ROOT, k.file), 'utf8').trim() || null;
    } catch {
      // not set yet: that provider's features stay off
    }
  }
}
const fetchOpts = mock ? { fetchImpl: mock.mockFetch } : {};
const finnhub = createFinnhub({ getKey: () => keys.finnhub, ...fetchOpts, ...(mock ? { WebSocketImpl: mock.MockWebSocket } : {}) });
const fred = createFred({ getKey: () => keys.fred, ...fetchOpts });
const rates = createRates(fetchOpts);
const providers = { finnhub: { check: () => finnhub.check(), restart: () => finnhub.restart() }, fred: { check: () => fred.check(), restart: () => fred.reset() } };

// Trades stream to every open browser tab as server-sent events, batched every 250 ms.
const streams = new Set();
let pending = [];
finnhub.onTrades((trades) => pending.push(...trades));
setInterval(() => {
  if (!pending.length) return;
  const data = `data: ${JSON.stringify(pending)}\n\n`;
  pending = [];
  for (const res of streams) res.write(data);
}, 250);
const UNIVERSE = new Set(liveSymbols());

// ---- access key for other devices (only with --lan) ---------------------------------------

let accessKey = null;
if (LAN) {
  const keyFile = path.join(ROOT, '.access-key');
  try {
    accessKey = readFileSync(keyFile, 'utf8').trim();
  } catch {
    // first start
  }
  if (!/^\d{6}$/.test(accessKey || '')) {
    accessKey = String(randomInt(100000, 1000000));
    writeFileSync(keyFile, accessKey);
  }
}
const isLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
function keyOk(sent) {
  const a = Buffer.from(String(sent || ''));
  const b = Buffer.from(accessKey);
  return a.length === b.length && timingSafeEqual(a, b);
}
function authorized(req, url) {
  if (isLocal(req)) return true;
  if (!accessKey) return false;
  const cookie = /(?:^|;\s*)mkey=(\d{6})/.exec(req.headers.cookie || '')?.[1];
  return keyOk(url.searchParams.get('key')) || keyOk(cookie);
}

// ---- daily history: cached on disk per day, since it only changes once a day --------------

const today = () => new Date().toISOString().slice(0, 10);
let historyMem = null;
async function allHistory() {
  const file = path.join(CACHE_DIR, `history-${today()}.json`);
  if (historyMem?.day === today()) return historyMem.data;
  try {
    const data = JSON.parse(await readFile(file, 'utf8'));
    historyMem = { day: today(), data };
    return data;
  } catch {
    // not cached yet today
  }
  const data = {};
  const errors = {};
  await pool([...UNIVERSE], 6, async (s) => {
    try {
      const ch = await yahoo.chart(s, '1y', '1d');
      data[s] = { meta: ch.meta, bars: ch.bars.map(({ t, o, h, l, c, v }) => ({ t, o, h, l, c, v })) };
    } catch (err) {
      errors[s] = err.message;
    }
  });
  if (Object.keys(data).length > UNIVERSE.size * 0.8) {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(file, JSON.stringify(data));
    historyMem = { day: today(), data };
  }
  if (Object.keys(errors).length) console.warn(`History missing for ${Object.keys(errors).length} symbols:`, Object.entries(errors).slice(0, 5));
  return data;
}

// ---- version: compare with the newest one published on GitHub ------------------------------

const REPO = 'petarsokolov2000-creator/meridian-terminal';
let latestCache = null;
async function versionInfo() {
  let current = null;
  try {
    current = (await readFile(path.join(ROOT, 'VERSION'), 'utf8')).trim();
  } catch {
    // running from a copy without a VERSION file
  }
  if (!latestCache || Date.now() - latestCache.at > 60 * 60e3) {
    let latest = null;
    if (!mock) {
      try {
        const res = await fetch(`https://raw.githubusercontent.com/${REPO}/main/VERSION`, { signal: AbortSignal.timeout(5000) });
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

// ---- routes -----------------------------------------------------------------------------

// POST bodies must be JSON: other websites can't send that cross-origin without a CORS
// preflight, which this server never approves, so they can't drive these routes.
function readBody(req, limit = 64 * 1024) {
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return Promise.reject(new Error('Expected a JSON request'));
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Request too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('Request body is not JSON'));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
const syms = (v) => String(v || '').split(',').map((s) => s.trim()).filter((s) => s && UNIVERSE.has(s)).slice(0, 200);
const oneSym = (v) => (/^[\w^=.\-/:]{1,24}$/.test(v || '') ? v : null);

const routes = {
  '/api/status': async () => ({ ok: true, live: true, mock: !!process.env.MERIDIAN_MOCK }),
  '/api/history': async () => allHistory(),
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
    const s = oneSym(q.get('symbol'));
    if (!s) throw Object.assign(new Error('Bad symbol'), { status: 400 });
    const ch = await yahoo.chart(s, '1d', q.get('interval') === '5m' ? '5m' : '1m');
    return { meta: ch.meta, bars: ch.bars };
  },
  '/api/chart': async (q) => {
    const s = oneSym(q.get('symbol'));
    const range = ['5y', '10y', 'max', '2y', '1y'].includes(q.get('range')) ? q.get('range') : '2y';
    if (!s) throw Object.assign(new Error('Bad symbol'), { status: 400 });
    const ch = await yahoo.chart(s, range, range === 'max' || range === '10y' ? '1wk' : '1d');
    return { meta: ch.meta, bars: ch.bars };
  },
  '/api/news': async (q) => yahoo.news(String(q.get('q') || 'stock market').slice(0, 60), Math.min(30, Number(q.get('n')) || 20)),
  '/api/profile': async (q) => {
    const s = oneSym(q.get('symbol'));
    if (!s) throw Object.assign(new Error('Bad symbol'), { status: 400 });
    return yahoo.profile(s);
  },
  '/api/finnhub/status': async () => finnhub.status(),
  '/api/rates': async () => {
    // Each source on its own: one failing leaves the other.
    const [t, e] = await Promise.allSettled([rates.treasury(), rates.ecb()]);
    return { treasury: t.value ?? null, treasuryError: t.reason?.message ?? null, ecb: e.value ?? null, ecbError: e.reason?.message ?? null };
  },
  '/api/fred/status': async () => ({ configured: !!keys.fred }),
  '/api/version': async () => versionInfo(),
  '/api/fred/economy': async () => fred.economy(),
  '/api/finnhub/news': async (q) => finnhub.news(['general', 'forex', 'crypto', 'merger'].includes(q.get('category')) ? q.get('category') : 'general'),
  '/api/finnhub/company-news': async (q) => {
    const s = oneSym(q.get('symbol'));
    if (!s) throw Object.assign(new Error('Bad symbol'), { status: 400 });
    return finnhub.companyNews(s);
  },
  '/api/finnhub/earnings': async () => finnhub.earnings(),
  '/api/finnhub/economic': async () => finnhub.economic(),
  '/api/options': async (q) => {
    const s = oneSym(q.get('symbol'));
    if (!s) throw Object.assign(new Error('Bad symbol'), { status: 400 });
    const d = Number(q.get('date')) || null;
    return yahoo.options(s, d);
  },
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!authorized(req, url)) {
    res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><meta name=viewport content="width=device-width"><body style="font:16px system-ui;background:#000;color:#ddd;padding:24px"><h3>Meridian Terminal</h3><form><p>Enter the access key shown in the terminal window on your PC.</p><input name=key inputmode=numeric autofocus style="font-size:20px;width:8em"> <button>Open</button></form>');
    return;
  }
  // Remember the key so the phone doesn't need it in every URL.
  const key = url.searchParams.get('key');
  if (key && keyOk(key)) res.setHeader('set-cookie', `mkey=${key}; Path=/; Max-Age=31536000; SameSite=Strict; HttpOnly`);

  if (url.pathname === '/api/stream') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(': connected\n\n');
    streams.add(res);
    req.on('close', () => streams.delete(res));
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/finnhub/stream') {
    try {
      const body = await readBody(req);
      finnhub.setStream((Array.isArray(body.symbols) ? body.symbols : []).filter((s) => typeof s === 'string' && oneSym(s)));
      send(res, 200, finnhub.status());
    } catch (err) {
      send(res, 400, { error: err.message });
    }
    return;
  }
  const keyRoute = /^\/api\/(finnhub|fred)\/key$/.exec(url.pathname);
  if (req.method === 'POST' && keyRoute) {
    const id = keyRoute[1];
    const k = KEYS[id];
    // Only from this PC: a phone on the Wi-Fi can't change or remove a key.
    if (!isLocal(req)) return send(res, 403, { error: `Set the ${k.label} key from the PC running Meridian.` });
    try {
      const value = String((await readBody(req)).key || '').trim();
      if (!value) {
        keys[id] = null;
        try {
          unlinkSync(path.join(ROOT, k.file));
        } catch {
          // nothing saved
        }
        providers[id].restart();
        return send(res, 200, { ok: true, removed: true });
      }
      if (!k.pattern.test(value)) return send(res, 400, { error: `That doesn't look like a ${k.label} API key${id === 'fred' ? ' (32 lower-case letters and digits)' : ' (letters and digits only)'}.` });
      const previous = keys[id];
      keys[id] = value;
      try {
        await providers[id].check();
      } catch (err) {
        keys[id] = previous;
        return send(res, 400, { error: `${k.label} didn't accept it: ${err.message}` });
      }
      if (!process.env[k.env]) writeFileSync(path.join(ROOT, k.file), value);
      providers[id].restart();
      send(res, 200, { ok: true });
    } catch (err) {
      send(res, 400, { error: err.message });
    }
    return;
  }
  const route = routes[url.pathname];
  if (route) {
    try {
      send(res, 200, await route(url.searchParams));
    } catch (err) {
      send(res, err.status && err.status < 500 ? err.status : 502, { error: err.message });
    }
    return;
  }
  const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep) || /[\\/](server|\.cache)[\\/]|\.(access-key|finnhub-key|fred-key)$/.test(file.slice(ROOT.length))) {
    res.writeHead(404).end('Not found');
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).on('error', (err) => {
  console.error(err.code === 'EADDRINUSE'
    ? `Port ${PORT} is already used by another program. Close it, or start Meridian with a different port (set PORT=8180).`
    : `Meridian's server could not start: ${err.message}`);
  process.exit(1);
}).listen(PORT, LAN ? '0.0.0.0' : '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  Meridian Terminal  ${url}${process.env.MERIDIAN_MOCK ? '   (MOCK DATA)' : ''}`);
  if (LAN) {
    const ips = Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
    for (const ip of ips) console.log(`  On your phone:     http://${ip}:${PORT}/?key=${accessKey}`);
    console.log('  (same Wi-Fi only; the key is saved in .access-key — delete that file to make a new one)');
  }
  console.log(`  Finnhub:           ${keys.finnhub ? 'key loaded (real-time trades, news, earnings)' : 'no key — type FINNHUB <your key> in the terminal to add one'}`);
  console.log(`  FRED:              ${keys.fred ? 'key loaded (US economic releases)' : 'no key — type FRED <your key> in the terminal to add one'}`);
  console.log('  Keep this window open while you use the terminal. Ctrl+C stops it.\n');
  if (process.argv.includes('--open')) exec(`${process.platform === 'win32' ? 'start ""' : process.platform === 'darwin' ? 'open' : 'xdg-open'} ${url}`);
});
