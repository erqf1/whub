'use strict';

// W Hub - Hauptprozess: Fenster, Einstellungen, Katalog-Stand (GitHub + installierte Programme),
// Warteschlange für Installationen und Updates, Selbst-Update.
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme, Notification } = require('electron');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const gh = require('./github');
const inst = require('./installed');
const setup = require('./installer');
const { APPS, byId, pickAsset, newer } = require('./shared/catalog');
const { t: tr } = require('./shared/i18n');

const APP_ID = 'win.mert.WHub';
const REPO = 'erqf1/whub';
// --selftest <ordner>: Selbsttest; --siteshots <ordner>: Bilder für die Website (beides unsichtbar)
const testArg = ['--selftest', '--siteshots'].find((a) => process.argv.includes(a));
const selfTest = testArg ? process.argv[process.argv.indexOf(testArg) + 1] : null;

if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
if (selfTest) {
  app.setPath('userData', path.join(selfTest, 'userdata'));
  // Selbsttest läuft unsichtbar: Fehler nur ausgeben, nie als Fehlerfenster zeigen
  process.on('uncaughtException', (e) => {
    console.log('Fehler im Selbsttest:', e && e.stack ? e.stack : e);
    app.exit(1);
  });
}

let win = null;
let settings = {};
const userFile = (name) => path.join(app.getPath('userData'), name);
const t = (key, vars) => tr(settings.language || 'en', key, vars);

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(data));
  fs.renameSync(`${file}.tmp`, file);
}

// ---------------------------------------------------------------- System
function linuxFlavor() {
  const has = (cmd) => {
    try {
      execFileSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  };
  if (has('dpkg')) return 'deb';
  if (has('pacman')) return 'pacman';
  return 'tar';
}
const SYS = { platform: process.platform, arch: process.arch, flavor: process.platform === 'linux' ? linuxFlavor() : process.arch };
const appsDir = () => (selfTest ? path.join(selfTest, 'apps') : path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'W Hub', 'Apps'));
const downloadDir = () => (selfTest ? path.join(selfTest, 'downloads') : path.join(app.getPath('temp'), 'W Hub'));

// ---------------------------------------------------------------- Stand: Releases + installierte Programme
const state = { releases: {}, installed: {}, checked: 0, error: null, jobs: {} };

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}
function snapshot() {
  return { releases: state.releases, installed: state.installed, checked: state.checked, error: state.error, jobs: state.jobs, sys: SYS };
}

let refreshing = null;
async function refresh(force = false) {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const withRepo = APPS.filter((a) => a.repo);
    const [installed, results] = await Promise.all([
      inst.scan(),
      Promise.all(withRepo.map((a) => gh.releases(a.repo, { force }).then((r) => [a.id, r]))),
    ]);
    state.installed = installed;
    const errors = new Set();
    for (const [id, r] of results) {
      state.releases[id] = r.list;
      if (r.error) errors.add(r.error);
    }
    state.error = errors.has('limit') ? 'limit' : errors.size ? 'offline' : null;
    state.checked = Date.now();
    send('hub:state', snapshot());
    notifyUpdates();
    return snapshot();
  })();
  try {
    return await refreshing;
  } finally {
    refreshing = null;
  }
}
async function rescan() {
  state.installed = await inst.scan();
  send('hub:state', snapshot());
}

function updatesAvailable() {
  const out = [];
  for (const appDef of APPS) {
    const have = state.installed[appDef.id];
    const rel = (state.releases[appDef.id] || []).find((r) => !r.prerelease);
    if (have && rel && newer(rel.tag, have.version) && pickAsset(appDef, rel.assets, SYS)) out.push({ id: appDef.id, name: appDef.name, version: rel.tag.replace(/^v/, '') });
  }
  return out;
}

/** Einmal je neuer Version eine Systemmeldung */
function notifyUpdates() {
  if (selfTest || settings.notify === false || !Notification.isSupported()) return;
  const list = updatesAvailable();
  const seen = readJson(userFile('notified.json'), {});
  const fresh = list.filter((u) => seen[u.id] !== u.version);
  if (!fresh.length) return;
  for (const u of fresh) seen[u.id] = u.version;
  writeJson(userFile('notified.json'), seen);
  const n = new Notification({
    title: t('notifyTitle'),
    body: fresh.length === 1 ? t('notifyOne', { app: fresh[0].name, version: fresh[0].version }) : t('notifyMany', { n: fresh.length, list: fresh.map((u) => u.name).join(', ') }),
  });
  n.on('click', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    send('hub:show', 'updates');
  });
  n.show();
}

