# Sécurité, conformité et limites

Ce document dit ce que le logiciel garantit, ce qu'il ne garantit pas et ce qu'il reste à décider. Les mentions « Interprétation » signalent une analyse et non un fait établi par un texte.

## 1. Mesures mises en œuvre

| Exigence | Mise en œuvre | Référence |
|---|---|---|
| Double authentification pour tout accès | TOTP (RFC 6238), obligatoire avant tout accès aux dossiers ; 10 codes de secours à usage unique ; un même code ne peut pas servir deux fois | Règlement intérieur, art. 40 et 56.1 ; RFC 6238 |
| Comptes nominatifs, pas de compte partagé | Un compte par adresse ; l'administrateur ne connaît jamais le mot de passe (lien d'activation) | Art. 40 |
| Mots de passe | 12 caractères minimum avec majuscule, minuscule, chiffre et caractère spécial ; empreinte scrypt ; verrouillage 15 min après 5 échecs | CNIL, délibération n° 2022-100 du 21 juillet 2022 |
| Réinitialisation par le membre | Lien de 30 min **et** second facteur exigé ; toutes les sessions sont fermées | — |
| Droits | Lecture seule / lecture et écriture / administrateur ; il reste toujours au moins un administrateur actif | Demande initiale |
| Commentaires non modifiables et non supprimables | Interdits par l'API (réponse 405) **et** par des déclencheurs SQLite ; chaînage SHA-256 et signature Ed25519 : toute altération directe du fichier est détectée (`npm run verify`) | Demande initiale |
| Documents | Chiffrés AES-256-GCM ; empreinte SHA-256 vérifiée à chaque lecture ; versions successives conservées, aucune suppression | Art. 31.3 (liste et version des documents), art. 40 |
| Déport pour conflit d'intérêts | Le membre perd l'accès au dossier et ses notifications ; déclaration tracée et définitive | Art. 4.2 |
| Journalisation | Connexions, échecs, consultations, téléchargements, commentaires, actions d'administration ; ajout seul ; purge automatique au-delà d'un an | Art. 40 (conservation de six mois à un an) |
| Confidentialité des notifications | Les courriels ne contiennent que la référence du dossier | Art. 5 et 6.1 |
| Formulaire public | Aucune donnée de santé demandée ; attestation obligatoire ; RIPH refusée avec renvoi vers un CPP ; anti-robots ; contrôle des types de fichiers | Art. 24.2, 56.4 ; CSP, art. L.1123-6 |
| Référence des dossiers | `CER-PROMEDNAV-AAAA-NNN` | Art. 31.3 (après renommage) |
| HTTPS, en-têtes de sécurité | HSTS, CSP stricte, aucune ressource externe | Art. 40 et 59.2 |

## 2. Limites à connaître

1. **La « signature » des commentaires n'est pas une signature électronique qualifiée** (pour les avis et les procès-verbaux, voir [SIGNATURE_QUALIFIEE.md](SIGNATURE_QUALIFIEE.md)). L'auteur est identifié par son authentification forte. Le serveur signe ensuite chaque commentaire avec sa propre clé. Au sens du règlement (UE) n° 910/2014 (eIDAS), c'est une *signature électronique* simple (art. 3, 10°) assortie d'une preuve d'intégrité. Ce n'est pas une signature *avancée* : l'art. 26 exige que les données de création soient sous le contrôle exclusif du signataire, et ici la clé appartient au serveur. Les avis du comité, signés par le président (art. 31.3), restent des documents distincts.
2. **Un administrateur système qui contrôle à la fois le serveur et ses clés pourrait réécrire toute la chaîne.** L'outil inscrit désormais l'empreinte de référence dans chaque procès-verbal et chaque avis. Une copie de ces actes conservée hors de l'outil (art. 34-7.3 proposé) rend donc toute réécriture détectable.

   **Secret du vote.** Le bulletin secret est enregistré sans nom et sans horodatage, avec un identifiant aléatoire. Le secret est garanti vis-à-vis des membres et du président. Il ne l'est pas totalement vis-à-vis d'un administrateur système déterminé, qui pourrait rapprocher l'émargement du bulletin par les journaux du serveur. D'où l'engagement prévu à l'art. 34-2.2 d.
3. **« Jamais supprimés » se heurte aux durées de conservation.** Le règlement fixe la conservation des dossiers à la durée du projet augmentée de dix ans (art. 34.3). Le RGPD interdit de conserver des données personnelles au-delà du nécessaire (art. 5.1.e). Le logiciel ne prévoit pas encore de purge des dossiers échus. Il faudra une procédure d'archivage ou de destruction, validée par le DPD, appliquée par dossier entier et tracée.
4. **Notifications push des applications natives.** Le Web Push fonctionne dans les navigateurs et dans la PWA installée (iOS/iPadOS 16.4 ou ultérieur, après ajout à l'écran d'accueil, source : webkit.org/blog/13878). Les applications Capacitor ne reçoivent pas de push natif : il faudrait intégrer Firebase Cloud Messaging et APNs. Les membres y reçoivent les courriels et voient le compteur dans l'application.
5. **Magasins d'applications.** Publier sur l'App Store demande l'Apple Developer Program, payant chaque année (developer.apple.com/programs). Une application qui se contente d'afficher un site peut être refusée (règle 4.2 « Minimum Functionality » des App Review Guidelines). Pour un usage interne, la **PWA** est la solution la plus simple et sans coût. À défaut : distribution privée (Apple Business Manager, *custom apps*) ou TestFlight. Pour Android, l'APK peut s'installer directement ; Google Play exige des frais d'inscription uniques. Les tarifs sont à vérifier sur les sites officiels au moment de la décision.
6. **Non testé dans cet environnement** : la construction des images Docker, des installateurs Electron et des projets Android et iOS. Il manquait Docker, les SDK Android et iOS, et l'accès aux binaires Electron. Le serveur, l'interface web et le formulaire ont été testés : 17 tests automatisés, plus un parcours complet dans un navigateur sur ordinateur et sur iPhone émulé.
7. **Couvert depuis la version 2** : rapporteurs, votes, procès-verbaux, avis selon l'annexe 7, rapport annuel, version signée des actes.

   **Pas encore couvert** :
   - questions écrites au porteur depuis l'application (art. 28.2) : le statut « questions au porteur » suspend bien le délai dans le rapport annuel, mais les échanges avec le porteur se font hors de l'outil ;
   - délai minimal d'un vote électronique (art. 34-9.3 proposé) ;
   - réexamen avec des rapporteurs différents (art. 33.1) : le président doit y veiller.

