'use strict';
/*
 * LaserBeat - processus principal Electron.
 * - Une seule fenêtre, chargée depuis les fichiers locaux (aucun serveur, aucun port).
 * - Aucune navigation vers l'extérieur, aucun navigateur ouvert.
 * - Son maintenu fenêtre réduite, pas de mise en veille pendant la lecture.
 * - Réglages dans %APPDATA%\LaserBeat\config.json, morceaux ajoutés dans %APPDATA%\LaserBeat\musiques.
 */
const { app, BrowserWindow, Menu, ipcMain, powerSaveBlocker, dialog, globalShortcut, session, safeStorage } = require('electron');
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs');
const { Config } = require('./config');
const library = require('./library');
const { Accounts } = require('./accounts');
const { setupUpdater } = require('./updater');

const APP_ID = 'fr.laserbeat.app';
/* Comptes des salles : système prêt mais PAS ENCORE ACTIVÉ. Passer à true pour l'ouvrir aux salles.
   (Les tests automatiques l'activent pour eux seuls avec LASERBEAT_TEST + LASERBEAT_ACCOUNTS=1.) */
const ACCOUNTS_ENABLED = false;
const accountsOn = () => ACCOUNTS_ENABLED || (!!process.env.LASERBEAT_TEST && process.env.LASERBEAT_ACCOUNTS === '1');
const INDEX = path.join(__dirname, 'renderer', 'index.html');
const INDEX_URL = pathToFileURL(INDEX).href;

