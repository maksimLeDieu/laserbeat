'use strict';
/*
 * Tests automatiques de LaserBeat (pilotent la vraie fenêtre du logiciel).
 *
 *   npm test                                  -> teste la version de développement
 *   LASERBEAT_EXE=dist/win-unpacked/LaserBeat.exe npm test   -> teste le logiciel compilé
 *
 * Chaque test démarre LaserBeat avec un dossier de données vide et vérifie un comportement réel :
 * lecture, enchaînement, fenêtre cachée, Agenda, réglages, import/suppression, plantage,
 * navigation bloquée, mise à jour, sortie audio, redémarrage de nuit.
 * Le moindre échec renvoie un code d'erreur : la version n'est alors pas publiée.
 */
const { _electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const os = require('os');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const EXE = process.env.LASERBEAT_EXE ? path.resolve(ROOT, process.env.LASERBEAT_EXE) : null;
const ELECTRON = EXE || require('electron');
const BASE_ARGS = (EXE ? [] : [ROOT]).concat(process.platform === 'linux' && process.getuid && process.getuid() === 0 ? ['--no-sandbox'] : []);
const SAMPLE_MP3 = path.join(ROOT, 'musiques', 'LaserBeat 2 - Phonk.mp3');

let current = null;
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'laserbeat-tests-'));

function newDataDir(name) {
  const d = path.join(tmpRoot, name);
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function env(dataDir, extra) {
  return { ...process.env, LASERBEAT_USER_DATA: dataDir, LASERBEAT_TEST: '1', ...(extra || {}) };
}
async function launch(dataDir, extra) {
  const app = await _electron.launch({ executablePath: ELECTRON, args: BASE_ARGS, env: env(dataDir, extra), timeout: 60000 });
  const w = await app.firstWindow();
  await w.waitForLoadState('domcontentloaded');
  await w.waitForTimeout(1500);
  const errors = [];
  w.on('pageerror', e => errors.push(e.message));
  current = app;
  return { app, w, errors };
}
async function close(app) {
  const pid = (() => { try { return app.process().pid; } catch (e) { return null; } })();
  await within(app.close(), 15000);
  if (pid) { try { process.kill(pid, 'SIGKILL'); } catch (e) { /* déjà fermé */ } }
  current = null;
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Chaque vérification est limitée à 5 s : une page en cours de rechargement ne bloque jamais le test.
const within = (p, ms = 5000) => Promise.race([Promise.resolve(p).catch(() => false), sleep(ms).then(() => false)]);
async function waitFor(fn, ms, step = 500) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await within(fn())) return true; await sleep(step); }
  return false;
}
const playing = w => w.evaluate(() => [...document.querySelectorAll('audio')].some(a => !a.paused && a.currentTime > 0));
const title = w => w.textContent('#npT');
// « fin » = fin réelle de la musique (avant le silence final du fichier), comme pour le fondu enchaîné
const seekNearEnd = (w, s = 1) => w.evaluate(s => {
  const a = [...document.querySelectorAll('audio')].find(x => !x.paused);
  const t = (window.laserbeat.tracks || []).find(x => x.id === a.dataset.tid);
  const end = t && t.end > 0 && t.end < a.duration ? t.end : a.duration;
  a.currentTime = end - s;
}, s);
const logOf = dir => { try { return fs.readFileSync(path.join(dir, 'laserbeat.log'), 'utf8'); } catch (e) { return ''; } };

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

/* ------------------------------------------------------------------ */
test('Démarrage : fenêtre Musique ML, sans menu, fichiers locaux, 15 morceaux', async () => {
  const { app, w, errors } = await launch(newDataDir('demarrage'));
  const info = await app.evaluate(({ BrowserWindow, Menu }) => {
    const b = BrowserWindow.getAllWindows()[0];
    return { n: BrowserWindow.getAllWindows().length, title: b.getTitle(), size: b.getSize(), min: b.getMinimumSize(), menu: Menu.getApplicationMenu() && Menu.getApplicationMenu().items.map(i => i.label), url: b.webContents.getURL(), throttle: b.webContents.getBackgroundThrottling() };
  });
  assert(info.n === 1, 'une seule fenêtre attendue');
  assert(info.title === 'Musique ML', 'titre : ' + info.title);
  assert(info.min[0] === 1000 && info.min[1] === 640, 'taille minimale');
  // Mac : la barre de menus du haut existe toujours, réduite à « Musique ML », « Édition », « Fenêtre »
  if (process.platform === 'darwin') assert(JSON.stringify(info.menu) === JSON.stringify(['Musique ML', 'Édition', 'Fenêtre']), 'menu Mac : ' + JSON.stringify(info.menu));
  else assert(info.menu === null, 'menu par défaut présent');
  assert(info.url.startsWith('file:'), 'interface non locale : ' + info.url);
  assert(info.throttle === false, 'ralentissement en arrière-plan actif');
  const n = await w.evaluate(() => window.laserbeat.tracks.length);
  assert(n === 15, 'morceaux fournis : ' + n);
  assert(/^v\d+\.\d+\.\d+/.test(await w.textContent('#ver')), 'version non affichée');
  assert(!errors.length, 'erreurs : ' + errors.join(' | '));
  await close(app);
});

test('Lecture : « Jouer la musique » lance le son', async () => {
  const { app, w, errors } = await launch(newDataDir('lecture'));
  await w.click('text=Jouer la musique');
  assert(await waitFor(() => playing(w), 10000), 'la musique ne démarre pas');
  assert(!errors.length, 'erreurs : ' + errors.join(' | '));
  await close(app);
});

test('Pause et reprise en douceur : le son descend puis s\'arrête, remonte à la reprise', async () => {
  const { app, w, errors } = await launch(newDataDir('pause-douce'));
  await w.click('text=Jouer la musique');
  assert(await waitFor(() => playing(w), 10000), 'la musique ne démarre pas');
  await w.waitForTimeout(600);
  const st = () => w.evaluate(() => { const a = [...document.querySelectorAll('audio')].find(x => x.dataset.tid && x.getAttribute('src')); return { paused: a.paused, v: a.volume, icon: document.querySelector('#bPlay').innerHTML }; });
  const full = (await st()).v;
  assert(full > 0.1, 'volume de départ : ' + full);
  const iconPlaying = (await st()).icon;
  // pause : le son baisse progressivement (pas de coupure nette), le bouton change tout de suite
  const samples = await w.evaluate(() => new Promise(res => {
    const a = [...document.querySelectorAll('audio')].find(x => !x.paused), out = [];
    document.querySelector('#bPlay').click();
    const t0 = performance.now();
    const iv = setInterval(() => { out.push({ t: Math.round(performance.now() - t0), v: a.volume, paused: a.paused }); if (performance.now() - t0 > 700) { clearInterval(iv); res(out); } }, 40);
  }));
  const mid = samples.filter(x => !x.paused && x.v > 0.02 && x.v < full * 0.95);
  assert(mid.length >= 2, 'pas de descente progressive : ' + JSON.stringify(samples.slice(0, 8)));
  const end = await st();
  assert(end.paused, 'la musique n\'est pas en pause après le fondu');
  assert(Math.abs(end.v - full) < 0.001, 'volume non rétabli après la pause : ' + end.v);
  assert(end.icon !== iconPlaying, 'le bouton n\'indique pas la pause');
  // reprise : le son repart de zéro et remonte au volume normal
  const up = await w.evaluate(() => new Promise(res => {
    const a = [...document.querySelectorAll('audio')].find(x => x.dataset.tid && x.getAttribute('src')), out = [];
    document.querySelector('#bPlay').click();
    const t0 = performance.now();
    const iv = setInterval(() => { out.push(a.volume); if (performance.now() - t0 > 600) { clearInterval(iv); res(out); } }, 40);
  }));
  assert(up[0] < full * 0.6 && Math.abs(up[up.length - 1] - full) < 0.001, 'pas de remontée progressive : ' + JSON.stringify(up.slice(0, 8)));
  assert(await playing(w), 'la musique ne reprend pas');
  // deux appuis rapprochés : pause annulée pendant la descente, la musique continue au bon volume
  await w.evaluate(() => { const b = document.querySelector('#bPlay'); b.click(); setTimeout(() => b.click(), 120); });
  await w.waitForTimeout(800);
  const again = await st();
  assert(!again.paused && Math.abs(again.v - full) < 0.001, 'reprise pendant la descente : ' + JSON.stringify({ paused: again.paused, v: again.v }));
  assert(!errors.length, 'erreurs : ' + errors.join(' | '));
  await close(app);
});

test('Interface : panneau « En cours de lecture », bouton lecture/pause de la playlist, bibliothèque réduite', async () => {
  const { app, w, errors } = await launch(newDataDir('interface'));
  await w.click('.pli >> text=LaserBeats'); await w.click('#view .bigplay');
  assert(await waitFor(() => playing(w), 10000), 'pas de lecture');
  const rp = await w.textContent('#rp');
  assert(rp.includes('Phonk Laser Game') && rp.includes('Ensuite dans la file') && rp.includes('Mandelao'), 'panneau de droite incomplet');
  assert(/url\("file:.*Phonk%20Laser%20Game\.webp"\)/.test(await w.getAttribute('#npArt', 'style')), 'photo du morceau absente du lecteur');
  assert(await w.evaluate(() => { const i = document.querySelector('#rp .rp-art'); return !!i && /\.webp/.test(getComputedStyle(i).backgroundImage); }), 'photo absente du panneau de droite');
  await w.click('#view .bigplay');                                   // même playlist : pause
  assert(await waitFor(async () => !(await playing(w)), 3000), 'le gros bouton ne met pas en pause');
  await w.click('#view .bigplay');                                   // reprise, sans repartir du début
  assert(await waitFor(() => playing(w), 3000), 'le gros bouton ne relance pas');
  assert((await title(w)) === 'Phonk Laser Game', 'mauvais morceau après reprise');
  if (!(await w.isVisible('#rpanel'))) await w.click('#bQ');           // petit écran : le panneau est masqué d'office
  await w.click('#rp .qi >> text=Drift Hardbass II');                // clic dans la file
  assert(await waitFor(async () => (await title(w)) === 'Drift Hardbass II', 3000), 'la file ne lance pas le morceau');
  await w.click('#bQ'); assert(!(await w.isVisible('#rpanel')), 'le panneau ne se masque pas');
  await w.click('#bSide'); assert(!(await w.isVisible('#n-all')), 'la bibliothèque ne se réduit pas');
  await w.click('#bSide'); await w.click('#bQ');
  assert(await w.isVisible('#rpanel') && await w.isVisible('#n-all'), 'affichage non rétabli');
  assert(!errors.length, 'erreurs : ' + errors.join(' | '));
  await close(app);
});

