'use strict';

// Herunterladen, prüfen und installieren. Immer nur über die offiziellen GitHub-Releases der Programme.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { net, session, shell } = require('electron');

// Downloads: GitHub liefert die Release-Dateien über ein CDN, das jede einzelne Verbindung bremst
// (je nach Ort oft nur ein paar MB/s). Große Dateien lädt W Hub deshalb in Stücken über mehrere
// Verbindungen gleichzeitig (HTTP-Range), jede in einer eigenen Sitzung - sonst bündelt Chromium alles
// über HTTP/2 wieder in eine Verbindung. Kleine Dateien und Server ohne Range: wie bisher am Stück.
const CHUNK = 8 * 1024 * 1024; // Stückgröße (auch die erste Anfrage)
const LANES = 4; // Verbindungen gleichzeitig
const FLUSH = 1024 * 1024; // in 1-MB-Blöcken auf die Platte
const TRIES = 4; // je Stück, bei Verbindungsabbruch (geht dort weiter, wo es war)
const sessions = [];
function lane(i) {
  if (i === 0) return null; // Standardsitzung
  if (!sessions[i]) sessions[i] = session.fromPartition(`whub-dl-${i}`, { cache: false });
  return sessions[i];
}
const headers = (range) => ({ 'User-Agent': 'W-Hub', ...(range ? { Range: range } : {}) });
const fetchOn = (ses, url, range, signal) => (ses ? ses.fetch(url, { signal, headers: headers(range), cache: 'no-store' }) : net.fetch(url, { signal, headers: headers(range), cache: 'no-store' }));
const fail = (msg, code = 'download') => Object.assign(new Error(msg), { code });

/** Datei laden, Fortschritt melden, abbrechbar über signal. Liefert "sha256:<hex>". */
async function download(url, file, total, onProgress, signal) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const part = `${file}.part`;
  // eigenes Abbrechen: bricht ein Stück endgültig ab, hören auch alle anderen auf
  const stop = new AbortController();
  const onAbort = () => stop.abort(signal.reason);
  if (signal) {
    if (signal.aborted) throw fail('aborted', 'aborted');
    signal.addEventListener('abort', onAbort, { once: true });
  }
  let fh = null;
  let got = 0;
  let size = total || 0;
  let last = 0;
  const tick = (force) => {
    const now = Date.now();
    if (!force && now - last < 250) return;
    last = now;
    onProgress({ phase: 'download', got, total: size });
  };
  try {
    fh = await fs.promises.open(part, 'w');
    // Puffer sammeln und an die richtige Stelle schreiben
    const writer = (pos) => {
      let buf = [];
      let len = 0;
      return {
        get pos() {
          return pos + len;
        },
        async add(chunk) {
          buf.push(chunk);
          len += chunk.length;
          if (len >= FLUSH) await this.flush();
        },
        async flush() {
          if (!len) return;
          const data = buf.length === 1 ? buf[0] : Buffer.concat(buf, len);
          buf = [];
          let off = 0;
          while (off < data.length) off += (await fh.write(data, off, data.length - off, pos + off)).bytesWritten;
          pos += len;
          len = 0;
        },
      };
    };
    const first = await fetchOn(null, url, `bytes=0-${CHUNK - 1}`, stop.signal);
    if (!first.ok || !first.body) throw fail(`HTTP ${first.status}`);
    const range = first.status === 206 && /^bytes 0-(\d+)\/(\d+)$/.exec(first.headers.get('content-range') || '');
    let hash = null;
    if (!range) {
      // Server kann keine Stücke: am Stück laden, Prüfsumme gleich mitrechnen
      size = Number(first.headers.get('content-length')) || total || 0;
      hash = crypto.createHash('sha256');
      const w = writer(0);
      for await (const c of first.body) {
        const b = Buffer.from(c.buffer, c.byteOffset, c.byteLength);
        hash.update(b);
        got += b.length;
        await w.add(b);
        tick();
      }
      await w.flush();
    } else {
      size = Number(range[2]);
      if (total && size !== total) throw fail('size', 'size');
      // die erste Antwort ist schon Stück 0; danach holt sich jede Verbindung das nächste freie Stück
      const finalUrl = first.url || url;
      let next = Number(range[1]) + 1;
      const take = () => {
        if (next >= size) return null;
        const a = next;
        next = Math.min(size, a + CHUNK);
        return [a, next - 1];
      };
      const pull = async (body, a, b) => {
        const w = writer(a);
        try {
          for await (const c of body) {
            const buf = Buffer.from(c.buffer, c.byteOffset, c.byteLength);
            const room = b + 1 - w.pos;
            if (room <= 0) break;
            const piece = buf.length > room ? buf.subarray(0, room) : buf;
            got += piece.length;
            await w.add(piece);
            tick();
          }
        } finally {
          await w.flush();
        }
        return w.pos;
      };
      const piece = async (ses, a, b, body) => {
        let pos = a;
        for (let i = 0; ; i++) {
          try {
            if (!body) {
              // erst die schon aufgelöste Adresse, beim Wiederholen wieder über github.com (Links laufen ab)
              const res = await fetchOn(ses, i ? url : finalUrl, `bytes=${pos}-${b}`, stop.signal);
              if (res.status !== 206 || !res.body) throw fail(`HTTP ${res.status}`);
              body = res.body;
            }
            pos = await pull(body, pos, b);
            body = null;
            if (pos > b) return;
            throw fail('short');
          } catch (e) {
            body = null;
            if (stop.signal.aborted || i + 1 >= TRIES) throw e;
            await new Promise((r) => setTimeout(r, 400 * (i + 1)));
          }
        }
      };
      const run = async (i, start) => {
        if (start) await piece(lane(i), start[0], start[1], start[2]);
        for (let p = take(); p; p = take()) await piece(lane(i), p[0], p[1]);
      };
      const lanes = Math.max(1, Math.min(LANES, Math.ceil((size - next) / CHUNK) + 1));
      const jobs = [run(0, [0, Number(range[1]), first.body])];
      for (let i = 1; i < lanes; i++) jobs.push(run(i));
      // schlägt eine Verbindung endgültig fehl, alle anderen abbrechen - und warten, bis wirklich keine mehr schreibt
      let bad = null;
      await Promise.allSettled(jobs.map((j) => j.catch((e) => {
        bad ||= e;
        stop.abort(e);
      })));
      if (bad) throw signal && signal.aborted ? signal.reason || bad : bad;
    }
    if (total && got !== total) throw fail('size', 'size');
    if (size && got !== size) throw fail('size', 'size');
    await fh.close();
    fh = null;
    tick(true);
    if (!hash) {
      // Prüfsumme über die ganze fertige Datei
      hash = crypto.createHash('sha256');
      for await (const c of fs.createReadStream(part, { highWaterMark: FLUSH })) hash.update(c);
    }
    fs.renameSync(part, file);
    return `sha256:${hash.digest('hex')}`;
  } catch (e) {
    // abgebrochen oder kaputt: keine halbe Datei liegen lassen
    stop.abort(e);
    if (fh) await fh.close().catch(() => {});
    fs.rmSync(part, { force: true });
    throw e;
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort);
  }
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

module.exports = { download, runInstaller, installArgs, isInside, uninstall, splitCommand, startMenuShortcut, launch };
