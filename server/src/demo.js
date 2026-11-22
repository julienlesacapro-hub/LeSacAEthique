'use strict';
/**
 * VERSION DE DÉMONSTRATION — données entièrement fictives.
 *
 * Activée uniquement par DEMO_MODE=true, et seulement si le répertoire de
 * données contient « demo » (garde-fou : le mode démo ne peut pas être
 * activé sur la base réelle). En démo :
 *  - connexion en un clic sur des comptes fictifs (sans mot de passe) ;
 *  - code de double authentification fixe « 000000 » pour signer ;
 *  - courriels conservés en mémoire et consultables dans l'outil.
 * La base est remplie au premier démarrage avec des dossiers à toutes les
 * étapes : dépôt, instruction, vote électronique ouvert, séance close avec
 * procès-verbal, avis signé et transmis, appel, destruction en attente.
 */
const express = require('express');
const PDFDocument = require('pdfkit');
const db = require('./db');
const config = require('./config');
const sec = require('./security');
const totp = require('./totp');
const mailer = require('./mailer');
const domain = require('./domain');
const gov = require('./governance');
const { createSession, publicUser } = require('./auth');

const q = () => db.get();
const DEMO_CODE = '000000';
const enabled = () => config.demoMode;

function assertSafe() {
  if (!/demo/i.test(config.dataDir)) {
    throw new Error(`DEMO_MODE refusé : le répertoire de données (${config.dataDir}) doit contenir « demo » pour éviter toute activation sur la base réelle.`);
  }
}

// ---------- Génération de documents fictifs ----------
function pdf(title, lines) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 60, info: { Title: title } });
    const chunks = []; doc.on('data', (c) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.fillColor('#b3261e').fontSize(9).text('DOCUMENT FICTIF — VERSION DE DÉMONSTRATION', { align: 'right' }).moveDown();
    doc.fillColor('#03213a').fontSize(16).text(title).moveDown();
    doc.fillColor('#111').fontSize(11);
    for (const l of lines) doc.text(l, { align: 'justify' }).moveDown(0.6);
    doc.end();
  });
}

const MEMBERS = [
  ['pres', 'Dr Alice Martin', 'Médecin hyperbare, présidente du comité', 'admin', 'president', 1, 0],
  ['vp', 'Dr Marc Rousseau', 'Médecin de la plongée, vice-président', 'admin', 'vice_president', 1, 0],
  ['juriste', 'Me Claire Dubois', 'Juriste en droit de la santé', 'ecriture', 'titulaire', 0, 1],
  ['plongee', 'Dr Bruno Lefèvre', 'Médecin de la plongée', 'ecriture', 'titulaire', 1, 0],
  ['methodo', 'Pr Hugo Bernard', 'Méthodologiste (biostatistiques)', 'ecriture', 'titulaire', 1, 1],
  ['usagers', 'Mme Léa Moreau', 'Représentante des usagers (plongeuse)', 'ecriture', 'titulaire', 0, 1],
  ['ide', 'M. Karim Benali', 'Infirmier en médecine hyperbare', 'ecriture', 'titulaire', 1, 0],
  ['suppleant', 'Mme Inès Petit', 'Éthicienne, membre suppléante', 'ecriture', 'suppleant', 0, 1],
  ['secretariat', 'M. Paul Girard', 'Secrétariat administratif', 'ecriture', 'secretariat', 0, 0],
  ['dpd', 'Mme Sophie Garnier', 'Déléguée à la protection des données', 'lecture', 'consultatif', 0, 1],
];

