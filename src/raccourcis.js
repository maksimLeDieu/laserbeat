'use strict';
/*
 * Réparation des raccourcis Windows de Musique ML (barre des tâches, Bureau, menu Démarrer).
 *
 * Un raccourci épinglé avant le changement de nom et de logo (2.6.0) peut garder un chemin d'icône
 * que Windows ne retrouve plus : la barre des tâches affiche alors une page blanche au lieu du logo ML.
 * Une fois par version installée, on remet sur chacun de NOS raccourcis : le bon programme,
 * l'icône du programme (logo ML) et l'identifiant d'application (pour regrouper la fenêtre dessus),
 * puis on demande à Windows de rafraîchir ses icônes. Les raccourcis des autres logiciels ne sont jamais touchés.
 */
const fs = require('fs');
const path = require('path');

const EXE_NAME = 'laserbeat.exe';
const NAMES = ['musique ml.lnk', 'laserbeat.lnk'];

function shortcutDirs(appData, desktop) {
  return [
    path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar'),
    path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch'),
    path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    desktop
  ].filter(Boolean);
}

/* Le raccourci est-il le nôtre ? (cible LaserBeat.exe, notre identifiant d'application, ou nom du raccourci) */
function isOurs(file, link, appId) {
  const target = String(link.target || '').toLowerCase();
  return path.win32.basename(target) === EXE_NAME
    || (!!link.appUserModelId && link.appUserModelId === appId)
    || (NAMES.includes(path.basename(file).toLowerCase()) && !target);
}

/* Répare les raccourcis ; renvoie la liste des fichiers modifiés. */
function repairShortcuts({ shell, exe, appId, dirs, log = () => {} }) {
  const fixed = [];
  for (const dir of dirs) {
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.lnk')); } catch (e) { continue; }
    for (const f of files) {
      const file = path.join(dir, f);
      let link;
      try { link = shell.readShortcutLink(file); } catch (e) { continue; }
      if (!isOurs(f, link, appId)) continue;
      try {
        const ok = shell.writeShortcutLink(file, 'update', {
          target: exe, cwd: path.dirname(exe), icon: exe, iconIndex: 0, appUserModelId: appId
        });
        if (ok) fixed.push(file); else log('raccourci non modifié', file);
      } catch (e) { log('raccourci', file, e.message); }
    }
  }
  return fixed;
}

module.exports = { repairShortcuts, shortcutDirs, isOurs };
