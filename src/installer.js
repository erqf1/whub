'use strict';

// Herunterladen, prüfen und installieren. Immer nur über die offiziellen GitHub-Releases der Programme.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { spawn, execFile } = require('child_process');
const { net, shell } = require('electron');

/** Datei laden, Fortschritt melden, abbrechbar über signal. Liefert "sha256:<hex>". */
async function download(url, file, total, onProgress, signal) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const part = `${file}.part`;
  const res = await net.fetch(url, { signal, headers: { 'User-Agent': 'W-Hub' }, cache: 'no-store' });
  if (!res.ok || !res.body) throw Object.assign(new Error(`HTTP ${res.status}`), { code: 'download' });
  const size = Number(res.headers.get('content-length')) || total || 0;
  const hash = crypto.createHash('sha256');
  let got = 0;
  let last = 0;
  const count = new Transform({
    transform(chunk, _enc, done) {
      got += chunk.length;
      hash.update(chunk);
      const now = Date.now();
      if (now - last > 120) {
        last = now;
        onProgress({ phase: 'download', got, total: size });
      }
      done(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(res.body), count, fs.createWriteStream(part), { signal });
    if (total && got !== total) throw Object.assign(new Error('size'), { code: 'size' });
  } catch (e) {
    // abgebrochen oder kaputt: keine halbe Datei liegen lassen
    fs.rmSync(part, { force: true });
    throw e;
  }
  onProgress({ phase: 'download', got, total: size || got });
  fs.renameSync(part, file);
  return `sha256:${hash.digest('hex')}`;
}

/** Programm starten und auf das Ende warten. Liefert den Exit-Code. */
function runAndWait(exe, args) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(exe, args, { windowsHide: true, stdio: 'ignore' });
    } catch (e) {
      reject(e);
      return;
    }
    child.on('error', reject);
    child.on('exit', (code) => resolve(code == null ? -1 : code));
  });
}

/** Wie runAndWait, aber mit Administratorrechten (Windows fragt per UAC nach). */
function runElevated(exe, args) {
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const ps = `$p = Start-Process -FilePath ${q(exe)} -ArgumentList ${args.length ? args.map(q).join(',') : "''"} -Verb RunAs -Wait -PassThru; exit $p.ExitCode`;
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { windowsHide: true }, (err) => {
      resolve(err ? (typeof err.code === 'number' ? err.code : -1) : 0);
    });
  });
}

async function runInstaller(exe, args) {
  try {
    const code = await runAndWait(exe, args);
    // 740 = braucht Administratorrechte: noch einmal mit UAC
    if (code === 740) return runElevated(exe, args);
    return code;
  } catch (e) {
    if (e && (e.code === 'EACCES' || e.errno === -4092 || /740/.test(String(e.message)))) return runElevated(exe, args);
    throw e;
  }
}

/** Startparameter für einen stillen Installer */
function installArgs(kind, existing, allUsers) {
  const machine = existing ? !!existing.machine : !!allUsers;
  if (kind === 'inno') return ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', '/CLOSEAPPLICATIONS', machine ? '/ALLUSERS' : '/CURRENTUSER'];
  if (kind === 'nsis') return ['/S', machine ? '/allusers' : '/currentuser'];
  return [];
}

/** Befehlszeile aus der Registry in Programm und Parameter zerlegen */
function splitCommand(cmd) {
  const s = String(cmd || '').trim();
  const m = s.startsWith('"') ? /^"([^"]+)"\s*(.*)$/.exec(s) : /^(\S+)\s*(.*)$/.exec(s);
  if (!m) return null;
  const args = (m[2].match(/"[^"]*"|\S+/g) || []).map((a) => a.replace(/^"|"$/g, ''));
  return { exe: m[1], args };
}

/** Deinstallieren: still, Inno ohne Fortschrittsfenster */
async function uninstall(kind, cmd) {
  const c = splitCommand(cmd);
  if (!c) throw Object.assign(new Error('no uninstaller'), { code: 'uninstall' });
  let args = c.args;
  if (kind === 'inno') args = [...args.filter((a) => !/^\/(SILENT|VERYSILENT)$/i.test(a)), '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'];
  if (kind === 'nsis' && !args.some((a) => a === '/S')) args = [...args, '/S'];
  return runInstaller(c.exe, args);
}

/** Verknüpfung im Startmenü (nur Windows) */
function startMenuShortcut(appData, name, target) {
  if (process.platform !== 'win32' || process.env.WHUB_NO_SHORTCUTS) return '';
  const dir = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  const lnk = path.join(dir, `${name}.lnk`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    shell.writeShortcutLink(lnk, 'create', { target, cwd: path.dirname(target), description: name, icon: target, iconIndex: 0 });
    return lnk;
  } catch {
    return '';
  }
}

/** Programm öffnen, ohne auf das Ende zu warten */
function launch(exe) {
  if (!exe) return false;
  if (process.platform === 'linux' && !exe.includes('/')) {
    spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
    return true;
  }
  if (process.platform === 'darwin') {
    spawn('open', [exe], { detached: true, stdio: 'ignore' }).unref();
    return true;
  }
  if (!fs.existsSync(exe)) return false;
  const child = spawn(exe, [], { detached: true, stdio: 'ignore', cwd: path.dirname(exe) });
  child.on('error', () => {});
  child.unref();
  return true;
}

module.exports = { download, runInstaller, installArgs, uninstall, splitCommand, startMenuShortcut, launch };