// ---------------------------------------------------------------- Warteschlange
const queue = [];
let busy = false;
const controllers = {};

function setJob(id, patch) {
  state.jobs[id] = patch ? { ...(state.jobs[id] || {}), ...patch } : undefined;
  if (!patch) delete state.jobs[id];
  send('hub:job', { id, job: state.jobs[id] || null });
}

function enqueue(id, action) {
  if (state.jobs[id] && !['done', 'error', 'canceled'].includes(state.jobs[id].phase)) return false;
  queue.push({ id, action });
  setJob(id, { phase: 'queued', action, got: 0, total: 0, error: null });
  pump();
  return true;
}

async function pump() {
  if (busy) return;
  const next = queue.shift();
  if (!next) return;
  busy = true;
  try {
    if (next.action === 'uninstall') await doUninstall(next.id);
    else if (next.action === 'move') await doMove(next.id);
    else await doInstall(next.id);
  } catch (e) {
    if (state.jobs[next.id] && state.jobs[next.id].phase !== 'canceled') setJob(next.id, { phase: 'error', error: e.code || 'failed', detail: String(e.message || e).slice(0, 200) });
  } finally {
    delete controllers[next.id];
    busy = false;
    pump();
  }
}

class HubError extends Error {
  constructor(code, detail) {
    super(detail || code);
    this.code = code;
  }
}

async function askClose(appDef, existing) {
  if (!existing || !(await inst.running(existing.exe))) return true;
  if (selfTest) return true;
  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: [t('continue'), t('cancel')],
    defaultId: 0,
    cancelId: 1,
    title: appDef.name,
    message: t('closeRunningTitle', { app: appDef.name }),
    detail: t('closeRunningMsg', { app: appDef.name }),
  });
  return response === 0;
}

/** Beginnt die Datei wie ein Windows-Programm (MZ)? Vor dem Deinstallieren beim Verschieben geprüft. */
function isWindowsProgram(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const b = Buffer.alloc(2);
    fs.readSync(fd, b, 0, 2, 0);
    fs.closeSync(fd);
    return b.toString('latin1') === 'MZ';
  } catch {
    return false;
  }
}

/** Gemeinsamer Installationsordner (nur Windows): <ordner>\<Programmname>, sonst null */
function targetDir(appDef) {
  return SYS.platform === 'win32' && settings.installDir ? path.join(settings.installDir, appDef.name) : null;
}

/** Neuestes Paket laden und prüfen. Liefert { file, asset, version } oder null (abgebrochen). */
async function fetchPackage(id) {
  const appDef = byId[id];
  const list = state.releases[id] || [];
  const rel = list.find((r) => !r.prerelease) || list[0];
  if (!rel) throw new HubError('norelease');
  const asset = pickAsset(appDef, rel.assets, SYS);
  if (!asset) throw new HubError('noasset');
  const ctrl = new AbortController();
  controllers[id] = ctrl;
  const file = path.join(downloadDir(), asset.name);
  let digest;
  try {
    digest = await setup.download(asset.url, file, asset.size, (p) => setJob(id, p), ctrl.signal);
  } catch (e) {
    if (ctrl.signal.aborted) {
      setJob(id, { phase: 'canceled' });
      return null;
    }
    throw new HubError('download', e.message);
  }
  if (asset.digest && asset.digest.toLowerCase() !== digest) {
    fs.rmSync(file, { force: true });
    throw new HubError('digest');
  }
  return { file, asset, version: rel.tag.replace(/^v/, '') };
}

