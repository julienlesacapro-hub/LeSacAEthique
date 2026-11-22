#!/usr/bin/env node
'use strict';
/**
 * Lance la VERSION DE DÉMONSTRATION (données fictives), repartie de zéro à chaque lancement.
 *   npm run demo            -> http://localhost:8443
 * Options : PORT, HOST, PUBLIC_URL, DEMO_DATA_DIR (doit contenir « demo »), DEMO_KEEP=true pour conserver les données.
 */
const fs = require('fs');
const path = require('path');
const dir = path.resolve(process.env.DEMO_DATA_DIR || path.join(__dirname, '..', 'demo-data'));
if (!/demo/i.test(dir)) { console.error('DEMO_DATA_DIR doit contenir « demo ».'); process.exit(1); }
if (process.env.DEMO_KEEP !== 'true') fs.rmSync(dir, { recursive: true, force: true });
process.env.DEMO_MODE = 'true';
process.env.DATA_DIR = dir;
process.env.KEYS_DIR = path.join(dir, 'keys');
process.env.PORT = process.env.PORT || '8443';
process.env.PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT}`;
require('../src/index');
