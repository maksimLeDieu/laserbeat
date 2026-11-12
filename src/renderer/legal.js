/*
 * Textes légaux de Musique ML (affichés dans l'application et repris dans l'installateur).
 * Une seule source : outils/cgu.js en tire build/CGU.txt (page « Contrat de licence » de l'installateur).
 * Chaque texte : un titre, une date de mise à jour et une suite de blocs ['h', titre] / ['p', paragraphe] / ['l', [liste]].
 */
(function (g) {
  'use strict';
  const EDITEUR = 'Maxime Loret';
  const LICENCIE = 'Didier Floret';
  const MAJ = '12 novembre 2026';

  g.LEGAL = [
    {
      id: 'cgu',
      titre: "Conditions générales d'utilisation",
      maj: MAJ,
      blocs: [
        ['p', `Les présentes conditions générales d'utilisation (« CGU ») encadrent l'utilisation du logiciel Musique ML (anciennement LaserBeat), de ses musiques, de ses images et de ses mises à jour (ensemble, « le Logiciel »). Installer ou utiliser le Logiciel vaut acceptation des présentes CGU.`],
        ['h', '1. Éditeur et titulaire des droits'],
        ['p', `Le Logiciel est édité par ${EDITEUR}, seul titulaire de l'ensemble des droits sur le Logiciel (code, interface, design, logo, images et musiques fournies).`],
        ['h', '2. Licence accordée'],
        ['p', `${EDITEUR} accorde à ${LICENCIE} (« l'Utilisateur »), par sa permission, une licence d'utilisation personnelle, non exclusive, non cessible et gratuite, pour la durée de protection des droits d'auteur, sauf retrait dans les conditions de l'article 9. Cette licence permet :`],
        ['l', [
          "d'installer et d'utiliser le Logiciel sur les ordinateurs des salles de laser game de Trégueux, Quimper et Brest exploitées par l'Utilisateur ;",
          "de diffuser publiquement les musiques fournies avec le Logiciel dans ces salles (parties de laser game, accueil, attente)."
        ]],
        ['p', "Tout autre usage, en particulier dans d'autres établissements, nécessite l'accord écrit préalable de l'éditeur."],
        ['h', '3. Ce qui est interdit'],
        ['p', "Sauf accord écrit de l'éditeur, il est interdit :"],
        ['l', [
          'de vendre, louer, prêter, céder ou distribuer le Logiciel, ses musiques ou ses images, gratuitement ou non ;',
          "de copier, d'extraire ou de réutiliser les musiques ou les images en dehors du Logiciel (vidéos, réseaux sociaux, autres logiciels, supports commerciaux…) ;",
          "de modifier, de décompiler ou de désassembler le Logiciel, ou d'en contourner les protections, sauf dans les cas expressément permis par la loi (article L. 122-6-1 du Code de la propriété intellectuelle) ;",
          "de retirer ou de modifier les mentions de propriété, de droits d'auteur ou de licence."
        ]],
        ['h', '4. Propriété intellectuelle'],
        ['p', `Le Logiciel, son code, son interface, son design, son logo « ML », ses images et les musiques fournies sont des œuvres protégées par le Code de la propriété intellectuelle. Ils sont la propriété exclusive de ${EDITEUR}. La licence de l'article 2 ne transfère aucun droit de propriété. Toute utilisation non autorisée constitue une contrefaçon (articles L. 335-2 et suivants du Code de la propriété intellectuelle).`],
        ['p', "Le Logiciel intègre des composants libres (moteur Electron, Chromium, police DM Sans…), utilisés dans le respect de leurs licences. Ils restent la propriété de leurs auteurs : voir « Licences libres »."],
        ['h', '5. Musiques fournies et diffusion publique'],
        ['p', `Les musiques fournies sont des créations originales réalisées pour ${EDITEUR} et sous sa direction. Elles n'utilisent aucune œuvre d'un autre artiste et ne sont confiées à aucune société de gestion collective (SACEM, SPRE…) : leur diffusion dans les salles autorisées à l'article 2 ne donne lieu à aucune redevance au titre de ces musiques.`],
        ['h', "6. Musiques ajoutées par l'Utilisateur"],
        ['p', "Le Logiciel permet d'ajouter ses propres fichiers audio (playlists « Ambiance accueil », « Mes imports »…). L'Utilisateur est seul responsable de ces fichiers : il doit en détenir les droits et, s'il les diffuse en public, s'acquitter lui-même des droits éventuellement dus (par exemple auprès de la SACEM et de la SPRE pour la musique du commerce). L'éditeur ne contrôle pas ces fichiers et n'en est pas responsable."],
        ['h', '7. Mises à jour automatiques'],
        ['p', "Pour rester à jour, le Logiciel vérifie au lancement, puis toutes les 4 heures, si une nouvelle version est disponible sur le service GitHub, et la télécharge. Elle s'installe au lancement suivant, avant que la musique démarre, ou plus tôt si l'Utilisateur clique sur « Installer la mise à jour ». Une nouvelle version peut modifier, ajouter ou retirer des fonctions, des musiques ou des images. C'est la seule connexion à Internet du Logiciel : la lecture de la musique fonctionne entièrement hors ligne."],
        ['h', '8. Garantie et responsabilité'],
        ['p', "Le Logiciel est fourni gratuitement et « en l'état ». L'éditeur s'efforce d'en assurer le bon fonctionnement et la stabilité, mais ne garantit pas qu'il sera exempt d'erreurs ou d'interruptions, ni qu'il conviendra à un usage particulier. Dans les limites permises par la loi, l'éditeur ne pourra être tenu responsable des dommages indirects (perte d'exploitation, interruption de la musique pendant une partie, perte de données…) liés à l'utilisation ou à l'impossibilité d'utiliser le Logiciel. Rien dans les présentes CGU ne limite les droits que la loi accorde à l'Utilisateur et qui ne peuvent pas être écartés par contrat."],
        ['h', '9. Durée et fin de la licence'],
        ['p', "La licence prend effet à l'installation du Logiciel. L'éditeur peut la retirer en cas de manquement aux présentes CGU, après en avoir informé l'Utilisateur. L'Utilisateur peut y mettre fin à tout moment en désinstallant le Logiciel. À la fin de la licence, l'Utilisateur cesse toute utilisation du Logiciel et de ses musiques et le supprime de ses ordinateurs."],
        ['h', '10. Données personnelles'],
        ['p', "Le Logiciel ne collecte aucune donnée personnelle pour le compte de l'éditeur. Les comptes des salles (nom, identifiant, mot de passe), dès qu'ils seront activés, resteront enregistrés sur l'ordinateur où ils seront créés et ne seront transmis à personne. Les détails figurent dans la page « Données personnelles »."],
        ['p', "L'Utilisateur choisit des mots de passe personnels et ne les communique qu'aux personnes autorisées à utiliser le compte. Il prévient l'éditeur s'il pense qu'un compte a été utilisé sans autorisation."],
        ['h', '11. Modification des CGU'],
        ['p', "L'éditeur peut modifier les présentes CGU, notamment à l'occasion d'une mise à jour. La version en vigueur est toujours consultable dans le Logiciel (Paramètres, rubrique « Informations légales »), avec sa date de mise à jour."],
        ['h', '12. Droit applicable et litiges'],
        ['p', "Les présentes CGU sont soumises au droit français. En cas de difficulté, les parties recherchent d'abord une solution amiable. À défaut, le litige est porté devant les tribunaux compétents selon les règles de droit commun."]
      ]
    },
    {
      id: 'mentions',
      titre: 'Mentions légales',
      maj: MAJ,
      blocs: [
        ['h', 'Éditeur'],
        ['p', `Musique ML est édité par ${EDITEUR}, personne physique, titulaire de l'ensemble des droits sur le Logiciel. Directeur de la publication : ${EDITEUR}.`],
        ['h', 'Utilisateur autorisé'],
        ['p', `${LICENCIE}, pour les salles de laser game de Trégueux, Quimper et Brest, dans les conditions des conditions générales d'utilisation.`],
        ['h', 'Distribution des mises à jour'],
        ['p', 'Les fichiers des mises à jour sont hébergés par GitHub, Inc., 88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, États-Unis (github.com).'],
        ['h', 'Propriété intellectuelle'],
        ['p', `© 2026 ${EDITEUR}. Tous droits réservés. Le code, l'interface, le design, le logo « ML », les images et les musiques fournies sont protégés par le Code de la propriété intellectuelle. Toute reproduction, représentation, diffusion ou adaptation, totale ou partielle, sans l'autorisation écrite de l'éditeur est interdite, sauf dans les cas prévus par les conditions générales d'utilisation ou par la loi.`],
        ['h', 'Musiques et images'],
        ['p', `Musiques : créations originales réalisées pour ${EDITEUR} et sous sa direction. Pochettes et images : créations originales réalisées pour ${EDITEUR}. Aucune œuvre d'un autre artiste n'est utilisée.`],
        ['h', 'Composants libres'],
        ['p', 'Le Logiciel utilise des composants libres sous leurs propres licences : voir « Licences libres » et le fichier THIRD-PARTY-NOTICES.txt installé avec le Logiciel.']
      ]
    },
    {
      id: 'donnees',
      titre: 'Données personnelles',
      maj: MAJ,
      blocs: [
        ['p', "Musique ML est conçu pour fonctionner hors ligne, sans compte en ligne. Il ne collecte, ne transmet et ne vend aucune donnée personnelle pour le compte de l'éditeur. Il ne contient ni publicité, ni mesure d'audience, ni traceur."],
        ['h', 'Les comptes des salles (bientôt disponibles)'],
        ['p', "Les comptes ne sont pas encore activés : aucune de ces informations n'est enregistrée pour le moment. Une fois activés, créer un compte sera facultatif. Il sert à garder les favoris et l'ordre des playlists propres à une salle. Pour chaque compte, le Logiciel enregistre sur l'ordinateur : le nom du compte, l'identifiant de connexion (par exemple lge.b), la date de création et de dernière connexion, et une empreinte du mot de passe. Le mot de passe lui-même n'est jamais enregistré : son empreinte (scrypt, avec un sel aléatoire) ne permet pas de le retrouver."],
        ['p', "Ces informations sont rangées dans un fichier chiffré par Windows pour la session de l'utilisateur (comptes.dat, dans %APPDATA%\\LaserBeat) : copié sur un autre ordinateur, il est illisible. Elles ne quittent jamais l'ordinateur et ne sont transmises à personne, y compris à l'éditeur. Elles sont conservées tant que le compte existe : « Supprimer le compte » (Paramètres) les efface aussitôt."],
        ['p', "Après plusieurs mots de passe faux, le Logiciel impose un délai avant un nouvel essai, pour empêcher de deviner un mot de passe."],
        ['h', 'Ce qui reste sur l\'ordinateur'],
        ['p', "Ces informations sont enregistrées uniquement sur l'ordinateur où le Logiciel est installé, dans le dossier %APPDATA%\\LaserBeat :"],
        ['l', [
          'les réglages : volume, favoris, ordre des morceaux, dernière musique écoutée pour la reprise, préférences d\'affichage et de lecture ;',
          'les comptes des salles, s\'il y en a (voir ci-dessus) ;',
          'les morceaux ajoutés et leur liste (morceaux.json) ;',
          "un journal technique (laserbeat.log) qui aide à comprendre un éventuel problème : il contient des événements du logiciel (démarrage, erreurs de lecture, mises à jour) et aucune donnée personnelle."
        ]],
        ['p', "Ces fichiers ne quittent jamais l'ordinateur. Ils sont conservés à la désinstallation, pour retrouver les réglages en cas de réinstallation, et peuvent être supprimés à tout moment en effaçant ce dossier."],
        ['h', 'La seule connexion : les mises à jour'],
        ['p', "Pour vérifier et télécharger les mises à jour, le Logiciel contacte les serveurs de GitHub (github.com et ses serveurs de téléchargement). Comme pour toute connexion à Internet, GitHub reçoit l'adresse IP de l'ordinateur et la version du système, qu'il traite selon sa propre politique de confidentialité. Aucune autre information n'est envoyée."],
        ['h', 'Vos droits'],
        ['p', "Aucune donnée personnelle n'étant collectée par l'éditeur, il n'existe pas de fichier vous concernant chez lui. Pour toute question, vous pouvez vous adresser à l'éditeur ; vous pouvez aussi saisir la CNIL (cnil.fr)."]
      ]
    },
    {
      id: 'licences',
      titre: 'Licences libres',
      maj: MAJ,
      blocs: [
        ['p', "Musique ML est construit avec des composants libres. Leurs auteurs autorisent leur utilisation, y compris dans un logiciel non libre, à condition de reproduire leurs mentions de licence. Le texte des licences figure dans les fichiers THIRD-PARTY-NOTICES.txt, LICENSE.electron.txt et LICENSES.chromium.html installés avec le Logiciel."],
        ['l', [
          'Electron : © OpenJS Foundation et contributeurs Electron, licence MIT.',
          'Chromium : © The Chromium Authors, licence BSD et licences de ses composants.',
          'Node.js : © OpenJS Foundation et contributeurs Node.js, licence MIT.',
          'electron-updater (mises à jour) : © Loopline Systems et contributeurs electron-builder, licence MIT.',
          'Police DM Sans : © The DM Sans Project Authors, SIL Open Font License 1.1.',
          'Icônes inspirées de Feather : © Cole Bemis, licence MIT.'
        ]],
        ['p', "Ces licences portent uniquement sur les composants cités. Elles ne s'appliquent pas aux musiques, aux images, au logo, au design ni au code propre de Musique ML, qui restent la propriété exclusive de l'éditeur."]
      ]
    }
  ];
})(typeof window !== 'undefined' ? window : globalThis);