async function doInstall(id) {
  const appDef = byId[id];
  const list = state.releases[id] || [];
  const rel = list.find((r) => !r.prerelease) || list[0];
  if (!rel) throw new HubError('norelease');
  if (!pickAsset(appDef, rel.assets, SYS)) throw new HubError('noasset');
  const existing = state.installed[id];
  if (!(await askClose(appDef, existing))) {
    setJob(id, { phase: 'canceled' });
    return;
  }
  const pkg = await fetchPackage(id);
  if (!pkg) return;
  const { file, asset, version } = pkg;
  setJob(id, { phase: 'install' });
  const kind = appDef.win && appDef.win.kind;
  if (SYS.platform === 'win32' && (kind === 'inno' || kind === 'nsis')) {
    // Updates bleiben, wo sie sind; neue Installationen kommen in den gemeinsamen Ordner (falls gewählt)
    const code = await setup.runInstaller(file, setup.installArgs(kind, existing, settings.allUsers, existing ? null : targetDir(appDef)));
    if (!settings.keepInstallers) fs.rmSync(file, { force: true });
    if (code !== 0) throw new HubError('installer', String(code));
    setJob(id, { phase: 'done', result: existing ? 'updated' : 'installed', version });
  } else if (kind === 'portable' || /\.html$/i.test(asset.name)) {
    // ein einzelnes Programm (oder die Offline-Datei): selbst ablegen und merken
    const dir = existing && existing.managed ? path.dirname(existing.exe) : targetDir(appDef) || path.join(appsDir(), id);
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, /\.html$/i.test(asset.name) ? 'GambelStrike2.html' : appDef.win.exe);
    fs.copyFileSync(file, dest);
    fs.rmSync(file, { force: true });
    const shortcut = /\.exe$/i.test(dest) ? setup.startMenuShortcut(app.getPath('appData'), appDef.name, dest) : '';
    inst.setManaged(id, { version, path: dest, shortcut });
    setJob(id, { phase: 'done', result: existing ? 'updated' : 'installed', version });
  } else {
    // Linux und macOS: das Paket öffnet die Paketverwaltung bzw. der Finder
    const target = path.join(app.getPath('downloads'), asset.name);
    fs.copyFileSync(file, target);
    fs.rmSync(file, { force: true });
    if (!selfTest) {
      const err = await shell.openPath(target);
      if (err) shell.showItemInFolder(target);
    }
    setJob(id, { phase: 'done', result: 'opened', version, file: target });
  }
  await rescan();
}

async function doUninstall(id) {
  const appDef = byId[id];
  const have = state.installed[id];
  if (!have) {
    setJob(id, null);
    return;
  }
  if (!(await askClose(appDef, have))) {
    setJob(id, { phase: 'canceled' });
    return;
  }
  setJob(id, { phase: 'uninstall' });
  if (have.managed) {
    fs.rmSync(have.exe, { force: true });
    if (have.shortcut) fs.rmSync(have.shortcut, { force: true });
    inst.setManaged(id, null);
  } else {
    const code = await setup.uninstall(appDef.win && appDef.win.kind, have.uninstall);
    if (code !== 0) throw new HubError('uninstall', String(code));
  }
  setJob(id, { phase: 'done', result: 'removed' });
  await rescan();
}

/** Installiertes Programm in den gemeinsamen Installationsordner bringen.
 *  Installer-Programme: neuestes Paket laden, still deinstallieren, still in den neuen Ordner installieren
 *  (Benutzerdaten liegen in AppData und bleiben; Daten neben der EXE - win.dataDir - werden mitkopiert).
 *  Einzelne EXE: einfach verschieben. */