test('Touches multimédia du clavier : lecture/pause, suivant, précédent', async () => {
  const { app, w, errors } = await launch(newDataDir('touches'));
  const reg = await app.evaluate(({ globalShortcut }) => ['MediaPlayPause', 'MediaNextTrack', 'MediaPreviousTrack'].map(k => globalShortcut.isRegistered(k)));
  if (process.platform === 'win32') assert(reg.every(Boolean), 'touches non enregistrées : ' + reg.join(','));
  const key = a => app.evaluate(({ BrowserWindow }, a) => BrowserWindow.getAllWindows()[0].webContents.send('media:key', a), a);
  await key('playpause');
  assert(await waitFor(() => playing(w), 10000), 'lecture/pause ne lance pas la musique');
  assert((await title(w)) === 'Phonk Laser Game', 'mauvais premier morceau : ' + await title(w));
  await key('next');
  assert(await waitFor(async () => (await title(w)) === 'Phonk', 4000), 'suivant ne marche pas');
  await key('prev');
  assert(await waitFor(async () => (await title(w)) === 'Phonk Laser Game', 4000), 'précédent ne marche pas');
  await key('playpause');
  assert(await waitFor(async () => !(await playing(w)), 4000), 'lecture/pause ne met pas en pause');
  assert(!errors.length, 'erreurs : ' + errors.join(' | '));
  await close(app);
});

test('Volume égal : chaque morceau est ramené au même niveau, mesure des morceaux ajoutés', async () => {
  const dir = newDataDir('volume');
  const src = path.join(tmpRoot, 'Copie de Phonk.mp3');
  fs.copyFileSync(SAMPLE_MP3, src);
  const { app, w, errors } = await launch(dir);
  const vols = () => w.evaluate(() => [...document.querySelectorAll('audio')].filter(a => !a.paused).map(a => a.volume));
  await w.click('text=Jouer la musique');
  assert(await waitFor(() => playing(w), 10000), 'pas de lecture');
  // Phonk Laser Game : -6,1 LUFS -> -1,4 dB ; Phonk : -4,6 LUFS -> -2,9 dB (volume général 0,8)
  const near = (v, x) => Math.abs(v - x) < 0.01;
  assert(await waitFor(async () => { const v = await vols(); return v.length === 1 && near(v[0], 0.8 * Math.pow(10, -1.4 / 20)); }, 4000), 'correction absente : ' + (await vols()).join(','));
  await w.click('#bNext');
  assert(await waitFor(async () => { const v = await vols(); return v.length === 1 && near(v[0], 0.8 * Math.pow(10, -2.9 / 20)); }, 6000), 'correction du morceau suivant absente : ' + (await vols()).join(','));
  // morceau ajouté : mesuré automatiquement (même fichier que Phonk, donc environ -4,6 LUFS)
  await app.evaluate(({ dialog }, src) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [src] }); }, src);
  await w.click('#n-lib'); await w.click('text=Ajouter mes morceaux');
  const measured = () => w.evaluate(() => (window.laserbeat.store.get('lb_lufs') || {})['u:copie de phonk.mp3']);
  assert(await waitFor(async () => typeof (await measured()) === 'number', 30000, 1000), 'volume du morceau ajouté non mesuré');
  const m = await measured();
  assert(Math.abs(m - (-4.6)) <= 0.5, 'mesure incorrecte : ' + m + ' LUFS (attendu -4,6)');
  assert(!errors.length, 'erreurs : ' + errors.join(' | '));
  await close(app);
});

test('Mode écran : grande pochette, morceau suivant, clic sur la bannière, Échap pour sortir', async () => {
  const { app, w, errors } = await launch(newDataDir('ecran'));
  await w.click('text=Jouer la musique');
  assert(await waitFor(() => playing(w), 10000), 'pas de lecture');
  await w.click('#bFs');
  assert(await w.isVisible('#fs'), 'mode écran non affiché');
  assert((await w.textContent('#fsT')) === 'Phonk Laser Game', 'mauvais titre : ' + await w.textContent('#fsT'));
  assert((await w.textContent('#fsNext')).includes('Phonk'), 'morceau suivant absent');
  assert((await w.textContent('#fsNow')).includes('Laser Arena'), 'playlist absente');
  await w.keyboard.press('Escape');
  assert(await waitFor(async () => !(await w.isVisible('#fs')), 3000), 'Échap ne quitte pas le mode écran');
  assert(await playing(w), 'la musique s\'est arrêtée');
  // un clic sur la bannière du lecteur (titre en bas) ouvre aussi le plein écran
  await w.click('#npT');
  assert(await w.isVisible('#fs'), 'clic sur la bannière : plein écran non affiché');
  await w.keyboard.press('Escape');
  assert(await waitFor(async () => !(await w.isVisible('#fs')), 3000), 'Échap ne quitte pas (bannière)');
  await w.click('#bPlay'); await w.waitForTimeout(300);
  assert(!(await w.isVisible('#fs')), 'le bouton lecture/pause ne doit pas ouvrir le plein écran');
  assert(!errors.length, 'erreurs : ' + errors.join(' | '));
  await close(app);
});

test('Ordre des morceaux : glisser-déposer, mémorisé, suivi par la lecture, retour à l\'ordre d\'origine', async () => {
  const dir = newDataDir('ordre');
  let { app, w, errors } = await launch(dir);
  const names = () => w.$$eval('#view .trow:not(.thead) .tn', r => r.map(x => x.textContent));
  await w.click('.pli >> text=Laser Arena'); await w.waitForTimeout(300);
  assert((await names())[0] === 'Phonk Laser Game', 'ordre de départ inattendu');
  const rows = '#view .trow:not(.thead)';
  // petit écran (comme sur le PC de test de GitHub) : la liste défile, on vise donc après l'avoir affichée
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 640)); await w.waitForTimeout(400);
  await w.locator(rows).nth(2).scrollIntoViewIfNeeded(); await w.waitForTimeout(200);
  const src = await w.locator(rows).nth(0).boundingBox(), dst = await w.locator(rows).nth(2).boundingBox();
  await w.mouse.move(src.x + 200, src.y + src.height / 2); await w.mouse.down();
  await w.mouse.move(src.x + 210, src.y + src.height / 2 + 10, { steps: 3 });
  await w.mouse.move(dst.x + 200, dst.y + dst.height * 0.85, { steps: 10 });   // bas de Mandelao : juste après
  await w.mouse.up(); await w.waitForTimeout(300);
  const after = await names();
  assert(after.slice(0, 3).join('|') === 'Phonk|Mandelao|Phonk Laser Game', 'ordre non modifié : ' + after.join(', '));
  assert(await w.isVisible('text=Ordre d\'origine'), 'bouton « Ordre d\'origine » absent');
  await close(app);
  ({ app, w, errors } = await launch(dir));                         // relance : l'ordre est gardé
  await w.click('.pli >> text=Laser Arena'); await w.waitForTimeout(300);
  assert((await names()).slice(0, 3).join('|') === 'Phonk|Mandelao|Phonk Laser Game', 'ordre perdu après relance');
  await w.click('#view .bigplay');
  assert(await waitFor(async () => (await title(w)) === 'Phonk', 8000), 'la lecture ne suit pas le nouvel ordre');
  await w.click('#bNext');
  assert(await waitFor(async () => (await title(w)) === 'Mandelao', 5000), 'le morceau suivant ne suit pas le nouvel ordre');
  await w.click('text=Ordre d\'origine');
  assert((await names())[0] === 'Phonk Laser Game', 'ordre d\'origine non rétabli');
  await w.click('#bNext');
  assert(await waitFor(async () => (await title(w)) === 'Drift Hardbass', 5000), 'la file ne suit pas l\'ordre d\'origine : ' + await title(w));
  assert(!errors.length, 'erreurs : ' + errors.join(' | '));
  await close(app);
});

test('Paramètres (clic sur le logo) : fondu et volume égal désactivables, mémorisés', async () => {
  const dir = newDataDir('parametres');
  let { app, w, errors } = await launch(dir);
  await w.click('#bBrand');
  assert((await w.textContent('#ttl')) === 'Paramètres', 'page Paramètres non ouverte');
  assert(await w.isVisible('text=Connexion'), 'Connexion absente');
  const sw = k => w.getAttribute(`.sw[data-k="${k}"]`, 'aria-checked');
  assert((await sw('xfade')) === 'true' && (await sw('norm')) === 'true', 'réglages par défaut incorrects');
  await w.click('.sw[data-k="norm"]'); await w.click('.sw[data-k="xfade"]');
  assert((await sw('norm')) === 'false' && (await sw('xfade')) === 'false', 'interrupteurs sans effet');
  // comptes : bouton « Se connecter », pas de création libre, rien d'enregistré tant qu'on ne se connecte pas
  assert((await w.$$('[data-act="acct-login"]')).length === 1 && (await w.$$('[data-act="acct-new"]')).length === 0, 'bouton de connexion');
  assert(!fs.existsSync(path.join(dir, 'comptes.dat')), 'fichier des comptes créé sans connexion');
  await close(app);
  ({ app, w, errors } = await launch(dir));
  await w.click('#bBrand');
  assert((await sw('norm')) === 'false' && (await sw('xfade')) === 'false', 'réglages non mémorisés');
  await w.click('.pli >> text=Laser Arena'); await w.click('#view .bigplay');
  assert(await waitFor(() => playing(w), 10000), 'pas de lecture');
  const v = await w.evaluate(() => [...document.querySelectorAll('audio')].filter(a => !a.paused).map(a => a.volume));
  assert(v.length === 1 && Math.abs(v[0] - 0.8) < 0.01, 'volume égal toujours appliqué : ' + v.join(','));
  await seekNearEnd(w, 2.5); await w.waitForTimeout(1200);
  const both = await w.evaluate(() => [...document.querySelectorAll('audio')].filter(a => !a.paused).length);
  assert(both === 1, 'fondu toujours actif (deux lecteurs en même temps)');
  assert(!errors.length, 'erreurs : ' + errors.join(' | '));
  await close(app);
});

