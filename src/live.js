// Live market data engine. Same interface as the simulation Engine (instruments, get,
// daily, intraday, news, curve, ...), filled from the local server's /api/* routes, which
// fetch Yahoo Finance. Quotes refresh every 15 s; intraday bars, fundamentals and per-ticker
// news load when a panel asks for them.

import { LIVE_EQUITIES, LIVE_INDICES, LIVE_FX, LIVE_COMMODITIES, LIVE_CRYPTO, LIVE_BONDS, CURVE_TENORS, finnhubSymbol } from './live-universe.js';
import { SESSION_MIN } from './engine.js';
import { logReturns } from './studies.js';

const QUOTE_MS = 15000;
const INTRADAY_MS = 60000;
const NEWS_MS = 5 * 60000;
const MARKET_NEWS = [['stock market', 'Markets'], ['economy', 'Economy'], ['federal reserve', 'Central Banks'], ['oil prices', 'Commodities'], ['bitcoin', 'Crypto'], ['treasury yields', 'Rates'], ['dollar currency', 'FX'], ['earnings', 'Earnings']];

async function api(path) {
  const res = await fetch(path, { cache: 'no-store' });
  const body = await res.json().catch(() => ({ error: `Server answered ${res.status}` }));
  if (!res.ok || body.error) throw new Error(body.error || `Server answered ${res.status}`);
  return body;
}

export async function liveAvailable() {
  try {
    const s = await api('/api/status');
    return !!s.live;
  } catch {
    return false;
  }
}

function etParts(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', hourCycle: 'h23' })
    .formatToParts(d).reduce((o, x) => ((o[x.type] = x.value), o), {});
  return { iso: `${p.year}-${p.month}-${p.day}`, sec: Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second), weekday: p.weekday, hhmmss: `${p.hour}:${p.minute}:${p.second}` };
}
const dayIn = (tz, ms) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const dpFor = (p) => (p >= 1000 ? 2 : p >= 10 ? 2 : p >= 1 ? 4 : 5);

