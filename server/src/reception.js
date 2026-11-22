'use strict';
/**
 * Date de réception de l'avis par le porteur : point de départ du délai d'appel.
 *
 * Chaque envoi de l'avis comporte un lien personnel d'accusé de réception.
 * La réception est établie, par ordre de priorité :
 *  1. par la confirmation du porteur (lien, puis bouton « Je confirme ») — un
 *     simple affichage du lien ne suffit pas, car les messageries ouvrent
 *     parfois automatiquement les liens pour les analyser ;
 *  2. par la déclaration du président (accusé de réception postal, courriel
 *     du porteur…), avec justification ;
 *  3. à défaut, l'avis est réputé reçu [15] jours après le premier envoi.
 *     Une confirmation postérieure à cette date ne repousse pas le délai.
 * Si l'avis n'a jamais été transmis, le délai court de la date de l'avis.
 */
const db = require('./db');
const config = require('./config');
const sec = require('./security');

const q = () => db.get();
const DAY = 864e5;

function addMonths(ms, n) {
  const d = new Date(ms); const day = d.getDate();
  d.setMonth(d.getMonth() + n);
  if (d.getDate() < day) d.setDate(0);
  return d.getTime();
}

/** Prépare un accusé de réception pour un envoi : renvoie le jeton à placer dans le courriel. */
function newToken() { return sec.randomToken(); }

function record({ acte, dossierId, envoiId, token, sentAt }) {
  q().prepare('INSERT INTO receptions (acte_id, dossier_id, envoi_id, token_hash, sent_at) VALUES (?,?,?,?,?)')
    .run(acte.id, dossierId, envoiId, sec.sha256(token), sentAt);
}

const linkFor = (token) => `${config.publicUrl}/api/public/reception/${token}`;

function byToken(token) {
  return q().prepare('SELECT * FROM receptions WHERE token_hash = ?').get(sec.sha256(String(token || '')));
}

/** Confirmation par le porteur. Retourne { status: 'confirmee' | 'deja' | 'invalide', row }. */
function confirm(token, ip) {
  const row = byToken(token);
  if (!row) return { status: 'invalide' };
  if (row.confirmed_at) return { status: 'deja', row };
  const now = Date.now();
  q().prepare("UPDATE receptions SET confirmed_at = ?, method = 'lien', ip = ? WHERE id = ?").run(now, String(ip || ''), row.id);
  q().prepare('INSERT INTO dossier_events (dossier_id, at, user_id, type, details) VALUES (?,?,?,?,?)')
    .run(row.dossier_id, now, null, 'reception', 'Réception de l’avis confirmée par le porteur (accusé de réception électronique)');
  return { status: 'confirmee', row: { ...row, confirmed_at: now } };
}

/** Déclaration de la date de réception par le président (avis de réception postal, réponse écrite du porteur…). */
function declare(avis, by, { date, note }) {
  const at = Number(date);
  if (!at || Number.isNaN(at)) throw Object.assign(new Error('Date invalide'), { rule: true });
  if (at > Date.now()) throw Object.assign(new Error('La date de réception ne peut pas être dans le futur'), { rule: true });
  if (at < avis.created_at) throw Object.assign(new Error('La date de réception ne peut pas précéder la date de l’avis'), { rule: true });
  if (q().prepare('SELECT 1 FROM receptions WHERE acte_id = ? AND confirmed_at IS NOT NULL').get(avis.id)) throw Object.assign(new Error('Une date de réception est déjà établie'), { rule: true });
  if (String(note || '').trim().length < 5) throw Object.assign(new Error('Précisez le justificatif (avis de réception postal, courriel du porteur…)'), { rule: true });
  q().prepare("INSERT INTO receptions (acte_id, dossier_id, confirmed_at, method, declared_by, note) VALUES (?,?,?,'declaration',?,?)")
    .run(avis.id, avis.dossier_id, at, by.id, String(note).trim().slice(0, 500));
  q().prepare('INSERT INTO dossier_events (dossier_id, at, user_id, type, details) VALUES (?,?,?,?,?)')
    .run(avis.dossier_id, Date.now(), by.id, 'reception', `Date de réception de l’avis déclarée : ${new Date(at).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })} (${String(note).trim().slice(0, 120)})`);
}

/** Situation de la réception d'un avis (avis d'origine). */
function infoFor(avis) {
  const rows = q().prepare('SELECT * FROM receptions WHERE acte_id = ? ORDER BY id').all(avis.id);
  const sent = rows.filter((r) => r.sent_at).map((r) => r.sent_at);
  const firstSent = sent.length ? Math.min(...sent) : null;
  const confirmed = rows.filter((r) => r.confirmed_at).sort((a, b) => a.confirmed_at - b.confirmed_at)[0];
  const presumedAt = firstSent ? firstSent + config.receptionPresumptionDays * DAY : null;
  let basis; let receivedAt;
  // Une confirmation tardive ne repousse pas le délai : au-delà de la date de présomption, l'avis est réputé reçu.
  if (confirmed && !(presumedAt && confirmed.confirmed_at > presumedAt)) { basis = confirmed.method === 'lien' ? 'confirmee' : 'declaree'; receivedAt = confirmed.confirmed_at; }
  else if (firstSent) { basis = 'presumee'; receivedAt = presumedAt; }
  else { basis = 'non_transmis'; receivedAt = null; }
  return { firstSent, receivedAt, presumedAt, basis, method: confirmed ? confirmed.method : null, note: confirmed ? confirmed.note : null };
}

const BASIS_LABEL = {
  confirmee: 'confirmée par le porteur',
  declaree: 'déclarée par le président',
  presumee: `réputée, ${config.receptionPresumptionDays} jours après l’envoi, faute de confirmation`,
  non_transmis: 'avis non encore transmis : le délai court de la date de l’avis',
};

/** Échéance du délai d'appel d'un avis. */
function appealDeadline(avis) {
  const info = infoFor(avis);
  const start = info.receivedAt || avis.created_at;
  return { ...info, start, deadline: addMonths(start, config.appealDelayMonths), label: BASIS_LABEL[info.basis] };
}

module.exports = { newToken, record, linkFor, byToken, confirm, declare, infoFor, appealDeadline, addMonths, BASIS_LABEL };
