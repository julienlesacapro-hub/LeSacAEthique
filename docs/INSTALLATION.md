# Installation sur le serveur de l'association

## 1. Prérequis

- Un serveur Linux (Debian 12 ou Ubuntu 24.04 par exemple), hébergé en France ou dans l'Union européenne. Il doit rester **distinct du serveur du registre** (règlement intérieur, art. 59.4).
- Un nom de domaine dédié, par exemple `cer.promednav.fr`, qui pointe vers ce serveur.
- Un compte SMTP pour l'envoi des courriels (invitations, notifications, réinitialisations).
- Docker et Docker Compose (méthode A) ou Node.js 22 (méthode B).

## 2. Méthode A : Docker (recommandée)

```bash
git clone <dépôt> /opt/lesacaethique && cd /opt/lesacaethique
cp server/.env.example deploy/.env
nano deploy/.env            # PUBLIC_URL, PUBLIC_FORM_ORIGINS, SMTP_*, etc.
echo "DOMAIN=cer.promednav.fr" >> deploy/.env
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
docker compose -f deploy/docker-compose.yml exec app node server/scripts/create-admin.js \
  --email president@promednav.com --name "Prénom Nom" --quality "Président du CER-PROMEDNAV"
```

Caddy obtient et renouvelle seul le certificat HTTPS (Let's Encrypt).

## 3. Méthode B : sans Docker

```bash
sudo useradd --system lesaca
sudo mkdir -p /var/lib/lesacaethique/data /etc/lesacaethique/keys
sudo chown -R lesaca /var/lib/lesacaethique /etc/lesacaethique/keys && sudo chmod 700 /etc/lesacaethique/keys
cd /opt/lesacaethique/server && npm ci --omit=dev
cp .env.example .env && nano .env
sudo cp ../deploy/lesacaethique.service /etc/systemd/system/
sudo systemctl enable --now lesacaethique
sudo -u lesaca node scripts/create-admin.js --email … --name "…"
```

Placez ensuite un proxy HTTPS devant le port 8443 : Caddy, ou nginx avec certbot.

## 4. Clés et sauvegardes

Au premier démarrage, le serveur crée dans `KEYS_DIR` :

- `data-encryption.key` : chiffre les documents et les secrets de double authentification ;
- `signing-ed25519.pem` : signe les commentaires (la clé publique est dans `signing-ed25519.pub.pem`).

**Sans ces clés, les documents sont illisibles.** Sauvegardez-les **à part** (coffre, support hors ligne), jamais avec les données.

Sauvegarde quotidienne chiffrée : `deploy/backup.sh`, à planifier avec cron (voir l'en-tête du script). Après chaque test de restauration, lancez :

```bash
npm run verify     # contrôle la chaîne des commentaires et l'intégrité de chaque document
```

## 5. Intégrer le formulaire au site de l'association

Deux possibilités :

1. **Cadre intégré (le plus simple).** Ajoutez dans une page du site :
   ```html
   <iframe src="https://cer.promednav.fr/formulaire/" title="Saisine du CER-PROMEDNAV"
           style="width:100%;min-height:1800px;border:0"></iframe>
   ```
   Le domaine du site doit figurer dans `PUBLIC_FORM_ORIGINS`.
2. **Copie sur le site.** Copiez `formulaire-saisine.html`, `formulaire.js`, `formulaire.css` et `logo.png`, puis remplacez `data-endpoint="/api/public/submissions"` par `https://cer.promednav.fr/api/public/submissions`.

Dans les deux cas, le site ne stocke rien : les fichiers partent directement vers le serveur du comité.

## 6. Notifications push (facultatif)

```bash
cd server && npx web-push generate-vapid-keys
```

Reportez les deux clés dans `VAPID_PUBLIC_KEY` et `VAPID_PRIVATE_KEY`, puis redémarrez. Chaque membre active ensuite les notifications depuis « Mon compte ».

## 7. Applications

**Téléphones et tablettes (recommandé : PWA).** Ouvrir l'adresse du serveur, puis :

- Android (Chrome) : menu ⋮ → « Installer l'application » ;
- iPhone/iPad (Safari) : Partager → « Sur l'écran d'accueil ».

Pas de magasin d'applications, pas de compte développeur, mises à jour immédiates. Sur iOS/iPadOS, les notifications push ne fonctionnent qu'une fois l'application ajoutée à l'écran d'accueil (iOS 16.4 ou ultérieur).

**Applications natives (facultatif).**

```bash
cd mobile && npm install && npx cap add android && npx cap add ios
npm run android      # ouvre Android Studio
npm run ios          # ouvre Xcode (Mac obligatoire)
```

Il faut un compte Google Play Console et/ou un compte Apple Developer Program. Pour un usage interne, voir la distribution privée dans [CONFORMITE_ET_LIMITES.md](CONFORMITE_ET_LIMITES.md).

**Ordinateur.**

```bash
cd desktop && npm install && npm run dist    # installateur Windows (.exe), macOS (.dmg) ou Linux (.AppImage)
```

Au premier lancement, l'application demande l'adresse du serveur.
