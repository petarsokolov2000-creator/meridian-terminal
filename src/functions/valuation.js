// VAL: is the stock cheap or expensive against its own history and its peers?
// DCF: what the business is worth if its cash flows follow stated assumptions.
//
// Figures: SEC EDGAR 10-K filings (Yahoo's annual statements for companies that don't file 10-Ks
// with the SEC); prices: Yahoo Finance. Nothing is estimated: a missing input shows n/a, and every
// number lists the formula behind it. Banks and insurers get bank metrics (EBITDA and free cash
// flow don't describe them), and no DCF.

import { register } from '../registry.js';
import { num, big, esc, el, dir, store, save } from '../fmt.js';
import { XYChart } from '../chart.js';

const NA = '<span class="dim">n/a</span>';
const x = (v, dp = 1) => (v == null || !Number.isFinite(v) ? NA : `${num(v, dp)}×`);
const pc = (v, dp = 1) => (v == null || !Number.isFinite(v) ? NA : `${num(v * 100, dp)}%`);
const needsReal = (what) => (ctx) => {
  ctx.el.innerHTML = `<div class="empty">${esc(what)} needs real company data. Switch with <kbd>MODE LIVE</kbd> (Meridian has to be running from its icon).</div>`;
};
const onlyStocks = (ctx, what) => {
  if (ctx.sec.cls === 'EQ' && !ctx.sec.etf) return false;
  ctx.el.innerHTML = `<div class="empty">${esc(what)} is only for company stocks (${esc(ctx.sec.sym)} isn't one).</div>`;
  return true;
};
const loading = (ctx, what) => {
  const w = el('div', 'empty', `${what}`);
  ctx.el.appendChild(w);
  return w;
};

// [key, label, format, formula, lower is cheaper?]
export const METRICS = {
  pe: ['P/E', x, 'Share price ÷ diluted earnings per share (latest fiscal year)', true],
  evEbitda: ['EV / EBITDA', x, '(Market value + debt − cash & short-term investments) ÷ (EBIT + depreciation & amortization)', true],
  ps: ['P / S', x, 'Market value ÷ revenue', true],
  pfcf: ['P / FCF', x, 'Market value ÷ (operating cash flow − capital expenditure)', true],
  fcfYield: ['FCF yield', pc, '(Operating cash flow − capital expenditure) ÷ market value', false],
  pb: ['P / B', x, "Market value ÷ (shareholders' equity − preferred stock)", true],
  ptbv: ['P / TBV', x, 'Market value ÷ (common equity − goodwill − other intangibles)', true],
  divYield: ['Dividend yield', pc, 'Dividends declared per share (fiscal year) ÷ share price', false],
};

// ---- VAL ------------------------------------------------------------------------------------

