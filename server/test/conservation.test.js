'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lesaca-cons-'));
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
const reception = require('../src/reception');
const { createSession } = require('../src/auth');
const { createApp } = require('../src/app');

let server, base;
const T = {}; const U = {}; const S = {};
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const YEAR = 365.25 * 864e5;

function mkUser(key, { role = 'ecriture', fonction = 'titulaire', hp = 1, indep = 0, dpd = 0 }) {
  const r = db.get().prepare(`INSERT INTO users (email, full_name, quality, role, fonction, health_professional, independent, dpd, status, password_hash, totp_enabled, totp_secret, created_at)
    VALUES (?,?,?,?,?,?,?,?,'actif','x',1,?,?)`).run(`${key}@cer.test`, key.toUpperCase(), `Qualité ${key}`, role, fonction, hp, indep, dpd, sec.encryptText(totp.generateSecret()), Date.now());
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
  const r = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text() };
}

/** Dossier instruit jusqu'à la clôture (avis signé à la main versé). */
async function closedDossier(title, { seance = false } = {}) {
  const d = domain.createDossier({ title, applicant_name: 'Dr Porteur', applicant_email: 'porteur@hopital.test', qualification: 'RNIPH', qualification_reason: 'x' });
  domain.addDocument(d.id, { originalname: 'protocole.pdf', buffer: PDF }, { piece: 'b' });
  await api('POST', `/api/dossiers/${d.id}/comments`, 't1', { body: `Analyse de ${title}` });
  await api('POST', `/api/gov/dossiers/${d.id}/rapporteurs`, 'pres', { user_id: U.t1.id });
  await api('POST', `/api/gov/dossiers/${d.id}/rapporteurs`, 'pres', { user_id: U.t2.id });
  let seanceId = null;
  if (seance) seanceId = (await api('POST', '/api/gov/seances', 'pres', { date: Date.now(), mode: 'visio' })).body.seance.id;
  const sc = (await api('POST', `/api/gov/dossiers/${d.id}/scrutins`, 'pres', { seance_id: seanceId, deadline: seanceId ? null : Date.now() + 14 * 864e5 })).body.scrutin;
  for (const k of ['pres', 't1', 't2']) await api('POST', `/api/gov/scrutins/${sc.id}/vote`, k, { choice: 'favorable', code: code(k) });
  await api('POST', `/api/gov/scrutins/${sc.id}/cloture`, 'pres');
  if (seanceId) assert.equal((await api('POST', `/api/gov/seances/${seanceId}/cloture`, 'pres')).status, 200);
  const avis = (await api('POST', `/api/gov/dossiers/${d.id}/avis`, 'pres', { scrutin_id: sc.id, motivation: 'Conforme.' })).body.acte;
  const f = new FormData(); f.append('file', new Blob([PDF]), 'scan.pdf'); f.set('code', avis.meta.verifCode);
  const r = await api('POST', `/api/gov/actes/${avis.id}/signe-manuscrit`, 'pres', undefined, f);
  assert.ok(r.body.closure, JSON.stringify(r.body));
  return { d: domain.getDossier(d.id), avis };
}

