# Musique ML

> Nom affiché : **Musique ML** (logo « ML » violet et noir). Le nom technique interne reste `LaserBeat` (fichiers, dossier `%APPDATA%\LaserBeat`, installateur `LaserBeat-Setup.exe`) pour que les mises à jour et les réglages déjà en place continuent de fonctionner.

Lecteur de musique de bureau pour Windows, 100 % hors ligne, conçu pour les salles de laser game de Trégueux, Quimper et Brest.
Electron 44 + electron-builder (installateur NSIS x64). L'interface est un fichier local : aucun navigateur, aucun serveur, aucun port réseau.

## Commandes

```bash
npm install        # installe Electron et electron-builder
npm run start      # lance LaserBeat en mode développement
npm run build      # crée dist/LaserBeat-Setup.exe
```

`npm run build` se lance de préférence sur un PC Windows. Depuis Linux, il faut Wine 64 et 32 bits (`wine64` et `wine32:i386`).

## Installation et avertissement Windows (SmartScreen)

Double-cliquez sur `LaserBeat-Setup.exe`. L'installateur n'est pas signé, donc Windows peut afficher « Windows a protégé votre ordinateur ».
Cliquez sur **Informations complémentaires** puis sur **Exécuter quand même**.

L'installateur crée les icônes sur le Bureau et dans le menu Démarrer. La page « Options » propose **Lancer LaserBeat au démarrage de Windows** (case décochée par défaut).
L'installation se fait pour l'utilisateur courant dans `%LOCALAPPDATA%\Programs\LaserBeat`, sans droits administrateur.

## Où sont les données

