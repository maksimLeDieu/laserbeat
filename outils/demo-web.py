#!/usr/bin/env python3
"""Régénère la démo web de Musique ML à partir du code du logiciel.

La démo reprend telle quelle l'interface du logiciel (src/renderer/index.html), les polices, les images
et les morceaux fournis (musiques/), et remplace seulement le lien avec Windows (fichiers, mises à jour,
touches du clavier) par un petit module « démo web ».

Utilisation :
    python3 outils/demo-web.py                 # crée le dossier dist-demo/
    python3 outils/demo-web.py autre/dossier   # ou dans le dossier indiqué

Le dossier obtenu contient index.html et tous ses fichiers ; il se publie tel quel comme page web.
Rien n'est envoyé nulle part par cet outil.
"""
import json
import os
import re
import shutil
import sys

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SORTIE = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(RACINE, 'dist-demo')


def lire(chemin):
    with open(os.path.join(RACINE, chemin), encoding='utf-8') as f:
        return f.read()


def remplacer(texte, avant, apres, nom):
    """Remplace exactement une fois ; s'arrête si le code du logiciel a changé (la démo resterait fausse)."""
    n = texte.count(avant)
    if n != 1:
        sys.exit(f"demo-web : « {nom} » introuvable ({n} fois) dans l'interface. Mettre à jour outils/demo-web.py.")
    return texte.replace(avant, apres)


def version():
    return json.loads(lire('package.json'))['version']


# Styles propres à la démo : écran étroit (téléphone), boutons d'ajout masqués, badge « Démo web ».
CSS_DEMO = '''
/* ----- Démo web : écran étroit (téléphone) ----- */
@media (max-width:900px){
 .app,.app.rp{--lw:72px}
 .app .libt,.app #bAdd,.app .chips,.app .pli .pm,.app .pli .spk,.app .vline,.app .brand span{display:none}
 .app .side .sh{justify-content:center;padding:14px 0 8px}
 .app.rp .body{grid-template-columns:var(--lw) minmax(0,1fr)}
 .rpanel{display:none!important}
 .status,.search kbd{display:none}
 .search{min-width:0}
 .player{grid-template-columns:minmax(0,1fr) auto;gap:10px}
 .player .tools,.player .prog,#bShuf,#bRep,#bFav{display:none}
 .feat{flex-direction:column;align-items:flex-start}
 .feat .art{width:120px;height:120px}
 .feat h2{font-size:32px}
 .ph{flex-direction:column;align-items:flex-start}
}
@container (max-width:440px){.qgrid{grid-template-columns:minmax(0,1fr)}}
/* ----- Démo web : pas d'ajout de fichiers dans un navigateur ----- */
#bAdd,[data-act="import"]{display:none!important}
.demo-badge{position:fixed;left:50%;transform:translateX(-50%);top:calc(env(safe-area-inset-top,0px) + 4px);z-index:90;font:600 11px var(--font);letter-spacing:.06em;text-transform:uppercase;color:var(--ac2);background:rgba(139,92,246,.14);border:1px solid rgba(139,92,246,.35);padding:3px 10px;border-radius:999px;pointer-events:none}
'''

# Remplace le lien avec Windows (preload.js) : réglages dans le navigateur, morceaux fournis, rien d'autre.
PONT_DEMO = '''<div class="demo-badge">Démo web</div>
<script>
/* Démo web de Musique ML : remplace le lien avec Windows (fichiers, mises à jour, touches du clavier). */
(function(){
 var P='mlweb_',mem={};
 function get(k){try{var v=localStorage.getItem(P+k);return v===null?(k in mem?mem[k]:undefined):JSON.parse(v)}catch(e){return mem[k]}}
 function set(k,v){mem[k]=v;try{localStorage.setItem(P+k,JSON.stringify(v))}catch(e){}}
 window.laserbeat={
  version:%(version)s,
  store:{get:get,set:set},
  tracks:%(tracks)s,
  saveDuration:function(){},
  readAudio:function(){return Promise.resolve(null)},
  onMediaKey:function(){},
  updateReady:null,
  onUpdate:function(){},
  launchUpdateCheck:function(){return Promise.resolve(null)},
  setPlaying:function(){},
  log:function(m){try{console.info('[Musique ML]',m)}catch(e){}}
 };
})();
</script>
'''


