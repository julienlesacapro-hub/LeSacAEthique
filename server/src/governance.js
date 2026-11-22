'use strict';
/**
 * Instruction et délibération du comité (règlement intérieur, art. 28 à 34) :
 *  - désignation des rapporteurs (art. 28.1) ;
 *  - scrutins en séance ou par voie électronique, procédure ordinaire ou
 *    simplifiée (art. 29 et 30), quorum (art. 29.2), majorité (art. 29.3) ;
 *  - contrôle d'intégrité OBLIGATOIRE et consigné avant toute clôture de vote ;
 *  - actes : avis (annexe 7), procès-verbaux (art. 29.4), rapport annuel (art. 34.2) ;
 *  - dépôt de la version signée (signature électronique qualifiée) d'un acte.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const config = require('./config');
const sec = require('./security');

const q = () => db.get();

const FONCTIONS = {
  president: 'Président(e) du comité',
  vice_president: 'Vice-président(e) du comité',
  titulaire: 'Membre titulaire',
  suppleant: 'Membre suppléant',
  secretariat: 'Secrétariat administratif (sans voix)',
  consultatif: 'Voix consultative (DPD, expert)',
};
const VOTING = ['president', 'vice_president', 'titulaire'];

const CHOICES = {
  favorable: 'Favorable',
  favorable_reserve: 'Favorable sous réserve',
  modifications: 'Demande de modifications avec nouvel examen',
  defavorable: 'Défavorable',
  incompetence: 'Incompétence, avec renvoi vers un CPP',
  abstention: 'Abstention',
};
const CHOICES_EN = {
  favorable: 'favourable',
  favorable_reserve: 'conditionally favourable',
  modifications: 'modifications requested, with a new review',
  defavorable: 'unfavourable',
  incompetence: 'lack of competence (referral to a French Committee for the Protection of Persons)',
};
const CHOICE_TO_STATUS = {
  favorable: 'avis_favorable', favorable_reserve: 'avis_reserve', modifications: 'avis_modifications',
  defavorable: 'avis_defavorable', incompetence: 'incompetence',
};

class RuleError extends Error { constructor(msg, extra = {}) { super(msg); this.status = 400; Object.assign(this, extra); } }

const getUser = (id) => q().prepare('SELECT * FROM users WHERE id = ?').get(id);
const isRecused = (userId, dossierId) => !!q().prepare('SELECT 1 FROM conflicts WHERE user_id = ? AND dossier_id = ?').get(userId, dossierId);
const isAdmin = (u) => u && u.role === 'admin';
const canManageDossiers = (u) => isAdmin(u) || (u && u.fonction === 'secretariat');
const seats = () => q().prepare(`SELECT COUNT(*) n FROM users WHERE status = 'actif' AND fonction IN (${VOTING.map(() => '?').join(',')})`).get(...VOTING).n;

function event(dossierId, userId, type, details, value = null) {
  q().prepare('INSERT INTO dossier_events (dossier_id, at, user_id, type, value, details) VALUES (?,?,?,?,?,?)')
    .run(dossierId, Date.now(), userId, type, value, details);
}

// ===================== Rapporteurs (art. 28.1) =====================
function activeRapporteurs(dossierId) {
  return q().prepare(`SELECT r.*, u.full_name, u.quality, u.health_professional FROM rapporteurs r JOIN users u ON u.id = r.user_id
    WHERE r.dossier_id = ? AND r.ended_at IS NULL ORDER BY r.id`).all(dossierId);
}
const isRapporteur = (userId, dossierId) => activeRapporteurs(dossierId).some((r) => r.user_id === userId);

function designateRapporteur(dossier, userId, by) {
  assertOpen(dossier);
  const u = getUser(userId);
  if (!u || u.status !== 'actif') throw new RuleError('Membre introuvable ou inactif');
  if (![...VOTING, 'suppleant'].includes(u.fonction)) throw new RuleError('Seul un membre du comité (titulaire, suppléant, président, vice-président) peut être rapporteur');
  if (isRecused(u.id, dossier.id)) throw new RuleError('Ce membre s’est déporté sur ce dossier');
  const current = activeRapporteurs(dossier.id);
  if (current.some((r) => r.user_id === u.id)) throw new RuleError('Ce membre est déjà rapporteur');
  if (current.length >= 2) throw new RuleError('Deux rapporteurs sont déjà désignés (art. 28.1). Mettez fin à une désignation d’abord.');
  if (dossier.kind === 'appel' && require('./appeal').previousRapporteurs(dossier).includes(u.id)) {
    throw new RuleError('En appel, les rapporteurs doivent être différents de ceux du dossier initial (art. 33.1)');
  }
  if (current.length === 1 && current[0].health_professional && u.health_professional) {
    throw new RuleError('Au moins un des deux rapporteurs ne doit pas exercer une profession de santé (art. 28.1)');
  }
  q().prepare('INSERT INTO rapporteurs (dossier_id, user_id, designated_by, designated_at) VALUES (?,?,?,?)').run(dossier.id, u.id, by.id, Date.now());
  event(dossier.id, by.id, 'rapporteur', `Désignation de ${u.full_name} comme rapporteur`);
  return u;
}

function endRapporteur(dossierId, userId, byId, reason) {
  const r = q().prepare('SELECT * FROM rapporteurs WHERE dossier_id = ? AND user_id = ? AND ended_at IS NULL').get(dossierId, userId);
  if (!r) return false;
  q().prepare('UPDATE rapporteurs SET ended_at = ?, end_reason = ? WHERE id = ?').run(Date.now(), reason, r.id);
  const u = getUser(userId);
  event(dossierId, byId, 'rapporteur', `Fin de la désignation de ${u.full_name} (${reason})`);
  return true;
}

// ===================== Scrutins (art. 29 et 30) =====================
function documentsSnapshot(dossierId) {
  return q().prepare('SELECT id, piece, original_name, version, sha256 FROM documents WHERE dossier_id = ? ORDER BY piece, original_name, version').all(dossierId);
}

const openScrutinOf = (dossierId) => q().prepare("SELECT * FROM scrutins WHERE dossier_id = ? AND status = 'ouvert'").get(dossierId);

function openScrutin({ dossier, by, procedure = 'ordinaire', secret = false, seanceId = null, deadline = null, substitutes = [], rapporteurId = null }) {
  assertOpen(dossier);
  if (openScrutinOf(dossier.id)) throw new RuleError('Un scrutin est déjà ouvert sur ce dossier');
  if (seanceId) {
    const s = q().prepare('SELECT * FROM seances WHERE id = ?').get(seanceId);
    if (!s) throw new RuleError('Séance introuvable');
    if (s.closed_at) throw new RuleError('Cette séance est close');
  }
  if (deadline && deadline < Date.now()) throw new RuleError('La date limite est passée');
  const rapp = activeRapporteurs(dossier.id);
  let electeurs = [];
  let nSeats;
  if (procedure === 'simplifiee' && dossier.kind === 'appel') throw new RuleError('Un appel est examiné en séance plénière : la procédure simplifiée est exclue (art. 33.1)');
  if (procedure === 'simplifiee') {
    // Art. 30.2 : le président (ou le vice-président) et un rapporteur
    if (!['president', 'vice_president'].includes(by.fonction)) throw new RuleError('La procédure simplifiée est conduite par le président ou le vice-président (art. 30.2)');
    if (isRecused(by.id, dossier.id)) throw new RuleError('Vous vous êtes déporté(e) sur ce dossier');
    const r = rapp.find((x) => x.user_id === Number(rapporteurId)) || (rapp.length === 1 ? rapp[0] : null);
    if (!r) throw new RuleError('Choisissez le rapporteur qui rend l’avis avec vous (art. 30.2)');
    if (r.user_id === by.id) throw new RuleError('Le rapporteur doit être une autre personne que le président');
    electeurs = [{ user_id: by.id, substitute_for: null }, { user_id: r.user_id, substitute_for: null }];
    nSeats = 2;
  } else {
    if (rapp.length < 2) throw new RuleError('Deux rapporteurs doivent être désignés avant le vote (art. 28.1)');
    const voters = q().prepare(`SELECT id FROM users WHERE status = 'actif' AND fonction IN (${VOTING.map(() => '?').join(',')})`).all(...VOTING);
    electeurs = voters.filter((u) => !isRecused(u.id, dossier.id)).map((u) => ({ user_id: u.id, substitute_for: null }));
    for (const s of substitutes || []) {
      const sup = getUser(s.user_id); const tit = getUser(s.substitute_for);
      if (!sup || sup.fonction !== 'suppleant' || sup.status !== 'actif') throw new RuleError('Le remplaçant doit être un membre suppléant actif');
      if (!tit || !VOTING.includes(tit.fonction)) throw new RuleError('Le membre remplacé doit être un membre votant');
      if (isRecused(sup.id, dossier.id)) throw new RuleError(`${sup.full_name} s’est déporté(e) sur ce dossier`);
      if (electeurs.some((e) => e.user_id === sup.id)) throw new RuleError('Un suppléant ne peut remplacer qu’un seul membre');
      if (electeurs.some((e) => e.substitute_for === tit.id)) throw new RuleError(`${tit.full_name} a déjà un remplaçant`);
      electeurs.push({ user_id: sup.id, substitute_for: tit.id });
    }
    nSeats = seats();
  }
  const id = q().transaction(() => {
    const r = q().prepare(`INSERT INTO scrutins (dossier_id, seance_id, procedure, secret, opened_by, opened_at, deadline, seats, documents_json)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(dossier.id, seanceId, procedure, secret ? 1 : 0, by.id, Date.now(), deadline, nSeats, JSON.stringify(documentsSnapshot(dossier.id)));
    const ins = q().prepare('INSERT INTO scrutin_electeurs (scrutin_id, user_id, substitute_for) VALUES (?,?,?)');
    for (const e of electeurs) ins.run(r.lastInsertRowid, e.user_id, e.substitute_for);
    event(dossier.id, by.id, 'scrutin', `Ouverture du scrutin n° ${r.lastInsertRowid} (procédure ${procedure === 'simplifiee' ? 'simplifiée' : 'ordinaire'}${secret ? ', bulletin secret' : ''})`);
    return r.lastInsertRowid;
  })();
  return q().prepare('SELECT * FROM scrutins WHERE id = ?').get(id);
}

/**
 * Enregistre un vote SIGNÉ. La route a déjà exigé un code de double
 * authentification au moment du vote (« method ») : le vote est un acte
 * volontaire, imputable à son auteur. L'émargement (qui a voté) et le
 * bulletin (ce qui a été voté) reçoivent chacun une empreinte et une
 * signature du serveur. En vote secret, le bulletin ne porte ni nom ni lien
 * avec l'émargement.
 */
