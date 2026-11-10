'use strict';

// Symbole für die Website: app-icons/hub-192.png, hub-512.png, hub-maskable-512.png, wash/hub.png und hub/icon.png.
// Unsichtbar: npx electron tools/site-icons.js <Websites-Ordner>
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

process.on('uncaughtException', (e) => {
  console.log('Fehler:', e && e.stack ? e.stack : e);
  app.exit(1);
});

const site = path.resolve(process.argv[process.argv.length - 1]);
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'icons.js'), 'utf8');
const logo = /export function logoSvg[\s\S]*?return `([\s\S]*?)`;/.exec(src)[1].replace(/\$\{size\}/g, '1024');
const grad = '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#60a5fa"/><stop offset="1" stop-color="#1d4ed8"/></linearGradient></defs>';
// maskable: Fläche bis zum Rand, das W im sicheren Bereich (80 %)
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 64 64">${grad}<rect width="64" height="64" fill="url(#g)"/><g transform="translate(6.4 6.4) scale(.8)"><path d="M15 21.5 23.5 43 32 27.5 40.5 43 49 21.5" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`;
// wash: nur die Farben des Symbols, ohne das helle W
const wash = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 64 64">${grad}<rect width="64" height="64" fill="url(#g)"/></svg>`;

async function render(win, svg, size) {
  return win.webContents.executeJavaScript(`(async () => {
    const img = new Image();
    img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(svg).toString('base64'))};
    await img.decode();
    const c = document.createElement('canvas');
    c.width = c.height = ${size};
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, ${size}, ${size});
    return c.toDataURL('image/png').split(',')[1];
  })()`).then((b64) => Buffer.from(b64, 'base64'));
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<html><body></body></html>');
  const icons = path.join(site, 'app-icons');
  fs.writeFileSync(path.join(icons, 'hub-192.png'), await render(win, logo, 192));
  fs.writeFileSync(path.join(icons, 'hub-512.png'), await render(win, logo, 512));
  fs.writeFileSync(path.join(icons, 'hub-maskable-512.png'), await render(win, maskable, 512));
  fs.writeFileSync(path.join(icons, 'wash', 'hub.png'), await render(win, wash, 48));
  fs.mkdirSync(path.join(site, 'hub'), { recursive: true });
  fs.writeFileSync(path.join(site, 'hub', 'icon.png'), await render(win, logo, 256));
  console.log('Website-Symbole geschrieben');
  app.quit();
});
