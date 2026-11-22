---
title: "Règlement intérieur de PROMEDNAV — Propositions de rédaction relatives au CER-PROMEDNAV et à l'outil LeSacAEthique"
subtitle: "Projet à soumettre au conseil d'administration (art. 18 des statuts en vigueur, art. 23 du projet de statuts v2)"
---

# Note de présentation (à supprimer avant adoption)

## Trois points à régler avant l'adoption

**1. Le changement de nom exige une modification des statuts.** Le projet de statuts v2 nomme le comité « CERMEDHYP » à l'article 18 et à l'article 23. Le règlement intérieur ne peut pas contredire les statuts (art. 1.3 du règlement ; art. 23 du projet de statuts). Le nom « CER-PROMEDNAV » doit donc d'abord entrer dans les statuts, par l'assemblée générale extraordinaire (art. 22 du projet de statuts : majorité des deux tiers des suffrages exprimés). Rédaction proposée pour l'article 18.1 des statuts :

> « 18.1 Il est institué un Comité d'éthique de la recherche de PROMEDNAV, dénommé « CER-PROMEDNAV ». Le CER-PROMEDNAV est une instance consultative indépendante. […] »

Il faut aussi remplacer « CERMEDHYP » dans les articles 18.2 à 18.7, 19.3, 19.4, 21.2, 23 et 24 des statuts. Si les statuts v2 ne sont pas encore déposés, le plus simple est de faire ce changement avant leur adoption.

**2. Le mot « administrateur » est déjà pris.** Dans le règlement intérieur, un « administrateur » est un membre du conseil d'administration. L'article 26.1 prévoit d'ailleurs en option que « le président du CERMEDHYP ne peut pas être administrateur ». Appeler le président du comité « administrateur de l'outil » créerait une contradiction apparente. Le projet emploie donc l'expression **« administrateur fonctionnel de l'outil »**.

**3. Ne confiez pas l'administration de l'outil à une seule personne.** Vous demandez que l'administrateur soit le président du CER. Si celui-ci est absent, malade, ou s'il se déporte sur un dossier, plus personne ne peut ouvrir ni clore un vote. Le projet confie donc la suppléance au vice-président, sur le modèle de l'article 15.2 des statuts. Si vous préférez un président seul administrateur, le logiciel le permet (paramètre `ADMIN_FUNCTIONS=president`) : supprimez alors la seconde phrase de l'article 34-3.1.

## Numérotation

Pour ne pas renuméroter le règlement, les nouveaux articles forment un **Titre IV bis**, inséré entre le Titre IV (comité d'éthique) et le Titre V (registre). Ils sont numérotés de 34-1 à 34-12.

## Ce que le logiciel applique déjà

Chaque règle proposée est appliquée par le logiciel, sauf celles marquées *(organisationnel)*, qui reposent sur les personnes. Le tableau de correspondance figure en fin de document.

# 1. Article 6.1 — nouvelle rédaction

**Rédaction actuelle :**

> 6.1 Les échanges entre l'association, les porteurs et les instances passent par voie électronique, à l'adresse contact@promednav.com. Aucune donnée de santé identifiante ne transite par une messagerie non chiffrée.

**Rédaction proposée :**

> 6.1 Les échanges entre l'association, les porteurs et les instances passent par voie électronique.
>
> a) Pour le CER-PROMEDNAV, la saisine se fait par le formulaire de dépôt du site internet de l'association. L'instruction des dossiers, les échanges entre ses membres, les votes, les procès-verbaux, les avis et leur conservation passent exclusivement par l'outil sécurisé LeSacAEthique, régi par le Titre IV bis. L'avis est adressé au porteur depuis cet outil.
>
> b) Les autres échanges passent par l'adresse contact@promednav.com.
>
> c) Aucune donnée de santé identifiante ne transite par une messagerie électronique. Aucun document d'un dossier du CER-PROMEDNAV n'est transmis par messagerie, à l'exception de l'avis adressé au porteur. Les notifications envoyées par l'outil indiquent seulement la référence du dossier.

