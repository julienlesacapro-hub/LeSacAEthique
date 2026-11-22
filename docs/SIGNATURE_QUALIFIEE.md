---
title: "Signature électronique qualifiée : contraintes, coûts, procédure, reconnaissance"
subtitle: "LeSacAEthique — CER-PROMEDNAV"
---

Les mentions « Interprétation » signalent une analyse et non un fait établi par un texte. Les tarifs viennent de pages commerciales ou de comparatifs consultés en novembre 2026 : vérifiez-les avant tout achat.

# 0. Procédure transitoire retenue (en vigueur dans l'outil)

En attendant le choix d'un prestataire de signature qualifiée :

1. **Les membres signent leur vote dans l'outil.** Ils saisissent à nouveau un code de double authentification. L'émargement et le bulletin reçoivent une empreinte et une signature du serveur, et le membre reçoit un reçu. C'est une signature électronique simple au sens d'eIDAS (art. 3, 10°), imputable grâce à l'authentification forte.
2. **Le président imprime l'avis et le signe à la main.** L'avis porte un code de vérification.
3. **Il verse l'exemplaire numérisé dans l'outil**, en recopiant ce code. L'outil refuse le versement si le code ne correspond pas. Puis il clôt la procédure : contrôle d'intégrité, relevé de clôture, dossier en lecture seule.
4. **Sur décision du président, l'outil envoie l'avis signé au porteur** depuis l'adresse du comité (`MAIL_FROM`, par exemple `comite-ethique@promednav.com`). Le président peut modifier l'objet et le texte. Le texte exact envoyé est conservé.

**Valeur juridique (Interprétation).** L'original est l'exemplaire papier signé. Le fichier versé et envoyé au porteur en est une **copie**. Le Code civil (art. 1379) donne à une copie fiable la même force probante que l'original. La fiabilité est appréciée par le juge, sauf procédés présumés fiables par décret. **Conservez donc l'original papier** : le Secrétaire général l'archive (art. 6.2). En cas de contestation, c'est lui qui fait foi.

# 1. Ce que dit le droit

| Point | Règle | Source |
|---|---|---|
| Définition | Signature électronique avancée, créée par un dispositif qualifié de création de signature, et reposant sur un certificat qualifié | Règlement (UE) n° 910/2014 « eIDAS », art. 3, 12° |
| Effet juridique | Effet équivalent à celui d'une signature manuscrite | eIDAS, art. 25.2 |
| Reconnaissance dans l'UE | Reconnue comme qualifiée dans tous les États membres | eIDAS, art. 25.3 |
| Autres niveaux | Un juge ne peut pas écarter une signature au seul motif qu'elle est électronique ou qu'elle n'est pas qualifiée | eIDAS, art. 25.1 |
| Droit français | L'écrit électronique a la même force probante que l'écrit papier si son auteur est identifié et si son intégrité est garantie. La fiabilité de la signature est présumée lorsqu'elle est qualifiée | Code civil, art. 1366 et 1367 ; décret n° 2017-1416 du 28 septembre 2017, art. 1er |
| Charge de la preuve | Avec une signature qualifiée, c'est à celui qui la conteste de prouver qu'elle n'est pas fiable. Avec une signature d'un autre niveau, c'est à celui qui s'en prévaut de prouver sa fiabilité | Code civil, art. 1367 ; Code de procédure civile, art. 287 |

**Ce que cela change pour le comité (Interprétation).** Aucun texte n'impose une forme particulière aux avis d'un comité d'éthique associatif. Le règlement intérieur exige seulement que l'avis soit « signé par le président » (art. 31.3). Une signature qualifiée n'est donc pas obligatoire. Elle apporte deux avantages :

- une présomption de fiabilité opposable en cas de contestation ;
- une reconnaissance automatique dans toute l'Union.

# 2. Où l'utiliser

| Acte | Qui signe | Signature recommandée |
|---|---|---|
| Avis (art. 31.3, annexe 7) | Président (vice-président en suppléance) | **Qualifiée** |
| Procès-verbal de séance (art. 29.4) | Président et secrétariat | Qualifiée pour le président ; qualifiée ou avancée pour le secrétariat |
| Rapport annuel (art. 34.2) | Président | Qualifiée, ou authentification forte dans l'outil |
| Commentaires, votes des membres | Chaque membre | **Aucun certificat nécessaire** : la double authentification et la signature du serveur suffisent (art. 34-6) |

Il faut donc **deux certificats** (président et vice-président), voire trois avec le secrétariat. Il n'en faut pas un par membre.

# 3. Contraintes

