'use strict';

// Startet den Selbsttest von W Hub unsichtbar und ohne echte Installationen:
//  - ein lokaler Testserver (in tools/selftest.js) spielt GitHub,
//  - ein ausgedachter Registry-Stand (registry.json) ersetzt die echte Windows-Liste,
//  - FakeSetup.exe ersetzt die Installer: schreibt nur auf, womit es gestartet wurde.
// Zweiter Teil (alle Systeme): Hintergrundbetrieb, Auto-Update, parallele Downloads (tools/selftest-bg.js).
// Aufruf: node tools/run-selftest.js [ordner] [--siteshots] [--exe <programm>]
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const shots = process.argv.includes('--siteshots');
const exeIdx = process.argv.indexOf('--exe');
const dir = path.resolve(process.argv.slice(2).find((a, i) => !a.startsWith('--') && i + 2 !== exeIdx + 1) || path.join(os.tmpdir(), `whub-selftest-${Date.now()}`));
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const isWin = process.platform === 'win32';
// FakeSetup.exe: mit dem C#-Compiler aus Windows gebaut (kein Fenster: /target:winexe)
const cs = `using System; using System.IO;
class P { static int Main(string[] a) {
  string d = Environment.GetEnvironmentVariable("WHUB_FAKE_DIR");
  string me = Path.GetFileName(Environment.GetCommandLineArgs()[0]);
  File.AppendAllText(Path.Combine(d, "log.txt"), me + "|" + string.Join(" ", a) + "\\n");
  string[] queue = Directory.GetFiles(d, "next-registry-*.json");
  Array.Sort(queue, StringComparer.Ordinal);
  string next = Path.Combine(d, "next-registry.json");
  if (queue.Length > 0) { File.Copy(queue[0], Path.Combine(d, "registry.json"), true); File.Delete(queue[0]); }
  else if (File.Exists(next)) File.Copy(next, Path.Combine(d, "registry.json"), true);
  string code = Path.Combine(d, "exitcode.txt");
  return File.Exists(code) ? int.Parse(File.ReadAllText(code).Trim()) : 0;
} }`;
if (isWin) {
  fs.writeFileSync(path.join(dir, 'FakeSetup.cs'), cs);
  const csc = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  execFileSync(csc, ['/nologo', '/target:winexe', `/out:${path.join(dir, 'FakeSetup.exe')}`, path.join(dir, 'FakeSetup.cs')], { stdio: 'inherit', windowsHide: true });
}

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

// --exe <pfad>: das fertig gebaute Programm testen statt node_modules/electron
const exeArg = process.argv.indexOf('--exe');
const exe = exeArg > 0 ? path.resolve(process.argv[exeArg + 1]) : null;
const electron = exe || require(path.join(root, 'node_modules', 'electron'));

/** Einen Lauf starten; Linux ohne Bildschirm über xvfb-run */
function launch(args, env) {
  return new Promise((resolve) => {
    let cmd = electron;
    let argv = [...(exe ? [] : [root]), ...args];
    if (process.platform === 'linux') {
      argv.push('--no-sandbox');
      if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
        argv = ['-a', cmd, ...argv];
        cmd = 'xvfb-run';
      }
    }
    const child = spawn(cmd, argv, { env, stdio: 'inherit', windowsHide: true });
    const timer = setTimeout(() => {
      console.log('Zeitüberschreitung');
      child.kill();
    }, 6 * 60 * 1000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code == null ? 1 : code);
    });
  });
}

(async () => {
  const base = { ...process.env, WHUB_NO_SHORTCUTS: '1' };
  delete base.ELECTRON_RUN_AS_NODE;
  let code = 0;
  // 1) Oberfläche, Installieren, Updates, Verschieben (braucht Windows wegen FakeSetup.exe)
  if (isWin) {
    const port = await freePort();
    code = await launch([shots ? '--siteshots' : '--selftest', dir], {
      ...base,
      WHUB_API: `http://127.0.0.1:${port}`,
      WHUB_TEST_PORT: String(port),
      WHUB_REGISTRY: path.join(dir, 'registry.json'),
      WHUB_FAKE_DIR: dir,
      WHUB_RUNNING: path.join(dir, 'running.txt'),
      WHUB_RETRY_MS: '1500',
      WHUB_SITE: `http://127.0.0.1:${port}`,
      WHUB_PICK_DIR: path.join(dir, 'W Software'),
    });
  } else {
    console.log('Hinweis: Teil 1 (Installer) braucht Windows, hier nur der Hintergrund-Teil.');
  }
  if (shots) process.exit(code);
  // 2) Hintergrundbetrieb: Start mit dem System ohne Fenster, Auto-Update, parallele Downloads (alle Systeme)
  const bg = path.join(dir, 'hintergrund');
  fs.mkdirSync(path.join(bg, 'userdata'), { recursive: true });
  const gs = path.join(bg, 'apps', 'gamble', isWin ? 'GambelStrike2.exe' : 'GambelStrike2.html');
  fs.mkdirSync(path.dirname(gs), { recursive: true });
  fs.writeFileSync(gs, 'alt');
  fs.writeFileSync(path.join(bg, 'userdata', 'managed.json'), JSON.stringify({ gamble: { version: '1.0.0', path: gs, shortcut: '' } }));
  fs.writeFileSync(path.join(bg, 'userdata', 'settings.json'), JSON.stringify({ language: 'de', startWithSystem: true, autoUpdate: true, notify: true }));
  fs.writeFileSync(path.join(bg, 'running.txt'), path.basename(gs));
  const port = await freePort();
  const code2 = await launch(['--selftest-bg', bg, '--autostart'], {
    ...base,
    WHUB_API: `http://127.0.0.1:${port}`,
    WHUB_TEST_PORT: String(port),
    WHUB_REGISTRY: path.join(bg, 'registry.json'),
    WHUB_RUNNING: path.join(bg, 'running.txt'),
    WHUB_RETRY_MS: '1500',
    WHUB_AUTOSTART_DIR: path.join(bg, 'autostart'),
    WHUB_SITE: `http://127.0.0.1:${port}`,
  });
  process.exit(code || code2);
})();
