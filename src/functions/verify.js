// VERIFY <ticker>: are Yahoo's company figures the same as the company's own SEC filing?
//
// Yahoo is the one source for every number in Meridian. This screen only checks it: the same figures (revenue,
// profit, cash flow, assets…) are read from the SEC filing and put side by side. Nothing from the SEC is ever
// copied into another screen, so two screens can never disagree. A gap above 5% is flagged: when that happens,
// open the filing (FILE) and trust the filing.

import { register } from '../registry.js';
import { esc, el, num, big } from '../fmt.js';

const showVal = (r, v) => (v == null ? '—' : r.key === 'epsDil' ? num(v, 2) : big(v, 2));
const MARK = {
  agree: ['✓', 'up', 'The same figure (within 2%)'],
  close: ['≈', '', 'Small gap (2–5%): usually a rounding or a restated number'],
  differs: ['⚠', 'dn', 'More than 5% apart: check the filing'],
  missing: ['—', 'dim', 'One of the two sources has no figure for this year'],
  skipped: ['—', 'dim', ''],
};

/** The one-line verdict for the top of a screen. */
/** Puts the one-line verdict at the top of a panel when the SEC cross-check finishes (silent when it can't run). */
export function showVerdict(host, E, sym, isGone) {
  const box = el('div', 'verify-line');
  host.append(box);
  E.verify(sym).then((vr) => {
    const line = verdictLine(vr);
    if (isGone() || !line) return box.remove();
    box.innerHTML = `<span class="${line.cls}">${esc(line.text)}</span>`;
  }).catch(() => box.remove());
}

export function verdictLine(v) {
  if (!v || v.state !== 'ok') return null;
  const { checked, agree, close, differs } = v.summary;
  if (!checked) return null;
  if (differs) return { cls: 'dn', text: `⚠ ${differs} of ${checked} Yahoo figures differ from the SEC filing by more than 5% (fiscal year ${v.latest.slice(0, 4)}). Type VERIFY to see which.` };
  return { cls: 'up', text: `✓ ${agree + close} of ${checked} Yahoo figures match the SEC filing (fiscal year ${v.latest.slice(0, 4)}).` };
}

register({
  code: 'VERIFY', aliases: ['XCHECK', 'AUDIT', 'TRUST'], name: 'Check Yahoo figures against the SEC filing', cat: 'System', sec: true,
  help: '<ticker> VERIFY — Yahoo\'s revenue, profit, cash flow and balance sheet next to the company\'s SEC filing; a ⚠ means they differ by more than 5% (US companies only)',
  run(ctx) {
    ctx.el.innerHTML = '<div class="empty">The filing check needs real company data. Switch with <kbd>MODE LIVE</kbd> (Meridian has to be running from its icon).</div>';
  },
  live(ctx) {
    const s = ctx.sec;
    if (s.cls !== 'EQ' || s.etf) {
      ctx.el.innerHTML = `<div class="empty">The filing check is for company stocks (${esc(s.sym)} isn't one).</div>`;
      return;
    }
    const host = el('div', 'empty', 'Reading the SEC filing and comparing it with Yahoo (about 10 seconds the first time)…');
    ctx.el.appendChild(host);
    let gone = false;
    ctx.engine.verify(s.sym).then((v) => {
      if (gone) return;
      if (v.state !== 'ok') {
        host.innerHTML = `Nothing to compare: ${esc(v.reason)}`;
        return;
      }
      const line = verdictLine(v);
      const years = [...new Set(v.rows.map((r) => r.end))].sort().reverse();
      const body = years.map((end) => {
        const rows = v.rows.filter((r) => r.end === end).map((r) => {
          const [mark, cls, tip] = MARK[r.state] || MARK.missing;
          const gap = r.diff == null ? '' : `${num(r.diff * 100, 1)}%`;
          return `<tr><td class="l">${esc(r.label)}</td><td>${showVal(r, r.yahoo)}</td><td>${showVal(r, r.sec)}</td><td>${gap}</td><td class="${cls}" title="${esc(r.note || tip)}">${mark}</td></tr>`;
        }).join('');
        return `<tr class="grp"><td colspan="5" class="l">Fiscal year ending ${esc(end)}</td></tr>${rows}`;
      }).join('');
      host.className = '';
      host.innerHTML = `<div class="pane"><h3>${esc(s.sym)}: Yahoo vs the SEC filing</h3>
        <p class="note ${line?.cls || ''}">${esc(line?.text || '')}</p>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th class="l">Figure</th><th>Yahoo</th><th>SEC filing</th><th>Gap</th><th></th></tr></thead><tbody>${body}</tbody></table></div>
        <p class="note dim">Yahoo is still the only source for every other screen: nothing from the SEC is copied into them. If a figure is ⚠, open <kbd>FILE</kbd> and trust the filing. Companies that file in another currency or aren't US filers can't be checked.</p></div>`;
    }).catch((err) => {
      if (!gone) host.textContent = `Couldn't run the check: ${err.message}`;
    });
    return { destroy: () => { gone = true; } };
  },
});