1. **Un prestataire qualifié.** Le certificat doit être délivré par un prestataire inscrit sur la liste de confiance européenne (consultable avec le *Trusted List Browser* de la Commission).
2. **Une vérification d'identité.** Elle se fait en face à face, ou à distance par vidéo selon les procédés admis par le prestataire. Prévoyez un délai de une à quatre semaines.
3. **Un dispositif qualifié.** Soit une clé USB ou une carte à puce (le signataire doit l'avoir avec lui et installer un pilote), soit un service de signature à distance (téléphone ou code reçu par SMS, selon le prestataire).
4. **Une durée limitée.** Un certificat vaut un à trois ans. Pour qu'un avis reste vérifiable après l'expiration du certificat, il faut un horodatage qualifié (format PAdES « LT » ou « LTA », que proposent la plupart des logiciels de signature). À défaut, conservez le rapport de validation établi au moment de la signature : l'outil permet de le déposer avec l'acte signé.
5. **Un certificat nominatif.** Il appartient à la personne. Au changement de président, le nouveau président obtient son propre certificat.

# 4. Coûts indicatifs

| Solution | Prix constaté | Source | Remarque |
|---|---|---|---|
| ChamberSign Eiducio+ (qualifié, clé USB) | À partir de 115 à 125 € HT pour 1 an ; 250 € HT pour 3 ans ; clé USB 65 € HT en plus | chambersign.fr (pages produit) | Prix éditeur |
| Certigna (qualifié, clé USB) | Environ 140 € pour 1 an et 204 € pour 2 ans, clé incluse | Comparatifs tiers | À confirmer auprès de l'éditeur |
| Fourchette du marché, certificat qualifié sur clé | 90 à 290 € HT selon la durée (1 à 3 ans) | Article spécialisé marchés publics (titulis.fr) | Ordre de grandeur |
| Signature qualifiée à l'unité (service en ligne, ex. Yousign) | Environ 10 à 15 € HT par signature, sur abonnement payant | Comparatif tiers et avis d'utilisateur ; aucun montant affiché sur la page officielle | Demander un devis |

**Estimation (Interprétation).** Avec 20 à 40 avis par an, deux certificats sur clé coûtent environ **250 à 600 € HT par an** au total, quel que soit le nombre d'avis. La signature à l'unité coûterait 200 à 600 € HT par an, plus un abonnement. Pour un comité qui signe régulièrement, les certificats sur clé sont la solution la plus simple et la plus prévisible.

# 5. Procédure dans LeSacAEthique (déjà programmée)

1. Après le vote, le président clique sur « Produire l'avis ». L'outil génère le PDF selon l'annexe 7, en français et en anglais. Le PDF contient la liste et la version des documents examinés et l'empreinte du contrôle d'intégrité.
2. Le président télécharge le PDF et le signe avec son certificat qualifié, par exemple dans Adobe Acrobat Reader (gratuit), menu « Utiliser un certificat », ou avec le logiciel du prestataire. Il **ne modifie pas** le document.
3. Facultatif : il vérifie la signature avec l'outil de validation de la Commission européenne (DSS), qui contrôle le certificat au regard des listes de confiance. Il en conserve le rapport.
4. Il dépose le PDF signé dans l'outil, avec le rapport s'il l'a établi. L'outil vérifie :
   - que le fichier signé **commence exactement** par les octets de l'avis qu'il a produit : la signature PDF s'ajoute à la fin du fichier, par « mise à jour incrémentale », sans toucher au contenu ;
   - qu'il contient bien une signature électronique.
5. « Transmettre au porteur » envoie la version signée.

**Limite.** L'outil vérifie que le document n'a pas été modifié et qu'il porte une signature. Il ne vérifie pas lui-même que le certificat est qualifié : c'est le rôle de l'étape 3. Pour automatiser cette vérification, il faudrait installer sur le serveur la bibliothèque libre DSS de la Commission européenne (Java), ou passer par l'API d'un prestataire.

# 6. Reconnaissance

| Destinataire | Reconnaissance | Source ou statut |
|---|---|---|
| Juridictions et administrations françaises | Équivalence avec la signature manuscrite, présomption de fiabilité | Code civil, art. 1367 ; décret n° 2017-1416 |
| Autres États de l'UE | Reconnaissance obligatoire | eIDAS, art. 25.3 |
| Revues scientifiques internationales | Aucune règle juridique : les revues demandent en pratique une lettre ou un avis du comité, pas une forme de signature particulière. Une signature électronique vérifiable est au moins aussi probante qu'un scan | Interprétation |
| OHRP (enregistrement IRB) | L'enregistrement se fait dans le système électronique de l'OHRP lui-même, et non par l'envoi de documents signés. Un avis n'a pas à porter de signature qualifiée pour mentionner les numéros IORG et IRB | hhs.gov, page *New IRB registration*. Je n'ai pas trouvé de règle de signature propre à l'enregistrement IRB |
| Hors UE (États-Unis, Royaume-Uni…) | Pas d'effet automatique : la valeur dépend du droit local. Une signature qualifiée y reste vérifiable techniquement | Interprétation |

# 7. Une procédure 100 % informatique est-elle possible ?

**Oui pour le fonctionnement du comité. Non pour l'obtention du certificat.**

**Ce qui peut être entièrement dématérialisé** (Interprétation fondée sur les art. 1366 et 1367 du Code civil et sur l'absence de texte imposant le papier pour les actes d'un comité associatif) :

- la saisine (formulaire en ligne) ;
- l'instruction, les échanges et les rapports ;
- les déports ;
- les votes, en séance ou par voie électronique, une fois le Titre IV bis adopté ;
- les procès-verbaux et les avis signés électroniquement ;
- la transmission au porteur ;
- l'archivage, avec contrôles d'intégrité et rapports de validation.

**Ce qui reste hors ligne ou physique :**

1. La vérification d'identité lors de la délivrance du certificat. Elle peut se faire par vidéo chez certains prestataires.
2. La clé USB du signataire, sauf choix d'une signature à distance.
3. **La modification des statuts** (nom du comité) et l'adoption du règlement intérieur, selon les formes prévues par les statuts : assemblée générale, procès-verbal signé par le Président et le Secrétaire général (art. 20.3 du projet de statuts). Ces signatures peuvent aussi être électroniques. Vérifiez cependant les exigences du greffe des associations pour la déclaration de la modification.
4. La conservation hors de l'outil d'une copie des procès-verbaux (art. 34-7.3). Elle peut être numérique, sur un support distinct, et n'a pas besoin d'être sur papier.

**Seul point de vigilance (Interprétation) :** la conservation à long terme. Pour qu'un avis signé en 2026 reste vérifiable en 2040, il faut un horodatage qualifié au moment de la signature (PAdES-LTA), ou le rapport de validation conservé dans l'outil. Sans l'un ou l'autre, la signature reste probante, mais elle sera plus difficile à vérifier une fois le certificat expiré.

# 8. Option pour plus tard : le cachet électronique qualifié

Un cachet électronique qualifié (eIDAS, art. 35 à 40) est l'équivalent, pour une personne morale, de la signature qualifiée. Il pourrait sceller automatiquement chaque acte produit par l'outil, au nom de l'association. Il ne remplace pas la signature du président, que le règlement intérieur exige. Il coûte plus cher, car il faut un module matériel de sécurité ou un service à distance. Il n'est pas utile au démarrage.

# Sources

- Règlement (UE) n° 910/2014 (eIDAS), art. 25 : [texte d'origine sur legislation.gov.uk](https://www.legislation.gov.uk/eur/2014/910/article/25/data.pdf). Pour la version consolidée après le règlement (UE) 2024/1183, consultez EUR-Lex.
- ANSSI, guide des niveaux de signature eIDAS : [cyber.gouv.fr](https://cyber.gouv.fr/sites/default/files/document/anssi-eidas-guide-niveau-signature.pdf)
- Décret n° 2017-1416 du 28 septembre 2017 : [affairesjuridiques.aphp.fr](https://affairesjuridiques.aphp.fr/textes/decret-n-2017-1416-du-28-septembre-2017-relatif-a-la-signature-electronique/) ; commentaire : [centre-inffo.fr](https://www.centre-inffo.fr/site-droit-formation/actualites-droit/signature-electronique)
- Code civil, art. 1366 et 1367 : [Légifrance](https://www.legifrance.gouv.fr/codes/id/LEGIARTI000044072399/2022-01-01) ; présomption de fiabilité : [rapport du 117e Congrès des notaires](https://www.rapport-congresdesnotaires.fr/2021-rapport-du-117e-congres/la-presomption-de-fiabilite-de-la-signature-qualifiee)
- Tarifs ChamberSign : [Eiducio+](https://www.chambersign.fr/produit-chambersign/eiducio-plus/), [Eiducio](https://www.chambersign.fr/eiducio-24/)
- Fourchettes de prix : [titulis.fr](https://titulis.fr/articles/certificat-signature-electronique-marche-public), [comparatif signersynthese.fr](https://signersynthese.fr/blog/comparatif-prestataires-signature-qualifiee-inpi.html)
- Yousign : [page signature qualifiée](https://yousign.com/fr-fr/signature-electronique-qualifiee), [tarifs](https://yousign.com/fr-fr/prix)
- Commission européenne, outil de validation DSS : [webapp de démonstration](https://ec.europa.eu/digital-building-blocks/DSS/webapp-demo), [présentation de DSS](https://ec.europa.eu/digital-building-blocks/wikis/display/DIGITAL/Digital+Signature+Service+-++DSS)
- OHRP, enregistrement d'un IRB : [hhs.gov](https://www.hhs.gov/ohrp/register-irbs-and-obtain-fwas/irb-registration/new-irb-registration/index.html)