function castVote(sc, user, choice, motivation, method = 'totp') {
  if (sc.status !== 'ouvert') throw new RuleError('Ce scrutin est clos');
  if (sc.deadline && Date.now() > sc.deadline) throw new RuleError('La date limite de vote est passée');
  if (!CHOICES[choice]) throw new RuleError('Choix invalide');
  if (sc.procedure === 'simplifiee' && (choice === 'defavorable' || choice === 'abstention')) {
    throw new RuleError('Un avis défavorable ne peut pas être rendu en procédure simplifiée (art. 30.2). Demandez un examen en séance plénière.');
  }
  const el = q().prepare('SELECT * FROM scrutin_electeurs WHERE scrutin_id = ? AND user_id = ?').get(sc.id, user.id);
  if (!el) throw new RuleError('Vous n’êtes pas appelé(e) à voter sur ce scrutin');
  if (isRecused(user.id, sc.dossier_id)) throw new RuleError('Vous vous êtes déporté(e) sur ce dossier');
  if (q().prepare('SELECT 1 FROM emargements WHERE scrutin_id = ? AND user_id = ?').get(sc.id, user.id)) throw new RuleError('Vous avez déjà voté');
  // Un titulaire et son suppléant ne votent pas tous les deux
  if (el.substitute_for && q().prepare('SELECT 1 FROM emargements WHERE scrutin_id = ? AND user_id = ?').get(sc.id, el.substitute_for)) {
    throw new RuleError('Le membre que vous remplacez a déjà voté');
  }
  const sub = q().prepare('SELECT user_id FROM scrutin_electeurs WHERE scrutin_id = ? AND substitute_for = ?').get(sc.id, user.id);
  if (sub && q().prepare('SELECT 1 FROM emargements WHERE scrutin_id = ? AND user_id = ?').get(sc.id, sub.user_id)) {
    throw new RuleError('Votre suppléant a déjà voté à votre place');
  }
  const mot = String(motivation || '').trim().slice(0, 4000);
  const at = Date.now();
  const em = { scrutin_id: sc.id, user_id: user.id, at, method };
  em.hash = sec.sha256(emargementCanon(em));
  em.signature = sec.sign(em.hash);
  const b = { id: crypto.randomUUID(), scrutin_id: sc.id, choice, motivation: mot, voter_id: sc.secret ? null : user.id, voter_name: sc.secret ? null : user.full_name };
  b.emargement_hash = sc.secret ? null : em.hash;
  b.hash = sec.sha256(bulletinCanon(b));
  b.signature = sec.sign(b.hash);
  q().transaction(() => {
    q().prepare('INSERT INTO emargements (scrutin_id, user_id, at, method, hash, signature) VALUES (?,?,?,?,?,?)').run(sc.id, user.id, at, method, em.hash, em.signature);
    q().prepare('INSERT INTO bulletins (id, scrutin_id, choice, motivation, voter_id, voter_name, hash, signature) VALUES (?,?,?,?,?,?,?,?)')
      .run(b.id, sc.id, choice, mot, b.voter_id, b.voter_name, b.hash, b.signature);
  })();
  return { receipt: b.hash, emargement: em.hash, at };
}

