#!/usr/bin/env node
// Vérifie data/*.json et dist/. Code de sortie 1 au moindre échec.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, 'dist');
const PUBLIC_DIR = join(ROOT, 'public');

const TEXT_EXTENSIONS = new Set(['.html', '.css', '.xml', '.txt', '.json', '.svg', '.js', '.mjs', '.webmanifest']);
const REQUIRED_DIST_FILES = ['index.html', 'styles.css', 'sitemap.xml', 'robots.txt', '.nojekyll'];
let BASE_URL = '';
const MAX_INLINE_SCRIPT = 6000;

// « 3D » est cherché comme mot isolé : les codes couleur comme #e3d9cc ne doivent pas déclencher d'alerte.
const FORBIDDEN = [
  { label: '3D', pattern: /(?<![a-z0-9])3[\s\u00a0-]?d(?![a-z0-9])/i },
  { label: 'impression', pattern: /impression/i },
  { label: 'imprimé / imprimante', pattern: /imprim/i },
];

// « Fait main » est faux : la marque conçoit en Savoie et fabrique en petite série.
// Le motif est appliqué au texte brut ET au texte sans accents (« à la main » → « a la main »).
const HAND_MADE = /fait(e|s)? (à la )?main|finie?s? à la main|artisanal/i;
const HAND_MADE_PLAIN = /fait(e|s)? (a la )?main|finie?s? a la main|artisanal/i;
const squash = (text) => text.replace(/[\s\u00a0\u202f]+/g, ' ');

const TOKENS = {
  '--bg': '#120d0a',
  '--surface': '#1c1511',
  '--surface-2': '#261c16',
  '--line': '#3a2c22',
  '--text': '#f6eadb',
  '--muted': '#bfae9c',
  '--ember': '#ff7a1a',
  '--ember-deep': '#d9560f',
  '--gold': '#e9b872',
  '--on-ember': '#1a0f08',
  '--cream': '#fff4e6',
};

const errors = [];
const fail = (msg) => errors.push(msg);
const ok = (msg) => console.log(`OK    ${msg}`);

const isUrl = (value) => {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
};

const normalize = (text) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const formatPrice = (value) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value);
const slugOf = (p) => p.slug || p.id;

