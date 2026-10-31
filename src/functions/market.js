// Market-wide monitors: watchlist, indices, movers, heat map, overview, FX, commodities,
// crypto, curves, govvies, calendars and market hours.

import { register } from '../registry.js';
import { LiveTable, px, pct, chgText, netText, dir, num, big, signed, secLink, esc, el, store, save } from '../fmt.js';
import { sparkline, XYChart } from '../chart.js';
import { SECTORS, TENORS } from '../universe.js';
import { fmtVal } from '../news.js';

const quoteCols = (E, extra = []) => [
  { label: 'Ticker', value: (i) => secLink(i), cls: 'l' },
  { label: 'Name', value: (i) => esc(i.name), cls: 'l dim name' },
  { label: 'Last', value: (i) => px(i), cls: 'r', flash: (i) => i.last },
  { label: 'Net', value: (i) => netText(i), cls: 'r', cellCls: (i) => dir(i.chg) },
  { label: 'Chg', value: (i) => chgText(i), cls: 'r', cellCls: (i) => dir(i.chg) },
  ...extra,
];
const hiLo = [
  { label: 'High', value: (i) => px(i, i.high), cls: 'r dim' },
  { label: 'Low', value: (i) => px(i, i.low), cls: 'r dim' },
];
const spark = (E) => ({ label: 'Intraday', value: (i) => sparkline(E.intraday(i.sym).filter((_, k, a) => k % 4 === 0 || k === a.length - 1).map((b) => b.c), { color: i.chg >= 0 ? 'var(--up)' : 'var(--down)' }), cls: 'c' });

function quoteMonitor(ctx, insts, { extra = [], sort } = {}) {
  const t = new LiveTable(ctx.el, quoteCols(ctx.engine, extra), { onRow: (k) => ctx.app.load(k) });
  const update = () => {
    const list = typeof insts === 'function' ? insts() : insts;
    t.set((sort ? [...list].sort(sort) : list).map((i) => Object.assign(i, { key: i.sym })));
  };
  update();
  return { update };
}

register({
  code: 'WATCH', aliases: ['W', 'WL'], name: 'Watchlist', cat: 'Markets',
  help: 'WATCH · WATCH ADD <sym> · WATCH DEL <sym>',
  run(ctx) {
    const E = ctx.engine;
    const key = `watch:${E.mode}`;
    let list = store(key, E.defaults.watch);
    const [op, sym] = ctx.args;
    if (op && sym) {
      const s = sym.toUpperCase();
      if (/^ADD$/i.test(op) && E.get(s) && !list.includes(s)) list.push(s);
      if (/^(DEL|RM|REMOVE)$/i.test(op)) list = list.filter((x) => x !== s);
      save(key, list);
      ctx.app.toast(`Watchlist: ${list.length} securities`);
    }
    return quoteMonitor(ctx, () => list.map((s) => E.get(s)).filter(Boolean), {
      extra: [...hiLo, { label: 'Volume', value: (i) => (i.volume ? big(i.volume) : '—'), cls: 'r dim' }, spark(E)],
    });
  },
});

register({
  code: 'INDX', aliases: ['WEI', 'IDX'], name: 'World equity indices', cat: 'Markets',
  run(ctx) {
    const E = ctx.engine;
    const ytd = (i) => i.last / i.history[0].c - 1;
    return quoteMonitor(ctx, E.instruments.filter((i) => i.cls === 'IDX'), {
      extra: [...hiLo, { label: '1Y', value: (i) => pct(ytd(i), 1), cls: 'r', cellCls: (i) => dir(ytd(i)) }, spark(E)],
    });
  },
});

