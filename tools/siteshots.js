'use strict';

// Bilder für die Website (mert.win/hub): echtes W Hub mit echten Releases von GitHub und den eingebauten
// Web-Programmen, unsichtbar. Liest nur - installiert wird nichts.
// Aufruf (echte Daten): npx electron . --siteshots <ordner>   -> <ordner>/shots/*.webp
// Hell und dunkel, Deutsch und Englisch: Startseite, Entdecken, Programm-Details, Updates, Web-Programme,
// Details eines Web-Programms, ein geöffnetes Web-Programm, Einstellungen.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

module.exports = async function siteshots(win, dir, hub) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (code) => win.webContents.executeJavaScript(code);
  const out = path.join(dir, 'shots');
  fs.mkdirSync(out, { recursive: true });
  const only = (process.env.WHUB_SHOTS || '').split(',').filter(Boolean);
  /** Bild eines Fensters als WebP (im Fenster von W Hub umgewandelt) */
  const snap = async (name, from = win) => {
    if (only.length && !only.some((o) => name.startsWith(o))) return;
    await sleep(800);
    // unter Xvfb klappt die erste Aufnahme manchmal nicht (UnknownVizError): neu versuchen, sonst auslassen
    let img = null;
    for (let i = 0; i < 4 && !img; i++) {
      try {
        img = await from.webContents.capturePage();
        if (img.isEmpty()) img = null;
      } catch (e) {
        console.log('Aufnahme', name, 'noch einmal:', e.message);
      }
      if (!img) await sleep(1000);
    }
    if (!img) {
      console.log('Bild', name, 'ausgelassen');
      return;
    }
    const b64 = img.toPNG().toString('base64');
    const webp = await js(`(async () => {
      const i = new Image(); i.src = 'data:image/png;base64,${b64}'; await i.decode();
      const c = document.createElement('canvas'); c.width = i.width; c.height = i.height;
      c.getContext('2d').drawImage(i, 0, 0);
      return c.toDataURL('image/webp', 0.88).split(',')[1];
    })()`);
    fs.writeFileSync(path.join(out, `${name}.webp`), Buffer.from(webp, 'base64'));
    console.log('Bild', name, img.getSize());
  };
  const until = async (code, ms = 15000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await js(code).catch(() => false)) return true;
      await sleep(100);
    }
    return false;
  };
  try {
    await until('window.__ready === true', 30000);
    win.setContentSize(1280, 800);
    await sleep(600);
    // Meine Programme mit einem Beispielordner (nur im Test-Benutzerordner gespeichert)
    const home = (lang) => js(`(() => { const s = window.__hub.settings(); s.folders = []; s.homeOrder = []; s.hidden = []; window.__hub.addFolder('${lang === 'de' ? 'Schule' : 'School'}', 'voca'); window.__hub.moveToFolder('pse', s.folders[0].id); window.__hub.go('home'); })()`);
    for (const mode of ['dark', 'light']) {
      await js(`window.__hub.setSetting('mode', '${mode}')`);
      for (const lang of ['de', 'en']) {
        const n = (x) => `${x}-${mode === 'light' ? 'light-' : ''}${lang}`;
        await js(`window.__hub.setSetting('language', '${lang}')`);
        await home(lang);
        await snap(n('home'));
        await js(`window.__hub.go('discover'); document.querySelector('#view').scrollTop = 0`);
        await snap(n('discover'));
        await js(`window.__hub.go('app', 'vid')`);
        await snap(n('app'));
        await js(`window.__hub.go('app', 'pic')`);
        await snap(n('app-pic'));
        await js(`window.__hub.go('updates')`);
        await snap(n('updates'));
        await js(`window.__hub.go('webapps')`);
        await snap(n('webapps'));
        await js(`window.__hub.go('app', 'skin')`);
        await snap(n('webapp-skin'));
        await js(`window.__hub.go('home'); document.querySelector('#settings-btn').click()`);
        await sleep(1200); // Dialog fertig eingeblendet
        await snap(n('settings'));
        await js(`document.querySelectorAll('.overlay').forEach((o) => o.remove())`);
      }
    }
    // geöffnete Web-Programme (eigene Fenster, offline aus dem eingebauten Schnappschuss)
    for (const id of ['pse', 'qr', 'web', 'deal']) {
      if (only.length && !only.some((o) => `open-${id}`.startsWith(o))) continue;
      if (!(await hub.openWebApp(id))) continue;
      let w = null;
      for (let i = 0; i < 80 && !w; i++) {
        w = [...hub.webWins.entries()].find(([k]) => k.startsWith(`${id}|`))?.[1] || null;
        await sleep(100);
      }
      if (!w) continue;
      w.setContentSize(1280, 800);
      for (let i = 0; i < 80 && w.webContents.isLoading(); i++) await sleep(100);
      await sleep(1500);
      await snap(`open-${id}`, w);
      w.close();
    }
  } catch (e) {
    console.log('Fehler:', e && e.stack ? e.stack : e);
  }
  app.exit(0);
};
