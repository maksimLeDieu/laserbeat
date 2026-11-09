'use strict';
/*
 * Bibliothèque de morceaux.
 *
 * Deux dossiers sont lus, chacun avec un fichier morceaux.json facultatif :
 *  - les morceaux fournis avec le logiciel (resources\musiques, en lecture seule) ;
 *  - les morceaux de l'utilisateur (%APPDATA%\LaserBeat\musiques), remplis par le bouton
 *    « Ajouter mes morceaux » ou à la main.
 *
 * Format d'une entrée de morceaux.json :
 *   { "titre": "Cible Verrouillée", "fichier": "01-cible-verrouillee.mp3",
 *     "playlist": "Tech Zone", "bpm": 144, "duree": 141.5 }
 * Un fichier audio présent dans le dossier mais absent du JSON est quand même ajouté
 * (titre = nom du fichier). Une entrée dont le fichier n'existe pas est ignorée.
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const AUDIO_EXT = ['.mp3', '.wav', '.m4a', '.ogg', '.flac', '.aac'];
const LIST = 'morceaux.json';
const DEFAULT_PLAYLIST = 'Mes imports';

const isAudio = f => AUDIO_EXT.includes(path.extname(f).toLowerCase());
const num = v => { const n = Number(v); return isFinite(n) && n > 0 ? n : 0; };
const keyOf = f => String(f).replace(/\\/g, '/').toLowerCase();

function readList(dir) {
  const file = path.join(dir, LIST);
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { return { list: [], ok: e.code === 'ENOENT' }; }
  try {
    const v = JSON.parse(raw.replace(/^﻿/, ''));
    const list = Array.isArray(v) ? v : (v && Array.isArray(v.morceaux) ? v.morceaux : []);
    return { list: list.filter(e => e && typeof e === 'object'), ok: true };
  } catch (e) {
    return { list: [], ok: false, error: e.message };
  }
}

function writeList(dir, list) {
  const file = path.join(dir, LIST);
  const tmp = file + '.tmp';
  const json = JSON.stringify(list, null, 2) + '\n';
  try { fs.writeFileSync(tmp, json); fs.renameSync(tmp, file); } catch (e) { fs.writeFileSync(file, json); }
}

function makeTrack(origin, dir, file, e) {
  return {
    id: origin + ':' + keyOf(file),
    file,
    title: String(e.titre || e.title || '').trim() || path.basename(file, path.extname(file)),
    playlist: String(e.playlist || '').trim(),
    bpm: Math.round(num(e.bpm)),
    dur: num(e.duree !== undefined ? e.duree : e.dur),
    url: pathToFileURL(path.join(dir, file)).href,
    user: origin === 'u'
  };
}

// Fichiers supprimés que Windows n'a pas laissé effacer tout de suite (fichier encore ouvert) :
// ils restent cachés et on retente l'effacement au lancement suivant.
const PENDING = '.a-supprimer.json';
function readPending(dir) {
  try { const v = JSON.parse(fs.readFileSync(path.join(dir, PENDING), 'utf8')); return Array.isArray(v) ? v.map(String) : []; } catch (e) { return []; }
}
function writePending(dir, list) {
  const f = path.join(dir, PENDING);
  try { if (list.length) fs.writeFileSync(f, JSON.stringify(list)); else fs.rmSync(f, { force: true }); } catch (e) { /* ignore */ }
}
function retryPending(dir) {
  const left = readPending(dir).filter(name => {
    try { fs.rmSync(path.join(dir, name), { force: true }); return false; } catch (e) { return true; }
  });
  writePending(dir, left);
}

function loadDir(dir, origin) {
  const root = path.resolve(dir);
  const out = [];
  const seen = new Set(origin === 'u' ? readPending(dir).map(keyOf) : []);
  for (const e of readList(dir).list) {
    const f = String(e.fichier || e.file || '').trim();
    if (!f || !isAudio(f)) continue;
    const full = path.resolve(root, f);
    if (!full.startsWith(root + path.sep) || !fs.existsSync(full)) continue;
    if (seen.has(keyOf(f))) continue;
    seen.add(keyOf(f));
    out.push(makeTrack(origin, dir, f, e));
  }
  let files = [];
  try { files = fs.readdirSync(dir); } catch (e) { /* dossier absent */ }
  files.filter(isAudio).sort((a, b) => a.localeCompare(b, 'fr')).forEach(f => {
    if (seen.has(keyOf(f))) return;
    seen.add(keyOf(f));
    out.push(makeTrack(origin, dir, f, {}));
  });
  return out;
}