register({
  code: 'VAL', aliases: ['VALUE', 'MULT', 'MULTIPLES'], name: 'Valuation vs history & peers', cat: 'Equity', sec: true,
  help: '<ticker> VAL — P/E, EV/EBITDA, P/S, P/FCF and FCF yield now vs the company’s 5y/10y median and range, and vs peers',
  run: needsReal('Valuation history'),
  live(ctx) {
    if (onlyStocks(ctx, 'Valuation')) return;
    const s = ctx.sec;
    const E = ctx.engine;
    const wait = loading(ctx, 'Loading 10 years of 10-K figures from the SEC (first time takes about 10 seconds)…');
    let gone = false;
    let chart = null;
    E.valuation(s.sym).then((v) => {
      if (gone) return;
      wait.remove();
      const keys = v.keys;
      const cur = v.current;
      const peerState = { data: null, error: null, extra: store(`peers-extra:${s.sym}`, []), removed: store(`peers-removed:${s.sym}`, []), rows: [] };
      let sel = keys[0];

      const head = el('div', 'port-head');
      head.innerHTML = [
        ['Price', `${num(cur.price, 2)} ${esc(v.priceCurrency || '')}`],
        ['Market value', cur.marketCap ? big(cur.marketCap) : NA],
        ['Fiscal year used', `FY${v.latestFy} <span class="dim">(ended ${v.latestEnd})</span>`],
        ['Industry (SEC)', v.profile?.sic ? `${v.profile.sic} · ${esc(v.profile.sicDescription || '')}` : NA],
        ['Treated as', v.financial ? 'bank / insurer' : 'operating company'],
      ].map(([a, b]) => `<div><span class="dim">${a}</span><b>${b}</b></div>`).join('');
      ctx.el.appendChild(head);
      if (v.currencyMismatch) ctx.el.appendChild(el('div', 'empty', esc(v.currencyMismatch)));
      if (v.financial) ctx.el.appendChild(el('p', 'note', 'Banks and insurers: EV/EBITDA, P/S, P/FCF and FCF yield are left out because debt and cash flow are their raw material, not financing. Shown instead: P/E, price to book, price to tangible book and dividend yield.'));

      const table = el('div', 'tbl-wrap');
      ctx.el.appendChild(table);
      const host = el('div', 'chart-host short val-chart');
      ctx.el.appendChild(host);
      chart = new XYChart(host);
      const formulas = el('div', 'val-formulas');
      ctx.el.appendChild(formulas);
      const peersBox = el('div', 'val-peers');
      ctx.el.appendChild(peersBox);
      const note = el('p', 'note');
      ctx.el.appendChild(note);

      const range = (st) => (st.short ? `<span class="dim">n/a (${v.years.length} yr${v.years.length === 1 ? '' : 's'} of data)</span>` : st.min == null ? NA : `${fmt(st.k, st.min)} – ${fmt(st.k, st.max)}`);
      const fmt = (k, val) => METRICS[k][1](val);
      const peerMedian = (k) => {
        const vals = peerState.rows.filter((r) => !r.error && !r.currencyMismatch && Number.isFinite(r[k])).map((r) => r[k]).sort((a, b) => a - b);
        if (!vals.length) return null;
        const m = Math.floor(vals.length / 2);
        return vals.length % 2 ? vals[m] : (vals[m - 1] + vals[m]) / 2;
      };
      const vs = (now, ref, k) => {
        if (now == null || ref == null || !Number.isFinite(now) || !Number.isFinite(ref) || ref === 0) return NA;
        const d = now / ref - 1;
        const cheap = METRICS[k][3] ? d < 0 : d > 0;
        return `<span class="${cheap ? 'up' : 'down'}" title="${cheap ? 'cheaper' : 'more expensive'} than the reference">${d > 0 ? '+' : ''}${num(d * 100, 0)}%</span>`;
      };
      const drawTable = () => {
        table.innerHTML = `<table class="tbl val-tbl"><thead><tr><th class="l">Metric</th><th class="r">Now</th><th class="r">5y median</th><th class="r">5y range</th><th class="r">10y median</th><th class="r">10y range</th><th class="r">Peer median</th><th class="r" title="Now vs the 5-year median (green = cheaper)">vs 5y</th><th class="r" title="Now vs the peer median (green = cheaper)">vs peers</th></tr></thead><tbody>
          ${keys.map((k) => {
            const st = v.stats[k];
            const win = (w, n) => (w.short ? NA : `${fmt(k, w.median)}${w.n < n ? ` <span class="dim small" title="Only ${w.n} of the last ${n} fiscal years had every input for this multiple">${w.n}/${n} yrs</span>` : ''}`);
            return `<tr data-k="${k}" class="${k === sel ? 'self' : ''}" style="cursor:pointer"><td class="l">${METRICS[k][0]}</td><td class="r"><b>${fmt(k, cur[k])}</b></td>
              <td class="r">${win(st.y5, 5)}</td><td class="r">${range({ ...st.y5, k })}</td><td class="r">${win(st.y10, 10)}</td><td class="r">${range({ ...st.y10, k })}</td>
              <td class="r">${peerState.data ? fmt(k, peerMedian(k)) : '<span class="dim">…</span>'}</td><td class="r">${st.y5.short ? NA : vs(cur[k], st.y5.median, k)}</td><td class="r">${vs(cur[k], peerMedian(k), k)}</td></tr>`;
          }).join('')}</tbody></table>`;
      };
      table.addEventListener('click', (e) => {
        const tr = e.target.closest('[data-k]');
        if (!tr) return;
        sel = tr.dataset.k;
        drawTable();
        drawChart();
      });

      const drawChart = () => {
        const pts = v.history.filter((h) => Number.isFinite(h[sel])).map((h) => ({ x: h.fy, y: METRICS[sel][1] === pc ? h[sel] * 100 : h[sel], label: `FY${h.fy}` }));
        const nowPt = Number.isFinite(cur[sel]) ? [{ x: v.latestFy + 0.9, y: METRICS[sel][1] === pc ? cur[sel] * 100 : cur[sel], label: 'now' }] : [];
        if (!pts.length && !nowPt.length) {
          chart.setData({ series: [] });
          return;
        }
        chart.setData({
          series: [{ name: `${METRICS[sel][0]} at each fiscal year end`, line: true, points: pts }, { name: 'Now', points: nowPt, color: 'var(--accent)', r: 4, labels: true }],
          xFmt: (val) => (Number.isInteger(Math.round(val * 10) / 10) ? `FY${Math.round(val)}` : ''), yFmt: (val) => (METRICS[sel][1] === pc ? `${val.toFixed(1)}%` : `${val.toFixed(1)}×`), yLabel: METRICS[sel][0],
        });
      };

      // the formula and the actual inputs behind every "now" figure
      const y = v.years[v.years.length - 1];
      const M = (val) => (val == null ? 'n/a' : big(val));
      const inputs = {
        pe: `${num(cur.price, 2)} ÷ ${y.epsDil == null ? 'n/a' : num(y.epsDil, 2)}`,
        evEbitda: `(${M(cur.marketCap)} + ${M(y.debt)} − ${M(y.cashAll)}) ÷ (${M(y.ebit)} + ${M(y.da)})${y.formulas?.ebit && !/^Operating/.test(y.formulas.ebit) ? ` · EBIT = ${esc(y.formulas.ebit.toLowerCase())}` : ''}`,
        ps: `${M(cur.marketCap)} ÷ ${M(y.revenue)}`,
        pfcf: `${M(cur.marketCap)} ÷ (${M(y.ocf)} − ${M(y.capex)})`,
        fcfYield: `(${M(y.ocf)} − ${M(y.capex)}) ÷ ${M(cur.marketCap)}`,
        pb: `${M(cur.marketCap)} ÷ (${M(y.equity)} − ${M(y.preferred ?? 0)})`,
        ptbv: `${M(cur.marketCap)} ÷ (${M(y.commonEquity)} − ${M(y.goodwill ?? 0)} − ${M(y.intangibles ?? 0)})`,
        divYield: `${y.dps == null ? 'n/a' : num(y.dps, 2)} ÷ ${num(cur.price, 2)}`,
      };
      formulas.innerHTML = `<h3>How each figure is calculated (now, FY${v.latestFy})</h3><table class="tbl small"><tbody>${keys.map((k) => `<tr><td class="l"><b>${METRICS[k][0]}</b></td><td class="l val-formula">${esc(METRICS[k][2])}<br><span class="dim">= ${inputs[k]} = </span>${fmt(k, cur[k])}</td></tr>`).join('')}
        <tr><td class="l"><b>Market value</b></td><td class="l val-formula">Share price × ${esc(cur.sharesBasis || 'shares')}<br><span class="dim">= ${num(cur.price, 2)} × ${M(cur.shares)}</span></td></tr></tbody></table>`;

      // peers: SEC industry code, editable
      const drawPeers = () => {
        const rows = peerState.rows;
        const own = { symbol: s.sym, ...cur, fy: v.latestFy, self: true };
        peersBox.innerHTML = `<h3>Peers ${peerState.data?.rule ? `<span class="dim">· ${esc(peerState.data.rule)}</span>` : peerState.extra.length ? '<span class="dim">· added by you</span>' : ''}</h3>
          ${peerState.error ? `<p class="note">${esc(peerState.error)}</p>` : !peerState.data ? '<p class="note">Finding companies with the same SEC industry code and loading their 10-K figures (first time takes 20–30 seconds)…</p>' : ''}
          ${rows.length ? `<table class="tbl"><thead><tr><th class="l">Company</th><th class="r">FY</th>${keys.map((k) => `<th class="r">${METRICS[k][0]}</th>`).join('')}<th></th></tr></thead><tbody>
            ${[own, ...rows].map((r) => `<tr class="${r.self ? 'self' : ''}"><td class="l">${r.self ? `<b>${esc(r.symbol)}</b>` : `<a href="#" class="sec" data-sec="${esc(r.symbol)}">${esc(r.symbol)}</a>`}</td>
              <td class="r dim">${r.fy ? `FY${r.fy}` : ''}</td>${r.error ? `<td class="l dim" colspan="${keys.length}">${esc(r.error)}</td>` : r.currencyMismatch ? `<td class="l dim" colspan="${keys.length}">reports in another currency than its share price: n/a</td>` : keys.map((k) => `<td class="r">${fmt(k, r[k])}</td>`).join('')}
              <td class="r">${r.self ? '' : `<a href="#" class="dim" data-rm="${esc(r.symbol)}" title="Remove this peer">×</a>`}</td></tr>`).join('')}
            <tr><td class="l"><b>Median</b></td><td></td>${keys.map((k) => `<td class="r"><b>${fmt(k, peerMedian(k))}</b></td>`).join('')}<td></td></tr></tbody></table>` : ''}
          <div class="val-add"><input placeholder="Add a peer (ticker)" maxlength="12" data-add> <button class="tb" data-addbtn>Add</button>${peerState.removed.length ? ` <button class="tb" data-reset>Reset peers</button>` : ''}</div>`;
      };
      const loadPeers = async () => {
        try {
          peerState.data = await E.peers(s.sym);
        } catch (err) {
          peerState.data = { rule: null, peers: [] };
          peerState.error = `Automatic peers: ${err.message}. You can still add peers yourself.`;
        }
        if (gone) return;
        peerState.rows = peerState.data.peers.filter((r) => !peerState.removed.includes(r.symbol));
        for (const sym of peerState.extra) if (!peerState.rows.some((r) => r.symbol === sym)) peerState.rows.push(await E.peerRow(sym).catch((err) => ({ symbol: sym, error: err.message })));
        drawPeers();
        drawTable();
      };
      peersBox.addEventListener('click', async (e) => {
        const rm = e.target.closest('[data-rm]');
        if (rm) {
          e.preventDefault();
          const sym = rm.dataset.rm;
          peerState.rows = peerState.rows.filter((r) => r.symbol !== sym);
          peerState.extra = peerState.extra.filter((x2) => x2 !== sym);
          if (!peerState.removed.includes(sym)) peerState.removed.push(sym);
          save(`peers-extra:${s.sym}`, peerState.extra);
          save(`peers-removed:${s.sym}`, peerState.removed);
          drawPeers();
          drawTable();
        }
        if (e.target.closest('[data-reset]')) {
          peerState.removed = [];
          peerState.extra = [];
          save(`peers-extra:${s.sym}`, []);
          save(`peers-removed:${s.sym}`, []);
          peerState.rows = peerState.data?.peers || [];
          drawPeers();
          drawTable();
        }
        if (e.target.closest('[data-addbtn]')) {
          const input = peersBox.querySelector('[data-add]');
          const sym = String(input.value || '').trim().toUpperCase();
          if (!/^[A-Z0-9.\-]{1,12}$/.test(sym) || sym === s.sym || peerState.rows.some((r) => r.symbol === sym)) return;
          input.value = '';
          peerState.extra.push(sym);
          peerState.removed = peerState.removed.filter((x2) => x2 !== sym);
          save(`peers-extra:${s.sym}`, peerState.extra);
          peerState.rows.push({ symbol: sym, error: 'loading…' });
          drawPeers();
          const row = await E.peerRow(sym);
          peerState.rows = peerState.rows.map((r) => (r.symbol === sym ? row : r));
          drawPeers();
          drawTable();
        }
      });
      peersBox.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.matches('[data-add]')) peersBox.querySelector('[data-addbtn]').click();
      });

      note.innerHTML = `Sources: ${esc(v.source)}, latest filing ${esc(v.asOf)}; prices: ${esc(v.priceSource)}. "Now" = today's price with the latest fiscal year's figures (not trailing 12 months). History = the price at each fiscal year end with that year's figures, which were published about 1–2 months later. Medians and ranges use only the years available: a 10-year figure needs 10 fiscal years, otherwise n/a. Per-share figures are adjusted for stock splits${v.splits.length ? ` (${v.splits.map((sp) => `${esc(sp.ratio)} on ${sp.date}`).join(', ')})` : ''}. Negative earnings or cash flow give n/a for that multiple.`;
      drawTable();
      drawChart();
      drawPeers();
      loadPeers();
    }).catch((err) => {
      if (!gone) wait.textContent = `Couldn't load the valuation data: ${err.message}`;
    });
    return { destroy: () => { gone = true; chart?.destroy(); } };
  },
});

