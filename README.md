<p align="center"><img src="assets/logo.svg" width="120" alt="Logo LeSacAEthique"></p>

# LeSacAEthique

Outil d'échanges sécurisés du **CER-PROMEDNAV**, comité d'éthique de la recherche de l'association PROMEDNAV.

- Le **site internet** de l'association reçoit les demandes d'avis (formulaire de saisine, pièces de l'annexe 3 du règlement intérieur).
- Dès le dépôt, les **membres sont notifiés** : dans l'application, par courriel et, s'ils l'activent, par notification push.
- Les membres **lisent tous les documents** et **commentent**. Les autres membres répondent ou complètent. Un commentaire n'est **jamais modifiable ni supprimable**. Chaque commentaire porte le nom et la qualité de son auteur, un horodatage et une signature du serveur.
- Un **administrateur** crée les comptes et règle les droits : *lecture seule*, *lecture et écriture* ou *administrateur*.
- Chaque membre choisit son mot de passe et le **réinitialise lui-même** en cas de perte. La **double authentification** est obligatoire.
- Les documents sont stockés **sur le serveur de l'association**, chiffrés.

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
| `docs/` | [installation](docs/INSTALLATION.md), [guide des membres](docs/GUIDE_MEMBRES.md), [sécurité, conformité et limites](docs/CONFORMITE_ET_LIMITES.md) |

## Démarrage rapide (essai local)

```bash
cd server
npm ci
npm test                                   # 17 tests : 2FA, droits, immuabilité, falsification, déport…
npm run create-admin -- --email vous@exemple.fr --name "Prénom Nom" --quality "Président du CER"
npm start                                  # http://localhost:8443
```

Ouvrez le lien d'activation affiché, choisissez un mot de passe, puis scannez le QR code avec une application d'authentification. Le formulaire public est servi sur `http://localhost:8443/formulaire/`.

Pour la mise en production, suivez [docs/INSTALLATION.md](docs/INSTALLATION.md).
