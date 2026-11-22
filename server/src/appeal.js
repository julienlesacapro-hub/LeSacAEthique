'use strict';
/**
 * Procédure d'appel (règlement intérieur, art. 33.1 dans sa rédaction proposée).
 *
 * Un appel est une nouvelle demande, déposée par la même voie (formulaire du
 * site), par le porteur ou par le président de l'association, dans les
 * [3] mois qui suivent l'avis. Il est reconnu si :
 *  - la référence désigne un dossier initial dont l'avis a été établi ;
 *  - le demandeur fournit le code de vérification imprimé sur cet avis
 *    (preuve qu'il détient l'avis : un formulaire public ne peut pas, à lui
 *    seul, vérifier l'identité de l'auteur) ;
 *  - le délai n'est pas expiré ;
 *  - aucun appel n'a déjà été formé contre ce dossier (un seul appel).
 * L'appel reconnu reçoit automatiquement les copies du dossier initial :
 * documents, avis (exemplaire signé s'il existe), relevé de clôture
 * contenant l'ensemble des échanges avec l'identité de leurs auteurs ; les
 * déports du dossier initial sont reportés. Hors délai, la demande est
 * enregistrée comme une nouvelle demande, qui doit être complète.
 */
const db = require('./db');
const config = require('./config');

const q = () => db.get();
const norm = (c) => String(c || '').toUpperCase().replace(/[^A-Z2-7]/g, '');

/** Ajoute des mois calendaires (le 30 novembre + 3 mois = le 28 ou 29 février). */
function addMonths(ms, n) {
  const d = new Date(ms); const day = d.getDate();
  d.setMonth(d.getMonth() + n);
  if (d.getDate() < day) d.setDate(0);
  return d.getTime();
}

const originalAvis = (dossierId) => q().prepare("SELECT * FROM actes WHERE type = 'avis' AND dossier_id = ? AND parent_id IS NULL ORDER BY id DESC").get(dossierId);

/**
 * Évalue une demande d'appel. Retourne { status, ... } :
 *  'recevable'    : appel reconnu
 *  'hors_delai'   : à enregistrer comme nouvelle demande complète
 *  'introuvable' | 'sans_avis' | 'code_invalide' | 'deja_appel' | 'appel_d_appel' : refus motivé
 */
function evaluate({ reference, code, now = Date.now() }) {
  const parent = q().prepare('SELECT * FROM dossiers WHERE reference = ? COLLATE NOCASE').get(String(reference || '').trim());
  if (!parent) return { status: 'introuvable', message: 'Aucun dossier ne correspond à cette référence.' };
  if (parent.kind === 'appel') return { status: 'appel_d_appel', parent, message: 'Ce dossier est déjà un appel : la décision rendue en appel ne peut pas faire l’objet d’un nouvel appel.' };
  const avis = originalAvis(parent.id);
  if (!avis) return { status: 'sans_avis', parent, message: 'Aucun avis n’a encore été rendu sur ce dossier : un appel n’est pas possible.' };
  const meta = JSON.parse(avis.meta_json || '{}');
  if (!meta.verifCode || norm(code) !== norm(meta.verifCode)) {
    return { status: 'code_invalide', parent, message: 'Le code de vérification ne correspond pas à celui imprimé sur l’avis. Il figure en bas de chaque page de l’avis.' };
  }
  const deadline = addMonths(avis.created_at, config.appealDelayMonths);
  if (now > deadline) return { status: 'hors_delai', parent, avis, deadline, message: `Le délai d’appel de ${config.appealDelayMonths} mois a expiré le ${new Date(deadline).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })}.` };
  if (q().prepare("SELECT 1 FROM dossiers WHERE parent_id = ? AND kind = 'appel'").get(parent.id)) {
    return { status: 'deja_appel', parent, message: 'Un appel a déjà été formé contre cet avis : un seul appel est possible.' };
  }
  return { status: 'recevable', parent, avis, deadline };
}

