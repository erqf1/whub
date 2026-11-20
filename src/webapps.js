'use strict';

// Web-Programme (QR-Codes, Skin-Editor, Webgames, …): laden, speichern und wiederfinden.
// Reines Node ohne Electron, damit das Build-Skript (tools/fetch-webapps.js) und der Selbsttest dasselbe benutzen.
//
// Laden: von der Website (https://mert.win/<ordner>/) mit dem Zugangs-Cookie, ausgehend von der Startseite des
// Programms. Gefolgt wird Verweisen aus HTML (href/src/srcset, <style>, <script>), CSS (url(), @import) und JS
// (import, fetch, new URL, importScripts, feste Pfade in Zeichenketten) - nur auf demselben Server.
// Seiten (<a href>) werden nur innerhalb des Programmordners geladen, Dateien (CSS, JS, Bilder) von überall auf dem
// Server (z. B. /app-icons/acryl.css). Geratene Pfade aus JS nur im Programmordner und in /app-icons/.
//
// Speicher: <ordner>/index.json + <ordner>/blobs/<sha256>. Inhalte liegen nach Prüfsumme, gemeinsam benutzte
// Dateien also nur einmal, und ein Update wird erst mit dem Schreiben von index.json gültig (nie halb).
// Es gibt zwei Speicher: den eingebauten Schnappschuss (beim Bauen geladen, nur lesen) und den im Benutzerordner
// (Updates). Je Pfad gilt der zuletzt bestätigte Stand (Feld at).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SITE = 'https://mert.win';
/** Zugang zur Website: nginx prüft dieses Cookie (Code "w", vom Betreiber für W Hub freigegeben) */
const ACCESS_COOKIE = { name: 'w_zugang', value: 'w' };
const SHARED = ['/app-icons/'];
/** Fest versionierte Bibliotheken von CDNs (z. B. qr-code-styling@1.9.2): werden mitgespeichert, damit das Programm
 *  offline läuft. Abgelegt unter /_ext/<host>/<pfad>; das Programmfenster leitet die Anfragen dorthin um. */
const CDN = [
  /^https:\/\/cdn\.jsdelivr\.net\/(?:npm|gh)\/(?:@[\w.-]+\/)?[\w.-]+@\d[\w.-]*\/.+\.(?:js|mjs|css|json|wasm)$/,
  /^https:\/\/unpkg\.com\/(?:@[\w.-]+\/)?[\w.-]+@\d[\w.-]*\/.+\.(?:js|mjs|css|json|wasm)$/,
  /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/[\w.-]+\/\d[\w.-]*\/.+\.(?:js|mjs|css|json|wasm)$/,
];
const CDN_HOSTS = ['cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com'];
const isCdn = (url) => CDN.some((re) => re.test(url));
/** Speicher-Pfad einer CDN-Datei */
const extKey = (url) => {
  const u = new URL(url);
  return `/_ext/${u.host}${u.pathname}`;
};
const LIMITS = { files: 3000, fileBytes: 60 * 1024 * 1024, appBytes: 400 * 1024 * 1024 };

