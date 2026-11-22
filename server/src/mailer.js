'use strict';
/**
 * Envoi des courriels (SMTP). Les courriels ne contiennent JAMAIS le contenu
 * des dossiers ni des commentaires : seulement la référence et un lien vers
 * l'application, où l'accès exige la double authentification
 * (règlement intérieur, art. 5 et 6.1).
 * Sans SMTP configuré, les messages sont écrits dans la console (mode test).
 */
const nodemailer = require('nodemailer');
const config = require('./config');

let transport = null;
const outbox = []; // conservé en mode test pour les vérifications automatiques

function getTransport() {
  if (transport) return transport;
  if (!config.smtp.host) return null;
  transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  return transport;
}

async function send({ to, subject, text }) {
  const msg = { from: config.smtp.from, to, subject: `[${config.committeeName}] ${subject}`, text };
  const t = getTransport();
  if (!t) {
    outbox.push(msg);
    if (!config.isTest) console.log(`\n--- Courriel (SMTP non configuré) ---\nÀ : ${to}\nObjet : ${msg.subject}\n${text}\n---`);
    return;
  }
  try {
    await t.sendMail(msg);
  } catch (e) {
    console.error('Échec d’envoi du courriel à', to, '-', e.message);
  }
}

module.exports = { send, outbox };
