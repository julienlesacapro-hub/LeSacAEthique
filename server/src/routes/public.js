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
const appeal = require('../appeal');
const db = require('../db');

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
    pieces: domain.PIECES, maxUploadMb: config.maxUploadMb, maxFiles: config.maxFilesPerSubmission, appealDelayMonths: config.appealDelayMonths,
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
  const clip = (v, n) => String(v || '').trim().slice(0, n);
  const files = req.files || [];
  for (const f of files) {
    const err = domain.checkFile(f);
    if (err) return res.status(400).json({ error: err });
  }
  const pieceOf = (f) => { const m = /^piece_(autre|[a-j])$/.exec(f.fieldname || ''); return m ? m[1] : 'autre'; };
  const has = (p) => files.some((f) => pieceOf(f) === p);
  if (b.attest_no_health_data !== 'on' && b.attest_no_health_data !== 'true') {
    return res.status(400).json({ error: 'Veuillez attester que les documents ne contiennent aucune donnée de santé identifiante.' });
  }
  if (!String(b.applicant_name || '').trim()) return res.status(400).json({ error: 'Champ obligatoire manquant : nom du demandeur' });
  if (!EMAIL_RE.test(String(b.applicant_email || '').trim())) return res.status(400).json({ error: 'Adresse électronique invalide' });

  // ----- Appel -----
  let relatedReference = null; let notice = null;
  if (b.request_type === 'appel') {
    const ev = appeal.evaluate({ reference: b.appeal_reference, code: b.appeal_code });
    audit.log('appel_evalue', { target: clip(b.appeal_reference, 40), ip: req.ip, details: ev.status });
    if (ev.status === 'recevable') {
      if (!['porteur', 'president_association'].includes(b.appeal_role)) return res.status(400).json({ error: 'Précisez si vous êtes le porteur du projet ou le président de l’association' });
      if (String(b.appeal_reason || '').trim().length < 20) return res.status(400).json({ error: 'Motivez l’appel (éléments nouveaux, motifs de contestation)' });
      if (!has('a')) return res.status(400).json({ error: 'Joignez la lettre d’appel signée (pièce a)' });
      const p = ev.parent;
      const dossier = domain.createDossier({
        title: clip(`Appel — ${p.title}`, 300), applicant_name: p.applicant_name, applicant_email: p.applicant_email,
        applicant_affiliation: p.applicant_affiliation, investigator: p.investigator, qualification: p.qualification,
        qualification_reason: p.qualification_reason, summary: clip(b.appeal_reason, 8000), funding: p.funding, source: 'site',
        kind: 'appel', parent_id: p.id, parent_reference: p.reference, appeal_avis_id: ev.avis.id, appeal_role: b.appeal_role,
        appeal_requester: clip(b.applicant_name, 150), appeal_requester_email: clip(b.applicant_email, 200).toLowerCase(), appeal_reason: clip(b.appeal_reason, 8000),
      });
      for (const f of files) domain.addDocument(dossier.id, f, { piece: pieceOf(f), label: 'Versé par le demandeur lors de l’appel' });
      const copies = appeal.fileCopies(dossier, p);
      audit.log('appel_depose', { target: dossier.reference, ip: req.ip, details: `appel de ${p.reference} ; ${files.length} nouveau(x) fichier(s) ; ${copies} copie(s)` });
      res.status(201).json({ ok: true, kind: 'appel', reference: dossier.reference, parentReference: p.reference,
        message: `Votre appel contre l’avis du dossier ${p.reference} est enregistré sous la référence ${dossier.reference}. Les documents du dossier initial y ont été versés automatiquement.` });
      const roleLabel = b.appeal_role === 'porteur' ? 'le porteur du projet' : 'le président de l’association';
      mailer.send({ to: dossier.appeal_requester_email || b.applicant_email, subject: `Accusé de dépôt d’un appel — ${dossier.reference}`,
        text: `Bonjour ${b.applicant_name},\n\nVotre appel contre l'avis rendu sur le dossier ${p.reference} a bien été déposé auprès du ${config.committeeName} sous la référence ${dossier.reference}.\n\nIl sera examiné en séance plénière par des rapporteurs différents de ceux du dossier initial. Le secrétariat vérifie sa recevabilité et vous adresse un accusé de réception daté.\n` });
      if (b.appeal_role === 'president_association' && p.applicant_email !== String(b.applicant_email).trim().toLowerCase()) {
        mailer.send({ to: p.applicant_email, subject: `Appel formé sur votre dossier — ${p.reference}`,
          text: `Bonjour ${p.applicant_name},\n\nNous vous informons qu'un appel contre l'avis rendu sur votre dossier ${p.reference} a été formé par ${roleLabel} (${b.applicant_name}). Il est enregistré sous la référence ${dossier.reference}. Vous pouvez adresser au comité tout élément utile.\n` });
      }
      if (config.secretariatEmail) mailer.send({ to: config.secretariatEmail, subject: `Appel ${dossier.reference}`, text: `Appel du dossier ${p.reference} formé par ${roleLabel}.\n${config.publicUrl}/#/dossiers/${dossier.id}\n` });
      notify.newDossier({ ...dossier, reference: dossier.reference }, { appel: p.reference }).catch((e) => console.error(e));
      return undefined;
    }
    if (ev.status !== 'hors_delai') return res.status(400).json({ error: ev.message, appealStatus: ev.status });
    // Hors délai : nouvelle demande, qui doit être complète
    relatedReference = ev.parent.reference;
    notice = `${ev.message} Votre demande n’est pas reconnue comme un appel : elle est enregistrée comme une nouvelle demande, examinée sur la base des seuls documents fournis.`;
    if (!has('a') || !has('b') || !String(b.title || '').trim() || !String(b.qualification_reason || '').trim()) {
      return res.status(400).json({ appealStatus: 'hors_delai', error: `${ev.message} La demande ne peut être enregistrée que comme une nouvelle demande : fournissez l’ensemble du dossier (titre, qualification réglementaire, lettre de saisine, protocole et autres pièces de l’annexe 3). Les documents du dossier initial ne sont pas repris automatiquement.` });
    }
  }

  // ----- Nouvelle demande -----
  const required = { title: 'Titre du projet', qualification_reason: 'Justification de la qualification réglementaire' };
  for (const [k, label] of Object.entries(required)) {
    if (!String(b[k] || '').trim()) return res.status(400).json({ error: `Champ obligatoire manquant : ${label}` });
  }
  if (b.qualification !== 'RNIPH' && b.qualification !== 'autre') {
    return res.status(400).json({ error: 'Le comité ne rend pas l’avis exigé pour une recherche impliquant la personne humaine (RIPH) : celui-ci relève d’un CPP (art. L.1123-6 du code de la santé publique).' });
  }
  if (!has('a') || !has('b')) return res.status(400).json({ error: 'Joignez au moins la lettre de saisine (pièce a) et le protocole (pièce b)' });
  const dossier = domain.createDossier({
    title: clip(b.title, 300), applicant_name: clip(b.applicant_name, 150), applicant_email: clip(b.applicant_email, 200).toLowerCase(),
    applicant_affiliation: clip(b.applicant_affiliation, 300), investigator: clip(b.investigator, 150),
    qualification: b.qualification === 'RNIPH' ? 'RNIPH' : 'Autre (question éthique, registre…)',
    qualification_reason: clip(b.qualification_reason, 4000), summary: clip(b.summary, 8000), funding: clip(b.funding, 2000),
    source: 'site', related_reference: relatedReference,
  });
  for (const f of files) domain.addDocument(dossier.id, f, { piece: pieceOf(f) });
  audit.log('demande_deposee', { target: dossier.reference, ip: req.ip, details: `${files.length} fichier(s)${relatedReference ? ` ; appel hors délai de ${relatedReference}` : ''}` });
  res.status(201).json({ ok: true, kind: 'nouvelle', reference: dossier.reference, message: notice || undefined });

  // Accusé de dépôt au porteur (distinct de l'accusé de recevabilité de l'art. 27.3)
  mailer.send({
    to: dossier.applicant_email,
    subject: `Accusé de dépôt — ${dossier.reference}`,
    text: `Bonjour ${dossier.applicant_name},\n\nVotre demande « ${dossier.title} » a bien été déposée auprès du ${config.committeeName} sous la référence ${dossier.reference} (${files.length} document(s)).\n${notice ? `\n${notice}\n` : ''}\nCe message accuse le DÉPÔT de votre demande. Le secrétariat et le président vérifient ensuite sa recevabilité et vous adressent un accusé de réception daté (règlement intérieur, art. 27.3).\n\nRappel : l'avis du comité ne vaut pas avis d'un comité de protection des personnes (art. L.1123-6 du code de la santé publique) et ne dispense d'aucune formalité auprès de la CNIL.\n`,
  });
  if (config.secretariatEmail) {
    mailer.send({ to: config.secretariatEmail, subject: `Nouvelle demande ${dossier.reference}`, text: `Une demande a été déposée depuis le site : ${dossier.reference}.\n${config.publicUrl}/#/dossiers/${dossier.id}\n` });
  }
  notify.newDossier(dossier).catch((e) => console.error(e));
  return undefined;
});

