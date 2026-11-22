'use strict';
/**
 * Production des actes en PDF : avis (annexe 7, français et anglais),
 * procès-verbaux de séance (art. 29.4), rapport annuel d'activité (art. 34.2).
 * Les PDF produits peuvent ensuite être signés (signature électronique
 * qualifiée PAdES) avec un logiciel de signature, puis redéposés.
 */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const LOGO = path.join(__dirname, '..', '..', 'client', 'icons', 'icon-192.png');
const NAVY = '#03213a'; const BLUE = '#0a6aa8'; const GREY = '#55606b';
const FN = { president: 'Le président', vice_president: 'Pour le président empêché, le vice-président' };
const FN_EN = { president: 'Chair', vice_president: 'Vice-Chair, for the Chair' };

const dFr = (ms, time = false) => new Intl.DateTimeFormat('fr-FR', time ? { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Paris' } : { dateStyle: 'long', timeZone: 'Europe/Paris' }).format(new Date(ms));
const dEn = (ms) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'Europe/Paris' }).format(new Date(ms));
const modeFr = { presentiel: 'en présentiel', visio: 'par visioconférence', electronique: 'par voie électronique' };
const modeEn = { presentiel: 'in person', visio: 'by videoconference', electronique: 'by electronic means' };
const PIECE = (p) => (p === 'autre' ? 'autre' : `pièce ${p})`);

function make(title, subject) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 64, left: 62, right: 62 }, bufferPages: true,
    info: { Title: title, Subject: subject, Author: 'CER-PROMEDNAV', Creator: 'LeSacAEthique', Producer: 'LeSacAEthique' } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  return { doc, done };
}

function header(doc, committee, longName, label) {
  if (fs.existsSync(LOGO)) doc.image(LOGO, doc.page.margins.left, 44, { width: 46 });
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(12).text(committee, 118, 50);
  doc.fillColor(GREY).font('Helvetica').fontSize(8.5).text(longName, 118, 66);
  if (label) doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(8.5).text(label, 118, 78);
  doc.moveTo(doc.page.margins.left, 102).lineTo(doc.page.width - doc.page.margins.right, 102).strokeColor('#d6e0e7').lineWidth(1).stroke();
  doc.x = doc.page.margins.left; doc.y = 118; doc.fillColor('#111');
}

function footer(doc, text) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom; doc.page.margins.bottom = 0;
    doc.fillColor(GREY).font('Helvetica').fontSize(7.5)
      .text(`${text} — page ${i + 1}/${range.count}`, doc.page.margins.left, doc.page.height - 40, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: 'center' });
    doc.page.margins.bottom = bottom;
  }
}

const h = (doc, t, size = 13) => { doc.moveDown(0.6).fillColor(NAVY).font('Helvetica-Bold').fontSize(size).text(t).moveDown(0.3).fillColor('#111').font('Helvetica').fontSize(10.5); };
const p = (doc, t, opt = {}) => doc.font(opt.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opt.size || 10.5).fillColor(opt.color || '#111').text(t, { align: opt.align || 'justify', lineGap: 2 }).moveDown(opt.gap ?? 0.5);
const small = (doc, t) => p(doc, t, { size: 8, color: GREY, align: 'left' });
const bullet = (doc, items, size = 9.5) => { doc.font('Helvetica').fontSize(size).fillColor('#111'); doc.list(items, { bulletRadius: 1.6, textIndent: 12, lineGap: 1.5 }); doc.moveDown(0.5); };

