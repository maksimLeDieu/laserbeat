'use strict';
/*
 * Tests de durée et de résistance (longs : ~45 min). Ils ne font pas partie de la publication.
 *   LASERBEAT_ENDURANCE=1 npm test
 * Ils reproduisent des journées de salle en accéléré : des centaines d'enchaînements, des heures de
 * musique jouées plus vite, des clics dans tous les sens, des fichiers abîmés, des réglages corrompus.
 */
module.exports = function ({ test, launch, close, newDataDir, assert, waitFor, playing, title, sleep, logOf, fs, path, tmpRoot, SAMPLE_MP3 }) {
  // état du lecteur principal, vu de la page
  const arena = w => w.evaluate(() => {
    const els = [...document.querySelectorAll('audio:not(.zone2)')];
    const on = els.filter(a => !a.paused && a.getAttribute('src'));
    return { n: els.length, on: on.length, t: on[0] ? on[0].currentTime : 0, tid: on[0] ? on[0].dataset.tid : null };
  });
  const heap = w => w.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize : 0));
  const errLines = dir => logOf(dir).split('\n').filter(l => /Uncaught|TypeError|ReferenceError|RangeError/.test(l));
  // accélère la musique (x speed) sur tous les lecteurs, y compris ceux créés plus tard
  const fast = (w, speed) => w.evaluate(speed => {
    window.__speed = speed;
    if (window.__fastIv) clearInterval(window.__fastIv);
    window.__fastIv = setInterval(() => document.querySelectorAll('audio').forEach(a => { if (a.playbackRate !== window.__speed) a.playbackRate = window.__speed; }), 200);
  }, speed);

  test('Durée : 300 enchaînements avec fondu dans l\'Arène, jamais de silence, mémoire stable', async () => {
    const dir = newDataDir('end-300');
    const { app, w, errors } = await launch(dir);
    await w.click('.pli >> text=LaserBeats'); await w.click('#view .bigplay');
    assert(await waitFor(() => playing(w), 10000), 'pas de lecture');
    await w.waitForTimeout(3000);
    const h0 = await heap(w);
    let last = await title(w), changes = 0, silent = 0;
    for (let k = 0; k < 300; k++) {
      // attendre la fin du fondu précédent : un seul lecteur actif, celui du morceau en cours
      await waitFor(async () => (await arena(w)).on === 1, 8000, 100);
      await w.evaluate(() => {
        const a = [...document.querySelectorAll('audio:not(.zone2)')].find(x => !x.paused);
        if (!a) return;
        const t = window.laserbeat.tracks.find(x => x.id === a.dataset.tid);
        const end = t && t.end > 0 && t.end < a.duration ? t.end : a.duration;
        if (isFinite(end) && a.currentTime < end - 4) a.currentTime = end - 3.5;
      });
      const ok = await waitFor(async () => (await title(w)) !== last, 12000, 150);
      assert(ok, 'enchaînement ' + (k + 1) + ' bloqué sur « ' + last + ' »');
      last = await title(w); changes++;
      const s = await arena(w);
      if (!s.on) silent++;
      assert(s.n <= 2, 'lecteurs audio en trop : ' + s.n);
      if (k % 50 === 49) console.log('        ' + (k + 1) + ' enchaînements, mémoire ' + Math.round((await heap(w)) / 1048576) + ' Mo');
    }
    await w.waitForTimeout(4000);
    assert((await arena(w)).on === 1, 'plus de musique à la fin');
    assert(silent <= 3, 'silences relevés : ' + silent);
    const h1 = await heap(w);
    assert(!h0 || h1 < h0 * 2 + 20e6, 'mémoire en hausse : ' + Math.round(h0 / 1048576) + ' → ' + Math.round(h1 / 1048576) + ' Mo');
    assert(!errors.length, 'erreurs : ' + errors.join(' | '));
    assert(!errLines(dir).length, 'erreurs dans le journal : ' + errLines(dir).slice(0, 3).join(' | '));
    await close(app);
  });

  test('Durée : 3 h de musique jouées en accéléré (x8), fins de morceaux naturelles, Arène et Accueil', async () => {
    const dir = newDataDir('end-3h');
    const { app, w, errors } = await launch(dir);
    await w.click('.pli >> text=Laser Arena'); await w.click('#view .bigplay');
    assert(await waitFor(() => playing(w), 10000), 'pas de lecture');
    await w.click('#bMulti'); await w.click('#zPlay');
    assert(await waitFor(() => w.evaluate(() => [...document.querySelectorAll('audio.zone2')].some(a => !a.paused)), 8000), 'l\'accueil ne joue pas');
    await fast(w, 8);
    const seenA = new Set(), seenZ = new Set();
    const t0 = Date.now(), dur = 22.5 * 60 * 1000; // 22 min 30 réelles x 8 = 3 h
    let stillA = 0, stillZ = 0, lastA = -1, lastZ = -1, k = 0;
    while (Date.now() - t0 < dur) {
      await sleep(5000); k++;
      const s = await w.evaluate(() => {
        const A = [...document.querySelectorAll('audio:not(.zone2)')].find(x => !x.paused && x.getAttribute('src'));
        const Z = [...document.querySelectorAll('audio.zone2')].find(x => !x.paused && x.getAttribute('src'));
        return { a: A ? A.dataset.tid + '@' + A.currentTime.toFixed(1) : null, z: Z ? Z.dataset.tid + '@' + Z.currentTime.toFixed(1) : null, at: A && A.dataset.tid, zt: Z && Z.dataset.tid };
      });
      assert(s.a, 'l\'Arène s\'est arrêtée après ' + Math.round((Date.now() - t0) / 60000 * 8) + ' min de musique');
      assert(s.z, 'l\'Accueil s\'est arrêté après ' + Math.round((Date.now() - t0) / 60000 * 8) + ' min de musique');
      stillA = s.a === lastA ? stillA + 1 : 0; stillZ = s.z === lastZ ? stillZ + 1 : 0;
      assert(stillA < 3 && stillZ < 3, 'lecture figée (' + (stillA >= 3 ? 'Arène' : 'Accueil') + ')');
      lastA = s.a; lastZ = s.z; seenA.add(s.at); seenZ.add(s.zt);
      if (k % 36 === 0) console.log('        ' + Math.round((Date.now() - t0) / 60000 * 8) + ' min de musique, mémoire ' + Math.round((await heap(w)) / 1048576) + ' Mo');
    }
    assert(seenA.size >= 10, 'peu de morceaux différents dans l\'Arène : ' + seenA.size);
    assert(seenZ.size === 2, 'l\'Accueil n\'a pas alterné ses 2 morceaux');
    assert(!errors.length, 'erreurs : ' + errors.join(' | '));
    assert(!errLines(dir).length, 'erreurs dans le journal : ' + errLines(dir).slice(0, 3).join(' | '));
    await close(app);
  });

  test('Résistance : 400 actions au hasard (suivant, précédent, pause, déplacement, aléatoire, Accueil…)', async () => {
    const dir = newDataDir('end-clics');
    const { app, w, errors } = await launch(dir);
    await w.click('.pli >> text=LaserBeats'); await w.click('#view .bigplay');
    assert(await waitFor(() => playing(w), 10000), 'pas de lecture');
    await w.click('#bMulti');
    const acts = ['#bNext', '#bPrev', '#bPlay', '#bShuf', '#zNext', '#zPlay', '#zShuf', 'seek', 'zseek', 'vol', 'fade'];
    let seed = 7; const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let k = 0; k < 400; k++) {
      const a = acts[rnd(acts.length)];
      try {
        if (a === 'seek' || a === 'zseek') {
          const el = await w.$(a === 'seek' ? '#bar' : '#zBar'); const b = el && await el.boundingBox();
          if (b) await w.mouse.click(b.x + b.width * (rnd(100) / 100), b.y + b.height / 2);
        } else if (a === 'vol') {
          await w.$eval('#zVol', (el, v) => { el.value = String(v); el.dispatchEvent(new Event('input')); }, rnd(100) / 100);
        } else if (a === 'fade') {
          await w.evaluate(() => { const x = [...document.querySelectorAll('audio:not(.zone2)')].find(e => !e.paused); if (x && isFinite(x.duration)) x.currentTime = Math.max(0, x.duration - 6); });
        } else await w.click(a, { timeout: 2000 });
      } catch (e) { /* bouton momentanément absent : on continue */ }
      await sleep(30 + rnd(150));
    }
    // remise en état claire : lecture dans les deux zones, puis tout doit jouer normalement
    await sleep(3000);
    const st = await w.evaluate(() => ({
      a: [...document.querySelectorAll('audio:not(.zone2)')].some(x => !x.paused), z: [...document.querySelectorAll('audio.zone2')].some(x => !x.paused),
      n: document.querySelectorAll('audio').length
    }));
    if (!st.a) await w.click('#bPlay');
    if (!st.z) await w.click('#zPlay');
    assert(await waitFor(async () => (await arena(w)).on === 1, 6000, 200), 'l\'Arène ne repart pas après les clics');
    assert(await waitFor(() => w.evaluate(() => [...document.querySelectorAll('audio.zone2')].filter(x => !x.paused).length === 1), 6000, 200), 'l\'Accueil ne repart pas après les clics');
    assert(st.n <= 4, 'lecteurs audio en trop : ' + st.n);
    const t1 = await title(w);
    await w.click('#bNext');
    assert(await waitFor(async () => (await title(w)) !== t1 && (await arena(w)).on === 1, 6000, 200), '« suivant » ne marche plus');
    assert(!errors.length, 'erreurs : ' + errors.join(' | '));
    assert(!errLines(dir).length, 'erreurs dans le journal : ' + errLines(dir).slice(0, 3).join(' | '));
    await close(app);
  });

  test('Résistance : fichiers abîmés ou vides au milieu des morceaux, la musique les saute', async () => {
    const dir = newDataDir('end-abimes');
    const files = [];
    const mk = (name, data) => { const p = path.join(tmpRoot, name); fs.writeFileSync(p, data); files.push(p); };
    const good = fs.readFileSync(SAMPLE_MP3);
    mk('A bon 1.mp3', good);
    mk('B abime.mp3', Buffer.from('ceci n\'est pas de la musique'.repeat(500)));
    mk('C vide.mp3', Buffer.alloc(0));
    mk('D tronque.mp3', good.subarray(0, 4000));
    mk('E bon 2.mp3', good);
    const { app, w, errors } = await launch(dir);
    await app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: f }); }, files);
    await w.click('#n-lib'); await w.click('text=Ajouter mes morceaux');
    assert(await waitFor(async () => (await w.$$('#view .trow:not(.thead) .tn')).length >= 3, 6000), 'morceaux non importés');
    const names = await w.$$eval('#view .trow:not(.thead) .tn', e => e.map(x => x.textContent.trim()));
    console.log('        importés : ' + names.join(', '));
    await w.click('#view .trow:not(.thead) .tn');
    assert(await waitFor(() => playing(w), 10000), 'pas de lecture');
    // on avance morceau par morceau : les fichiers abîmés doivent être sautés, jamais bloquer
    const heard = new Set();
    for (let k = 0; k < 8; k++) {
      const s = await arena(w); if (s.tid) heard.add(s.tid);
      const before = await title(w);
      await w.evaluate(() => { const a = [...document.querySelectorAll('audio:not(.zone2)')].find(x => !x.paused); if (a && isFinite(a.duration)) a.currentTime = a.duration - 1; });
      assert(await waitFor(async () => (await title(w)) !== before || (await arena(w)).tid !== s.tid, 15000, 200), 'bloqué sur « ' + before + ' »');
      assert(await waitFor(async () => (await arena(w)).on === 1, 15000, 200), 'silence après « ' + before + ' »');
    }
    assert(!errors.length, 'erreurs : ' + errors.join(' | '));
    await close(app);
  });

  test('Résistance : réglages et liste des morceaux corrompus au démarrage', async () => {
    for (const [what, write] of [
      ['config.json illisible', d => fs.writeFileSync(path.join(d, 'config.json'), '{"lb_v2": tr')],
      ['config.json vide', d => fs.writeFileSync(path.join(d, 'config.json'), '')],
      ['config.json avec de mauvaises valeurs', d => fs.writeFileSync(path.join(d, 'config.json'), JSON.stringify({ lb_v2: true, lb_vol: 'fort', lb_resume: { pl: 42, id: null, t: -5, playing: 'oui' }, lb_favs: 'aucun', lb_zone2: { pl: null, vol: 9, seen: 'x', sink: 3 }, lb_multi: true, lb_sink: 'casque' }))],
      ['morceaux.json illisible', d => { fs.mkdirSync(path.join(d, 'musiques'), { recursive: true }); fs.writeFileSync(path.join(d, 'musiques', 'morceaux.json'), '[{"fichier": '); }]
    ]) {
      const dir = newDataDir('end-corrompu-' + what.replace(/\W+/g, '-'));
      write(dir);
      const { app, w, errors } = await launch(dir);
      assert(await waitFor(() => w.isVisible('.pli >> text=Laser Arena'), 8000), what + ' : l\'appli ne s\'affiche pas');
      await w.click('.pli >> text=Laser Arena'); await w.click('#view .bigplay');
      assert(await waitFor(() => playing(w), 10000), what + ' : pas de lecture');
      assert(!errors.length, what + ' : erreurs : ' + errors.join(' | '));
      await close(app);
      console.log('        ' + what + ' : OK');
    }
  });

  test('Résistance : sortie son débranchée et rebranchée 30 fois de suite, dans les deux zones', async () => {
    const dir = newDataDir('end-sorties');
    const { app, w, errors } = await launch(dir);
    await w.evaluate(() => {
      window.__outs = [
        { kind: 'audiooutput', deviceId: 'default', groupId: 'g0', label: 'Par défaut' },
        { kind: 'audiooutput', deviceId: 'arene-1', groupId: 'g1', label: 'Ampli arène' },
        { kind: 'audiooutput', deviceId: 'accueil-2', groupId: 'g2', label: 'Enceintes accueil' }];
      navigator.mediaDevices.enumerateDevices = async () => window.__outs;
      HTMLMediaElement.prototype.setSinkId = async function (id) { Object.defineProperty(this, 'sinkId', { value: id, configurable: true }); };
      navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
    });
    await w.waitForTimeout(1500);
    await w.click('.pli >> text=Laser Arena'); await w.click('#view .bigplay');
    await w.click('#bMulti'); await w.click('#bBrand');
    await w.selectOption('select[data-k="sink"]', 'arene-1'); await w.selectOption('select[data-k="zsink"]', 'accueil-2');
    await w.click('#zPlay');
    const both = () => w.evaluate(() => ({
      a: [...document.querySelectorAll('audio:not(.zone2)')].filter(x => !x.paused).length,
      z: [...document.querySelectorAll('audio.zone2')].filter(x => !x.paused).length }));
    assert(await waitFor(async () => { const s = await both(); return s.a === 1 && s.z === 1; }, 8000, 200), 'les deux zones ne jouent pas');
    let seed = 3; const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let k = 0; k < 30; k++) {
      const id = rnd(2) ? 'arene-1' : 'accueil-2';
      await w.evaluate(id => { window.__saved = window.__outs.find(o => o.deviceId === id); window.__outs = window.__outs.filter(o => o.deviceId !== id); navigator.mediaDevices.dispatchEvent(new Event('devicechange')); }, id);
      await sleep(200 + rnd(1500));
      await w.evaluate(() => { if (window.__saved) window.__outs.push(window.__saved); navigator.mediaDevices.dispatchEvent(new Event('devicechange')); });
      await sleep(rnd(1200));
    }
    assert(await waitFor(async () => { const s = await both(); return s.a === 1 && s.z === 1; }, 10000, 300), 'après les débranchements, les deux zones ne rejouent pas : ' + JSON.stringify(await both()));
    const sinks = await w.evaluate(() => [...document.querySelectorAll('audio')].filter(x => !x.paused).map(x => (x.classList.contains('zone2') ? 'z:' : 'a:') + x.sinkId).sort());
    assert(JSON.stringify(sinks) === JSON.stringify(['a:arene-1', 'z:accueil-2']), 'mauvaises sorties : ' + sinks.join(', '));
    assert(!errors.length, 'erreurs : ' + errors.join(' | '));
    await close(app);
  });
};
