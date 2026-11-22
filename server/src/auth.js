'use strict';
/**
 * Sessions et contrôle d'accès.
 *
 * Une session passe par trois étapes :
 *   'mfa'    : mot de passe vérifié, code de double authentification attendu ;
 *   'enroll' : mot de passe vérifié, double authentification à configurer ;
 *   'full'   : accès complet.
 * Le jeton est transmis dans l'en-tête « Authorization: Bearer … ». Seule
 * son empreinte SHA-256 est conservée en base.
 */
const db = require('./db');
const config = require('./config');
const sec = require('./security');

const PENDING_MINUTES = 10;

function createSession(user, stage, req) {
  const token = sec.randomToken();
  const now = Date.now();
  const expires = stage === 'full'
    ? now + config.session.absoluteHours * 3600e3
    : now + PENDING_MINUTES * 60e3;
  db.get().prepare(`INSERT INTO sessions (token_hash, user_id, stage, created_at, last_seen_at, expires_at, ip, user_agent)
    VALUES (?,?,?,?,?,?,?,?)`).run(sec.sha256(token), user.id, stage, now, now, expires, req.ip || '', String(req.get('user-agent') || '').slice(0, 300));
  return token;
}

function revokeAll(userId) {
  db.get().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

function readToken(req) {
  const h = req.get('authorization') || '';
  const m = h.match(/^Bearer\s+([A-Za-z0-9_-]{20,})$/);
  return m ? m[1] : null;
}

/** Middleware : exige une session valide à l'une des étapes indiquées. */
function requireSession(stages = ['full']) {
  return (req, res, next) => {
    const token = readToken(req);
    if (!token) return res.status(401).json({ error: 'Authentification requise' });
    const s = db.get().prepare('SELECT * FROM sessions WHERE token_hash = ?').get(sec.sha256(token));
    const now = Date.now();
    if (!s || s.expires_at < now || (s.stage === 'full' && now - s.last_seen_at > config.session.idleMinutes * 60e3)) {
      if (s) db.get().prepare('DELETE FROM sessions WHERE id = ?').run(s.id);
      return res.status(401).json({ error: 'Session expirée, veuillez vous reconnecter' });
    }
    if (!stages.includes(s.stage)) return res.status(403).json({ error: 'Étape d’authentification incomplète', stage: s.stage });
    const user = db.get().prepare('SELECT * FROM users WHERE id = ?').get(s.user_id);
    if (!user || user.status !== 'actif') {
      db.get().prepare('DELETE FROM sessions WHERE id = ?').run(s.id);
      return res.status(401).json({ error: 'Compte inactif' });
    }
    db.get().prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(now, s.id);
    req.session = s;
    req.user = user;
    next();
  };
}

const ROLE_RANK = { lecture: 1, ecriture: 2, admin: 3 };

/** Middleware : exige au moins le rôle indiqué. */
function requireRole(min) {
  return (req, res, next) => {
    if (!req.user || ROLE_RANK[req.user.role] < ROLE_RANK[min]) {
      return res.status(403).json({ error: 'Droits insuffisants' });
    }
    next();
  };
}

/** Le membre s'est-il déporté sur ce dossier (conflit d'intérêts, art. 4.2) ? */
function isRecused(userId, dossierId) {
  return !!db.get().prepare('SELECT 1 FROM conflicts WHERE user_id = ? AND dossier_id = ?').get(userId, dossierId);
}

function publicUser(u) {
  return {
    id: u.id, email: u.email, full_name: u.full_name, quality: u.quality, role: u.role, status: u.status,
    fonction: u.fonction, health_professional: !!u.health_professional, independent: !!u.independent,
    totp_enabled: !!u.totp_enabled, notify_email: !!u.notify_email, notify_comments: !!u.notify_comments,
    created_at: u.created_at, last_login_at: u.last_login_at,
    recovery_codes_left: JSON.parse(u.recovery_codes || '[]').length,
  };
}

module.exports = { createSession, revokeAll, requireSession, requireRole, isRecused, publicUser, ROLE_RANK, readToken };
