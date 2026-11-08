'use strict';
/*
 * Mise à jour automatique (versions publiées sur GitHub Releases).
 * - Ne bloque jamais la musique : sans Internet, la vérification échoue en silence (juste notée au journal).
 * - La nouvelle version est téléchargée en arrière-plan, puis installée :
 *     • quand on clique sur « Installer la mise à jour » dans LaserBeat (redémarrage + reprise de la musique),
 *     • ou à la prochaine fermeture normale de LaserBeat.
 * - Jamais pendant un arrêt de Windows (une installation interrompue pourrait abîmer le logiciel).
 */
const { app, ipcMain } = require('electron');

const FIRST_CHECK_MS = 60 * 1000;          // 1 min après le lancement
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000; // puis toutes les 4 h

function setupUpdater({ log, getWindow }) {
  let ready = null;
  ipcMain.on('update:get', e => { e.returnValue = ready; });

  if (!app.isPackaged || process.platform !== 'win32') {
    ipcMain.on('update:install', () => {});
    return { onSessionEnd() {} };
  }

  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    log('[maj] module indisponible', err);
    ipcMain.on('update:install', () => {});
    return { onSessionEnd() {} };
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.logger = {
    info: m => log('[maj]', String(m)),
    warn: m => log('[maj]', String(m)),
    error: m => log('[maj] erreur', String(m)),
    debug: () => {}
  };

  const notify = () => {
    const w = getWindow();
    if (ready && w && !w.isDestroyed()) w.webContents.send('update:ready', ready);
  };

  autoUpdater.on('update-downloaded', info => {
    ready = info && info.version ? String(info.version) : 'nouvelle';
    log('[maj] version prête', ready);
    notify();
  });
  // Écouteur obligatoire : sans lui, une erreur réseau ferait planter le processus.
  autoUpdater.on('error', err => log('[maj] vérification impossible', err && err.message ? err.message : String(err)));

  let checking = false;
  const check = () => {
    if (checking || ready) return;
    checking = true;
    Promise.resolve()
      .then(() => autoUpdater.checkForUpdates())
      .catch(() => { /* déjà noté par l'écouteur 'error' */ })
      .then(() => { checking = false; });
  };
  setTimeout(check, FIRST_CHECK_MS);
  setInterval(check, CHECK_EVERY_MS);

  let installing = false;
  ipcMain.on('update:install', () => {
    if (!ready || installing) return;
    installing = true;
    log('[maj] installation demandée', ready);
    // Installation silencieuse puis relance de LaserBeat ; la musique reprend toute seule.
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 300);
  });

  return {
    // Arrêt ou déconnexion de Windows : on n'installe pas à ce moment-là.
    onSessionEnd() { autoUpdater.autoInstallOnAppQuit = false; }
  };
}

module.exports = { setupUpdater };
