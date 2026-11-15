// Terminal shell: four linked panels, a command line with autocomplete, ticker tape,
// session clock, toasts and the story reader.

import { Engine } from './engine.js';
import { LiveEngine, liveAvailable } from './live.js';
import { FUNCTIONS, resolve } from './registry.js';
import { esc, px, chgText, dir, store, save, el } from './fmt.js';
import { startDeskTint } from './desk-tint.js';
import './functions/market.js';
import './functions/security.js';
import { trade, checkAlerts, collectBackgroundAlerts } from './functions/tools.js';
import './functions/live-fns.js';
import './functions/fundamentals.js';
import './functions/backtest.js';
import './functions/supply.js';
import './functions/valuation.js';
import './functions/quality.js';
import './functions/business.js';
import './functions/check.js';
import './functions/status.js';
import './functions/compare.js';
import './functions/breadth.js';
import './functions/ovme.js';
import './functions/mars.js';
import './functions/bql.js';
import './functions/analysts.js';
import './functions/notes.js';
import './functions/insider.js';
import './functions/alloc.js';
import { GLOSSARY } from './glossary.js';

const PANEL_DEFAULTS = [
  { cmd: 'OVER', link: 'A' },
  { cmd: 'CHART', link: 'A' },
  { cmd: 'NEWS', link: 'B' },
  { cmd: 'HEAT', link: 'B' },
];
const LINKS = ['A', 'B', 'C', null];
const MAX_TABS = 12;
const THEMES = ['desk', 'dark', 'light'];

let engine; // chosen at boot: LiveEngine (real data via serve.mjs) or the simulation

class Panel {
  constructor(app, idx, saved) {
    this.app = app;
    this.idx = idx;
    this.link = saved?.link ?? PANEL_DEFAULTS[idx]?.link ?? null;
    this.history = [];
    this.root = el('section', 'panel');
    this.root.dataset.idx = idx + 1;
    this.root.innerHTML = `<header class="ph">
        <button class="pnum" title="Focus panel (Ctrl+${idx + 1})">${idx + 1}</button>
        <button class="plink" title="Link group: panels with the same colour follow each other's security"></button>
        <span class="ptitle"></span>
        <span class="pspacer"></span>
        <button class="pbtn back" title="Back (Alt+←)">◀</button>
        <button class="pbtn max" title="Maximize panel">⤢</button>
      </header><div class="pb" tabindex="-1"></div>`;
    this.body = this.root.querySelector('.pb');
    this.title = this.root.querySelector('.ptitle');
    this.root.addEventListener('mousedown', () => app.focus(this.idx));
    this.root.querySelector('.plink').addEventListener('click', (e) => {
      e.stopPropagation();
      this.link = LINKS[(LINKS.indexOf(this.link) + 1) % LINKS.length];
      this.paintLink();
      app.persist();
    });
    this.root.querySelector('.back').addEventListener('click', () => this.back());
    this.root.querySelector('.max').addEventListener('click', () => app.toggleMax(this.idx));
    this.body.addEventListener('click', (e) => {
      const a = e.target.closest('a.sec');
      if (a) {
        e.preventDefault();
        app.load(a.dataset.sec, this);
      }
    });
    this.paintLink();
  }
  // A tab that has nothing in it yet: a hint and a few starting points.
  showEmpty() {
    this.mounted?.destroy?.();
    this.mounted = null;
    this.def = null;
    this.sec = null;
    this.state = null;
    this.title.innerHTML = '<span class="pname">Empty tab</span>';
    this.root.classList.remove('sec-fn');
    this.body.scrollTop = 0;
    const start = [['WATCH', 'WATCH'], ['NEWS', 'NEWS'], ['HEAT', 'HEAT'], ['OVER', 'OVER'], [`${engine.defaults.sec} CHART`, 'CHART'], ['HELP', 'HELP']];
    this.body.innerHTML = `<div class="empty-tab"><p><b>Empty tab.</b> Type a ticker or a function in the command line at the top, for example <kbd>${esc(engine.defaults.sec)}</kbd> or <kbd>${esc(engine.defaults.sec)} CHART</kbd>.</p>
      <p class="dim">Or start from one of these:</p><div class="chips">${start.map(([cmd, label]) => `<button class="chip" data-cmd="${esc(cmd)}">${esc(label)}</button>`).join('')}</div></div>`;
    this.body.querySelector('.empty-tab').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cmd]');
      if (b) this.app.run(b.dataset.cmd, this);
    });
    this.app.persist();
  }
  // position changed (a tab before this one was closed)
  renumber(idx) {
    this.idx = idx;
    this.root.dataset.idx = idx + 1;
    const n = this.root.querySelector('.pnum');
    n.textContent = idx + 1;
    n.title = `Focus panel (Ctrl+${idx + 1})`;
  }
  paintLink() {
    const b = this.root.querySelector('.plink');
    b.dataset.link = this.link || '';
    b.textContent = this.link || '·';
  }
  // Show function `def` for security `sec` (an instrument or null).
  show(def, sec, args = [], { push = true } = {}) {
    if (push && this.state) this.history.push(this.state);
    if (this.history.length > 30) this.history.shift();
    this.mounted?.destroy?.();
    this.body.innerHTML = '';
    this.body.scrollTop = 0;
    this.def = def;
    this.sec = sec;
    this.state = { code: def.code, sym: sec?.sym ?? null, args };
    this.title.innerHTML = `${sec ? `<b class="psec">${esc(sec.sym)}</b> <span class="${dir(sec.chg)} pchg">${chgText(sec)}</span> ` : ''}<span class="pfn">${def.code}</span> <span class="pname">${esc(def.name)}</span>`;
    this.root.classList.toggle('sec-fn', !!def.sec);
    try {
      const ctx = { el: this.body, engine, sec, args, app: this.app, panel: this };
      this.mounted = (engine.mode === 'live' && def.live ? def.live(ctx) : def.run(ctx)) || null;
    } catch (err) {
      console.error(err);
      this.body.innerHTML = `<div class="empty">Function ${esc(def.code)} failed: ${esc(err.message)}</div>`;
      this.mounted = null;
    }
    this.ticks = 0;
    this.app.persist();
  }
  update() {
    if (this.sec) {
      const c = this.title.querySelector('.pchg');
      if (c) {
        c.textContent = chgText(this.sec);
        c.className = `${dir(this.sec.chg)} pchg`;
      }
    }
    if (!this.mounted?.update) return;
    this.ticks++;
    if (this.ticks % (this.mounted.every || 1)) return;
    try {
      this.mounted.update();
    } catch (err) {
      console.error(err);
    }
  }
  back() {
    const prev = this.history.pop();
    if (!prev) return;
    this.show(resolve(prev.code), engine.get(prev.sym), prev.args, { push: false });
  }
}

