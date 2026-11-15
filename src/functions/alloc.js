// ALLOC: where does the company put its money? A donut chart of how one year's cash (or the last
// five years together) was used: research, capital spending, acquisitions, buybacks, dividends,
// debt repaid, and what was left over.
//
// Data: the annual figures from /api/annual (SEC EDGAR 10-K first, Yahoo and Finnhub only for
// gaps, each fallback marked). A use no source reported is counted as 0 and listed under the chart:
// nothing is estimated. Banks and insurers don't have meaningful cash-flow figures, so for them
// the base is net income and only dividends, buybacks and acquisitions are shown.

import { register } from '../registry.js';
import { num, big, esc, el } from '../fmt.js';
import { mark, statusLine } from '../sources.js';

const fin = (v) => v != null && Number.isFinite(v);
const needsReal = (what) => (ctx) => {
  ctx.el.innerHTML = `<div class="empty">${esc(what)} needs real company data. Switch with <kbd>MODE LIVE</kbd> (Meridian has to be running from its icon).</div>`;
};

// [field, label, colour variable, what it is]
export const USES = [
  ['rnd', 'Research & development', '--s1', 'Spent on developing new products (an expense: it is already deducted in operating cash flow)'],
  ['capex', 'Capital spending', '--s2', 'Plants, machines, data centres, buildings (capital expenditure)'],
  ['acquisitions', 'Acquisitions', '--s3', 'Cash paid to buy other businesses, net of the cash they had'],
  ['buybacks', 'Share buybacks', '--s4', 'Cash paid to buy back the company’s own shares'],
  ['dividendsPaid', 'Dividends', '--s5', 'Cash paid out to shareholders'],
  ['debtRepaid', 'Debt repaid', '--s6', 'Gross repayments of borrowings (companies often refinance, so this does not mean debt shrank)'],
];
const KEPT = ['kept', 'Kept / other', '--dim', 'What was left of the cash after all of the above: cash build-up, investments, other items'];
const BANK_USES = ['dividendsPaid', 'buybacks', 'acquisitions'];

/**
 * How one fiscal year's money was used.
 * base: the cash the company had to use (operating cash flow + R&D; net income for banks).
 * slices: every use above zero, plus "kept" when the base was larger than all uses.
 * gap: how much the uses exceeded the base (paid from cash on hand or new borrowing).
 */
export function allocOf(y, financial) {
  const keys = financial ? BANK_USES : USES.map((u) => u[0]);
  const items = keys.map((k) => ({ key: k, val: fin(y[k]) ? Math.max(0, y[k]) : 0, reported: fin(y[k]) }));
  const baseCore = financial ? y.netIncome : y.ocf;
  const base = fin(baseCore) ? baseCore + (!financial && fin(y.rnd) ? y.rnd : 0) : null;
  const uses = items.reduce((a, i) => a + i.val, 0);
  const keptVal = base != null && base > uses ? base - uses : 0;
  const gap = base != null && base < uses ? uses - base : 0;
  return {
    fy: y.fy, base, uses, gap, items, kept: keptVal,
    total: uses + keptVal,
    missing: items.filter((i) => !i.reported).map((i) => ({ key: i.key, why: y.na?.[i.key] || 'not reported' })),
    baseMissing: base == null ? (y.na?.[financial ? 'netIncome' : 'ocf'] || 'not reported') : null,
  };
}

/** Several years added together. */
export function allocSum(list) {
  const first = list[0];
  const items = first.items.map((it, k) => ({ key: it.key, val: list.reduce((a, r) => a + r.items[k].val, 0), reported: list.some((r) => r.items[k].reported) }));
  const known = list.filter((r) => r.base != null);
  const base = known.length ? known.reduce((a, r) => a + r.base, 0) : null;
  const uses = items.reduce((a, i) => a + i.val, 0);
  const usesKnown = known.reduce((a, r) => a + r.uses, 0);
  // years without a base don't enter the "kept" figure: it only compares like with like
  const keptVal = base != null && base > usesKnown ? base - usesKnown : 0;
  const gap = base != null && base < usesKnown ? usesKnown - base : 0;
  return {
    fy: `${list[0].fy}–${list[list.length - 1].fy}`, base, uses, gap, items, kept: keptVal, total: uses + keptVal, years: list.length, baseYears: known.length,
    missing: items.filter((i) => !i.reported).map((i) => ({ key: i.key, why: 'not reported in any of these years' })),
    baseMissing: base == null ? 'no year has operating cash flow' : null,
  };
}

