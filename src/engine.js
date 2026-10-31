// Market simulation engine.
//
// One seed per calendar date generates: a year of daily history, overnight news and gaps,
// and the whole of today's 390-minute session (minute bars, intraday news, economic
// releases). The clock then reveals that session; between minute closes, live ticks follow
// a Brownian bridge so they always land exactly on the precomputed bar.
//
// Returns come from a factor model (global risk, region, sector, USD, commodity groups,
// crypto, per-country rate level/slope), so prices move together the way markets do.

import { Rng, hashString } from './rng.js';
import { RAW, SECTORS, CURVES, TENORS, TENOR_YEARS } from './universe.js';
import { companyStory, macroStory, ecoStory } from './news.js';

export const SESSION_MIN = 390; // 09:30 - 16:00 ET
const HIST_DAYS = 260;
const SQ252 = Math.sqrt(252);

const SECTOR_VOL = {
  Technology: 0.3, Semiconductors: 0.42, Financials: 0.24, 'Health Care': 0.26, Energy: 0.3,
  Industrials: 0.22, 'Consumer Disc.': 0.28, 'Consumer Staples': 0.17, Materials: 0.26,
  Utilities: 0.18, Communication: 0.26, 'Real Estate': 0.22,
};
const SECTOR_PE = {
  Technology: 32, Semiconductors: 28, Financials: 12, 'Health Care': 21, Energy: 10,
  Industrials: 20, 'Consumer Disc.': 24, 'Consumer Staples': 20, Materials: 15,
  Utilities: 17, Communication: 19, 'Real Estate': 30,
};
const SECTOR_YIELD = {
  Technology: 0.6, Semiconductors: 0.8, Financials: 2.8, 'Health Care': 1.6, Energy: 3.9,
  Industrials: 1.7, 'Consumer Disc.': 1.0, 'Consumer Staples': 2.9, Materials: 2.2,
  Utilities: 3.8, Communication: 1.4, 'Real Estate': 3.9,
};
const REGION_CCY = { US: 'USD', EU: 'EUR', ASIA: 'JPY' };

// Intraday volatility profile: heavier at the open and into the close.
const VOL_PROFILE = (() => {
  const raw = [];
  for (let m = 0; m < SESSION_MIN; m++) {
    raw.push(1 + 1.6 * Math.exp(-m / 22) + 0.7 * Math.exp(-(SESSION_MIN - 1 - m) / 28));
  }
  const norm = Math.sqrt(raw.reduce((s, x) => s + x * x, 0));
  return raw.map((x) => x / norm);
})();
const VOLU_PROFILE = (() => {
  const raw = VOL_PROFILE.map((x) => x * x);
  const s = raw.reduce((a, b) => a + b, 0);
  return raw.map((x) => x / s);
})();

export function etNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).reduce((o, p) => ((o[p.type] = p.value), o), {});
  return {
    iso: `${parts.year}-${parts.month}-${parts.day}`,
    secOfDay: Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second),
  };
}

