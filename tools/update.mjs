/* Update check and download for Meridian, run by the launcher (Meridian.exe).
     node tools/update.mjs check   prints two lines: the installed version, then the newest
                                   published one (or "error: <reason>")
     node tools/update.mjs apply   downloads the newest version, unpacks it and runs its
                                   installer (which keeps keys, settings and cache)
   Every run is logged to .cache/update.log, so a failed update is never silent. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'petarsokolov2000-creator/meridian-terminal';
const LOG = path.join(ROOT, '.cache', 'update.log');

function log(msg) {
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, `${new Date().toISOString()}  ${msg}\n`);
  } catch {
    // logging must never break an update
  }
}

function current() {
  try {
    return fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim();
  } catch {
    return '';
  }
}

async function latest() {
  // The query string skips GitHub's few-minute cache, so a new release shows up at once.
  const res = await fetch(`https://raw.githubusercontent.com/${REPO}/main/VERSION?t=${Date.now()}`, { signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'Meridian' } });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const v = (await res.text()).trim();
  if (!v || v.length > 40) throw new Error('GitHub returned no version number');
  return v;
}

async function apply() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meridian-update-'));
  try {
    const res = await fetch(`https://codeload.github.com/${REPO}/zip/refs/heads/main`, { signal: AbortSignal.timeout(120000), headers: { 'user-agent': 'Meridian' } });
    if (!res.ok) throw new Error(`download failed: GitHub answered ${res.status}`);
    const zip = path.join(tmp, 'meridian.zip');
    fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
    log(`downloaded ${fs.statSync(zip).size} bytes`);
    // Windows 10 and 11 ship tar.exe, which unpacks .zip; PowerShell is the fallback.
    const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    let r = fs.existsSync(tar) ? spawnSync(tar, ['-xf', zip, '-C', tmp], { encoding: 'utf8' }) : { status: 1 };
    if (r.status !== 0) {
      r = spawnSync('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${tmp.replace(/'/g, "''")}' -Force`], { encoding: 'utf8' });
    }
    const src = fs.readdirSync(tmp).map((d) => path.join(tmp, d)).find((d) => fs.existsSync(path.join(d, 'tools', 'install.mjs')));
    if (r.status !== 0 || !src) throw new Error(`couldn't unpack the download ${r.stderr || ''}`.trim());
    const inst = spawnSync(process.execPath, [path.join(src, 'tools', 'install.mjs')], { cwd: src, encoding: 'utf8' });
    log(`installer exit ${inst.status}\n${inst.stdout || ''}${inst.stderr || ''}`);
    if (inst.status !== 0) throw new Error((inst.stderr || inst.stdout || 'the installer failed').trim().split('\n').slice(-6).join('\n'));
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // a temp folder Windows cleans up eventually
    }
  }
}

const cmd = process.argv[2];
try {
  if (cmd === 'check') {
    const cur = current();
    const v = await latest();
    log(`check: installed ${cur || 'none'}, published ${v}`);
    console.log(cur);
    console.log(v);
  } else if (cmd === 'apply') {
    log(`apply: from ${current() || 'none'}`);
    await apply();
    log('apply: done');
    console.log('ok');
  } else {
    console.error('usage: node tools/update.mjs check|apply');
    process.exit(2);
  }
} catch (err) {
  log(`${cmd}: ${err.message}`);
  if (cmd === 'check') {
    console.log(current());
    console.log(`error: ${err.message}`);
  } else {
    console.error(err.message);
    process.exit(1);
  }
}
