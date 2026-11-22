'use strict';
/**
 * Connexion, double authentification, activation de compte (invitation),
 * réinitialisation autonome des identifiants par le membre.
 */
const express = require('express');
const crypto = require('crypto');
const QRCode = require('qrcode');
const db = require('../db');
const config = require('../config');
const sec = require('../security');
const totp = require('../totp');
const audit = require('../audit');
const mailer = require('../mailer');
const { createSession, revokeAll, requireSession, publicUser } = require('../auth');

const router = express.Router();
const q = () => db.get();
const getUser = (id) => q().prepare('SELECT * FROM users WHERE id = ?').get(id);

// Factice : temps de calcul constant même si l'adresse n'existe pas
const DUMMY_HASH = sec.hashPassword(crypto.randomBytes(16).toString('hex'));

function registerFailure(user, req, what) {
  audit.log('connexion_echec', { userId: user ? user.id : null, target: user ? user.email : '', ip: req.ip, details: what });
  if (!user) return;
  const attempts = user.failed_attempts + 1;
  const lock = attempts >= config.lockout.maxAttempts ? Date.now() + config.lockout.minutes * 60e3 : 0;
  q().prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?')
    .run(lock ? 0 : attempts, lock || user.locked_until, user.id);
  if (lock) audit.log('compte_verrouille', { userId: user.id, ip: req.ip, details: `${config.lockout.minutes} min` });
}

const isLocked = (u) => u && u.locked_until > Date.now();
const lockedMsg = () => `Compte temporairement verrouillé après ${config.lockout.maxAttempts} échecs. Réessayez dans ${config.lockout.minutes} minutes.`;

function genRecoveryCodes() {
  const codes = [];
  for (let i = 0; i < 10; i++) {
    const raw = totp.base32Encode(crypto.randomBytes(7)).slice(0, 10);
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return codes;
}
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z2-7]/g, '');

/** Vérifie un code TOTP ou un code de secours (consommé). */
function checkSecondFactor(user, code) {
  if (user.totp_enabled && user.totp_secret) {
    const step = totp.verify(sec.decryptText(user.totp_secret), String(code || '').trim(), user.totp_last_step);
    if (step > 0) {
      q().prepare('UPDATE users SET totp_last_step = ? WHERE id = ?').run(step, user.id);
      return 'totp';
    }
  }
  const n = normCode(code);
  if (n.length === 10) {
    const list = JSON.parse(user.recovery_codes || '[]');
    const h = sec.sha256(n);
    const idx = list.indexOf(h);
    if (idx >= 0) {
      list.splice(idx, 1);
      q().prepare('UPDATE users SET recovery_codes = ? WHERE id = ?').run(JSON.stringify(list), user.id);
      return 'secours';
    }
  }
  return null;
}

function loginSucceeded(user, req) {
  q().prepare('UPDATE users SET failed_attempts = 0, locked_until = 0, last_login_at = ? WHERE id = ?').run(Date.now(), user.id);
  audit.log('connexion', { userId: user.id, ip: req.ip, details: String(req.get('user-agent') || '').slice(0, 120) });
}

// ---------- Étape 1 : identifiant + mot de passe ----------
router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = q().prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim());
  if (isLocked(user)) return res.status(429).json({ error: lockedMsg() });
  const ok = sec.verifyPassword(String(password || ''), user && user.password_hash ? user.password_hash : DUMMY_HASH);
  if (!user || !ok || !user.password_hash) {
    registerFailure(user, req, 'mot de passe');
    return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect' });
  }
  if (user.status !== 'actif') {
    audit.log('connexion_refusee', { userId: user.id, ip: req.ip, details: user.status });
    return res.status(403).json({ error: 'Compte suspendu ou non activé. Contactez un administrateur.' });
  }
  const stage = user.totp_enabled ? 'mfa' : 'enroll';
  res.json({ token: createSession(user, stage, req), stage });
});

// ---------- Étape 2 : code de double authentification ----------
router.post('/mfa', requireSession(['mfa']), (req, res) => {
  const user = req.user;
  if (isLocked(user)) return res.status(429).json({ error: lockedMsg() });
  const how = checkSecondFactor(user, (req.body || {}).code);
  if (!how) {
    registerFailure(user, req, 'second facteur');
    return res.status(401).json({ error: 'Code invalide' });
  }
  q().prepare('DELETE FROM sessions WHERE id = ?').run(req.session.id);
  loginSucceeded(user, req);
  if (how === 'secours') audit.log('code_secours_utilise', { userId: user.id, ip: req.ip });
  const fresh = getUser(user.id);
  res.json({ token: createSession(fresh, 'full', req), stage: 'full', user: publicUser(fresh), usedRecoveryCode: how === 'secours' });
});