// ---------- Accusé de réception de l'avis par le porteur ----------
// GET n'enregistre rien (les messageries ouvrent parfois les liens pour les analyser) :
// seule la validation du bouton (POST) confirme la réception.
const reception = require('../reception');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function page(title, body) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)}</title><link rel="stylesheet" href="/formulaire/formulaire.css"></head><body><main class="cer-form-wrap">
<header class="cer-head"><img src="/formulaire/logo.png" alt="" width="56" height="56"><div><h1>${esc(title)}</h1><p>${esc(config.committeeLongName)}</p></div></header>${body}</main></body></html>`;
}
const fr = (ms) => new Date(ms).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'long', timeStyle: 'short' });
const receptionLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: config.isTest ? 1000 : 30, standardHeaders: 'draft-8', legacyHeaders: false });

router.get('/reception/:token', receptionLimiter, (req, res) => {
  const row = reception.byToken(req.params.token);
  res.type('html');
  if (!row) return res.status(404).send(page('Lien invalide', '<div class="cer-error">Ce lien d’accusé de réception est invalide.</div>'));
  const d = db.get().prepare('SELECT reference FROM dossiers WHERE id = ?').get(row.dossier_id);
  if (row.confirmed_at) return res.send(page('Réception déjà confirmée', `<div class="cer-done"><p>La réception de l’avis du dossier <strong>${esc(d.reference)}</strong> a été confirmée le ${esc(fr(row.confirmed_at))}.</p></div>`));
  res.send(page('Accusé de réception', `<form class="cer-form" method="post"><fieldset><legend>Dossier ${esc(d.reference)}</legend>