test('Informations légales : CGU, mentions légales, données personnelles, licences', async () => {
  const chk = require('child_process').spawnSync(process.execPath, [path.join(ROOT, 'outils', 'cgu.js'), '--verifier'], { encoding: 'utf8' });
  assert(chk.status === 0, 'build/CGU.txt (installateur) pas à jour : ' + (chk.stderr || chk.stdout));
  const { app, w, errors } = await launch(newDataDir('legal'));
  await w.click('#bBrand');
  await w.click('[data-act="legal"][data-id="cgu"]');
  assert((await w.textContent('#ttl')) === 'Informations légales', 'page non ouverte');
  const t1 = await w.textContent('#view');
  for (const m of ['Conditions générales d\'utilisation', 'Maxime Loret', 'Didier Floret', 'Trégueux', 'Quimper', 'Brest', 'SACEM', 'droit français']) assert(t1.includes(m), 'CGU incomplètes : ' + m);
  await w.click('.lg-tabs >> text=Mentions légales');
  assert((await w.textContent('#view')).includes('GitHub, Inc.'), 'mentions légales incomplètes');
  await w.click('.lg-tabs >> text=Données personnelles');
  assert((await w.textContent('#view')).includes('aucune donnée personnelle'), 'page données personnelles incomplète');
  await w.click('.lg-tabs >> text=Licences libres');
  assert((await w.textContent('#view')).includes('Electron'), 'licences incomplètes');
  await w.click('#bInfo'); await w.click('#aboutBox [data-act="legal"]');
  assert(!(await w.isVisible('#about')) && (await w.textContent('#view')).includes('Conditions générales'), 'lien de la fiche ⓘ vers les CGU');
  assert(!errors.length, 'erreurs : ' + errors.join(' | '));
  await close(app);
});

test('Sécurité : pas de caméra/micro, pas d\'accès Internet depuis la page, pas de cadre extérieur', async () => {
  const { app, w, errors } = await launch(newDataDir('securite'));
  const r = await w.evaluate(async () => {
    const out = {};
    try { await navigator.mediaDevices.getUserMedia({ audio: true }); out.micro = 'autorisé'; } catch (e) { out.micro = e.name; }
    try { await fetch('https://example.com/'); out.web = 'autorisé'; } catch (e) { out.web = 'bloqué'; }
    const f = document.createElement('iframe'); f.src = 'https://example.com/'; document.body.appendChild(f);
    await new Promise(r => setTimeout(r, 800));
    try { out.cadre = f.contentWindow.location.href; } catch (e) { out.cadre = 'bloqué'; }
    f.remove();
    out.node = typeof require;
    return out;
  });
  assert(r.micro !== 'autorisé', 'micro accessible');
  assert(r.web === 'bloqué', 'accès Internet depuis la page');
  assert(!/example\.com/.test(r.cadre), 'cadre extérieur chargé : ' + r.cadre);
  assert(r.node === 'undefined', 'accès à Node.js depuis la page');
  const bridge = await w.evaluate(() => Object.keys(window.laserbeat).sort().join(','));
  assert(!/require|ipcRenderer|process|fs/.test(bridge), 'pont trop large : ' + bridge);
  await close(app);
});

test('Comptes des salles : choix de la salle, code choisi à la première connexion, favoris séparés, relance, suppression', async () => {
  const dir = newDataDir('comptes');
  const ON = { LASERBEAT_ACCOUNTS: '1' };
  let { app, w, errors } = await launch(dir, ON);
  const fill = async (vals) => { for (const [id, v] of Object.entries(vals)) await w.fill('#' + id, v); await w.click('#acctForm button[type=submit]'); };
  const err = () => w.textContent('#fErr');
  // favori « du PC » avant tout compte
  await w.click('.pli >> text=Laser Arena'); await w.waitForTimeout(200);
  await w.hover('#view .trow:not(.thead) >> nth=0'); await w.click('#view .trow:not(.thead) >> nth=0 >> .star');
  // les trois salles sont proposées
  await w.click('#bBrand'); await w.click('[data-act="acct-login"]');
  const salles = await w.$$eval('#aboutBox .salle', r => r.map(x => x.querySelector('b').textContent + ':' + x.dataset.login));
  assert(salles.join('|') === 'Quimper:lge.q|Brest:lge.b|Saint-Brieuc:lge.sb', 'salles proposées : ' + salles.join('|'));
  // première connexion de Brest sur ce PC (sans reprendre les favoris) : code trop court, puis correct
  await w.click('.salle[data-login="lge.b"]'); await w.waitForSelector('#fPw2');
  await w.uncheck('#fKeep');
  await fill({ fPw: '123', fPw2: '123' });
  assert((await err()).includes('4 caractères'), 'mot de passe trop court accepté');
  await fill({ fPw: 'MotDePasse-Brest1', fPw2: 'MotDePasse-Brest1' });
  assert(await waitFor(async () => !(await w.isVisible('#about')), 8000), 'compte non créé : ' + await err());
  assert((await w.textContent('#bAcct')).includes('Brest'), 'compte connecté non affiché');
  await w.click('.pli >> text=Morceaux préférés'); await w.waitForTimeout(200);
  assert((await w.$$('#view .trow:not(.thead)')).length === 0, 'le compte Brest voit les favoris du PC');
  await w.click('.pli >> text=Laser Arena'); await w.waitForTimeout(200);
  await w.hover('#view .trow:not(.thead) >> nth=2'); await w.click('#view .trow:not(.thead) >> nth=2 >> .star');   // Mandelao
  // le mot de passe n'est jamais enregistré en clair
  await w.waitForTimeout(800);
  const raw = fs.readFileSync(path.join(dir, 'comptes.dat'));
  assert(!raw.includes('MotDePasse-Brest1'), 'mot de passe enregistré en clair');
  if (process.platform === 'win32') assert(!raw.includes('Brest') && !raw.includes('lge.b'), 'fichier des comptes non chiffré');
  // déconnexion : on retrouve les favoris du PC
  await w.click('#bBrand'); await w.click('[data-act="acct-logout"]'); await w.waitForTimeout(300);
  assert(await w.isHidden('#bAcct'), 'toujours connecté');
  await w.click('.pli >> text=Morceaux préférés'); await w.waitForTimeout(200);
  let names = await w.$$eval('#view .trow:not(.thead) .tn', r => r.map(x => x.textContent));
  assert(names.join('|') === 'Phonk Laser Game', 'favoris du PC incorrects : ' + names.join(', '));
  // mauvais mot de passe, puis le bon
  await w.click('#bBrand'); await w.click('[data-act="acct-login"]');
  await w.click('.salle[data-login="lge.b"]'); await w.waitForSelector('#fPw');
  assert(!(await w.$('#fPw2')), 'le code est redemandé deux fois alors que le compte existe');
  await fill({ fPw: 'faux-mot-de-passe' });
  assert(await waitFor(async () => (await err()).includes('incorrect'), 8000), 'mauvais mot de passe accepté');
  await fill({ fPw: 'MotDePasse-Brest1' });
  assert(await waitFor(async () => !(await w.isVisible('#about')), 8000), 'connexion refusée : ' + await err());
  await close(app);
  // relance : toujours connecté, favoris du compte
  ({ app, w, errors } = await launch(dir, ON));
  assert((await w.textContent('#bAcct')).includes('Brest'), 'session perdue après relance');
  await w.click('.pli >> text=Morceaux préférés'); await w.waitForTimeout(200);
  names = await w.$$eval('#view .trow:not(.thead) .tn', r => r.map(x => x.textContent));
  assert(names.join('|') === 'Mandelao', 'favoris du compte incorrects : ' + names.join(', '));
  // code de 4 chiffres : changement du mot de passe, déconnexion, connexion avec le code
  await w.click('#bBrand'); await w.click('[data-act="acct-pw"]');
  await fill({ fOld: 'MotDePasse-Brest1', fPw: '4827', fPw2: '4827' });
  assert(await waitFor(async () => !(await w.isVisible('#about')), 8000), 'code de 4 chiffres refusé : ' + await err());
  await w.click('[data-act="acct-logout"]'); await w.waitForTimeout(300);
  await w.click('[data-act="acct-login"]'); await w.click('.salle[data-login="lge.b"]'); await w.waitForSelector('#fPw');
  await fill({ fPw: '4827' });
  assert(await waitFor(async () => !(await w.isVisible('#about')), 8000), 'connexion avec le code refusée : ' + await err());
  // pas de blocage : plusieurs codes faux, puis le bon code passe tout de suite
  await w.click('[data-act="acct-logout"]'); await w.waitForTimeout(300);
  await w.click('[data-act="acct-login"]'); await w.click('.salle[data-login="lge.b"]'); await w.waitForSelector('#fPw');
  for (let k = 0; k < 6; k++) { await fill({ fPw: '000' + k }); await waitFor(async () => (await err()).includes('incorrect'), 8000); }
  await fill({ fPw: '4827' });
  assert(await waitFor(async () => !(await w.isVisible('#about')), 8000), 'connexion bloquée après des codes faux : ' + await err());
  await w.click('#bBrand');
  await w.click('[data-act="acct-del"]');
  await fill({ fPw: 'faux' });
  assert(await waitFor(async () => (await err()).includes('incorrect'), 8000), 'suppression sans le bon mot de passe');
  await fill({ fPw: '4827' });
  assert(await waitFor(async () => !(await w.isVisible('#about')), 8000), 'compte non supprimé');
  assert(await w.isHidden('#bAcct'), 'toujours connecté après suppression');
  assert(!errors.length, 'erreurs : ' + errors.join(' | '));
  await close(app);
});

test('Fondu enchaîné : le suivant monte pendant que le premier descend, jamais de silence', async () => {
  const { app, w } = await launch(newDataDir('fondu'));
  await w.click('.pli >> text=Laser Arena'); await w.click('#view .bigplay');
  assert(await waitFor(() => playing(w), 10000), 'pas de lecture');
  await w.waitForTimeout(2500); // le morceau suivant est préchargé
  const t1 = await title(w);
  await seekNearEnd(w, 6);
  // relevés toutes les 100 ms pendant 9 s
  const samples = await w.evaluate(() => new Promise(res => {
    const out = [], t0 = performance.now();
    const id = setInterval(() => {
      const d = [...document.querySelectorAll('audio:not(.zone2)')].map(a => ({ on: !a.paused && !!a.getAttribute('src'), v: a.volume }));
      out.push({ t: performance.now() - t0, decks: d, title: document.querySelector('#npT').textContent });
      if (performance.now() - t0 > 9000) { clearInterval(id); res(out); }
    }, 100);
  }));
  const silent = samples.filter(x => !x.decks.some(d => d.on));
  const both = samples.filter(x => x.decks.every(d => d.on));
  const last = samples[samples.length - 1];
  console.log(`    chevauchement des deux morceaux : ${(both.length / 10).toFixed(1)} s ; relevés sans son : ${silent.length}`);
  assert(last.title !== t1, 'pas de passage au morceau suivant');
  assert(silent.length === 0, 'silence pendant la transition');
  assert(both.length >= 15, 'pas de vrai fondu (chevauchement trop court)');
  const ons = last.decks.filter(d => d.on);
  assert(ons.length === 1, 'les deux lecteurs jouent encore après le fondu');
  const vol = await w.inputValue('#vol');
  // volume final = volume réglé x correction « volume égal » du morceau (Phonk : -2,9 dB)
  const corr = { 'Phonk Laser Game': -1.4, 'Phonk': -2.9 }[last.title] || 0;
  assert(Math.abs(ons[0].v - Number(vol) * Math.pow(10, corr / 20)) < 0.02, 'volume final incorrect : ' + ons[0].v);
  await close(app);
});

