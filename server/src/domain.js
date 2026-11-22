'use strict';
/**
 * Règles métier : dossiers, documents, commentaires signés et chaînés.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const config = require('./config');
const sec = require('./security');

// Pièces du dossier de saisine (règlement intérieur, annexe 3)
const PIECES = {
  a: 'Lettre de saisine signée (qualification réglementaire et justification)',
  b: 'Protocole ou synopsis détaillé (enjeux éthiques)',
  c: 'Note d’information et formulaire de consentement',
  d: 'Description des données (sources, variables, pseudonymisation, hébergement, conservation)',
  e: 'Formalité CNIL prévue et DPD consulté',
  f: 'Résumé de l’analyse d’impact (AIPD)',
  g: 'CV courts du porteur et de l’investigateur principal',
  h: 'Sources de financement et déclarations d’intérêts',
  i: 'Demande d’accès aux données du registre (annexe 4)',
  j: 'Avis du Conseil scientifique',
  autre: 'Autre document',
};

// Statuts d'un dossier (art. 27 à 33)
const STATUSES = {
  depose: 'Déposé',
  recevable: 'Recevable — accusé de réception envoyé',
  incomplet: 'Incomplet — pièces demandées',
  instruction: 'En instruction',
  questions: 'Questions au porteur (délai suspendu)',
  seance: 'Inscrit en séance',
  avis_favorable: 'Avis favorable',
  avis_reserve: 'Avis favorable sous réserve',
  avis_modifications: 'Demande de modifications',
  avis_defavorable: 'Avis défavorable',
  incompetence: 'Incompétence — renvoi vers un CPP',
  suivi: 'Suivi du projet',
  clos: 'Clos',
};

const ALLOWED_MIME = new Map([
  ['application/pdf', '.pdf'],
  ['application/msword', '.doc'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
  ['application/vnd.oasis.opendocument.text', '.odt'],
  ['application/vnd.ms-excel', '.xls'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
  ['application/vnd.oasis.opendocument.spreadsheet', '.ods'],
  ['text/plain', '.txt'],
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
]);
const ALLOWED_EXT = new Set(['.pdf', '.doc', '.docx', '.odt', '.xls', '.xlsx', '.ods', '.txt', '.png', '.jpg', '.jpeg']);

function checkFile(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!ALLOWED_EXT.has(ext)) return `Type de fichier non accepté : ${file.originalname}`;
  // Vérification de la signature binaire des formats principaux
  const b = file.buffer;
  if (ext === '.pdf' && b.subarray(0, 5).toString('latin1') !== '%PDF-') return `${file.originalname} n'est pas un PDF valide`;
  if (['.docx', '.xlsx', '.odt', '.ods'].includes(ext) && !(b[0] === 0x50 && b[1] === 0x4b)) return `${file.originalname} est corrompu`;
  if (ext === '.png' && b.readUInt32BE(0) !== 0x89504e47) return `${file.originalname} n'est pas une image PNG valide`;
  if (['.jpg', '.jpeg'].includes(ext) && !(b[0] === 0xff && b[1] === 0xd8)) return `${file.originalname} n'est pas une image JPEG valide`;
  return null;
}

function mimeFor(name) {
  const ext = path.extname(name).toLowerCase().replace('.jpeg', '.jpg');
  for (const [m, e] of ALLOWED_MIME) if (e === ext) return m;
  return 'application/octet-stream';
}

function safeName(name) {
  return String(name || 'document').normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 180);
}

/** Crée un dossier et lui attribue la référence CER-PROMEDNAV-AAAA-NNN (art. 31.3). */
const createDossier = (data) => db.get().transaction(() => {
  const now = Date.now();
  const year = new Date(now).getFullYear();
  const { n } = db.get().prepare('SELECT COALESCE(MAX(seq),0)+1 AS n FROM dossiers WHERE year = ?').get(year);
  const reference = `${config.referencePrefix}-${year}-${String(n).padStart(3, '0')}`;
  const r = db.get().prepare(`INSERT INTO dossiers
    (reference, year, seq, title, applicant_name, applicant_email, applicant_affiliation, investigator,
     qualification, qualification_reason, summary, funding, procedure, status, source, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    reference, year, n, data.title, data.applicant_name, data.applicant_email, data.applicant_affiliation || '',
    data.investigator || '', data.qualification || 'RNIPH', data.qualification_reason || '', data.summary || '',
    data.funding || '', data.procedure === 'simplifiee' ? 'simplifiee' : 'ordinaire', 'depose', data.source || 'site', now, now);
  db.get().prepare('INSERT INTO dossier_events (dossier_id, at, user_id, type, value, details) VALUES (?,?,?,?,?,?)')
    .run(r.lastInsertRowid, now, data.created_by || null, 'status', 'depose', `Dépôt (${data.source || 'site'})`);
  return getDossier(r.lastInsertRowid);
}).immediate();

const getDossier = (id) => db.get().prepare('SELECT * FROM dossiers WHERE id = ?').get(id);

/** Enregistre un fichier chiffré sur le disque du serveur et l'inscrit au dossier. */
function addDocument(dossierId, file, { piece = 'autre', label = '', userId = null } = {}) {
  const p = Object.prototype.hasOwnProperty.call(PIECES, piece) ? piece : 'autre';
  const storage = crypto.randomUUID() + '.bin';
  fs.writeFileSync(path.join(config.filesDir, storage), sec.encrypt(file.buffer), { mode: 0o600 });
  const name = safeName(file.originalname);
  const { v } = db.get().prepare('SELECT COALESCE(MAX(version),0)+1 AS v FROM documents WHERE dossier_id = ? AND piece = ? AND original_name = ?')
    .get(dossierId, p, name);
  const r = db.get().prepare(`INSERT INTO documents
    (dossier_id, piece, label, version, original_name, mime, size, sha256, storage_name, uploaded_by, uploaded_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    dossierId, p, String(label || '').slice(0, 200), v, name, mimeFor(name), file.buffer.length,
    sec.sha256(file.buffer), storage, userId, Date.now());
  return db.get().prepare('SELECT * FROM documents WHERE id = ?').get(r.lastInsertRowid);
}

function readDocument(doc) {
  const buf = sec.decrypt(fs.readFileSync(path.join(config.filesDir, doc.storage_name)));
  if (sec.sha256(buf) !== doc.sha256) throw new Error('Intégrité du document compromise');
  return buf;
}

// ----- Commentaires signés -----
const GENESIS = '0'.repeat(64);

function canonical(c) {
  return JSON.stringify([
    'v1', c.dossier_id, c.parent_id ?? null, c.document_id ?? null, c.kind, c.author_id, c.author_name,
    c.author_quality, c.author_email, c.created_at, sec.sha256(c.body), c.prev_hash,
  ]);
}

const addComment = ({ dossierId, parentId = null, documentId = null, author, body, kind = null }) => db.get().transaction(() => {
  const last = db.get().prepare('SELECT hash FROM comments ORDER BY id DESC LIMIT 1').get();
  const c = {
    dossier_id: dossierId,
    parent_id: parentId,
    document_id: documentId,
    kind: kind || (parentId ? 'reponse' : 'commentaire'),
    author_id: author.id,
    author_name: author.full_name,
    author_quality: author.quality || '',
    author_email: author.email,
    body,
    created_at: Date.now(),
    prev_hash: last ? last.hash : GENESIS,
  };
  c.hash = sec.sha256(canonical(c));
  c.signature = sec.sign(c.hash);
  const r = db.get().prepare(`INSERT INTO comments
    (dossier_id, parent_id, document_id, kind, author_id, author_name, author_quality, author_email, body, created_at, prev_hash, hash, signature)
    VALUES (@dossier_id,@parent_id,@document_id,@kind,@author_id,@author_name,@author_quality,@author_email,@body,@created_at,@prev_hash,@hash,@signature)`).run(c);
  return { id: r.lastInsertRowid, ...c };
}).immediate();

/** Vérifie la chaîne complète des commentaires et l'intégrité des fichiers. */
function verifyIntegrity({ checkFiles = true } = {}) {
  const gov = require('./governance');
  const problems = [];
  let prev = GENESIS, n = 0;
  for (const c of db.get().prepare('SELECT * FROM comments ORDER BY id').iterate()) {
    n++;
    if (c.prev_hash !== prev) problems.push(`Commentaire #${c.id} : chaînage rompu (commentaire supprimé ou inséré ?)`);
    const h = sec.sha256(canonical(c));
    if (h !== c.hash) problems.push(`Commentaire #${c.id} : contenu modifié`);
    if (!sec.verifySignature(c.hash, c.signature)) problems.push(`Commentaire #${c.id} : signature invalide`);
    prev = c.hash;
  }
  let files = 0;
  if (checkFiles) {
    for (const d of db.get().prepare('SELECT * FROM documents ORDER BY id').iterate()) {
      files++;
      try { readDocument(d); } catch (e) { problems.push(`Document #${d.id} (${d.original_name}) : ${e.message}`); }
    }
  }
  // Actes (avis, procès-verbaux, rapports) : empreinte du fichier stocké
  let actes = 0;
  if (checkFiles) {
    for (const a of db.get().prepare('SELECT * FROM actes ORDER BY id').iterate()) {
      actes++;
      try { gov.readActe(a); } catch (e) { problems.push(`Acte #${a.id} (${a.original_name}) : ${e.message}`); }
    }
  }
  // Scrutins clos : le décompte doit correspondre aux bulletins conservés
  let ballots = 0;
  for (const sc of db.get().prepare("SELECT * FROM scrutins WHERE status = 'clos' ORDER BY id").iterate()) {
    const t = gov.tallyOf(sc.id);
    ballots += t.ballots;
    if (t.hash !== sc.tally_hash) problems.push(`Scrutin #${sc.id} : bulletins modifiés, ajoutés ou supprimés après la clôture`);
  }
  const { ob } = db.get().prepare("SELECT COUNT(*) ob FROM bulletins b JOIN scrutins s ON s.id = b.scrutin_id WHERE s.status = 'ouvert'").get();
  ballots += ob;
  problems.push(...gov.verifyVotes());
  return { ok: problems.length === 0, comments: n, documents: files, actes, ballots, lastHash: prev, problems };
}

/** Exécute un contrôle et le consigne (preuve opposable du contrôle préalable). */
function recordIntegrityCheck(userId, purpose) {
  const r = verifyIntegrity();
  const ins = db.get().prepare(`INSERT INTO integrity_checks (at, user_id, purpose, ok, comments, documents, ballots, actes, last_hash, problems)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(Date.now(), userId, purpose, r.ok ? 1 : 0, r.comments, r.documents, r.ballots, r.actes, r.lastHash, JSON.stringify(r.problems));
  return { ...r, checkId: ins.lastInsertRowid };
}

module.exports = {
  PIECES, STATUSES, checkFile, createDossier, getDossier, addDocument, readDocument, addComment,
  verifyIntegrity, recordIntegrityCheck, canonical, GENESIS, safeName,
};
