'use strict';
/*
 * Mise à jour sur Mac, sans certificat Apple.
 *
 * Le système de mise à jour standard (celui de Windows) refuse de remplacer une appli Mac non certifiée.
 * Musique ML le fait donc lui-même :
 *  1. il vérifie sur GitHub s'il existe une nouvelle version (au lancement, toutes les 4 h, à la demande) ;
 *  2. il télécharge Musique-ML-Mac.dmg dans un dossier temporaire, vérifie sa taille et son empreinte,
 *     en sort la nouvelle appli, puis SUPPRIME le .dmg ;
 *  3. au clic sur « Installer maintenant » (ou à la fermeture de Musique ML), un petit script attend la
 *     fermeture, met la nouvelle appli À LA PLACE de l'ancienne (l'ancienne est effacée, rien n'est gardé
 *     en double), efface le dossier temporaire, puis relance Musique ML (sauf à la fermeture).
 * Si quelque chose empêche le remplacement (appli lancée depuis le .dmg, dossier protégé…), on revient
 * à l'ancienne méthode : le bouton « Télécharger » ouvre le site.
 * Les réglages et favoris (~/Library/Application Support/LaserBeat) ne sont jamais touchés.
 */
const { app, ipcMain, net, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const SITE = 'https://maksimledieu.github.io/laserbeat/';
const LATEST_API = 'https://api.github.com/repos/maksimLeDieu/laserbeat/releases/latest';
const MAC_ASSET = 'Musique-ML-Mac.dmg';
const PREFIX = 'musique-ml-maj-';
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

const newer = (a, b) => {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0; }
  return false;
};
const run = (cmd, args) => new Promise((res, rej) => execFile(cmd, args, { timeout: 180000 }, (e, out, err) => {
  if (e) rej(new Error(cmd + ' : ' + String(err || e.message).trim().slice(0, 300))); else res(String(out));
}));
const rm = p => { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { /* rien */ } };
const writable = p => { try { fs.accessSync(p, fs.constants.W_OK); return true; } catch (e) { return false; } };

// Script lancé à part : attend la fermeture de Musique ML, remplace l'appli, nettoie, relance.
// Prudence : la nouvelle appli est d'abord vérifiée puis copiée À CÔTÉ de l'ancienne (même dossier), pour
// que l'échange final soit deux renommages instantanés. En cas d'échec, l'ancienne appli est remise.
// Le résultat est noté dans un journal que Musique ML recopie dans le sien au lancement suivant.
const SWAP = `#!/bin/sh
PID="$1"; OLD="$2"; NEW="$3"; DIR="$4"; RELAUNCH="$5"; LOG="$6"
NEXT="\${OLD%.app} (nouvelle version).app"; BAK="\${OLD%.app} (ancienne version).app"
note() { echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG"; }
i=0; while kill -0 "$PID" 2>/dev/null && [ $i -lt 240 ]; do sleep 0.25; i=$((i+1)); done
if kill -0 "$PID" 2>/dev/null; then note "Musique ML ne s'est pas fermé : remplacement reporté"; exit 0; fi
if ! /usr/bin/codesign --verify --deep "$NEW" 2>/dev/null; then note "nouvelle version incomplète : remplacement annulé"; rm -rf "$DIR"; [ "$RELAUNCH" = "1" ] && open "$OLD"; exit 0; fi
rm -rf "$NEXT" "$BAK"
if ! /usr/bin/ditto "$NEW" "$NEXT"; then note "copie impossible (disque plein ?) : remplacement annulé"; rm -rf "$NEXT" "$DIR"; [ "$RELAUNCH" = "1" ] && open "$OLD"; exit 0; fi
if mv "$OLD" "$BAK"; then
  if mv "$NEXT" "$OLD"; then rm -rf "$BAK"; note "remplacement réussi"; else mv "$BAK" "$OLD"; note "renommage impossible : ancienne version remise"; fi
else note "ancienne appli non déplaçable (autorisation macOS ?) : remplacement annulé"; fi
rm -rf "$NEXT"
xattr -dr com.apple.quarantine "$OLD" 2>/dev/null
rm -rf "$DIR"
if [ "$RELAUNCH" = "1" ]; then open "$OLD"; fi
`;