class App {
  constructor() {
    this.engine = engine;
    // 6 / 4 / 2 / 1 panels on one screen, or 'tabs' = one big panel with a tab for each of the four.
    // Phones start with tabs (four stacked panels meant a very long scroll).
    const phone = window.matchMedia?.('(max-width: 900px)').matches;
    const saved0 = store('layout', null);
    this.layout = [1, 2, 4, 6, 'tabs'].includes(saved0) ? saved0 : phone ? 'tabs' : 4;
    this.grid = document.getElementById('grid');
    const saved = store(`panels:${engine.mode}`, []);
    // four panels to start with; more can be opened as tabs (up to MAX_TABS), and closed again
    const count = Math.min(MAX_TABS, Math.max(PANEL_DEFAULTS.length, Array.isArray(saved) ? saved.length : 0));
    this.panels = Array.from({ length: count }, (_, i) => new Panel(this, i, saved[i]));
    this.panels.forEach((p) => this.grid.appendChild(p.root));
    this.cmd = document.getElementById('cmd');
    this.cmd.placeholder = `Ticker or function, e.g. ${engine.defaults.sec} CHART 1Y RSI · HEAT · HELP`;
    this.suggest = document.getElementById('suggest');
    this.focused = 0;
    this.focusTick = 0;
    this.booting = true;
    this.panels.forEach((p, i) => {
      const s = saved[i];
      this.focused = i;
      if (s?.code && resolve(s.code)) this.show(p, resolve(s.code), engine.get(s.sym), s.args || []);
      else if (s?.empty) p.showEmpty();
      else {
        const d = PANEL_DEFAULTS[i]?.cmd;
        if (!d) p.showEmpty();
        else this.run(d === 'CHART' ? `${engine.defaults.sec} CHART` : d);
      }
      p.history = [];
    });
    this.booting = false;
    this.tabs = document.getElementById('tabs');
    this.tabs.addEventListener('click', (e) => {
      const x = e.target.closest('[data-close]');
      if (x) return this.closePanel(Number(x.dataset.close));
      if (e.target.closest('[data-newtab]')) return this.addPanel();
      const b = e.target.closest('[data-tab]');
      if (b) { this.focus(Number(b.dataset.tab)); this.cmd.focus({ preventScroll: true }); }
    });
    document.getElementById('viewbtn').addEventListener('click', () => this.setLayout(this.layout === 'tabs' ? this.lastGrid() : 'tabs'));
    this.focus(Math.min(this.panels.length - 1, Math.max(0, Number(store('tabFocus', 0)) || 0)));
    this.applyLayout();
    this.bindCommandLine();
    this.bindKeys();
    this.buildTape();
    const th = store('theme', 'desk');
    this.theme = THEMES.includes(th) ? th : 'desk';
    document.documentElement.dataset.theme = this.theme;
    this.tint = startDeskTint(this.grid);
    this.status();
    engine.on('tick', () => this.onTick());
    engine.on('news', (stories) => this.onNews(stories));
    let last = performance.now();
    setInterval(() => {
      const now = performance.now();
      engine.advance(Math.min(5, (now - last) / 1000));
      last = now;
    }, 1000);
    document.getElementById('boot').textContent = engine.mode === 'live'
      ? `${engine.instruments.length} real instruments${engine.missing?.length ? ` (${engine.missing.length} unavailable)` : ''} · loaded in ${(engine.buildMs / 1000).toFixed(1)} s`
      : `${engine.instruments.length} simulated instruments · ${engine.stories.length} stories · built in ${Math.round(engine.buildMs)} ms`;
    document.getElementById('disclaimer').textContent = engine.mode === 'live'
      ? 'Real data from Yahoo Finance, may be delayed. Not investment advice.'
      : 'Simulated market data for demonstration. All companies are fictional. Not investment advice.';
  }

  fn(code) {
    return resolve(code);
  }