function signatureBlock(doc, lines) {
  doc.moveDown(1);
  if (doc.y > doc.page.height - 200) doc.addPage();
  const x = doc.page.width / 2; const w = doc.page.width / 2 - doc.page.margins.right;
  for (const l of lines) doc.font(l.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor('#111').text(l.t, x, doc.y, { width: w });
  doc.rect(x, doc.y + 6, w, 58).dash(3, { space: 3 }).strokeColor('#9aa7b2').stroke().undash();
  doc.fillColor(GREY).fontSize(7.5).text('Signature', x + 6, doc.y + 10, { width: w - 12 });
  doc.x = doc.page.margins.left; doc.y += 64; doc.fillColor('#111');
}

function codeLine(doc, code) {
  if (!code) return;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(NAVY).text(`Code de vérification : ${code}`, { align: 'right' });
  doc.font('Helvetica').fontSize(7.5).fillColor(GREY).text('À recopier lors du versement de l’exemplaire signé dans LeSacAEthique / Verification code', { align: 'right' }).moveDown(0.5);
  doc.fillColor('#111');
}

// ===================== AVIS (annexe 7) =====================
async function avis(d) {
  const { doc, done } = make(`Avis ${d.numero}`, `Avis du ${d.committee}`);
  const meeting = d.seance
    ? `réuni le ${dFr(d.seance.date)} ${modeFr[d.seance.mode]}${d.seance.lieu ? ` (${d.seance.lieu})` : ''}`
    : `en procédure ${d.procedure === 'simplifiee' ? 'simplifiée (art. 30 du règlement intérieur)' : 'par voie électronique'}, le ${dFr(d.scrutin.closed_at)}`;
  const meetingEn = d.seance
    ? `met on ${dEn(d.seance.date)} ${modeEn[d.seance.mode]}`
    : `${d.procedure === 'simplifiee' ? 'under its expedited review procedure' : 'by electronic means'} on ${dEn(d.scrutin.closed_at)}`;

  header(doc, d.committee, d.longName, `AVIS ${d.numero}`);
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(16).text('Avis du comité d’éthique de la recherche', { align: 'center' }).moveDown(0.2);
  doc.fillColor(GREY).font('Helvetica').fontSize(10).text(`Référence : ${d.numero} — ${dFr(d.date)}`, { align: 'center' }).moveDown(1);

  if (d.dossier.kind === 'appel') p(doc, `Avis rendu en appel de l’avis du dossier ${d.parentReference}, sur la demande ${d.dossier.appeal_role === 'president_association' ? 'du président de l’association' : 'du porteur'}.`, { bold: true });
  p(doc, `Le ${d.longName} (${d.committee}), ${meeting}, a examiné le projet intitulé « ${d.dossier.title} », présenté par ${d.dossier.applicant_name}${d.dossier.applicant_affiliation ? ` (${d.dossier.applicant_affiliation})` : ''} (dossier ${d.dossier.reference}), sur la base des documents suivants :`);
  bullet(doc, d.documents.map((x) => `${x.original_name} — version ${x.version} — ${PIECE(x.piece)} — empreinte SHA-256 ${x.sha256.slice(0, 16)}…`), 8.5);
  if (d.procedure === 'simplifiee') {
    p(doc, `L’avis a été rendu en procédure simplifiée par le président (ou le vice-président) et un rapporteur ; le comité en est informé à sa séance suivante.`);
  } else {
    p(doc, `Le comité a délibéré en présence de ${d.participants} membres votants${d.qualities.length ? `, dont : ${d.qualities.join(' ; ')}` : ''}. ${d.nConflicts ? (d.nConflicts > 1 ? `${d.nConflicts} membres en conflit d’intérêts se sont déportés.` : 'Un membre en conflit d’intérêts s’est déporté.') : 'Aucun membre ne s’est déclaré en conflit d’intérêts.'}`);
  }
  doc.moveDown(0.3);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY).text(`Le comité rend un avis : ${d.decisionFr.toUpperCase()}.`).moveDown(0.5);
  p(doc, 'Motivation :', { bold: true, gap: 0.2 });
  p(doc, d.motivation);
  if (['favorable', 'favorable_reserve'].includes(d.decision)) {
    p(doc, `Cet avis vaut pour la durée du projet indiquée au dossier, dans la limite de ${d.validityMonths} mois, renouvelable sur demande (art. 31.4). Toute modification substantielle doit être soumise au comité avant sa mise en œuvre (art. 32.1).${d.decision === 'favorable_reserve' ? ' Les réponses aux réserves seront vérifiées par un rapporteur.' : ''}`);
  }
  if (d.decision === 'incompetence') p(doc, 'Le comité estime que le projet relève d’une recherche impliquant la personne humaine et invite le porteur à saisir un comité de protection des personnes (art. 24.3).');
  p(doc, 'Le comité rappelle que le présent avis ne vaut pas avis d’un comité de protection des personnes au sens de l’article L.1123-6 du code de la santé publique et ne dispense d’aucune formalité auprès de la CNIL.', { size: 9.5 });
  if (d.irb.iorg || d.irb.irb) small(doc, `Enregistrement OHRP : ${d.irb.iorg ? 'IORG ' + d.irb.iorg : ''} ${d.irb.irb ? 'IRB ' + d.irb.irb : ''}`);
  signatureBlock(doc, [{ t: `Fait à ${d.lieu}, le ${dFr(d.date)}.` }, { t: `${FN[d.signataireFonction] || 'Le président'} du ${d.committee},` }, { t: d.signataire, bold: true }]);
  codeLine(doc, d.verifCode);
  small(doc, `Contrôle d’intégrité n° ${d.integrity.id} du ${dFr(d.integrity.at, true)} préalable à la validation du vote : conforme. Empreinte de référence : ${d.integrity.last_hash}.`);

  // ----- English version -----
  doc.addPage();
  header(doc, d.committee, 'Research Ethics Committee of PROMEDNAV', `OPINION ${d.numero}`);
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(16).text('Opinion of the Research Ethics Committee', { align: 'center' }).moveDown(0.2);
  doc.fillColor(GREY).font('Helvetica').fontSize(10).text(`Reference: ${d.numero} — ${dEn(d.date)}`, { align: 'center' }).moveDown(1);
  p(doc, `The Research Ethics Committee of PROMEDNAV (${d.committee}) ${meetingEn} and reviewed the project entitled "${d.dossier.title}", submitted by ${d.dossier.applicant_name} (reference ${d.dossier.reference}), on the basis of the following documents:`);
  bullet(doc, d.documents.map((x) => `${x.original_name} — version ${x.version} — SHA-256 ${x.sha256.slice(0, 16)}…`), 8.5);
  if (d.procedure !== 'simplifiee') p(doc, `${d.participants} voting members took part in the deliberation${d.qualities.length ? `, including: ${d.qualities.join('; ')}` : ''}. Members with a conflict of interest did not take part.`);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY).text(`The committee issues a ${d.decisionEn} opinion.`).moveDown(0.5);
  p(doc, 'Grounds:', { bold: true, gap: 0.2 });
  p(doc, d.motivationEn || `(Original grounds in French) ${d.motivation}`);
  if (['favorable', 'favorable_reserve'].includes(d.decision)) p(doc, `This opinion is valid for the duration of the project stated in the application, up to ${d.validityMonths} months, renewable on request.`);
  p(doc, 'This opinion does not replace the opinion of a French Committee for the Protection of Persons (CPP) required for research involving human persons under Article L.1123-6 of the French Public Health Code.', { size: 9.5 });
  if (d.irb.iorg || d.irb.irb) small(doc, `OHRP registration: ${d.irb.iorg ? 'IORG ' + d.irb.iorg : ''} ${d.irb.irb ? 'IRB ' + d.irb.irb : ''}`);
  signatureBlock(doc, [{ t: `${d.lieu}, ${dEn(d.date)}.` }, { t: `${FN_EN[d.signataireFonction] || 'Chair'} of ${d.committee},` }, { t: d.signataire, bold: true }]);
  codeLine(doc, d.verifCode);
  footer(doc, `${d.committee} — Avis / Opinion ${d.numero} — code ${d.verifCode}`);
  doc.end();
  return done;
}

