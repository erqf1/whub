'use strict';

// Selbsttest (läuft im unsichtbaren Fenster, gestartet über tools/run-selftest.js).
// Spielt GitHub und mert.win mit einem lokalen Server, steuert die Oberfläche wie ein Mensch und prüft,
// welche Installer mit welchen Parametern gestartet wurden (FakeSetup.exe schreibt log.txt).
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { app } = require('electron');

module.exports = async function selftest(win, dir, hub) {
  const results = [];
  const ok = (name, cond, extra) => {
    results.push([!!cond, name]);
    console.log(`${cond ? 'OK  ' : 'FEHL'} ${name}${extra !== undefined && !cond ? ` -> ${JSON.stringify(extra)}` : ''}`);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (code) => win.webContents.executeJavaScript(code);
  const until = async (code, ms = 15000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try {
        const v = await js(code);
        if (v) return v;
      } catch {
        // Seite lädt noch
      }
      await sleep(80);
    }
    return null;
  };
  const click = (sel) => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`);
  const text = (sel) => js(`(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ''`);
  const menuClick = (label) => js(`(() => { const m = [...document.querySelectorAll('.menu-item')].find(x => x.querySelector('.menu-label').textContent === ${JSON.stringify(label)}); if (!m) return false; m.click(); return true; })()`);
  const menuLabels = () => js(`[...document.querySelectorAll('.menu .menu-label')].map(x => x.textContent).join('|')`);
  // echtes Ziehen & Ablegen im Fenster (DragEvent mit DataTransfer, wie mit der Maus)
  const drag = (fromSel, toSel, side = 'before') => js(`(() => {
    const a = document.querySelector(${JSON.stringify(fromSel)}), b = document.querySelector(${JSON.stringify(toSel)});
    if (!a || !b) return false;
    const dt = new DataTransfer(); const r = b.getBoundingClientRect();
    const x = ${JSON.stringify(side)} === 'before' ? r.left + 2 : r.right - 2, y = r.top + r.height / 2;
    a.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
    b.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: x, clientY: y }));
    b.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: x, clientY: y }));
    a.dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, bubbles: true }));
    return true;
  })()`);
  const homeKeys = () => js(`[...document.querySelectorAll('.tiles > .tile')].map(t => t.dataset.app || 'f:' + t.dataset.folder).join()`);
  const log = () => (fs.existsSync(path.join(dir, 'log.txt')) ? fs.readFileSync(path.join(dir, 'log.txt'), 'utf8').trim().split('\n').filter(Boolean) : []);
  const fake = path.join(dir, 'FakeSetup.exe');
  const fakeBytes = fs.readFileSync(fake);

  // ---------------------------------------------------------------- ausgedachte Registry
  const entry = (hive, key, name, version, exe, uninstall, loc = dir) => ({ hive, key, name, version, icon: path.join(loc, exe), location: loc, uninstall: `"${fake}"`, quiet: `"${fake}" ${uninstall}` });
  const VID = (v, loc) => entry('HKCU', '{B7D0C3E2-5A41-4C7E-9B61-3F2A8E6D1C90}_is1', `Vidline ${v}`, v, 'Vidline.exe', '/SILENT', loc);
  const CLIP = entry('HKCU', '{4F2C9A61-7D3B-4E8A-A5C2-9B1E6D0F3A77}_is1', 'Clipline version 1.9.0', '1.9.0', 'Clipline.exe', '/SILENT');
  const TEXT = (v, loc) => ({ ...entry('HKLM', 'd0565d34-edd1-5436-8ff2-a927d9ee791b', `Textline ${v}`, v, 'Textline.exe,0', '/allusers /S', loc), icon: `${path.join(loc || dir, 'Textline.exe')},0` });
  const WEB = (loc) => entry('HKCU', 'b0d11819-7e3c-5ae6-808c-4aa8e370b417', 'Webline 1.10.0', '1.10.0', 'Webline.exe', '/currentuser /S', loc);
  const setReg = (list) => fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify(list));
  const nextReg = (list) => fs.writeFileSync(path.join(dir, 'next-registry.json'), JSON.stringify(list));
  for (const exe of ['Vidline.exe', 'Clipline.exe', 'Textline.exe', 'Webline.exe']) fs.writeFileSync(path.join(dir, exe), 'x');
  setReg([VID('1.13.0'), CLIP, TEXT('1.1.1')]);

  // ---------------------------------------------------------------- GitHub und mert.win zum Spielen
  const port = Number(process.env.WHUB_TEST_PORT);
  const base = `http://127.0.0.1:${port}`;
  const files = {};
  const addFile = (name, bytes) => {
    files[name] = bytes;
    return { name, size: bytes.length, browser_download_url: `${base}/dl/${encodeURIComponent(name)}`, digest: `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}` };
  };
  const tiny = (s) => Buffer.from(s);
  // großes, aber echtes Programm (angehängte Daten stören Windows nicht)
  // über 8 MB: kommt über mehrere Verbindungen (Range)
  const big = Buffer.concat([fakeBytes, Buffer.alloc(10 * 1024 * 1024, 7)]);
  const NOTES = '## Neu\n\n- **Plugins**: das Musik-Plugin mit Bibliothek\n- Fix: `MP3` mit Cover spielt wieder\n  - auch mit langen Titeln\n\nMehr im [Changelog](https://mert.win/vid/changelog.html).\n\n<!-- intern -->';
  const rel = (tag, assets, body = `Version ${tag}`, date = '2026-11-03T12:00:00Z') => ({ tag_name: tag, name: tag, published_at: date, body, html_url: `https://github.com/x/releases/tag/${tag}`, prerelease: false, draft: false, assets });
  const RELEASES = {
    'erqf1/vidline': [rel('v1.14.0', [addFile('Vidline-windows-x64-setup.exe', fakeBytes), addFile('vidline_amd64.deb', tiny('deb')), addFile('Vidline-macos-intel.dmg', tiny('dmg'))], NOTES), rel('v1.13.0', [], 'Tag-Editor'), rel('v1.12.0', [], ''), { ...rel('v1.15.0-beta', []), draft: true }],
    'erqf1/clipline': [rel('v1.9.0', [addFile('Clipline-windows-x64-setup.exe', fakeBytes)], 'x', '2026-10-01T12:00:00Z')],
    'erqf1/webline': [rel('v1.10.0', [addFile('Webline-Setup-1.10.0.exe', fakeBytes), addFile('Webline-1.10.0-portable.exe', tiny('p')), addFile('Webline-1.10.0-amd64.deb', tiny('deb'))])],
    'erqf1/textline': [rel('v1.2.0', [addFile('Textline-Setup-1.2.0.exe', fakeBytes)], 'x', '2026-11-08T12:00:00Z')],
    'erqf1/picline': [rel('v1.1.1', [{ ...addFile('Picline-Setup-1.1.1.exe', fakeBytes), digest: 'sha256:0000' }])],
    'erqf1/convertline': [rel('v1.0.0', [addFile('Convertline-Setup-1.0.0.exe', fakeBytes)])],
    'erqf1/GambelStrike2': [rel('v1.1.0', [addFile('GambelStrike2-v1.1.0-Windows.exe', fakeBytes), addFile('GambelStrike2-v1.1.0-offline.html', tiny('<html></html>'))])],
    'erqf1/JumpNDodge': [rel('v5.0.0', [addFile('JumpNDodge-windows-x64-setup.exe', big), addFile('jumpndodge_amd64.deb', tiny('deb'))])],
  };
  const mode = { limit: false, slow: new Set(['JumpNDodge-windows-x64-setup.exe']), apiCalls: 0, notModified: 0, pages: [], rev: 0, ranges: {} };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, base);
    const m = /^\/repos\/([^/]+\/[^/]+)\/releases$/.exec(u.pathname);
    if (m) {
      mode.apiCalls++;
      if (mode.limit) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end('{"message":"API rate limit exceeded"}');
      }
      const list = RELEASES[m[1]];
      if (!list) {
        res.writeHead(404);
        return res.end('{}');
      }
      const etag = `"t-${m[1]}-${mode.rev}"`;
      if (req.headers['if-none-match'] === etag) {
        mode.notModified++;
        res.writeHead(304, { ETag: etag });
        return res.end();
      }
      res.writeHead(200, { 'Content-Type': 'application/json', ETag: etag });
      return res.end(JSON.stringify(list));
    }
    const d = /^\/dl\/(.+)$/.exec(u.pathname);
    if (d && files[decodeURIComponent(d[1])]) {
      const name = decodeURIComponent(d[1]);
      const all = files[name];
      // wie GitHub: Range-Anfragen bekommen 206 mit dem Stück
      const r = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || '');
      const a = r ? Number(r[1]) : 0;
      const b = r ? Math.min(Number(r[2]), all.length - 1) : all.length - 1;
      if (r) mode.ranges[name] = (mode.ranges[name] || 0) + 1;
      const bytes = all.subarray(a, b + 1);
      res.writeHead(r ? 206 : 200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length, ...(r ? { 'Content-Range': `bytes ${a}-${b}/${all.length}` } : {}) });
      if (!mode.slow.has(name)) return res.end(bytes);
      // langsam: 64 KB alle 100 ms je Verbindung
      let pos = 0;
      const tick = () => {
        if (res.destroyed) return;
        if (pos >= bytes.length) return res.end();
        res.write(bytes.subarray(pos, pos + 65536));
        pos += 65536;
        setTimeout(tick, 100);
      };
      return tick();
    }
    // alles andere: Seiten von "mert.win" (Web-Apps)
    mode.pages.push(u.pathname);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><title>Seite ${u.pathname}</title><body>Web-App ${u.pathname}<script>localStorage.setItem('x', location.pathname)</script></body>`);
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));

  try {
    // ---------------------------------------------------------------- Start: Meine Programme
    ok('Oberfläche bereit', await until('window.__ready === true', 30000));
    ok('Standard: kein Auto-Update, kein Autostart', (await js(`window.__hub.settings().autoUpdate === false && window.__hub.settings().startWithSystem === false`)) && !hub.tray());
    await js(`window.__hub.setSetting('language', 'de')`);
    ok('Start auf "Meine Programme"', (await js('window.__hub.view')) === 'home' && (await text('.sect-head h2')) === 'Meine Programme', await text('.sect-head h2'));
    ok('Leiste: nur Meine Programme, Entdecken, Updates', (await js(`[...document.querySelectorAll('.nav-btn[data-view] .nav-label')].map(x => x.textContent).join('|')`)) === 'Meine Programme|Entdecken|Updates');
    ok('Startseite: installierte Programme + Web-Apps (8)', (await homeKeys()) === 'vid,clip,text,voca,files,web,skin,pse', await homeKeys());
    ok('Update-Punkt auf Vidline-Kachel', await js(`!!document.querySelector('.tile[data-app="vid"] .tile-dot')`));
    ok('Updates-Zähler 2', (await text('.nav-btn[data-view="updates"] .count')) === '2');
    ok('Hinweis oben: 2 Updates', (await text('.banner')).includes('2 Updates verfügbar'));

    // ---------------------------------------------------------------- Entdecken (ein Tab mit Filter und Sortierung)
    await click('.nav-btn[data-view="discover"]');
    ok('Katalog: 13 Kacheln', (await js(`document.querySelectorAll('.card').length`)) === 13, await js(`document.querySelectorAll('.card').length`));
    ok('Bereiche: Programme, Spiele, Im Browser, Legacy', (await js(`[...document.querySelectorAll('.sect-head h2')].map(x => x.textContent).join('|')`)) === 'Programme|Spiele|Im Browser|Legacy', await js(`[...document.querySelectorAll('.sect-head h2')].map(x => x.textContent).join('|')`));
    ok('Convertline ist Legacy, JumpNDodge nicht mehr', !!(await js(`document.querySelector('.card[data-app="convert"] .badge')`)) && !(await js(`document.querySelector('.card[data-app="jump"] .badge')`)));
    ok('Erkannt: Vidline 1.13.0 mit Update auf 1.14.0', (await text('.card[data-app="vid"] .st')).includes('1.13.0 → 1.14.0'), await text('.card[data-app="vid"] .st'));
    ok('Erkannt: Clipline aktuell', (await text('.card[data-app="clip"] .st')) === 'Installiert · 1.9.0', await text('.card[data-app="clip"] .st'));
    ok('Nicht installiert: Webline mit Version', (await text('.card[data-app="html"] .st')) === 'Nicht installiert · 1.10.0', await text('.card[data-app="html"] .st'));
    ok('Web-App: Voca öffnet als App', (await text('.card[data-app="voca"] .btn')) === 'Öffnen' && (await text('.card[data-app="voca"] .st')).includes('eigenen Fenster'));
    ok('Entwürfe werden nicht gezeigt', !(await js(`JSON.stringify(document.body.textContent)`)).includes('1.15.0-beta'));
    await click('.fchip[data-filter="games"]');
    ok('Filter Spiele: 2 Kacheln', (await js(`[...document.querySelectorAll('.card')].map(c => c.dataset.app).join()`)) === 'gamble,jump');
    await click('.fchip[data-filter="all"]');
    await js(`(() => { const s = document.querySelector('#sort'); s.value = 'name'; s.dispatchEvent(new Event('change')); })()`);
    ok('Sortiert nach Name', (await js(`[...document.querySelectorAll('.card')].slice(0, 3).map(c => c.dataset.app).join()`)) === 'clip,convert,files', await js(`[...document.querySelectorAll('.card')].slice(0, 3).map(c => c.dataset.app).join()`));
    await js(`(() => { const s = document.querySelector('#sort'); s.value = 'updated'; s.dispatchEvent(new Event('change')); })()`);
    ok('Sortiert nach "Zuletzt aktualisiert"', (await js(`document.querySelector('.card').dataset.app`)) === 'text', await js(`document.querySelector('.card').dataset.app`));
    await js(`(() => { const s = document.querySelector('#sort'); s.value = 'default'; s.dispatchEvent(new Event('change')); })()`);
    ok('Filter und Sortierung gemerkt', JSON.parse(fs.readFileSync(path.join(dir, 'userdata', 'settings.json'), 'utf8')).discoverSort === 'default');

    // Suche
    await js(`window.__hub.setQuery('pixel')`);
    ok('Suche "pixel" findet Picline', (await js(`[...document.querySelectorAll('.card')].map(c => c.dataset.app).join()`)) === 'pic');
    await js(`window.__hub.setQuery('minecraft')`);
    ok('Suche "minecraft" findet Picline und Skin-Editor', (await js(`[...document.querySelectorAll('.card')].map(c => c.dataset.app).sort().join()`)) === 'pic,skin');
    await js(`window.__hub.setQuery('zzzz')`);
    ok('Suche ohne Treffer', (await text('.empty p')).includes('zzzz'));
    await js(`window.__hub.setQuery('')`);
    await js(`window.__hub.go('discover')`);

    // App-Seite
    await click('.card[data-app="vid"]');
    await until(`!!document.querySelector('.hero h1')`);
    ok('App-Seite: Name', (await text('.hero h1')) === 'Vidline');
    ok('App-Seite: Version, Größe, Ort', (await text('.hero-meta')).includes('1.14.0') && (await text('.hero-meta')).includes('Download') && (await text('.hero-meta')).includes('Ort'), await text('.hero-meta'));
    ok('App-Seite: Systeme', (await text('.hero-meta')).includes('Windows · Linux · macOS'), await text('.hero-meta'));
    ok('App-Seite: 5 Bilder, deutsche Fassung', (await js(`[...document.querySelectorAll('.shot img')].map(i => i.src.split('/').pop()).join()`)) === 'player.webp,library-de.webp,music.webp,theme-studio.webp,theme-light.webp');
    ok('App-Seite: Bilder geladen', await until(`(() => { const i = document.querySelector('.shot img'); return i && i.complete && i.naturalWidth > 100; })()`, 8000));
    ok('Neuerungen als Markdown (Liste, fett, Code, Link)', await js(`(() => { const md = document.querySelector('.notes .md'); return md && md.querySelector('li b') && md.querySelector('code') && md.querySelector('a') && md.querySelector('li ul li') && !md.textContent.includes('intern'); })()`));
    ok('Frühere Versionen: 2', (await js(`document.querySelectorAll('.older details').length`)) === 2);
    await js(`document.querySelector('.older details').open = true`);
    ok('Frühere Version aufklappbar', await until(`(document.querySelector('.older details .md') || {}).textContent === 'Tag-Editor'`, 3000));
    await click('.shot');
    ok('Bild groß öffnen', await until(`!!document.querySelector('.lightbox img')`, 3000));
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    ok('Bild schließen mit Esc', !(await js(`!!document.querySelector('.lightbox')`)));
    await click('.back-row .btn');
    ok('Zurück zu Entdecken', await until(`document.querySelectorAll('.card').length === 13`, 3000));

    // ---------------------------------------------------------------- Installieren (Webline, nsis, für mich)
    nextReg([VID('1.13.0'), CLIP, TEXT('1.1.1'), WEB()]);
    await click('.card[data-app="html"] .act .btn');
    ok('Webline: fertig installiert', await until(`(document.querySelector('.card[data-app="html"] .st') || {}).textContent === 'Installiert · 1.10.0'`, 20000), await text('.card[data-app="html"] .st'));
    ok('Webline-Installer still und nur für mich', log().includes('Webline-Setup-1.10.0.exe|/S /currentuser'), log());
    ok('Heruntergeladener Installer wieder gelöscht', !fs.existsSync(path.join(dir, 'downloads', 'Webline-Setup-1.10.0.exe')));

    // ---------------------------------------------------------------- Alle aktualisieren (Vidline inno für mich, Textline nsis für alle)
    await click('.nav-btn[data-view="updates"]');
    ok('Updates-Ansicht: 2 Einträge mit Notizen', (await js(`document.querySelectorAll('.update-item').length`)) === 2 && (await js(`!!document.querySelector('.row-notes .md')`)));
    nextReg([VID('1.14.0'), CLIP, TEXT('1.2.0'), WEB()]);
    await click('.sect-head .btn.primary');
    ok('Alles aktuell nach "Alle aktualisieren"', await until(`(document.querySelector('.empty p') || {}).textContent === 'Alles ist aktuell.'`, 30000), await text('.page'));
    const l = log();
    ok('Vidline-Update still über Inno, für mich', l.includes('Vidline-windows-x64-setup.exe|/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /CLOSEAPPLICATIONS /CURRENTUSER'), l);
    ok('Textline-Update für alle Benutzer (bleibt, wo es ist)', l.includes('Textline-Setup-1.2.0.exe|/S /allusers'), l);
    ok('Nacheinander, nicht gleichzeitig', l.indexOf(l.find((x) => x.startsWith('Vidline'))) < l.indexOf(l.find((x) => x.startsWith('Textline'))));
    ok('Updates-Zähler weg', (await text('.nav-btn[data-view="updates"] .count')) === '');

    // ---------------------------------------------------------------- Meine Programme: Menü, Deinstallieren (Clipline, Inno ohne Fenster)
    await click('.nav-btn[data-view="home"]');
    ok('Webline jetzt auf der Startseite', (await homeKeys()).includes('html'), await homeKeys());
    await click('.tile[data-app="clip"] .tile-more');
    await until(`!!document.querySelector('.menu')`, 3000);
    ok('Kachel-Menü', (await menuLabels()) === 'Öffnen|Details|In Ordner verschieben|Im Ordner zeigen|Deinstallieren', await menuLabels());
    await menuClick('Deinstallieren');
    ok('Nachfrage vor dem Deinstallieren', await until(`!!document.querySelector('.dialog .btn.danger')`, 3000));
    nextReg([VID('1.14.0'), TEXT('1.2.0'), WEB()]);
    await click('.dialog .btn.danger');
    ok('Clipline von der Startseite verschwunden', await until(`!document.querySelector('.tile[data-app="clip"]')`, 15000));
    ok('Inno-Deinstaller ganz still', log().some((x) => x === 'FakeSetup.exe|/VERYSILENT /SUPPRESSMSGBOXES /NORESTART'), log());

    // ---------------------------------------------------------------- Ordner und Ziehen & Ablegen
    await js(`window.__hub.addFolder('Video', 'vid')`);
    ok('Ordner "Video" mit Vidline', await until(`(document.querySelector('.tile.folder .tile-name') || {}).textContent === 'Video1'`, 3000), await text('.tile.folder .tile-name'));
    ok('Vidline nicht mehr lose auf der Startseite', !(await homeKeys()).split(',').includes('vid'), await homeKeys());
    await drag('.tile[data-app="html"]', '.tile.folder');
    ok('Ziehen auf Ordner: Webline hinein', await until(`(document.querySelector('.tile.folder .tile-count') || {}).textContent === '2'`, 3000), await text('.tile.folder .tile-count'));
    await drag('.tile[data-app="pse"]', '.tile[data-app="voca"]', 'before');
    const keys = (await homeKeys()).split(',');
    ok('Ziehen zwischen Kacheln: neue Reihenfolge', keys.indexOf('pse') === keys.indexOf('voca') - 1, keys);
    await sleep(300);
    ok('Reihenfolge und Ordner gespeichert', (() => {
      const s = JSON.parse(fs.readFileSync(path.join(dir, 'userdata', 'settings.json'), 'utf8'));
      return s.folders.length === 1 && s.folders[0].apps.join() === 'vid,html' && s.homeOrder.indexOf('pse') < s.homeOrder.indexOf('voca');
    })());
    await click('.tile.folder');
    ok('Ordner öffnen', await until(`[...document.querySelectorAll('.folder-view .tile')].map(t => t.dataset.app).join() === 'vid,html'`, 3000));
    await drag('.folder-view .tile[data-app="html"]', '.folder-view .tile[data-app="vid"]', 'before');
    ok('Im Ordner umsortieren', await until(`[...document.querySelectorAll('.folder-view .tile')].map(t => t.dataset.app).join() === 'html,vid'`, 3000));
    await drag('.folder-view .tile[data-app="html"]', '.crumb');
    ok('Auf "Meine Programme" ziehen: aus dem Ordner', await until(`[...document.querySelectorAll('.folder-view .tile')].map(t => t.dataset.app).join() === 'vid'`, 3000));
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    ok('Esc: zurück zur Startseite', await until(`window.__hub.view === 'home'`, 3000) && (await homeKeys()).includes('html'));

    // Web-App ausblenden und zurückholen
    await click('.tile[data-app="skin"] .tile-more');
    await until(`!!document.querySelector('.menu')`, 3000);
    await menuClick('Aus „Meine Programme“ entfernen');
    ok('Web-App ausgeblendet', await until(`!document.querySelector('.tile[data-app="skin"]') && !!document.querySelector('.hidden-row .btn')`, 3000));
    await click('.hidden-row .btn');
    ok('Web-App zurückgeholt', await until(`!!document.querySelector('.tile[data-app="skin"]')`, 3000));

    // ---------------------------------------------------------------- Web-App im eigenen Fenster
    await click('.tile[data-app="voca"]');
    const webWin = async (id) => {
      for (let i = 0; i < 60; i++) {
        const w = [...hub.webWins.entries()].find(([k]) => k.startsWith(`${id}|`));
        if (w) return w[1];
        await sleep(100);
      }
      return null;
    };
    const vw = await webWin('voca');
    ok('Voca öffnet ein eigenes Fenster', !!vw);
    if (vw) {
      for (let i = 0; i < 60 && vw.webContents.isLoading(); i++) await sleep(100);
      ok('Fenster lädt die Voca-Seite', vw.webContents.getURL() === `${base}/`, vw.webContents.getURL());
      ok('Eigener Speicher je Web-App', /web-voca/.test(vw.webContents.session.storagePath || ''), vw.webContents.session.storagePath);
      ok('Fenstertitel mit App-Name', /^Voca/.test(vw.getTitle()), vw.getTitle());
      ok('Keine Menüleiste', !vw.isMenuBarVisible());
    }
    await click('.tile[data-app="voca"]');
    await sleep(300);
    ok('Zweiter Klick: kein zweites Fenster', [...hub.webWins.keys()].filter((k) => k.startsWith('voca|')).length === 1);
    await js(`window.__hub.go('app', 'text')`);
    await until(`!!document.querySelector('.hero h1')`);
    await js(`[...document.querySelectorAll('.hero-actions .btn')].find(b => b.textContent.includes('Als Web-App öffnen')).click()`);
    const tw = await webWin('text');
    ok('Textline auch als Web-App (eigener Speicher)', !!tw && /web-text/.test(tw.webContents.session.storagePath || ''));
    for (const w of hub.webWins.values()) w.close();

    // ---------------------------------------------------------------- Einzelne EXE (GambelStrike 2)
    await js(`window.__hub.go('discover')`);
    await click('.card[data-app="gamble"] .act .btn');
    ok('GambelStrike 2 abgelegt', await until(`(document.querySelector('.card[data-app="gamble"] .st') || {}).textContent === 'Installiert · 1.1.0'`, 15000));
    const gsExe = path.join(dir, 'apps', 'gamble', 'GambelStrike2.exe');
    ok('EXE liegt im Apps-Ordner', fs.existsSync(gsExe) && fs.statSync(gsExe).size === fakeBytes.length);
    ok('managed.json merkt sich Version', JSON.parse(fs.readFileSync(path.join(dir, 'userdata', 'managed.json'), 'utf8')).gamble.version === '1.1.0');
    ok('Öffnen geht', await js(`window.api.open('gamble')`));
    ok('Kein Installer dafür gestartet', !log().some((x) => x.startsWith('GambelStrike')));
    ok('Hinweise verschwinden wieder', await until(`document.querySelectorAll('.toast').length === 0`, 6000), await js(`document.querySelectorAll('.toast').length`));

    // ---------------------------------------------------------------- Fehlerfälle
    const before = log().length;
    await click('.card[data-app="pic"] .act .btn');
    ok('Kaputter Download: Fehler wird gezeigt', await until(`(document.querySelector('.card[data-app="pic"] .st.error') || {}).textContent.includes('beschädigt')`, 15000), await text('.card[data-app="pic"] .st'));
    ok('Kaputter Download: nichts gestartet', log().length === before);

    fs.writeFileSync(path.join(dir, 'exitcode.txt'), '5');
    fs.rmSync(path.join(dir, 'next-registry.json'), { force: true });
    await click('.card[data-app="convert"] .act .btn');
    ok('Installer bricht ab: Code wird gezeigt', await until(`(document.querySelector('.card[data-app="convert"] .st.error') || {}).textContent.includes('Code 5')`, 15000), await text('.card[data-app="convert"] .st'));
    fs.rmSync(path.join(dir, 'exitcode.txt'));
    ok('Nochmal versuchen geht (Knopf bleibt)', (await text('.card[data-app="convert"] .act .btn')) === 'Installieren');

    const msgs0 = hub.stats.jobMsgs;
    const t0 = Date.now();
    await click('.card[data-app="jump"] .act .btn');
    ok('Langsamer Download zeigt Fortschritt', await until(`/Lädt herunter … \\d+ %/.test((document.querySelector('.card[data-app="jump"] .job-label') || {}).textContent || '')`, 10000));
    await sleep(1500);
    ok('Großes Paket kommt über mehrere Verbindungen', (mode.ranges['JumpNDodge-windows-x64-setup.exe'] || 0) >= 3, mode.ranges);
    const rate = (hub.stats.jobMsgs - msgs0) / ((Date.now() - t0) / 1000);
    ok('Fortschritt sparsam (höchstens 5 Meldungen/s)', rate <= 5, rate);
    await click('.card[data-app="jump"] .act .icon-btn');
    ok('Abbrechen: Knopf wieder da', await until(`(document.querySelector('.card[data-app="jump"] .act .btn') || {}).textContent === 'Installieren'`, 8000));
    ok('Abbrechen: nichts installiert, keine Reste', !log().some((x) => x.startsWith('JumpNDodge')) && !fs.existsSync(path.join(dir, 'downloads', 'JumpNDodge-windows-x64-setup.exe')) && !fs.existsSync(path.join(dir, 'downloads', 'JumpNDodge-windows-x64-setup.exe.part')));

    // ---------------------------------------------------------------- Installationsordner und Verschieben
    // JumpNDodge liegt woanders und hat seinen Spielstand neben der EXE
    const oldJump = path.join(dir, 'Alt JumpNDodge');
    fs.mkdirSync(path.join(oldJump, 'data'), { recursive: true });
    fs.writeFileSync(path.join(oldJump, 'JumpNDodge.exe'), 'x');
    fs.writeFileSync(path.join(oldJump, 'data', 'gameplay.json'), 'spielstand');
    const JUMP = (loc) => entry('HKCU', '{B44A592F-4DB5-4419-BCA6-7C5F80AA4472}_is1', 'JumpNDodge', '5.0.0', 'JumpNDodge.exe', '/SILENT', loc);
    setReg([VID('1.14.0'), TEXT('1.2.0'), WEB(), JUMP(oldJump)]);
    mode.slow.clear();
    await click('#refresh');
    await sleep(800);
    const target = path.join(dir, 'W Software');
    await click('#settings-btn');
    ok('Einstellungen: Installationsordner (Standard)', await until(`(document.querySelector('#install-dir .dir-path') || {}).textContent === 'Standard (jedes Programm entscheidet selbst)'`, 3000), await text('#install-dir'));
    await click('#pick-dir');
    ok('Ordner gewählt', await until(`(document.querySelector('#install-dir .dir-path') || {}).textContent === ${JSON.stringify(target)}`, 3000), await text('#install-dir .dir-path'));
    ok('Angebot: 5 Programme verschieben', (await text('#move-all')) === 'Installierte Programme hierher verschieben (5)', await text('#move-all'));
    // nach jedem Lauf des Fake-Installers steht schon der Endstand in der "Registry"
    for (const exe of ['Vidline.exe', 'Textline.exe', 'Webline.exe', 'JumpNDodge.exe']) {
      const n = exe.replace('.exe', '');
      fs.mkdirSync(path.join(target, n), { recursive: true });
      fs.writeFileSync(path.join(target, n, exe), 'x');
    }
    // Reihenfolge der Jobs: Vidline, Webline, Textline, (GambelStrike ohne Installer), JumpNDodge -
    // je ein Stand nach Deinstallieren und nach Installieren (FakeSetup nimmt next-registry-NN.json der Reihe nach)
    fs.rmSync(path.join(dir, 'next-registry.json'), { force: true });
    const nV = VID('1.14.0', path.join(target, 'Vidline')), nW = WEB(path.join(target, 'Webline')), nT = TEXT('1.2.0', path.join(target, 'Textline')), nJ = JUMP(path.join(target, 'JumpNDodge'));
    const oT = TEXT('1.2.0'), oW = WEB(), oJ = JUMP(oldJump);
    [[oW, oT, oJ], [nV, oW, oT, oJ], [nV, oT, oJ], [nV, nW, oT, oJ], [nV, nW, oJ], [nV, nW, nT, oJ], [nV, nW, nT], [nV, nW, nT, nJ]]
      .forEach((st, i) => fs.writeFileSync(path.join(dir, `next-registry-${String(i + 1).padStart(2, '0')}.json`), JSON.stringify(st)));
    const logBefore = log().length;
    await click('#move-all');
    ok('Nachfrage vor dem Verschieben', await until(`(document.querySelectorAll('.dialog')[1] || {}).textContent?.includes('neu installiert')`, 3000));
    await js(`document.querySelectorAll('.dialog')[1].querySelector('.btn.primary').click()`);
    ok('Alles verschoben', await until(`!document.querySelector('#move-all') && Object.keys(window.__hub.settings()).length > 0`, 45000) && (await until(`!document.querySelector('.job')`, 20000)), { dir: await text('#install-dir'), jobs: hub.state.jobs, queue: hub.queue, jump: hub.state.installed.jump, log: log().slice(-6) });
    const ml = log().slice(logBefore);
    ok('Vidline: still deinstalliert, dann mit /DIR neu', ml.indexOf('FakeSetup.exe|/VERYSILENT /SUPPRESSMSGBOXES /NORESTART') >= 0 && ml.includes(`Vidline-windows-x64-setup.exe|/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /CLOSEAPPLICATIONS /CURRENTUSER /DIR=${path.join(target, 'Vidline')}`), ml);
    ok('Textline: für alle, mit /D= am Ende (Pfad mit Leerzeichen)', ml.includes(`Textline-Setup-1.2.0.exe|/S /allusers /D=${path.join(target, 'Textline')}`), ml);
    ok('Webline: für mich, mit /D=', ml.includes(`Webline-Setup-1.10.0.exe|/S /currentuser /D=${path.join(target, 'Webline')}`), ml);
    ok('JumpNDodge: Spielstand mitgenommen', fs.existsSync(path.join(target, 'JumpNDodge', 'data', 'gameplay.json')) && fs.readFileSync(path.join(target, 'JumpNDodge', 'data', 'gameplay.json'), 'utf8') === 'spielstand');
    const gsNew = path.join(target, 'GambelStrike 2', 'GambelStrike2.exe');
    ok('GambelStrike 2: EXE verschoben', fs.existsSync(gsNew) && !fs.existsSync(gsExe));
    ok('managed.json zeigt neuen Ort', JSON.parse(fs.readFileSync(path.join(dir, 'userdata', 'managed.json'), 'utf8')).gamble.path === gsNew);
    await click('.settings-dialog .btn.primary');
    nextReg([nV, nT, nW, nJ]);
    await js(`window.api.uninstall('gamble')`);
    ok('GambelStrike 2 wieder entfernt', await until(`(() => { window.__hub.go('discover'); return (document.querySelector('.card[data-app="gamble"] .st') || {}).textContent === 'Nicht installiert · 1.1.0'; })()`, 10000));
    // neue Installation landet direkt im gemeinsamen Ordner
    nextReg([VID('1.14.0', path.join(target, 'Vidline')), TEXT('1.2.0', path.join(target, 'Textline')), WEB(path.join(target, 'Webline')), JUMP(path.join(target, 'JumpNDodge')), { ...CLIP, location: path.join(target, 'Clipline') }]);
    await click('.card[data-app="clip"] .act .btn');
    ok('Verschieben: JumpNDodge parallel geladen und geprüft', (mode.ranges['JumpNDodge-windows-x64-setup.exe'] || 0) >= 6, mode.ranges);
    ok('Neue Installation direkt in den Ordner', await until(`(document.querySelector('.card[data-app="clip"] .st') || {}).textContent === 'Installiert · 1.9.0'`, 15000) && log().includes(`Clipline-windows-x64-setup.exe|/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /CLOSEAPPLICATIONS /CURRENTUSER /DIR=${path.join(target, 'Clipline')}`), log().slice(-2));

    // ---------------------------------------------------------------- Alles automatisch aktualisieren
    // Clipline 1.9.1 und Webline 1.10.1 erscheinen; Webline ist gerade geöffnet
    const CLIP2 = { ...CLIP, name: 'Clipline version 1.9.1', version: '1.9.1', location: path.join(target, 'Clipline') };
    const WEB2 = { ...WEB(path.join(target, 'Webline')), name: 'Webline 1.10.1', version: '1.10.1' };
    const restReg = [VID('1.14.0', path.join(target, 'Vidline')), TEXT('1.2.0', path.join(target, 'Textline')), JUMP(path.join(target, 'JumpNDodge'))];
    fs.rmSync(path.join(dir, 'next-registry.json'), { force: true });
    fs.writeFileSync(path.join(dir, 'next-registry-01.json'), JSON.stringify([...restReg, WEB(path.join(target, 'Webline')), CLIP2]));
    fs.writeFileSync(path.join(dir, 'next-registry-02.json'), JSON.stringify([...restReg, WEB2, CLIP2]));
    RELEASES['erqf1/clipline'].unshift(rel('v1.9.1', [addFile('Clipline-windows-x64-setup.exe', fakeBytes)], 'neu', '2026-11-10T12:00:00Z'));
    RELEASES['erqf1/webline'].unshift(rel('v1.10.1', [addFile('Webline-Setup-1.10.1.exe', fakeBytes)], 'neu', '2026-11-10T12:00:00Z'));
    mode.rev++;
    fs.writeFileSync(path.join(dir, 'running.txt'), 'Webline.exe');
    await js(`window.__hub.setSetting('autoUpdate', true)`);
    await sleep(200);
    const autoLog = log().length;
    hub.notes.length = 0;
    await hub.refresh(true, true);
    ok('Auto-Update: Clipline still aktualisiert', await until(`(() => { window.__hub.go('discover'); return (document.querySelector('.card[data-app="clip"] .st') || {}).textContent === 'Installiert · 1.9.1'; })()`, 15000) && log().slice(autoLog).includes('Clipline-windows-x64-setup.exe|/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /CLOSEAPPLICATIONS /CURRENTUSER'), log().slice(autoLog));
    ok('Auto-Update: geöffnetes Webline nicht angefasst, keine Nachfrage', !log().slice(autoLog).some((x) => x.startsWith('Webline')) && !(await js(`!!document.querySelector('.dialog')`)));
    ok('Auto-Update: Meldung "aktualisiert"', hub.notes.some((n) => n.title === 'Aktualisiert' && n.body.includes('Clipline')), hub.notes);
    fs.writeFileSync(path.join(dir, 'running.txt'), '');
    const webDone = async () => {
      for (let i = 0; i < 150; i++) {
        if (log().slice(autoLog).includes('Webline-Setup-1.10.1.exe|/S /currentuser') && hub.state.installed.html && hub.state.installed.html.version === '1.10.1') return true;
        await sleep(100);
      }
      return false;
    };
    ok('Auto-Update: Webline nach dem Schließen nachgeholt', await webDone(), { log: log().slice(autoLog), html: hub.state.installed.html });
    await js(`window.__hub.setSetting('autoUpdate', false)`);
    ok('Auto-Update wieder aus (gespeichert)', JSON.parse(fs.readFileSync(path.join(dir, 'userdata', 'settings.json'), 'utf8')).autoUpdate === false);

    // ---------------------------------------------------------------- GitHub-Limit und Zwischenspeicher
    const calls = mode.apiCalls;
    await click('#refresh');
    await sleep(800);
    ok('Erneut prüfen: unveränderte Releases kommen als 304', mode.notModified >= 7, mode.notModified);
    ok('Dabei je Programm nur eine Anfrage', mode.apiCalls - calls === 8, mode.apiCalls - calls);
    mode.limit = true;
    await click('#refresh');
    ok('Limit erreicht: Hinweis oben', await until(`(document.querySelector('#checked') || {}).textContent.includes('GitHub-Limit')`, 8000), await text('#checked'));
    ok('Limit erreicht: Kacheln bleiben', (await js(`document.querySelectorAll('.card').length`)) > 0);
    mode.limit = false;

    // ---------------------------------------------------------------- Einstellungen, Sprache, Stil
    await click('#settings-btn');
    ok('Einstellungen öffnen', await until(`!!document.querySelector('.settings-dialog select')`, 3000));
    ok('Einstellungen: Für alle Benutzer installieren', (await text('.settings-dialog')).includes('für alle Benutzer'));
    await click('.settings-dialog .btn.primary');
    await js(`window.__hub.go('home'); window.__hub.setSetting('language', 'en')`);
    ok('Sprache Englisch: Leiste', (await text('.nav-btn[data-view="home"] .nav-label')) === 'My apps' && (await text('.nav-btn[data-view="discover"] .nav-label')) === 'Discover');
    await js(`window.__hub.go('discover')`);
    ok('Sprache Englisch: App-Text', (await text('.card[data-app="clip"] .card-tag')).startsWith('That moment?'));
    await js(`window.__hub.setSetting('language', 'ja')`);
    ok('Japanisch: Leiste übersetzt, App-Text auf Englisch', (await text('.nav-btn[data-view="home"] .nav-label')) === 'マイアプリ' && (await text('.card[data-app="vid"] .card-tag')).startsWith('Your video'));
    await js(`window.__hub.setSetting('look', 'acryl')`);
    ok('Stil Acryl', (await js(`document.documentElement.dataset.look`)) === 'acryl');
    await js(`window.__hub.setSetting('look', 'standard'); window.__hub.setSetting('language', 'de')`);
    ok('Einstellungen gespeichert', JSON.parse(fs.readFileSync(path.join(dir, 'userdata', 'settings.json'), 'utf8')).language === 'de');

    // Bilder für den Bericht
    for (const [v, f] of [['home', 'start.png'], ['discover', 'uebersicht.png']]) {
      await js(`window.__hub.go('${v}')`);
      await sleep(500);
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(dir, f), img.toPNG());
    }
  } catch (e) {
    ok(`Unerwarteter Fehler: ${e.message}`, false);
  }
  server.close();
  const bad = results.filter(([r]) => !r);
  console.log(`\n${results.length - bad.length} von ${results.length} Prüfungen bestanden`);
  app.exit(bad.length ? 1 : 0);
};