function checkCollections() {
  let collections;
  try {
    collections = readJson('data/collections.json');
  } catch (e) {
    fail(`data/collections.json illisible : ${e.message}`);
    return [];
  }
  if (!Array.isArray(collections) || collections.length === 0) {
    fail('data/collections.json doit être un tableau non vide.');
    return [];
  }
  const before = errors.length;
  const slugs = new Set();
  const orders = new Set();
  collections.forEach((c, i) => {
    const label = `collection #${i + 1} (${c?.slug ?? 'sans slug'})`;
    if (typeof c.slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(c.slug)) fail(`${label} : slug invalide (minuscules, chiffres et tirets).`);
    else if (slugs.has(c.slug)) fail(`${label} : slug en double.`);
    else slugs.add(c.slug);
    for (const field of ['name', 'season', 'tagline', 'description']) {
      if (typeof c[field] !== 'string' || !c[field].trim()) fail(`${label} : « ${field} » manquant.`);
    }
    if (typeof c.accent !== 'string' || !/^#[0-9a-f]{6}$/i.test(c.accent)) fail(`${label} : accent doit être un code #RRGGBB.`);
    else if (contrast(c.accent, TOKENS['--bg']) < 3) fail(`${label} : accent ${c.accent} trop sombre sur le fond (contraste < 3).`);
    if (!Number.isFinite(c.order)) fail(`${label} : order doit être un nombre.`);
    else if (orders.has(c.order)) fail(`${label} : order en double (${c.order}).`);
    else orders.add(c.order);
  });
  if (slugs.has('collections')) fail('le slug « collections » est réservé.');
  if (errors.length === before) ok(`collections : ${collections.map((c) => c.slug).join(', ')} (slug, nom, saison, accroche, description, accent, ordre)`);
  return [...collections].sort((a, b) => a.order - b.order);
}

function checkProducts(collections) {
  let products;
  try {
    products = readJson('data/products.json');
  } catch (e) {
    fail(`data/products.json illisible : ${e.message}`);
    return [];
  }
  if (!Array.isArray(products) || products.length === 0) {
    fail('data/products.json doit être un tableau non vide.');
    return [];
  }

  const ids = new Set();
  const slugs = new Set();
  products.forEach((p, index) => {
    const label = `produit #${index + 1} (${p?.id ?? 'sans id'})`;
    const before = errors.length;
    const slugRe = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

    if (typeof p.id !== 'string' || !slugRe.test(p.id)) {
      fail(`${label} : id requis (minuscules, chiffres et tirets).`);
    } else if (ids.has(p.id)) {
      fail(`${label} : id en double.`);
    } else {
      ids.add(p.id);
    }
    if (!slugRe.test(slugOf(p))) fail(`${label} : slug invalide (minuscules, chiffres et tirets).`);
    else if (slugs.has(slugOf(p))) fail(`${label} : slug en double.`);
    else slugs.add(slugOf(p));
    if (typeof p.name !== 'string' || !p.name.trim()) fail(`${label} : name manquant.`);
    if (slugOf(p) === 'collections') fail(`${label} : le slug « collections » est réservé aux pages collection.`);
    if (!collections.some((c) => c.slug === p.collection)) fail(`${label} : collection « ${p.collection} » inconnue (attendu : ${collections.map((c) => c.slug).join(', ')}).`);
    if (typeof p.priceFrom !== 'number' || !Number.isFinite(p.priceFrom) || p.priceFrom <= 0) {
      fail(`${label} : priceFrom doit être un nombre > 0.`);
    }
    if ('price' in p) fail(`${label} : « price » est remplacé par « priceFrom ».`);
    if (typeof p.etsyUrl !== 'string' || !isUrl(p.etsyUrl)) fail(`${label} : etsyUrl manquant ou invalide.`);
    if (p.leboncoinUrl && !isUrl(p.leboncoinUrl)) {
      fail(`${label} : leboncoinUrl invalide (laisser vide pour masquer le bouton).`);
    }
    for (const field of ['tagline', 'cardTagline', 'quote', 'story']) {
      if (!p[field]) fail(`${label} : « ${field} » manquant (fiche produit et carte de l'accueil).`);
    }
    if (!Array.isArray(p.specs) || p.specs.length === 0) fail(`${label} : « specs » manquant.`);
    if (!Array.isArray(p.faq) || p.faq.length === 0) fail(`${label} : « faq » manquant.`);
    if (!Array.isArray(p.images) || p.images.length === 0) {
      fail(`${label} : au moins une image est requise.`);
    } else {
      p.images.forEach((img, i) => {
        const src = typeof img === 'string' ? img : img?.src;
        const abs = typeof src === 'string' ? join(PUBLIC_DIR, src) : null;
        if (!abs || !existsSync(abs) || !statSync(abs).isFile() || statSync(abs).size === 0) {
          fail(`${label} : image #${i + 1} introuvable ou vide (public/${src}).`);
        }
      });
      for (const field of ['nightImage']) {
        if (field in p && !(Number.isInteger(p[field]) && p.images[p[field]])) fail(`${label} : ${field} hors limites.`);
      }
      for (const field of ['galleryImages', 'detailImages']) {
        if (field in p && !(Array.isArray(p[field]) && p[field].every((n) => Number.isInteger(n) && p.images[n]))) {
          fail(`${label} : ${field} contient un index d'image inexistant.`);
        }
      }
    }
    if (errors.length === before) ok(`${label} : données complètes (slug « ${slugOf(p)} », ${p.images.length} image(s))`);
  });
  return products;
}

function checkTokens() {
  const css = join(DIST, 'styles.css');
  if (!existsSync(css)) return;
  const text = readFileSync(css, 'utf8').toLowerCase();
  const before = errors.length;
  for (const [name, value] of Object.entries(TOKENS)) {
    if (!new RegExp(`${name}:\\s*${value}\\b`).test(text)) fail(`styles.css : variable ${name} attendue à ${value} (Figma).`);
  }
  for (const font of ['Fraunces', 'DM Sans']) {
    if (!text.includes(font.toLowerCase())) fail(`styles.css : police ${font} absente.`);
  }
  const pairs = [
    ['--text', '--bg'],
    ['--cream', '--bg'],
    ['--muted', '--bg'],
    ['--muted', '--surface'],
    ['--muted', '--surface-2'],
    ['--gold', '--bg'],
    ['--gold', '--surface'],
    ['--ember', '--bg'],
    ['--ember', '--surface'],
    ['--on-ember', '--ember'],
    ['--cream', '--surface-2'],
  ];
  for (const [fg, bg] of pairs) {
    const ratio = contrast(TOKENS[fg], TOKENS[bg]);
    if (ratio < 4.5) fail(`contraste insuffisant ${fg} sur ${bg} : ${ratio.toFixed(2)} (< 4.5).`);
  }
  if (!/prefers-reduced-motion:\s*no-preference/.test(text)) fail('styles.css : les animations doivent être limitées à prefers-reduced-motion: no-preference.');
  if (!/:focus-visible/.test(text)) fail('styles.css : style :focus-visible manquant.');
  if (!/@view-transition\s*\{\s*navigation:\s*auto/.test(text)) fail('styles.css : @view-transition { navigation: auto; } manquant.');
  if (!/view-transition-name:\s*var\(--vt/.test(text)) fail('styles.css : view-transition-name partagé (photo carte / photo fiche) manquant.');
  if (!/prefers-reduced-motion:\s*reduce/.test(text)) fail('styles.css : bloc prefers-reduced-motion: reduce manquant.');
  if (!/perspective\(1200px\)/.test(text)) fail('styles.css : perspective(1200px) de la pile du hero manquante.');
  const fxStart = text.indexOf('@media (prefers-reduced-motion: no-preference)');
  const fxEnd = text.indexOf('@media print', fxStart);
  if (fxStart >= 0 && fxEnd > fxStart) {
    for (const m of text.slice(fxStart, fxEnd).matchAll(/transition:\s*([^;}]+)/g)) {
      const props = m[1].replace(/\([^)]*\)/g, '').split(',').map((part) => part.trim().split(/\s+/)[0]);
      if (props.some((prop) => !['opacity', 'transform'].includes(prop))) fail(`styles.css : les effets 3D ne doivent animer que transform et opacity (transition : ${m[1].trim()}).`);
    }
  }
  for (const m of text.matchAll(/url\(\s*['"]?(\/[^)'"]*)/g)) fail(`styles.css : chemin absolu à la racine : ${m[1]}`);
  if (errors.length === before) ok('styles.css : 11 variables Figma, polices, focus visible, animations conditionnelles, contrastes AA (≥ 4.5)');
}

function parseLd(page, html) {
  const out = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)) {
    try {
      out.push(JSON.parse(m[1]));
    } catch {
      fail(`${page} : JSON-LD invalide.`);
    }
  }
  return out;
}

function visibleText(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, '\u00a0')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

// Contrôles communs à toutes les pages.
function checkPageCommon(page, html, { dir, url, products, maxEager = 1, noImages = false }) {
  const before = errors.length;
  if (!/<html lang="fr"/.test(html)) fail(`${page} : attribut lang="fr" manquant.`);
  if (!/<title>[^<]+<\/title>/.test(html)) fail(`${page} : <title> manquant.`);
  if (!/<meta name="description" content="[^"]{20,}"/.test(html)) fail(`${page} : meta description manquante ou trop courte.`);
  if ((html.match(/<h1\b/g) ?? []).length !== 1) fail(`${page} : un seul <h1> est attendu.`);

  const attr = (re) => re.exec(html)?.[1];
  const canonical = attr(/<link rel="canonical" href="([^"]+)"/);
  const ogUrl = attr(/<meta property="og:url" content="([^"]+)"/);
  const ogImage = attr(/<meta property="og:image" content="([^"]+)"/);
  const ogTitle = attr(/<meta property="og:title" content="([^"]+)"/);
  if (canonical !== url) fail(`${page} : canonical attendu ${url} (trouvé : ${canonical}).`);
  if (ogUrl !== url) fail(`${page} : og:url attendu ${url} (trouvé : ${ogUrl}).`);
  if (!ogTitle) fail(`${page} : og:title manquant.`);
  if (!ogImage?.startsWith(`${BASE_URL}/`)) fail(`${page} : og:image doit commencer par ${BASE_URL}/ (trouvé : ${ogImage}).`);
  else if (!existsSync(join(DIST, decodeURIComponent(ogImage.slice(BASE_URL.length + 1))))) fail(`${page} : og:image absente de dist/ (${ogImage}).`);

  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(
    (m) => !/type="application\/ld\+json"/.test(m[1]),
  );
  if (scripts.length > 1) fail(`${page} : un seul script inline d'amélioration progressive est autorisé (${scripts.length} trouvés).`);
  for (const [, attrs, body] of scripts) {
    if (/\bsrc=/.test(attrs)) fail(`${page} : script externe interdit.`);
    if (body.length > MAX_INLINE_SCRIPT) fail(`${page} : script inline trop gros (${body.length} > ${MAX_INLINE_SCRIPT} caractères).`);
    if (!body.includes('prefers-reduced-motion: reduce') || !body.includes('pointer: coarse')) fail(`${page} : le script doit désactiver les effets en « réduire les animations » et sur écran tactile (pointer: coarse).`);
    if (/\b(?:fetch|XMLHttpRequest|localStorage|document\.cookie)\b/.test(body)) fail(`${page} : le script ne doit ni appeler le réseau ni stocker de données.`);
  }

  for (const m of html.matchAll(/\b(?:src|href|srcset)="(\/[^"]*)"/g)) fail(`${page} : chemin absolu à la racine (casse le sous-chemin) : ${m[1]}`);

  const tags = [...(html.match(/<img\b[^>]*>/g) ?? []), ...(html.match(/<source\b[^>]*>/g) ?? [])];
  for (const tag of tags) {
    const isImg = tag.startsWith('<img');
    if (isImg && !/\balt="[^"]+"/.test(tag)) fail(`${page} : image sans alt : ${tag.slice(0, 90)}`);
    if (!/\bwidth="\d+"/.test(tag) || !/\bheight="\d+"/.test(tag)) fail(`${page} : image sans width/height : ${tag.slice(0, 90)}`);
    const src = /\b(?:src|srcset)="([^"]+)"/.exec(tag)?.[1];
    if (src && !isUrl(src) && !existsSync(join(dir, decodeURIComponent(src)))) fail(`${page} : image absente de dist/ : ${src}`);
  }
  const imgs = html.match(/<img\b[^>]*>/g) ?? [];
  const eager = imgs.filter((t) => !/loading="lazy"/.test(t));
  const prioritized = imgs.filter((t) => /fetchpriority="high"/.test(t));
  if (noImages && imgs.length === 0) {
    // page sans photo (collection vide) : rien à prioriser
  } else if (prioritized.length !== 1) fail(`${page} : une seule image prioritaire (fetchpriority="high") est attendue (${prioritized.length}).`);
  if (noImages && imgs.length === 0) {
    // idem
  } else if (eager.length < 1 || eager.length > maxEager) fail(`${page} : seules les images au-dessus de la ligne de flottaison ne doivent pas être en lazy (${eager.length} images non lazy, ${maxEager} au plus).`);

  for (const m of html.matchAll(/<a\b[^>]*>/g)) {
    const tag = m[0];
    const href = /\bhref="([^"]*)"/.exec(tag)?.[1] ?? '';
    if (isUrl(href) && !(/target="_blank"/.test(tag) && /rel="noopener"/.test(tag))) {
      fail(`${page} : lien externe sans target="_blank" rel="noopener" : ${href}`);
    }
  }

  const text = visibleText(html);
  for (const m of text.matchAll(/(\d[\d\s\u00a0\u202f]*(?:[.,]\d+)?)\s*(?:€|EUR|euros?)/gi)) {
    const amount = Number(m[1].replace(/[\s\u00a0\u202f]/g, '').replace(',', '.'));
    if (!products.some((p) => p.priceFrom === amount)) fail(`${page} : prix affiché « ${m[0].trim()} » qui n'est pas un priceFrom (le prix Etsy ne doit jamais apparaître).`);
  }
  if (errors.length === before) ok(`${page} : lang, title, description, canonical/og, un script max, images (alt, width/height, lazy), liens externes, prix`);
}

