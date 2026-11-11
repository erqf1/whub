'use strict';

// Herunterladen, prüfen und installieren. Immer nur über die offiziellen GitHub-Releases der Programme.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { spawn, execFile } = require('child_process');
const { net, shell, session } = require('electron');

// Große Dateien über mehrere Verbindungen gleichzeitig laden: eine einzelne Verbindung zu GitHub bricht
// zeitweise auf unter 1 MB/s ein, mehrere Range-Anfragen nebeneinander gleichen das aus.
const SEG = {
  min: 8 * 1024 * 1024, // ab dieser Größe parallel
  chunk: 4 * 1024 * 1024, // Stückgröße (Arbeit wird dynamisch verteilt, langsame Verbindungen holen weniger)
  conns: 6, // Verbindungen gleichzeitig (gemessen bei GitHub: 1 -> 23 MB/s, 4 -> 40 MB/s, 6 -> 53 MB/s)
  tries: 3, // Versuche je Stück
  tick: 250, // höchstens alle 250 ms eine Fortschrittsmeldung
};
const UA = { 'User-Agent': 'W-Hub' };
// Jede Verbindung bekommt eine eigene Sitzung im Speicher (eigener Socket-Pool): sonst legt Chromium alle
// Anfragen an denselben Host auf eine HTTP/2-Verbindung, und die ist ja gerade der Flaschenhals.
// Proxy und Zertifikate des Systems gelten trotzdem.
const sessions = [];
function fetcher(i) {
  if (i === 0) return net;
  if (!sessions[i]) sessions[i] = session.fromPartition(`whub-dl-${i}`, { cache: false });
  return sessions[i];
}
const err = (code, msg) => Object.assign(new Error(msg || code), { code });

/** Prüfsumme einer Datei auf der Platte */
async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file, { highWaterMark: 1024 * 1024 }), new Transform({
    transform(chunk, _enc, done) {
      hash.update(chunk);
      done();
    },
  }));
  return `sha256:${hash.digest('hex')}`;
}

/** Antwort-Körper in die Datei ab Position pos schreiben. Liefert die Zahl der Bytes. */
async function writeBody(res, fd, pos, limit, onBytes, signal) {
  let at = pos;
  for await (const chunk of Readable.fromWeb(res.body, { signal })) {
    let buf = chunk;
    if (limit != null && at - pos + buf.length > limit) buf = buf.subarray(0, limit - (at - pos));
    let off = 0;
    while (off < buf.length) {
      const { bytesWritten } = await fd.write(buf, off, buf.length - off, at);
      off += bytesWritten;
      at += bytesWritten;
    }
    onBytes(buf.length);
    if (limit != null && at - pos >= limit) break;
  }
  return at - pos;
}

/**
 * Datei laden, Fortschritt melden, abbrechbar über signal. Liefert "sha256:<hex>" (über die ganze Datei).
 * Große Dateien kommen in Stücken über mehrere Verbindungen (HTTP Range); kann der Server das nicht,
 * geht es mit der ersten Antwort am Stück weiter.
 */
