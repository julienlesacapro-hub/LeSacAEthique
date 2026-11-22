/* LeSacAEthique — application des membres du CER-PROMEDNAV.
 * Application web progressive (PWA) : fonctionne dans le navigateur de
 * l'ordinateur, s'installe sur téléphone et tablette (Android, iOS/iPadOS),
 * et sert d'interface aux versions de bureau (Electron) et mobiles (Capacitor).
 * Aucun contenu utilisateur n'est injecté en HTML brut (protection XSS). */

// ===================== Outils =====================
const $app = document.getElementById('app');
const store = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch { /* stockage indisponible */ } },
  getLocal(k) { try { return localStorage.getItem(k); } catch { return null; } },
  setLocal(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* idem */ } },
};
// Application mobile (Capacitor) : l'interface est embarquée, le serveur est distant.
// Application de bureau (Electron) : la fenêtre ouvre directement le serveur.
const isNative = !!(window.Capacitor || location.protocol === 'capacitor:' || location.protocol === 'file:');
const isDesktop = !!window.lesacaDesktop;
const apiBase = () => (isNative ? store.getLocal('serverUrl') || '' : '').replace(/\/$/, '');

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
const svg = (path) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
  for (const d of path.split('|')) { const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); s.append(p); }
  return s;
};
const ICONS = {
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9|M10.3 21a1.9 1.9 0 0 0 3.4 0',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2|M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  lock: 'M5 11h14v10H5z|M8 11V7a4 4 0 1 1 8 0v4',
  calendar: 'M4 6h16v14H4z|M4 10h16|M8 3v4|M16 3v4',
};

function toast(msg) {
  const t = h('div', {}, msg);
  document.getElementById('toast').append(t);
  setTimeout(() => t.remove(), 4500);
}

const fmtDate = (ms, withTime = true) => new Intl.DateTimeFormat('fr-FR', withTime
  ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(new Date(ms));
const fmtSize = (n) => (n < 1024 ? `${n} o` : n < 1048576 ? `${(n / 1024).toFixed(0)} Ko` : `${(n / 1048576).toFixed(1)} Mo`);

// ===================== API =====================
const S = { token: store.get('token'), user: null, meta: null, unread: 0 };

class ApiError extends Error { constructor(status, body) { super(body.error || `Erreur ${status}`); this.status = status; this.body = body; } }

async function api(method, path, body, { raw = false } = {}) {
  const headers = {};
  if (S.token) headers.Authorization = `Bearer ${S.token}`;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let r;
  try {
    r = await fetch(apiBase() + '/api' + path, { method, headers, body: payload, cache: 'no-store' });
  } catch {
    throw new ApiError(0, { error: isNative && !store.getLocal('serverUrl') ? 'Adresse du serveur non configurée' : 'Serveur injoignable. Vérifiez votre connexion.' });
  }
  if (raw && r.ok) return r;
  const data = (r.headers.get('content-type') || '').includes('json') ? await r.json() : {};
  if (r.status === 401 && S.token && !path.startsWith('/auth/login') && !path.startsWith('/auth/mfa')) {
    setToken(null); S.user = null;
    toast(data.error || 'Session expirée');
    go('/connexion');
  }
  if (!r.ok) throw new ApiError(r.status, data);
  return data;
}
function setToken(t) { S.token = t; store.set('token', t); }

// ===================== Routeur =====================
function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/dossiers';
  const [path, qs] = raw.split('?');
  return { path, params: new URLSearchParams(qs || '') };
}
const go = (p) => { if (location.hash !== '#' + p) location.hash = p; else render(); };
window.addEventListener('hashchange', () => render());

const PUBLIC_ROUTES = ['/connexion', '/activer', '/reinitialiser', '/oubli', '/2fa', '/configurer-2fa', '/parametres'];

async function render() {
  const { path, params } = parseHash();
  if (isNative && !store.getLocal('serverUrl') && path !== '/parametres') return go('/parametres');
  if (!S.meta) { try { S.meta = await api('GET', '/meta'); } catch { S.meta = { committee: 'CER-PROMEDNAV', committeeLongName: '', pieces: {}, statuses: {} }; } }
  if (!PUBLIC_ROUTES.includes(path)) {
    if (!S.token) return go('/connexion');
    if (!S.user) {
      try { S.user = (await api('GET', '/auth/me')).user; } catch (e) {
        if (e.body && e.body.stage === 'mfa') return go('/2fa');
        if (e.body && e.body.stage === 'enroll') return go('/configurer-2fa');
        if (e.status === 0) return renderOffline(e.message);
        return go('/connexion');
      }
      refreshUnread(); startPolling(); registerSW();
    }
    if (!S.gov) { try { S.gov = await api('GET', '/gov/meta'); } catch { S.gov = { fonctions: {}, choices: {}, voting: [] }; } }
  }
  const m = path.match(/^\/dossiers\/(\d+)$/);
  const ms = path.match(/^\/seances\/(\d+)$/);
  try {
    if (path === '/connexion') return viewLogin();
    if (path === '/2fa') return viewMfa();
    if (path === '/configurer-2fa') return viewEnroll();
    if (path === '/activer') return viewActivate(params.get('jeton'));
    if (path === '/oubli') return viewForgot();
    if (path === '/reinitialiser') return viewReset(params.get('jeton'));
    if (path === '/parametres') return viewSettings();
    if (path === '/dossiers') return viewDossiers();
    if (m) return viewDossier(+m[1]);
    if (path === '/notifications') return viewNotifications();
    if (path === '/seances') return viewSeances();
    if (ms) return viewSeance(+ms[1]);
    if (path === '/rapport') return viewRapport();
    if (path === '/demo/courriels' && S.meta.demo) return viewDemoMails();
    if (path === '/profil') return viewProfile();
    if (path === '/admin/membres' && S.user.role === 'admin') return viewMembers();
    if (path === '/admin/journal' && S.user.role === 'admin') return viewAudit();
    if (path === '/admin/conservation' && (S.user.role === 'admin' || S.user.dpd)) return viewConservation();
    if (path === '/admin/nouveau' && S.user.role === 'admin') return viewNewDossier();
    return go('/dossiers');
  } catch (e) {
    shell(path, h('div', { class: 'alert err' }, e.message));
  }
}

function renderOffline(msg) {
  $app.replaceChildren(h('div', { class: 'auth-wrap' }, h('div', { class: 'card auth stack' },
    logoImg('logo'), h('h1', {}, 'Connexion impossible'), h('p', { class: 'alert err' }, msg),
    h('button', { onclick: () => render() }, 'Réessayer'),
    isNative ? h('button', { class: 'secondary', onclick: () => go('/parametres') }, 'Adresse du serveur') : null)));
}

// ===================== Gabarit =====================
const logoImg = (cls) => h('img', { class: cls, src: 'icons/icon-192.png', alt: '' });

function shell(path, ...content) {
  const isAdmin = S.user && S.user.role === 'admin';
  const links = [
    ['/dossiers', 'Dossiers', 'folder'],
    ['/seances', 'Séances', 'calendar'],
    ['/notifications', 'Notifications', 'bell'],
    ['/profil', 'Mon compte', 'user'],
    ...(isAdmin ? [['/admin/membres', 'Administration', 'shield']] : []),
    ...(!isAdmin && S.user.dpd ? [['/admin/conservation', 'Conservation', 'shield']] : []),
  ];
  const cur = (p) => (path === p || (p === '/dossiers' && path.startsWith('/dossiers')) || (p === '/admin/membres' && path.startsWith('/admin')) || (p === '/admin/conservation' && path === '/admin/conservation') || (p === '/seances' && (path.startsWith('/seances') || path === '/rapport')) ? 'page' : null);
  const badge = (p) => (p === '/notifications' && S.unread ? h('span', { class: 'badge-count', 'aria-label': `${S.unread} non lues` }, S.unread) : null);
  const roleLabel = { lecture: 'Lecture seule', ecriture: 'Lecture et écriture', admin: 'Administrateur' };
  $app.replaceChildren(
    h('div', { class: 'shell' },
      h('aside', { class: 'sidebar' },
        h('a', { class: 'brand', href: '#/dossiers' }, logoImg(''), h('span', {}, h('b', {}, 'LeSacAEthique'), h('small', {}, S.meta.committee))),
        h('nav', { class: 'nav', 'aria-label': 'Navigation principale' },
          links.map(([p, label]) => h('a', { href: '#' + p, 'aria-current': cur(p) }, h('span', {}, label), badge(p)))),
        h('div', { class: 'spacer' }),
        h('div', { class: 'who' }, h('div', {}, h('b', {}, S.user.full_name)), h('div', {}, roleLabel[S.user.role]),
          h('button', { class: 'secondary small', onclick: logout }, 'Se déconnecter'))),
      h('div', {},
        h('header', { class: 'topbar' }, logoImg(''), h('div', {}, h('b', {}, 'LeSacAEthique'), h('small', {}, S.meta.committee))),
        h('main', { id: 'main' }, ...content))),
    h('nav', { class: 'tabbar', 'aria-label': 'Navigation' },
      links.map(([p, label, icon]) => h('a', { href: '#' + p, 'aria-current': cur(p) }, svg(ICONS[icon]), label.replace('Administration', 'Admin'), badge(p)))),
  );
  if (S.meta.demo) {
    const main = document.getElementById('main');
    main.prepend(h('div', { class: 'demo-banner' }, h('b', {}, 'DÉMONSTRATION'), ` — données fictives · code de double authentification : ${S.meta.demo.code} · `,
      h('a', { href: '#/demo/courriels' }, 'courriels envoyés'), ' · ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); logout(); } }, 'changer de rôle'), ' · ', h('a', { href: '/formulaire/', target: '_blank', rel: 'noopener' }, 'formulaire du site')));
    main.querySelectorAll('input.otp').forEach((i) => { i.placeholder = `${S.meta.demo.code} (démo)`; });
  }
  window.scrollTo(0, 0);
}

async function logout() {
  try { await api('POST', '/auth/logout'); } catch { /* déjà expirée */ }
  setToken(null); S.user = null; stopPolling();
  go('/connexion');
}

let pollTimer = null;
function startPolling() { stopPolling(); pollTimer = setInterval(refreshUnread, 60000); }
function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }
async function refreshUnread() {
  if (!S.token) return;
  try {
    const r = await api('GET', '/notifications');
    const changed = r.unread !== S.unread;
    S.unread = r.unread;
    if (changed) document.querySelectorAll('a[href="#/notifications"]').forEach((a) => {
      a.querySelector('.badge-count')?.remove();
      if (S.unread) a.append(h('span', { class: 'badge-count' }, S.unread));
    });
    if ('setAppBadge' in navigator) { S.unread ? navigator.setAppBadge(S.unread).catch(() => {}) : navigator.clearAppBadge().catch(() => {}); }
  } catch { /* hors ligne */ }
}

function registerSW() {
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ===================== Formulaires =====================
function field(label, input, hint) {
  const id = input.id || ('f' + Math.random().toString(36).slice(2));
  input.id = id;
  return h('div', { class: 'field' }, h('label', { for: id }, label), input, hint ? h('div', { class: 'hint' }, hint) : null);
}
function formError(form) {
  let box = form.querySelector('.form-error');
  if (!box) { box = h('div', { class: 'alert err form-error', role: 'alert', hidden: true }); form.prepend(box); }
  return (msg) => { box.textContent = msg || ''; box.hidden = !msg; };
}
function submitting(form, fn) {
  return async (e) => {
    e.preventDefault();
    const err = formError(form);
    err('');
    const btns = form.querySelectorAll('button[type=submit]');
    btns.forEach((b) => { b.disabled = true; });
    try { await fn(new FormData(form), e.submitter || null); } catch (ex) { err(ex.message); } finally { btns.forEach((b) => { b.disabled = false; }); }
  };
}
const PW_HINT = '12 caractères minimum, avec majuscule, minuscule, chiffre et caractère spécial.';

function authPage(title, sub, ...body) {
  $app.replaceChildren(h('div', { class: 'auth-wrap' }, h('div', { class: 'card auth' },
    logoImg('logo'), h('h1', {}, title), sub ? h('p', { class: 'sub' }, sub) : null, ...body)));
}

// ===================== Connexion =====================
function viewLogin() {
  if (S.token && S.user) return go('/dossiers');
  const form = h('form', { class: 'stack', novalidate: true },
    field('Adresse électronique', h('input', { name: 'email', type: 'email', autocomplete: 'username', required: true, autofocus: true })),
    field('Mot de passe', h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true })),
    h('button', { type: 'submit' }, 'Se connecter'),
    h('div', { class: 'row between small' },
      h('a', { href: '#/oubli' }, 'Identifiants perdus ?'),
      isNative ? h('a', { href: '#/parametres' }, 'Serveur') : null,
      isDesktop ? h('a', { href: '#', onclick: (e) => { e.preventDefault(); window.lesacaDesktop.resetServer(); } }, 'Changer de serveur') : null));
  form.addEventListener('submit', submitting(form, async (fd) => {
    const r = await api('POST', '/auth/login', { email: fd.get('email'), password: fd.get('password') });
    setToken(r.token);
    go(r.stage === 'mfa' ? '/2fa' : '/configurer-2fa');
  }));
  authPage('LeSacAEthique', `${S.meta.committee} — espace sécurisé des membres`, S.meta.demo ? demoLogin() : null, form);
}

