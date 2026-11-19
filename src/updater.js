'use strict';
/*
 * Mise à jour automatique (versions publiées sur GitHub Releases).
 *
 * - AU LANCEMENT : avant de démarrer la musique, l'interface demande s'il y a une mise à jour prête
 *   (vérification limitée à quelques secondes). Si oui, elle s'installe tout de suite
 *   (écran « Mise à jour », installation silencieuse, redémarrage). Sinon, la musique démarre.
 * - PENDANT L'UTILISATION : les nouvelles versions sont seulement téléchargées en arrière-plan,
 *   sans couper la musique ; elles s'installeront au lancement suivant (ou par le bouton, ou en quittant).
 * - À LA DEMANDE : Paramètres > Mise à jour > « Rechercher une mise à jour » lance la recherche tout de suite ;
 *   si une version existe, elle se télécharge puis le bouton « Installer maintenant » apparaît.
 * - Jamais pendant un arrêt de Windows. Sans Internet, rien ne se passe et la musique démarre normalement.
 */
const { app, ipcMain, net, shell } = require('electron');

// Site de téléchargement : sur Mac, les nouvelles versions se récupèrent là (voir setupMacNotice).
const SITE = 'https://maksimledieu.github.io/laserbeat/';
const LATEST_API = 'https://api.github.com/repos/maksimLeDieu/laserbeat/releases/latest';
const MAC_ASSET = 'Musique-ML-Mac.dmg';

const LAUNCH_WAIT_MS = 6000;               // attente maximale au lancement avant de démarrer la musique
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000; // téléchargement des nouvelles versions toutes les 4 h

const newer = (a, b) => {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0; }
  return false;
};

/*
 * Mac : sans certificat Apple payant, macOS refuse qu'une appli se remplace toute seule.
 * Musique ML vérifie donc seulement s'il existe une nouvelle version (au lancement, toutes les 4 h,
 * et à la demande) et propose de l'ouvrir sur le site de téléchargement. La musique n'est jamais coupée.
 */
function setupMacNotice({ log, getWindow }) {
  let available = null;
  ipcMain.on('update:avail-get', e => { e.returnValue = available; });
  ipcMain.handle('update:launch-check', async () => null);
  ipcMain.on('update:install', () => {});
  ipcMain.on('update:site', () => { log('[maj] ouverture du site de téléchargement'); shell.openExternal(SITE).catch(() => {}); });
  const look = () => net.fetch(LATEST_API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Musique-ML' } })
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(d => {
      const v = String(d.tag_name || '').replace(/^v/, '');
      // la version Mac n'est annoncée que si son installateur est bien publié
      const mac = (d.assets || []).some(a => a.name === MAC_ASSET);
      if (v && mac && newer(v, app.getVersion())) {
        if (available !== v) {
          available = v; log('[maj] nouvelle version disponible sur le site', v);
          const w = getWindow(); if (w && !w.isDestroyed()) w.webContents.send('update:available', v);
        }
        return { status: 'available', version: v };
      }
      return { status: 'none' };
    })
    .catch(err => { log('[maj] vérification impossible', err && err.message ? err.message : String(err)); return { status: 'error' }; });
  look();
  setInterval(look, CHECK_EVERY_MS);
  ipcMain.handle('update:check', () => look());
  return { onSessionEnd() {} };
}

function setupUpdater({ log, getWindow }) {
  let ready = null;
  ipcMain.on('update:get', e => { e.returnValue = ready; });

  if (app.isPackaged && process.platform === 'darwin' && !process.env.LASERBEAT_TEST) return setupMacNotice({ log, getWindow });
  ipcMain.on('update:avail-get', e => { e.returnValue = null; });

  // Pas de mise à jour en développement, hors Windows, ni pendant les tests automatiques.
  if (!app.isPackaged || process.platform !== 'win32' || process.env.LASERBEAT_TEST) {
    // Tests : LASERBEAT_TEST_LAUNCH_UPDATE simule une mise à jour prête au lancement.
    ipcMain.handle('update:launch-check', async () => process.env.LASERBEAT_TEST_LAUNCH_UPDATE || null);
    // Tests : LASERBEAT_TEST_MANUAL_UPDATE simule une version trouvée à la demande, prête 1,5 s plus tard.
    // Tests : LASERBEAT_TEST_SITE_UPDATE simule le cas Mac (nouvelle version à prendre sur le site).
    ipcMain.on('update:site', () => log('[maj] ouverture du site de téléchargement (test)'));
    ipcMain.handle('update:check', async () => {
      const sv = process.env.LASERBEAT_TEST && process.env.LASERBEAT_TEST_SITE_UPDATE;
      if (sv) return { status: 'available', version: sv };
      const v = process.env.LASERBEAT_TEST && process.env.LASERBEAT_TEST_MANUAL_UPDATE;
      if (!v) return { status: 'none' };
      if (ready) return { status: 'ready', version: ready };
      setTimeout(() => { ready = v; const w = getWindow(); if (w && !w.isDestroyed()) w.webContents.send('update:ready', ready); }, 1500);
      return { status: 'downloading', version: v };
    });
    ipcMain.on('update:install', () => {});
    return { onSessionEnd() {} };
  }

  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    log('[maj] module indisponible', err);
    ipcMain.handle('update:launch-check', async () => null);
    ipcMain.handle('update:check', async () => ({ status: 'error' }));
    ipcMain.on('update:install', () => {});
    ipcMain.on('update:site', () => {});
    return { onSessionEnd() {} };
  }
  ipcMain.on('update:site', () => {});

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

  // Recherche à la demande (Paramètres > Mise à jour). Le téléchargement suit tout seul ;
  // l'interface est prévenue par 'update:ready' quand la version est prête à installer.
  let manual = null;
  ipcMain.handle('update:check', () => {
    if (ready) return { status: 'ready', version: ready };
    if (!manual) {
      manual = Promise.resolve()
        .then(() => autoUpdater.checkForUpdates())
        .then(r => {
          const v = r && r.updateInfo && r.updateInfo.version ? String(r.updateInfo.version) : null;
          if (ready) return { status: 'ready', version: ready };
          return v && newer(v, app.getVersion()) ? { status: 'downloading', version: v } : { status: 'none' };
        })
        .catch(err => { log('[maj] recherche à la demande impossible', err && err.message ? err.message : String(err)); return { status: 'error' }; })
        .then(res => { manual = null; return res; });
    }
    return manual;
  });

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
