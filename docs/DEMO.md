# Version de démonstration

Une instance pré-remplie de **données entièrement fictives**, pour présenter l'outil au comité, au conseil d'administration ou aux futurs membres.

## Lancer

```bash
cd server && npm ci && npm run demo        # http://localhost:8443
```

Avec Docker, sur un serveur de présentation : `docker compose -f deploy/docker-compose.demo.yml up -d --build`, puis `http://<serveur>:8080`.

La démo repart de zéro à chaque lancement. Pour garder les manipulations entre deux lancements, utilisez `DEMO_KEEP=true npm run demo`.

## Ce qui change par rapport à la version réelle

| Version réelle | Démonstration |
|---|---|
| Mot de passe + double authentification | Connexion en un clic sur un rôle fictif |
| Code de l'application d'authentification pour signer | Code fixe **000000** |
| Courriels envoyés par SMTP | Courriels affichés dans l'outil (bannière → « courriels envoyés ») |

Une bannière orange signale la démonstration sur chaque écran.

**Garde-fou.** Le mode démonstration refuse de démarrer si le répertoire de données ne contient pas « demo ». Il ne peut donc pas être activé sur la base réelle. Les routes de démonstration n'existent pas hors de ce mode (vérifié par les tests).

## Contenu

| Dossier | Étape | À essayer |
|---|---|---|
| 001 – Registre des accidents de désaturation | Avis favorable signé, transmis, réception confirmée, dossier clos ; examiné en séance (procès-verbal) | Actes, relevé de clôture, délai d'appel |
| 002 – Enquête oxygénothérapie | Avis défavorable (vote secret), dossier clos | Opinion divergente au procès-verbal |
| 003 – **Appel** du dossier 002 | Appel déposé, copies du dossier initial versées | Désigner des rapporteurs : les anciens sont refusés |
| 004 – Caisson multiplace | En instruction : rapports, échanges, **vote électronique ouvert**, un membre déporté | Voter avec le code 000000, répondre à un commentaire |
| 005 – Perception du risque | Simple dépôt | Notifications, déport, désignation des rapporteurs |
| 006 – Barotraumatismes (archives) | Fin de conservation : **destruction proposée** | Avis du DPD (Mme Garnier), puis décision de la présidente |

On trouve aussi une séance close avec son procès-verbal, une séance programmée, le rapport annuel, et le formulaire public de dépôt (lien dans la bannière), y compris pour un appel.

## Suggestion de parcours (10 minutes)

1. **Pr Hugo Bernard** (titulaire) : dossier 004 → lire les rapports → voter avec le code 000000.
2. **Dr Alice Martin** (présidente) : dossier 004 → clore le vote (contrôle d'intégrité) → produire l'avis → verser l'exemplaire signé (code de vérification de l'avis) → envoyer au porteur.
3. Bannière → **courriels envoyés** → ouvrir le lien d'accusé de réception → confirmer.
4. **Mme Sophie Garnier** (DPD) : Conservation → avis sur la destruction du dossier 006. Puis la présidente décide.
5. Formulaire du site : déposer une nouvelle demande, ou un appel du dossier 001 avec le code imprimé sur son avis.