/** Verse dans le dossier d'appel les copies du dossier initial et reporte les déports. */
function fileCopies(appeal, parent) {
  const domain = require('./domain');
  const gov = require('./governance');
  const label = `Copie du dossier initial ${parent.reference}`;
  let n = 0;
  for (const doc of q().prepare('SELECT * FROM documents WHERE dossier_id = ? ORDER BY id').all(parent.id)) {
    const buf = domain.readDocument(doc);
    domain.addDocument(appeal.id, { originalname: doc.original_name, buffer: buf }, { piece: doc.piece === 'autre' ? 'anterieur' : doc.piece, label });
    n++;
  }
  // Avis (exemplaire signé s'il existe, sinon l'avis produit) et relevé de clôture (tous les échanges, auteurs identifiés)
  const avis = originalAvis(parent.id);
  const actes = [];
  if (avis) {
    const signed = gov.signedVersionOf(avis.id);
    actes.push(avis); if (signed) actes.push(signed);
  }
  const cloture = q().prepare("SELECT * FROM actes WHERE type = 'cloture' AND dossier_id = ? ORDER BY id DESC").get(parent.id);
  if (cloture) actes.push(cloture);
  for (const a of actes) {
    const name = a.original_name.includes(parent.reference) ? a.original_name : `${parent.reference}-${a.original_name}`;
    domain.addDocument(appeal.id, { originalname: name, buffer: gov.readActe(a) }, { piece: 'anterieur', label: `${label} — ${a.title}` });
    n++;
  }
  // Les membres déportés sur le dossier initial le restent pour l'appel
  const ins = q().prepare('INSERT OR IGNORE INTO conflicts (dossier_id, user_id, reason, declared_at) VALUES (?,?,?,?)');
  for (const c of q().prepare('SELECT * FROM conflicts WHERE dossier_id = ?').all(parent.id)) {
    ins.run(appeal.id, c.user_id, `Déport reporté du dossier initial ${parent.reference} : ${c.reason}`, Date.now());
  }
  gov.event(parent.id, null, 'appel', `Appel formé : dossier ${appeal.reference}`);
  gov.event(appeal.id, null, 'appel', `${n} copie(s) du dossier initial ${parent.reference} versée(s) automatiquement`);
  return n;
}

/** Données du dossier initial affichées dans le dossier d'appel (échanges avec l'identité de leurs auteurs). */
function initialView(appeal) {
  if (!appeal.parent_id) return null;
  const p = q().prepare('SELECT * FROM dossiers WHERE id = ?').get(appeal.parent_id);
  const gov = require('./governance');
  return {
    id: p.id, reference: p.reference, title: p.title, status: p.status, closed_at: p.closed_at,
    comments: q().prepare(`SELECT id, parent_id, kind, author_name, author_quality, body, created_at, hash FROM comments WHERE dossier_id = ? ORDER BY id`).all(p.id),
    scrutins: q().prepare("SELECT id, procedure, result, closed_at, tally_json FROM scrutins WHERE dossier_id = ? AND status = 'clos' ORDER BY id").all(p.id)
      .map((s) => ({ ...s, counts: JSON.parse(s.tally_json || '{}'), tally_json: undefined })),
    rapporteurs: q().prepare('SELECT DISTINCT u.full_name, u.quality FROM rapporteurs r JOIN users u ON u.id = r.user_id WHERE r.dossier_id = ?').all(p.id),
    actes: q().prepare('SELECT * FROM actes WHERE dossier_id = ? ORDER BY id').all(p.id).map(gov.acteView),
  };
}

const previousRapporteurs = (appeal) => (appeal.parent_id
  ? q().prepare('SELECT DISTINCT user_id FROM rapporteurs WHERE dossier_id = ?').all(appeal.parent_id).map((r) => r.user_id) : []);

module.exports = { evaluate, fileCopies, initialView, previousRapporteurs, addMonths, originalAvis };
