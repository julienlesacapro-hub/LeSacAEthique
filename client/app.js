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
  }
  const m = path.match(/^\/dossiers\/(\d+)$/);
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
    if (path === '/profil') return viewProfile();
    if (path === '/admin/membres' && S.user.role === 'admin') return viewMembers();
    if (path === '/admin/journal' && S.user.role === 'admin') return viewAudit();
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
const logoImg = (cls) => h('img', { class: cls, src: 'icons/logo.svg', alt: '' });

function shell(path, ...content) {
  const isAdmin = S.user && S.user.role === 'admin';
  const links = [
    ['/dossiers', 'Dossiers', 'folder'],
    ['/notifications', 'Notifications', 'bell'],
    ['/profil', 'Mon compte', 'user'],
    ...(isAdmin ? [['/admin/membres', 'Administration', 'shield']] : []),
  ];
  const cur = (p) => (path === p || (p === '/dossiers' && path.startsWith('/dossiers')) || (p === '/admin/membres' && path.startsWith('/admin')) ? 'page' : null);
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
  authPage('LeSacAEthique', `${S.meta.committee} — espace sécurisé des membres`, form);
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
      h('span', { class: 'row' }, d.never_opened ? h('span', { class: 'pill new' }, 'Nouveau') : null,
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
  const { dossier: d, documents, comments, events, conflicts, lastReadCommentId, canWrite, isAdmin } = data;
  const docsById = Object.fromEntries(documents.map((x) => [x.id, x]));
  refreshUnread();

  // --- Documents ---
  const byPiece = {};
  for (const doc of documents) (byPiece[doc.piece] ||= []).push(doc);
  const docList = h('ul', { class: 'doc-list' }, Object.keys(S.meta.pieces).filter((p) => byPiece[p]).flatMap((p) => byPiece[p].map((doc) =>
    h('li', {}, h('button', { onclick: () => openDocument(d, doc) },
      h('span', { class: 'doc-icon' }, (doc.original_name.split('.').pop() || '').toUpperCase().slice(0, 4)),
      h('span', {}, doc.original_name, doc.version > 1 ? ` (v${doc.version})` : '',
        h('span', { class: 'piece' }, `${p === 'autre' ? '' : `Pièce ${p}) — `}${S.meta.pieces[p]} · ${fmtSize(doc.size)} · ${fmtDate(doc.uploaded_at)}`)))))));

  const missing = Object.keys(S.meta.pieces).filter((p) => ['a', 'b', 'c', 'd', 'e', 'g', 'h'].includes(p) && !byPiece[p]);

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
      h('p', { class: 'hint' }, `Publié sous votre nom (${S.user.full_name}${S.user.quality ? ', ' + S.user.quality : ''}), horodaté et signé. Un commentaire publié ne peut plus être ni modifié ni supprimé : vous pourrez seulement y répondre ou le compléter.`),
      h('div', { class: 'row' }, h('button', { type: 'submit' }, 'Publier définitivement')));
    form.addEventListener('submit', submitting(form, async (fd) => {
      const body = String(fd.get('body') || '').trim();
      if (!body) throw new Error('Commentaire vide');
      if (!confirm('Publier ce commentaire ? Il ne pourra plus être modifié ni supprimé.')) return;
      await api('POST', `/dossiers/${id}/comments`, { body, parent_id: parentId, document_id: fd.get('document_id') ? +fd.get('document_id') : null });
      toast('Commentaire publié');
      onDone();
    }));
    return form;
  }

  // --- Administration du dossier ---
  let adminBox = null;
  if (isAdmin) {
    const st = h('select', { name: 'status' }, Object.entries(S.meta.statuses).map(([k, v]) => h('option', { value: k, selected: k === d.status }, v)));
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
        adminBox,
        recuse),
      h('section', { class: 'stack', 'aria-label': 'Discussion' },
        h('div', { class: 'row between' }, h('h2', {}, `Discussion (${comments.length})`),
          !canWrite ? h('span', { class: 'pill' }, 'Lecture seule') : null),
        comments.length ? renderThread(0) : h('p', { class: 'empty card' }, 'Aucun commentaire. ' + (canWrite ? 'Soyez le premier à donner votre analyse.' : '')),
        canWrite ? h('div', { class: 'composer' }, composer({ label: 'Nouveau commentaire', onDone: () => viewDossier(id) })) : null)));
  const firstNew = document.querySelector('.comment.is-new');
  if (firstNew) firstNew.scrollIntoView({ block: 'center' });
}

