'use strict';
/**
 * Destruction des dossiers en fin de conservation (règlement intérieur,
 * art. 34.3 et 45.2).
 *
 *  - Durée : fin du projet + [10] ans. Sans date de fin de projet renseignée,
 *    aucune destruction n'est possible.
 *  - Un dossier initial et son appel forment une « famille » détruite d'un
 *    seul tenant (l'appel contient des copies du dossier initial).
 *  - Procédure : proposition du président → avis du délégué à la protection
 *    des données (dans l'outil, signé par double authentification, ou
 *    document versé par le président) → décision du président, signée par
 *    double authentification → exécution.
 *  - Exécution : contrôle d'intégrité, certificat de destruction (sans
 *    donnée personnelle), suppression des enregistrements et des fichiers,
 *    anonymisation de la fiche du dossier, conservation facultative des avis
 *    signés (archives de l'association). Les procès-verbaux de séance, qui
 *    portent sur plusieurs dossiers, sont conservés au titre des archives.
 *    Les commentaires détruits laissent
 *    une trace (empreinte seule) qui maintient la vérifiabilité de la chaîne.
 * La base n'autorise ces suppressions que pendant une destruction en cours
 * d'exécution, décidée et consignée (déclencheurs SQL).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const config = require('./config');

const q = () => db.get();
class RuleError extends Error { constructor(m) { super(m); this.status = 400; } }

function addYears(ms, n) {
  const d = new Date(ms); const day = d.getDate();
  d.setFullYear(d.getFullYear() + n);
  if (d.getDate() < day) d.setDate(0);
  return d.getTime();
}

/** Dossier initial et appel(s) liés. */
function family(d) {
  const root = d.parent_id ? q().prepare('SELECT * FROM dossiers WHERE id = ?').get(d.parent_id) : d;
  const children = q().prepare('SELECT * FROM dossiers WHERE parent_id = ? ORDER BY id').all(root.id);
  return [root, ...children];
}

/** Échéance de conservation de la famille (la plus tardive). */
function retentionOf(d) {
  const fam = family(d);
  const missing = fam.filter((x) => !x.project_end_at).map((x) => x.reference);
  const notClosed = fam.filter((x) => !x.closed_at && !x.destroyed_at).map((x) => x.reference);
  const until = missing.length ? null : Math.max(...fam.map((x) => addYears(x.project_end_at, config.retentionYears)));
  return { family: fam, until, missing, notClosed, root: fam[0] };
}

const openProcedure = (rootId) => q().prepare("SELECT * FROM destructions WHERE dossier_id = ? AND status IN ('attente_dpd','avis_dpd_rendu') ORDER BY id DESC").get(rootId);

function viewFor(d) {
  const r = retentionOf(d);
  const proc = q().prepare('SELECT * FROM destructions WHERE dossier_id = ? ORDER BY id DESC').get(r.root.id) || null;
  return {
    projectEnd: d.project_end_at, until: r.until, missing: r.missing, notClosed: r.notClosed, rootId: r.root.id,
    due: !!(r.until && r.until <= Date.now()), destroyed: d.destroyed_at || null, years: config.retentionYears,
    procedure: proc ? { ...proc, family: undefined, counts: proc.counts_json ? JSON.parse(proc.counts_json) : null } : null,
  };
}

/** Date de fin du projet (modifiable même après la clôture : le rapport final arrive après l'avis, art. 32.4). */
function setProjectEnd(d, by, date) {
  if (d.destroyed_at) throw new RuleError('Dossier détruit');
  const at = Number(date);
  if (!at || Number.isNaN(at)) throw new RuleError('Date invalide');
  if (at < d.created_at - 20 * 365 * 864e5) throw new RuleError('Date invalide');
  if (openProcedure(family(d)[0].id)) throw new RuleError('Une procédure de destruction est en cours : abandonnez-la avant de modifier la date');
  q().prepare('UPDATE dossiers SET project_end_at = ? WHERE id = ?').run(at, d.id);
  q().prepare('INSERT INTO dossier_events (dossier_id, at, user_id, type, details) VALUES (?,?,?,?,?)')
    .run(d.id, Date.now(), by.id, 'conservation', `Fin du projet renseignée : ${new Date(at).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })}`);
}

/** Dossiers arrivés à échéance, ou proches de l'échéance, ou sans date de fin de projet. */
function echeances() {
  const rows = q().prepare('SELECT * FROM dossiers WHERE closed_at IS NOT NULL AND destroyed_at IS NULL AND parent_id IS NULL ORDER BY id').all();
  const soon = Date.now() + config.retentionNoticeDays * 864e5;
  return rows.map((d) => ({ d, r: retentionOf(d) }))
    .filter(({ r }) => !r.until || r.until <= soon)
    .map(({ d, r }) => ({ id: d.id, reference: d.reference, closed_at: d.closed_at, until: r.until, missing: r.missing, notClosed: r.notClosed,
      due: !!(r.until && r.until <= Date.now()), procedure: openProcedure(d.id) || null, family: r.family.map((x) => x.reference) }));
}