| Quoi | Où |
|---|---|
| Morceaux fournis | `musiques/` du projet (copiés dans `resources\musiques` à l'installation) |
| Réglages (volume, favoris, reprise) | `%APPDATA%\LaserBeat\config.json` |
| Morceaux ajoutés | `%APPDATA%\LaserBeat\musiques\` + `morceaux.json` |
| Journal (en cas de problème) | `%APPDATA%\LaserBeat\laserbeat.log` |

La désinstallation conserve `%APPDATA%\LaserBeat` (vos réglages et vos morceaux).

## Ajouter des morceaux

- **Sans rien recompiler** : dans Bibliothèque, cliquez sur **Ajouter mes morceaux**. Les fichiers sont copiés dans `%APPDATA%\LaserBeat\musiques` et rangés dans « Mes imports ».
  Pour retirer un morceau importé, survolez sa ligne et cliquez sur la corbeille (les morceaux fournis avec le logiciel ne peuvent pas être supprimés).
  Vous pouvez aussi copier des MP3 directement dans ce dossier. Pour choisir la playlist et le BPM, modifiez `morceaux.json` dans ce même dossier (LaserBeat fermé), puis relancez LaserBeat.
- **Dans le logiciel lui-même** : copiez le MP3 dans `musiques/`, ajoutez une ligne dans `musiques/morceaux.json`, puis lancez `npm run build`.

Format d'une entrée :

```json
{ "titre": "Phonk Laser Game", "fichier": "LaserBeat 1 - Phonk Laser Game.mp3", "playlist": "Laser Arena", "bpm": 145, "duree": 80.5, "photo": "LaserBeat 1 - Phonk Laser Game.webp" }
```

`photo` (facultatif) : image du morceau (jpg, png ou webp, carrée de préférence) placée dans le même dossier ; sans photo, le morceau prend les couleurs de sa playlist.

Pour `playlist`, mettez `Laser Arena` (musique des parties de laser game), `Ambiance accueil`, `Mes imports` ou un nouveau nom (la playlist est alors créée).
LaserBeats réunit automatiquement toute la musique du logiciel. « Jouer la musique » lance Laser Arena. Si `duree` vaut 0 ou manque, elle est calculée toute seule.

## Fonctionnement

- Pages : Accueil, Tous les morceaux, **Ambiance accueil** (musiques de l'accueil, séparées du laser game,
  ajoutées avec « Ajouter des morceaux »), Bibliothèque, playlists et favoris. Le bouton ⓘ en haut à droite
  affiche l'auteur, la propriété et l'utilisation autorisée du logiciel.
- En fin de playlist, la musique repart au début (répétition de la playlist activée par défaut).

- Pendant qu'un morceau joue, le suivant est déjà chargé dans un second lecteur. Les 3 dernières secondes, un fondu
  enchaîné fait monter le suivant pendant que le premier descend : jamais de blanc ni de coupure sèche.
- Le son continue fenêtre réduite ou cachée, et le PC ne se met pas en veille pendant la lecture.
- Si la lecture se bloque, elle est relancée automatiquement. Si un fichier est illisible, LaserBeat passe au suivant.
- Si la page de l'interface plante, elle est rechargée.
- Si LaserBeat jouait au moment où il a été fermé (ou en cas de coupure de courant), il reprend la musique au prochain lancement.
- LaserBeat ne s'ouvre qu'une fois : si vous le relancez, la fenêtre déjà ouverte revient au premier plan.

## Réglages conseillés sur le PC du laser game (à faire une fois)

1. **Lancement au démarrage** : relancer l'installateur et cocher « Lancer LaserBeat au démarrage de Windows »
   (après une coupure de courant ou un redémarrage de Windows, la musique repart toute seule).
2. **Veille** : Paramètres › Système › Alimentation › « Mettre en veille » sur **Jamais** (secteur).
3. **Windows Update** : Paramètres › Windows Update › Options avancées › **Heures d'activité** = vos horaires
   d'ouverture (Windows ne redémarrera pas pendant les parties).
4. **Sortie audio** : clic droit sur l'icône du son › Paramètres audio › choisir l'ampli / les enceintes comme
   périphérique de sortie par défaut.
5. **Notifications** : Paramètres › Système › Notifications › activer « Ne pas déranger » (pas de sons Windows
   par-dessus la musique).

La croix de la fenêtre propose « Réduire » (la musique continue) ou « Quitter » : un clic par erreur ne coupe
plus la musique.

## Mise à jour automatique

Depuis la version 1.3.0, LaserBeat se met à jour tout seul à partir des versions publiées sur
GitHub (`maksimLeDieu/laserbeat`, onglet Releases).

- **Au lancement**, avant de démarrer la musique, LaserBeat regarde s'il a une mise à jour prête (6 s au plus).
  Si oui : écran « Mise à jour » avec barre de progression, installation, redémarrage, écran « Mise à jour
  installée », puis la musique démarre. Sinon (ou sans Internet), la musique démarre normalement.
- **Pendant l'utilisation**, les nouvelles versions sont seulement téléchargées en arrière-plan (toutes les 4 h),
  sans couper la musique : elles s'installeront au lancement suivant. Le bouton « Installer la mise à jour »
  (en bas à gauche) permet aussi de l'installer tout de suite. Jamais pendant une pause ni un arrêt de Windows.
- Sécurité : après 2 tentatives ratées pour une même version, LaserBeat ne réessaie plus au lancement.
- Réglages, favoris, morceaux ajoutés et lancement au démarrage sont conservés.

- **Quoi de neuf** : juste après l'écran « Mise à jour installée », une fenêtre présente une seule fois les
  nouveautés arrivées depuis la version d'avant. L'historique complet reste dans Paramètres › À propos › Nouveautés.

Publier une nouvelle version : augmenter `version` dans `package.json`, ajouter **en tête** de
`src/renderer/notes.js` les nouveautés de cette version (les tests le vérifient), et pousser sur `main`.
Le workflow GitHub Actions `.github/workflows/publier.yml` compile alors l'installateur sur Windows
et crée la Release `v<version>` (`LaserBeat-Setup.exe`, `.blockmap`, `latest.yml`).
On peut aussi le lancer à la main : onglet Actions › Publier une version › Run workflow.

## Structure

```
src/main.js            processus principal : fenêtre, instance unique, anti-veille, reprise après plantage
src/preload.js         pont sécurisé entre l'interface et le processus principal
src/config.js          réglages dans config.json (écriture atomique + copie de secours)
src/library.js         lecture de morceaux.json, ajout de morceaux
src/updater.js         mise à jour automatique (GitHub Releases)
src/renderer/index.html  l'interface validée (même design), adaptée au logiciel
build/installer.nsh    page « Options » de l'installateur (lancement au démarrage)
musiques/              les MP3 fournis + morceaux.json
```

## Démo web (aperçu avant de modifier le logiciel)

Les changements d'interface s'essaient d'abord dans une démo web, avant d'être ajoutés au logiciel Windows.
La démo est générée à partir du code du logiciel (même interface, mêmes morceaux, mêmes images) :

```
npm run demo        # ou : python3 outils/demo-web.py
```

Le dossier `dist-demo/` obtenu contient `index.html` et tous ses fichiers, prêts à être publiés comme page web.
Dans la démo, seul le lien avec Windows est remplacé : pas d'ajout ni de suppression de morceaux, pas de
touches multimédia, pas de mise à jour automatique ni de reprise au démarrage. Les réglages (volume, favoris)
restent dans le navigateur. Si l'interface change au point que l'outil ne s'y retrouve plus, il s'arrête avec
un message plutôt que de produire une démo fausse.

## Sécurité

- Page isolée : `contextIsolation`, `sandbox`, aucun accès à Node.js depuis l'interface, pont minimal (`src/preload.js`).
- Chaque échange avec le processus principal est refusé s'il ne vient pas de la page de Musique ML ; réglages limités aux clés `lb_…` et à 2 Mo.
- Aucune autorisation (caméra, micro, position, notifications, périphériques) : seul le plein écran est permis.
- La page ne peut joindre aucun site Internet ni ouvrir de fenêtre, de cadre ou de page externe ; seule la mise à jour (processus principal) contacte GitHub.
- Politique de sécurité du contenu stricte (`default-src 'none'`, pas de `<base>`, pas d'envoi de formulaire).
- Fusibles Electron : exécution en mode Node désactivée, `NODE_OPTIONS` ignoré, application chargée uniquement depuis `app.asar`.
- Tests automatiques dédiés (micro, accès Internet, cadres, pont).

## Informations légales

Les CGU, mentions légales, la page « Données personnelles » et les licences libres sont dans `src/renderer/legal.js`
(affichées dans Paramètres > Informations légales). L'installateur affiche les CGU à accepter (`build/CGU.txt`),
produit à partir de ce même fichier : `node outils/cgu.js` (les tests vérifient qu'il est à jour).