async function openDocument(d, doc) {
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
    const r = await api('GET', `/dossiers/${d.id}/documents/${doc.id}/content${dl ? '?download=1' : ''}`, undefined, { raw: true });
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
    h('option', { value: 'ecriture', selected: val === 'ecriture' }, 'Lecture et écriture'), h('option', { value: 'admin', selected: val === 'admin' }, 'Administrateur'));
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
    field('Droits', roleSel('ecriture')),
    h('p', { class: 'hint' }, 'Le membre reçoit un lien pour choisir son mot de passe et configurer la double authentification. Vous ne connaissez jamais son mot de passe.'),
    h('button', { type: 'submit' }, 'Créer et envoyer l’invitation'));
  create.addEventListener('submit', submitting(create, async (fd) => {
    const r = await api('POST', '/users', Object.fromEntries(fd));
    toast(`Invitation envoyée à ${r.user.email}`);
    await viewMembers(r.invitationLink);
  }));
  const statusLabel = { invite: 'Invitation en attente', actif: 'Actif', suspendu: 'Suspendu' };
  const cards = users.map((u) => {
    const rs = roleSel(u.role);
    rs.addEventListener('change', async () => {
      try { await api('PATCH', `/users/${u.id}`, { role: rs.value }); toast('Droits modifiés'); } catch (e) { toast(e.message); rs.value = u.role; }
    });
    const act = (label, fn, cls = 'secondary small') => h('button', { class: cls, onclick: async () => { try { await fn(); } catch (e) { toast(e.message); } } }, label);
    return h('div', { class: 'card member-card' },
      h('div', {}, h('b', {}, u.full_name), u.id === S.user.id ? ' (vous)' : '', h('div', { class: 'small muted' }, `${u.quality || '—'} · ${u.email}`),
        h('div', { class: 'small' }, h('span', { class: 'pill' }, statusLabel[u.status]), ' ', u.totp_enabled ? '2FA active' : '2FA non configurée',
          u.last_login_at ? ` · dernière connexion ${fmtDate(u.last_login_at)}` : '')),
      h('div', { class: 'stack' }, rs, h('div', { class: 'row' },
        u.status === 'actif' ? act('Suspendre', async () => { if (confirm(`Suspendre ${u.full_name} ? Ses sessions seront fermées.`)) { await api('PATCH', `/users/${u.id}`, { status: 'suspendu' }); viewMembers(); } }) : null,
        u.status === 'suspendu' && u.totp_enabled ? act('Réactiver', async () => { await api('PATCH', `/users/${u.id}`, { status: 'actif' }); viewMembers(); }) : null,
        act(u.status === 'invite' ? 'Renvoyer l’invitation' : 'Nouvelle invitation', async () => {
          if (u.status !== 'invite' && !confirm('Le mot de passe et la double authentification actuels seront annulés. Continuer ?')) return;
          const r = await api('POST', `/users/${u.id}/invitation`); toast('Invitation envoyée'); await viewMembers(r.invitationLink);
        }),
        u.totp_enabled ? act('Réinitialiser la 2FA', async () => { if (confirm(`À faire uniquement si ${u.full_name} a perdu son téléphone ET ses codes de secours, après avoir vérifié son identité. Continuer ?`)) { await api('POST', `/users/${u.id}/reset-2fa`); toast('Double authentification réinitialisée'); viewMembers(); } }) : null)));
  });
  shell('/admin/membres',
    h('div', { class: 'row between' }, h('h1', {}, 'Membres et droits'), h('a', { class: 'btn secondary', href: '#/admin/journal' }, 'Journal et intégrité')),
    linkBox, h('div', { class: 'stack' }, cards), create);
  showLink(pendingLink);
}

async function viewAudit() {
  const { entries } = await api('GET', '/users/audit/log?limit=500');
  const res = h('div');
  const check = h('button', { class: 'secondary', onclick: async () => {
    res.replaceChildren(h('p', { class: 'muted' }, 'Vérification…'));
    const r = await api('GET', '/users/audit/integrity');
    res.replaceChildren(h('div', { class: `alert ${r.ok ? 'ok' : 'err'}` },
      h('p', {}, r.ok ? `Intègre : ${r.comments} commentaires (chaîne d’empreintes et signatures valides) et ${r.documents} documents vérifiés.` : 'ANOMALIES DÉTECTÉES :'),
      r.ok ? null : h('ul', {}, r.problems.map((p) => h('li', {}, p))),
      h('details', {}, h('summary', { class: 'small' }, 'Clé publique de signature du serveur'), h('pre', { class: 'mono' }, r.publicKey))));
  } }, 'Vérifier l’intégrité des commentaires et documents');
  shell('/admin/journal', h('a', { href: '#/admin/membres', class: 'small' }, '← Membres'), h('h1', {}, 'Journal et intégrité'),
    h('div', { class: 'card stack' }, h('p', { class: 'small' }, 'Le journal (connexions, consultations, téléchargements, actions d’administration) est en ajout seul. Le règlement intérieur prévoit une analyse au moins tous les deux mois (art. 40).'), check, res),
    h('div', { class: 'card table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Date'), h('th', {}, 'Personne'), h('th', {}, 'Action'), h('th', {}, 'Objet'), h('th', {}, 'IP'))),
      h('tbody', {}, entries.map((e) => h('tr', {}, h('td', {}, fmtDate(e.at)), h('td', {}, e.full_name || '—'), h('td', {}, e.action.replace(/_/g, ' ')), h('td', {}, e.target), h('td', { class: 'mono' }, e.ip)))))));
}

render();