# 2. Modifications ponctuelles d'autres articles

**Article 2 (Définitions)** — remplacer la ligne « CERMEDHYP » et ajouter les lignes suivantes :

| Terme | Définition pour l'application du règlement |
|---|---|
| CER-PROMEDNAV | Comité d'éthique de la recherche de PROMEDNAV (Titre IV). |
| Outil | Logiciel LeSacAEthique, hébergé sur un serveur de l'association, qui assure l'instruction, les échanges, les votes et la conservation des actes du CER-PROMEDNAV (Titre IV bis). |
| Administrateur fonctionnel | Personne qui paramètre les comptes et conduit les procédures dans l'outil, sans pouvoir sur le contenu des échanges (art. 34-3). |
| Référent technique | Personne désignée par le CE pour installer, maintenir et sauvegarder le serveur de l'outil, sans accès applicatif (art. 34-2). |
| Contrôle d'intégrité | Vérification automatique, par l'outil, qu'aucun commentaire, document, bulletin de vote ou acte n'a été modifié, supprimé ou inséré après coup (art. 34-7). |

**Article 26.2** — remplacer « Adresse dédiée : [cermedhyp@...] » par :

> « Le secrétariat dispose d'un compte dans l'outil, sans droit de vote. Il gère la recevabilité, les pièces des dossiers et le calendrier des séances. Adresse dédiée : [cer@promednav.com]. »

**Article 29.1** — ajouter une seconde phrase :

> « Il peut aussi délibérer par voie électronique, dans les conditions de l'article 34-9. »

**Article 29.3** — remplacer « À défaut, il décide à la majorité des votants. » par :

> « À défaut, il décide à la majorité des suffrages exprimés ; les abstentions ne sont pas des suffrages exprimés. »

*Note de rédaction :* « majorité des votants » peut se lire de deux façons (avec ou sans les abstentions). Le logiciel retient la majorité des suffrages exprimés. La précision lève l'ambiguïté.

**Article 31.3** — remplacer la deuxième phrase par :

> « Il porte une référence unique (CER-PROMEDNAV-AAAA-NNN), sa date, la liste et la version des documents examinés, la qualité des membres qui ont délibéré, l'empreinte du contrôle d'intégrité préalable au vote (art. 34-7) et un code de vérification. Le président le signe de sa main sur l'exemplaire imprimé par l'outil ; l'exemplaire signé est numérisé et versé dans l'outil, et l'original papier est conservé par le Secrétaire général (art. 6.2). Dès qu'un prestataire de signature électronique qualifiée au sens du règlement (UE) n° 910/2014 aura été retenu par le CE, la signature électronique qualifiée pourra remplacer la signature manuscrite. »

**Annexe 5 (engagement)** — ajouter :

> « Je m'engage à ne communiquer à personne mes identifiants de connexion à l'outil LeSacAEthique, à signaler sans délai toute perte ou compromission, et à n'utiliser aucun autre canal que l'outil pour les échanges relatifs aux dossiers du CER-PROMEDNAV. »

**Annexe 7** — remplacer « CERMEDHYP » par « CER-PROMEDNAV », et « Comité d'éthique de la recherche en médecine hyperbare et de la plongée » par « Comité d'éthique de la recherche de PROMEDNAV ». L'outil produit cet avis en français et en anglais.

# 3. Titre IV bis — Outil numérique du CER-PROMEDNAV

## Article 34-1 — Objet et caractère exclusif

34-1.1 L'outil LeSacAEthique est le seul support officiel de l'instruction des dossiers du CER-PROMEDNAV : saisine, pièces, échanges entre membres, désignation des rapporteurs, déports, votes, procès-verbaux, avis et rapport annuel.

34-1.2 Un échange sur le fond d'un dossier fait hors de l'outil n'a aucune valeur dans la procédure. Le membre qui reçoit un tel échange le verse dans l'outil ou le signale au président.