// ---- DCF ------------------------------------------------------------------------------------

/**
 * Ten-year discounted free cash flow. Revenue grows at `growth` for years 1-5, then the growth
 * rate fades in a straight line to `terminal` by year 10; free cash flow = revenue × `margin`.
 * Value = PV(FCF years 1-10) + PV(terminal value) − net debt, per share.
 */
export function dcf({ revenue0, growth, margin, discount, terminal, netDebt, shares }) {
  if (![revenue0, growth, margin, discount, terminal, netDebt, shares].every(Number.isFinite) || shares <= 0) return { error: 'missing input' };
  if (discount <= terminal) return { error: 'the discount rate must be above terminal growth' };
  let rev = revenue0;
  let pv = 0;
  const rows = [];
  for (let t = 1; t <= 10; t++) {
    const g = t <= 5 ? growth : growth + ((terminal - growth) * (t - 5)) / 5;
    rev *= 1 + g;
    const fcf = rev * margin;
    const df = 1 / (1 + discount) ** t;
    pv += fcf * df;
    rows.push({ t, g, rev, fcf, pv: fcf * df });
  }
  const tv = (rows[9].fcf * (1 + terminal)) / (discount - terminal);
  const pvTv = tv / (1 + discount) ** 10;
  const equity = pv + pvTv - netDebt;
  return { rows, pvFcf: pv, tv, pvTv, equity, perShare: equity / shares, tvShare: pvTv / (pv + pvTv) };
}

