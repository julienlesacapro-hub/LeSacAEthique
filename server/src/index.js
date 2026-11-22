'use strict';
const config = require('./config');
const db = require('./db');
const { createApp } = require('./app');

if (config.demoMode) require('./demo').assertSafe();
const app = createApp();

// Purge régulière des sessions et jetons expirés
setInterval(() => {
  const now = Date.now();
  db.get().prepare('DELETE FROM sessions WHERE expires_at < ? OR (stage = \'full\' AND last_seen_at < ?)')
    .run(now, now - config.session.idleMinutes * 60e3);
  db.get().prepare('DELETE FROM tokens WHERE expires_at < ?').run(now - 7 * 864e5);
  // Journal d'audit : conservation d'un an (art. 52 du règlement intérieur)
  db.get().prepare('DELETE FROM audit_log WHERE at < ?').run(now - 366 * 864e5);
}, 10 * 60e3).unref();

async function start() {
  if (config.demoMode) {
    console.log('*** VERSION DE DÉMONSTRATION — données fictives — ne jamais utiliser en production ***');
    if (await require('./demo').seed()) console.log('Données de démonstration créées.');
  }
  const { n } = db.get().prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin'").get();
  app.listen(config.port, config.host, () => {
  console.log(`${config.appName} — ${config.committeeName} — http://${config.host}:${config.port}`);
  console.log(`URL publique : ${config.publicUrl}`);
  if (!n) console.log('Aucun administrateur : lancez « npm run create-admin -- --email … --name … »');
  if (!config.smtp.host && !config.demoMode) console.log('SMTP non configuré : les courriels sont affichés dans la console.');
  });
}
start().catch((e) => { console.error(e); process.exit(1); });
