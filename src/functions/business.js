// SEG: where the revenue comes from (business segment, product, geography) and whether a few
// customers matter. RISK: the risk factors the company itself lists in its latest 10-K.
// ETF: what a fund costs and holds, and how much two funds overlap.
//
// SEG and RISK read the latest 10-K from SEC EDGAR; ETF uses Yahoo Finance fund data.
// Nothing is estimated: what the filing or fund data doesn't contain shows as n/a.

import { register } from '../registry.js';
import { num, big, esc, el, dir, store, save } from '../fmt.js';

const NA = '<span class="dim">n/a</span>';
const fin = (v) => v != null && Number.isFinite(v);
const P = (v, dp = 1) => (fin(v) ? `${num(v * 100, dp)}%` : NA);
const needsReal = (what) => (ctx) => {
  ctx.el.innerHTML = `<div class="empty">${esc(what)} needs real company data. Switch with <kbd>MODE LIVE</kbd> (Meridian has to be running from its icon).</div>`;
};
const onlyStocks = (ctx, what) => {
  if (ctx.sec.cls === 'EQ' && !ctx.sec.etf) return false;
  ctx.el.innerHTML = `<div class="empty">${esc(what)} is only for company stocks (${esc(ctx.sec.sym)} isn't one${ctx.sec.etf ? `: try <kbd>${esc(ctx.sec.sym)} ETF</kbd>` : ''}).</div>`;
  return true;
};
function deferredView(ctx, promise, wait, render) {
  const w = el('div', 'empty', wait);
  ctx.el.appendChild(w);
  let gone = false;
  promise.then((d) => {
    if (gone) return;
    w.remove();
    render(d);
  }).catch((err) => {
    if (!gone) w.textContent = `Couldn't load this: ${err.message}`;
  });
  return { destroy: () => { gone = true; } };
}
const filingLink = (f) => `<a class="doc" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc(f.form)} filed ${esc(f.filed || '')}${f.reportDate ? ` (fiscal year ended ${esc(f.reportDate)})` : ''} ↗</a>`;
const bar = (share) => (fin(share) && share > 0 ? `<span class="seg-bar" style="width:${Math.min(100, share * 100).toFixed(1)}%"></span>` : '');

// ---- SEG ------------------------------------------------------------------------------------