/** Defaults from the company's own history, each with how it was derived. */
export function dcfDefaults(years, { beta, rf, erp = 0.05, terminal = 0.025 }) {
  const ys = years.filter((y) => y.revenue > 0);
  const last = ys[ys.length - 1];
  const out = { notes: {} };
  if (!last) return null;
  out.revenue0 = last.revenue;
  out.notes.revenue0 = `FY${last.fy} revenue`;
  const span = Math.min(5, ys.length - 1);
  if (span >= 2) {
    const first = ys[ys.length - 1 - span];
    out.growth = (last.revenue / first.revenue) ** (1 / span) - 1;
    out.notes.growth = `${span}-year revenue growth per year, FY${first.fy}–FY${last.fy}: (${big(last.revenue)} ÷ ${big(first.revenue)})^(1/${span}) − 1`;
  } else {
    out.growth = null;
    out.notes.growth = 'needs at least 3 years of revenue: enter your own';
  }
  const margins = ys.slice(-5).filter((y) => y.fcf != null).map((y) => y.fcf / y.revenue).sort((a, b) => a - b);
  if (margins.length) {
    const m = Math.floor(margins.length / 2);
    out.margin = margins.length % 2 ? margins[m] : (margins[m - 1] + margins[m]) / 2;
    out.notes.margin = `median free-cash-flow margin of the last ${margins.length} fiscal year${margins.length === 1 ? '' : 's'} (FCF ÷ revenue)`;
  } else {
    out.margin = null;
    out.notes.margin = 'no free cash flow reported: enter your own';
  }
  if (Number.isFinite(beta) && Number.isFinite(rf)) {
    out.discount = rf + beta * erp;
    out.notes.discount = `cost of equity (CAPM) = 10-year Treasury ${num(rf * 100, 2)}% + beta ${num(beta, 2)} × equity risk premium ${num(erp * 100, 1)}% (an assumption)`;
  } else {
    out.discount = null;
    out.notes.discount = 'needs the 10-year Treasury yield and beta: enter your own';
  }
  out.terminal = terminal;
  out.notes.terminal = `assumption: ${num(terminal * 100, 1)}%, about long-run nominal economic growth; must be below the discount rate`;
  out.netDebt = last.netDebt;
  out.notes.netDebt = `FY${last.fy}: ${last.formulas?.netDebt || 'debt − cash'}`;
  out.shares = last.sharesOut ?? last.sharesDil;
  out.notes.shares = `FY${last.fy} ${last.sharesOut != null ? 'shares outstanding' : 'diluted average shares'}`;
  out.fy = last.fy;
  return out;
}

