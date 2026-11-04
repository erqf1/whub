'use strict';

// Bilder für die Website (mert.win/hub): echtes W Hub mit echten Releases von GitHub, unsichtbar.
// Liest nur - installiert wird nichts. Aufruf: node tools/run-selftest.js <ordner> --siteshots
// (für echte Daten ohne WHUB_API/WHUB_REGISTRY: npx electron . --siteshots <ordner>)
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

module.exports = async function siteshots(win, dir) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (code) => win.webContents.executeJavaScript(code);
  const out = path.join(dir, 'shots');
  fs.mkdirSync(out, { recursive: true });
  try {
    for (let i = 0; i < 300 && !(await js('window.__ready === true').catch(() => false)); i++) await sleep(100);
    win.setContentSize(1280, 800);
    await sleep(600);
    const snap = async (name) => {
      await sleep(700);
      const img = await win.webContents.capturePage();
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
    await js(`window.__hub.setSetting('mode', 'dark')`);
    for (const lang of ['de', 'en']) {
      await js(`window.__hub.setSetting('language', '${lang}')`);
      await js(`window.__hub.go('discover'); document.querySelector('#view').scrollTop = 0`);
      await snap(`discover-${lang}`);
      await js(`window.__hub.go('app', 'vid')`);
      await snap(`app-${lang}`);
      await js(`window.__hub.go('updates')`);
      await snap(`updates-${lang}`);
      await js(`window.__hub.go('installed')`);
      await snap(`installed-${lang}`);
    }
    await js(`window.__hub.setSetting('mode', 'light'); window.__hub.setSetting('language', 'de'); window.__hub.go('app', 'pic')`);
    await snap('light-de');
    await js(`window.__hub.setSetting('language', 'en')`);
    await snap('light-en');
  } catch (e) {
    console.log('Fehler:', e && e.stack ? e.stack : e);
  }
  app.exit(0);
};
