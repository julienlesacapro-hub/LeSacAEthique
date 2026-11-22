/* Formulaire public de saisine du CER-PROMEDNAV.
 * Envoie directement au serveur du comité (multipart/form-data) ; rien
 * n'est stocké par le site internet de l'association. */
(function () {
  'use strict';
  var PIECES = {
    a: 'Lettre de saisine signée (qualification réglementaire et justification) *',
    b: 'Protocole ou synopsis détaillé, avec le paragraphe sur les enjeux éthiques *',
    c: 'Note d’information des participants et, le cas échéant, formulaire de consentement',
    d: 'Description des données : sources, variables, pseudonymisation, hébergement, conservation',
    e: 'Formalité CNIL prévue et nom du DPD consulté',
    f: 'Résumé de l’analyse d’impact, si elle est requise',
    g: 'CV courts du porteur et de l’investigateur principal',
    h: 'Sources de financement et déclarations d’intérêts',
    i: 'Pour une réutilisation du registre : demande d’accès (annexe 4)',
    j: 'Avis du Conseil scientifique, s’il existe',
    autre: 'Autres documents',
  };
  var ACCEPT = '.pdf,.doc,.docx,.odt,.xls,.xlsx,.ods,.txt,.png,.jpg,.jpeg';
  var form = document.getElementById('cer-form');
  var errBox = form.querySelector('.cer-error');
  var endpoint = form.getAttribute('data-endpoint');
  var base = endpoint.replace(/\/api\/public\/submissions$/, '');

  var pieces = document.getElementById('pieces');
  Object.keys(PIECES).forEach(function (k) {
    var wrap = document.createElement('div');
    wrap.className = 'cer-piece';
    var label = document.createElement('label');
    label.setAttribute('for', 'piece_' + k);
    label.textContent = (k === 'autre' ? '' : k + ') ') + PIECES[k];
    var input = document.createElement('input');
    input.type = 'file'; input.id = 'piece_' + k; input.name = 'piece_' + k; input.multiple = true; input.accept = ACCEPT;
    wrap.appendChild(label); wrap.appendChild(input);
    pieces.appendChild(wrap);
  });

  fetch(base + '/api/public/form-info').then(function (r) { return r.json(); }).then(function (info) {
    document.getElementById('limits').textContent = info.maxUploadMb + ' Mo par fichier, ' + info.maxFiles + ' fichiers au plus.';
  }).catch(function () {});

  var warn = document.getElementById('riph-warn');
  form.querySelectorAll('input[name=qualification]').forEach(function (r) {
    r.addEventListener('change', function () { warn.hidden = form.qualification.value !== 'RIPH'; });
  });

  function showError(msg) {
    errBox.textContent = msg; errBox.hidden = !msg;
    if (msg) errBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    showError('');
    var fd = new FormData(form);
    if (fd.get('qualification') === 'RIPH') return showError(warn.textContent);
    var missing = [];
    ['title', 'applicant_name', 'applicant_email', 'qualification_reason'].forEach(function (k) {
      if (!String(fd.get(k) || '').trim()) missing.push(form.querySelector('label[for=' + k + ']').textContent.replace(' *', ''));
    });
    if (missing.length) return showError('Champs obligatoires : ' + missing.join(', ') + '.');
    if (!form.piece_a.files.length || !form.piece_b.files.length) return showError('Joignez au moins la lettre de saisine (a) et le protocole (b).');
    if (!form.attest_no_health_data.checked) return showError('Veuillez cocher l’attestation relative aux données de santé.');
    var btn = form.querySelector('.cer-submit');
    btn.disabled = true; btn.textContent = 'Envoi en cours…';
    fetch(endpoint, { method: 'POST', body: fd })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.body.error || 'Envoi impossible');
        form.hidden = true;
        document.getElementById('cer-ref').textContent = res.body.reference;
        document.getElementById('cer-done').hidden = false;
        window.scrollTo(0, 0);
      })
      .catch(function (ex) { showError(ex.message === 'Failed to fetch' ? 'Serveur du comité injoignable. Réessayez plus tard ou écrivez au secrétariat.' : ex.message); })
      .then(function () { btn.disabled = false; btn.textContent = 'Déposer la demande'; });
  });
})();
