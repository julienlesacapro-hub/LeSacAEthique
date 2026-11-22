'use strict';
const express = require('express');
const db = require('../db');
const config = require('../config');
const { requireSession } = require('../auth');

const router = express.Router();
const q = () => db.get();
router.use(requireSession(['full']));

router.get('/', (req, res) => {
  const rows = q().prepare(`SELECT n.*, d.reference FROM notifications n LEFT JOIN dossiers d ON d.id = n.dossier_id
    WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 100`).all(req.user.id);
  const { unread } = q().prepare('SELECT COUNT(*) unread FROM notifications WHERE user_id = ? AND read_at IS NULL').get(req.user.id);
  res.json({ notifications: rows, unread });
});

router.post('/read', (req, res) => {
  q().prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(Date.now(), req.user.id);
  res.json({ ok: true });
});

router.get('/push/key', (req, res) => res.json({ publicKey: config.vapid.publicKey || null }));

router.post('/push/subscribe', (req, res) => {
  const s = req.body || {};
  if (!s.endpoint || !/^https:\/\//.test(s.endpoint) || !s.keys || !s.keys.p256dh || !s.keys.auth) {
    return res.status(400).json({ error: 'Abonnement invalide' });
  }
  q().prepare(`INSERT INTO push_subscriptions (user_id, endpoint, keys_json, created_at) VALUES (?,?,?,?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, keys_json = excluded.keys_json`)
    .run(req.user.id, s.endpoint, JSON.stringify({ p256dh: s.keys.p256dh, auth: s.keys.auth }), Date.now());
  res.json({ ok: true });
});

router.post('/push/unsubscribe', (req, res) => {
  q().prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(req.user.id, String((req.body || {}).endpoint || ''));
  res.json({ ok: true });
});

module.exports = router;