async function doMove(id) {
  const appDef = byId[id];
  const have = state.installed[id];
  const dest = targetDir(appDef);
  if (!have || !dest) {
    setJob(id, null);
    return;
  }
  if (setup.isInside(have.location, settings.installDir)) {
    setJob(id, { phase: 'done', result: 'moved' });
    return;
  }
  if (!(await askClose(appDef, have))) {
    setJob(id, { phase: 'canceled' });
    return;
  }
  if (have.managed) {
    setJob(id, { phase: 'move' });
    fs.mkdirSync(dest, { recursive: true });
    const exe = path.join(dest, path.basename(have.exe));
    fs.copyFileSync(have.exe, exe);
    fs.rmSync(have.exe, { force: true });
    try {
      fs.rmdirSync(path.dirname(have.exe));
    } catch {
      // Ordner nicht leer: dann bleibt er
    }
    if (have.shortcut) fs.rmSync(have.shortcut, { force: true });
    const shortcut = /\.exe$/i.test(exe) ? setup.startMenuShortcut(app.getPath('appData'), appDef.name, exe) : '';
    inst.setManaged(id, { version: have.version, path: exe, shortcut });
  } else {
    const kind = appDef.win && appDef.win.kind;
    if (kind !== 'inno' && kind !== 'nsis') {
      setJob(id, null);
      return;
    }
    // zuerst laden und prüfen: schlägt das fehl, ist noch nichts deinstalliert
    const pkg = await fetchPackage(id);
    if (!pkg) return;
    if (!isWindowsProgram(pkg.file)) {
      fs.rmSync(pkg.file, { force: true });
      throw new HubError('installer', 'no exe');
    }
    setJob(id, { phase: 'move' });
    const oldLoc = have.location;
    let code = await setup.uninstall(kind, have.uninstall);
    if (code !== 0) throw new HubError('uninstall', String(code));
    code = await setup.runInstaller(pkg.file, setup.installArgs(kind, have, settings.allUsers, dest));
    if (!settings.keepInstallers) fs.rmSync(pkg.file, { force: true });
    if (code !== 0) throw new HubError('installer', String(code));
    const dataDir = appDef.win && appDef.win.dataDir;
    if (dataDir && oldLoc) {
      const from = path.join(oldLoc, dataDir);
      const to = path.join(dest, dataDir);
      if (fs.existsSync(from) && !fs.existsSync(to)) fs.cpSync(from, to, { recursive: true });
    }
  }
  await rescan();
  const now = state.installed[id];
  if (!now || !setup.isInside(now.location, settings.installDir)) throw new HubError('move');
  setJob(id, { phase: 'done', result: 'moved', version: now.version });
}

// ---------------------------------------------------------------- Web-Apps im eigenen Fenster (wie mit Webline geöffnet)
const webWins = new Map();
/** Selbsttest: Seiten vom Testserver statt von mert.win */
const siteUrl = (u) => (process.env.WHUB_SITE ? String(u).replace('https://mert.win', process.env.WHUB_SITE) : u);

function openWebApp(id, url) {
  const appDef = byId[id];
  const target = appDef && siteUrl(url || appDef.web);
  if (!target) return false;
  const key = `${id}|${target}`;
  const open = webWins.get(key);
  if (open && !open.isDestroyed()) {
    if (open.isMinimized()) open.restore();
    open.show();
    open.focus();
    return true;
  }
  const saved = (settings.webWindows || {})[id] || {};
  const dark = settings.mode === 'dark' || (settings.mode !== 'light' && nativeTheme.shouldUseDarkColors);
  const icon = path.join(__dirname, '..', 'assets', 'icons', `${id}.png`);
  const partition = `persist:web-${id}`;
  const w = new BrowserWindow({
    width: saved.width || 1200,
    height: saved.height || 800,
    x: saved.x,
    y: saved.y,
    minWidth: 360,
    minHeight: 300,
    show: false,
    title: appDef.name,
    icon: fs.existsSync(icon) ? icon : undefined,
    backgroundColor: dark ? '#14161b' : '#ffffff',
    autoHideMenuBar: true,
    webPreferences: { partition, contextIsolation: true, sandbox: true, spellcheck: true, backgroundThrottling: !selfTest },
  });
  w.setMenuBarVisibility(false);
  if (saved.maximized) w.maximize();
  // eigenes Symbol in der Taskleiste statt unter W Hub gruppiert
  if (process.platform === 'win32') w.setAppDetails({ appId: `${APP_ID}.${id}`, relaunchDisplayName: appDef.name });
  const origin = new URL(target).origin;
  const inside = (u) => {
    try {
      const x = new URL(u);
      return x.origin === origin || /(^|\.)mert\.win$/i.test(x.hostname);
    } catch {
      return false;
    }
  };
  const external = (u) => {
    if (/^https?:\/\//i.test(u) && !selfTest) shell.openExternal(u);
  };
  w.webContents.setWindowOpenHandler(({ url: u }) => {
    if (inside(u)) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, icon: fs.existsSync(icon) ? icon : undefined, webPreferences: { partition } } };
    external(u);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (e, u) => {
    if (!inside(u)) {
      e.preventDefault();
      external(u);
    }
  });
  // Titel: Name der App, Seitentitel dahinter (wie Webline)
  w.on('page-title-updated', (e, title) => {
    e.preventDefault();
    w.setTitle(title && title !== appDef.name ? `${appDef.name} – ${title}` : appDef.name);
  });
  const remember = () => {
    if (w.isDestroyed() || w.isMinimized()) return;
    const maximized = w.isMaximized();
    const b = maximized ? saved : w.getBounds();
    settings.webWindows = { ...(settings.webWindows || {}), [id]: { x: b.x, y: b.y, width: b.width, height: b.height, maximized } };
  };
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize']) w.on(ev, remember);
  w.once('ready-to-show', () => {
    if (!selfTest) w.show();
  });
  w.on('closed', () => webWins.delete(key));
  webWins.set(key, w);
  w.loadURL(target);
  return true;
}

