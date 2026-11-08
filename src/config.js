'use strict';
/*
 * Réglages persistants dans un simple fichier JSON (%APPDATA%\LaserBeat\config.json).
 * Écriture atomique (fichier temporaire puis renommage) + copie de secours,
 * pour survivre à une coupure de courant pendant l'écriture.
 */
const fs = require('fs');

class Config {
  constructor(file, log) {
    this.file = file;
    this.log = log || (() => {});
    this.data = this.read(file) || this.read(file + '.bak') || {};
    this.timer = null;
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
    try {
      fs.writeFileSync(tmp, json);
      try { fs.copyFileSync(this.file, this.file + '.bak'); } catch (e) { /* premier enregistrement */ }
      fs.renameSync(tmp, this.file);
    } catch (e) {
      // Renommage refusé (antivirus...) : écriture directe.
      try { fs.writeFileSync(this.file, json); } catch (e2) { this.log('config non enregistrée', e2.message); }
    }
  }
}

module.exports = { Config };
