// NOTE: your own note on a security: long, short or just watching; why; entry price, target and stop;
// a dated journal. Shows how the price stands against your plan (profit or loss from YOUR side of the trade:
// a falling price is a gain on a short) and can set price alerts for the target and the stop.
// NOTES: all of them in one table, sorted so the ones that need a decision are on top.
//
// Notes stay on this device (this browser, or the phone app); they are not sent anywhere and the phone and
// the PC don't share them. Use the backup box in NOTES to move or keep them.

import { register } from '../registry.js';
import { num, esc, el, secLink, signed } from '../fmt.js';
import { SIDES, loadNotes, getNote, saveNote, deleteNote, noteStats, importNotes, localDay } from '../notes-data.js';
import { createAlert } from './tools.js';

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const NA = '<span class="dim">—</span>';
const P = (v, dp = 1) => {
  if (v == null) return NA;
  const r = Math.round(v * 100 * 10 ** dp) / 10 ** dp; // so a tiny move reads 0.0%, not -0.0%
  return `<span class="${r > 0 ? 'up' : r < 0 ? 'down' : 'dim'}">${r > 0 ? '+' : ''}${num(r, dp)}%</span>`;
};
const when = (t) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const numOrNull = (s) => {
  const t = String(s ?? '').trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : NaN;
};
const MAX_NOTES = 300;

function flags(st) {
  const f = [];
  if (st.stopHit) f.push('<span class="tag down">STOP HIT</span>');
  if (st.targetReached) f.push('<span class="tag up">TARGET REACHED</span>');
  return f.join(' ');
}

