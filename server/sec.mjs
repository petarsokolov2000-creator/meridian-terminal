// SEC EDGAR: official filings for US-listed companies (annual and quarterly reports, current
// reports, insider forms, proxies). Free, no key; the SEC asks every client to identify itself
// in the User-Agent as "name email" (requests without a contact email are refused with 403)
// and to stay under 10 requests a second, which this easily does. The contact is the
// project's public GitHub no-reply address, not anyone's personal email.

const UA = 'Meridian Terminal 322796608+petarsokolov2000-creator@users.noreply.github.com';

export function createSec({ fetchImpl = fetch } = {}) {
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
  async function json(url) {
    const res = await fetchImpl(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    if (res.status === 403 || res.status === 429) {
      throw Object.assign(new Error(`the SEC refused the request (${res.status}); it limits automated access, so try again in a few minutes`), { status: 503 });
    }
    if (!res.ok) throw Object.assign(new Error(`SEC answered ${res.status}`), { status: res.status });
    return res.json();
  }

  // ticker -> { cik, title }, from the SEC's own list (refreshed daily)
  const tickers = () => cached('tickers', 24 * 60 * 60e3, async () => {
    const data = await json('https://www.sec.gov/files/company_tickers.json');
    const map = new Map();
    for (const row of Object.values(data || {})) {
      if (row?.ticker && row.cik_str != null) map.set(String(row.ticker).toUpperCase(), { cik: Number(row.cik_str), title: row.title });
    }
    return map;
  });

  async function filings(symbol) {
    // EDGAR writes share classes with a dash (BRK-B); Yahoo uses the same form.
    const t = String(symbol).toUpperCase();
    const hit = (await tickers()).get(t) || (await tickers()).get(t.replace('.', '-'));
    if (!hit) throw Object.assign(new Error(`${t} isn't in the SEC's list of US filers (non-US companies usually file elsewhere)`), { status: 404 });
    return cached(`filings:${hit.cik}`, 30 * 60e3, async () => {
      const cik10 = String(hit.cik).padStart(10, '0');
      const data = await json(`https://data.sec.gov/submissions/CIK${cik10}.json`);
      const r = data?.filings?.recent || {};
      const out = [];
      const count = Math.min(200, (r.accessionNumber || []).length);
      for (let i = 0; i < count; i++) {
        const acc = r.accessionNumber[i];
        const doc = r.primaryDocument?.[i];
        out.push({
          form: r.form?.[i], date: r.filingDate?.[i], reportDate: r.reportDate?.[i] || null,
          description: r.primaryDocDescription?.[i] || '',
          url: doc ? `https://www.sec.gov/Archives/edgar/data/${hit.cik}/${String(acc).replace(/-/g, '')}/${doc}` : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik10}`,
        });
      }
      return { company: data?.name || hit.title, cik: hit.cik, source: 'SEC EDGAR', filings: out, edgar: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik10}&type=&dateb=&owner=include&count=40` };
    });
  }

  return { filings };
}