// ---------------------------------------------------------------- Fenster
function createWindow() {
  const s = settings.window || {};
  win = new BrowserWindow({
    width: s.width || 1180,
    height: s.height || 760,
    x: s.x,
    y: s.y,
    minWidth: 820,
    minHeight: 520,
    show: false,
    title: 'W Hub',
    backgroundColor: settings.mode === 'light' || (settings.mode !== 'dark' && !nativeTheme.shouldUseDarkColors) ? '#f3f4f7' : '#14161b',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: !selfTest,
    },
  });
  if (s.maximized) win.maximize();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    if (!selfTest) win.show();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault();
  });
  const remember = () => {
    if (!win || win.isDestroyed() || win.isMinimized()) return;
    const maximized = win.isMaximized();
    const b = maximized ? settings.window || {} : win.getBounds();
    settings.window = { x: b.x, y: b.y, width: b.width, height: b.height, maximized };
  };
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize']) win.on(ev, remember);
  win.on('closed', () => {
    win = null;
  });
}

function buildMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
}

// ---------------------------------------------------------------- IPC
ipcMain.handle('settings:get', () => settings);
ipcMain.handle('settings:set', (_e, next) => {
  settings = { ...next, window: settings.window, webWindows: settings.webWindows };
  writeJson(userFile('settings.json'), settings);
  return true;
});
ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  dark: nativeTheme.shouldUseDarkColors,
  selfTest: !!selfTest,
  sys: SYS,
}));
nativeTheme.on('updated', () => send('app:system-theme', nativeTheme.shouldUseDarkColors));

