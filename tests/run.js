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
const seekNearEnd = (w, s = 1) => w.evaluate(s => { const a = [...document.querySelectorAll('audio')].find(x => !x.paused); a.currentTime = a.duration - s; }, s);
const logOf = dir => { try { return fs.readFileSync(path.join(dir, 'laserbeat.log'), 'utf8'); } catch (e) { return ''; } };

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

/* ------------------------------------------------------------------ */
test('Démarrage : fenêtre Musique ML, sans menu, fichiers locaux, 6 morceaux', async () => {
  const { app, w, errors } = await launch(newDataDir('demarrage'));
  const info = await app.evaluate(({ BrowserWindow, Menu }) => {
    const b = BrowserWindow.getAllWindows()[0];
    return { n: BrowserWindow.getAllWindows().length, title: b.getTitle(), size: b.getSize(), min: b.getMinimumSize(), menu: Menu.getApplicationMenu(), url: b.webContents.getURL(), throttle: b.webContents.getBackgroundThrottling() };
  });
  assert(info.n === 1, 'une seule fenêtre attendue');
  assert(info.title === 'Musique ML', 'titre : ' + info.title);
  assert(info.min[0] === 1000 && info.min[1] === 640, 'taille minimale');
  assert(info.menu === null, 'menu par défaut présent');
  assert(info.url.startsWith('file:'), 'interface non locale : ' + info.url);
  assert(info.throttle === false, 'ralentissement en arrière-plan actif');
  const n = await w.evaluate(() => window.laserbeat.tracks.length);
  assert(n === 6, 'morceaux fournis : ' + n);
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

test('Mode écran : grande pochette, morceau suivant, Échap pour sortir', async () => {
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
  await w.locator(rows).nth(0).dragTo(w.locator(rows).nth(2), { targetPosition: { x: 200, y: 48 } });   // lâché sur le bas de Mandelao : juste après
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
      const d = [...document.querySelectorAll('audio')].map(a => ({ on: !a.paused && !!a.getAttribute('src'), v: a.volume }));
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

test('Fin de playlist : la musique continue (répétition de la playlist par défaut)', async () => {
  const { app, w } = await launch(newDataDir('fin-playlist'));
  await w.click('.pli >> text=LaserBeats');
  assert(await w.evaluate(() => document.querySelector('#bRep').classList.contains('on')), 'répétition non active par défaut');
  const rows = await w.$$('#view .trow:not(.thead)');
  await rows[rows.length - 1].click();                               // dernier morceau de la playlist
  assert(await waitFor(async () => (await title(w)) === 'Hard Rock' && await playing(w), 10000), 'dernier morceau non lancé');
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
  assert(await w.isVisible('#view .empty'), 'message de page vide absent');
  await w.click('text=Ajouter des morceaux');
  assert(await waitFor(async () => (await w.$$eval('#view .trow:not(.thead) .tn', r => r.map(x => x.textContent))).includes('Ambiance douce'), 5000), 'morceau non ajouté à l\'accueil');
  const json = JSON.parse(fs.readFileSync(path.join(dir, 'musiques', 'morceaux.json'), 'utf8'));
  assert(json.some(e => e.fichier === 'Ambiance douce.mp3' && e.playlist === 'Ambiance accueil'), 'mauvaise playlist enregistrée');
  await w.click('.pli >> text=Laser Arena'); await w.waitForTimeout(300);
  const arena = await w.$$eval('#view .trow:not(.thead) .tn', r => r.map(x => x.textContent));
  assert(!arena.includes('Ambiance douce'), 'musique d\'accueil mélangée à Laser Arena');
  await w.click('.pli >> text=LaserBeats'); await w.waitForTimeout(300);
  const all = await w.$$eval('#view .trow:not(.thead) .tn', r => r.map(x => x.textContent));
  assert(all.includes('Ambiance douce') && all.includes('Mandelao') && all.length === 7, 'LaserBeats ne réunit pas toute la musique : ' + all.join(', '));
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
