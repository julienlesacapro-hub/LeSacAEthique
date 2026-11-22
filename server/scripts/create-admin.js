#!/usr/bin/env node
'use strict';
/**
 * Crée le premier administrateur (à exécuter sur le serveur).
 *   npm run create-admin -- --email president@exemple.fr --name "Prénom Nom" --quality "Président du CER"
 * Affiche le lien d'activation (mot de passe + double authentification).
 */
const db = require('../src/db');
const sec = require('../src/security');
const config = require('../src/config');
const audit = require('../src/audit');

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
if (!args.email || !args.name) {
  console.error('Usage : npm run create-admin -- --email <adresse> --name "<Prénom Nom>" [--quality "<qualité>"]');
  process.exit(1);
}
db.open();
const email = args.email.trim().toLowerCase();
let user = db.get().prepare('SELECT * FROM users WHERE email = ?').get(email);
if (!user) {
  const r = db.get().prepare("INSERT INTO users (email, full_name, quality, role, status, created_at) VALUES (?,?,?,'admin','invite',?)")
    .run(email, args.name, args.quality || 'Administrateur', Date.now());
  user = db.get().prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
} else {
  db.get().prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(user.id);
}
const raw = sec.randomToken();
db.get().prepare("INSERT INTO tokens (user_id, type, token_hash, expires_at) VALUES (?, 'invite', ?, ?)")
  .run(user.id, sec.sha256(raw), Date.now() + config.inviteHours * 3600e3);
audit.log('administrateur_cree_console', { userId: user.id, target: email });
console.log(`Administrateur : ${email}\nLien d'activation (valable ${config.inviteHours} h) :\n${config.publicUrl}/#/activer?jeton=${raw}`);
