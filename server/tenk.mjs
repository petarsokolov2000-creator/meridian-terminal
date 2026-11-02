// Reads a company's latest 10-K (inline XBRL HTML from SEC EDGAR) for SEG and RISK:
//   segments(symbol)  revenue by business segment, product/service and geography, as tagged in
//                     the filing (usually three fiscal years), plus customer concentration
//   risks(symbol)     the headings of Item 1A "Risk Factors", linked to the filing
// Plain string parsing (no DOM), so it runs the same in Node and in the phone app.

const REVENUE = ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'RevenuesNetOfInterestExpense', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax'];
const AXES = {
  'us-gaap:StatementBusinessSegmentsAxis': 'segment',
  'srt:ProductOrServiceAxis': 'product',
  'srt:StatementGeographicalAxis': 'geography',
};
// a second dimension that only says "this is the operating-segment figure" is fine
const OK_EXTRA = /^(srt:ConsolidationItemsAxis=us-gaap:OperatingSegmentsMember|srt:ConsolidationItemsAxis=us-gaap:MaterialReconcilingItemsMember)$/;
const DAY = 86400e3;

const decode = (t) => t.replace(/&nbsp;|&#160;|&#xa0;/gi, ' ').replace(/&amp;/g, '&').replace(/&#8217;|&rsquo;|&#x2019;/gi, '’').replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/gi, '"').replace(/&#8212;|&mdash;/gi, '—').replace(/&#8211;|&ndash;/gi, '–').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
const strip = (h) => decode(h.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const attr = (s, name) => (new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(s) || [])[1] ?? null;

// standard taxonomy members whose names don't read well when split
const KNOWN = { IPhoneMember: 'iPhone', IPadMember: 'iPad', MacMember: 'Mac', ServiceMember: 'Services', ProductMember: 'Products', CorporateNonSegmentMember: 'Corporate (not a segment)', AllOtherSegmentsMember: 'All other segments', NonUsMember: 'Outside the US' };
let regionNames = null;
/** "aapl:GreaterChinaSegmentMember" -> "Greater China"; "country:CN" -> "China" */
export function memberLabel(qname) {
  const [prefix, name] = String(qname).includes(':') ? String(qname).split(':') : ['', String(qname)];
  if (prefix === 'country' && /^[A-Z]{2}$/.test(name)) {
    try {
      regionNames ||= new Intl.DisplayNames(['en'], { type: 'region' });
      return name === 'US' ? 'United States' : regionNames.of(name) || name;
    } catch {
      return name;
    }
  }
  if (KNOWN[name]) return KNOWN[name];
  const local = name.replace(/(Segment|Reportable|Operating)*Member$/, '').replace(/Member$/, '').replace(/Homeand/g, 'HomeAnd');
  return local.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/\bAnd\b/g, 'and').replace(/\bOf\b/g, 'of').trim() || qname;
}

export function parseContexts(html) {
  const ctx = new Map();
  const re = /<(?:xbrli:)?context\b([^>]*)>([\s\S]*?)<\/(?:xbrli:)?context>/gi;
  let m;
  while ((m = re.exec(html))) {
    const id = attr(m[1], 'id');
    const body = m[2];
    const dims = [];
    const dre = /<(?:xbrldi:)?explicitMember\b([^>]*)>([^<]+)</gi;
    let d;
    while ((d = dre.exec(body))) dims.push([attr(d[1], 'dimension'), d[2].trim()]);
    const start = (/<(?:xbrli:)?startDate>([^<]+)</i.exec(body) || [])[1] || null;
    const end = (/<(?:xbrli:)?endDate>([^<]+)</i.exec(body) || [])[1] || null;
    const instant = (/<(?:xbrli:)?instant>([^<]+)</i.exec(body) || [])[1] || null;
    ctx.set(id, { dims, start, end, instant });
  }
  return ctx;
}

export function parseFacts(html, wanted) {
  const out = [];
  const re = /<ix:nonFraction\b([^>]*)>([\s\S]*?)<\/ix:nonFraction>/gi;
  let m;
  while ((m = re.exec(html))) {
    const name = attr(m[1], 'name');
    if (!name || !wanted(name)) continue;
    const text = strip(m[2]);
    const format = attr(m[1], 'format') || '';
    let v;
    if (/zerodash|fixed-zero/i.test(format) || /^[—–-]$/.test(text)) v = 0;
    else {
      v = Number(text.replace(/[,\s]/g, '').replace(/^\((.*)\)$/, '$1'));
      if (!Number.isFinite(v)) continue;
    }
    const scale = Number(attr(m[1], 'scale') || 0);
    v *= 10 ** scale;
    if (attr(m[1], 'sign') === '-') v = -v;
    out.push({ name, context: attr(m[1], 'contextRef'), value: v });
  }
  return out;
}

const years = (c) => (c.start && c.end ? (Date.parse(c.end) - Date.parse(c.start)) / DAY : 0);

/** Revenue by segment / product / geography for each fiscal year in the filing. */
export function extractSegments(html) {
  const contexts = parseContexts(html);
  const facts = parseFacts(html, (n) => REVENUE.includes(n.split(':').pop()) || /ConcentrationRiskPercentage/.test(n));
  // the revenue tag the filing uses for its total
  const totals = new Map();
  for (const f of facts) {
    const c = contexts.get(f.context);
    if (!c || c.dims.length || years(c) < 350 || years(c) > 380) continue;
    const tag = f.name.split(':').pop();
    if (!REVENUE.includes(tag)) continue;
    const prev = totals.get(c.end);
    if (!prev || REVENUE.indexOf(tag) < REVENUE.indexOf(prev.tag)) totals.set(c.end, { tag, value: f.value });
  }
  const tagOf = [...totals.values()][0]?.tag || null;
  const groups = { segment: new Map(), product: new Map(), geography: new Map() };
  for (const f of facts) {
    const tag = f.name.split(':').pop();
    if (tag !== tagOf) continue;
    const c = contexts.get(f.context);
    if (!c || !c.dims.length || years(c) < 350 || years(c) > 380) continue;
    const main = c.dims.filter(([axis]) => AXES[axis]);
    const extra = c.dims.filter(([axis]) => !AXES[axis]).map(([a, b]) => `${a}=${b}`);
    if (main.length !== 1 || extra.some((e) => !OK_EXTRA.test(e))) continue;
    const [axis, member] = main[0];
    const g = groups[AXES[axis]];
    const key = member;
    if (!g.has(key)) g.set(key, { member, label: memberLabel(member), values: {} });
    const row = g.get(key);
    // the same figure often appears twice (table and note): keep one
    row.values[c.end] = f.value;
  }
  const ends = [...totals.keys()].sort().slice(-3);
  const shape = (g) => [...g.values()].filter((r) => ends.some((e) => r.values[e] != null)).sort((a, b) => (b.values[ends[ends.length - 1]] ?? 0) - (a.values[ends[ends.length - 1]] ?? 0));
  // customer concentration: % of revenue per (often unnamed) major customer
  const customers = [];
  for (const f of facts) {
    if (!/ConcentrationRiskPercentage/.test(f.name)) continue;
    const c = contexts.get(f.context);
    if (!c) continue;
    const bench = c.dims.find(([a]) => /ConcentrationRiskByBenchmarkAxis/.test(a))?.[1] || '';
    const cust = c.dims.find(([a]) => /MajorCustomersAxis/.test(a))?.[1];
    if (!cust || !/Revenue|Sales/i.test(bench)) continue;
    if (c.end && ends.length && c.end !== ends[ends.length - 1]) continue;
    customers.push({ customer: memberLabel(cust), share: f.value, period: c.end || c.instant });
  }
  const uniq = new Map(customers.map((x) => [x.customer, x]));
  return {
    revenueTag: tagOf, ends, totals: Object.fromEntries(ends.map((e) => [e, totals.get(e)?.value ?? null])),
    segment: shape(groups.segment), product: shape(groups.product), geography: shape(groups.geography),
    customers: [...uniq.values()].sort((a, b) => b.share - a.share),
  };
}

/** Headings of Item 1A: bold or italic stand-alone paragraphs inside the section. */
export function extractRiskHeadings(html) {
  const text = html;
  const start = [];
  const sre = /Item(?:\s|&#160;|&nbsp;|<[^>]+>)*1A\.?(?:\s|&#160;|&nbsp;|<[^>]+>)*(?:—|-|–|:)?(?:\s|&#160;|&nbsp;|<[^>]+>)*Risk(?:\s|&#160;|&nbsp;|<[^>]+>)+Factors/gi;
  let m;
  while ((m = sre.exec(text))) start.push(m.index);
  const ere = /Item(?:\s|&#160;|&nbsp;|<[^>]+>)*(?:1B|1C|2)\.?(?:\s|&#160;|&nbsp;|<[^>]+>)*(?:—|-|–|:)?(?:\s|&#160;|&nbsp;|<[^>]+>)*(?:Unresolved|Cybersecurity|Properties)/gi;
  const ends = [];
  while ((m = ere.exec(text))) ends.push(m.index);
  // the real section is the longest stretch between a start and the next end (the table of contents is short)
  let best = null;
  for (const s of start) {
    const e = ends.find((x) => x > s);
    if (e && (!best || e - s > best[1] - best[0])) best = [s, e];
  }
  if (!best || best[1] - best[0] < 2000) return { headings: [], found: false };
  const section = text.slice(best[0], best[1]);
  const blocks = section.split(/<\/(?:div|p)>/i);
  const headings = [];
  for (const b of blocks.slice(1)) {
    const all = strip(b);
    if (all.length < 12 || all.length > 600) continue;
    // text inside bold/italic runs
    let styled = '';
    const rre = /<(span|b|strong|i|em)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    let r;
    while ((r = rre.exec(b))) {
      const tag = r[1].toLowerCase();
      const style = (attr(r[2], 'style') || '').toLowerCase();
      if (tag !== 'span' || /font-weight:\s*(bold|[6-9]00)|font-style:\s*italic/.test(style)) styled += ` ${strip(r[3])}`;
    }
    if (styled.replace(/\s+/g, '').length < all.replace(/\s+/g, '').length * 0.9) continue;
    if (/^item\s*1a/i.test(all) || /^risk factors$/i.test(all) || /^table of contents$/i.test(all) || /^\d+$/.test(all)) continue;
    const group = all.length < 80 && !/[.!?]$/.test(all);
    headings.push({ text: all.length > 300 ? `${all.slice(0, 297)}…` : all, group });
  }
  return { headings: headings.slice(0, 120), found: true };
}

export function createTenK({ sec }) {
  async function doc(symbol) {
    const hit = await sec.cikOf(symbol);
    if (!hit) throw Object.assign(new Error(`${symbol} isn't in the SEC's list of US filers`), { status: 404 });
    const f = await sec.latest10K(hit.cik);
    return { f, hit };
  }
  async function segments(symbol) {
    const { f } = await doc(symbol);
    if (f.form !== '10-K') return { filing: f, unsupported: `${symbol} files a ${f.form} (foreign annual report), which Meridian doesn't read for segments yet.` };
    const html = await sec.documentText(f.url);
    return { filing: f, ...extractSegments(html), source: 'SEC EDGAR, inline XBRL tags in the latest 10-K' };
  }
  async function risks(symbol) {
    const { f } = await doc(symbol);
    if (f.form !== '10-K') return { filing: f, headings: [], unsupported: `${symbol} files a ${f.form}; its risk factors are in that filing (linked), which Meridian doesn't read yet.` };
    const html = await sec.documentText(f.url);
    return { filing: f, ...extractRiskHeadings(html), source: 'SEC EDGAR, Item 1A of the latest 10-K' };
  }
  return { segments, risks };
}
