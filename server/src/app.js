'use strict';
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const db = require('./db');
const sec = require('./security');
const domain = require('./domain');
const notify = require('./notify');

function createApp() {
  db.open();
  sec.loadKeys();
  const app = express();
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'"],
        'img-src': ["'self'", 'data:', 'blob:'],
        'frame-src': ["'self'", 'blob:'],
        'object-src': ["'none'"],
        'connect-src': ["'self'"],
        'frame-ancestors': ["'none'"],
        'form-action': ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: { maxAge: 31536000, includeSubDomains: true },
    referrerPolicy: { policy: 'no-referrer' },
  }));

  // CORS pour les applications natives (Capacitor sur Android/iOS, Electron)
  app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/public')) return next();
    const origin = req.get('origin');
    if (origin && config.appOrigins.includes(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.set('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use(express.json({ limit: '200kb' }));

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: config.isTest ? 10000 : 60, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Trop de tentatives. Réessayez dans quelques minutes.' },
  });

  app.get('/api/meta', (req, res) => res.json({
    appName: config.appName, committee: config.committeeName, committeeLongName: config.committeeLongName,
    pieces: domain.PIECES, statuses: domain.STATUSES, pushPublicKey: notify.pushEnabled() ? config.vapid.publicKey : null,
    session: config.session,
  }));
  app.get('/api/health', (req, res) => res.json({ ok: true }));

  app.use('/api/auth', authLimiter, require('./routes/auth'));
  app.use('/api/users', require('./routes/users'));
  app.use('/api/dossiers', require('./routes/dossiers'));
  app.use('/api/notifications', require('./routes/notifications'));
  app.use('/api/public', require('./routes/public'));
  app.use('/api/gov', require('./routes/gouvernance'));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Ressource inconnue' }));

  // Formulaire public de dépôt (peut aussi être intégré au site de l'association)
  // Seule cette page peut être intégrée (iframe) dans le site de l'association.
  app.use('/formulaire', (req, res, next) => {
    const csp = res.get('Content-Security-Policy') || '';
    const ancestors = config.publicFormOrigins.length ? `'self' ${config.publicFormOrigins.join(' ')}` : "'self'";
    res.set('Content-Security-Policy', csp.replace(/frame-ancestors [^;]*/, `frame-ancestors ${ancestors}`));
    res.removeHeader('X-Frame-Options');
    next();
  }, express.static(path.join(__dirname, '..', '..', 'site-integration'), { index: 'formulaire-saisine.html' }));
  // Application des membres (PWA)
  app.use(express.static(path.join(__dirname, '..', '..', 'client'), {
    setHeaders: (res, p) => { if (p.endsWith('sw.js')) res.set('Cache-Control', 'no-cache'); },
  }));

  // Gestion d'erreurs : aucun détail technique renvoyé au client
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Requête trop volumineuse' });
    if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: `Fichier trop volumineux (${config.maxUploadMb} Mo au plus)` });
    if (err && /ne peut pas être (modifié|supprimé)/.test(err.message || '')) return res.status(405).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erreur interne' });
  });
  return app;
}

module.exports = { createApp };