// ---------- Configuration de la double authentification ----------
router.post('/enroll/start', requireSession(['enroll', 'full']), async (req, res) => {
  const user = req.user;
  if (user.totp_enabled && req.session.stage !== 'full') return res.status(400).json({ error: 'Déjà configurée' });
  if (req.session.stage === 'full' && user.totp_enabled) {
    // Changement d'appareil : exige le code actuel
    if (!checkSecondFactor(user, (req.body || {}).code)) return res.status(401).json({ error: 'Code actuel requis pour changer d’appareil' });
  }
  const secret = totp.generateSecret();
  // Le secret en attente est stocké chiffré ; il n'est activé qu'après confirmation.
  q().prepare('UPDATE users SET totp_secret = ?, totp_enabled = 0, totp_last_step = 0 WHERE id = ?')
    .run(sec.encryptText(secret), user.id);
  if (req.session.stage === 'full') {
    // L'ancien appareil est invalidé : la session repasse en configuration.
    q().prepare("UPDATE sessions SET stage = 'enroll', expires_at = ? WHERE id = ?").run(Date.now() + 10 * 60e3, req.session.id);
  }
  const url = totp.otpauthUrl(secret, user.email, config.committeeName);
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 240 });
  res.json({ secret, otpauth: url, qr });
});

router.post('/enroll/confirm', requireSession(['enroll']), (req, res) => {
  const user = req.user;
  if (!user.totp_secret) return res.status(400).json({ error: 'Commencez la configuration' });
  const step = totp.verify(sec.decryptText(user.totp_secret), String((req.body || {}).code || '').trim(), 0);
  if (step < 0) return res.status(401).json({ error: 'Code invalide. Vérifiez l’heure de votre téléphone.' });
  const codes = genRecoveryCodes();
  q().prepare('UPDATE users SET totp_enabled = 1, totp_last_step = ?, recovery_codes = ? WHERE id = ?')
    .run(step, JSON.stringify(codes.map((c) => sec.sha256(normCode(c)))), user.id);
  q().prepare('DELETE FROM sessions WHERE id = ?').run(req.session.id);
  audit.log('double_authentification_activee', { userId: user.id, ip: req.ip });
  loginSucceeded(user, req);
  const fresh = getUser(user.id);
  res.json({ token: createSession(fresh, 'full', req), stage: 'full', recoveryCodes: codes, user: publicUser(fresh) });
});

// ---------- Activation du compte (lien d'invitation envoyé par l'administrateur) ----------
function consumeToken(raw, type) {
  const t = q().prepare('SELECT * FROM tokens WHERE token_hash = ? AND type = ?').get(sec.sha256(String(raw || '')), type);
  if (!t || t.used_at || t.expires_at < Date.now()) return null;
  return t;
}

router.post('/activate', (req, res) => {
  const { token, password } = req.body || {};
  const t = consumeToken(token, 'invite');
  if (!t) return res.status(400).json({ error: 'Lien d’invitation invalide ou expiré. Demandez-en un nouveau à l’administrateur.' });
  const problems = sec.passwordProblems(password);
  if (problems.length) return res.status(400).json({ error: `Le mot de passe doit contenir ${problems.join(', ')}.` });
  q().transaction(() => {
    q().prepare('UPDATE tokens SET used_at = ? WHERE id = ?').run(Date.now(), t.id);
    q().prepare("UPDATE users SET password_hash = ?, status = 'actif', totp_enabled = 0, totp_secret = NULL, failed_attempts = 0, locked_until = 0 WHERE id = ?")
      .run(sec.hashPassword(password), t.user_id);
  })();
  const user = getUser(t.user_id);
  audit.log('compte_active', { userId: user.id, ip: req.ip });
  res.json({ token: createSession(user, 'enroll', req), stage: 'enroll', email: user.email });
});