test('Fondu réel : les deux morceaux se mélangent pendant 3 s de vraie musique, pas pendant le silence final', async () => {
  const { app, w, errors } = await launch(newDataDir('fondu-reel'));
  // 1) chaque morceau fourni a une « fin » de musique mesurée, et il y a bien du son juste avant, du silence après
  const mesures = await w.evaluate(async () => {
    const out = [];
    const db = (x, a, b) => { let sum = 0, n = 0; for (let i = Math.max(0, Math.floor(a)); i < Math.min(x.length, Math.floor(b)); i++) { sum += x[i] * x[i]; n++; } return n ? 10 * Math.log10(sum / n + 1e-12) : -120; };
    for (const t of window.laserbeat.tracks.filter(x => !x.user)) {
      const bytes = await window.laserbeat.readAudio(t.id);
      const buf = await new OfflineAudioContext(2, 1, 48000).decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      const x = buf.getChannelData(0), sr = buf.sampleRate, end = t.end || 0;
      out.push({ title: t.title, end, dur: buf.duration, lufs: t.lufs, avant: db(x, (end - 3) * sr, (end - 1) * sr), apres: buf.duration - end > 0.6 ? db(x, (end + 0.3) * sr, x.length) : null });
    }
    return out;
  });
  assert(mesures.length === 15, 'morceaux mesurés : ' + mesures.length);
  for (const m of mesures) {
    assert(m.end > 10 && m.end <= m.dur + 0.2, m.title + ' : « fin » absente ou fausse dans morceaux.json (relancer outils/fin-morceaux.py) : ' + m.end);
    // « musique » et « silence » se jugent par rapport au niveau moyen du morceau (les musiques d'accueil sont plus douces)
    assert(m.avant > m.lufs - 22, m.title + ' : pas de musique dans les 3 s avant la « fin » (' + m.avant.toFixed(0) + ' dB)');
    if (m.apres !== null) assert(m.apres < m.lufs - 20, m.title + ' : il reste du son après la « fin » (' + m.apres.toFixed(0) + ' dB)');
  }
  // 2) en lecture : le fondu démarre 3 s avant la fin de la MUSIQUE et se termine quand elle s'arrête
  await w.click('.pli >> text=Laser Arena');
  await w.click('#view .trow:not(.thead):has(.tn:text-is("Mandelao"))');          // 3,2 s de silence à la fin du fichier
  assert(await waitFor(async () => (await title(w)) === 'Mandelao' && await playing(w), 10000), 'pas de lecture');
  const end = mesures.find(m => m.title === 'Mandelao').end;
  await w.evaluate(e => { const a = [...document.querySelectorAll('audio')].find(x => !x.paused); a.currentTime = e - 5; }, end);
  const obs = await w.evaluate(end => new Promise(res => {
    const els = [...document.querySelectorAll('audio')], out = { start: null, both: 0, endOut: null, maxOutAtEnd: null };
    const old = els.find(x => !x.paused);
    const t0 = performance.now();
    const iv = setInterval(() => {
      const live = els.filter(x => !x.paused);
      if (live.length === 2) { if (out.start === null) out.start = old.currentTime; out.both++; out.endOut = old.currentTime; }
      if ((out.start !== null && live.length === 1) || performance.now() - t0 > 12000) { clearInterval(iv); res(out); }
    }, 50);
  }), end);
  assert(obs.start !== null, 'aucun fondu observé');
  assert(Math.abs(obs.start - (end - 3)) < 0.5, 'le fondu ne démarre pas 3 s avant la fin de la musique : ' + obs.start.toFixed(1) + ' s (fin de la musique ' + end + ' s)');
  assert(obs.both * 0.05 > 2.4, 'mélange trop court : ' + (obs.both * 0.05).toFixed(1) + ' s');
  assert(obs.endOut <= end + 0.4, 'le fondu se prolonge dans le silence final : ' + obs.endOut.toFixed(1) + ' s');
  assert((await title(w)) === 'Drift Hardbass', 'morceau suivant : ' + await title(w));
  // 3) fondu désactivé : le silence final est quand même sauté
  await w.click('#bBrand'); await w.click('.sw[data-k="xfade"]');
  const cur = await title(w), endCur = mesures.find(m => m.title === cur).end;
  await w.evaluate(e => { const a = [...document.querySelectorAll('audio')].find(x => !x.paused); a.currentTime = e - 1; }, endCur);
  assert(await waitFor(async () => (await title(w)) !== cur, 2500, 100), 'silence final non sauté quand le fondu est désactivé');
  assert(!errors.length, 'erreurs : ' + errors.join(' | '));
  await close(app);
});

test('Fondu : pause et morceau suivant pendant le fondu restent propres', async () => {
  const { app, w } = await launch(newDataDir('fondu-pause'));
  await w.click('.pli >> text=Laser Arena'); await w.click('#view .bigplay');
  assert(await waitFor(() => playing(w), 10000), 'pas de lecture');
  await w.waitForTimeout(2500);
  await seekNearEnd(w, 4);
  await w.waitForTimeout(2000);            // en plein fondu
  await w.click('#bPlay');                 // pause
  await w.waitForTimeout(500);
  const afterPause = await w.evaluate(() => [...document.querySelectorAll('audio')].filter(a => !a.paused).length);
  assert(afterPause === 0, 'un lecteur joue encore après la pause');
  await w.click('#bPlay'); await w.waitForTimeout(800);
  const t2 = await title(w);
  await w.click('#bNext'); await w.waitForTimeout(1500);
  const st = await w.evaluate(() => [...document.querySelectorAll('audio')].filter(a => !a.paused).length);
  assert(st === 1 && (await title(w)) !== t2, 'état incohérent après « suivant »');
  await close(app);
});

test('Fenêtre réduite/cachée : la musique continue et enchaîne', async () => {
  const { app, w } = await launch(newDataDir('cachee'));
  await w.click('.pli >> text=Laser Arena'); await w.click('#view .bigplay');
  assert(await waitFor(() => playing(w), 10000), 'pas de lecture');
  await app.evaluate(({ BrowserWindow }) => { const b = BrowserWindow.getAllWindows()[0]; b.minimize(); b.hide(); });
  const t1 = await title(w);
  await w.waitForTimeout(2500);
  await seekNearEnd(w);
  assert(await waitFor(async () => (await title(w)) !== t1 && await playing(w), 10000), "pas d'enchaînement fenêtre cachée");
  await close(app);
});

test('Aléatoire : aucun morceau rejoué avant que toute la playlist soit passée', async () => {
  const { app, w, errors } = await launch(newDataDir('aleatoire'));
  await w.click('.pli >> text=Laser Arena');
  await w.click('#view [data-act="shuf-pl"]');
  assert(await waitFor(() => playing(w), 10000), 'pas de lecture');
  const n = (await w.$$('#view .trow:not(.thead)')).length;
  assert(n === 13, 'morceaux de la playlist : ' + n);
  // trois tours complets en passant au suivant : chaque tour contient chaque morceau une seule fois
  const order = [await title(w)];
  for (let k = 1; k < n * 3; k++) {
    const before = order[order.length - 1];
    await w.click('#bNext');
    assert(await waitFor(async () => (await title(w)) !== before, 5000, 100), 'le morceau ne change pas');
    order.push(await title(w));
  }
  for (let c = 0; c < 3; c++) {
    const tour = order.slice(c * n, (c + 1) * n);
    assert(new Set(tour).size === n, 'morceau répété dans le tour ' + (c + 1) + ' : ' + tour.join(', '));
  }
  for (let k = 1; k < order.length; k++) assert(order[k] !== order[k - 1], 'même morceau deux fois de suite');
  assert(order.slice(0, n).join('|') !== order.slice(n, 2 * n).join('|'), 'les tours ont le même ordre (pas aléatoire)');
  // fin de morceau naturelle (avec fondu) : le suivant n'est pas un morceau déjà passé dans le tour
  await w.click('#bNext'); await w.waitForTimeout(400);
  const a = await title(w);
  assert(await waitFor(() => playing(w), 8000, 200), 'pas de lecture après « suivant »');
  await w.waitForTimeout(1000); // machine lente (Mac de GitHub) : le morceau doit être bien chargé avant d'aller vers la fin
  await seekNearEnd(w, 4);
  assert(await waitFor(async () => (await title(w)) !== a, 12000, 200), 'pas d\'enchaînement');
  // après un redémarrage, le tour continue : pas de répétition
  await w.waitForTimeout(2500);
  const seenBefore = await w.evaluate(() => JSON.parse(JSON.stringify(window.laserbeat.store.get('lb_resume').seen)));
  assert(seenBefore.length >= 2 && seenBefore.length <= n, 'tour non mémorisé : ' + seenBefore.length);
  assert(!errors.length, 'erreurs : ' + errors.join(' | '));
  await close(app);
});

