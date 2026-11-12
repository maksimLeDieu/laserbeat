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

let acct = null;
try { acct = ipcRenderer.sendSync('acct:state') || null; } catch (e) { acct = null; }

contextBridge.exposeInMainWorld('laserbeat', {
  accounts: {
    state: acct,
    list: () => ipcRenderer.invoke('acct:list'),
    create: (name, login, pw, initial) => ipcRenderer.invoke('acct:create', String(name || ''), String(login || ''), String(pw || ''), initial || null),
    login: (login, pw) => ipcRenderer.invoke('acct:login', String(login || ''), String(pw || '')),
    logout: () => ipcRenderer.invoke('acct:logout'),
    changePassword: (oldPw, newPw) => ipcRenderer.invoke('acct:password', String(oldPw || ''), String(newPw || '')),
    remove: pw => ipcRenderer.invoke('acct:remove', String(pw || '')),
    setProfile: (key, value) => ipcRenderer.send('prof:set', String(key), value)
  },
  version,
  store: {
    get: key => (Object.prototype.hasOwnProperty.call(cfg, key) ? cfg[key] : undefined),
    set: (key, value) => { cfg[key] = value; ipcRenderer.send('cfg:set', key, value); }
  },
  tracks,
  importTracks: playlist => ipcRenderer.invoke('lib:import', String(playlist || '')),
  saveDuration: (id, dur) => ipcRenderer.send('lib:duration', id, dur),
  readAudio: id => ipcRenderer.invoke('lib:read', String(id)),
  onMediaKey: cb => ipcRenderer.on('media:key', (e, a) => cb(String(a))),
  confirmDelete: title => ipcRenderer.invoke('lib:confirm-delete', String(title)),
  deleteTrack: id => ipcRenderer.invoke('lib:delete', String(id)),
  updateReady,
  onUpdate: cb => ipcRenderer.on('update:ready', (e, v) => cb(String(v))),
  installUpdate: () => ipcRenderer.send('update:install'),
  launchUpdateCheck: () => ipcRenderer.invoke('update:launch-check'),
  setPlaying: playing => ipcRenderer.send('player:state', !!playing),
  log: msg => ipcRenderer.send('log', String(msg))
});
