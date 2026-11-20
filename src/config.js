'use strict';
/*
 * Réglages persistants dans un simple fichier JSON (%APPDATA%\LaserBeat\config.json).
 * Écriture atomique (fichier temporaire écrit jusqu'au disque, puis renommage) + copie de secours,
 * pour survivre à une coupure de courant pendant l'écriture. La copie de secours (.bak) n'est refaite
 * qu'une fois par lancement, à partir d'un fichier relu et valide : elle est ancienne et sûre.
 */
const fs = require('fs');

class Config {
  constructor(file, log) {
    this.file = file;
    this.log = log || (() => {});
    this.data = this.read(file) || this.read(file + '.bak') || {};
    this.timer = null;
    this.backedUp = false;
  }

  read(f) {
    try {
      const v = JSON.parse(fs.readFileSync(f, 'utf8'));
      return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
    } catch (e) {
      if (e.code !== 'ENOENT') this.log('config illisible', f, e.message);
      return null;
    }
  }

  all() { return this.data; }

  set(key, value) {
    if (value === undefined) delete this.data[key];
    else this.data[key] = value;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 250);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    const json = JSON.stringify(this.data, null, 1);
    const tmp = this.file + '.tmp';
    // copie de secours : une fois par lancement, seulement si le fichier actuel est valide
    if (!this.backedUp) {
      this.backedUp = true;
      if (this.read(this.file)) {
        try { writeSync(this.file + '.bak', fs.readFileSync(this.file)); } catch (e) { this.log('copie de secours impossible', e.message); }
      }
    }
    try {
      writeSync(tmp, json);
      fs.renameSync(tmp, this.file);
    } catch (e) {
      // Renommage refusé (antivirus...) : écriture directe.
      try { writeSync(this.file, json); } catch (e2) { this.log('config non enregistrée', e2.message); }
    }
  }
}

// Écrit le fichier et attend qu'il soit vraiment sur le disque (une coupure juste après ne le perd pas).
function writeSync(file, data) {
  const fd = fs.openSync(file, 'w');
  try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

module.exports = { Config, writeSync };