def main():
    if os.path.exists(SORTIE):
        shutil.rmtree(SORTIE)
    for d in ('fonts', 'img', 'musiques'):
        os.makedirs(os.path.join(SORTIE, d))

    # polices utilisées par l'interface + images
    for f in os.listdir(os.path.join(RACINE, 'src', 'renderer', 'fonts')):
        if f.startswith('dm-sans-') and f.endswith('.woff2'):
            shutil.copy(os.path.join(RACINE, 'src', 'renderer', 'fonts', f), os.path.join(SORTIE, 'fonts', f))
    for f in os.listdir(os.path.join(RACINE, 'src', 'renderer', 'img')):
        shutil.copy(os.path.join(RACINE, 'src', 'renderer', 'img', f), os.path.join(SORTIE, 'img', f))

    # morceaux fournis : copiés sous des noms simples (morceau-1.mp3, morceau-1.webp...)
    liste = json.loads(lire('musiques/morceaux.json'))
    tracks = []
    for i, e in enumerate(liste, 1):
        src = os.path.join(RACINE, 'musiques', e['fichier'])
        if not os.path.exists(src):
            continue
        ext = os.path.splitext(e['fichier'])[1].lower()
        shutil.copy(src, os.path.join(SORTIE, 'musiques', f'morceau-{i}{ext}'))
        img = ''
        if e.get('photo') and os.path.exists(os.path.join(RACINE, 'musiques', e['photo'])):
            iext = os.path.splitext(e['photo'])[1].lower()
            shutil.copy(os.path.join(RACINE, 'musiques', e['photo']), os.path.join(SORTIE, 'musiques', f'morceau-{i}{iext}'))
            img = f'musiques/morceau-{i}{iext}'
        tracks.append({'id': 'b:' + e['fichier'].lower(), 'title': e['titre'], 'playlist': e.get('playlist', ''),
                       'bpm': e.get('bpm', 0), 'dur': e.get('duree', 0), 'url': f'musiques/morceau-{i}{ext}',
                       'img': img, 'lufs': e.get('lufs'), 'user': False})

    s = lire('src/renderer/index.html')
    # le service de pages ajoute lui-même doctype, <html>, <head> et <body>
    s = re.sub(r'<!DOCTYPE html>\s*<html lang="fr">\s*<head>\s*', '', s)
    s = re.sub(r'<meta charset="utf-8">\s*', '', s)
    s = re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]*>\s*', '', s)
    s = re.sub(r'<meta name="viewport"[^>]*>\s*', '', s)
    s = remplacer(s, '</head>\n<body>\n', '', 'fin de <head>')
    s = remplacer(s, '</body>\n</html>', '', 'fin du document')
    # photos : dans la démo, elles viennent du dossier musiques/ de la page (et non de file:)
    s = remplacer(s, "img:typeof t.img==='string'&&/^file:/.test(t.img)?t.img:''",
                  "img:typeof t.img==='string'&&/^(file:|musiques\\/)/.test(t.img)?t.img:''", 'photos des morceaux')
    s = remplacer(s, '@media (prefers-reduced-motion:reduce)', CSS_DEMO + '@media (prefers-reduced-motion:reduce)', 'styles')
    pont = PONT_DEMO % {'version': json.dumps(version() + ' · démo web'), 'tracks': json.dumps(tracks, ensure_ascii=False)}
    s = remplacer(s, '<script>\n(function(){\n"use strict";', pont + '<script>\n(function(){\n"use strict";', 'script principal')
    if not s.lstrip().startswith('<title>'):
        sys.exit('demo-web : le document doit commencer par <title>.')

    with open(os.path.join(SORTIE, 'index.html'), 'w', encoding='utf-8') as f:
        f.write(s)
    taille = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(SORTIE) for f in fs)
    print(f'Démo web {version()} prête dans {SORTIE} ({len(tracks)} morceaux, {taille / 1048576:.1f} Mo).')


if __name__ == '__main__':
    main()