function demoLogin() {
  const box = h('div', { class: 'stack demo-login' },
    h('p', { class: 'alert warn small' }, h('b', {}, 'Version de démonstration. '), 'Données entièrement fictives. Choisissez un rôle pour vous connecter sans mot de passe. Pour signer un vote ou une décision, le code de double authentification est ', h('b', {}, S.meta.demo.code), '.'));
  api('GET', '/demo/accounts').then(({ accounts }) => {
    const FN = { president: 'Président(e)', vice_president: 'Vice-président', titulaire: 'Membre titulaire', suppleant: 'Suppléante', secretariat: 'Secrétariat', consultatif: 'DPD' };
    box.append(h('div', { class: 'demo-accounts' }, accounts.map((a) => h('button', { type: 'button', class: 'secondary', onclick: async () => {
      const r = await api('POST', '/demo/login', { user_id: a.id });
      setToken(r.token); S.user = r.user; refreshUnread(); startPolling(); go('/dossiers');
    } }, h('span', { class: 'demo-acc' }, h('b', {}, a.full_name), h('small', {}, `${FN[a.fonction] || a.fonction}${a.role === 'admin' ? ' · administrateur' : a.role === 'lecture' ? ' · lecture seule' : ''}`))))));
  }).catch(() => {});
  return box;
}

function viewMfa() {
  if (!S.token) return go('/connexion');
  let recovery = false;
  const input = h('input', { name: 'code', class: 'otp', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, required: true, autofocus: true });
  const toggle = h('button', { type: 'button', class: 'ghost' }, 'Utiliser un code de secours');
  toggle.addEventListener('click', () => {
    recovery = !recovery;
    input.value = '';
    input.setAttribute('inputmode', recovery ? 'text' : 'numeric');
    input.maxLength = recovery ? 11 : 6;
    input.placeholder = recovery ? 'XXXXX-XXXXX' : '';
    toggle.textContent = recovery ? 'Utiliser l’application d’authentification' : 'Utiliser un code de secours';
    input.focus();
  });
  const form = h('form', { class: 'stack' },
    field('Code à 6 chiffres de votre application d’authentification', input),
    h('button', { type: 'submit' }, 'Valider'), toggle,
    h('button', { type: 'button', class: 'ghost', onclick: () => { setToken(null); go('/connexion'); } }, 'Annuler'));
  form.addEventListener('submit', submitting(form, async (fd) => {
    const r = await api('POST', '/auth/mfa', { code: String(fd.get('code')).trim() });
    setToken(r.token); S.user = r.user;
    if (r.usedRecoveryCode) toast('Code de secours utilisé : pensez à en régénérer depuis « Mon compte ».');
    refreshUnread(); startPolling(); registerSW();
    go('/dossiers');
  }));
  authPage('Double authentification', 'Deuxième étape de connexion', form);
}

async function viewEnroll() {
  if (!S.token) return go('/connexion');
  authPage('Configurer la double authentification', 'Obligatoire pour accéder aux dossiers', h('p', { class: 'muted' }, 'Préparation…'));
  let r;
  try { r = await api('POST', '/auth/enroll/start'); } catch (e) {
    return authPage('Configurer la double authentification', '', h('p', { class: 'alert err' }, e.message), h('a', { href: '#/connexion' }, 'Retour à la connexion'));
  }
  const form = h('form', { class: 'stack' },
    h('ol', { class: 'small' },
      h('li', {}, 'Installez une application d’authentification sur votre téléphone (FreeOTP, Aegis, Google Authenticator, Microsoft Authenticator, ou votre gestionnaire de mots de passe).'),
      h('li', {}, 'Scannez ce QR code avec l’application.'),
      h('li', {}, 'Saisissez le code à 6 chiffres affiché.')),
    h('img', { class: 'qr', src: r.qr, alt: 'QR code de configuration' }),
    h('details', {}, h('summary', { class: 'small' }, 'Impossible de scanner ? Saisie manuelle'),
      h('p', { class: 'mono' }, r.secret), isNative || /Mobi/.test(navigator.userAgent) ? h('a', { href: r.otpauth, class: 'small' }, 'Ouvrir dans l’application d’authentification de ce téléphone') : null),
    field('Code à 6 chiffres', h('input', { name: 'code', class: 'otp', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, required: true })),
    h('button', { type: 'submit' }, 'Activer'));
  form.addEventListener('submit', submitting(form, async (fd) => {
    const res = await api('POST', '/auth/enroll/confirm', { code: String(fd.get('code')).trim() });
    setToken(res.token); S.user = res.user;
    showRecoveryCodes(res.recoveryCodes, () => { refreshUnread(); startPolling(); registerSW(); go('/dossiers'); });
  }));
  authPage('Configurer la double authentification', 'Obligatoire pour accéder aux dossiers', form);
}

function showRecoveryCodes(codes, onDone) {
  const ack = h('input', { type: 'checkbox', id: 'ack' });
  const btn = h('button', { disabled: true, onclick: onDone }, 'Continuer');
  ack.addEventListener('change', () => { btn.disabled = !ack.checked; });
  const copy = h('button', { class: 'secondary', onclick: async () => { try { await navigator.clipboard.writeText(codes.join('\n')); toast('Codes copiés'); } catch { toast('Copie impossible : notez-les'); } } }, 'Copier');
  authPage('Codes de secours', 'À conserver hors de votre téléphone', h('div', { class: 'stack' },
    h('p', { class: 'alert warn' }, 'Chaque code permet UNE connexion si vous perdez votre téléphone, et sert aussi à réinitialiser votre mot de passe. Ils ne seront plus affichés.'),
    h('div', { class: 'codes' }, codes.map((c) => h('span', {}, c))),
    h('div', { class: 'row' }, copy, h('button', { class: 'secondary', onclick: () => window.print() }, 'Imprimer')),
    h('label', { class: 'check', for: 'ack' }, ack, 'J’ai conservé ces codes en lieu sûr'),
    btn));
}

function viewActivate(token) {
  const form = h('form', { class: 'stack' },
    h('p', { class: 'small muted' }, 'Choisissez votre mot de passe. Vous configurerez ensuite la double authentification.'),
    field('Nouveau mot de passe', h('input', { name: 'password', type: 'password', autocomplete: 'new-password', required: true }), PW_HINT),
    field('Confirmation', h('input', { name: 'confirm', type: 'password', autocomplete: 'new-password', required: true })),
    h('button', { type: 'submit' }, 'Activer mon compte'));
  form.addEventListener('submit', submitting(form, async (fd) => {
    if (fd.get('password') !== fd.get('confirm')) throw new Error('Les deux mots de passe diffèrent');
    const r = await api('POST', '/auth/activate', { token, password: fd.get('password') });
    setToken(r.token);
    go('/configurer-2fa');
  }));
  authPage('Activer votre compte', S.meta.committeeLongName || S.meta.committee, token ? form : h('p', { class: 'alert err' }, 'Lien incomplet.'));
}

function viewForgot() {
  const form = h('form', { class: 'stack' },
    h('p', { class: 'small muted' }, 'Indiquez votre adresse : vous recevrez un lien pour choisir un nouveau mot de passe. Il vous faudra aussi votre application d’authentification ou un code de secours.'),
    field('Adresse électronique', h('input', { name: 'email', type: 'email', autocomplete: 'username', required: true })),
    h('button', { type: 'submit' }, 'Recevoir le lien'),
    h('a', { href: '#/connexion', class: 'small' }, 'Retour à la connexion'),
    h('p', { class: 'small muted' }, 'Téléphone ET codes de secours perdus ? Contactez un administrateur, qui réinitialisera votre double authentification.'));
  form.addEventListener('submit', submitting(form, async (fd) => {
    const r = await api('POST', '/auth/forgot', { email: fd.get('email') });
    form.replaceChildren(h('p', { class: 'alert ok' }, r.message), h('a', { href: '#/connexion' }, 'Retour à la connexion'));
  }));
  authPage('Identifiants perdus', '', form);
}

function viewReset(token) {
  const form = h('form', { class: 'stack' },
    field('Nouveau mot de passe', h('input', { name: 'password', type: 'password', autocomplete: 'new-password', required: true }), PW_HINT),
    field('Confirmation', h('input', { name: 'confirm', type: 'password', autocomplete: 'new-password', required: true })),
    field('Code de l’application d’authentification ou code de secours', h('input', { name: 'code', autocomplete: 'one-time-code', required: true })),
    h('button', { type: 'submit' }, 'Changer le mot de passe'));
  form.addEventListener('submit', submitting(form, async (fd) => {
    if (fd.get('password') !== fd.get('confirm')) throw new Error('Les deux mots de passe diffèrent');
    await api('POST', '/auth/reset', { token, password: fd.get('password'), code: String(fd.get('code')).trim() });
    form.replaceChildren(h('p', { class: 'alert ok' }, 'Mot de passe modifié. Toutes vos sessions ont été fermées.'), h('a', { class: 'btn', href: '#/connexion' }, 'Se connecter'));
  }));
  authPage('Nouveau mot de passe', '', token ? form : h('p', { class: 'alert err' }, 'Lien incomplet.'));
}

function viewSettings() {
  const form = h('form', { class: 'stack' },
    field('Adresse du serveur du comité', h('input', { name: 'url', type: 'url', placeholder: 'https://cer.promednav.fr', value: store.getLocal('serverUrl') || '' }),
      'Fournie par l’administrateur. Connexion chiffrée (https) obligatoire.'),
    h('button', { type: 'submit' }, 'Enregistrer'),
    h('a', { href: '#/connexion', class: 'small' }, 'Retour'));
  form.addEventListener('submit', submitting(form, async (fd) => {
    const url = String(fd.get('url') || '').trim().replace(/\/$/, '');
    if (url && !/^https:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(url)) throw new Error('L’adresse doit commencer par https://');
    store.setLocal('serverUrl', url || null);
    S.meta = null;
    const res = await fetch(url + '/api/health').catch(() => null);
    if (!res || !res.ok) throw new Error('Serveur injoignable à cette adresse');
    toast('Serveur enregistré'); go('/connexion');
  }));
  authPage('Paramètres', 'Applications ordinateur, Android et iOS', form);
}

// ===================== Dossiers =====================
const statusPill = (s) => h('span', { class: `pill s-${s}` }, S.meta.statuses[s] || s);

async function viewDossiers() {
  shell('/dossiers', h('p', { class: 'muted' }, 'Chargement…'));
  const { dossiers } = await api('GET', '/dossiers');
  const list = h('div', { class: 'dossiers' });
  const search = h('input', { type: 'search', placeholder: 'Rechercher (référence, titre, porteur)…', 'aria-label': 'Rechercher' });
  const statusSel = h('select', { 'aria-label': 'Filtrer par statut' }, h('option', { value: '' }, 'Tous les statuts'),
    Object.entries(S.meta.statuses).map(([k, v]) => h('option', { value: k }, v)));
  const draw = () => {
    const t = search.value.toLowerCase(); const s = statusSel.value;
    const rows = dossiers.filter((d) => (!s || d.status === s) && (!t || [d.reference, d.title, d.applicant_name].join(' ').toLowerCase().includes(t)));
    list.replaceChildren(...(rows.length ? rows.map(dossierCard) : [h('p', { class: 'empty' }, dossiers.length ? 'Aucun dossier ne correspond.' : 'Aucun dossier pour l’instant. Les demandes déposées sur le site apparaîtront ici.')]));
  };
  search.addEventListener('input', draw); statusSel.addEventListener('change', draw);
  draw();
  shell('/dossiers',
    h('div', { class: 'row between' }, h('h1', {}, 'Dossiers'),
      S.user.role === 'admin' ? h('a', { class: 'btn secondary', href: '#/admin/nouveau' }, '+ Saisir une demande reçue hors site') : null),
    h('div', { class: 'filters' }, search, statusSel), list);
}

function dossierCard(d) {
  if (d.recused) {
    return h('div', { class: 'card' }, h('div', { class: 'row between' }, h('span', { class: 'ref' }, d.reference), statusPill(d.status)),
      h('p', { class: 'small muted' }, 'Vous vous êtes déporté(e) sur ce dossier (conflit d’intérêts).'));
  }
  return h('a', { class: 'dossier-item', href: `#/dossiers/${d.id}` }, h('div', { class: 'card' },
    h('div', { class: 'row between' }, h('span', { class: 'ref' }, d.reference),
      h('span', { class: 'row' }, d.kind === 'appel' ? h('span', { class: 'pill appel' }, `Appel de ${d.parent_reference}`) : null,
        d.related_reference ? h('span', { class: 'pill' }, `Appel hors délai de ${d.related_reference}`) : null,
        d.never_opened ? h('span', { class: 'pill new' }, 'Nouveau') : null,
        d.unread ? h('span', { class: 'pill new' }, `${d.unread} message${d.unread > 1 ? 's' : ''} non lu${d.unread > 1 ? 's' : ''}`) : null,
        statusPill(d.status))),
    h('h2', {}, d.title),
    h('div', { class: 'meta' }, h('span', {}, d.applicant_name), h('span', {}, `Déposé le ${fmtDate(d.created_at, false)}`),
      h('span', {}, `${d.documents} document${d.documents > 1 ? 's' : ''}`), h('span', {}, `${d.comments} commentaire${d.comments > 1 ? 's' : ''}`),
      d.procedure === 'simplifiee' ? h('span', {}, 'Procédure simplifiée') : null)));
}

