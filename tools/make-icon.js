'use strict';

// Erzeugt assets/icon.png, icon.ico und icon.icns aus demselben SVG wie das Logo in der App (logoSvg in icons.js).
// Läuft in einem unsichtbaren Electron-Fenster: npx electron tools/make-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

// Unsichtbar: Fehler nur ausgeben, nie als Fehlerfenster zeigen
process.on('uncaughtException', (e) => {
  console.log('Fehler:', e && e.stack ? e.stack : e);
  app.exit(1);
});

const OUT = path.join(__dirname, '..', 'assets');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'icons.js'), 'utf8');
const svg = /export function logoSvg[\s\S]*?return `([\s\S]*?)`;/.exec(src)[1].replace(/\$\{size\}/g, '1024');

async function render(win, size, pad) {
  return win.webContents.executeJavaScript(`(async () => {
    const img = new Image();
    img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(svg).toString('base64'))};
    await img.decode();
    const c = document.createElement('canvas');
    c.width = c.height = ${size};
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    // das SVG hat 4/64 Rand; für macOS noch etwas mehr
    const p = ${size} * ${pad};
    g.drawImage(img, p, p, ${size} - p * 2, ${size} - p * 2);
    return c.toDataURL('image/png').split(',')[1];
  })()`).then((b64) => Buffer.from(b64, 'base64'));
}

function ico(images) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  const entries = [];
  let off = 6 + 16 * images.length;
  for (const [s, png] of images) {
    const e = Buffer.alloc(16);
    e[0] = s >= 256 ? 0 : s;
    e[1] = s >= 256 ? 0 : s;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(off, 12);
    off += png.length;
    entries.push(e);
  }
  return Buffer.concat([head, ...entries, ...images.map(([, p]) => p)]);
}
function icns(images) {
  const parts = images.map(([type, png]) => {
    const h = Buffer.alloc(8);
    h.write(type, 0, 'ascii');
    h.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([h, png]);
  });
  const body = Buffer.concat(parts);
  const h = Buffer.alloc(8);
  h.write('icns', 0, 'ascii');
  h.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([h, body]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<html><body></body></html>');
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'icon.png'), await render(win, 512, 0));
  const icoImgs = [];
  for (const s of [16, 20, 24, 32, 40, 48, 64, 128, 256]) icoImgs.push([s, await render(win, s, 0)]);
  fs.writeFileSync(path.join(OUT, 'icon.ico'), ico(icoImgs));
  const mac = [];
  for (const [type, s] of [['ic11', 32], ['ic12', 64], ['ic07', 128], ['ic13', 256], ['ic08', 256], ['ic14', 512], ['ic09', 512], ['ic10', 1024]]) mac.push([type, await render(win, s, 0.06)]);
  fs.writeFileSync(path.join(OUT, 'icon.icns'), icns(mac));
  console.log('icon.png, icon.ico, icon.icns geschrieben');
  app.quit();
});