8. **Interprétations retenues par le logiciel**, à confirmer dans le règlement intérieur (voir les propositions) :
   - la majorité de l'art. 29.3 est celle des suffrages exprimés ;
   - le quorum de l'art. 29.2 est calculé sur tous les membres votants en exercice, y compris ceux qui se sont déportés. Si les déports empêchent d'atteindre le quorum, l'art. 4.3 s'applique (appel à un expert extérieur) ;
   - en procédure simplifiée, l'avis exige l'accord du président et du rapporteur.

## 3. Modifications à apporter au règlement intérieur (projet v8)

Ces points découlent de la lecture du projet v8. Ils relèvent de la décision du conseil d'administration (art. 18 des statuts).

| Article | Rédaction actuelle | Modification à prévoir |
|---|---|---|
| **Statuts**, art. 18, 19, 21, 23, 24 | « CERMEDHYP » | Le renommage exige d'abord une modification des statuts par l'assemblée générale extraordinaire : voir [PROPOSITION_REGLEMENT_INTERIEUR.md](PROPOSITION_REGLEMENT_INTERIEUR.md) |
| Art. 2, Titre IV, annexes 3 et 7 | « CERMEDHYP », « Comité d'éthique de la recherche en médecine hyperbare et de la plongée » | Renommer « CER-PROMEDNAV » partout. Vérifier si l'intitulé limité à la « médecine hyperbare et de la plongée » reste voulu : l'objet des statuts couvre plus largement le naval et le maritime |
| Art. 31.3 | Référence `[CERMEDHYP-AAAA-NNN]` | `CER-PROMEDNAV-AAAA-NNN` (format déjà appliqué par le logiciel) |
| Art. 26.2 | Adresse dédiée `[cermedhyp@...]` | Adresse du secrétariat du CER-PROMEDNAV |
| Art. 6.1 et nouveau Titre IV bis | « Les échanges […] passent par voie électronique, à l'adresse contact@promednav.com » | Rédactions proposées dans [PROPOSITION_REGLEMENT_INTERIEUR.md](PROPOSITION_REGLEMENT_INTERIEUR.md) |
| Art. 27.2 / annexe 3 | Dossier de saisine | Préciser le dépôt en ligne et l'attestation d'absence de données de santé identifiantes |
| Art. 40 | Journalisation | Le logiciel conserve les journaux un an ; à reporter dans la politique de sécurité |
| Art. 34.3 | Conservation | Définir la procédure de fin de conservation (point 2.3 ci-dessus) |

## 4. Formalités RGPD (Interprétation)

L'outil traite des données personnelles : identité et coordonnées des porteurs et des membres, journaux de connexion. Il ne traite pas, par conception, de données de santé. Il faut :

- l'inscrire au registre des activités de traitement (RGPD, art. 30) ;
- informer les porteurs : mention présente dans le formulaire, à compléter avec l'adresse d'exercice des droits ;
- informer les membres : charte et engagement de l'annexe 5.

La base légale proposée dans le formulaire, l'intérêt légitime, est une proposition à faire valider par le DPD.

## 5. Destruction en fin de conservation : ce qu'il faut savoir

- Une suppression n'est possible, au niveau de la base, que pendant une destruction décidée et consignée. Hors de ce cadre, les déclencheurs SQL la refusent. Une suppression faite en contournant ces déclencheurs est détectée par le contrôle d'intégrité, car la chaîne des commentaires est rompue (testé).
- La base efface physiquement les données supprimées (`secure_delete`) et son journal d'écriture est purgé. Les fichiers, déjà chiffrés, sont écrasés puis supprimés. **Limite :** sur un disque SSD, l'écrasement n'est pas garanti au niveau matériel. Le chiffrement de chaque fichier en limite la portée.
- **Sauvegardes :** les copies chiffrées subsistent jusqu'à leur rotation (35 jours avec `deploy/backup.sh`).
- **Procès-verbaux de séance :** un procès-verbal porte sur plusieurs dossiers, il n'est donc pas détruit avec un dossier. C'est au comité de fixer sa règle : les conserver comme archives, ou les détruire quand tous leurs dossiers l'ont été.
- **Journal d'audit :** il mentionne la référence du dossier, jamais son contenu, et il est purgé après un an.
- **Base existante :** la liste des types d'actes a été étendue (avis du DPD, certificat de destruction). Une base créée avec une version antérieure de l'outil doit être recréée avant la mise en production.