register({
  code: 'SEG', aliases: ['SEGMENT', 'SEGMENTS', 'GEO', 'MIX'], name: 'Revenue by segment & geography', cat: 'Equity', sec: true,
  help: '<ticker> SEG — revenue by business segment, product and geography from the latest 10-K, plus customer concentration',
  run: needsReal('Segment data'),
  live(ctx) {
    if (onlyStocks(ctx, 'Segment data')) return;
    const s = ctx.sec;
    return deferredView(ctx, ctx.engine.segments(s.sym), 'Reading the latest 10-K from the SEC (large filings take a while)…', (d) => {
      if (d.unsupported) {
        ctx.el.appendChild(el('div', 'empty', `${esc(d.unsupported)} ${filingLink(d.filing)}`));
        return;
      }
      const ends = d.ends;
      const last = ends[ends.length - 1];
      const total = d.totals[last];
      const tabs = [['segment', 'Business segments'], ['product', 'Products & services'], ['geography', 'Geography']].filter(([k]) => d[k].length);
      let tab = tabs[0]?.[0];
      const head = el('div', 'port-head');
      head.innerHTML = [['Total revenue', `${fin(total) ? big(total) : NA} <span class="dim small">FY ended ${esc(last || '')}</span>`], ['Revenue tag', `<span class="small">${esc(d.revenueTag || 'n/a')}</span>`], ['Filing', filingLink(d.filing)]]
        .map(([a, b]) => `<div><span class="dim">${a}</span><b>${b}</b></div>`).join('');
      const bar2 = el('div', 'toolbar');
      const body = el('div', 'tbl-wrap');
      const cust = el('div', 'val-formulas');
      const note = el('p', 'note');
      ctx.el.append(head, bar2, body, cust, note);
      if (!tabs.length) {
        body.innerHTML = `<div class="empty">This 10-K has no revenue figures tagged by segment, product or geography. Companies with a single segment often report none; the filing itself may still describe the mix: ${filingLink(d.filing)}</div>`;
      }
      const draw = () => {
        bar2.innerHTML = tabs.map(([k, label]) => `<button class="tb ${k === tab ? 'on' : ''}" data-tab="${k}">${label}</button>`).join('');
        if (!tab) return;
        const rows = d[tab];
        const sum = rows.reduce((a, r) => a + (r.values[last] ?? 0), 0);
        const prevEnd = ends[ends.length - 2];
        body.innerHTML = `<table class="tbl seg-tbl"><thead><tr><th class="l">${esc(tabs.find((t) => t[0] === tab)[1])}</th>${ends.map((e) => `<th class="r">FY ${esc(e.slice(0, 4))}</th>`).join('')}<th class="r">Share</th><th class="l seg-col"></th><th class="r">Growth</th></tr></thead><tbody>
          ${rows.map((r) => {
            const v = r.values[last];
            const share = fin(v) && fin(total) && total ? v / total : null;
            const g = prevEnd && fin(v) && fin(r.values[prevEnd]) && r.values[prevEnd] > 0 ? v / r.values[prevEnd] - 1 : null;
            return `<tr><td class="l" title="${esc(r.member)}">${esc(r.label)}</td>${ends.map((e) => `<td class="r">${fin(r.values[e]) ? big(r.values[e]) : NA}</td>`).join('')}<td class="r">${P(share)}</td><td class="l seg-col">${bar(share)}</td><td class="r ${fin(g) ? dir(g) : ''}">${fin(g) ? `${g > 0 ? '+' : ''}${num(g * 100, 1)}%` : NA}</td></tr>`;
          }).join('')}
          <tr><td class="l dim">Sum of the parts</td>${ends.map((e) => `<td class="r dim">${big(rows.reduce((a, r) => a + (r.values[e] ?? 0), 0))}</td>`).join('')}<td class="r dim">${fin(total) && total ? P(sum / total) : NA}</td><td colspan="2" class="l dim small">${fin(total) && Math.abs(sum / total - 1) > 0.02 ? 'Not 100% of revenue: the filing tags these parts on a different basis (for example before eliminations, or only some regions).' : 'Adds up to total revenue.'}</td></tr>
          </tbody></table>`;
      };
      bar2.addEventListener('click', (e) => {
        const b = e.target.closest('[data-tab]');
        if (!b) return;
        tab = b.dataset.tab;
        draw();
      });
      draw();
      cust.innerHTML = `<h3>Customer concentration</h3>${d.customers.length
        ? `<table class="tbl"><thead><tr><th class="l">Customer (as named in the filing)</th><th class="r">Share of revenue</th><th class="l seg-col"></th></tr></thead><tbody>${d.customers.map((c) => `<tr><td class="l">${esc(c.customer)}</td><td class="r">${P(c.share)}</td><td class="l seg-col">${bar(c.share)}</td></tr>`).join('')}</tbody></table><p class="note">Companies usually don't name these customers; "Customer A" is how the filing tags them.</p>`
        : '<p class="note">No customer concentration is tagged in this 10-K. US rules require disclosing any single customer that accounts for 10% or more of revenue, so this usually means there is none; a few companies describe it only in the text.</p>'}`;
      note.innerHTML = `Source: ${esc(d.source)}, ${filingLink(d.filing)}. Each figure is the company's own tagged revenue (${esc(d.revenueTag || '')}) for a full fiscal year, broken down along the axis the filing uses; labels are derived from the tag names (hover a row for the tag). Up to three fiscal years: the ones the 10-K itself covers.`;
    });
  },
});

