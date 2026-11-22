#!/usr/bin/env node
'use strict';
/**
 * Lance la VERSION DE DÉMONSTRATION (données fictives), repartie de zéro à chaque lancement.
 *   npm run demo            -> http://localhost:8443
 * Accessible aussi depuis un téléphone du même réseau Wi-Fi (adresse et QR code affichés).
 * Options : PORT, HOST (127.0.0.1 pour limiter à l'ordinateur), PUBLIC_URL, DEMO_DATA_DIR (doit contenir « demo »), DEMO_KEEP=true pour conserver les données.
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
// Accessible depuis les autres appareils du réseau local (téléphone, tablette) : démonstration uniquement
process.env.HOST = process.env.HOST || '0.0.0.0';
const lan = Object.values(require('os').networkInterfaces()).flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
const lanUrl = lan.length ? `http://${lan[0]}:${process.env.PORT}` : null;
process.env.PUBLIC_URL = process.env.PUBLIC_URL || lanUrl || `http://localhost:${process.env.PORT}`;
require('../src/index');
setTimeout(async () => {
  console.log(`\nSur cet ordinateur : http://localhost:${process.env.PORT}`);
  if (process.env.HOST === '0.0.0.0' && lan.length) {
    console.log('Sur un téléphone ou une tablette connecté au MÊME réseau Wi-Fi :');
    for (const ip of lan) console.log(`   http://${ip}:${process.env.PORT}`);
    try { console.log(await require('qrcode').toString(lanUrl, { type: 'terminal', small: true })); } catch { /* QR facultatif */ }
    console.log('Scannez ce QR code avec l’appareil photo du téléphone. Arrêt : Ctrl + C.');
  }
}, 1500);
