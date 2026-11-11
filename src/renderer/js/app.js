// W Hub - Oberfläche: Leiste links (Meine Programme, Entdecken, Updates), Suche oben,
// Start-Kacheln mit Ordnern, Katalog-Kacheln mit Filter/Sortierung, App-Seiten.
import { h, $, dialog, confirm, prompt, toast, showMenu } from './ui.js';
import { applyTheme, ACCENTS } from './theme.js';
import { icon, logoSvg } from './icons.js';
import { markdown } from './md.js';
import i18n from '../../shared/i18n.js';
import C from '../../shared/catalog.js';

const api = window.api;
const ASSETS = '../../assets';

let settings = {};
let info = {};
let hub = { releases: {}, installed: {}, jobs: {}, checked: 0, error: null, sys: {} };
let view = 'home';
let current = null;
let currentFolder = null;
let lastList = 'home';
let query = '';
let booted = false;

const t = (key, vars) => i18n.t(settings.language, key, vars);
const L = () => (settings.language === 'de' ? 'de' : settings.language || 'en');
const txt = (obj) => C.loc(obj, settings.language);
const ver = (tag) => String(tag || '').replace(/^v/, '');
// Tags wie "installer" sind keine Version: dann nichts anzeigen
const shown = (rel) => (rel && C.parseVersion(rel.tag) ? ver(rel.tag) : '');

// ---------------------------------------------------------------- Einstellungen
function withDefaults(s) {
  const out = { ...s };
  out.language ||= i18n.LANGS.map(([c]) => c).find((c) => navigator.language.toLowerCase().startsWith(c)) || 'en';
  out.mode ||= 'system';
  out.look ||= 'standard';
  out.accent ||= ACCENTS[0];
  out.checkOnStart ??= true;
  out.notify ??= true;
  out.allUsers ??= false;
  out.keepInstallers ??= false;
  out.autoUpdate ??= false;
  out.startWithSystem ??= false;
  out.installDir ??= '';
  out.folders = Array.isArray(out.folders) ? out.folders : [];
  out.homeOrder = Array.isArray(out.homeOrder) ? out.homeOrder : [];
  out.hidden = Array.isArray(out.hidden) ? out.hidden : [];
  out.discoverFilter ||= 'all';
  out.discoverSort ||= 'default';
  return out;
}
function saveSettings() {
  api.setSettings(settings);
}
function theme() {
  const dark = settings.mode === 'dark' || (settings.mode === 'system' && info.dark);
  applyTheme(settings.accent, dark, settings.look);
}

// ---------------------------------------------------------------- Stand je App
function latest(id) {
  const list = hub.releases[id] || [];
  return list.find((r) => !r.prerelease) || list[0] || null;
}
/** kind: web | none | installed | update | unavailable | unknown */
function status(app) {
  if (!app.repo) return { kind: 'web' };
  const have = hub.installed[app.id];
  const rel = latest(app.id);
  const asset = rel ? C.pickAsset(app, rel.assets, hub.sys) : null;
  if (have) {
    if (rel && asset && C.newer(rel.tag, have.version)) return { kind: 'update', have, rel, asset };
    return { kind: 'installed', have, rel, asset };
  }
  if (!rel) return { kind: 'unknown' };
  if (!asset) return { kind: 'unavailable', rel };
  return { kind: 'none', rel, asset };
}
const activeJob = (id) => {
  const j = hub.jobs[id];
  return j && ['queued', 'download', 'install', 'uninstall', 'move'].includes(j.phase) ? j : null;
};
function updateList() {
  return C.APPS.filter((a) => status(a).kind === 'update');
}
function humanSize(n) {
  if (!n) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1000 && i < units.length - 1) {
    n /= 1000;
    i++;
  }
  return `${n.toLocaleString(settings.language, { maximumFractionDigits: i > 1 ? 1 : 0 })} ${units[i]}`;
}
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(settings.language, { day: 'numeric', month: 'long', year: 'numeric' }) : '');
const iconImg = (app, size) => h('img', { class: 'app-ico', src: `${ASSETS}/icons/${app.id}.png`, width: size, height: size, alt: '', draggable: 'false' });

/** Liegt der Ordner eines installierten Programms im gemeinsamen Installationsordner? */
function inInstallDir(have) {
  if (!settings.installDir || !have || !have.location) return true;
  const norm = (p) => String(p).replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase();
  const base = norm(settings.installDir);
  const loc = norm(have.location);
  return loc === base || loc.startsWith(`${base}\\`);
}
/** Installierte Programme, die (noch) nicht im gemeinsamen Ordner liegen */
function outsideInstallDir() {
  if (info.platform !== 'win32' || !settings.installDir) return [];
  return C.APPS.filter((a) => hub.installed[a.id] && !inInstallDir(hub.installed[a.id]) && (hub.installed[a.id].managed || ['inno', 'nsis'].includes(a.win?.kind)));
}

// ---------------------------------------------------------------- Aktionen
async function doInstall(app) {
  await api.install(app.id);
}
async function doUninstall(app) {
  const r = await confirm(t('uninstallTitle', { app: app.name }), t('uninstallMsg', { app: app.name }), [
    { label: t('cancel'), value: 'cancel' },
    { label: t('uninstall'), value: 'ok', danger: true },
  ]);
  if (r === 'ok') await api.uninstall(app.id);
}
async function doOpen(app) {
  const ok = await api.open(app.id);
  if (!ok) toast(t('errOpen'), { kind: 'error' });
}
const openWeb = (url) => api.openExternal(url);
/** Web-App im eigenen Fenster (wie mit Webline geöffnet) */
const openWebApp = (app, url) => api.web(app.id, url || app.web);
async function askMove(apps) {
  if (!apps.length) return;
  const r = await confirm(t('moveTitle'), t('moveMsg', { list: apps.map((a) => a.name).join(', '), dir: settings.installDir }), [
    { label: t('cancel'), value: 'cancel' },
    { label: t('move'), value: 'ok', primary: true },
  ]);
  if (r === 'ok') await api.move(apps.map((a) => a.id));
}
/** Kachel auf der Startseite anklicken: Programm oder Web-App starten */
function launch(app) {
  if (app.category === 'web') return openWebApp(app);
  if (hub.installed[app.id]) return doOpen(app);
  return go('app', app.id);
}