34-1.3 En séance, en présentiel ou par visioconférence, les débats sont oraux. Les votes sont émis dans l'outil.

## Article 34-2 — Hébergement, référent technique et clés

34-2.1 L'outil est hébergé sur un serveur dont l'association a la maîtrise, situé en France ou dans l'Union européenne. Ce serveur est distinct de celui du registre (art. 59.4) et de celui du site internet. L'association est propriétaire des données.

34-2.2 Le CE désigne un référent technique, qui installe l'outil, applique les mises à jour de sécurité (art. 40) et assure les sauvegardes. Le référent technique :

a) n'a pas de compte dans l'outil et n'accède pas au contenu des dossiers ;

b) ne peut pas être membre votant du CER-PROMEDNAV ;

c) signe l'engagement de confidentialité de l'annexe 5 ;

d) s'interdit toute tentative de rapprocher un bulletin de vote secret de son auteur ;

e) n'intervient sur la base de données que pour la maintenance. Chaque intervention est consignée et portée à la connaissance du président du CER-PROMEDNAV.

34-2.3 Les clés de chiffrement et de signature du serveur sont conservées séparément des sauvegardes. Une copie de secours, sous pli scellé ou sur un support chiffré, est remise au président du CER-PROMEDNAV et au délégué à la protection des données. *(organisationnel)*

## Article 34-3 — Administrateur fonctionnel

34-3.1 Le président du CER-PROMEDNAV est l'administrateur fonctionnel de l'outil. Le vice-président le supplée en cas d'empêchement, ou lorsque le président s'est déporté sur un dossier. Aucune autre personne ne détient ce rôle.

34-3.2 L'administrateur fonctionnel :

a) ouvre, modifie, suspend et ferme les comptes, et fixe les droits ;

b) désigne les rapporteurs ;

c) ouvre, clôt ou annule les votes ;

d) établit les avis et produit les procès-verbaux et le rapport annuel ;

e) effectue les contrôles d'intégrité de l'article 34-7.

34-3.3 Le rôle d'administrateur fonctionnel ne donne aucun pouvoir sur le contenu. Personne, y compris l'administrateur fonctionnel et le référent technique, ne peut modifier ni supprimer un commentaire, un document déposé, un bulletin de vote, une déclaration de conflit d'intérêts, un acte ou une entrée du journal. L'outil rend ces opérations techniquement impossibles.

34-3.4 Aucun organe de l'association ne détient de compte dans l'outil à ce titre (art. 23.2 et 33.2).

## Article 34-4 — Comptes et droits

34-4.1 Chaque personne dispose d'un seul compte nominatif. Un compte ne peut être ni partagé ni délégué.

34-4.2 L'administrateur fonctionnel ouvre un compte :

a) aux membres titulaires et suppléants, après leur nomination par le CA (art. 25.4) ;

b) au secrétariat (art. 26.2) ;

c) le cas échéant, au DPD et aux experts (art. 25.6).

Le compte n'est ouvert qu'après la signature de l'annexe 5.

34-4.3 Les droits sont les suivants :

| Droit | Titulaires |
|---|---|
| Lecture seule | DPD, experts, toute personne sans voix délibérative |
| Lecture et écriture | Membres titulaires et suppléants ; secrétariat, sans droit de vote |
| Administrateur fonctionnel | Président et vice-président (art. 34-3) |

34-4.4 Le compte indique le nom complet et la qualité du membre, qui signent chacun de ses messages. Il indique aussi sa fonction au sein du comité, et s'il exerce une profession de santé et s'il est indépendant de l'association : ces deux mentions servent à la désignation des rapporteurs (art. 28.1) et au calcul du quorum (art. 29.2).

34-4.5 À la fin d'un mandat (art. 25.5), le compte est suspendu le jour même. Un compte n'est jamais supprimé, pour que la signature des messages passés reste vérifiable.

34-4.6 L'administrateur fonctionnel revoit la liste des comptes et des droits chaque année et en rend compte dans le rapport annuel. *(organisationnel)*

