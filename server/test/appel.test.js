'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lesaca-appel-'));
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = tmp;
process.env.KEYS_DIR = path.join(tmp, 'keys');
process.env.PUBLIC_URL = 'http://test.local';

const config = require('../src/config');
config.rebuild();
const db = require('../src/db');
const domain = require('../src/domain');
const mailer = require('../src/mailer');
const sec = require('../src/security');
const totp = require('../src/totp');
const appeal = require('../src/appeal');
const { createSession } = require('../src/auth');
const { createApp } = require('../src/app');

let server, base;
const T = {}; const U = {}; const S = {};
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

function mkUser(key, { role = 'ecriture', fonction = 'titulaire', hp = 1, indep = 0 }) {
  const r = db.get().prepare(`INSERT INTO users (email, full_name, quality, role, fonction, health_professional, independent, status, password_hash, totp_enabled, totp_secret, created_at)
    VALUES (?,?,?,?,?,?,?,'actif','x',1,?,?)`).run(`${key}@cer.test`, key.toUpperCase(), `Qualité ${key}`, role, fonction, hp, indep, sec.encryptText(totp.generateSecret()), Date.now());
  U[key] = db.get().prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
  T[key] = createSession(U[key], 'full', { ip: '1', get: () => '' });
}
function code(key) {
  const u = db.get().prepare('SELECT * FROM users WHERE id = ?').get(U[key].id);
  db.get().prepare('UPDATE users SET totp_last_step = 0 WHERE id = ?').run(u.id);
  return totp.hotp(totp.base32Decode(sec.decryptText(u.totp_secret)), totp.currentStep());
}
async function api(method, url, who, body, form) {
  const headers = who ? { Authorization: `Bearer ${T[who]}` } : {};
  let payload;
  if (form) payload = form; else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(base + url, { method, headers, body: payload });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, body: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
}
function appealForm(fields, files = { piece_a: 'lettre-appel.pdf' }) {
  const f = new FormData();
  const base = { request_type: 'appel', applicant_name: 'Pr Président Association', applicant_email: 'president@promednav.test', attest_no_health_data: 'on', ...fields };
  for (const [k, v] of Object.entries(base)) f.set(k, v);
  for (const [field, name] of Object.entries(files)) f.append(field, new Blob([PDF]), name);
  return f;
}