  persist() {
    this.paintTabs();
    if (this.booting) return;
    save(`panels:${engine.mode}`, this.panels.map((p) => (p.state ? { ...p.state, link: p.link } : { empty: true, link: p.link })));
  }

  focus(i) {
    this.focused = i;
    if (!this.booting) save('tabFocus', i);
    this.panels.forEach((p, k) => p.root.classList.toggle('focused', k === i));
    document.getElementById('target').textContent = `${this.layout === 'tabs' ? 'TAB' : 'PANEL'} ${i + 1}`;
    if (this.layout === 'tabs' && this.grid && this.tabs) this.applyLayout();
    else this.paintTabs();
  }

  toggleMax(i) {
    this.maxed = this.maxed === i ? null : i;
    this.applyLayout();
  }

  // the grid size the Tabs button switches back to (4 unless the user chose 1, 2 or 6)
  lastGrid() {
    const g = store('gridLayout', 4);
    return [1, 2, 4, 6].includes(g) ? g : 4;
  }

  setLayout(l) {
    // a bigger grid than we have panels: open empty ones so no cell is missing
    while (typeof l === 'number' && this.panels.length < l && this.panels.length < MAX_TABS) this.addPanel('', true);
    this.layout = l;
    this.maxed = null;
    save('layout', l);
    if (l !== 'tabs') save('gridLayout', l);
    this.applyLayout();
    this.focus(Math.min(this.focused, this.layout === 'tabs' ? this.panels.length - 1 : Math.min(this.layout, this.panels.length) - 1));
    this.toast(l === 'tabs' ? 'Tabs: one big panel at a time. Tap a tab (or Ctrl+1-9) to switch, + opens a new one, × closes one. Switch back with the button at the top.' : `${l} panel${l === 1 ? '' : 's'} on screen.${this.panels.length > l ? ` Your other ${this.panels.length - l} tab${this.panels.length - l === 1 ? ' is' : 's are'} still open: switch back to Tabs to see ${this.panels.length - l === 1 ? 'it' : 'them'}.` : ''}`);
  }

  // Open another tab (a new panel). Only the tab view can show more than four, so switch to it.
  addPanel(cmd = '', keepLayout = false) {
    if (this.panels.length >= MAX_TABS) return this.toast(`That's the most tabs (${MAX_TABS}). Close one with × first.`, 'err');
    const p = new Panel(this, this.panels.length, null);
    this.panels.push(p);
    this.grid.appendChild(p.root);
    if (this.layout !== 'tabs' && !keepLayout) {
      this.layout = 'tabs';
      save('layout', 'tabs');
    }
    this.maxed = null;
    this.focused = this.panels.length - 1;
    if (cmd) this.run(cmd, p);
    else p.showEmpty();
    p.history = [];
    this.applyLayout();
    this.focus(this.panels.length - 1);
    this.persist();
    this.cmd.focus({ preventScroll: true });
  }

  closePanel(i) {
    if (this.panels.length <= 1) return this.toast('The last tab can\'t be closed.', 'err');
    const p = this.panels[i];
    if (!p) return;
    p.mounted?.destroy?.();
    p.root.remove();
    this.panels.splice(i, 1);
    this.panels.forEach((q, k) => q.renumber(k));
    this.maxed = null;
    const next = i < this.focused ? this.focused - 1 : Math.min(this.focused, this.panels.length - 1);
    this.focused = next;
    this.applyLayout();
    this.focus(next);
    this.persist();
  }

