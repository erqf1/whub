'use strict';

// Selbsttest des Hintergrundbetriebs (gestartet über tools/run-selftest.js mit --selftest-bg --autostart).
// Läuft auf Windows, Linux und macOS: W Hub startet wie beim Anmelden ohne Fenster, nur mit dem Symbol im
// Infobereich, prüft, spielt Updates still ein (laufende Programme später), und lädt große Dateien über
// mehrere Verbindungen. Dazu ein Testserver, der GitHub spielt und HTTP-Range kann.
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { app, BrowserWindow, webContents } = require('electron');

module.exports = async function selftestBg(_win, dir, hub) {
  const results = [];
  const ok = (name, cond, extra) => {
    results.push([!!cond, name]);
    console.log(`${cond ? 'OK  ' : 'FEHL'} ${name}${extra !== undefined && !cond ? ` -> ${JSON.stringify(extra)}` : ''}`);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 10000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try {
        const v = await fn();
        if (v) return v;
      } catch {
        // noch nicht so weit
      }
      await sleep(60);
    }
    return null;
  };
  const sha = (b) => `sha256:${crypto.createHash('sha256').update(b).digest('hex')}`;
  const win = process.platform === 'win32';

  // ---------------------------------------------------------------- Testserver: GitHub-API und Downloads mit Range
  const port = Number(process.env.WHUB_TEST_PORT);
  const base = `http://127.0.0.1:${port}`;
  const files = {};
  const addFile = (name, bytes) => {
    files[name] = bytes;
    return { name, size: bytes.length, browser_download_url: `${base}/dl/${encodeURIComponent(name)}`, digest: sha(bytes) };
  };
  const gsName = win ? 'GambelStrike2-v1.1.0-Windows.exe' : 'GambelStrike2-v1.1.0-offline.html';
  const gsBytes = Buffer.from(win ? 'MZ neue Version' : '<html>neue Version</html>');
  const RELEASES = {
    'erqf1/GambelStrike2': [{ tag_name: 'v1.1.0', name: 'v1.1.0', published_at: '2026-11-03T12:00:00Z', body: 'neu', html_url: 'https://x/', prerelease: false, draft: false, assets: [addFile(gsName, gsBytes)] }],
  };
  // große Dateien: big kann Range, plain nicht, flaky bricht die ersten Stück-Anfragen ab
  const big = crypto.randomBytes(20 * 1024 * 1024 + 12345);
  files['big.bin'] = big;
  files['plain.bin'] = big;
  files['flaky.bin'] = big;
  const mode = { apiCalls: 0, rate: 0, sockets: new Set(), open: 0, maxOpen: 0, ranges: 0, flaky: 0 };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, base);
    const m = /^\/repos\/([^/]+\/[^/]+)\/releases$/.exec(u.pathname);
    if (m) {
      mode.apiCalls++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(RELEASES[m[1]] || []));
    }
    const d = /^\/dl\/(.+)$/.exec(u.pathname);
    const name = d && decodeURIComponent(d[1]);
    if (!name || !files[name]) {
      res.writeHead(404);
      return res.end();
    }
    const bytes = files[name];
    mode.sockets.add(req.socket);
    mode.open++;
    mode.maxOpen = Math.max(mode.maxOpen, mode.open);
    let closed = false;
    const done = () => {
      if (!closed) {
        closed = true;
        mode.open--;
      }
    };
    res.on('finish', done);
    res.on('close', done);
    let a = 0;
    let b = bytes.length - 1;
    const r = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || '');
    const ranged = r && name !== 'plain.bin';
    if (ranged) {
      a = Number(r[1]);
      b = Math.min(Number(r[2]), bytes.length - 1);
      mode.ranges++;
      if (name === 'flaky.bin' && a > 0 && mode.flaky > 0) {
        mode.flaky--;
        return res.destroy();
      }
    }
    res.writeHead(ranged ? 206 : 200, { 'Content-Length': b - a + 1, ...(ranged ? { 'Content-Range': `bytes ${a}-${b}/${bytes.length}` } : {}) });
    if (!mode.rate) return res.end(bytes.subarray(a, b + 1));
    // gedrosselt: je Verbindung mode.rate Bytes pro Sekunde (wie eine lahme Einzelverbindung zu GitHub)
    let pos = a;
    const tick = () => {
      if (res.destroyed) return;
      if (pos > b) return res.end();
      const end = Math.min(b + 1, pos + Math.floor(mode.rate / 10));
      res.write(bytes.subarray(pos, end));
      pos = end;
      setTimeout(tick, 100);
    };
    return tick();
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));

  try {
    // ---------------------------------------------------------------- Start mit dem System: kein Fenster, nur Symbol
    ok('Kein Fenster beim Start mit dem System', BrowserWindow.getAllWindows().length === 0);
    ok('Keine Oberfläche (kein Renderer-Prozess)', webContents.getAllWebContents().length === 0 && !app.getAppMetrics().some((p) => p.type === 'Tab'), app.getAppMetrics().map((p) => p.type));
    ok('Symbol im Infobereich', !!hub.tray());
    ok('Ohne Fenster keine Grafikbeschleunigung (spart den GPU-Speicher)', /disabled|unavailable/.test(String(app.getGPUFeatureStatus().gpu_compositing)), app.getGPUFeatureStatus());
    const login = hub.loginItem();
    if (process.platform === 'linux') {
      const file = hub.autostartFile();
      const txt = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      ok('Linux: Autostart-Datei ~/.config/autostart/*.desktop', /^Exec=.*--autostart$/m.test(txt) && /^Type=Application$/m.test(txt) && /^Name=W Hub$/m.test(txt), txt);
    } else {
      ok('Anmeldeobjekt mit --autostart', login && login.openAtLogin === true && login.args.includes('--autostart'), login);
    }

    // ---------------------------------------------------------------- Prüfung beim Start, Auto-Update, laufendes Programm
    // GambelStrike 2 läuft gerade: wird nicht geschlossen, sondern übersprungen
    ok('Prüfung beim Start', await until(() => hub.state.checked > 0, 8000) && mode.apiCalls > 0);
    ok('Update erkannt (1.0.0 -> 1.1.0)', hub.state.installed.gamble && hub.state.installed.gamble.version === '1.0.0' && (hub.state.releases.gamble || []).length === 1, hub.state.installed.gamble);
    await sleep(300);
    ok('Laufendes Programm übersprungen (kein Job, nicht ersetzt)', !hub.state.jobs.gamble && !hub.queue.length && fs.readFileSync(hub.state.installed.gamble.exe, 'utf8') === 'alt');
    ok('Dafür Bescheid gegeben', hub.notes.some((n) => n.body.includes('GambelStrike 2 1.1.0')), hub.notes);
    // beendet: beim nächsten Versuch (hier nach 1,5 s statt 30 min) kommt das Update still
    fs.writeFileSync(path.join(dir, 'running.txt'), '');
    ok('Später erneut versucht und still aktualisiert', await until(() => hub.state.installed.gamble && hub.state.installed.gamble.version === '1.1.0', 10000), hub.state.installed.gamble);
    ok('Neue Datei liegt an alter Stelle', fs.readFileSync(hub.state.installed.gamble.exe).equals(gsBytes));
    ok('Meldung "aktualisiert"', await until(() => hub.notes.some((n) => n.title === 'Aktualisiert' && n.body.includes('1.1.0')), 3000), hub.notes);
    ok('Im Hintergrund keine Job-Reste', Object.keys(hub.state.jobs).length === 0, hub.state.jobs);

    // ---------------------------------------------------------------- Downloads über mehrere Verbindungen
    const dlDir = path.join(dir, 'dl');
    const target = path.join(dlDir, 'big.bin');
    const load = async (name, opts = {}, abortAfter = 0) => {
      Object.assign(mode, { sockets: new Set(), maxOpen: 0, ranges: 0 });
      let progress = 0;
      const ctrl = new AbortController();
      if (abortAfter) setTimeout(() => ctrl.abort(), abortAfter);
      const t0 = Date.now();
      try {
        const digest = await hub.setup.download(`${base}/dl/${name}`, target, big.length, () => progress++, ctrl.signal, opts);
        return { digest, progress, ms: Date.now() - t0, sockets: mode.sockets.size, ranges: mode.ranges };
      } catch (e) {
        return { error: e, msg: String(e && e.message), progress, ms: Date.now() - t0 };
      } finally {
        fs.rmSync(target, { force: true });
      }
    };
    mode.rate = 1024 * 1024; // 1 MB/s je Verbindung
    const one = await load('big.bin', { conns: 1 });
    const many = await load('big.bin');
    ok('Parallel: Prüfsumme über die ganze Datei stimmt', many.digest === sha(big), many);
    ok('Parallel: mehrere eigene Verbindungen', many.sockets >= 4 && many.ranges >= 5, many);
    ok('Parallel: deutlich schneller als eine Verbindung', many.ms * 2.5 < one.ms, { one: one.ms, many: many.ms });
    ok('Fortschritt sparsam (höchstens 4 Meldungen/s)', many.progress <= many.ms / 250 + 3 && one.progress <= one.ms / 250 + 3, { many: [many.progress, many.ms], one: [one.progress, one.ms] });
    console.log(`     gedrosselt 1 MB/s je Verbindung: eine ${(big.length / 1048576 / (one.ms / 1000)).toFixed(1)} MB/s, parallel ${(big.length / 1048576 / (many.ms / 1000)).toFixed(1)} MB/s`);
    mode.rate = 0;
    const plain = await load('plain.bin');
    ok('Server ohne Range: am Stück, Prüfsumme stimmt', plain.digest === sha(big) && plain.sockets === 1, plain);
    mode.flaky = 2;
    const flaky = await load('flaky.bin');
    ok('Abgebrochene Stücke werden neu geladen', flaky.digest === sha(big) && mode.flaky === 0, flaky);
    mode.flaky = 1000;
    const broken = await load('flaky.bin');
    ok('Dauerhaft kaputt: Fehler, keine Reste', !!broken.error && !fs.existsSync(`${target}.part`) && !fs.existsSync(target), broken.error && broken.error.message);
    mode.flaky = 0;
    mode.rate = 512 * 1024;
    const aborted = await load('big.bin', {}, 1200);
    ok('Abbrechen während paralleler Verbindungen: keine .part-Reste', !!aborted.error && aborted.ms < 4000 && !fs.existsSync(`${target}.part`) && !fs.existsSync(target), { ms: aborted.ms, err: aborted.error && aborted.error.message });
    await until(() => mode.open === 0, 3000);
    ok('Abbrechen: alle Verbindungen zu', mode.open === 0, mode.open);
    mode.rate = 0;

    // ---------------------------------------------------------------- Leerlauf messen (nur Hauptprozess + Hilfsprozesse)
    app.getAppMetrics();
    await sleep(3000);
    const metrics = app.getAppMetrics();
    const mb = metrics.reduce((s, p) => s + (p.memory.workingSetSize || 0), 0) / 1024;
    const cpu = metrics.reduce((s, p) => s + p.cpu.percentCPUUsage, 0);
    console.log(`     Leerlauf im Infobereich: ${mb.toFixed(0)} MB RAM (${metrics.map((p) => `${p.type} ${(p.memory.workingSetSize / 1024).toFixed(0)}`).join(', ')}), CPU ${cpu.toFixed(2)} %`);
    fs.writeFileSync(path.join(dir, 'leerlauf.json'), JSON.stringify({ mb, cpu, processes: metrics.map((p) => ({ type: p.type, mb: p.memory.workingSetSize / 1024, cpu: p.cpu.percentCPUUsage })) }, null, 1));
    ok('Leerlauf: wenig CPU', cpu < 5, cpu);

    // ---------------------------------------------------------------- Nach Updates suchen über das Symbol
    const before = hub.notes.length;
    await hub.trayCheck();
    ok('Symbol "Nach Updates suchen": meldet "Alles ist aktuell."', hub.notes.length === before + 1 && hub.notes[before].body === 'Alles ist aktuell.', hub.notes.slice(before));

    // ---------------------------------------------------------------- Öffnen aus dem Infobereich, X schließt nur das Fenster
    const w = hub.openWindow('updates');
    const js = (code) => w.webContents.executeJavaScript(code);
    ok('Öffnen: Fenster wird erst jetzt angelegt', !!w && BrowserWindow.getAllWindows().length === 1);
    ok('Oberfläche geladen, gleich auf "Updates"', await until(() => js(`window.__ready === true && window.__hub.view === 'updates'`), 20000));
    ok('Einstellung "Mit dem System starten" sichtbar', await until(async () => {
      await js(`document.querySelector('#settings-btn').click()`);
      return js(`[...document.querySelectorAll('.settings-dialog .toggle-row')].some(r => r.textContent.includes('Mit dem System starten')) && [...document.querySelectorAll('.settings-dialog .toggle-row')].some(r => r.textContent.includes('Beim Start alles automatisch aktualisieren'))`);
    }, 5000));
    const toggle = (label) => js(`(() => { const r = [...document.querySelectorAll('.settings-dialog .toggle-row')].find(r => r.textContent.includes(${JSON.stringify(label)})); const i = r.querySelector('input'); i.click(); return i.checked; })()`);
    ok('Ausschalten: Haken weg', (await toggle('Mit dem System starten')) === false);
    ok('Ausschalten: Symbol und Autostart weg', await until(() => !hub.tray(), 3000) && (process.platform === 'linux' ? !fs.existsSync(hub.autostartFile()) : hub.loginItem().openAtLogin === false), hub.loginItem());
    ok('Wieder einschalten', (await toggle('Mit dem System starten')) === true && (await until(() => !!hub.tray(), 3000)) && (process.platform === 'linux' ? fs.existsSync(hub.autostartFile()) : hub.loginItem().openAtLogin === true));
    w.close();
    await sleep(800);
    ok('X schließt nur das Fenster: W Hub läuft im Infobereich weiter', BrowserWindow.getAllWindows().length === 0 && !!hub.tray());
    const w2 = hub.openWindow();
    ok('Erneut öffnen geht', !!w2 && (await until(() => w2.webContents.executeJavaScript('window.__ready === true'), 20000)));
    w2.close();
  } catch (e) {
    ok(`Unerwarteter Fehler: ${e.stack || e.message}`, false);
  }
  server.close();
  const bad = results.filter(([r]) => !r);
  console.log(`\n${results.length - bad.length} von ${results.length} Prüfungen (Hintergrund) bestanden`);
  app.exit(bad.length ? 1 : 0);
};