async function viewDossier(id) {
  shell('/dossiers', h('p', { class: 'muted' }, 'Chargement…'));
  let data;
  try { data = await api('GET', `/dossiers/${id}`); } catch (e) {
    return shell('/dossiers', h('a', { href: '#/dossiers' }, '← Dossiers'), h('p', { class: e.body && e.body.recused ? 'alert warn' : 'alert err' }, e.message));
  }
  const { dossier: d, documents, comments, events, conflicts, lastReadCommentId, canWrite, isAdmin, canManage, isRapporteur, closed, initial, appeal, appealOf, retention } = data;
  const extra = isAdmin ? await Promise.all([api('GET', '/gov/membres'), api('GET', '/gov/seances')]).catch(() => null) : null;
  const docsById = Object.fromEntries(documents.map((x) => [x.id, x]));
  refreshUnread();

  // --- Documents ---
  const byPiece = {};
  for (const doc of documents) (byPiece[doc.piece] ||= []).push(doc);
  const docList = h('ul', { class: 'doc-list' }, Object.keys(S.meta.pieces).filter((p) => byPiece[p]).flatMap((p) => byPiece[p].map((doc) =>
    h('li', {}, h('button', { onclick: () => openDocument(d, doc) },
      h('span', { class: 'doc-icon' }, (doc.original_name.split('.').pop() || '').toUpperCase().slice(0, 4)),
      h('span', {}, doc.original_name, doc.version > 1 ? ` (v${doc.version})` : '',
        h('span', { class: 'piece' }, `${p === 'autre' || p === 'anterieur' ? '' : `Pièce ${p}) — `}${S.meta.pieces[p]} · ${fmtSize(doc.size)} · ${fmtDate(doc.uploaded_at)}`),
        doc.label ? h('span', { class: `piece${doc.label.startsWith('Copie') ? ' copy' : ''}` }, doc.label) : null))))));

  const missing = d.kind === 'appel' ? [] : Object.keys(S.meta.pieces).filter((p) => ['a', 'b', 'c', 'd', 'e', 'g', 'h'].includes(p) && !byPiece[p]);

  // --- Fil de discussion ---
  const children = {};
  for (const c of comments) (children[c.parent_id || 0] ||= []).push(c);
  const renderThread = (parentId) => {
    const items = children[parentId] || [];
    if (!items.length) return null;
    return h('ul', { class: 'thread' }, items.map((c) => h('li', {}, commentCard(c), renderThread(c.id))));
  };
  const commentCard = (c) => {
    const replyBox = h('div', { class: 'reply-box' });
    const doc = c.document_id ? docsById[c.document_id] : null;
    return h('article', { class: `comment${c.id > lastReadCommentId && c.author_id !== S.user.id ? ' is-new' : ''}`, id: `c${c.id}` },
      h('header', {}, h('b', {}, c.author_name), h('span', { class: 'quality' }, c.author_quality),
        c.kind === 'rapport' ? h('span', { class: 'pill s-recevable' }, 'Rapport de rapporteur') : null,
        c.id > lastReadCommentId && c.author_id !== S.user.id ? h('span', { class: 'pill new' }, 'Nouveau') : null,
        h('time', { datetime: new Date(c.created_at).toISOString() }, fmtDate(c.created_at))),
      doc ? h('span', { class: 'doc-chip' }, `À propos de : ${doc.original_name}${doc.version > 1 ? ` (v${doc.version})` : ''}`) : null,
      h('div', { class: 'body' }, c.body),
      h('footer', {},
        h('span', { class: 'sig', title: `Empreinte SHA-256 : ${c.hash}\nSignature Ed25519 du serveur : ${c.signature}` }, svg(ICONS.lock), `Signé par ${c.author_name} · n° ${c.id} · ${c.hash.slice(0, 10)}…`),
        canWrite ? h('button', { class: 'ghost small', onclick: () => {
          if (replyBox.firstChild) { replyBox.replaceChildren(); return; }
          replyBox.append(composer({ parentId: c.id, label: `Répondre à ${c.author_name} ou compléter`, onDone: () => viewDossier(id) }));
          replyBox.querySelector('textarea').focus();
        } }, 'Répondre / compléter') : null),
      replyBox);
  };

  function composer({ parentId = null, label, onDone }) {
    const docSel = h('select', { name: 'document_id' }, h('option', { value: '' }, 'Commentaire général sur le dossier'),
      documents.map((x) => h('option', { value: x.id }, `${x.original_name}${x.version > 1 ? ` (v${x.version})` : ''}`)));
    const form = h('form', { class: 'card stack' },
      h('label', { for: `ta${parentId || 0}` }, label),
      h('textarea', { id: `ta${parentId || 0}`, name: 'body', required: true, maxlength: 20000, placeholder: 'Votre commentaire…' }),
      parentId ? null : field('Document concerné', docSel),
      !parentId && isRapporteur ? h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'as_rapport' }), 'Publier comme mon rapport de rapporteur (art. 28)') : null,
      h('p', { class: 'hint' }, `Publié sous votre nom (${S.user.full_name}${S.user.quality ? ', ' + S.user.quality : ''}), horodaté et signé. Un commentaire publié ne peut plus être ni modifié ni supprimé : vous pourrez seulement y répondre ou le compléter.`),
      h('div', { class: 'row' }, h('button', { type: 'submit' }, 'Publier définitivement')));
    form.addEventListener('submit', submitting(form, async (fd) => {
      const body = String(fd.get('body') || '').trim();
      if (!body) throw new Error('Commentaire vide');
      if (!confirm('Publier ce commentaire ? Il ne pourra plus être modifié ni supprimé.')) return;
      await api('POST', `/dossiers/${id}/comments`, { body, parent_id: parentId, document_id: fd.get('document_id') ? +fd.get('document_id') : null, as_rapport: !!fd.get('as_rapport') });
      toast('Commentaire publié');
      onDone();
    }));
    return form;
  }

  // --- Administration du dossier ---
  let adminBox = null;
  if (canManage) {
    const st = h('select', { name: 'status' }, Object.entries(S.meta.statuses).filter(([k]) => isAdmin || !(k.startsWith('avis_') || k === 'incompetence') || k === d.status).map(([k, v]) => h('option', { value: k, selected: k === d.status }, v)));
    const proc = h('select', { name: 'procedure' }, h('option', { value: 'ordinaire', selected: d.procedure === 'ordinaire' }, 'Ordinaire'), h('option', { value: 'simplifiee', selected: d.procedure === 'simplifiee' }, 'Simplifiée (art. 30)'));
    const f1 = h('form', { class: 'stack' }, field('Statut', st), field('Procédure', proc), field('Note (historique)', h('input', { name: 'note', maxlength: 1000 })),
      h('button', { type: 'submit', class: 'secondary' }, 'Enregistrer'));
    f1.addEventListener('submit', submitting(f1, async (fd) => {
      await api('PATCH', `/dossiers/${id}`, { status: fd.get('status'), procedure: fd.get('procedure'), note: fd.get('note') });
      toast('Dossier mis à jour'); viewDossier(id);
    }));
    const f2 = h('form', { class: 'stack' },
      field('Pièce', h('select', { name: 'piece' }, Object.entries(S.meta.pieces).map(([k, v]) => h('option', { value: k }, `${k === 'autre' ? '' : k + ') '}${v}`)))),
      field('Fichier(s)', h('input', { type: 'file', name: 'files', multiple: true, required: true, accept: '.pdf,.doc,.docx,.odt,.xls,.xlsx,.ods,.txt,.png,.jpg,.jpeg' }),
        'Un fichier de même nom devient une nouvelle version ; l’ancienne reste consultable.'),
      h('button', { type: 'submit', class: 'secondary' }, 'Ajouter'));
    f2.addEventListener('submit', submitting(f2, async (fd) => {
      await api('POST', `/dossiers/${id}/documents`, fd);
      toast('Document ajouté'); viewDossier(id);
    }));
    adminBox = h('details', { class: 'card' }, h('summary', {}, 'Administration du dossier'), h('div', { class: 'stack', style: null }, h('h3', {}, 'Statut'), f1, h('h3', {}, 'Ajouter un document'), f2));
  }

  const recuse = h('button', { class: 'secondary small', onclick: async () => {
    const reason = prompt('Déclarer un conflit d’intérêts sur ce dossier (art. 4.2).\nVous n’y aurez plus accès et ne participerez ni à l’instruction, ni aux débats.\n\nNature du conflit :');
    if (!reason) return;
    try { await api('POST', `/dossiers/${id}/conflicts`, { reason }); toast('Déport enregistré'); go('/dossiers'); } catch (e) { toast(e.message); }
  } }, 'Déclarer un conflit d’intérêts');

  shell('/dossiers',
    h('a', { href: '#/dossiers', class: 'small' }, '← Dossiers'),
    h('div', { class: 'row between', style: null }, h('div', {}, h('div', { class: 'ref muted small' }, d.reference), h('h1', {}, d.title)), statusPill(d.status)),
    d.kind === 'appel' ? h('div', { class: 'alert appel stack' },
      h('p', {}, h('b', {}, 'Procédure d’appel'), ` de l’avis rendu sur le dossier `, h('a', { href: `#/dossiers/${initial.id}` }, initial.reference),
        `, formé le ${fmtDate(d.created_at, false)} par ${d.appeal_requester} (${d.appeal_role === 'president_association' ? 'président de l’association' : 'porteur du projet'}, ${d.appeal_requester_email}).`),
      h('p', { class: 'small' }, 'Examen en séance plénière, par des rapporteurs différents de ceux du dossier initial. Les copies du dossier initial figurent dans les documents (pièce « Dossier initial »).')) : null,
    d.related_reference ? h('p', { class: 'alert warn small' }, `Appel formé hors délai contre l’avis du dossier ${d.related_reference} : enregistré comme une nouvelle demande, sans reprise du dossier initial.`) : null,
    retention && retention.destroyed ? h('p', { class: 'alert warn' }, `Dossier détruit en fin de conservation le ${fmtDate(retention.destroyed)}. Seuls la référence, les avis conservés et le certificat de destruction subsistent.`) : null,
    closed ? h('p', { class: 'alert ok' }, `Procédure close et dossier archivé le ${fmtDate(closed.at)} par ${closed.by}. Le dossier est en lecture seule ; le relevé de clôture figure dans les actes.`) : null,
    h('div', { class: 'dossier-grid' },
      h('div', { class: 'stack' },
        h('section', { class: 'card' }, h('h2', {}, 'Demande'),
          h('dl', { class: 'kv' },
            h('dt', {}, 'Porteur'), h('dd', {}, d.applicant_name),
            h('dt', {}, 'Courriel'), h('dd', {}, h('a', { href: `mailto:${d.applicant_email}` }, d.applicant_email)),
            d.applicant_affiliation ? [h('dt', {}, 'Établissement'), h('dd', {}, d.applicant_affiliation)] : null,
            d.investigator ? [h('dt', {}, 'Investigateur'), h('dd', {}, d.investigator)] : null,
            h('dt', {}, 'Qualification'), h('dd', {}, d.qualification),
            d.qualification_reason ? [h('dt', {}, 'Justification'), h('dd', {}, d.qualification_reason)] : null,
            d.funding ? [h('dt', {}, 'Financement'), h('dd', {}, d.funding)] : null,
            h('dt', {}, 'Dépôt'), h('dd', {}, fmtDate(d.created_at)),
            h('dt', {}, 'Procédure'), h('dd', {}, d.procedure === 'simplifiee' ? 'Simplifiée' : 'Ordinaire')),
          d.summary ? h('details', {}, h('summary', {}, 'Résumé'), h('p', { class: 'body', style: null }, d.summary)) : null),
        h('section', { class: 'card' }, h('h2', {}, `Documents (${documents.length})`),
          documents.length ? docList : h('p', { class: 'muted' }, 'Aucun document.'),
          missing.length ? h('p', { class: 'alert warn small' }, `Pièces de l’annexe 3 non fournies : ${missing.join(', ')}.`) : null),
        conflicts.length ? h('section', { class: 'card small' }, h('h3', {}, 'Membres déportés'), h('ul', {}, conflicts.map((c) => h('li', {}, `${c.full_name}${c.quality ? ' (' + c.quality + ')' : ''} — ${fmtDate(c.declared_at, false)}`)))) : null,
        h('details', { class: 'card small' }, h('summary', {}, 'Historique du dossier'),
          h('ul', {}, events.map((e) => h('li', {}, `${fmtDate(e.at)} — ${e.details}${e.full_name ? ' (' + e.full_name + ')' : ''}`)))),
        appeal && !(retention && retention.destroyed) ? receptionCard(data, id) : null,
        retention && closed && (canManage || isAdmin || S.user.fonction === 'secretariat' || S.user.dpd) ? conservationCard(data, id) : null,
        ...govSections(data, extra, id),
        adminBox,
        closed ? null : recuse),
      h('section', { class: 'stack', 'aria-label': 'Discussion' },
        initial ? initialSection(initial) : null,
        h('div', { class: 'row between' }, h('h2', {}, `Discussion (${comments.length})`),
          !canWrite ? h('span', { class: 'pill' }, 'Lecture seule') : null),
        comments.length ? renderThread(0) : h('p', { class: 'empty card' }, 'Aucun commentaire. ' + (canWrite ? 'Soyez le premier à donner votre analyse.' : '')),
        canWrite ? h('div', { class: 'composer' }, composer({ label: 'Nouveau commentaire', onDone: () => viewDossier(id) })) : null)));
  const firstNew = document.querySelector('.comment.is-new');
  if (firstNew) firstNew.scrollIntoView({ block: 'center' });
}