  paintTabs() {
    if (!this.tabs || !this.panels) return;
    const tabs = this.layout === 'tabs';
    const btn = document.getElementById('viewbtn');
    btn.textContent = tabs ? `▦ ${this.lastGrid()} panels` : `▤ Tabs${this.panels.length > 4 ? ` (${this.panels.length})` : ''}`;
    btn.setAttribute('aria-pressed', String(tabs));
    this.tabs.hidden = !tabs;
    if (!tabs) return;
    const many = this.panels.length > 1;
    this.tabs.innerHTML = this.panels.map((p, k) => `<div class="tab ${k === this.focused ? 'on' : ''}"><button class="tabgo" role="tab" aria-selected="${k === this.focused}" data-tab="${k}"><span class="tabn">${k + 1}</span> ${p.def ? `${p.sec ? `<b>${esc(p.sec.sym)}</b> ` : ''}${esc(p.def.code)}` : '<span class="dim">new</span>'}</button>${many ? `<button class="tabx" data-close="${k}" title="Close tab ${k + 1}" aria-label="Close tab ${k + 1}">×</button>` : ''}</div>`).join('') + (this.panels.length < MAX_TABS ? '<button class="tabnew" data-newtab title="Open a new tab (command: TAB)" aria-label="New tab">+</button>' : '');
    this.tabs.querySelector('.tab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  applyLayout() {
    const tabs = this.layout === 'tabs';
    if (tabs) this.maxed = null;
    const n = this.maxed != null || tabs ? 1 : this.layout;
    this.grid.dataset.layout = n;
    this.grid.dataset.tabs = tabs ? '1' : '';
    this.panels.forEach((p, k) => {
      const visible = this.maxed != null ? k === this.maxed : tabs ? k === this.focused : k < n;
      const was = p.root.hidden;
      p.root.hidden = !visible;
      // a panel coming out of hiding has no size yet: redraw it once it has one
      if (was && visible && p.mounted?.update) requestAnimationFrame(() => p.mounted?.update?.());
    });
    if (this.maxed == null && !tabs && this.focused >= n) this.focus(0);
    this.paintTabs();
  }

  show(panel, def, sec, args) {
    panel.show(def, sec, args);
  }

  // Parse and run a command line against the focused panel.
  run(text, panel = this.panels[this.focused]) {
    const raw = text.trim();
    if (!raw) return;
    const toks = raw.split(/\s+/);
    const up = toks.map((t) => t.toUpperCase());
    // Commands that are not panel functions.
    if (up[0] === 'BUY' || up[0] === 'SELL') {
      const [sym, qty] = this.takeSec(toks.slice(1));
      if (!sym && toks[1] && engine.lookup) return this.lookupThenRun(toks[1], raw, panel);
      if (!sym) return this.toast(`Usage: ${up[0]} <ticker> <quantity>`, 'err');
      const msg = trade(engine, up[0] === 'BUY' ? 1 : -1, sym.sym, Math.round(Number(qty[0])));
      this.toast(msg, /^(Bought|Sold)/.test(msg) ? 'ok' : 'err');
      this.panels.forEach((p) => p.def?.code === 'PORT' && p.update());
      return;
    }
    if (up[0] === 'UPDATE' || up[0] === 'VERSION') return this.checkUpdate(true);
    if (up[0] === 'FINNHUB') return this.keyCommand('finnhub', toks[1]);
    if (up[0] === 'FRED') return this.keyCommand('fred', toks[1]);
    if (up[0] === 'SECID') return this.secContact(toks[1]);
    if (up[0] === 'MODE') {
      const want = up[1] === 'SIM' ? 'sim' : up[1] === 'LIVE' ? 'live' : null;
      if (!want) return this.toast(`Data: ${engine.mode === 'live' ? 'real (Yahoo Finance)' : 'simulated'}. Switch with MODE LIVE or MODE SIM.`);
      save('mode', want);
      location.reload();
      return;
    }
    if (up[0] === 'SPEED') {
      if (engine.mode === 'live') return this.toast('Real data runs on the real clock; SPEED only affects MODE SIM.');
      const v = Math.max(1, Math.min(60, Number(up[1]) || 1));
      engine.speed = v;
      save('speed', v);
      this.status();
      return this.toast(`Clock speed ${v}×`);
    }
    if (up[0] === 'THEME') {
      const want = (up[1] || '').toLowerCase();
      if (up[1] && !THEMES.includes(want)) return this.toast(`THEME ${THEMES.join(' / ').toUpperCase()}, or just THEME to switch to the next look.`, 'err');
      this.theme = want || THEMES[(THEMES.indexOf(this.theme) + 1) % THEMES.length];
      document.documentElement.dataset.theme = this.theme;
      save('theme', this.theme);
      this.tint();
      this.panels.forEach((p) => p.mounted?.update?.());
      return this.toast(`Look: ${this.theme.toUpperCase()}. Switch with THEME DESK / DARK / LIGHT.`);
    }
    if (up[0] === 'TAB' || up[0] === 'NEWTAB' || up[0] === 'TABS') {
      if (/^(CLOSE|X|DEL|RM)$/.test(up[1] || '')) return this.closePanel(this.focused);
      if (up[0] === 'TABS') return this.setLayout('tabs');
      return this.addPanel(toks.slice(1).join(' '));
    }
    if (up[0] === 'LAYOUT') {
      const a = up[1];
      return this.setLayout(/^TABS?$/.test(a || '') ? 'tabs' : [1, 2, 4, 6].includes(Number(a)) ? Number(a) : a ? 4 : this.layout === 'tabs' ? 4 : 'tabs');
    }
    if (up[0] === 'BACK') return panel.back();
    if (up[0] === 'RESET') {
      [`panels:${engine.mode}`, 'layout'].forEach((k) => save(k, null));
      location.reload();
      return;
    }

    // "AAPL MSFT COMPARE" or "AAPL COMPARE MSFT": every ticker around the word goes to COMPARE.
    const ci = up.findIndex((t, k) => k > 0 && resolve(t)?.code === 'COMPARE');
    if (ci > 0 && !up.slice(0, ci).some((t) => resolve(t))) return this.show(panel, resolve('COMPARE'), null, toks.filter((_, k) => k !== ci));

    // Security + function in either order: "ARCX CHART 1Y", "CHART ARCX", "ARCX".
    let def = resolve(up[0]);
    let sec = null;
    let rest;
    if (def) {
      if (def.sec) {
        const [s, r] = this.takeSec(toks.slice(1));
        sec = s;
        rest = r;
      } else rest = toks.slice(1);
    } else {
      const [s, r] = this.takeSec(toks);
      // Real data: any Yahoo symbol works, loaded the first time it's typed.
      if (!s && engine.lookup) return this.lookupThenRun(toks[0], raw, panel);
      if (!s) return this.toast(`Unknown function or security: ${raw}`, 'err');
      sec = s;
      def = r.length && resolve(r[0]) ? resolve(r[0]) : null;
      rest = def ? r.slice(1) : r;
      if (!def) def = panel.def?.sec ? panel.def : resolve('DESC');
      if (!def.sec) {
        // e.g. "ARCX NEWS": news filtered to the security
        if (def.code === 'NEWS') def = resolve('CN');
        else return this.show(panel, def, null, [sec.sym, ...rest]);
      }
    }
    if (def.sec && !sec) sec = panel.sec || engine.get(engine.defaults.sec);
    this.show(panel, def, sec, rest);
    if (sec && def.sec) this.propagate(panel, sec);
  }

  async checkUpdate(asked) {
    const phone = !!window.AndroidNet;
    try {
      const v = await (await fetch('/api/version')).json();
      if (v.updateAvailable && asked && v.selfUpdate) return this.installUpdate(v);
      if (v.updateAvailable) {
        const how = phone
          ? 'Close Meridian fully (phone Settings › Apps › Meridian › Force stop), open it again and wait about 15 seconds: it updates itself.'
          : v.selfUpdate ? 'Type UPDATE to install it.' : 'Close Meridian and open it again from its icon to update.';
        this.toast(`Meridian ${v.latest} is available (you have ${v.current}). ${how}`, 'ok');
      } else if (asked) this.toast(v.current ? `Meridian ${v.current}${v.latest ? ' is the latest version.' : ' (couldn\'t reach GitHub to check for updates).'}` : 'This copy has no version number (run it from the installed Meridian icon to get updates).');
    } catch {
      if (asked) this.toast('Update check needs the Meridian server (open Meridian from its icon).', 'err');
    }
  }

  // UPDATE on the PC: the server downloads and installs the new version, then reopens Meridian.
  async installUpdate(v) {
    try {
      const res = await fetch('/api/update', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.error) return this.toast(body.error || `Update failed (server answered ${res.status})`, 'err');
      this.toast(`Installing Meridian ${v.latest}… This window closes and Meridian reopens by itself in about a minute.`, 'ok');
    } catch {
      this.toast('The Meridian server is not running, so it can\'t update. Open Meridian from its icon.', 'err');
    }
  }

  // FINNHUB/FRED <key> saves a key on the PC running the server; <name> OFF removes it.
  // SECID <email>: the contact address the SEC asks every client to send (kept on this PC); SECID OFF removes it.
  async secContact(arg) {
    if (engine.mode !== 'live') return this.toast('SECID works with real data only: switch with MODE LIVE first.');
    if (!arg) return this.toast('SECID <your email> sets the contact address Meridian gives the SEC (EDGAR asks for one; it stays on this PC and goes only to the SEC). SECID OFF removes it. Check the result with STATUS.');
    const contact = /^off$/i.test(arg) ? '' : arg;
    try {
      const res = await fetch('/api/sec/contact', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contact }) });
      const body = await res.json().catch(() => ({ error: `Server answered ${res.status}` }));
      if (!res.ok || body.error) return this.toast(body.error || 'Saving failed', 'err');
      this.toast(contact ? 'SEC contact saved on this PC. Run STATUS and press "Test again" to see whether the SEC now answers.' : 'SEC contact removed (Meridian\'s default is used again).', 'ok');
    } catch {
      this.toast('The Meridian server is not running (start it with Start Meridian.cmd).', 'err');
    }
  }

  async keyCommand(id, arg) {
    const label = id === 'fred' ? 'FRED' : 'Finnhub';
    if (!arg) {
      if (engine.mode !== 'live') return this.toast(`${label} works with real data only: switch with MODE LIVE first.`);
      if (id === 'fred') {
        const f = engine.fred;
        if (!f.configured) return this.toast('No FRED key yet. Get a free one at fredaccount.stlouisfed.org/apikeys, then type FRED followed by the key.');
        return this.toast(`FRED: ${f.economy ? `${f.economy.length} indicators loaded (see ECO)` : f.error || 'loading'}.`);
      }
      const fh = engine.fh;
      if (!fh.configured) return this.toast('No Finnhub key yet. Type FINNHUB followed by your key (free at finnhub.io).');
      return this.toast(`Finnhub: stream ${fh.stream}, ${fh.streaming} symbols${fh.error ? ` — ${fh.error}` : ''}. Earnings ${fh.earnings ? 'loaded' : fh.earningsError || 'pending'}. Economic calendar: ${fh.eco ? 'loaded' : fh.ecoError || 'pending'}.`);
    }
    const key = /^off$/i.test(arg) ? '' : arg;
    this.toast(key ? `Checking the key with ${label}…` : `Removing the ${label} key…`);
    try {
      const res = await fetch(`/api/${id}/key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key }) });
      const body = await res.json().catch(() => ({ error: `Server answered ${res.status}` }));
      if (!res.ok || body.error) return this.toast(body.error || 'Saving the key failed', 'err');
      this.toast(key ? `${label} key saved on this PC. Reloading…` : `${label} key removed. Reloading…`, 'ok');
      setTimeout(() => location.reload(), 1200);
    } catch {
      this.toast('The Meridian server is not running (start it with Start Meridian.cmd).', 'err');
    }
  }

  async lookupThenRun(sym, raw, panel) {
    this.toast(`Looking up ${sym.toUpperCase()} on Yahoo Finance…`);
    try {
      const inst = await engine.lookup(sym);
      this.toast(`Added ${inst.sym} (${inst.name}). It stays in Meridian from now on.`, 'ok');
    } catch (err) {
      return this.toast(`Couldn't find ${sym.toUpperCase()}: ${err.message}. Try the company name to search.`, 'err');
    }
    this.run(raw, panel);
  }

  // Take the leading security from a token list (symbols may contain a space, e.g. "C 1").
  takeSec(toks) {
    if (!toks.length) return [null, toks];
    if (toks.length > 1) {
      const two = engine.get(`${toks[0]} ${toks[1]}`);
      if (two) return [two, toks.slice(2)];
    }
    const one = engine.get(toks[0]);
    return one ? [one, toks.slice(1)] : [null, toks];
  }

  // Load a security from a click: into a linked security panel if there is one,
  // otherwise into the panel itself.
  load(sym, from = this.panels[this.focused]) {
    const sec = engine.get(sym);
    if (!sec) {
      // one of the extra companies (or any ticker): look it up first, then open it
      if (!engine.lookup) return;
      this.toast(`Opening ${sym}: loading its history from Yahoo Finance…`);
      engine.lookup(sym).then(() => this.load(sym, from), (err) => this.toast(`Couldn't open ${sym}: ${err.message}`, 'err'));
      return;
    }
    const linked = this.panels.filter((p) => p !== from && from.link && p.link === from.link && !p.root.hidden);
    const target = from.def?.sec ? from : linked.find((p) => p.def?.sec);
    if (target) {
      this.show(target, target.def.sec ? target.def : resolve('DESC'), sec, target === from ? [] : target.state?.args || []);
      this.propagate(target, sec);
    } else {
      this.show(from, resolve('DESC'), sec, []);
    }
  }

  propagate(src, sec) {
    if (!src.link) return;
    for (const p of this.panels) {
      if (p === src || p.link !== src.link || !p.def?.sec || p.sec === sec) continue;
      p.show(p.def, sec, p.state?.args?.filter((a) => !engine.get(a)) || []);
    }
  }

  // ---------------------------------------------------------------- command line

  bindCommandLine() {
    const input = this.cmd;
    const cmdHist = store('cmdHist', []);
    let hp = -1;
    this.sel = -1;
    input.addEventListener('input', () => {
      // Upper-case everything except an API key typed after FINNHUB or FRED, or an address after SECID (keys are case-sensitive).
      const m = /^(\s*(?:finnhub|fred|secid)\s+)(.*)$/i.exec(input.value) || /^(\s*(?:\S+\s+)?note\s+)(.*)$/i.exec(input.value);
      input.value = m ? m[1].toUpperCase() + m[2] : input.value.toUpperCase();
      this.sel = -1;
      this.renderSuggest();
    });
    input.addEventListener('keydown', (e) => {
      const items = [...this.suggest.querySelectorAll('li')];
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (items.length) {
          this.sel = (this.sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items.forEach((li, k) => li.classList.toggle('sel', k === this.sel));
        } else if (cmdHist.length) {
          hp = Math.max(-1, Math.min(cmdHist.length - 1, hp + (e.key === 'ArrowUp' ? 1 : -1)));
          input.value = hp >= 0 ? cmdHist[hp] : '';
        }
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const li = items[this.sel >= 0 ? this.sel : 0];
        if (li) this.complete(li.dataset.v);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const li = this.sel >= 0 ? items[this.sel] : null;
        if (li) this.complete(li.dataset.v);
        const v = input.value.trim();
        if (!v) return;
        if (!/^(FINNHUB|FRED)\s+\S/i.test(v)) {
          // never keep an API key in the command history
          cmdHist.unshift(v);
          save('cmdHist', [...new Set(cmdHist)].slice(0, 50));
        }
        hp = -1;
        input.value = '';
        this.renderSuggest();
        this.run(v);
      } else if (e.key === 'Escape') {
        input.value = '';
        this.renderSuggest();
        input.blur();
      }
    });
    input.addEventListener('blur', () => setTimeout(() => this.renderSuggest(true), 150));
    this.suggest.addEventListener('mousedown', (e) => {
      const li = e.target.closest('li');
      if (!li) return;
      e.preventDefault();
      this.complete(li.dataset.v);
      const v = this.cmd.value.trim();
      this.cmd.value = '';
      this.renderSuggest();
      this.run(v);
    });
  }

  complete(v) {
    const parts = this.cmd.value.split(/\s+/);
    parts[parts.length - 1] = v;
    this.cmd.value = `${parts.join(' ')} `;
    this.renderSuggest();
  }

  renderSuggest(hide) {
    const v = this.cmd.value;
    const last = v.split(/\s+/).pop();
    if (hide || !last) {
      this.suggest.hidden = true;
      this.suggest.innerHTML = '';
      return;
    }
    const fns = [...FUNCTIONS.values()].filter((f) => f.code.startsWith(last) || (f.aliases || []).some((a) => a === last)).slice(0, 6);
    const secs = engine.search(last).slice(0, 8);
    // Anything else Yahoo knows (any exchange), fetched as you pause typing.
    const remote = (this.remote?.q === last ? this.remote.items : []).filter((r) => !engine.get(r.symbol)).slice(0, 6);
    const items = [
      ...fns.map((f) => `<li data-v="${f.code}"><span class="code">${f.code}</span><span>${esc(f.name)}</span><span class="kind">FUNC</span></li>`),
      ...secs.map((s) => `<li data-v="${esc(s.sym)}"><span class="code">${esc(s.sym)}</span><span>${esc(s.name)}</span><span class="kind">${s.cls}</span>${s.light && s.last == null ? '<span class="dim r">open</span>' : `<span class="${dir(s.chg)} r">${px(s)} ${chgText(s)}</span>`}</li>`),
      ...remote.map((r) => `<li data-v="${esc(r.symbol)}"><span class="code">${esc(r.symbol)}</span><span>${esc(r.name)}</span><span class="kind">${esc(r.type)}</span><span class="dim r">${esc(r.exchange)} · add</span></li>`),
    ];
    if (engine.searchRemote && last.length >= 2 && this.remote?.q !== last) {
      clearTimeout(this.remoteTimer);
      this.remoteTimer = setTimeout(async () => {
        const q = last;
        const found = await engine.searchRemote(q);
        this.remote = { q, items: found };
        if (this.cmd.value.split(/\s+/).pop() === q) this.renderSuggest();
      }, 300);
    }
    this.suggest.innerHTML = items.join('');
    this.suggest.hidden = !items.length;
    if (this.sel >= 0) this.suggest.querySelectorAll('li')[this.sel]?.classList.add('sel');
  }

  bindKeys() {
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && /^[1-9]$/.test(e.key) && Number(e.key) <= this.panels.length) {
        e.preventDefault();
        const i = Number(e.key) - 1;
        if (this.maxed != null) this.maxed = null;
        if (this.layout !== 'tabs' && i >= this.layout) {
          // panels 7+ only exist in the tab view; 5-6 need the six-panel grid, 1-4 the four-panel grid
          this.layout = i >= 6 ? 'tabs' : i >= 4 ? 6 : 4;
        }
        this.applyLayout();
        this.focus(i);
        this.cmd.focus();
      } else if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        this.panels[this.focused].back();
      } else if (e.key === '/' && document.activeElement !== this.cmd) {
        e.preventDefault();
        this.cmd.focus();
      } else if (e.key === 'Escape' && !document.getElementById('story').hidden) {
        this.closeStory();
      } else if (document.activeElement === document.body && e.key.length === 1 && /[a-z0-9]/i.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // typing anywhere goes to the command line, like a terminal
        this.cmd.focus();
      }
    });
    document.getElementById('story').addEventListener('click', (e) => {
      if (e.target.id === 'story' || e.target.closest('.close')) this.closeStory();
      const a = e.target.closest('a.sec');
      if (a) {
        e.preventDefault();
        this.closeStory();
        this.load(a.dataset.sec);
      }
    });
  }

  // ---------------------------------------------------------------- live updates

  onTick() {
    if (engine.setFocus && ++this.focusTick % 5 === 1) {
      // stream what's on screen first: panel securities, the watchlist, the tape
      const shown = this.panels.filter((p) => !p.root.hidden && p.sec).map((p) => p.sec.sym);
      engine.setFocus([...shown, ...store(`watch:${engine.mode}`, engine.defaults.watch), ...this.tapeInsts.map((i) => i.sym)]);
    }
    for (const p of this.panels) if (!p.root.hidden) p.update();
    this.updateTape();
    this.status();
    checkAlerts(engine, (m, k) => this.toast(m, k));
  }

  onNews(stories) {
    const main = stories.filter((s) => s.category !== 'Crypto'); // crypto news is on its own NEWS tab, not in the pop-ups
    const pick = engine.mode === 'live' ? main : main.filter((s) => Math.abs(s.impact) > 0.02 || s.eco);
    for (const s of pick.slice(0, 2)) this.toast(`<b>${engine.storyTime(s)}</b> ${esc(s.headline)}`, 'news', s.id);
  }

  status() {
    const st = document.getElementById('status');
    const mode = engine.mode === 'live' ? (engine.closed ? 'US CLOSED' : 'US OPEN') : engine.closed ? 'CLOSED' : engine.live ? 'LIVE' : 'REPLAY';
    const src = engine.sourceLabel();
    st.innerHTML = `<span class="src ${src.cls}" title="${esc(src.title)}">${esc(src.text)}</span><span class="mode ${mode.split(' ').pop().toLowerCase()}">${mode}</span><span class="clock">${engine.timeLabel()} ET</span>${engine.mode === 'sim' ? `<span class="dim">${engine.date}</span><span class="dim">${engine.speed}×</span>` : ''}`;
  }

  buildTape() {
    this.tapeInsts = engine.defaults.tape.map((s) => engine.get(s)).filter(Boolean);
    const t = document.getElementById('tape-inner');
    const item = (i) => `<a class="ti sec" data-sec="${esc(i.sym)}" href="#"><b>${esc(i.sym)}</b> <span class="tp">${px(i)}</span> <span class="tc ${dir(i.chg)}">${chgText(i)}</span></a>`;
    t.innerHTML = this.tapeInsts.map(item).join('') + this.tapeInsts.map(item).join('');
    t.addEventListener('click', (e) => {
      const a = e.target.closest('a.sec');
      if (a) {
        e.preventDefault();
        this.load(a.dataset.sec);
      }
    });
  }

  updateTape() {
    const nodes = document.querySelectorAll('#tape-inner .ti');
    nodes.forEach((n, k) => {
      const i = this.tapeInsts[k % this.tapeInsts.length];
      n.querySelector('.tp').textContent = px(i);
      const c = n.querySelector('.tc');
      c.textContent = chgText(i);
      c.className = `tc ${dir(i.chg)}`;
    });
  }

  toast(html, kind = 'info', storyId) {
    const box = document.getElementById('toasts');
    const t = el('div', `toast ${kind}`, kind === 'news' ? html : esc(html));
    if (storyId) {
      t.classList.add('clickable');
      t.addEventListener('click', () => this.openStory(storyId));
    }
    box.prepend(t);
    while (box.children.length > 4) box.lastChild.remove();
    setTimeout(() => t.classList.add('out'), kind === 'alert' ? 9000 : 5000);
    setTimeout(() => t.remove(), kind === 'alert' ? 9600 : 5600);
  }

  openStory(id) {
    const s = engine.stories.find((x) => x.id === id);
    if (!s) return;
    const m = document.getElementById('story');
    const link = /^https?:\/\//.test(s.link || '') ? s.link : null;
    m.querySelector('.story-body').innerHTML = `<div class="dim">${engine.storyTime(s)} ET · ${esc(s.source)} · ${esc(s.category || '')}</div>
      <h2>${esc(s.headline)}</h2>${s.body ? `<p>${esc(s.body)}</p>` : ''}${link ? `<p><a class="chip" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Read the full story at ${esc(s.source)} ↗</a></p>` : ''}
      ${s.tickers.length ? `<div class="chips">${s.tickers.map((t) => engine.get(t)).filter(Boolean).map((i) => `<a class="chip sec" data-sec="${esc(i.sym)}" href="#">${esc(i.sym)} <span class="${dir(i.chg)}">${chgText(i)}</span></a>`).join('')}</div>` : ''}
      ${engine.mode === 'sim' ? '<p class="note">Simulated story. Not real news.</p>' : ''}`;
    m.hidden = false;
  }

  closeStory() {
    document.getElementById('story').hidden = true;
  }
}