<p>En cliquant sur le bouton, vous confirmez avoir reçu l’avis du ${esc(config.committeeName)} relatif à ce dossier. La date et l’heure de votre confirmation sont enregistrées.</p>
<p class="cer-hint">Le délai d’appel de ${config.appealDelayMonths} mois court à compter de la réception. À défaut de confirmation, l’avis est réputé reçu ${config.receptionPresumptionDays} jours après son envoi.</p></fieldset>
<button type="submit" class="cer-submit">Je confirme la réception de l’avis</button></form>`));
});

router.post('/reception/:token', receptionLimiter, (req, res) => {
  const r = reception.confirm(req.params.token, req.ip);
  res.type('html');
  if (r.status === 'invalide') return res.status(404).send(page('Lien invalide', '<div class="cer-error">Ce lien d’accusé de réception est invalide.</div>'));
  const d = db.get().prepare('SELECT reference FROM dossiers WHERE id = ?').get(r.row.dossier_id);
  audit.log('reception_avis_confirmee', { target: d.reference, ip: req.ip, details: r.status });
  res.send(page('Réception confirmée', `<div class="cer-done"><p>${r.status === 'deja' ? 'La réception avait déjà été confirmée' : 'Merci. La réception'} de l’avis du dossier <strong>${esc(d.reference)}</strong> est enregistrée le ${esc(fr(r.row.confirmed_at))}.</p></div>`));
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
