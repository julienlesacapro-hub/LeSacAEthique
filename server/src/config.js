'use strict';
/**
 * Configuration centrale. Toutes les valeurs viennent de variables
 * d'environnement (voir ../.env.example). Aucune valeur secrète n'est
 * écrite dans le code.
 */
const path = require('path');
const fs = require('fs');

// Chargement minimal d'un fichier .env (sans dépendance externe).
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadDotEnv(path.join(__dirname, '..', '.env'));

const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);
const list = (k) => env(k, '').split(',').map((s) => s.trim()).filter(Boolean);

function build() {
  const dataDir = path.resolve(env('DATA_DIR', path.join(__dirname, '..', 'data')));
  return {
    appName: env('APP_NAME', 'LeSacAEthique'),
    committeeName: env('COMMITTEE_NAME', 'CER-PROMEDNAV'),
    committeeLongName: env('COMMITTEE_LONG_NAME', "Comité d'éthique de la recherche de PROMEDNAV"),
    referencePrefix: env('REFERENCE_PREFIX', 'CER-PROMEDNAV'),
    associationName: env('ASSOCIATION_NAME', 'PROMEDNAV'),
    avisLieu: env('AVIS_LIEU', 'Toulon'),                 // « Fait à Toulon » (annexe 7)
    irbIorg: env('IRB_IORG', ''),                          // n° IORG si enregistrement OHRP
    irbNumber: env('IRB_NUMBER', ''),                      // n° IRB si enregistrement OHRP
    avisValidityMonths: parseInt(env('AVIS_VALIDITY_MONTHS', '36'), 10), // art. 31.4 : trois ans au plus
    avisDelayDays: parseInt(env('AVIS_DELAY_DAYS', '30'), 10),           // art. 31.2
    appealDelayMonths: parseInt(env('APPEAL_DELAY_MONTHS', '3'), 10),     // délai d'appel après l'avis
    // Fonctions autorisées à détenir le rôle administrateur de l'outil
    adminFunctions: (env('ADMIN_FUNCTIONS', 'president,vice_president')).split(',').map((s) => s.trim()).filter(Boolean),
    port: parseInt(env('PORT', '8443'), 10),
    host: env('HOST', '127.0.0.1'),
    publicUrl: env('PUBLIC_URL', 'http://localhost:8443').replace(/\/$/, ''),
    trustProxy: env('TRUST_PROXY', 'loopback'),
    dataDir,
    filesDir: path.join(dataDir, 'files'),
    keysDir: path.resolve(env('KEYS_DIR', path.join(dataDir, 'keys'))),
    dbFile: path.join(dataDir, 'lesacaethique.sqlite'),
    // Origines autorisées à déposer une demande (site internet de l'association)
    publicFormOrigins: list('PUBLIC_FORM_ORIGINS'),
    // Origines autorisées pour les applications natives (Capacitor / Electron)
    appOrigins: list('APP_ORIGINS').length
      ? list('APP_ORIGINS')
      : ['capacitor://localhost', 'https://localhost', 'http://localhost', 'app://lesacaethique'],
    maxUploadMb: parseInt(env('MAX_UPLOAD_MB', '25'), 10),
    maxFilesPerSubmission: parseInt(env('MAX_FILES_PER_SUBMISSION', '20'), 10),
    session: {
      idleMinutes: parseInt(env('SESSION_IDLE_MINUTES', '30'), 10),
      absoluteHours: parseInt(env('SESSION_ABSOLUTE_HOURS', '12'), 10),
    },
    lockout: {
      maxAttempts: parseInt(env('LOCKOUT_MAX_ATTEMPTS', '5'), 10),
      minutes: parseInt(env('LOCKOUT_MINUTES', '15'), 10),
    },
    inviteHours: parseInt(env('INVITE_VALID_HOURS', '72'), 10),
    resetMinutes: parseInt(env('RESET_VALID_MINUTES', '30'), 10),
    smtp: {
      host: env('SMTP_HOST', ''),
      port: parseInt(env('SMTP_PORT', '587'), 10),
      secure: env('SMTP_SECURE', 'false') === 'true',
      user: env('SMTP_USER', ''),
      pass: env('SMTP_PASS', ''),
      from: env('MAIL_FROM', 'CER-PROMEDNAV <ne-pas-repondre@localhost>'),
      replyTo: env('MAIL_REPLY_TO', ''),
    },
    secretariatEmail: env('SECRETARIAT_EMAIL', ''),
    vapid: {
      publicKey: env('VAPID_PUBLIC_KEY', ''),
      privateKey: env('VAPID_PRIVATE_KEY', ''),
      subject: env('VAPID_SUBJECT', 'mailto:admin@localhost'),
    },
    isTest: env('NODE_ENV', '') === 'test',
  };
}

module.exports = build();
module.exports.rebuild = () => Object.assign(module.exports, build());
