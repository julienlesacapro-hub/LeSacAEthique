#!/usr/bin/env node
'use strict';
/**
 * Vérifie que :
 *  - aucun commentaire n'a été modifié, supprimé ou inséré après coup
 *    (chaîne d'empreintes SHA-256 + signatures Ed25519) ;
 *  - aucun document stocké n'a été altéré (empreinte SHA-256 après déchiffrement).
 * Code de sortie 0 si tout est intègre, 2 sinon. À lancer après chaque
 * restauration de sauvegarde et lors de l'analyse périodique des journaux.
 */
const db = require('../src/db');
const domain = require('../src/domain');

db.open();
const r = domain.verifyIntegrity();
console.log(`Commentaires vérifiés : ${r.comments}\nDocuments vérifiés : ${r.documents}\nDernière empreinte : ${r.lastHash}`);
if (r.ok) { console.log('INTÈGRE'); process.exit(0); }
console.log('ANOMALIES :'); for (const p of r.problems) console.log(' - ' + p);
process.exit(2);
