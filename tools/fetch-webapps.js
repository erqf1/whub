'use strict';

// Schnappschuss der Web-Programme für den Build: lädt alle Programme aus dem Katalog (category webapps) genauso wie
// W Hub selbst von https://mert.win (mit dem Zugangs-Cookie) nach webapps-snapshot/. electron-builder legt den Ordner
// als resources/webapps neben die App - so laufen die Programme schon beim allerersten Start ohne Internet.
//
// Ist mert.win nicht erreichbar, bricht der Build NICHT ab: es wird ohne (bzw. ohne die fehlenden Programme)
// gebaut, mit einem Hinweis in index.json und einer Warnung in der Ausgabe (GitHub Actions: ::warning::).
// W Hub lädt die Programme dann beim ersten Start mit Internet nach.
//
// Aufruf: node tools/fetch-webapps.js [ziel] [--origin http://127.0.0.1:1234]
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Node-fetch kennt HTTPS_PROXY nur mit NODE_USE_ENV_PROXY (z. B. hinter einem Firmen-Proxy oder in der Cloud)
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const r = spawnSync(process.execPath, ['--no-warnings', ...process.argv.slice(1)], { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } });
  process.exit(r.status == null ? 0 : r.status);
}

const W = require('../src/webapps');
const { WEBAPPS } = require('../src/shared/catalog');

const args = process.argv.slice(2);
const oi = args.indexOf('--origin');
const origin = oi >= 0 ? args[oi + 1] : process.env.WHUB_WEB_ORIGIN || W.SITE;
const dest = path.resolve(args.find((a, i) => !a.startsWith('--') && i !== oi + 1) || path.join(__dirname, '..', 'webapps-snapshot'));
const ci = !!process.env.GITHUB_ACTIONS;
const warn = (msg) => console.log(ci ? `::warning::${msg}` : `WARNUNG: ${msg}`);

/** fetch mit Zeitlimit, damit ein hängender Server den Build nicht aufhält */
const fetchFn = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(30000) });

(async () => {
  const tmp = `${dest}.tmp`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const now = Date.now();
  const report = [];
  let first = true;
  let offline = false;
  for (const prog of WEBAPPS) {
    if (offline) {
      report.push([prog.id, 'offline']);
      continue;
    }
    const t0 = Date.now();
    try {
      const r = await W.crawl(prog, { fetch: fetchFn, origin, cdnOrigin: process.env.WHUB_WEB_CDN || undefined });
      W.commit(tmp, prog, r, { now });
      const size = Object.values(r.files).reduce((n, f) => n + f.size, 0);
      console.log(`${prog.id.padEnd(5)} ${String(Object.keys(r.files).length).padStart(4)} Dateien ${(size / 1024).toFixed(0).padStart(5)} KB  ${Date.now() - t0} ms${r.missing.length ? `  (fehlt auf der Website: ${r.missing.join(', ')})` : ''}`);
      report.push([prog.id, 'ok']);
    } catch (e) {
      report.push([prog.id, e.code || 'failed']);
      if (e.code === 'missing' && prog.soon) console.log(`${prog.id.padEnd(5)} noch nicht auf der Website - kommt später per Update`);
      else warn(`Web-Programm ${prog.id}: ${e.message}`);
      // schon das erste Programm offline: der Rest ist es auch
      if (first && e.code === 'offline') offline = true;
    }
    first = false;
  }
  const idx = W.readIndex(tmp);
  const ok = report.filter(([, r]) => r === 'ok').map(([id]) => id);
  const bad = report.filter(([id, r]) => r !== 'ok' && !(r === 'missing' && WEBAPPS.find((a) => a.id === id).soon));
  idx.built = now;
  idx.note = bad.length ? `ohne ${bad.map(([id, r]) => `${id} (${r})`).join(', ')}` : null;
  W.writeIndex(tmp, idx);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.renameSync(tmp, dest);
  if (!ok.length) warn(`mert.win war nicht erreichbar - W Hub wird OHNE eingebaute Web-Programme gebaut (sie kommen beim ersten Start mit Internet).`);
  else if (bad.length) warn(`Schnappschuss unvollständig: ${idx.note}`);
  console.log(`Web-Programme: ${ok.length}/${WEBAPPS.length} im Schnappschuss -> ${dest}`);
})().catch((e) => {
  // nie den Build scheitern lassen
  warn(`Schnappschuss der Web-Programme fehlgeschlagen: ${e && e.stack ? e.stack : e}`);
  fs.mkdirSync(dest, { recursive: true });
  if (!fs.existsSync(path.join(dest, 'index.json'))) W.writeIndex(dest, { v: 1, apps: {}, files: {}, built: Date.now(), note: 'fehlgeschlagen' });
});
