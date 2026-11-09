'use strict';
/*
 * Mise à jour automatique (versions publiées sur GitHub Releases).
 *
 * - AU LANCEMENT : avant de démarrer la musique, l'interface demande s'il y a une mise à jour prête
 *   (vérification limitée à quelques secondes). Si oui, elle s'installe tout de suite
 *   (écran « Mise à jour », installation silencieuse, redémarrage). Sinon, la musique démarre.
 * - PENDANT L'UTILISATION : les nouvelles versions sont seulement téléchargées en arrière-plan,
 *   sans couper la musique ; elles s'installeront au lancement suivant (ou par le bouton, ou en quittant).
 * - Jamais pendant un arrêt de Windows. Sans Internet, rien ne se passe et la musique démarre normalement.
 */
const { app, ipcMain } = require('electron');

const LAUNCH_WAIT_MS = 6000;               // attente maximale au lancement avant de démarrer la musique
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000; // téléchargement des nouvelles versions toutes les 4 h

function setupUpdater({ log, getWindow }) {
  let ready = null;
  ipcMain.on('update:get', e => { e.returnValue = ready; });

  // Pas de mise à jour en développement, hors Windows, ni pendant les tests automatiques.
  if (!app.isPackaged || process.platform !== 'win32' || process.env.LASERBEAT_TEST) {
    // Tests : LASERBEAT_TEST_LAUNCH_UPDATE simule une mise à jour prête au lancement.
    ipcMain.handle('update:launch-check', async () => process.env.LASERBEAT_TEST_LAUNCH_UPDATE || null);
    ipcMain.on('update:install', () => {});
    return { onSessionEnd() {} };
  }

  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    log('[maj] module indisponible', err);
    ipcMain.handle('update:launch-check', async () => null);
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

  // Résultat de la première vérification (celle du lancement).
  let settleLaunch;
  const launchResult = new Promise(res => { settleLaunch = res; });
  setTimeout(() => settleLaunch(null), LAUNCH_WAIT_MS);

  autoUpdater.on('update-downloaded', info => {
    ready = info && info.version ? String(info.version) : 'nouvelle';
    log('[maj] version prête', ready);
    settleLaunch(ready);
    notify();
  });
  autoUpdater.on('update-not-available', () => settleLaunch(null));
  // Écouteur obligatoire : sans lui, une erreur réseau ferait planter le processus.
  autoUpdater.on('error', err => {
    log('[maj] vérification impossible', err && err.message ? err.message : String(err));
    settleLaunch(null);
  });

  let checking = false;
  const check = () => {
    if (checking || ready) return;
    checking = true;
    Promise.resolve()
      .then(() => autoUpdater.checkForUpdates())
      .catch(() => { /* déjà noté par l'écouteur 'error' */ })
      .then(() => { checking = false; });
  };
  check();                          // tout de suite, pour le lancement
  setInterval(check, CHECK_EVERY_MS);

  // L'interface attend cette réponse (au plus LAUNCH_WAIT_MS) avant de démarrer la musique.
  ipcMain.handle('update:launch-check', () => launchResult);

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