/** Hauptknopf einer App, je nach Zustand. compact = Kachel */
function actionNode(app, compact) {
  const wrap = h('div', { class: `act${compact ? ' compact' : ''}`, 'data-job': app.id });
  const job = activeJob(app.id);
  if (job) {
    const pct = job.total ? Math.min(100, Math.round((job.got / job.total) * 100)) : 0;
    const label = job.phase === 'queued' ? t('queued') : job.phase === 'download' ? t('downloading', { pct }) : job.phase === 'uninstall' ? t('removing') : job.phase === 'move' ? t('moving') : t('installing');
    const bar = h('div', { class: `progress${['install', 'uninstall', 'move'].includes(job.phase) ? ' busy' : ''}` }, h('i', { style: { width: `${job.phase === 'download' ? pct : 100}%` } }));
    wrap.append(h('div', { class: 'job' }, h('span', { class: 'job-label', text: label }), bar));
    if (job.phase === 'queued' || job.phase === 'download') wrap.append(h('button', { class: 'icon-btn small', title: t('cancel'), onclick: (e) => { e.stopPropagation(); api.cancel(app.id); } }, icon('close', 15)));
    return wrap;
  }
  const s = status(app);
  const btn = (label, cls, run) => h('button', { class: `btn ${cls}`, onclick: (e) => { e.stopPropagation(); run(); } }, label);
  if (s.kind === 'web') wrap.append(btn(t('open'), 'primary', () => openWebApp(app)));
  else if (s.kind === 'update') wrap.append(btn(t('update'), 'primary', () => doInstall(app)));
  else if (s.kind === 'installed') wrap.append(btn(t('open'), '', () => doOpen(app)));
  else if (s.kind === 'none') wrap.append(btn(hub.sys.platform === 'win32' || app.win?.kind === 'portable' ? t('install') : t('download'), 'primary', () => doInstall(app)));
  else if (s.kind === 'unavailable' && app.web) wrap.append(btn(t('openAsApp'), '', () => openWebApp(app)));
  else if (s.kind === 'unknown') wrap.append(h('span', { class: 'muted small', text: hub.checked ? '' : t('loading') }));
  return wrap;
}
function statusLine(app) {
  const job = hub.jobs[app.id];
  if (job && job.phase === 'error') {
    const msg = t(`err_${job.error}`, { detail: job.detail || '' });
    return h('span', { class: 'st error', title: msg }, icon('alert', 13), h('span', { class: 'st-msg', text: msg }));
  }
  const s = status(app);
  if (s.kind === 'web') return h('span', { class: 'st' }, t('webApp'));
  if (s.kind === 'update') return h('span', { class: 'st up' }, t('fromTo', { from: s.have.version, to: ver(s.rel.tag) }));
  if (s.kind === 'installed') return h('span', { class: 'st ok' }, t('installedVersion', { version: s.have.version }));
  if (s.kind === 'none' || s.kind === 'unavailable') return h('span', { class: 'st' }, `${t('notInstalled')}${shown(s.rel) ? ` · ${shown(s.rel)}` : ''}`);
  return h('span', { class: 'st' }, '');
}

// ---------------------------------------------------------------- Katalog-Kacheln
function card(app) {
  return h('div', { class: `card${app.legacy ? ' legacy' : ''}`, tabindex: '0', 'data-app': app.id, onclick: () => go('app', app.id), onkeydown: (e) => { if (e.key === 'Enter') go('app', app.id); } },
    h('div', { class: 'card-top' }, iconImg(app, 52),
      h('div', { class: 'card-txt' },
        h('div', { class: 'card-name' }, app.name, app.legacy ? h('span', { class: 'badge', text: t('legacy') }) : null),
        h('div', { class: 'card-tag', text: txt(app.tagline) }))),
    h('div', { class: 'card-foot' }, statusLine(app), actionNode(app, true)));
}
const grid = (apps) => h('div', { class: 'grid' }, apps.map(card));

function section(title, apps, extra) {
  if (!apps.length) return null;
  return h('section', { class: 'sect' }, h('div', { class: 'sect-head' }, h('h2', { text: title }), extra || null), grid(apps));
}

