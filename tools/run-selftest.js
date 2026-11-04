'use strict';

// Startet den Selbsttest von W Hub unsichtbar und ohne echte Installationen:
//  - ein lokaler Testserver (in tools/selftest.js) spielt GitHub,
//  - ein ausgedachter Registry-Stand (registry.json) ersetzt die echte Windows-Liste,
//  - FakeSetup.exe ersetzt die Installer: schreibt nur auf, womit es gestartet wurde.
// Aufruf: node tools/run-selftest.js [ordner] [--siteshots]
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

// FakeSetup.exe: mit dem C#-Compiler aus Windows gebaut (kein Fenster: /target:winexe)
const cs = `using System; using System.IO;
class P { static int Main(string[] a) {
  string d = Environment.GetEnvironmentVariable("WHUB_FAKE_DIR");
  string me = Path.GetFileName(Environment.GetCommandLineArgs()[0]);
  File.AppendAllText(Path.Combine(d, "log.txt"), me + "|" + string.Join(" ", a) + "\\n");
  string next = Path.Combine(d, "next-registry.json");
  if (File.Exists(next)) File.Copy(next, Path.Combine(d, "registry.json"), true);
  string code = Path.Combine(d, "exitcode.txt");
  return File.Exists(code) ? int.Parse(File.ReadAllText(code).Trim()) : 0;
} }`;
fs.writeFileSync(path.join(dir, 'FakeSetup.cs'), cs);
const csc = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
execFileSync(csc, ['/nologo', '/target:winexe', `/out:${path.join(dir, 'FakeSetup.exe')}`, path.join(dir, 'FakeSetup.cs')], { stdio: 'inherit', windowsHide: true });

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

(async () => {
  const port = await freePort();
  // --exe <pfad>: das fertig gebaute Programm testen statt node_modules/electron
  const exeArg = process.argv.indexOf('--exe');
  const exe = exeArg > 0 ? path.resolve(process.argv[exeArg + 1]) : null;
  const electron = exe || require(path.join(root, 'node_modules', 'electron'));
  const env = {
    ...process.env,
    WHUB_API: `http://127.0.0.1:${port}`,
    WHUB_TEST_PORT: String(port),
    WHUB_REGISTRY: path.join(dir, 'registry.json'),
    WHUB_FAKE_DIR: dir,
    WHUB_NO_SHORTCUTS: '1',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [...(exe ? [] : [root]), shots ? '--siteshots' : '--selftest', dir], { env, stdio: 'inherit', windowsHide: true });
  const timer = setTimeout(() => {
    console.log('Zeitüberschreitung');
    child.kill();
  }, 6 * 60 * 1000);
  child.on('exit', (code) => {
    clearTimeout(timer);
    process.exit(code == null ? 1 : code);
  });
})();