function checkDist(products, collections) {
  if (!existsSync(DIST)) {
    fail('dist/ absent : lancer `node build.mjs` avant `node check.mjs`.');
    return;
  }
  const slugs = products.map(slugOf);
  const required = [...REQUIRED_DIST_FILES, ...collections.map((c) => `collections/${c.slug}/index.html`), ...slugs.map((s) => `${s}/index.html`)];
  for (const f of required) {
    if (!existsSync(join(DIST, f))) fail(`dist/${f} manquant.`);
  }
  if (!existsSync(join(DIST, 'index.html'))) return;
  ok(`fichiers requis présents dans dist/ (${required.join(', ')})`);

  const site = readJson('data/site.json');

  // --- Accueil ---
  const home = readFileSync(join(DIST, 'index.html'), 'utf8');
  checkPageCommon('index.html', home, { dir: DIST, url: `${BASE_URL}/`, products, maxEager: 3 });
  const homeBefore = errors.length;
  const homeLd = parseLd('index.html', home);
  const types = homeLd.map((x) => x['@type']);
  if (!types.includes('WebSite') || !types.includes('Organization')) fail('index.html : JSON-LD WebSite et Organization attendus.');
  if (types.includes('Product')) fail('index.html : le JSON-LD Product appartient aux fiches produit.');
  const homeText = visibleText(home).replace(/\s+/g, ' ');
  const flatText = (v) => (Array.isArray(v) ? v.join(' ') : typeof v === 'object' && v ? flatText(v.d ?? v.m) : String(v));
  const spaced = (v) => flatText(v).replace(/\s+/g, ' ').trim();

  // Les collections : 3 tuiles, la première collection qui a des pièces en grande tuile à gauche.
  if (!/<section class="collections" id="collections"/.test(home)) fail('index.html : section « Les collections » (#collections) absente.');
  const etsyShop = site.etsyShopUrl;
  const pcs = (c) => products.filter((p) => p.collection === c.slug);
  const tiles = [...home.matchAll(/<li class="card-item tile-item( tile-item--lead)?[^"]*"[^>]*>([\s\S]*?)<\/li>/g)];
  if (tiles.length !== collections.length) fail(`index.html : ${collections.length} tuile(s) de collection attendue(s) (trouvé : ${tiles.length}).`);
  const lead = collections.find((c) => pcs(c).length > 0) ?? collections[0];
  const expectedOrder = [lead, ...collections.filter((c) => c !== lead)];
  expectedOrder.forEach((c, i) => {
    const tile = tiles[i];
    if (!tile) return;
    const body = tile[2];
    const text = visibleText(body).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
    const pieces = pcs(c);
    if ((i === 0) !== Boolean(tile[1])) fail(`index.html : la grande tuile (à gauche) doit être « ${lead.slug} ».`);
    if (!body.includes(`<a class="tile-link" href="collections/${c.slug}/">${c.name}</a>`)) fail(`index.html : la tuile « ${c.slug} » doit lier collections/${c.slug}/.`);
    for (const [what, value] of [['saison', c.season], ['nom', c.name], ['accroche', c.tagline]]) {
      if (!text.replace(/’/g, "'").includes(value.replace(/’/g, "'"))) fail(`index.html : la tuile « ${c.slug} » doit afficher sa ${what} (« ${value} »).`);
    }
    if (!body.includes(`style="--accent:${c.accent}`) && !tile[0].includes(`--accent:${c.accent}`)) fail(`index.html : la tuile « ${c.slug} » doit porter son accent ${c.accent}.`);
    if (!body.includes('class="tile-glow"')) fail(`index.html : la tuile « ${c.slug} » doit avoir sa lueur.`);
    if (!body.includes('class="card-glare"')) fail(`index.html : la tuile « ${c.slug} » doit avoir son reflet (effet des cartes).`);
    if (pieces.length > 0) {
      const status = `${pieces.length} ${pieces.length > 1 ? site.collections.pieceMany : site.collections.pieceOne} · ${site.collections.statusLimited}`;
      if (!text.includes(status)) fail(`index.html : la tuile « ${c.slug} » doit afficher le statut « ${status} ».`);
      if (!text.includes(site.collections.ctaOpen.replace(/\s+→\s*$/, ''))) fail(`index.html : la tuile « ${c.slug} » doit afficher « ${site.collections.ctaOpen.trim()} ».`);
      if (i === 0 && !body.includes(`class="tile-photo"`)) fail(`index.html : la grande tuile « ${c.slug} » doit montrer la photo de sa première pièce.`);
      if (i === 0 && !body.includes(`src="${pieces[0].images[pieces[0].galleryImages?.[0] ?? 0].src}"`)) fail(`index.html : la photo de la grande tuile doit être celle de « ${pieces[0].id} ».`);
    } else {
      if (!text.includes(site.collections.statusSoon)) fail(`index.html : la tuile vide « ${c.slug} » doit afficher « ${site.collections.statusSoon} ».`);
      const cta = new RegExp(`<a class="tile-cta" href="${etsyShop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" target="_blank" rel="noopener">`);
      if (!cta.test(body) || !text.includes(site.collections.ctaSoon.replace(/\s+→\s*$/, ''))) fail(`index.html : la tuile vide « ${c.slug} » doit afficher « ${site.collections.ctaSoon.trim()} » vers la boutique Etsy.`);
    }
  });
  for (const c of collections) {
    if (!home.includes(`href="collections/${c.slug}/"`)) fail(`index.html : lien vers la collection « ${c.slug} » absent.`);
  }
  if (/<a class="card" /.test(home)) fail('index.html : les cartes produit ont quitté l\'accueil (elles sont sur les pages collection).');

  for (const anchor of ['collections', 'atelier', 'commander']) {
    if (!home.includes(`id="${anchor}"`)) fail(`index.html : ancre #${anchor} absente.`);
  }
  if (home.includes('id="piece"')) fail('index.html : la section « pièce du moment » ne fait plus partie de l\'accueil.');
  if (!/<a class="btn btn-primary" href="#collections">/.test(home)) fail('index.html : le bouton principal du hero doit pointer vers #collections.');
  const navLabels = [site.nav.collections, site.nav.atelier, site.nav.commander, site.nav.etsyDesktop];
  const navHtml = /<nav class="nav-links"[\s\S]*?<\/nav>/.exec(home)?.[0] ?? '';
  let lastPos = -1;
  for (const label of navLabels) {
    const pos = navHtml.replace(/’/g, "'").indexOf(label.replace(/’/g, "'"));
    if (pos < 0 || pos < lastPos) fail(`index.html : navigation « ${navLabels.join(' · ')} » attendue dans cet ordre (problème : « ${label} »).`);
    lastPos = pos;
  }

  const figmaTexts = [
    site.hero.eyebrow,
    `${site.hero.titleLine1} ${site.hero.titleLine2}${site.hero.titleEmphasis}`,
    spaced(site.hero.subtitle.d),
    ...site.hero.guarantees,
    ...site.atouts.map((t) => t.title),
    site.collections.eyebrow,
    spaced(site.collections.titleLine1 + ' ' + site.collections.titleLine2),
    site.collections.text,
    spaced(site.atelier.titleLine1 + ' ' + site.atelier.titleLine2),
    ...site.atelier.figures.map((f) => `${f.value} ${f.label}`),
    site.steps.title,
    site.finalHome.eyebrow,
    spaced(site.finalHome.titleLine1 + ' ' + site.finalHome.titleLine2),
    site.footer.tagline,
  ];
  const norm = (t) => t.replace(/[’\u00a0]/g, (c) => (c === '’' ? "'" : ' ')).replace(/\s+/g, ' ');
  for (const text of figmaTexts) {
    if (!norm(homeText).toLowerCase().includes(norm(text).toLowerCase())) fail(`index.html : texte Figma absent : « ${text} ».`);
  }
  if (!/<span class="line">qui <em>font de l’effet\.<\/em><\/span>/.test(home)) fail('index.html : « font de l’effet. » doit être en italique ember (<em>) dans le titre du hero.');
  const heroImgs = [...home.matchAll(/<div class="stack-card [^"]*">/g)].length;
  if (heroImgs !== 3) fail(`index.html : la pile du hero doit contenir 3 cartes photo (trouvé : ${heroImgs}).`);

  // Les textes propres à une pièce restent sur sa fiche.
  for (const p of products) {
    for (const [what, value] of [['citation', p.quote], ['histoire', p.story], ['légende de détail', p.images.map((i) => i.detailCaption).find(Boolean)]]) {
      if (value && norm(homeText).includes(norm(value))) fail(`index.html : la ${what} de « ${slugOf(p)} » ne doit apparaître que sur sa fiche.`);
    }
  }
  for (const gone of ['La pièce du moment', 'Dans la lumière']) {
    if (homeText.includes(gone)) fail(`index.html : « ${gone} » a quitté l'accueil.`);
  }
  if (errors.length === homeBefore) ok(`index.html : JSON-LD WebSite + Organization, ${collections.length} tuiles de collection liées (grande tuile : ${lead.slug}), nav, ancres, 3 cartes de hero, textes Figma`);

  // --- Pages collection ---
  for (const c of collections) {
    const page = `collections/${c.slug}/index.html`;
    const file = join(DIST, page);
    if (!existsSync(file)) continue;
    const html = readFileSync(file, 'utf8');
    const pieces = pcs(c);
    checkPageCommon(page, html, { dir: dirname(file), url: `${BASE_URL}/collections/${c.slug}/`, products, noImages: pieces.length === 0 });
    const before = errors.length;
    const text = visibleText(html).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
    const plainText = (t) => t.replace(/’/g, "'");
    const crumb = `<a href="../../">${site.collectionPage.breadcrumbHome}</a><span class="crumbs-sep" aria-hidden="true">/</span><a href="../../#collections">${site.collectionPage.breadcrumbRoot}</a><span class="crumbs-sep" aria-hidden="true">/</span><span aria-current="page">${c.name}</span>`;
    if (!html.includes(crumb)) fail(`${page} : fil d'Ariane « Accueil / Collections / ${c.name} » attendu.`);
    if (!html.includes(`<h1 class="h-coll serif" id="collection-titre">${c.name}</h1>`)) fail(`${page} : le <h1> doit être « ${c.name} ».`);
    for (const [what, value] of [['saison', c.season], ['description', c.description]]) {
      if (!plainText(text).includes(plainText(value))) fail(`${page} : « ${what} » absente (« ${value} »).`);
    }
    if (!html.includes(`--accent:${c.accent}`) || !html.includes('class="glow glow--coll"')) fail(`${page} : lueur de l'accent ${c.accent} attendue.`);
    if (!/<nav class="nav-links"[\s\S]*?href="\.\.\/\.\.\/#collections"/.test(html)) fail(`${page} : la navigation doit pointer vers ../../#collections.`);
    for (const o of collections) {
      const expected = o === c ? `<span class="pill is-current" aria-current="page">${o.name}</span>` : `<a class="pill" href="../../collections/${o.slug}/">${pcs(o).length ? o.name : `${o.name} · ${site.collectionPage.soonSuffix}`}</a>`;
      if (!html.includes(expected)) fail(`${page} : pastille « ${o.name} » attendue (${expected}).`);
    }
    const cards = [...html.matchAll(/<a class="card" href="([^"]+)">([\s\S]*?)<\/a>/g)];
    if (cards.length !== pieces.length) fail(`${page} : ${pieces.length} carte(s) produit attendue(s) (trouvé : ${cards.length}).`);
    for (const p of pieces) {
      const card = cards.find((m) => m[1] === `../../${slugOf(p)}/`);
      if (!card) {
        fail(`${page} : carte cliquable vers « ${slugOf(p)} » absente.`);
        continue;
      }
      const cardText = visibleText(card[2]).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
      for (const [what, value] of [['nom', p.name], ['accroche', p.cardTagline], ['prix', `dès ${formatPrice(p.priceFrom)} €`], ['« Voir la pièce »', 'Voir la pièce']]) {
        if (!plainText(cardText).includes(plainText(value))) fail(`${page} : la carte de « ${slugOf(p)} » doit afficher son ${what} (« ${value} »).`);
      }
      if (!card[2].includes(`style="--vt:photo-${slugOf(p)}"`)) fail(`${page} : la photo de la carte « ${slugOf(p)} » doit porter le nom de transition photo-${slugOf(p)} (partagé avec la fiche).`);
    }
    const soonCount = (html.match(/class="card-soon /g) ?? []).length;
    if (pieces.length > 0) {
      const expectedSoon = Math.min((site.collectionPage.soon ?? []).length, Math.max(0, (site.collectionPage.columns ?? 3) - pieces.length));
      if (soonCount !== expectedSoon) fail(`${page} : ${expectedSoon} carte(s) « en préparation » attendue(s) (trouvé : ${soonCount}).`);
      if (/Premières pièces bientôt/.test(html)) fail(`${page} : le message « Premières pièces bientôt » est réservé aux collections vides.`);
    } else {
      if (!html.includes(`${site.collectionPage.empty.title}`)) fail(`${page} : message « ${site.collectionPage.empty.title} » attendu (collection vide).`);
      const re = new RegExp(`<a class="btn btn-outline" href="${etsyShop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" target="_blank" rel="noopener">${site.collectionPage.empty.cta}`);
      if (!re.test(html)) fail(`${page} : bouton « ${site.collectionPage.empty.cta} » vers la boutique Etsy attendu (collection vide).`);
    }
    const ld = parseLd(page, html);
    const cp = ld.find((x) => x['@type'] === 'CollectionPage');
    const list = cp?.mainEntity;
    if (!cp) fail(`${page} : JSON-LD CollectionPage attendu.`);
    else if (cp.url !== `${BASE_URL}/collections/${c.slug}/`) fail(`${page} : JSON-LD CollectionPage : url attendue ${BASE_URL}/collections/${c.slug}/.`);
    if (!list || list['@type'] !== 'ItemList') fail(`${page} : JSON-LD ItemList attendu dans CollectionPage.mainEntity.`);
    else {
      if (list.numberOfItems !== pieces.length || list.itemListElement?.length !== pieces.length) fail(`${page} : ItemList : ${pieces.length} élément(s) attendu(s).`);
      pieces.forEach((p, i) => {
        const el = list.itemListElement?.[i];
        if (!el || el.position !== i + 1 || el.url !== `${BASE_URL}/${slugOf(p)}/`) fail(`${page} : ItemList : élément ${i + 1} attendu vers ${BASE_URL}/${slugOf(p)}/.`);
      });
    }
    if (errors.length === before) ok(`${page} : fil d'Ariane, saison, titre, lueur ${c.accent}, pastilles, ${pieces.length ? `${pieces.length} carte(s) + ${soonCount} « en préparation »` : 'message « Premières pièces bientôt » + bouton Etsy'}, JSON-LD CollectionPage + ItemList`);
  }

  // --- Fiches produit ---
  for (const p of products) {
    const page = `${slugOf(p)}/index.html`;
    const file = join(DIST, page);
    if (!existsSync(file)) continue;
    const html = readFileSync(file, 'utf8');
    checkPageCommon(page, html, { dir: dirname(file), url: `${BASE_URL}/${slugOf(p)}/`, products });
    const before = errors.length;

    const etsyBtns = [...html.matchAll(/<a class="btn btn-etsy[^"]*" href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
    if (etsyBtns.length === 0 || !etsyBtns.every((u) => u === p.etsyUrl)) fail(`${page} : bouton Etsy attendu vers ${p.etsyUrl}.`);
    const lbcBtns = [...html.matchAll(/<a class="btn btn-leboncoin[^"]*" href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
    if (p.leboncoinUrl) {
      if (lbcBtns.length === 0 || !lbcBtns.every((u) => u === p.leboncoinUrl)) fail(`${page} : bouton Leboncoin attendu vers ${p.leboncoinUrl}.`);
    } else if (lbcBtns.length > 0) {
      fail(`${page} : bouton Leboncoin affiché sans leboncoinUrl.`);
    }

    const amount = `${formatPrice(p.priceFrom)}\u00a0€`;
    const priceRe = new RegExp(`<span class="price-from">dès</span> <span class="price-amount">${amount.replace('€', '(?:€)')}</span>`);
    if (!priceRe.test(html.replace(/&nbsp;/g, '\u00a0'))) fail(`${page} : « dès ${formatPrice(p.priceFrom)} € » absent.`);
    if (!html.includes(site.product.priceNote)) fail(`${page} : mention « ${site.product.priceNote} » absente.`);
    if (/même prix/i.test(html)) fail(`${page} : « Même prix » ne doit pas apparaître.`);

    const ld = parseLd(page, html);
    const prods = ld.filter((x) => x['@type'] === 'Product');
    if (prods.length !== 1) {
      fail(`${page} : un JSON-LD Product est attendu (${prods.length}).`);
    } else {
      const offers = prods[0].offers;
      const expectedUrl = p.leboncoinUrl || p.etsyUrl;
      if (!offers || Array.isArray(offers) || offers['@type'] !== 'Offer') fail(`${page} : JSON-LD Product : un seul Offer est attendu.`);
      else if (Number(offers.price) !== p.priceFrom || offers.priceCurrency !== (p.currency ?? 'EUR') ||
          offers.availability !== 'https://schema.org/InStock' || offers.url !== expectedUrl) {
        fail(`${page} : JSON-LD Offer attendu : ${p.priceFrom} ${p.currency ?? 'EUR'} InStock ${expectedUrl}.`);
      }
      if (prods[0].name !== p.name || prods[0].description !== p.description) fail(`${page} : JSON-LD Product : name/description différents des données.`);
      if (!(prods[0].image?.[0] ?? '').startsWith(`${BASE_URL}/`)) fail(`${page} : JSON-LD Product : images en URL absolue attendues.`);
    }

    const col = collections.find((c) => c.slug === p.collection);
    if (col) {
      const crumbs = `<a href="../#collections">${site.product.breadcrumbRoot}</a><span class="crumbs-sep" aria-hidden="true">/</span><a href="../collections/${col.slug}/">${col.name}</a><span class="crumbs-sep" aria-hidden="true">/</span><span aria-current="page">${p.name}</span>`;
      if (!html.includes(crumbs)) fail(`${page} : fil d'Ariane « ${site.product.breadcrumbRoot} / ${col.name} / ${p.name} » avec liens attendu.`);
      if (!html.includes(`<p class="eyebrow eyebrow--ember">${col.name}${p.badge ? ` · ${p.badge}` : ''}</p>`)) fail(`${page} : le surtitre doit reprendre le nom de la collection (« ${col.name} »).`);
    }
    if (!html.includes('id="galerie-principale"')) fail(`${page} : photo principale (#galerie-principale) absente.`);
    if ((html.match(/data-thumb/g) ?? []).length < 2) fail(`${page} : au moins 2 vignettes de galerie attendues.`);
    if (!html.includes('id="barre-achat"')) fail(`${page} : barre d'achat mobile absente.`);
    if (!html.includes(`<div class="gallery-main" style="--vt:photo-${slugOf(p)}">`)) fail(`${page} : la grande photo doit porter le nom de transition photo-${slugOf(p)} (partagé avec la carte de l'accueil).`);
    for (const r of site.product.reassurance) if (!html.includes(r)) fail(`${page} : réassurance « ${r} » absente.`);
    if (!html.replace(/&#39;/g, "'").includes(String(p.story).replace(/’/g, "’"))) fail(`${page} : l'histoire de la pièce est absente.`);
    if ((html.match(/<details\b/g) ?? []).length < 1) fail(`${page} : FAQ en <details> absente.`);
    if (!html.includes(`<meta name="description" content="${p.description.replace(/'/g, '&#39;').replace(/"/g, '&quot;')}"`)) {
      fail(`${page} : la meta description doit reprendre la description du produit.`);
    }
    if (errors.length === before) ok(`${page} : boutons Etsy${p.leboncoinUrl ? ' + Leboncoin' : ''}, « dès ${formatPrice(p.priceFrom)} € », JSON-LD Product (un Offer), galerie, barre d'achat, FAQ`);
  }

  // --- sitemap / robots ---
  const before = errors.length;
  const sitemap = readFileSync(join(DIST, 'sitemap.xml'), 'utf8');
  for (const loc of [`${BASE_URL}/`, ...collections.map((c) => `${BASE_URL}/collections/${c.slug}/`), ...slugs.map((s) => `${BASE_URL}/${s}/`)]) {
    if (!sitemap.includes(`<loc>${loc}</loc>`)) fail(`sitemap.xml : <loc>${loc}</loc> manquant.`);
  }
  const robots = readFileSync(join(DIST, 'robots.txt'), 'utf8');
  if (!robots.includes(`Sitemap: ${BASE_URL}/sitemap.xml`)) fail(`robots.txt : « Sitemap: ${BASE_URL}/sitemap.xml » manquant.`);
  if (errors.length === before) ok(`sitemap.xml (${slugs.length + collections.length + 1} URL : accueil, collections, fiches) et robots.txt pointent vers BASE_URL`);

  // --- mots interdits ---
  const wordsBefore = errors.length;
  const textFiles = walk(DIST).filter((f) => TEXT_EXTENSIONS.has(extname(f).toLowerCase()));
  for (const file of textFiles) {
    const raw = readFileSync(file, 'utf8');
    if (/même prix/i.test(raw)) fail(`« Même prix » ne doit plus apparaître (${relative(ROOT, file)}).`);
    const text = normalize(raw);
    if (HAND_MADE.test(squash(raw)) || HAND_MADE_PLAIN.test(squash(text))) {
      const m = HAND_MADE.exec(squash(raw)) ?? HAND_MADE_PLAIN.exec(squash(text));
      fail(`mention « fait main » interdite (${m[0]}) dans ${relative(ROOT, file)} : la marque conçoit en Savoie et fabrique en petite série.`);
    }
    for (const { label, pattern } of FORBIDDEN) {
      const match = pattern.exec(text);
      if (match) {
        const start = Math.max(0, match.index - 30);
        const excerpt = text.slice(start, match.index + 40).replace(/\s+/g, ' ');
        fail(`mot interdit « ${label} » dans ${relative(ROOT, file)} : …${excerpt}…`);
      }
    }
  }
  for (const f of ['data/site.json', 'data/products.json', 'data/collections.json']) {
    const raw = squash(readFileSync(join(ROOT, f), 'utf8'));
    if (HAND_MADE.test(raw) || HAND_MADE_PLAIN.test(normalize(raw))) fail(`mention « fait main » interdite dans ${f}.`);
  }
  if (errors.length === wordsBefore) ok(`aucun mot interdit ni « fait main / artisanal » dans dist/ et data/ (${textFiles.length} fichiers texte analysés)`);
}

function checkDomain() {
  const site = readJson('data/site.json');
  const before = errors.length;
  BASE_URL = String(site.baseUrl ?? '').replace(/\/+$/, '');
  if (!isUrl(BASE_URL)) fail('data/site.json : baseUrl doit être une URL absolue (https://…).');
  if (!('customDomain' in site) || typeof site.customDomain !== 'string') fail('data/site.json : customDomain (chaîne, vide tant que le domaine n\'est pas activé) est requis.');
  const domain = (site.customDomain ?? '').trim();
  const cname = join(DIST, 'CNAME');
  if (existsSync(DIST)) {
    if (!domain && existsSync(cname)) fail('dist/CNAME ne doit exister que si customDomain est renseigné.');
    if (domain) {
      if (!existsSync(cname) || readFileSync(cname, 'utf8').trim() !== domain) fail(`dist/CNAME doit contenir « ${domain} ».`);
      if (isUrl(BASE_URL) && new URL(BASE_URL).host !== domain) fail(`customDomain (${domain}) activé : baseUrl doit devenir https://${domain}.`);
    }
  }
  if (errors.length === before) ok(`domaine : baseUrl = ${BASE_URL}, customDomain ${domain ? `= ${domain} (dist/CNAME écrit)` : 'vide (pas de dist/CNAME)'}`);
}

checkDomain();
const collections = checkCollections();
const products = checkProducts(collections);
checkDist(products, collections);
checkTokens();

if (errors.length > 0) {
  console.error('');
  for (const e of errors) console.error(`ERREUR ${e}`);
  console.error(`\ncheck échoué : ${errors.length} erreur(s).`);
  process.exit(1);
}
console.log('\ncheck ok.');
