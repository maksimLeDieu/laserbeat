'use strict';
/*
 * LaserBeat - processus principal Electron.
 * - Une seule fenêtre, chargée depuis les fichiers locaux (aucun serveur, aucun port).
 * - Aucune navigation vers l'extérieur, aucun navigateur ouvert.
 * - Son maintenu fenêtre réduite, pas de mise en veille pendant la lecture.
 * - Réglages dans %APPDATA%\LaserBeat\config.json, morceaux ajoutés dans %APPDATA%\LaserBeat\musiques.
 */
const { app, BrowserWindow, Menu, ipcMain, powerSaveBlocker, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { Config } = require('./config');
const library = require('./library');
const { setupUpdater } = require('./updater');

const APP_ID = 'fr.laserbeat.app';
const INDEX = path.join(__dirname, 'renderer', 'index.html');

/* ---------- options Chromium (avant 'ready') ---------- */
// Lecture sans geste préalable (Agenda, reprise automatique au lancement).
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Ne jamais ralentir la page quand la fenêtre est réduite, masquée ou recouverte.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
// Tests automatiques uniquement : dossier de données isolé (jamais utilisé en temps normal).
if (process.env.LASERBEAT_USER_DATA) app.setPath('userData', process.env.LASERBEAT_USER_DATA);

/* ---------- journal (pour comprendre un éventuel problème) ---------- */
let logFile = null;
function log(...args) {
  const line = new Date().toISOString() + ' ' + args.map(a => (a instanceof Error ? a.stack : typeof a === 'string' ? a : JSON.stringify(a))).join(' ') + '\n';
  try {
    if (!logFile) logFile = path.join(app.getPath('userData'), 'laserbeat.log');
    try { if (fs.statSync(logFile).size > 1024 * 1024) fs.renameSync(logFile, logFile + '.old'); } catch (e) { /* pas encore de journal */ }
    fs.appendFileSync(logFile, line);
  } catch (e) { /* le journal ne doit jamais faire planter l'application */ }
  if (!app.isPackaged) process.stdout.write(line);
}
process.on('uncaughtException', err => log('uncaughtException', err));
process.on('unhandledRejection', err => log('unhandledRejection', err));

/* ---------- une seule instance ---------- */
let win = null;
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  start();
}

function showWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function start() {
  let config = null;
  let musicDirs = null;
  let blockerId = null;
  let updater = null;
  let quitting = false;

  function setPlaying(playing) {
    if (playing && blockerId === null) {
      blockerId = powerSaveBlocker.start('prevent-display-sleep');
    } else if (!playing && blockerId !== null) {
      if (powerSaveBlocker.isStarted(blockerId)) powerSaveBlocker.stop(blockerId);
      blockerId = null;
    }
  }

  /* ----- IPC : réglages ----- */
  ipcMain.on('cfg:load', e => { e.returnValue = config.all(); });
  ipcMain.on('cfg:set', (e, key, value) => {
    if (typeof key === 'string' && key.startsWith('lb_')) config.set(key, value);
  });

  /* ----- IPC : morceaux ----- */
  ipcMain.on('app:version', e => { e.returnValue = app.getVersion(); });
  ipcMain.on('lib:load', e => {
    try { e.returnValue = library.loadAll(musicDirs); } catch (err) { log('lib:load', err); e.returnValue = []; }
  });
  ipcMain.handle('lib:import', async (e, playlist) => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Ajouter des morceaux à Musique ML',
      buttonLabel: 'Ajouter',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Fichiers audio', extensions: library.AUDIO_EXT.map(x => x.slice(1)) }]
    });
    if (r.canceled || !r.filePaths.length) return [];
    try { return library.importFiles(musicDirs.user, r.filePaths, playlist); } catch (err) { log('lib:import', err); return []; }
  });
  ipcMain.handle('lib:confirm-delete', async (e, title) => {
    const r = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Supprimer', 'Annuler'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: 'Supprimer un morceau',
      message: `Supprimer « ${String(title).slice(0, 120)} » ?`,
      detail: 'Le morceau sera retiré de Musique ML et son fichier effacé du dossier de vos morceaux. Cette action est définitive.'
    });
    return r.response === 0;
  });
  ipcMain.handle('lib:delete', (e, id) => {
    try { return library.deleteTrack(musicDirs.user, id); } catch (err) { log('lib:delete', err); return false; }
  });
  ipcMain.on('lib:duration', (e, id, dur) => {
    try { library.saveDuration(musicDirs.user, id, dur); } catch (err) { log('lib:duration', err); }
  });

  /* ----- IPC : état du lecteur (anti-veille) et journal ----- */
  ipcMain.on('player:state', (e, playing) => setPlaying(!!playing));
  ipcMain.on('log', (e, msg) => log('[interface]', String(msg).slice(0, 2000)));

  app.on('child-process-gone', (e, d) => log('child-process-gone', d));

  app.whenReady().then(() => {
    config = new Config(path.join(app.getPath('userData'), 'config.json'), log);
    musicDirs = {
      builtin: app.isPackaged ? path.join(process.resourcesPath, 'musiques') : path.join(__dirname, '..', 'musiques'),
      user: path.join(app.getPath('userData'), 'musiques')
    };
    try { fs.mkdirSync(musicDirs.user, { recursive: true }); } catch (err) { log('mkdir', err); }
    Menu.setApplicationMenu(null);
    log('démarrage', app.getVersion(), musicDirs);
    createWindow();
    updater = setupUpdater({ log, getWindow: () => win });
  });

  app.on('window-all-closed', () => app.quit());
  // Fermeture voulue (Quitter, mise à jour, redémarrage de nuit, arrêt de Windows) : la fenêtre se ferme sans question.
  app.on('before-quit', () => { quitting = true; setPlaying(false); if (config) config.flush(); });

  // Aucune fenêtre ou vue supplémentaire : tout reste dans la fenêtre LaserBeat.
  app.on('web-contents-created', (e, wc) => {
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-attach-webview', ev => ev.preventDefault());
  });

  function createWindow() {
    win = new BrowserWindow({
      width: 1360,
      height: 860,
      minWidth: 1000,
      minHeight: 640,
      center: true,
      show: false,
      title: 'Musique ML',
      icon: path.join(__dirname, '..', 'assets', process.platform === 'win32' ? 'laserbeat.ico' : 'laserbeat.png'),
      backgroundColor: '#0a0910',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        spellcheck: false,
        devTools: !app.isPackaged
      }
    });
    win.setMenuBarVisibility(false);

    const wc = win.webContents;
    const showOnce = () => { if (win && !win.isDestroyed() && !win.isVisible()) win.show(); };
    win.once('ready-to-show', showOnce);
    setTimeout(showOnce, 4000);

    // Interdit toute navigation (lien, glisser-déposer d'un fichier...) : la page reste LaserBeat.
    wc.on('will-navigate', e => e.preventDefault());
    wc.on('will-redirect', e => e.preventDefault());

    // Si la page plante, on la recharge : la lecture reprend là où elle en était.
    wc.on('render-process-gone', (e, d) => {
      log('render-process-gone', d);
      setPlaying(false);
      if (d.reason === 'clean-exit') return;
      setTimeout(() => { if (win && !win.isDestroyed()) win.loadFile(INDEX); }, 1500);
    });
    let hangTimer = null;
    win.on('unresponsive', () => {
      log('unresponsive');
      clearTimeout(hangTimer);
      hangTimer = setTimeout(() => { if (win && !win.isDestroyed()) { log('reload after hang'); wc.forcefullyCrashRenderer(); } }, 20000);
    });
    win.on('responsive', () => clearTimeout(hangTimer));
    wc.on('did-fail-load', (e, code, desc) => log('did-fail-load', code, desc));
    wc.on('console-message', (e) => { if (e.level === 'error') log('[console]', e.message); });

    // Arrêt de Windows : pas d'installation de mise à jour à ce moment-là.
    win.on('query-session-end', () => { quitting = true; });
    win.on('session-end', () => { quitting = true; if (updater) updater.onSessionEnd(); });

    // Croix de la fenêtre (ou Alt+F4) : on propose de réduire, pour ne pas couper la musique par erreur.
    let asking = false;
    win.on('close', e => {
      if (quitting) return;
      e.preventDefault();
      if (asking) return;
      asking = true;
      dialog.showMessageBox(win, {
        type: 'question',
        buttons: ['Réduire', 'Quitter Musique ML', 'Annuler'],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
        title: 'Musique ML',
        message: 'Fermer Musique ML ?',
        detail: 'Réduire : la musique continue, Musique ML reste dans la barre des tâches.\nQuitter : la musique s\'arrête.'
      }).then(r => {
        asking = false;
        if (!win || win.isDestroyed()) return;
        if (r.response === 0) win.minimize();
        else if (r.response === 1) { log('fermeture demandée'); app.quit(); }
      }).catch(err => { asking = false; log('dialogue fermeture', err); });
    });
    win.on('closed', () => { win = null; setPlaying(false); });
    win.loadFile(INDEX);
  }
}