const emargementCanon = (e) => JSON.stringify(['v1-emargement', e.scrutin_id, e.user_id, e.at, e.method]);
const bulletinCanon = (b) => JSON.stringify(['v1-bulletin', b.id, b.scrutin_id, b.choice, sec.sha256(b.motivation || ''), b.voter_id ?? null, b.voter_name ?? null, b.emargement_hash ?? null]);

/** Vérifie la signature de chaque émargement et de chaque bulletin. */
function verifyVotes() {
  const problems = [];
  const emHash = new Map();
  for (const e of q().prepare('SELECT * FROM emargements').iterate()) {
    const h = sec.sha256(emargementCanon(e));
    if (!e.hash || h !== e.hash || !sec.verifySignature(e.hash, e.signature)) problems.push(`Émargement (scrutin n° ${e.scrutin_id}, membre n° ${e.user_id}) : signature invalide ou contenu modifié`);
    emHash.set(`${e.scrutin_id}:${e.user_id}`, e.hash);
  }
  for (const b of q().prepare('SELECT b.*, s.secret FROM bulletins b JOIN scrutins s ON s.id = b.scrutin_id').iterate()) {
    const h = sec.sha256(bulletinCanon({ ...b, emargement_hash: b.secret ? null : emHash.get(`${b.scrutin_id}:${b.voter_id}`) }));
    if (!b.hash || h !== b.hash || !sec.verifySignature(b.hash, b.signature)) problems.push(`Bulletin (scrutin n° ${b.scrutin_id}) : signature invalide ou contenu modifié`);
  }
  return problems;
}

function tallyOf(scrutinId) {
  const rows = q().prepare('SELECT id, choice, motivation, voter_id FROM bulletins WHERE scrutin_id = ? ORDER BY id').all(scrutinId);
  const counts = Object.fromEntries(Object.keys(CHOICES).map((k) => [k, 0]));
  for (const r of rows) counts[r.choice]++;
  const hash = sec.sha256(JSON.stringify(rows.map((r) => [r.id, r.choice, r.motivation, r.voter_id])));
  return { ballots: rows.length, counts, hash, rows };
}

function computeResult(sc) {
  const t = tallyOf(sc.id);
  const voters = q().prepare(`SELECT u.id, u.full_name, u.quality, u.health_professional, u.independent FROM emargements e JOIN users u ON u.id = e.user_id
    WHERE e.scrutin_id = ? ORDER BY u.full_name`).all(sc.id);
  const quorum = { participants: voters.length, reasons: [] };
  if (sc.procedure === 'simplifiee') {
    quorum.needed = 2;
    if (voters.length < 2) quorum.reasons.push('Le président (ou le vice-président) et le rapporteur doivent tous deux se prononcer');
  } else {
    quorum.needed = Math.floor(sc.seats / 2) + 1;
    quorum.nonHealth = voters.filter((v) => !v.health_professional).length;
    quorum.independent = voters.filter((v) => v.independent).length;
    if (voters.length < quorum.needed) quorum.reasons.push(`${voters.length} participant(s) pour ${quorum.needed} requis (majorité des ${sc.seats} membres votants en exercice)`);
    if (!quorum.nonHealth) quorum.reasons.push('Aucun participant n’exerce une profession non médicale (art. 29.2)');
    if (!quorum.independent) quorum.reasons.push('Aucun membre indépendant de l’association n’a participé (art. 29.2)');
  }
  quorum.ok = quorum.reasons.length === 0;
  let decision = null;
  const expressed = t.ballots - t.counts.abstention;
  if (quorum.ok && expressed > 0) {
    if (sc.procedure === 'simplifiee') {
      const choices = new Set(t.rows.map((r) => r.choice));
      if (choices.size === 1) decision = [...choices][0];
    } else {
      for (const [k, n] of Object.entries(t.counts)) if (k !== 'abstention' && n * 2 > expressed) decision = k;
    }
  }
  const divergent = decision ? t.rows.filter((r) => r.choice !== decision && r.choice !== 'abstention').map((r) => ({ choice: r.choice, motivation: r.motivation })) : [];
  const unanimous = decision && t.counts[decision] === t.ballots;
  return { tally: t, voters, quorum, decision, divergent, unanimous, expressed };
}