// scenario offsets from the base case (editable afterwards)
const SCEN = { bear: { growth: -0.03, margin: -0.02, discount: 0.01 }, base: { growth: 0, margin: 0, discount: 0 }, bull: { growth: 0.03, margin: 0.02, discount: -0.01 } };

register({
  code: 'DCF', aliases: ['FAIR', 'INTRINSIC', 'DCFV'], name: 'Discounted cash flow value', cat: 'Analytics', sec: true,
  help: '<ticker> DCF — fair value from 10 years of free cash flow; edit growth, margin, discount rate and terminal growth for bear/base/bull',
  run: needsReal('The DCF'),
  live(ctx) {
    if (onlyStocks(ctx, 'A DCF')) return;
    const s = ctx.sec;
    const E = ctx.engine;
    const wait = loading(ctx, 'Loading 10-K history from the SEC and the beta from Yahoo…');
    let gone = false;
    Promise.all([E.valuation(s.sym), E.details(s.sym).catch(() => null)]).then(([v, det]) => {
      if (gone) return;
      wait.remove();
      if (v.financial) {
        ctx.el.innerHTML = `<div class="empty">A free-cash-flow DCF doesn't apply to ${esc(s.sym)}: it's a bank or insurer (SEC industry code ${v.profile?.sic}), where debt and deposits are raw material rather than financing, so "free cash flow" and "net debt" have no meaning. Use <kbd>${esc(s.sym)} VAL</kbd> for price to book, price to tangible book and P/E against history and peers.</div>`;
        return;
      }
      if (v.currencyMismatch) {
        ctx.el.innerHTML = `<div class="empty">${esc(v.currencyMismatch)}</div>`;
        return;
      }
      const tsy = E.get('US10Y');
      const rf = tsy?.last != null ? tsy.last / 100 : null;
      const beta = det?.stats?.beta ?? null;
      const d = dcfDefaults(v.years, { beta, rf });
      if (!d) {
        ctx.el.innerHTML = '<div class="empty">No revenue history: a DCF needs at least one fiscal year of revenue.</div>';
        return;
      }
      const saved = store(`dcf:${s.sym}`, null);
      const base = { growth: d.growth, margin: d.margin, discount: d.discount, terminal: d.terminal };
      const scen = saved?.scen || Object.fromEntries(Object.entries(SCEN).map(([k, o]) => [k, {
        growth: base.growth == null ? null : base.growth + o.growth, margin: base.margin == null ? null : base.margin + o.margin,
        discount: base.discount == null ? null : base.discount + o.discount, terminal: base.terminal,
      }]));
      const price = v.current.price;

      const form = el('div', 'dcf-form');
      const out = el('div', 'port-head');
      const sens = el('div', 'tbl-wrap');
      const detail = el('div', 'tbl-wrap');
      const notes = el('div', 'val-formulas');
      ctx.el.append(form, out, sens, detail, notes);
      const P = (v2) => (v2 == null ? '' : (v2 * 100).toFixed(1));
      const drawForm = () => {
        form.innerHTML = `<table class="tbl"><thead><tr><th class="l">Assumption</th><th class="r">Bear</th><th class="r">Base</th><th class="r">Bull</th><th class="l">Default comes from</th></tr></thead><tbody>
          ${[['growth', 'Revenue growth, years 1–5 (%/yr)'], ['margin', 'Free-cash-flow margin (% of revenue)'], ['discount', 'Discount rate (%)'], ['terminal', 'Terminal growth after year 10 (%)']].map(([k, label]) => `<tr><td class="l">${label}</td>
            ${['bear', 'base', 'bull'].map((sc) => `<td class="r"><input type="number" step="0.1" inputmode="decimal" data-sc="${sc}" data-k="${k}" value="${P(scen[sc][k])}" placeholder="n/a"></td>`).join('')}
            <td class="l dim small">${esc(d.notes[k])}</td></tr>`).join('')}
          </tbody></table><div class="val-add"><button class="tb" data-reset>Reset to defaults</button> <span class="dim small">Bear/bull start at base ∓3 pts growth, ∓2 pts margin, ±1 pt discount rate. Years 6–10: growth fades in a straight line to terminal growth.</span></div>`;
      };
      form.addEventListener('change', (e) => {
        const t = e.target;
        if (!t.dataset.sc) return;
        const n = t.value === '' ? null : Number(t.value) / 100;
        scen[t.dataset.sc][t.dataset.k] = Number.isFinite(n) ? n : null;
        save(`dcf:${s.sym}`, { scen });
        drawOut();
      });
      form.addEventListener('click', (e) => {
        if (!e.target.closest('[data-reset]')) return;
        save(`dcf:${s.sym}`, null);
        for (const [k, o] of Object.entries(SCEN)) scen[k] = { growth: base.growth == null ? null : base.growth + o.growth, margin: base.margin == null ? null : base.margin + o.margin, discount: base.discount == null ? null : base.discount + o.discount, terminal: base.terminal };
        drawForm();
        drawOut();
      });
      const run = (sc) => dcf({ revenue0: d.revenue0, netDebt: d.netDebt, shares: d.shares, ...sc });
      const fv = (r) => (r.error || !(r.perShare > 0) ? NA : num(r.perShare, 2));
      const mos = (r) => {
        if (r.error || !(r.perShare > 0) || !price) return NA;
        const m = (r.perShare - price) / r.perShare;
        return `<span class="${dir(m)}">${m > 0 ? '+' : ''}${num(m * 100, 0)}%</span>`;
      };
      const drawOut = () => {
        const R = Object.fromEntries(['bear', 'base', 'bull'].map((k) => [k, run(scen[k])]));
        out.innerHTML = [['Price', num(price, 2)], ...['bear', 'base', 'bull'].map((k) => [`${k[0].toUpperCase()}${k.slice(1)} fair value`, `${fv(R[k])} <span class="dim small">margin of safety</span> ${mos(R[k])}${R[k].error ? ` <span class="dim small">(${esc(R[k].error)})</span>` : ''}`])]
          .map(([a, b]) => `<div><span class="dim">${a}</span><b>${b}</b></div>`).join('') +
          `<div><span class="dim">Terminal value share of base value</span><b>${R.base.error ? NA : `${num(R.base.tvShare * 100, 0)}%`}</b></div>`;
        // sensitivity of the base case: discount rate × terminal growth
        const b = scen.base;
        const dr = b.discount == null ? [] : [-0.02, -0.01, 0, 0.01, 0.02].map((o) => b.discount + o);
        const tg = [0.015, 0.02, 0.025, 0.03, 0.035];
        sens.innerHTML = dr.length ? `<h3>Base-case fair value per share: discount rate × terminal growth</h3><table class="tbl dcf-sens"><thead><tr><th class="l">Discount ↓ / terminal →</th>${tg.map((t) => `<th class="r">${num(t * 100, 1)}%</th>`).join('')}</tr></thead><tbody>
          ${dr.map((r) => `<tr><td class="l">${num(r * 100, 1)}%</td>${tg.map((t) => {
            const res = run({ ...b, discount: r, terminal: t });
            const cls = res.error || !(res.perShare > 0) ? '' : res.perShare >= price ? 'up' : 'down';
            return `<td class="r ${cls}">${fv(res)}</td>`;
          }).join('')}</tr>`).join('')}</tbody></table><p class="note">Green = above today's price, red = below. Each cell changes only the discount rate and terminal growth; the other base-case inputs stay the same.</p>` : '<p class="note">Enter a base-case discount rate to see the sensitivity table.</p>';
        detail.innerHTML = R.base.error ? '' : `<h3>Base case, year by year</h3><table class="tbl small"><thead><tr><th class="l">Year</th><th class="r">Growth</th><th class="r">Revenue</th><th class="r">Free cash flow</th><th class="r">Present value</th></tr></thead><tbody>
          ${R.base.rows.map((r) => `<tr><td class="l">${d.fy + r.t}</td><td class="r">${num(r.g * 100, 1)}%</td><td class="r">${big(r.rev)}</td><td class="r">${big(r.fcf)}</td><td class="r">${big(r.pv)}</td></tr>`).join('')}
          <tr><td class="l">Terminal</td><td class="r">${num(b.terminal * 100, 1)}%</td><td></td><td class="r">${big(R.base.tv)}</td><td class="r">${big(R.base.pvTv)}</td></tr></tbody></table>`;
      };
      notes.innerHTML = `<h3>Method and inputs</h3><table class="tbl small"><tbody>
        <tr><td class="l"><b>Fair value / share</b></td><td class="l val-formula">(Σ PV of free cash flow, years 1–10 + PV of terminal value − net debt) ÷ shares<br><span class="dim">PV = cash flow ÷ (1 + discount rate)^year · terminal value = FCF year 10 × (1 + terminal growth) ÷ (discount rate − terminal growth)</span></td></tr>
        <tr><td class="l"><b>Margin of safety</b></td><td class="l val-formula">(Fair value − price) ÷ fair value · positive = price below fair value</td></tr>
        <tr><td class="l">Starting revenue</td><td class="l">${big(d.revenue0)} <span class="dim">(${esc(d.notes.revenue0)})</span></td></tr>
        <tr><td class="l">Net debt</td><td class="l">${d.netDebt == null ? NA : big(d.netDebt)} <span class="dim">(${esc(d.notes.netDebt)})</span></td></tr>
        <tr><td class="l">Shares</td><td class="l">${big(d.shares)} <span class="dim">(${esc(d.notes.shares)})</span></td></tr></tbody></table>
        <p class="note">Sources: ${esc(v.source)}, latest filing ${esc(v.asOf)}; beta: Yahoo Finance (5-year monthly); 10-year Treasury: Yahoo Finance (^TNX)${rf != null ? `, ${num(rf * 100, 2)}% now` : ' (not loaded: enter a discount rate)'}; price: Yahoo Finance. Free cash flow = operating cash flow − capital expenditure; stock-based compensation is not subtracted, which flatters companies that pay heavily in stock. A DCF is only as good as its assumptions: small changes in the discount rate or terminal growth move the result a lot (see the table).</p>`;
      drawForm();
      drawOut();
    }).catch((err) => {
      if (!gone) wait.textContent = `Couldn't load the DCF inputs: ${err.message}`;
    });
    return { destroy: () => { gone = true; } };
  },
});