## Article 34-5 — Identifiants et authentification

34-5.1 Personne ne connaît ni ne peut connaître le mot de passe d'un membre : ni l'administrateur fonctionnel, ni le référent technique, ni le secrétariat. L'outil n'en conserve qu'une empreinte.

34-5.2 Un compte s'ouvre par un lien d'activation personnel, valable 72 heures et à usage unique. Le membre y choisit son mot de passe, puis configure la double authentification. Celle-ci est obligatoire pour tout accès.

34-5.3 En cas de perte du mot de passe, le membre le réinitialise lui-même. Il lui faut le lien reçu à son adresse électronique **et** un code de son application d'authentification ou un code de secours.

34-5.4 Si le membre a perdu à la fois son téléphone et ses codes de secours, l'administrateur fonctionnel réinitialise sa double authentification. Il vérifie d'abord l'identité du membre de vive voix ou par visioconférence. L'opération est journalisée et notifiée au membre.

34-5.5 Le membre signale sans délai au président toute perte ou compromission de ses identifiants. Le compte est alors suspendu.

## Article 34-6 — Valeur et intégrité des écrits

34-6.1 Les commentaires, réponses et compléments sont définitifs dès leur publication. On corrige un écrit en publiant un complément.

34-6.2 Chaque écrit porte le nom et la qualité de son auteur, sa date et son heure, une empreinte numérique et la signature du serveur. Comme l'accès exige une authentification forte, l'écrit est imputable à son auteur.

34-6.3 Les documents déposés ne sont jamais remplacés. Une nouvelle version s'ajoute à la précédente, qui reste consultable.

## Article 34-7 — Contrôle de non-altération

34-7.1 L'outil vérifie que rien n'a été modifié, supprimé ou inséré après coup. Le contrôle porte sur les commentaires, les documents, les bulletins de vote et les actes.

34-7.2 Le contrôle est obligatoire :

a) avant la validation de tout vote. L'outil l'effectue automatiquement à la clôture du vote. **Un vote ne peut être validé, ni un avis établi, que si le contrôle est conforme** ;

b) à la clôture de chaque séance, avant la production du procès-verbal ;

c) au moins tous les deux mois, à l'initiative de l'administrateur fonctionnel, en même temps que l'analyse des journaux (art. 40) ;

d) après toute restauration d'une sauvegarde, par le référent technique.

34-7.3 Chaque contrôle est consigné de façon définitive, qu'il soit conforme ou non. Le procès-verbal et l'avis mentionnent le numéro du contrôle et l'empreinte de référence. Le Secrétaire général conserve une copie de chaque procès-verbal hors de l'outil (art. 6.2), de sorte qu'une réécriture ultérieure de l'historique serait détectable. *(organisationnel pour la copie externe)*

34-7.4 Si un contrôle n'est pas conforme :

a) le vote en cours n'est pas validé ;

b) le président informe sans délai le référent technique, le délégué à la protection des données et le CE ;

c) l'incident suit, s'il y a lieu, la procédure de l'article 47 ;

d) le comité décide, au vu de l'analyse, d'un nouveau vote sur la base d'éléments vérifiés.

## Article 34-8 — Déport pour conflit d'intérêts

34-8.1 Le membre en conflit d'intérêts (art. 4.2) déclare son déport dans l'outil, avant tout examen du dossier.

34-8.2 Le déport prend effet immédiatement :

a) le membre n'a plus accès au dossier, à ses votes ni aux procès-verbaux qui le concernent ;

b) il ne reçoit plus les notifications du dossier ;

c) s'il était rapporteur, sa désignation prend fin.

34-8.3 La déclaration est définitive. Les autres membres la voient. Le procès-verbal la mentionne, et l'avis indique le nombre de déports.

34-8.4 Si le président estime qu'un membre est en conflit d'intérêts sans s'être déporté, il l'invite à le faire. À défaut, il saisit le CA (art. 25.5). *(organisationnel)*