async function download(url, file, total, onProgress, signal, opts = {}) {
  const cfg = { ...SEG, ...opts };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const part = `${file}.part`;
  // eigener Abbruch: ein Stück scheitert endgültig -> alle anderen Verbindungen sofort zu
  const ctrl = new AbortController();
  const stop = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) throw err('aborted', 'aborted');
    signal.addEventListener('abort', stop, { once: true });
  }
  let got = 0;
  let size = total || 0;
  let last = 0;
  const bytes = (n) => {
    got += n;
    const now = Date.now();
    if (now - last >= cfg.tick) {
      last = now;
      onProgress({ phase: 'download', got, total: size });
    }
  };
  const get = (headers, i = 0) => fetcher(i).fetch(url, { signal: ctrl.signal, headers: { ...UA, ...headers }, cache: 'no-store' });
  const fd = await fs.promises.open(part, 'w');
  let conns = 1;
  try {
    const parallel = size >= cfg.min && cfg.conns > 1;
    const first = await get(parallel ? { Range: `bytes=0-${cfg.chunk - 1}` } : {});
    if (!first.ok || !first.body) throw err('download', `HTTP ${first.status}`);
    const range = first.status === 206 && /^bytes 0-\d+\/(\d+)$/.exec(first.headers.get('content-range') || '');
    if (!range) {
      // am Stück (kleine Datei oder Server ohne Range)
      size = Number(first.headers.get('content-length')) || size;
      await writeBody(first, fd, 0, null, bytes, ctrl.signal);
    } else {
      size = Number(range[1]);
      if (total && size !== total) throw err('size');
      const chunks = [];
      for (let p = cfg.chunk; p < size; p += cfg.chunk) chunks.push([p, Math.min(size, p + cfg.chunk) - 1]);
      const firstLen = Math.min(cfg.chunk, size);
      const loadChunk = async ([a, b], slot) => {
        for (let attempt = 1; ; attempt++) {
          let counted = 0;
          const count = (n) => {
            counted += n;
            bytes(n);
          };
          try {
            const res = await get({ Range: `bytes=${a}-${b}` }, slot);
            if (res.status !== 206 || !res.body) throw err('download', `HTTP ${res.status}`);
            if (await writeBody(res, fd, a, b - a + 1, count, ctrl.signal) !== b - a + 1) throw err('download', 'short');
            return;
          } catch (e) {
            got -= counted; // dieses Stück zählt neu
            if (ctrl.signal.aborted || attempt >= cfg.tries) throw e;
            await new Promise((r) => setTimeout(r, 400 * attempt));
          }
        }
      };
      const worker = (slot) => async () => {
        while (chunks.length) await loadChunk(chunks.shift(), slot);
      };
      conns = Math.min(cfg.conns, chunks.length + 1);
      const jobs = [writeBody(first, fd, 0, firstLen, bytes, ctrl.signal).then((n) => {
        if (n !== firstLen) throw err('download', 'short');
      }).then(worker(0)), ...Array.from({ length: conns - 1 }, (_x, i) => worker(i + 1)())];
      // das erste Stück, das endgültig scheitert, ist der eigentliche Fehler; die anderen brechen nur mit ab
      let firstErr = null;
      await Promise.allSettled(jobs.map((j) => j.catch((e) => {
        firstErr ||= e;
        ctrl.abort();
      })));
      if (firstErr) throw firstErr;
    }
    await fd.close();
    if (total && got !== total) throw err('size');
    if (signal && signal.aborted) throw err('aborted', 'aborted');
  } catch (e) {
    ctrl.abort();
    await fd.close().catch(() => {});
    // abgebrochen oder kaputt: keine halbe Datei liegen lassen
    fs.rmSync(part, { force: true });
    throw e;
  } finally {
    if (signal) signal.removeEventListener('abort', stop);
  }
  onProgress({ phase: 'download', got, total: size || got });
  fs.renameSync(part, file);
  const digest = await sha256File(file);
  download.last = { conns, size };
  return digest;
}

/** Programm starten und auf das Ende warten. Liefert den Exit-Code.
 *  Die Befehlszeile wird wörtlich übergeben (windowsVerbatimArguments): NSIS liest /D= bis zum Zeilenende
 *  und darf keine Anführungszeichen bekommen, Inno will /DIR="..." mit Anführungszeichen. */
function runAndWait(exe, args) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(exe, args, { windowsHide: true, stdio: 'ignore', windowsVerbatimArguments: true, argv0: `"${exe}"` });
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

/** Startparameter für einen stillen Installer. dir = eigener Zielordner (sonst entscheidet der Installer) */
function installArgs(kind, existing, allUsers, dir) {
  const machine = existing ? !!existing.machine : !!allUsers;
  const clean = dir ? String(dir).replace(/"/g, '').replace(/[\\/]+$/, '') : '';
  if (kind === 'inno') return ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', '/CLOSEAPPLICATIONS', machine ? '/ALLUSERS' : '/CURRENTUSER', ...(clean ? [`/DIR="${clean}"`] : [])];
  // NSIS: /D= muss ganz am Ende stehen und darf keine Anführungszeichen haben (Leerzeichen sind erlaubt)
  if (kind === 'nsis') return ['/S', machine ? '/allusers' : '/currentuser', ...(clean ? [`/D=${clean}`] : [])];
  return [];
}

/** Liegt pfad im Ordner basis? (Groß-/Kleinschreibung egal, wie unter Windows) */
function isInside(p, base) {
  if (!p || !base) return false;
  const norm = (x) => path.resolve(String(x)).replace(/[\\/]+$/, '').toLowerCase();
  return norm(p) === norm(base) || norm(p).startsWith(`${norm(base)}${path.sep}`);
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
  // Teile mit Leerzeichen wieder in Anführungszeichen (die Befehlszeile geht wörtlich raus)
  args = args.map((a) => (/\s/.test(a) && !a.startsWith('"') ? `"${a}"` : a));
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

module.exports = { download, sha256File, SEG, runInstaller, installArgs, isInside, uninstall, splitCommand, startMenuShortcut, launch };
