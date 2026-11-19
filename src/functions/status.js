// STATUS: is everything working? Tests every data source right now (one fresh request each, see
// /api/diag in server/backend.mjs) and shows each one's real answer, including the HTTP status
// of a source that refused. Also: the installed and the newest version, which API keys are set
// (never the keys themselves), notifications, and on the PC the updater's last log lines; in the
// phone app, what the app says about its own updates and background alert checks.
// "Copy report" puts all of it on the clipboard as plain text, to paste when asking for help.

import { register } from '../registry.js';
import { esc, el } from '../fmt.js';
import * as notify from '../notify.js';

const when = (ts) => (ts ? new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'never');
const PERMISSION = {
  granted: 'on', ask: 'not turned on yet', denied: 'blocked', 'old-app': 'need the newer phone app', unsupported: 'not supported by this browser',
};

function versionText(d, app) {
  const v = d.version;
  if (!v.current) return 'This copy has no version number.';
  if (!v.latest) return `${v.current} · couldn't reach GitHub to see the newest version`;
  if (!v.updateAvailable) return `${v.current} · the newest version`;
  const how = app || notify.onPhone()
    ? 'close Meridian fully (phone Settings › Apps › Meridian › Force stop), open it again and wait about 15 seconds'
    : d.host?.selfUpdate ? 'type UPDATE' : 'close Meridian and open it again from its icon';
  return `${v.current} · <span class="st-bad">${esc(v.latest)} is available</span>: ${how}`;
}

function hostText(d, app) {
  if (app) return `Android app (app file ${esc(app.apk || '?')}, Android ${esc(String(app.android || '?'))})`;
  if (notify.onPhone()) return 'Android app (first version of the app file)';
  const h = d.host;
  if (h?.kind === 'pc') return `${h.platform === 'win32' ? 'Windows PC' : h.platform === 'darwin' ? 'Mac' : 'this computer'}${h.lan ? ', also serving your phone on Wi-Fi' : ''}`;
  return 'this computer';
}

/** The plain-text report for the clipboard. No keys, no personal data. */
function report(d, mode, app) {
  const lines = [
    `Meridian status report, ${d.at}${d.mock ? ' (TEST DATA)' : ''}`,
    `Version: ${d.version.current || 'none'} (newest published: ${d.version.latest || 'unknown'})`,
    `Runs on: ${hostText(d, app).replace(/<[^>]+>/g, '')}${d.host?.node ? `, Node ${d.host.node}` : ''}`,
    `Browser: ${navigator.userAgent}`,
    `Data mode: ${mode === 'live' ? 'real data' : 'simulation'}`,
    `Keys: Finnhub ${d.keys.finnhub ? 'set' : 'not set'}, FRED ${d.keys.fred ? 'set' : 'not set'}, AISStream ${d.keys.ais ? 'set' : 'not set'}; SEC contact: ${d.keys.secContact ? 'your own' : 'Meridian default'}`,
    `Notifications: ${PERMISSION[notify.permission()] || notify.permission()}`,
    '',
    ...d.checks.map((c) => `${c.state === 'ok' ? '[OK]    ' : c.state === 'off' ? '[OFF]   ' : '[FAILED]'} ${c.name}: ${c.state === 'failed' ? `${typeof c.http === 'number' ? `HTTP ${c.http}` : c.http}: ${c.error}` : c.detail}${c.ms != null ? ` (${c.ms} ms)` : ''}`),
  ];
  if (app) {
    lines.push('', `Phone app: web files ${app.web || '?'} (in the app file: ${app.bundled || '?'})`,
      `Last update check: ${when(app.update?.at)}: ${app.update?.result || 'none yet'}`,
      `Background alerts: ${app.alerts?.job || 'unknown'}; ${app.alerts?.count ?? 0} waiting, last check ${when(app.alerts?.lastCheck)}: ${app.alerts?.lastResult || 'none yet'}, battery: ${app.battery || '?'}`);
  }
  if (d.host?.updateLog?.length) lines.push('', 'Updater log (last lines):', ...d.host.updateLog);
  return lines.join('\n');
}