// ---- RISK -----------------------------------------------------------------------------------

register({
  code: 'RISK', aliases: ['RISKS', 'RF', '1A'], name: 'Risk factors (10-K)', cat: 'News', sec: true,
  help: '<ticker> RISK — the risk-factor headings from Item 1A of the latest 10-K, linked to the filing',
  run: needsReal('Risk factors'),
  live(ctx) {
    if (onlyStocks(ctx, 'Risk factors')) return;
    const s = ctx.sec;
    return deferredView(ctx, ctx.engine.risks(s.sym), 'Reading Item 1A of the latest 10-K from the SEC…', (d) => {
      const head = el('div', 'port-head');
      const items = d.headings.filter((h) => !h.group).length;
      head.innerHTML = [['Filing', filingLink(d.filing)], ['Risk headings found', d.unsupported ? NA : String(items)]].map(([a, b]) => `<div><span class="dim">${a}</span><b>${b}</b></div>`).join('');
      ctx.el.appendChild(head);
      const filt = el('div', 'val-add', '<input placeholder="Filter headings (e.g. china, debt, AI)" data-q style="width:260px">');
      const list = el('div', 'risk-list');
      ctx.el.append(filt, list);
      const draw = (q = '') => {
        if (d.unsupported) {
          list.innerHTML = `<div class="empty">${esc(d.unsupported)} ${filingLink(d.filing)}</div>`;
          return;
        }
        if (!d.found || !d.headings.length) {
          list.innerHTML = `<div class="empty">Couldn't find the risk-factor headings in this 10-K (some filings format them in a way Meridian can't pick out). Read them in the filing: ${filingLink(d.filing)}</div>`;
          return;
        }
        const ql = q.trim().toLowerCase();
        let n = 0;
        list.innerHTML = d.headings.map((h) => {
          if (h.group) return ql ? '' : `<h3>${esc(h.text)}</h3>`;
          if (ql && !h.text.toLowerCase().includes(ql)) return '';
          n++;
          return `<div class="risk-item"><span class="dim">${n}.</span> ${esc(h.text)}</div>`;
        }).join('') || '<p class="note">No heading matches.</p>';
      };
      filt.addEventListener('input', (e) => draw(e.target.value));
      draw();
      ctx.el.appendChild(el('p', 'note', `Source: ${esc(d.source || 'SEC EDGAR')}, ${filingLink(d.filing)}. Headings are the bold or italic lines in Item 1A, quoted as written; the full explanation of each risk is in the filing. Companies list every risk their lawyers can think of, so the number of headings says little; what changed from last year's list often says more.`));
    });
  },
});

// ---- ETF ------------------------------------------------------------------------------------

const SECTOR = { realestate: 'Real estate', consumer_cyclical: 'Consumer cyclical', basic_materials: 'Basic materials', consumer_defensive: 'Consumer defensive', technology: 'Technology', communication_services: 'Communication services', financial_services: 'Financial services', utilities: 'Utilities', industrials: 'Industrials', energy: 'Energy', healthcare: 'Health care' };

/** Overlap of two funds' known holdings: Σ min(weight in A, weight in B) over shared holdings. */
export function overlap(a, b) {
  const wb = new Map(b.map((h) => [h.symbol || h.name, h.weight]));
  const common = a.filter((h) => wb.has(h.symbol || h.name)).map((h) => ({ symbol: h.symbol, name: h.name, a: h.weight, b: wb.get(h.symbol || h.name) }));
  return { common: common.sort((x, y) => Math.min(y.a, y.b) - Math.min(x.a, x.b)), total: common.reduce((s, c) => s + Math.min(c.a, c.b), 0) };
}