ipcMain.handle('hub:state', () => snapshot());
ipcMain.handle('hub:refresh', (_e, force) => refresh(!!force));
ipcMain.handle('hub:install', (_e, id) => (byId[id] ? enqueue(id, state.installed[id] ? 'update' : 'install') : false));
ipcMain.handle('hub:uninstall', (_e, id) => (byId[id] ? enqueue(id, 'uninstall') : false));
ipcMain.handle('hub:cancel', (_e, id) => {
  const i = queue.findIndex((q) => q.id === id);
  if (i >= 0) {
    queue.splice(i, 1);
    setJob(id, null);
    return true;
  }
  if (controllers[id] && state.jobs[id] && state.jobs[id].phase === 'download') {
    controllers[id].abort();
    return true;
  }
  return false;
});
ipcMain.handle('hub:dismiss', (_e, id) => {
  if (state.jobs[id] && ['done', 'error', 'canceled'].includes(state.jobs[id].phase)) setJob(id, null);
});
ipcMain.handle('hub:open', (_e, id) => {
  const have = state.installed[id];
  if (!have) return false;
  if (/\.html?$/i.test(have.exe)) return shell.openPath(have.exe).then((err) => !err);
  if (selfTest) return fs.existsSync(have.exe);
  return setup.launch(have.exe);
});
ipcMain.handle('hub:move', (_e, ids) => (Array.isArray(ids) ? ids.filter((id) => byId[id] && state.installed[id]).map((id) => enqueue(id, 'move')) : []));
ipcMain.handle('hub:pick-dir', async (_e, current) => {
  if (selfTest) return process.env.WHUB_PICK_DIR || null;
  const r = await dialog.showOpenDialog(win, { title: t('installDir'), defaultPath: current || process.env.LOCALAPPDATA || app.getPath('home'), properties: ['openDirectory', 'createDirectory', 'promptToCreate'] });
  return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
});
ipcMain.handle('hub:web', (_e, id, url) => openWebApp(id, url));
ipcMain.handle('hub:reveal', (_e, id) => {
  const have = state.installed[id];
  if (have && have.exe && fs.existsSync(have.exe)) shell.showItemInFolder(have.exe);
});
ipcMain.handle('shell:open-external', (_e, url) => {
  if (/^https:\/\//i.test(url)) shell.openExternal(url);
});

// ---------------------------------------------------------------- Selbst-Update (wie bei den anderen Programmen)
function isTarGz() {
  if (process.platform !== 'linux') return false;
  const exe = app.getPath('exe');
  return !exe.startsWith('/usr/') && !exe.startsWith('/opt/');
}
function setupAutoUpdate() {
  if (!app.isPackaged || selfTest) return;
  if (process.env.PORTABLE_EXECUTABLE_DIR || process.platform === 'darwin' || isTarGz()) return setupUpdateNotice();
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch {
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  let retry = null;
  autoUpdater.on('error', () => {
    clearTimeout(retry);
    retry = setTimeout(check, 10 * 60 * 1000);
  });
  const laterFile = userFile('update.json');
  let asking = false;
  autoUpdater.on('update-downloaded', async (info) => {
    const later = readJson(laterFile, {});
    if (asking || busy || (later.version === info.version && Date.now() < later.until)) return;
    asking = true;
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      buttons: [t('restartNow'), t('later')],
      defaultId: 0,
      cancelId: 1,
      title: t('updateTitle'),
      message: t('updateReady', { version: info.version }),
      detail: t('updateDetail'),
    });
    asking = false;
    if (response === 0) autoUpdater.quitAndInstall();
    else writeJson(laterFile, { version: info.version, until: Date.now() + 14 * 24 * 3600 * 1000 });
  });
  setTimeout(check, 5000);
  setInterval(check, 60 * 60 * 1000);
}
function setupUpdateNotice() {
  const laterFile = userFile('update.json');
  let asked = false;
  const check = async () => {
    if (asked) return;
    const { list } = await gh.releases(REPO);
    const rel = gh.latest(list);
    const version = rel ? rel.tag.replace(/^v/, '') : '';
    if (!version || !newer(version, app.getVersion())) return;
    const later = readJson(laterFile, {});
    if (later.version === version && Date.now() < later.until) return;
    asked = true;
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      buttons: [t('openDownloadPage'), t('later')],
      defaultId: 0,
      cancelId: 1,
      title: t('updateTitle'),
      message: t('updateAvailable', { version }),
      detail: t('updateManualDetail'),
    });
    if (response === 0) shell.openExternal(rel.url || `https://github.com/${REPO}/releases/latest`);
    else writeJson(laterFile, { version, until: Date.now() + 14 * 24 * 3600 * 1000 });
  };
  setTimeout(check, 8000);
  setInterval(check, 6 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------- Start
if (!selfTest && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(() => {
    settings = readJson(userFile('settings.json'), {});
    gh.init(path.join(app.getPath('userData'), 'cache'));
    inst.init(app.getPath('userData'));
    buildMenu();
    createWindow();
    setupAutoUpdate();
    // regelmäßig nachsehen, solange W Hub offen ist
    if (!selfTest) setInterval(() => refresh(false), 6 * 60 * 60 * 1000);
    if (selfTest) require(path.join(__dirname, '..', 'tools', testArg === '--siteshots' ? 'siteshots.js' : 'selftest.js'))(win, selfTest, { state, queue, webWins });
  });
}

app.on('before-quit', () => {
  for (const c of Object.values(controllers)) c.abort();
  try {
    writeJson(userFile('settings.json'), settings);
  } catch {
    // egal
  }
});
app.on('window-all-closed', () => app.quit());
app.on('activate', () => {
  if (!win) createWindow();
});
