// Génère le logo et les icônes de LeSacAEthique selon la charte des applications LeSacA.
// Base : design/sac-plein.png (même illustration du sac que LeSacAPDF et LeSacAUrge).
// Un avis du comité sort à moitié de l'ouverture du sac : balance (éthique) et loupe (recherche).
// Usage : cd server && node ../tools/make-icons.js   (Playwright requis)
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const src = 'data:image/png;base64,' + fs.readFileSync(path.join(root, 'design', 'sac-plein.png')).toString('base64');

// Bord supérieur du panneau avant du sac (mesuré sur l'image source) : repasse devant la feuille.
const FRONT = 'M290 427 Q512 489 734 427 L760 1024 L264 1024 Z';

const sheet = `
  <g transform="rotate(-6 512 330)">
    <path d="M392 140h184l56 56v310H392z" fill="#FFFFFF"/>
    <path d="M576 140v56h56z" fill="#D5DCE6"/>
    <!-- pastille aux couleurs LeSacA, balance de l'éthique -->
    <rect x="421" y="196" width="182" height="150" rx="22" fill="url(#badge)"/>
    <g fill="none" stroke="#FFFFFF" stroke-linecap="round" stroke-linejoin="round">
      <path d="M512 222v100M480 324h64" stroke-width="11"/>
      <path d="M448 244h128" stroke-width="10"/>
      <path d="M458 244l-22 46M458 244l22 46M566 244l-22 46M566 244l22 46" stroke-width="5"/>
    </g>
    <g fill="#FFFFFF"><path d="M430 290h56a28 18 0 0 1 -56 0z"/><path d="M538 290h56a28 18 0 0 1 -56 0z"/><circle cx="512" cy="222" r="9"/></g>
    <g stroke="#C3CCD8" stroke-width="11" stroke-linecap="round"><path d="M420 372h96M420 404h80"/></g>
    <!-- loupe de la recherche -->
    <circle cx="568" cy="384" r="40" fill="#E6F3FA" fill-opacity=".7" stroke="#0A3D66" stroke-width="13"/>
    <path d="M597 413l30 30" stroke="#0A3D66" stroke-width="18" stroke-linecap="round"/>
  </g>`;

const art = `
  <defs>
    <clipPath id="front"><path d="${FRONT}"/></clipPath>
    <clipPath id="round"><rect x="0" y="0" width="1024" height="1024" rx="230"/></clipPath>
    <linearGradient id="badge" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0A6AA8"/><stop offset="1" stop-color="#13B5B0"/></linearGradient>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1D3D63"/><stop offset=".5" stop-color="#1C3456"/><stop offset="1" stop-color="#182A45"/>
    </linearGradient>
    <filter id="feather"><feGaussianBlur stdDeviation="28"/></filter>
    <mask id="fade2"><rect x="14" y="14" width="996" height="996" rx="220" fill="#fff" filter="url(#feather)"/></mask>
    <mask id="fade"><rect x="40" y="40" width="944" height="944" rx="200" fill="#fff" filter="url(#feather)"/></mask>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="9"/></filter>
  </defs>
  <g>
    <image href="${src}" width="1024" height="1024"/>
    <path d="M392 160h240v310H392z" transform="rotate(-6 512 330) translate(10 10)" fill="#000" opacity=".28" filter="url(#soft)"/>
    ${sheet}
    <path d="M300 418 Q512 480 724 418" fill="none" stroke="#5a3a1a" stroke-width="22" opacity=".35" filter="url(#soft)"/>
    <image href="${src}" width="1024" height="1024" clip-path="url(#front)"/>
  </g>`;

const head = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">';
const svg = (variant) => {
  if (variant === 'rounded') return head + `<g clip-path="url(#round)">${art}</g></svg>`;
  const defs = art.replace(/<g>[\s\S]*<\/g>\s*$/, '');
  const body = art.replace(/<defs>[\s\S]*<\/defs>/, '');
  if (variant === 'full') return head + defs + `<rect width="1024" height="1024" fill="url(#bg)"/><g mask="url(#fade2)">${body}</g></svg>`;
  return head + defs + `<rect width="1024" height="1024" fill="url(#bg)"/>
    <g transform="translate(512 512) scale(.84) translate(-512 -512)" mask="url(#fade)">${body}</g></svg>`;
};

const jobs = [
  ['rounded', 1024, 'assets/logo-1024.png'], ['rounded', 1024, 'desktop/icon.png'],
  ['rounded', 512, 'client/icons/icon-512.png'], ['rounded', 192, 'client/icons/icon-192.png'],
  ['rounded', 32, 'client/icons/favicon-32.png'], ['rounded', 256, 'site-integration/logo.png'],
  ['maskable', 512, 'client/icons/maskable-512.png'], ['full', 180, 'client/icons/apple-touch-icon.png'],
  ['full', 1024, 'design/icone-pleine-1024.png'],
];
(async () => {
  const b = await chromium.launch();
  for (const [v, size, out] of jobs) {
    const p = await b.newPage({ viewport: { width: size, height: size } });
    await p.setContent(`<html><body style="margin:0;background:transparent">${svg(v).replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await p.waitForTimeout(50);
    await p.screenshot({ path: path.join(root, out), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    await p.close();
    console.log(out);
  }
  await b.close();
})();
