'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lesaca-test-'));
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = tmp;
process.env.KEYS_DIR = path.join(tmp, 'keys');
process.env.PUBLIC_URL = 'http://test.local';
process.env.PUBLIC_FORM_ORIGINS = 'https://www.promednav.example';

const config = require('../src/config');
config.rebuild();
const db = require('../src/db');
const sec = require('../src/security');
const totp = require('../src/totp');
const mailer = require('../src/mailer');
const domain = require('../src/domain');
const { createApp } = require('../src/app');

let server, base;
const PW = 'Plongee-Ethique-2026!';

before(async () => {
  const app = createApp();
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

async function api(method, url, { token, body, form, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(base + url, { method, headers: h, body: payload });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, body: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()), headers: r.headers };
}

function codeFor(email) {
  const u = db.get().prepare('SELECT * FROM users WHERE email = ?').get(email);
  db.get().prepare('UPDATE users SET totp_last_step = 0 WHERE id = ?').run(u.id); // autorise un nouveau code dans le même pas de 30 s
  return totp.hotp(totp.base32Decode(sec.decryptText(u.totp_secret)), totp.currentStep());
}

function inviteToken(userId) {
  const raw = sec.randomToken();
  db.get().prepare("INSERT INTO tokens (user_id, type, token_hash, expires_at) VALUES (?, 'invite', ?, ?)").run(userId, sec.sha256(raw), Date.now() + 3600e3);
  return raw;
}

/** Active un compte invité et renvoie un jeton de session complet. */
async function activateAndEnroll(rawInvite, email) {
  let r = await api('POST', '/api/auth/activate', { body: { token: rawInvite, password: PW } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.stage, 'enroll');
  const pending = r.body.token;
  r = await api('POST', '/api/auth/enroll/start', { token: pending });
  assert.equal(r.status, 200);
  assert.match(r.body.qr, /^data:image\/png;base64,/);
  r = await api('POST', '/api/auth/enroll/confirm', { token: pending, body: { code: codeFor(email) } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.recoveryCodes.length, 10);
  return { token: r.body.token, recovery: r.body.recoveryCodes };
}

async function login(email, password = PW) {
  let r = await api('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.stage, 'mfa');
  r = await api('POST', '/api/auth/mfa', { token: r.body.token, body: { code: codeFor(email) } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.token;
}

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const state = {};

test('TOTP conforme aux vecteurs de la RFC 6238 (SHA-1)', () => {
  const secret = Buffer.from('12345678901234567890');
  assert.equal(totp.hotp(secret, Math.floor(59 / 30), 8), '94287082');
  assert.equal(totp.hotp(secret, Math.floor(1111111109 / 30), 8), '07081804');
  assert.equal(totp.hotp(secret, Math.floor(20000000000 / 30), 8), '65353130');
  const s = totp.generateSecret();
  assert.deepEqual(totp.base32Decode(totp.base32Encode(totp.base32Decode(s))), totp.base32Decode(s));
});

test('politique de mot de passe', () => {
  assert.ok(sec.passwordProblems('court').length > 0);
  assert.equal(sec.passwordProblems(PW).length, 0);
});

test('premier administrateur : activation + double authentification obligatoire', async () => {
  const r = db.get().prepare("INSERT INTO users (email, full_name, quality, role, status, created_at) VALUES ('admin@test.fr','Alice Admin','Présidente','admin','invite',?)").run(Date.now());
  const raw = inviteToken(r.lastInsertRowid);
  // Une session « enroll » ne donne accès à rien d'autre que la configuration
  const a = await api('POST', '/api/auth/activate', { body: { token: raw, password: PW } });
  const blocked = await api('GET', '/api/dossiers', { token: a.body.token });
  assert.equal(blocked.status, 403);
  // Le lien d'invitation est à usage unique
  const reuse = await api('POST', '/api/auth/activate', { body: { token: raw, password: PW } });
  assert.equal(reuse.status, 400);
  // Fin de l'enrôlement
  const s = await api('POST', '/api/auth/enroll/start', { token: a.body.token });
  assert.equal(s.status, 200);
  const c = await api('POST', '/api/auth/enroll/confirm', { token: a.body.token, body: { code: codeFor('admin@test.fr') } });
  assert.equal(c.status, 200);
  state.admin = c.body.token;
  state.adminRecovery = c.body.recoveryCodes;
});

test('connexion : mauvais code refusé, code de secours à usage unique', async () => {
  let r = await api('POST', '/api/auth/login', { body: { email: 'admin@test.fr', password: PW } });
  const pending = r.body.token;
  r = await api('POST', '/api/auth/mfa', { token: pending, body: { code: '000000' } });
  assert.equal(r.status, 401);
  r = await api('POST', '/api/auth/mfa', { token: pending, body: { code: state.adminRecovery[0] } });
  assert.equal(r.status, 200);
  assert.equal(r.body.usedRecoveryCode, true);
  r = await api('POST', '/api/auth/login', { body: { email: 'admin@test.fr', password: PW } });
  r = await api('POST', '/api/auth/mfa', { token: r.body.token, body: { code: state.adminRecovery[0] } });
  assert.equal(r.status, 401);
  db.get().prepare("UPDATE users SET failed_attempts = 0 WHERE email = 'admin@test.fr'").run();
});

test('mot de passe erroné refusé ; verrouillage après échecs répétés', async () => {
  db.get().prepare("INSERT INTO users (email, full_name, role, status, password_hash, created_at) VALUES ('lock@test.fr','Lock','lecture','actif',?,?)").run(sec.hashPassword(PW), Date.now());
  for (let i = 0; i < config.lockout.maxAttempts; i++) {
    const r = await api('POST', '/api/auth/login', { body: { email: 'lock@test.fr', password: 'Mauvais-mdp-123!' } });
    assert.equal(r.status, 401);
  }
  const r = await api('POST', '/api/auth/login', { body: { email: 'lock@test.fr', password: PW } });
  assert.equal(r.status, 429);
});

test("l'administrateur crée des membres avec des droits différents", async () => {
  mailer.outbox.length = 0;
  let r = await api('POST', '/api/users', { token: state.admin, body: { email: 'bob@test.fr', full_name: 'Bob Rapporteur', quality: 'Médecin hyperbare', role: 'ecriture' } });
  assert.equal(r.status, 201);
  assert.ok(r.body.invitationLink.includes('#/activer?jeton='));
  assert.equal(mailer.outbox.length, 1);
  assert.ok(!mailer.outbox[0].text.includes(PW));
  const bobInvite = r.body.invitationLink.split('jeton=')[1];
  r = await api('POST', '/api/users', { token: state.admin, body: { email: 'carla@test.fr', full_name: 'Carla Lectrice', quality: 'Représentante des usagers', role: 'lecture' } });
  const carlaInvite = r.body.invitationLink.split('jeton=')[1];
  r = await api('POST', '/api/users', { token: state.admin, body: { email: 'dan@test.fr', full_name: 'Dan Juriste', quality: 'Juriste', role: 'ecriture' } });
  const danInvite = r.body.invitationLink.split('jeton=')[1];

  state.bob = (await activateAndEnroll(bobInvite, 'bob@test.fr')).token;
  state.carla = (await activateAndEnroll(carlaInvite, 'carla@test.fr')).token;
  state.dan = (await activateAndEnroll(danInvite, 'dan@test.fr')).token;

  // Un non-administrateur ne peut pas gérer les membres
  r = await api('GET', '/api/users', { token: state.bob });
  assert.equal(r.status, 403);
});

test('dépôt public depuis le site : référence, documents chiffrés, notification des membres', async () => {
  mailer.outbox.length = 0;
  const form = new FormData();
  form.set('title', 'Étude rétrospective des accidents de décompression');
  form.set('applicant_name', 'Dr Porteur');
  form.set('applicant_email', 'porteur@hopital.example');
  form.set('qualification', 'RNIPH');
  form.set('qualification_reason', 'Étude sur données déjà collectées');
  form.set('attest_no_health_data', 'on');
  form.append('piece_a', new Blob([PDF], { type: 'application/pdf' }), 'lettre-saisine.pdf');
  form.append('piece_b', new Blob([PDF], { type: 'application/pdf' }), 'protocole.pdf');
  const r = await api('POST', '/api/public/submissions', { form, headers: { Origin: 'https://www.promednav.example' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.match(r.body.reference, /^CER-PROMEDNAV-\d{4}-001$/);
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://www.promednav.example');
  state.reference = r.body.reference;
  await new Promise((res) => setTimeout(res, 50));
  const recipients = mailer.outbox.map((m) => m.to);
  for (const e of ['porteur@hopital.example', 'admin@test.fr', 'bob@test.fr', 'carla@test.fr', 'dan@test.fr']) assert.ok(recipients.includes(e), e);
  // Les courriels aux membres ne contiennent pas le titre (confidentialité)
  assert.ok(!mailer.outbox.filter((m) => m.to === 'bob@test.fr').some((m) => m.text.includes('décompression')));
  // Fichier stocké chiffré sur le disque
  const doc = db.get().prepare('SELECT * FROM documents LIMIT 1').get();
  const raw = fs.readFileSync(path.join(config.filesDir, doc.storage_name));
  assert.ok(!raw.includes(Buffer.from('%PDF')));
});

test('dépôt refusé : RIPH, origine inconnue, fichier non conforme', async () => {
  const mk = (over = {}) => {
    const f = new FormData();
    const base = { title: 'X', applicant_name: 'Y', applicant_email: 'y@x.fr', qualification: 'RNIPH', qualification_reason: 'Z', attest_no_health_data: 'on', ...over };
    for (const [k, v] of Object.entries(base)) f.set(k, v);
    f.append('piece_a', new Blob([over.file || PDF]), over.name || 'a.pdf');
    return f;
  };
  let r = await api('POST', '/api/public/submissions', { form: mk({ qualification: 'RIPH' }) });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /CPP/);
  r = await api('POST', '/api/public/submissions', { form: mk(), headers: { Origin: 'https://pirate.example' } });
  assert.equal(r.status, 403);
  r = await api('POST', '/api/public/submissions', { form: mk({ name: 'virus.exe' }) });
  assert.equal(r.status, 400);
  r = await api('POST', '/api/public/submissions', { form: mk({ file: Buffer.from('pas un pdf') }) });
  assert.equal(r.status, 400);
});

test('les membres lisent le dossier et les documents ; notifications in-app', async () => {
  let r = await api('GET', '/api/notifications', { token: state.carla });
  assert.equal(r.body.unread, 1);
  r = await api('GET', '/api/dossiers', { token: state.carla });
  assert.equal(r.body.dossiers.length, 1);
  state.dossierId = r.body.dossiers[0].id;
  r = await api('GET', `/api/dossiers/${state.dossierId}`, { token: state.carla });
  assert.equal(r.status, 200);
  assert.equal(r.body.documents.length, 2);
  assert.equal(r.body.canWrite, false);
  state.docId = r.body.documents[0].id;
  r = await api('GET', `/api/dossiers/${state.dossierId}/documents/${state.docId}/content`, { token: state.carla });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, PDF);
  r = await api('GET', `/api/dossiers/${state.dossierId}`);
  assert.equal(r.status, 401);
});

test('commentaires signés : ajout, réponse, complément ; lecture seule ne peut pas écrire', async () => {
  let r = await api('POST', `/api/dossiers/${state.dossierId}/comments`, { token: state.bob, body: { body: 'Le paragraphe éthique du protocole est insuffisant.', document_id: state.docId } });
  assert.equal(r.status, 201);
  const c1 = r.body.comment;
  assert.equal(c1.author_name, 'Bob Rapporteur');
  assert.equal(c1.author_quality, 'Médecin hyperbare');
  assert.ok(sec.verifySignature(c1.hash, c1.signature));
  r = await api('POST', `/api/dossiers/${state.dossierId}/comments`, { token: state.dan, body: { body: 'D’accord ; la note d’information doit aussi être revue.', parent_id: c1.id } });
  assert.equal(r.status, 201);
  assert.equal(r.body.comment.parent_id, c1.id);
  state.c1 = c1.id;
  r = await api('POST', `/api/dossiers/${state.dossierId}/comments`, { token: state.carla, body: { body: 'Je voudrais écrire' } });
  assert.equal(r.status, 403);
  r = await api('GET', `/api/dossiers/${state.dossierId}`, { token: state.carla });
  assert.equal(r.body.comments.length, 2);
});

test('un commentaire ne peut JAMAIS être modifié ni supprimé (API et base de données)', async () => {
  for (const m of ['PUT', 'PATCH', 'DELETE']) {
    const r = await api(m, `/api/dossiers/${state.dossierId}/comments/${state.c1}`, { token: state.admin, body: { body: 'modifié' } });
    assert.equal(r.status, 405);
  }
  assert.throws(() => db.get().prepare("UPDATE comments SET body = 'falsifié' WHERE id = ?").run(state.c1), /ne peut pas être modifié/);
  assert.throws(() => db.get().prepare('DELETE FROM comments WHERE id = ?').run(state.c1), /ne peut pas être supprimé/);
  assert.throws(() => db.get().prepare('DELETE FROM documents').run(), /ne peut pas être supprimé/);
  assert.throws(() => db.get().prepare('DELETE FROM audit_log').run(), /ajout seul/);
  // Une entrée de plus d'un an peut être purgée (conservation limitée, art. 40)
  db.get().prepare("INSERT INTO audit_log (at, action) VALUES (?, 'ancien')").run(Date.now() - 400 * 864e5);
  assert.equal(db.get().prepare('DELETE FROM audit_log WHERE at < ?').run(Date.now() - 366 * 864e5).changes, 1);
  assert.equal(domain.verifyIntegrity().ok, true);
});

test('une falsification directe du fichier de base est détectée', () => {
  const d = db.get();
  d.exec('DROP TRIGGER comments_no_update');
  d.prepare("UPDATE comments SET body = 'texte falsifié' WHERE id = ?").run(state.c1);
  const r = domain.verifyIntegrity();
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes('contenu modifié')));
  d.exec(db.SCHEMA); // restaure le déclencheur pour la suite
});

test('déport pour conflit d’intérêts : le membre perd l’accès et n’est plus notifié', async () => {
  let r = await api('POST', `/api/dossiers/${state.dossierId}/conflicts`, { token: state.dan, body: { reason: 'Co-auteur du protocole' } });
  assert.equal(r.status, 200);
  r = await api('GET', `/api/dossiers/${state.dossierId}`, { token: state.dan });
  assert.equal(r.status, 403);
  assert.equal(r.body.recused, true);
  r = await api('GET', '/api/dossiers', { token: state.dan });
  assert.equal(r.body.dossiers[0].title, undefined);
  mailer.outbox.length = 0;
  await api('POST', `/api/dossiers/${state.dossierId}/comments`, { token: state.bob, body: { body: 'Complément' } });
  await new Promise((res) => setTimeout(res, 50));
  assert.ok(!mailer.outbox.some((m) => m.to === 'dan@test.fr'));
});

test('administration du dossier : statut historisé, ajout de nouvelle version', async () => {
  let r = await api('PATCH', `/api/dossiers/${state.dossierId}`, { token: state.admin, body: { status: 'recevable', note: 'Dossier complet' } });
  assert.equal(r.status, 200);
  r = await api('PATCH', `/api/dossiers/${state.dossierId}`, { token: state.bob, body: { status: 'clos' } });
  assert.equal(r.status, 403);
  const form = new FormData();
  form.set('piece', 'b');
  form.append('files', new Blob([PDF]), 'protocole.pdf');
  r = await api('POST', `/api/dossiers/${state.dossierId}/documents`, { token: state.admin, form });
  assert.equal(r.status, 201);
  assert.equal(r.body.documents[0].version, 2);
  r = await api('GET', `/api/dossiers/${state.dossierId}`, { token: state.bob });
  assert.ok(r.body.events.some((e) => e.details.includes('Recevable')));
});

test('identifiants perdus : réinitialisation par le membre, second facteur exigé', async () => {
  mailer.outbox.length = 0;
  let r = await api('POST', '/api/auth/forgot', { body: { email: 'bob@test.fr' } });
  assert.equal(r.status, 200);
  r = await api('POST', '/api/auth/forgot', { body: { email: 'inconnu@test.fr' } });
  assert.equal(r.status, 200); // même réponse : pas d'énumération
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(mailer.outbox.length, 1);
  const tok = mailer.outbox[0].text.match(/jeton=([A-Za-z0-9_-]+)/)[1];
  const NEW = 'Nouveau-Mot-De-Passe-42!';
  r = await api('POST', '/api/auth/reset', { body: { token: tok, password: NEW, code: '123456' } });
  assert.equal(r.status, 401);
  r = await api('POST', '/api/auth/reset', { body: { token: tok, password: NEW, code: codeFor('bob@test.fr') } });
  assert.equal(r.status, 200);
  // Anciennes sessions révoquées
  r = await api('GET', '/api/auth/me', { token: state.bob });
  assert.equal(r.status, 401);
  state.bob = await login('bob@test.fr', NEW);
  r = await api('POST', '/api/auth/reset', { body: { token: tok, password: NEW, code: codeFor('bob@test.fr') } });
  assert.equal(r.status, 400); // lien à usage unique
});

test('suspension : accès coupé immédiatement ; le dernier administrateur est protégé', async () => {
  const carla = db.get().prepare("SELECT id FROM users WHERE email='carla@test.fr'").get();
  let r = await api('PATCH', `/api/users/${carla.id}`, { token: state.admin, body: { status: 'suspendu' } });
  assert.equal(r.status, 200);
  r = await api('GET', '/api/dossiers', { token: state.carla });
  assert.equal(r.status, 401);
  const admin = db.get().prepare("SELECT id FROM users WHERE email='admin@test.fr'").get();
  r = await api('PATCH', `/api/users/${admin.id}`, { token: state.admin, body: { role: 'lecture' } });
  assert.equal(r.status, 400);
});

test('journal d’audit et contrôle d’intégrité accessibles aux administrateurs', async () => {
  let r = await api('GET', '/api/users/audit/log', { token: state.admin });
  assert.equal(r.status, 200);
  const actions = r.body.entries.map((e) => e.action);
  for (const a of ['connexion', 'demande_deposee', 'document_consulte', 'commentaire_publie', 'deport_declare']) assert.ok(actions.includes(a), a);
  r = await api('GET', '/api/users/audit/integrity', { token: state.admin });
  assert.equal(r.status, 200);
  assert.match(r.body.publicKey, /BEGIN PUBLIC KEY/);
});

test('hors démonstration : pas de connexion de démo, le code 000000 est refusé', async () => {
  let r = await api('GET', '/api/demo/accounts');
  assert.equal(r.status, 404);
  r = await api('POST', '/api/auth/login', { body: { email: 'admin@test.fr', password: PW } });
  r = await api('POST', '/api/auth/mfa', { token: r.body.token, body: { code: '000000' } });
  assert.equal(r.status, 401);
});