register({
  code: 'NOTE', aliases: ['THESIS', 'IDEA', 'JOURNAL'], name: 'Your note on a security', cat: 'Trading', sec: true,
  help: 'NOTE — why you hold or want it, entry, target, stop, journal. Typed: <ticker> NOTE LONG target 280 stop 210 reason… · <ticker> NOTE ADD <journal text> · <ticker> NOTE DEL',
  run(ctx) {
    const E = ctx.engine;
    const s = ctx.sec;
    const mode = E.mode;
    const a0 = String(ctx.args[0] || '').toUpperCase();
    let flash = '';
    // ---- typed shortcuts
    if (SIDES.includes(a0)) {
      const rest = ctx.args.slice(1);
      const take = (names) => {
        const k = rest.findIndex((t) => names.includes(String(t).toUpperCase()));
        if (k < 0) return null;
        const v = numOrNull(rest[k + 1]);
        rest.splice(k, 2);
        return v;
      };
      const target = take(['TARGET', 'T', 'TP']);
      const stop = take(['STOP', 'S', 'SL']);
      if (Number.isNaN(target) || Number.isNaN(stop)) flash = 'Target and stop must be prices above zero.';
      else {
        const old = getNote(mode, s.sym);
        if (!old && Object.keys(loadNotes(mode)).length >= MAX_NOTES) flash = `You have ${MAX_NOTES} notes, the most that fit. Delete some in NOTES first.`;
        else {
          saveNote(mode, s.sym, { ...(old || { log: [] }), side: a0, entry: old?.entry ?? s.last, entryAt: old?.entryAt ?? localDay(), target: target ?? old?.target ?? null, stop: stop ?? old?.stop ?? null, reason: rest.join(' ').slice(0, 2000) || old?.reason || '' });
          flash = `Saved your ${a0.toLowerCase()} note on ${s.sym}.`;
        }
      }
    } else if ((a0 === 'ADD' || a0 === 'LOG') && ctx.args.length > 1) {
      const n = getNote(mode, s.sym) || { side: 'WATCH', entry: s.last, entryAt: localDay(), target: null, stop: null, reason: '', log: [] };
      n.log = [{ t: Date.now(), text: ctx.args.slice(1).join(' ').slice(0, 500) }, ...(n.log || [])].slice(0, 200);
      saveNote(mode, s.sym, n);
      flash = `Added to the journal of ${s.sym}.`;
    } else if (a0 === 'DEL' || a0 === 'DELETE') {
      deleteNote(mode, s.sym);
      flash = `Deleted your note on ${s.sym}.`;
    }
    if (flash) ctx.app.toast(flash, /must|most|can't/.test(flash) ? 'err' : 'ok');

    // ---- screen
    const note0 = getNote(mode, s.sym);
    let side = note0?.side || 'LONG';
    const dp = s.dp ?? 2;
    const wrap = el('div', 'note-ed');
    ctx.el.appendChild(wrap);
    const v = (x) => (fin(x) ? +x.toFixed(Math.max(dp, 2)) : '');
    wrap.innerHTML = `
      <div class="note-head"><span class="note-px"></span></div>
      <div class="note-form">
        <div class="note-sides" role="group" aria-label="Side">${SIDES.map((x) => `<button class="tb ${x === side ? 'on' : ''}" data-side="${x}" title="${x === 'LONG' ? 'You own it or want to: you gain when the price rises' : x === 'SHORT' ? 'You bet against it: you gain when the price falls' : 'Just watching: no position'}">${x[0]}${x.slice(1).toLowerCase()}</button>`).join('')}</div>
        <label>Entry price <input data-f="entry" type="number" step="any" inputmode="decimal" value="${v(note0?.entry ?? s.last)}"></label>
        <label>Since <input data-f="entryAt" type="date" value="${esc(note0?.entryAt || localDay())}"></label>
        <label>Target <input data-f="target" type="number" step="any" inputmode="decimal" value="${v(note0?.target)}" placeholder="optional"></label>
        <label>Stop <input data-f="stop" type="number" step="any" inputmode="decimal" value="${v(note0?.stop)}" placeholder="optional"></label>
        <label class="note-why">Why? What would prove you wrong?<textarea data-f="reason" rows="4" maxlength="2000" placeholder="Your thesis in a few sentences. Writing down what would make you sell (or cover) now is the most useful part.">${esc(note0?.reason || '')}</textarea></label>
        <div class="note-actions"><button class="tb on" data-save>Save note</button> <button class="tb" data-alerts title="Price alerts for your target and your stop (see ALRT)">Set alerts for target and stop</button> ${note0 ? '<button class="tb" data-del>Delete note</button>' : ''}</div>
        <p class="note note-msg"></p>
      </div>
      <div class="note-stats"></div>
      <div class="pane"><h3>Journal</h3>
        <div class="val-add"><input data-f="log" size="40" maxlength="500" placeholder="What happened or what you think now…" aria-label="Journal entry"> <button class="tb" data-log>Add</button></div>
        <div class="note-log"></div></div>
      <p class="note">Notes stay on this device only: this browser, or the phone app. The PC and the phone don't share them, and clearing the app's data or reinstalling it deletes them: <kbd>NOTES</kbd> has a backup box. Profit and loss here is your side of the trade (a falling price is a gain on a short) and ignores costs, dividends and borrowing fees. A note is a memory aid, not advice.</p>`;
    const q = (k) => wrap.querySelector(`[data-f=${k}]`);
    const msg = wrap.querySelector('.note-msg');
    const current = () => getNote(mode, s.sym);
    const form = () => ({ side, entry: numOrNull(q('entry').value), entryAt: q('entryAt').value || localDay(), target: numOrNull(q('target').value), stop: numOrNull(q('stop').value), reason: q('reason').value.trim().slice(0, 2000) });

    const drawStats = () => {
      const n = current();
      const head = wrap.querySelector('.note-px');
      head.innerHTML = `<b>${esc(s.sym)}</b> last <b>${num(s.last, dp)}</b> ${esc(s.ccy || '')}${n ? ` · your note: <b class="${n.side === 'SHORT' ? 'down' : n.side === 'LONG' ? 'up' : ''}">${n.side}</b>, updated ${when(n.updated)}` : ' · no note yet'}`;
      const box = wrap.querySelector('.note-stats');
      if (!n) { box.innerHTML = ''; return; }
      const st = noteStats(n, s.last);
      box.innerHTML = `<div class="port-head">
        <div><span class="dim">${n.side === 'WATCH' ? 'Move since noted' : 'Your profit / loss'}</span><b>${P(st.pnl)}</b></div>
        <div><span class="dim">To target</span><b>${st.targetReached ? '<span class="up">reached</span>' : P(st.toTarget)}</b></div>
        <div><span class="dim">Cushion to stop</span><b>${st.stopHit ? '<span class="down">hit</span>' : P(st.cushion)}</b></div>
        <div><span class="dim">Reward : risk</span><b>${st.rr == null ? NA : `${num(st.rr, 1)} : 1`}</b></div>
        <div><span class="dim">Days</span><b>${st.days == null ? NA : st.days}</b></div>
      </div>${flags(st) ? `<p class="note">${flags(st)} Your own plan says it's time to decide: act on it or write down why you're changing the plan.</p>` : ''}
      ${st.problems.length ? `<p class="note st-warn">Check the numbers: ${esc(st.problems.join('; '))}.</p>` : ''}`;
    };
    const drawLog = () => {
      const n = current();
      wrap.querySelector('.note-log').innerHTML = n?.log?.length ? `<table class="tbl compact"><tbody>${n.log.map((l, k) => `<tr><td class="l dim" style="white-space:nowrap">${when(l.t)}</td><td class="l" style="width:100%;text-align:left">${esc(l.text)}</td><td class="r"><button class="tb" data-rmlog="${k}" title="Remove this entry" aria-label="Remove this entry">×</button></td></tr>`).join('')}</tbody></table>` : '<p class="note">Nothing yet. Add what changed your mind, or why you stayed put.</p>';
    };
    drawStats();
    drawLog();

    wrap.addEventListener('click', (e) => {
      const sd = e.target.closest('[data-side]');
      if (sd) { side = sd.dataset.side; wrap.querySelectorAll('[data-side]').forEach((b) => b.classList.toggle('on', b.dataset.side === side)); return; }
      if (e.target.closest('[data-save]')) {
        const f = form();
        if ([f.entry, f.target, f.stop].some((x) => Number.isNaN(x))) { msg.textContent = 'Entry, target and stop must be prices above zero (or empty).'; return; }
        if (!current() && Object.keys(loadNotes(mode)).length >= MAX_NOTES) { msg.textContent = `You have ${MAX_NOTES} notes, the most that fit. Delete some in NOTES first.`; return; }
        saveNote(mode, s.sym, { ...(current() || { log: [] }), ...f });
        msg.textContent = 'Saved.';
        drawStats();
        return;
      }
      if (e.target.closest('[data-alerts]')) {
        const f = form();
        if (!(f.target || f.stop)) { msg.textContent = 'Enter a target or a stop first.'; return; }
        const sign = side === 'SHORT' ? -1 : 1;
        let made = 0;
        if (f.target && createAlert(E, { sym: s.sym, op: sign > 0 ? '>' : '<', v: f.target })) made++;
        if (f.stop && createAlert(E, { sym: s.sym, op: sign > 0 ? '<' : '>', v: f.stop })) made++;
        msg.textContent = made ? `${made} price alert${made > 1 ? 's' : ''} set: see ALRT.` : 'Those alerts already exist: see ALRT.';
        return;
      }
      if (e.target.closest('[data-del]')) { deleteNote(mode, s.sym); ctx.app.run(`${s.sym} NOTE`, ctx.panel); return; }
      if (e.target.closest('[data-log]')) {
        const t = q('log').value.trim();
        if (!t) return;
        const n = current() || { side, entry: numOrNull(q('entry').value) ?? s.last, entryAt: localDay(), target: null, stop: null, reason: '', log: [] };
        n.log = [{ t: Date.now(), text: t.slice(0, 500) }, ...(n.log || [])].slice(0, 200);
        saveNote(mode, s.sym, n);
        q('log').value = '';
        drawStats();
        drawLog();
        return;
      }
      const rm = e.target.closest('[data-rmlog]');
      if (rm) {
        const n = current();
        n.log.splice(Number(rm.dataset.rmlog), 1);
        saveNote(mode, s.sym, n);
        drawLog();
      }
    });
    q('log').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); wrap.querySelector('[data-log]').click(); } });
    return { update: drawStats, every: 5 };
  },
});