## Article 34-9 — Rapporteurs, délibérations et votes

34-9.1 Le président désigne les deux rapporteurs dans l'outil (art. 28.1). L'outil refuse deux rapporteurs qui exerceraient tous deux une profession de santé. Les rapporteurs peuvent publier leur rapport dans l'outil.

34-9.2 Sauf en procédure simplifiée, un vote ne peut être ouvert qu'une fois les deux rapporteurs désignés.

34-9.3 Le vote a lieu soit en séance, soit par voie électronique. Pour un vote par voie électronique, le président fixe une date limite, qui ne peut pas être fixée moins de [cinq jours ouvrés] après l'ouverture. Tout membre peut demander, avant la date limite, que le dossier soit examiné en séance. Le président annule alors le vote électronique.

*Note de rédaction :* le logiciel permet d'annuler un vote, mais il ne vérifie pas encore ce délai minimal. C'est au président de le respecter.

34-9.4 Sont appelés à voter les membres votants en exercice qui ne se sont pas déportés. Un suppléant vote à la place d'un titulaire désigné par le président à l'ouverture du vote. Le titulaire et son suppléant ne peuvent pas voter tous les deux.

34-9.4 bis Chaque membre signe son vote : avant d'enregistrer son bulletin, il saisit à nouveau un code de sa double authentification. Le vote est alors définitif et imputable à son auteur. L'outil signe l'émargement et le bulletin, et remet au membre un reçu (empreinte de son bulletin). En vote secret, le bulletin signé ne porte ni le nom de son auteur ni de lien avec l'émargement.

34-9.5 L'outil applique les règles suivantes :

a) le quorum de l'article 29.2, calculé sur le nombre des membres votants en exercice ;

b) la majorité des suffrages exprimés (art. 29.3) ;

c) le vote à bulletin secret, de droit si un membre le demande. Le bulletin est alors enregistré sans le nom de son auteur ;

d) en procédure simplifiée, l'interdiction d'un avis défavorable (art. 30.2).

Un bulletin est définitif. Le résultat n'est visible qu'après la clôture.

34-9.6 Le procès-verbal consigne les opinions divergentes avec leur motivation, sans le nom de leur auteur (art. 29.3).

## Article 34-10 — Procès-verbaux, avis et signature

34-10.1 À la clôture de chaque séance, l'outil produit le procès-verbal. Celui-ci indique :

a) les membres ayant voté et les déports ;

b) les rapporteurs ;

c) le quorum, le résultat et la décision ;

d) les opinions divergentes ;

e) les avis rendus en procédure simplifiée depuis la séance précédente (art. 30.2) ;

f) le contrôle d'intégrité.

Le président et le secrétariat signent le procès-verbal.

34-10.2 Après un vote, le président établit l'avis dans l'outil, selon le modèle de l'annexe 7, en français et en anglais.

34-10.3 Le président imprime l'avis et le signe de sa main, ce qui authentifie la décision. Il numérise l'exemplaire signé et le verse dans l'outil, en recopiant le code de vérification imprimé sur l'avis. L'outil refuse le versement si le code ne correspond pas. L'original papier est remis au Secrétaire général, qui le conserve (art. 6.2).

34-10.4 Le versement de l'avis signé clôt la procédure. L'outil effectue un contrôle d'intégrité, produit un relevé de clôture et d'archivage, puis place le dossier en lecture seule définitive. Le relevé contient la chronologie, les documents, l'intégralité des échanges, les votes et les actes, avec leurs empreintes. Une modification ultérieure du projet fait l'objet d'une nouvelle saisine (art. 32.1).

34-10.5 Sur décision du président, l'outil adresse l'avis signé au porteur par courriel, depuis l'adresse électronique du comité [comite-ethique@promednav.com]. Le président peut modifier l'objet et le texte du message avant l'envoi. Le texte exact envoyé, son destinataire, sa date et l'empreinte de la pièce jointe sont conservés dans le dossier.