async function seed() {
  if (q().prepare('SELECT COUNT(*) n FROM users').get().n) return false;
  const U = {};
  for (const [k, name, quality, role, fonction, hp, ind] of MEMBERS) {
    const r = q().prepare(`INSERT INTO users (email, full_name, quality, role, fonction, health_professional, independent, dpd, status, totp_enabled, totp_secret, created_at)
      VALUES (?,?,?,?,?,?,?,?,'actif',1,?,?)`).run(`${k}@demo.promednav.invalid`, name, quality, role, fonction, hp, ind, k === 'dpd' ? 1 : 0, sec.encryptText(totp.generateSecret()), Date.now());
    U[k] = q().prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
  }
  const doc = async (d, piece, name, title, lines) => domain.addDocument(d.id, { originalname: name, buffer: await pdf(title, lines) }, { piece });
  const comment = (d, who, body, extra = {}) => domain.addComment({ dossierId: d.id, author: U[who], body, ...extra });
  const vote = (sc, who, choice, motivation = '') => gov.castVote(sc, U[who], choice, motivation, 'demo');
  const sign = async (acte) => {
    const meta = JSON.parse(acte.meta_json);
    const scan = await pdf('Exemplaire signé à la main (numérisation fictive)', [`Avis ${meta.numero || ''}`, 'Signature manuscrite du président — démonstration.']);
    return gov.attachHandwritten(acte, { originalname: 'scan-signe.pdf', buffer: scan }, U.pres, { code: meta.verifCode, note: 'Démonstration' });
  };
  const PROTO = ['Objectif : décrire les facteurs de risque à partir de données déjà collectées.', 'Méthode : étude rétrospective sur dossiers pseudonymisés ; aucune intervention auprès des participants.', 'Enjeux éthiques (Déclaration d’Helsinki, § 22) : information des personnes, droit d’opposition, minimisation des données.'];

  // ----- Séance 1 (close, avec procès-verbal) : dossiers A et B -----
  const seance1 = gov.createSeance({ date: Date.now() - 864e5, mode: 'visio', lieu: 'Visioconférence' }, U.secretariat);

  // Dossier A : avis favorable, signé, transmis, réception confirmée
  const A = domain.createDossier({ title: 'Registre des accidents de désaturation en plongée de loisir : étude rétrospective 2015-2025', applicant_name: 'Dr Paul Durand (fictif)', applicant_email: 'porteur.a@demo.promednav.invalid', applicant_affiliation: 'Service de médecine hyperbare (fictif)', qualification: 'RNIPH', qualification_reason: 'Étude sur données déjà collectées, sans intervention.', summary: PROTO.join(' ') });
  await doc(A, 'a', 'lettre-saisine.pdf', 'Lettre de saisine', ['Qualification retenue : recherche n’impliquant pas la personne humaine.']);
  await doc(A, 'b', 'protocole-v1.pdf', 'Protocole', PROTO);
  await doc(A, 'c', 'note-information.pdf', 'Note d’information des participants', ['Les plongeurs peuvent s’opposer à l’utilisation de leurs données.']);
  gov.event(A.id, U.secretariat.id, 'status', 'Statut : Recevable — accusé de réception envoyé', 'recevable');
  gov.designateRapporteur(A, U.plongee.id, U.pres); gov.designateRapporteur(A, U.juriste.id, U.pres);
  const a1 = comment(A, 'plongee', 'Rapport : la méthodologie est adaptée et les données sont pseudonymisées. Avis favorable proposé.', { kind: 'rapport' });
  comment(A, 'juriste', 'Rapport : la note d’information mentionne le droit d’opposition ; la formalité CNIL (MR-004) est identifiée. Rien à redire.', { kind: 'rapport' });
  comment(A, 'usagers', 'Du point de vue des plongeurs, la note d’information est claire.', { parentId: a1.id });
  const scA = gov.openScrutin({ dossier: A, by: U.pres, seanceId: seance1.id });
  for (const [w, c] of [['pres', 'favorable'], ['vp', 'favorable'], ['juriste', 'favorable'], ['plongee', 'favorable'], ['methodo', 'favorable'], ['usagers', 'favorable'], ['ide', 'abstention']]) vote(scA, w, c);
  const scAc = gov.closeScrutin(scA, U.pres);

  // Dossier B : avis défavorable (puis appel)
  const B = domain.createDossier({ title: 'Enquête sur les pratiques d’oxygénothérapie hyperbare dans les centres français', applicant_name: 'Dr Nora Lambert (fictive)', applicant_email: 'porteur.b@demo.promednav.invalid', applicant_affiliation: 'Centre hospitalier (fictif)', qualification: 'RNIPH', qualification_reason: 'Enquête de pratiques auprès des centres.', summary: 'Questionnaire adressé aux centres hyperbares.' });
  await doc(B, 'a', 'lettre-saisine.pdf', 'Lettre de saisine', ['Enquête de pratiques.']);
  await doc(B, 'b', 'protocole.pdf', 'Protocole', ['Questionnaire en ligne nominatif adressé aux médecins des centres.']);
  gov.event(B.id, U.secretariat.id, 'status', 'Statut : Recevable — accusé de réception envoyé', 'recevable');
  gov.designateRapporteur(B, U.methodo.id, U.pres); gov.designateRapporteur(B, U.usagers.id, U.pres);
  comment(B, 'methodo', 'Rapport : le questionnaire est nominatif sans justification ; la confidentialité des réponses n’est pas garantie.', { kind: 'rapport' });
  comment(B, 'usagers', 'Rapport : aucune information n’est prévue pour les répondants. Avis défavorable proposé.', { kind: 'rapport' });
  const scB = gov.openScrutin({ dossier: B, by: U.pres, seanceId: seance1.id, secret: true });
  for (const [w, c, m] of [['pres', 'defavorable'], ['vp', 'defavorable'], ['juriste', 'defavorable'], ['plongee', 'modifications', 'Des modifications suffiraient.'], ['methodo', 'defavorable'], ['usagers', 'defavorable'], ['ide', 'defavorable']]) vote(scB, w, c, m || '');
  const scBc = gov.closeScrutin(scB, U.pres);
  await gov.closeSeance(seance1, U.pres);

  const avisA = await gov.generateAvis({ dossier: domain.getDossier(A.id), scrutin: scAc, by: U.pres, motivation: 'Le projet porte sur des données pseudonymisées déjà collectées et prévoit une information des plongeurs avec droit d’opposition. Il respecte les principes de la Déclaration d’Helsinki.', motivationEn: 'The project uses pseudonymised data already collected and informs divers of their right to object.' });
  await sign(avisA);
  await gov.closeDossier(domain.getDossier(A.id), U.pres);
  await gov.sendAvis(avisA, U.pres, { subject: `Avis du CER-PROMEDNAV — ${A.reference}`, body: 'Madame, Monsieur,\n\nVeuillez trouver ci-joint l’avis du comité sur votre demande.\n\nDr Alice Martin\nPrésidente du CER-PROMEDNAV' });
  const tokA = (mailer.outbox.map((m) => m.text).join(' ').match(/reception\/([A-Za-z0-9_-]+)/) || [])[1];
  if (tokA) require('./reception').confirm(tokA, 'démonstration');

  const avisB = await gov.generateAvis({ dossier: domain.getDossier(B.id), scrutin: scBc, by: U.pres, motivation: 'Le questionnaire nominatif n’est pas justifié et aucune information des répondants n’est prévue. La confidentialité des réponses n’est pas assurée.' });
  await sign(avisB);
  await gov.closeDossier(domain.getDossier(B.id), U.pres);
  await gov.sendAvis(avisB, U.pres, { subject: `Avis du CER-PROMEDNAV — ${B.reference}`, body: 'Madame, Monsieur,\n\nVeuillez trouver ci-joint l’avis du comité.\n\nDr Alice Martin' });

  // Appel du dossier B par la porteuse (dans le délai)
  const Bc = domain.getDossier(B.id);
  const Ap = domain.createDossier({ title: `Appel — ${Bc.title}`, applicant_name: Bc.applicant_name, applicant_email: Bc.applicant_email, applicant_affiliation: Bc.applicant_affiliation, qualification: Bc.qualification, qualification_reason: Bc.qualification_reason, summary: 'Le questionnaire est désormais anonyme et une note d’information est jointe.', source: 'site', kind: 'appel', parent_id: Bc.id, parent_reference: Bc.reference, appeal_avis_id: avisB.id, appeal_role: 'porteur', appeal_requester: Bc.applicant_name, appeal_requester_email: Bc.applicant_email, appeal_reason: 'Le questionnaire est désormais anonyme et une note d’information est jointe.' });
  await doc(Ap, 'a', 'lettre-appel.pdf', 'Lettre d’appel', ['Le questionnaire est rendu anonyme ; une note d’information est ajoutée.']);
  await doc(Ap, 'c', 'note-information-v2.pdf', 'Note d’information des répondants', ['Les réponses sont anonymes et facultatives.']);
  require('./appeal').fileCopies(domain.getDossier(Ap.id), Bc);

  // ----- Dossier C : en instruction, vote électronique ouvert -----
  const C = domain.createDossier({ title: 'Évaluation de la tolérance des séances en caisson multiplace chez les patients âgés', applicant_name: 'Pr Jean Morel (fictif)', applicant_email: 'porteur.c@demo.promednav.invalid', applicant_affiliation: 'Unité de recherche clinique (fictive)', qualification: 'RNIPH', qualification_reason: 'Analyse de dossiers existants.', summary: PROTO.join(' ') });
  await doc(C, 'a', 'lettre-saisine.pdf', 'Lettre de saisine', ['Demande d’avis.']);
  await doc(C, 'b', 'protocole.pdf', 'Protocole', PROTO);
  await doc(C, 'd', 'description-donnees.pdf', 'Description des données', ['Variables : âge, nombre de séances, incidents. Hébergement : serveur de l’établissement.']);
  gov.event(C.id, U.secretariat.id, 'status', 'Statut : En instruction', 'instruction');
  q().prepare("UPDATE dossiers SET status = 'instruction' WHERE id = ?").run(C.id);
  q().prepare('INSERT INTO conflicts (dossier_id, user_id, reason, declared_at) VALUES (?,?,?,?)').run(C.id, U.ide.id, 'Exerce dans le service du porteur', Date.now());
  gov.designateRapporteur(C, U.vp.id, U.pres); gov.designateRapporteur(C, U.juriste.id, U.pres);
  const c1 = comment(C, 'vp', 'Rapport : protocole solide. Une réserve : préciser la durée de conservation des données.', { kind: 'rapport' });
  comment(C, 'juriste', 'Rapport : je rejoins la réserve ; la formalité CNIL est bien identifiée.', { kind: 'rapport' });
  comment(C, 'methodo', 'Le calcul du nombre de sujets mériterait d’être explicité.', { parentId: c1.id });
  comment(C, 'vp', 'Complément : le porteur a répondu par courriel au secrétariat, la durée sera de 5 ans.', { parentId: c1.id });
  const scC = gov.openScrutin({ dossier: domain.getDossier(C.id), by: U.pres, deadline: Date.now() + 14 * 864e5 });
  vote(scC, 'vp', 'favorable_reserve', 'Sous réserve de préciser la durée de conservation.');
  vote(scC, 'juriste', 'favorable_reserve');

  // ----- Dossier D : simple dépôt (notifications) -----
  const D = domain.createDossier({ title: 'Questionnaire sur la perception du risque chez les plongeurs professionnels', applicant_name: 'Mme Julie Faure (fictive)', applicant_email: 'porteur.d@demo.promednav.invalid', qualification: 'RNIPH', qualification_reason: 'Enquête anonyme.', summary: 'Questionnaire anonyme en ligne.' });
  await doc(D, 'a', 'lettre-saisine.pdf', 'Lettre de saisine', ['Demande d’avis.']);
  await doc(D, 'b', 'protocole.pdf', 'Protocole', ['Questionnaire anonyme diffusé par les fédérations.']);
  await require('./notify').newDossier(D);

  // ----- Dossier E : ancien dossier arrivé en fin de conservation, destruction proposée -----
  const E = domain.createDossier({ title: 'Étude historique des barotraumatismes de l’oreille (archives 2008-2012)', applicant_name: 'Dr Henri Blanc (fictif)', applicant_email: 'porteur.e@demo.promednav.invalid', qualification: 'RNIPH', qualification_reason: 'Archives.', summary: 'Dossier ancien.' });
  await doc(E, 'a', 'lettre-saisine.pdf', 'Lettre de saisine', ['Demande ancienne.']);
  await doc(E, 'b', 'protocole.pdf', 'Protocole', ['Étude sur archives.']);
  gov.designateRapporteur(E, U.plongee.id, U.pres); gov.designateRapporteur(E, U.juriste.id, U.pres);
  comment(E, 'plongee', 'Rapport : pas d’objection.', { kind: 'rapport' });
  const scE = gov.openScrutin({ dossier: E, by: U.pres, deadline: Date.now() + 14 * 864e5 });
  for (const w of ['pres', 'vp', 'juriste', 'plongee', 'methodo', 'usagers']) vote(scE, w, 'favorable');
  const avisE = await gov.generateAvis({ dossier: domain.getDossier(E.id), scrutin: gov.closeScrutin(scE, U.pres), by: U.pres, motivation: 'Étude sur archives sans objection éthique.' });
  await sign(avisE);
  await gov.closeDossier(domain.getDossier(E.id), U.pres);
  const retention = require('./retention');
  retention.setProjectEnd(domain.getDossier(E.id), U.pres, new Date(2014, 11, 31).getTime());
  retention.propose(domain.getDossier(E.id), U.pres);

  // ----- Séance 2 programmée, rapport annuel -----
  gov.createSeance({ date: Date.now() + 10 * 864e5, mode: 'presentiel', lieu: 'Siège de PROMEDNAV, Toulon (fictif)' }, U.secretariat);
  await gov.generateAnnualReport(new Date().getFullYear(), U.pres);
  return true;
}

// ---------- Routes de démonstration ----------
function router() {
  const r = express.Router();
  r.get('/accounts', (req, res) => {
    res.json({ accounts: q().prepare("SELECT * FROM users WHERE status = 'actif' ORDER BY id").all().map((u) => ({ id: u.id, full_name: u.full_name, quality: u.quality, role: u.role, fonction: u.fonction, dpd: !!u.dpd })), code: DEMO_CODE });
  });
  r.post('/login', (req, res) => {
    const u = q().prepare("SELECT * FROM users WHERE id = ? AND status = 'actif'").get((req.body || {}).user_id);
    if (!u) return res.status(404).json({ error: 'Compte inconnu' });
    res.json({ token: createSession(u, 'full', req), stage: 'full', user: publicUser(u) });
  });
  r.get('/courriels', (req, res) => {
    res.json({ courriels: mailer.outbox.slice().reverse().map((m, i) => ({ id: i, to: m.to, subject: m.subject, text: m.text, attachments: (m.attachments || []).map((a) => a.filename) })) });
  });
  return r;
}

module.exports = { enabled, assertSafe, seed, router, DEMO_CODE };
