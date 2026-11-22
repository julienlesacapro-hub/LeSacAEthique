'use strict';
/**
 * Primitives cryptographiques (module natif `crypto` de Node.js uniquement).
 *  - mots de passe : scrypt (sel aléatoire 16 octets, N=2^15, r=8, p=1) ;
 *  - jetons (session, invitation, réinitialisation) : 32 octets aléatoires,
 *    seule leur empreinte SHA-256 est stockée ;
 *  - chiffrement au repos des documents et des secrets TOTP : AES-256-GCM ;
 *  - signature des commentaires : Ed25519 (clé du serveur).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof password !== 'string') return false;
  const [algo, N, r, p, saltB64, keyB64] = stored.split('$');
  if (algo !== 'scrypt') return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: +N, r: +r, p: +p, maxmem: SCRYPT.maxmem,
  });
  return crypto.timingSafeEqual(key, expected);
}

/**
 * Politique de mot de passe : 12 caractères minimum, avec majuscule,
 * minuscule, chiffre et caractère spécial (CNIL, délibération
 * n° 2022-100 du 21 juillet 2022, cas n° 1).
 */
function passwordProblems(pw) {
  const p = [];
  if (typeof pw !== 'string' || pw.length < 12) p.push('au moins 12 caractères');
  if (!/[A-Z]/.test(pw || '')) p.push('une majuscule');
  if (!/[a-z]/.test(pw || '')) p.push('une minuscule');
  if (!/[0-9]/.test(pw || '')) p.push('un chiffre');
  if (!/[^A-Za-z0-9]/.test(pw || '')) p.push('un caractère spécial');
  if (typeof pw === 'string' && pw.length > 256) p.push('256 caractères au plus');
  return p;
}

const randomToken = () => crypto.randomBytes(32).toString('base64url');
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

// ----- Clés du serveur (générées au premier démarrage) -----
let keys = null;
function loadKeys() {
  if (keys) return keys;
  fs.mkdirSync(config.keysDir, { recursive: true, mode: 0o700 });
  const encFile = path.join(config.keysDir, 'data-encryption.key');
  const sigFile = path.join(config.keysDir, 'signing-ed25519.pem');
  const pubFile = path.join(config.keysDir, 'signing-ed25519.pub.pem');

  let enc;
  if (process.env.DATA_ENCRYPTION_KEY) {
    enc = Buffer.from(process.env.DATA_ENCRYPTION_KEY, 'hex');
  } else if (fs.existsSync(encFile)) {
    enc = Buffer.from(fs.readFileSync(encFile, 'utf8').trim(), 'hex');
  } else {
    enc = crypto.randomBytes(32);
    fs.writeFileSync(encFile, enc.toString('hex'), { mode: 0o600 });
  }
  if (enc.length !== 32) throw new Error('DATA_ENCRYPTION_KEY doit faire 32 octets (64 caractères hexadécimaux)');

  let privateKey, publicKey;
  if (fs.existsSync(sigFile)) {
    privateKey = crypto.createPrivateKey(fs.readFileSync(sigFile));
    publicKey = crypto.createPublicKey(privateKey);
  } else {
    ({ privateKey, publicKey } = crypto.generateKeyPairSync('ed25519'));
    fs.writeFileSync(sigFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    fs.writeFileSync(pubFile, publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o644 });
  }
  keys = { enc, privateKey, publicKey };
  return keys;
}
const resetKeys = () => { keys = null; };

// AES-256-GCM : [iv 12 o][tag 16 o][données chiffrées]
function encrypt(buf) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', loadKeys().enc, iv);
  const ct = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}
function decrypt(buf) {
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const d = crypto.createDecipheriv('aes-256-gcm', loadKeys().enc, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]);
}
const encryptText = (s) => encrypt(Buffer.from(s, 'utf8')).toString('base64');
const decryptText = (s) => decrypt(Buffer.from(s, 'base64')).toString('utf8');

const sign = (text) => crypto.sign(null, Buffer.from(text, 'utf8'), loadKeys().privateKey).toString('base64');
const verifySignature = (text, sigB64, publicKey = loadKeys().publicKey) =>
  crypto.verify(null, Buffer.from(text, 'utf8'), publicKey, Buffer.from(sigB64, 'base64'));
const publicKeyPem = () => loadKeys().publicKey.export({ type: 'spki', format: 'pem' });

module.exports = {
  hashPassword, verifyPassword, passwordProblems, randomToken, sha256,
  encrypt, decrypt, encryptText, decryptText, sign, verifySignature, publicKeyPem, loadKeys, resetKeys,
};