// ---------- Identifiants perdus : réinitialisation par le membre lui-même ----------
router.post('/forgot', async (req, res) => {
  const email = String((req.body || {}).email || '').trim();
  const user = q().prepare('SELECT * FROM users WHERE email = ?').get(email);
  // Réponse identique que l'adresse existe ou non (pas d'énumération des comptes)
  res.json({ ok: true, message: 'Si cette adresse correspond à un compte actif, un lien de réinitialisation vient d’être envoyé.' });
  if (!user || user.status !== 'actif') return;
  const raw = sec.randomToken();
  q().prepare('INSERT INTO tokens (user_id, type, token_hash, expires_at) VALUES (?,?,?,?)')
    .run(user.id, 'reset', sec.sha256(raw), Date.now() + config.resetMinutes * 60e3);
  audit.log('reinitialisation_demandee', { userId: user.id, ip: req.ip });
  await mailer.send({
    to: user.email,
    subject: 'Réinitialisation de votre mot de passe',
    text: `Bonjour ${user.full_name},\n\nUne réinitialisation de votre mot de passe ${config.appName} a été demandée.\n\nLien valable ${config.resetMinutes} minutes :\n${config.publicUrl}/#/reinitialiser?jeton=${raw}\n\nVous devrez saisir un code de votre application d'authentification (ou un code de secours).\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message et prévenez l'administrateur.\n`,
  });
});

router.post('/reset', (req, res) => {
  const { token, password, code } = req.body || {};
  const t = consumeToken(token, 'reset');
  if (!t) return res.status(400).json({ error: 'Lien invalide ou expiré' });
  const user = getUser(t.user_id);
  if (!user || user.status !== 'actif') return res.status(400).json({ error: 'Compte inactif' });
  if (isLocked(user)) return res.status(429).json({ error: lockedMsg() });
  const problems = sec.passwordProblems(password);
  if (problems.length) return res.status(400).json({ error: `Le mot de passe doit contenir ${problems.join(', ')}.` });
  // La réinitialisation exige AUSSI le second facteur : l'accès à la seule
  // messagerie ne suffit pas à prendre le contrôle du compte.
  if (user.totp_enabled && !checkSecondFactor(user, code)) {
    registerFailure(user, req, 'second facteur (réinitialisation)');
    return res.status(401).json({ error: 'Code de double authentification ou code de secours invalide. Si vous avez perdu les deux, contactez un administrateur.' });
  }
  q().transaction(() => {
    q().prepare('UPDATE tokens SET used_at = ? WHERE id = ?').run(Date.now(), t.id);
    q().prepare('UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = 0 WHERE id = ?').run(sec.hashPassword(password), user.id);
  })();
  revokeAll(user.id);
  audit.log('mot_de_passe_reinitialise', { userId: user.id, ip: req.ip });
  mailer.send({ to: user.email, subject: 'Mot de passe modifié', text: `Bonjour ${user.full_name},\n\nVotre mot de passe vient d'être réinitialisé. Si ce n'est pas vous, prévenez immédiatement l'administrateur.\n` });
  res.json({ ok: true });
});

// ---------- Compte connecté ----------
router.get('/me', requireSession(['full']), (req, res) => res.json({ user: publicUser(req.user) }));

router.post('/logout', requireSession(['mfa', 'enroll', 'full']), (req, res) => {
  q().prepare('DELETE FROM sessions WHERE id = ?').run(req.session.id);
  audit.fromReq(req, 'deconnexion');
  res.json({ ok: true });
});

router.post('/password', requireSession(['full']), (req, res) => {
  const { current, password } = req.body || {};
  if (!sec.verifyPassword(String(current || ''), req.user.password_hash)) return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
  const problems = sec.passwordProblems(password);
  if (problems.length) return res.status(400).json({ error: `Le mot de passe doit contenir ${problems.join(', ')}.` });
  q().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(sec.hashPassword(password), req.user.id);
  q().prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').run(req.user.id, req.session.id);
  audit.fromReq(req, 'mot_de_passe_modifie');
  res.json({ ok: true });
});

router.post('/recovery-codes', requireSession(['full']), (req, res) => {
  if (!checkSecondFactor(req.user, (req.body || {}).code)) return res.status(401).json({ error: 'Code invalide' });
  const codes = genRecoveryCodes();
  q().prepare('UPDATE users SET recovery_codes = ? WHERE id = ?').run(JSON.stringify(codes.map((c) => sec.sha256(normCode(c)))), req.user.id);
  audit.fromReq(req, 'codes_secours_regeneres');
  res.json({ recoveryCodes: codes });
});

router.patch('/preferences', requireSession(['full']), (req, res) => {
  const b = req.body || {};
  q().prepare('UPDATE users SET notify_email = ?, notify_comments = ? WHERE id = ?')
    .run(b.notify_email ? 1 : 0, b.notify_comments ? 1 : 0, req.user.id);
  res.json({ user: publicUser(getUser(req.user.id)) });
});

module.exports = router;
module.exports._internal = { checkSecondFactor, genRecoveryCodes };
