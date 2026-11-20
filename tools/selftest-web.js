'use strict';

// Selbsttest der Web-Programme (gestartet über tools/run-selftest.js mit --selftest-web, unsichtbar, alle Systeme).
// Ein lokaler Mini-Server spielt mert.win samt Zugangsschutz (ohne Cookie w_zugang=w: 403) und ein CDN.
// Geprüft wird: Build-Skript (online und ohne Server), Laden aller Dateien (HTML/CSS/JS/Manifest/Service-Worker-
// Listen, absolute Pfade wie /app-icons/…), Ausliefern über whub-web:// offline, CDN-Bibliotheken offline,
// Weiterleiten nicht gespeicherter Pfade online mit Cookie, Updates (ETag/Last-Modified, 304, Prüfsumme),
// neue Programme ("soon"), abgelehnter Zugang, Offline-Abgleich, Oberfläche und eigener Speicher je Programm.
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { app, BrowserWindow, session, protocol } = require('electron');
const W = require('../src/webapps');

module.exports = async function selftestWeb(win, dir, hub) {
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
  const js = (code) => win.webContents.executeJavaScript(code);

  // ---------------------------------------------------------------- Mini-mert.win
  const port = Number(process.env.WHUB_TEST_PORT);
  const base = `http://127.0.0.1:${port}`;
  const LM = 'Sat, 14 Nov 2026 22:57:54 GMT';
  const site = {
    '/app-icons/acryl.css': ':root{--acryl:1}body{background:url(/app-icons/acryl/ocean.webp) no-repeat}.marker{width:123px}',
    '/app-icons/acryl/ocean.webp': 'WEBP-ocean',
    '/app-icons/mobile.css': '@import url("/app-icons/print.css");',
    '/app-icons/print.css': '.p{}',
    '/qr/': `<!doctype html><html><head><meta charset="utf-8"><title>QR-Codes – mert.win</title>
<link rel="icon" href="/app-icons/qr-192.png"><link rel="manifest" href="/qr/app.webmanifest">
<link rel="stylesheet" href="qr.css"><link rel="stylesheet" href="/app-icons/acryl.css"><link rel="stylesheet" href="/app-icons/mobile.css">
</head><body><div class="marker" id="m"></div><a href="/help/">Alle Apps</a><script src="qr.js"></script></body></html>`,
    '/qr/qr.css': '.x{background:url("img/dot.svg")}',
    '/qr/img/dot.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
    '/qr/qr.js': `window.QR_VERSION = 1;
const LIB = 'https://cdn.jsdelivr.net/npm/fake-qr@1.2.3/lib/fake-qr.js';
const s = document.createElement('script'); s.src = LIB; document.head.append(s);
window.shareApi = () => fetch('/share/api?x=1').then((r) => r.json());`,
    '/qr/app.webmanifest': JSON.stringify({ icons: [{ src: '/app-icons/qr-512.png' }] }),
    '/qr/app-sw.js': 'const CORE = ["./", "qr.css", "extra/help.txt"];',
    '/qr/extra/help.txt': 'Hilfe',
    '/app-icons/qr-192.png': 'PNG-qr-192',
    '/app-icons/qr-512.png': 'PNG-qr-512',
    '/_cdn/cdn.jsdelivr.net/npm/fake-qr@1.2.3/lib/fake-qr.js': 'window.fakeQr = true;',
    '/skin/': `<!doctype html><html><head><meta charset="utf-8"><title>Skin-Editor</title><link rel="stylesheet" href="/app-icons/acryl.css"></head>
<body><script type="module" src="js/app.js"></script></body></html>`,
    '/skin/js/app.js': `import { model } from './model.js';
const steve = new URL('../img/steve.png', import.meta.url);
window.SKIN = model;
fetch('data/parts.json').then((r) => r.json()).then((d) => { window.PARTS = d.n; });
fetch(steve).then((r) => r.text()).then((t) => { window.STEVE = t; });`,
    '/skin/js/model.js': "export const model = 'steve';",
    '/skin/img/steve.png': 'PNG-steve',
    '/skin/data/parts.json': '{"n": 12}',
    '/app-icons/skin-192.png': 'PNG-skin',
    '/hintergrund/': '<!doctype html><title>Hintergrund</title><script src="bg.js"></script>',
    '/hintergrund/bg.js': "window.BG = 1; const T = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/';",
    '/app-icons/bg-192.png': 'PNG-bg',
    '/mc/': '<!doctype html><title>MC</title><script src="js/core.js"></script>',
    '/mc/js/core.js': 'window.MC = 1;',
    '/app-icons/mc-192.png': 'PNG-mc',
    '/periodensystem/': '<!doctype html><title>PSE</title><script src="elements.js"></script>',
    '/periodensystem/elements.js': 'window.ELEMENTS = 118;',
    '/app-icons/pse-192.png': 'PNG-pse',
    '/web/': `<!doctype html><title>Webgames</title><link rel="icon" href="shared/icon.svg">
<script>var GAMES = [['snake', 'Snake']]; var idx = ''; document.write('<a href="' + GAMES[0][0] + '/' + idx + '">x</a>');</script>`,
    '/web/app-sw.js': 'const CORE = ["./", "shared/kit.js", "shared/icon.svg", "snake/"];',
    '/web/shared/kit.js': 'window.KIT = 1;',
    '/web/shared/icon.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
    '/web/snake/': '<!doctype html><title>Snake</title><script src="../shared/kit.js"></script><script src="game.js"></script>',
    '/web/snake/game.js': "window.SNAKE = 1; fetch('/app-icons/web-192.png').then((r) => { window.ICON_OK = r.ok; });",
    '/app-icons/web-192.png': 'PNG-web',
    '/help/': '<!doctype html><title>Hilfe online</title>',
    '/share/api': null, // dynamisch
  };
  const etag = (body) => `"${crypto.createHash('md5').update(body).digest('hex')}"`;
  const srv = { down: false, cookie: 'w_zugang=w', hits: {}, n304: 0, conditional: 0, noCookie: 0, cdnCookie: false, lastShareCookie: null };
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    if (srv.down) return req.socket.destroy();
    const u = new URL(req.url, base);
    const p = decodeURIComponent(u.pathname);
    srv.hits[p] = (srv.hits[p] || 0) + 1;
    if (/^\/repos\//.test(p)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('[]');
    }
    if (p.startsWith('/_cdn/')) {
      if (req.headers.cookie) srv.cdnCookie = true;
    } else if (!String(req.headers.cookie || '').split(/;\s*/).includes(srv.cookie)) {
      // wie nginx auf mert.win: ohne Zugangs-Cookie kein Inhalt
      srv.noCookie++;
      res.writeHead(403, { 'Content-Type': 'text/html' });
      return res.end('<h1>Zugangscode</h1>');
    }
    if (p === '/share/api') {
      srv.lastShareCookie = req.headers.cookie;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ online: true, q: u.search }));
    }
    // Ordner ohne Schrägstrich: wie nginx umleiten
    if (site[`${p}/`] !== undefined && site[p] === undefined) {
      res.writeHead(301, { Location: `${p}/` });
      return res.end();
    }
    const body = site[p];
    if (body == null) {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      return res.end('<h1>404</h1>');
    }
    const tag = etag(body);
    const type = p.endsWith('/') ? 'text/html' : W.typeOf(p);
    if (req.headers['if-none-match'] || req.headers['if-modified-since']) srv.conditional++;
    if (req.headers['if-none-match'] === tag) {
      srv.n304++;
      res.writeHead(304, { ETag: tag, 'Last-Modified': LM });
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': type, ETag: tag, 'Last-Modified': LM, 'Cache-Control': 'no-store' });
    res.end(body);
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const goDown = () => {
    srv.down = true;
    for (const s of sockets) s.destroy();
  };
  const goUp = () => {
    srv.down = false;
  };
  const get = (p, headers = {}) => new Promise((resolve) => {
    http.get(`${base}${p}`, { headers }, (r) => {
      let b = '';
      r.on('data', (c) => (b += c));
      r.on('end', () => resolve({ status: r.statusCode, body: b }));
    }).on('error', () => resolve({ status: 0, body: '' }));
  });

  const web = hub.web();
  const builtin = process.env.WHUB_WEB_BUILTIN;
  const userDir = path.join(dir, 'userdata', 'webapps');
  const st = () => web.status().apps;
  // Build-Skript als eigener Node-Prozess (nicht blockierend: der Testserver läuft in diesem Prozess)
  const nodeRun = (args) => new Promise((resolve) => {
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', GITHUB_ACTIONS: '' };
    for (const k of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NODE_OPTIONS']) delete env[k];
    const c = spawn(process.execPath, [path.join(__dirname, 'fetch-webapps.js'), ...args], { env, windowsHide: true });
    let stdout = '';
    let stderr = '';
    c.stdout.on('data', (d) => (stdout += d));
    c.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => c.kill(), 120000);
    c.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });

  try {
    ok('Oberfläche bereit', await until(() => js('window.__ready === true'), 30000));
    await js(`window.__hub.setSetting('language', 'de')`);

    // ---------------------------------------------------------------- Zugangsschutz wie auf mert.win
    ok('Server: ohne Cookie 403', (await get('/qr/')).status === 403);
    ok('Server: mit Cookie 200', (await get('/qr/', { Cookie: 'w_zugang=w' })).status === 200);
    let denied = null;
    try {
      await W.crawl({ id: 'qr', root: '/qr/' }, { origin: base, fetch: (u, i) => fetch(u, { ...i, headers: { ...i.headers, Cookie: 'w_zugang=falsch' } }) });
    } catch (e) {
      denied = e.code;
    }
    ok('Laden mit falschem Code: Zugang abgelehnt', denied === 'access', denied);

    // ---------------------------------------------------------------- Vor dem Schnappschuss: nichts da
    ok('Ohne Schnappschuss: kein Web-Programm verfügbar', Object.values(st()).every((a) => !a.available), st());

    // ---------------------------------------------------------------- Build-Skript ohne erreichbaren Server: kein Abbruch
    const offDir = path.join(dir, 'snapshot-offline');
    const off = await nodeRun([offDir, '--origin', 'http://127.0.0.1:9']);
    ok('Build-Skript ohne Server: endet ohne Fehler', off.status === 0, [off.status, off.stdout, off.stderr]);
    ok('Build-Skript ohne Server: meldet es', /WARNUNG|::warning::/.test(off.stdout) && /OHNE eingebaute Web-Programme/.test(off.stdout), off.stdout);
    ok('Build-Skript ohne Server: leerer Schnappschuss mit Hinweis', (() => {
      const i = W.readIndex(offDir);
      return Object.keys(i.apps).length === 0 && !!i.note;
    })());

    // ---------------------------------------------------------------- Build-Skript: Schnappschuss vom Mini-mert.win
    const snap = await nodeRun([builtin, '--origin', base]);
    ok('Build-Skript: Schnappschuss geladen', snap.status === 0 && /6\/7 im Schnappschuss/.test(snap.stdout), [snap.status, snap.stdout, snap.stderr]);
    ok('Build-Skript: Dealline noch nicht da, kein Fehler', /deal\s+noch nicht auf der Website/.test(snap.stdout), snap.stdout);
    ok('CDN ohne Zugangs-Cookie geladen', !srv.cdnCookie);
    const idx = W.readIndex(builtin);
    const has = (p) => !!idx.files[p];
    ok('Geladen: Seite, CSS, JS, Symbol', ['/qr/', '/qr/qr.css', '/qr/qr.js', '/app-icons/qr-192.png'].every(has));
    ok('Geladen: gemeinsame Dateien (/app-icons/acryl.css, url() darin, @import)', ['/app-icons/acryl.css', '/app-icons/acryl/ocean.webp', '/app-icons/mobile.css', '/app-icons/print.css'].every(has));
    ok('Geladen: Manifest-Symbole und Service-Worker-Liste', has('/app-icons/qr-512.png') && has('/qr/extra/help.txt'));
    ok('Geladen: url() in CSS relativ zur CSS-Datei', has('/qr/img/dot.svg'));
    ok('Geladen: ES-Module, new URL(…, import.meta.url), fetch()', ['/skin/js/app.js', '/skin/js/model.js', '/skin/img/steve.png', '/skin/data/parts.json'].every(has), Object.keys(idx.files).filter((p) => p.startsWith('/skin')));
    ok('Geladen: Webgames samt Spiel aus der Liste', ['/web/', '/web/snake/', '/web/snake/game.js', '/web/shared/kit.js'].every(has));
    ok('Geladen: CDN-Bibliothek (fest versioniert)', has('/_ext/cdn.jsdelivr.net/npm/fake-qr@1.2.3/lib/fake-qr.js'));
    ok('Nicht geladen: Seiten außerhalb des Ordners (/help/)', !has('/help/') && !has('/help/index.html'));
    ok('Nicht geladen: kaputter Link aus Skript-Text', !Object.keys(idx.files).some((p) => p.includes("'")));
    ok('Gemeinsame Datei nur einmal gespeichert', fs.readdirSync(path.join(builtin, 'blobs')).length === new Set(Object.values(idx.files).map((f) => f.hash)).size);
    ok('Hintergrund: externe Dienste notiert', (idx.apps.bg.external || []).includes('cdn.jsdelivr.net'), idx.apps.bg.external);

    web.lib.reload();
    web.changed();
    const s1 = st();
    ok('Schnappschuss: 6 Programme verfügbar, Dealline nicht', ['qr', 'skin', 'bg', 'mc', 'pse', 'web'].every((id) => s1[id].available && s1[id].source === 'builtin') && !s1.deal.available, s1);
    ok('Stand = Last-Modified der Website', s1.qr.modified === Date.parse(LM), s1.qr.modified);

    // ---------------------------------------------------------------- Offline: Server weg, alles aus dem Speicher
    goDown();
    ok('Server ist weg', (await get('/qr/', { Cookie: 'w_zugang=w' })).status === 0);
    const opened = await hub.openWebApp('qr');
    ok('QR-Codes öffnet (offline)', opened === true);
    const qw = await until(() => [...hub.webWins.entries()].find(([k]) => k.startsWith('qr|'))?.[1], 5000);
    ok('Eigenes Fenster, unsichtbar im Test', !!qw && !qw.isVisible());
    if (qw) {
      const q = (code) => qw.webContents.executeJavaScript(code);
      await until(() => !qw.webContents.isLoading(), 8000);
      ok('Adresse whub-web://mert.win/qr/', qw.webContents.getURL() === 'whub-web://mert.win/qr/', qw.webContents.getURL());
      ok('Offline: Seite und Skript laufen', (await until(() => q('window.QR_VERSION === 1'), 5000)) === true);
      ok('Offline: absolutes /app-icons/acryl.css greift', (await until(() => q(`getComputedStyle(document.getElementById('m')).width === '123px'`), 5000)) === true);
      ok('Offline: absoluter Pfad per fetch', await q(`fetch('/app-icons/acryl/ocean.webp').then((r) => r.text()).then((t) => t === 'WEBP-ocean')`));
      ok('Offline: CDN-Bibliothek aus dem Speicher', (await until(() => q('window.fakeQr === true'), 5000)) === true);
      ok('Eigener Speicherbereich je Programm', /web-qr/.test(qw.webContents.session.storagePath || ''), qw.webContents.session.storagePath);
      // macOS: kein Menü am Fenster, sondern das globale App-Menü - dort meldet Electron immer "sichtbar"
      if (process.platform !== 'darwin') ok('Keine Menüleiste', !qw.isMenuBarVisible());
      ok('Offline: nicht gespeicherte API meldet Fehler statt zu hängen', await q(`fetch('/share/api').then((r) => r.status === 503, () => true)`));
      await qw.loadURL('whub-web://mert.win/help/').catch(() => {});
      ok('Offline: nicht gespeicherte Seite zeigt Hinweis', (await until(() => q(`document.title === 'Offline nicht verfügbar'`), 5000)) === true, await q('document.title'));
      // ---------------------------------------------------------------- Online: nicht gespeicherte Pfade gehen an die Website, mit Cookie
      goUp();
      await qw.loadURL('whub-web://mert.win/qr/');
      const api = await q('window.shareApi()').catch((e) => String(e));
      ok('Online: /share/api über die Website', api && api.online === true && api.q === '?x=1', api);
      ok('Online: dabei mit Zugangs-Cookie', /w_zugang=w/.test(srv.lastShareCookie || ''), srv.lastShareCookie);
      await qw.loadURL('whub-web://mert.win/help/').catch(() => {});
      ok('Online: /help/ kommt von der Website', (await until(() => q(`document.title === 'Hilfe online'`), 5000)) === true);
      qw.close();
    }

    // Webgames: Ordner ohne Schrägstrich, relative und absolute Pfade, Skin-Editor mit Modulen
    goDown();
    await hub.openWebApp('web', 'whub-web://mert.win/web/snake');
    const ww = await until(() => [...hub.webWins.entries()].find(([k]) => k.startsWith('web|'))?.[1], 5000);
    if (ww) {
      await until(() => !ww.webContents.isLoading(), 8000);
      ok('Ordner ohne / wird zu /web/snake/', ww.webContents.getURL() === 'whub-web://mert.win/web/snake/', ww.webContents.getURL());
      ok('Spiel läuft offline (../shared/kit.js, game.js, /app-icons/…)', (await until(() => ww.webContents.executeJavaScript('window.KIT === 1 && window.SNAKE === 1 && window.ICON_OK === true'), 5000)) === true);
      ww.close();
    } else ok('Webgames-Fenster', false);
    await hub.openWebApp('skin');
    const sw = await until(() => [...hub.webWins.entries()].find(([k]) => k.startsWith('skin|'))?.[1], 5000);
    if (sw) {
      ok('Skin-Editor offline: Module, Daten und Bilder', (await until(() => sw.webContents.executeJavaScript(`window.SKIN === 'steve' && window.PARTS === 12 && window.STEVE === 'PNG-steve'`), 8000)) === true);
      sw.close();
    } else ok('Skin-Editor-Fenster', false);

    // ---------------------------------------------------------------- Oberfläche
    await js(`window.__hub.go('webapps')`);
    ok('Leiste: Bereich Web-Programme', (await js(`[...document.querySelectorAll('.nav-btn[data-view] .nav-label')].map(x => x.textContent).join('|')`)) === 'Meine Programme|Entdecken|Web-Programme|Updates');
    ok('Bereich Web-Programme: 6 Kacheln (Dealline noch versteckt)', (await js(`[...document.querySelectorAll('.card')].map(c => c.dataset.app).join()`)) === 'qr,skin,bg,mc,pse,web', await js(`[...document.querySelectorAll('.card')].map(c => c.dataset.app).join()`));
    ok('Kachel: Offline bereit mit Stand', (await js(`document.querySelector('.card[data-app="qr"] .st').textContent`)).startsWith('Offline bereit · Stand'), await js(`document.querySelector('.card[data-app="qr"] .st').textContent`));
    ok('Symbole aus whub-web geladen', (await until(() => js(`(() => { const i = document.querySelector('.card[data-app="mc"] img'); return i.complete; })()`), 3000)) === true);
    await js(`window.__hub.go('app', 'skin')`);
    ok('Detailseite: ehrlicher Hinweis auf Internet', (await js(`(document.querySelector('[data-net="skin"]') || {}).textContent || ''`)).includes('Braucht Internet'), await js(`(document.querySelector('[data-net="skin"]') || {}).textContent`));
    await js(`window.__hub.go('app', 'pse')`);
    ok('Detailseite: Periodensystem läuft komplett offline', (await js(`(document.querySelector('[data-net="pse"]') || {}).textContent || ''`)).includes('komplett offline'));
    await js(`window.__hub.go('home')`);
    ok('Meine Programme: Web-Programme als Kacheln', (await js(`[...document.querySelectorAll('.tiles > .tile')].map(t => t.dataset.app).join()`)).includes('qr,skin,bg,mc,pse,web'));

    // ---------------------------------------------------------------- Update-Erkennung
    goUp();
    srv.n304 = 0;
    srv.conditional = 0;
    site['/qr/qr.js'] = site['/qr/qr.js'].replace('QR_VERSION = 1', 'QR_VERSION = 2');
    site['/deal/'] = '<!doctype html><title>Dealline</title><link rel="icon" href="/app-icons/deal-192.png">';
    site['/app-icons/deal-192.png'] = 'PNG-deal';
    const updated = await web.sync();
    const s2 = st();
    ok('Abgleich: geänderte Datei erkannt (nur QR-Codes und neues Dealline)', JSON.stringify(updated.sort()) === JSON.stringify(['deal', 'qr']), updated);
    ok('Abgleich: bedingte Anfragen (If-None-Match/If-Modified-Since)', srv.conditional > 20 && srv.n304 > 20, [srv.conditional, srv.n304]);
    ok('Neue Version liegt im Benutzerordner', s2.qr.source === 'user' && fs.existsSync(path.join(userDir, 'index.json')));
    ok('Dealline erscheint, sobald es auf der Website liegt', s2.deal.available === true);
    await js(`window.__hub.go('webapps')`);
    ok('Dealline jetzt im Bereich', await until(() => js(`!!document.querySelector('.card[data-app="deal"]')`), 3000));
    goDown();
    await hub.openWebApp('qr');
    const qw2 = await until(() => [...hub.webWins.entries()].find(([k]) => k.startsWith('qr|'))?.[1], 5000);
    if (qw2) {
      ok('Offline danach: neue Version läuft', (await until(() => qw2.webContents.executeJavaScript('window.QR_VERSION === 2'), 5000)) === true);
      qw2.close();
    } else ok('QR-Fenster nach Update', false);
    goUp();
    const again = await web.sync();
    ok('Zweiter Abgleich ohne Änderung: nichts aktualisiert', again.length === 0, again);
    const snapIdx = W.readIndex(builtin);
    ok('Eingebauter Schnappschuss bleibt unverändert', snapIdx.apps.qr && !snapIdx.apps.deal);

    // Knopf in der Oberfläche
    site['/periodensystem/elements.js'] = 'window.ELEMENTS = 119;';
    await js(`window.__hub.go('webapps')`);
    await js(`document.querySelector('#web-sync').click()`);
    ok('Knopf "Von mert.win aktualisieren": Meldung', (await until(() => js(`[...document.querySelectorAll('.toast')].map(t => t.textContent).join('|')`), 15000) || '').includes('Aktualisiert: Periodensystem'), await js(`[...document.querySelectorAll('.toast')].map(t => t.textContent).join('|')`));

    // ---------------------------------------------------------------- Zugang abgelehnt / offline: gespeicherte Version bleibt
    srv.cookie = 'w_zugang=neu';
    await web.sync();
    ok('Anderer Code auf dem Server: Fehler "access", Programme bleiben', Object.values(st()).filter((a) => a.available).every((a) => a.error === 'access' && a.available), st());
    srv.cookie = 'w_zugang=w';
    goDown();
    await web.sync();
    ok('Offline-Abgleich: Fehler "offline", Programme bleiben', ['qr', 'skin', 'web', 'deal'].every((id) => st()[id].error === 'offline' && st()[id].available), st());
    goUp();

    // ---------------------------------------------------------------- Speicher aus W Hub bis 1.2 übernehmen (localStorage unter https://mert.win)
    const part = 'persist:web-mc';
    const ses = session.fromPartition(part);
    const oldWin = new BrowserWindow({ show: false, webPreferences: { partition: part } });
    await ses.protocol.handle('https', () => new Response('<!doctype html><title>alt</title>', { headers: { 'Content-Type': 'text/html' } }));
    await oldWin.loadURL('https://mert.win/mc/');
    await oldWin.webContents.executeJavaScript(`localStorage.setItem('mc.lastVersion', '1.21'); true`);
    ses.protocol.unhandle('https');
    oldWin.destroy();
    await ses.flushStorageData();
    await until(() => fs.existsSync(path.join(dir, 'userdata', 'Partitions', 'web-mc', 'Local Storage')), 5000);
    await hub.openWebApp('mc');
    const mw = await until(() => [...hub.webWins.entries()].find(([k]) => k.startsWith('mc|'))?.[1], 8000);
    if (mw) {
      await until(() => !mw.webContents.isLoading(), 8000);
      ok('Alter Speicher (bis 1.2) übernommen', (await mw.webContents.executeJavaScript(`localStorage.getItem('mc.lastVersion')`)) === '1.21');
      mw.close();
    } else ok('Minecraft-Tools-Fenster', false);
    void protocol;
  } catch (e) {
    ok(`Ausnahme: ${e && e.stack ? e.stack : e}`, false);
  }

  server.close();
  const bad = results.filter(([r]) => !r);
  console.log(`\nWeb-Programme: ${results.length - bad.length}/${results.length} bestanden`);
  fs.writeFileSync(path.join(dir, 'ergebnis-web.json'), JSON.stringify(results));
  app.exit(bad.length ? 1 : 0);
};