function openDocument(d, doc) {
  return openBlobViewer(doc.original_name, `/dossiers/${d.id}/documents/${doc.id}/content`, doc.mime, doc.sha256);
}

async function openBlobViewer(name, apiPath, mime, sha256) {
  const doc = { original_name: name, mime, sha256 };
  const body = h('div', { class: 'dlg-body viewer' }, h('p', { class: 'muted' }, 'Déchiffrement et chargement…'));
  let url = null;
  const dlg = h('dialog', { 'aria-label': doc.original_name },
    h('div', { class: 'dlg-head' }, h('b', {}, doc.original_name),
      h('button', { class: 'secondary small', onclick: () => download() }, 'Télécharger'),
      h('button', { class: 'small', onclick: () => dlg.close() }, 'Fermer')),
    body);
  dlg.addEventListener('close', () => { if (url) URL.revokeObjectURL(url); dlg.remove(); });
  document.body.append(dlg);
  dlg.showModal();
  async function fetchBlob(dl) {
    const r = await api('GET', `${apiPath}${dl ? '?download=1' : ''}`, undefined, { raw: true });
    return r.blob();
  }
  async function download() {
    try {
      const blob = await fetchBlob(true);
      const a = h('a', { href: URL.createObjectURL(blob), download: doc.original_name });
      document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    } catch (e) { toast(e.message); }
  }
  try {
    const blob = await fetchBlob(false);
    url = URL.createObjectURL(blob);
    if (doc.mime === 'application/pdf') body.replaceChildren(h('iframe', { src: url, title: doc.original_name }),
      h('p', { class: 'hint' }, 'Sur iPhone/iPad, si le document n’apparaît qu’en partie, utilisez « Télécharger ».'));
    else if (doc.mime.startsWith('image/')) body.replaceChildren(h('img', { src: url, alt: doc.original_name }));
    else if (doc.mime === 'text/plain') body.replaceChildren(h('pre', {}, await blob.text()));
    else body.replaceChildren(h('p', {}, 'Aperçu non disponible pour ce format (Word, tableur…).'), h('button', { onclick: download }, 'Télécharger le document'));
    body.append(h('p', { class: 'hint mono' }, `SHA-256 : ${doc.sha256}`));
  } catch (e) { body.replaceChildren(h('p', { class: 'alert err' }, e.message)); }
}

// ===================== Saisie manuelle (admin) =====================
function viewNewDossier() {
  const form = h('form', { class: 'card stack' },
    field('Titre du projet', h('input', { name: 'title', required: true, maxlength: 300 })),
    field('Porteur', h('input', { name: 'applicant_name', required: true })),
    field('Courriel du porteur', h('input', { name: 'applicant_email', type: 'email', required: true })),
    field('Établissement', h('input', { name: 'applicant_affiliation' })),
    field('Qualification réglementaire', h('select', { name: 'qualification' }, h('option', { value: 'RNIPH' }, 'RNIPH'), h('option', { value: 'Autre (question éthique, registre…)' }, 'Autre (question éthique, registre…)'))),
    field('Justification', h('textarea', { name: 'qualification_reason' })),
    field('Résumé', h('textarea', { name: 'summary' })),
    h('button', { type: 'submit' }, 'Créer le dossier'));
  form.addEventListener('submit', submitting(form, async (fd) => {
    const r = await api('POST', '/dossiers', Object.fromEntries(fd));
    toast(`Dossier ${r.dossier.reference} créé — ajoutez les documents`);
    go(`/dossiers/${r.dossier.id}`);
  }));
  shell('/admin/nouveau', h('a', { href: '#/dossiers', class: 'small' }, '← Dossiers'), h('h1', {}, 'Saisir une demande reçue hors site'),
    h('p', { class: 'muted' }, 'Pour une demande reçue par courrier ou courriel. Les membres sont notifiés à la création.'), form);
}

// ===================== Notifications =====================
async function viewNotifications() {
  const { notifications } = await api('GET', '/notifications');
  await api('POST', '/notifications/read');
  S.unread = 0;
  const pushBox = h('div');
  shell('/notifications', h('h1', {}, 'Notifications'), pushBox,
    notifications.length ? h('div', { class: 'stack' }, notifications.map((n) => h('a', { class: 'dossier-item', href: `#/dossiers/${n.dossier_id}` },
      h('div', { class: 'card row between' }, h('span', {}, n.read_at ? null : h('span', { class: 'pill new' }, 'Nouveau'), ' ', n.message), h('span', { class: 'small muted' }, fmtDate(n.created_at))))))
      : h('p', { class: 'empty' }, 'Aucune notification.'));
  pushSetup(pushBox);
}

async function pushSetup(box) {
  if (!S.meta.pushPublicKey || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    if (/iPhone|iPad/.test(navigator.userAgent) && !window.matchMedia('(display-mode: standalone)').matches) {
      box.replaceChildren(h('p', { class: 'alert warn small' }, 'Sur iPhone/iPad : ajoutez l’application à l’écran d’accueil (Partager → « Sur l’écran d’accueil ») pour recevoir les notifications.'));
    }
    return;
  }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  const btn = h('button', { class: 'secondary small' }, sub ? 'Désactiver les notifications sur cet appareil' : 'Activer les notifications sur cet appareil');
  btn.addEventListener('click', async () => {
    try {
      if (sub) {
        await api('POST', '/notifications/push/unsubscribe', { endpoint: sub.endpoint });
        await sub.unsubscribe(); toast('Notifications désactivées');
      } else {
        if (await Notification.requestPermission() !== 'granted') return toast('Autorisation refusée');
        const key = Uint8Array.from(atob(S.meta.pushPublicKey.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((S.meta.pushPublicKey.length + 3) % 4)), (c) => c.charCodeAt(0));
        const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        await api('POST', '/notifications/push/subscribe', s.toJSON()); toast('Notifications activées');
      }
      pushSetup(box);
    } catch (e) { toast(e.message); }
  });
  box.replaceChildren(h('div', { class: 'card row between' }, h('span', { class: 'small' }, 'Notifications instantanées (téléphone, tablette, ordinateur)'), btn));
}

// ===================== Mon compte =====================
async function viewProfile() {
  const u = (await api('GET', '/auth/me')).user; S.user = u;
  const pw = h('form', { class: 'card stack' }, h('h2', {}, 'Mot de passe'),
    field('Mot de passe actuel', h('input', { name: 'current', type: 'password', autocomplete: 'current-password', required: true })),
    field('Nouveau mot de passe', h('input', { name: 'password', type: 'password', autocomplete: 'new-password', required: true }), PW_HINT),
    field('Confirmation', h('input', { name: 'confirm', type: 'password', autocomplete: 'new-password', required: true })),
    h('button', { type: 'submit' }, 'Changer'));
  pw.addEventListener('submit', submitting(pw, async (fd) => {
    if (fd.get('password') !== fd.get('confirm')) throw new Error('Les deux mots de passe diffèrent');
    await api('POST', '/auth/password', { current: fd.get('current'), password: fd.get('password') });
    pw.reset(); toast('Mot de passe modifié ; vos autres sessions sont fermées');
  }));
  const rc = h('form', { class: 'card stack' }, h('h2', {}, 'Double authentification'),
    h('p', { class: 'small' }, `Active. Codes de secours restants : ${u.recovery_codes_left} / 10.`),
    field('Code actuel de votre application', h('input', { name: 'code', class: 'otp', inputmode: 'numeric', maxlength: 11, required: true })),
    h('div', { class: 'row' }, h('button', { type: 'submit', name: 'act', value: 'codes' }, 'Régénérer les codes de secours'),
      h('button', { type: 'submit', name: 'act', value: 'device', class: 'secondary' }, 'Changer de téléphone')));
  rc.addEventListener('submit', submitting(rc, async (fd, submitter) => {
    const act = submitter && submitter.value;
    if (act === 'device') {
      if (!confirm('Votre ancien téléphone ne fonctionnera plus. Continuer ?')) return;
      await api('POST', '/auth/enroll/start', { code: String(fd.get('code')).trim() });
      return go('/configurer-2fa');
    }
    const r = await api('POST', '/auth/recovery-codes', { code: String(fd.get('code')).trim() });
    showRecoveryCodes(r.recoveryCodes, () => go('/profil'));
  }));
  const prefs = h('form', { class: 'card stack' }, h('h2', {}, 'Courriels de notification'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'notify_email', checked: u.notify_email }), 'Recevoir un courriel à chaque nouvelle demande ou nouveau document'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'notify_comments', checked: u.notify_comments }), 'Recevoir un courriel à chaque nouveau commentaire'),
    h('p', { class: 'hint' }, 'Les courriels ne contiennent jamais le contenu des dossiers, seulement leur référence.'),
    h('button', { type: 'submit', class: 'secondary' }, 'Enregistrer'));
  prefs.addEventListener('submit', submitting(prefs, async (fd) => {
    S.user = (await api('PATCH', '/auth/preferences', { notify_email: !!fd.get('notify_email'), notify_comments: !!fd.get('notify_comments') })).user;
    toast('Préférences enregistrées');
  }));
  const pushBox = h('div');
  const roleLabel = { lecture: 'Lecture seule', ecriture: 'Lecture et écriture', admin: 'Administrateur' };
  shell('/profil', h('h1', {}, 'Mon compte'),
    h('div', { class: 'card' }, h('dl', { class: 'kv' }, h('dt', {}, 'Nom (signature)'), h('dd', {}, u.full_name), h('dt', {}, 'Qualité'), h('dd', {}, u.quality || '—'),
      h('dt', {}, 'Identifiant'), h('dd', {}, u.email), h('dt', {}, 'Droits'), h('dd', {}, roleLabel[u.role]),
      h('dt', {}, 'Dernière connexion'), h('dd', {}, u.last_login_at ? fmtDate(u.last_login_at) : '—')),
      h('p', { class: 'hint' }, 'Nom, qualité et droits sont fixés par un administrateur.')),
    pushBox, pw, rc, prefs,
    isNative ? h('a', { href: '#/parametres', class: 'small' }, 'Adresse du serveur') : null);
  pushSetup(pushBox);
}

