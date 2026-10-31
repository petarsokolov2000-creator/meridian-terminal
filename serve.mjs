// Meridian Terminal server: serves the app and fetches real market data for it
// (browsers can't read Yahoo Finance directly). No dependencies. The data routes themselves
// live in server/backend.mjs, shared with the Android app.
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
import { createBackend } from './server/backend.mjs';
import { liveSymbols } from './src/live-universe.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8173;
const LAN = process.argv.includes('--lan');
// Mock runs keep their own cache so fixtures never stand in for real history.
const CACHE_DIR = path.join(ROOT, '.cache', process.env.MERIDIAN_MOCK ? 'mock' : 'yahoo');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

const mock = process.env.MERIDIAN_MOCK ? await import('./server/mock.mjs') : null;

// ---- API keys: an env var, or a git-ignored file next to this script ------------------------
// Keys never leave this PC: the browser only learns whether one is set.

const KEY_FILES = { finnhub: { env: 'FINNHUB_API_KEY', file: '.finnhub-key' }, fred: { env: 'FRED_API_KEY', file: '.fred-key' } };
const keys = {};
for (const [id, k] of Object.entries(KEY_FILES)) {
  keys[id] = process.env[k.env] || null;
  if (!keys[id]) {
    try {
      keys[id] = readFileSync(path.join(ROOT, k.file), 'utf8').trim() || null;
    } catch {
      // not set yet: that provider's features stay off
    }
  }
}
const keyStore = {
  get: (id) => keys[id],
  // A key being checked is held in memory only; it is written once the provider accepts it.
  set(id, value, { tentative = false } = {}) {
    keys[id] = value || null;
    if (tentative || process.env[KEY_FILES[id].env]) return;
    const file = path.join(ROOT, KEY_FILES[id].file);
    if (value) writeFileSync(file, value);
    else {
      try {
        unlinkSync(file);
      } catch {
        // nothing saved
      }
    }
  },
};

const backend = createBackend({
  ...(mock ? { fetchImpl: mock.mockFetch, WebSocketImpl: mock.MockWebSocket } : {}),
  keyStore,
  historyStore: {
    read: async (day) => JSON.parse(await readFile(path.join(CACHE_DIR, `history-${day}.json`), 'utf8')),
    write: async (day, data) => {
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(path.join(CACHE_DIR, `history-${day}.json`), JSON.stringify(data));
    },
  },
  currentVersion: async () => (await readFile(path.join(ROOT, 'VERSION'), 'utf8')).trim(),
  universe: liveSymbols(),
  mock: !!mock,
});

// Trades stream to every open browser tab as server-sent events, batched every 250 ms.
const streams = new Set();
let pending = [];
backend.onTrades((trades) => pending.push(...trades));
setInterval(() => {
  if (!pending.length) return;
  const data = `data: ${JSON.stringify(pending)}\n\n`;
  pending = [];
  for (const res of streams) res.write(data);
}, 250);

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

// ---- HTTP -------------------------------------------------------------------------------

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
const failure = (err) => (err.status && err.status < 500 ? err.status : 502);

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
  if (req.method === 'POST' && url.pathname === '/api/shutdown') {
    // The launcher stops a leftover server before updating. Only from this PC, JSON only.
    if (!isLocal(req) || !/^application\/json\b/i.test(req.headers['content-type'] || '')) return send(res, 403, { error: 'Not allowed' });
    send(res, 200, { ok: true });
    setTimeout(() => process.exit(0), 100);
    return;
  }
  if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
    // Only this PC may change or remove a key; a phone on the Wi-Fi can't.
    if (/\/key$/.test(url.pathname) && !isLocal(req)) return send(res, 403, { error: 'Set API keys from the PC running Meridian.' });
    try {
      send(res, 200, await backend.post(url.pathname, await readBody(req)));
    } catch (err) {
      send(res, failure(err) === 502 ? 400 : failure(err), { error: err.message });
    }
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    try {
      send(res, 200, await backend.get(url.pathname, url.searchParams));
    } catch (err) {
      send(res, failure(err), { error: err.message });
    }
    return;
  }
  const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const file = path.normalize(path.join(ROOT, rel));
  // server/ is served too: it holds no secrets (keys live in the dot-files blocked here), and the
  // Android app loads the same modules from its own copy.
  if (!file.startsWith(ROOT + path.sep) || /[\\/]\.cache[\\/]|\.(access-key|finnhub-key|fred-key)$/.test(file.slice(ROOT.length))) {
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
