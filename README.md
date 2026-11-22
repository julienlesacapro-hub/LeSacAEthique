<p align="center"><img src="assets/logo-1024.png" width="128" alt="Logo : un sac en cuir d'où sort un avis du comité (balance et loupe)"></p>

# LeSacAEthique

Outil d'échanges sécurisés du **CER-PROMEDNAV**, comité d'éthique de la recherche de l'association PROMEDNAV.

- Le **site internet** de l'association reçoit les demandes d'avis (formulaire de saisine, pièces de l'annexe 3 du règlement intérieur).
- Dès le dépôt, les **membres sont notifiés** : dans l'application, par courriel et, s'ils l'activent, par notification push.
- Les membres **lisent tous les documents** et **commentent**. Les autres membres répondent ou complètent. Un commentaire n'est **jamais modifiable ni supprimable**. Chaque commentaire porte le nom et la qualité de son auteur, un horodatage et une signature du serveur.
- Un **administrateur** crée les comptes et règle les droits : *lecture seule*, *lecture et écriture* ou *administrateur*.
- Chaque membre choisit son mot de passe et le **réinitialise lui-même** en cas de perte. La **double authentification** est obligatoire.
- Les documents sont stockés **sur le serveur de l'association**, chiffrés.
- **Instruction et délibération** (règlement intérieur, art. 28 à 34) :
  - désignation des rapporteurs (deux, dont au moins un non professionnel de santé) ;
  - votes en séance ou par voie électronique, en procédure ordinaire ou simplifiée, avec suppléants, quorum, majorité et bulletin secret ;
  - **contrôle de non-altération obligatoire avant toute validation de vote** ;
  - procès-verbaux, avis bilingues selon l'annexe 7 et rapport annuel, en PDF ;
  - **votes signés** par une nouvelle saisie du code de double authentification, avec reçu remis au membre ;
  - **avis signé à la main** par le président, puis numérisé et versé avec contrôle du code de vérification. Le versement clôt et archive le dossier en lecture seule et produit un relevé de clôture ;
  - **procédure d'appel** dans les 3 mois, avec reprise automatique du dossier initial (documents, avis, échanges avec l'identité de leurs auteurs). Hors délai, la demande est traitée comme une nouvelle demande complète ;
  - **courriel au porteur** sur décision du président, modifiable et envoyé depuis l'adresse du comité ; le texte exact est conservé ;
  - signature électronique qualifiée possible plus tard (dépôt de la version signée, déjà programmé).
- **Gouvernance de l'outil** : l'administrateur est le président du comité, suppléé par le vice-président. Personne ne connaît les mots de passe. Un membre peut se déporter d'un dossier pour conflit d'intérêts.

Une seule interface sert tous les appareils :

| Support | Comment |
|---|---|
| Ordinateur (navigateur) | ouvrir l'adresse du serveur |
| Ordinateur (application) | `desktop/` : Electron pour Windows, macOS et Linux |
| Téléphone et tablette Android, iPhone, iPad | installation depuis le navigateur (PWA, **recommandé**) ou applications natives `mobile/` (Capacitor) |

## Architecture

```
Site de l'association ──(formulaire, HTTPS)──►  Serveur du comité (Node.js)
                                                ├─ API REST + authentification 2FA
                                                ├─ SQLite (dossiers, commentaires, journal)
                                                └─ documents chiffrés AES-256-GCM
Membres : navigateur / PWA / Electron / Capacitor ──(HTTPS)──►
```

| Dossier | Contenu |
|---|---|
| `server/` | API, base de données, sécurité, notifications, tests (`npm test`) |
| `client/` | application des membres : PWA responsive, sans dépendance |
| `site-integration/` | formulaire public de saisine, à intégrer au site |
| `desktop/` | application de bureau Electron |
| `mobile/` | applications Android et iOS (Capacitor) |
| `deploy/` | Docker, proxy HTTPS (Caddy), service systemd, sauvegarde chiffrée |
| `docs/` | [installation](docs/INSTALLATION.md), [guide des membres](docs/GUIDE_MEMBRES.md), [sécurité, conformité et limites](docs/CONFORMITE_ET_LIMITES.md), [propositions pour le règlement intérieur](docs/PROPOSITION_REGLEMENT_INTERIEUR.md) (+ .docx), [signature électronique qualifiée](docs/SIGNATURE_QUALIFIEE.md) (+ .docx) |
| `design/`, `tools/` | logo selon la charte LeSacA (sac de LeSacAPDF) et son générateur (`node tools/make-icons.js`) |

## Démarrage rapide (essai local)

```bash
cd server
npm ci
npm test                                   # 43 tests : 2FA, droits, immuabilité, falsification, déport, votes, quorum, avis, signature…
npm run create-admin -- --email vous@exemple.fr --name "Prénom Nom" --quality "Président du CER"
npm start                                  # http://localhost:8443
```

Ouvrez le lien d'activation affiché, choisissez un mot de passe, puis scannez le QR code avec une application d'authentification. Le formulaire public est servi sur `http://localhost:8443/formulaire/`.

Pour la mise en production, suivez [docs/INSTALLATION.md](docs/INSTALLATION.md).