function setupMacUpdater({ log, getWindow }) {
  // tests : LASERBEAT_TEST_MAC_DMG = un .dmg local, ou « github » pour le vrai téléchargement de la dernière version
  const test = process.env.LASERBEAT_TEST && process.env.LASERBEAT_TEST_MAC_DMG;
  // Dossier de travail dans les données de l'appli (pas le dossier temporaire du système, que macOS vide
  // au bout de quelques jours : une version préparée pourrait y être abîmée avant d'être installée).
  const tmp = path.join(app.getPath('userData'), 'mise-a-jour');
  const swapLog = path.join(app.getPath('userData'), 'mise-a-jour.log');
  try { fs.mkdirSync(tmp, { recursive: true }); } catch (e) { /* rien */ }
  // restes d'une mise à jour précédente (interrompue) : on les efface
  try { for (const n of fs.readdirSync(tmp)) if (n.startsWith(PREFIX)) rm(path.join(tmp, n)); } catch (e) { /* rien */ }
  // résultat du dernier remplacement (écrit par le script) : recopié dans le journal
  try { const t = fs.readFileSync(swapLog, 'utf8').trim(); if (t) log('[maj] remplacement précédent :', t.split('\n').slice(-3).join(' | ')); fs.rmSync(swapLog, { force: true }); } catch (e) { /* aucun */ }
  // arrêt du Mac : pas de remplacement à ce moment-là
  try { require('electron').powerMonitor.on('shutdown', () => { sessionEnd = true; }); } catch (e) { /* rien */ }

  const bundle = path.resolve(process.execPath, '..', '..', '..'); // …/Musique ML.app
  const selfOk = () => bundle.endsWith('.app') && !bundle.startsWith('/Volumes/') && writable(path.dirname(bundle)) && writable(bundle);

  let ready = null, staged = null, dir = null, available = null, busy = null, installing = false, sessionEnd = false;
  const send = (ch, v) => { const w = getWindow(); if (w && !w.isDestroyed()) w.webContents.send(ch, v); };
  ipcMain.on('update:get', e => { e.returnValue = ready; });
  ipcMain.on('update:avail-get', e => { e.returnValue = available; });
  ipcMain.handle('update:launch-check', async () => null); // le téléchargement se fait pendant la musique
  ipcMain.on('update:site', () => { log('[maj] ouverture du site de téléchargement'); shell.openExternal(SITE).catch(() => {}); });

  // Repli : la nouvelle version se prend sur le site.
  const fallback = (v, why) => {
    log('[maj] remplacement automatique impossible (' + why + ') : proposer le site');
    if (available !== v) { available = v; send('update:available', v); }
    return { status: 'available', version: v };
  };

  async function fetchLatest() {
    if (test && test !== 'github') return { v: process.env.LASERBEAT_TEST_MAC_VERSION || '9.9.9', asset: { local: test } };
    // tests (« github ») : pendant une publication, la toute dernière version n'a pas encore son .dmg :
    // on prend la plus récente qui en a un.
    const url = test === 'github' ? LATEST_API.replace('/latest', '?per_page=5') : LATEST_API;
    const r = await net.fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Musique-ML' }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    let d = await r.json();
    if (Array.isArray(d)) d = d.find(x => !x.prerelease && !x.draft && (x.assets || []).some(a => a.name === MAC_ASSET)) || {};
    return { v: String(d.tag_name || '').replace(/^v/, ''), asset: (d.assets || []).find(a => a.name === MAC_ASSET) || null };
  }

  async function prepare(v, asset) {
    dir = fs.mkdtempSync(path.join(tmp, PREFIX));
    const dmg = path.join(dir, MAC_ASSET), mnt = path.join(dir, 'disque'), stage = path.join(dir, 'nouvelle');
    log('[maj] téléchargement de la version', v);
    if (asset.local) fs.copyFileSync(asset.local, dmg);
    else {
      // 20 min au plus pour le téléchargement : une connexion figée ne bloque pas les vérifications suivantes
      const r = await net.fetch(asset.browser_download_url, { headers: { 'User-Agent': 'Musique-ML' }, signal: AbortSignal.timeout(20 * 60 * 1000) });
      if (!r.ok || !r.body) throw new Error('téléchargement HTTP ' + r.status);
      const h = crypto.createHash('sha256');
      const src = Readable.fromWeb(r.body);
      src.on('data', c => h.update(c));
      await pipeline(src, fs.createWriteStream(dmg));
      const size = fs.statSync(dmg).size;
      if (asset.size && size !== asset.size) throw new Error('taille inattendue (' + size + ' octets)');
      const want = String(asset.digest || '').replace(/^sha256:/, '');
      if (want && h.digest('hex') !== want) throw new Error('fichier abîmé (empreinte différente)');
    }
    // sortir l'appli du .dmg, puis effacer le .dmg
    fs.mkdirSync(mnt); fs.mkdirSync(stage);
    await run('/usr/bin/hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mnt, dmg]);
    try {
      const name = fs.readdirSync(mnt).find(n => n.endsWith('.app'));
      if (!name) throw new Error('aucune appli dans le .dmg');
      await run('/usr/bin/ditto', [path.join(mnt, name), path.join(stage, path.basename(bundle))]);
    } finally {
      await run('/usr/bin/hdiutil', ['detach', mnt, '-force']).catch(e => log('[maj] démontage', e.message));
    }
    rm(dmg);
    const app2 = path.join(stage, path.basename(bundle));
    await run('/usr/bin/codesign', ['--verify', '--deep', app2]);
    if (!test) {
      const got = (await run('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', path.join(app2, 'Contents', 'Info.plist')])).trim();
      if (got !== v) throw new Error('version ' + got + ' au lieu de ' + v);
    }
    staged = app2; ready = v;
    log('[maj] version prête à installer', v);
    send('update:ready', v);
    return { status: 'ready', version: v };
  }

  function check() {
    if (ready) return Promise.resolve({ status: 'ready', version: ready });
    if (busy) return busy.first;
    let first;
    const firstP = new Promise(res => { first = res; });
    busy = { first: firstP };
    (async () => {
      let v = null;
      try {
        const { v: latest, asset } = await fetchLatest();
        v = latest;
        if (!v || !asset || !(test || newer(v, app.getVersion()))) { first({ status: 'none' }); return; }
        if (!selfOk()) { first(fallback(v, 'dossier ' + path.dirname(bundle))); return; }
        first({ status: 'downloading', version: v });
        await prepare(v, asset);
      } catch (err) {
        log('[maj] échec', err && err.message ? err.message : String(err));
        if (dir) { rm(dir); dir = null; }
        if (v) first(fallback(v, err && err.message)); else first({ status: 'error' });
      } finally { busy = null; }
    })();
    return firstP;
  }
  check();
  setInterval(check, CHECK_EVERY_MS);
  ipcMain.handle('update:check', () => check());

  const swap = relaunch => {
    if (!ready || !staged || !dir || installing) return false;
    installing = true;
    try {
      const script = path.join(dir, 'remplacer.sh');
      fs.writeFileSync(script, SWAP, { mode: 0o755 });
      const again = relaunch && !process.env.LASERBEAT_TEST ? '1' : '0';
      log('[maj] remplacement de', bundle, 'par la version', ready, again === '1' ? '(puis relance)' : '');
      spawn('/bin/sh', [script, String(process.pid), bundle, staged, dir, again, swapLog], { detached: true, stdio: 'ignore' }).unref();
      return true;
    } catch (err) {
      installing = false;
      log('[maj] remplacement impossible', err && err.message);
      return false;
    }
  };
  ipcMain.on('update:install', () => {
    if (swap(true)) setTimeout(() => app.quit(), 300);
    else { log('[maj] installation non démarrée : on continue avec la version actuelle'); send('update:failed'); }
  });
  // Fermeture de Musique ML avec une version prête : elle est mise en place, sans relancer.
  app.on('will-quit', () => { if (!sessionEnd) swap(false); });

  return { onSessionEnd() { sessionEnd = true; } };
}

module.exports = { setupMacUpdater };
