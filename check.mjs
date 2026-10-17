#!/usr/bin/env node
// Vérifie data/products.json et dist/. Code de sortie 1 au moindre échec.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, 'dist');
const PUBLIC_DIR = join(ROOT, 'public');

const TEXT_EXTENSIONS = new Set(['.html', '.css', '.xml', '.txt', '.json', '.svg', '.js', '.mjs', '.webmanifest']);
const REQUIRED_DIST_FILES = ['index.html', 'styles.css', 'sitemap.xml', 'robots.txt', '.nojekyll'];
const BASE_URL = 'https://pockemon.github.io/meltro-studio';

// « 3D » est cherché comme mot isolé : les codes couleur comme #e3d9cc ne doivent pas déclencher d'alerte.
const FORBIDDEN = [
  { label: '3D', pattern: /(?<![a-z0-9])3[\s\u00a0-]?d(?![a-z0-9])/i },
  { label: 'impression', pattern: /impression/i },
  { label: 'imprimé / imprimante', pattern: /imprim/i },
];

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

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function checkProducts() {
  const file = join(ROOT, 'data/products.json');
  let products;
  try {
    products = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    fail(`data/products.json illisible : ${e.message}`);
    return [];
  }
  if (!Array.isArray(products) || products.length === 0) {
    fail('data/products.json doit être un tableau non vide.');
    return [];
  }

  const ids = new Set();
  products.forEach((p, index) => {
    const label = `produit #${index + 1} (${p?.id ?? 'sans id'})`;
    const before = errors.length;

    if (typeof p.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.id)) {
      fail(`${label} : id requis (minuscules, chiffres et tirets).`);
    } else if (ids.has(p.id)) {
      fail(`${label} : id en double.`);
    } else {
      ids.add(p.id);
    }
    if (typeof p.name !== 'string' || !p.name.trim()) fail(`${label} : name manquant.`);
    if (typeof p.priceFrom !== 'number' || !Number.isFinite(p.priceFrom) || p.priceFrom <= 0) {
      fail(`${label} : priceFrom doit être un nombre > 0.`);
    }
    if ('price' in p) fail(`${label} : « price » est remplacé par « priceFrom ».`);
    if (typeof p.etsyUrl !== 'string' || !isUrl(p.etsyUrl)) {
      fail(`${label} : etsyUrl manquant ou invalide.`);
    }
    if (p.leboncoinUrl && !isUrl(p.leboncoinUrl)) {
      fail(`${label} : leboncoinUrl invalide (laisser vide pour masquer le bouton).`);
    }
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
    }
    if (errors.length === before) ok(`${label} : nom, priceFrom, etsyUrl et ${p.images.length} image(s) présents`);
  });
  return products;
}

