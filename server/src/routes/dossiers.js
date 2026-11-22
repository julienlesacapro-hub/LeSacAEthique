'use strict';
/**
 * Dossiers, documents, commentaires, déports pour conflit d'intérêts.
 */
const express = require('express');
const multer = require('multer');
const db = require('../db');
const config = require('../config');
const audit = require('../audit');
const notify = require('../notify');
const domain = require('../domain');
const { requireSession, requireRole, isRecused } = require('../auth');

const router = express.Router();
const q = () => db.get();
router.use(requireSession(['full']));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: config.maxFilesPerSubmission },
});

function loadDossier(req, res) {
  const d = domain.getDossier(req.params.id);
  if (!d) { res.status(404).json({ error: 'Dossier introuvable' }); return null; }
  if (isRecused(req.user.id, d.id)) {
    res.status(403).json({ error: 'Vous vous êtes déporté(e) sur ce dossier (conflit d’intérêts) : son contenu ne vous est plus accessible.', recused: true });
    return null;
  }
  return d;
}

const docView = (d) => ({
  id: d.id, piece: d.piece, piece_label: domain.PIECES[d.piece] || d.piece, label: d.label, version: d.version,
  original_name: d.original_name, mime: d.mime, size: d.size, sha256: d.sha256, uploaded_at: d.uploaded_at,
  uploaded_by: d.uploaded_by,
});

router.get('/', (req, res) => {
  const rows = q().prepare(`
    SELECT d.id, d.reference, d.title, d.applicant_name, d.status, d.procedure, d.qualification, d.created_at, d.updated_at,
      (SELECT COUNT(*) FROM documents x WHERE x.dossier_id = d.id) AS documents,
      (SELECT COUNT(*) FROM comments c WHERE c.dossier_id = d.id) AS comments,
      (SELECT COUNT(*) FROM comments c WHERE c.dossier_id = d.id AND c.id > COALESCE(r.last_read_comment_id, 0) AND c.author_id <> @uid) AS unread,
      (r.user_id IS NULL) AS never_opened,
      EXISTS (SELECT 1 FROM conflicts k WHERE k.dossier_id = d.id AND k.user_id = @uid) AS recused
    FROM dossiers d LEFT JOIN reads r ON r.dossier_id = d.id AND r.user_id = @uid
    ORDER BY d.created_at DESC`).all({ uid: req.user.id });
  // Un membre déporté ne voit que la référence du dossier.
  res.json({ dossiers: rows.map((r) => (r.recused ? { id: r.id, reference: r.reference, status: r.status, created_at: r.created_at, recused: 1 } : r)) });
});

router.get('/:id', (req, res) => {
  const d = loadDossier(req, res); if (!d) return;
  const documents = q().prepare('SELECT * FROM documents WHERE dossier_id = ? ORDER BY piece, original_name, version').all(d.id).map(docView);
  const comments = q().prepare(`SELECT id, parent_id, document_id, kind, author_id, author_name, author_quality, body, created_at, hash, signature
    FROM comments WHERE dossier_id = ? ORDER BY id`).all(d.id);
  const events = q().prepare(`SELECT e.at, e.type, e.details, u.full_name FROM dossier_events e LEFT JOIN users u ON u.id = e.user_id
    WHERE e.dossier_id = ? ORDER BY e.id`).all(d.id);
  const conflicts = q().prepare(`SELECT u.full_name, u.quality, c.declared_at FROM conflicts c JOIN users u ON u.id = c.user_id
    WHERE c.dossier_id = ? ORDER BY c.id`).all(d.id);
  const prev = q().prepare('SELECT last_read_comment_id FROM reads WHERE user_id = ? AND dossier_id = ?').get(req.user.id, d.id);
  const lastId = comments.length ? comments[comments.length - 1].id : 0;
  q().prepare(`INSERT INTO reads (user_id, dossier_id, last_read_comment_id) VALUES (?,?,?)
    ON CONFLICT(user_id, dossier_id) DO UPDATE SET last_read_comment_id = excluded.last_read_comment_id`).run(req.user.id, d.id, lastId);
  q().prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND dossier_id = ? AND read_at IS NULL').run(Date.now(), req.user.id, d.id);
  audit.fromReq(req, 'dossier_consulte', d.reference);
  res.json({
    dossier: d, documents, comments, events, conflicts,
    lastReadCommentId: prev ? prev.last_read_comment_id : 0,
    canWrite: req.user.role !== 'lecture', isAdmin: req.user.role === 'admin',
  });
});