// ---- SVG ------------------------------------------------------------------------------------

function arc(cx, cy, r, a0, a1) {
  const p = (a) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

function donut(slices, total, centre) {
  const R = 74;
  const W = 34;
  let a = 0;
  const paths = slices.map((s, i) => {
    const f = s.val / total;
    const a0 = a;
    a += f * 2 * Math.PI;
    const style = `fill:none;stroke:var(${s.color});stroke-width:${W}`;
    const tip = `<title>${esc(s.label)}: ${big(s.val)} (${num(f * 100, 1)}%)</title>`;
    if (f >= 0.9999) return `<circle data-i="${i}" class="pie-s" cx="100" cy="100" r="${R}" style="${style}">${tip}</circle>`;
    // a hair of gap between slices so neighbours stay distinguishable
    return `<path data-i="${i}" class="pie-s" d="${arc(100, 100, R, a0 + 0.006, a - 0.006)}" style="${style}">${tip}</path>`;
  });
  return `<svg class="pie" viewBox="0 0 200 200" role="img" aria-label="Where the money goes">${paths.join('')}
    <text x="100" y="94" text-anchor="middle" class="pie-big">${esc(centre[0])}</text><text x="100" y="112" text-anchor="middle" class="pie-sub">${esc(centre[1])}</text></svg>`;
}

function stacked(rows) {
  const n = rows.length;
  const W = 520;
  const H = 150;
  const bw = Math.min(40, (W - 20) / n - 6);
  const bars = rows.map((r, k) => {
    const x = 10 + (k + 0.5) * ((W - 20) / n) - bw / 2;
    let y = 0;
    const segs = r.slices.map((s) => {
      const h = (s.val / r.total) * H;
      const seg = `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, h - 0.6).toFixed(1)}" style="fill:var(${s.color})"><title>FY${r.fy} ${esc(s.label)}: ${big(s.val)} (${num((s.val / r.total) * 100, 1)}%)</title></rect>`;
      y += h;
      return seg;
    });
    return `${segs.join('')}<text x="${(x + bw / 2).toFixed(1)}" y="${H + 14}" text-anchor="middle" class="pie-axis">${String(r.fy).slice(2)}</text>`;
  });
  return `<svg class="pie-hist" viewBox="0 0 ${W} ${H + 20}" role="img" aria-label="How the mix changed over the years">${bars.join('')}</svg>`;
}

/**
 * The last 12 months as a pseudo fiscal year: operating cash flow and net income from the trailing figures,
 * the uses the same way (SEC: 10-K + year-to-date 10-Q − the same period a year earlier; else Yahoo's trailing 12 months). A figure with no
 * 12-month source stays missing with its reason; a fiscal-year fallback is never passed off as 12 months.
 */
export function ttmYear(a) {
  const N = a?.now?.fields;
  if (!N) return null;
  const y = { fy: 'TTM', end: a.now.ttmEnd || null, src: {}, na: {} };
  const take = (k, x) => {
    if (x && fin(x.val) && x.basis !== 'FY') {
      y[k] = x.val;
      y.src[k] = { s: x.src || 'SEC', tag: x.tag, filed: x.filed, period: x.end, item: x.formula };
    } else y.na[k] = x && fin(x.val) ? 'only a fiscal-year figure exists, no 12-month one' : x?.why || 'not reported';
  };
  for (const k of ['ocf', 'netIncome']) take(k, N[k]);
  for (const u of USES) take(u[0], N[u[0]]);
  return y;
}

// ---- view -----------------------------------------------------------------------------------

const labelOf = (key) => (USES.find((u) => u[0] === key) || [])[1] || key;

function slicesOf(al, financial) {
  const defs = financial ? USES.filter((u) => BANK_USES.includes(u[0])) : USES;
  const out = al.items.map((it) => {
    const d = defs.find((u) => u[0] === it.key);
    return { key: it.key, label: d[1], color: d[2], tip: d[3], val: it.val };
  }).filter((s) => s.val > 0);
  if (al.kept > 0) out.push({ key: KEPT[0], label: KEPT[1], color: KEPT[2], tip: KEPT[3], val: al.kept });
  return out;
}

register({
  code: 'ALLOC', aliases: ['WHERE', 'USES', 'MONEY', 'PIE'], name: 'Where the money goes', cat: 'Equity', sec: true,
  help: '<ticker> ALLOC — donut chart of where the company puts its money: research, capex, acquisitions, buybacks, dividends, debt repaid (one year or the last 5 years)',
  run: needsReal('Where the money goes'),
  live(ctx) {
    const s = ctx.sec;
    if (s.cls !== 'EQ' || s.etf) {
      ctx.el.innerHTML = `<div class="empty">Where the money goes is only for company stocks (${esc(s.sym)} isn't one).</div>`;
      return;
    }
    const wait = el('div', 'empty', 'Loading 10-K history from the SEC (first time takes about 10 seconds)…');
    ctx.el.appendChild(wait);
    let gone = false;
    ctx.engine.annual(s.sym).then((a) => {
      if (gone) return;
      wait.remove();
      render(ctx, a);
    }).catch((err) => {
      if (!gone) wait.textContent = `Couldn't load the 10-K figures: ${err.message}`;
    });
    return { destroy: () => { gone = true; } };
  },
});

function render(ctx, a) {
  const financial = a.financial ?? false;
  const years = a.years.filter((y) => y.revenue != null || y.ocf != null || y.netIncome != null).slice(-10);
  if (!years.length) {
    ctx.el.appendChild(el('div', 'empty', 'No fiscal year with figures to show.'));
    return;
  }
  const per = years.map((y) => ({ y, al: allocOf(y, financial) }));
  const tabsKeys = per.slice(-5).map((p) => String(p.y.fy));
  const ty = ttmYear(a);
  const ttmP = ty ? { y: ty, al: allocOf(ty, financial) } : null;
  const ttmLabel = ty?.end ? `the 12 months to ${ty.end}` : 'the last 12 months';
  const canSum = per.length >= 2;
  let sel = String(per[per.length - 1].y.fy);
  const bar = el('div', 'toolbar');
  const body = el('div');
  ctx.el.append(bar, body);
  const drawBar = () => {
    bar.innerHTML = (ttmP ? `<button class="tb ${sel === 'ttm' ? 'on' : ''}" data-k="ttm" title="The last 12 months from the latest quarterly report (10-K + year-to-date 10-Q − the same period a year earlier)">12 MONTHS</button><span class="sep"></span>` : '')
      + tabsKeys.map((k) => `<button class="tb ${k === sel ? 'on' : ''}" data-k="${k}">FY${k}</button>`).join('')
      + (canSum ? `<span class="sep"></span><button class="tb ${sel === 'sum' ? 'on' : ''}" data-k="sum" title="The last ${Math.min(5, per.length)} fiscal years added together">${Math.min(5, per.length)} YEARS</button>` : '');
  };
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-k]');
    if (!b) return;
    sel = b.dataset.k;
    draw();
  });

  const draw = () => {
    drawBar();
    const one = sel === 'sum' ? null : sel === 'ttm' ? ttmP : per.find((p) => String(p.y.fy) === sel);
    const periodName = sel === 'sum' ? 'these years' : sel === 'ttm' ? ttmLabel : `FY${sel}`;
    const al = one ? one.al : allocSum(per.slice(-5).map((p) => p.al));
    const slices = slicesOf(al, financial);
    const total = al.total;
    const baseName = financial ? 'net income' : 'operating cash flow + R&D';
    // nothing spent that any source reported: a chart that is all "kept" would only look like an answer
    if (!(al.uses > 0)) {
      const why = [...new Set(al.missing.map((m) => m.why))].join('; ');
      body.innerHTML = `<div class="empty">No source reported ${financial ? 'dividends, buybacks or acquisitions' : 'any use of cash (research, capital spending, acquisitions, buybacks, dividends, debt repaid)'} for ${esc(periodName)}${why ? ` (${esc(why)})` : ''}, so there is nothing to chart.<br><span class="dim small">${statusLine(a.status)}</span></div>`;
      return;
    }
    const centre = [big(total), sel === 'sum' ? `${al.years} years` : sel === 'ttm' ? '12 months' : `FY${al.fy}`];
    const pct = (v) => `${num((v / total) * 100, 1)}%`;
    const rows = slices.map((sl) => {
      const m = one && sl.key !== 'kept' ? mark(one.y, [sl.key]) : '';
      return `<tr data-i="${slices.indexOf(sl)}"><td class="l"><span class="sw" style="background:var(${sl.color})"></span>${esc(sl.label)}<span class="dim small" title="${esc(sl.tip)}"> ⓘ</span></td><td class="r">${big(sl.val)}${m}</td><td class="r"><b>${pct(sl.val)}</b></td></tr>`;
    }).join('');
    const cards = [
      [financial ? 'Net income' : 'Operating cash flow + R&D', al.base == null ? `<span class="dim" title="${esc(al.baseMissing || '')}">n/a</span>` : big(al.base), 'The cash the company had to use'],
      ['Total uses', big(al.uses), 'Everything in the chart except "kept"'],
      al.gap > 0 ? ['Spent more than earned', `<span class="down">${big(al.gap)}</span>`, 'The uses were larger than the cash generated: the difference came from cash on hand or new borrowing']
        : ['Kept / other', al.kept > 0 ? big(al.kept) : '0', 'What was left after all uses'],
    ];
    const missing = al.missing.filter((m) => labelOf(m.key));
    const hist = per.filter((p) => p.al.total > 0).map((p) => ({ fy: p.y.fy, total: p.al.total, slices: slicesOf(p.al, financial) }));
    const legendAll = (financial ? USES.filter((u) => BANK_USES.includes(u[0])) : USES).concat([KEPT]);
    body.innerHTML = `<div class="port-head">${cards.map(([k, v, tip]) => `<div title="${esc(tip)}"><span class="dim">${k}</span><b>${v}</b></div>`).join('')}</div>
      <div class="alloc-main"><div class="alloc-pie">${donut(slices, total, centre)}</div>
        <div class="tbl-wrap alloc-tbl"><table class="tbl"><thead><tr><th class="l">${esc(ctx.sec.sym)} · ${sel === 'sum' ? `FY${esc(al.fy)}` : sel === 'ttm' ? '12 MONTHS' : `FY${esc(sel)}`}</th><th class="r">Amount</th><th class="r">Share</th></tr></thead><tbody>${rows}</tbody></table></div></div>
      ${hist.length > 1 ? `<h3 class="alloc-h">How the mix changed (share of each year's total)</h3><div class="alloc-hist">${stacked(hist)}</div><div class="alloc-key">${legendAll.map((u) => `<span><i class="sw" style="background:var(${u[2]})"></i>${esc(u[1])}</span>`).join('')}</div>` : ''}
      <p class="note">${al.gap > 0 ? `In this period the company spent ${big(al.gap)} more than the ${baseName} it generated (${big(al.base)}); the difference was paid from cash on hand or new borrowing, so the chart shows the uses only. ` : al.base == null ? `No ${baseName} figure was reported, so the chart shows the uses only, without a "kept" slice. ` : ''}${missing.length ? `Counted as 0 because ${sel === 'ttm' ? 'no source has a 12-month figure for them' : 'no source reported them'}: ${missing.map((m) => `${esc(labelOf(m.key))} (${esc(m.why)})`).join('; ')}. ` : ''}${financial ? 'Banks and insurers: the base is net income, and capital spending, R&D and debt are left out because their cash flow statements don’t describe the business. ' : 'R&D is added back to operating cash flow so it can be compared with the other uses (it was deducted before that figure). '}Acquisitions are net of the cash acquired. Debt repaid is gross: companies refinance, so a large number does not mean the debt shrank.<br>${statusLine(a.status)}<br>Sources: ${esc(a.source)}, latest filing ${esc(a.asOf)}. Hover a slice for its amount; a letter next to an amount means it came from a fallback source (tap it for the details).</p>`;
    body.querySelectorAll('.pie-s').forEach((p) => {
      const i = p.dataset.i;
      const rowEl = body.querySelector(`tr[data-i="${i}"]`);
      p.addEventListener('mouseenter', () => rowEl?.classList.add('self'));
      p.addEventListener('mouseleave', () => rowEl?.classList.remove('self'));
    });
    body.querySelectorAll('tr[data-i]').forEach((tr) => {
      const p = body.querySelector(`.pie-s[data-i="${tr.dataset.i}"]`);
      tr.addEventListener('mouseenter', () => p?.classList.add('hot'));
      tr.addEventListener('mouseleave', () => p?.classList.remove('hot'));
    });
  };
  draw();
}