function propose(d, by) {
  const r = retentionOf(d);
  if (r.root.destroyed_at) throw new RuleError('Dossier déjà détruit');
  if (r.missing.length) throw new RuleError(`Renseignez d’abord la date de fin du projet : ${r.missing.join(', ')}`);
  if (r.notClosed.length) throw new RuleError(`Dossier non clos : ${r.notClosed.join(', ')}`);
  if (r.until > Date.now()) throw new RuleError(`La durée de conservation court jusqu’au ${new Date(r.until).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })}`);
  if (openProcedure(r.root.id)) throw new RuleError('Une procédure de destruction est déjà en cours');
  const famStr = `,${r.family.map((x) => x.id).join(',')},`;
  const id = q().prepare(`INSERT INTO destructions (dossier_id, family, status, retention_until, proposed_by, proposed_at)
    VALUES (?,?, 'attente_dpd', ?, ?, ?)`).run(r.root.id, famStr, r.until, by.id, Date.now()).lastInsertRowid;
  for (const x of r.family) {
    q().prepare('INSERT INTO dossier_events (dossier_id, at, user_id, type, details) VALUES (?,?,?,?,?)')
      .run(x.id, Date.now(), by.id, 'conservation', `Destruction proposée (fin de conservation) — avis du délégué à la protection des données demandé`);
  }
  const dpds = q().prepare("SELECT * FROM users WHERE dpd = 1 AND status = 'actif'").all();
  const mailer = require('./mailer');
  for (const u of dpds) {
    q().prepare('INSERT INTO notifications (user_id, type, dossier_id, message, created_at) VALUES (?,?,?,?,?)')
      .run(u.id, 'destruction', r.root.id, `Avis demandé : destruction du dossier ${r.root.reference}`, Date.now());
    mailer.send({ to: u.email, subject: `Avis du DPD demandé — destruction ${r.root.reference}`,
      text: `Bonjour ${u.full_name},\n\nLe président du ${config.committeeName} propose la destruction, en fin de conservation, du dossier ${r.root.reference}${r.family.length > 1 ? ` et de son appel` : ''} (art. 45.2). Votre avis est requis.\n${config.publicUrl}/#/admin/conservation\n` });
  }
  return { id, dpds: dpds.length };
}

const getProc = (id) => q().prepare('SELECT * FROM destructions WHERE id = ?').get(id);

/** Avis du DPD rendu dans l'outil (la route a vérifié le second facteur). */
function dpdOpinion(proc, user, { opinion, motivation }) {
  if (!user.dpd) throw new RuleError('Réservé au délégué à la protection des données');
  return recordOpinion(proc, user, opinion, motivation, 'outil', null);
}

/** Avis du DPD remis par écrit, versé par le président. */
async function dpdDocument(proc, by, { opinion, motivation, file, dpdName }) {
  if (!file) throw new RuleError('Joignez l’avis écrit du délégué à la protection des données');
  const err = require('./domain').checkFile(file);
  if (err) throw new RuleError(err);
  if (!String(dpdName || '').trim()) throw new RuleError('Indiquez le nom du délégué à la protection des données');
  const gov = require('./governance');
  const acte = gov.storeActe({ type: 'avis_dpd', year: new Date().getFullYear(), title: `Avis du DPD — destruction du dossier ${q().prepare('SELECT reference FROM dossiers WHERE id = ?').get(proc.dossier_id).reference}`,
    meta: { destructionId: proc.id }, buffer: file.buffer, originalName: `avis-dpd-destruction-${proc.id}${path.extname(file.originalname).toLowerCase()}`, byId: by.id });
  return recordOpinion(proc, { id: by.id, full_name: String(dpdName).trim() }, opinion, motivation, 'document', acte.id);
}

function recordOpinion(proc, who, opinion, motivation, method, acteId) {
  if (!['attente_dpd', 'avis_dpd_rendu'].includes(proc.status)) throw new RuleError('Procédure close');
  if (proc.dpd_opinion) throw new RuleError('L’avis du DPD est déjà enregistré');
  if (!['favorable', 'defavorable'].includes(opinion)) throw new RuleError('Avis invalide');
  if (opinion === 'defavorable' && String(motivation || '').trim().length < 10) throw new RuleError('Motivez l’avis défavorable');
  q().prepare(`UPDATE destructions SET status = 'avis_dpd_rendu', dpd_opinion = ?, dpd_motivation = ?, dpd_by = ?, dpd_name = ?, dpd_method = ?, dpd_at = ?, dpd_acte_id = ? WHERE id = ?`)
    .run(opinion, String(motivation || '').trim().slice(0, 2000), who.id, who.full_name, method, Date.now(), acteId, proc.id);
  return getProc(proc.id);
}