function checkDist(products) {
  if (!existsSync(DIST)) {
    fail('dist/ absent : lancer `node build.mjs` avant `node check.mjs`.');
    return;
  }
  for (const f of REQUIRED_DIST_FILES) {
    if (!existsSync(join(DIST, f))) fail(`dist/${f} manquant.`);
  }
  if (!existsSync(join(DIST, 'index.html'))) return;
  ok(`fichiers requis présents dans dist/ (${REQUIRED_DIST_FILES.join(', ')})`);

  const htmlBefore = errors.length;
  const html = readFileSync(join(DIST, 'index.html'), 'utf8');

  if (!/<html lang="fr"/.test(html)) fail('index.html : attribut lang="fr" manquant.');
  if (!/<title>[^<]+<\/title>/.test(html)) fail('index.html : <title> manquant.');
  if (!/<meta name="description" content="[^"]+"/.test(html)) fail('index.html : meta description manquante.');
  if (!/<meta property="og:image" content="[^"]+"/.test(html)) fail('index.html : og:image manquant.');

  const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)].filter((m) => !/type="application\/ld\+json"/.test(m[1]));
  if (scripts.length > 0) fail('index.html : aucun script exécutable n\'est autorisé (seul le JSON-LD l\'est).');
  if ((html.match(/type="application\/ld\+json"/g) ?? []).length !== products.length) {
    fail('index.html : un bloc JSON-LD Product par produit est attendu.');
  }
  for (const tag of html.match(/<img\b[^>]*>/g) ?? []) {
    if (!/\balt="[^"]+"/.test(tag)) fail(`index.html : image sans alt : ${tag.slice(0, 80)}`);
    if (!/\bwidth="\d+"/.test(tag) || !/\bheight="\d+"/.test(tag)) fail(`index.html : image sans width/height : ${tag.slice(0, 80)}`);
    const src = /\bsrc="([^"]+)"/.exec(tag)?.[1];
    if (src && !isUrl(src) && !existsSync(join(DIST, decodeURIComponent(src)))) fail(`index.html : image absente de dist/ : ${src}`);
  }

  const attr = (re) => re.exec(html)?.[1];
  const canonical = attr(/<link rel="canonical" href="([^"]+)"/);
  const ogUrl = attr(/<meta property="og:url" content="([^"]+)"/);
  const ogImage = attr(/<meta property="og:image" content="([^"]+)"/);
  if (canonical !== `${BASE_URL}/`) fail(`canonical attendu : ${BASE_URL}/ (trouvé : ${canonical}).`);
  if (ogUrl !== `${BASE_URL}/`) fail(`og:url attendu : ${BASE_URL}/ (trouvé : ${ogUrl}).`);
  if (!ogImage?.startsWith(`${BASE_URL}/`)) fail(`og:image doit commencer par ${BASE_URL}/ (trouvé : ${ogImage}).`);
  for (const [name, expected] of [['sitemap.xml', `<loc>${BASE_URL}/</loc>`], ['robots.txt', `Sitemap: ${BASE_URL}/sitemap.xml`]]) {
    const file = join(DIST, name);
    if (existsSync(file) && !readFileSync(file, 'utf8').includes(expected)) fail(`dist/${name} doit contenir « ${expected} ».`);
  }
  // Servi sous /meltro-studio/ : un chemin commençant par « / » casserait CSS, images et liens.
  for (const m of html.matchAll(/\b(?:src|href)="(\/[^"]*)"/g)) fail(`index.html : chemin absolu à la racine (casse le sous-chemin) : ${m[1]}`);
  const css = join(DIST, 'styles.css');
  if (existsSync(css)) {
    for (const m of readFileSync(css, 'utf8').matchAll(/url\(\s*['"]?(\/[^)'"]*)/g)) fail(`styles.css : chemin absolu à la racine : ${m[1]}`);
  }

  const etsyButtons = (html.match(/class="btn btn-etsy"/g) ?? []).length;
  const leboncoinButtons = (html.match(/class="btn btn-leboncoin"/g) ?? []).length;
  const expectedLeboncoin = products.filter((p) => p.leboncoinUrl).length;
  if (etsyButtons !== products.length) fail(`${etsyButtons} bouton(s) Etsy pour ${products.length} produit(s).`);
  if (leboncoinButtons !== expectedLeboncoin) {
    fail(`${leboncoinButtons} bouton(s) Leboncoin affiché(s), ${expectedLeboncoin} attendu(s) (URL renseignées).`);
  }
  const site = JSON.parse(readFileSync(join(ROOT, 'data/site.json'), 'utf8'));
  const expectedHeaderLeboncoin = site.leboncoinShopUrl || (products.length === 1 ? products[0].leboncoinUrl : '');
  const headerLeboncoin = /<a class="nav-leboncoin" href="([^"]+)"/.exec(html)?.[1];
  if ((headerLeboncoin ?? '') !== (expectedHeaderLeboncoin ?? '')) {
    fail(`lien Leboncoin de l'en-tête : « ${headerLeboncoin ?? 'absent'} », attendu « ${expectedHeaderLeboncoin || 'absent'} ».`);
  }
  for (const p of products) {
    const amount = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(p.priceFrom);
    const expectedPrice = `Dès ${amount} ${p.currency && p.currency !== 'EUR' ? p.currency : '€'}`;
    if (!html.includes(`>${expectedPrice}<`)) fail(`« ${expectedPrice} » absent de index.html (produit « ${p.id} »).`);
  }
  if (!html.includes('Prix exact et frais de port sur chaque plateforme.')) {
    fail('index.html : la mention « Prix exact et frais de port sur chaque plateforme. » est absente.');
  }
  for (const m of html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)) {
    let ld;
    try {
      ld = JSON.parse(m[1]);
    } catch {
      fail('index.html : JSON-LD invalide.');
      continue;
    }
    const p = products.find((x) => x.name === ld.name);
    const offers = ld.offers;
    if (!p || !offers || Array.isArray(offers) || offers['@type'] !== 'Offer') {
      fail(`JSON-LD « ${ld.name} » : un seul Offer est attendu.`);
      continue;
    }
    const expectedUrl = p.leboncoinUrl || p.etsyUrl;
    if (Number(offers.price) !== p.priceFrom || offers.priceCurrency !== (p.currency ?? 'EUR') ||
        offers.availability !== 'https://schema.org/InStock' || offers.url !== expectedUrl) {
      fail(`JSON-LD « ${ld.name} » : offre attendue ${p.priceFrom} ${p.currency ?? 'EUR'} InStock ${expectedUrl}.`);
    }
  }
  if (errors.length === htmlBefore) ok(`index.html : prix « Dès … », mention des prix par plateforme et JSON-LD (un Offer par produit) conformes`);
  for (const p of products) {
    if (!html.includes(`id="${p.id}"`)) fail(`produit « ${p.id} » absent de index.html.`);
  }
  if (errors.length === htmlBefore) ok(`index.html : ${products.length} produit(s), ${etsyButtons} bouton(s) Etsy, ${leboncoinButtons} bouton(s) Leboncoin`);

  const before = errors.length;
  const textFiles = walk(DIST).filter((f) => TEXT_EXTENSIONS.has(extname(f).toLowerCase()));
  for (const file of textFiles) {
    const raw = readFileSync(file, 'utf8');
    if (/même prix/i.test(raw)) fail(`« Même prix » ne doit plus apparaître (${relative(ROOT, file)}).`);
    const text = normalize(raw);
    for (const { label, pattern } of FORBIDDEN) {
      const match = pattern.exec(text);
      if (match) {
        const start = Math.max(0, match.index - 30);
        const excerpt = text.slice(start, match.index + 40).replace(/\s+/g, ' ');
        fail(`mot interdit « ${label} » dans ${relative(ROOT, file)} : …${excerpt}…`);
      }
    }
  }
  if (errors.length === before) ok(`aucun mot interdit dans dist/ (${textFiles.length} fichiers texte analysés)`);
}

const products = checkProducts();
checkDist(products);

if (errors.length > 0) {
  console.error('');
  for (const e of errors) console.error(`ERREUR ${e}`);
  console.error(`\ncheck échoué : ${errors.length} erreur(s).`);
  process.exit(1);
}
console.log('\ncheck ok.');
