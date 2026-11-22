'use strict';
/**
 * Notifications des membres : dans l'application, par courriel et, si le
 * membre l'a activé, par notification « push » sur téléphone, tablette ou
 * ordinateur (Web Push, protocole standard RFC 8030 / VAPID RFC 8292).
 */
const db = require('./db');
const config = require('./config');
const mailer = require('./mailer');

let webpush = null;
if (config.vapid.publicKey && config.vapid.privateKey) {
  webpush = require('web-push');
  webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey);
}

/** Membres actifs qui ne se sont pas déportés sur ce dossier. */
function recipientsFor(dossierId, { excludeUserId = null } = {}) {
  return db.get().prepare(`
    SELECT u.* FROM users u
    WHERE u.status = 'actif'
      AND (? IS NULL OR u.id <> ?)
      AND NOT EXISTS (SELECT 1 FROM conflicts c WHERE c.dossier_id = ? AND c.user_id = u.id)
  `).all(excludeUserId, excludeUserId, dossierId);
}

async function push(userId, payload) {
  if (!webpush) return;
  const subs = db.get().prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId);
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: JSON.parse(s.keys_json) }, JSON.stringify(payload));
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        db.get().prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
      }
    }
  }
}

async function dispatch({ users, type, dossier, commentId = null, message, emailSubject, emailText, wantEmail }) {
  const ins = db.get().prepare(
    'INSERT INTO notifications (user_id, type, dossier_id, comment_id, message, created_at) VALUES (?,?,?,?,?,?)');
  const now = Date.now();
  for (const u of users) ins.run(u.id, type, dossier.id, commentId, message, now);
  const link = `${config.publicUrl}/#/dossiers/${dossier.id}`;
  await Promise.all(users.map(async (u) => {
    if (u.notify_email && wantEmail(u)) {
      await mailer.send({ to: u.email, subject: emailSubject, text: `Bonjour ${u.full_name},\n\n${emailText}\n\nAccéder au dossier : ${link}\n\nCe message ne contient volontairement aucun élément confidentiel du dossier.\n` });
    }
    await push(u.id, { title: config.committeeName, body: message, url: `/#/dossiers/${dossier.id}` });
  }));
}

async function newDossier(dossier, { appel = null } = {}) {
  await dispatch({
    users: recipientsFor(dossier.id),
    type: 'nouveau_dossier',
    dossier,
    message: appel ? `Appel déposé : ${dossier.reference} (dossier initial ${appel})` : `Nouvelle demande déposée : ${dossier.reference}`,
    emailSubject: appel ? `Appel ${dossier.reference}` : `Nouvelle demande ${dossier.reference}`,
    emailText: appel ? `Un appel a été formé contre l'avis rendu sur le dossier ${appel}. Il est enregistré sous la référence ${dossier.reference}, avec les copies du dossier initial. Les documents sont consultables dans ${config.appName}.` : `Une nouvelle demande d'avis a été déposée (référence ${dossier.reference}). Les documents sont consultables dans ${config.appName}.`,
    wantEmail: () => true,
  });
}

async function newComment(dossier, comment, author) {
  await dispatch({
    users: recipientsFor(dossier.id, { excludeUserId: author.id }),
    type: 'nouveau_commentaire',
    dossier,
    commentId: comment.id,
    message: `${author.full_name} a ${comment.parent_id ? 'répondu' : 'commenté'} — ${dossier.reference}`,
    emailSubject: `Nouveau commentaire — ${dossier.reference}`,
    emailText: `${author.full_name} (${author.quality || 'membre'}) a publié un ${comment.parent_id ? 'message en réponse' : 'commentaire'} sur le dossier ${dossier.reference}.`,
    wantEmail: (u) => !!u.notify_comments,
  });
}

async function newDocument(dossier, doc, actor) {
  await dispatch({
    users: recipientsFor(dossier.id, { excludeUserId: actor ? actor.id : null }),
    type: 'nouveau_document',
    dossier,
    message: `Nouveau document ajouté — ${dossier.reference}`,
    emailSubject: `Nouveau document — ${dossier.reference}`,
    emailText: `Un document a été ajouté au dossier ${dossier.reference}.`,
    wantEmail: () => true,
  });
}

module.exports = { newDossier, newComment, newDocument, recipientsFor, pushEnabled: () => !!webpush };
