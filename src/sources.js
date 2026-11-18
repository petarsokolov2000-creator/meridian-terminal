// Where each number came from, on screen. Every company figure comes from Yahoo Finance
// (server/fundamentals.mjs), so there is nothing to mix and cells carry no source marker; a
// missing number shows "n/a" that can be tapped for the reason. (The marker code stays for
// figures that carry another source, such as ones computed from price history.)

import { esc, big, num } from './fmt.js';
import { help } from './glossary.js';

const LETTER = { SEC: 'S', Yahoo: 'Y', Finnhub: 'F' };
const NAME = { SEC: 'SEC EDGAR', Yahoo: 'Yahoo Finance', Finnhub: 'Finnhub' };
export const LABEL = {
  revenue: 'Revenue', opIncome: 'Operating income', grossProfit: 'Gross profit', cogs: 'Cost of revenue', nonInterestExpense: 'Non-interest expense', prefDividends: 'Preferred dividends',
  pretax: 'Pre-tax income', interest: 'Interest expense', tax: 'Income tax', netIncome: 'Net income', da: 'Depreciation & amortization', ocf: 'Operating cash flow', capex: 'Capital expenditure',
  sbc: 'Stock-based pay', buybacks: 'Buybacks', dividendsPaid: 'Dividends paid', rnd: 'Research & development', acquisitions: 'Acquisitions', debtRepaid: 'Debt repaid', epsDil: 'Diluted EPS', dps: 'Dividends per share', sharesDil: 'Diluted shares', sharesOut: 'Shares outstanding',
  cash: 'Cash', stInvest: 'Short-term investments', assets: 'Total assets', equity: "Shareholders' equity", preferred: 'Preferred stock', goodwill: 'Goodwill', intangibles: 'Intangible assets',
  debt: 'Debt', ebit: 'EBIT', ebitda: 'EBITDA', fcf: 'Free cash flow', cashAll: 'Cash & short-term investments', netDebt: 'Net debt', commonEquity: 'Common equity', tangibleEquity: 'Tangible common equity', shares: 'Share count',
};
// derived figure -> the figures it's computed from
const DEPS = {
  fcf: ['ocf', 'capex'], ebitda: ['ebit', 'da'], ebit: ['opIncome', 'pretax', 'interest'], netDebt: ['debt', 'cashAll'], cashAll: ['cash', 'stInvest'],
  commonEquity: ['equity', 'preferred'], tangibleEquity: ['commonEquity', 'goodwill', 'intangibles'], shares: ['sharesOut', 'sharesDil'],
};
const fin = (v) => v != null && Number.isFinite(v);
const amount = (f, v) => (!fin(v) ? 'n/a' : /^eps|^dps/.test(f) ? num(v, 2) : big(v));

/** The reported figures behind `fields` in one year (derived ones expanded; only those present). */
export function baseFields(y, fields) {
  const out = [];
  const walk = (f) => {
    if (!y || out.includes(f)) return;
    if (DEPS[f]) {
      if (f === 'ebit' && fin(y.opIncome)) return walk('opIncome');
      if (f === 'shares') return walk(fin(y.sharesOut) ? 'sharesOut' : 'sharesDil');
      DEPS[f].forEach(walk);
      return;
    }
    if (fin(y[f])) out.push(f);
  };
  fields.forEach(walk);
  return out;
}

/** One line per reported figure: its source, date, and the cross-check. */
function describe(y, f) {
  const s = y.src?.[f] || {};
  let t = `${LABEL[f] || f}: ${amount(f, y[f])} · ${NAME[s.s] || s.s || 'Yahoo Finance'}`;
  if (s.s === 'SEC') t += `${s.form ? ` ${s.form}` : ''}${s.filed ? ` filed ${s.filed}` : ''}${s.tag ? ` (${s.tag})` : ''}`;
  else if (s.s === 'Yahoo') t += ` annual statements, period ending ${s.period}${s.item ? ` (${s.item})` : ''}`;
  else if (s.s === 'Finnhub') t += ` as-reported ${s.form || '10-K'}${s.filed ? ` filed ${s.filed}` : ''}${s.tag ? ` (${s.tag})` : ''}`;
  if (s.s && s.s !== 'SEC' && (s.check || s.s !== 'Yahoo')) {
    const c = s.check;
    t += c ? ` · cross-checked: FY${c.fy} ${c.primary} ${amount(f, c.primaryVal)} vs ${s.s} ${amount(f, c.fallbackVal)}, ${num(c.diff * 100, 1)}% apart` : ' · unchecked: no year where the primary source and this one both have it';
  }
  return t;
}

const button = (cls, label, text) => `<button type="button" class="srcm ${cls}" data-srcinfo="${esc(text)}" title="${esc(text)}">${esc(label)}</button>`;

