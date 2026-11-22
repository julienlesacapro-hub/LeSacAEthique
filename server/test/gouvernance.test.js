'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lesaca-gov-'));
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = tmp;
process.env.KEYS_DIR = path.join(tmp, 'keys');
process.env.PUBLIC_URL = 'http://test.local';

const config = require('../src/config');
config.rebuild();
const db = require('../src/db');
const domain = require('../src/domain');
const mailer = require('../src/mailer');
const { createSession } = require('../src/auth');
const { createApp } = require('../src/app');

let server, base;
const T = {}; const U = {}; const S = {};
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const fakeReq = { ip: '127.0.0.1', get: () => 'test' };

function mkUser(key, { role = 'ecriture', fonction = 'titulaire', hp = 1, indep = 0, quality }) {
  const r = db.get().prepare(`INSERT INTO users (email, full_name, quality, role, fonction, health_professional, independent, status, password_hash, totp_enabled, created_at)
    VALUES (?,?,?,?,?,?,?,'actif','x',1,?)`).run(`${key}@cer.test`, key.toUpperCase(), quality || fonction, role, fonction, hp, indep, Date.now());
  U[key] = db.get().prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
  T[key] = createSession(U[key], 'full', fakeReq);
}

async function api(method, url, who, body, form) {
  const headers = { Authorization: `Bearer ${T[who]}` };
  let payload;
  if (form) payload = form; else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(base + url, { method, headers, body: payload });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, body: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
}

function newDossier(title) {
  const d = domain.createDossier({ title, applicant_name: 'Dr Porteur', applicant_email: 'porteur@hopital.test', qualification: 'RNIPH' });
  domain.addDocument(d.id, { originalname: 'protocole.pdf', buffer: PDF }, { piece: 'b' });
  return d;
}

