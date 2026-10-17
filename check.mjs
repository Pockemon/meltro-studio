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

function checkProducts() {
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
function checkPageCommon(page, html, { dir, url, products, maxEager = 1 }) {
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
  if (prioritized.length !== 1) fail(`${page} : une seule image prioritaire (fetchpriority="high") est attendue (${prioritized.length}).`);
  if (eager.length < 1 || eager.length > maxEager) fail(`${page} : seules les images au-dessus de la ligne de flottaison ne doivent pas être en lazy (${eager.length} images non lazy, ${maxEager} au plus).`);

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

function checkDist(products) {
  if (!existsSync(DIST)) {
    fail('dist/ absent : lancer `node build.mjs` avant `node check.mjs`.');
    return;
  }
  const slugs = products.map(slugOf);
  const required = [...REQUIRED_DIST_FILES, ...slugs.map((s) => `${s}/index.html`)];
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

  // La collection : toujours affichée, une carte cliquable par produit, complétée par des cartes « à venir ».
  if (!/<section class="collection" id="collection"/.test(home)) fail('index.html : section « La collection » (#collection) absente.');
  const cards = [...home.matchAll(/<a class="card" href="([^"]+)">([\s\S]*?)<\/a>/g)];
  for (const p of products) {
    const card = cards.find((m) => m[1] === `${slugOf(p)}/`);
    if (!card) {
      fail(`index.html : carte cliquable vers la fiche « ${slugOf(p)}/ » absente.`);
      continue;
    }
    const cardText = visibleText(card[2]).replace(/\s+/g, ' ');
    for (const [what, value] of [['nom', p.name], ['badge', p.badge], ['collection', p.collection], ['accroche', p.cardTagline], ['prix', `dès ${formatPrice(p.priceFrom)}\u00a0€`], ['« Voir la pièce »', 'Voir la pièce']]) {
      if (value && !cardText.replace(/\u00a0/g, ' ').includes(String(value).replace(/\u00a0/g, ' ').replace(/’/g, "'")) && !cardText.replace(/\u00a0/g, ' ').includes(String(value).replace(/\u00a0/g, ' '))) {
        fail(`index.html : la carte de « ${slugOf(p)} » doit afficher son ${what} (« ${value} »).`);
      }
    }
    if (!card[2].includes(`style="--vt:photo-${slugOf(p)}"`)) fail(`index.html : la photo de la carte « ${slugOf(p)} » doit porter le nom de transition photo-${slugOf(p)}.`);
  }
  const columns = site.collection.columns ?? 3;
  const soonCount = (home.match(/class="card-soon[ "]/g) ?? []).length;
  const expectedSoon = Math.min((site.collection.soon ?? []).length, Math.max(0, columns - products.length));
  if (soonCount !== expectedSoon) fail(`index.html : ${expectedSoon} carte(s) « en préparation » attendue(s) (trouvé : ${soonCount}).`);
  if (soonCount > 0) {
    const etsyShop = site.etsyShopUrl;
    const follow = [...home.matchAll(/<a class="btn btn-outline" href="([^"]+)" target="_blank" rel="noopener">Suivre sur Etsy/g)];
    if (follow.length !== soonCount || !follow.every((m) => m[1] === etsyShop)) fail(`index.html : chaque carte « en préparation » doit avoir un bouton « Suivre sur Etsy » vers ${etsyShop}.`);
  }

  for (const anchor of ['collection', 'atelier', 'commander']) {
    if (!home.includes(`id="${anchor}"`)) fail(`index.html : ancre #${anchor} absente.`);
  }
  if (home.includes('id="piece"')) fail('index.html : la section « pièce du moment » ne fait plus partie de l\'accueil.');
  if (!/<a class="btn btn-primary" href="#collection">/.test(home)) fail('index.html : le bouton principal du hero doit pointer vers #collection.');
  const navLabels = [site.nav.collection, site.nav.atelier, site.nav.commander, site.nav.etsyDesktop];
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
    site.collection.title,
    site.collection.text,
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
  if (errors.length === homeBefore) ok(`index.html : JSON-LD WebSite + Organization, ${products.length} carte(s) cliquable(s) + ${soonCount} « en préparation », nav, ancres, 3 cartes de hero, textes Figma`);

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
  for (const loc of [`${BASE_URL}/`, ...slugs.map((s) => `${BASE_URL}/${s}/`)]) {
    if (!sitemap.includes(`<loc>${loc}</loc>`)) fail(`sitemap.xml : <loc>${loc}</loc> manquant.`);
  }
  const robots = readFileSync(join(DIST, 'robots.txt'), 'utf8');
  if (!robots.includes(`Sitemap: ${BASE_URL}/sitemap.xml`)) fail(`robots.txt : « Sitemap: ${BASE_URL}/sitemap.xml » manquant.`);
  if (errors.length === before) ok(`sitemap.xml (${slugs.length + 1} URL) et robots.txt pointent vers BASE_URL`);

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
  for (const f of ['data/site.json', 'data/products.json']) {
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
const products = checkProducts();
checkDist(products);
checkTokens();

if (errors.length > 0) {
  console.error('');
  for (const e of errors) console.error(`ERREUR ${e}`);
  console.error(`\ncheck échoué : ${errors.length} erreur(s).`);
  process.exit(1);
}
console.log('\ncheck ok.');