function matches(app, q) {
  const hay = `${app.name} ${txt(app.tagline)} ${app.tagline.en} ${app.tagline.de || ''} ${app.keywords || ''}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

// ---------------------------------------------------------------- Meine Programme: Kacheln, Ordner, Reihenfolge
const folderById = (id) => settings.folders.find((f) => f.id === id);
const folderOf = (appId) => settings.folders.find((f) => f.apps.includes(appId));
/** Was auf "Meine Programme" gehört: installierte Programme und Web-Apps (außer ausgeblendeten) */
function homeApps() {
  return C.APPS.filter((a) => (hub.installed[a.id] || a.category === 'web') && !settings.hidden.includes(a.id));
}
const appKey = (id) => id;
const folderKey = (id) => `f:${id}`;
/** Einträge der obersten Ebene in der gespeicherten Reihenfolge: Ordner und Apps ohne Ordner */
function topEntries() {
  const visible = homeApps();
  const entries = [
    ...settings.folders.map((f) => ({ key: folderKey(f.id), folder: f })),
    ...visible.filter((a) => !folderOf(a.id)).map((a) => ({ key: appKey(a.id), app: a })),
  ];
  const pos = (k) => {
    const i = settings.homeOrder.indexOf(k);
    return i < 0 ? 1e6 : i;
  };
  return entries.map((e, i) => [e, i]).sort((x, y) => pos(x[0].key) - pos(y[0].key) || x[1] - y[1]).map(([e]) => e);
}
function folderApps(f) {
  const visible = new Set(homeApps().map((a) => a.id));
  return f.apps.filter((id) => visible.has(id) && C.byId[id]).map((id) => C.byId[id]);
}
/** aktuelle Reihenfolge festschreiben (damit neue Einträge hinten landen) */
function commitOrder(keys) {
  settings.homeOrder = keys;
  saveSettings();
}
function newFolderId() {
  let i = 1;
  while (folderById(`f${i}`)) i++;
  return `f${i}`;
}
async function createFolder(withApp) {
  const name = await prompt(t('newFolder'), t('folderName'), t('folderDefault'), { okLabel: 'OK', cancelLabel: t('cancel') });
  if (name == null) return null;
  return addFolder(name.trim() || t('folderDefault'), withApp);
}
function addFolder(name, withApp) {
  const id = newFolderId();
  if (withApp) removeFromFolders(withApp);
  settings.folders.push({ id, name, apps: withApp ? [withApp] : [] });
  const keys = topEntries().map((e) => e.key).filter((k) => k !== folderKey(id) && k !== appKey(withApp));
  commitOrder([...keys, folderKey(id)]);
  render();
  return id;
}
function removeFromFolders(appId) {
  for (const f of settings.folders) f.apps = f.apps.filter((x) => x !== appId);
}
function moveToFolder(appId, folderId) {
  const f = folderById(folderId);
  if (!f) return;
  removeFromFolders(appId);
  f.apps.push(appId);
  saveSettings();
  render();
}
function takeOutOfFolder(appId) {
  const f = folderOf(appId);
  if (!f) return;
  const keys = topEntries().map((e) => e.key);
  removeFromFolders(appId);
  // direkt hinter dem Ordner einsortieren
  const i = keys.indexOf(folderKey(f.id));
  keys.splice(i + 1, 0, appKey(appId));
  commitOrder(keys);
  render();
}
async function renameFolder(f) {
  const name = await prompt(t('rename'), t('folderName'), f.name, { okLabel: 'OK', cancelLabel: t('cancel') });
  if (name == null || !name.trim()) return;
  f.name = name.trim();
  saveSettings();
  render();
}
async function deleteFolder(f) {
  const r = await confirm(t('deleteFolder'), t('deleteFolderMsg'), [{ label: t('cancel'), value: 'cancel' }, { label: t('deleteFolder'), value: 'ok', danger: true }]);
  if (r !== 'ok') return;
  const keys = topEntries().map((e) => e.key);
  const i = keys.indexOf(folderKey(f.id));
  keys.splice(i, 1, ...f.apps.map(appKey));
  settings.folders = settings.folders.filter((x) => x !== f);
  commitOrder(keys);
  if (view === 'folder' && currentFolder === f.id) go('home');
  else render();
}

/** Ziehen & Ablegen: Kachel auf Ordner (hinein), auf Kachel (davor/dahinter), auf "Meine Programme" (aus Ordner) */
let dragKey = null;
function dragSource(el, key) {
  el.setAttribute('draggable', 'true');
  el.addEventListener('dragstart', (e) => {
    dragKey = key;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', key);
    requestAnimationFrame(() => el.classList.add('dragging'));
  });
  el.addEventListener('dragend', () => {
    dragKey = null;
    el.classList.remove('dragging');
    document.querySelectorAll('.drop-into, .drop-before, .drop-after').forEach((x) => x.classList.remove('drop-into', 'drop-before', 'drop-after'));
  });
}
function dropTarget(el, { accepts, onDrop, side }) {
  const clear = () => el.classList.remove('drop-into', 'drop-before', 'drop-after');
  const where = (e) => {
    if (!side) return 'into';
    const r = el.getBoundingClientRect();
    return e.clientX < r.left + r.width / 2 ? 'before' : 'after';
  };
  el.addEventListener('dragover', (e) => {
    const k = dragKey || e.dataTransfer.getData('text/plain');
    if (!k || !accepts(k)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clear();
    el.classList.add(`drop-${where(e)}`);
  });
  el.addEventListener('dragleave', (e) => {
    if (!el.contains(e.relatedTarget)) clear();
  });
  el.addEventListener('drop', (e) => {
    const k = dragKey || e.dataTransfer.getData('text/plain');
    clear();
    if (!k || !accepts(k)) return;
    e.preventDefault();
    e.stopPropagation();
    onDrop(k, where(e));
  });
}
/** Reihenfolge der obersten Ebene: k vor/hinter target */
function reorderTop(k, targetKey, where) {
  const appId = k.startsWith('f:') ? null : k;
  if (appId && folderOf(appId)) removeFromFolders(appId);
  const keys = topEntries().map((e) => e.key).filter((x) => x !== k);
  let i = keys.indexOf(targetKey);
  if (i < 0) i = keys.length;
  keys.splice(where === 'after' ? i + 1 : i, 0, k);
  commitOrder(keys);
  render();
}
/** Reihenfolge innerhalb eines Ordners */
function reorderInFolder(f, appId, targetId, where) {
  removeFromFolders(appId);
  const i = f.apps.indexOf(targetId);
  f.apps.splice(i < 0 ? f.apps.length : where === 'after' ? i + 1 : i, 0, appId);
  saveSettings();
  render();
}

function tile(app, folder) {
  const s = status(app);
  const job = activeJob(app.id);
  const el = h('div', { class: `tile${app.legacy ? ' legacy' : ''}`, tabindex: '0', 'data-app': app.id, title: txt(app.tagline),
    onclick: () => launch(app),
    onkeydown: (e) => { if (e.key === 'Enter') launch(app); },
    oncontextmenu: (e) => { e.preventDefault(); tileMenu(app, folder, e.clientX, e.clientY); } },
  h('div', { class: 'tile-ico' }, iconImg(app, 60), s.kind === 'update' ? h('span', { class: 'tile-dot', title: t('update') }) : null),
  h('div', { class: 'tile-name', text: app.name }),
  job ? h('div', { class: `progress tile-progress${job.phase === 'download' ? '' : ' busy'}`, 'data-tilejob': app.id }, h('i', { style: { width: `${job.phase === 'download' && job.total ? Math.round((job.got / job.total) * 100) : 100}%` } })) : null,
  h('button', { class: 'icon-btn small tile-more menu-anchor', title: t('more'), onclick: (e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.classList.add('open');
    tileMenu(app, folder, r.right, r.bottom + 4, true);
  } }, icon('more', 16)));
  dragSource(el, appKey(app.id));
  if (folder) dropTarget(el, { side: true, accepts: (k) => !k.startsWith('f:') && k !== app.id, onDrop: (k, where) => reorderInFolder(folder, k, app.id, where) });
  else dropTarget(el, { side: true, accepts: (k) => k !== app.id, onDrop: (k, where) => reorderTop(k, appKey(app.id), where) });
  return el;
}

function folderTile(f) {
  const apps = folderApps(f);
  const el = h('div', { class: 'tile folder', tabindex: '0', 'data-folder': f.id,
    onclick: () => go('folder', f.id),
    onkeydown: (e) => { if (e.key === 'Enter') go('folder', f.id); },
    oncontextmenu: (e) => { e.preventDefault(); folderMenu(f, e.clientX, e.clientY); } },
  h('div', { class: 'folder-ico' }, apps.slice(0, 4).map((a) => iconImg(a, 26))),
  h('div', { class: 'tile-name' }, h('span', { text: f.name }), h('span', { class: 'tile-count', text: String(apps.length) })),
  h('button', { class: 'icon-btn small tile-more menu-anchor', title: t('more'), onclick: (e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.classList.add('open');
    folderMenu(f, r.right, r.bottom + 4, true);
  } }, icon('more', 16)));
  dragSource(el, folderKey(f.id));
  // Programm auf den Ordner: hinein; Ordner auf den Ordner: Reihenfolge
  dropTarget(el, { side: false, accepts: (k) => k !== folderKey(f.id), onDrop: (k) => (k.startsWith('f:') ? reorderTop(k, folderKey(f.id), 'before') : moveToFolder(k, f.id)) });
  return el;
}

function tileMenu(app, folder, x, y, alignRight = false) {
  const s = status(app);
  const have = hub.installed[app.id];
  const items = [{ label: t('open'), run: () => launch(app) }];
  if (s.kind === 'update' && !activeJob(app.id)) items.push({ label: t('update'), run: () => doInstall(app) });
  items.push({ label: t('details'), run: () => go('app', app.id) });
  items.push('-');
  const folderItems = settings.folders.filter((f) => f !== folder).map((f) => ({ label: f.name, run: () => moveToFolder(app.id, f.id) }));
  items.push({ label: t('moveToFolder'), submenu: [...folderItems, ...(folderItems.length ? ['-'] : []), { label: `${t('newFolder')} …`, run: () => createFolder(app.id) }] });
  if (folder) items.push({ label: t('removeFromFolder'), run: () => takeOutOfFolder(app.id) });
  if (app.category === 'web') items.push({ label: t('hideFromHome'), run: () => { settings.hidden = [...settings.hidden, app.id]; removeFromFolders(app.id); saveSettings(); render(); } });
  if (have && hub.sys.platform === 'win32' && !activeJob(app.id)) {
    items.push('-');
    items.push({ label: t('showInFolder'), run: () => api.reveal(app.id) });
    if (!inInstallDir(have)) items.push({ label: t('moveHere'), run: () => askMove([app]) });
    items.push({ label: t('uninstall'), run: () => doUninstall(app) });
  }
  showMenu(items, x, y, { alignRight });
}
function folderMenu(f, x, y, alignRight = false) {
  showMenu([
    { label: t('open'), run: () => go('folder', f.id) },
    { label: t('rename'), run: () => renameFolder(f) },
    '-',
    { label: t('deleteFolder'), run: () => deleteFolder(f) },
  ], x, y, { alignRight });
}

function newFolderButton() {
  const b = h('button', { class: 'btn', id: 'new-folder', onclick: () => createFolder() }, icon('folder', 15), t('newFolder'));
  // Programm auf "Neuer Ordner" ziehen: Ordner mit diesem Programm anlegen
  dropTarget(b, { accepts: (k) => !k.startsWith('f:'), onDrop: (k) => createFolder(k) });
  return b;
}

function viewHome() {
  const out = [];
  const ups = updateList();
  if (ups.length) {
    out.push(h('div', { class: 'banner' }, icon('updates', 18), h('span', { text: ups.length === 1 ? t('updates1') : t('updatesN', { n: ups.length }) }),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: () => go('updates') }, t('updates')),
      h('button', { class: 'btn primary', onclick: () => ups.forEach((a) => api.install(a.id)) }, t('updateAll'))));
  }
  const entries = topEntries();
  const head = h('div', { class: 'sect-head' }, h('h2', { text: t('myApps') }), newFolderButton());
  if (!entries.length) {
    out.push(h('section', { class: 'sect' }, head, h('div', { class: 'empty' }, icon('apps', 28), h('p', { text: hub.checked ? t('homeEmpty') : t('loading') }),
      h('button', { class: 'btn primary', onclick: () => go('discover') }, t('discover')))));
    return out;
  }
  const tiles = h('div', { class: 'tiles' }, entries.map((e) => (e.folder ? folderTile(e.folder) : tile(e.app, null))));
  out.push(h('section', { class: 'sect' }, head, tiles, h('p', { class: 'hint muted small', text: t('dragHint') })));
  const hidden = settings.hidden.filter((id) => C.byId[id]);
  if (hidden.length) {
    out.push(h('div', { class: 'hidden-row muted small' }, hidden.map((id) => h('button', { class: 'btn ghost small-btn', title: t('addToHome'), onclick: () => { settings.hidden = settings.hidden.filter((x) => x !== id); saveSettings(); render(); } }, `+ ${C.byId[id].name}`))));
  }
  return out;
}

function viewFolder(f) {
  if (!f) return viewHome();
  const crumb = h('button', { class: 'btn ghost crumb', onclick: () => go('home') }, icon('back', 16), t('myApps'));
  // Kachel auf "Meine Programme" ziehen: aus dem Ordner nehmen
  dropTarget(crumb, { accepts: (k) => !k.startsWith('f:') && f.apps.includes(k), onDrop: (k) => takeOutOfFolder(k) });
  const apps = folderApps(f);
  const head = h('div', { class: 'sect-head' }, h('h2', {}, icon('folder', 16), h('span', { text: f.name })),
    h('button', { class: 'icon-btn menu-anchor', title: t('more'), onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); e.currentTarget.classList.add('open'); folderMenu(f, r.right, r.bottom + 4, true); } }, icon('more', 18)));
  const body = apps.length ? h('div', { class: 'tiles' }, apps.map((a) => tile(a, f))) : h('div', { class: 'empty' }, icon('folder', 28), h('p', { text: t('dragHint') }));
  return [h('div', { class: 'back-row' }, crumb), h('section', { class: 'sect folder-view' }, head, body)];
}

// ---------------------------------------------------------------- Entdecken (ein Tab: Filter + Sortierung)
const FILTERS = [['all', 'all'], ['apps', 'programs'], ['games', 'games'], ['web', 'inBrowser']];
function sortedApps(list) {
  const out = [...list];
  if (settings.discoverSort === 'name') out.sort((a, b) => a.name.localeCompare(b.name, settings.language));
  else if (settings.discoverSort === 'updated') {
    const d = (a) => (latest(a.id) ? new Date(latest(a.id).date).getTime() || 0 : 0);
    out.sort((a, b) => d(b) - d(a) || a.name.localeCompare(b.name));
  }
  return out;
}
function viewDiscover() {
  const ups = updateList();
  const out = [];
  if (ups.length) {
    out.push(h('div', { class: 'banner' }, icon('updates', 18), h('span', { text: ups.length === 1 ? t('updates1') : t('updatesN', { n: ups.length }) }),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: () => go('updates') }, t('updates')),
      h('button', { class: 'btn primary', onclick: () => ups.forEach((a) => api.install(a.id)) }, t('updateAll'))));
  }
  const bar = h('div', { class: 'toolbar' },
    h('div', { class: 'chips' }, FILTERS.map(([f, label]) => h('button', { class: `fchip${settings.discoverFilter === f ? ' on' : ''}`, 'data-filter': f, onclick: () => { settings.discoverFilter = f; saveSettings(); render(); } }, t(label)))),
    h('span', { class: 'spacer' }),
    h('label', { class: 'sort' }, h('span', { class: 'muted small', text: t('sortBy') }),
      h('select', { id: 'sort', onchange: (e) => { settings.discoverSort = e.target.value; saveSettings(); render(); } },
        [['default', t('sortDefault')], ['name', t('sortName')], ['updated', t('sortUpdated')]].map(([v, l]) => h('option', { value: v, selected: settings.discoverSort === v ? 'selected' : null }, l)))));
  out.push(bar);
  const f = settings.discoverFilter;
  if (f === 'all' && settings.discoverSort === 'default') {
    out.push(section(t('programs'), C.APPS.filter((a) => a.category === 'apps' && !a.legacy)));
    out.push(section(t('games'), C.APPS.filter((a) => a.category === 'games' && !a.legacy)));
    out.push(section(t('inBrowser'), C.APPS.filter((a) => a.category === 'web')));
    out.push(section(t('legacy'), C.APPS.filter((a) => a.legacy)));
  } else {
    const list = C.APPS.filter((a) => f === 'all' || a.category === f);
    out.push(h('section', { class: 'sect' }, grid(sortedApps(list))));
  }
  return out;
}
function viewSearch() {
  const hits = C.APPS.filter((a) => matches(a, query));
  if (!hits.length) return [h('div', { class: 'empty' }, icon('search', 28), h('p', { text: t('noResults', { q: query }) }))];
  return [section(`${t('search')}: ${query}`, hits)];
}

function row(app, right) {
  return h('div', { class: 'row', tabindex: '0', 'data-app': app.id, onclick: () => go('app', app.id), onkeydown: (e) => { if (e.key === 'Enter') go('app', app.id); } },
    iconImg(app, 40),
    h('div', { class: 'row-txt' }, h('div', { class: 'row-name', text: app.name }), statusLine(app)),
    right);
}
function viewUpdates() {
  const ups = updateList();
  const busy = C.APPS.filter((a) => activeJob(a.id) && hub.installed[a.id] && !ups.includes(a));
  const list = [...ups, ...busy];
  if (!list.length) return [h('div', { class: 'empty' }, icon('check', 28), h('p', { text: hub.checked ? t('allUpToDate') : t('loading') }))];
  return [h('section', { class: 'sect' },
    h('div', { class: 'sect-head' }, h('h2', { text: ups.length === 1 ? t('updates1') : t('updatesN', { n: ups.length }) }),
      ups.length > 1 ? h('button', { class: 'btn primary', onclick: () => ups.forEach((a) => api.install(a.id)) }, t('updateAll')) : null),
    h('div', { class: 'rows' }, list.map((app) => {
      const s = status(app);
      const notes = s.rel ? h('div', { class: 'row-notes' }, markdown(s.rel.body, openWeb)) : null;
      const r = row(app, actionNode(app));
      return h('div', { class: 'update-item' }, r, notes);
    })))];
}

function moreMenu(app, anchor) {
  const r = anchor.getBoundingClientRect();
  const have = hub.installed[app.id];
  const items = [];
  if (have && hub.sys.platform === 'win32' && !activeJob(app.id)) {
    items.push({ label: t('showInFolder'), run: () => api.reveal(app.id) });
    if (!inInstallDir(have)) items.push({ label: t('moveHere'), run: () => askMove([app]) });
    items.push('-');
    items.push({ label: t('uninstall'), run: () => doUninstall(app) });
  }
  if (app.site) items.push(...(items.length ? ['-'] : []), { label: t('website'), run: () => openWeb(app.site) });
  if (app.repo) items.push({ label: 'GitHub', run: () => openWeb(`https://github.com/${app.repo}`) });
  anchor.classList.add('open');
  showMenu(items, r.right, r.bottom + 4, { alignRight: true });
}