// ===================== Administration =====================
async function viewMembers(pendingLink = null) {
  const { users } = await api('GET', '/users');
  const roleSel = (val, name = 'role') => h('select', { name }, h('option', { value: 'lecture', selected: val === 'lecture' }, 'Lecture seule'),
    h('option', { value: 'ecriture', selected: val === 'ecriture' }, 'Lecture et écriture'), h('option', { value: 'admin', selected: val === 'admin' }, 'Administrateur (président ou vice-président)'));
  const fnSel = (val, name = 'fonction') => h('select', { name }, Object.entries(S.gov.fonctions).map(([k, v]) => h('option', { value: k, selected: k === val }, v)));
  const linkBox = h('div');
  const showLink = (link) => {
    if (!link) return;
    linkBox.replaceChildren(h('div', { class: 'alert warn stack' },
      h('p', {}, 'Aucun serveur de courriel n’est configuré : transmettez ce lien d’activation au membre par un canal sûr (il est à usage unique).'),
      h('p', { class: 'mono' }, link),
      h('button', { class: 'secondary small', onclick: () => navigator.clipboard.writeText(link).then(() => toast('Lien copié')) }, 'Copier le lien')));
  };
  const create = h('form', { class: 'card stack' }, h('h2', {}, 'Ajouter un membre'),
    field('Nom complet (signera ses commentaires)', h('input', { name: 'full_name', required: true })),
    field('Qualité', h('input', { name: 'quality', placeholder: 'ex. Médecin hyperbare, Juriste, Représentant des usagers…' })),
    field('Adresse électronique (identifiant)', h('input', { name: 'email', type: 'email', required: true })),
    field('Fonction au sein du comité', fnSel('titulaire')),
    field('Droits dans l’outil', roleSel('ecriture')),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'health_professional', checked: true }), 'Exerce une profession de santé (art. 28.1 et 29.2)'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'independent' }), 'Membre indépendant de l’association : ne siège ni au CA ni au CE (art. 25.1)'),
    h('p', { class: 'hint' }, 'Le membre reçoit un lien pour choisir son mot de passe et configurer la double authentification. Vous ne connaissez jamais son mot de passe.'),
    h('button', { type: 'submit' }, 'Créer et envoyer l’invitation'));
  create.addEventListener('submit', submitting(create, async (fd) => {
    const r = await api('POST', '/users', { ...Object.fromEntries(fd), health_professional: !!fd.get('health_professional'), independent: !!fd.get('independent') });
    toast(`Invitation envoyée à ${r.user.email}`);
    await viewMembers(r.invitationLink);
  }));
  const statusLabel = { invite: 'Invitation en attente', actif: 'Actif', suspendu: 'Suspendu' };
  const cards = users.map((u) => {
    const rs = roleSel(u.role);
    rs.addEventListener('change', async () => {
      try { await api('PATCH', `/users/${u.id}`, { role: rs.value }); toast('Droits modifiés'); } catch (e) { toast(e.message); rs.value = u.role; }
    });
    const fs = fnSel(u.fonction);
    fs.addEventListener('change', async () => {
      try { await api('PATCH', `/users/${u.id}`, { fonction: fs.value }); toast('Fonction modifiée'); } catch (e) { toast(e.message); fs.value = u.fonction; }
    });
    const flag = (key, label) => {
      const cb = h('input', { type: 'checkbox', checked: u[key] });
      cb.addEventListener('change', async () => { try { await api('PATCH', `/users/${u.id}`, { [key]: cb.checked }); toast('Enregistré'); } catch (e) { toast(e.message); cb.checked = !cb.checked; } });
      return h('label', { class: 'check small' }, cb, label);
    };
    const act = (label, fn, cls = 'secondary small') => h('button', { class: cls, onclick: async () => { try { await fn(); } catch (e) { toast(e.message); } } }, label);
    return h('div', { class: 'card member-card' },
      h('div', {}, h('b', {}, u.full_name), u.id === S.user.id ? ' (vous)' : '', h('div', { class: 'small muted' }, `${u.quality || '—'} · ${u.email}`),
        h('div', { class: 'small' }, h('span', { class: 'pill' }, statusLabel[u.status]), ' ', u.totp_enabled ? '2FA active' : '2FA non configurée',
          u.last_login_at ? ` · dernière connexion ${fmtDate(u.last_login_at)}` : '')),
      h('div', { class: 'stack' }, fs, rs, flag('health_professional', 'Profession de santé'), flag('independent', 'Indépendant de l’association'), flag('dpd', 'Délégué à la protection des données'), h('div', { class: 'row' },
        u.status === 'actif' ? act('Suspendre', async () => { if (confirm(`Suspendre ${u.full_name} ? Ses sessions seront fermées.`)) { await api('PATCH', `/users/${u.id}`, { status: 'suspendu' }); viewMembers(); } }) : null,
        u.status === 'suspendu' && u.totp_enabled ? act('Réactiver', async () => { await api('PATCH', `/users/${u.id}`, { status: 'actif' }); viewMembers(); }) : null,
        act(u.status === 'invite' ? 'Renvoyer l’invitation' : 'Nouvelle invitation', async () => {
          if (u.status !== 'invite' && !confirm('Le mot de passe et la double authentification actuels seront annulés. Continuer ?')) return;
          const r = await api('POST', `/users/${u.id}/invitation`); toast('Invitation envoyée'); await viewMembers(r.invitationLink);
        }),
        u.totp_enabled ? act('Réinitialiser la 2FA', async () => { if (confirm(`À faire uniquement si ${u.full_name} a perdu son téléphone ET ses codes de secours, après avoir vérifié son identité. Continuer ?`)) { await api('POST', `/users/${u.id}/reset-2fa`); toast('Double authentification réinitialisée'); viewMembers(); } }) : null)));
  });
  shell('/admin/membres',
    h('div', { class: 'row between' }, h('h1', {}, 'Membres et droits'), h('div', { class: 'row' }, h('a', { class: 'btn secondary', href: '#/admin/conservation' }, 'Conservation'), h('a', { class: 'btn secondary', href: '#/admin/journal' }, 'Journal et intégrité'))),
    linkBox, h('div', { class: 'stack' }, cards), create);
  showLink(pendingLink);
}

async function viewAudit() {
  const [{ entries }, { checks }] = await Promise.all([api('GET', '/users/audit/log?limit=500'), api('GET', '/gov/integrite')]);
  const res = h('div');
  const check = h('button', { class: 'secondary', onclick: async () => {
    res.replaceChildren(h('p', { class: 'muted' }, 'Vérification…'));
    const r = await api('POST', '/gov/integrite');
    res.replaceChildren(h('div', { class: `alert ${r.ok ? 'ok' : 'err'}` },
      h('p', {}, r.ok ? `Contrôle n° ${r.checkId} conforme : ${r.comments} commentaires (chaîne d’empreintes et signatures), ${r.documents} documents, ${r.ballots} bulletins, ${r.actes} actes.` : `Contrôle n° ${r.checkId} — ANOMALIES DÉTECTÉES :`),
      h('p', { class: 'mono' }, `Empreinte de référence : ${r.lastHash}`),
      r.ok ? null : h('ul', {}, r.problems.map((p) => h('li', {}, p))),
      h('details', {}, h('summary', { class: 'small' }, 'Clé publique de signature du serveur'), h('pre', { class: 'mono' }, r.publicKey))));
  } }, 'Vérifier l’intégrité des commentaires et documents');
  shell('/admin/journal', h('a', { href: '#/admin/membres', class: 'small' }, '← Membres'), h('h1', {}, 'Journal et intégrité'),
    h('div', { class: 'card stack' }, h('p', { class: 'small' }, 'Le journal (connexions, consultations, téléchargements, actions d’administration) est en ajout seul. Le règlement intérieur prévoit une analyse au moins tous les deux mois (art. 52). Un contrôle d’intégrité est aussi effectué automatiquement avant chaque validation de vote et chaque clôture de séance.'), check, res),
    h('details', { class: 'card table-wrap' }, h('summary', {}, `Historique des contrôles d’intégrité (${checks.length})`), h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'N°'), h('th', {}, 'Date'), h('th', {}, 'Par'), h('th', {}, 'Objet'), h('th', {}, 'Résultat'), h('th', {}, 'Empreinte'))),
      h('tbody', {}, checks.map((c) => h('tr', {}, h('td', {}, c.id), h('td', {}, fmtDate(c.at)), h('td', {}, c.full_name || '—'), h('td', {}, c.purpose), h('td', {}, c.ok ? 'Conforme' : 'NON CONFORME'), h('td', { class: 'mono' }, c.last_hash.slice(0, 16) + '…')))))),
    h('div', { class: 'card table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Date'), h('th', {}, 'Personne'), h('th', {}, 'Action'), h('th', {}, 'Objet'), h('th', {}, 'IP'))),
      h('tbody', {}, entries.map((e) => h('tr', {}, h('td', {}, fmtDate(e.at)), h('td', {}, e.full_name || '—'), h('td', {}, e.action.replace(/_/g, ' ')), h('td', {}, e.target), h('td', { class: 'mono' }, e.ip)))))));
}


// ===================== Instruction et délibération =====================
const CH = () => S.gov.choices;
const ACTE_TYPES = { avis: 'Avis', pv: 'Procès-verbal', rapport_annuel: 'Rapport annuel', rapport_validation: 'Rapport de validation de signature', cloture: 'Relevé de clôture et d’archivage' };
const MODE = { presentiel: 'Présentiel', visio: 'Visioconférence', electronique: 'Délibération par voie électronique' };
const DECISIONS = ['favorable', 'favorable_reserve', 'modifications', 'defavorable', 'incompetence'];
const actBtn = (label, fn, cls = 'secondary small') => h('button', { class: cls, onclick: async () => { try { await fn(); } catch (e) { toast(e.message); } } }, label);

function govSections(data, extra, id) {
  const { rapporteurs, scrutins, actes, isAdmin, isMember } = data;
  const reload = () => viewDossier(id);
  let designate = null;
  if (isAdmin && rapporteurs.length < 2 && extra && !data.closed) {
    const sel = h('select', { name: 'user_id', 'aria-label': 'Membre à désigner' }, extra[0].membres
      .filter((m) => ['president', 'vice_president', 'titulaire', 'suppleant'].includes(m.fonction) && !rapporteurs.some((r) => r.user_id === m.id))
      .map((m) => h('option', { value: m.id }, `${m.full_name} — ${m.quality || S.gov.fonctions[m.fonction]}${m.health_professional ? '' : ' (non professionnel de santé)'}`)));
    designate = h('form', { class: 'row' }, sel, h('button', { type: 'submit', class: 'small' }, 'Désigner'));
    designate.addEventListener('submit', submitting(designate, async (fd) => {
      await api('POST', `/gov/dossiers/${id}/rapporteurs`, { user_id: +fd.get('user_id') }); toast('Rapporteur désigné et notifié'); reload();
    }));
  }
  const rapp = h('section', { class: 'card stack' }, h('h2', {}, 'Rapporteurs'),
    rapporteurs.length ? h('ul', { class: 'plain' }, rapporteurs.map((r) => h('li', { class: 'row between' },
      h('span', {}, h('b', {}, r.full_name), ` — ${r.quality || ''}${r.health_professional ? '' : ' · non professionnel de santé'}`),
      isAdmin && !data.closed ? actBtn('Mettre fin', async () => {
        const reason = prompt('Motif de fin de désignation :'); if (!reason) return;
        await api('POST', `/gov/dossiers/${id}/rapporteurs/${r.user_id}/fin`, { reason }); reload();
      }) : null))) : h('p', { class: 'muted small' }, 'Aucun rapporteur désigné.'),
    designate,
    h('p', { class: 'hint' }, 'Art. 28.1 : deux rapporteurs, dont au moins un n’exerce pas une profession de santé. Un rapporteur qui se déporte perd sa désignation.'));

  const delib = h('section', { class: 'card stack' }, h('h2', {}, 'Délibération et vote'));
  const open = scrutins.find((s) => s.status === 'ouvert');
  for (const sc of scrutins.slice().reverse()) delib.append(scrutinBlock(sc, data, id, reload));
  if (isAdmin && !open && extra && !data.closed) delib.append(openScrutinForm(data, extra, id, reload));
  const avisSigned = actes.some((a) => a.type === 'avis' && a.has_signed_version);
  if (isAdmin && !data.closed && avisSigned && !open) {
    delib.append(actBtn('Clore la procédure et archiver le dossier', async () => {
      if (!confirm('Le dossier sera clos et archivé en lecture seule définitive. Continuer ?')) return;
      const r = await api('POST', `/gov/dossiers/${id}/cloture`); toast(`Dossier clos (contrôle d’intégrité n° ${r.checkId})`); reload();
    }, 'small'));
  }
  if (!scrutins.length && !isAdmin) delib.append(h('p', { class: 'muted small' }, 'Aucun vote pour l’instant.'));
  if (open && open.procedure === 'simplifiee' && isMember) {
    delib.append(actBtn('Demander l’examen en séance plénière (art. 30.2)', async () => {
      if (!confirm('Le vote en procédure simplifiée sera annulé et le dossier examiné en séance plénière. Continuer ?')) return;
      await api('POST', `/gov/dossiers/${id}/pleniere`); toast('Examen en séance plénière demandé'); reload();
    }));
  }
  return [rapp, delib, actes.length ? h('section', { class: 'card stack' }, h('h2', {}, 'Actes du dossier'), actesList(actes, isAdmin, reload)) : null];
}

