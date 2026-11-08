# LaserBeat

Lecteur de musique de bureau pour Windows, 100 % hors ligne, conçu pour le Laser Game Evolution (Saint-Brieuc).
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
| Réglages (volume, favoris, agenda, reprise) | `%APPDATA%\LaserBeat\config.json` |
| Morceaux ajoutés | `%APPDATA%\LaserBeat\musiques\` + `morceaux.json` |
| Journal (en cas de problème) | `%APPDATA%\LaserBeat\laserbeat.log` |

La désinstallation conserve `%APPDATA%\LaserBeat` (vos réglages et vos morceaux).

## Ajouter des morceaux

- **Sans rien recompiler** : dans Bibliothèque, cliquez sur **Ajouter mes morceaux**. Les fichiers sont copiés dans `%APPDATA%\LaserBeat\musiques` et rangés dans « Mes imports ».
  Vous pouvez aussi copier des MP3 directement dans ce dossier. Pour choisir la playlist et le BPM, modifiez `morceaux.json` dans ce même dossier (LaserBeat fermé), puis relancez LaserBeat.
- **Dans le logiciel lui-même** : copiez le MP3 dans `musiques/`, ajoutez une ligne dans `musiques/morceaux.json`, puis lancez `npm run build`.

Format d'une entrée :

```json
{ "titre": "Cible Verrouillée", "fichier": "01-cible-verrouillee.mp3", "playlist": "Tech Zone", "bpm": 144, "duree": 141.5 }
```

Pour `playlist`, mettez `Tech Zone`, `Overdrive`, `LaserBeats`, `Laser Arena`, `Mes imports` ou un nouveau nom (la playlist est alors créée).
Laser Arena contient automatiquement les morceaux de Tech Zone, d'Overdrive et de LaserBeats. Si `duree` vaut 0 ou manque, elle est calculée toute seule.

## Fonctionnement

- Pendant qu'un morceau joue, le suivant est déjà chargé dans un second lecteur. Les morceaux s'enchaînent donc sans blanc.
- Le son continue fenêtre réduite ou cachée, et le PC ne se met pas en veille pendant la lecture.
- Si la lecture se bloque, elle est relancée automatiquement. Si un fichier est illisible, LaserBeat passe au suivant.
- Si la page de l'interface plante, elle est rechargée.
- Si LaserBeat jouait au moment où il a été fermé (ou en cas de coupure de courant), il reprend la musique au prochain lancement.
- LaserBeat ne s'ouvre qu'une fois : si vous le relancez, la fenêtre déjà ouverte revient au premier plan.

## Mise à jour automatique

Depuis la version 1.3.0, LaserBeat se met à jour tout seul à partir des versions publiées sur
GitHub (`maksimLeDieu/laserbeat`, onglet Releases).

- 1 minute après le lancement, puis toutes les 4 heures, LaserBeat regarde s'il existe une nouvelle version.
  Sans Internet, il ne se passe rien : la musique continue normalement.
- La nouvelle version se télécharge en arrière-plan. Un bouton « Installer la mise à jour » apparaît alors
  en bas à gauche : LaserBeat redémarre (environ 20 s) et la musique reprend.
  Sinon, la mise à jour s'installe à la prochaine fermeture de LaserBeat (jamais pendant un arrêt de Windows).
- Réglages, favoris, Agenda, morceaux ajoutés et lancement au démarrage sont conservés.

Publier une nouvelle version : augmenter `version` dans `package.json` et pousser sur `main`.
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