register({
  code: 'MOVE', aliases: ['MOV', 'MOVERS'], name: 'Top movers', cat: 'Equity',
  help: 'MOVE [US|EU|ASIA]',
  run(ctx) {
    const E = ctx.engine;
    const region = (ctx.args[0] || '').toUpperCase();
    const grid = el('div', 'split2');
    ctx.el.appendChild(grid);
    const up = el('div', 'pane');
    const dn = el('div', 'pane');
    up.innerHTML = '<h3 class="up">Leaders</h3>';
    dn.innerHTML = '<h3 class="down">Laggards</h3>';
    grid.append(up, dn);
    const cols = [
      { label: 'Ticker', value: (i) => secLink(i), cls: 'l' },
      { label: 'Last', value: (i) => px(i), cls: 'r', flash: (i) => i.last },
      { label: 'Chg', value: (i) => pct(i.pct), cls: 'r', cellCls: (i) => dir(i.chg) },
      { label: 'Vol×Avg', value: (i) => num(i.volume / (i.adv * (E.minute / 390 || 0.01)), 1), cls: 'r dim', title: 'Volume vs average for this time of day' },
      { label: '', value: (i) => `<span class="bar ${dir(i.pct)}" style="width:${Math.min(100, Math.abs(i.pct) * 1500)}%"></span>`, cls: 'barcell' },
    ];
    const tu = new LiveTable(up, cols, { onRow: (k) => ctx.app.load(k) });
    const td = new LiveTable(dn, cols, { onRow: (k) => ctx.app.load(k) });
    const update = () => {
      const eq = E.equities.filter((i) => !region || i.region === region).sort((a, b) => b.pct - a.pct);
      tu.set(eq.slice(0, 15).map((i) => Object.assign(i, { key: i.sym })));
      td.set(eq.slice(-15).reverse().map((i) => Object.assign(i, { key: i.sym })));
    };
    update();
    return { update };
  },
});

register({
  code: 'HEAT', aliases: ['HMAP', 'IMAP'], name: 'Sector heat map', cat: 'Equity',
  help: 'HEAT [US|EU|ASIA] — tiles sized by market cap',
  run(ctx) {
    const E = ctx.engine;
    const region = (ctx.args[0] || '').toUpperCase();
    const host = el('div', 'heat');
    ctx.el.appendChild(host);
    host.addEventListener('click', (e) => {
      const t = e.target.closest('[data-sec]');
      if (t) ctx.app.load(t.dataset.sec);
    });
    const color = (p) => {
      const k = Math.max(-1, Math.min(1, p / 0.03));
      return k >= 0 ? `color-mix(in oklab, var(--heat-up) ${Math.round(18 + k * 82)}%, var(--heat-mid))` : `color-mix(in oklab, var(--heat-down) ${Math.round(18 - k * 82)}%, var(--heat-mid))`;
    };
    const update = () => {
      const eq = E.equities.filter((i) => !region || i.region === region);
      const groups = SECTORS.map((s) => {
        const m = eq.filter((i) => i.sector === s);
        const cap = m.reduce((a, i) => a + i.shares * i.last, 0);
        const ret = m.reduce((a, i) => a + i.shares * i.last * i.pct, 0) / (cap || 1);
        return { s, m, cap, ret, value: Math.sqrt(cap) };
      }).filter((g) => g.m.length);
      const W = host.clientWidth;
      const H = host.clientHeight;
      if (!W || !H) return;
      let html = '';
      for (const g of squarify(groups, 0, 0, W, H)) {
        const head = 15;
        html += `<div class="heat-sector" style="left:${g.x}px;top:${g.y}px;width:${g.w}px;height:${g.h}px"><div class="heat-head"><span>${esc(g.s)}</span><span class="${dir(g.ret)}">${pct(g.ret)}</span></div></div>`;
        const tiles = squarify(g.m.map((i) => ({ i, value: Math.sqrt(i.shares * i.last) })), g.x + 1, g.y + head + 1, g.w - 2, g.h - head - 2);
        for (const t of tiles) {
          const small = t.w < 46 || t.h < 30;
          html += `<div class="tile" data-sec="${t.i.sym}" title="${esc(t.i.name)} ${pct(t.i.pct)}" style="left:${t.x}px;top:${t.y}px;width:${Math.max(0, t.w - 1)}px;height:${Math.max(0, t.h - 1)}px;background:${color(t.i.pct)}">${small ? '' : `<b>${t.i.sym}</b><span>${pct(t.i.pct, 1)}</span>`}</div>`;
        }
      }
      host.innerHTML = html;
    };
    const ro = new ResizeObserver(() => update());
    ro.observe(host);
    update();
    return { update, every: 3, destroy: () => ro.disconnect() };
  },
});