before(async () => {
  const app = createApp();
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  mkUser('pres', { role: 'admin', fonction: 'president' });
  mkUser('t1', { hp: 0, indep: 1 });
  mkUser('t2', {});
  mkUser('dpd', { role: 'lecture', fonction: 'consultatif', dpd: 1 });
  S.a = await closedDossier('Étude A');
  S.b = await closedDossier('Étude B', { seance: true });
});
after(() => { server.close(); db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

// ===================== Réception de l'avis =====================
test('avis non transmis : le délai d’appel court de la date de l’avis', () => {
  const dl = reception.appealDeadline(db.get().prepare('SELECT * FROM actes WHERE id = ?').get(S.a.avis.id));
  assert.equal(dl.basis, 'non_transmis');
  assert.equal(dl.start, S.a.avis.created_at);
});

test('envoi : lien d’accusé de réception ; sans confirmation, réception réputée après le délai de présomption', async () => {
  mailer.outbox.length = 0;
  const r = await api('POST', `/api/gov/actes/${S.a.avis.id}/transmettre`, 'pres', { subject: 'Avis', body: 'Bonjour.' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const m = mailer.outbox[0];
  S.token = m.text.match(/reception\/([A-Za-z0-9_-]+)/)[1];
  const env = db.get().prepare('SELECT body FROM envois ORDER BY id DESC').get();
  assert.ok(!env.body.includes(S.token)); // le jeton n'est pas conservé en clair
  const g = await api('GET', `/api/dossiers/${S.a.d.id}`, 'pres');
  assert.equal(g.body.appeal.basis, 'presumee');
  assert.equal(g.body.appeal.start - g.body.appeal.firstSent, config.receptionPresumptionDays * 864e5);
});

test('accusé de réception : l’ouverture du lien ne confirme pas, le bouton confirme une seule fois', async () => {
  let r = await api('GET', `/api/public/reception/${S.token}`);
  assert.equal(r.status, 200);
  assert.match(r.body, /Je confirme la réception/);
  assert.equal(reception.appealDeadline(db.get().prepare('SELECT * FROM actes WHERE id = ?').get(S.a.avis.id)).basis, 'presumee');
  r = await api('POST', `/api/public/reception/${S.token}`);
  assert.equal(r.status, 200);
  assert.match(r.body, /est enregistrée/);
  const dl = reception.appealDeadline(db.get().prepare('SELECT * FROM actes WHERE id = ?').get(S.a.avis.id));
  assert.equal(dl.basis, 'confirmee');
  assert.ok(Math.abs(dl.start - Date.now()) < 60000);
  assert.equal(dl.deadline, reception.addMonths(dl.start, config.appealDelayMonths));
  r = await api('POST', `/api/public/reception/${S.token}`);
  assert.match(r.body, /avait déjà été confirmée/);
  r = await api('POST', '/api/public/reception/jeton-inexistant-000000000000');
  assert.equal(r.status, 404);
  r = await api('POST', `/api/gov/actes/${S.a.avis.id}/reception`, 'pres', { date: Date.now() - 864e5, note: 'Avis de réception postal' });
  assert.equal(r.status, 400); // réception déjà établie
});

test('déclaration de réception par le président ; confirmation tardive plafonnée par la présomption', async () => {
  let r = await api('POST', `/api/gov/actes/${S.b.avis.id}/reception`, 'pres', { date: Date.now() + 864e5, note: 'LRAR' });
  assert.equal(r.status, 400); // date future
  r = await api('POST', `/api/gov/actes/${S.b.avis.id}/reception`, 'pres', { date: Date.now(), note: 'Avis de réception postal n° 1A2B' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.appeal.basis, 'declaree');
  // confirmation 30 jours après l'envoi : l'avis reste réputé reçu au 15e jour
  const sent = Date.now() - 30 * 864e5; const tok = reception.newToken();
  const a2 = require('../src/governance').storeActe({ type: 'avis', dossierId: S.a.d.id, title: 'Avis test', buffer: PDF, originalName: 'a.pdf', byId: U.pres.id });
  reception.record({ acte: a2, dossierId: S.a.d.id, envoiId: null, token: tok, sentAt: sent });
  reception.confirm(tok, '1');
  const dl = reception.appealDeadline(a2);
  assert.equal(dl.basis, 'presumee');
  assert.equal(dl.start, sent + config.receptionPresumptionDays * 864e5);
});

// ===================== Destruction =====================
test('pas de destruction sans date de fin de projet ni avant l’échéance', async () => {
  let r = await api('POST', `/api/gov/dossiers/${S.b.d.id}/destruction`, 'pres');
  assert.equal(r.status, 400); assert.match(r.body.error, /fin du projet/);
  r = await api('POST', `/api/gov/dossiers/${S.b.d.id}/fin-projet`, 'pres', { date: Date.now() - YEAR });
  assert.equal(r.status, 200);
  assert.equal(r.body.retention.due, false);
  r = await api('POST', `/api/gov/dossiers/${S.b.d.id}/destruction`, 'pres');
  assert.equal(r.status, 400); assert.match(r.body.error, /court jusqu’au/);
  r = await api('POST', `/api/gov/dossiers/${S.b.d.id}/fin-projet`, 'pres', { date: Date.now() - 11 * YEAR });
  assert.equal(r.body.retention.due, true);
  r = await api('GET', '/api/gov/conservation', 'dpd');
  assert.equal(r.status, 200);
  assert.ok(r.body.echeances.some((e) => e.reference === S.b.d.reference && e.due));
  r = await api('GET', '/api/gov/conservation', 't1');
  assert.equal(r.status, 403);
});

test('procédure : avis du DPD signé, puis décision du président signée', async () => {
  // un commentaire postérieur dans un autre dossier : la chaîne doit rester vérifiable après destruction
  await api('POST', `/api/dossiers/${S.a.d.id}/comments`, 't1', { body: 'x' }); // dossier clos : refusé
  db.get().prepare('UPDATE dossiers SET closed_at = NULL WHERE id = ?').run(S.a.d.id);
  await api('POST', `/api/dossiers/${S.a.d.id}/comments`, 't1', { body: 'Commentaire postérieur dans un autre dossier' });
  db.get().prepare('UPDATE dossiers SET closed_at = ? WHERE id = ?').run(Date.now(), S.a.d.id);

  mailer.outbox.length = 0;
  let r = await api('POST', `/api/gov/dossiers/${S.b.d.id}/destruction`, 'pres');
  assert.equal(r.status, 201, JSON.stringify(r.body));
  S.proc = r.body.procedure;
  assert.equal(S.proc.status, 'attente_dpd');
  await new Promise((res) => setTimeout(res, 30));
  assert.ok(mailer.outbox.some((m) => m.to === 'dpd@cer.test'));
  r = await api('POST', `/api/gov/destructions/${S.proc.id}/decision`, 'pres', { code: code('pres') });
  assert.equal(r.status, 400); assert.match(r.body.error, /avis du délégué/);
  r = await api('POST', `/api/gov/destructions/${S.proc.id}/avis-dpd`, 't1', { opinion: 'favorable', code: code('t1') });
  assert.equal(r.status, 400);
  r = await api('POST', `/api/gov/destructions/${S.proc.id}/avis-dpd`, 'dpd', { opinion: 'favorable', code: '000000' });
  assert.equal(r.status, 401);
  r = await api('POST', `/api/gov/destructions/${S.proc.id}/avis-dpd`, 'dpd', { opinion: 'favorable', motivation: 'Durée expirée, aucune obligation de conservation supplémentaire.', code: code('dpd') });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  S.files = db.get().prepare('SELECT storage_name FROM documents WHERE dossier_id = ?').all(S.b.d.id).map((x) => x.storage_name);
  S.nComments = db.get().prepare('SELECT COUNT(*) n FROM comments WHERE dossier_id = ?').get(S.b.d.id).n;
  r = await api('POST', `/api/gov/destructions/${S.proc.id}/decision`, 'pres', { code: '000000' });
  assert.equal(r.status, 401);
  r = await api('POST', `/api/gov/destructions/${S.proc.id}/decision`, 'pres', { code: code('pres'), keep_avis: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  S.cert = r.body.certificate;
  assert.equal(r.body.procedure.status, 'executee');
});

test('après destruction : données supprimées, avis conservés, certificat, chaîne d’intégrité vérifiable', async () => {
  const id = S.b.d.id;
  const n = (t) => db.get().prepare(`SELECT COUNT(*) n FROM ${t} WHERE dossier_id = ?`).get(id).n;
  for (const t of ['comments', 'documents', 'scrutins', 'rapporteurs', 'dossier_events', 'envois', 'receptions']) {
    if (t === 'dossier_events') assert.equal(n(t), 1); else assert.equal(n(t), 0, t);
  }
  assert.equal(db.get().prepare('SELECT COUNT(*) n FROM comment_tombstones WHERE dossier_id = ?').get(id).n, S.nComments);
  for (const f of S.files) assert.equal(fs.existsSync(path.join(config.filesDir, f)), false);
  const d = domain.getDossier(id);
  assert.equal(d.status, 'detruit'); assert.equal(d.title, '[Dossier détruit]'); assert.equal(d.applicant_email, '');
  assert.equal(d.reference, S.b.d.reference); // la numérotation reste continue
  const kept = db.get().prepare("SELECT type FROM actes WHERE dossier_id = ?").all(id).map((a) => a.type).sort();
  assert.deepEqual(kept, ['avis', 'avis', 'certificat_destruction']); // avis d'origine + exemplaire signé + certificat
  const r = await api('GET', `/api/gov/actes/${S.cert.id}/content`, 'pres');
  assert.equal(r.status, 200);
  // le procès-verbal de la séance est conservé au titre des archives
  const pv = db.get().prepare("SELECT * FROM actes WHERE type = 'pv'").all();
  assert.equal(pv.length, 1);
  const proc = db.get().prepare('SELECT counts_json FROM destructions WHERE id = ?').get(S.proc.id);
  assert.equal(JSON.parse(proc.counts_json).keptPV.length, 1);
  const v = domain.verifyIntegrity();
  assert.equal(v.ok, true, v.problems.join('\n'));
  // hors destruction autorisée, rien ne peut être supprimé
  assert.throws(() => db.get().prepare('DELETE FROM comments WHERE dossier_id = ?').run(S.a.d.id), /ne peut pas être supprimé/);
});

test('une suppression non autorisée (déclencheur contourné) est détectée', () => {
  db.get().exec('DROP TRIGGER comments_no_delete');
  const c = db.get().prepare('SELECT * FROM comments WHERE dossier_id = ? ORDER BY id LIMIT 1').get(S.a.d.id);
  db.get().pragma('foreign_keys = OFF');
  db.get().prepare('DELETE FROM comments WHERE id = ?').run(c.id);
  const v = domain.verifyIntegrity();
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => p.includes('chaînage rompu')));
});