before(async () => {
  const app = createApp();
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  mkUser('pres', { role: 'admin', fonction: 'president', quality: 'Médecin hyperbare, président' });
  mkUser('vp', { fonction: 'vice_president', quality: 'Médecin de la plongée' });
  mkUser('t1', { fonction: 'titulaire', hp: 0, indep: 1, quality: 'Juriste en droit de la santé' });
  mkUser('t2', { fonction: 'titulaire', quality: 'Infirmier' });
  mkUser('t3', { fonction: 'titulaire', quality: 'Méthodologiste' });
  mkUser('sup1', { fonction: 'suppleant', hp: 0, quality: 'Représentant des usagers' });
  mkUser('secr', { role: 'lecture', fonction: 'secretariat', quality: 'Secrétariat' });
  S.d1 = newDossier('Étude A'); S.d2 = newDossier('Étude B'); S.d3 = newDossier('Étude C');
});
after(() => { server.close(); db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('administrateur de l’outil = président (ou vice-président) uniquement', async () => {
  let r = await api('PATCH', `/api/users/${U.t2.id}`, 'pres', { role: 'admin' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /réservé/);
  r = await api('POST', '/api/users', 'pres', { email: 'x@cer.test', full_name: 'X Y', role: 'admin', fonction: 'titulaire' });
  assert.equal(r.status, 400);
});

test('secrétariat : gère les dossiers et les séances, mais ne rend pas d’avis', async () => {
  let r = await api('PATCH', `/api/dossiers/${S.d1.id}`, 'secr', { status: 'recevable' });
  assert.equal(r.status, 200);
  r = await api('PATCH', `/api/dossiers/${S.d1.id}`, 'secr', { status: 'avis_favorable' });
  assert.equal(r.status, 403);
  r = await api('POST', '/api/gov/seances', 'secr', { date: Date.now(), mode: 'visio', lieu: 'Visioconférence' });
  assert.equal(r.status, 201);
  S.seance = r.body.seance;
  r = await api('POST', `/api/gov/dossiers/${S.d1.id}/rapporteurs`, 'secr', { user_id: U.t1.id });
  assert.equal(r.status, 403);
});

test('rapporteurs : deux au plus, dont un non professionnel de santé (art. 28.1)', async () => {
  let r = await api('POST', `/api/gov/dossiers/${S.d1.id}/rapporteurs`, 'pres', { user_id: U.t2.id });
  assert.equal(r.status, 201);
  r = await api('POST', `/api/gov/dossiers/${S.d1.id}/rapporteurs`, 'pres', { user_id: U.t3.id });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /profession de santé/);
  r = await api('POST', `/api/gov/dossiers/${S.d1.id}/rapporteurs`, 'pres', { user_id: U.t1.id });
  assert.equal(r.status, 201);
  r = await api('POST', `/api/gov/dossiers/${S.d1.id}/rapporteurs`, 'pres', { user_id: U.vp.id });
  assert.equal(r.status, 400);
  r = await api('POST', `/api/gov/dossiers/${S.d1.id}/rapporteurs`, 'pres', { user_id: U.secr.id });
  assert.equal(r.status, 400);
  // un rapporteur publie son rapport
  r = await api('POST', `/api/dossiers/${S.d1.id}/comments`, 't1', { body: 'Rapport : le projet est conforme.', as_rapport: true });
  assert.equal(r.status, 201);
  assert.equal(r.body.comment.kind, 'rapport');
  r = await api('POST', `/api/dossiers/${S.d1.id}/comments`, 't3', { body: 'Je ne suis pas rapporteur', as_rapport: true });
  assert.equal(r.status, 403);
});

test('vote impossible sans deux rapporteurs', async () => {
  const r = await api('POST', `/api/gov/dossiers/${S.d2.id}/scrutins`, 'pres', {});
  assert.equal(r.status, 400);
  assert.match(r.body.error, /rapporteurs/);
});

test('scrutin secret avec suppléant : un vote par siège, bulletins anonymes et immuables', async () => {
  let r = await api('POST', `/api/gov/dossiers/${S.d1.id}/scrutins`, 'pres', { seance_id: S.seance.id, secret: true, substitutes: [{ user_id: U.sup1.id, substitute_for: U.t3.id }] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  S.sc = r.body.scrutin;
  assert.equal(S.sc.electeurs.length, 6);
  const vote = (who, choice, motivation) => api('POST', `/api/gov/scrutins/${S.sc.id}/vote`, who, { choice, motivation });
  assert.equal((await vote('pres', 'favorable')).status, 200);
  assert.equal((await vote('t1', 'favorable', 'Conforme')).status, 200);
  assert.equal((await vote('t2', 'defavorable', 'Information des plongeurs insuffisante')).status, 200);
  assert.equal((await vote('sup1', 'favorable')).status, 200);
  r = await vote('t3', 'favorable');
  assert.equal(r.status, 400);
  assert.match(r.body.error, /suppléant/);
  assert.equal((await vote('vp', 'abstention')).status, 200);
  assert.equal((await vote('pres', 'defavorable')).status, 400); // pas de second vote
  assert.equal((await vote('secr', 'favorable')).status, 400); // le secrétariat ne vote pas
  const rows = db.get().prepare('SELECT * FROM bulletins WHERE scrutin_id = ?').all(S.sc.id);
  assert.equal(rows.length, 5);
  assert.ok(rows.every((b) => b.voter_id === null && b.voter_name === null));
  assert.throws(() => db.get().prepare("UPDATE bulletins SET choice = 'defavorable'").run(), /ne peut pas être modifié/);
  assert.throws(() => db.get().prepare('DELETE FROM bulletins').run(), /ne peut pas être supprimé/);
  // résultat invisible avant la clôture
  r = await api('GET', `/api/dossiers/${S.d1.id}`, 't2');
  assert.equal(r.body.scrutins[0].counts, undefined);
});

test('clôture refusée si le contrôle de non-altération échoue', async () => {
  const c = db.get().prepare('SELECT * FROM comments WHERE dossier_id = ? LIMIT 1').get(S.d1.id);
  db.get().exec('DROP TRIGGER comments_no_update');
  db.get().prepare("UPDATE comments SET body = 'falsifié' WHERE id = ?").run(c.id);
  let r = await api('POST', `/api/gov/scrutins/${S.sc.id}/cloture`, 'pres');
  assert.equal(r.status, 400);
  assert.match(r.body.error, /NON CONFORME/);
  assert.ok(r.body.problems.length);
  const check = db.get().prepare('SELECT * FROM integrity_checks ORDER BY id DESC LIMIT 1').get();
  assert.equal(check.ok, 0); // le contrôle négatif est lui-même conservé
  db.get().prepare('UPDATE comments SET body = ? WHERE id = ?').run(c.body, c.id);
  db.get().exec(db.SCHEMA);
  r = await api('POST', `/api/gov/scrutins/${S.sc.id}/cloture`, 'vp');
  assert.equal(r.status, 403); // seul le président (administrateur) valide le vote
});

test('clôture : quorum, majorité des votants, opinions divergentes, contrôle consigné', async () => {
  const r = await api('POST', `/api/gov/scrutins/${S.sc.id}/cloture`, 'pres');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const v = r.body.scrutin;
  assert.equal(v.result, 'favorable');
  assert.equal(v.quorum.ok, true);
  assert.equal(v.quorum.needed, 3); // 5 membres votants en exercice
  assert.equal(v.counts.favorable, 3);
  assert.equal(v.divergent.length, 1);
  assert.equal(v.ballots, undefined); // vote secret : pas de bulletins nominatifs
  const check = db.get().prepare('SELECT * FROM integrity_checks WHERE id = ?').get(v.integrity_check_id);
  assert.equal(check.ok, 1);
  assert.match(check.purpose, /Clôture du scrutin/);
  assert.throws(() => db.get().prepare("UPDATE scrutins SET result = 'defavorable' WHERE id = ?").run(S.sc.id), /ne peut pas être modifié/);
});

test('falsification d’un bulletin après clôture : détectée', () => {
  db.get().exec('DROP TRIGGER bulletins_no_update');
  const b = db.get().prepare('SELECT * FROM bulletins WHERE scrutin_id = ? LIMIT 1').get(S.sc.id);
  db.get().prepare("UPDATE bulletins SET motivation = 'ajouté' WHERE id = ?").run(b.id);
  const r = domain.verifyIntegrity();
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes('bulletins')));
  db.get().prepare('UPDATE bulletins SET motivation = ? WHERE id = ?').run(b.motivation, b.id);
  db.get().exec(db.SCHEMA);
  assert.equal(domain.verifyIntegrity().ok, true);
});

test('avis selon l’annexe 7 : PDF bilingue, statut mis à jour, unicité', async () => {
  let r = await api('POST', `/api/gov/dossiers/${S.d1.id}/avis`, 'pres', { scrutin_id: S.sc.id, motivation: '' });
  assert.equal(r.status, 400);
  r = await api('POST', `/api/gov/dossiers/${S.d1.id}/avis`, 'pres', { scrutin_id: S.sc.id, motivation: 'Le projet respecte les principes de la Déclaration d’Helsinki.', motivation_en: 'The project complies with the Declaration of Helsinki.', validity_months: 24 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  S.avis = r.body.acte;
  assert.match(S.avis.title, /CER-PROMEDNAV-\d{4}-001/);
  r = await api('GET', `/api/gov/actes/${S.avis.id}/content`, 't2');
  assert.equal(r.status, 200);
  assert.equal(r.body.subarray(0, 5).toString(), '%PDF-');
  S.avisPdf = r.body;
  assert.equal(domain.getDossier(S.d1.id).status, 'avis_favorable');
  r = await api('POST', `/api/gov/dossiers/${S.d1.id}/avis`, 'pres', { scrutin_id: S.sc.id, motivation: 'bis' });
  assert.equal(r.status, 400);
});

test('signature qualifiée : seule une version signée de l’acte exact est acceptée', async () => {
  const sigPart = Buffer.from('\n3 0 obj\n<</Type /Sig /Filter /Adobe.PPKLite /SubFilter /ETSI.CAdES.detached /ByteRange [0 100 200 300] /Contents <3082>>>\nendobj\n%%EOF\n');
  const send = (buf) => { const f = new FormData(); f.append('file', new Blob([buf]), 'avis-signe.pdf'); f.set('note', 'Signé avec certificat qualifié'); return api('POST', `/api/gov/actes/${S.avis.id}/signe`, 'pres', undefined, f); };
  let r = await send(Buffer.concat([Buffer.from('%PDF-1.7 autre document'), sigPart]));
  assert.equal(r.status, 400);
  assert.match(r.body.error, /ne correspond pas/);
  r = await send(Buffer.concat([S.avisPdf, Buffer.from('\n% simple ajout sans signature\n')]));
  assert.equal(r.status, 400);
  r = await send(Buffer.concat([S.avisPdf, sigPart]));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.acte.signed, true);
  assert.equal(r.body.acte.meta.subFilter, 'ETSI.CAdES.detached');
  mailer.outbox.length = 0;
  r = await api('POST', `/api/gov/actes/${S.avis.id}/transmettre`, 'pres', {});
  assert.equal(r.status, 200);
  assert.equal(r.body.signed, true);
  assert.equal(mailer.outbox[0].to, 'porteur@hopital.test');
  assert.match(mailer.outbox[0].attachments[0].filename, /-signe\.pdf$/);
});

test('procédure simplifiée : pas d’avis défavorable ; examen plénier sur demande d’un membre', async () => {
  await api('POST', `/api/gov/dossiers/${S.d2.id}/rapporteurs`, 'pres', { user_id: U.t1.id });
  let r = await api('POST', `/api/gov/dossiers/${S.d2.id}/scrutins`, 'pres', { procedure: 'simplifiee', rapporteur_id: U.t1.id });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const sid = r.body.scrutin.id;
  r = await api('POST', `/api/gov/scrutins/${sid}/vote`, 't1', { choice: 'defavorable' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /art\. 30\.2/);
  r = await api('POST', `/api/gov/scrutins/${sid}/vote`, 't2', { choice: 'favorable' });
  assert.equal(r.status, 400); // non appelé à voter
  r = await api('POST', `/api/gov/dossiers/${S.d2.id}/pleniere`, 't2');
  assert.equal(r.status, 200);
  assert.equal(db.get().prepare('SELECT status FROM scrutins WHERE id = ?').get(sid).status, 'annule');
  assert.equal(domain.getDossier(S.d2.id).procedure, 'ordinaire');
});

test('quorum non atteint : aucun avis possible', async () => {
  await api('POST', `/api/gov/dossiers/${S.d3.id}/rapporteurs`, 'pres', { user_id: U.t1.id });
  await api('POST', `/api/gov/dossiers/${S.d3.id}/rapporteurs`, 'pres', { user_id: U.t2.id });
  let r = await api('POST', `/api/gov/dossiers/${S.d3.id}/scrutins`, 'pres', { seance_id: S.seance.id });
  const sid = r.body.scrutin.id;
  await api('POST', `/api/gov/scrutins/${sid}/vote`, 'pres', { choice: 'favorable' });
  r = await api('POST', `/api/gov/scrutins/${sid}/cloture`, 'pres');
  assert.equal(r.body.scrutin.result, 'quorum_non_atteint');
  r = await api('POST', `/api/gov/dossiers/${S.d3.id}/avis`, 'pres', { scrutin_id: sid, motivation: 'x' });
  assert.equal(r.status, 400);
});

test('déport d’un rapporteur : la désignation prend fin', async () => {
  const r = await api('POST', `/api/dossiers/${S.d3.id}/conflicts`, 't2', { reason: 'Lien hiérarchique avec le porteur' });
  assert.equal(r.status, 200);
  const rows = db.get().prepare('SELECT * FROM rapporteurs WHERE dossier_id = ? AND user_id = ?').all(S.d3.id, U.t2.id);
  assert.ok(rows[0].ended_at);
});

test('procès-verbal à la clôture de séance, séance close figée', async () => {
  let r = await api('POST', `/api/gov/seances/${S.seance.id}/cloture`, 'pres');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await api('GET', `/api/gov/actes/${r.body.acte.id}/content`, 'pres');
  assert.equal(r.body.subarray(0, 5).toString(), '%PDF-');
  r = await api('POST', `/api/gov/dossiers/${S.d2.id}/rapporteurs`, 'pres', { user_id: U.t3.id });
  r = await api('POST', `/api/gov/dossiers/${S.d2.id}/scrutins`, 'pres', { seance_id: S.seance.id });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /close/);
  // le membre déporté sur un dossier de la séance n'accède pas au PV
  const pv = db.get().prepare("SELECT id FROM actes WHERE type = 'pv'").get();
  r = await api('GET', `/api/gov/actes/${pv.id}/content`, 't2');
  assert.equal(r.status, 403);
});

test('rapport annuel sans élément confidentiel', async () => {
  const year = new Date().getFullYear();
  let r = await api('GET', `/api/gov/rapport-annuel?annee=${year}`, 't3');
  assert.equal(r.status, 200);
  const st = r.body.stats;
  assert.equal(st.deposes, 3);
  assert.equal(st.avis, 1);
  assert.equal(st.byCategory.favorable, 1);
  assert.equal(st.delays.n, 1);
  assert.equal(st.seances, 1);
  assert.ok(!JSON.stringify(st).includes('Étude'));
  r = await api('POST', '/api/gov/rapport-annuel', 'pres', { annee: year });
  assert.equal(r.status, 201);
  assert.equal(domain.verifyIntegrity().ok, true);
});
