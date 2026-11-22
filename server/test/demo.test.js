'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lesaca-demo-'));
process.env.NODE_ENV = 'test';
process.env.DEMO_MODE = 'true';
process.env.DATA_DIR = tmp;
process.env.KEYS_DIR = path.join(tmp, 'keys');
const config = require('../src/config');
config.rebuild();
const db = require('../src/db');
const demo = require('../src/demo');
after(() => { db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('le jeu de démonstration couvre toutes les étapes et reste intègre', async () => {
  db.open();
  assert.equal(await demo.seed(), true);
  assert.equal(await demo.seed(), false); // pas de double remplissage
  const q = (sql) => db.get().prepare(sql).get();
  assert.equal(q('SELECT COUNT(*) n FROM users').n, 10);
  assert.equal(q("SELECT COUNT(*) n FROM dossiers WHERE kind = 'appel'").n, 1);
  assert.ok(q("SELECT COUNT(*) n FROM dossiers WHERE closed_at IS NOT NULL").n >= 3);
  assert.equal(q("SELECT COUNT(*) n FROM scrutins WHERE status = 'ouvert'").n, 1);
  assert.equal(q("SELECT COUNT(*) n FROM actes WHERE type = 'pv'").n, 1);
  assert.equal(q("SELECT COUNT(*) n FROM destructions WHERE status = 'attente_dpd'").n, 1);
  assert.equal(q("SELECT COUNT(*) n FROM receptions WHERE confirmed_at IS NOT NULL").n, 1);
  const v = require('../src/domain').verifyIntegrity();
  assert.equal(v.ok, true, v.problems.join('\n'));
});

test('garde-fou : le mode démonstration refuse un répertoire de données sans « demo »', () => {
  const r = spawnSync(process.execPath, ['-e', "require('./src/index')"], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, NODE_ENV: '', DEMO_MODE: 'true', DATA_DIR: path.join(os.tmpdir(), 'lesaca-prod-xyz'), PORT: '0' }, encoding: 'utf8', timeout: 20000,
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /DEMO_MODE refusé/);
});
