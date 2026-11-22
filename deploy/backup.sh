#!/usr/bin/env bash
# Sauvegarde chiffrée quotidienne (règlement intérieur, art. 40 : sauvegardes chiffrées,
# copie hors site). À planifier par cron : 15 2 * * * /opt/lesacaethique/deploy/backup.sh
# Prérequis : sqlite3, gpg ; BACKUP_PASSPHRASE_FILE lisible par root seulement.
set -euo pipefail
DATA_DIR="${DATA_DIR:-/var/lib/lesacaethique/data}"
DEST="${BACKUP_DIR:-/var/backups/lesacaethique}"
PASS="${BACKUP_PASSPHRASE_FILE:-/etc/lesacaethique/backup.pass}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DEST"; TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
sqlite3 "$DATA_DIR/lesacaethique.sqlite" ".backup '$TMP/lesacaethique.sqlite'"   # copie cohérente à chaud
cp -a "$DATA_DIR/files" "$TMP/files"                                             # documents (déjà chiffrés AES-256-GCM)
tar -C "$TMP" -czf - . | gpg --batch --yes --pinentry-mode loopback --passphrase-file "$PASS" --symmetric --cipher-algo AES256 -o "$DEST/lesaca-$STAMP.tar.gz.gpg"
find "$DEST" -name 'lesaca-*.tar.gz.gpg' -mtime +35 -delete
echo "Sauvegarde : $DEST/lesaca-$STAMP.tar.gz.gpg"
# Les CLÉS (KEYS_DIR) se sauvegardent À PART (coffre, support hors ligne), jamais avec ces archives.