// ===================== PROCÈS-VERBAL (art. 29.4) =====================
async function pv(d) {
  const s = d.seance;
  const { doc, done } = make(`Procès-verbal de la séance n° ${s.id}`, `Procès-verbal ${d.committee}`);
  header(doc, d.committee, d.longName, 'PROCÈS-VERBAL — DOCUMENT CONFIDENTIEL (art. 29.4)');
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(16).text(`Procès-verbal de la séance n° ${s.id}`, { align: 'center' }).moveDown(0.2);
  doc.fillColor(GREY).font('Helvetica').fontSize(10).text(`${dFr(s.date, true)} — ${modeFr[s.mode]}${s.lieu ? ` — ${s.lieu}` : ''}`, { align: 'center' }).moveDown(0.8);

  h(doc, 'Membres ayant pris part aux votes');
  if (d.participants.length) bullet(doc, d.participants.map((m) => `${m.full_name} — ${m.quality || d.fonctions[m.fonction]}`));
  else p(doc, 'Aucun vote enregistré.');

  for (const it of d.items) {
    const sc = it.sc;
    h(doc, `Dossier ${it.dossier.reference} — ${it.dossier.title}`, 11.5);
    p(doc, `Porteur : ${it.dossier.applicant_name}. Procédure ${sc.procedure === 'simplifiee' ? 'simplifiée' : 'ordinaire'}${sc.secret ? ', vote à bulletin secret (art. 29.3)' : ''}. Scrutin n° ${sc.id} ouvert le ${dFr(sc.opened_at, true)}.`, { gap: 0.2 });
    p(doc, `Rapporteurs : ${it.rapporteurs.length ? it.rapporteurs.map((r) => `${r.full_name} (${r.quality})`).join(' ; ') : '—'}.`, { gap: 0.2 });
    p(doc, `Déports pour conflit d’intérêts (art. 4.2) : ${it.deports.length ? it.deports.map((r) => r.full_name).join(' ; ') : 'aucun'}.`, { gap: 0.2 });
    if (sc.status === 'annule') { p(doc, `Scrutin annulé : ${sc.cancel_reason}.`); continue; }
    const r = it.res; const qj = r.quorum;
    p(doc, `Quorum (art. 29.2) : ${qj.participants} participant(s) pour ${qj.needed} requis${sc.procedure === 'ordinaire' ? ` ; membres non professionnels de santé : ${qj.nonHealth} ; membres indépendants : ${qj.independent}` : ''} — ${qj.ok ? 'atteint' : 'NON ATTEINT : ' + qj.reasons.join(' ; ')}.`, { gap: 0.2 });
    const counts = Object.entries(r.tally.counts).filter(([, n]) => n).map(([k, n]) => `${d.choices[k]} : ${n}`).join(' ; ') || 'aucun bulletin';
    p(doc, `Résultat : ${counts}.`, { gap: 0.2 });
    p(doc, `Décision : ${r.decision ? d.choices[r.decision] + (r.unanimous ? ' (unanimité)' : ' (majorité des votants, art. 29.3)') : (qj.ok ? 'pas de majorité — nouvel examen' : 'aucune — quorum non atteint')}.`, { bold: true, gap: 0.3 });
    if (r.divergent.length) {
      p(doc, 'Opinions divergentes consignées (art. 29.3) :', { gap: 0.1 });
      bullet(doc, r.divergent.map((x) => `${d.choices[x.choice]}${x.motivation ? ' — ' + x.motivation : ''}`), 9);
    }
    if (it.check) small(doc, `Contrôle d’intégrité n° ${it.check.id} avant validation du vote : conforme. Empreinte des bulletins : ${sc.tally_hash}.`);
  }

  if (d.simplifiees.length) {
    h(doc, 'Information du comité : avis rendus en procédure simplifiée (art. 30.2)');
    bullet(doc, d.simplifiees.map((x) => `${x.reference} — ${d.choices[x.result] || x.result} — ${dFr(x.closed_at)}`));
  }
  h(doc, 'Intégrité');
  p(doc, `Contrôle d’intégrité n° ${d.check.checkId} effectué à la clôture de la séance : conforme (${d.check.comments} commentaires, ${d.check.documents} documents, ${d.check.ballots} bulletins, ${d.check.actes} actes). Empreinte de référence de la chaîne des commentaires : ${d.check.lastHash}.`, { size: 9, align: 'left' });
  small(doc, 'Toute réécriture ultérieure de l’historique des échanges rendrait cette empreinte introuvable : conservez ce procès-verbal hors de l’outil.');
  signatureBlock(doc, [{ t: `Le président du ${d.committee},` }, { t: d.closedBy.full_name, bold: true }]);
  signatureBlock(doc, [{ t: 'Le secrétariat du comité,' }, { t: ' ' }]);
  codeLine(doc, d.verifCode);
  footer(doc, `${d.committee} — Procès-verbal de la séance n° ${s.id} — confidentiel — code ${d.verifCode}`);
  doc.end();
  return done;
}