register({
  code: 'NOTES', aliases: ['IDEAS', 'BOOKNOTES', 'THESES'], name: 'All your notes', cat: 'Trading',
  help: 'NOTES — every note in one table: side, entry, profit/loss, target and stop, with the ones that need a decision on top. Includes a backup box.',
  run(ctx) {
    const E = ctx.engine;
    const mode = E.mode;
    const body = el('div', 'notes');
    ctx.el.appendChild(body);
    const draw = () => {
      const wasOpen = body.querySelector('details')?.open;
      const all = loadNotes(mode);
      const rows = Object.entries(all).map(([sym, n]) => ({ sym, n, i: E.get(sym) })).map((r) => ({ ...r, st: r.i ? noteStats(r.n, r.i.last) : null }));
      const urgency = (r) => (r.st?.stopHit ? 0 : r.st?.targetReached ? 1 : 2);
      rows.sort((a, b) => urgency(a) - urgency(b) || (b.n.updated || 0) - (a.n.updated || 0));
      const ok = rows.filter((r) => r.st && r.n.side !== 'WATCH' && r.st.pnl != null);
      const avg = (side) => { const m = ok.filter((r) => r.n.side === side); return m.length ? m.reduce((a, r) => a + r.st.pnl, 0) / m.length : null; };
      const count = (side) => rows.filter((r) => r.n.side === side).length;
      body.innerHTML = rows.length ? `<div class="port-head">
          <div><span class="dim">Notes</span><b>${rows.length}</b></div>
          <div><span class="dim">Long / short / watch</span><b>${count('LONG')} / ${count('SHORT')} / ${count('WATCH')}</b></div>
          <div><span class="dim">Average P&amp;L, longs</span><b>${P(avg('LONG'))}</b></div>
          <div><span class="dim">Average P&amp;L, shorts</span><b>${P(avg('SHORT'))}</b></div>
          <div><span class="dim">Need a decision</span><b class="${rows.some((r) => r.st && (r.st.stopHit || r.st.targetReached)) ? 'down' : 'dim'}">${rows.filter((r) => r.st && (r.st.stopHit || r.st.targetReached)).length}</b></div>
        </div>
        <div class="tbl-wrap"><table class="tbl compact"><thead><tr><th class="l">Ticker</th><th class="l">Side</th><th class="r">Since</th><th class="r">Entry</th><th class="r">Last</th><th class="r" title="Your profit or loss from your side of the trade">P&amp;L</th><th class="r">Target</th><th class="r" title="Distance left to the target">To target</th><th class="r">Stop</th><th class="r" title="Distance to the stop before it is hit">Cushion</th><th class="r" title="Reward to risk at your entry">R:R</th><th class="l">Status</th><th class="l">Why</th></tr></thead><tbody>
        ${rows.map((r) => { const { n, i, st } = r; return `<tr data-note="${esc(r.sym)}" class="supp-row"><td class="l">${i ? secLink(i) : esc(r.sym)}</td><td class="l ${n.side === 'SHORT' ? 'down' : n.side === 'LONG' ? 'up' : 'dim'}">${n.side}</td><td class="r dim">${esc(n.entryAt || '')}</td><td class="r">${fin(n.entry) ? num(n.entry, i?.dp ?? 2) : NA}</td><td class="r">${i ? num(i.last, i.dp) : '<span class="dim">n/a</span>'}</td><td class="r">${st ? P(st.pnl) : NA}</td><td class="r">${fin(n.target) ? num(n.target, i?.dp ?? 2) : NA}</td><td class="r">${st ? (st.targetReached ? '<span class="up">reached</span>' : P(st.toTarget)) : NA}</td><td class="r">${fin(n.stop) ? num(n.stop, i?.dp ?? 2) : NA}</td><td class="r">${st ? (st.stopHit ? '<span class="down">hit</span>' : P(st.cushion)) : NA}</td><td class="r dim">${st?.rr == null ? '—' : `${num(st.rr, 1)}`}</td><td class="l">${st ? flags(st) : ''}</td><td class="l dim" title="${esc(n.reason || '')}">${esc((n.reason || n.log?.[0]?.text || '').slice(0, 60))}${(n.reason || '').length > 60 ? '…' : ''}</td></tr>`; }).join('')}
        </tbody></table></div>
        <p class="note">Click a row to open its note. Rows with a hit stop or a reached target are on top: that is the moment your own plan says to decide. Profit and loss is from your side (a falling price is a gain on a short). Notes are not advice.</p>`
        : `<div class="empty">No notes yet. Open a stock and type <kbd>${esc(E.defaults.sec)} NOTE</kbd>, or in one line: <kbd>${esc(E.defaults.sec)} NOTE LONG target ${Math.round(E.get(E.defaults.sec).last * 1.2)} stop ${Math.round(E.get(E.defaults.sec).last * 0.9)} why you like it</kbd>. Use SHORT for a bet against it, WATCH if you only follow it.</div>`;
      const json = JSON.stringify(all);
      const back = el('details', 'bql-help');
      back.innerHTML = `<summary>Backup and restore</summary>
        <p class="note">Notes live only on this device, and are lost if you clear the app's data or reinstall it. Copy the code below somewhere safe (a message to yourself, a file). To restore or move to another device, paste it into the second box and press Restore: notes already here are replaced only by newer ones.</p>
        <textarea readonly rows="3" data-backup aria-label="Backup code">${esc(json)}</textarea><div class="val-add"><button class="tb" data-copyb>Copy backup code</button> <button class="tb" data-copyt>Copy as readable text</button></div>
        <textarea rows="3" data-restore placeholder="Paste a backup code here" aria-label="Restore"></textarea><div class="val-add"><button class="tb" data-restorebtn>Restore</button> <span class="dim small" data-restoremsg></span></div>`;
      body.appendChild(back);
      back.dataset.json = json;
      if (wasOpen) back.open = true;
    };
    const readable = () => Object.entries(loadNotes(mode)).map(([sym, n]) => `${sym} · ${n.side} · since ${n.entryAt || '?'} at ${n.entry ?? '?'}${n.target ? ` · target ${n.target}` : ''}${n.stop ? ` · stop ${n.stop}` : ''}\n${n.reason || ''}${(n.log || []).map((l) => `\n  ${new Date(l.t).toISOString().slice(0, 10)}: ${l.text}`).join('')}`).join('\n\n');
    const copy = async (text, btn) => {
      try { await navigator.clipboard.writeText(text); ctx.app.toast('Copied.', 'ok'); } catch { const t = body.querySelector('[data-backup]'); t.value = text; t.select(); ctx.app.toast('Select the text in the box and copy it (Ctrl+C).'); }
    };
    body.addEventListener('click', (e) => {
      const row = e.target.closest('[data-note]');
      if (row && !e.target.closest('a')) return ctx.app.run(`${row.dataset.note} NOTE`, ctx.panel);
      if (e.target.closest('[data-copyb]')) copy(body.querySelector('details').dataset.json);
      if (e.target.closest('[data-copyt]')) copy(readable());
      if (e.target.closest('[data-restorebtn]')) {
        const m = body.querySelector('[data-restoremsg]');
        try {
          const n = importNotes(mode, JSON.parse(body.querySelector('[data-restore]').value));
          m.textContent = `${n} note${n === 1 ? '' : 's'} restored.`;
          draw();
          body.querySelector('details').open = true;
        } catch (err) { m.textContent = err instanceof SyntaxError ? 'That is not a backup code (it should start with {).' : err.message; }
      }
    });
    draw();
    // keep prices current without rebuilding the backup box while someone types into it
    return { update: () => { if (!body.contains(document.activeElement) || document.activeElement.tagName === 'BODY') draw(); }, every: 10 };
  },
});
