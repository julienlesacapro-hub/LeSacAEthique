'use strict';
/**
 * Rapporteurs, scrutins, séances, avis, procès-verbaux, rapport annuel,
 * versions signées des actes, contrôles d'intégrité.
 */
const express = require('express');
const multer = require('multer');
const db = require('../db');
const config = require('../config');
const audit = require('../audit');
const mailer = require('../mailer');
const domain = require('../domain');
const gov = require('../governance');
const { requireSession, isRecused } = require('../auth');

const router = express.Router();
const q = () => db.get();
router.use(requireSession(['full']));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024, files: 2 } });

const admin = (req, res, next) => (gov.isAdmin(req.user) ? next() : res.status(403).json({ error: 'Réservé au président du comité (administrateur de l’outil)' }));
const manager = (req, res, next) => (gov.canManageDossiers(req.user) ? next() : res.status(403).json({ error: 'Réservé au président et au secrétariat' }));

// Exécute un handler et traduit les erreurs de règle en réponses 400
const run = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (e) {
    if (e instanceof gov.RuleError) return res.status(e.status).json({ error: e.message, problems: e.problems });
    console.error(e); res.status(500).json({ error: 'Erreur interne' });
  }
};

function dossierFor(req, res) {
  const d = domain.getDossier(req.params.id);
  if (!d) { res.status(404).json({ error: 'Dossier introuvable' }); return null; }
  if (isRecused(req.user.id, d.id)) { res.status(403).json({ error: 'Vous vous êtes déporté(e) sur ce dossier', recused: true }); return null; }
  return d;
}
function scrutinFor(req, res) {
  const sc = q().prepare('SELECT * FROM scrutins WHERE id = ?').get(req.params.sid);
  if (!sc) { res.status(404).json({ error: 'Scrutin introuvable' }); return null; }
  if (isRecused(req.user.id, sc.dossier_id)) { res.status(403).json({ error: 'Vous vous êtes déporté(e) sur ce dossier' }); return null; }
  return sc;
}

router.get('/meta', (req, res) => res.json({ fonctions: gov.FONCTIONS, choices: gov.CHOICES, voting: gov.VOTING, seats: gov.seats(), adminFunctions: config.adminFunctions }));

// Membres pouvant être désignés ou remplacer (pour les formulaires du président)
router.get('/membres', admin, (req, res) => {
  res.json({ membres: q().prepare("SELECT id, full_name, quality, fonction, health_professional, independent FROM users WHERE status = 'actif' ORDER BY full_name").all() });
});

// ---------- Rapporteurs (art. 28.1) ----------
router.post('/dossiers/:id/rapporteurs', admin, run((req, res) => {
  const d = dossierFor(req, res); if (!d) return;
  const u = gov.designateRapporteur(d, Number((req.body || {}).user_id), req.user);
  audit.fromReq(req, 'rapporteur_designe', d.reference, u.email);
  q().prepare('INSERT INTO notifications (user_id, type, dossier_id, message, created_at) VALUES (?,?,?,?,?)')
    .run(u.id, 'rapporteur', d.id, `Vous êtes désigné(e) rapporteur — ${d.reference}`, Date.now());
  mailer.send({ to: u.email, subject: `Désignation comme rapporteur — ${d.reference}`, text: `Bonjour ${u.full_name},\n\nLe président vous a désigné(e) rapporteur du dossier ${d.reference} (art. 28.1).\n${config.publicUrl}/#/dossiers/${d.id}\n\nSi vous êtes en conflit d'intérêts, déclarez-le dans le dossier : la désignation prendra fin.\n` });
  res.status(201).json({ rapporteurs: gov.activeRapporteurs(d.id) });
}));

router.post('/dossiers/:id/rapporteurs/:uid/fin', admin, run((req, res) => {
  const d = dossierFor(req, res); if (!d) return;
  const reason = String((req.body || {}).reason || '').trim() || 'décision du président';
  if (!gov.endRapporteur(d.id, Number(req.params.uid), req.user.id, reason)) return res.status(404).json({ error: 'Désignation introuvable' });
  audit.fromReq(req, 'rapporteur_fin', d.reference, reason);
  res.json({ rapporteurs: gov.activeRapporteurs(d.id) });
}));