// ---------------------------------------------------------------- App-Seite
function viewApp(app) {
  const s = status(app);
  const rel = latest(app.id);
  const out = [];
  const actions = h('div', { class: 'hero-actions' }, actionNode(app));
  if (s.kind === 'update' && !activeJob(app.id)) actions.append(h('button', { class: 'btn', onclick: () => doOpen(app) }, t('open')));
  if (app.web && s.kind !== 'web' && s.kind !== 'unavailable') actions.append(h('button', { class: 'btn', onclick: () => openWebApp(app) }, icon('web', 15), t('openAsApp')));
  actions.append(h('button', { class: 'icon-btn menu-anchor', title: t('more'), onclick: (e) => moreMenu(app, e.currentTarget) }, icon('more', 18)));

  const meta = h('div', { class: 'hero-meta' });
  const chip = (label, value) => value && meta.append(h('span', { class: 'chip' }, h('b', { text: label }), value));
  if (app.repo) {
    chip(t('version'), rel ? shown(rel) || (s.have && s.have.version) : '…');
    if (rel) chip(t('released'), fmtDate(rel.date));
    if (s.asset) chip(t('size'), humanSize(s.asset.size));
    chip(t('systems'), systemsOf(app, rel));
    chip(t('license'), 'Apache 2.0');
    if (s.have && s.have.location && hub.sys.platform === 'win32') chip(t('location'), s.have.location);
  } else chip('', t('webApp'));

  out.push(h('div', { class: 'hero', style: { '--app': app.color } },
    iconImg(app, 96),
    h('div', { class: 'hero-txt' },
      h('h1', {}, app.name, app.legacy ? h('span', { class: 'badge', text: t('legacy') }) : null),
      h('p', { class: 'hero-tag', text: txt(app.tagline) }),
      statusLine(app),
      actions)));
  out.push(meta);
  if (app.legacy) out.push(h('div', { class: 'banner warn' }, icon('alert', 18), h('span', { text: t('legacyNote') })));

  const shots = (app.shots || []).map((f) => `${ASSETS}/apps/${app.id}/${C.shotFile(f, L())}`);
  if (shots.length) out.push(h('div', { class: 'shots' }, shots.map((src, i) => h('button', { class: 'shot', onclick: () => lightbox(shots, i) }, h('img', { src, alt: '', loading: 'lazy', draggable: 'false' })))));

  const body = h('div', { class: 'cols' });
  const left = h('div', { class: 'col-main' }, h('h2', { text: t('about') }), h('p', { class: 'about', text: txt(app.about) }));
  if (app.features && app.features.length) {
    left.append(h('div', { class: 'features' }, app.features.map((f) => {
      const [title, text] = f[settings.language] || f.en;
      return h('div', { class: 'feature' }, h('b', { text: title }), h('span', { text }));
    })));
  }
  body.append(left);
  out.push(body);

  if (app.repo) {
    const list = hub.releases[app.id] || [];
    if (rel) {
      const notes = h('section', { class: 'notes' }, h('h2', { text: shown(rel) ? t('whatsNew', { version: shown(rel) }) : rel.name }), rel.body.trim() ? markdown(rel.body, openWeb) : h('p', { class: 'muted', text: t('noNotes') }));
      out.push(notes);
    }
    const older = list.filter((r) => r !== rel).slice(0, 10);
    if (older.length) {
      out.push(h('section', { class: 'older' }, h('h2', { text: t('earlier') }), older.map((r) => {
        const d = h('details', { class: 'rel' }, h('summary', {}, h('b', { text: ver(r.tag) }), h('span', { class: 'muted', text: fmtDate(r.date) })));
        d.addEventListener('toggle', () => {
          if (d.open && !d.querySelector('.md')) d.append(r.body.trim() ? markdown(r.body, openWeb) : h('p', { class: 'muted', text: t('noNotes') }));
        }, { once: false });
        return d;
      })));
    }
  }
  return out;
}
function systemsOf(app, rel) {
  if (!rel) return '';
  const n = rel.assets.map((a) => a.name);
  const sys = [];
  const has = (re) => re && n.some((x) => re.test(x));
  if (has(app.assets.win)) sys.push('Windows');
  if (has(app.assets.deb) || has(app.assets.pacman) || has(app.assets.tar)) sys.push('Linux');
  if (has(app.assets.arm64) || has(app.assets.x64)) sys.push('macOS');
  if (has(app.assets.html)) sys.push(t('inBrowser'));
  return sys.join(' · ');
}