function scrutinBlock(sc, data, id, reload) {
  const box = h('div', { class: 'vote-box stack' });
  const status = sc.status === 'ouvert' ? h('span', { class: 'pill new' }, 'Vote ouvert') : sc.status === 'annule' ? h('span', { class: 'pill' }, 'Annulé') : h('span', { class: 'pill s-avis_favorable' }, 'Clos');
  box.append(h('div', { class: 'row between' }, h('b', {}, `Scrutin n° ${sc.id} — procédure ${sc.procedure === 'simplifiee' ? 'simplifiée' : 'ordinaire'}${sc.secret ? ' — bulletin secret' : ''}`), status));
  box.append(h('p', { class: 'small muted' }, `Ouvert le ${fmtDate(sc.opened_at)}${sc.deadline ? ` · date limite ${fmtDate(sc.deadline)}` : ''} · ${sc.electeurs.filter((e) => e.voted).length}/${sc.electeurs.length} ont voté`));
  box.append(h('details', {}, h('summary', { class: 'small' }, 'Membres appelés à voter'),
    h('ul', { class: 'small' }, sc.electeurs.map((e) => h('li', {}, `${e.full_name}${e.substitute_for_name ? ` (remplace ${e.substitute_for_name})` : ''} — ${e.voted ? 'a voté' : 'n’a pas encore voté'}`)))));
  if (sc.status === 'annule') box.append(h('p', { class: 'small' }, `Motif : ${sc.cancel_reason}`));
  if (sc.status === 'ouvert' && !sc.seance_id && sc.procedure === 'ordinaire' && data.isMember) {
    box.append(actBtn('Demander l’examen en séance (art. 43.3)', async () => {
      if (!confirm('Le vote électronique sera annulé et le dossier examiné en séance. Continuer ?')) return;
      await api('POST', `/gov/scrutins/${sc.id}/demande-seance`); toast('Vote annulé : examen en séance demandé'); reload();
    }));
  }
  if (sc.canVote) {
    const choices = Object.entries(CH()).filter(([k]) => sc.procedure !== 'simplifiee' || (k !== 'defavorable' && k !== 'abstention'));
    const f = h('form', { class: 'stack' },
      h('fieldset', { class: 'choices' }, h('legend', {}, 'Votre vote'), choices.map(([k, v]) => h('label', { class: 'check' }, h('input', { type: 'radio', name: 'choice', value: k, required: true }), v))),
      field('Motivation (consignée au procès-verbal si votre avis diverge)', h('textarea', { name: 'motivation', maxlength: 4000 })),
      field('Signer mon vote : code de mon application d’authentification', h('input', { name: 'code', class: 'otp', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 11, required: true })),
      h('p', { class: 'hint' }, `${sc.secret ? 'Vote secret : votre bulletin est enregistré et signé sans votre nom.' : 'Votre bulletin est nominatif.'} La saisie du code vaut signature : le vote est définitif.`),
      h('button', { type: 'submit' }, 'Signer et voter'));
    f.addEventListener('submit', submitting(f, async (fd) => {
      if (!fd.get('choice')) throw new Error('Choisissez une option');
      if (!confirm(`Confirmer votre vote : « ${CH()[fd.get('choice')]} » ? Il ne pourra pas être modifié.`)) return;
      const r = await api('POST', `/gov/scrutins/${sc.id}/vote`, { choice: fd.get('choice'), motivation: fd.get('motivation'), code: String(fd.get('code')).trim() });
      try { localStorage.setItem(`recu-${sc.id}`, r.receipt); } catch { /* stockage indisponible */ }
      modal('Vote signé et enregistré', h('div', { class: 'stack' }, h('p', {}, `Votre vote « ${CH()[fd.get('choice')]} » est signé et enregistré le ${fmtDate(r.at)}.`),
        h('p', { class: 'small' }, 'Reçu (empreinte de votre bulletin), à conserver si vous souhaitez vérifier plus tard que votre bulletin a été compté :'), h('p', { class: 'mono' }, r.receipt)));
      reload();
    }));
    box.append(f);
  } else if (sc.hasVoted && sc.status === 'ouvert') box.append(h('p', { class: 'alert ok small' }, 'Votre vote est signé et enregistré. Le résultat sera visible à la clôture.'));
  if (sc.status === 'ouvert' && data.isAdmin) {
    const err = h('div');
    box.append(h('div', { class: 'row' },
      h('button', { class: 'small', onclick: async () => {
        if (!confirm('Clore le vote ? Un contrôle de non-altération de toutes les données est effectué d’abord : s’il échoue, le vote n’est pas validé.')) return;
        try { const r = await api('POST', `/gov/scrutins/${sc.id}/cloture`); toast(`Vote clos — contrôle d’intégrité n° ${r.check.id} conforme`); reload(); } catch (e) {
          err.replaceChildren(h('div', { class: 'alert err small' }, e.message, e.body && e.body.problems ? h('ul', {}, e.body.problems.map((p) => h('li', {}, p))) : null));
        }
      } }, 'Clore le vote (contrôle d’intégrité)'),
      actBtn('Annuler le scrutin', async () => { const reason = prompt('Motif d’annulation :'); if (!reason) return; await api('POST', `/gov/scrutins/${sc.id}/annulation`, { reason }); reload(); })), err);
  }
  if (sc.status === 'clos') {
    const qr = sc.quorum;
    const label = CH()[sc.result] || (sc.result === 'pas_de_majorite' ? 'Pas de majorité : nouvel examen nécessaire' : 'Quorum non atteint : aucune décision');
    box.append(h('p', { class: `alert ${CH()[sc.result] ? 'ok' : 'warn'}` }, h('b', {}, `Décision : ${label}`)));
    box.append(h('p', { class: 'small' }, `Résultat : ${Object.entries(sc.counts).filter(([, n]) => n).map(([k, n]) => `${CH()[k]} : ${n}`).join(' · ') || 'aucun bulletin'}`));
    box.append(h('p', { class: 'small muted' }, `Quorum : ${qr.participants} participant(s) pour ${qr.needed} requis${qr.nonHealth !== undefined ? ` · non professionnels de santé : ${qr.nonHealth} · indépendants : ${qr.independent}` : ''}${qr.ok ? '' : ' — ' + qr.reasons.join(' ; ')}`));
    if (sc.divergent && sc.divergent.length) box.append(h('details', {}, h('summary', { class: 'small' }, `Opinions divergentes (${sc.divergent.length})`), h('ul', { class: 'small' }, sc.divergent.map((x) => h('li', {}, `${CH()[x.choice]}${x.motivation ? ' — ' + x.motivation : ''}`)))));
    if (sc.ballots) box.append(h('details', {}, h('summary', { class: 'small' }, 'Bulletins nominatifs'), h('ul', { class: 'small' }, sc.ballots.map((b) => h('li', {}, `${b.voter_name} : ${CH()[b.choice]}${b.motivation ? ' — ' + b.motivation : ''}`)))));
    box.append(h('p', { class: 'hint mono' }, `Contrôle d’intégrité n° ${sc.integrity_check_id} conforme · empreinte des bulletins ${(sc.tally_hash || '').slice(0, 16)}…`));
    if (data.isAdmin && !sc.avis && !data.closed && DECISIONS.includes(sc.result)) box.append(avisForm(sc, id, reload));
  }
  return box;
}

function openScrutinForm(data, extra, id, reload) {
  const [{ membres }, { seances }] = extra;
  const supp = membres.filter((m) => m.fonction === 'suppleant');
  const tit = membres.filter((m) => S.gov.voting.includes(m.fonction));
  const f = h('form', { class: 'stack' },
    field('Procédure', h('select', { name: 'procedure' }, h('option', { value: 'ordinaire' }, 'Ordinaire'),
      h('option', { value: 'simplifiee', selected: data.dossier.procedure === 'simplifiee' }, 'Simplifiée (art. 30) : président + un rapporteur'))),
    field('Séance', h('select', { name: 'seance_id' }, h('option', { value: '' }, 'Hors séance (vote par voie électronique)'),
      seances.filter((s) => !s.closed_at).map((s) => h('option', { value: s.id }, `Séance n° ${s.id} du ${fmtDate(s.date)}`)))),
    data.rapporteurs.length ? field('Rapporteur (procédure simplifiée)', h('select', { name: 'rapporteur_id' }, data.rapporteurs.map((r) => h('option', { value: r.user_id }, r.full_name)))) : null,
    field('Date limite (facultative)', h('input', { type: 'datetime-local', name: 'deadline' })),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'secret' }), 'Vote à bulletin secret (de droit si un membre le demande, art. 29.3)'),
    supp.length ? h('details', {}, h('summary', { class: 'small' }, 'Suppléants siégeant en remplacement'),
      supp.map((m) => field(`${m.full_name} remplace :`, h('select', { name: `sub_${m.id}` }, h('option', { value: '' }, '— personne —'), tit.map((t) => h('option', { value: t.id }, t.full_name)))))) : null,
    h('p', { class: 'hint' }, 'Procédure ordinaire : deux rapporteurs doivent être désignés ; tous les membres votants non déportés sont appelés à voter et notifiés. Hors séance, une date limite d’au moins 5 jours ouvrés est obligatoire (art. 43.3).'),
    h('button', { type: 'submit' }, 'Ouvrir le vote'));
  f.addEventListener('submit', submitting(f, async (fd) => {
    const substitutes = supp.filter((m) => fd.get(`sub_${m.id}`)).map((m) => ({ user_id: m.id, substitute_for: +fd.get(`sub_${m.id}`) }));
    const dl = fd.get('deadline');
    await api('POST', `/gov/dossiers/${id}/scrutins`, {
      procedure: fd.get('procedure'), seance_id: fd.get('seance_id') || null, rapporteur_id: fd.get('rapporteur_id') ? +fd.get('rapporteur_id') : null,
      secret: !!fd.get('secret'), deadline: dl ? new Date(dl).getTime() : null, substitutes,
    });
    toast('Vote ouvert — les membres sont notifiés'); reload();
  }));
  return h('details', { class: 'subcard' }, h('summary', {}, 'Ouvrir un vote'), f);
}

function avisForm(sc, id, reload) {
  const f = h('form', { class: 'stack subcard' }, h('h3', {}, 'Établir l’avis (annexe 7)'),
    field('Motivation (français) *', h('textarea', { name: 'motivation', required: true })),
    field('Motivation (anglais, facultative)', h('textarea', { name: 'motivation_en' })),
    field('Validité en mois (36 au plus, art. 31.4)', h('input', { type: 'number', name: 'validity_months', min: 1, max: 36, value: 36 })),
    h('p', { class: 'hint' }, 'L’avis est produit en PDF (français et anglais) à votre nom, avec la liste et la version des documents examinés et un code de vérification. Imprimez-le, signez-le à la main, puis versez l’exemplaire numérisé : le dossier est alors clos et archivé.'),
    h('button', { type: 'submit' }, 'Produire l’avis'));
  f.addEventListener('submit', submitting(f, async (fd) => {
    await api('POST', `/gov/dossiers/${id}/avis`, { scrutin_id: sc.id, motivation: fd.get('motivation'), motivation_en: fd.get('motivation_en'), validity_months: +fd.get('validity_months') });
    toast('Avis produit'); reload();
  }));
  return f;
}

const SIG_LABEL = { manuscrite: 'exemplaire signé à la main', electronique: 'signature électronique' };
function actesList(actes, isAdmin, reload) {
  const signable = (a) => isAdmin && !a.signed && !a.parent_id && ['avis', 'pv', 'rapport_annuel'].includes(a.type);
  return h('ul', { class: 'doc-list' }, actes.map((a) => h('li', {},
    h('button', { onclick: () => openBlobViewer(a.original_name, `/gov/actes/${a.id}/content`, a.mime || 'application/pdf', a.sha256) },
      h('span', { class: 'doc-icon' }, a.signed ? 'SIGNÉ' : (a.original_name.split('.').pop() || 'pdf').toUpperCase().slice(0, 4)),
      h('span', {}, a.title, h('span', { class: 'piece' }, [
        ACTE_TYPES[a.type], fmtDate(a.created_at), a.created_by_name,
        a.meta.signature ? SIG_LABEL[a.meta.signature] : null,
        signable(a) && a.meta.verifCode ? `code de vérification ${a.meta.verifCode}` : null,
        a.sent_at ? `adressé au porteur le ${fmtDate(a.sent_at, false)}` : null,
      ].filter(Boolean).join(' · ')))),
    signable(a) ? h('div', { class: 'row acte-actions' },
      a.has_signed_version ? null : actBtn('1. Imprimer', () => downloadActe(a)),
      a.has_signed_version ? null : actBtn('2. Verser l’exemplaire signé', () => uploadHandwritten(a, reload), 'small'),
      a.type === 'avis' && a.has_signed_version ? actBtn('Envoyer au porteur…', () => mailAvis(a, reload), 'small') : null,
      a.has_signed_version ? null : h('details', { class: 'small' }, h('summary', {}, 'Signature électronique qualifiée (si disponible)'), actBtn('Déposer la version signée électroniquement', () => uploadSigned(a, reload)))) : null)));
}

async function downloadActe(a) {
  const r = await api('GET', `/gov/actes/${a.id}/content?download=1`, undefined, { raw: true });
  const link = h('a', { href: URL.createObjectURL(await r.blob()), download: a.original_name });
  document.body.append(link); link.click(); setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 1000);
  toast('Imprimez l’acte, signez-le à la main, puis numérisez-le');
}

function uploadHandwritten(a, reload) {
  const isAvis = a.type === 'avis';
  const f = h('form', { class: 'stack' },
    h('ol', { class: 'small' },
      h('li', {}, 'Imprimez l’acte et signez-le à la main.'),
      h('li', {}, 'Numérisez toutes les pages (scanner ou application de numérisation du téléphone), en un seul PDF de préférence.'),
      h('li', {}, 'Recopiez le code de vérification imprimé sur l’acte : il prouve que l’exemplaire versé est bien ce document.'),
      h('li', {}, 'Conservez l’original papier : le Secrétaire général l’archive (art. 6.2).')),
    field('Exemplaire signé numérisé (PDF, JPEG ou PNG)', h('input', { type: 'file', name: 'file', accept: '.pdf,.jpg,.jpeg,.png', required: true })),
    field('Code de vérification imprimé sur l’acte', h('input', { name: 'code', placeholder: 'XXXX-XXXX', autocomplete: 'off', required: true })),
    field('Note (facultative)', h('input', { name: 'note' })),
    isAvis ? h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'cloturer', checked: true }), 'Clore la procédure et archiver le dossier (lecture seule définitive)') : null,
    h('button', { type: 'submit' }, isAvis ? 'Verser et clore' : 'Verser'));
  const dlg = modal(`Exemplaire signé — ${a.title}`, f);
  f.addEventListener('submit', submitting(f, async (fd) => {
    fd.set('cloturer', fd.get('cloturer') ? 'true' : 'false');
    if (isAvis && fd.get('cloturer') === 'true' && !confirm('Le dossier sera clos et archivé : plus aucun commentaire, document ni vote ne pourra y être ajouté. Continuer ?')) return;
    const r = await api('POST', `/gov/actes/${a.id}/signe-manuscrit`, fd);
    dlg.close();
    if (r.closure) toast(`Exemplaire versé — dossier clos et archivé (contrôle d’intégrité n° ${r.closure.checkId})`);
    else if (r.closureError) toast(`Exemplaire versé, mais clôture impossible : ${r.closureError}`);
    else toast('Exemplaire signé versé');
    reload();
  }));
}