function abandon(proc, by, reason) {
  if (!['attente_dpd', 'avis_dpd_rendu'].includes(proc.status)) throw new RuleError('Procédure close');
  if (String(reason || '').trim().length < 5) throw new RuleError('Motif requis');
  q().prepare("UPDATE destructions SET status = 'abandonnee', abandon_reason = ?, decided_by = ?, decided_at = ? WHERE id = ?").run(String(reason).trim(), by.id, Date.now(), proc.id);
  q().prepare('INSERT INTO dossier_events (dossier_id, at, user_id, type, details) VALUES (?,?,?,?,?)').run(proc.dossier_id, Date.now(), by.id, 'conservation', `Destruction abandonnée : ${String(reason).trim()}`);
}

function shred(file) {
  try {
    const size = fs.statSync(file).size;
    const fd = fs.openSync(file, 'r+');
    fs.writeSync(fd, crypto.randomBytes(Math.min(size, 64 * 1024 * 1024)), 0, Math.min(size, 64 * 1024 * 1024), 0);
    fs.fsyncSync(fd); fs.closeSync(fd);
    fs.unlinkSync(file);
    return true;
  } catch { return false; }
}

/** Décision du président (la route a vérifié le second facteur) et exécution. */
async function decideAndExecute(proc, by, { keepAvis = true, note = '' }) {
  if (!['president', 'vice_president'].includes(by.fonction) || by.role !== 'admin') throw new RuleError('Décision réservée au président du comité');
  if (proc.status !== 'avis_dpd_rendu') throw new RuleError('L’avis du délégué à la protection des données est requis avant la décision');
  if (proc.dpd_opinion === 'defavorable' && String(note).trim().length < 20) throw new RuleError('L’avis du DPD est défavorable : motivez votre décision de passer outre');
  const fam = q().prepare('SELECT * FROM dossiers WHERE instr(?, \',\' || id || \',\') > 0 ORDER BY id').all(proc.family);
  const r = retentionOf(fam[0]);
  if (!r.until || r.until > Date.now()) throw new RuleError('La durée de conservation n’est pas expirée');
  const check = require('./domain').recordIntegrityCheck(by.id, `Destruction du dossier ${fam[0].reference}`);
  if (!check.ok) throw new RuleError('Contrôle d’intégrité NON CONFORME : destruction suspendue. Prévenez le référent technique.');

  // ----- Inventaire (sans contenu ni donnée personnelle) -----
  const ids = fam.map((x) => x.id);
  const inList = `(${ids.map(() => '?').join(',')})`;
  const docs = q().prepare(`SELECT id, dossier_id, sha256, storage_name, piece, version FROM documents WHERE dossier_id IN ${inList}`).all(...ids);
  const comments = q().prepare(`SELECT * FROM comments WHERE dossier_id IN ${inList} ORDER BY id`).all(...ids);
  const scrutins = q().prepare(`SELECT id FROM scrutins WHERE dossier_id IN ${inList}`).all(...ids).map((s) => s.id);
  const ballots = scrutins.length ? q().prepare(`SELECT COUNT(*) n FROM bulletins WHERE scrutin_id IN (${scrutins.map(() => '?').join(',')})`).get(...scrutins).n : 0;
  const actes = q().prepare(`SELECT * FROM actes WHERE dossier_id IN ${inList}`).all(...ids);
  const keptActes = actes.filter((a) => keepAvis && a.type === 'avis');
  // Procès-verbaux des séances où la famille a été examinée : conservés au titre des archives (art. 45.2)
  const keptPV = scrutins.length ? q().prepare(`SELECT DISTINCT a.id, a.title, a.sha256 FROM actes a JOIN scrutins s ON s.seance_id = a.seance_id
    WHERE a.type = 'pv' AND s.id IN (${scrutins.map(() => '?').join(',')}) ORDER BY a.id`).all(...scrutins) : [];
  const delActes = actes.filter((a) => !keptActes.includes(a));
  const counts = {
    dossiers: fam.map((x) => x.reference), documents: docs.length, comments: comments.length, votes: scrutins.length, ballots,
    actes: delActes.length, keptAvis: keptActes.map((a) => ({ title: a.title, sha256: a.sha256 })),
    keptPV: keptPV.map((a) => ({ title: a.title, sha256: a.sha256 })),
    envois: q().prepare(`SELECT COUNT(*) n FROM envois WHERE dossier_id IN ${inList}`).get(...ids).n,
  };
  const pdf = require('./pdf');
  const gov = require('./governance');
  const now = Date.now();
  const certBuf = await pdf.certificatDestruction({
    committee: config.committeeName, longName: config.committeeLongName, proc, fam, counts, by, date: now, check,
    retentionYears: config.retentionYears, docs, comments: comments.map((c) => ({ id: c.id, hash: c.hash })), delActes,
  });

  // ----- Suppression, dans une transaction autorisée -----
  const files = [...docs.map((d) => d.storage_name), ...delActes.map((a) => a.storage_name)];
  q().transaction(() => {
    q().prepare("UPDATE destructions SET status = 'execution', decided_by = ?, decided_at = ?, decision_note = ?, keep_avis = ? WHERE id = ?")
      .run(by.id, now, String(note).trim().slice(0, 2000), keepAvis ? 1 : 0, proc.id);
    const tomb = q().prepare('INSERT INTO comment_tombstones (comment_id, dossier_id, prev_hash, hash, signature, destruction_id, destroyed_at) VALUES (?,?,?,?,?,?,?)');
    for (const c of comments) tomb.run(c.id, c.dossier_id, c.prev_hash, c.hash, c.signature, proc.id, now);
    const del = (sql, ...args) => q().prepare(sql).run(...args);
    // Ordre imposé par les clés étrangères
    del(`DELETE FROM reads WHERE dossier_id IN ${inList}`, ...ids);
    del(`DELETE FROM notifications WHERE dossier_id IN ${inList}`, ...ids);
    for (const a of keptActes) del('UPDATE actes SET scrutin_id = NULL WHERE id = ?', a.id);
    if (scrutins.length) {
      const sl = `(${scrutins.map(() => '?').join(',')})`;
      del(`DELETE FROM bulletins WHERE scrutin_id IN ${sl}`, ...scrutins);
      del(`DELETE FROM emargements WHERE scrutin_id IN ${sl}`, ...scrutins);
      del(`DELETE FROM scrutin_electeurs WHERE scrutin_id IN ${sl}`, ...scrutins);
    }
    del(`DELETE FROM receptions WHERE dossier_id IN ${inList}`, ...ids);
    del(`DELETE FROM envois WHERE dossier_id IN ${inList}`, ...ids);
    del(`DELETE FROM comments WHERE dossier_id IN ${inList}`, ...ids);
    for (const a of [...delActes].sort((x, y) => (y.parent_id ? 1 : 0) - (x.parent_id ? 1 : 0))) del('DELETE FROM actes WHERE id = ?', a.id);
    del(`DELETE FROM documents WHERE dossier_id IN ${inList}`, ...ids);
    del(`DELETE FROM scrutins WHERE dossier_id IN ${inList}`, ...ids);
    del(`DELETE FROM rapporteurs WHERE dossier_id IN ${inList}`, ...ids);
    del(`DELETE FROM conflicts WHERE dossier_id IN ${inList}`, ...ids);
    del(`DELETE FROM dossier_events WHERE dossier_id IN ${inList}`, ...ids);
    del(`UPDATE dossiers SET title = '[Dossier détruit]', applicant_name = '[détruit]', applicant_email = '', applicant_affiliation = '', investigator = '',
      qualification_reason = '', summary = '', funding = '', appeal_requester = NULL, appeal_requester_email = NULL, appeal_reason = NULL,
      status = 'detruit', destroyed_at = ?, updated_at = ? WHERE id IN ${inList}`, now, now, ...ids);
  })();

  const cert = gov.storeActe({ type: 'certificat_destruction', dossierId: fam[0].id, year: new Date(now).getFullYear(),
    title: `Certificat de destruction — ${fam.map((x) => x.reference).join(' et ')}`, meta: { destructionId: proc.id, checkId: check.checkId },
    buffer: certBuf, originalName: `Certificat-destruction-${fam[0].reference}.pdf`, byId: by.id });
  q().prepare("UPDATE destructions SET status = 'executee', executed_at = ?, certificate_acte_id = ?, counts_json = ? WHERE id = ?")
    .run(Date.now(), cert.id, JSON.stringify(counts), proc.id);
  for (const x of fam) {
    q().prepare('INSERT INTO dossier_events (dossier_id, at, user_id, type, value, details) VALUES (?,?,?,?,?,?)')
      .run(x.id, now, by.id, 'status', 'detruit', `Dossier détruit en fin de conservation (avis du DPD : ${proc.dpd_opinion}). Certificat de destruction conservé.`);
  }
  // Effacement des fichiers (contenu déjà chiffré), puis purge du journal d'écriture SQLite
  let shredded = 0;
  for (const f of files) if (shred(path.join(config.filesDir, f))) shredded++;
  q().pragma('wal_checkpoint(TRUNCATE)');
  return { certificate: cert, counts, shredded };
}

module.exports = { family, retentionOf, viewFor, setProjectEnd, echeances, propose, getProc, dpdOpinion, dpdDocument, abandon, decideAndExecute, RuleError, addYears };