function closeScrutin(sc, by) {
  if (sc.status !== 'ouvert') throw new RuleError('Ce scrutin est déjà clos');
  // Contrôle de non-altération obligatoire, consigné, préalable à la validation du vote
  const check = require('./domain').recordIntegrityCheck(by.id, `Clôture du scrutin n° ${sc.id}`);
  if (!check.ok) {
    throw new RuleError('Contrôle d’intégrité NON CONFORME : le vote ne peut pas être validé. Prévenez le référent sécurité.', { problems: check.problems, checkId: check.checkId });
  }
  const r = computeResult(sc);
  const result = r.decision || (r.quorum.ok ? 'pas_de_majorite' : 'quorum_non_atteint');
  q().prepare(`UPDATE scrutins SET status = 'clos', closed_by = ?, closed_at = ?, integrity_check_id = ?, participants = ?, quorum_json = ?,
    tally_json = ?, tally_hash = ?, result = ? WHERE id = ?`).run(
    by.id, Date.now(), check.checkId, r.voters.length, JSON.stringify(r.quorum), JSON.stringify(r.tally.counts), r.tally.hash, result, sc.id);
  const label = CHOICES[result] || (result === 'pas_de_majorite' ? 'pas de majorité' : 'quorum non atteint');
  event(sc.dossier_id, by.id, 'scrutin', `Clôture du scrutin n° ${sc.id} : ${label} (contrôle d’intégrité n° ${check.checkId} conforme)`);
  return { ...q().prepare('SELECT * FROM scrutins WHERE id = ?').get(sc.id), check };
}

function cancelScrutin(sc, by, reason) {
  if (sc.status !== 'ouvert') throw new RuleError('Ce scrutin n’est plus ouvert');
  q().prepare("UPDATE scrutins SET status = 'annule', closed_at = ?, closed_by = ?, cancel_reason = ? WHERE id = ?").run(Date.now(), by.id, reason, sc.id);
  event(sc.dossier_id, by.id, 'scrutin', `Annulation du scrutin n° ${sc.id} : ${reason}`);
}

/** Art. 30.2 : tout membre peut demander un examen en séance plénière. */
function requestPlenary(dossier, by) {
  assertOpen(dossier);
  const sc = openScrutinOf(dossier.id);
  if (sc && sc.procedure === 'simplifiee') cancelScrutin(sc, by, `examen en séance plénière demandé par ${by.full_name}`);
  if (dossier.procedure === 'simplifiee' || sc) {
    q().prepare("UPDATE dossiers SET procedure = 'ordinaire', updated_at = ? WHERE id = ?").run(Date.now(), dossier.id);
    event(dossier.id, by.id, 'procedure', `Examen en séance plénière demandé par ${by.full_name} (art. 30.2)`, 'ordinaire');
    return true;
  }
  throw new RuleError('Ce dossier n’est pas en procédure simplifiée');
}

function scrutinView(sc, viewer) {
  const electeurs = q().prepare(`SELECT se.user_id, se.substitute_for, u.full_name, u.quality, t.full_name AS substitute_for_name,
      EXISTS (SELECT 1 FROM emargements e WHERE e.scrutin_id = se.scrutin_id AND e.user_id = se.user_id) AS voted
    FROM scrutin_electeurs se JOIN users u ON u.id = se.user_id LEFT JOIN users t ON t.id = se.substitute_for
    WHERE se.scrutin_id = ? ORDER BY u.full_name`).all(sc.id);
  const me = electeurs.find((e) => e.user_id === viewer.id);
  const v = {
    id: sc.id, procedure: sc.procedure, secret: !!sc.secret, status: sc.status, opened_at: sc.opened_at, deadline: sc.deadline,
    seance_id: sc.seance_id, seats: sc.seats, closed_at: sc.closed_at, result: sc.result, cancel_reason: sc.cancel_reason,
    integrity_check_id: sc.integrity_check_id, tally_hash: sc.tally_hash,
    electeurs: electeurs.map((e) => ({ full_name: e.full_name, quality: e.quality, voted: !!e.voted, substitute_for_name: e.substitute_for_name })),
    canVote: !!me && !me.voted && sc.status === 'ouvert',
    hasVoted: !!(me && me.voted),
  };
  if (sc.status === 'clos') {
    const r = computeResult(sc);
    v.counts = JSON.parse(sc.tally_json);
    v.quorum = JSON.parse(sc.quorum_json);
    v.divergent = r.divergent;
    v.ballots = sc.secret ? undefined : r.tally.rows.map((b) => ({ choice: b.choice, motivation: b.motivation, voter_name: getUser(b.voter_id)?.full_name }));
    v.avis = q().prepare("SELECT id FROM actes WHERE type = 'avis' AND scrutin_id = ? AND parent_id IS NULL").get(sc.id) || null;
  }
  return v;
}

// ===================== Actes (avis, PV, rapports) =====================
/** Code imprimé sur chaque acte, à recopier lors du versement de l'exemplaire signé. */
function verifCode() {
  const raw = require('./totp').base32Encode(crypto.randomBytes(6)).slice(0, 8);
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z2-7]/g, '');

function assertOpen(dossier) {
  if (dossier && dossier.closed_at) throw new RuleError('Dossier clos et archivé : il est en lecture seule.');
}

const MIME_BY_EXT = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
const acteMime = (a) => MIME_BY_EXT[(a.original_name.split('.').pop() || '').toLowerCase()] || 'application/pdf';