// ---------- Scrutins (art. 29 et 30) ----------
router.post('/dossiers/:id/scrutins', admin, run((req, res) => {
  const d = dossierFor(req, res); if (!d) return;
  const b = req.body || {};
  const sc = gov.openScrutin({
    dossier: d, by: req.user, procedure: b.procedure === 'simplifiee' ? 'simplifiee' : 'ordinaire', secret: !!b.secret,
    seanceId: b.seance_id ? Number(b.seance_id) : null, deadline: b.deadline ? Number(b.deadline) : null,
    substitutes: Array.isArray(b.substitutes) ? b.substitutes.map((s) => ({ user_id: Number(s.user_id), substitute_for: Number(s.substitute_for) })) : [],
    rapporteurId: b.rapporteur_id,
  });
  audit.fromReq(req, 'scrutin_ouvert', `${d.reference}#${sc.id}`);
  const electeurs = q().prepare('SELECT u.* FROM scrutin_electeurs se JOIN users u ON u.id = se.user_id WHERE se.scrutin_id = ?').all(sc.id);
  const ins = q().prepare('INSERT INTO notifications (user_id, type, dossier_id, message, created_at) VALUES (?,?,?,?,?)');
  for (const u of electeurs) {
    ins.run(u.id, 'vote', d.id, `Vote ouvert — ${d.reference}`, Date.now());
    mailer.send({ to: u.email, subject: `Vote ouvert — ${d.reference}`, text: `Bonjour ${u.full_name},\n\nUn vote est ouvert sur le dossier ${d.reference}${sc.deadline ? ` jusqu'au ${new Date(sc.deadline).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}` : ''}.\n${config.publicUrl}/#/dossiers/${d.id}\n` });
  }
  res.status(201).json({ scrutin: gov.scrutinView(sc, req.user) });
}));

router.post('/scrutins/:sid/vote', run((req, res) => {
  const sc = scrutinFor(req, res); if (!sc) return;
  const b = req.body || {};
  gov.castVote(sc, req.user, b.choice, b.motivation);
  // Le journal n'enregistre jamais le sens du vote
  audit.fromReq(req, 'vote_emis', `scrutin #${sc.id}`);
  res.json({ scrutin: gov.scrutinView(q().prepare('SELECT * FROM scrutins WHERE id = ?').get(sc.id), req.user) });
}));

router.post('/scrutins/:sid/cloture', admin, run((req, res) => {
  const sc = scrutinFor(req, res); if (!sc) return;
  try {
    const closed = gov.closeScrutin(sc, req.user);
    audit.fromReq(req, 'scrutin_clos', `scrutin #${sc.id}`, { result: closed.result, controle: closed.check.checkId });
    res.json({ scrutin: gov.scrutinView(closed, req.user), check: { id: closed.check.checkId, lastHash: closed.check.lastHash } });
  } catch (e) {
    if (e.problems) audit.fromReq(req, 'controle_integrite_non_conforme', `scrutin #${sc.id}`, e.problems.join(' | '));
    throw e;
  }
}));

router.post('/scrutins/:sid/annulation', admin, run((req, res) => {
  const sc = scrutinFor(req, res); if (!sc) return;
  const reason = String((req.body || {}).reason || '').trim();
  if (reason.length < 3) return res.status(400).json({ error: 'Motif requis' });
  gov.cancelScrutin(sc, req.user, reason);
  audit.fromReq(req, 'scrutin_annule', `scrutin #${sc.id}`, reason);
  res.json({ ok: true });
}));

router.post('/dossiers/:id/pleniere', run((req, res) => {
  const d = dossierFor(req, res); if (!d) return;
  if (![...gov.VOTING, 'suppleant'].includes(req.user.fonction)) return res.status(403).json({ error: 'Réservé aux membres du comité' });
  gov.requestPlenary(d, req.user);
  audit.fromReq(req, 'pleniere_demandee', d.reference);
  res.json({ ok: true });
}));

// ---------- Avis (annexe 7) ----------
router.post('/dossiers/:id/avis', admin, run(async (req, res) => {
  const d = dossierFor(req, res); if (!d) return;
  const b = req.body || {};
  const sc = q().prepare('SELECT * FROM scrutins WHERE id = ? AND dossier_id = ?').get(b.scrutin_id, d.id);
  if (!sc) return res.status(404).json({ error: 'Scrutin introuvable' });
  const acte = await gov.generateAvis({ dossier: d, scrutin: sc, by: req.user, motivation: b.motivation, motivationEn: b.motivation_en, validityMonths: b.validity_months });
  audit.fromReq(req, 'avis_etabli', d.reference, acte.title);
  res.status(201).json({ acte: gov.acteView(acte) });
}));

// ---------- Séances et procès-verbaux ----------
router.get('/seances', (req, res) => {
  const rows = q().prepare(`SELECT s.*, (SELECT COUNT(*) FROM scrutins x WHERE x.seance_id = s.id) AS scrutins,
    (SELECT id FROM actes a WHERE a.type = 'pv' AND a.seance_id = s.id AND a.parent_id IS NULL) AS pv_id
    FROM seances s ORDER BY s.date DESC`).all();
  res.json({ seances: rows });
});

router.post('/seances', manager, run((req, res) => {
  const s = gov.createSeance(req.body || {}, req.user);
  audit.fromReq(req, 'seance_creee', `séance #${s.id}`);
  res.status(201).json({ seance: s });
}));

router.get('/seances/:id', (req, res) => {
  const s = q().prepare('SELECT * FROM seances WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Séance introuvable' });
  const scrutins = q().prepare(`SELECT s.*, d.reference, d.title FROM scrutins s JOIN dossiers d ON d.id = s.dossier_id WHERE s.seance_id = ? ORDER BY s.id`).all(s.id)
    .map((sc) => (isRecused(req.user.id, sc.dossier_id)
      ? { id: sc.id, reference: sc.reference, recused: true, status: sc.status }
      : { ...gov.scrutinView(sc, req.user), reference: sc.reference, title: sc.title, dossier_id: sc.dossier_id }));
  const actes = q().prepare('SELECT * FROM actes WHERE seance_id = ? ORDER BY id').all(s.id).map(gov.acteView);
  res.json({ seance: s, scrutins, actes, check: s.integrity_check_id ? q().prepare('SELECT * FROM integrity_checks WHERE id = ?').get(s.integrity_check_id) : null });
});

router.post('/seances/:id/cloture', admin, run(async (req, res) => {
  const s = q().prepare('SELECT * FROM seances WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Séance introuvable' });
  const { acte, check } = await gov.closeSeance(s, req.user);
  audit.fromReq(req, 'seance_close', `séance #${s.id}`, { controle: check.checkId });
  res.json({ acte: gov.acteView(acte), check: { id: check.checkId, lastHash: check.lastHash } });
}));

