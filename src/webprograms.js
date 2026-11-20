'use strict';

// Web-Programme im Hauptprozess: eigenes Protokoll whub-web://mert.win/… mit der Website-Wurzel als Basis
// (absolute Pfade wie /app-icons/acryl.css funktionieren), Ausliefern aus dem Speicher (offline), stilles Abgleichen
// mit der Website im Hintergrund und das Vorbereiten der Sitzung (eigener Speicherbereich je Programm).
const fs = require('fs');
const path = require('path');
const { protocol, session, BrowserWindow } = require('electron');
const W = require('./webapps');
const { WEBAPPS, byId } = require('./shared/catalog');

const SCHEME = 'whub-web';
const HOST = 'mert.win';
const BASE = `${SCHEME}://${HOST}`;

/** Muss vor app.whenReady() laufen */
function registerScheme() {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } }]);
}

const textTypes = /^(text\/|application\/(json|manifest\+json|javascript|xml))/;

/**
 * opts: builtinDir (Schnappschuss aus dem Build), userDir (Updates), origin (Quelle, Standard https://mert.win),
 *       onChange(status) bei jeder Änderung, offlinePage(lang) -> HTML, lang() -> Sprache
 */
function create(opts) {
  const origin = (opts.origin || W.SITE).replace(/\/+$/, '');
  const lib = new W.Library(opts.builtinDir, opts.userDir);
  const st = {}; // je Programm: updating, error
  let syncing = null;
  let lastSync = 0;
  const prepared = new WeakSet();
  const cookie = `${W.ACCESS_COOKIE.name}=${W.ACCESS_COOKIE.value}`;

  // ------------------------------------------------ Laden über Chromium (Proxy-Einstellungen des Systems gelten)
  const loader = () => session.fromPartition('whub-websync', { cache: false });
  /** fetch für W.crawl: Umleitungen meldet Electron bei redirect: 'manual' als Fehler, daher nachbilden */
  async function fetchFn(url, init = {}) {
    const res = await loader().fetch(url, { ...init, redirect: 'follow', bypassCustomProtocolHandlers: true, cache: 'no-store' });
    if (init.redirect === 'manual' && res.redirected) {
      try {
        await res.body?.cancel();
      } catch {
        // egal
      }
      return { status: 302, headers: { get: (n) => (String(n).toLowerCase() === 'location' ? res.url : null) }, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    return res;
  }

  // ------------------------------------------------ Ausliefern
  async function serve(req, ses) {
    const u = new URL(req.url);
    let p;
    try {
      p = decodeURIComponent(u.pathname);
    } catch {
      return new Response('', { status: 400 });
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      const e = lib.lookup(p);
      if (e && e.redirect) return new Response(null, { status: 301, headers: { Location: `${BASE}${encodeURI(e.redirect)}${u.search}` } });
      if (e) {
        try {
          const body = req.method === 'HEAD' ? null : await fs.promises.readFile(e.file);
          const type = textTypes.test(e.type) || /javascript/.test(e.type) ? `${e.type}; charset=utf-8` : e.type;
          return new Response(body, { status: 200, headers: { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache', 'X-WHub-Offline': '1' } });
        } catch {
          // Datei weg (gerade aufgeräumt): dann eben online
        }
      }
    }
    if (p.startsWith('/_ext/')) return new Response('', { status: 404 });
    // nicht gespeichert (z. B. /share/api, /help/): online von der Website, mit dem Zugangs-Cookie
    try {
      const headers = new Headers(req.headers);
      headers.set('Cookie', cookie);
      const init = { method: req.method, headers, redirect: 'follow', bypassCustomProtocolHandlers: true };
      if (!['GET', 'HEAD'].includes(req.method) && req.body) {
        init.body = req.body;
        init.duplex = 'half';
      }
      const res = await ses.fetch(`${origin}${u.pathname}${u.search}`, init);
      const h = new Headers(res.headers);
      h.set('Access-Control-Allow-Origin', '*');
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
    } catch {
      const nav = /html/.test(req.headers.get('accept') || '') || p.endsWith('/') || /\.html?$/.test(p);
      if (nav) return new Response(opts.offlinePage(p), { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      return new Response('', { status: 503 });
    }
  }

  /** Sitzung für whub-web vorbereiten: Protokoll, Zugangs-Cookie für Seiten direkt von mert.win, CDN aus dem Speicher */
  function prepare(ses) {
    if (prepared.has(ses)) return;
    prepared.add(ses);
    ses.protocol.handle(SCHEME, (req) => serve(req, ses));
    if (ses !== session.defaultSession) {
      ses.cookies.set({ url: W.SITE, name: W.ACCESS_COOKIE.name, value: W.ACCESS_COOKIE.value, secure: true, sameSite: 'lax', expirationDate: Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 3600 }).catch(() => {});
      // fest versionierte Bibliotheken (jsDelivr & Co.) aus dem Speicher statt aus dem Netz
      ses.webRequest.onBeforeRequest({ urls: W.CDN_HOSTS.map((h) => `https://${h}/*`) }, (d, cb) => {
        const url = d.url.split(/[?#]/)[0];
        const key = W.isCdn(url) ? W.extKey(url) : null;
        const e = key && lib.lookup(key);
        cb(e && !e.redirect ? { redirectURL: `${BASE}${key}` } : {});
      });
    }
  }

  // ------------------------------------------------ Abgleich mit der Website
  async function syncOne(prog) {
    st[prog.id] = { ...(st[prog.id] || {}), updating: true };
    emit();
    try {
      const prev = lib.state(prog.id);
      const r = await W.crawl(prog, { fetch: fetchFn, origin, cdnOrigin: opts.cdnOrigin, known: (p) => lib.known(p) });
      const changed = W.commit(opts.userDir, prog, r, { prev });
      lib.reload();
      st[prog.id] = { updating: false, error: null, changed };
      return changed;
    } catch (e) {
      // offline oder kein Zugang: die gespeicherte Version läuft einfach weiter
      st[prog.id] = { updating: false, error: e.code || 'failed', detail: String(e.message || e).slice(0, 200) };
      return false;
    } finally {
      emit();
    }
  }
  /** Alle Programme still abgleichen. Liefert die Liste der aktualisierten. Offline: nach dem ersten Fehlschlag aufhören. */
  function sync() {
    if (syncing) return syncing;
    syncing = (async () => {
      const updated = [];
      for (const prog of WEBAPPS) {
        const changed = await syncOne(prog);
        if (changed) updated.push(prog.id);
        if (st[prog.id].error === 'offline' && prog.id === WEBAPPS[0].id) {
          for (const p of WEBAPPS.slice(1)) st[p.id] = { updating: false, error: 'offline' };
          break;
        }
      }
      lastSync = Date.now();
      return updated;
    })();
    return syncing.finally(() => {
      syncing = null;
      emit();
    });
  }

  function status() {
    const out = {};
    for (const prog of WEBAPPS) {
      const a = lib.app(prog.id);
      const s = st[prog.id] || {};
      out[prog.id] = {
        available: !!a,
        modified: a ? a.modified : null,
        changed: a ? a.changed : null,
        checked: a ? a.checked : null,
        size: a ? a.size : 0,
        source: a ? a.source : null,
        updating: !!s.updating,
        error: s.error || null,
      };
    }
    return { apps: out, syncing: !!syncing, lastSync };
  }
  let emitTimer = null;
  function emit() {
    clearTimeout(emitTimer);
    emitTimer = setTimeout(() => opts.onChange && opts.onChange(status()), 30);
  }

  const url = (id) => (byId[id] && byId[id].root ? `${BASE}${byId[id].root}` : null);
  /** Pfad auf der Website, falls offline vorhanden (für Links direkt auf https://mert.win/…) */
  const localFor = (href) => {
    try {
      const x = new URL(href);
      if (x.origin !== W.SITE) return null;
      return lib.lookup(decodeURIComponent(x.pathname)) ? `${BASE}${x.pathname}${x.search}${x.hash}` : null;
    } catch {
      return null;
    }
  };
  /** Symbol als Datei (für das Fenster), aus dem Speicher */
  const iconFile = (id) => {
    const prog = byId[id];
    const e = prog && prog.icon && lib.entry(prog.icon);
    return e ? e.file : null;
  };

  /** Alter Speicher (W Hub bis 1.2: online unter https://mert.win) -> neues Protokoll, einmal je Programm.
   *  Nur localStorage (Spielstände, Rekorde, Skins); Ziel-Werte, die es schon gibt, bleiben. */
  async function migrate(id, userData) {
    const mark = path.join(opts.userDir, 'migrated.json');
    let done = {};
    try {
      done = JSON.parse(fs.readFileSync(mark, 'utf8'));
    } catch {
      // noch nichts
    }
    if (done[id]) return;
    const partition = `persist:web-${id}`;
    const old = path.join(userData, 'Partitions', `web-${id}`);
    if (fs.existsSync(path.join(old, 'Local Storage'))) {
      const ses = session.fromPartition(partition);
      prepare(ses);
      const w = new BrowserWindow({ show: false, webPreferences: { partition, sandbox: true, contextIsolation: true } });
      try {
        await ses.protocol.handle('https', () => new Response('<!doctype html><title>W Hub</title>', { headers: { 'Content-Type': 'text/html' } }));
        await w.loadURL(`${W.SITE}/__whub-migrate__`);
        const dump = await w.webContents.executeJavaScript('JSON.stringify(Object.entries(localStorage))');
        ses.protocol.unhandle('https');
        const entries = JSON.parse(dump);
        if (entries.length) {
          await w.loadURL(`${BASE}/__whub-migrate__`).catch(() => {});
          await w.webContents.executeJavaScript(`(() => { for (const [k, v] of ${JSON.stringify(entries)}) if (localStorage.getItem(k) === null) localStorage.setItem(k, v); return true; })()`);
        }
      } catch (e) {
        console.error('Web-Programme: Übernahme des Speichers', id, e.message);
      } finally {
        try {
          if (ses.protocol.isProtocolHandled('https')) ses.protocol.unhandle('https');
        } catch {
          // egal
        }
        if (!w.isDestroyed()) w.destroy();
      }
    }
    done[id] = Date.now();
    fs.mkdirSync(opts.userDir, { recursive: true });
    fs.writeFileSync(mark, JSON.stringify(done));
  }

  return { lib, prepare, sync, syncOne, status, changed: emit, url, localFor, iconFile, migrate, fetchFn, origin, available: (id) => !!lib.app(id) };
}

module.exports = { SCHEME, HOST, BASE, registerScheme, create };
