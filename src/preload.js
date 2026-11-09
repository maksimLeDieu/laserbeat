'use strict';
/* Pont sécurisé entre l'interface et le processus principal (aucun accès Node dans la page). */
const { contextBridge, ipcRenderer } = require('electron');

let cfg = {};
try { cfg = ipcRenderer.sendSync('cfg:load') || {}; } catch (e) { cfg = {}; }

let tracks = [];
try { tracks = ipcRenderer.sendSync('lib:load') || []; } catch (e) { tracks = []; }

let version = '';
let updateReady = null;
try { updateReady = ipcRenderer.sendSync('update:get') || null; } catch (e) { updateReady = null; }
try { version = ipcRenderer.sendSync('app:version') || ''; } catch (e) { version = ''; }

contextBridge.exposeInMainWorld('laserbeat', {
  version,
  store: {
    get: key => (Object.prototype.hasOwnProperty.call(cfg, key) ? cfg[key] : undefined),
    set: (key, value) => { cfg[key] = value; ipcRenderer.send('cfg:set', key, value); }
  },
  tracks,
  importTracks: playlist => ipcRenderer.invoke('lib:import', String(playlist || '')),
  saveDuration: (id, dur) => ipcRenderer.send('lib:duration', id, dur),
  confirmDelete: title => ipcRenderer.invoke('lib:confirm-delete', String(title)),
  deleteTrack: id => ipcRenderer.invoke('lib:delete', String(id)),
  updateReady,
  onUpdate: cb => ipcRenderer.on('update:ready', (e, v) => cb(String(v))),
  installUpdate: () => ipcRenderer.send('update:install'),
  launchUpdateCheck: () => ipcRenderer.invoke('update:launch-check'),
  setPlaying: playing => ipcRenderer.send('player:state', !!playing),
  log: msg => ipcRenderer.send('log', String(msg))
});
