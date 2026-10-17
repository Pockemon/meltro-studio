#!/usr/bin/env node
// Génère dist/ à partir de data/, src/ et public/. Node 20, modules natifs uniquement.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, 'dist');
const PUBLIC_DIR = join(ROOT, 'public');

// Le site est servi sous un sous-chemin (GitHub Pages) : le HTML n'utilise que des chemins relatifs,
// BASE_URL ne sert qu'aux URL absolues (canonical, Open Graph, JSON-LD, sitemap, robots.txt).
const BASE_URL = 'https://pockemon.github.io/meltro-studio';

const FONTS_URL =
  'https://fonts.googleapis.com/css2' +
  '?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600' +
  '&family=Fraunces:opsz,wght,SOFT,WONK@9..144,300,0,1;9..144,400,0,1' +
  '&display=swap';

const CURRENCY_SYMBOLS = { EUR: '€' };

const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

const esc = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const jsonLd = (data) => JSON.stringify(data).replace(/</g, '\\u003c');

function imageSize(buf, file) {
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let o = 2;
    while (o + 9 < buf.length) {
      if (buf[o] !== 0xff) {
        o += 1;
        continue;
      }
      const marker = buf[o + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xff) {
        o += marker === 0xff ? 1 : 2;
        continue;
      }
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: buf.readUInt16BE(o + 5), width: buf.readUInt16BE(o + 7) };
      }
      o += 2 + buf.readUInt16BE(o + 2);
    }
  } else if (buf.toString('latin1', 1, 4) === 'PNG') {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } else if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    const kind = buf.toString('latin1', 12, 16);
    if (kind === 'VP8 ') {
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (kind === 'VP8L') {
      const bits = buf.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (kind === 'VP8X') {
      return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    }
  }
  throw new Error(`Format d'image non reconnu (JPEG, PNG ou WebP attendu) : ${file}`);
}

function loadProducts() {
  const raw = readJson('data/products.json');
  if (!Array.isArray(raw)) throw new Error('data/products.json doit contenir un tableau de produits.');
  return raw.map((p) => {
    if (!p.id || !p.name) throw new Error(`Produit invalide (id et name requis) : ${JSON.stringify(p).slice(0, 80)}`);
    const images = (p.images ?? []).map((img, i) => {
      const src = typeof img === 'string' ? img : img.src;
      const file = join(PUBLIC_DIR, src);
      if (!existsSync(file)) throw new Error(`Image introuvable pour « ${p.id} » : public/${src}`);
      const { width, height } = imageSize(readFileSync(file), src);
      const alt = (typeof img === 'object' && img.alt) || `${p.name}, photo ${i + 1}`;
      return { src, alt, width, height };
    });
    if (images.length === 0) throw new Error(`Le produit « ${p.id} » n'a aucune image.`);
    return { ...p, images };
  });
}

const formatPriceFrom = (priceFrom, currency = 'EUR') => {
  const amount = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(priceFrom);
  return `Dès ${amount} ${CURRENCY_SYMBOLS[currency] ?? currency}`;
};

const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');

function renderCard(p, { eagerFirst }) {
  const n = p.images.length;
  const [main] = p.images;
  const galleryId = `galerie-${p.id}`;
  const slides = p.images
    .map(
      (img, i) => `
          <li class="gallery-slide">
            <figure>
              <img src="${esc(img.src)}" alt="${esc(img.alt)}" width="${img.width}" height="${img.height}" loading="lazy" decoding="async">
              <figcaption>${esc(p.name)} · photo ${i + 1} sur ${n}</figcaption>
            </figure>
          </li>`,
    )
    .join('');

  const leboncoin = p.leboncoinUrl
    ? `
          <a class="btn btn-leboncoin" href="${esc(p.leboncoinUrl)}" target="_blank" rel="noopener">Voir sur Leboncoin<span class="sr-only"> (nouvel onglet)</span></a>`
    : '';

  return `
      <li>
        <article class="card" id="${esc(p.id)}" aria-labelledby="${esc(p.id)}-nom">
          <a class="photo" href="#${esc(galleryId)}" aria-label="Voir les ${n} photos : ${esc(p.name)}">
            <img src="${esc(main.src)}" alt="${esc(main.alt)}" width="${main.width}" height="${main.height}"${
              eagerFirst ? ' fetchpriority="high"' : ' loading="lazy"'
            } decoding="async">
          </a>
          <div class="gallery" id="${esc(galleryId)}" role="dialog" aria-modal="true" aria-label="Photos : ${esc(p.name)}">
            <a class="gallery-close" href="#${esc(p.id)}">Fermer<span class="sr-only"> la galerie</span></a>
            <ul class="gallery-track" tabindex="0" aria-label="Photos de ${esc(p.name)}, faire défiler horizontalement">${slides}
            </ul>
          </div>
          <div class="infos">
            <p class="overline">${esc(p.collection ?? '')}</p>
            <h2 class="name serif" id="${esc(p.id)}-nom">${esc(p.name)}</h2>
            <p class="detail">${esc(p.detail ?? '')}</p>
            <p class="description">${esc(p.description ?? '')}</p>
          </div>
          <p class="price serif">${esc(formatPriceFrom(p.priceFrom, p.currency))}</p>
          <div class="actions">
          <a class="btn btn-etsy" href="${esc(p.etsyUrl)}" target="_blank" rel="noopener">Acheter sur Etsy<span class="sr-only"> (nouvel onglet)</span></a>${leboncoin}
          </div>
          <p class="note">Prix exact et frais de port sur chaque plateforme.</p>
        </article>
      </li>`;
}

