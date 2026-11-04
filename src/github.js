'use strict';

// Releases von GitHub lesen. Ohne Anmeldung erlaubt GitHub 60 Anfragen pro Stunde - deshalb merkt sich W Hub
// jede Antwort mit ihrem ETag: unveränderte Releases kommen als "304 Not Modified" und zählen nicht mit.
const fs = require('fs');
const path = require('path');
const { net } = require('electron');

// Für den Selbsttest lässt sich die Adresse umbiegen (lokaler Testserver statt api.github.com)
const API = process.env.WHUB_API || 'https://api.github.com';

let cacheFile = null;
let cache = {};

function init(dir) {
  cacheFile = path.join(dir, 'releases.json');
  try {
    cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  } catch {
    cache = {};
  }
}
function persist() {
  if (!cacheFile) return;
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(`${cacheFile}.tmp`, JSON.stringify(cache));
    fs.renameSync(`${cacheFile}.tmp`, cacheFile);
  } catch {
    // Zwischenspeicher ist nur eine Hilfe
  }
}

/** Nur das, was W Hub braucht */
function slim(r) {
  return {
    tag: r.tag_name,
    name: r.name || r.tag_name,
    date: r.published_at || r.created_at,
    body: String(r.body || '').slice(0, 20000),
    url: r.html_url,
    prerelease: !!r.prerelease,
    assets: (r.assets || []).map((a) => ({ name: a.name, size: a.size, url: a.browser_download_url, digest: a.digest || null })),
  };
}

/**
 * Releases eines Repos, neueste zuerst. Liefert { list, from: 'net' | 'cache', error }.
 * Bei Fehlern (offline, Limit erreicht) kommt der letzte bekannte Stand.
 */
async function releases(repo, { force = false } = {}) {
  const old = cache[repo];
  if (old && !force && Date.now() - old.time < 10 * 60 * 1000) return { list: old.list, from: 'cache' };
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'W-Hub', 'X-GitHub-Api-Version': '2022-11-28' };
  if (old && old.etag) headers['If-None-Match'] = old.etag;
  try {
    const res = await net.fetch(`${API}/repos/${repo}/releases?per_page=12`, { headers, cache: 'no-store' });
    if (res.status === 304 && old) {
      old.time = Date.now();
      persist();
      return { list: old.list, from: 'net' };
    }
    if (!res.ok) {
      const limited = res.status === 403 || res.status === 429;
      return { list: old ? old.list : [], from: 'cache', error: limited ? 'limit' : `http ${res.status}` };
    }
    const list = (await res.json()).filter((r) => !r.draft).map(slim);
    cache[repo] = { etag: res.headers.get('etag'), time: Date.now(), list };
    persist();
    return { list, from: 'net' };
  } catch (e) {
    return { list: old ? old.list : [], from: 'cache', error: 'offline' };
  }
}

/** Neuestes richtiges Release (ohne Vorabversionen, solange es eine normale gibt) */
function latest(list) {
  return list.find((r) => !r.prerelease) || list[0] || null;
}

module.exports = { init, releases, latest };