test('Lire ensuite : clic droit sur un morceau, il passe après celui en cours, puis l\'ordre reprend', async () => {
  const { app, w, errors } = await launch(newDataDir('lire-ensuite'));
  await w.click('.pli >> text=Laser Arena'); await w.click('#view .bigplay');
  assert(await waitFor(async () => (await title(w)) === 'Phonk Laser Game' && await playing(w), 10000), 'pas de lecture');
  const ask = async name => {
    await w.click(`#view .trow:not(.thead):has(.tn:text-is("${name}"))`, { button: 'right' });
    assert(await w.isVisible('#ctx'), 'menu du clic droit absent');
    await w.click('#ctx [data-act="play-next"]');
    assert(!(await w.isVisible('#ctx')), 'menu resté ouvert');
  };
  const nextIs = async (name, msg) => { await w.click('#bNext'); assert(await waitFor(async () => (await title(w)) === name, 5000, 100), msg + ' : ' + await title(w)); };
  // le morceau en cours ne peut pas être « lu ensuite »
  await w.click('#view .trow:not(.thead):has(.tn:text-is("Phonk Laser Game"))', { button: 'right' });
  assert(await w.isDisabled('#ctx [data-act="play-next"]'), 'morceau en cours proposé');
  await w.keyboard.press('Escape');
  assert(!(await w.isVisible('#ctx')), 'Échap ne ferme pas le menu');
  // deux demandes : elles passent dans l'ordre demandé, puis la playlist reprend où elle en était
  await ask('Drift Hardbass II'); await ask('Donk Division');
  assert((await title(w)) === 'Phonk Laser Game' && await playing(w), 'la demande a coupé le morceau en cours');
  await nextIs('Drift Hardbass II', '1re demande');
  await nextIs('Donk Division', '2e demande');
  await nextIs('Phonk', 'reprise de l\'ordre');
  await nextIs('Mandelao', 'suite de l\'ordre');
  // fin de morceau naturelle (avec fondu) : la demande passe aussi
  await ask('Night Raid');
  await seekNearEnd(w, 4);
  assert(await waitFor(async () => (await title(w)) === 'Night Raid', 8000, 200), 'demande ignorée en fin de morceau : ' + await title(w));
  await w.waitForTimeout(3500);
  await nextIs('Drift Hardbass', 'reprise après la fin de morceau');
  // en aléatoire : la demande passe en premier
  await w.click('#bShuf');
  await ask('Redline');
  await nextIs('Redline', 'demande en aléatoire');
  assert(!errors.length, 'erreurs : ' + errors.join(' | '));
  await close(app);
});

test('Mise à jour à la demande : Paramètres > Mise à jour, recherche puis « Installer maintenant »', async () => {
  // rien de nouveau : « à jour »
  let { app, w, errors } = await launch(newDataDir('maj-demande-0'));
  await w.click('#bBrand');
  assert(await w.isVisible('#setUpd'), 'rubrique Mise à jour absente des Paramètres');
  const last = await w.$$eval('.set-sec h3', r => r[r.length - 1].textContent);
  assert(last === 'Mise à jour', 'la rubrique Mise à jour n\'est pas tout en bas : ' + last);
  await w.click('[data-act="upd-check"]');
  assert(await waitFor(async () => (await w.textContent('#updTxt')).includes('à jour.'), 5000, 100), 'message « à jour » absent');
  assert(!errors.length, 'erreurs : ' + errors.join(' | '));
  await close(app);
  // une version existe : téléchargement, puis bouton d'installation
  const dir = newDataDir('maj-demande-1');
  ({ app, w, errors } = await launch(dir, { LASERBEAT_TEST_MANUAL_UPDATE: '9.9.9' }));
  await w.click('.pli >> text=Laser Arena'); await w.click('#view .bigplay');
  assert(await waitFor(() => playing(w), 10000), 'pas de lecture');
  await w.click('#bBrand');
  await w.click('[data-act="upd-check"]');
  assert(await waitFor(async () => (await w.textContent('#setUpd')).includes('9.9.9'), 3000, 50), 'version trouvée non annoncée');
  assert(await playing(w), 'la recherche a coupé la musique');
  assert(await waitFor(() => w.isVisible('[data-act="upd-install"]'), 6000, 200), 'bouton « Installer maintenant » absent');
  await w.click('[data-act="upd-install"]');
  assert(await waitFor(async () => (await w.isVisible('#boot')) && (await w.textContent('#bootK')).includes('Mise à jour'), 5000, 100), 'écran de mise à jour absent');
  assert(!errors.length, 'erreurs : ' + errors.join(' | '));
  await close(app);
});

test('Mac : mise à jour automatique, l\'ancienne appli remplacée et rien ne traîne', async () => {
  if (process.platform !== 'darwin' || !EXE) { console.log('        (vérifié seulement sur Mac, avec le logiciel compilé)'); return; }
  const dmg = path.join(ROOT, 'dist', 'Musique-ML-Mac.dmg');
  assert(fs.existsSync(dmg), '.dmg absent : ' + dmg);
  // 1er essai : le .dmg qui vient d'être compilé ; 2e essai : le vrai téléchargement depuis GitHub
  for (const source of [dmg, 'github']) {
  // copie de l'appli dans un dossier « Applications » de test
  const apps = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-applications-'));
  const src = path.resolve(EXE, '..', '..', '..'), target = path.join(apps, path.basename(src));
  cp.execFileSync('/usr/bin/ditto', [src, target]);
  const exe = path.join(target, 'Contents', 'MacOS', path.basename(EXE));
  const ino0 = fs.statSync(target).ino;
  const leftovers = () => fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('musique-ml-maj-'));
  const dir = newDataDir('maj-mac-auto-' + (source === 'github' ? 'github' : 'local'));
  const app = await _electron.launch({ executablePath: exe, args: BASE_ARGS, env: env(dir, { LASERBEAT_TEST_MAC_DMG: source }), timeout: 60000 });
  current = app;
  const w = await app.firstWindow();
  await w.waitForLoadState('domcontentloaded');
  // téléchargement (ici : copie du .dmg), sortie de l'appli, puis le bouton apparaît
  assert(await waitFor(() => w.isVisible('#updBtn'), 180000, 1000), 'version jamais prête : ' + logOf(dir).split('\n').filter(l => l.includes('[maj]')).slice(-3).join(' | '));
  const dmgs = leftovers().flatMap(n => { try { return fs.readdirSync(path.join(os.tmpdir(), n)); } catch (e) { return []; } }).filter(n => n.endsWith('.dmg'));
  assert(!dmgs.length, 'le .dmg téléchargé n\'a pas été supprimé');
  const pid = app.process().pid;
  await w.click('#updBtn');
  // Musique ML se ferme, l'appli est remplacée, le dossier temporaire est effacé
  const gone = () => { try { process.kill(pid, 0); return false; } catch (e) { return true; } };
  assert(await waitFor(async () => gone(), 20000, 250), 'Musique ML ne se ferme pas pour s\'installer');
  current = null;
  assert(await waitFor(async () => { try { return fs.statSync(target).ino !== ino0; } catch (e) { return false; } }, 30000, 250), 'ancienne appli non remplacée');
  assert(await waitFor(async () => !leftovers().length, 15000, 250), 'dossier temporaire non effacé : ' + leftovers().join(', '));
  assert(!fs.existsSync(target + '.ancienne-version'), 'l\'ancienne version est restée à côté');
  assert(fs.readdirSync(apps).length === 1, 'fichiers en trop dans Applications : ' + fs.readdirSync(apps).join(', '));
  assert(fs.existsSync(exe), 'nouvelle appli incomplète');
  assert(logOf(dir).includes('[maj] remplacement de'), 'remplacement non noté dans le journal');
  fs.rmSync(apps, { recursive: true, force: true });
  }
});

test('Mac : nouvelle version annoncée, à télécharger sur le site, sans couper la musique', async () => {
  const dir = newDataDir('maj-mac');
  const { app, w, errors } = await launch(dir, { LASERBEAT_TEST_SITE_UPDATE: '9.9.9' });
  await w.click('.pli >> text=Laser Arena'); await w.click('#view .bigplay');
  assert(await waitFor(() => playing(w), 10000), 'pas de lecture');
  await w.click('#bBrand');
  await w.click('[data-act="upd-check"]');
  assert(await waitFor(async () => (await w.textContent('#setUpd')).includes('9.9.9 disponible'), 3000, 50), 'nouvelle version non annoncée');
  assert(await w.isVisible('#updBtn'), 'bouton « Nouvelle version » absent de la colonne de gauche');
  await w.click('[data-act="upd-site"]');
  await w.waitForTimeout(500);
  const logTxt = fs.readFileSync(path.join(dir, 'laserbeat.log'), 'utf8');
  assert(logTxt.includes('ouverture du site de téléchargement'), 'le site n\'est pas ouvert');
  assert(await playing(w), 'l\'annonce a coupé la musique');
  assert(!(await w.isVisible('#boot')), 'écran de mise à jour affiché alors que rien ne s\'installe');
  assert(!errors.length, 'erreurs : ' + errors.join(' | '));
  await close(app);
});

test('Fin de playlist : la musique continue (répétition de la playlist par défaut)', async () => {
  const { app, w } = await launch(newDataDir('fin-playlist'));
  await w.click('.pli >> text=LaserBeats');
  assert(await w.evaluate(() => document.querySelector('#bRep').classList.contains('on')), 'répétition non active par défaut');
  const rows = await w.$$('#view .trow:not(.thead)');
  await rows[rows.length - 1].click();                               // dernier morceau de la playlist
  assert(await waitFor(async () => (await title(w)) === 'Ambiance Pop II' && await playing(w), 10000), 'dernier morceau non lancé');
  await w.waitForTimeout(2500); await seekNearEnd(w, 1);
  assert(await waitFor(async () => (await title(w)) === 'Phonk Laser Game' && await playing(w), 10000), 'la musique s\'arrête en fin de playlist');
  await close(app);
});

test('Playlists vides masquées, reprise sûre si un morceau a été retiré', async () => {
  const dir = newDataDir('retires');
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ lb_v2: true, lb_favs: ['b:ancien-morceau.mp3'], lb_resume: { pl: 'beats', id: 'b:ancien-morceau.mp3', t: 30, playing: true, shuffle: false, repeat: 1 } }));
  const { app, w } = await launch(dir);
  const side = await w.$$eval('#sideList .pli b', e => e.map(x => x.textContent.trim()));
  assert(side.join('|') === 'Morceaux préférés|Laser Arena|LaserBeats|Ambiance accueil', 'playlists affichées : ' + side.join(', '));
  assert((await w.textContent('#sideList .pli[data-id="fav"] small')) === 'Playlist · 0 morceau', 'favori d\'un morceau retiré encore compté');
  assert(await waitFor(() => playing(w), 10000), 'la musique ne repart pas après le retrait du morceau');
  await close(app);
});