function productJsonLd(p, site) {
  const abs = (src) => `${BASE_URL}/${encodePath(src)}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    sku: p.id,
    image: p.images.map((img) => abs(img.src)),
    description: p.description,
    brand: { '@type': 'Brand', name: site.name },
    offers: {
      '@type': 'Offer',
      price: String(p.priceFrom),
      priceCurrency: p.currency ?? 'EUR',
      availability: 'https://schema.org/InStock',
      url: p.leboncoinUrl || p.etsyUrl,
    },
  };
}

function renderIndex(products, site) {
  const first = products[0];
  const ogImage = first && first.images[0];
  const absolute = (src) => `${BASE_URL}/${encodePath(src)}`;
  // Un seul produit : le lien d'en-tête pointe vers son annonce. Plusieurs produits : seulement si
  // leboncoinShopUrl (page vendeur) est renseignée dans data/site.json. Sinon, aucun lien.
  const leboncoinHeaderUrl =
    site.leboncoinShopUrl || (products.length === 1 ? products[0].leboncoinUrl : '');
  const headerLinks = [
    site.etsyShopUrl && { href: site.etsyShopUrl, long: 'Boutique Etsy', short: 'Etsy' },
    leboncoinHeaderUrl && { href: leboncoinHeaderUrl, long: 'Leboncoin', short: 'Leboncoin', cls: ' class="nav-leboncoin"' },
  ]
    .filter(Boolean)
    .map((l) => {
      const label =
        l.long === l.short
          ? esc(l.long)
          : `<span class="long">${esc(l.long)}</span><span class="short">${esc(l.short)}</span>`;
      return `<a${l.cls ?? ''} href="${esc(l.href)}" target="_blank" rel="noopener">${label}<span class="sr-only"> (nouvel onglet)</span></a>`;
    })
    .join('\n      ');

  const cards = products.map((p, i) => renderCard(p, { eagerFirst: i === 0 })).join('\n');
  const ld = products
    .map((p) => `  <script type="application/ld+json">${jsonLd(productJsonLd(p, site))}</script>`)
    .join('\n');

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(site.title)}</title>
  <meta name="description" content="${esc(site.description)}">
  <meta name="theme-color" content="#F5EFE6">
  <link rel="canonical" href="${esc(BASE_URL)}/">
  <link rel="icon" href="favicon.svg" type="image/svg+xml">
  <meta property="og:type" content="website">
  <meta property="og:locale" content="fr_FR">
  <meta property="og:site_name" content="${esc(site.name)}">
  <meta property="og:title" content="${esc(site.title)}">
  <meta property="og:description" content="${esc(site.description)}">
  <meta property="og:url" content="${esc(BASE_URL)}/">${
    ogImage
      ? `
  <meta property="og:image" content="${esc(absolute(ogImage.src))}">
  <meta property="og:image:width" content="${ogImage.width}">
  <meta property="og:image:height" content="${ogImage.height}">
  <meta property="og:image:alt" content="${esc(ogImage.alt)}">
  <meta name="twitter:card" content="summary_large_image">`
      : ''
  }
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="${FONTS_URL}">
  <link rel="stylesheet" href="styles.css">
${ld}
</head>
<body>
  <header class="site-header">
    <p class="brand serif"><a href="./">${esc(site.name)}</a></p>
    <nav class="site-nav" aria-label="Boutiques en ligne">
      ${headerLinks}
    </nav>
  </header>
  <main>
    <section class="intro">
      <p class="overline"><span class="long">Objets décoratifs, fabriqués en France</span><span class="short">Fabriqués en France</span></p>
      <h1 class="serif">Des objets qui font la lumière.</h1>
      <p class="lede">Petites séries, finies à la main. Pour commander, choisis Etsy (paiement sécurisé, livraison) ou Leboncoin (envoi ou remise en main propre).</p>
    </section>
    <section class="products" aria-label="Produits">
      <ul class="grid">${cards}
      </ul>
    </section>
  </main>
  <footer class="site-footer">
    <p class="footer-brand serif">${esc(site.name)}</p>
    <p class="footer-note">Vente par un particulier<span class="long"> · Contact via Etsy ou Leboncoin</span></p>
  </footer>
</body>
</html>
`;
}

function main() {
  const site = { ...readJson('data/site.json') };
  const products = loadProducts();

  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });
  if (existsSync(PUBLIC_DIR)) cpSync(PUBLIC_DIR, DIST, { recursive: true });

  writeFileSync(join(DIST, '.nojekyll'), '');
  writeFileSync(join(DIST, 'index.html'), renderIndex(products, site));
  writeFileSync(join(DIST, 'styles.css'), readFileSync(join(ROOT, 'src/styles.css')));
  writeFileSync(
    join(DIST, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>${esc(BASE_URL)}/</loc>\n  </url>\n</urlset>\n`,
  );
  writeFileSync(join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${BASE_URL}/sitemap.xml\n`);

  console.log(`build ok : ${products.length} produit(s) -> ${resolve(DIST)}`);
  console.log(`BASE_URL = ${BASE_URL}`);
}

main();
