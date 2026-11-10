'use strict';
/*
 * Produit build/CGU.txt (page « Contrat de licence » de l'installateur Windows) à partir des textes
 * légaux de l'application (src/renderer/legal.js) : une seule source pour les deux.
 *   node outils/cgu.js           -> écrit build/CGU.txt
 *   node outils/cgu.js --verifier -> s'arrête en erreur si build/CGU.txt n'est pas à jour
 */
const fs = require('fs');
const path = require('path');
require(path.join(__dirname, '..', 'src', 'renderer', 'legal.js'));

const largeur = 92;
function couper(texte, retrait = '') {
  const mots = texte.split(/\s+/); const lignes = []; let l = retrait;
  for (const m of mots) {
    if ((l + m).length > largeur && l.trim()) { lignes.push(l.trimEnd()); l = retrait.replace(/\S/g, ' ') + m + ' '; }
    else l += m + ' ';
  }
  if (l.trim()) lignes.push(l.trimEnd());
  return lignes.join('\r\n');
}
function texte() {
  const out = ['MUSIQUE ML - CONTRAT DE LICENCE ET CONDITIONS D\'UTILISATION', ''];
  for (const id of ['cgu', 'donnees']) {
    const doc = globalThis.LEGAL.find(d => d.id === id);
    out.push(doc.titre.toUpperCase() + ' (mise à jour : ' + doc.maj + ')', '');
    for (const [type, val] of doc.blocs) {
      if (type === 'h') out.push(val, '');
      else if (type === 'p') out.push(couper(val), '');
      else if (type === 'l') { val.forEach(x => out.push(couper(x, '  - '))); out.push(''); }
    }
    out.push('');
  }
  out.push("Ces textes, les mentions légales et les licences libres sont consultables à tout moment dans Musique ML : Paramètres > Informations légales.");
  return '﻿' + out.join('\r\n') + '\r\n';
}
const cible = path.join(__dirname, '..', 'build', 'CGU.txt');
if (process.argv.includes('--verifier')) {
  const ok = fs.existsSync(cible) && fs.readFileSync(cible, 'utf8') === texte();
  if (!ok) { console.error('build/CGU.txt n\'est pas à jour : lancer « node outils/cgu.js ».'); process.exit(1); }
  console.log('build/CGU.txt est à jour.');
} else {
  fs.writeFileSync(cible, texte());
  console.log('build/CGU.txt écrit.');
}
