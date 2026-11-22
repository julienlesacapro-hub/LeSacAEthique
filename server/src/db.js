'use strict';
/**
 * Base de données SQLite (fichier unique sur le serveur de l'association).
 *
 * Règles d'intégrité imposées AU NIVEAU DE LA BASE par des déclencheurs
 * (triggers), et non seulement par l'interface :
 *  - un commentaire ne peut jamais être modifié ni supprimé ;
 *  - un document déposé ne peut jamais être modifié ni supprimé
 *    (une nouvelle version s'ajoute à côté) ;
 *  - le journal d'audit, l'historique des dossiers et les déclarations de
 *    conflit d'intérêts sont en ajout seul.
 * En complément, chaque commentaire est chaîné (empreinte SHA-256 du
 * précédent) et signé par le serveur (Ed25519) : toute altération faite
 * directement dans le fichier est détectable (scripts/verify-integrity.js).
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA secure_delete = ON;   -- le contenu supprimé est effacé physiquement du fichier

CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name       TEXT NOT NULL,
  quality         TEXT NOT NULL DEFAULT '',
  role            TEXT NOT NULL CHECK (role IN ('lecture','ecriture','admin')),
  -- Fonction au sein du comité (art. 25 et 26 du règlement intérieur)
  fonction        TEXT NOT NULL DEFAULT 'titulaire'
                  CHECK (fonction IN ('president','vice_president','titulaire','suppleant','secretariat','consultatif')),
  health_professional INTEGER NOT NULL DEFAULT 1,  -- exerce une profession de santé (art. 28.1, 29.2)
  independent     INTEGER NOT NULL DEFAULT 0,      -- membre indépendant de l'association (art. 25.1, 29.2)
  status          TEXT NOT NULL DEFAULT 'invite' CHECK (status IN ('invite','actif','suspendu')),
  password_hash   TEXT,
  totp_secret     TEXT,
  totp_enabled    INTEGER NOT NULL DEFAULT 0,
  totp_last_step  INTEGER NOT NULL DEFAULT 0,
  recovery_codes  TEXT NOT NULL DEFAULT '[]',
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    INTEGER NOT NULL DEFAULT 0,
  notify_email    INTEGER NOT NULL DEFAULT 1,
  notify_comments INTEGER NOT NULL DEFAULT 1,
  dpd             INTEGER NOT NULL DEFAULT 0,      -- délégué à la protection des données (avis sur les destructions)
  created_at      INTEGER NOT NULL,
  created_by      INTEGER,
  last_login_at   INTEGER
);

CREATE TABLE IF NOT EXISTS tokens (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  type        TEXT NOT NULL CHECK (type IN ('invite','reset')),
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  id           INTEGER PRIMARY KEY,
  token_hash   TEXT NOT NULL UNIQUE,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  stage        TEXT NOT NULL CHECK (stage IN ('mfa','enroll','full')),
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  ip           TEXT,
  user_agent   TEXT
);

CREATE TABLE IF NOT EXISTS dossiers (
  id                    INTEGER PRIMARY KEY,
  reference             TEXT NOT NULL UNIQUE,
  year                  INTEGER NOT NULL,
  seq                   INTEGER NOT NULL,
  title                 TEXT NOT NULL,
  applicant_name        TEXT NOT NULL,
  applicant_email       TEXT NOT NULL,
  applicant_affiliation TEXT NOT NULL DEFAULT '',
  investigator          TEXT NOT NULL DEFAULT '',
  qualification         TEXT NOT NULL DEFAULT 'RNIPH',
  qualification_reason  TEXT NOT NULL DEFAULT '',
  summary               TEXT NOT NULL DEFAULT '',
  funding               TEXT NOT NULL DEFAULT '',
  procedure             TEXT NOT NULL DEFAULT 'ordinaire' CHECK (procedure IN ('ordinaire','simplifiee')),
  status                TEXT NOT NULL DEFAULT 'depose',
  source                TEXT NOT NULL DEFAULT 'site',
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,
  closed_at             INTEGER,           -- clôture et archivage : le dossier passe en lecture seule
  closed_by             INTEGER REFERENCES users(id),
  -- Procédure d'appel (nouvelle demande rattachée à un dossier dont l'avis a été rendu)
  kind                  TEXT NOT NULL DEFAULT 'initiale' CHECK (kind IN ('initiale','appel')),
  parent_id             INTEGER REFERENCES dossiers(id),
  appeal_avis_id        INTEGER,
  appeal_role           TEXT,              -- 'porteur' ou 'president_association'
  appeal_requester      TEXT,
  appeal_requester_email TEXT,
  appeal_reason         TEXT,
  related_reference     TEXT,              -- appel hors délai enregistré comme nouvelle demande
  project_end_at        INTEGER,           -- fin du projet : point de départ de la durée de conservation (art. 34.3)
  destroyed_at          INTEGER,           -- destruction en fin de conservation (art. 45.2)
  UNIQUE (year, seq)
);

CREATE TABLE IF NOT EXISTS dossier_events (
  id          INTEGER PRIMARY KEY,
  dossier_id  INTEGER NOT NULL REFERENCES dossiers(id),
  at          INTEGER NOT NULL,
  user_id     INTEGER REFERENCES users(id),
  type        TEXT NOT NULL,
  value       TEXT,
  details     TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS documents (
  id            INTEGER PRIMARY KEY,
  dossier_id    INTEGER NOT NULL REFERENCES dossiers(id),
  piece         TEXT NOT NULL,
  label         TEXT NOT NULL DEFAULT '',
  version       INTEGER NOT NULL DEFAULT 1,
  original_name TEXT NOT NULL,
  mime          TEXT NOT NULL,
  size          INTEGER NOT NULL,
  sha256        TEXT NOT NULL,
  storage_name  TEXT NOT NULL UNIQUE,
  uploaded_by   INTEGER REFERENCES users(id),
  uploaded_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS comments (
  id             INTEGER PRIMARY KEY,
  dossier_id     INTEGER NOT NULL REFERENCES dossiers(id),
  parent_id      INTEGER REFERENCES comments(id),
  document_id    INTEGER REFERENCES documents(id),
  kind           TEXT NOT NULL DEFAULT 'commentaire' CHECK (kind IN ('commentaire','reponse','complement','rapport')),
  author_id      INTEGER NOT NULL REFERENCES users(id),
  author_name    TEXT NOT NULL,
  author_quality TEXT NOT NULL,
  author_email   TEXT NOT NULL,
  body           TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  prev_hash      TEXT NOT NULL,
  hash           TEXT NOT NULL UNIQUE,
  signature      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conflicts (
  id          INTEGER PRIMARY KEY,
  dossier_id  INTEGER NOT NULL REFERENCES dossiers(id),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  reason      TEXT NOT NULL,
  declared_at INTEGER NOT NULL,
  UNIQUE (dossier_id, user_id)
);

CREATE TABLE IF NOT EXISTS reads (
  user_id    INTEGER NOT NULL REFERENCES users(id),
  dossier_id INTEGER NOT NULL REFERENCES dossiers(id),
  last_read_comment_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, dossier_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  type        TEXT NOT NULL,
  dossier_id  INTEGER REFERENCES dossiers(id),
  comment_id  INTEGER REFERENCES comments(id),
  message     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  read_at     INTEGER
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  endpoint   TEXT NOT NULL UNIQUE,
  keys_json  TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id       INTEGER PRIMARY KEY,
  at       INTEGER NOT NULL,
  user_id  INTEGER,
  action   TEXT NOT NULL,
  target   TEXT NOT NULL DEFAULT '',
  ip       TEXT NOT NULL DEFAULT '',
  details  TEXT NOT NULL DEFAULT ''
);

-- ===== Instruction et délibération (art. 28 à 34) =====
CREATE TABLE IF NOT EXISTS rapporteurs (
  id            INTEGER PRIMARY KEY,
  dossier_id    INTEGER NOT NULL REFERENCES dossiers(id),
  user_id       INTEGER NOT NULL REFERENCES users(id),
  designated_by INTEGER NOT NULL REFERENCES users(id),
  designated_at INTEGER NOT NULL,
  ended_at      INTEGER,
  end_reason    TEXT
);

-- Contrôles d'intégrité : chaque contrôle est conservé (preuve du contrôle préalable au vote)
CREATE TABLE IF NOT EXISTS integrity_checks (
  id         INTEGER PRIMARY KEY,
  at         INTEGER NOT NULL,
  user_id    INTEGER REFERENCES users(id),
  purpose    TEXT NOT NULL,
  ok         INTEGER NOT NULL,
  comments   INTEGER NOT NULL,
  documents  INTEGER NOT NULL,
  ballots    INTEGER NOT NULL DEFAULT 0,
  actes      INTEGER NOT NULL DEFAULT 0,
  last_hash  TEXT NOT NULL,
  problems   TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS seances (
  id          INTEGER PRIMARY KEY,
  date        INTEGER NOT NULL,
  mode        TEXT NOT NULL CHECK (mode IN ('presentiel','visio','electronique')),
  lieu        TEXT NOT NULL DEFAULT '',
  created_by  INTEGER NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  closed_at   INTEGER,
  closed_by   INTEGER REFERENCES users(id),
  integrity_check_id INTEGER REFERENCES integrity_checks(id)
);

CREATE TABLE IF NOT EXISTS scrutins (
  id            INTEGER PRIMARY KEY,
  dossier_id    INTEGER NOT NULL REFERENCES dossiers(id),
  seance_id     INTEGER REFERENCES seances(id),
  procedure     TEXT NOT NULL CHECK (procedure IN ('ordinaire','simplifiee')),
  secret        INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'ouvert' CHECK (status IN ('ouvert','clos','annule')),
  opened_by     INTEGER NOT NULL REFERENCES users(id),
  opened_at     INTEGER NOT NULL,
  deadline      INTEGER,
  seats         INTEGER NOT NULL,          -- membres votants en exercice (base du quorum)
  documents_json TEXT NOT NULL DEFAULT '[]', -- documents examinés (id, nom, version, empreinte)
  closed_by     INTEGER REFERENCES users(id),
  closed_at     INTEGER,
  integrity_check_id INTEGER REFERENCES integrity_checks(id),
  participants  INTEGER,
  quorum_json   TEXT,
  tally_json    TEXT,
  tally_hash    TEXT,
  result        TEXT,
  cancel_reason TEXT
);

CREATE TABLE IF NOT EXISTS scrutin_electeurs (
  scrutin_id     INTEGER NOT NULL REFERENCES scrutins(id),
  user_id        INTEGER NOT NULL REFERENCES users(id),
  substitute_for INTEGER REFERENCES users(id),
  PRIMARY KEY (scrutin_id, user_id)
);

CREATE TABLE IF NOT EXISTS emargements (
  scrutin_id INTEGER NOT NULL REFERENCES scrutins(id),
  user_id    INTEGER NOT NULL REFERENCES users(id),
  at         INTEGER NOT NULL,
  method     TEXT,                    -- second facteur utilisé pour signer le vote
  hash       TEXT,
  signature  TEXT,
  PRIMARY KEY (scrutin_id, user_id)
);

-- Bulletins : clé aléatoire, sans horodatage, sans auteur si le vote est secret
CREATE TABLE IF NOT EXISTS bulletins (
  id          TEXT PRIMARY KEY,
  scrutin_id  INTEGER NOT NULL REFERENCES scrutins(id),
  choice      TEXT NOT NULL CHECK (choice IN ('favorable','favorable_reserve','modifications','defavorable','incompetence','abstention')),
  motivation  TEXT NOT NULL DEFAULT '',
  voter_id    INTEGER REFERENCES users(id),
  voter_name  TEXT,
  hash        TEXT,
  signature   TEXT
) WITHOUT ROWID;

-- Actes produits : avis (annexe 7), procès-verbaux, rapports annuels, et leurs versions signées
CREATE TABLE IF NOT EXISTS actes (
  id            INTEGER PRIMARY KEY,
  type          TEXT NOT NULL CHECK (type IN ('avis','pv','rapport_annuel','rapport_validation','cloture','avis_dpd','certificat_destruction')),
  dossier_id    INTEGER REFERENCES dossiers(id),
  seance_id     INTEGER REFERENCES seances(id),
  scrutin_id    INTEGER REFERENCES scrutins(id),
  year          INTEGER,
  title         TEXT NOT NULL,
  meta_json     TEXT NOT NULL DEFAULT '{}',
  storage_name  TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  size          INTEGER NOT NULL,
  sha256        TEXT NOT NULL,
  signed        INTEGER NOT NULL DEFAULT 0,
  parent_id     INTEGER REFERENCES actes(id),
  created_by    INTEGER REFERENCES users(id),
  created_at    INTEGER NOT NULL,
  sent_at       INTEGER
);

-- Courriels adressés aux porteurs (texte exact conservé)
CREATE TABLE IF NOT EXISTS envois (
  id           INTEGER PRIMARY KEY,
  acte_id      INTEGER NOT NULL REFERENCES actes(id),
  dossier_id   INTEGER REFERENCES dossiers(id),
  from_email   TEXT NOT NULL,
  to_email     TEXT NOT NULL,
  subject      TEXT NOT NULL,
  body         TEXT NOT NULL,
  attachment_name   TEXT NOT NULL,
  attachment_sha256 TEXT NOT NULL,
  sent_by      INTEGER NOT NULL REFERENCES users(id),
  sent_at      INTEGER NOT NULL
);

-- Réception de l'avis par le porteur (point de départ du délai d'appel)
CREATE TABLE IF NOT EXISTS receptions (
  id           INTEGER PRIMARY KEY,
  acte_id      INTEGER NOT NULL REFERENCES actes(id),   -- avis d'origine
  dossier_id   INTEGER NOT NULL REFERENCES dossiers(id),
  envoi_id     INTEGER REFERENCES envois(id),
  token_hash   TEXT UNIQUE,
  sent_at      INTEGER,
  confirmed_at INTEGER,
  method       TEXT CHECK (method IN ('lien','declaration')),
  declared_by  INTEGER REFERENCES users(id),
  note         TEXT NOT NULL DEFAULT '',
  ip           TEXT NOT NULL DEFAULT ''
);

-- Destructions en fin de conservation (art. 45.2)
CREATE TABLE IF NOT EXISTS destructions (
  id              INTEGER PRIMARY KEY,
  dossier_id      INTEGER NOT NULL REFERENCES dossiers(id),   -- dossier initial
  family          TEXT NOT NULL,                              -- « ,id1,id2, » : dossier initial et appel
  status          TEXT NOT NULL CHECK (status IN ('attente_dpd','avis_dpd_rendu','execution','executee','abandonnee')),
  retention_until INTEGER NOT NULL,
  proposed_by     INTEGER NOT NULL REFERENCES users(id),
  proposed_at     INTEGER NOT NULL,
  dpd_opinion     TEXT CHECK (dpd_opinion IN ('favorable','defavorable')),
  dpd_motivation  TEXT,
  dpd_by          INTEGER REFERENCES users(id),
  dpd_name        TEXT,
  dpd_method      TEXT CHECK (dpd_method IN ('outil','document')),
  dpd_at          INTEGER,
  dpd_acte_id     INTEGER REFERENCES actes(id),
  decided_by      INTEGER REFERENCES users(id),
  decided_at      INTEGER,
  decision_note   TEXT,
  keep_avis       INTEGER NOT NULL DEFAULT 1,
  executed_at     INTEGER,
  certificate_acte_id INTEGER REFERENCES actes(id),
  counts_json     TEXT,
  abandon_reason  TEXT
);

-- Commentaires détruits : seule l'empreinte reste, pour que la chaîne d'intégrité demeure vérifiable
CREATE TABLE IF NOT EXISTS comment_tombstones (
  comment_id     INTEGER PRIMARY KEY,
  dossier_id     INTEGER NOT NULL,
  prev_hash      TEXT NOT NULL,
  hash           TEXT NOT NULL,
  signature      TEXT NOT NULL,
  destruction_id INTEGER NOT NULL REFERENCES destructions(id),
  destroyed_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comments_dossier ON comments(dossier_id, id);
CREATE INDEX IF NOT EXISTS idx_documents_dossier ON documents(dossier_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);

-- ===== Immuabilité =====
CREATE TRIGGER IF NOT EXISTS comments_no_update BEFORE UPDATE ON comments
BEGIN SELECT RAISE(ABORT, 'Un commentaire ne peut pas être modifié'); END;
CREATE TRIGGER IF NOT EXISTS comments_no_delete BEFORE DELETE ON comments
WHEN NOT EXISTS (SELECT 1 FROM destructions x WHERE x.status = 'execution' AND instr(x.family, ',' || (old.dossier_id) || ',') > 0)
BEGIN SELECT RAISE(ABORT, 'Un commentaire ne peut pas être supprimé'); END;

CREATE TRIGGER IF NOT EXISTS documents_no_update BEFORE UPDATE ON documents
BEGIN SELECT RAISE(ABORT, 'Un document déposé ne peut pas être modifié'); END;
CREATE TRIGGER IF NOT EXISTS documents_no_delete BEFORE DELETE ON documents
WHEN NOT EXISTS (SELECT 1 FROM destructions x WHERE x.status = 'execution' AND instr(x.family, ',' || (old.dossier_id) || ',') > 0)
BEGIN SELECT RAISE(ABORT, 'Un document déposé ne peut pas être supprimé'); END;

CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'Le journal est en ajout seul'); END;
-- Journal : suppression possible UNIQUEMENT au-delà de 365 jours
-- (règlement intérieur, art. 52 : conservation entre six mois et un an).
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log
WHEN old.at > (CAST(strftime('%s','now') AS INTEGER) - 365*86400) * 1000
BEGIN SELECT RAISE(ABORT, 'Le journal est en ajout seul'); END;

CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON dossier_events
BEGIN SELECT RAISE(ABORT, 'Historique en ajout seul'); END;
CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON dossier_events
WHEN NOT EXISTS (SELECT 1 FROM destructions x WHERE x.status = 'execution' AND instr(x.family, ',' || (old.dossier_id) || ',') > 0)
BEGIN SELECT RAISE(ABORT, 'Historique en ajout seul'); END;

CREATE TRIGGER IF NOT EXISTS rapporteurs_no_delete BEFORE DELETE ON rapporteurs
WHEN NOT EXISTS (SELECT 1 FROM destructions x WHERE x.status = 'execution' AND instr(x.family, ',' || (old.dossier_id) || ',') > 0)
BEGIN SELECT RAISE(ABORT, 'Une désignation ne peut pas être supprimée'); END;
CREATE TRIGGER IF NOT EXISTS rapporteurs_update_once BEFORE UPDATE ON rapporteurs
WHEN old.ended_at IS NOT NULL OR new.dossier_id IS NOT old.dossier_id OR new.user_id IS NOT old.user_id
  OR new.designated_at IS NOT old.designated_at OR new.designated_by IS NOT old.designated_by
BEGIN SELECT RAISE(ABORT, 'Une désignation ne peut pas être modifiée'); END;

CREATE TRIGGER IF NOT EXISTS checks_no_update BEFORE UPDATE ON integrity_checks
BEGIN SELECT RAISE(ABORT, 'Un contrôle d''intégrité ne peut pas être modifié'); END;
CREATE TRIGGER IF NOT EXISTS checks_no_delete BEFORE DELETE ON integrity_checks
BEGIN SELECT RAISE(ABORT, 'Un contrôle d''intégrité ne peut pas être supprimé'); END;

CREATE TRIGGER IF NOT EXISTS seances_no_delete BEFORE DELETE ON seances
BEGIN SELECT RAISE(ABORT, 'Une séance ne peut pas être supprimée'); END;
CREATE TRIGGER IF NOT EXISTS seances_closed BEFORE UPDATE ON seances WHEN old.closed_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Une séance close ne peut pas être modifiée'); END;

CREATE TRIGGER IF NOT EXISTS scrutins_no_delete BEFORE DELETE ON scrutins
WHEN NOT EXISTS (SELECT 1 FROM destructions x WHERE x.status = 'execution' AND instr(x.family, ',' || (old.dossier_id) || ',') > 0)
BEGIN SELECT RAISE(ABORT, 'Un scrutin ne peut pas être supprimé'); END;
CREATE TRIGGER IF NOT EXISTS scrutins_closed BEFORE UPDATE ON scrutins WHEN old.status <> 'ouvert'
BEGIN SELECT RAISE(ABORT, 'Un scrutin clos ou annulé ne peut pas être modifié'); END;

CREATE TRIGGER IF NOT EXISTS electeurs_no_update BEFORE UPDATE ON scrutin_electeurs
BEGIN SELECT RAISE(ABORT, 'Liste électorale figée'); END;
CREATE TRIGGER IF NOT EXISTS electeurs_no_delete BEFORE DELETE ON scrutin_electeurs
WHEN NOT EXISTS (SELECT 1 FROM destructions x WHERE x.status = 'execution' AND instr(x.family, ',' || ((SELECT dossier_id FROM scrutins WHERE id = old.scrutin_id)) || ',') > 0)
BEGIN SELECT RAISE(ABORT, 'Liste électorale figée'); END;
CREATE TRIGGER IF NOT EXISTS emargements_no_update BEFORE UPDATE ON emargements
BEGIN SELECT RAISE(ABORT, 'Émargement définitif'); END;
CREATE TRIGGER IF NOT EXISTS emargements_no_delete BEFORE DELETE ON emargements
WHEN NOT EXISTS (SELECT 1 FROM destructions x WHERE x.status = 'execution' AND instr(x.family, ',' || ((SELECT dossier_id FROM scrutins WHERE id = old.scrutin_id)) || ',') > 0)
BEGIN SELECT RAISE(ABORT, 'Émargement définitif'); END;
CREATE TRIGGER IF NOT EXISTS bulletins_no_update BEFORE UPDATE ON bulletins
BEGIN SELECT RAISE(ABORT, 'Un bulletin ne peut pas être modifié'); END;
CREATE TRIGGER IF NOT EXISTS bulletins_no_delete BEFORE DELETE ON bulletins
WHEN NOT EXISTS (SELECT 1 FROM destructions x WHERE x.status = 'execution' AND instr(x.family, ',' || ((SELECT dossier_id FROM scrutins WHERE id = old.scrutin_id)) || ',') > 0)
BEGIN SELECT RAISE(ABORT, 'Un bulletin ne peut pas être supprimé'); END;

CREATE TRIGGER IF NOT EXISTS actes_no_delete BEFORE DELETE ON actes
WHEN NOT EXISTS (SELECT 1 FROM destructions x WHERE x.status = 'execution' AND instr(x.family, ',' || (old.dossier_id) || ',') > 0)
BEGIN SELECT RAISE(ABORT, 'Un acte ne peut pas être supprimé'); END;
CREATE TRIGGER IF NOT EXISTS actes_update_sent_only BEFORE UPDATE ON actes
WHEN new.sha256 IS NOT old.sha256 OR new.storage_name IS NOT old.storage_name OR new.meta_json IS NOT old.meta_json
  OR new.type IS NOT old.type OR new.parent_id IS NOT old.parent_id OR new.created_at IS NOT old.created_at
BEGIN SELECT RAISE(ABORT, 'Un acte ne peut pas être modifié'); END;

CREATE TRIGGER IF NOT EXISTS envois_no_update BEFORE UPDATE ON envois
BEGIN SELECT RAISE(ABORT, 'Un envoi ne peut pas être modifié'); END;
CREATE TRIGGER IF NOT EXISTS envois_no_delete BEFORE DELETE ON envois
WHEN NOT EXISTS (SELECT 1 FROM destructions x WHERE x.status = 'execution' AND instr(x.family, ',' || (old.dossier_id) || ',') > 0)
BEGIN SELECT RAISE(ABORT, 'Un envoi ne peut pas être supprimé'); END;

CREATE TRIGGER IF NOT EXISTS receptions_confirm_once BEFORE UPDATE ON receptions
WHEN old.confirmed_at IS NOT NULL OR new.acte_id IS NOT old.acte_id OR new.dossier_id IS NOT old.dossier_id OR new.sent_at IS NOT old.sent_at
BEGIN SELECT RAISE(ABORT, 'Une réception confirmée ne peut pas être modifiée'); END;
CREATE TRIGGER IF NOT EXISTS receptions_no_delete BEFORE DELETE ON receptions
WHEN NOT EXISTS (SELECT 1 FROM destructions x WHERE x.status = 'execution' AND instr(x.family, ',' || (old.dossier_id) || ',') > 0)
BEGIN SELECT RAISE(ABORT, 'Une réception ne peut pas être supprimée'); END;
CREATE TRIGGER IF NOT EXISTS destructions_no_delete BEFORE DELETE ON destructions
BEGIN SELECT RAISE(ABORT, 'Une procédure de destruction ne peut pas être supprimée'); END;
CREATE TRIGGER IF NOT EXISTS destructions_final BEFORE UPDATE ON destructions WHEN old.status IN ('executee','abandonnee')
BEGIN SELECT RAISE(ABORT, 'Une procédure de destruction terminée ne peut pas être modifiée'); END;
CREATE TRIGGER IF NOT EXISTS tombstones_no_update BEFORE UPDATE ON comment_tombstones
BEGIN SELECT RAISE(ABORT, 'Trace de destruction immuable'); END;
CREATE TRIGGER IF NOT EXISTS tombstones_no_delete BEFORE DELETE ON comment_tombstones
BEGIN SELECT RAISE(ABORT, 'Trace de destruction immuable'); END;

CREATE TRIGGER IF NOT EXISTS conflicts_no_update BEFORE UPDATE ON conflicts
BEGIN SELECT RAISE(ABORT, 'Une déclaration de conflit ne peut pas être modifiée'); END;
CREATE TRIGGER IF NOT EXISTS conflicts_no_delete BEFORE DELETE ON conflicts
WHEN NOT EXISTS (SELECT 1 FROM destructions x WHERE x.status = 'execution' AND instr(x.family, ',' || (old.dossier_id) || ',') > 0)
BEGIN SELECT RAISE(ABORT, 'Une déclaration de conflit ne peut pas être supprimée'); END;
`;

let db = null;

// Ajoute les colonnes introduites par les versions récentes à une base existante.
const ADDED_COLUMNS = [
  ['dossiers', 'closed_at', 'INTEGER'], ['dossiers', 'closed_by', 'INTEGER'],
  ['dossiers', 'kind', "TEXT NOT NULL DEFAULT 'initiale'"], ['dossiers', 'parent_id', 'INTEGER'], ['dossiers', 'appeal_avis_id', 'INTEGER'],
  ['dossiers', 'appeal_role', 'TEXT'], ['dossiers', 'appeal_requester', 'TEXT'], ['dossiers', 'appeal_requester_email', 'TEXT'],
  ['dossiers', 'appeal_reason', 'TEXT'], ['dossiers', 'related_reference', 'TEXT'],
  ['dossiers', 'project_end_at', 'INTEGER'], ['dossiers', 'destroyed_at', 'INTEGER'], ['users', 'dpd', 'INTEGER NOT NULL DEFAULT 0'],
  ['emargements', 'method', 'TEXT'], ['emargements', 'hash', 'TEXT'], ['emargements', 'signature', 'TEXT'],
  ['bulletins', 'hash', 'TEXT'], ['bulletins', 'signature', 'TEXT'],
];
function migrate(d) {
  for (const [table, col, type] of ADDED_COLUMNS) {
    const exists = d.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
    if (!exists) continue;
    if (!d.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
  }
  // Déclencheurs de suppression devenus conditionnels (destruction autorisée) : recréés par SCHEMA
  for (const t of ['comments', 'documents', 'events', 'rapporteurs', 'scrutins', 'electeurs', 'emargements', 'bulletins', 'actes', 'envois', 'conflicts']) {
    const row = d.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(`${t}_no_delete`);
    if (row && !/destructions/.test(row.sql)) d.exec(`DROP TRIGGER ${t}_no_delete`);
  }
}

function open() {
  if (db) return db;
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(config.filesDir, { recursive: true, mode: 0o700 });
  db = new Database(config.dbFile);
  migrate(db);
  db.exec(SCHEMA);
  return db;
}

function close() {
  if (db) db.close();
  db = null;
}

module.exports = { open, close, get: () => open(), SCHEMA, dbPath: () => path.resolve(config.dbFile) };