/** "Y", "F" or "S+Y" for a combined source string; '' when it's all SEC. */
export function letters(src) {
  const parts = String(src || '').split('+').filter(Boolean);
  if (!parts.length || (parts.length === 1 && (parts[0] === 'SEC' || parts[0] === 'Yahoo'))) return '';
  return parts.map((p) => LETTER[p] || p[0]).join('+');
}

/** Marker for a value computed from `fields` of year `y` (and `prevFields` of the year before). */
export function mark(y, fields, prev = null, prevFields = [], prevLabel = 'for the average') {
  const cur = baseFields(y, fields);
  const pre = prev ? baseFields(prev, prevFields) : [];
  const srcs = [...cur.map((f) => y.src?.[f]?.s), ...pre.map((f) => prev.src?.[f]?.s)];
  const lab = letters([...new Set(srcs)].filter(Boolean).sort((a, b) => 'SEC Yahoo Finnhub'.indexOf(a) - 'SEC Yahoo Finnhub'.indexOf(b)).join('+'));
  if (!lab) return '';
  const lines = [`${/^\d/.test(String(y.fy)) ? 'FY' : ''}${y.fy}:`, ...cur.map((f) => describe(y, f)), ...(pre.length ? [`FY${prev.fy} (${prevLabel}):`, ...pre.map((f) => describe(prev, f))] : [])];
  if (lab.includes('+')) lines.unshift('This figure combines numbers from more than one source.');
  return button(lab.includes('+') ? 'mix' : '', lab, lines.join('\n'));
}

/** Why a value computed from `fields` is missing (the first input that is). */
export function why(y, fields, prev = null, prevFields = []) {
  const walk = (z, f) => {
    if (!z) return null;
    if (DEPS[f] && !fin(z[f])) {
      if (z.na?.[f]) return z.na[f];
      for (const d of DEPS[f]) {
        const r = walk(z, d);
        if (r) return r;
      }
    }
    if (fin(z[f])) return null;
    if (z.conflict?.[f]) return `${LABEL[f] || f}: ${z.na?.[f] || 'sources disagree'}`;
    return `${LABEL[f] || f}: ${z.na?.[f] || 'not reported'}`;
  };
  for (const f of fields) {
    const r = walk(y, f);
    if (r) return `FY${y.fy} ${r.charAt(0).toLowerCase()}${r.slice(1)}`;
  }
  for (const f of prevFields) {
    const r = walk(prev, f);
    if (r) return `FY${prev.fy} ${r.charAt(0).toLowerCase()}${r.slice(1)}`;
  }
  return null;
}

/** "n/a" that explains itself, or "sources disagree" when that's the reason. */
export function na(reason, fallback = 'not meaningful (negative or zero where a positive number is needed)') {
  const r = reason || fallback;
  return /sources disagree/.test(r) ? button('warn', 'sources disagree', r) : button('na', 'n/a', `n/a: ${r}`);
}

/** Small marker for a figure Yahoo didn't have, filled from another source (tap for where from). */
export function filled(src) {
  return button('mix', 'alt', `Yahoo had no figure here. Filled from another source: ${src}`);
}

/** A table cell's content: the formatted value plus its marker, or an explained n/a. */
export function cell(text, value, y, fields, prev = null, prevFields = []) {
  if (!fin(value)) return na(why(y, fields, prev, prevFields));
  return `${text}${mark(y, fields, prev, prevFields)}`;
}

// ---- "now" figures (trailing 12 months) -----------------------------------------------------

const NOW_DEPS = { fcf: ['ocf', 'capex'], ebitda: ['ebit', 'da'], ebit: ['opIncome', 'pretax', 'interest'], netDebt: ['debt', 'cashAll'], cashAll: ['cash', 'stInvest'], commonEquity: ['equity', 'preferred'], tangibleEquity: ['commonEquity', 'goodwill', 'intangibles'] };
function nowBase(N, fields) {
  const out = [];
  const walk = (f) => {
    if (out.includes(f)) return;
    if (NOW_DEPS[f] && N[f]?.derived) {
      if (f === 'ebit' && fin(N.opIncome?.val)) return walk('opIncome');
      NOW_DEPS[f].forEach(walk);
      return;
    }
    if (fin(N[f]?.val)) out.push(f);
  };
  fields.forEach(walk);
  return out;
}
const nowLine = (N, f) => {
  const x = N[f];
  let t = `${LABEL[f] || f}: ${amount(f, x.val)} · ${NAME[x.src] || x.src}${x.basis === 'FY' ? ' · latest fiscal year, not trailing 12 months' : ''} — ${x.formula || ''}`;
  if (x.src === 'Yahoo' && x.check) t += ` · cross-checked: FY${x.check.fy} SEC ${amount(f, x.check.primaryVal)} vs Yahoo ${amount(f, x.check.fallbackVal)}, ${num(x.check.diff * 100, 1)}% apart`;
  return t;
};
/** Lines describing the inputs of a "now" figure. */
export function nowLines(N, fields) {
  return nowBase(N, fields).map((f) => nowLine(N, f));
}
/** Marker for a "now" multiple: source letters and an "FY" tag when it isn't trailing 12 months. */
export function nowMark(N, fields, meta) {
  const lines = nowLines(N, fields);
  const lab = letters(meta?.src);
  let out = lab ? button(lab.includes('+') ? 'mix' : '', lab, [lab.includes('+') ? 'This figure combines numbers from more than one source.' : '', ...lines].filter(Boolean).join('\n')) : '';
  if (meta?.basis === 'FY') out += button('fy', 'FY', ['Uses the latest fiscal year for at least one input: no trailing-12-month figure was available.', ...lines].join('\n'));
  return out;
}