export class LiveEngine {
  constructor() {
    this.mode = 'live';
    this.live = true;
    this.speed = 1;
    this.listeners = {};
    this.instruments = [];
    this.bySym = new Map();
    this.stories = [];
    this.storyByKey = new Map();
    this.eco = [];
    this.ecoWeek = [];
    this.earnings = [];
    this.curveRows = [['US', 'United States', 'USD']];
    this.defaults = {
      sec: 'AAPL',
      watch: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'JPM', 'XOM', 'LLY', 'XBTUSD', 'GC1'],
      tape: ['SPX', 'NDX', 'INDU', 'SX5E', 'NKY', 'VIX', 'US10Y', 'EURUSD', 'USDJPY', 'GBPUSD', 'CL1', 'GC1', 'HG1', 'XBTUSD', 'XETUSD', 'AAPL', 'NVDA', 'MSFT'],
      corr: ['SPX', 'SX5E', 'NKY', 'US10Y', 'EURUSD', 'USDJPY', 'CL1', 'GC1', 'XBTUSD', 'VIX'],
      book: { AAPL: 50, MSFT: 30, JPM: 60, XOM: 80, GC1: 2 },
      bench: 'SPX',
    };
    this.status = { quotesAt: 0, error: null, degraded: false };
    this.intradayCache = new Map();
    this.profiles = new Map();
    this.symNews = new Map();
    // Finnhub add-on: real-time trades, news summaries, earnings estimates/actuals.
    this.fh = { configured: false, stream: 'off', error: null, ecoError: null, eco: null, streaming: 0, earnings: false };
    this.byFh = new Map();
    this.fred = { configured: false, economy: null, error: null };
    this.ratesInfo = { treasury: null, treasuryError: null, ecbError: null };
  }

  // ---------------------------------------------------------------- startup

  async init(onProgress = () => {}) {
    const t0 = performance.now();
    const add = (row, cls, extra = {}) => {
      const inst = { ysym: row[0], sym: row[1], cls, prints: [], history: [], ...extra };
      this.instruments.push(inst);
      this.bySym.set(inst.sym, inst);
      this.bySym.set(inst.ysym.toUpperCase(), inst);
    };
    for (const r of LIVE_EQUITIES) add(r, 'EQ', { sector: r[2], region: r[3] });
    for (const r of LIVE_INDICES) add(r, 'IDX', { name: r[2], region: r[3] });
    for (const r of LIVE_FX) add(r, 'FX', { name: r[2], ccy: r[1].slice(3) });
    for (const r of LIVE_COMMODITIES) add(r, 'CMDTY', { name: r[2], unit: r[3], ccy: 'USD' });
    for (const r of LIVE_CRYPTO) add(r, 'CRYPTO', { name: r[2], ccy: 'USD' });
    for (const r of LIVE_BONDS) add(r, 'BOND', { name: `United States ${r[2]} Treasury yield`, country: 'US', tenor: r[2], ccy: 'USD', additive: true });

    onProgress('Loading a year of daily history (first start of the day takes ~20–40 s)…');
    const hist = await api('/api/history');
    for (const inst of this.instruments) {
      const h = hist[inst.ysym];
      if (!h || !h.bars?.length) continue;
      const tz = h.meta.tz || 'America/New_York';
      const today = dayIn(tz, Date.now());
      const scale = this.yieldScale(inst, h.meta.price ?? h.bars[h.bars.length - 1].c);
      // Today's partial bar is rebuilt from live quotes, so it leaves the history.
      inst.history = h.bars.filter((b) => b.t < today).map((b) => ({ t: b.t, o: b.o * scale, h: b.h * scale, l: b.l * scale, c: b.c * scale, v: b.v }));
      inst.tz = tz;
      inst.name ||= h.meta.name;
      inst.ccy ||= h.meta.currency;
      inst.meta = h.meta;
    }
    const missing = this.instruments.filter((i) => i.history.length < 30);
    this.instruments = this.instruments.filter((i) => i.history.length >= 30);
    for (const i of missing) {
      this.bySym.delete(i.sym);
      this.bySym.delete(i.ysym.toUpperCase());
    }
    this.missing = missing.map((i) => i.sym);
    if (this.instruments.length < 20) throw new Error('Yahoo returned too little history to run on real data');
    this.equities = this.instruments.filter((i) => i.cls === 'EQ');

    onProgress('Loading official yield curves (US Treasury, ECB)…');
    await this.loadRates().catch((err) => (this.ratesInfo.treasuryError = err.message));
    onProgress('Loading quotes…');
    await this.refreshQuotes();
    this.computeStats();
    // Finnhub first, so the first headline load already includes its summaries.
    await this.initFinnhub(onProgress).catch((err) => (this.fh.error = err.message));
    onProgress('Loading headlines…');
    await this.refreshMarketNews().catch(() => {});
    this.buildMs = performance.now() - t0;
    this.date = etParts().iso;
    await this.initFred().catch((err) => (this.fred.error = err.message));
    this.timers = [
      setInterval(() => this.loadRates().catch(() => {}), 60 * 60000),
      setInterval(() => this.refreshQuotes().catch(() => {}), QUOTE_MS),
      setInterval(() => this.refreshMarketNews().catch(() => {}), NEWS_MS),
    ];
    return this;
  }

  // Yahoo quotes some yield indices ×10 in places; keep every yield in percent.
  yieldScale(inst, p) {
    return inst.cls === 'BOND' && p > 20 ? 0.1 : 1;
  }

  async refreshQuotes() {
    const syms = this.instruments.filter((i) => !i.eod).map((i) => i.ysym);
    let r;
    try {
      r = await api(`/api/quotes?symbols=${encodeURIComponent(syms.join(','))}`);
    } catch (err) {
      this.status.error = err.message;
      this.emit('status', this.status);
      return;
    }
    const count = Object.keys(r.quotes).length;
    this.status = {
      quotesAt: Date.now(), degraded: r.degraded, count,
      // Prices fall back to the last close when quotes don't arrive: say so loudly.
      error: count < syms.length / 2 ? `Yahoo returned quotes for only ${count} of ${syms.length} instruments; the rest show their last close` : null,
    };
    for (const inst of this.instruments) {
      if (inst.eod) continue; // official end-of-day series refresh in loadRates()
      const q = r.quotes[inst.ysym];
      const lastBar = inst.history[inst.history.length - 1];
      if (!q || q.price == null) {
        if (inst.last == null) this.applyQuote(inst, { price: lastBar.c, prevClose: lastBar.c, stale: true });
        continue;
      }
      this.applyQuote(inst, q);
    }
    if (!this.fh.earnings) this.earnings = this.equities.filter((i) => i.earnings?.date).map((i) => i.earnings).sort((a, b) => a.date.localeCompare(b.date) || a.sym.localeCompare(b.sym));
    this.emit('quotes', this.status);
  }

  applyQuote(inst, q) {
    // A Finnhub trade from the last minute is fresher than Yahoo's (often delayed) quote.
    const rt = inst.rtAt && Date.now() - inst.rtAt < 60000;
    if (rt) q = { ...q, price: inst.last, high: Math.max(q.high ?? inst.last, inst.high ?? inst.last), low: Math.min(q.low ?? inst.last, inst.low ?? inst.last) };
    const sc = this.yieldScale(inst, q.price);
    const lastBar = inst.history[inst.history.length - 1];
    const prev = inst.last;
    inst.last = q.price * sc;
    inst.prevClose = (q.prevClose ?? lastBar.c / sc) * sc;
    inst.open = (q.open ?? q.prevClose ?? q.price) * sc;
    inst.high = Math.max((q.high ?? q.price) * sc, inst.last);
    inst.low = Math.min((q.low ?? q.price) * sc, inst.last);
    inst.volume = q.volume ?? 0;
    inst.dp = inst.cls === 'BOND' ? 3 : dpFor(inst.last);
    inst.price = inst.last;
    inst.chg = inst.last - inst.prevClose;
    inst.pct = inst.additive ? null : inst.chg / inst.prevClose;
    inst.chgBp = inst.additive ? inst.chg * 100 : null;
    const spread = inst.cls === 'EQ' ? Math.max(0.01, inst.last * 0.0002) : inst.last * 0.0001;
    inst.bid = q.bid ? q.bid * sc : inst.last - spread / 2;
    inst.ask = q.ask ? q.ask * sc : inst.last + spread / 2;
    inst.bidSize = q.bidSize;
    inst.askSize = q.askSize;
    inst.stale = !!q.stale;
    // 'ecb': Yahoo had no quote, so this is the ECB's once-a-day reference rate
    inst.quoteSource = q.source || null;
    inst.quoteAsOf = q.asOf || null;
    inst.quoteTime = q.time ? q.time * 1000 : null;
    inst.marketState = q.marketState;
    if (q.name && inst.cls === 'EQ') inst.name = q.name;
    if (q.hi52) inst.hi52 = q.hi52 * sc;
    if (q.lo52) inst.lo52 = q.lo52 * sc;
    if (inst.cls === 'EQ') {
      inst.marketCap = q.marketCap ?? inst.marketCap;
      inst.shares = q.shares ?? (inst.marketCap ? inst.marketCap / inst.last : inst.shares ?? 1e9 / inst.last);
      inst.eps = q.eps ?? inst.eps ?? null;
      inst.divYield = q.divYield ?? inst.divYield ?? 0;
      inst.adv = q.avgVolume ?? inst.adv ?? 0;
      if (q.earnings && !inst.earnings?.fromFinnhub) {
        const ms = q.earnings * 1000;
        const et = etParts(new Date(ms));
        inst.earnings = { sym: inst.sym, name: inst.name, date: et.iso, when: et.sec < 12 * 3600 ? 'BMO' : 'AMC', est: inst.earnings?.est ?? null, actual: null, revEst: inst.earnings?.revEst ?? null };
      }
    } else if (inst.cls === 'CRYPTO') {
      inst.marketCap = q.marketCap ?? inst.marketCap;
    }
    // Synthesized prints from observed quote changes, labelled as such in TAPE.
    if (!rt && !inst.rtAt && prev != null && prev !== inst.last && inst.cls === 'EQ') {
      inst.prints.unshift({ s: etParts().sec - 9.5 * 3600, p: inst.last, q: 0, side: inst.last > prev ? 1 : -1 });
      if (inst.prints.length > 120) inst.prints.pop();
    }
    // Keep a forming intraday bar in step with the quote.
    const cached = this.intradayCache.get(inst.sym);
    if (cached?.bars.length) {
      const b = cached.bars[cached.bars.length - 1];
      b.c = inst.last;
      b.h = Math.max(b.h, inst.last);
      b.l = Math.min(b.l, inst.last);
    }
  }

  computeStats() {
    const bench = this.get(this.defaults.bench);
    const bR = bench ? logReturns(bench.history.map((b) => b.c)) : [];
    for (const inst of this.instruments) {
      const h = inst.history;
      inst.hi52 ??= Math.max(...h.map((b) => b.h));
      inst.lo52 ??= Math.min(...h.map((b) => b.l));
      if (inst.additive) continue;
      const rr = logReturns(h.map((b) => b.c));
      const mean = rr.reduce((a, b) => a + b, 0) / rr.length;
      inst.realVol = Math.sqrt(rr.reduce((a, b) => a + (b - mean) ** 2, 0) / (rr.length - 1)) * Math.sqrt(252);
      inst.vol = inst.realVol;
      if ((inst.cls === 'EQ' || inst.cls === 'IDX') && bR.length) {
        // Align on the most recent common length (exchanges have different holidays).
        const n = Math.min(rr.length, bR.length);
        const x = bR.slice(-n);
        const y = rr.slice(-n);
        const mx = x.reduce((a, b) => a + b, 0) / n;
        const my = y.reduce((a, b) => a + b, 0) / n;
        let cov = 0;
        let vr = 0;
        for (let i = 0; i < n; i++) {
          cov += (y[i] - my) * (x[i] - mx);
          vr += (x[i] - mx) ** 2;
        }
        inst.histBeta = cov / vr;
      }
    }
  }

  // ---------------------------------------------------------------- news

  addStory(x, category) {
    const key = x.id || x.link || x.headline;
    const hkey = `h:${String(x.headline).toLowerCase().replace(/\W+/g, ' ').trim()}`;
    const seen = this.storyByKey.get(key) || this.storyByKey.get(hkey);
    if (seen) {
      if (x.body && !seen.body) seen.body = x.body; // Finnhub adds the summary Yahoo lacks
      return seen;
    }
    const tickers = (x.tickers || []).map((t) => this.bySym.get(String(t).toUpperCase())?.sym).filter(Boolean);
    const s = { id: this.stories.length + 1, headline: x.headline, body: x.body || '', source: x.source, link: x.link, t: x.t, tickers, category: tickers.length && category === 'Markets' ? 'Company' : category, sentiment: 0, impact: 0 };
    s.minute = this.minuteOf(x.t);
    this.stories.push(s);
    this.storyByKey.set(key, s);
    this.storyByKey.set(hkey, s);
    return s;
  }

  async refreshMarketNews() {
    const before = this.stories.length;
    await Promise.all(MARKET_NEWS.map(async ([q, cat]) => {
      try {
        for (const x of await api(`/api/news?q=${encodeURIComponent(q)}&n=15`)) this.addStory(x, cat);
      } catch {
        // one query failing leaves the others
      }
    }));
    if (this.fh.configured) {
      const cats = [['general', 'Markets'], ['forex', 'FX'], ['crypto', 'Crypto'], ['merger', 'Company']];
      await Promise.all(cats.map(async ([c, cat]) => {
        try {
          for (const x of await api(`/api/finnhub/news?category=${c}`)) this.addStory(x, cat);
        } catch {
          // Yahoo headlines still cover it
        }
      }));
    }
    const fresh = this.stories.slice(before).filter((s) => Date.now() - s.t < 20 * 60000);
    if (before && fresh.length) this.emit('news', fresh);
  }

  ensureSymNews(inst) {
    const c = this.symNews.get(inst.sym);
    if (c && (c.loading || Date.now() - c.at < NEWS_MS)) return;
    this.symNews.set(inst.sym, { loading: true, at: Date.now() });
    api(`/api/news?q=${encodeURIComponent(inst.ysym)}&n=20`).then((list) => {
      for (const x of list) {
        const s = this.addStory(x, 'Company');
        if (!s.tickers.includes(inst.sym)) s.tickers.push(inst.sym);
      }
    }).catch(() => {}).finally(() => this.symNews.set(inst.sym, { loading: false, at: Date.now() }));
    if (this.fh.configured && inst.cls === 'EQ') {
      api(`/api/finnhub/company-news?symbol=${encodeURIComponent(finnhubSymbol(inst.ysym, 'EQ'))}`).then((list) => {
        for (const x of list) {
          const s = this.addStory(x, 'Company');
          if (!s.tickers.includes(inst.sym)) s.tickers.push(inst.sym);
        }
      }).catch(() => {});
    }
  }

  // ---------------------------------------------------------------- Finnhub

  async initFinnhub(onProgress) {
    const st = await api('/api/finnhub/status');
    this.fh.configured = st.configured;
    if (!st.configured) return;
    onProgress('Connecting to Finnhub…');
    for (const i of this.instruments) {
      const f = finnhubSymbol(i.ysym, i.cls);
      if (f) {
        i.fhsym = f;
        this.byFh.set(f, i);
      }
    }
    if (typeof EventSource !== 'undefined') {
      this.es = new EventSource('/api/stream');
      this.es.onmessage = (ev) => {
        try {
          for (const t of JSON.parse(ev.data)) this.applyTrade(t);
        } catch {
          // ignore a malformed batch
        }
      };
    }
    this.setFocus([]);
    await Promise.all([this.loadFhEarnings(), this.loadFhEconomic()]);
    this.fhTimer = setInterval(() => {
      api('/api/finnhub/status').then((s) => Object.assign(this.fh, { stream: s.stream, error: s.error, streaming: s.streaming.length })).catch(() => {});
    }, 5000);
    setInterval(() => this.loadFhEarnings(), 30 * 60000);
    setInterval(() => this.loadFhEconomic(), 15 * 60000);
  }

  // Stream priority: what's on screen first, then the biggest stocks and the coins.
  setFocus(syms) {
    if (!this.fh.configured) return;
    const insts = [...syms.map((s) => this.get(s)), ...this.equities.slice().sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0)), ...this.instruments.filter((i) => i.cls === 'CRYPTO')];
    const list = [...new Set(insts.filter((i) => i?.fhsym).map((i) => i.fhsym))].slice(0, 50);
    const sig = list.join(',');
    if (sig === this.fhSig) return;
    this.fhSig = sig;
    fetch('/api/finnhub/stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ symbols: list }) })
      .then((r) => r.json()).then((s) => Object.assign(this.fh, { stream: s.stream, error: s.error, streaming: (s.streaming || []).length })).catch(() => {});
  }

  applyTrade({ s, p, v, t }) {
    const inst = this.byFh.get(s);
    if (!inst || !Number.isFinite(p) || inst.prevClose == null) return;
    const prev = inst.last;
    inst.last = p;
    inst.price = p;
    inst.rtAt = Date.now();
    inst.high = Math.max(inst.high, p);
    inst.low = Math.min(inst.low, p);
    inst.chg = p - inst.prevClose;
    inst.pct = inst.chg / inst.prevClose;
    const half = (inst.ask - inst.bid) / 2 || p * 0.0001;
    inst.bid = p - half;
    inst.ask = p + half;
    inst.prints.unshift({ s: etParts(new Date(t || Date.now())).sec - 9.5 * 3600, p, q: v, side: p > prev ? 1 : p < prev ? -1 : (inst.prints[0]?.side ?? 1), real: true });
    if (inst.prints.length > 200) inst.prints.pop();
    const cached = this.intradayCache.get(inst.sym);
    if (cached?.bars.length) {
      const b = cached.bars[cached.bars.length - 1];
      b.c = p;
      b.h = Math.max(b.h, p);
      b.l = Math.min(b.l, p);
    }
  }

  async loadFhEarnings() {
    try {
      const list = await api('/api/finnhub/earnings');
      const rows = [];
      for (const e of list) {
        const inst = this.byFh.get(e.symbol);
        if (!inst || inst.cls !== 'EQ') continue;
        const row = { sym: inst.sym, name: inst.name, date: e.date, when: { bmo: 'BMO', amc: 'AMC', dmh: 'DMH' }[e.hour] || '—', est: e.epsEstimate, actual: e.epsActual, revEst: e.revenueEstimate, revActual: e.revenueActual, fromFinnhub: true };
        rows.push(row);
        if (!inst.earnings?.fromFinnhub || row.date >= etParts().iso) inst.earnings = row;
      }
      this.earnings = rows.sort((a, b) => a.date.localeCompare(b.date) || a.sym.localeCompare(b.sym));
      this.fh.earnings = true;
    } catch (err) {
      this.fh.earningsError = err.message;
    }
  }

  async loadFhEconomic() {
    try {
      this.fh.eco = await api('/api/finnhub/economic');
      this.fh.ecoError = null;
    } catch (err) {
      this.fh.ecoError = err.message;
    }
  }

  news({ sym, category, limit = 200 } = {}) {
    let s = this.stories;
    if (sym) {
      const inst = this.get(sym);
      if (inst) this.ensureSymNews(inst);
      s = s.filter((x) => x.tickers.includes(sym));
    }
    if (category) s = s.filter((x) => x.category === category);
    return [...s].sort((a, b) => b.t - a.t).slice(0, limit);
  }

  storyTime(s) {
    const et = etParts(new Date(s.t));
    return et.iso === etParts().iso ? et.hhmmss.slice(0, 5) : et.iso.slice(5);
  }

  // ---------------------------------------------------------------- fundamentals & options

  profile(sym) {
    const inst = this.get(sym);
    if (!inst) return Promise.reject(new Error(`Unknown ${sym}`));
    if (!this.profiles.has(inst.sym)) {
      const p = api(`/api/profile?symbol=${encodeURIComponent(inst.ysym)}`).then((pr) => {
        if (pr.summary) inst.desc = pr.summary;
        if (pr.profitMargin != null) inst.margin = pr.profitMargin;
        if (inst.earnings && pr.epsEstimate != null) {
          inst.earnings.est = pr.epsEstimate;
          inst.earnings.revEst = pr.revenueEstimate;
        }
        return pr;
      });
      p.catch(() => this.profiles.delete(inst.sym));
      this.profiles.set(inst.sym, p);
    }
    return this.profiles.get(inst.sym);
  }

  options(sym, date) {
    const inst = this.get(sym);
    return api(`/api/options?symbol=${encodeURIComponent(inst.ysym)}${date ? `&date=${date}` : ''}`);
  }

  // ---------------------------------------------------------------- clock (real time)

  advance() {
    this.emit('tick', this);
  }
  get minute() {
    return Math.max(0, Math.min(SESSION_MIN, Math.floor((etParts().sec - 9.5 * 3600) / 60)));
  }
  get closed() {
    const et = etParts();
    return ['Sat', 'Sun'].includes(et.weekday) || et.sec < 9.5 * 3600 || et.sec >= 16 * 3600;
  }
  minuteOf(ms) {
    const et = etParts(new Date(ms));
    const dayShift = Math.round((Date.parse(`${et.iso}T00:00:00Z`) - Date.parse(`${etParts().iso}T00:00:00Z`)) / 86400000);
    return Math.floor((et.sec - 9.5 * 3600) / 60) + dayShift * 1440;
  }
  timeLabel() {
    return etParts().hhmmss;
  }
  minuteLabel(m) {
    const s = (((9.5 * 3600 + m * 60) % 86400) + 86400) % 86400;
    return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
  }
  sourceLabel() {
    if (this.status.error) return { text: this.status.quotesAt ? 'STALE DATA' : 'DATA ERROR', title: this.status.error, cls: 'err' };
    const age = Math.round((Date.now() - this.status.quotesAt) / 1000);
    const yahoo = `Quotes from Yahoo Finance, refreshed every ${QUOTE_MS / 1000}s. Exchange data may be delayed up to 15–20 min.${this.status.degraded ? ' Quote API refused; using slower chart fallback.' : ''}`;
    if (this.fh.configured) {
      const live = this.fh.stream === 'live' && !this.fh.error;
      const fh = live ? `Finnhub real-time trades streaming for ${this.fh.streaming} symbols (US stocks and crypto); everything else from Yahoo.` : `Finnhub stream ${this.fh.stream}${this.fh.error ? `: ${this.fh.error}` : ''}.`;
      return { text: `YAHOO · ${age}s · ${live ? `FH RT ${this.fh.streaming}` : 'FH ✕'}`, title: `${fh} ${yahoo}`, cls: live && !this.status.degraded ? 'ok' : 'warn' };
    }
    return { text: `YAHOO · ${age}s`, title: `${yahoo} Add a Finnhub key (FINNHUB <key>) for real-time US stock trades.`, cls: this.status.degraded ? 'warn' : 'ok' };
  }

  // ---------------------------------------------------------------- queries

  get(sym) {
    if (!sym) return null;
    return this.bySym.get(String(sym).toUpperCase()) || null;
  }

  search(q) {
    q = q.toUpperCase();
    return this.instruments.filter((i) => i.sym.startsWith(q) || i.ysym.toUpperCase().startsWith(q) || (i.name || '').toUpperCase().includes(q)).slice(0, 12);
  }

  daily(sym) {
    const inst = this.get(sym);
    if (!inst) return [];
    return [...inst.history, { t: etParts().iso, o: inst.open, h: inst.high, l: inst.low, c: inst.last, v: inst.volume, live: true }];
  }

  intraday(sym) {
    const inst = this.get(sym);
    if (!inst) return [];
    const c = this.intradayCache.get(inst.sym);
    if (!c || (!c.loading && Date.now() - c.at > INTRADAY_MS)) {
      const entry = { bars: c?.bars || [], loading: true, at: Date.now() };
      this.intradayCache.set(inst.sym, entry);
      api(`/api/intraday?symbol=${encodeURIComponent(inst.ysym)}`).then((r) => {
        const sc = this.yieldScale(inst, r.meta.price ?? 0);
        entry.bars = r.bars.map((b) => ({ m: this.minuteOf(b.ts * 1000), o: b.o * sc, h: b.h * sc, l: b.l * sc, c: b.c * sc, v: b.v }));
      }).catch(() => {}).finally(() => {
        entry.loading = false;
        entry.at = Date.now();
      });
    }
    return this.intradayCache.get(inst.sym).bars;
  }

  curve(cc) {
    return CURVE_TENORS.map((t) => this.get(`${cc}${t}`)).filter(Boolean).map((i) => ({
      tenor: i.tenor, years: { '3M': 0.25, '2Y': 2, '5Y': 5, '10Y': 10, '30Y': 30 }[i.tenor], y: i.last, prev: i.prevClose,
      wk: i.history[Math.max(0, i.history.length - 5)].c, mo: i.history[Math.max(0, i.history.length - 21)].c,
    }));
  }

  // ---------------------------------------------------------------- official curves & FRED

  // End-of-day yields: the US 2Y from the Treasury, euro-area curves from the ECB. They
  // become ordinary BOND instruments (daily history, last = latest fixing).
  async loadRates() {
    const r = await api('/api/rates');
    this.ratesInfo = { treasury: r.treasury, treasuryError: r.treasuryError, ecbError: r.ecbError };
    const make = (sym, name, cc, tenor, ccy, points, source) => {
      if (!points || points.length < 2) return;
      let inst = this.get(sym);
      if (!inst) {
        inst = { ysym: sym, sym, cls: 'BOND', name, country: cc, tenor, ccy, additive: true, prints: [], eod: true, source };
        this.instruments.push(inst);
        this.bySym.set(sym, inst);
      }
      const past = points.slice(0, -1);
      inst.history = past.map((p) => ({ t: p.t, o: p.v, h: p.v, l: p.v, c: p.v, v: 0 }));
      const last = points[points.length - 1];
      inst.asOf = last.t;
      this.applyQuote(inst, { price: last.v, prevClose: past[past.length - 1].v, open: last.v, high: last.v, low: last.v, volume: 0 });
      inst.hi52 = Math.max(...points.map((p) => p.v));
      inst.lo52 = Math.min(...points.map((p) => p.v));
    };
    if (r.treasury) {
      const col = r.treasury.tenors.find((t) => t.years === 2)?.label;
      if (col) make('US2Y', 'United States 2Y Treasury yield (official close)', 'US', '2Y', 'USD', r.treasury.rows.filter((x) => x.y[col] != null).map((x) => ({ t: x.date, v: x.y[col] })), 'treasury');
    }
    const rows = [['US', 'United States', 'USD']];
    if (r.ecb) {
      const names = { EA: 'Euro area AAA', EZ: 'Euro area all issuers' };
      for (const cc of ['EA', 'EZ']) {
        for (const t of CURVE_TENORS) make(`${cc}${t}`, `${names[cc]} ${t} govt yield (ECB)`, cc, t, 'EUR', r.ecb[cc]?.[t], 'ecb');
        if (CURVE_TENORS.every((t) => this.get(`${cc}${t}`))) rows.push([cc, `${names[cc]} (ECB)`, 'EUR']);
      }
    }
    this.curveRows = rows;
    this.treasury = r.treasury;
  }

  async initFred() {
    const st = await api('/api/fred/status');
    this.fred.configured = st.configured;
    if (!st.configured) return;
    const load = () => api('/api/fred/economy').then((e) => {
      this.fred.economy = e;
      this.fred.error = null;
    }).catch((err) => (this.fred.error = err.message));
    await load();
    setInterval(load, 60 * 60000);
  }

  ecoToday() {
    return [];
  }

  book(sym) {
    const inst = this.get(sym);
    if (!inst) return null;
    return { bids: [{ p: inst.bid, q: inst.bidSize ?? 0, n: 1 }], asks: [{ p: inst.ask, q: inst.askSize ?? 0, n: 1 }] };
  }

  on(ev, fn) {
    (this.listeners[ev] ||= []).push(fn);
    return () => (this.listeners[ev] = this.listeners[ev].filter((f) => f !== fn));
  }
  emit(ev, data) {
    for (const fn of this.listeners[ev] || []) fn(data);
  }
}
