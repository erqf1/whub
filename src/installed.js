'use strict';

// Welche Programme sind installiert, in welcher Version, und wo liegt die EXE?
// Windows: die Liste "Apps & Features" (Uninstall-Schlüssel in der Registry), gelesen über PowerShell.
// Linux: Paketverwaltung (dpkg oder pacman). macOS: /Applications/<Name>.app.
// Programme ohne Installer (GambelStrike 2) legt W Hub selbst ab und merkt sich das in managed.json.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { APPS } = require('./shared/catalog');

let managedFile = null;
let managed = {};

function init(dir) {
  managedFile = path.join(dir, 'managed.json');
  try {
    managed = JSON.parse(fs.readFileSync(managedFile, 'utf8'));
  } catch {
    managed = {};
  }
}
function saveManaged() {
  fs.mkdirSync(path.dirname(managedFile), { recursive: true });
  fs.writeFileSync(`${managedFile}.tmp`, JSON.stringify(managed, null, 1));
  fs.renameSync(`${managedFile}.tmp`, managedFile);
}
function setManaged(id, info) {
  if (info) managed[id] = info;
  else delete managed[id];
  saveManaged();
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 20000, maxBuffer: 16 * 1024 * 1024, ...opts }, (err, stdout) => resolve(err ? null : String(stdout)));
  });
}

// ---------------------------------------------------------------- Windows
const ROOTS = [
  ['HKCU', 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'],
  ['HKLM', 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'],
  ['HKLM', 'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'],
];
const PS = `[Console]::OutputEncoding = [Text.Encoding]::UTF8
$out = foreach ($r in ${ROOTS.map(([h, p]) => `@('${h}','${p}')`).join(',')}) {
  if (Test-Path $r[1]) { Get-ChildItem $r[1] -ErrorAction SilentlyContinue | ForEach-Object {
    $v = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
    if ($v.DisplayName) { [pscustomobject]@{ hive = $r[0]; key = $_.PSChildName; name = [string]$v.DisplayName; version = [string]$v.DisplayVersion;
      icon = [string]$v.DisplayIcon; location = [string]$v.InstallLocation; uninstall = [string]$v.UninstallString; quiet = [string]$v.QuietUninstallString } } } }
}
ConvertTo-Json -Compress -Depth 2 @($out)`;

async function registryEntries() {
  // Selbsttest: ausgedachte Einträge aus einer Datei statt der echten Registry
  if (process.env.WHUB_REGISTRY) {
    try {
      return JSON.parse(fs.readFileSync(process.env.WHUB_REGISTRY, 'utf8'));
    } catch {
      return [];
    }
  }
  // als EncodedCommand (UTF-16LE, Base64): mehrzeilig und ohne Ärger mit Anführungszeichen
  const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(PS, 'utf16le').toString('base64')]);
  if (!out) return [];
  try {
    const list = JSON.parse(out.trim() || '[]');
    return Array.isArray(list) ? list : [list];
  } catch {
    return [];
  }
}

/** "C:\x\App.exe",0 -> C:\x\App.exe */
function exeFromIcon(icon) {
  if (!icon) return '';
  return icon.replace(/,\s*-?\d+\s*$/, '').replace(/^"|"$/g, '').trim();
}

function windowsMatch(app, entries) {
  const w = app.win;
  if (!w || w.kind === 'portable') return null;
  const hit = entries.find((e) => (w.keys || []).includes(e.key)) || entries.find((e) => w.names && w.names.test(e.name));
  if (!hit) return null;
  let exe = exeFromIcon(hit.icon);
  if (!/\.exe$/i.test(exe) && hit.location) exe = path.join(hit.location, w.exe);
  if (exe && w.exe && path.basename(exe).toLowerCase() !== w.exe.toLowerCase() && hit.location) exe = path.join(hit.location, w.exe);
  return {
    version: hit.version || (/(\d+\.\d+(?:\.\d+)?)/.exec(hit.name) || [])[1] || '',
    exe,
    machine: hit.hive === 'HKLM' || /\/allusers/i.test(hit.uninstall || '') || /\(All users\)/i.test(hit.name),
    uninstall: hit.quiet || hit.uninstall || '',
    key: hit.key,
    location: (hit.location || (exe ? path.dirname(exe) : '')).replace(/^"|"$/g, '').replace(/[\\/]+$/, ''),
  };
}

// ---------------------------------------------------------------- Linux und macOS
async function linuxVersion(pkg) {
  if (!pkg) return null;
  const deb = await run('dpkg-query', ['-W', '-f=${Status}|${Version}', pkg]);
  if (deb && /install ok installed\|/.test(deb)) return deb.split('|')[1].replace(/-\d+$/, '');
  const pac = await run('pacman', ['-Q', pkg]);
  if (pac) return pac.trim().split(/\s+/)[1].replace(/-\d+$/, '');
  return null;
}
function macVersion(appName) {
  for (const base of ['/Applications', path.join(os.homedir(), 'Applications')]) {
    const plist = path.join(base, appName, 'Contents', 'Info.plist');
    try {
      const xml = fs.readFileSync(plist, 'utf8');
      const m = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(xml);
      return { version: m ? m[1] : '', exe: path.join(base, appName) };
    } catch {
      // nicht da
    }
  }
  return null;
}

/** { id: { version, exe, machine, uninstall, managed } } für alle installierten Programme */
async function scan() {
  const found = {};
  if (process.platform === 'win32') {
    const entries = await registryEntries();
    for (const app of APPS) {
      const m = windowsMatch(app, entries);
      if (m) found[app.id] = m;
    }
  } else if (process.platform === 'linux') {
    await Promise.all(APPS.filter((a) => a.linux).map(async (app) => {
      const v = await linuxVersion(app.linux.pkg);
      if (v) found[app.id] = { version: v, exe: app.linux.pkg, machine: true };
    }));
  } else if (process.platform === 'darwin') {
    for (const app of APPS.filter((a) => a.mac)) {
      const m = macVersion(app.mac.app);
      if (m) found[app.id] = { ...m, machine: true };
    }
  }
  // von W Hub selbst abgelegte Programme
  for (const [id, info] of Object.entries(managed)) {
    if (info && info.path && fs.existsSync(info.path)) found[id] = { version: info.version, exe: info.path, managed: true, shortcut: info.shortcut || '', location: path.dirname(info.path) };
    else if (info) setManaged(id, null);
  }
  return found;
}

/** Läuft das Programm gerade? (nur Windows; sonst false) */
async function running(exe) {
  if (process.platform !== 'win32' || !exe || process.env.WHUB_REGISTRY) return false;
  const out = await run('tasklist.exe', ['/FI', `IMAGENAME eq ${path.basename(exe)}`, '/FO', 'CSV', '/NH']);
  return !!out && out.toLowerCase().includes(`"${path.basename(exe).toLowerCase()}"`);
}

module.exports = { init, scan, running, setManaged, exeFromIcon, windowsMatch };
