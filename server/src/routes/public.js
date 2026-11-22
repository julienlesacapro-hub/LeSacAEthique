'use strict';
/**
 * Point d'entrée PUBLIC : dépôt d'une demande d'avis depuis le site internet
 * de l'association. Aucune authentification ; protections : origine
 * autorisée, limitation de débit, champ piège anti-robots, contrôle du type
 * et de la taille des fichiers.
 *
 * Le site ne reçoit ni ne stocke rien : le formulaire envoie directement au
 * serveur du comité (le site reste séparé, cf. règlement intérieur, art. 59).
 */
const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const audit = require('../audit');
const mailer = require('../mailer');
const notify = require('../notify');
const domain = require('../domain');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// CORS restreint aux origines du site de l'association
router.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin && config.publicFormOrigins.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000, limit: config.isTest ? 1000 : 5, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: 'Trop de dépôts depuis cette adresse. Réessayez dans une heure ou contactez le secrétariat.' },
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: config.maxFilesPerSubmission, fields: 60 },
});

router.get('/form-info', (req, res) => {
  res.json({
    committee: config.committeeName, committeeLongName: config.committeeLongName,
    pieces: domain.PIECES, maxUploadMb: config.maxUploadMb, maxFiles: config.maxFilesPerSubmission,
  });
});

router.post('/submissions', limiter, (req, res, next) => {
  const origin = req.get('origin');
  // Requête d'un navigateur depuis une origine non autorisée (le formulaire
  // servi par le serveur lui-même est toujours accepté).
  if (origin && !config.publicFormOrigins.includes(origin) && origin !== config.publicUrl) {
    return res.status(403).json({ error: 'Origine non autorisée' });
  }
  next();
}, upload.any(), async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.status(201).json({ ok: true, reference: 'reçu' }); // champ piège rempli = robot
  const required = { title: 'Titre du projet', applicant_name: 'Nom du porteur', applicant_email: 'Courriel du porteur', qualification_reason: 'Justification de la qualification réglementaire' };
  for (const [k, label] of Object.entries(required)) {
    if (!String(b[k] || '').trim()) return res.status(400).json({ error: `Champ obligatoire manquant : ${label}` });
  }
  if (!EMAIL_RE.test(String(b.applicant_email).trim())) return res.status(400).json({ error: 'Adresse électronique invalide' });
  if (b.qualification !== 'RNIPH' && b.qualification !== 'autre') {
    return res.status(400).json({ error: 'Le comité ne rend pas l’avis exigé pour une recherche impliquant la personne humaine (RIPH) : celui-ci relève d’un CPP (art. L.1123-6 du code de la santé publique).' });
  }
  if (b.attest_no_health_data !== 'on' && b.attest_no_health_data !== 'true') {
    return res.status(400).json({ error: 'Veuillez attester que les documents ne contiennent aucune donnée de santé identifiante.' });
  }
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'Joignez au moins la lettre de saisine et le protocole' });
  for (const f of files) {
    const err = domain.checkFile(f);
    if (err) return res.status(400).json({ error: err });
  }
  const clip = (v, n) => String(v || '').trim().slice(0, n);
  const dossier = domain.createDossier({
    title: clip(b.title, 300), applicant_name: clip(b.applicant_name, 150), applicant_email: clip(b.applicant_email, 200).toLowerCase(),
    applicant_affiliation: clip(b.applicant_affiliation, 300), investigator: clip(b.investigator, 150),
    qualification: b.qualification === 'RNIPH' ? 'RNIPH' : 'Autre (question éthique, registre…)',
    qualification_reason: clip(b.qualification_reason, 4000), summary: clip(b.summary, 8000), funding: clip(b.funding, 2000),
    source: 'site',
  });
  // Le nom du champ fichier indique la pièce : piece_a, piece_b, … ou piece_autre
  for (const f of files) {
    const m = /^piece_([a-j]|autre)/.exec(f.fieldname || '');
    domain.addDocument(dossier.id, f, { piece: m ? m[1] : 'autre' });
  }
  audit.log('demande_deposee', { target: dossier.reference, ip: req.ip, details: `${files.length} fichier(s)` });
  res.status(201).json({ ok: true, reference: dossier.reference });

  // Accusé de dépôt au porteur (distinct de l'accusé de recevabilité de l'art. 27.3)
  mailer.send({
    to: dossier.applicant_email,
    subject: `Accusé de dépôt — ${dossier.reference}`,
    text: `Bonjour ${dossier.applicant_name},\n\nVotre demande « ${dossier.title} » a bien été déposée auprès du ${config.committeeName} sous la référence ${dossier.reference} (${files.length} document(s)).\n\nCe message accuse le DÉPÔT de votre demande. Le secrétariat et le président vérifient ensuite sa recevabilité et vous adressent un accusé de réception daté (règlement intérieur, art. 27.3).\n\nRappel : l'avis du comité ne vaut pas avis d'un comité de protection des personnes (art. L.1123-6 du code de la santé publique) et ne dispense d'aucune formalité auprès de la CNIL.\n`,
  });
  if (config.secretariatEmail) {
    mailer.send({ to: config.secretariatEmail, subject: `Nouvelle demande ${dossier.reference}`, text: `Une demande a été déposée depuis le site : ${dossier.reference}.\n${config.publicUrl}/#/dossiers/${dossier.id}\n` });
  }
  notify.newDossier(dossier).catch((e) => console.error(e));
});

// Erreurs de téléversement (taille, nombre de fichiers)
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? `Fichier trop volumineux (${config.maxUploadMb} Mo au plus)` :
      err.code === 'LIMIT_FILE_COUNT' ? `Trop de fichiers (${config.maxFilesPerSubmission} au plus)` : 'Envoi invalide';
    return res.status(400).json({ error: msg });
  }
  next(err);
});

module.exports = router;