// ---------- Actes : consultation, version signée, transmission ----------
function acteFor(req, res) {
  const a = q().prepare('SELECT * FROM actes WHERE id = ?').get(req.params.aid);
  if (!a) { res.status(404).json({ error: 'Acte introuvable' }); return null; }
  if (a.dossier_id && isRecused(req.user.id, a.dossier_id)) { res.status(403).json({ error: 'Vous vous êtes déporté(e) sur ce dossier' }); return null; }
  if (a.seance_id) {
    const recused = q().prepare('SELECT 1 FROM scrutins s JOIN conflicts c ON c.dossier_id = s.dossier_id WHERE s.seance_id = ? AND c.user_id = ?').get(a.seance_id, req.user.id);
    if (recused) { res.status(403).json({ error: 'Ce procès-verbal concerne un dossier sur lequel vous vous êtes déporté(e)' }); return null; }
  }
  return a;
}

router.get('/actes', (req, res) => {
  const { type, dossier_id: dossierId } = req.query;
  let rows = q().prepare('SELECT * FROM actes ORDER BY id DESC LIMIT 500').all();
  if (type) rows = rows.filter((a) => a.type === type);
  if (dossierId) rows = rows.filter((a) => String(a.dossier_id) === String(dossierId));
  rows = rows.filter((a) => !(a.dossier_id && isRecused(req.user.id, a.dossier_id)));
  res.json({ actes: rows.map(gov.acteView) });
});

