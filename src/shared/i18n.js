'use strict';

// Texte in 12 Sprachen (wie die anderen Programme). Spalten: en de es fr it pt nl pl tr ru ja zh
const LANGS = [
  ['en', 'English'], ['de', 'Deutsch'], ['es', 'Español'], ['fr', 'Français'], ['it', 'Italiano'], ['pt', 'Português'],
  ['nl', 'Nederlands'], ['pl', 'Polski'], ['tr', 'Türkçe'], ['ru', 'Русский'], ['ja', '日本語'], ['zh', '中文'],
];
const CODES = LANGS.map(([c]) => c);
const S = require('./strings');

function t(lang, key, vars) {
  const row = S[key];
  if (!row) return key;
  const i = Math.max(0, CODES.indexOf(lang));
  let text = row[i] || row[0];
  if (vars) for (const [k, v] of Object.entries(vars)) text = text.split(`{${k}}`).join(String(v));
  return text;
}

module.exports = { t, LANGS, KEYS: Object.keys(S) };