// ===================== RAPPORT ANNUEL (art. 34.2) =====================
async function rapport(d) {
  const st = d.stats;
  const { doc, done } = make(`Rapport d’activité ${st.year}`, `Rapport annuel ${d.committee}`);
  header(doc, d.committee, d.longName, `RAPPORT D’ACTIVITÉ ${st.year}`);
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(16).text(`Rapport d’activité ${st.year}`, { align: 'center' }).moveDown(0.2);
  doc.fillColor(GREY).font('Helvetica').fontSize(10).text(`Présenté au conseil d’administration et à l’assemblée générale de ${d.association} (art. 34.2)`, { align: 'center' }).moveDown(1);
  const fmt = (x) => (x == null ? '—' : `${x.toFixed(1).replace('.', ',')} jours`);
  h(doc, 'Activité');
  bullet(doc, [
    `Demandes déposées : ${st.deposes}, dont appels : ${st.appels || 0}`,
    `Avis rendus : ${st.avis} (procédure ordinaire : ${st.ordinaires} ; procédure simplifiée : ${st.simplifiees})`,
    `Séances closes : ${st.seances}`,
    `Déports pour conflit d’intérêts : ${st.deports}`,
  ]);
  h(doc, 'Avis par catégorie (art. 31.1)');
  bullet(doc, Object.entries(st.byCategory).map(([k, n]) => `${d.choices[k]} : ${n}`));
  h(doc, 'Délais (de la recevabilité à l’avis, hors suspension)');
  bullet(doc, [
    `Délai moyen : ${fmt(st.delays.mean)}`, `Délai médian : ${fmt(st.delays.median)}`, `Délai maximal : ${fmt(st.delays.max)}`,
    `Avis rendus dans le délai de ${st.delays.limitDays} jours (art. 31.2) : ${st.delays.withinLimit} sur ${st.delays.n}`,
    ...(st.delays.sansRecevabilite ? [`Avis sans date de recevabilité enregistrée (exclus du calcul) : ${st.delays.sansRecevabilite}`] : []),
  ]);
  h(doc, 'Fiabilité de l’outil');
  bullet(doc, [`Contrôles d’intégrité effectués : ${st.integrityChecks.total}, dont conformes : ${st.integrityChecks.conformes}`]);
  h(doc, 'Composition au jour du rapport');
  bullet(doc, Object.entries(st.composition).map(([k, n]) => `${d.fonctions[k] || k} : ${n}`));
  small(doc, 'Conformément à l’article 34.2 du règlement intérieur, ce rapport ne contient aucun élément confidentiel : ni titre de projet, ni nom de porteur, ni contenu des débats.');
  signatureBlock(doc, [{ t: `Fait le ${dFr(d.date)}.` }, { t: `Le président du ${d.committee},` }, { t: d.by.full_name, bold: true }]);
  codeLine(doc, d.verifCode);
  footer(doc, `${d.committee} — Rapport d’activité ${st.year} — code ${d.verifCode}`);
  doc.end();
  return done;
}