router.get('/actes/:aid/content', (req, res) => {
  const a = acteFor(req, res); if (!a) return;
  const buf = gov.readActe(a);
  audit.fromReq(req, 'acte_consulte', a.title);
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(a.original_name)}`);
  res.set('Cache-Control', 'no-store');
  res.send(buf);
});

router.post('/actes/:aid/signe', admin, upload.fields([{ name: 'file', maxCount: 1 }, { name: 'rapport', maxCount: 1 }]), run((req, res) => {
  const a = acteFor(req, res); if (!a) return;
  const f = req.files && req.files.file && req.files.file[0];
  if (!f) return res.status(400).json({ error: 'Joignez le PDF signé' });
  const signed = gov.attachSigned(a, f.buffer, req.user, (req.body || {}).note);
  const r = req.files.rapport && req.files.rapport[0];
  let report = null;
  if (r) {
    if (r.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') return res.status(400).json({ error: 'Le rapport de validation doit être un PDF' });
    report = gov.storeActe({ type: 'rapport_validation', dossierId: a.dossier_id, seanceId: a.seance_id, year: a.year, title: `Rapport de validation de la signature — ${a.title}`, buffer: r.buffer, originalName: 'rapport-validation-signature.pdf', byId: req.user.id, parentId: signed.id });
  }
  audit.fromReq(req, 'acte_signe_depose', a.title);
  res.status(201).json({ acte: gov.acteView(signed), rapport: report ? gov.acteView(report) : null });
}));

router.post('/actes/:aid/transmettre', admin, run(async (req, res) => {
  const a = acteFor(req, res); if (!a) return;
  if (a.type !== 'avis') return res.status(400).json({ error: 'Seuls les avis sont transmis au porteur' });
  const base = a.parent_id ? q().prepare('SELECT * FROM actes WHERE id = ?').get(a.parent_id) : a;
  const signed = q().prepare('SELECT * FROM actes WHERE parent_id = ? AND signed = 1 ORDER BY id DESC').get(base.id);
  const toSend = signed || base;
  if (!signed && !(req.body || {}).sans_signature_qualifiee) {
    return res.status(400).json({ error: 'Aucune version signée n’a été déposée. Confirmez l’envoi de la version non signée ou déposez d’abord la version signée.', needsConfirmation: true });
  }
  const d = domain.getDossier(a.dossier_id);
  await mailer.send({
    to: d.applicant_email, subject: `Avis du comité — ${d.reference}`,
    text: `Bonjour ${d.applicant_name},\n\nVeuillez trouver ci-joint l'avis du ${config.committeeName} sur votre demande « ${d.title} » (${d.reference}).\n\nEmpreinte SHA-256 du fichier : ${toSend.sha256}\n${signed ? 'Le document porte une signature électronique ; vous pouvez la vérifier avec votre lecteur PDF ou l\'outil de validation de la Commission européenne.' : ''}\n`,
    attachments: [{ filename: toSend.original_name, content: gov.readActe(toSend), contentType: 'application/pdf' }],
  });
  q().prepare('UPDATE actes SET sent_at = ? WHERE id = ?').run(Date.now(), toSend.id);
  gov.event(d.id, req.user.id, 'transmission', `Avis transmis au porteur (${signed ? 'version signée' : 'version non signée'})`);
  audit.fromReq(req, 'avis_transmis', d.reference, toSend.original_name);
  res.json({ ok: true, signed: !!signed });
}));

// ---------- Rapport annuel (art. 34.2) ----------
router.get('/rapport-annuel', (req, res) => {
  const year = parseInt(req.query.annee, 10) || new Date().getFullYear();
  res.json({ stats: gov.annualStats(year), actes: q().prepare("SELECT * FROM actes WHERE type = 'rapport_annuel' AND year = ? ORDER BY id DESC").all(year).map(gov.acteView) });
});
router.post('/rapport-annuel', admin, run(async (req, res) => {
  const year = parseInt((req.body || {}).annee, 10) || new Date().getFullYear();
  const acte = await gov.generateAnnualReport(year, req.user);
  audit.fromReq(req, 'rapport_annuel', String(year));
  res.status(201).json({ acte: gov.acteView(acte) });
}));

// ---------- Contrôles d'intégrité ----------
router.post('/integrite', admin, (req, res) => {
  const r = domain.recordIntegrityCheck(req.user.id, 'Contrôle périodique');
  audit.fromReq(req, 'verification_integrite', '', { ok: r.ok, controle: r.checkId });
  res.json({ ...r, publicKey: require('../security').publicKeyPem() });
});
router.get('/integrite', admin, (req, res) => {
  res.json({ checks: q().prepare('SELECT c.*, u.full_name FROM integrity_checks c LEFT JOIN users u ON u.id = c.user_id ORDER BY c.id DESC LIMIT 200').all() });
});

module.exports = router;