router.get('/:id/documents/:docId/content', (req, res) => {
  const d = loadDossier(req, res); if (!d) return;
  const doc = q().prepare('SELECT * FROM documents WHERE id = ? AND dossier_id = ?').get(req.params.docId, d.id);
  if (!doc) return res.status(404).json({ error: 'Document introuvable' });
  let buf;
  try { buf = domain.readDocument(doc); } catch (e) {
    audit.fromReq(req, 'document_corrompu', `${d.reference}/${doc.id}`, e.message);
    return res.status(500).json({ error: 'Document illisible ou altéré — prévenez l’administrateur' });
  }
  audit.fromReq(req, req.query.download ? 'document_telecharge' : 'document_consulte', `${d.reference}/${doc.original_name} v${doc.version}`);
  res.set('Content-Type', doc.mime);
  res.set('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(doc.original_name)}`);
  res.set('Cache-Control', 'no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  res.send(buf);
});

// ----- Commentaires : ajout uniquement, jamais de modification ni de suppression -----
router.post('/:id/comments', requireRole('ecriture'), async (req, res) => {
  const d = loadDossier(req, res); if (!d) return;
  const b = req.body || {};
  const body = String(b.body || '').replace(/\r\n/g, '\n').trim();
  if (!body) return res.status(400).json({ error: 'Commentaire vide' });
  if (body.length > 20000) return res.status(400).json({ error: 'Commentaire trop long (20 000 caractères au plus)' });
  let parentId = null, documentId = null;
  if (b.parent_id) {
    const p = q().prepare('SELECT id FROM comments WHERE id = ? AND dossier_id = ?').get(b.parent_id, d.id);
    if (!p) return res.status(400).json({ error: 'Message parent introuvable' });
    parentId = p.id;
  }
  if (b.document_id) {
    const doc = q().prepare('SELECT id FROM documents WHERE id = ? AND dossier_id = ?').get(b.document_id, d.id);
    if (!doc) return res.status(400).json({ error: 'Document introuvable' });
    documentId = doc.id;
  }
  const c = domain.addComment({ dossierId: d.id, parentId, documentId, author: req.user, body });
  q().prepare('UPDATE dossiers SET updated_at = ? WHERE id = ?').run(Date.now(), d.id);
  q().prepare(`INSERT INTO reads (user_id, dossier_id, last_read_comment_id) VALUES (?,?,?)
    ON CONFLICT(user_id, dossier_id) DO UPDATE SET last_read_comment_id = excluded.last_read_comment_id`).run(req.user.id, d.id, c.id);
  audit.fromReq(req, parentId ? 'reponse_publiee' : 'commentaire_publie', `${d.reference}#${c.id}`);
  res.status(201).json({ comment: { id: c.id, parent_id: c.parent_id, document_id: c.document_id, kind: c.kind, author_id: c.author_id, author_name: c.author_name, author_quality: c.author_quality, body: c.body, created_at: c.created_at, hash: c.hash, signature: c.signature } });
  notify.newComment(d, c, req.user).catch((e) => console.error(e));
});

// Toute tentative de modification ou de suppression est refusée explicitement.
const immutable = (req, res) => res.status(405).json({ error: 'Les commentaires ne peuvent être ni modifiés ni supprimés. Vous pouvez y répondre ou les compléter.' });
router.put('/:id/comments/:cid', immutable);
router.patch('/:id/comments/:cid', immutable);
router.delete('/:id/comments/:cid', immutable);

// ----- Déport pour conflit d'intérêts (art. 4.2) -----
router.post('/:id/conflicts', (req, res) => {
  const d = loadDossier(req, res); if (!d) return;
  const reason = String((req.body || {}).reason || '').trim();
  if (reason.length < 3) return res.status(400).json({ error: 'Précisez la nature du conflit d’intérêts' });
  q().prepare('INSERT INTO conflicts (dossier_id, user_id, reason, declared_at) VALUES (?,?,?,?)').run(d.id, req.user.id, reason.slice(0, 1000), Date.now());
  q().prepare('INSERT INTO dossier_events (dossier_id, at, user_id, type, details) VALUES (?,?,?,?,?)')
    .run(d.id, Date.now(), req.user.id, 'deport', 'Déport pour conflit d’intérêts');
  audit.fromReq(req, 'deport_declare', d.reference);
  res.json({ ok: true });
});

// ----- Administration du dossier -----
router.patch('/:id', requireRole('admin'), (req, res) => {
  const d = loadDossier(req, res); if (!d) return;
  const b = req.body || {};
  const changes = [];
  if (b.status !== undefined) {
    if (!domain.STATUSES[b.status]) return res.status(400).json({ error: 'Statut inconnu' });
    if (b.status !== d.status) changes.push(['status', b.status, `Statut : ${domain.STATUSES[b.status]}`]);
  }
  if (b.procedure !== undefined) {
    if (!['ordinaire', 'simplifiee'].includes(b.procedure)) return res.status(400).json({ error: 'Procédure inconnue' });
    if (b.procedure !== d.procedure) changes.push(['procedure', b.procedure, `Procédure : ${b.procedure === 'simplifiee' ? 'simplifiée (art. 30)' : 'ordinaire'}`]);
  }
  const note = String(b.note || '').trim().slice(0, 1000);
  const now = Date.now();
  q().transaction(() => {
    for (const [k, v, label] of changes) {
      q().prepare(`UPDATE dossiers SET ${k} = ?, updated_at = ? WHERE id = ?`).run(v, now, d.id);
      q().prepare('INSERT INTO dossier_events (dossier_id, at, user_id, type, details) VALUES (?,?,?,?,?)')
        .run(d.id, now, req.user.id, k, label + (note ? ` — ${note}` : ''));
    }
  })();
  if (changes.length) audit.fromReq(req, 'dossier_modifie', d.reference, Object.fromEntries(changes.map(([k, v]) => [k, v])));
  res.json({ dossier: domain.getDossier(d.id) });
});

router.post('/:id/documents', requireRole('admin'), upload.array('files'), async (req, res) => {
  const d = loadDossier(req, res); if (!d) return;
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'Aucun fichier' });
  for (const f of files) { const err = domain.checkFile(f); if (err) return res.status(400).json({ error: err }); }
  const added = files.map((f) => domain.addDocument(d.id, f, { piece: req.body.piece, label: req.body.label, userId: req.user.id }));
  q().prepare('INSERT INTO dossier_events (dossier_id, at, user_id, type, details) VALUES (?,?,?,?,?)')
    .run(d.id, Date.now(), req.user.id, 'document', `${added.length} document(s) ajouté(s)`);
  audit.fromReq(req, 'document_ajoute', d.reference, added.map((a) => a.original_name).join(', '));
  res.status(201).json({ documents: added.map(docView) });
  notify.newDocument(d, added[0], req.user).catch((e) => console.error(e));
});

// Création manuelle (demande reçue par courrier ou par courriel).
router.post('/', requireRole('admin'), (req, res) => {
  const b = req.body || {};
  for (const k of ['title', 'applicant_name', 'applicant_email']) {
    if (!String(b[k] || '').trim()) return res.status(400).json({ error: `Champ requis : ${k}` });
  }
  const d = domain.createDossier({ ...b, source: 'secretariat', created_by: req.user.id });
  audit.fromReq(req, 'dossier_cree', d.reference);
  res.status(201).json({ dossier: d });
  notify.newDossier(d).catch((e) => console.error(e));
});

module.exports = router;