function lightbox(list, start) {
  let i = start;
  const img = h('img', { alt: '' });
  const show = () => {
    img.src = list[i];
  };
  const overlay = h('div', { class: 'lightbox', onclick: (e) => { if (e.target === overlay || e.target === img) close(); } },
    img,
    list.length > 1 ? h('button', { class: 'lb-nav prev', title: t('back'), onclick: (e) => { e.stopPropagation(); i = (i - 1 + list.length) % list.length; show(); } }, icon('left', 26)) : null,
    list.length > 1 ? h('button', { class: 'lb-nav next', onclick: (e) => { e.stopPropagation(); i = (i + 1) % list.length; show(); } }, icon('right', 26)) : null,
    h('button', { class: 'lb-close', title: t('close'), onclick: () => close() }, icon('close', 20)));
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') { i = (i - 1 + list.length) % list.length; show(); }
    else if (e.key === 'ArrowRight') { i = (i + 1) % list.length; show(); }
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
  }
  document.addEventListener('keydown', onKey, true);
  show();
  document.body.append(overlay);
}

// ---------------------------------------------------------------- Gerüst
// Nur drei Bereiche: Meine Programme, Entdecken (mit Filter/Sortierung), Updates
const NAV = [['home', 'home'], ['discover', 'discover'], '-', ['updates', 'updates']];
const NAV_LABEL = { home: 'myApps', discover: 'discover', updates: 'updates' };