const TYPES = {
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json',
  webmanifest: 'application/manifest+json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm', txt: 'text/plain',
  md: 'text/markdown', xml: 'application/xml', wasm: 'application/wasm', csv: 'text/csv', glb: 'model/gltf-binary', gltf: 'model/gltf+json',
  onnx: 'application/octet-stream', bin: 'application/octet-stream', map: 'application/json',
};
const extOf = (p) => (/\.([a-z0-9]+)$/i.exec(p) || [])[1]?.toLowerCase() || '';
const typeOf = (p, header) => {
  const h = String(header || '').split(';')[0].trim().toLowerCase();
  if (p.endsWith('/')) return 'text/html';
  return TYPES[extOf(p)] || h || 'application/octet-stream';
};
const isHtml = (type) => /html/.test(type);
const isCss = (type) => /css/.test(type);
const isJs = (type) => /javascript|ecmascript/.test(type);
const isText = (type) => isHtml(type) || isCss(type) || isJs(type) || /json|manifest/.test(type);
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// ---------------------------------------------------------------- Verweise finden
const SKIP = /^(#|data:|javascript:|mailto:|tel:|blob:|about:|\{|\$\{)|['"<>`]|\s\+|\+\s/i;
const FILE_LIKE = /^(?:\.{1,2}\/|\/)?[\w@~.%+-]+(?:\/[\w@~.%+-]+)*\/?$/;
const KNOWN_EXT = new RegExp(`\\.(${Object.keys(TYPES).join('|')})$`, 'i');

function cssRefs(text) {
  const out = [];
  for (const m of text.matchAll(/url\(\s*(['"]?)([^'")]+?)\1\s*\)/gi)) out.push(m[2]);
  for (const m of text.matchAll(/@import\s+(?:url\()?\s*['"]([^'"]+)['"]/gi)) out.push(m[1]);
  return out;
}
/** JS: sichere Verweise (relativ zum Skript: import/export … from, import(), new URL(…, import.meta.url)),
 *  Verweise relativ zur Seite (fetch, Worker, importScripts) und geratene feste Pfade in Zeichenketten. */
function jsRefs(text) {
  const mod = [];
  const doc = [];
  const guess = [];
  const q = `(['"\`])([^'"\`\\n$]+)\\1`;
  for (const m of text.matchAll(new RegExp(`\\b(?:import|export)\\s[^;'"\`]*?\\bfrom\\s*${q}`, 'g'))) mod.push(m[2]);
  for (const m of text.matchAll(new RegExp(`\\bimport\\s*${q}`, 'g'))) mod.push(m[2]);
  for (const m of text.matchAll(new RegExp(`\\bimport\\s*\\(\\s*${q}\\s*\\)`, 'g'))) mod.push(m[2]);
  for (const m of text.matchAll(new RegExp(`new\\s+URL\\s*\\(\\s*${q}\\s*,\\s*import\\.meta\\.url`, 'g'))) mod.push(m[2]);
  for (const m of text.matchAll(new RegExp(`\\b(?:fetch|importScripts|Worker|SharedWorker|Audio|EventSource)\\s*\\(\\s*${q}`, 'g'))) doc.push(m[2]);
  for (const m of text.matchAll(/(['"`])([^'"`\n\s$<>(){}]{2,200})\1/g)) {
    const s = m[2];
    if (FILE_LIKE.test(s) && (KNOWN_EXT.test(s) || (s.endsWith('/') && /[a-z0-9]/i.test(s) && !s.startsWith('//')))) guess.push(s);
  }
  const abs = [];
  for (const m of text.matchAll(/(['"`])(https?:\/\/[^'"`\s$<>\\]+)\1/g)) abs.push(m[2]);
  return { mod, doc, guess, abs };
}
/** HTML: Seiten (<a>, <iframe>) und Dateien, dazu Inhalte von <style>, style="" und <script> */
function htmlRefs(text) {
  const nav = [];
  const res = [];
  const js = { mod: [], doc: [], guess: [], abs: [] };
  const attr = /\b(href|src|poster|data-src|srcset|content)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  for (const t of text.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)) {
    const tag = t[1].toLowerCase();
    if (tag === 'meta') {
      // <meta http-equiv="refresh" content="0; url=…">
      const c = /content\s*=\s*["'][^"']*url=([^"';]+)/i.exec(t[2]);
      if (c) nav.push(c[1].trim());
      continue;
    }
    for (const a of t[2].matchAll(attr)) {
      const name = a[1].toLowerCase();
      const v = (a[2] ?? a[3] ?? '').trim();
      if (!v || name === 'content') continue;
      if (name === 'srcset') {
        for (const part of v.split(',')) res.push(part.trim().split(/\s+/)[0]);
        continue;
      }
      if (/^(a|area|iframe|frame)$/.test(tag)) nav.push(v);
      else if (tag === 'link' && /\brel\s*=\s*["']?(?:alternate|canonical|next|prev)\b/i.test(t[2])) nav.push(v);
      else if (tag === 'script' && /type\s*=\s*["']module/i.test(t[2]) && name === 'src') js.mod.push(v);
      else res.push(v);
    }
  }
  for (const m of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) res.push(...cssRefs(m[1]));
  for (const m of text.matchAll(/\bstyle\s*=\s*"([^"]*)"/gi)) res.push(...cssRefs(m[1]));
  for (const m of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/.test(m[1]) || !m[2].trim()) continue;
    const r = jsRefs(m[2]);
    // im Dokument: alles ist relativ zur Seite
    js.doc.push(...r.mod, ...r.doc);
    js.guess.push(...r.guess);
    js.abs.push(...r.abs);
  }
  return { nav, res, js };
}
function manifestRefs(text) {
  try {
    const m = JSON.parse(text);
    return [...(m.icons || []), ...(m.screenshots || [])].map((i) => i && i.src).filter(Boolean).concat(m.start_url ? [m.start_url] : []);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- Laden
class WebError extends Error {
  constructor(code, detail) {
    super(`${code}${detail ? `: ${detail}` : ''}`);
    this.code = code; // access | missing | offline | incomplete | limit
  }
}

/** Header-Zugriff für fetch-Antworten (Node und Electron) */
const hdr = (res, name) => (res.headers && typeof res.headers.get === 'function' ? res.headers.get(name) : null);

/**
 * Ein Web-Programm vollständig laden.
 * prog: { id, root: '/qr/', icon?: '/app-icons/qr-192.png' }
 * opts.fetch(url, { headers, redirect: 'manual' }) wie WHATWG fetch
 * opts.origin: Quelle (Standard https://mert.win), opts.cdnOrigin: nur Selbsttest, opts.known(path) -> { hash, etag, lm, body } | null (für bedingte Anfragen)
 * Liefert { files: { path: { hash, type, size, etag, lm, body } }, external: [hosts], missing: [pfade], modified }.
 */
async function crawl(prog, opts) {
  const origin = (opts.origin || SITE).replace(/\/+$/, '');
  const fetchFn = opts.fetch;
  const known = opts.known || (() => null);
  const conc = opts.concurrency || 6;
  const root = prog.root;
  const files = {};
  const external = new Set();
  const missing = [];
  const ext = new Set();
  const seen = new Set();
  const queue = [];
  let total = 0;
  let failed = null;

  const inScope = (p) => p.startsWith(root);
  const shared = (p) => SHARED.some((s) => p.startsWith(s));
  /** Verweis auflösen; nur gleicher Server, ohne ?Suche und #Anker. null = nicht laden */
  const resolve = (ref, base) => {
    if (!ref || SKIP.test(ref)) return null;
    let u;
    try {
      u = new URL(ref, `${origin}${base}`);
    } catch {
      return null;
    }
    if (u.origin !== origin) {
      if (/^https?:$/.test(u.protocol) && !/^(localhost|127\.|www\.w3\.org$)/.test(u.hostname)) {
        if (isCdn(u.href.split(/[?#]/)[0])) ext.add(u.href.split(/[?#]/)[0]);
        else external.add(u.host);
      }
      return null;
    }
    let p;
    try {
      p = decodeURI(u.pathname);
    } catch {
      return null;
    }
    if (p.includes('..') || p.includes('\0')) return null;
    return p;
  };
  const add = (p, kind) => {
    if (!p || seen.has(p)) return;
    if (kind === 'nav' && !inScope(p)) return;
    if (kind === 'guess' && !inScope(p) && !shared(p)) return;
    // Seiten außerhalb des Ordners nicht als Datei laden (z. B. /help/ über <link>)
    if (kind === 'res' && !inScope(p) && (p.endsWith('/') || /\.html?$/i.test(p))) return;
    seen.add(p);
    queue.push({ p, kind });
  };

  const parse = (p, type, body) => {
    if (!isText(type)) return;
    const text = body.toString('utf8');
    const dir = p.endsWith('/') ? p : p.replace(/[^/]*$/, '');
    if (isHtml(type)) {
      const r = htmlRefs(text);
      for (const x of r.nav) add(resolve(x, dir), 'nav');
      for (const x of r.res) add(resolve(x, dir), 'res');
      for (const x of r.js.mod) add(resolve(x, dir), 'res');
      for (const x of r.js.doc) add(resolve(x, dir), 'guess');
      for (const x of r.js.guess) add(resolve(x, dir), 'guess');
      for (const x of r.js.abs) resolve(x, dir);
    } else if (isCss(type)) {
      for (const x of cssRefs(text)) add(resolve(x, p), 'res');
    } else if (isJs(type)) {
      const r = jsRefs(text);
      for (const x of r.abs) resolve(x, p);
      for (const x of r.mod) add(resolve(x, p), 'res');
      // fetch() & Co. gelten relativ zur Seite, liegen aber oft neben dem Skript: beides versuchen
      for (const x of [...r.doc, ...r.guess]) {
        add(resolve(x, root), 'guess');
        add(resolve(x, p), 'guess');
      }
    } else if (/manifest/.test(type) || /\.webmanifest$/i.test(p)) {
      for (const x of manifestRefs(text)) add(resolve(x, p), 'res');
    }
  };

  const get = async ({ p, kind }, hops = 0) => {
    const k = known(p);
    const headers = { Cookie: `${ACCESS_COOKIE.name}=${ACCESS_COOKIE.value}`, 'Cache-Control': 'no-cache' };
    if (k && k.etag) headers['If-None-Match'] = k.etag;
    if (k && k.lm) headers['If-Modified-Since'] = k.lm;
    let res;
    let body = null;
    // Netzfehler (abgebrochene Verbindung): bis zu dreimal neu versuchen, Inhalt gleich mitlesen
    for (let attempt = 0; ; attempt++) {
      try {
        res = await fetchFn(`${origin}${encodeURI(p)}`, { headers, redirect: 'manual' });
        if (res.status === 200) body = Buffer.from(await res.arrayBuffer());
        break;
      } catch (e) {
        if (attempt >= (p === root ? 1 : 3)) throw new WebError(p === root ? 'offline' : 'incomplete', `${p}: ${e.message}`);
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      }
    }
    const status = res.status;
    if (status === 304 && k && k.body) {
      files[p] = { hash: k.hash, type: k.type || typeOf(p), size: k.body.length, etag: k.etag || null, lm: k.lm || null, body: k.body };
      return parse(p, files[p].type, k.body);
    }
    if (status >= 300 && status < 400) {
      // nginx: /web/snake -> /web/snake/ ist in Ordnung, alles andere (Anmeldeseite) nicht
      const loc = hdr(res, 'location');
      const to = loc ? resolve(loc, p) : null;
      if (to === `${p}/` && hops < 2) {
        add(to, kind === 'guess' ? 'guess' : 'nav');
        return;
      }
      if (p === root) throw new WebError('access', `${status} ${loc || ''}`);
      return;
    }
    if (status === 401 || status === 403) {
      if (p === root || kind !== 'guess') throw new WebError('access', `${p}: ${status}`);
      return;
    }
    if (status === 404 || status === 410) {
      if (p === root) throw new WebError('missing', p);
      if (kind !== 'guess') missing.push(p);
      return;
    }
    if (status !== 200) {
      if (kind === 'guess' && status < 500) return;
      throw new WebError(p === root ? 'offline' : 'incomplete', `${p}: ${status}`);
    }
    const type = typeOf(p, hdr(res, 'content-type'));
    // geraten und als HTML zurück (z. B. Fehlerseite statt Skript): nur Seiten im Ordner behalten
    if (kind === 'guess' && isHtml(type) && !p.endsWith('/') && !/\.html?$/i.test(p)) return;
    if (body.length > LIMITS.fileBytes) throw new WebError('limit', `${p}: ${body.length}`);
    total += body.length;
    if (total > LIMITS.appBytes || Object.keys(files).length >= LIMITS.files) throw new WebError('limit', `${prog.id}: ${total}`);
    files[p] = { hash: sha(body), type, size: body.length, etag: hdr(res, 'etag'), lm: hdr(res, 'last-modified'), body };
    parse(p, type, body);
  };

  add(root, 'nav');
  if (prog.icon) add(prog.icon, 'res');
  add(`${root}app.webmanifest`, 'guess');
  add(`${root}app-sw.js`, 'guess');
  // erst die Startseite (zeigt, ob es das Programm gibt und der Zugang klappt), dann parallel
  await get(queue.shift());
  let active = 0;
  await new Promise((done) => {
    const pump = () => {
      while (!failed && active < conc && queue.length) {
        const job = queue.shift();
        active++;
        get(job).catch((e) => {
          failed = failed || e;
        }).finally(() => {
          active--;
          pump();
        });
      }
      if (active === 0) done();
    };
    pump();
  });
  if (failed) throw failed;
  // CDN-Dateien: ohne Cookie (anderer Server). Klappt das nicht, bleibt der bekannte Stand; fehlt er, eben ohne.
  await Promise.all([...ext].map(async (url) => {
    const key = extKey(url);
    const k = known(key);
    try {
      // opts.cdnOrigin: nur für den Selbsttest (CDN vom Testserver statt aus dem Internet)
      const from = opts.cdnOrigin ? url.replace(/^https:\/\/[^/]+/, `${opts.cdnOrigin.replace(/\/+$/, '')}/_cdn/${new URL(url).host}`) : url;
      const res = await fetchFn(from, { headers: k && k.etag ? { 'If-None-Match': k.etag } : {}, redirect: 'follow' });
      if (res.status === 304 && k && k.body) {
        files[key] = { hash: k.hash, type: k.type, size: k.body.length, etag: k.etag || null, lm: k.lm || null, body: k.body, url };
        return;
      }
      if (res.status !== 200) throw new Error(String(res.status));
      const body = Buffer.from(await res.arrayBuffer());
      if (body.length > LIMITS.fileBytes) throw new Error('zu groß');
      files[key] = { hash: sha(body), type: typeOf(key, hdr(res, 'content-type')), size: body.length, etag: hdr(res, 'etag'), lm: null, body, url };
    } catch {
      if (k && k.body) files[key] = { hash: k.hash, type: k.type, size: k.body.length, etag: k.etag || null, lm: k.lm || null, body: k.body, url };
      else external.add(new URL(url).host);
    }
  }));
  let modified = 0;
  for (const f of Object.values(files)) {
    if (f.url) continue;
    const t = f.lm ? Date.parse(f.lm) : NaN;
    if (t > modified) modified = t;
  }
  return { files, external: [...external].sort(), missing, modified: modified || null };
}

// ---------------------------------------------------------------- Speicher
function readIndex(dir) {
  try {
    const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
    return { v: 1, apps: idx.apps || {}, files: idx.files || {}, built: idx.built || null, note: idx.note || null };
  } catch {
    return { v: 1, apps: {}, files: {}, built: null, note: null };
  }
}
function writeIndex(dir, idx) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'index.json');
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(idx));
  fs.renameSync(`${file}.tmp`, file);
}
const blobFile = (dir, hash) => path.join(dir, 'blobs', hash);

/** Ergebnis von crawl() für ein Programm in einen Speicher schreiben. Liefert true, wenn sich etwas geändert hat
 *  (prev = bisheriger gültiger Stand dieses Programms, { paths: { pfad: hash } }). */
function commit(dir, prog, result, { now = Date.now(), prev = null } = {}) {
  const idx = readIndex(dir);
  fs.mkdirSync(path.join(dir, 'blobs'), { recursive: true });
  const paths = Object.keys(result.files).sort();
  for (const p of paths) {
    const f = result.files[p];
    const b = blobFile(dir, f.hash);
    if (!fs.existsSync(b)) {
      fs.writeFileSync(`${b}.tmp`, f.body);
      fs.renameSync(`${b}.tmp`, b);
    }
    idx.files[p] = { hash: f.hash, type: f.type, size: f.size, etag: f.etag || null, lm: f.lm || null, at: now };
  }
  const old = idx.apps[prog.id];
  let changed = !prev || Object.keys(prev.paths || {}).length !== paths.length || paths.some((p) => prev.paths[p] !== result.files[p].hash);
  idx.apps[prog.id] = {
    at: now,
    checked: now,
    changed: changed ? now : (old && old.changed) || (prev && prev.changed) || now,
    modified: result.modified,
    size: paths.reduce((n, p) => n + result.files[p].size, 0),
    paths,
    external: result.external,
  };
  // Pfade, die kein Programm mehr braucht, und Inhalte ohne Pfad wegräumen
  const used = new Set(Object.values(idx.apps).flatMap((a) => a.paths || []));
  for (const p of Object.keys(idx.files)) if (!used.has(p)) delete idx.files[p];
  writeIndex(dir, idx);
  const hashes = new Set(Object.values(idx.files).map((f) => f.hash));
  try {
    for (const name of fs.readdirSync(path.join(dir, 'blobs'))) if (!hashes.has(name)) fs.rmSync(path.join(dir, 'blobs', name), { force: true });
  } catch {
    // egal
  }
  return changed;
}
/** Nur "geprüft" vermerken (z. B. offline oder unverändert, ohne etwas neu zu schreiben) */
function markChecked(dir, id, now = Date.now()) {
  const idx = readIndex(dir);
  if (!idx.apps[id]) return;
  idx.apps[id].checked = now;
  writeIndex(dir, idx);
}

/** Beide Speicher zusammen: eingebauter Schnappschuss + Updates im Benutzerordner */
class Library {
  constructor(builtinDir, userDir) {
    this.dirs = [builtinDir, userDir].filter(Boolean);
    this.userDir = userDir;
    this.reload();
  }
  reload() {
    this.idx = this.dirs.map((d) => ({ dir: d, ...readIndex(d) }));
  }
  /** Eintrag für einen Pfad: der zuletzt bestätigte aus beiden Speichern, dessen Inhalt auch da ist */
  entry(p) {
    let best = null;
    for (const s of this.idx) {
      const f = s.files[p];
      if (f && (!best || (f.at || 0) >= (best.at || 0))) {
        const file = this.blob(f.hash);
        if (file) best = { ...f, file };
      }
    }
    return best;
  }
  blob(hash) {
    for (const s of [...this.idx].reverse()) {
      const b = blobFile(s.dir, hash);
      if (fs.existsSync(b)) return b;
    }
    return null;
  }
  /** Was zu einem Pfad ausgeliefert wird: Datei, Ordner-Seite oder Umleitung auf "pfad/" */
  lookup(p) {
    const e = this.entry(p) || (p.endsWith('/') ? this.entry(`${p}index.html`) : null);
    if (e) return e;
    if (!p.endsWith('/') && (this.entry(`${p}/`) || this.entry(`${p}/index.html`))) return { redirect: `${p}/` };
    return null;
  }
  /** Stand eines Programms (aus dem neueren Speicher) */
  app(id) {
    let best = null;
    for (const s of this.idx) {
      const a = s.apps[id];
      if (a && (!best || (a.at || 0) >= (best.at || 0))) best = { ...a, source: s.dir === this.userDir ? 'user' : 'builtin' };
    }
    if (!best) return null;
    // geprüft: das spätere von beiden
    best.checked = Math.max(...this.idx.map((s) => (s.apps[id] && s.apps[id].checked) || 0));
    return best;
  }
  /** Bekannter Stand eines Pfades für bedingte Anfragen (mit Inhalt) */
  known(p) {
    const e = this.entry(p);
    if (!e) return null;
    try {
      return { ...e, body: fs.readFileSync(e.file) };
    } catch {
      return null;
    }
  }
  /** Bisheriger Stand eines Programms als { paths: { pfad: hash } } */
  state(id) {
    const a = this.app(id);
    if (!a) return null;
    const paths = {};
    for (const p of a.paths || []) {
      const e = this.entry(p);
      if (e) paths[p] = e.hash;
    }
    return { paths, changed: a.changed };
  }
}

module.exports = { SITE, ACCESS_COOKIE, SHARED, CDN_HOSTS, isCdn, extKey, LIMITS, WebError, crawl, commit, markChecked, readIndex, writeIndex, Library, htmlRefs, cssRefs, jsRefs, typeOf };
