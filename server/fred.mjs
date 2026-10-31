// FRED (St. Louis Fed): the latest official US economic releases and their next release
// dates, for the ECO screen. Needs a free key (fredaccount.stlouisfed.org/apikeys), kept on
// this PC like the Finnhub key. FRED has actuals and dates but no economists' forecasts.

const BASE = 'https://api.stlouisfed.org/fred';

// [series id, label, how to show it, unit, group]
//   level: the value as published; yoy: % change vs 12 obs earlier; mom: % change vs previous;
//   diff: change vs previous (in the series' units). ISM data is not on FRED (removed in 2016
//   at ISM's request), so the Philadelphia Fed survey stands in for manufacturing sentiment.
export const INDICATORS = [
  ['CPIAUCSL', 'CPI inflation (YoY)', 'yoy', '%', 'Inflation'],
  ['CPILFESL', 'Core CPI (YoY)', 'yoy', '%', 'Inflation'],
  ['PCEPILFE', 'Core PCE prices (YoY)', 'yoy', '%', 'Inflation'],
  ['CP0000EZ19M086NEST', 'Euro area HICP inflation (YoY)', 'yoy', '%', 'Inflation'],
  ['PAYEMS', 'Nonfarm payrolls (change)', 'diff', 'K', 'Labor'],
  ['UNRATE', 'Unemployment rate', 'level', '%', 'Labor'],
  ['ICSA', 'Initial jobless claims', 'level', 'K', 'Labor'],
  ['JTSJOL', 'JOLTS job openings', 'level', 'K', 'Labor'],
  ['A191RL1Q225SBEA', 'Real GDP growth (QoQ ann.)', 'level', '%', 'Growth'],
  ['RSAFS', 'Retail sales (MoM)', 'mom', '%', 'Growth'],
  ['INDPRO', 'Industrial production (MoM)', 'mom', '%', 'Growth'],
  ['GACDFSA066MSFRBPHI', 'Philly Fed manufacturing index', 'level', '', 'Growth'],
  ['UMCSENT', 'UMich consumer sentiment', 'level', '', 'Growth'],
  ['HOUST', 'Housing starts', 'level', 'K', 'Housing'],
  ['MORTGAGE30US', '30-year mortgage rate', 'level', '%', 'Housing'],
  ['FEDFUNDS', 'Fed funds effective rate', 'level', '%', 'Rates'],
  ['WCESTUS1', 'Crude oil stocks ex-SPR (weekly change, bbl)', 'diff', 'K', 'Energy'],
];

export class FredError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function createFred({ getKey, fetchImpl = fetch } = {}) {
  const cache = new Map();
  const cached = (key, ttl, fn) => {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.p;
    const p = fn().catch((err) => {
      cache.delete(key);
      throw err;
    });
    cache.set(key, { at: Date.now(), p });
    return p;
  };

  async function get(path, params) {
    const key = getKey();
    if (!key) throw new FredError('No FRED API key set', 401);
    const qs = new URLSearchParams({ ...params, api_key: key, file_type: 'json' });
    const res = await fetchImpl(`${BASE}${path}?${qs}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    const body = await res.json().catch(() => ({}));
    // FRED answers 400 for an unknown or unregistered key
    if (res.status === 400 && /api_key/i.test(body.error_message || '')) throw new FredError('FRED rejected the API key', 401);
    if (res.status === 429) throw new FredError('FRED rate limit reached (120 requests/min)', 429);
    if (!res.ok) throw new FredError(body.error_message || `FRED answered ${res.status}`, res.status);
    return body;
  }

  const today = () => new Date().toISOString().slice(0, 10);

  async function indicator([id, label, how, unit, group]) {
    const obs = (await get('/series/observations', { series_id: id, sort_order: 'desc', limit: '14' })).observations || [];
    const vals = obs.filter((o) => o.value !== '.').map((o) => ({ date: o.date, v: Number(o.value) }));
    if (vals.length < 2) return { id, label, unit, group, error: 'No data' };
    const at = (i) => {
      const x = vals[i];
      if (!x) return null;
      if (how === 'yoy') return vals[i + 12] ? (x.v / vals[i + 12].v - 1) * 100 : null;
      if (how === 'mom') return vals[i + 1] ? (x.v / vals[i + 1].v - 1) * 100 : null;
      if (how === 'diff') return vals[i + 1] ? x.v - vals[i + 1].v : null;
      return id === 'ICSA' ? x.v / 1000 : x.v;
    };
    // the release this series belongs to, and its next scheduled dates
    let release = null;
    let next = null;
    let last = null;
    try {
      const rel = (await get('/series/release', { series_id: id })).releases?.[0];
      if (rel) {
        release = rel.name;
        const dates = (await get('/release/dates', { release_id: String(rel.id), realtime_start: '2000-01-01', include_release_dates_with_no_data: 'true', sort_order: 'desc', limit: '40' })).release_dates || [];
        const ds = dates.map((d) => d.date).sort();
        next = ds.find((d) => d > today()) || null;
        last = [...ds].reverse().find((d) => d <= today()) || null;
      }
    } catch {
      // the numbers still show without release dates
    }
    return { id, label, unit, group, period: vals[0].date, actual: at(0), prior: at(1), release, lastRelease: last, nextRelease: next };
  }

  return {
    check: async () => {
      await get('/series', { series_id: 'UNRATE' });
      return true;
    },
    // One batch per hour at most: 17 series x 3 calls, inside FRED's 120 requests/min.
    economy: () => cached('economy', 60 * 60e3, async () => {
      const out = [];
      for (const ind of INDICATORS) {
        try {
          out.push(await indicator(ind));
        } catch (err) {
          if (err.status === 401) throw err;
          out.push({ id: ind[0], label: ind[1], unit: ind[3], group: ind[4], error: err.message });
        }
      }
      return out;
    }),
    reset: () => cache.clear(),
  };
}