function buildShell() {
  const app = $('#app');
  app.innerHTML = '';
  const side = h('nav', { id: 'side' },
    h('div', { class: 'brand', html: logoSvg(28) }, h('span', { text: 'W Hub' })),
    h('div', { class: 'nav' }, NAV.map((n) => (n === '-' ? h('div', { class: 'nav-sep' }) : h('button', { class: 'nav-btn', 'data-view': n[0], onclick: () => go(n[0]) }, icon(n[1], 18), h('span', { class: 'nav-label', text: t(NAV_LABEL[n[0]]) }), h('span', { class: 'count' }))))),
    h('div', { class: 'spacer' }),
    h('button', { class: 'nav-btn', id: 'settings-btn', onclick: openSettings }, icon('settings', 18), h('span', { class: 'nav-label', text: t('settings') })));
  const input = h('input', { id: 'search', type: 'search', placeholder: t('search'), spellcheck: 'false', value: query, oninput: (e) => { query = e.target.value.trim(); render(); } });
  const top = h('div', { id: 'top' },
    h('label', { class: 'search' }, icon('search', 16), input),
    h('span', { class: 'spacer' }),
    h('span', { id: 'checked', class: 'muted small' }),
    h('button', { class: 'icon-btn', id: 'refresh', title: t('checkNow'), onclick: () => refresh(true) }, icon('refresh', 18)));
  app.append(side, h('div', { id: 'main' }, top, h('div', { id: 'view' })));
}

