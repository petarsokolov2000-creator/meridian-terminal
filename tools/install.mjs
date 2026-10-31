/* Windows setup and update for Meridian. Copies the program to its own home,
   %LOCALAPPDATA%\Meridian\app (so the downloaded folder can be deleted), keeping any API
   keys, settings and cache already there; builds Meridian.exe (a small launcher, compiled
   with the C# compiler that ships with Windows); and puts "Meridian" on the Desktop and in
   the Start menu, plus "Meridian (phone access)" in the Start menu. Nothing is downloaded.
   Run by "Install Meridian.cmd". Running a newer copy's installer is how you update. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ico } from './icon.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(HERE, '..');

if (process.platform !== 'win32') {
  console.log('This installer is for Windows. Elsewhere, run: node serve.mjs --open');
  process.exit(0);
}

const ROOT = path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || SOURCE, 'AppData', 'Local'), 'Meridian', 'app');
const EXE = path.join(ROOT, 'Meridian.exe');
const ICO = path.join(ROOT, 'Meridian.ico');
// Files that belong to this PC, not to the program: never overwritten by an update.
const LOCAL = new Set(['.cache', '.finnhub-key', '.fred-key', '.access-key', 'Meridian.exe', 'Meridian.exe.old', 'Meridian.ico']);

// Meridian must be closed: its files (and Meridian.exe) are in use while it runs.
async function running() {
  try {
    const res = await fetch('http://127.0.0.1:8173/api/status', { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}
// A running Meridian (possibly one an older launcher left in the background) would block the
// update: close it, newest servers politely, older ones by ending the process on our port.
async function stopRunning() {
  try {
    await fetch('http://127.0.0.1:8173/api/shutdown', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(2000) });
  } catch {
    // older servers have no shutdown route
  }
  const settle = async () => {
    for (let i = 0; i < 16 && (await running()); i++) await new Promise((r) => setTimeout(r, 250));
  };
  await settle();
  if (await running()) {
    try {
      const lines = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' }).split(/\r?\n/);
      for (const line of lines) {
        const f = line.trim().split(/\s+/);
        if (f.length >= 5 && f[1].endsWith(':8173') && f[3] === 'LISTENING') {
          const who = execFileSync('tasklist', ['/FI', `PID eq ${f[4]}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
          if (/^"node\.exe"/i.test(who.trim())) execFileSync('taskkill', ['/PID', f[4], '/F'], { stdio: 'ignore' });
        }
      }
    } catch {
      // nothing more we can do; reported below
    }
    await settle();
  }
  // Meridian's own browser windows, including ones Edge kept alive in the background.
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe' OR Name='chrome.exe'\" | Where-Object { $_.CommandLine -like '*\\Meridian\\profile*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"], { stdio: 'ignore' });
  } catch {
    // no such windows
  }
}
if (await running()) {
  console.log('Closing the running Meridian so it can be updated...');
  await stopRunning();
  if (await running()) {
    console.error('Meridian is still running and could not be closed. Restart the PC, then run the installer again.');
    process.exit(1);
  }
}

const csc = [
  'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
  'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
].find((p) => fs.existsSync(p));
if (!csc) {
  console.error('Could not find the C# compiler that ships with Windows (.NET Framework 4).');
  console.error('You can still start Meridian with "Start Meridian.cmd".');
  process.exit(1);
}

const updating = fs.existsSync(path.join(ROOT, 'serve.mjs'));
if (SOURCE.toLowerCase() !== ROOT.toLowerCase()) {
  console.log(`1/4  ${updating ? 'Updating' : 'Copying'} Meridian in ${ROOT}...`);
  fs.mkdirSync(ROOT, { recursive: true });
  // Drop the old program files (keeping this PC's keys, cache and settings), then copy the new.
  for (const name of fs.readdirSync(ROOT)) if (!LOCAL.has(name)) fs.rmSync(path.join(ROOT, name), { recursive: true, force: true });
  for (const name of fs.readdirSync(SOURCE)) {
    const from = path.join(SOURCE, name);
    const to = path.join(ROOT, name);
    if (LOCAL.has(name)) {
      // A key typed while running from the download folder moves along, unless one is already set.
      if (name.endsWith('-key') && !fs.existsSync(to)) fs.copyFileSync(from, to);
      continue;
    }
    fs.cpSync(from, to, { recursive: true });
  }
} else {
  console.log('1/4  Meridian is already in place.');
}

console.log('2/4  Drawing the icon...');
fs.writeFileSync(ICO, ico());

console.log('3/4  Building Meridian.exe...');
// Left over from the last update (Windows can't delete a running exe, only rename it).
try {
  fs.rmSync(`${EXE}.old`, { force: true });
} catch {
  // still in use: removed next time
}
try {
  // A running Meridian.exe can't be overwritten; ask the user to close it first.
  if (fs.existsSync(EXE)) fs.renameSync(EXE, `${EXE}.old`);
} catch {
  console.error('Meridian is open. Close its window, then run the installer again.');
  process.exit(1);
}
try {
  execFileSync(csc, [
    '/nologo', '/target:winexe', '/optimize+', `/out:${EXE}`, `/win32icon:${ICO}`,
    '/reference:System.dll', '/reference:System.Core.dll', '/reference:System.Windows.Forms.dll', '/reference:System.Management.dll',
    path.join(ROOT, 'tools', 'Launcher.cs'),
  ], { stdio: 'inherit' });
  try {
    fs.rmSync(`${EXE}.old`, { force: true });
  } catch {
    // the launcher that started this update is still running from it
  }
} catch (err) {
  if (fs.existsSync(`${EXE}.old`)) fs.renameSync(`${EXE}.old`, EXE);
  console.error(`Building Meridian.exe failed: ${err.message}`);
  process.exit(1);
}

console.log('4/4  Adding shortcuts...');
// PowerShell's WScript.Shell creates .lnk files; the script goes in base64 to avoid quoting
// trouble with spaces or apostrophes in folder names.
const q = (s) => `'${s.replace(/'/g, "''")}'`;
const ps = `
$ErrorActionPreference = 'Stop'
$sh = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$start = Join-Path ([Environment]::GetFolderPath('Programs')) 'Meridian'
New-Item -ItemType Directory -Force -Path $start | Out-Null
function Link($file, $arguments, $desc) {
  $l = $sh.CreateShortcut($file)
  $l.TargetPath = ${q(EXE)}
  $l.Arguments = $arguments
  $l.WorkingDirectory = ${q(ROOT)}
  $l.IconLocation = ${q(ICO)}
  $l.Description = $desc
  $l.Save()
}
Link (Join-Path $desktop 'Meridian.lnk') '' 'Meridian market terminal'
Link (Join-Path $start 'Meridian.lnk') '' 'Meridian market terminal'
Link (Join-Path $start 'Meridian (phone access).lnk') '--lan' 'Meridian, also reachable from your phone on the same Wi-Fi'
Write-Output $desktop
`;
let desktop = 'your Desktop';
try {
  desktop = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { encoding: 'utf8' }).trim() || desktop;
} catch (err) {
  console.error(`Couldn't create the shortcuts (${err.message.split('\n')[0]}).`);
  console.error(`Meridian.exe is built: double-click it in ${ROOT}, or right-click it > Send to > Desktop.`);
  process.exit(1);
}

console.log(`
${updating ? 'Updated' : 'Installed'}. Open Meridian from the icon on ${desktop} or from the Start menu.
  - "Meridian" opens the terminal in its own window; closing the window stops it.
  - "Meridian (phone access)" (Start menu) also shows an address for your phone.
Meridian now lives in ${ROOT}${SOURCE.toLowerCase() !== ROOT.toLowerCase() ? `,
so you can delete the folder you ran this from (${SOURCE}).` : '.'}
To update later: get the new version and run its "Install Meridian.cmd"; your keys and settings stay.`);
