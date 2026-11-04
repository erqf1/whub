// Farben der Oberfläche (hell/dunkel) und die Akzentfarbe als CSS-Variablen.
import { parseHex, luminance } from './color.js';
import { hueOf, smokeUrl } from './smoke.js';

const LIGHT = {
  bg: '#f3f4f7', panel: '#ffffff', panel2: '#f2f3f6', line: '#e2e5eb', text: '#1b1f27', muted: '#6b7280', hover: 'rgba(0,0,0,0.05)',
  canvasBg: '#e3e6ec', danger: '#dc2626', shadow: '0 12px 32px -12px rgba(20,24,40,0.28), 0 2px 6px rgba(20,24,40,0.08)',
};
const DARK = {
  bg: '#14161b', panel: '#1b1e25', panel2: '#232731', line: '#2d323d', text: '#e8eaf0', muted: '#9aa1b2', hover: 'rgba(255,255,255,0.06)',
  canvasBg: '#101216', danger: '#f87171', shadow: '0 16px 40px -12px rgba(0,0,0,0.65), 0 2px 8px rgba(0,0,0,0.35)',
};
// Stil Acryl: Flächen durchscheinend über dem Rauch, Aufklappendes fast deckend (--popup)
const ACRYL_DARK = {
  bg: '#1f2023', panel: 'rgba(255,255,255,0.055)', panel2: 'rgba(255,255,255,0.08)', line: 'rgba(255,255,255,0.11)',
  text: '#f0f1f4', muted: '#adb0b9', hover: 'rgba(255,255,255,0.08)', canvasBg: 'rgba(0,0,0,0.26)', popup: 'rgba(40,41,46,0.94)',
};
const ACRYL_LIGHT = {
  bg: '#eaeaed', panel: 'rgba(255,255,255,0.46)', panel2: 'rgba(255,255,255,0.62)', line: 'rgba(0,0,0,0.10)',
  text: '#17181c', muted: '#5b5c66', hover: 'rgba(0,0,0,0.05)', canvasBg: 'rgba(255,255,255,0.34)', popup: 'rgba(248,248,250,0.95)',
};
export const ACCENTS = ['#3b82f6', '#0ea5e9', '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#64748b'];

export function applyTheme(accent, dark, look = 'standard') {
  const acryl = look === 'acryl';
  const v = { ...(dark ? DARK : LIGHT), ...(acryl ? (dark ? ACRYL_DARK : ACRYL_LIGHT) : {}) };
  v.popup = v.popup || v.panel;
  const a = parseHex(accent) || parseHex('#3b82f6');
  v.accent = accent;
  v.accentText = luminance(a) > 0.62 ? '#111827' : '#ffffff';
  v.accentSoft = `rgba(${a.r},${a.g},${a.b},${dark ? 0.22 : 0.14})`;
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.look = acryl ? 'acryl' : 'standard';
  root.style.setProperty('--smoke', acryl ? `url("${smokeUrl(hueOf(accent), dark)}")` : 'none');
  const names = { bg: '--bg', panel: '--panel', panel2: '--panel2', line: '--line', text: '--text', muted: '--muted', hover: '--hover', canvasBg: '--canvas-bg', popup: '--popup', danger: '--danger', shadow: '--shadow', accent: '--accent', accentText: '--accent-text', accentSoft: '--accent-soft' };
  for (const [k, css] of Object.entries(names)) root.style.setProperty(css, v[k]);
  root.style.colorScheme = dark ? 'dark' : 'light';
  return v;
}