before(async () => {
  const app = createApp();
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  mkUser('pres', { role: 'admin', fonction: 'president' });
  mkUser('t1', { hp: 0, indep: 1 });
  mkUser('t2', {});
  mkUser('t3', {});
  mkUser('t4', { hp: 0 });
  // Dossier initial instruit jusqu'à l'avis signé et la clôture
  const d = domain.createDossier({ title: 'Étude initiale', applicant_name: 'Dr Porteur', applicant_email: 'porteur@hopital.test', qualification: 'RNIPH', qualification_reason: 'Données existantes' });
  domain.addDocument(d.id, { originalname: 'protocole.pdf', buffer: PDF }, { piece: 'b' });
  domain.addDocument(d.id, { originalname: 'lettre.pdf', buffer: PDF }, { piece: 'a' });
  S.parent = d;
  await api('POST', `/api/dossiers/${d.id}/comments`, 't1', { body: 'Analyse du rapporteur : information insuffisante.' });
  await api('POST', `/api/dossiers/${d.id}/conflicts`, 't3', { reason: 'Co-auteur' });
  await api('POST', `/api/gov/dossiers/${d.id}/rapporteurs`, 'pres', { user_id: U.t1.id });
  await api('POST', `/api/gov/dossiers/${d.id}/rapporteurs`, 'pres', { user_id: U.t2.id });
  const sc = (await api('POST', `/api/gov/dossiers/${d.id}/scrutins`, 'pres', { deadline: Date.now() + 14 * 864e5 })).body.scrutin;
  for (const k of ['pres', 't1', 't2']) await api('POST', `/api/gov/scrutins/${sc.id}/vote`, k, { choice: 'defavorable', motivation: 'Insuffisant', code: code(k) });
  await api('POST', `/api/gov/scrutins/${sc.id}/cloture`, 'pres');
  const avis = (await api('POST', `/api/gov/dossiers/${d.id}/avis`, 'pres', { scrutin_id: sc.id, motivation: 'Information des participants insuffisante.' })).body.acte;
  S.code = avis.meta.verifCode;
  const f = new FormData(); f.append('file', new Blob([PDF]), 'scan.pdf'); f.set('code', S.code);
  const r = await api('POST', `/api/gov/actes/${avis.id}/signe-manuscrit`, 'pres', undefined, f);
  assert.ok(r.body.closure, JSON.stringify(r.body));
});
after(() => { server.close(); db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('délai en mois calendaires', () => {
  assert.equal(new Date(appeal.addMonths(new Date(2026, 10, 30).getTime(), 3)).getDate(), 28); // 30 nov. + 3 mois = 28 févr. 2027
  assert.equal(new Date(appeal.addMonths(new Date(2026, 0, 15).getTime(), 3)).getMonth(), 3);
});

test('appel refusé : référence inconnue, code de l’avis erroné, motif ou lettre absents', async () => {
  let r = await api('POST', '/api/public/submissions', null, undefined, appealForm({ appeal_reference: 'CER-PROMEDNAV-1999-001', appeal_code: S.code, appeal_role: 'porteur', appeal_reason: 'x'.repeat(30) }));
  assert.equal(r.status, 400); assert.equal(r.body.appealStatus, 'introuvable');
  r = await api('POST', '/api/public/submissions', null, undefined, appealForm({ appeal_reference: S.parent.reference, appeal_code: 'AAAA-BBBB', appeal_role: 'porteur', appeal_reason: 'x'.repeat(30) }));
  assert.equal(r.status, 400); assert.equal(r.body.appealStatus, 'code_invalide');
  r = await api('POST', '/api/public/submissions', null, undefined, appealForm({ appeal_reference: S.parent.reference, appeal_code: S.code, appeal_role: 'porteur', appeal_reason: 'trop court' }));
  assert.equal(r.status, 400);
  r = await api('POST', '/api/public/submissions', null, undefined, appealForm({ appeal_reference: S.parent.reference, appeal_code: S.code, appeal_role: 'porteur', appeal_reason: 'x'.repeat(30) }, { piece_autre: 'note.pdf' }));
  assert.equal(r.status, 400); assert.match(r.body.error, /lettre d’appel/);
});

test('appel dans le délai par le président de l’association : copies versées automatiquement', async () => {
  mailer.outbox.length = 0;
  const r = await api('POST', '/api/public/submissions', null, undefined, appealForm(
    { appeal_reference: S.parent.reference.toLowerCase(), appeal_code: S.code.toLowerCase(), appeal_role: 'president_association', appeal_reason: 'Une nouvelle note d’information répond aux observations du comité.' },
    { piece_a: 'lettre-appel.pdf', piece_c: 'note-information-v2.pdf' }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.kind, 'appel');
  assert.equal(r.body.parentReference, S.parent.reference);
  const ap = db.get().prepare('SELECT * FROM dossiers WHERE reference = ?').get(r.body.reference);
  S.appeal = ap;
  assert.equal(ap.kind, 'appel'); assert.equal(ap.parent_id, S.parent.id); assert.equal(ap.appeal_role, 'president_association');
  assert.equal(ap.applicant_email, 'porteur@hopital.test'); // le porteur reste le porteur
  const docs = db.get().prepare('SELECT * FROM documents WHERE dossier_id = ?').all(ap.id);
  // 2 nouveaux + 2 documents initiaux + avis + exemplaire signé + relevé de clôture
  assert.equal(docs.length, 7);
  assert.equal(docs.filter((x) => x.label.startsWith('Copie du dossier initial')).length, 5);
  assert.ok(docs.some((x) => x.original_name.includes('Cloture')));
  // le déport du dossier initial est reporté
  assert.ok(db.get().prepare('SELECT 1 FROM conflicts WHERE dossier_id = ? AND user_id = ?').get(ap.id, U.t3.id));
  await new Promise((res) => setTimeout(res, 50));
  assert.ok(mailer.outbox.some((m) => m.to === 'president@promednav.test'));
  assert.ok(mailer.outbox.some((m) => m.to === 'porteur@hopital.test' && /Appel formé/.test(m.subject))); // le porteur est informé
  assert.ok(mailer.outbox.some((m) => m.to === 'pres@cer.test' && /Appel/.test(m.subject)));
  assert.ok(!mailer.outbox.some((m) => m.to === 't3@cer.test')); // déporté : non notifié
});

test('dossier d’appel : échanges initiaux visibles avec leurs auteurs, nouveaux rapporteurs, séance plénière', async () => {
  let r = await api('GET', `/api/dossiers/${S.appeal.id}`, 't2');
  assert.equal(r.status, 200);
  assert.equal(r.body.initial.reference, S.parent.reference);
  assert.ok(r.body.initial.comments.some((c) => c.author_name === 'T1' && /information insuffisante/.test(c.body)));
  assert.ok(r.body.initial.actes.some((a) => a.type === 'avis'));
  r = await api('GET', `/api/dossiers/${S.appeal.id}`, 't3');
  assert.equal(r.status, 403);
  r = await api('POST', `/api/gov/dossiers/${S.appeal.id}/rapporteurs`, 'pres', { user_id: U.t1.id });
  assert.equal(r.status, 400); assert.match(r.body.error, /différents/);
  r = await api('POST', `/api/gov/dossiers/${S.appeal.id}/rapporteurs`, 'pres', { user_id: U.t4.id });
  assert.equal(r.status, 201);
  r = await api('POST', `/api/gov/dossiers/${S.appeal.id}/scrutins`, 'pres', { procedure: 'simplifiee', rapporteur_id: U.t4.id });
  assert.equal(r.status, 400); assert.match(r.body.error, /plénière/);
  r = await api('GET', `/api/dossiers/${S.parent.id}`, 'pres');
  assert.equal(r.body.appealOf.reference, S.appeal.reference);
});

test('un seul appel par avis ; pas d’appel d’un appel', async () => {
  let r = await api('POST', '/api/public/submissions', null, undefined, appealForm({ appeal_reference: S.parent.reference, appeal_code: S.code, appeal_role: 'porteur', appeal_reason: 'x'.repeat(30) }));
  assert.equal(r.status, 400); assert.equal(r.body.appealStatus, 'deja_appel');
  r = await api('POST', '/api/public/submissions', null, undefined, appealForm({ appeal_reference: S.appeal.reference, appeal_code: S.code, appeal_role: 'porteur', appeal_reason: 'x'.repeat(30) }));
  assert.equal(r.status, 400); assert.equal(r.body.appealStatus, 'appel_d_appel');
});

test('hors délai : nouvelle demande, qui doit être complète, sans copies', async () => {
  const saved = config.appealDelayMonths;
  config.appealDelayMonths = 0;
  try {
    let r = await api('POST', '/api/public/submissions', null, undefined, appealForm({ appeal_reference: S.parent.reference, appeal_code: S.code, appeal_role: 'porteur', appeal_reason: 'x'.repeat(30) }));
    assert.equal(r.status, 400); assert.equal(r.body.appealStatus, 'hors_delai');
    assert.match(r.body.error, /nouvelle demande/);
    r = await api('POST', '/api/public/submissions', null, undefined, appealForm(
      { appeal_reference: S.parent.reference, appeal_code: S.code, appeal_role: 'porteur', appeal_reason: 'x'.repeat(30), applicant_email: 'porteur@hopital.test', applicant_name: 'Dr Porteur',
        title: 'Étude initiale, version 2', qualification: 'RNIPH', qualification_reason: 'Données existantes' },
      { piece_a: 'lettre.pdf', piece_b: 'protocole-v2.pdf' }));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.kind, 'nouvelle');
    assert.match(r.body.message, /n’est pas reconnue comme un appel/);
    const d = db.get().prepare('SELECT * FROM dossiers WHERE reference = ?').get(r.body.reference);
    assert.equal(d.kind, 'initiale'); assert.equal(d.related_reference, S.parent.reference); assert.equal(d.parent_id, null);
    assert.equal(db.get().prepare('SELECT COUNT(*) n FROM documents WHERE dossier_id = ?').get(d.id).n, 2);
  } finally { config.appealDelayMonths = saved; }
});

test('rapport annuel : appels comptés ; intégrité conservée', async () => {
  const r = await api('GET', `/api/gov/rapport-annuel?annee=${new Date().getFullYear()}`, 'pres');
  assert.equal(r.body.stats.appels, 1);
  assert.equal(domain.verifyIntegrity().ok, true);
});
