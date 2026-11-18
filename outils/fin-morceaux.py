#!/usr/bin/env python3
"""Mesure la fin réelle de la musique de chaque morceau fourni et l'écrit dans musiques/morceaux.json ("fin").

Beaucoup de fichiers se terminent par 2 à 3 secondes de silence. Le fondu enchaîné (3 s) doit partir
de la fin de la MUSIQUE, pas de la fin du FICHIER : sinon il se fait pendant le silence et on entend
un blanc puis le morceau suivant qui monte tout seul.

    python3 outils/fin-morceaux.py        (nécessite ffmpeg ; à relancer après avoir ajouté un morceau)
"""
import json
import os
import re
import subprocess

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOSSIER = os.path.join(RACINE, 'musiques')
SEUIL_DB = -45      # en dessous : silence
MIN_SILENCE = 0.25  # secondes


def fin_musique(chemin):
    out = subprocess.run(['ffmpeg', '-nostats', '-i', chemin, '-af', f'silencedetect=noise={SEUIL_DB}dB:d={MIN_SILENCE}', '-f', 'null', '-'],
                         capture_output=True, text=True).stderr
    duree = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', chemin],
                                 capture_output=True, text=True).stdout.strip())
    debuts = [float(x) for x in re.findall(r'silence_start: ([0-9.]+)', out)]
    fins = [float(x) for x in re.findall(r'silence_end: ([0-9.]+)', out)]
    # le dernier silence compte seulement s'il va jusqu'au bout du fichier
    if debuts and (len(fins) < len(debuts) or fins[-1] >= duree - 0.05):
        return round(min(duree, debuts[-1] + 0.1), 1), round(duree, 1)
    return round(duree, 1), round(duree, 1)


def main():
    p = os.path.join(DOSSIER, 'morceaux.json')
    liste = json.load(open(p, encoding='utf-8'))
    for e in liste:
        fin, duree = fin_musique(os.path.join(DOSSIER, e['fichier']))
        e['fin'] = fin
        print(f"{e['titre']:<20} fichier {duree:5.1f} s   musique {fin:5.1f} s   silence final {duree - fin:.1f} s")
    texte = '[\n' + ',\n'.join('  ' + json.dumps(e, ensure_ascii=False).replace('{"', '{ "').replace('}', ' }') for e in liste) + '\n]\n'
    open(p, 'w', encoding='utf-8').write(texte)


if __name__ == '__main__':
    main()
