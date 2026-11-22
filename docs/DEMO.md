# Version de démonstration

Une instance pré-remplie de **données entièrement fictives**, pour présenter l'outil au comité, au conseil d'administration ou aux futurs membres.

## Lancer

```bash
cd server && npm ci && npm run demo        # http://localhost:8443
```

Avec Docker, sur un serveur de présentation : `docker compose -f deploy/docker-compose.demo.yml up -d --build`, puis `http://<serveur>:8080`.

La démo repart de zéro à chaque lancement. Pour garder les manipulations entre deux lancements, utilisez `DEMO_KEEP=true npm run demo`.

## Sur un smartphone Android (ou un iPhone)

La démo tourne sur un ordinateur. Le téléphone l'ouvre par le même réseau Wi-Fi.

1. Sur l'ordinateur (Windows, macOS ou Linux), installez **Node.js 22 LTS** depuis nodejs.org (choix par défaut).
2. Récupérez le code : sur GitHub, ouvrez le dépôt → **Code** → **Download ZIP**, puis décompressez.
3. Ouvrez un terminal dans le dossier `server` :
   - **Windows** : clic droit dans le dossier → « Ouvrir dans le Terminal » ;
   - **Mac** : Terminal, puis `cd` suivi du chemin du dossier.
4. Tapez `npm ci` (une seule fois), puis `npm run demo`.
5. Le terminal affiche une adresse du type `http://192.168.1.23:8443` et un **QR code**. Sous Windows, si le pare-feu le demande, autorisez Node.js sur les **réseaux privés**.
6. Sur le téléphone, connecté au **même Wi-Fi** : scannez le QR code avec l'appareil photo, ou tapez l'adresse dans Chrome.
7. Choisissez un rôle. Pour signer, le code est 000000.

Facultatif : menu ⋮ de Chrome → « Ajouter à l'écran d'accueil » crée un raccourci. L'installation complète en application (notifications, hors connexion) exige une adresse en `https`, donc un hébergement (Docker ci-dessous).

**En cas de problème :**
- **La page ne s'ouvre pas** : vérifiez que le téléphone est sur le même Wi-Fi (pas en 4G/5G) et que le terminal est toujours ouvert. Les réseaux Wi-Fi « invités » ou publics isolent souvent les appareils entre eux : utilisez le Wi-Fi de la maison ou le partage de connexion du téléphone.
- **Plusieurs adresses affichées** : essayez-les une à une ; c'est souvent celle qui commence par `192.168.`.
- **Arrêter la démo** : Ctrl + C dans le terminal.

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
