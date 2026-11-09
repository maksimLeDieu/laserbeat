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
const SAMPLE_MP3 = path.join(ROOT, 'musiques', '30-arret-net.mp3');

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
test('Démarrage : fenêtre LaserBeat, sans menu, fichiers locaux, 11 morceaux', async () => {
  const { app, w, errors } = await launch(newDataDir('demarrage'));
  const info = await app.evaluate(({ BrowserWindow, Menu }) => {
    const b = BrowserWindow.getAllWindows()[0];
    return { n: BrowserWindow.getAllWindows().length, title: b.getTitle(), size: b.getSize(), min: b.getMinimumSize(), menu: Menu.getApplicationMenu(), url: b.webContents.getURL(), throttle: b.webContents.getBackgroundThrottling() };
  });
  assert(info.n === 1, 'une seule fenêtre attendue');
  assert(info.title === 'LaserBeat', 'titre : ' + info.title);
  assert(info.min[0] === 1000 && info.min[1] === 640, 'taille minimale');
  assert(info.menu === null, 'menu par défaut présent');
  assert(info.url.startsWith('file:'), 'interface non locale : ' + info.url);
  assert(info.throttle === false, 'ralentissement en arrière-plan actif');
  const n = await w.evaluate(() => window.laserbeat.tracks.length);
  assert(n === 11, 'morceaux fournis : ' + n);
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

test('Fondu enchaîné : le suivant monte pendant que le premier descend, jamais de silence', async () => {
  const { app, w } = await launch(newDataDir('fondu'));
  await w.click('.pli >> text=Laser Arena'); await w.click('text=Écouter');
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
  assert(Math.abs(ons[0].v - Number(vol)) < 0.02, 'volume final incorrect');
  await close(app);
});

test('Fondu : pause et morceau suivant pendant le fondu restent propres', async () => {
  const { app, w } = await launch(newDataDir('fondu-pause'));
  await w.click('.pli >> text=Laser Arena'); await w.click('text=Écouter');
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
  await w.click('.pli >> text=Laser Arena'); await w.click('text=Écouter');
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
  await w.click('.pli >> text=Tech Zone'); await w.click('text=Écouter');
  assert(await waitFor(() => playing(w), 10000), 'pas de lecture');
  assert(await w.evaluate(() => document.querySelector('#bRep').classList.contains('on')), 'répétition non active par défaut');
  await w.waitForTimeout(2500); await seekNearEnd(w, 1);            // 1er morceau -> 2e
  assert(await waitFor(async () => (await title(w)) === 'Arrêt Net', 10000), 'pas de 2e morceau');
  await w.waitForTimeout(2500); await seekNearEnd(w, 1);            // dernier morceau -> retour au début
  assert(await waitFor(async () => (await title(w)) === 'Cible Verrouillée' && await playing(w), 10000), 'la musique s\'arrête en fin de playlist');
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
  await w.click('.pli >> text=Tech Zone'); await w.click('text=Écouter');
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