register({
  code: 'ETF', aliases: ['FUND', 'HOLDINGS', 'OVERLAP'], name: 'ETF costs, holdings & overlap', cat: 'Markets', sec: true,
  help: '<etf> ETF [<other etf>] — expense ratio, top holdings, sector weights; with a second ETF, the overlap between them',
  run: needsReal('Fund data'),
  live(ctx) {
    const s = ctx.sec;
    const E = ctx.engine;
    const other = ctx.args.map((x) => x.toUpperCase()).find((x) => /^[A-Z0-9.\-]{1,12}$/.test(x) && x !== 'VS') || store('etf-vs', {})[s.sym] || null;
    return deferredView(ctx, E.etf(s.ysym), 'Loading fund data from Yahoo Finance…', (f) => {
      if ((f.type && !['ETF', 'MUTUALFUND'].includes(f.type)) || (!f.type && !f.holdings.length && f.expenseRatio == null)) {
        ctx.el.appendChild(el('div', 'empty', `${esc(s.sym)} isn't a fund${f.type ? ` (Yahoo lists it as ${esc(f.type)})` : ''}. Try <kbd>SPY ETF</kbd> or <kbd>QQQ ETF SPY</kbd>.`));
        return;
      }
      const top = f.holdings.reduce((a, h) => a + h.weight, 0);
      const head = el('div', 'port-head');
      head.innerHTML = [
        ['Fund', esc(f.name)], ['Issuer', esc(f.family || 'n/a')], ['Category', esc(f.category || 'n/a')],
        ['Expense ratio', fin(f.expenseRatio) ? `${num(f.expenseRatio * 100, f.expenseRatio < 0.001 ? 4 : 2)}% <span class="dim small">= $${num(f.expenseRatio * 10000, 2)} a year per $10,000</span>` : NA],
        ['Category average', fin(f.expenseRatioCategory) ? `${num(f.expenseRatioCategory * 100, 2)}%` : NA], ['Fund assets', fin(f.totalAssets) ? big(f.totalAssets) : NA], ['Yield', P(f.yield, 2)],
      ].map(([a, b]) => `<div><span class="dim">${a}</span><b>${b}</b></div>`).join('');
      ctx.el.appendChild(head);
      const split = el('div', 'split2');
      split.innerHTML = `<div class="pane"><h3>Top ${f.holdings.length} holdings · ${P(top)} of the fund</h3>${f.holdings.length ? `<table class="tbl"><tbody>${f.holdings.map((h) => `<tr><td class="l">${h.symbol ? `<a href="#" class="sec" data-sec="${esc(h.symbol)}">${esc(h.symbol)}</a>` : ''}</td><td class="l dim name">${esc(h.name)}</td><td class="r">${P(h.weight, 2)}</td><td class="l seg-col">${bar(h.weight / (f.holdings[0]?.weight || 1) * 0.6)}</td></tr>`).join('')}</tbody></table>` : '<p class="note">Yahoo lists no holdings for this fund.</p>'}</div>
        <div class="pane"><h3>Sector weights</h3>${f.sectors.length ? `<table class="tbl"><tbody>${f.sectors.map((x) => `<tr><td class="l">${esc(SECTOR[x.sector] || x.sector)}</td><td class="r">${P(x.weight)}</td><td class="l seg-col">${bar(x.weight)}</td></tr>`).join('')}</tbody></table>` : '<p class="note">No sector breakdown (bond and commodity funds usually have none).</p>'}
        ${fin(f.stock) || fin(f.bond) ? `<p class="note">Stocks ${P(f.stock)} · bonds ${P(f.bond)} · cash ${P(f.cash)}</p>` : ''}</div>`;
      ctx.el.appendChild(split);
      const ov = el('div', 'val-formulas');
      ctx.el.appendChild(ov);
      const drawOverlap = async (sym) => {
        if (!sym) {
          ov.innerHTML = `<h3>Overlap with another fund</h3><div class="val-add"><input placeholder="Other ETF (e.g. QQQ)" data-vs maxlength="12"> <button class="tb" data-go>Compare</button></div>`;
          return;
        }
        ov.innerHTML = `<h3>Overlap with ${esc(sym)}</h3><p class="note">Loading ${esc(sym)}…</p>`;
        let g;
        try {
          g = await E.etf(sym);
        } catch (err) {
          ov.innerHTML = `<h3>Overlap with ${esc(sym)}</h3><p class="note">Couldn't load ${esc(sym)}: ${esc(err.message)}</p><div class="val-add"><input placeholder="Other ETF" data-vs maxlength="12"> <button class="tb" data-go>Compare</button></div>`;
          return;
        }
        const o = overlap(f.holdings, g.holdings);
        const sw = new Map(g.sectors.map((x) => [x.sector, x.weight]));
        const sectorOverlap = f.sectors.length && g.sectors.length ? f.sectors.reduce((a, x) => a + Math.min(x.weight, sw.get(x.sector) ?? 0), 0) : null;
        ov.innerHTML = `<h3>Overlap with ${esc(sym)} <span class="dim">· ${esc(g.name)}</span></h3>
          <div class="port-head"><div><span class="dim">Holdings overlap (top 10s only)</span><b>at least ${P(o.total)}</b></div><div><span class="dim">Sector overlap</span><b>${P(sectorOverlap)}</b></div><div><span class="dim">Shared top holdings</span><b>${o.common.length}</b></div><div><span class="dim">${esc(sym)} expense ratio</span><b>${fin(g.expenseRatio) ? `${num(g.expenseRatio * 100, g.expenseRatio < 0.001 ? 4 : 2)}%` : NA}</b></div></div>
          ${o.common.length ? `<table class="tbl"><thead><tr><th class="l">Shared holding</th><th class="r">${esc(s.sym)}</th><th class="r">${esc(sym)}</th><th class="r">Overlap</th></tr></thead><tbody>${o.common.map((c) => `<tr><td class="l">${esc(c.symbol || c.name)}</td><td class="r">${P(c.a, 2)}</td><td class="r">${P(c.b, 2)}</td><td class="r">${P(Math.min(c.a, c.b), 2)}</td></tr>`).join('')}</tbody></table>` : '<p class="note">None of their top holdings are the same.</p>'}
          <p class="note">Overlap = Σ over shared holdings of the smaller of the two weights (the share of money that sits in the same stocks). Yahoo publishes only each fund's top 10 holdings (${P(top)} of ${esc(s.sym)}, ${P(g.holdings.reduce((a, h) => a + h.weight, 0))} of ${esc(sym)}), so the true overlap can only be higher: read it as a minimum. Sector overlap uses complete sector weights.</p>
          <div class="val-add"><input placeholder="Other ETF" data-vs maxlength="12"> <button class="tb" data-go>Compare</button> <button class="tb" data-clear>Clear</button></div>`;
      };
      ov.addEventListener('click', (e) => {
        if (e.target.closest('[data-clear]')) {
          const m = store('etf-vs', {});
          delete m[s.sym];
          save('etf-vs', m);
          drawOverlap(null);
        }
        if (!e.target.closest('[data-go]')) return;
        const sym = String(ov.querySelector('[data-vs]').value || '').trim().toUpperCase();
        if (!/^[A-Z0-9.\-]{1,12}$/.test(sym)) return;
        save('etf-vs', { ...store('etf-vs', {}), [s.sym]: sym });
        drawOverlap(sym);
      });
      ov.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.matches('[data-vs]')) ov.querySelector('[data-go]').click();
      });
      drawOverlap(other);
      ctx.el.appendChild(el('p', 'note', `Source: Yahoo Finance fund data (fundProfile, topHoldings), retrieved ${new Date().toISOString().slice(0, 10)}. Yahoo doesn't date its holdings snapshot; funds usually update them monthly or quarterly. The expense ratio is the fund's annual-report figure.`));
    });
  },
});