async function mailAvis(a, reload) {
  const { draft, envois } = await api('GET', `/gov/actes/${a.id}/courriel`);
  const f = h('form', { class: 'stack' },
    h('dl', { class: 'kv small' }, h('dt', {}, 'De'), h('dd', {}, draft.from), draft.replyTo ? [h('dt', {}, 'Réponses à'), h('dd', {}, draft.replyTo)] : null,
      h('dt', {}, 'À'), h('dd', {}, draft.to), h('dt', {}, 'Pièce jointe'), h('dd', {}, draft.attachment ? `${draft.attachment.name} (${SIG_LABEL[draft.attachment.signature]})` : '—')),
    field('Objet', h('input', { name: 'subject', value: draft.subject, required: true, maxlength: 300 })),
    field('Message', h('textarea', { name: 'body', required: true, rows: 14 }, draft.body)),
    envois.length ? h('p', { class: 'alert warn small' }, `Déjà envoyé ${envois.length} fois (dernier envoi le ${fmtDate(envois[envois.length - 1].sent_at)} par ${envois[envois.length - 1].full_name}).`) : null,
    h('p', { class: 'hint' }, 'Ajouté automatiquement sous votre message (lien personnel du porteur) :'),
    h('pre', { class: 'small footer-preview' }, draft.receptionFooter),
    h('p', { class: 'hint' }, 'Le texte exact envoyé est conservé dans le dossier.'),
    h('button', { type: 'submit' }, 'Envoyer au porteur'));
  const dlg = modal('Envoyer l’avis signé au porteur', f);
  f.addEventListener('submit', submitting(f, async (fd) => {
    if (!confirm(`Envoyer l’avis à ${draft.to} ?`)) return;
    await api('POST', `/gov/actes/${a.id}/transmettre`, { subject: fd.get('subject'), body: fd.get('body') });
    dlg.close(); toast('Avis envoyé au porteur'); reload();
  }));
}

function modal(title, content) {
  const dlg = h('dialog', { 'aria-label': title }, h('div', { class: 'dlg-head' }, h('b', {}, title), h('button', { class: 'small', onclick: () => dlg.close() }, 'Fermer')), h('div', { class: 'dlg-body' }, content));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg); dlg.showModal();
  return dlg;
}

function uploadSigned(a, reload) {
  const f = h('form', { class: 'stack' },
    h('ol', { class: 'small' },
      h('li', {}, 'Téléchargez l’acte.'),
      h('li', {}, 'Signez-le avec votre certificat de signature qualifiée (clé USB ou service à distance), sans modifier le document.'),
      h('li', {}, 'Facultatif : vérifiez la signature avec l’outil de validation de la Commission européenne (DSS) et joignez son rapport.'),
      h('li', {}, 'Déposez ici le PDF signé : l’outil vérifie qu’il s’agit bien de l’acte qu’il a produit.')),
    field('PDF signé', h('input', { type: 'file', name: 'file', accept: '.pdf', required: true })),
    field('Rapport de validation (facultatif)', h('input', { type: 'file', name: 'rapport', accept: '.pdf' })),
    field('Note', h('input', { name: 'note', placeholder: 'ex. certificat qualifié sur clé USB' })),
    h('button', { type: 'submit' }, 'Déposer'));
  const dlg = modal(`Version signée — ${a.title}`, f);
  f.addEventListener('submit', submitting(f, async (fd) => {
    if (!fd.get('rapport') || !fd.get('rapport').size) fd.delete('rapport');
    await api('POST', `/gov/actes/${a.id}/signe`, fd);
    dlg.close(); toast('Version signée enregistrée'); reload();
  }));
}

// ===================== Séances =====================
async function viewSeances() {
  const { seances } = await api('GET', '/gov/seances');
  let form = null;
  if (S.user.role === 'admin' || S.user.fonction === 'secretariat') {
    form = h('form', { class: 'card stack' }, h('h2', {}, 'Programmer une séance'),
      field('Date et heure', h('input', { type: 'datetime-local', name: 'date', required: true })),
      field('Modalité', h('select', { name: 'mode' }, Object.entries(MODE).map(([k, v]) => h('option', { value: k }, v)))),
      field('Lieu ou lien de visioconférence', h('input', { name: 'lieu' })),
      h('button', { type: 'submit' }, 'Créer la séance'));
    form.addEventListener('submit', submitting(form, async (fd) => {
      const r = await api('POST', '/gov/seances', { date: new Date(fd.get('date')).getTime(), mode: fd.get('mode'), lieu: fd.get('lieu') });
      go(`/seances/${r.seance.id}`);
    }));
  }
  shell('/seances', h('div', { class: 'row between' }, h('h1', {}, 'Séances'), h('a', { class: 'btn secondary', href: '#/rapport' }, 'Rapport annuel')),
    seances.length ? h('div', { class: 'dossiers' }, seances.map((s) => h('a', { class: 'dossier-item', href: `#/seances/${s.id}` }, h('div', { class: 'card' },
      h('div', { class: 'row between' }, h('span', { class: 'ref' }, `Séance n° ${s.id}`), h('span', { class: `pill ${s.closed_at ? '' : 'new'}` }, s.closed_at ? 'Close' : 'Ouverte')),
      h('h2', {}, fmtDate(s.date)),
      h('div', { class: 'meta' }, h('span', {}, MODE[s.mode]), s.lieu ? h('span', {}, s.lieu) : null, h('span', {}, `${s.scrutins} vote(s)`), s.pv_id ? h('span', {}, 'Procès-verbal établi') : null)))))
      : h('p', { class: 'empty' }, 'Aucune séance.'),
    form);
}

async function viewSeance(id) {
  const { seance: s, scrutins, actes, check } = await api('GET', `/gov/seances/${id}`);
  const isAdmin = S.user.role === 'admin';
  const reload = () => viewSeance(id);
  const closeBtn = isAdmin && !s.closed_at ? actBtn('Clore la séance et produire le procès-verbal', async () => {
    if (!confirm('Clore la séance ? Un contrôle d’intégrité est effectué, puis le procès-verbal est produit. La séance ne pourra plus être modifiée.')) return;
    const r = await api('POST', `/gov/seances/${id}/cloture`); toast(`Séance close — contrôle n° ${r.check.id} conforme`); reload();
  }, 'small') : null;
  shell('/seances', h('a', { href: '#/seances', class: 'small' }, '← Séances'), h('h1', {}, `Séance n° ${s.id} — ${fmtDate(s.date)}`),
    h('div', { class: 'card stack' }, h('p', {}, `${MODE[s.mode]}${s.lieu ? ' — ' + s.lieu : ''}`),
      s.closed_at ? h('p', { class: 'alert ok small' }, `Close le ${fmtDate(s.closed_at)}${check ? ` — contrôle d’intégrité n° ${check.id} conforme` : ''}`)
        : h('p', { class: 'muted small' }, 'Pour inscrire un dossier, ouvrez un vote depuis le dossier en choisissant cette séance.'), closeBtn),
    h('h2', {}, 'Ordre du jour et votes'),
    scrutins.length ? h('div', { class: 'stack' }, scrutins.map((sc) => (sc.recused ? h('div', { class: 'card small' }, `${sc.reference} — vous vous êtes déporté(e)`)
      : h('a', { class: 'dossier-item', href: `#/dossiers/${sc.dossier_id}` }, h('div', { class: 'card' },
        h('div', { class: 'row between' }, h('span', { class: 'ref' }, sc.reference), h('span', { class: 'pill' }, sc.status === 'clos' ? (CH()[sc.result] || sc.result.replace(/_/g, ' ')) : sc.status)),
        h('h2', {}, sc.title)))))) : h('p', { class: 'muted' }, 'Aucun vote inscrit.'),
    actes.length ? h('section', { class: 'card stack' }, h('h2', {}, 'Procès-verbal'), actesList(actes, isAdmin, reload)) : null);
}

// ===================== Rapport annuel =====================
const kpi = (label, value) => h('div', { class: 'card kpi' }, h('div', { class: 'kpi-v' }, String(value)), h('div', { class: 'small muted' }, label));
async function viewRapport() {
  const now = new Date().getFullYear();
  const sel = h('select', { 'aria-label': 'Année' }, [0, 1, 2, 3].map((i) => h('option', { value: now - i }, now - i)));
  const box = h('div', { class: 'stack' });
  const load = async () => {
    const y = +sel.value;
    const { stats: st, actes } = await api('GET', `/gov/rapport-annuel?annee=${y}`);
    const dd = (x) => (x == null ? '—' : `${x.toFixed(1).replace('.', ',')} j`);
    box.replaceChildren(
      h('div', { class: 'kpis' }, kpi('Demandes déposées', st.deposes), kpi('Avis rendus', st.avis), kpi('Délai moyen', dd(st.delays.mean)),
        kpi(`Avis en ${st.delays.limitDays} j au plus`, `${st.delays.withinLimit}/${st.delays.n}`), kpi('Séances', st.seances), kpi('Déports', st.deports)),
      h('div', { class: 'card' }, h('h2', {}, 'Avis par catégorie'),
        h('table', {}, h('tbody', {}, Object.entries(st.byCategory).map(([k, n]) => h('tr', {}, h('td', {}, CH()[k]), h('td', {}, n))))),
        h('p', { class: 'small muted' }, `Procédure ordinaire : ${st.ordinaires} · simplifiée : ${st.simplifiees} · délai médian : ${dd(st.delays.median)} · contrôles d’intégrité conformes : ${st.integrityChecks.conformes}/${st.integrityChecks.total}`)),
      S.user.role === 'admin' ? actBtn(`Produire le rapport ${y} (PDF)`, async () => { await api('POST', '/gov/rapport-annuel', { annee: y }); toast('Rapport produit'); load(); }, '') : null,
      actes.length ? h('div', { class: 'card' }, h('h2', {}, 'Rapports produits'), actesList(actes, S.user.role === 'admin', load)) : null);
  };
  sel.addEventListener('change', load);
  shell('/rapport', h('a', { href: '#/seances', class: 'small' }, '← Séances'),
    h('div', { class: 'row between' }, h('h1', {}, 'Rapport annuel d’activité'), sel),
    h('p', { class: 'muted small' }, 'Art. 34.2 : nombre de dossiers, avis par catégorie, délais moyens. Aucun élément confidentiel.'), box);
  await load();
}

// ===================== Dossier initial (appel) =====================
function initialSection(ini) {
  const children = {};
  for (const c of ini.comments) (children[c.parent_id || 0] ||= []).push(c);
  const thread = (pid) => (children[pid] ? h('ul', { class: 'thread' }, children[pid].map((c) => h('li', {},
    h('article', { class: 'comment initial' },
      h('header', {}, h('b', {}, c.author_name), h('span', { class: 'quality' }, c.author_quality),
        c.kind === 'rapport' ? h('span', { class: 'pill s-recevable' }, 'Rapport de rapporteur') : null,
        h('time', {}, fmtDate(c.created_at))),
      h('div', { class: 'body' }, c.body),
      h('footer', {}, h('span', { class: 'sig' }, svg(ICONS.lock), `Dossier initial · n° ${c.id} · ${c.hash.slice(0, 10)}…`))),
    thread(c.id)))) : null);
  return h('details', { class: 'card stack', open: true },
    h('summary', {}, `Dossier initial ${ini.reference} : avis et échanges (${ini.comments.length})`),
    h('p', { class: 'small muted' }, `Rapporteurs du dossier initial : ${ini.rapporteurs.map((r) => r.full_name).join(', ') || '—'}. Votes : ${ini.scrutins.map((sc) => `${CH()[sc.result] || sc.result} (${fmtDate(sc.closed_at, false)})`).join(' ; ') || '—'}.`),
    ini.actes.length ? h('div', {}, h('h3', {}, 'Avis et actes'), actesList(ini.actes, false, () => {})) : null,
    h('h3', {}, 'Échanges du dossier initial'),
    ini.comments.length ? thread(0) : h('p', { class: 'muted small' }, 'Aucun échange.'));
}