test('Page « Ambiance accueil » : ajout de morceaux séparés du laser game', async () => {
  const dir = newDataDir('accueil');
  const src = path.join(tmpRoot, 'Ambiance douce.mp3');
  fs.copyFileSync(SAMPLE_MP3, src);
  const { app, w, errors } = await launch(dir);
  await app.evaluate(({ dialog }, src) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [src] }); }, src);
  await w.click('#n-accueil');
  assert((await w.textContent('#ttl')) === 'Ambiance accueil', 'page non ouverte');
  const fournis = await w.$$eval('#view .trow:not(.thead) .tn', r => r.map(x => x.textContent));
  assert(fournis.join('|') === 'Ambiance Pop|Ambiance Pop II', 'musiques d\'accueil fournies : ' + fournis.join(', '));
  await w.click('text=Ajouter des morceaux');
  assert(await waitFor(async () => (await w.$$eval('#view .trow:not(.thead) .tn', r => r.map(x => x.textContent))).includes('Ambiance douce'), 5000), 'morceau non ajouté à l\'accueil');
  const json = JSON.parse(fs.readFileSync(path.join(dir, 'musiques', 'morceaux.json'), 'utf8'));
  assert(json.some(e => e.fichier === 'Ambiance douce.mp3' && e.playlist === 'Ambiance accueil'), 'mauvaise playlist enregistrée');
  await w.click('.pli >> text=Laser Arena'); await w.waitForTimeout(300);
  const arena = await w.$$eval('#view .trow:not(.thead) .tn', r => r.map(x => x.textContent));
  assert(!arena.includes('Ambiance douce') && !arena.includes('Ambiance Pop') && !arena.includes('Ambiance Pop II') && arena.length === 13, 'musique d\'accueil mélangée à Laser Arena');
  await w.click('.pli >> text=LaserBeats'); await w.waitForTimeout(300);
  const all = await w.$$eval('#view .trow:not(.thead) .tn', r => r.map(x => x.textContent));
  assert(all.includes('Ambiance douce') && all.includes('Mandelao') && all.includes('Night Raid') && all.length === 16, 'LaserBeats ne réunit pas toute la musique : ' + all.join(', '));
  assert(!errors.length, 'erreurs : ' + errors.join(' | '));
  await close(app);
});

test('Bouton ⓘ : fiche « À propos » (auteur, propriété, utilisation)', async () => {
  const { app, w } = await launch(newDataDir('apropos'));
  await w.click('#bInfo');
  assert(await w.isVisible('#about'), 'fiche non affichée');
  const txt = await w.textContent('#aboutBox');
  for (const m of ['Maxime Loret', 'Didier Floret', '100 % des droits', '100 % légal', 'Trégueux', 'Quimper', 'Brest']) assert(txt.includes(m), 'texte manquant : ' + m);
  await w.keyboard.press('Escape');
  assert(!(await w.isVisible('#about')), 'Échap ne ferme pas la fiche');
  await close(app);
});

test('Réglages conservés et reprise de la musique après redémarrage', async () => {
  const dir = newDataDir('reglages');
  let { app, w } = await launch(dir);
  await w.click('.pli >> text=LaserBeats'); await w.click('#view .bigplay');
  assert(await waitFor(() => playing(w), 10000), 'pas de lecture');
  await w.evaluate(() => { const v = document.querySelector('#vol'); v.value = '0.42'; v.dispatchEvent(new Event('input')); });
  await w.click('#bFav'); await w.click('#bRep');
  const t = await title(w);
  await w.waitForTimeout(800);
  await close(app);
  ({ app, w } = await launch(dir));
  assert(await waitFor(() => playing(w), 10000), 'la musique ne reprend pas');
  assert((await w.inputValue('#vol')) === '0.42', 'volume perdu');
  assert(await title(w) === t, 'mauvais morceau repris');
  assert(await w.evaluate(() => document.querySelector('#bFav').classList.contains('on')), 'favori perdu');
  assert(await w.evaluate(() => document.querySelector('#bRep').classList.contains('on')), 'mode répétition perdu');
  await close(app);
});

test('Import puis suppression d\'un morceau (pendant sa lecture)', async () => {
  const dir = newDataDir('import');
  const src = path.join(tmpRoot, 'Mon morceau test.mp3');
  fs.copyFileSync(SAMPLE_MP3, src);
  const { app, w, errors } = await launch(dir);
  await app.evaluate(({ dialog }, src) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [src] }); dialog.showMessageBox = async () => ({ response: 0 }); }, src);
  await w.click('#n-lib'); await w.click('text=Ajouter mes morceaux');
  assert(await waitFor(async () => (await w.$$('#view .del')).length === 1, 5000), 'morceau importé absent');
  assert(fs.existsSync(path.join(dir, 'musiques', 'Mon morceau test.mp3')), 'fichier non copié');
  await w.click('#view .trow:not(.thead) .tn');
  assert(await waitFor(() => playing(w), 10000), 'le morceau importé ne joue pas');
  await w.hover('#view .trow:not(.thead)'); await w.click('#view .trow:not(.thead) .del');
  assert(await waitFor(() => !fs.existsSync(path.join(dir, 'musiques', 'Mon morceau test.mp3')), 8000), 'fichier non supprimé');
  assert((await w.$$('#view .trow:not(.thead) .tn')).length === 0, 'morceau encore affiché');
  assert(!errors.length, 'erreurs : ' + errors.join(' | '));
  await close(app);
});

test("Plantage de l'interface : rechargement et reprise automatique", async () => {
  const { app, w } = await launch(newDataDir('plantage'));
  await w.click('text=Jouer la musique');
  assert(await waitFor(() => playing(w), 10000), 'pas de lecture');
  await w.waitForTimeout(6500); // état enregistré
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());
  const back = await waitFor(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents
    .executeJavaScript("[...document.querySelectorAll('audio')].some(a => !a.paused && a.currentTime > 0)").catch(() => false)), 20000, 1000);
  assert(back, "la musique n'a pas repris après le plantage");
  await close(app);
});

test('Aucune navigation ni fenêtre externe (jamais de navigateur)', async () => {
  const { app, w } = await launch(newDataDir('navigation'));
  await w.evaluate(() => { location.href = 'https://www.qwant.com/'; });
  await w.waitForTimeout(1500);
  await w.evaluate(() => window.open('https://example.com'));
  await w.waitForTimeout(800);
  const urls = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(b => b.webContents.getURL()));
  assert(urls.length === 1 && urls[0].startsWith('file:'), 'navigation ouverte : ' + urls.join(', '));
  await close(app);
});

test('Une seule instance : un 2e lancement se ferme et réaffiche la fenêtre', async () => {
  const dir = newDataDir('instance');
  const { app } = await launch(dir);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
  const r = cp.spawnSync(ELECTRON, BASE_ARGS, { env: env(dir), timeout: 30000 });
  assert(r.status === 0, '2e instance : code ' + r.status);
  await sleep(800);
  assert(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), 'fenêtre non réaffichée');
  await close(app);
});

test('Croix de la fenêtre : « Réduire » garde la musique, « Quitter » ferme', async () => {
  const { app, w } = await launch(newDataDir('croix'));
  await w.click('text=Jouer la musique');
  assert(await waitFor(() => playing(w), 10000), 'pas de lecture');
  await app.evaluate(({ dialog }) => { global.__asked = 0; dialog.showMessageBox = async () => { global.__asked++; return { response: 0 }; }; });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await sleep(1500);
  const st = await app.evaluate(({ BrowserWindow }) => ({ n: BrowserWindow.getAllWindows().length, min: BrowserWindow.getAllWindows()[0].isMinimized(), asked: global.__asked }));
  assert(st.asked === 1, 'question non posée');
  assert(st.n === 1, 'fenêtre fermée au lieu de réduite');
  assert(await playing(w), 'la musique s\'est arrêtée');
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
  const exited = new Promise(r => app.process().once('exit', () => r(true)));
  await app.evaluate(({ BrowserWindow }) => { const b = BrowserWindow.getAllWindows()[0]; b.restore(); b.close(); });
  assert(await Promise.race([exited, sleep(10000).then(() => false)]), '« Quitter » ne ferme pas LaserBeat');
  current = null;
});

test('Mise à jour prête : le bouton apparaît et lance l\'installation', async () => {
  const { app, w } = await launch(newDataDir('maj'));
  await app.evaluate(({ ipcMain }) => { global.__inst = 0; ipcMain.on('update:install', () => global.__inst++); });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('update:ready', '9.9.9'));
  assert(await waitFor(() => w.isVisible('#updBtn'), 3000), 'bouton absent');
  await w.click('#updBtn');
  // écran « Mise à jour » : barre qui avance, rapide au début puis plus lente, jusqu'à 100 %
  assert(await waitFor(() => w.isVisible('#boot'), 2000), 'écran de mise à jour absent');
  assert((await w.textContent('#bootT')).includes('9.9.9'), 'version absente de l\'écran');
  const pct = async () => parseInt(await w.textContent('#bootP'), 10);
  await sleep(1000); const p1 = await pct();
  await sleep(1000); const p2 = await pct();
  await sleep(1000); const p3 = await pct();
  console.log(`    progression : ${p1} % -> ${p2} % -> ${p3} % (1 s d'écart)`);
  assert(p1 < p2 && p2 < p3, 'la barre n\'avance pas');
  assert(p2 - p1 > p3 - p2, 'la barre ne ralentit pas');
  assert(await waitFor(() => app.evaluate(() => global.__inst === 1), 4000), 'installation non demandée');
  assert((await pct()) === 100, 'la barre n\'atteint pas 100 %');
  await close(app);
});

test('Mise à jour au lancement : installée avant la musique, 2 essais au maximum', async () => {
  const dir = newDataDir('maj-lancement');
  let { app, w } = await launch(dir);                       // session précédente : musique en cours
  await w.click('text=Jouer la musique');
  assert(await waitFor(() => playing(w), 10000), 'pas de lecture');
  await w.waitForTimeout(800);
  await close(app);
  for (let k = 1; k <= 2; k++) {
    ({ app, w } = await launch(dir, { LASERBEAT_TEST_LAUNCH_UPDATE: '9.9.9' }));
    await app.evaluate(({ ipcMain }) => { global.__inst = 0; ipcMain.on('update:install', () => global.__inst++); });
    assert(await w.isVisible('#boot'), 'écran de mise à jour absent au lancement (essai ' + k + ')');
    assert(!(await playing(w)), 'la musique démarre avant la mise à jour');
    assert(await waitFor(() => app.evaluate(() => global.__inst === 1), 8000), 'installation non lancée (essai ' + k + ')');
    await close(app);
  }
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
  assert(cfg.lb_resume && cfg.lb_resume.playing, 'état de lecture perdu pendant la mise à jour');
  ({ app, w } = await launch(dir, { LASERBEAT_TEST_LAUNCH_UPDATE: '9.9.9' }));  // 3e lancement : on n'insiste plus
  assert(await waitFor(() => playing(w), 10000), 'après 2 échecs, la musique doit démarrer normalement');
  assert(!(await w.isVisible('#boot')), 'écran de mise à jour encore affiché');
  await close(app);
});