/* ---------- options Chromium (avant 'ready') ---------- */
// Lecture sans geste préalable (Agenda, reprise automatique au lancement).
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Ne jamais ralentir la page quand la fenêtre est réduite, masquée ou recouverte.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
// HardwareMediaKeyHandling : les touches multimédia sont gérées par Musique ML lui-même (voir registerMediaKeys),
// sinon Chromium les traiterait aussi et une pression compterait deux fois.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,HardwareMediaKeyHandling');

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

  /* ----- Sécurité des échanges avec la page -----
     Chaque demande doit venir de la page de Musique ML elle-même (jamais d'une autre page ou d'un cadre). */
  const fromApp = e => { try { const u = e.senderFrame && e.senderFrame.url; return !!u && u.split('#')[0] === INDEX_URL; } catch (err) { return false; } };
  const on = (ch, fn) => ipcMain.on(ch, (e, ...a) => { if (!fromApp(e)) { log('IPC refusé', ch); e.returnValue = null; return; } fn(e, ...a); });
  const handle = (ch, fn) => ipcMain.handle(ch, (e, ...a) => { if (!fromApp(e)) { log('IPC refusé', ch); return null; } return fn(e, ...a); });

  /* ----- IPC : réglages ----- */
  on('cfg:load', e => { e.returnValue = config.all(); });
  on('cfg:set', (e, key, value) => {
    // seulement les réglages de Musique ML (lb_...), et jamais une valeur démesurée
    if (typeof key !== 'string' || !/^lb_[a-zA-Z0-9_]{1,40}$/.test(key)) return;
    let size = 0; try { size = JSON.stringify(value === undefined ? null : value).length; } catch (err) { return; }
    if (size > 2 * 1024 * 1024) { log('réglage trop gros refusé', key, size); return; }
    config.set(key, value);
  });

  /* ----- IPC : morceaux ----- */
  on('app:version', e => { e.returnValue = app.getVersion(); });
  on('lib:load', e => {
    try { e.returnValue = library.loadAll(musicDirs); } catch (err) { log('lib:load', err); e.returnValue = []; }
  });
  handle('lib:import', async (e, playlist) => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Ajouter des morceaux à Musique ML',
      buttonLabel: 'Ajouter',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Fichiers audio', extensions: library.AUDIO_EXT.map(x => x.slice(1)) }]
    });
    if (r.canceled || !r.filePaths.length) return [];
    try { return library.importFiles(musicDirs.user, r.filePaths, playlist); } catch (err) { log('lib:import', err); return []; }
  });
  handle('lib:confirm-delete', async (e, title) => {
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
  handle('lib:delete', (e, id) => {
    try { return library.deleteTrack(musicDirs.user, id); } catch (err) { log('lib:delete', err); return false; }
  });
  // Lecture d'un morceau connu (fourni ou ajouté) pour mesurer son volume : jamais un autre fichier du disque.
  handle('lib:read', async (e, id) => {
    try { return await library.readAudio(musicDirs, id); } catch (err) { log('lib:read', err); return null; }
  });
  /* ----- IPC : comptes des salles (enregistrés et protégés sur ce PC, voir accounts.js) ----- */
  let accounts = null;
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const OFF = { ok: false, error: 'Les comptes ne sont pas encore disponibles.' };
  on('acct:state', e => { e.returnValue = accounts ? { enabled: true, account: accounts.current(), profile: accounts.profile(), count: accounts.list().length } : { enabled: false }; });
  handle('acct:list', () => (accounts ? accounts.list() : []));
  handle('acct:create', (e, name, login, pw, initial) => !accounts ? OFF : accounts.create(str(name, 80), str(login, 64), str(pw, 300), initial && typeof initial === 'object' ? initial : null));
  handle('acct:login', (e, login, pw) => !accounts ? OFF : accounts.login(str(login, 64), str(pw, 300)));
  handle('acct:logout', () => (!accounts ? OFF : accounts.logout()));
  handle('acct:password', (e, oldPw, newPw) => !accounts ? OFF : accounts.changePassword(str(oldPw, 300), str(newPw, 300)));
  handle('acct:remove', (e, pw) => !accounts ? OFF : accounts.remove(str(pw, 300)));
  on('prof:set', (e, key, value) => { if (accounts) accounts.setProfile(String(key), value); });
  on('lib:duration', (e, id, dur) => {
    try { library.saveDuration(musicDirs.user, id, dur); } catch (err) { log('lib:duration', err); }
  });

  /* ----- IPC : état du lecteur (anti-veille) et journal ----- */
  on('player:state', (e, playing) => setPlaying(!!playing));
  on('log', (e, msg) => log('[interface]', String(msg).slice(0, 2000)));

  app.on('child-process-gone', (e, d) => log('child-process-gone', d));

  app.whenReady().then(() => {
    config = new Config(path.join(app.getPath('userData'), 'config.json'), log);
    if (accountsOn()) accounts = new Accounts(app.getPath('userData'), { safeStorage, log });
    musicDirs = {
      builtin: app.isPackaged ? path.join(process.resourcesPath, 'musiques') : path.join(__dirname, '..', 'musiques'),
      user: path.join(app.getPath('userData'), 'musiques')
    };
    try { fs.mkdirSync(musicDirs.user, { recursive: true }); } catch (err) { log('mkdir', err); }
    Menu.setApplicationMenu(null);
    lockDown();
    log('démarrage', app.getVersion(), musicDirs);
    createWindow();
    registerMediaKeys();
    updater = setupUpdater({ log, getWindow: () => win });
  });

  /* ----- verrous de sécurité -----
     - aucune autorisation (caméra, micro, position, notifications...) : seul le plein écran est permis ;
     - la page ne peut joindre aucun site Internet (la seule connexion du logiciel, les mises à jour,
       part du processus principal) ;
     - aucune fenêtre, aucun cadre intégré (webview) ni aucune navigation ailleurs que la page de Musique ML. */
  function lockDown() {
    const ses = session.defaultSession;
    ses.setPermissionRequestHandler((wc, permission, cb) => cb(permission === 'fullscreen'));
    ses.setPermissionCheckHandler((wc, permission) => permission === 'fullscreen' || permission === 'media');
    ses.setDevicePermissionHandler(() => false);
    ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*', 'ftp://*/*'] }, (d, cb) => {
      const fromPage = typeof d.webContentsId === 'number' && d.webContentsId > 0;
      if (fromPage) log('accès Internet bloqué depuis la page :', d.url.slice(0, 200));
      cb({ cancel: fromPage });
    });
  }
  app.on('web-contents-created', (e, wc) => {
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-attach-webview', ev => ev.preventDefault());
    wc.on('will-navigate', (ev, url) => { if (url.split('#')[0] !== INDEX_URL) ev.preventDefault(); });
  });

  /* ----- touches multimédia du clavier (lecture/pause, suivant, précédent, stop) -----
     Elles marchent même quand la fenêtre est réduite, cachée ou derrière une autre application. */
  function registerMediaKeys() {
    const keys = { MediaPlayPause: 'playpause', MediaNextTrack: 'next', MediaPreviousTrack: 'prev', MediaStop: 'stop' };
    for (const [key, action] of Object.entries(keys)) {
      try {
        const ok = globalShortcut.register(key, () => { if (win && !win.isDestroyed()) win.webContents.send('media:key', action); });
        if (!ok) log('touche multimédia déjà utilisée par une autre application :', key);
      } catch (err) { log('touche multimédia', key, err); }
    }
  }
  app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch (e) { /* rien */ } });

  app.on('window-all-closed', () => app.quit());
  // Fermeture voulue (Quitter, mise à jour, redémarrage de nuit, arrêt de Windows) : la fenêtre se ferme sans question.
  app.on('before-quit', () => { quitting = true; setPlaying(false); if (config) config.flush(); if (accounts) accounts.flush(); });

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