// Real data when the local server can provide it (or the user chose MODE LIVE), else the
// simulation. A failed live start falls back to the simulation and says why.
async function boot() {
  const msg = document.getElementById('boot-msg');
  const say = (t) => (msg.textContent = t);
  const pref = store('mode', 'auto');
  let reason = null;
  if (pref !== 'sim') {
    say('Connecting to the data server…');
    if (await liveAvailable()) {
      try {
        engine = await new LiveEngine().init(say);
      } catch (err) {
        reason = `Real data failed to load (${err.message}). Running the simulation instead.`;
      }
    } else if (pref === 'live') {
      reason = 'Real data needs the Meridian server running on your PC (Start Meridian.cmd). Running the simulation instead.';
    }
  }
  if (!engine) {
    say('Building the simulated market…');
    engine = new Engine({ speed: Number(store('speed', 5)) || 5 });
  }
  window.meridian = engine; // handy for poking at the data from devtools
  document.getElementById('boot-screen').remove();
  window.app = new App();
  installHelp();
  if (reason) window.app.toast(reason, 'err');
  if (engine.mode === 'live') window.app.checkUpdate(false);
  if (engine.mode === 'live') engine.on('quotes', () => window.app.status());
  // Phone app: alerts it triggered while Meridian was closed, now and whenever it comes back to the front.
  const collect = () => collectBackgroundAlerts(engine, (m, k) => window.app.toast(m, k));
  collect();
  document.addEventListener('visibilitychange', () => !document.hidden && collect());
}