test('Premier lancement après une mise à jour : écran « Mise à jour installée »', async () => {
  const dir = newDataDir('apres-maj');
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ lb_lastVersion: '0.0.1', lb_v2: true }));
  const { app, w } = await launch(dir);
  assert(await w.isVisible('#boot'), 'écran absent après mise à jour');
  assert((await w.textContent('#bootK')).includes('Mise à jour installée'), 'mauvais texte');
  assert(await waitFor(async () => !(await w.isVisible('#boot')), 6000), 'l\'écran ne disparaît pas');
  await close(app);
  const again = await launch(dir);
  await sleep(300);
  assert(!(await again.w.isVisible('#boot')), 'écran affiché à un lancement normal');
  await close(again.app);
});

test('Fenêtre « Mise à jour » : nouveautés montrées une fois après la mise à jour, historique dans Paramètres', async () => {
  // notes.js doit décrire la version publiée, en tête de liste
  const g = {}; new Function('window', fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'notes.js'), 'utf8'))(g);
  const pkgV = require(path.join(ROOT, 'package.json')).version;
  assert(Array.isArray(g.NOTES) && g.NOTES.length && g.NOTES[0].v === pkgV, 'src/renderer/notes.js : ajouter en tête les nouveautés de la version ' + pkgV);
  assert(g.NOTES.every(n => /^\d+\.\d+\.\d+$/.test(n.v) && n.items.length && n.items.every(t => typeof t === 'string' && t.length > 10)), 'notes.js : entrée mal formée');
  const prevV = g.NOTES[1].v;
  const dir = newDataDir('nouveautes');
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ lb_lastVersion: prevV, lb_v2: true }));
  const { app, w, errors } = await launch(dir);
  assert(await waitFor(async () => (await w.isVisible('#about')) && (await w.textContent('#aboutBox')).includes('Nouveautés') && (await w.textContent('#aboutT')) === 'Mise à jour', 9000), 'fenêtre « Mise à jour » absente après la mise à jour');
  const box = await w.textContent('#aboutBox');
  assert(box.includes('Version ' + pkgV) && box.includes(g.NOTES[0].items[0]), 'nouveautés de la version ' + pkgV + ' absentes');
  assert(!box.includes('Version ' + prevV), 'les nouveautés déjà vues (' + prevV + ') ne doivent pas réapparaître');
  await w.click('#aboutBox >> text=C\'est noté');
  assert(!(await w.isVisible('#about')), 'le bouton « C\'est noté » ne ferme pas');
  // historique complet depuis Paramètres
  await w.click('#bBrand');
  await w.click('[data-act="notes"]');
  const all = await w.textContent('#aboutBox');
  for (const n of g.NOTES) assert(all.includes('Version ' + n.v), 'historique incomplet : ' + n.v);
  await w.keyboard.press('Escape');
  assert(!(await w.isVisible('#about')), 'Échap ne ferme pas l\'historique');
  assert(!errors.length, 'erreurs : ' + errors.join(' | '));
  await close(app);
  const again = await launch(dir);
  await sleep(1000);
  assert(!(await again.w.isVisible('#about')), 'nouveautés réaffichées à un lancement normal');
  await close(again.app);
});

test('Raccourcis Windows : logo ML remis sur nos raccourcis, ceux des autres logiciels intacts', async () => {
  const { repairShortcuts, shortcutDirs } = require(path.join(ROOT, 'src', 'raccourcis.js'));
  const appData = newDataDir('raccourcis'), desk = path.join(appData, 'Bureau');
  const dirs = shortcutDirs(appData, desk);
  dirs.forEach(d => fs.mkdirSync(d, { recursive: true }));
  const links = {
    [path.join(dirs[0], 'LaserBeat.lnk')]: { target: 'C:\\Users\\x\\AppData\\Local\\Programs\\laserbeat\\LaserBeat.exe', icon: 'C:\\ancien\\icone.ico' },
    [path.join(dirs[0], 'Navigateur.lnk')]: { target: 'C:\\Program Files\\Nav\\nav.exe', icon: '' },
    [path.join(dirs[2], 'Musique ML.lnk')]: { target: 'C:\\autre\\LaserBeat.exe', appUserModelId: 'fr.laserbeat.app' },
    [path.join(desk, 'Jeu.lnk')]: { target: 'C:\\Jeux\\jeu.exe' }
  };
  Object.keys(links).forEach(f => fs.writeFileSync(f, ''));
  fs.writeFileSync(path.join(desk, 'notes.txt'), '');
  const written = {};
  const shell = {
    readShortcutLink: f => { if (!links[f]) throw new Error('pas un raccourci'); return links[f]; },
    writeShortcutLink: (f, op, o) => { written[f] = { op, ...o }; return true; }
  };
  const exe = 'C:\\Users\\x\\AppData\\Local\\Programs\\laserbeat\\LaserBeat.exe';
  const fixed = repairShortcuts({ shell, exe, appId: 'fr.laserbeat.app', dirs });
  assert(fixed.length === 2, 'raccourcis réparés : ' + fixed.length);
  for (const f of fixed) {
    const o = written[f];
    assert(o.op === 'update' && o.target === exe && o.icon === exe && o.iconIndex === 0 && o.appUserModelId === 'fr.laserbeat.app', 'raccourci mal réparé : ' + f);
  }
  assert(!written[path.join(dirs[0], 'Navigateur.lnk')] && !written[path.join(desk, 'Jeu.lnk')], 'raccourci d\'un autre logiciel modifié');
});

test('Sortie son : choix dans Paramètres, mémorisé, pause si débranchée puis reprise', async () => {
  const dir = newDataDir('sortie-choix');
  // sorties son simulées (le PC de test n'a pas de carte son) ; setSinkId est noté au lieu d'être appliqué
  const fake = w => w.evaluate(() => {
    window.__outs = [
      { kind: 'audiooutput', deviceId: 'default', groupId: 'g0', label: 'Par défaut' },
      { kind: 'audiooutput', deviceId: 'casque-1', groupId: 'g1', label: 'Prise casque' },
      { kind: 'audiooutput', deviceId: 'hdmi-2', groupId: 'g2', label: 'Ampli accueil (HDMI)' }
    ];
    navigator.mediaDevices.enumerateDevices = async () => window.__outs;
    HTMLMediaElement.prototype.setSinkId = async function (id) { Object.defineProperty(this, 'sinkId', { value: id, configurable: true }); };
    navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
  });
  const sinks = w => w.evaluate(() => [...document.querySelectorAll('audio:not(.zone2)')].map(a => a.sinkId));
  let { app, w, errors } = await launch(dir);
  await fake(w); await w.waitForTimeout(2000);
  await w.click('.pli >> text=Laser Arena'); await w.click('#view .bigplay');
  assert(await waitFor(() => playing(w), 10000), 'pas de lecture');
  await w.click('#bBrand');
  const opts = await w.$$eval('select[data-k="sink"] option', o => o.map(x => x.textContent));
  assert(opts.join('|') === 'Sortie par défaut de Windows|Prise casque|Ampli accueil (HDMI)', 'sorties proposées : ' + opts.join(', '));
  await w.selectOption('select[data-k="sink"]', 'hdmi-2');
  assert(await waitFor(async () => (await sinks(w)).every(x => x === 'hdmi-2'), 3000, 100), 'sortie non appliquée aux lecteurs : ' + (await sinks(w)).join(','));
  assert(await playing(w), 'le changement de sortie a coupé la musique');
  // débranchée : pause (pas de bascule sur une autre sortie), message en haut
  await w.evaluate(() => { window.__outs = window.__outs.filter(o => o.deviceId !== 'hdmi-2'); navigator.mediaDevices.dispatchEvent(new Event('devicechange')); });
  assert(await waitFor(async () => !(await playing(w)), 5000, 200), 'la musique continue alors que la sortie est débranchée');
  assert((await w.textContent('#statT')).includes('débranchée'), 'message « sortie débranchée » absent');
  assert((await w.$eval('select[data-k="sink"]', s => s.selectedOptions[0].textContent)).includes('(débranchée)'), 'Paramètres n\'indique pas la sortie débranchée');
  await w.waitForTimeout(2500);
  assert(!(await playing(w)), 'la musique est repartie toute seule sur une autre sortie');
  // rebranchée : reprise toute seule, sur la bonne sortie
  await w.evaluate(() => { window.__outs.push({ kind: 'audiooutput', deviceId: 'hdmi-2', groupId: 'g2', label: 'Ampli accueil (HDMI)' }); navigator.mediaDevices.dispatchEvent(new Event('devicechange')); });
  assert(await waitFor(() => playing(w), 6000, 200), 'la musique ne reprend pas quand la sortie est rebranchée');
  assert((await sinks(w)).every(x => x === 'hdmi-2'), 'mauvaise sortie après rebranchement');
  assert(!(await w.textContent('#statT')).includes('débranchée'), 'message resté affiché');
  assert(/Sortie son « Ampli accueil \(HDMI\) » débranchée/.test(logOf(dir)) && /rebranchée/.test(logOf(dir)), 'journal incomplet');
  assert(!errors.length, 'erreurs : ' + errors.join(' | '));
  await close(app);
  // mémorisée après relance
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
  assert(cfg.lb_sink && cfg.lb_sink.id === 'hdmi-2' && cfg.lb_sink.label === 'Ampli accueil (HDMI)', 'sortie non mémorisée : ' + JSON.stringify(cfg.lb_sink));
  // retour à la sortie par défaut
  ({ app, w, errors } = await launch(dir));
  await fake(w); await w.waitForTimeout(2000);
  await w.click('#bBrand');
  await w.selectOption('select[data-k="sink"]', '');
  assert(await waitFor(async () => (await sinks(w)).every(x => x === ''), 3000, 100), 'retour à la sortie par défaut impossible');
  assert(!errors.length, 'erreurs : ' + errors.join(' | '));
  await close(app);
});