// ===================== Réception de l'avis et délai d'appel =====================
const BASIS = { confirmee: 'confirmée par le porteur', declaree: 'déclarée par le président', presumee: 'réputée (pas de confirmation)', non_transmis: 'avis non transmis' };
function receptionCard(data, id) {
  const a = data.appeal;
  const expired = Date.now() > a.deadline;
  const card = h('section', { class: 'card stack' }, h('h2', {}, 'Réception de l’avis et délai d’appel'),
    h('dl', { class: 'kv' },
      h('dt', {}, 'Premier envoi'), h('dd', {}, a.firstSent ? fmtDate(a.firstSent) : '—'),
      h('dt', {}, 'Réception'), h('dd', {}, a.receivedAt ? `${fmtDate(a.receivedAt, false)} — ${BASIS[a.basis]}` : BASIS[a.basis]),
      a.note ? [h('dt', {}, 'Justificatif'), h('dd', {}, a.note)] : null,
      h('dt', {}, 'Délai d’appel'), h('dd', {}, data.appealOf ? h('span', {}, 'Appel formé : ', h('a', { href: `#/dossiers/${data.appealOf.id}` }, data.appealOf.reference)) : `jusqu’au ${fmtDate(a.deadline, false)}${expired ? ' (expiré)' : ''}`)),
    a.basis === 'presumee' && a.receivedAt > Date.now() ? h('p', { class: 'hint' }, `Sans confirmation du porteur, l’avis sera réputé reçu le ${fmtDate(a.receivedAt, false)}.`) : null);
  if (data.isAdmin && !['confirmee', 'declaree'].includes(a.basis)) {
    const f = h('form', { class: 'stack' },
      field('Date de réception', h('input', { type: 'date', name: 'date', required: true })),
      field('Justificatif', h('input', { name: 'note', placeholder: 'Avis de réception postal n°…, courriel du porteur du…', required: true })),
      h('button', { type: 'submit', class: 'secondary small' }, 'Enregistrer'));
    f.addEventListener('submit', submitting(f, async (fd) => {
      const [y, m, dd] = String(fd.get('date')).split('-').map(Number);
      await api('POST', `/gov/actes/${a.avisId}/reception`, { date: new Date(y, m - 1, dd, 12).getTime(), note: fd.get('note') });
      toast('Date de réception enregistrée'); viewDossier(id);
    }));
    card.append(h('details', {}, h('summary', { class: 'small' }, 'Déclarer une date de réception (accusé postal, réponse du porteur…)'), f));
  }
  return card;
}

// ===================== Conservation et destruction =====================
function conservationCard(data, id) {
  const r = data.retention;
  const card = h('section', { class: 'card stack' }, h('h2', {}, 'Conservation'),
    h('dl', { class: 'kv' },
      h('dt', {}, 'Fin du projet'), h('dd', {}, r.projectEnd ? fmtDate(r.projectEnd, false) : 'non renseignée'),
      h('dt', {}, 'Conservation'), h('dd', {}, r.until ? `jusqu’au ${fmtDate(r.until, false)} (fin du projet + ${r.years} ans${r.missing.length ? '' : ''})` : `à calculer : fin du projet à renseigner${r.missing.length > 1 || (r.missing[0] && r.missing[0] !== data.dossier.reference) ? ` (${r.missing.join(', ')})` : ''}`),
      r.procedure ? [h('dt', {}, 'Destruction'), h('dd', {}, procLabel(r.procedure))] : null));
  if (data.isAdmin || S.user.fonction === 'secretariat') {
    const f = h('form', { class: 'row' }, h('input', { type: 'date', name: 'date', required: true, 'aria-label': 'Date de fin du projet' }), h('button', { type: 'submit', class: 'secondary small' }, r.projectEnd ? 'Modifier la fin du projet' : 'Renseigner la fin du projet'));
    f.addEventListener('submit', submitting(f, async (fd) => {
      const [y, m, dd] = String(fd.get('date')).split('-').map(Number);
      await api('POST', `/gov/dossiers/${id}/fin-projet`, { date: new Date(y, m - 1, dd, 12).getTime() }); toast('Date enregistrée'); viewDossier(id);
    }));
    card.append(f, h('p', { class: 'hint' }, 'La fin du projet est indiquée par le rapport final du porteur (art. 32.4). Elle fait courir la durée de conservation (art. 34.3).'));
  }
  if (data.isAdmin && r.due && !(r.procedure && ['attente_dpd', 'avis_dpd_rendu'].includes(r.procedure.status))) {
    card.append(actBtn('Proposer la destruction (avis du DPD demandé)', async () => {
      if (!confirm('Proposer la destruction de ce dossier en fin de conservation ? Le délégué à la protection des données sera sollicité.')) return;
      await api('POST', `/gov/dossiers/${r.rootId}/destruction`); toast('Destruction proposée'); go('/admin/conservation');
    }, 'small'));
  }
  return card;
}
const PROC = { attente_dpd: 'en attente de l’avis du DPD', avis_dpd_rendu: 'avis du DPD rendu — décision du président attendue', executee: 'exécutée', abandonnee: 'abandonnée', execution: 'en cours' };
const procLabel = (p) => `${PROC[p.status]}${p.dpd_opinion ? ` (avis du DPD : ${p.dpd_opinion})` : ''}${p.executed_at ? ` le ${fmtDate(p.executed_at, false)}` : ''}`;

async function viewConservation() {
  const { echeances, procedures, years } = await api('GET', '/gov/conservation');
  const isAdmin = S.user.role === 'admin';
  const reload = () => viewConservation();
  const open = procedures.filter((p) => ['attente_dpd', 'avis_dpd_rendu'].includes(p.status));
  const procCard = (p) => {
    const box = h('div', { class: 'card stack' },
      h('div', { class: 'row between' }, h('b', {}, `Dossier ${p.reference}`), h('span', { class: `pill ${p.status === 'executee' ? '' : 'new'}` }, PROC[p.status])),
      h('p', { class: 'small muted' }, `Proposée le ${fmtDate(p.proposed_at, false)} · conservation expirée le ${fmtDate(p.retention_until, false)}`),
      p.dpd_opinion ? h('p', { class: `alert ${p.dpd_opinion === 'favorable' ? 'ok' : 'warn'} small` }, `Avis du DPD (${p.dpd_name}, ${p.dpd_method === 'outil' ? 'signé dans l’outil' : 'document versé'}) : ${p.dpd_opinion}${p.dpd_motivation ? ` — ${p.dpd_motivation}` : ''}`) : null,
      p.abandon_reason ? h('p', { class: 'small' }, `Motif d’abandon : ${p.abandon_reason}`) : null,
      p.counts ? h('p', { class: 'small' }, `Détruits : ${p.counts.documents} document(s), ${p.counts.comments} commentaire(s), ${p.counts.votes} vote(s), ${p.counts.actes} acte(s). Avis conservés : ${p.counts.keptAvis.length}. Procès-verbaux conservés (archives) : ${(p.counts.keptPV || []).length}.`) : null);
    if (p.status === 'attente_dpd' && S.user.dpd) {
      const f = h('form', { class: 'stack' },
        h('fieldset', { class: 'choices' }, h('legend', {}, 'Votre avis'), h('label', { class: 'check' }, h('input', { type: 'radio', name: 'opinion', value: 'favorable', required: true }), 'Favorable à la destruction'),
          h('label', { class: 'check' }, h('input', { type: 'radio', name: 'opinion', value: 'defavorable' }), 'Défavorable')),
        field('Motivation', h('textarea', { name: 'motivation' })),
        field('Signer : code de votre application d’authentification', h('input', { name: 'code', class: 'otp', inputmode: 'numeric', maxlength: 11, required: true })),
        h('button', { type: 'submit' }, 'Signer et rendre l’avis'));
      f.addEventListener('submit', submitting(f, async (fd) => { await api('POST', `/gov/destructions/${p.id}/avis-dpd`, Object.fromEntries(fd)); toast('Avis enregistré'); reload(); }));
      box.append(f);
    }
    if (p.status === 'attente_dpd' && isAdmin) {
      const f = h('form', { class: 'stack' },
        field('Nom du DPD', h('input', { name: 'dpd_name', required: true })),
        field('Avis', h('select', { name: 'opinion' }, h('option', { value: 'favorable' }, 'Favorable'), h('option', { value: 'defavorable' }, 'Défavorable'))),
        field('Motivation (résumé)', h('input', { name: 'motivation' })),
        field('Avis écrit du DPD (PDF)', h('input', { type: 'file', name: 'file', accept: '.pdf,.jpg,.jpeg,.png', required: true })),
        h('button', { type: 'submit', class: 'secondary small' }, 'Verser l’avis écrit'));
      f.addEventListener('submit', submitting(f, async (fd) => { await api('POST', `/gov/destructions/${p.id}/avis-dpd-document`, fd); toast('Avis du DPD versé'); reload(); }));
      box.append(h('details', {}, h('summary', { class: 'small' }, 'Le DPD n’a pas de compte : verser son avis écrit'), f));
    }
    if (p.status === 'avis_dpd_rendu' && isAdmin) {
      const f = h('form', { class: 'stack' },
        h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'keep_avis', checked: true }), 'Conserver les avis signés au titre des archives de l’association'),
        p.dpd_opinion === 'defavorable' ? field('Motivation de votre décision (avis du DPD défavorable)', h('textarea', { name: 'note', required: true })) : field('Note (facultative)', h('input', { name: 'note' })),
        field('Signer la décision : code de votre application d’authentification', h('input', { name: 'code', class: 'otp', inputmode: 'numeric', maxlength: 11, required: true })),
        h('p', { class: 'alert warn small' }, 'La destruction est définitive : documents, échanges, votes et données personnelles du dossier sont supprimés. Un certificat de destruction est conservé.'),
        h('button', { type: 'submit', class: 'danger' }, 'Signer et détruire'));
      f.addEventListener('submit', submitting(f, async (fd) => {
        if (!confirm(`Détruire définitivement le dossier ${p.reference} ?`)) return;
        const r = await api('POST', `/gov/destructions/${p.id}/decision`, { code: String(fd.get('code')).trim(), keep_avis: !!fd.get('keep_avis'), note: fd.get('note') || '' });
        toast(`Dossier détruit — certificat produit (${r.shredded} fichier(s) effacé(s))`); reload();
      }));
      box.append(f);
    }
    if (isAdmin && ['attente_dpd', 'avis_dpd_rendu'].includes(p.status)) {
      box.append(actBtn('Abandonner la procédure', async () => { const reason = prompt('Motif :'); if (!reason) return; await api('POST', `/gov/destructions/${p.id}/abandon`, { reason }); reload(); }));
    }
    return box;
  };
  shell('/admin/conservation', h('h1', {}, 'Conservation et destruction'),
    h('p', { class: 'muted small' }, `Durée de conservation : fin du projet + ${years} ans (art. 34.3). Destruction dossier par dossier, sur décision du président, après avis du délégué à la protection des données (art. 45.2).`),
    h('h2', {}, 'Procédures en cours'), open.length ? h('div', { class: 'stack' }, open.map(procCard)) : h('p', { class: 'muted' }, 'Aucune.'),
    isAdmin ? h('h2', {}, 'Échéances') : null,
    isAdmin ? (echeances.length ? h('div', { class: 'stack' }, echeances.map((e) => h('a', { class: 'dossier-item', href: `#/dossiers/${e.id}` }, h('div', { class: 'card row between' },
      h('span', {}, h('b', {}, e.family.join(' + ')), e.missing.length ? ' — fin du projet à renseigner' : ` — conservation ${e.due ? 'expirée' : 'jusqu’au'} ${e.until ? fmtDate(e.until, false) : ''}`),
      h('span', { class: `pill ${e.due ? 'new' : ''}` }, e.procedure ? PROC[e.procedure.status] : (e.due ? 'à détruire' : e.missing.length ? 'date manquante' : 'bientôt')))))) : h('p', { class: 'muted' }, 'Aucune échéance.')) : null,
    h('h2', {}, 'Historique'), h('div', { class: 'stack' }, procedures.filter((p) => !open.includes(p)).map(procCard)));
}

// ===================== Démonstration : courriels envoyés =====================
async function viewDemoMails() {
  const { courriels } = await api('GET', '/demo/courriels');
  const linkify = (text) => text.split(/(https?:\/\/\S+)/).map((part) => (/^https?:\/\//.test(part) ? h('a', { href: part.replace(/^https?:\/\/[^/]+/, ''), target: '_blank', rel: 'noopener' }, part) : part));
  shell('/demo/courriels', h('h1', {}, 'Courriels envoyés (démonstration)'),
    h('p', { class: 'muted small' }, 'En démonstration, aucun courriel ne quitte le serveur : ils sont affichés ici. Les liens (accusé de réception, invitation…) sont cliquables.'),
    courriels.length ? h('div', { class: 'stack' }, courriels.map((m) => h('details', { class: 'card' },
      h('summary', {}, h('b', {}, m.subject), h('span', { class: 'small muted' }, ` — à ${m.to}`)),
      h('pre', { class: 'mail-body' }, linkify(m.text)),
      m.attachments.length ? h('p', { class: 'small' }, `Pièce jointe : ${m.attachments.join(', ')}`) : null))) : h('p', { class: 'empty' }, 'Aucun courriel.'));
}

render();
