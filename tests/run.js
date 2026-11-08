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
function env(dataDir) {
  return { ...process.env, LASERBEAT_USER_DATA: dataDir, LASERBEAT_TEST: '1' };
}
async function launch(dataDir) {
  const app = await _electron.launch({ executablePath: ELECTRON, args: BASE_ARGS, env: env(dataDir), timeout: 60000 });
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

test('Enchaînement : passage au morceau suivant sans blanc (< 250 ms)', async () => {
  const { app, w } = await launch(newDataDir('enchainement'));
  await w.click('.pli >> text=Laser Arena'); await w.click('text=Écouter');
  assert(await waitFor(() => playing(w), 10000), 'pas de lecture');
  await w.waitForTimeout(2500); // le morceau suivant est préchargé
  await w.evaluate(() => { window.__ev = []; document.querySelectorAll('audio').forEach(a => ['ended', 'playing'].forEach(n => a.addEventListener(n, () => window.__ev.push([n, performance.now()])))); });
  const t1 = await title(w);
  await seekNearEnd(w);
  assert(await waitFor(async () => (await title(w)) !== t1 && await playing(w), 10000), 'pas de passage au suivant');
  const ev = await w.evaluate(() => window.__ev);
  const end = ev.find(e => e[0] === 'ended'), pl = ev.filter(e => e[0] === 'playing').pop();
  assert(end && pl, 'événements manquants');
  const gap = pl[1] - end[1];
  console.log(`    blanc entre deux morceaux : ${gap.toFixed(1)} ms`);
  assert(gap < 250, 'blanc trop long : ' + gap.toFixed(0) + ' ms');
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

test('Agenda : la playlist du créneau change en fin de morceau', async () => {
  const { app, w } = await launch(newDataDir('agenda'));
  await w.click('#n-agenda');
  const cur = await w.evaluate(() => [...document.querySelectorAll('.ag tr')].findIndex(r => r.classList.contains('now')) - 1);
  const was = await w.$eval(`select[data-slot="${cur}"]`, s => s.value);
  await w.click('text=Reprendre la programmation');
  assert(await waitFor(() => playing(w), 10000), 'pas de lecture');
  const target = was === 'tech' ? 'over' : 'tech';
  const name = target === 'tech' ? 'Tech Zone' : 'Overdrive';
  await w.selectOption(`select[data-slot="${cur}"]`, target);
  await w.waitForTimeout(1500);
  await seekNearEnd(w);
  assert(await waitFor(async () => (await w.textContent('#npS')) === name && await playing(w), 10000), "l'agenda n'a pas changé de playlist");
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

test('Mise à jour prête : le bouton apparaît et lance l\'installation', async () => {
  const { app, w } = await launch(newDataDir('maj'));
  await app.evaluate(({ ipcMain }) => { global.__inst = 0; ipcMain.on('update:install', () => global.__inst++); });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('update:ready', '9.9.9'));
  assert(await waitFor(() => w.isVisible('#updBtn'), 3000), 'bouton absent');
  await w.click('#updBtn');
  assert(await waitFor(() => app.evaluate(() => global.__inst === 1), 3000), 'installation non demandée');
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

test('Redémarrage préventif de nuit (créneau « Hors horaires »)', async () => {
  const { app, w } = await launch(newDataDir('nuit'));
  await app.evaluate(({ ipcMain }) => { ipcMain.removeAllListeners('app:restart'); global.__restart = 0; ipcMain.on('app:restart', () => global.__restart++); });
  await w.evaluate(() => { window.__LB_TEST_NIGHT_MS = 1; Date.prototype.getHours = () => 23; });
  assert(await waitFor(() => app.evaluate(() => global.__restart > 0), 75000, 2000), 'pas de redémarrage de nuit');
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
