'use strict';
/**
 * Administration des membres : création (invitation), droits
 * (lecture seule / lecture et écriture / administrateur), suspension,
 * réinitialisation de la double authentification, journal d'audit.
 */
const express = require('express');
const db = require('../db');
const config = require('../config');
const sec = require('../security');
const audit = require('../audit');
const mailer = require('../mailer');
const domain = require('../domain');
const { requireSession, requireRole, revokeAll, publicUser } = require('../auth');

const router = express.Router();
const q = () => db.get();
router.use(requireSession(['full']), requireRole('admin'));

const ROLES = ['lecture', 'ecriture', 'admin'];
const gov = require('../governance');
const FONCTIONS = Object.keys(gov.FONCTIONS);
const adminAllowed = (f) => config.adminFunctions.includes(f);
const ADMIN_RULE = () => `Le rôle administrateur est réservé à : ${config.adminFunctions.map((f) => gov.FONCTIONS[f]).join(', ')} (règlement intérieur)`;
const ROLE_LABEL = { lecture: 'lecture seule', ecriture: 'lecture et écriture', admin: 'administrateur' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function sendInvitation(user, req) {
  q().prepare("UPDATE tokens SET used_at = ? WHERE user_id = ? AND type = 'invite' AND used_at IS NULL").run(Date.now(), user.id);
  const raw = sec.randomToken();
  q().prepare('INSERT INTO tokens (user_id, type, token_hash, expires_at) VALUES (?,?,?,?)')
    .run(user.id, 'invite', sec.sha256(raw), Date.now() + config.inviteHours * 3600e3);
  const link = `${config.publicUrl}/#/activer?jeton=${raw}`;
  await mailer.send({
    to: user.email,
    subject: 'Votre accès au comité d’éthique',
    text: `Bonjour ${user.full_name},\n\n${req.user.full_name} vous a ouvert un accès à ${config.appName}, l'outil d'échanges du ${config.committeeName} (${config.committeeLongName}).\n\nVotre identifiant : ${user.email}\nVos droits : ${ROLE_LABEL[user.role]}\n\nPour choisir votre mot de passe et configurer la double authentification, ouvrez ce lien (valable ${config.inviteHours} heures) :\n${link}\n\nVous aurez besoin d'une application d'authentification sur votre téléphone (par exemple FreeOTP, Aegis, Google Authenticator ou Microsoft Authenticator).\n`,
  });
  return link;
}

router.get('/', (req, res) => {
  const users = q().prepare('SELECT * FROM users ORDER BY status, full_name').all().map(publicUser);
  res.json({ users });
});

router.post('/', async (req, res) => {
  const b = req.body || {};
  const email = String(b.email || '').trim().toLowerCase();
  const full_name = String(b.full_name || '').trim();
  const quality = String(b.quality || '').trim().slice(0, 120);
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Adresse électronique invalide' });
  if (full_name.length < 2) return res.status(400).json({ error: 'Nom complet requis (il signe les commentaires)' });
  if (!ROLES.includes(b.role)) return res.status(400).json({ error: 'Rôle invalide' });
  const fonction = b.fonction || 'titulaire';
  if (!FONCTIONS.includes(fonction)) return res.status(400).json({ error: 'Fonction invalide' });
  if (b.role === 'admin' && !adminAllowed(fonction)) return res.status(400).json({ error: ADMIN_RULE() });
  if (q().prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return res.status(409).json({ error: 'Cette adresse est déjà utilisée' });
  const r = q().prepare(`INSERT INTO users (email, full_name, quality, role, fonction, health_professional, independent, status, created_at, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(email, full_name, quality, b.role, fonction, b.health_professional === false ? 0 : 1, b.independent ? 1 : 0, 'invite', Date.now(), req.user.id);
  const user = q().prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
  const link = await sendInvitation(user, req);
  audit.fromReq(req, 'membre_cree', email, { role: b.role });
  // Le lien n'est renvoyé qu'en l'absence de SMTP, pour le transmettre par un canal sûr.
  res.status(201).json({ user: publicUser(user), invitationLink: config.smtp.host ? undefined : link });
});

router.patch('/:id', (req, res) => {
  const user = q().prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Membre introuvable' });
  const b = req.body || {};
  const changes = {};
  if (b.role !== undefined) {
    if (!ROLES.includes(b.role)) return res.status(400).json({ error: 'Rôle invalide' });
    changes.role = b.role;
  }
  if (b.status !== undefined) {
    if (!['actif', 'suspendu'].includes(b.status)) return res.status(400).json({ error: 'Statut invalide' });
    if (b.status === 'actif' && !user.password_hash) return res.status(400).json({ error: 'Le membre doit d’abord activer son compte' });
    changes.status = b.status;
  }
  if (b.quality !== undefined) changes.quality = String(b.quality).trim().slice(0, 120);
  if (b.fonction !== undefined) {
    if (!FONCTIONS.includes(b.fonction)) return res.status(400).json({ error: 'Fonction invalide' });
    changes.fonction = b.fonction;
  }
  if (b.health_professional !== undefined) changes.health_professional = b.health_professional ? 1 : 0;
  if (b.independent !== undefined) changes.independent = b.independent ? 1 : 0;
  const nextRole = changes.role || user.role; const nextFn = changes.fonction || user.fonction;
  if (nextRole === 'admin' && !adminAllowed(nextFn)) return res.status(400).json({ error: ADMIN_RULE() });
  if (b.full_name !== undefined) {
    if (String(b.full_name).trim().length < 2) return res.status(400).json({ error: 'Nom invalide' });
    changes.full_name = String(b.full_name).trim();
  }
  // Garde-fou : il doit toujours rester au moins un administrateur actif.
  const demotes = (changes.role && changes.role !== 'admin') || changes.status === 'suspendu';
  if (user.role === 'admin' && demotes) {
    const { n } = q().prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin' AND status = 'actif' AND id <> ?").get(user.id);
    if (n === 0) return res.status(400).json({ error: 'Impossible : il doit rester au moins un administrateur actif' });
  }
  const keys = Object.keys(changes);
  if (!keys.length) return res.json({ user: publicUser(user) });
  q().prepare(`UPDATE users SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...changes, id: user.id });
  if (changes.status === 'suspendu' || changes.role) revokeAll(user.id);
  audit.fromReq(req, 'membre_modifie', user.email, changes);
  res.json({ user: publicUser(q().prepare('SELECT * FROM users WHERE id = ?').get(user.id)) });
});

router.post('/:id/invitation', async (req, res) => {
  const user = q().prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Membre introuvable' });
  if (user.status === 'suspendu') return res.status(400).json({ error: 'Membre suspendu' });
  // Ré-invitation = nouvelle activation : mot de passe et double authentification à redéfinir.
  q().prepare("UPDATE users SET password_hash = NULL, totp_enabled = 0, totp_secret = NULL, status = 'invite', recovery_codes = '[]' WHERE id = ?").run(user.id);
  revokeAll(user.id);
  const link = await sendInvitation(user, req);
  audit.fromReq(req, 'invitation_renvoyee', user.email);
  res.json({ ok: true, invitationLink: config.smtp.host ? undefined : link });
});

// Le membre a perdu son téléphone ET ses codes de secours.
router.post('/:id/reset-2fa', (req, res) => {
  const user = q().prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Membre introuvable' });
  q().prepare("UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_last_step = 0, recovery_codes = '[]' WHERE id = ?").run(user.id);
  revokeAll(user.id);
  audit.fromReq(req, 'double_authentification_reinitialisee', user.email);
  mailer.send({ to: user.email, subject: 'Double authentification réinitialisée', text: `Bonjour ${user.full_name},\n\nUn administrateur a réinitialisé votre double authentification. À votre prochaine connexion, vous devrez la configurer à nouveau. Si vous n'avez rien demandé, prévenez immédiatement le secrétariat.\n` });
  res.json({ ok: true });
});

router.get('/audit/log', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '200', 10) || 200, 1000);
  const rows = q().prepare(`SELECT a.*, u.full_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
    ORDER BY a.id DESC LIMIT ?`).all(limit);
  res.json({ entries: rows });
});

router.get('/audit/integrity', (req, res) => {
  const r = domain.recordIntegrityCheck(req.user.id, 'Contrôle périodique');
  audit.fromReq(req, 'verification_integrite', '', { ok: r.ok, comments: r.comments, documents: r.documents, controle: r.checkId });
  res.json({ ...r, publicKey: sec.publicKeyPem() });
});

module.exports = router;