function go(next, id) {
  if (next !== 'app' && query) {
    query = '';
    $('#search').value = '';
  }
  if (next === 'app') {
    if (view !== 'app') lastList = view;
    current = id;
  }
  if (next === 'folder') currentFolder = id;
  view = next;
  render({ top: true });
}

function render({ top = false } = {}) {
  if (!booted) return;
  const v = $('#view');
  const scroll = v.scrollTop;
  let nodes;
  if (query && view !== 'app') nodes = viewSearch();
  else if (view === 'app' && C.byId[current]) {
    nodes = [h('div', { class: 'back-row' }, h('button', { class: 'btn ghost', onclick: () => go(lastList) }, icon('back', 16), t('back'))), ...viewApp(C.byId[current])];
  } else if (view === 'folder') nodes = viewFolder(folderById(currentFolder));
  else if (view === 'updates') nodes = viewUpdates();
  else if (view === 'discover') nodes = viewDiscover();
  else nodes = viewHome();
  v.replaceChildren(h('div', { class: `page${view === 'app' && !query ? ' app-page' : ''}` }, nodes));
  v.scrollTop = top ? 0 : scroll;
  // Leiste
  const sel = view === 'app' ? (lastList === 'folder' ? 'home' : lastList) : view === 'folder' ? 'home' : view;
  for (const b of document.querySelectorAll('.nav-btn[data-view]')) {
    b.classList.toggle('on', !query && b.dataset.view === sel);
    const c = b.querySelector('.count');
    const n = b.dataset.view === 'updates' ? updateList().length : 0;
    c.textContent = n ? String(n) : '';
    c.classList.toggle('hot', b.dataset.view === 'updates' && n > 0);
  }
  // offener Einstellungsdialog: Angebot "verschieben" aktuell halten
  if (refreshDirOption) refreshDirOption();
  const ck = $('#checked');
  if (hub.error) {
    ck.textContent = t(hub.error === 'limit' ? 'errLimit' : 'errOffline');
    ck.classList.add('warn');
  } else {
    ck.textContent = hub.checked ? t('checkedAt', { time: new Date(hub.checked).toLocaleTimeString(settings.language, { hour: '2-digit', minute: '2-digit' }) }) : t('loading');
    ck.classList.remove('warn');
  }
}

/** Nur die Knöpfe einer App neu zeichnen (Fortschritt kommt oft) */
function patchJob(id) {
  const app = C.byId[id];
  if (!app) return;
  for (const el of document.querySelectorAll(`[data-job="${id}"]`)) el.replaceWith(actionNode(app, el.classList.contains('compact')));
  const j = hub.jobs[id];
  for (const el of document.querySelectorAll(`[data-tilejob="${id}"] i`)) el.style.width = `${j && j.total ? Math.round((j.got / j.total) * 100) : 0}%`;
}

async function refresh(force) {
  const b = $('#refresh');
  b.classList.add('spin');
  try {
    hub = await api.refresh(force);
  } finally {
    b.classList.remove('spin');
  }
  render();
}

// ---------------------------------------------------------------- Einstellungen
let refreshDirOption = null;
function installDirOption() {
  if (info.platform !== 'win32') return null;
  const wrap = h('div', { class: 'opt', id: 'install-dir' });
  const fill = () => {
    if (!wrap.isConnected && refreshDirOption === fill && wrap.childNodes.length) {
      refreshDirOption = null;
      return;
    }
    const outside = outsideInstallDir();
    wrap.replaceChildren(
      h('span', { class: 'lbl', text: t('installDir') }),
      h('div', { class: 'dir-row' },
        h('span', { class: `dir-path${settings.installDir ? '' : ' muted'}`, title: settings.installDir, text: settings.installDir || t('installDirDefault') }),
        h('button', { class: 'btn', id: 'pick-dir', onclick: async () => {
          const d = await api.pickDir(settings.installDir);
          if (!d) return;
          settings.installDir = d;
          saveSettings();
          fill();
          render();
        } }, t('change')),
        settings.installDir ? h('button', { class: 'btn', onclick: () => { settings.installDir = ''; saveSettings(); fill(); render(); } }, t('useDefault')) : null),
      h('small', { class: 'muted', text: t('installDirHint') }),
      outside.length ? h('button', { class: 'btn primary', id: 'move-all', onclick: () => askMove(outside) }, t('moveAll', { n: outside.length })) : null);
  };
  fill();
  refreshDirOption = fill;
  return wrap;
}