// ---- the sources line under each panel ------------------------------------------------------

/** "SEC EDGAR ✓ · Yahoo: filled 12 figures · Finnhub: no API key", with real HTTP statuses. */
export function statusLine(st) {
  if (!st) return '';
  const one = (name, s) => {
    if (!s) return null;
    if (s.state === 'off') return null;
    if (s.state === 'ok') return `${name} ✓${s.filled ? ` (filled ${s.filled} figure${s.filled === 1 ? '' : 's'})` : ''}`;
    if (s.state === 'failed') return `<span class="down">${name} failed: ${esc(s.message)}</span>`;
    if (s.state === 'partial') return `<span class="down">${name} partly failed: ${esc(s.message)}</span>`;
    if (s.state === 'no key') return `${name}: no API key (optional; <kbd>FINNHUB &lt;key&gt;</kbd> adds it as a third source)`;
    if (s.state === 'not needed') return `${name}: not needed`;
    return `${name}: ${esc(s.message || s.state)}`;
  };
  const extra = [
    st.profile ? `<span class="down">SEC industry code failed: ${esc(st.profile.message)}</span>` : null,
    st.yahooProfile ? `<span class="down">Yahoo industry lookup failed: ${esc(st.yahooProfile.message)}</span>` : null,
    st.splits ? `<span class="down">Split history failed (${esc(st.splits.message)}): per-share figures may not be split-adjusted</span>` : null,
    st.yahootrailing ? `<span class="down">Yahoo trailing figures failed: ${esc(st.yahootrailing.message)}</span>` : null,
    st.yahooquarterly ? `<span class="down">Yahoo quarterly balance sheet failed: ${esc(st.yahooquarterly.message)}</span>` : null,
  ];
  return `Data${help('dataSources')}: ${[one('SEC EDGAR', st.sec), one('Yahoo Finance', st.yahoo), one('Finnhub', st.finnhub), ...extra].filter(Boolean).join(' · ')}. Every figure comes from Yahoo Finance; tap an n/a for the reason.`;
}

/** Marker for a 5y/10y median that used fallback figures in some years: list = ['FY2016: Finnhub', ...]. */
export function windowMark(list) {
  if (!list?.length) return '';
  const srcs = [...new Set(list.flatMap((l) => l.split(': ')[1].split('+')))];
  const lab = letters(['SEC', 'Yahoo', 'Finnhub'].filter((s) => srcs.includes(s)).join('+')) || letters(srcs.join('+'));
  return lab ? button(lab.includes('+') ? 'mix' : '', lab, ['Years in this window that used fallback figures (the others come from the main source):', ...list].join('\n')) : '';
}

/** Marker from a combined source string alone (peer rows), with a short explanation. */
export function srcOnly(src, what, basis) {
  const lab = letters(src);
  let out = lab ? button(lab.includes('+') ? 'mix' : '', lab, `${what}: inputs from ${String(src).split('+').map((s) => NAME[s] || s).join(' + ')}. Open that company's VAL for each input's source.`) : '';
  if (basis === 'FY') out += button('fy', 'FY', `${what}: uses the latest fiscal year for at least one input (no trailing-12-month figure).`);
  return out;
}

/** Source lines for a formula box, only when a fallback source is involved ('' otherwise). */
export function srcNote(y, fields, prev = null, prevFields = []) {
  const cur = baseFields(y, fields);
  const pre = prev ? baseFields(prev, prevFields) : [];
  const all = [...cur.map((f) => y.src?.[f]?.s), ...pre.map((f) => prev.src?.[f]?.s)].filter(Boolean);
  if (new Set(all).size <= 1 && all.every((x) => x === 'SEC' || x === 'Yahoo')) return '';
  const mixed = new Set(all).size > 1;
  return `<br><span class="dim small">${mixed ? '<b>Mixes sources.</b> ' : ''}${[...cur.map((f) => describe(y, f)), ...pre.map((f) => `FY${prev.fy} ${describe(prev, f)}`)].map(esc).join('<br>')}</span>`;
}

/** Kept for the screens that call it: lists are no longer filled from a second source, so there is nothing to say. */
export function altNote() {
  return '';
}