register({
  code: 'OVER', aliases: ['OVR', 'BTMM', 'DASH'], name: 'Market overview', cat: 'Markets',
  run(ctx) {
    const E = ctx.engine;
    const g = el('div', 'overview');
    ctx.el.appendChild(g);
    const sections = [
      ['Equity indices', E.instruments.filter((i) => i.cls === 'IDX')],
      [E.mode === 'live' ? 'US Treasuries' : 'Rates (10Y)', E.mode === 'live' ? E.curve('US').map((p) => E.get(`US${p.tenor}`)) : E.curveRows.map(([cc]) => E.get(`${cc}10Y`))],
      ['FX', E.instruments.filter((i) => i.cls === 'FX').slice(0, 8)],
      ['Commodities', E.instruments.filter((i) => i.cls === 'CMDTY').slice(0, 8)],
      ['Crypto', E.instruments.filter((i) => i.cls === 'CRYPTO')],
    ];
    const tables = sections.map(([title, list]) => {
      const box = el('div', 'pane', `<h3>${title}</h3>`);
      g.appendChild(box);
      const t = new LiveTable(box, [
        { label: '', value: (i) => secLink(i, i.cls === 'BOND' ? i.country : i.sym), cls: 'l' },
        { label: 'Last', value: (i) => px(i), cls: 'r', flash: (i) => i.last },
        { label: 'Chg', value: (i) => chgText(i), cls: 'r', cellCls: (i) => dir(i.chg) },
      ], { onRow: (k) => ctx.app.load(k), cls: 'compact' });
      return [t, list];
    });
    const newsBox = el('div', 'pane wide', '<h3>Latest headlines</h3><div class="news-mini"></div>');
    g.appendChild(newsBox);
    const nm = newsBox.querySelector('.news-mini');
    nm.addEventListener('click', (e) => {
      const r = e.target.closest('[data-story]');
      if (r) ctx.app.openStory(Number(r.dataset.story));
    });
    const update = () => {
      for (const [t, list] of tables) t.set(list.map((i) => Object.assign(i, { key: i.sym })));
      nm.innerHTML = E.news({ limit: 8 }).map((s) => `<div class="nrow" data-story="${s.id}"><span class="time">${E.storyTime(s)}</span><span class="hl">${esc(s.headline)}</span></div>`).join('');
    };
    update();
    return { update };
  },
});