test('Multi-écoute : Arène et Accueil en même temps, chacune sa playlist, son volume et sa sortie son', async () => {
  const dir = newDataDir('multi');
  const fake = w => w.evaluate(() => {
    window.__outs = [
      { kind: 'audiooutput', deviceId: 'default', groupId: 'g0', label: 'Par défaut' },
      { kind: 'audiooutput', deviceId: 'arene-1', groupId: 'g1', label: 'Ampli arène' },
      { kind: 'audiooutput', deviceId: 'accueil-2', groupId: 'g2', label: 'Enceintes accueil' }
    ];
    navigator.mediaDevices.enumerateDevices = async () => window.__outs;
    HTMLMediaElement.prototype.setSinkId = async function (id) { Object.defineProperty(this, 'sinkId', { value: id, configurable: true }); };
    navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
  });
  const zone = w => w.evaluate(() => [...document.querySelectorAll('audio.zone2')].filter(a => !a.paused && a.getAttribute('src')).map(a => ({ v: a.volume, sink: a.sinkId, t: a.currentTime })));
  const arena = w => w.evaluate(() => [...document.querySelectorAll('audio:not(.zone2)')].filter(a => !a.paused && a.getAttribute('src')).map(a => ({ v: a.volume, sink: a.sinkId })));
  let { app, w, errors } = await launch(dir);
  await fake(w); await w.waitForTimeout(2000);
  // désactivée par défaut : rien ne change
  assert(!(await w.isVisible('#zbar')), 'barre de l\'accueil visible alors que la multi-écoute est désactivée');
  await w.click('.pli >> text=Laser Arena'); await w.click('#view .bigplay');
  assert(await waitFor(async () => (await arena(w)).length > 0, 10000), 'pas de lecture dans l\'arène');
  // activation par le bouton du haut
  await w.click('#bMulti');
  assert(await w.isVisible('#zbar'), 'barre de l\'accueil absente');
  assert((await w.getAttribute('#bMulti', 'aria-pressed')) === 'true', 'bouton Multi-écoute non enfoncé');
  assert((await w.$eval('#zPl', s => s.value)) === 'accueil', 'playlist par défaut de l\'accueil : ' + await w.$eval('#zPl', s => s.value));
  assert(await w.$eval('#zPl option[value="arena"]', o => o.disabled), 'la playlist de l\'arène est proposée à l\'accueil');
  assert((await zone(w)).length === 0, 'l\'accueil démarre tout seul à l\'activation');
  // sorties : une par zone
  await w.click('#bBrand');
  await w.selectOption('select[data-k="sink"]', 'arene-1');
  await w.selectOption('select[data-k="zsink"]', 'accueil-2');
  await w.waitForTimeout(500);
  // lecture de l'accueil : les deux zones jouent en même temps, chacune sur sa sortie
  await w.click('#zPlay');
  assert(await waitFor(async () => (await zone(w)).length === 1, 8000, 200), 'l\'accueil ne joue pas');
  const A1 = await arena(w), Z1 = await zone(w);
  assert(A1.length === 1 && A1[0].sink === 'arene-1', 'arène : ' + JSON.stringify(A1));
  assert(Z1[0].sink === 'accueil-2', 'accueil : ' + JSON.stringify(Z1));
  const zt = await w.textContent('#zT');
  assert(['Ambiance Pop', 'Ambiance Pop II'].includes(zt), 'morceau de l\'accueil : ' + zt);
  assert(!(await w.textContent('#npT')).startsWith('Ambiance'), 'l\'arène a basculé sur l\'accueil');
  // volumes séparés
  const av = (await arena(w))[0].v;
  await w.$eval('#zVol', el => { el.value = '0.2'; el.dispatchEvent(new Event('input')); });
  await w.waitForTimeout(300);
  assert((await zone(w))[0].v < 0.21 && Math.abs((await arena(w))[0].v - av) < 0.001, 'les volumes ne sont pas séparés');
  // barre de progression de l'accueil : un clic au milieu avance le morceau, l'arène ne bouge pas
  const at0 = await w.evaluate(() => document.querySelector('audio:not(.zone2):not([paused])') && [...document.querySelectorAll('audio:not(.zone2)')].find(x => !x.paused).currentTime);
  const zb = await w.$('#zBar'); const box = await zb.boundingBox();
  await w.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
  await w.waitForTimeout(400);
  const zp = await w.evaluate(() => { const a = [...document.querySelectorAll('audio.zone2')].find(x => !x.paused); const t = window.laserbeat.tracks.find(x => x.id === a.dataset.tid); return a.currentTime / (t.end || a.duration); });
  assert(zp > 0.4 && zp < 0.6, 'clic sur la barre de l\'accueil sans effet : ' + zp.toFixed(2));
  const at1 = await w.evaluate(() => [...document.querySelectorAll('audio:not(.zone2)')].find(x => !x.paused).currentTime);
  assert(Math.abs(at1 - at0) < 3, 'le clic sur la barre de l\'accueil a déplacé l\'arène');
  assert((await w.textContent('#zTmC')) !== '0:00', 'temps de l\'accueil non affiché');
  // morceau suivant de l'accueil : l'arène ne bouge pas
  const arenaTitle = await title(w);
  await w.click('#zNext');
  assert(await waitFor(async () => (await w.textContent('#zT')) !== zt, 5000, 100), 'suivant de l\'accueil sans effet');
  assert((await title(w)) === arenaTitle && (await arena(w)).length === 1, 'le suivant de l\'accueil a touché l\'arène');
  // touches du clavier : elles commandent l'arène seulement
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('media:key', 'playpause'));
  assert(await waitFor(async () => (await arena(w)).length === 0, 3000, 100), 'la touche lecture/pause ne met pas l\'arène en pause');
  assert((await zone(w)).length === 1, 'la touche lecture/pause a arrêté l\'accueil');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('media:key', 'playpause'));
  assert(await waitFor(async () => (await arena(w)).length === 1, 3000, 100), 'l\'arène ne repart pas');
  // sortie de l'accueil débranchée : seul l'accueil se met en pause
  await w.evaluate(() => { window.__outs = window.__outs.filter(o => o.deviceId !== 'accueil-2'); navigator.mediaDevices.dispatchEvent(new Event('devicechange')); });
  assert(await waitFor(async () => (await zone(w)).length === 0, 6000, 200), 'l\'accueil continue alors que sa sortie est débranchée');
  assert((await arena(w)).length === 1, 'l\'arène s\'est arrêtée à cause de la sortie de l\'accueil');
  assert((await w.textContent('#zS')).includes('débranchée'), 'message de sortie débranchée absent de la barre de l\'accueil');
  await w.evaluate(() => { window.__outs.push({ kind: 'audiooutput', deviceId: 'accueil-2', groupId: 'g2', label: 'Enceintes accueil' }); navigator.mediaDevices.dispatchEvent(new Event('devicechange')); });
  assert(await waitFor(async () => (await zone(w)).length === 1, 6000, 200), 'l\'accueil ne reprend pas quand sa sortie est rebranchée');
  assert((await zone(w))[0].sink === 'accueil-2', 'mauvaise sortie pour l\'accueil après rebranchement');
  // fin de morceau de l'accueil : enchaînement dans l'accueil, l'arène continue
  const z2 = await w.textContent('#zT');
  await w.evaluate(() => { const a = [...document.querySelectorAll('audio.zone2')].find(x => !x.paused); const t = window.laserbeat.tracks.find(x => x.id === a.dataset.tid); a.currentTime = (t.end || a.duration) - 4; });
  assert(await waitFor(async () => (await w.textContent('#zT')) !== z2, 9000, 200), 'pas d\'enchaînement dans l\'accueil');
  assert((await arena(w)).length >= 1, 'l\'arène s\'est arrêtée pendant l\'enchaînement de l\'accueil');
  assert(!errors.length, 'erreurs : ' + errors.join(' | '));
  await w.waitForTimeout(2500);
  await close(app);
  // relance : les deux zones reprennent, chacune sur sa sortie
  ({ app, w, errors } = await launch(dir));
  await fake(w);
  assert(await waitFor(async () => (await zone(w)).length === 1 && (await arena(w)).length >= 1, 12000, 300), 'les deux zones ne reprennent pas après relance');
  assert(await waitFor(async () => (await zone(w))[0].sink === 'accueil-2' && (await arena(w))[0].sink === 'arene-1', 6000, 200), 'sorties perdues après relance');
  assert(Math.abs((await zone(w))[0].v - 0.2 * 1) < 0.2, 'volume de l\'accueil perdu');
  // désactivation : l'accueil s'arrête, l'arène continue
  await w.click('#bMulti');
  assert(await waitFor(async () => (await zone(w)).length === 0, 3000, 100), 'l\'accueil joue encore après désactivation');
  assert((await arena(w)).length >= 1 && !(await w.isVisible('#zbar')), 'désactivation incorrecte');
  assert(!errors.length, 'erreurs : ' + errors.join(' | '));
  await close(app);
});

test('Sortie audio modifiée : le morceau repart au même endroit', async () => {
  const dir = newDataDir('sortie');
  const { app, w } = await launch(dir);
  await w.click('text=Jouer la musique');
  assert(await waitFor(() => playing(w), 10000), 'pas de lecture');
  await w.waitForTimeout(3000);
  await w.evaluate(() => {
    navigator.mediaDevices.enumerateDevices = async () => [{ kind: 'audiooutput', deviceId: 'nouvelle-carte-son', groupId: 'g', label: 'Enceintes' }];
    navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
  });
  assert(await waitFor(() => /Sortie audio modifiée/.test(logOf(dir)), 6000), 'changement de sortie non détecté');
  assert(await waitFor(() => w.evaluate(() => { const a = [...document.querySelectorAll('audio')].find(x => !x.paused); return !!a && a.currentTime > 2; }), 6000), 'le morceau ne repart pas au même endroit');
  await close(app);
});

/* ------------------------------------------------------------------ */
(async () => {
  console.log(`LaserBeat - tests (${EXE ? 'logiciel compilé : ' + EXE : 'version de développement'})`);
  let failed = 0;
  for (const t of tests) {
    const t0 = Date.now();
    try {
      await Promise.race([t.fn(), sleep(180000).then(() => { throw new Error('test trop long (> 3 min)'); })]);
      console.log(`  OK    ${t.name} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    } catch (e) {
      failed++;
      console.log(`  ÉCHEC ${t.name}\n        ${e.message}`);
      if (current) await close(current);
    }
  }
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  console.log(failed ? `${failed} test(s) en échec sur ${tests.length}` : `Tous les tests réussis (${tests.length})`);
  process.exit(failed ? 1 : 0);
})();
