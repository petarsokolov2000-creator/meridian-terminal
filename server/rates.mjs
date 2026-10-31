// Official rates that need no API key:
//  - US Treasury daily par yield curve (home.treasury.gov CSV, end of day)
//  - ECB euro-area government yield curves (AAA issuers and all issuers, end of day)
//  - Frankfurter: ECB reference FX rates, used when Yahoo has no FX quote
// Column sets and date formats are read from each file's header, not assumed.

const TREASURY = 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv';
const ECB = 'https://data-api.ecb.europa.eu/service/data/YC';
const FRANKFURTER = 'https://api.frankfurter.dev/v1/latest';
export const TENORS = ['3M', '2Y', '5Y', '10Y', '30Y'];

// Minimal CSV parser: quoted fields, commas inside quotes, CRLF.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}

// "10/30/2026" or "2026-10-30" -> "2026-10-30"
export function isoDate(s) {
  const t = String(s).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return null;
}

// "1 Mo" / "1.5 Month" / "10 Yr" -> years
export function tenorYears(label) {
  const m = /^([\d.]+)\s*(mo|month|yr|year)/i.exec(String(label).trim());
  if (!m) return null;
  const n = Number(m[1]);
  return /^mo/i.test(m[2]) ? n / 12 : n;
}

export function createRates({ fetchImpl = fetch } = {}) {
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
  async function text(url) {
    const res = await fetchImpl(url, { headers: { 'user-agent': 'Meridian-Terminal/1.0', accept: 'text/csv,application/json,*/*' }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}`);
    return res.text();
  }

  // Last ~13 months of the official curve: { tenors: [{label, years}], rows: [{date, y: {label: pct}}] } oldest first.
  async function treasury() {
    return cached('treasury', 60 * 60e3, async () => {
      const year = new Date().getUTCFullYear();
      const byDate = new Map();
      let tenors = [];
      for (const y of [year - 1, year]) {
        let csv;
        try {
          csv = parseCsv(await text(`${TREASURY}/${y}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${y}&page&_format=csv`));
        } catch (err) {
          if (y === year) throw err;
          continue; // last year's file failing still leaves this year
        }
        const [head, ...body] = csv;
        const cols = head.map((h, i) => ({ i, label: h.trim(), years: tenorYears(h) })).filter((c) => c.years != null);
        if (cols.length > tenors.length) tenors = cols.map(({ label, years }) => ({ label, years }));
        for (const r of body) {
          const date = isoDate(r[0]);
          if (!date) continue;
          const y2 = {};
          for (const c of cols) {
            const v = Number(r[c.i]);
            if (r[c.i] !== '' && Number.isFinite(v)) y2[c.label] = v;
          }
          byDate.set(date, { date, y: y2 });
        }
      }
      const rows = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
      if (!rows.length) throw new Error('The Treasury file had no rows');
      return { tenors: tenors.sort((a, b) => a.years - b.years), rows };
    });
  }

  // { EA: {'3M': [{t, v}], ...}, EZ: {...} } oldest first; EA = AAA issuers, EZ = all issuers.
  async function ecb() {
    return cached('ecb', 60 * 60e3, async () => {
      const start = new Date(Date.now() - 400 * 86400e3).toISOString().slice(0, 10);
      const key = `B.U2.EUR.4F.G_N_A+G_N_C.SV_C_YM.${TENORS.map((t) => `SR_${t}`).join('+')}`;
      const [head, ...body] = parseCsv(await text(`${ECB}/${key}?format=csvdata&startPeriod=${start}`));
      const col = (name) => head.findIndex((h) => h.trim().toUpperCase() === name);
      const iKey = col('KEY') >= 0 ? col('KEY') : col('SERIES_KEY');
      const iT = col('TIME_PERIOD');
      const iV = col('OBS_VALUE');
      if (iT < 0 || iV < 0) throw new Error('Unexpected ECB file layout');
      const out = { EA: {}, EZ: {} };
      for (const r of body) {
        const k = iKey >= 0 ? r[iKey] : r.join('.');
        const cc = k.includes('G_N_A') ? 'EA' : k.includes('G_N_C') ? 'EZ' : null;
        const tenor = /SR_(\d+[MY])/.exec(k)?.[1];
        const v = Number(r[iV]);
        if (!cc || !TENORS.includes(tenor) || r[iV] === '' || !Number.isFinite(v)) continue;
        (out[cc][tenor] ||= []).push({ t: isoDate(r[iT]), v });
      }
      for (const cc of Object.keys(out)) for (const t of Object.keys(out[cc])) out[cc][t].sort((a, b) => a.t.localeCompare(b.t));
      if (!Object.keys(out.EA).length) throw new Error('The ECB returned no yield-curve data');
      return out;
    });
  }

  // USD-based ECB reference rates: { date, rates: { EUR: 0.92, JPY: 151.2, ... } }
  async function fx() {
    return cached('fx', 30 * 60e3, async () => {
      const j = JSON.parse(await text(`${FRANKFURTER}?base=USD`));
      if (!j.rates) throw new Error('Frankfurter returned no rates');
      return { date: j.date, rates: j.rates };
    });
  }

  return { treasury, ecb, fx };
}
