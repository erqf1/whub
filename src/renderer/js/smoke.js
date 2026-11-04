// Rauch für den Stil Acryl: weiche Wolken aus nur einer Farbfamilie, bewusst ohne Korn.
// Gleiche Rechnung wie in Vidline und Clipline, der Weichzeichner läuft mit laufender Summe.
const cache = new Map();

function boxBlur(px, w, h, r) {
  const c = 2 * r + 1;
  const line = new Uint8Array(Math.max(w, h) * 3);
  const run = (start, len, step) => {
    for (let i = 0; i < len; i++) {
      const o = start + i * step;
      line[i * 3] = px[o];
      line[i * 3 + 1] = px[o + 1];
      line[i * 3 + 2] = px[o + 2];
    }
    for (let ch = 0; ch < 3; ch++) {
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += line[Math.min(len - 1, Math.max(0, i)) * 3 + ch];
      for (let i = 0; i < len; i++) {
        px[start + i * step + ch] = sum / c;
        sum += line[Math.min(len - 1, i + r + 1) * 3 + ch] - line[Math.max(0, i - r) * 3 + ch];
      }
    }
  };
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) run(y * w * 4, w, 4);
    for (let x = 0; x < w; x++) run(x * 4, h, w * 4);
  }
}

/** Farbton einer Akzentfarbe; Grau bekommt kühlen Rauch */
export function hueOf(hex) {
  const n = parseInt(String(hex).replace('#', '').slice(0, 6), 16);
  const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!Number.isFinite(n) || d < 0.1) return 215;
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round(h * 60);
}

/** Bild als data-URL für CSS */
export function smokeUrl(hue, dark) {
  if (hue >= 28 && hue <= 75) hue = 22;  // Gelb und Orange würden dunkel olivgrün, deshalb warmes Braunrot
  const key = `${hue}-${dark ? 'd' : 'l'}`;
  if (cache.has(key)) return cache.get(key);
  const W = 640, H = 360;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = dark ? `hsl(${hue} 9% 15%)` : `hsl(${hue} 12% 91%)`;
  g.fillRect(0, 0, W, H);
  let seed = 11;
  const pick = (a, b) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return a + (seed >>> 8) % (b - a + 1);
  };
  for (let i = 0; i < 11; i++) {
    const h2 = (hue + pick(-14, 14) + 360) % 360;
    g.fillStyle = dark ? `hsl(${h2} ${pick(20, 36)}% ${pick(22, 31)}%)` : `hsl(${h2} ${pick(20, 35)}% ${pick(84, 89)}%)`;
    const rx = pick(60, 175), ry = pick(40, 120);
    g.beginPath();
    g.ellipse(pick(-80, W) + rx, pick(-80, H) + ry, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
  }
  const img = g.getImageData(0, 0, W, H);
  boxBlur(img.data, W, H, 55);
  g.putImageData(img, 0, 0);
  const url = c.toDataURL('image/png');
  cache.set(key, url);
  return url;
}