const README = `LaserBeat - vos morceaux
========================

Ce dossier contient les morceaux ajoutés avec le bouton « Ajouter mes morceaux »
(Bibliothèque). Vous pouvez aussi y copier directement des fichiers MP3 :
ils apparaissent au prochain lancement de LaserBeat.

Le fichier morceaux.json décrit chaque morceau (modifiable avec le Bloc-notes) :

  {
    "titre": "Mon morceau",
    "fichier": "mon-morceau.mp3",
    "playlist": "Tech Zone",
    "bpm": 150,
    "duree": 0
  }

- "playlist" : Laser Arena, Tech Zone, Overdrive, LaserBeats, Mes imports, ou un nouveau nom
  (une nouvelle playlist est alors créée).
- "duree" en secondes (0 = calculée automatiquement).
Fermez LaserBeat avant de modifier ce fichier, puis relancez-le.
`;

function ensureUserDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const list = path.join(dir, LIST);
  if (!fs.existsSync(list)) writeList(dir, []);
  const readme = path.join(dir, 'LISEZ-MOI.txt');
  if (!fs.existsSync(readme)) fs.writeFileSync(readme, '﻿' + README.replace(/\n/g, '\r\n'));
}

function loadAll(dirs) {
  try { ensureUserDir(dirs.user); } catch (e) { /* lecture seule quand même */ }
  try { retryPending(dirs.user); } catch (e) { /* ignore */ }
  return loadDir(dirs.builtin, 'b').concat(loadDir(dirs.user, 'u'));
}

// Liste utilisateur modifiable ; si le JSON est abîmé, on le met de côté plutôt que de l'écraser.
function editableList(dir) {
  const r = readList(dir);
  if (!r.ok) {
    try { fs.renameSync(path.join(dir, LIST), path.join(dir, LIST + '.erreur-' + Date.now())); } catch (e) { /* ignore */ }
  }
  return r.ok ? r.list : [];
}

function uniqueName(dir, base) {
  const ext = path.extname(base), stem = path.basename(base, ext);
  for (let i = 2; ; i++) {
    const n = `${stem} (${i})${ext}`;
    if (!fs.existsSync(path.join(dir, n))) return n;
  }
}

function importFiles(dir, paths, playlist) {
  ensureUserDir(dir);
  const list = editableList(dir);
  const listed = new Set(list.map(e => keyOf(e.fichier || e.file || '')));
  const added = [];
  for (const src of paths) {
    if (!isAudio(src)) continue;
    let name = path.basename(src);
    const dest = path.join(dir, name);
    if (path.resolve(src).toLowerCase() !== path.resolve(dest).toLowerCase()) {
      if (fs.existsSync(dest)) {
        // Même fichier déjà importé (même taille) : on ne le recopie pas.
        if (fs.statSync(dest).size !== fs.statSync(src).size) {
          name = uniqueName(dir, name);
          fs.copyFileSync(src, path.join(dir, name));
        }
      } else {
        fs.copyFileSync(src, dest);
      }
    }
    if (!listed.has(keyOf(name))) {
      list.push({ titre: path.basename(name, path.extname(name)), fichier: name, playlist: String(playlist || '').trim() || DEFAULT_PLAYLIST, bpm: 0, duree: 0 });
      listed.add(keyOf(name));
    }
    added.push('u:' + keyOf(name));
  }
  writeList(dir, list);
  const all = loadDir(dir, 'u');
  return all.filter(t => added.includes(t.id));
}

// Durée calculée par l'interface pour un morceau de l'utilisateur : on la note dans morceaux.json.
function saveDuration(dir, id, dur) {
  if (typeof id !== 'string' || !id.startsWith('u:')) return;
  dur = Math.round(num(dur) * 10) / 10;
  if (!dur) return;
  const key = id.slice(2);
  const list = editableList(dir);
  const e = list.find(x => keyOf(x.fichier || x.file || '') === key);
  if (e) {
    if (num(e.duree)) return;
    e.duree = dur;
  } else {
    const f = (fs.readdirSync(dir).find(n => keyOf(n) === key));
    if (!f) return;
    list.push({ titre: path.basename(f, path.extname(f)), fichier: f, playlist: DEFAULT_PLAYLIST, bpm: 0, duree: dur });
  }
  writeList(dir, list);
}

// Supprime un morceau ajouté par l'utilisateur (jamais un morceau fourni avec le logiciel).
function deleteTrack(dir, id) {
  if (typeof id !== 'string' || !id.startsWith('u:')) return false;
  const key = id.slice(2);
  const list = editableList(dir);
  const kept = list.filter(x => keyOf(x.fichier || x.file || '') !== key);
  let name = null;
  try { name = fs.readdirSync(dir).find(n => keyOf(n) === key) || null; } catch (e) { /* dossier absent */ }
  if (kept.length !== list.length) writeList(dir, kept);
  if (name) {
    try { fs.rmSync(path.join(dir, name)); } catch (e) {
      // Fichier encore verrouillé : masqué maintenant, effacé au prochain lancement.
      const p = readPending(dir); if (!p.includes(name)) p.push(name); writePending(dir, p);
    }
  }
  return true;
}

module.exports = { AUDIO_EXT, loadAll, importFiles, saveDuration, deleteTrack };
