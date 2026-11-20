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
      v: '2.19.1', date: '20 novembre 2026',
      items: [
        "Version stable : relecture complète et tests de plusieurs heures. Une trentaine de cas rares sont corrigés.",
        "Réglages, favoris et comptes des salles sont protégés contre une coupure de courant ou un fichier abîmé.",
        "Une mise à jour qui ne s'installe pas ne bloque plus l'écran : la musique continue avec la version actuelle.",
        "Accueil : la musique repart bien après une sortie son débranchée, et les morceaux ajoutés ou supprimés sont pris en compte tout de suite."
      ]
    },
    {
      v: '2.19.0', date: '20 novembre 2026',
      items: [
        "Mac : les mises à jour s'installent maintenant toutes seules, comme sur Windows. Plus besoin de repasser par le site ni par le Terminal.",
        "L'ancienne version est remplacée et le fichier téléchargé est effacé : rien ne s'accumule sur le Mac."
      ]
    },
    {
      v: '2.18.1', date: '19 novembre 2026',
      items: [
        "Multi-écoute : la barre de progression de l'Accueil se clique, comme celle de l'Arène, pour avancer ou reculer dans le morceau.",
        "Le temps écoulé et la durée du morceau de l'Accueil s'affichent de chaque côté de sa barre."
      ]
    },
    {
      v: '2.18.0', date: '19 novembre 2026',
      items: [
        "Musique ML existe aussi pour Mac : il se télécharge sur le site, à côté de la version Windows.",
        "Sur Mac, l'appli prévient quand une nouvelle version existe : le bouton « Télécharger » ouvre le site."
      ]
    },
    {
      v: '2.17.0', date: '19 novembre 2026',
      items: [
        "Multi-écoute : le bouton « Multi-écoute », en haut, ajoute une deuxième écoute, l'Accueil, en plus de l'Arène. Les deux jouent en même temps.",
        "Chaque zone a sa playlist, son volume et sa sortie son (Paramètres › Lecture). L'Accueil se pilote depuis sa barre, juste au-dessus du lecteur.",
        "Clic droit sur un morceau : « Lire dans l'accueil ». Les touches du clavier et le mode écran restent sur l'Arène."
      ]
    },
    {
      v: '2.16.0', date: '19 novembre 2026',
      items: [
        "Sortie son : dans Paramètres (logo ML), rubrique Lecture, choisissez où sort la musique (prise casque, HDMI, enceintes USB…).",
        "Si la sortie choisie est débranchée, la musique se met en pause au lieu de partir sur d'autres enceintes, et reprend toute seule quand elle est rebranchée."
      ]
    },
    {
      v: '2.15.0', date: '19 novembre 2026',
      items: [
        "Ambiance accueil : 2 musiques fournies, Ambiance Pop et Ambiance Pop II. Une pop douce pour l'accueil, à part de la musique des parties.",
        "Fondu enchaîné corrigé : les deux morceaux se mélangent vraiment pendant 3 secondes. Avant, le fondu se faisait pendant le silence à la fin des fichiers, d'où un blanc entre deux morceaux.",
        "Le silence à la fin des morceaux est maintenant sauté, même quand le fondu est désactivé."
      ]
    },
    {
      v: '2.14.0', date: '12 novembre 2026',
      items: [
        "Lire ensuite : clic droit sur un morceau, puis « Lire ensuite ». Il passe juste après celui en cours, puis la lecture reprend normalement.",
        "Mise à jour à la demande : dans Paramètres (logo ML), tout en bas, « Rechercher une mise à jour », puis « Installer maintenant ». Plus besoin de relancer Musique ML pour vérifier."
      ]
    },
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
