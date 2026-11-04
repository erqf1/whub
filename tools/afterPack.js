'use strict';

// electron-builder-Hook: entfernt aus dem entpackten Electron, was diese App nachweislich
// nicht braucht. Nur Dinge, die keinen Funktionsverlust bedeuten:
//  - Chromium-Sprachpakete außer den 12 Sprachen von W Hub
//  - unter Windows der Software-Renderer SwiftShader und der Vulkan-Loader (Chromium
//    nutzt dort D3D11/D3D12 - dxcompiler/dxil bleiben, die braucht WebGPU noch)
const fs = require('fs');
const path = require('path');

const KEEP_LOCALES = ['en', 'de', 'es', 'fr', 'it', 'pt', 'nl', 'pl', 'tr', 'ru', 'ja', 'zh'];
const keepLocale = (name) => KEEP_LOCALES.some((l) => name === l || name.startsWith(`${l}-`) || name.startsWith(`${l}_`));

async function remove(target) {
  await fs.promises.rm(target, { recursive: true, force: true });
}

// Bricht den Build ab, wenn eine Datei, die der Hauptprozess per require('./...') lädt, nicht in
// app.asar gelandet ist - sonst stürzt das Programm sofort beim Start ab (Textline 1.0.0/1.0.1: fileicons.js).
function checkRequires(asarFile) {
  const asar = require('@electron/asar');
  const inside = new Set(asar.listPackage(asarFile).map((f) => f.replace(/\\/g, '/').replace(/^\//, '')));
  const missing = [];
  for (const file of inside) {
    if (!/^src\/(shared\/)?[^/]+\.js$/.test(file)) continue;
    const code = asar.extractFile(asarFile, file.split('/').join(path.sep)).toString('utf8');
    for (const [, rel] of code.matchAll(/require\(\s*'(\.{1,2}\/[^']+)'\s*\)/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), rel));
      if (![target, `${target}.js`, `${target}/index.js`].some((t) => inside.has(t))) missing.push(`${file} -> ${rel}`);
    }
  }
  if (missing.length) throw new Error(`Fehlt in app.asar: ${missing.join(', ')}`);
}

exports.default = async function afterPack({ appOutDir, electronPlatformName, packager }) {
  const bundle = `${packager.appInfo.productFilename}.app`;
  checkRequires(electronPlatformName === 'darwin'
    ? path.join(appOutDir, bundle, 'Contents/Resources/app.asar')
    : path.join(appOutDir, 'resources/app.asar'));

  if (electronPlatformName === 'darwin') {
    const resources = path.join(
      appOutDir,
      bundle,
      'Contents/Frameworks/Electron Framework.framework/Versions/A/Resources'
    );
    for (const name of await fs.promises.readdir(resources)) {
      if (!name.endsWith('.lproj') || name === 'Base.lproj') continue;
      if (!keepLocale(name.replace(/\.lproj$/, ''))) await remove(path.join(resources, name));
    }
    return;
  }

  const locales = path.join(appOutDir, 'locales');
  for (const name of await fs.promises.readdir(locales)) {
    if (!keepLocale(name.replace(/\.pak$/, ''))) await remove(path.join(locales, name));
  }
  if (electronPlatformName === 'win32') {
    for (const name of ['vk_swiftshader.dll', 'vk_swiftshader_icd.json', 'vulkan-1.dll']) {
      await remove(path.join(appOutDir, name));
    }
  }
};