window.addEventListener('DOMContentLoaded', () => {
  boot().catch((err) => {
    document.getElementById('boot-msg').textContent = `Meridian could not start: ${err.message}`;
  });
});

// "?" next to a metric: its definition, formula and a rough typical range, in a small popup.
// Caught before any other click handler, so a "?" inside a clickable table row doesn't select it.
function installHelp() {
  const box = document.createElement('div');
  box.className = 'modal';
  box.hidden = true;
  box.innerHTML = '<div class="story help-card" role="dialog" aria-modal="true"><button class="close" aria-label="Close">✕</button><div class="help-body"></div></div>';
  document.body.appendChild(box);
  const body = box.querySelector('.help-body');
  const close = () => (box.hidden = true);
  box.addEventListener('click', (e) => {
    if (e.target === box || e.target.closest('.close')) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !box.hidden) close();
  });
  document.addEventListener('click', (e) => {
    // a source marker ("Y", "F", "S+Y", "FY") or an n/a: where the number came from, or why it's missing
    const src = e.target.closest('[data-srcinfo]');
    if (src) {
      e.preventDefault();
      e.stopPropagation();
      const lines = String(src.dataset.srcinfo || '').split('\n').filter(Boolean);
      const missing = src.classList.contains('na') || src.classList.contains('warn');
      body.innerHTML = `<h2>${missing ? 'Why this is missing' : 'Where this number comes from'}</h2>${lines.map((l) => `<p class="src-line">${esc(l)}</p>`).join('')}<p class="dim small">Order of sources: SEC EDGAR first, then Yahoo Finance, then Finnhub. A fallback number is used only if it is within 2% of the SEC's figure in the nearest year both report.</p>`;
      box.hidden = false;
      box.querySelector('.close').focus();
      return;
    }
    const b = e.target.closest('[data-help]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    const g = GLOSSARY[b.dataset.help];
    if (!g) return;
    body.innerHTML = `<h2>${esc(g.name)}</h2><p>${esc(g.what)}</p><p><span class="dim">Formula</span><br><b>${esc(g.formula)}</b></p>${g.typical ? `<p><span class="dim">Typical values (rough guide; varies by industry)</span><br>${esc(g.typical)}</p>` : ''}`;
    box.hidden = false;
    box.querySelector('.close').focus();
  }, true);
}