function openSettings() {
  const sel = (key, options, onChange) => h('select', { onchange: (e) => { settings[key] = e.target.value; saveSettings(); onChange && onChange(); } },
    options.map(([v, label]) => h('option', { value: v, selected: settings[key] === v ? 'selected' : null }, label)));
  const tog = (key, label, hint) => h('label', { class: 'toggle-row' },
    h('span', { class: 'tg-txt' }, h('span', { text: label }), hint ? h('small', { text: hint }) : null),
    h('input', { type: 'checkbox', class: 'switch', checked: settings[key] ? 'checked' : null, onchange: (e) => { settings[key] = e.target.checked; saveSettings(); } }));
  const swatches = h('div', { class: 'swatches' }, ACCENTS.map((c) => h('button', { class: `sw${settings.accent === c ? ' on' : ''}`, style: { background: c }, title: c, onclick: (e) => {
    settings.accent = c;
    saveSettings();
    theme();
    swatches.querySelectorAll('.sw').forEach((x) => x.classList.toggle('on', x === e.currentTarget));
  } })), h('input', { type: 'color', value: settings.accent, oninput: (e) => { settings.accent = e.target.value; saveSettings(); theme(); } }));
  const body = h('div', { class: 'settings' },
    h('div', { class: 'opt' }, h('span', { class: 'lbl', text: t('language') }), sel('language', i18n.LANGS, () => relabel())),
    h('div', { class: 'opt' }, h('span', { class: 'lbl', text: t('appearance') }), sel('mode', [['system', t('modeSystem')], ['light', t('modeLight')], ['dark', t('modeDark')]], theme)),
    h('div', { class: 'opt' }, h('span', { class: 'lbl', text: t('style') }), sel('look', [['standard', t('styleStandard')], ['acryl', t('styleAcryl')]], theme)),
    h('div', { class: 'opt' }, h('span', { class: 'lbl', text: t('accent') }), swatches),
    h('div', { class: 'sep' }),
    installDirOption(),
    tog('checkOnStart', t('checkOnStart')),
    tog('autoUpdate', t('autoUpdate'), t('autoUpdateHint')),
    tog('notify', t('notifyUpdates')),
    info.startWithSystem ? tog('startWithSystem', t('startWithSystem'), t('startWithSystemHint')) : null,
    info.platform === 'win32' ? tog('allUsers', t('allUsers'), t('allUsersHint')) : null,
    tog('keepInstallers', t('keepInstallers')),
    h('div', { class: 'sep' }),
    h('div', { class: 'about-hub' }, h('div', { html: logoSvg(40) }), h('div', {}, h('b', { text: `W Hub ${info.version}` }), h('p', { class: 'muted', text: t('aboutText') }),
      h('div', { class: 'links' }, h('a', { href: '#', onclick: (e) => { e.preventDefault(); openWeb('https://mert.win/hub/'); } }, 'mert.win/hub'), h('a', { href: '#', onclick: (e) => { e.preventDefault(); openWeb('https://github.com/erqf1/whub'); } }, 'GitHub')))));
  dialog({ title: t('settings'), body, buttons: [{ label: t('close'), value: 'ok', primary: true }], className: 'settings-dialog' });
}
function relabel() {
  // Sprache gewechselt: Gerüst neu bauen, Dialog schließen
  document.querySelectorAll('.overlay').forEach((o) => o.remove());
  document.documentElement.lang = settings.language;
  buildShell();
  render();
  openSettings();
}

// ---------------------------------------------------------------- Start
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    $('#search').focus();
    $('#search').select();
  } else if (e.key === 'Escape' && !document.querySelector('.overlay, .lightbox, .menu')) {
    if (query) {
      query = '';
      $('#search').value = '';
      render();
    } else if (view === 'app') go(lastList);
    else if (view === 'folder') go('home');
  } else if (e.altKey && e.key === 'ArrowLeft' && (view === 'app' || view === 'folder')) go(view === 'app' ? lastList : 'home');
  else if ((e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r')) && !e.shiftKey) {
    e.preventDefault();
    refresh(true);
  }
});

let lastJobs = {};
async function boot() {
  [settings, info] = await Promise.all([api.getSettings(), api.info()]);
  settings = withDefaults(settings);
  saveSettings();
  document.documentElement.lang = settings.language;
  theme();
  api.onSystemTheme((dark) => {
    info.dark = dark;
    theme();
  });
  hub = await api.state();
  booted = true;
  buildShell();
  render();
  api.onState((s) => {
    hub = s;
    render();
  });
  api.onJob(({ id, job }) => {
    const prev = lastJobs[id];
    if (job) hub.jobs[id] = job;
    else delete hub.jobs[id];
    lastJobs[id] = job;
    if (job && job.phase === 'done' && (!prev || prev.phase !== 'done')) {
      const app = C.byId[id];
      const msg = job.result === 'removed' ? t('doneRemoved', { app: app.name }) : job.result === 'updated' ? t('doneUpdated', { app: app.name, version: job.version }) : job.result === 'moved' ? t('doneMoved', { app: app.name }) : job.result === 'opened' ? t('doneOpened') : t('doneInstalled', { app: app.name });
      toast(msg, { ms: job.result === 'opened' ? 5000 : 2600 });
      setTimeout(() => api.dismiss(id), 400);
    }
    if (job && job.phase === 'canceled') setTimeout(() => api.dismiss(id), 100);
    // Fortschritt: nur die Knöpfe; Zustandswechsel: alles
    if (job && prev && job.phase === prev.phase && job.phase === 'download') patchJob(id);
    else render();
  });
  api.onShow((v) => go(v));
  // aus dem Infobereich oder per Systemmeldung geöffnet: gleich auf die passende Seite
  const first = await api.takeView();
  if (first) go(first);
  if (settings.checkOnStart || !hub.checked) await refresh(false);
  window.__ready = true;
}

window.__hub = {
  go,
  get view() { return view; },
  get query() { return query; },
  setQuery: (q) => { query = q; $('#search').value = q; render(); },
  settings: () => settings,
  setSetting: (k, v) => { settings[k] = v; saveSettings(); theme(); buildShell(); render(); },
  addFolder,
  moveToFolder,
  takeOutOfFolder,
};
boot();