34-10.6 Lorsqu'un prestataire de signature électronique qualifiée aura été retenu par le CE, la signature électronique qualifiée de l'avis pourra remplacer les articles 34-10.3 et 34-10.4, alinéa 1. L'outil vérifie alors que le document signé est exactement celui qu'il a produit.

## Article 34-11 — Conservation, sauvegardes et réversibilité

34-11.1 Les dossiers, avis et procès-verbaux sont conservés pendant la durée fixée à l'article 34.3. Les journaux sont conservés un an (art. 40).

34-11.2 À l'expiration de la durée de conservation, le président du CER-PROMEDNAV décide de la destruction, dossier par dossier, après avis du délégué à la protection des données. La destruction porte sur le dossier entier et elle est consignée. Les avis signés peuvent être conservés au titre des archives de l'association.

*Note de rédaction :* le logiciel ne permet pas encore cette destruction. Une fonction dédiée devra être développée avant la première échéance, soit au plus tôt dix ans après la fin du premier projet.

34-11.3 Le référent technique fait une sauvegarde chiffrée chaque jour et en garde une copie hors site. Il fait un test de restauration chaque semestre, suivi d'un contrôle d'intégrité (art. 34-7.2 d).

34-11.4 Si l'association cesse d'utiliser l'outil, elle conserve sous forme exportée les avis signés, les procès-verbaux, les documents des dossiers et le journal des contrôles d'intégrité.

## Article 34-12 — Évolution de l'outil

34-12.1 Le CE décide des évolutions de l'outil, sur proposition ou après avis du président du CER-PROMEDNAV.

34-12.2 Toute évolution qui touche à l'intégrité des écrits, aux votes, aux droits ou à l'authentification est soumise au préalable au CER-PROMEDNAV. Elle est mentionnée dans le rapport annuel.

34-12.3 Un test d'intrusion par un tiers est réalisé avant la mise en production, puis selon le calendrier de l'article 40.

# 4. Correspondance entre les articles et le logiciel

| Article | Règle | Appliquée par le logiciel |
|---|---|---|
| 6.1 | Canal unique, notifications sans contenu | Oui |
| 34-3.1 | Administrateur = président ou vice-président | Oui (`ADMIN_FUNCTIONS`) |
| 34-3.3 | Aucune modification ni suppression | Oui (API et déclencheurs de la base) |
| 34-4.3 | Trois niveaux de droits, secrétariat sans vote | Oui |
| 34-4.5 | Comptes suspendus, jamais supprimés | Oui |
| 34-5.1 à 34-5.4 | Mots de passe inconnus de tous, 2FA, réinitialisation autonome | Oui |
| 34-7.2 a et b | Contrôle obligatoire avant validation d'un vote et à la clôture d'une séance | Oui (clôture refusée si non conforme) |
| 34-7.3 | Contrôles consignés, empreinte dans les PV et avis | Oui |
| 34-8 | Déport immédiat, fin de désignation du rapporteur | Oui |
| 34-9.1 | Deux rapporteurs, dont un non professionnel de santé | Oui |
| 34-9.3 | Délai minimal du vote électronique | **Non** : à respecter par le président |
| 34-9.4 et 34-9.5 | Suppléance, quorum, majorité, vote secret, procédure simplifiée | Oui |
| 34-9.4 bis | Vote signé par une nouvelle saisie du code de double authentification, reçu remis au membre | Oui |
| 34-10 | PV, avis bilingue, versement de l'exemplaire signé à la main (avec code de vérification), clôture et archivage, courriel modifiable et conservé | Oui |
| 34-10.3 | Conservation de l'original papier par le Secrétaire général | Non : mesure organisationnelle |
| 34-11.2 | Destruction en fin de conservation | **Non** : développement à prévoir |
| 34-2.2 e, 34-2.3, 34-4.6, 34-7.3 (copie externe), 34-8.4 | Mesures organisationnelles | Non applicable |