function prevBusinessDays(iso, n) {
  const out = [];
  const d = new Date(`${iso}T12:00:00Z`);
  while (out.length < n) {
    d.setUTCDate(d.getUTCDate() - 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.unshift(d.toISOString().slice(0, 10));
  }
  return out;
}
function nextBusinessDays(iso, n) {
  const out = [];
  const d = new Date(`${iso}T12:00:00Z`);
  while (out.length < n) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export class Engine {
  constructor({ date, startSec, speed = 1 } = {}) {
    const et = etNow();
    this.date = date || et.iso;
    this.seed = hashString(`meridian:${this.date}`);
    this.speed = speed;
    this.listeners = {};
    this.mode = 'sim';
    this.curveRows = CURVES;
    this.defaults = {
      sec: 'ARCX',
      watch: ['ARCX', 'SLCN', 'NVLT', 'FNDR', 'VTLS', 'PTRA', 'DRVE', 'LUXE', 'KNSH', 'GATE', 'XBTUSD', 'XAU'],
      tape: ['MTUS500', 'MTUSTEC', 'MTEU350', 'MTJP225', 'MTVOL', 'US10Y', 'DE10Y', 'EURUSD', 'USDJPY', 'GBPUSD', 'CL1', 'XAU', 'HG1', 'XBTUSD', 'XETUSD', 'ARCX', 'SLCN', 'FNDR'],
      corr: ['MTUS500', 'MTEU350', 'MTJP225', 'US10Y', 'EURUSD', 'USDJPY', 'CL1', 'XAU', 'XBTUSD', 'MTVOL'],
      book: { ARCX: 400, FNDR: 1200, PTRA: 800, XAU: 20, VTLS: 600 },
      bench: 'MTUS500',
    };
    const openSec = 9.5 * 3600;
    const realSec = et.secOfDay - openSec;
    // Live mode when the real US session is open; otherwise replay from late morning.
    this.live = !date && realSec > 0 && realSec < SESSION_MIN * 60;
    this.simSec = startSec ?? (this.live ? realSec : 75 * 60);
    const t0 = performance.now();
    this.build();
    this.buildMs = performance.now() - t0;
  }

  // ---------------------------------------------------------------- generation

  build() {
    const r = new Rng(this.seed);
    this.rng = r;
    this.instruments = [];
    this.bySym = new Map();
    const add = (inst) => {
      inst.dp ??= inst.price >= 1000 ? 2 : inst.price >= 10 ? 2 : inst.price >= 1 ? 4 : 4;
      this.instruments.push(inst);
      this.bySym.set(inst.sym, inst);
      return inst;
    };

    for (const [sym, name, sector, region] of RAW.EQUITIES) {
      const ir = new Rng(hashString(sym));
      const vol = SECTOR_VOL[sector] * ir.float(0.8, 1.3);
      const price = Math.round(Math.exp(ir.float(Math.log(18), Math.log(480))) * 100) / 100;
      const mcap = Math.exp(ir.float(Math.log(6e9), Math.log(1.6e12)));
      const pe = SECTOR_PE[sector] * ir.float(0.6, 1.5);
      add({
        sym, name, sector, region, cls: 'EQ', ccy: REGION_CCY[region], price, vol,
        beta: ir.float(0.7, 1.35), sectorLoad: ir.float(0.7, 1.1),
        shares: mcap / price, eps: price / pe, divYield: Math.max(0, SECTOR_YIELD[sector] * ir.float(0.3, 1.6)),
        revenue: mcap * ir.float(0.15, 0.9), margin: ir.float(0.06, 0.38), dp: 2,
        desc: describe(ir, name, sector, region),
      });
    }
    for (const [sym, name, region, level] of RAW.INDICES) {
      add({ sym, name, region, cls: 'IDX', ccy: REGION_CCY[region], price: level, vol: sym === 'MTVOL' ? 0.9 : 0.16, dp: 2 });
    }
    for (const [sym, name, spot, vol, usdSign] of RAW.FX) {
      add({ sym, name, cls: 'FX', ccy: sym.slice(3), price: spot, vol, usdSign, dp: spot > 50 ? 2 : 4 });
    }
    for (const [sym, name, price, vol, group, unit] of RAW.COMMODITIES) {
      add({ sym, name, cls: 'CMDTY', ccy: 'USD', price, vol, group, unit, dp: price > 100 ? 2 : 3 });
    }
    for (const [sym, name, price, vol] of RAW.CRYPTO) {
      add({ sym, name, cls: 'CRYPTO', ccy: 'USD', price, vol, dp: price > 100 ? 2 : 4 });
    }
    for (const [cc, cname, ccy, curve] of CURVES) {
      for (const t of TENORS) {
        add({ sym: `${cc}${t}`, name: `${cname} ${t} Govt`, cls: 'BOND', country: cc, tenor: t, ccy, price: curve[t], dp: 3, additive: true });
      }
    }

    this.equities = this.instruments.filter((i) => i.cls === 'EQ');
    this.dates = prevBusinessDays(this.date, HIST_DAYS);
    this.buildHistory(r);
    this.buildEarnings(r);
    this.buildEco(r);
    this.buildNews(r);
    this.buildSession(r);
    this.computeStats();
    this.resetLive();
  }

  // Draws one period of factor shocks; `scale` turns daily volatility into the period's.
  factors(r, scale) {
    const f = { g: 0.0058 * r.shock() * scale, usd: 0.0026 * r.normal() * scale, energy: 0.012 * r.normal() * scale };
    f.metals = 0.008 * r.normal() * scale;
    f.ags = 0.012 * r.normal() * scale;
    f.crypto = 0.028 * r.shock() * scale;
    f.region = { US: 0.003 * r.normal() * scale, EU: 0.0038 * r.normal() * scale, ASIA: 0.0045 * r.normal() * scale };
    f.sector = {};
    for (const s of SECTORS) f.sector[s] = 0.0065 * r.normal() * scale;
    f.rates = {};
    for (const [cc] of CURVES) {
      // basis points: level and slope
      f.rates[cc] = { L: (cc === 'JP' ? 2 : 4.5) * r.normal() * scale, S: 2 * r.normal() * scale };
    }
    return f;
  }

  // One period return for an instrument given factor shocks (log return, or bp for bonds).
  ret(inst, f, r, scale) {
    const sd = (inst.vol / SQ252) * scale;
    switch (inst.cls) {
      case 'EQ': {
        const sys = inst.beta * (f.g + f.region[inst.region]) + inst.sectorLoad * f.sector[inst.sector];
        const sysSd = Math.sqrt((inst.beta * 0.0066) ** 2 + (inst.sectorLoad * 0.0065) ** 2) * scale;
        const idSd = Math.sqrt(Math.max(sd * sd - sysSd * sysSd, (0.35 * sd) ** 2));
        return sys + idSd * r.normal();
      }
      case 'FX': {
        const risk = ['AUD', 'NZD', 'MXN', 'BRL', 'KRW'].some((c) => inst.sym.includes(c)) ? 0.35 : ['JPY', 'CHF'].some((c) => inst.sym.includes(c)) ? -0.3 : 0;
        const riskSign = inst.usdSign === 1 ? -1 : 1;
        return inst.usdSign * f.usd + riskSign * risk * f.g + 0.5 * sd * r.normal();
      }
      case 'CMDTY': {
        const grp = f[inst.group];
        const extra = inst.group === 'energy' ? 0.35 * f.g : inst.sym === 'XAU' || inst.sym === 'XAG' ? -0.8 * f.usd : 0.25 * f.g;
        return grp * (inst.vol / 0.3) + extra + 0.55 * sd * r.normal();
      }
      case 'CRYPTO':
        return f.crypto * (inst.vol / 0.55) + 1.2 * f.g + 0.5 * sd * r.normal();
      case 'BOND': {
        const k = f.rates[inst.country];
        const y = TENOR_YEARS[inst.tenor];
        const front = Math.exp(-y / 3);
        const riskBp = 150 * f.g * (1 - front * 0.5);
        return k.L * (0.6 + 0.4 * (1 - front)) + k.S * (Math.log1p(y) / 3.4 - 0.5) + riskBp + 0.9 * scale * r.normal();
      }
      default:
        return 0;
    }
  }

  // Indices aggregate their constituents so the heat map and the index always agree.
  indexReturn(inst, rets, f, r, scale) {
    if (inst.sym === 'MTVOL') return null; // handled after the US 500
    const members = this.indexMembers(inst);
    let w = 0;
    let s = 0;
    for (const m of members) {
      const cap = m.shares * m.price;
      w += cap;
      s += cap * rets.get(m.sym);
    }
    const base = s / w;
    const mult = inst.sym === 'MTUSSML' ? 1.2 : 1;
    return base * mult + 0.0012 * scale * r.normal();
  }

  indexMembers(inst) {
    if (inst._members) return inst._members;
    const eq = this.equities;
    const pick = {
      MTUS500: (e) => e.region === 'US',
      MTUSTEC: (e) => e.region === 'US' && ['Technology', 'Semiconductors', 'Communication'].includes(e.sector),
      MTUSSML: (e) => e.region === 'US' && e.shares * e.price < 2e11,
      MTEU350: (e) => e.region === 'EU',
      MTDE40: (e) => e.region === 'EU' && hashString(e.sym) % 3 !== 0,
      MTUK100: (e) => e.region === 'EU' && hashString(e.sym) % 2 === 0,
      MTJP225: (e) => e.region === 'ASIA',
      MTHK50: (e) => e.region === 'ASIA' && hashString(e.sym) % 2 === 1,
      MTKR200: (e) => e.region === 'ASIA' && ['Technology', 'Semiconductors', 'Industrials', 'Consumer Disc.'].includes(e.sector),
    }[inst.sym];
    inst._members = eq.filter(pick);
    if (!inst._members.length) inst._members = eq.filter((e) => e.region === inst.region);
    return inst._members;
  }

  // Applies one period of returns to every instrument, mutating `levels`.
  stepAll(f, r, scale, levels, jumps) {
    const rets = new Map();
    for (const inst of this.instruments) {
      if (inst.cls === 'IDX') continue;
      let x = this.ret(inst, f, r, scale);
      if (jumps && jumps.has(inst.sym)) x += jumps.get(inst.sym);
      rets.set(inst.sym, x);
    }
    for (const inst of this.instruments) {
      if (inst.cls !== 'IDX' || inst.sym === 'MTVOL') continue;
      let x = this.indexReturn(inst, rets, f, r, scale);
      if (jumps && jumps.has(inst.sym)) x += jumps.get(inst.sym);
      rets.set(inst.sym, x);
    }
    const vix = this.bySym.get('MTVOL');
    const lv = Math.log(levels.get('MTVOL'));
    rets.set('MTVOL', -5 * rets.get('MTUS500') + 0.03 * scale * r.normal() + 0.08 * scale * scale * (Math.log(vix.price) - lv) + (lv < Math.log(10) ? 0.05 * scale : 0));
    for (const [sym, x] of rets) {
      const inst = this.bySym.get(sym);
      const p = levels.get(sym);
      levels.set(sym, inst.additive ? Math.max(-0.5, p + x / 100) : p * Math.exp(x));
    }
    return rets;
  }

  buildHistory(r) {
    // Simulate forward from today's anchor levels, then rescale so yesterday's close
    // equals the anchor: the year of history ends exactly where the universe says.
    const levels = new Map(this.instruments.map((i) => [i.sym, i.price]));
    const paths = new Map(this.instruments.map((i) => [i.sym, []]));
    const hl = [];
    for (let d = 0; d < HIST_DAYS; d++) {
      const opens = new Map(levels);
      const f = this.factors(r, 1);
      this.stepAll(f, r, 1, levels);
      for (const inst of this.instruments) {
        const o = opens.get(inst.sym);
        const c = levels.get(inst.sym);
        const range = inst.additive ? Math.abs(c - o) + 0.02 * r.float(0.3, 1.2) : Math.abs(Math.log(c / o)) + (inst.vol / SQ252) * r.float(0.25, 0.9);
        paths.get(inst.sym).push({ o, c, range });
      }
      hl.push(f);
    }
    for (const inst of this.instruments) {
      const p = paths.get(inst.sym);
      const last = p[p.length - 1].c;
      const adj = inst.additive ? (x) => x - last + inst.price : (x) => (x * inst.price) / last;
      const adv = inst.cls === 'EQ' ? (inst.shares * r.float(0.004, 0.012)) : inst.cls === 'IDX' ? 0 : 0;
      inst.adv = adv;
      inst.history = p.map((b, i) => {
        const o = adj(b.o);
        const c = adj(b.c);
        const hi = Math.max(o, c);
        const lo = Math.min(o, c);
        const ext = inst.additive ? b.range * 0.3 : b.range * 0.3;
        const h = inst.additive ? hi + ext * r.float(0.2, 1) : hi * Math.exp(ext * r.float(0.2, 1));
        const l = inst.additive ? lo - ext * r.float(0.2, 1) : lo * Math.exp(-ext * r.float(0.2, 1));
        return { t: this.dates[i], o, h, l, c, v: adv ? Math.round(adv * Math.exp(0.35 * r.normal())) : 0 };
      });
      inst.prevClose = inst.price;
    }
  }

  buildEarnings(r) {
    const next = nextBusinessDays(this.date, 15);
    const past = prevBusinessDays(this.date, 25);
    this.earnings = [];
    for (const e of this.equities) {
      const er = new Rng(hashString(`${e.sym}:${this.date.slice(0, 7)}`));
      const bucket = er.int(0, 2); // 0: reported recently, 1: today, 2: upcoming
      const when = er.chance(0.5) ? 'BMO' : 'AMC';
      const qEst = (e.eps / 4) * er.float(0.95, 1.08);
      let date;
      if (bucket === 1 && er.chance(0.25)) date = this.date;
      else if (bucket === 0) date = er.pick(past);
      else date = er.pick(next);
      const reported = date < this.date || (date === this.date && when === 'BMO');
      const actual = reported ? qEst * (1 + er.normal() * 0.06 + 0.02) : null;
      this.earnings.push({ sym: e.sym, name: e.name, date, when, est: qEst, actual, revEst: e.revenue / 4 });
      e.earnings = this.earnings[this.earnings.length - 1];
    }
    this.earnings.sort((a, b) => a.date.localeCompare(b.date) || a.sym.localeCompare(b.sym));
  }

  buildEco(r) {
    const d = new Date(`${this.date}T12:00:00Z`).getUTCDay();
    // [country, event, minute after 09:30 (negative = before open), unit, prior, sd, importance, shock fn]
    const pool = [
      ['US', 'CPI YoY', -60, '%', 3.4, 0.1, 3, 'inflUS'],
      ['US', 'Core CPI MoM', -60, '%', 0.3, 0.1, 3, 'inflUS'],
      ['US', 'Nonfarm Payrolls', -60, 'K', 175, 45, 3, 'growthUS'],
      ['US', 'Initial Jobless Claims', -60, 'K', 218, 9, 2, 'claimsUS'],
      ['US', 'Retail Sales MoM', -60, '%', 0.4, 0.3, 2, 'growthUS'],
      ['US', 'ISM Services', 30, 'idx', 52.4, 1.2, 2, 'growthUS'],
      ['US', 'Consumer Confidence', 30, 'idx', 101.3, 2.5, 2, 'growthUS'],
      ['US', 'Durable Goods Orders', -60, '%', 0.6, 1.1, 2, 'growthUS'],
      ['US', 'New Home Sales', 30, 'K', 683, 30, 1, 'growthUS'],
      ['US', 'Crude Oil Inventories', 60, 'K', -1200, 2400, 2, 'oil'],
      ['US', '10Y Note Auction', 210, 'y', 4.31, 0.02, 2, 'auction'],
      ['EZ', 'HICP Flash YoY', -270, '%', 2.4, 0.1, 3, 'inflEU'],
      ['DE', 'IFO Business Climate', -330, 'idx', 89.4, 0.8, 2, 'growthEU'],
      ['UK', 'Claimant Count', -390, 'K', 8.9, 9, 1, 'growthUK'],
      ['JP', 'Tankan Large Mfg', -870, 'idx', 13, 2, 2, 'growthJP'],
      ['CN', 'Caixin PMI Mfg', -810, 'idx', 51.1, 0.6, 2, 'growthCN'],
    ];
    const er = new Rng(this.seed ^ 0x5eed);
    const n = 6 + (d % 3);
    const chosen = [];
    const idx = pool.map((_, i) => i).sort(() => er.next() - 0.5).slice(0, n);
    for (const i of idx.sort((a, b) => pool[a][2] - pool[b][2])) {
      const [country, event, minute, unit, prior, sd, imp, shock] = pool[i];
      const survey = prior + er.normal() * sd * 0.4;
      const actual = survey + er.normal() * sd;
      chosen.push({
        country, event, minute: minute + (minute >= 0 ? 0 : 0), unit, prior, survey: round(survey, unit), actual: round(actual, unit), sd, importance: imp, shock,
      });
    }
    this.eco = chosen;
    // the rest of the week, for the calendar view
    this.ecoWeek = nextBusinessDays(this.date, 4).map((day, k) => {
      const wr = new Rng(hashString(`eco:${day}`));
      return {
        date: day,
        items: pool.filter(() => wr.chance(0.35)).slice(0, 5).map(([country, event, minute, unit, prior, sd, imp]) => ({
          country, event, minute, unit, prior, survey: round(prior + wr.normal() * sd * 0.4, unit), actual: null, importance: imp,
        })),
      };
    });
  }

  // Factor shocks (in period units) caused by an economic surprise.
  ecoShock(e, f) {
    const z = Math.max(-2.5, Math.min(2.5, (e.actual - e.survey) / e.sd)) * 0.6;
    const w = e.importance / 3;
    const add = (path, v) => {
      const keys = path.split('.');
      let o = f;
      for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
      o[keys[keys.length - 1]] += v;
    };
    switch (e.shock) {
      case 'inflUS': add('rates.US.L', 6 * z * w); add('g', -0.004 * z * w); add('usd', 0.0025 * z * w); add('metals', -0.003 * z * w); break;
      case 'growthUS': add('rates.US.L', 4 * z * w); add('g', 0.002 * z * w); add('usd', 0.0015 * z * w); break;
      case 'claimsUS': add('rates.US.L', -3 * z * w); add('g', -0.0015 * z * w); break;
      case 'oil': add('energy', -0.006 * Math.sign(z) * Math.min(1.5, Math.abs(z))); break;
      case 'auction': add('rates.US.L', 2.5 * z); break;
      case 'inflEU': add('rates.DE.L', 5 * z * w); add('rates.FR.L', 5 * z * w); add('rates.IT.L', 5 * z * w); add('usd', -0.0015 * z * w); break;
      case 'growthEU': add('region.EU', 0.003 * z * w); add('rates.DE.L', 2 * z * w); break;
      case 'growthUK': add('rates.UK.L', -2 * z * w); break;
      case 'growthJP': add('region.ASIA', 0.003 * z * w); break;
      case 'growthCN': add('region.ASIA', 0.003 * z * w); add('metals', 0.004 * z * w); break;
      default: break;
    }
  }

  buildNews(r) {
    this.stories = [];
    let id = 1;
    const push = (s) => {
      s.id = id++;
      this.stories.push(s);
      return s;
    };
    // Overnight: from 18:00 yesterday (-930 min) to the open.
    this.gapJumps = new Map();
    const usedMacro = new Set();
    const usedCo = new Set();
    for (let k = 0; k < 64; k++) {
      const minute = Math.round(r.float(-930, -2));
      const macro = r.chance(0.2) ? macroStory(r, usedMacro) : null;
      if (!macro) {
        const c = r.pick(this.equities);
        const sentiment = r.chance(0.52) ? 1 : -1;
        const size = sentiment * r.float(0.008, 0.035);
        const st = companyStory(r, c, sentiment, usedCo);
        if (!st) continue;
        push({ ...st, minute, tickers: [c.sym], sentiment, category: 'Company', impact: size });
        this.gapJumps.set(c.sym, (this.gapJumps.get(c.sym) || 0) + size);
      } else {
        push({ ...macro, minute, impact: 0 });
      }
    }
    for (const e of this.earnings) {
      if (e.date === this.date && e.when === 'BMO') {
        const c = this.bySym.get(e.sym);
        const surprise = (e.actual - e.est) / e.est;
        const sentiment = surprise >= 0 ? 1 : -1;
        const st = companyStory(new Rng(hashString(`ern:${e.sym}`)), c, sentiment);
        const size = Math.max(-0.12, Math.min(0.12, surprise * 1.6));
        push({ headline: `${c.name} Q Results: EPS ${e.actual.toFixed(2)} vs ${e.est.toFixed(2)} Est.`, body: st.body, source: 'MTN Wire', minute: -120, tickers: [c.sym], sentiment, category: 'Earnings', impact: size });
        this.gapJumps.set(c.sym, (this.gapJumps.get(c.sym) || 0) + size);
      }
    }
    for (const e of this.eco) {
      if (e.minute < 0) push({ ...ecoStory(e), minute: e.minute, tickers: [], sentiment: 0, impact: 0, eco: e });
    }
    // Intraday: about one company story every six minutes plus macro wires.
    this.intradayJumps = new Map(); // minute -> Map(sym -> jump)
    for (let k = 0; k < 75; k++) {
      const minute = r.int(1, SESSION_MIN - 2);
      const st = r.chance(0.3) ? macroStory(r, usedMacro) : null;
      if (!st) {
        const c = r.pick(this.equities);
        const sentiment = r.chance(0.5) ? 1 : -1;
        const size = sentiment * r.float(0.006, 0.03);
        const co = companyStory(r, c, sentiment, usedCo);
        if (!co) continue;
        push({ ...co, minute, tickers: [c.sym], sentiment, category: 'Company', impact: size });
        if (!this.intradayJumps.has(minute)) this.intradayJumps.set(minute, new Map());
        const m = this.intradayJumps.get(minute);
        m.set(c.sym, (m.get(c.sym) || 0) + size);
      } else {
        push({ ...st, minute, impact: 0 });
        const m = this.intradayJumps.get(minute) || new Map();
        for (const t of st.tickers) {
          const inst = this.bySym.get(t);
          if (!inst || inst.cls === 'IDX') continue; // indices follow their members
          const j = inst.additive ? -st.sentiment * 1.5 : st.sentiment * (inst.vol / SQ252) * 0.25;
          m.set(t, (m.get(t) || 0) + j);
        }
        this.intradayJumps.set(minute, m);
      }
    }
    for (const e of this.eco) {
      if (e.minute >= 0) push({ ...ecoStory(e), minute: e.minute, tickers: [], sentiment: 0, impact: 0, eco: e });
    }
    this.stories.sort((a, b) => a.minute - b.minute || a.id - b.id);
  }

  buildSession(r) {
    // Overnight gap.
    const levels = new Map(this.instruments.map((i) => [i.sym, i.prevClose]));
    const gapF = this.factors(r, 0.38);
    for (const e of this.eco) if (e.minute < 0) this.ecoShock(e, gapF);
    this.stepAll(gapF, r, 0.38, levels, this.gapJumps);
    this.openLevels = new Map(levels);
    for (const inst of this.instruments) inst.bars = [];
    for (let m = 0; m < SESSION_MIN; m++) {
      const scale = VOL_PROFILE[m] * 0.92;
      const before = new Map(levels);
      const f = this.factors(r, scale);
      for (const e of this.eco) if (e.minute === m) this.ecoShock(e, f);
      this.stepAll(f, r, scale, levels, this.intradayJumps.get(m));
      for (const inst of this.instruments) {
        const o = before.get(inst.sym);
        const c = levels.get(inst.sym);
        const wig = inst.additive ? 0.15 * scale * 10 : (inst.vol / SQ252) * scale * 0.4;
        const h = inst.additive ? Math.max(o, c) + wig * r.float(0, 1) : Math.max(o, c) * Math.exp(wig * r.float(0, 1));
        const l = inst.additive ? Math.min(o, c) - wig * r.float(0, 1) : Math.min(o, c) * Math.exp(-wig * r.float(0, 1));
        const v = inst.adv ? Math.round(inst.adv * VOLU_PROFILE[m] * Math.exp(0.3 * r.normal())) : 0;
        inst.bars.push({ m, o, h, l, c, v });
      }
    }
  }

  computeStats() {
    const us = this.bySym.get('MTUS500').history;
    const usR = us.slice(1).map((b, i) => Math.log(b.c / us[i].c));
    for (const inst of this.instruments) {
      const h = inst.history;
      const hi = Math.max(...h.map((b) => b.h));
      const lo = Math.min(...h.map((b) => b.l));
      inst.hi52 = hi;
      inst.lo52 = lo;
      if (inst.additive) continue;
      const rr = h.slice(1).map((b, i) => Math.log(b.c / h[i].c));
      const mean = rr.reduce((a, b) => a + b, 0) / rr.length;
      inst.realVol = Math.sqrt(rr.reduce((a, b) => a + (b - mean) ** 2, 0) / (rr.length - 1)) * SQ252;
      if (inst.cls === 'EQ' || inst.cls === 'IDX') {
        const mu = usR.reduce((a, b) => a + b, 0) / usR.length;
        let cov = 0;
        let vr = 0;
        for (let i = 0; i < rr.length; i++) {
          cov += (rr[i] - mean) * (usR[i] - mu);
          vr += (usR[i] - mu) ** 2;
        }
        inst.histBeta = cov / vr;
      }
    }
  }

  // ---------------------------------------------------------------- live clock

  resetLive() {
    this.lr = new Rng(this.seed ^ 0xabcdef);
    this.tick = 0;
    for (const inst of this.instruments) {
      inst.bridge = 0;
      inst.prints = [];
      inst.curHigh = -Infinity;
      inst.curLow = Infinity;
    }
    // Stories published before the clock starts count as already seen: only news that
    // breaks while the terminal is open raises an alert.
    this.seenStory = this.stories.filter((x) => x.minute <= this.minute).length;
    this.updatePrices(true);
  }

  get minute() {
    return Math.min(SESSION_MIN, Math.floor(this.simSec / 60));
  }
  get closed() {
    return this.simSec >= SESSION_MIN * 60;
  }

  // Advance the clock by `realSec` seconds of wall time.
  advance(realSec) {
    if (this.closed) return;
    const prevMin = this.minute;
    this.simSec = Math.min(SESSION_MIN * 60, this.simSec + realSec * this.speed);
    if (this.minute !== prevMin) {
      for (const inst of this.instruments) {
        inst.bridge = 0;
        inst.curHigh = -Infinity;
        inst.curLow = Infinity;
      }
    }
    this.tick++;
    this.updatePrices(false, realSec * this.speed);
    this.emit('tick', this);
    const fresh = this.newStories();
    if (fresh.length) this.emit('news', fresh);
  }

  updatePrices(initial, dtSec = 1) {
    const m = this.minute;
    const frac = (this.simSec - m * 60) / 60;
    for (const inst of this.instruments) {
      const bars = inst.bars;
      if (m >= SESSION_MIN) {
        inst.last = bars[SESSION_MIN - 1].c;
      } else {
        const b = bars[m];
        const o = b.o;
        const c = b.c;
        // Brownian bridge from the bar's open to its close.
        const df = Math.min(dtSec / 60, 1 - frac + 1e-9);
        const sd = inst.additive ? 0.12 * VOL_PROFILE[m] * 10 : (inst.vol / SQ252) * VOL_PROFILE[m] * 0.6;
        if (!initial && frac < 1) {
          inst.bridge = inst.bridge * (1 - df / Math.max(1 - frac + df, 1e-6)) + sd * Math.sqrt(df) * this.lr.normal();
        }
        const base = inst.additive ? o + (c - o) * frac : o * Math.exp(Math.log(c / o) * frac);
        inst.last = inst.additive ? base + inst.bridge * Math.sqrt(frac * (1 - frac)) : base * Math.exp(inst.bridge * Math.sqrt(frac * (1 - frac)));
        inst.curHigh = Math.max(inst.curHigh, inst.last, o);
        inst.curLow = Math.min(inst.curLow, inst.last, o);
        if (!initial && inst.adv && this.lr.chance(0.6)) {
          const size = Math.max(1, Math.round((inst.adv / SESSION_MIN / 20) * Math.exp(0.9 * this.lr.normal()) / 100) * 100);
          inst.prints.unshift({ s: this.simSec, p: inst.last, q: size, side: inst.last >= (inst.prevTick ?? inst.last) ? 1 : -1 });
          if (inst.prints.length > 120) inst.prints.pop();
        }
      }
      inst.prevTick = inst.last;
      const done = bars.slice(0, Math.min(m, SESSION_MIN));
      const first = bars[0];
      inst.open = first.o;
      inst.high = Math.max(first.o, ...done.map((b) => b.h), m < SESSION_MIN ? inst.curHigh : -Infinity, inst.last);
      inst.low = Math.min(first.o, ...done.map((b) => b.l), m < SESSION_MIN ? inst.curLow : Infinity, inst.last);
      inst.volume = done.reduce((a, b) => a + b.v, 0) + (m < SESSION_MIN ? Math.round(bars[m].v * frac) : 0);
      inst.chg = inst.last - inst.prevClose;
      inst.pct = inst.additive ? null : inst.chg / inst.prevClose;
      inst.chgBp = inst.additive ? inst.chg * 100 : null;
      const spread = this.spread(inst);
      inst.bid = inst.last - spread / 2;
      inst.ask = inst.last + spread / 2;
    }
  }

  spread(inst) {
    const tick = inst.cls === 'BOND' ? 0.001 : inst.cls === 'FX' ? inst.price * 0.00002 : inst.last * 0.0002;
    return inst.cls === 'EQ' ? Math.max(0.01, inst.last * (inst.shares * inst.price > 1e11 ? 0.0001 : 0.0004)) : tick * 2;
  }

  newStories() {
    const m = this.minute;
    const out = [];
    while (this.seenStory < this.stories.length && this.stories[this.seenStory].minute <= m) {
      const s = this.stories[this.seenStory++];
      out.push(s);
    }
    return out;
  }

  // ---------------------------------------------------------------- queries

  get(sym) {
    if (!sym) return null;
    return this.bySym.get(sym.toUpperCase()) || null;
  }

  search(q) {
    q = q.toUpperCase();
    return this.instruments.filter((i) => i.sym.startsWith(q) || i.name.toUpperCase().includes(q)).slice(0, 12);
  }

  news({ sym, category, limit = 200 } = {}) {
    const m = this.minute;
    let s = this.stories.filter((x) => x.minute <= m);
    if (sym) s = s.filter((x) => x.tickers.includes(sym));
    if (category) s = s.filter((x) => x.category === category);
    return s.reverse().slice(0, limit);
  }

  // Daily bars: history plus today's bar so far.
  daily(sym) {
    const inst = this.get(sym);
    if (!inst) return [];
    return [...inst.history, { t: this.date, o: inst.open, h: inst.high, l: inst.low, c: inst.last, v: inst.volume, live: true }];
  }

  // Minute bars revealed so far, including the one forming now.
  intraday(sym) {
    const inst = this.get(sym);
    if (!inst) return [];
    const m = this.minute;
    const out = inst.bars.slice(0, m).map((b) => ({ ...b, t: m }));
    if (m < SESSION_MIN) {
      const b = inst.bars[m];
      const frac = (this.simSec - m * 60) / 60;
      out.push({ m, o: b.o, h: inst.curHigh, l: inst.curLow, c: inst.last, v: Math.round(b.v * frac), live: true });
    }
    return out;
  }

  curve(cc) {
    return TENORS.map((t) => {
      const i = this.get(`${cc}${t}`);
      return { tenor: t, years: TENOR_YEARS[t], y: i.last, prev: i.prevClose, wk: i.history[i.history.length - 5].c, mo: i.history[i.history.length - 21].c };
    });
  }

  ecoToday() {
    return this.eco.map((e) => ({ ...e, released: e.minute <= this.minute }));
  }

  book(sym, depth = 10) {
    const inst = this.get(sym);
    if (!inst) return null;
    const br = new Rng(hashString(sym) ^ this.tick);
    const step = inst.cls === 'EQ' ? Math.max(0.01, +(inst.last * 0.0002).toFixed(2)) : this.spread(inst) / 2;
    const unit = inst.cls === 'EQ' ? 100 : inst.cls === 'FX' ? 1e6 : inst.cls === 'BOND' ? 1e6 : 10;
    const side = (dir) => Array.from({ length: depth }, (_, k) => ({
      p: (dir < 0 ? inst.bid : inst.ask) + dir * k * step,
      q: Math.round(unit * Math.exp(br.float(0, 2.2)) * (1 + k * 0.25)),
      n: br.int(1, 14),
    }));
    return { bids: side(-1), asks: side(1) };
  }

  storyTime(s) {
    return this.minuteLabel(s.minute);
  }

  sourceLabel() {
    return { text: 'SIMULATED', title: 'Simulated market: fictional companies, generated prices and news', cls: 'sim' };
  }

  timeLabel() {
    const s = Math.round(9.5 * 3600 + this.simSec);
    const hh = String(Math.floor(s / 3600)).padStart(2, '0');
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }

  minuteLabel(m) {
    const s = 9.5 * 3600 + m * 60;
    const d = ((s % 86400) + 86400) % 86400;
    return `${String(Math.floor(d / 3600)).padStart(2, '0')}:${String(Math.floor((d % 3600) / 60)).padStart(2, '0')}`;
  }

  on(ev, fn) {
    (this.listeners[ev] ||= []).push(fn);
    return () => (this.listeners[ev] = this.listeners[ev].filter((f) => f !== fn));
  }
  emit(ev, data) {
    for (const fn of this.listeners[ev] || []) fn(data);
  }
}

function round(v, unit) {
  if (unit === 'K') return Math.round(v);
  if (unit === 'idx') return Math.round(v * 10) / 10;
  if (unit === '%') return Math.round(v * 10) / 10;
  if (unit === 'y') return Math.round(v * 1000) / 1000;
  return Math.round(v * 100) / 100;
}

function describe(r, name, sector, region) {
  const where = { US: 'North America', EU: 'Europe', ASIA: 'Asia-Pacific' }[region];
  const what = {
    Technology: 'develops enterprise software and cloud infrastructure services',
    Semiconductors: 'designs and manufactures semiconductors and related equipment',
    Financials: 'provides banking, lending, insurance and asset-management services',
    'Health Care': 'develops and markets pharmaceuticals and medical technologies',
    Energy: 'explores for, produces and transports oil, gas and renewable power',
    Industrials: 'manufactures machinery, aerospace components and logistics solutions',
    'Consumer Disc.': 'designs and sells consumer products and leisure services',
    'Consumer Staples': 'produces and distributes food, beverages and household goods',
    Materials: 'mines and processes metals, chemicals and construction materials',
    Utilities: 'generates, transmits and distributes electricity and water',
    Communication: 'operates telecom networks, media and entertainment platforms',
    'Real Estate': 'owns and operates commercial and logistics real estate',
  }[sector];
  return `${name} ${what}. The company serves customers primarily in ${where} and employs about ${(r.int(2, 180) * 1000).toLocaleString('en-US')} people. (Simulated company.)`;
}