// ===================== RELEVÉ DE CLÔTURE ET D'ARCHIVAGE =====================
const TYPE_ACTE = { avis: 'Avis', pv: 'Procès-verbal', rapport_annuel: 'Rapport annuel', rapport_validation: 'Rapport de validation', cloture: 'Relevé de clôture' };
const SIG_MODE = { manuscrite: 'exemplaire signé à la main, numérisé', electronique: 'signature électronique' };
async function cloture(d) {
  const { doc, done } = make(`Relevé de clôture ${d.dossier.reference}`, 'Relevé de clôture et d’archivage');
  header(doc, d.committee, d.longName, 'RELEVÉ DE CLÔTURE ET D’ARCHIVAGE — CONFIDENTIEL');
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(15).text(`Dossier ${d.dossier.reference}`, { align: 'center' }).moveDown(0.2);
  doc.fillColor(GREY).font('Helvetica').fontSize(10).text(`Procédure close le ${dFr(d.date, true)} par ${d.by.full_name}`, { align: 'center' }).moveDown(0.8);
  p(doc, `Projet : « ${d.dossier.title} ». Porteur : ${d.dossier.applicant_name} (${d.dossier.applicant_email}). Qualification : ${d.dossier.qualification}. Déposé le ${dFr(d.dossier.created_at)}.`);
  h(doc, 'Chronologie', 11.5);
  bullet(doc, d.events.map((e) => `${dFr(e.at, true)} — ${e.details}${e.full_name ? ` (${e.full_name})` : ''}`), 8.5);
  h(doc, 'Rapporteurs et déports', 11.5);
  bullet(doc, [
    ...d.rapporteurs.map((r) => `Rapporteur : ${r.full_name}, désigné le ${dFr(r.designated_at)}${r.ended_at ? `, fin le ${dFr(r.ended_at)} (${r.end_reason})` : ''}`),
    ...d.conflicts.map((c) => `Déport : ${c.full_name}, le ${dFr(c.declared_at)}`),
  ].concat(d.rapporteurs.length || d.conflicts.length ? [] : ['Aucun']), 9);
  h(doc, 'Documents du dossier', 11.5);
  bullet(doc, d.documents.map((x) => `${x.original_name} — v${x.version} — pièce ${x.piece} — ${dFr(x.uploaded_at)} — SHA-256 ${x.sha256}`), 7.5);
  h(doc, 'Votes', 11.5);
  if (!d.scrutins.length) p(doc, 'Aucun vote.');
  for (const { sc, res } of d.scrutins) {
    const label = sc.status === 'annule' ? `annulé (${sc.cancel_reason})` : res ? `${d.choices[sc.result] || sc.result.replace(/_/g, ' ')} — ${Object.entries(res.tally.counts).filter(([, n]) => n).map(([k, n]) => `${d.choices[k]} : ${n}`).join(' ; ')} — quorum ${res.quorum.participants}/${res.quorum.needed}` : sc.status;
    p(doc, `Scrutin n° ${sc.id} (procédure ${sc.procedure}${sc.secret ? ', bulletin secret' : ''}), ouvert le ${dFr(sc.opened_at)} : ${label}.${sc.integrity_check_id ? ` Contrôle d’intégrité n° ${sc.integrity_check_id}. Empreinte des bulletins : ${sc.tally_hash}.` : ''}`, { size: 8.5, align: 'left', gap: 0.3 });
  }
  h(doc, 'Actes', 11.5);
  bullet(doc, d.actes.map((a) => { const m = JSON.parse(a.meta_json || '{}'); return `${TYPE_ACTE[a.type]} — ${a.title} — ${dFr(a.created_at)}${m.signature ? ` — ${SIG_MODE[m.signature]}` : ''}${a.sent_at ? ` — transmis le ${dFr(a.sent_at)}` : ''} — SHA-256 ${a.sha256}`; }), 7.5);
  h(doc, `Échanges entre les membres (${d.comments.length})`, 11.5);
  if (!d.comments.length) p(doc, 'Aucun échange.');
  for (const c of d.comments) {
    if (doc.y > doc.page.height - 140) doc.addPage();
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(NAVY).text(`N° ${c.id}${c.parent_id ? ` (réponse au n° ${c.parent_id})` : ''}${c.kind === 'rapport' ? ' — RAPPORT' : ''} — ${c.author_name}, ${c.author_quality} — ${dFr(c.created_at, true)}`);
    doc.font('Helvetica').fontSize(8.5).fillColor('#111').text(c.body, { align: 'left', lineGap: 1 });
    doc.font('Helvetica').fontSize(6.5).fillColor(GREY).text(`Empreinte ${c.hash} — signature du serveur vérifiée`).moveDown(0.5);
  }
  h(doc, 'Intégrité', 11.5);
  p(doc, `Contrôle d’intégrité n° ${d.check.checkId} effectué avant la clôture : conforme (${d.check.comments} commentaires, ${d.check.documents} documents, ${d.check.ballots} bulletins, ${d.check.actes} actes). Empreinte de référence : ${d.check.lastHash}.`, { size: 9, align: 'left' });
  small(doc, 'Le dossier est désormais en lecture seule. Les documents, échanges, votes et actes restent conservés, chiffrés, sur le serveur de l’association pendant la durée fixée par le règlement intérieur (art. 34.3).');
  footer(doc, `${d.committee} — Relevé de clôture ${d.dossier.reference} — confidentiel`);
  doc.end();
  return done;
}

module.exports = { avis, pv, rapport, cloture };