register({
  code: 'STATUS', aliases: ['DIAG', 'HEALTH', 'SELFTEST', 'ABOUT'], name: 'Status & self-test', cat: 'System',
  help: 'STATUS — tests every data source now and shows each real answer; your version, API keys, notifications and updates',
  run(ctx) {
    const E = ctx.engine;
    const box = el('div', 'status-fn');
    ctx.el.appendChild(box);
    let gone = false;
    let last = null;

    const render = (d) => {
      const app = notify.appInfo();
      const tested = d.checks.filter((c) => c.state !== 'off');
      const bad = tested.filter((c) => c.state === 'failed');
      const perm = notify.permission();
      const head = [
        ['Version', versionText(d, app)],
        ['Runs on', hostText(d, app)],
        ['Data', E.mode === 'live' ? 'real' : 'simulation <span class="dim small">(MODE LIVE for real data)</span>'],
        ...(d.stale?.count ? [['Saved copies', d.stale.active ? `<span class="st-bad">Yahoo is refusing some requests: company figures are being shown from a saved copy (up to ${Math.max(1, Math.round(d.stale.oldestMs / 3600e3))} h old) for ${d.stale.count} request${d.stale.count === 1 ? '' : 's'} since Meridian started.</span>` : `<span class="dim">${d.stale.count} request${d.stale.count === 1 ? '' : 's'} were answered from a saved copy while Yahoo was refusing (last ${when(new Date(d.stale.lastAt).toISOString())}). Everything is live again now.</span>`]] : []),
        ['Finnhub key', d.keys.finnhub ? 'set' : '<span class="dim">not set (optional)</span>'],
        ['FRED key', d.keys.fred ? 'set' : '<span class="dim">not set (optional)</span>'],
        ['AISStream key', d.keys.ais ? 'set' : '<span class="dim">not set (optional; SHIPS then shows the Baltic only)</span>'],
        ['SEC contact', d.keys.secContact ? 'your own address (kept on this PC)' : '<span class="dim">Meridian default. If the SEC answers HTTP 403, set yours: <kbd>SECID your@email</kbd></span>'],
        ['Notifications', perm === 'granted' ? 'on' : `<span class="${perm === 'ask' ? 'dim' : 'st-bad'}">${PERMISSION[perm] || esc(perm)}</span>`],
      ];
      const rows = d.checks.map((c) => {
        const mark = c.state === 'ok' ? '<span class="st-ok">● OK</span>' : c.state === 'off' ? '<span class="dim">○ off</span>' : '<span class="st-bad">✕ FAILED</span>';
        const http = typeof c.http === 'number' ? `HTTP ${c.http}` : c.http === 'timeout' ? 'no answer (timeout)' : c.http === 'network' ? 'could not connect' : c.http === 'empty' ? 'empty answer' : '';
        const result = c.state === 'failed'
          ? `${http && !String(c.error).includes(http) ? `<b class="st-bad">${esc(http)}</b> ` : ''}<span class="st-bad">${esc(c.error)}</span>${c.ifFails ? `<br><span class="dim">${esc(c.ifFails)}</span>` : ''}`
          : c.state === 'off' ? `<span class="dim">${esc(c.detail)}</span>` : esc(c.detail);
        return `<tr><td class="l nw">${mark}</td><td class="l">${esc(c.name)}<br><span class="dim small">Used by: ${esc(c.used)}</span></td><td class="l wrap">${result}</td><td class="r dim nw">${c.ms != null ? `${c.ms} ms` : ''}</td></tr>`;
      }).join('');

      let phone = '';
      if (app) {
        phone = `<h3>Phone app</h3><div class="st-list">
          <div><span class="dim">Web files in use</span> ${esc(app.web || '?')} <span class="dim">(the app file contains ${esc(app.bundled || '?')})</span></div>
          <div><span class="dim">Last automatic update check</span> ${when(app.update?.at)}${app.update?.result ? `: ${esc(app.update.result)}` : ''}</div>
          <div><span class="dim">Background alert check</span> ${esc(app.alerts?.job || 'unknown')}</div>
          <div><span class="dim">Alerts waiting</span> ${app.alerts?.count ?? 0} · <span class="dim">last background check</span> ${when(app.alerts?.lastCheck)}${app.alerts?.lastResult ? `: ${esc(app.alerts.lastResult)}` : ''} <button class="tb" data-act="checknow">Check now</button></div>
          <div><span class="dim">Battery setting</span> ${app.battery === 'unrestricted' ? 'unrestricted (best for alerts)' : 'optimised: Android may delay background checks, sometimes by hours'} <button class="tb" data-act="battery">Open settings</button></div>
        </div>`;
      } else if (notify.onPhone()) {
        phone = `<h3>Phone app</h3><p class="note st-warn">This is the first version of the phone app. It can't show notifications or check alerts while it is closed. <a href="${notify.APP_PAGE}" target="_blank" rel="noopener noreferrer">Download the newer app</a>. The two were signed with different keys, so Android will refuse to install it over this one: uninstall this app first. That clears what is saved in the phone app (watchlist, added tickers, alerts, API keys).</p>`;
      }
      const noteLine = perm === 'ask' ? '<button class="tb" data-act="ask">Turn on notifications</button> for price alerts (<kbd>ALRT</kbd>).'
        : perm === 'granted' ? `<button class="tb" data-act="test">Send a test notification</button>${notify.onPhone() ? '' : ' Notifications appear while this Meridian window is open, also minimised; not after you close it.'}`
        : perm === 'denied' ? (notify.onPhone() ? 'Notifications are switched off for Meridian in the phone’s settings. <button class="tb" data-act="notif">Open settings</button>' : 'Notifications are blocked for Meridian in the browser. Allow them in the site permissions for this page to get price alerts outside the window.')
        : '';
      const log = d.host?.updateLog?.length ? `<details class="st-log"><summary>Updater log on this PC (last ${d.host.updateLog.length} lines)</summary><pre>${esc(d.host.updateLog.join('\n'))}</pre></details>`
        : d.host?.kind === 'pc' ? '<p class="note">Updater log: empty (the updater has not run from this folder yet).</p>' : '';

      box.innerHTML = `
        <div class="st-sum ${bad.length ? 'bad' : 'good'}">${bad.length
          ? `✕ ${bad.length} of ${tested.length} data sources failed: ${bad.map((c) => esc(c.name)).join(', ')}`
          : `✓ All ${tested.length} data sources that were tested answered.`}${d.mock ? ' <b>TEST DATA: these are not real sources.</b>' : ''}</div>
        <div class="port-head">${head.map(([a, b]) => `<div><span class="dim">${a}</span><b>${b}</b></div>`).join('')}</div>
        <div class="tbl-wrap"><table class="tbl st-tbl"><thead><tr><th class="l">Result</th><th class="l">Data source</th><th class="l">Answer just now</th><th class="r">Time</th></tr></thead><tbody>${rows}</tbody></table></div>
        ${noteLine ? `<p class="note">${noteLine}</p>` : ''}
        ${phone}
        ${log}
        <div class="val-add"><button class="tb" data-act="again">Test again</button> <button class="tb" data-act="copy">Copy report</button> <span class="dim small">Tested ${when(d.at)}. The report has no keys or personal data; paste it when asking for help.</span></div>
        <textarea class="st-report" hidden readonly></textarea>
        <p class="note">Each line is one fresh request made just now, not a saved result. "FAILED" with HTTP 403 or 429 means the source refused or is limiting requests: wait a few minutes and test again. Screens that depend on a failed source show its error themselves.</p>`;
    };

    const load = () => {
      box.innerHTML = '<div class="empty">Testing every data source (up to 30 seconds)…</div>';
      fetch('/api/diag', { cache: 'no-store' }).then(async (res) => {
        const d = await res.json().catch(() => null);
        if (!res.ok || !d?.checks) throw new Error(d?.error || `the server answered ${res.status}`);
        return d;
      }).then((d) => {
        if (gone) return;
        last = d;
        render(d);
      }).catch((err) => {
        if (!gone) box.innerHTML = `<div class="empty">The self-test couldn't run: ${esc(err.message)}. It needs Meridian's own server, which starts when you open Meridian from its icon.</div>`;
      });
    };

    box.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'again') return load();
      if (act === 'copy' && last) {
        const text = report(last, E.mode, notify.appInfo());
        try {
          await navigator.clipboard.writeText(text);
          ctx.app.toast('Report copied. Paste it where you ask for help.', 'ok');
        } catch {
          // no clipboard access (some phones): show the text to copy by hand
          const ta = box.querySelector('.st-report');
          ta.hidden = false;
          ta.value = text;
          ta.focus();
          ta.select();
          ctx.app.toast('Select the text below and copy it.');
        }
        return;
      }
      if (act === 'ask') await notify.request();
      else if (act === 'test') {
        if (!notify.show('test', 'Meridian test notification', 'Price alerts will look like this.')) ctx.app.toast('The notification could not be shown.', 'err');
        return;
      } else if (act === 'notif') return notify.openSettings('notifications');
      else if (act === 'battery') return notify.openSettings('battery');
      else if (act === 'checknow') {
        b.textContent = 'Checking…';
        const r = await notify.checkNow();
        ctx.app.toast(`Background alert check: ${r || 'no answer'}`);
      }
      if (!gone && last) render(last);
    });

    load();
    return { destroy: () => { gone = true; } };
  },
});