register({
  code: 'FX', aliases: ['FXC', 'WCR'], name: 'FX monitor & cross matrix', cat: 'Rates & FX',
  run(ctx) {
    const E = ctx.engine;
    const top = el('div', 'pane');
    ctx.el.appendChild(top);
    const mon = quoteMonitor({ ...ctx, el: top }, E.instruments.filter((i) => i.cls === 'FX'), {
      extra: [{ label: 'Bid', value: (i) => num(i.bid, i.dp + 1), cls: 'r dim' }, { label: 'Ask', value: (i) => num(i.ask, i.dp + 1), cls: 'r dim' }, spark(E)],
    });
    const ccys = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD'];
    const mat = el('div', 'pane', '<h3>Cross rates (row ccy per 1 column ccy)</h3><div class="matrix"></div>');
    ctx.el.appendChild(mat);
    const m = mat.querySelector('.matrix');
    const usdPer = (c) => {
      if (c === 'USD') return 1;
      const d = E.get(`${c}USD`);
      if (d) return d.last;
      const iv = E.get(`USD${c}`);
      return 1 / iv.last;
    };
    const usdPerPrev = (c) => {
      if (c === 'USD') return 1;
      const d = E.get(`${c}USD`);
      if (d) return d.prevClose;
      return 1 / E.get(`USD${c}`).prevClose;
    };
    const update = () => {
      mon.update();
      m.innerHTML = `<table class="tbl mtx"><thead><tr><th></th>${ccys.map((c) => `<th class="r">${c}</th>`).join('')}</tr></thead><tbody>${ccys.map((r) => `<tr><th class="l">${r}</th>${ccys.map((c) => {
        if (r === c) return '<td class="r dim">—</td>';
        const v = usdPer(c) / usdPer(r);
        const pv = usdPerPrev(c) / usdPerPrev(r);
        return `<td class="r ${dir(v - pv)}">${num(v, v > 50 ? 2 : 4)}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table>`;
    };
    update();
    return { update };
  },
});

register({
  code: 'CMDY', aliases: ['CMDTY', 'GLCO'], name: 'Commodities', cat: 'Markets',
  run(ctx) {
    const E = ctx.engine;
    return quoteMonitor(ctx, E.instruments.filter((i) => i.cls === 'CMDTY'), {
      extra: [{ label: 'Unit', value: (i) => esc(i.unit), cls: 'l dim' }, ...hiLo, spark(E)],
    });
  },
});

register({
  code: 'CRYP', aliases: ['CRYPTO', 'XBT'], name: 'Crypto', cat: 'Markets',
  run(ctx) {
    const E = ctx.engine;
    const mcap = { XBTUSD: 19.7e6, XETUSD: 120e6, XSOUSD: 465e6, XRPUSD: 56e9, XADUSD: 35.5e9, XDOUSD: 145e9 };
    return quoteMonitor(ctx, E.instruments.filter((i) => i.cls === 'CRYPTO'), {
      extra: [...hiLo, { label: 'Mkt cap', value: (i) => big(i.marketCap ?? i.last * (mcap[i.sym] || 0)), cls: 'r dim' }, { label: '30D vol', value: (i) => pct(i.realVol, 0), cls: 'r dim' }, spark(E)],
    });
  },
});

register({
  code: 'CURVE', aliases: ['CRV', 'YC', 'GC'], name: 'Government yield curves', cat: 'Rates & FX',
  help: 'CURVE [US DE UK JP IT FR] — compares today with 1 week and 1 month ago',
  run(ctx) {
    const E = ctx.engine;
    const sel = ctx.args.map((a) => a.toUpperCase()).filter((a) => E.curveRows.some(([c]) => c === a));
    const countries = sel.length ? sel : E.curveRows.slice(0, 4).map(([c]) => c);
    const host = el('div', 'chart-host tall');
    ctx.el.appendChild(host);
    const chart = new XYChart(host);
    const tblHost = el('div', 'pane');
    ctx.el.appendChild(tblHost);
    const t = new LiveTable(tblHost, [
      { label: 'Curve', value: (r) => r.cc, cls: 'l' },
      ...TENORS.map((tn) => ({ label: tn, value: (r) => num(r.y(tn), 3), cls: 'r' })),
      { label: '2s10s', value: (r) => signed((r.y('10Y') - r.y('2Y')) * 100, 1, 'bp'), cls: 'r', cellCls: (r) => dir(r.y('10Y') - r.y('2Y')) },
      { label: '10Y chg', value: (r) => signed(E.get(`${r.cc}10Y`)?.chgBp, 1, 'bp'), cls: 'r', cellCls: (r) => dir(E.get(`${r.cc}10Y`)?.chg) },
    ], { onRow: (k) => ctx.app.load(`${k}10Y`) });
    const update = () => {
      const series = [];
      const rows = [];
      for (const cc of countries) {
        const c = E.curve(cc);
        series.push({ name: cc, line: true, points: c.map((p) => ({ x: Math.log1p(p.years), y: p.y, label: `${cc} ${p.tenor}` })) });
        rows.push({ key: cc, cc, c, y: (tn) => c.find((x) => x.tenor === tn)?.y ?? null });
      }
      if (countries.length === 1) {
        const c = E.curve(countries[0]);
        series.push({ name: '1W ago', line: true, dash: [4, 3], points: c.map((p) => ({ x: Math.log1p(p.years), y: p.wk })) });
        series.push({ name: '1M ago', line: true, dash: [1, 3], points: c.map((p) => ({ x: Math.log1p(p.years), y: p.mo })) });
      }
      // Real data: overlay the Treasury's official curve (1M-30Y) from its latest close.
      if (countries.length === 1 && countries[0] === 'US' && E.treasury?.rows.length) {
        const last = E.treasury.rows[E.treasury.rows.length - 1];
        series.push({ name: `Treasury close ${last.date}`, line: true, dash: [2, 2], r: 2, points: E.treasury.tenors.filter((t) => last.y[t.label] != null && t.years >= 0.25).map((t) => ({ x: Math.log1p(t.years), y: last.y[t.label], label: t.label })) });
      }
      chart.setData({ series, xCat: TENORS.map((tn) => [Math.log1p({ '3M': 0.25, '2Y': 2, '5Y': 5, '10Y': 10, '30Y': 30 }[tn]), tn]), yFmt: (v) => `${v.toFixed(2)}%`, xFmt: () => '', yLabel: 'Yield', xLabel: 'Tenor' });
      t.set(rows);
    };
    update();
    return { update, every: 2, destroy: () => chart.destroy() };
  },
});

register({
  code: 'GOVT', aliases: ['WB', 'GOVVIES'], name: 'Government bond monitor', cat: 'Rates & FX',
  run(ctx) {
    const E = ctx.engine;
    const t = new LiveTable(ctx.el, [
      { label: 'Country', value: (r) => esc(r.name), cls: 'l' },
      ...TENORS.flatMap((tn) => [
        { label: tn, value: (r) => num(E.get(`${r.cc}${tn}`)?.last, 3), cls: 'r', flash: (r) => E.get(`${r.cc}${tn}`)?.last },
        { label: 'Δbp', value: (r) => signed(E.get(`${r.cc}${tn}`)?.chgBp, 1), cls: 'r small', cellCls: (r) => dir(E.get(`${r.cc}${tn}`)?.chg) },
      ]),
      { label: '10Y vs US', value: (r) => (r.cc === 'US' ? '—' : signed((E.get(`${r.cc}10Y`)?.last - E.get('US10Y')?.last) * 100, 0, 'bp')), cls: 'r dim' },
    ], { onRow: (k) => ctx.app.load(`${k}10Y`) });
    const update = () => t.set(E.curveRows.map(([cc, name]) => ({ key: cc, cc, name })));
    update();
    return { update };
  },
});

register({
  code: 'ECO', aliases: ['ECOC', 'CAL'], name: 'Economic calendar', cat: 'Calendars',
  run(ctx) {
    const E = ctx.engine;
    if (E.mode === 'live') {
      ctx.el.innerHTML = '<div class="empty">No free source publishes an economic calendar with survey and actual figures, so ECO only runs on simulated data.<br>Use <kbd>NEWS ECONOMY</kbd> for real economic headlines, or <kbd>MODE SIM</kbd> to switch the whole terminal to the simulation.</div>';
      return;
    }
    const host = el('div');
    ctx.el.appendChild(host);
    const stars = (n) => '<span class="stars">' + '●'.repeat(n) + '<span class="dim">' + '●'.repeat(3 - n) + '</span></span>';
    const row = (e, date) => {
      const surprise = e.released ? (e.actual - e.survey) / (e.sd || 1) : null;
      return `<tr class="${e.released ? '' : 'pending'}"><td class="l dim">${date}</td><td class="l">${E.minuteLabel(e.minute)}</td><td class="l">${e.country}</td><td class="l">${esc(e.event)}</td><td class="c">${stars(e.importance)}</td>
        <td class="r dim">${fmtVal(e.prior, e.unit)}</td><td class="r">${fmtVal(e.survey, e.unit)}</td><td class="r ${surprise == null ? '' : dir(surprise)}">${e.released ? fmtVal(e.actual, e.unit) : '<span class="dim">—</span>'}</td><td class="r ${surprise == null ? '' : dir(surprise)}">${surprise == null ? '' : signed(surprise, 1, 'σ')}</td></tr>`;
    };
    const update = () => {
      const today = E.ecoToday();
      host.innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th class="l">Date</th><th class="l">Time ET</th><th class="l">Ctry</th><th class="l">Event</th><th>Imp</th><th class="r">Prior</th><th class="r">Survey</th><th class="r">Actual</th><th class="r">Surprise</th></tr></thead><tbody>
        ${today.map((e) => row(e, 'Today')).join('')}
        ${E.ecoWeek.flatMap((d) => d.items.map((e) => row({ ...e, released: false }, d.date.slice(5)))).join('')}
      </tbody></table></div>`;
    };
    update();
    return { update, every: 5 };
  },
});

register({
  code: 'EARN', aliases: ['ERN', 'EVTS'], name: 'Earnings calendar', cat: 'Calendars',
  run(ctx) {
    const E = ctx.engine;
    const t = new LiveTable(ctx.el, [
      { label: 'Date', value: (e) => (e.date === E.date ? '<b>Today</b>' : e.date.slice(5)), cls: 'l' },
      { label: 'Time', value: (e) => e.when, cls: 'l dim', title: 'BMO = before market open, AMC = after market close' },
      { label: 'Ticker', value: (e) => secLink(E.get(e.sym)), cls: 'l' },
      { label: 'Name', value: (e) => esc(e.name), cls: 'l dim name' },
      { label: 'EPS est', value: (e) => num(e.est, 2), cls: 'r' },
      { label: 'Actual', value: (e) => (e.actual == null ? '—' : num(e.actual, 2)), cls: 'r', cellCls: (e) => (e.actual == null ? '' : dir(e.actual - e.est)) },
      { label: 'Surprise', value: (e) => (e.actual == null ? '' : pct(e.actual / e.est - 1, 1)), cls: 'r', cellCls: (e) => (e.actual == null ? '' : dir(e.actual - e.est)) },
      { label: 'Rev est', value: (e) => big(e.revEst), cls: 'r dim' },
      { label: 'Px chg', value: (e) => pct(E.get(e.sym).pct), cls: 'r', cellCls: (e) => dir(E.get(e.sym).pct) },
    ], { onRow: (k) => ctx.app.load(k) });
    const update = () => t.set(E.earnings.map((e) => ({ ...e, key: e.sym, rowCls: e.date < E.date ? 'past' : '' })));
    update();
    return { update, every: 3 };
  },
});

register({
  code: 'HOURS', aliases: ['EXCH', 'MKTH'], name: 'Market hours', cat: 'Calendars',
  run(ctx) {
    const xs = [
      ['New York', 'America/New_York', '09:30', '16:00'],
      ['Toronto', 'America/Toronto', '09:30', '16:00'],
      ['São Paulo', 'America/Sao_Paulo', '10:00', '17:00'],
      ['London', 'Europe/London', '08:00', '16:30'],
      ['Frankfurt', 'Europe/Berlin', '09:00', '17:30'],
      ['Zurich', 'Europe/Zurich', '09:00', '17:20'],
      ['Mumbai', 'Asia/Kolkata', '09:15', '15:30'],
      ['Hong Kong', 'Asia/Hong_Kong', '09:30', '16:00'],
      ['Shanghai', 'Asia/Shanghai', '09:30', '15:00'],
      ['Seoul', 'Asia/Seoul', '09:00', '15:30'],
      ['Tokyo', 'Asia/Tokyo', '09:00', '15:00'],
      ['Sydney', 'Australia/Sydney', '10:00', '16:00'],
    ];
    const host = el('div');
    ctx.el.appendChild(host);
    const toMin = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
    const update = () => {
      const now = new Date();
      host.innerHTML = `<p class="note">Real wall-clock exchange hours (no holiday calendar). Simulated prices run on the terminal's own session clock.</p><div class="tbl-wrap"><table class="tbl"><thead><tr><th class="l">Exchange</th><th class="l">Local time</th><th class="l">Session</th><th class="l">Status</th><th class="l">Day</th></tr></thead><tbody>${xs.map(([n, tz, o, c]) => {
        const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(now).reduce((a, x) => ((a[x.type] = x.value), a), {});
        const m = Number(p.hour) * 60 + Number(p.minute);
        const wk = !['Sat', 'Sun'].includes(p.weekday);
        const open = wk && m >= toMin(o) && m < toMin(c);
        const prog = Math.max(0, Math.min(1, (m - toMin(o)) / (toMin(c) - toMin(o))));
        return `<tr><td class="l">${n}</td><td class="l">${p.hour}:${p.minute}</td><td class="l dim">${o}–${c}</td><td class="l ${open ? 'up' : 'dim'}">${open ? 'OPEN' : 'CLOSED'}</td><td class="l"><span class="dayline"><span style="width:${(open ? prog : m >= toMin(c) && wk ? 1 : 0) * 100}%"></span></span> ${p.weekday}</td></tr>`;
      }).join('')}</tbody></table></div>`;
    };
    update();
    return { update, every: 10 };
  },
});

// Squarified treemap (Bruls, Huizing & van Wijk): lays items with a `value` into the
// rectangle, keeping tiles as close to square as possible. Returns items with x, y, w, h.
function squarify(items, x, y, w, h) {
  const total = items.reduce((a, it) => a + it.value, 0);
  if (!total || w <= 0 || h <= 0) return [];
  const scale = (w * h) / total;
  const rest = [...items].sort((a, b) => b.value - a.value).map((it) => ({ ...it, area: it.value * scale }));
  const out = [];
  const worst = (row, side) => {
    const sum = row.reduce((a, r) => a + r.area, 0);
    const mx = Math.max(...row.map((r) => r.area));
    const mn = Math.min(...row.map((r) => r.area));
    return Math.max((side * side * mx) / (sum * sum), (sum * sum) / (side * side * mn));
  };
  let row = [];
  while (rest.length) {
    const side = Math.min(w, h);
    const next = rest[0];
    if (!row.length || worst([...row, next], side) <= worst(row, side)) {
      row.push(rest.shift());
      continue;
    }
    ({ x, y, w, h } = layRow(row, x, y, w, h, out));
    row = [];
  }
  if (row.length) layRow(row, x, y, w, h, out);
  return out.map((r) => ({ ...r, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) }));
}

function layRow(row, x, y, w, h, out) {
  const sum = row.reduce((a, r) => a + r.area, 0);
  if (w >= h) {
    const cw = sum / h;
    let cy = y;
    for (const r of row) {
      const rh = r.area / cw;
      out.push({ ...r, x, y: cy, w: cw, h: rh });
      cy += rh;
    }
    return { x: x + cw, y, w: w - cw, h };
  }
  const rh = sum / w;
  let cx = x;
  for (const r of row) {
    const rw = r.area / rh;
    out.push({ ...r, x: cx, y, w: rw, h: rh });
    cx += rw;
  }
  return { x, y: y + rh, w, h: h - rh };
}
