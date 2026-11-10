'use strict';

// Schmale Brücke zwischen Oberfläche und Hauptprozess (keine Node-APIs im Renderer).
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const on = (channel, cb) => {
  const f = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, f);
  return () => ipcRenderer.removeListener(channel, f);
};

contextBridge.exposeInMainWorld('api', {
  info: () => invoke('app:info'),
  getSettings: () => invoke('settings:get'),
  setSettings: (s) => invoke('settings:set', s),
  onSystemTheme: (cb) => on('app:system-theme', cb),

  state: () => invoke('hub:state'),
  refresh: (force) => invoke('hub:refresh', force),
  install: (id) => invoke('hub:install', id),
  uninstall: (id) => invoke('hub:uninstall', id),
  cancel: (id) => invoke('hub:cancel', id),
  dismiss: (id) => invoke('hub:dismiss', id),
  open: (id) => invoke('hub:open', id),
  reveal: (id) => invoke('hub:reveal', id),
  move: (ids) => invoke('hub:move', ids),
  pickDir: (current) => invoke('hub:pick-dir', current),
  web: (id, url) => invoke('hub:web', id, url),
  onState: (cb) => on('hub:state', cb),
  onJob: (cb) => on('hub:job', cb),
  onShow: (cb) => on('hub:show', cb),

  openExternal: (url) => invoke('shell:open-external', url),
});
