/*
 * Fenêtre « Mise à jour » : les nouveautés de chaque version, affichées une fois après la mise à jour
 * et toujours consultables dans Paramètres > À propos > Nouveautés.
 * À chaque nouvelle version : ajouter une entrée EN TÊTE de liste (les tests le vérifient).
 * Phrases courtes, du point de vue de la personne qui utilise l'appli.
 */
(function (g) {
  'use strict';
  g.NOTES = [
    {
      v: '2.13.1', date: '12 novembre 2026',
      items: [
        "Lecture aléatoire corrigée : un morceau ne repasse plus tant que tous les autres de la playlist n'ont pas été joués.",
        "Le tour en cours est gardé en mémoire, même après avoir fermé et relancé Musique ML."
      ]
    },
    {
      v: '2.13.0', date: '12 novembre 2026',
      items: [
        "7 nouveaux morceaux dans Laser Arena : Apex Drift, Nitro Favela, Donk Division, Ghost Lap, Redline, Overtake et Night Raid.",
        "Comme les autres, ils sont joués au même niveau sonore (volume égal)."
      ]
    },
    {
      v: '2.12.0', date: '12 novembre 2026',
      items: [
        "Comptes des salles : dans Paramètres (logo ML), « Se connecter », choisissez Quimper, Brest ou Saint-Brieuc.",
        "À la première connexion sur un PC, vous choisissez le code de la salle. Le PC reste ensuite connecté, même après fermeture.",
        "Chaque salle garde ses propres favoris et l'ordre de ses playlists."
      ]
    },
    {
      v: '2.11.0', date: '12 novembre 2026',
      items: [
        "Pause et reprise en douceur : le son baisse puis remonte progressivement, au lieu de couper net."
      ]
    },
    {
      v: '2.10.0', date: '12 novembre 2026',
      items: [
        "Après chaque mise à jour, cette fenêtre présente les nouveautés de la nouvelle version.",
        "Le logo ML s'affiche dans la barre des tâches de Windows, à la place de la page blanche.",
        "L'historique des nouveautés reste disponible dans Paramètres (logo ML en haut à gauche), rubrique À propos."
      ]
    },
    {
      v: '2.9.0', date: '12 novembre 2026',
      items: [
        "Comptes des salles en préparation : chaque salle pourra bientôt se connecter avec son identifiant et retrouver ses favoris.",
        "Protection renforcée des informations enregistrées sur le PC."
      ]
    },
    {
      v: '2.8.0', date: '10 novembre 2026',
      items: [
        "Mode écran : cliquez sur la bannière du lecteur, en bas, pour afficher la musique en grand. Idéal sur une télé.",
        "Glissez-déposez les morceaux d'une playlist pour changer leur ordre. Le bouton « Ordre d'origine » remet tout comme avant.",
        "Nouvelle page Paramètres, en cliquant sur le logo ML : fondu enchaîné, volume égal, affichage.",
        "Informations légales : conditions d'utilisation, mentions légales, données personnelles."
      ]
    },
    {
      v: '2.7.0', date: '10 novembre 2026',
      items: [
        "Les touches multimédia du clavier (lecture/pause, suivant, précédent) commandent la musique, même appli réduite.",
        "Volume égal : tous les morceaux sont joués au même niveau sonore."
      ]
    },
    {
      v: '2.6.0', date: '9 novembre 2026',
      items: [
        "LaserBeat devient Musique ML, avec un nouveau logo.",
        "Nouvelles pochettes pour les playlists et les morceaux.",
        "Laser Arena pour les parties de laser game, LaserBeats pour toute la musique."
      ]
    }
  ];
})(typeof window !== 'undefined' ? window : globalThis);
