'use strict';
/*
 * Comptes des salles (Brest, Quimper, Trégueux…), enregistrés uniquement sur ce PC.
 *
 * Protection :
 * - le mot de passe n'est jamais enregistré : seule une empreinte scrypt salée l'est (impossible à inverser) ;
 * - le fichier des comptes (comptes.dat) est chiffré par Windows pour l'utilisateur de la session
 *   (safeStorage / DPAPI) : copié sur un autre PC ou une autre session, il est illisible ;
 * - après 5 mots de passe faux, il faut attendre (30 s, puis de plus en plus longtemps) ;
 * - la page n'a accès qu'aux données du compte connecté, jamais à celles des autres comptes.
 * Rien n'est envoyé sur Internet.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 32;
const PROFILE_KEYS = ['favs', 'order', 'recent'];   // ce qui est propre à chaque compte
const LOGIN_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/;   // identifiant : ex. lge.b (2 à 32 caractères)

function scrypt(password, salt) {
  return new Promise((res, rej) => crypto.scrypt(password, salt, KEYLEN, SCRYPT, (err, key) => (err ? rej(err) : res(key))));
}

class Accounts {
  constructor(dir, { safeStorage, log } = {}) {
    this.file = path.join(dir, 'comptes.dat');
    this.safe = safeStorage && safeStorage.isEncryptionAvailable() ? safeStorage : null;
    this.log = log || (() => {});
    this.fails = new Map();     // identifiant -> { n, until }
    this.data = this.load();
    if (!this.safe) this.log('comptes : chiffrement Windows indisponible, fichier protégé par empreintes seulement');
  }

  /* ----- fichier ----- */
  load() {
    const empty = { v: 1, accounts: [], profiles: {}, session: null };
    for (const f of [this.file, this.file + '.bak']) {
      try {
        const raw = fs.readFileSync(f);
        const text = raw.subarray(0, 4).toString() === 'MLC1' ? this.decrypt(raw.subarray(4)) : raw.toString('utf8');
        const d = JSON.parse(text);
        if (d && Array.isArray(d.accounts)) return Object.assign(empty, d);
      } catch (e) { if (e.code !== 'ENOENT') this.log('comptes illisibles', f, e.message); }
    }
    return empty;
  }
  decrypt(buf) {
    if (!this.safe) throw new Error('fichier chiffré mais chiffrement indisponible');
    return this.safe.decryptString(buf);
  }
  save() {
    const json = JSON.stringify(this.data);
    const out = this.safe ? Buffer.concat([Buffer.from('MLC1'), this.safe.encryptString(json)]) : Buffer.from(json, 'utf8');
    const tmp = this.file + '.tmp';
    try {
      fs.writeFileSync(tmp, out, { mode: 0o600 });
      try { fs.copyFileSync(this.file, this.file + '.bak'); } catch (e) { /* premier enregistrement */ }
      fs.renameSync(tmp, this.file);
    } catch (e) {
      try { fs.writeFileSync(this.file, out, { mode: 0o600 }); } catch (e2) { this.log('comptes non enregistrés', e2.message); }
    }
  }

  /* ----- vues sûres pour la page ----- */
  pub(a) { return a ? { id: a.id, name: a.name, login: a.login } : null; }
  list() { return this.data.accounts.map(a => this.pub(a)); }
  current() { return this.pub(this.data.accounts.find(a => a.id === this.data.session)); }
  profile() {
    const id = this.data.session;
    if (!id) return null;
    const p = this.data.profiles[id] || {};
    const out = {}; PROFILE_KEYS.forEach(k => { if (p[k] !== undefined) out[k] = p[k]; });
    return out;
  }
  setProfile(key, value) {
    const id = this.data.session;
    if (!id || !PROFILE_KEYS.includes(key)) return false;
    let size = 0; try { size = JSON.stringify(value).length; } catch (e) { return false; }
    if (size > 512 * 1024) return false;
    (this.data.profiles[id] = this.data.profiles[id] || {})[key] = value;
    this.saveSoon();
    return true;
  }
  saveSoon() { clearTimeout(this.t); this.t = setTimeout(() => this.save(), 300); }
  flush() { if (this.t) { clearTimeout(this.t); this.t = null; this.save(); } }

  /* ----- actions ----- */
  check(name, login, password) {
    name = String(name || '').trim().slice(0, 40);
    login = String(login || '').trim().toLowerCase();
    if (!name) return { error: 'Indiquez le nom du compte (par exemple Brest).' };
    if (!LOGIN_RE.test(login)) return { error: 'Identifiant invalide : 2 à 32 caractères, lettres, chiffres, point, tiret ou tiret bas (par exemple lge.b).' };
    if (typeof password !== 'string' || password.length < 8) return { error: 'Le mot de passe doit faire au moins 8 caractères.' };
    if (password.length > 200) return { error: 'Mot de passe trop long.' };
    return { name, login };
  }
  async create(name, login, password, initial) {
    const c = this.check(name, login, password);
    if (c.error) return { ok: false, error: c.error };
    if (this.data.accounts.length >= 50) return { ok: false, error: 'Nombre maximal de comptes atteint.' };
    if (this.data.accounts.some(a => a.login === c.login)) return { ok: false, error: 'Cet identifiant est déjà utilisé.' };
    const salt = crypto.randomBytes(16);
    const hash = await scrypt(password, salt);
    const id = crypto.randomBytes(8).toString('hex');
    this.data.accounts.push({ id, name: c.name, login: c.login, salt: salt.toString('base64'), hash: hash.toString('base64'), created: new Date().toISOString() });
    const prof = {};
    if (initial && typeof initial === 'object') PROFILE_KEYS.forEach(k => { if (initial[k] !== undefined) prof[k] = initial[k]; });
    this.data.profiles[id] = prof;
    this.data.session = id;
    this.save();
    this.log('compte créé', c.name);
    return { ok: true, account: this.current(), profile: this.profile() };
  }
  wait(login) {
    const f = this.fails.get(login);
    return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0;
  }
  async verify(a, password) {
    if (!a || typeof password !== 'string') { await scrypt('x', Buffer.alloc(16)); return false; } // même durée, compte connu ou non
    const key = await scrypt(password, Buffer.from(a.salt, 'base64'));
    const ref = Buffer.from(a.hash, 'base64');
    return key.length === ref.length && crypto.timingSafeEqual(key, ref);
  }
  async login(login, password) {
    login = String(login || '').trim().toLowerCase();
    const w = this.wait(login);
    if (w) return { ok: false, error: `Trop d'essais. Réessayez dans ${w} s.` };
    const a = this.data.accounts.find(x => x.login === login);
    if (!(await this.verify(a, password))) {
      const f = this.fails.get(login) || { n: 0, until: 0 };
      f.n++; if (f.n >= 5) f.until = Date.now() + Math.min(15 * 60, 30 * 2 ** (f.n - 5)) * 1000;
      this.fails.set(login, f);
      this.log('connexion refusée');
      return { ok: false, error: 'Identifiant ou mot de passe incorrect.' };
    }
    this.fails.delete(login);
    this.data.session = a.id; a.last = new Date().toISOString();
    this.save();
    this.log('connexion', a.name);
    return { ok: true, account: this.current(), profile: this.profile() };
  }
  logout() { this.flush(); this.data.session = null; this.save(); return { ok: true }; }
  async changePassword(oldPw, newPw) {
    const a = this.data.accounts.find(x => x.id === this.data.session);
    if (!a) return { ok: false, error: 'Aucun compte connecté.' };
    if (!(await this.verify(a, oldPw))) return { ok: false, error: 'Mot de passe actuel incorrect.' };
    if (typeof newPw !== 'string' || newPw.length < 8 || newPw.length > 200) return { ok: false, error: 'Le nouveau mot de passe doit faire au moins 8 caractères.' };
    const salt = crypto.randomBytes(16);
    a.salt = salt.toString('base64'); a.hash = (await scrypt(newPw, salt)).toString('base64');
    this.save();
    return { ok: true };
  }
  async remove(password) {
    const a = this.data.accounts.find(x => x.id === this.data.session);
    if (!a) return { ok: false, error: 'Aucun compte connecté.' };
    if (!(await this.verify(a, password))) return { ok: false, error: 'Mot de passe incorrect.' };
    this.data.accounts = this.data.accounts.filter(x => x.id !== a.id);
    delete this.data.profiles[a.id];
    this.data.session = null;
    this.save();
    this.log('compte supprimé', a.name);
    return { ok: true };
  }
}

module.exports = { Accounts, PROFILE_KEYS };
