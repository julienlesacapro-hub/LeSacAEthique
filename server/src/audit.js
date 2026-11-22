'use strict';
/**
 * Journal d'audit en ajout seul : connexions, échecs, consultations et
 * téléchargements de documents, actions d'administration (règlement
 * intérieur, art. 40, ligne « Journalisation »).
 */
const db = require('./db');

function log(action, { userId = null, target = '', ip = '', details = '' } = {}) {
  db.get()
    .prepare('INSERT INTO audit_log (at, user_id, action, target, ip, details) VALUES (?,?,?,?,?,?)')
    .run(Date.now(), userId, action, String(target), String(ip || ''), typeof details === 'string' ? details : JSON.stringify(details));
}

const fromReq = (req, action, target = '', details = '') =>
  log(action, { userId: req.user ? req.user.id : null, target, ip: req.ip, details });

module.exports = { log, fromReq };
