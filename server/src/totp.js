'use strict';
/**
 * Double authentification par code à usage unique basé sur le temps
 * (TOTP, RFC 6238 ; HOTP, RFC 4226) : HMAC-SHA1, pas de 30 s, 6 chiffres.
 * Compatible avec les applications usuelles (FreeOTP, Aegis, Google
 * Authenticator, Microsoft Authenticator, applications de mots de passe…).
 */
const crypto = require('crypto');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = str.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('Base32 invalide');
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

function hotp(secretBuf, counter, digits = 6, algo = 'sha1') {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac(algo, secretBuf).update(msg).digest();
  const off = h[h.length - 1] & 0xf;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

const STEP = 30;
const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP);

function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

/**
 * Vérifie un code. Tolère ±1 pas (dérive d'horloge). Retourne le numéro de
 * pas accepté (pour interdire la réutilisation du même code) ou -1.
 */
function verify(secretB32, code, lastUsedStep = 0, now = Date.now()) {
  if (!/^\d{6}$/.test(String(code || ''))) return -1;
  const secret = base32Decode(secretB32);
  const step = currentStep(now);
  for (const s of [step, step - 1, step + 1]) {
    if (s <= lastUsedStep) continue;
    const expected = hotp(secret, s);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(code)))) return s;
  }
  return -1;
}

function otpauthUrl(secretB32, account, issuer) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

module.exports = { base32Encode, base32Decode, hotp, generateSecret, verify, otpauthUrl, currentStep, STEP };