/** Dernière version signée (manuscrite numérisée ou électronique qualifiée) d'un acte. */
const signedVersionOf = (acteId) => q().prepare('SELECT * FROM actes WHERE parent_id = ? AND signed = 1 ORDER BY id DESC').get(acteId);
function storeActe({ type, dossierId = null, seanceId = null, scrutinId = null, year = null, title, meta = {}, buffer, originalName, byId, signed = 0, parentId = null }) {
  const storage = crypto.randomUUID() + '.bin';
  fs.writeFileSync(path.join(config.filesDir, storage), sec.encrypt(buffer), { mode: 0o600 });
  const r = q().prepare(`INSERT INTO actes (type, dossier_id, seance_id, scrutin_id, year, title, meta_json, storage_name, original_name, size, sha256, signed, parent_id, created_by, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(type, dossierId, seanceId, scrutinId, year, title, JSON.stringify(meta), storage, originalName,
    buffer.length, sec.sha256(buffer), signed, parentId, byId, Date.now());
  return q().prepare('SELECT * FROM actes WHERE id = ?').get(r.lastInsertRowid);
}

function readActe(a) {
  const buf = sec.decrypt(fs.readFileSync(path.join(config.filesDir, a.storage_name)));
  if (sec.sha256(buf) !== a.sha256) throw new Error('Intégrité de l’acte compromise');
  return buf;
}

/**
 * Dépôt de la version signée d'un acte (signature électronique qualifiée PAdES).
 * Les logiciels de signature PDF ajoutent la signature par « mise à jour
 * incrémentale » : le fichier signé COMMENCE par les octets exacts du fichier
 * généré. On vérifie donc que le PDF signé est bien celui produit par l'outil,
 * et qu'il contient un dictionnaire de signature. La qualification du certificat
 * se vérifie avec l'outil de validation de la Commission européenne (DSS).
 */
function attachSigned(acte, buffer, by, note = '') {
  if (acte.signed) throw new RuleError('Cet acte est déjà une version signée');
  if (acte.type === 'rapport_validation') throw new RuleError('Type d’acte non signable');
  const original = readActe(acte);
  if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw new RuleError('Le fichier n’est pas un PDF');
  if (buffer.length <= original.length || !buffer.subarray(0, original.length).equals(original)) {
    throw new RuleError('Ce PDF ne correspond pas à l’acte généré par l’outil (contenu modifié avant signature, ou fichier ré-enregistré au lieu d’être signé).');
  }
  const tail = buffer.subarray(original.length).toString('latin1');
  if (!/\/ByteRange\s*\[/.test(tail) || !/\/Contents\s*</.test(tail)) throw new RuleError('Aucune signature électronique détectée dans le PDF');
  const subFilter = (tail.match(/\/SubFilter\s*\/([A-Za-z0-9.]+)/) || [])[1] || 'inconnu';
  const signed = storeActe({
    type: acte.type, dossierId: acte.dossier_id, seanceId: acte.seance_id, scrutinId: acte.scrutin_id, year: acte.year,
    title: `${acte.title} (signature électronique)`, meta: { signature: 'electronique', note: String(note).slice(0, 500), subFilter, signedBy: by.full_name },
    buffer, originalName: acte.original_name.replace(/\.pdf$/i, '') + '-signe.pdf', byId: by.id, signed: 1, parentId: acte.id,
  });
  if (acte.dossier_id) event(acte.dossier_id, by.id, 'signature', `Version signée déposée : ${acte.title} (format ${subFilter})`);
  return signed;
}

/**
 * Versement de l'exemplaire imprimé, signé à la main puis numérisé (PDF, JPEG
 * ou PNG). On ne peut pas comparer automatiquement une numérisation avec le
 * PDF produit : le signataire recopie donc le code de vérification imprimé
 * sur l'acte, qui prouve qu'il a bien signé CE document.
 */
function attachHandwritten(acte, file, by, { code, note = '' } = {}) {
  if (acte.signed || acte.parent_id) throw new RuleError('Choisissez l’acte d’origine, pas une version déjà versée');
  if (!['avis', 'pv', 'rapport_annuel'].includes(acte.type)) throw new RuleError('Type d’acte non signable');
  if (acte.dossier_id) assertOpen(q().prepare('SELECT * FROM dossiers WHERE id = ?').get(acte.dossier_id));
  const meta = JSON.parse(acte.meta_json || '{}');
  if (!meta.verifCode || normCode(code) !== normCode(meta.verifCode)) {
    throw new RuleError('Le code de vérification ne correspond pas à celui imprimé sur cet acte. Vérifiez que vous versez l’exemplaire signé de ce document.');
  }
  const ext = (file.originalname.split('.').pop() || '').toLowerCase();
  if (!['pdf', 'png', 'jpg', 'jpeg'].includes(ext)) throw new RuleError('Format accepté : PDF, JPEG ou PNG');
  const err = require('./domain').checkFile(file);
  if (err) throw new RuleError(err);
  const signedActe = storeActe({
    type: acte.type, dossierId: acte.dossier_id, seanceId: acte.seance_id, scrutinId: acte.scrutin_id, year: acte.year,
    title: `${acte.title} (exemplaire signé à la main)`,
    meta: { signature: 'manuscrite', signedBy: by.full_name, note: String(note).slice(0, 500), verifCode: meta.verifCode, scanSha256: sec.sha256(file.buffer) },
    buffer: file.buffer, originalName: `${acte.original_name.replace(/\.pdf$/i, '')}-signe.${ext === 'jpeg' ? 'jpg' : ext}`, byId: by.id, signed: 1, parentId: acte.id,
  });
  if (acte.dossier_id) event(acte.dossier_id, by.id, 'signature', `Exemplaire signé à la main versé : ${acte.title}`);
  return signedActe;
}

const acteView = (a) => ({
  id: a.id, type: a.type, title: a.title, original_name: a.original_name, size: a.size, sha256: a.sha256, signed: !!a.signed,
  parent_id: a.parent_id, created_at: a.created_at, sent_at: a.sent_at, meta: JSON.parse(a.meta_json || '{}'), mime: acteMime(a),
  has_signed_version: !a.signed && !!signedVersionOf(a.id),
  created_by_name: a.created_by ? getUser(a.created_by)?.full_name : null,
});

// ===================== Avis (annexe 7) =====================
const avisLocks = new Set();
async function generateAvis(args) {
  if (avisLocks.has(args.scrutin.id)) throw new RuleError('Avis en cours d’établissement');
  avisLocks.add(args.scrutin.id);
  try { return await generateAvisUnlocked(args); } finally { avisLocks.delete(args.scrutin.id); }
}
async function generateAvisUnlocked({ dossier, scrutin, by, motivation, motivationEn = '', validityMonths }) {
  const pdf = require('./pdf');
  if (scrutin.dossier_id !== dossier.id) throw new RuleError('Scrutin d’un autre dossier');
  if (scrutin.status !== 'clos' || !CHOICE_TO_STATUS[scrutin.result]) throw new RuleError('Le scrutin doit être clos avec une décision');
  if (q().prepare("SELECT 1 FROM actes WHERE type = 'avis' AND scrutin_id = ? AND parent_id IS NULL").get(scrutin.id)) throw new RuleError('L’avis de ce scrutin a déjà été établi');
  assertOpen(dossier);
  if (!String(motivation || '').trim()) throw new RuleError('La motivation est obligatoire (art. 31.3 : avis écrit et motivé)');
  const months = Math.min(Math.max(parseInt(validityMonths || config.avisValidityMonths, 10) || 36, 1), 36);
  const r = computeResult(scrutin);
  const seance = scrutin.seance_id ? q().prepare('SELECT * FROM seances WHERE id = ?').get(scrutin.seance_id) : null;
  const check = q().prepare('SELECT * FROM integrity_checks WHERE id = ?').get(scrutin.integrity_check_id);
  const { n } = q().prepare("SELECT COUNT(*) + 1 n FROM actes WHERE type = 'avis' AND dossier_id = ? AND parent_id IS NULL").get(dossier.id);
  const numero = `${dossier.reference}${n > 1 ? `/${n}` : ''}`;
  const nConflicts = q().prepare('SELECT COUNT(*) n FROM conflicts WHERE dossier_id = ?').get(dossier.id).n;
  const data = {
    committee: config.committeeName, longName: config.committeeLongName, association: config.associationName,
    numero, dossier, decision: scrutin.result, decisionFr: CHOICES[scrutin.result], decisionEn: CHOICES_EN[scrutin.result],
    procedure: scrutin.procedure, seance, scrutin, documents: JSON.parse(scrutin.documents_json),
    participants: r.voters.length, qualities: [...new Set(r.voters.map((v) => v.quality).filter(Boolean))],
    nConflicts, motivation: String(motivation).trim(), motivationEn: String(motivationEn || '').trim(),
    validityMonths: months, lieu: config.avisLieu, date: Date.now(),
    signataire: by.full_name, signataireFonction: by.fonction, irb: { iorg: config.irbIorg, irb: config.irbNumber },
    integrity: check, unanimous: r.unanimous, verifCode: verifCode(),
    parentReference: dossier.parent_id ? q().prepare('SELECT reference FROM dossiers WHERE id = ?').get(dossier.parent_id).reference : null,
  };
  const buffer = await pdf.avis(data);
  const acte = storeActe({
    type: 'avis', dossierId: dossier.id, scrutinId: scrutin.id, year: new Date().getFullYear(), title: `Avis ${numero}`,
    meta: { numero, decision: scrutin.result, validityMonths: months, motivation: data.motivation, motivationEn: data.motivationEn, verifCode: data.verifCode },
    buffer, originalName: `Avis-${numero.replace(/\//g, '-')}.pdf`, byId: by.id,
  });
  const status = CHOICE_TO_STATUS[scrutin.result];
  q().prepare('UPDATE dossiers SET status = ?, updated_at = ? WHERE id = ?').run(status, Date.now(), dossier.id);
  event(dossier.id, by.id, 'status', `Avis établi (${numero}) : ${CHOICES[scrutin.result]}`, status);
  return acte;
}

// ===================== Séances et procès-verbaux (art. 29.4) =====================
function createSeance({ date, mode, lieu }, by) {
  const d = Number(date);
  if (!d || Number.isNaN(d)) throw new RuleError('Date invalide');
  if (!['presentiel', 'visio', 'electronique'].includes(mode)) throw new RuleError('Mode invalide');
  const r = q().prepare('INSERT INTO seances (date, mode, lieu, created_by, created_at) VALUES (?,?,?,?,?)').run(d, mode, String(lieu || '').slice(0, 200), by.id, Date.now());
  return q().prepare('SELECT * FROM seances WHERE id = ?').get(r.lastInsertRowid);
}

function seanceData(seance) {
  const scrutins = q().prepare('SELECT * FROM scrutins WHERE seance_id = ? ORDER BY id').all(seance.id);
  const items = scrutins.map((sc) => {
    const d = q().prepare('SELECT * FROM dossiers WHERE id = ?').get(sc.dossier_id);
    const rapp = q().prepare(`SELECT u.full_name, u.quality FROM rapporteurs r JOIN users u ON u.id = r.user_id
      WHERE r.dossier_id = ? AND r.designated_at <= ? AND (r.ended_at IS NULL OR r.ended_at > ?)`).all(d.id, sc.opened_at, sc.opened_at);
    const deports = q().prepare('SELECT u.full_name, u.quality FROM conflicts c JOIN users u ON u.id = c.user_id WHERE c.dossier_id = ?').all(d.id);
    const res = sc.status === 'clos' ? computeResult(sc) : null;
    const check = sc.integrity_check_id ? q().prepare('SELECT * FROM integrity_checks WHERE id = ?').get(sc.integrity_check_id) : null;
    return { sc, dossier: d, rapporteurs: rapp, deports, res, check };
  });
  const participants = q().prepare(`SELECT DISTINCT u.full_name, u.quality, u.fonction FROM emargements e JOIN scrutins s ON s.id = e.scrutin_id
    JOIN users u ON u.id = e.user_id WHERE s.seance_id = ? ORDER BY u.full_name`).all(seance.id);
  // Avis rendus en procédure simplifiée depuis la séance précédente (art. 30.2 : information du comité)
  const prev = q().prepare('SELECT MAX(closed_at) t FROM seances WHERE closed_at IS NOT NULL AND id <> ?').get(seance.id).t || 0;
  const simplifiees = q().prepare(`SELECT s.*, d.reference FROM scrutins s JOIN dossiers d ON d.id = s.dossier_id
    WHERE s.procedure = 'simplifiee' AND s.status = 'clos' AND s.seance_id IS NULL AND s.closed_at > ? AND s.closed_at <= ?`).all(prev, Date.now());
  return { items, participants, simplifiees };
}

async function closeSeance(seance, by) {
  const pdf = require('./pdf');
  if (seance.closed_at) throw new RuleError('Séance déjà close');
  const open = q().prepare("SELECT COUNT(*) n FROM scrutins WHERE seance_id = ? AND status = 'ouvert'").get(seance.id).n;
  if (open) throw new RuleError(`${open} scrutin(s) encore ouvert(s) : clôturez-les d’abord`);
  const check = require('./domain').recordIntegrityCheck(by.id, `Clôture de la séance n° ${seance.id}`);
  if (!check.ok) throw new RuleError('Contrôle d’intégrité NON CONFORME : la séance ne peut pas être close.', { problems: check.problems });
  const data = seanceData(seance);
  q().prepare('UPDATE seances SET closed_at = ?, closed_by = ?, integrity_check_id = ? WHERE id = ?').run(Date.now(), by.id, check.checkId, seance.id);
  const code = verifCode();
  const buffer = await pdf.pv({ committee: config.committeeName, longName: config.committeeLongName, seance, ...data, closedBy: by, check, fonctions: FONCTIONS, choices: CHOICES, verifCode: code });
  const year = new Date(seance.date).getFullYear();
  const acte = storeActe({ type: 'pv', seanceId: seance.id, year, title: `Procès-verbal de la séance n° ${seance.id} du ${new Date(seance.date).toLocaleDateString('fr-FR')}`,
    buffer, originalName: `PV-seance-${seance.id}.pdf`, byId: by.id, meta: { checkId: check.checkId, lastHash: check.lastHash, verifCode: code } });
  return { acte, check };
}

// ===================== Rapport annuel (art. 34.2) =====================
function annualStats(year) {
  const from = new Date(year, 0, 1).getTime(); const to = new Date(year + 1, 0, 1).getTime();
  const deposes = q().prepare('SELECT COUNT(*) n FROM dossiers WHERE created_at >= ? AND created_at < ?').get(from, to).n;
  const appels = q().prepare("SELECT COUNT(*) n FROM dossiers WHERE kind = 'appel' AND created_at >= ? AND created_at < ?").get(from, to).n;
  const avis = q().prepare("SELECT a.*, s.procedure FROM actes a LEFT JOIN scrutins s ON s.id = a.scrutin_id WHERE a.type = 'avis' AND a.parent_id IS NULL AND a.created_at >= ? AND a.created_at < ?").all(from, to);
  const byCategory = Object.fromEntries(Object.keys(CHOICE_TO_STATUS).map((k) => [k, 0]));
  let simplifiees = 0;
  const delays = []; let sansRecevabilite = 0;
  for (const a of avis) {
    const m = JSON.parse(a.meta_json);
    byCategory[m.decision] = (byCategory[m.decision] || 0) + 1;
    if (a.procedure === 'simplifiee') simplifiees++;
    const evs = q().prepare("SELECT at, value FROM dossier_events WHERE dossier_id = ? AND type = 'status' AND at <= ? ORDER BY id").all(a.dossier_id, a.created_at);
    const rec = evs.find((e) => e.value === 'recevable');
    if (!rec) { sansRecevabilite++; continue; }
    // Délai hors suspension (art. 31.2 et 28.2) : périodes au statut « questions au porteur » retranchées
    let suspended = 0; let qStart = null;
    for (const e of evs.filter((x) => x.at >= rec.at)) {
      if (e.value === 'questions' && qStart === null) qStart = e.at;
      else if (e.value !== 'questions' && qStart !== null) { suspended += e.at - qStart; qStart = null; }
    }
    if (qStart !== null) suspended += a.created_at - qStart;
    delays.push((a.created_at - rec.at - suspended) / 864e5);
  }
  delays.sort((x, y) => x - y);
  const mean = delays.length ? delays.reduce((s, x) => s + x, 0) / delays.length : null;
  const median = delays.length ? (delays.length % 2 ? delays[(delays.length - 1) / 2] : (delays[delays.length / 2 - 1] + delays[delays.length / 2]) / 2) : null;
  const seancesN = q().prepare('SELECT COUNT(*) n FROM seances WHERE closed_at IS NOT NULL AND date >= ? AND date < ?').get(from, to).n;
  const deports = q().prepare('SELECT COUNT(*) n FROM conflicts WHERE declared_at >= ? AND declared_at < ?').get(from, to).n;
  const checks = q().prepare('SELECT COUNT(*) n, SUM(ok) ok FROM integrity_checks WHERE at >= ? AND at < ?').get(from, to);
  const composition = q().prepare("SELECT fonction, COUNT(*) n FROM users WHERE status = 'actif' GROUP BY fonction").all();
  return {
    year, deposes, appels, avis: avis.length, byCategory, simplifiees, ordinaires: avis.length - simplifiees,
    delays: { n: delays.length, mean, median, max: delays.length ? delays[delays.length - 1] : null, withinLimit: delays.filter((d) => d <= config.avisDelayDays).length, limitDays: config.avisDelayDays, sansRecevabilite },
    seances: seancesN, deports, integrityChecks: { total: checks.n, conformes: checks.ok || 0 },
    composition: Object.fromEntries(composition.map((c) => [c.fonction, c.n])),
  };
}

async function generateAnnualReport(year, by) {
  const pdf = require('./pdf');
  const stats = annualStats(year);
  const code = verifCode();
  const buffer = await pdf.rapport({ committee: config.committeeName, longName: config.committeeLongName, association: config.associationName, stats, choices: CHOICES, fonctions: FONCTIONS, by, date: Date.now(), verifCode: code });
  return storeActe({ type: 'rapport_annuel', year, title: `Rapport d’activité ${year}`, meta: { ...stats, verifCode: code }, buffer, originalName: `Rapport-activite-${config.committeeName}-${year}.pdf`, byId: by.id });
}

// ===================== Clôture et archivage du dossier =====================
/**
 * Clôt la procédure : exige un avis dont l'exemplaire signé a été versé,
 * aucun vote ouvert et un contrôle d'intégrité conforme ; produit le relevé
 * de clôture (documents, échanges, votes, actes, empreintes) ; le dossier
 * passe ensuite en lecture seule définitive.
 */
async function closeDossier(dossier, by) {
  const pdf = require('./pdf');
  assertOpen(dossier);
  if (openScrutinOf(dossier.id)) throw new RuleError('Un vote est encore ouvert sur ce dossier');
  const avis = q().prepare("SELECT * FROM actes WHERE type = 'avis' AND dossier_id = ? AND parent_id IS NULL ORDER BY id DESC").get(dossier.id);
  if (!avis) throw new RuleError('Aucun avis n’a été établi pour ce dossier');
  if (!signedVersionOf(avis.id)) throw new RuleError('Versez d’abord l’exemplaire signé de l’avis');
  const check = require('./domain').recordIntegrityCheck(by.id, `Clôture du dossier ${dossier.reference}`);
  if (!check.ok) throw new RuleError('Contrôle d’intégrité NON CONFORME : le dossier ne peut pas être clos.', { problems: check.problems });
  const now = Date.now();
  q().prepare("UPDATE dossiers SET closed_at = ?, closed_by = ?, updated_at = ? WHERE id = ?").run(now, by.id, now, dossier.id);
  const data = {
    committee: config.committeeName, longName: config.committeeLongName, dossier, by, date: now, check, choices: CHOICES,
    documents: q().prepare('SELECT * FROM documents WHERE dossier_id = ? ORDER BY id').all(dossier.id),
    comments: q().prepare('SELECT * FROM comments WHERE dossier_id = ? ORDER BY id').all(dossier.id),
    events: q().prepare('SELECT e.*, u.full_name FROM dossier_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.dossier_id = ? ORDER BY e.id').all(dossier.id),
    conflicts: q().prepare('SELECT u.full_name, c.declared_at FROM conflicts c JOIN users u ON u.id = c.user_id WHERE c.dossier_id = ?').all(dossier.id),
    rapporteurs: q().prepare('SELECT r.*, u.full_name FROM rapporteurs r JOIN users u ON u.id = r.user_id WHERE r.dossier_id = ? ORDER BY r.id').all(dossier.id),
    scrutins: q().prepare('SELECT * FROM scrutins WHERE dossier_id = ? ORDER BY id').all(dossier.id).map((sc) => ({ sc, res: sc.status === 'clos' ? computeResult(sc) : null })),
    actes: q().prepare('SELECT * FROM actes WHERE dossier_id = ? ORDER BY id').all(dossier.id),
  };
  const buffer = await pdf.cloture(data);
  const acte = storeActe({ type: 'cloture', dossierId: dossier.id, year: new Date(now).getFullYear(), title: `Relevé de clôture et d’archivage — ${dossier.reference}`,
    meta: { checkId: check.checkId, lastHash: check.lastHash }, buffer, originalName: `Cloture-${dossier.reference}.pdf`, byId: by.id });
  q().prepare("UPDATE dossiers SET status = 'clos' WHERE id = ?").run(dossier.id);
  event(dossier.id, by.id, 'status', `Procédure close et dossier archivé (contrôle d’intégrité n° ${check.checkId} conforme)`, 'clos');
  return { acte, check };
}

// ===================== Courriel au porteur =====================
function mailDraft(acte, by) {
  const d = q().prepare('SELECT * FROM dossiers WHERE id = ?').get(acte.dossier_id);
  const signedV = signedVersionOf(acte.id);
  const meta = JSON.parse(acte.meta_json || '{}');
  return {
    from: config.smtp.from, replyTo: config.smtp.replyTo || null, to: d.applicant_email,
    subject: `Avis du ${config.committeeName} — ${meta.numero || d.reference}`,
    body: `Madame, Monsieur,\n\nVeuillez trouver ci-joint l'avis du ${config.committeeLongName} (${config.committeeName}) sur votre demande « ${d.title} », enregistrée sous la référence ${d.reference}.\n\nDécision : ${CHOICES[meta.decision] || ''}.\n\nCet avis ne vaut pas avis d'un comité de protection des personnes au sens de l'article L.1123-6 du code de la santé publique et ne dispense d'aucune formalité auprès de la CNIL.\n\nToute modification substantielle du projet doit être soumise au comité avant sa mise en œuvre.\n\nVeuillez agréer, Madame, Monsieur, l'expression de nos salutations distinguées.\n\n${by.full_name}\n${by.fonction === 'vice_president' ? 'Vice-président' : 'Président'} du ${config.committeeName}`,
    attachment: signedV ? { id: signedV.id, name: signedV.original_name, sha256: signedV.sha256, signature: JSON.parse(signedV.meta_json).signature } : null,
  };
}

async function sendAvis(acte, by, { subject, body }) {
  if (acte.type !== 'avis' || acte.parent_id) throw new RuleError('Seul un avis est adressé au porteur');
  const signedV = signedVersionOf(acte.id);
  if (!signedV) throw new RuleError('Versez d’abord l’exemplaire signé de l’avis : seul l’avis signé est adressé au porteur.');
  const subj = String(subject || '').trim().slice(0, 300); const text = String(body || '').trim().slice(0, 20000);
  if (!subj || !text) throw new RuleError('Objet et message obligatoires');
  const d = q().prepare('SELECT * FROM dossiers WHERE id = ?').get(acte.dossier_id);
  const content = readActe(signedV);
  await require('./mailer').send({
    to: d.applicant_email, subject: subj, text, rawSubject: true, throwOnError: true,
    attachments: [{ filename: signedV.original_name, content, contentType: acteMime(signedV) }],
  });
  const now = Date.now();
  q().prepare(`INSERT INTO envois (acte_id, dossier_id, from_email, to_email, subject, body, attachment_name, attachment_sha256, sent_by, sent_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(signedV.id, d.id, config.smtp.from, d.applicant_email, subj, text, signedV.original_name, signedV.sha256, by.id, now);
  q().prepare('UPDATE actes SET sent_at = ? WHERE id = ?').run(now, signedV.id);
  event(d.id, by.id, 'transmission', `Avis signé adressé au porteur (${d.applicant_email}) sur décision de ${by.full_name}`);
  return { to: d.applicant_email, at: now };
}

module.exports = {
  verifyVotes, attachHandwritten, closeDossier, mailDraft, sendAvis, assertOpen, signedVersionOf, acteMime,
  FONCTIONS, VOTING, CHOICES, CHOICES_EN, CHOICE_TO_STATUS, RuleError,
  isAdmin, canManageDossiers, seats, activeRapporteurs, isRapporteur, designateRapporteur, endRapporteur,
  openScrutinOf, openScrutin, castVote, tallyOf, computeResult, closeScrutin, cancelScrutin, requestPlenary, scrutinView,
  storeActe, readActe, attachSigned, acteView, generateAvis, createSeance, seanceData, closeSeance, annualStats, generateAnnualReport, event,
};
