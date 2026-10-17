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
  '&family=Fraunces:ital,opsz,wght,SOFT,WONK@0,9..144,300,0,1;0,9..144,400,0,1;1,9..144,300,0,1;1,9..144,400,0,1' +
  '&display=swap';

const CURRENCY_SYMBOLS = { EUR: '€' };
const NBSP = '\u00a0';

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

const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');

// ---------------------------------------------------------------------------
// Textes : une chaîne, ou { d, m } quand la maquette mobile dit autre chose que le bureau.
// d / m peuvent être un tableau (une ligne par entrée).
// ---------------------------------------------------------------------------
const lines = (v) => (Array.isArray(v) ? v : [v]);
const flat = (v) => lines(v).join(' ');
const plain = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? flat(v.d ?? v.m) : flat(v));
const html = (v) => lines(v).map(esc).join('<br>');

function dm(v) {
  if (v == null) return '';
  if (typeof v !== 'object' || Array.isArray(v)) return html(v);
  if (v.d == null) return `<span class="m-only">${html(v.m)}</span>`;
  if (v.m == null) return `<span class="d-only">${html(v.d)}</span>`;
  if (JSON.stringify(v.d) === JSON.stringify(v.m)) return html(v.d);
  return `<span class="d-only">${html(v.d)}</span><span class="m-only">${html(v.m)}</span>`;
}

// ---------------------------------------------------------------------------
// Données
// ---------------------------------------------------------------------------
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
      const meta = typeof img === 'object' ? img : {};
      return {
        src,
        alt: meta.alt || `${p.name}, photo ${i + 1}`,
        caption: meta.caption,
        detailCaption: meta.detailCaption,
        width,
        height,
      };
    });
    if (images.length === 0) throw new Error(`Le produit « ${p.id} » n'a aucune image.`);
    const pick = (list, fallback) => {
      const idx = (Array.isArray(list) ? list : fallback).filter((n) => Number.isInteger(n) && images[n]);
      return idx.map((n) => images[n]);
    };
    const all = images.map((_, i) => i);
    const slug = p.slug || p.id;
    const index = (n, fallback = 0) => (Number.isInteger(n) && images[n] ? n : fallback);
    return {
      ...p,
      slug,
      images,
      main: images[index(p.galleryImages?.[0])],
      hero: images[index(p.heroImage)],
      heroMobile: images[index(p.heroImageMobile, index(p.galleryImages?.[0]))],
      night: images[index(p.nightImage, index(p.heroImage))],
      gallery: pick(p.galleryImages, all),
      mood: pick(p.moodImages, all.slice(0, 3)),
      details: pick(p.detailImages, all.slice(0, 3)),
    };
  });
}

const featuredOf = (products) => products.find((p) => p.featured) ?? products[0];

const formatPrice = (value) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value);
const priceAmount = (p) => `${formatPrice(p.priceFrom)}${NBSP}${CURRENCY_SYMBOLS[p.currency ?? 'EUR'] ?? p.currency}`;

const abs = (path) => `${BASE_URL}/${path}`;
const productPath = (p) => `${encodePath(p.slug)}/`;
const leboncoinOf = (site, products) =>
  site.leboncoinShopUrl || (products.length === 1 ? products[0].leboncoinUrl : '') || '';

// ---------------------------------------------------------------------------
// Briques HTML
// ---------------------------------------------------------------------------
const ICONS = {
  main: '<path d="M11 2.75L12.65 6.96667L16.9583 8.25L12.65 9.53333L11 13.75L9.35 9.53333L5.04167 8.25L9.35 6.96667L11 2.75Z"/><path d="M17.4167 13.75L18.15 15.5833L19.9833 16.3167L18.15 17.05L17.4167 18.8833L16.6833 17.05L14.85 16.3167L16.6833 15.5833L17.4167 13.75Z"/>',
  lumiere:
    '<path d="M8.25 16.5H13.75M9.16667 19.25H12.8333"/><path d="M11 2.75C9.82941 2.74268 8.68702 3.10904 7.73902 3.79579C6.79101 4.48253 6.08685 5.45384 5.72896 6.5684C5.37107 7.68296 5.37813 8.88264 5.74912 9.99291C6.1201 11.1032 6.83564 12.0661 7.79167 12.7417C8.34167 13.2 8.70833 13.8417 8.70833 14.575V14.6667H13.2917V14.575C13.2917 13.8417 13.6583 13.2 14.2083 12.7417C15.1644 12.0661 15.8799 11.1032 16.2509 9.99291C16.6219 8.88264 16.6289 7.68296 16.271 6.5684C15.9132 5.45384 15.209 4.48253 14.261 3.79579C13.313 3.10904 12.1706 2.74268 11 2.75Z"/>',
  pluie:
    '<path d="M2.75 11C2.75 8.81196 3.61919 6.71354 5.16637 5.16637C6.71354 3.61919 8.81196 2.75 11 2.75C13.188 2.75 15.2865 3.61919 16.8336 5.16637C18.3808 6.71354 19.25 8.81196 19.25 11H2.75Z"/><path d="M11 11V17.4167C11 17.9029 10.8068 18.3692 10.463 18.713C10.1192 19.0568 9.6529 19.25 9.16667 19.25C8.68044 19.25 8.21412 19.0568 7.8703 18.713C7.52649 18.3692 7.33333 17.9029 7.33333 17.4167"/>',
  bouclier:
    '<path d="M11 2.75L18.3333 5.5V11C18.3333 15.125 15.2167 18.5167 11 19.25C6.78333 18.5167 3.66667 15.125 3.66667 11V5.5L11 2.75Z"/><path d="M7.79167 11L10.0833 13.2917L14.2083 8.70833"/>',
};

const icon = (name) =>
  `<svg class="icon" width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;

const extLink = (href, cls, label, extra = '') =>
  `<a${cls ? ` class="${cls}"` : ''} href="${esc(href)}" target="_blank" rel="noopener"${extra}>${label}<span class="sr-only"> (nouvel onglet)</span></a>`;

const imgTag = (image, root, { cls = '', eager = false, priority = false } = {}) =>
  `<img${cls ? ` class="${cls}"` : ''} src="${esc(root + image.src)}" alt="${esc(image.alt)}" width="${image.width}" height="${image.height}"${
    eager ? (priority ? ' fetchpriority="high"' : '') : ' loading="lazy"'
  } decoding="async">`;

const priceBlock = (p, cls = '') =>
  `<p class="price${cls ? ` ${cls}` : ''}"><span class="price-from">dès</span> <span class="price-amount">${esc(priceAmount(p))}</span></p>`;

function header(site, { root, overlay, collectionId }) {
  const n = site.nav;
  return `
  <header class="nav${overlay ? ' nav--overlay' : ''}">
    <div class="nav-inner">
      <a class="logo" href="${root || './'}" aria-label="${esc(site.name)}, accueil"><span class="dot-logo" aria-hidden="true"></span><span class="logo-name serif">${esc(site.name)}</span></a>
      <nav class="nav-links" aria-label="Navigation principale">
        <a class="nav-link" href="${root}#${collectionId}">${esc(n.collection)}</a>
        <a class="nav-link" href="${root}#commander">${esc(n.commander)}</a>
        <a class="nav-link" href="${root}#atelier">${esc(n.atelier)}</a>
        ${site.etsyShopUrl ? extLink(site.etsyShopUrl, 'btn btn-outline btn-nav', `<span class="d-only">${esc(n.etsyDesktop)}</span><span class="m-only">${esc(n.etsyMobile)}</span>`) : ''}
      </nav>
    </div>
  </header>`;
}

function footer(site, products) {
  const f = site.footer;
  const lbc = leboncoinOf(site, products);
  return `
  <footer class="footer" id="atelier">
    <div class="footer-inner">
      <div class="footer-left">
        <p class="footer-brand serif">${esc(site.name)}</p>
        <p class="footer-tagline">${esc(f.tagline)}</p>
      </div>
      <p class="footer-links">
        ${site.etsyShopUrl ? extLink(site.etsyShopUrl, '', esc(f.etsy)) : ''}
        ${lbc ? extLink(lbc, '', esc(f.leboncoin)) : ''}
        <span class="d-only">${esc(f.contact)}</span>
      </p>
    </div>
  </footer>`;
}

const finalHeading = (l1, l2) =>
  `<span class="line">${esc(l1)}</span> <span class="line">${esc(l2)}</span>`;

const ARROW_SVG =
  '<svg class="arr" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 8h10M9 4l4 4-4 4"/></svg>';

// « Libellé  → » dans les textes : la flèche devient un pictogramme, le libellé reste du texte.
const CTA_ARROW = (label) => {
  const text = label.replace(/\s*→\s*$/, '');
  return text === label ? esc(label) : `${esc(text)}${ARROW_SVG}`;
};

function head({ title, description, canonical, ogType, ogImage, site, root, ld }) {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <meta name="theme-color" content="#120D0A">
  <link rel="canonical" href="${esc(canonical)}">
  <link rel="icon" href="${root}favicon.svg" type="image/svg+xml">
  <meta property="og:type" content="${ogType}">
  <meta property="og:locale" content="fr_FR">
  <meta property="og:site_name" content="${esc(site.name)}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${esc(canonical)}">${
    ogImage
      ? `
  <meta property="og:image" content="${esc(abs(encodePath(ogImage.src)))}">
  <meta property="og:image:width" content="${ogImage.width}">
  <meta property="og:image:height" content="${ogImage.height}">
  <meta property="og:image:alt" content="${esc(ogImage.alt)}">
  <meta name="twitter:card" content="summary_large_image">`
      : ''
  }
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="${FONTS_URL}">
  <link rel="stylesheet" href="${root}styles.css">
  <script>${INLINE_SCRIPT}</script>
${ld.map((x) => `  <script type="application/ld+json">${jsonLd(x)}</script>`).join('\n')}
</head>`;
}

// Amélioration progressive uniquement : sans JS, tout reste lisible et cliquable.
const INLINE_SCRIPT = `(function(){var d=document;d.documentElement.classList.add('js');d.addEventListener('DOMContentLoaded',function(){
var main=d.getElementById('galerie-principale'),thumbs=d.querySelectorAll('[data-thumb]');
thumbs.forEach(function(a){a.addEventListener('click',function(e){if(!main)return;e.preventDefault();
main.src=a.getAttribute('data-src');main.alt=a.getAttribute('data-alt');main.width=+a.getAttribute('data-w');main.height=+a.getAttribute('data-h');
thumbs.forEach(function(t){var on=t===a;t.classList.toggle('is-active',on);t.setAttribute('aria-current',on?'true':'false');});});});
var bar=d.getElementById('barre-achat'),anchor=d.getElementById('achat'),io='IntersectionObserver' in window;
if(bar&&anchor&&io){new IntersectionObserver(function(es){es.forEach(function(e){bar.classList.toggle('is-visible',!e.isIntersecting&&e.boundingClientRect.top<0);});}).observe(anchor);}
var rv=d.querySelectorAll('.reveal');
if(!io){rv.forEach(function(el){el.classList.add('is-in');});}else{var o=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('is-in');o.unobserve(e.target);}});},{rootMargin:'0px 0px -8% 0px'});rv.forEach(function(el){o.observe(el);});}
});})();`;

// ---------------------------------------------------------------------------
// Accueil
// ---------------------------------------------------------------------------
function renderHome(products, site) {
  const feat = featuredOf(products);
  const many = products.length > 1;
  const collectionId = many ? 'collection' : 'piece';
  const h = site.hero;
  const m = site.moment;
  const a = site.ambiance;
  const root = '';
  const productHref = `${productPath(feat)}`;

  const heroPicture = `<picture>
          <source media="(max-width: 860px)" srcset="${esc(feat.heroMobile.src)}" width="${feat.heroMobile.width}" height="${feat.heroMobile.height}">
          ${imgTag(feat.hero, root, { eager: true, priority: true })}
        </picture>`;

  const atouts = site.atouts
    .map(
      (t) => `
          <li class="atout">
            <span class="atout-icon">${icon(t.icon)}</span>
            <div class="atout-text">
              <p class="atout-title">${dm(t.title)}</p>
              <p class="atout-desc">${dm(t.text)}</p>
            </div>
          </li>`,
    )
    .join('');

  const mood = feat.mood
    .map(
      (img, i) => `
          <figure class="tile tile-${i + 1} reveal">
            ${imgTag(img, root)}
            <figcaption class="tile-caption serif">${esc(img.caption ?? '')}</figcaption>
          </figure>`,
    )
    .join('');

  const grid = many
    ? `
    <section class="section collection" id="collection" aria-labelledby="collection-titre">
      <div class="wrap">
        <p class="eyebrow eyebrow--gold">${esc(site.collection.eyebrow)}</p>
        <h2 class="h-section serif" id="collection-titre">${esc(site.collection.title)}</h2>
        <ul class="grid">${products
          .map(
            (p) => `
          <li class="card reveal">
            <a class="card-link" href="${productPath(p)}">
              ${imgTag(p.main, root, { cls: 'card-photo' })}
              <span class="card-body">
                <span class="card-name serif">${esc(p.name)}</span>
                <span class="card-detail">${esc(p.detail ?? '')}</span>
                ${priceBlock(p, 'price--small')}
              </span>
            </a>
          </li>`,
          )
          .join('')}
        </ul>
      </div>
    </section>`
    : '';

  const steps = site.steps.items
    .map((s, i) => {
      const textHtml = dm(s.text);
      return `
          <li class="step reveal">
            <p class="step-num serif" aria-hidden="true">${String(i + 1).padStart(2, '0')}</p>
            <div class="step-text">
              <h3 class="step-title">${esc(s.title)}</h3>
              <p class="step-desc">${textHtml}</p>
            </div>
          </li>`;
    })
    .join('');

  const ld = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: site.name,
      url: `${BASE_URL}/`,
      description: site.description,
      inLanguage: 'fr-FR',
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: site.name,
      url: `${BASE_URL}/`,
      description: site.footer.tagline,
      sameAs: [site.etsyShopUrl, leboncoinOf(site, products)].filter(Boolean),
    },
  ];

  return `${head({
    title: site.title,
    description: site.description,
    canonical: `${BASE_URL}/`,
    ogType: 'website',
    ogImage: feat.hero,
    site,
    root,
    ld,
  })}
<body class="page-home">
  <a class="skip" href="#contenu">Aller au contenu</a>
${header(site, { root, overlay: true, collectionId })}
  <main id="contenu">
  <section class="hero" aria-label="Présentation">
    <div class="hero-photo">
        ${heroPicture}
    </div>
    <div class="hero-shade" aria-hidden="true"></div>
    <div class="hero-fade" aria-hidden="true"></div>
    <div class="glow glow--hero" aria-hidden="true"></div>
    <div class="hero-text">
      <p class="eyebrow eyebrow--gold">${dm(h.eyebrow)}</p>
      <h1 class="hero-title serif"><span class="line">${esc(h.titleLine1)}</span> <em class="line">${esc(h.titleLine2)}</em></h1>
      <p class="hero-sub">${dm(h.subtitle)}</p>
      <div class="hero-actions">
        <a class="btn btn-primary" href="${productHref}">${CTA_ARROW(h.primaryCta)}</a>
        ${feat.etsyUrl ? extLink(feat.etsyUrl, 'btn btn-outline', esc(h.etsyCta)) : ''}
      </div>
      <ul class="guarantees d-only">${h.guarantees.map((g) => `<li><span class="dot-small" aria-hidden="true"></span>${esc(g)}</li>`).join('')}</ul>
    </div>
  </section>

  <section class="atouts" aria-label="Nos engagements">
    <div class="wrap">
      <ul class="atouts-box">${atouts}
      </ul>
    </div>
  </section>

  <section class="moment" id="piece" aria-labelledby="moment-titre">
    <div class="wrap moment-grid">
      <div class="moment-visual reveal">
        <div class="glow glow--moment" aria-hidden="true"></div>
        <a class="moment-photo" href="${productHref}" tabindex="-1" aria-hidden="true">${imgTag(feat.main, root)}</a>
        <p class="tag d-only"><span class="dot-tag" aria-hidden="true"></span>${esc(feat.badge ?? '')}</p>
      </div>
      <div class="moment-text reveal">
        <p class="eyebrow eyebrow--ember">${esc(m.eyebrow)}</p>
        <h2 class="h-moment serif" id="moment-titre">${esc(feat.name)}</h2>
        <p class="moment-pitch">${dm(feat.pitch ?? feat.description)}</p>
        <ul class="chips d-only">${(feat.highlights ?? []).map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
        ${priceBlock(feat)}
        <p class="moment-note d-only">${esc(m.note)}</p>
        <div class="moment-actions">
          <a class="btn btn-primary" href="${productHref}">${CTA_ARROW(m.primaryCta)}</a>
          ${feat.etsyUrl ? extLink(feat.etsyUrl, 'btn btn-outline d-only', esc(m.etsyCta)) : ''}
        </div>
      </div>
    </div>
  </section>

  <section class="ambiance" aria-labelledby="ambiance-titre">
    <div class="wrap">
      <div class="ambiance-head reveal">
        <div>
          <p class="eyebrow eyebrow--gold">${esc(a.eyebrow)}</p>
          <h2 class="h-ambiance serif" id="ambiance-titre">${finalHeading(a.titleLine1, a.titleLine2)}</h2>
        </div>
        <p class="ambiance-text d-only">${esc(a.text)}</p>
      </div>
      <div class="mosaic">${mood}
      </div>
    </div>
  </section>
${grid}
  <section class="steps" id="commander" aria-labelledby="steps-titre">
    <div class="wrap">
      <div class="steps-head reveal">
        <p class="eyebrow eyebrow--gold">${esc(site.steps.eyebrow)}</p>
        <h2 class="h-steps serif" id="steps-titre">${esc(site.steps.title)}</h2>
      </div>
      <ol class="steps-list">${steps}
      </ol>
    </div>
  </section>

  <section class="final" aria-labelledby="final-titre">
    <div class="glow glow--final" aria-hidden="true"></div>
    <div class="final-inner reveal">
      <p class="eyebrow eyebrow--gold">${esc(site.finalHome.eyebrow)}</p>
      <h2 class="h-final serif" id="final-titre">${finalHeading(site.finalHome.titleLine1, site.finalHome.titleLine2)}</h2>
      <a class="btn btn-primary" href="${productHref}">${CTA_ARROW(site.finalHome.cta)}</a>
    </div>
  </section>
  </main>
${footer(site, products)}
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Fiche produit
// ---------------------------------------------------------------------------
function productJsonLd(p, site) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    sku: p.id,
    url: abs(productPath(p)),
    image: p.images.map((img) => abs(encodePath(img.src))),
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

function renderProduct(p, products, site) {
  const root = '../';
  const s = site.product;
  const many = products.length > 1;
  const collectionId = many ? 'collection' : 'piece';
  const eyebrow = [p.collection, p.badge].filter(Boolean).join(' · ');
  const pageUrl = abs(productPath(p));
  const description = p.description;

  const thumbs = p.gallery
    .map(
      (img, i) => `
            <a class="thumb${i === 0 ? ' is-active' : ''}" href="${esc(root + img.src)}" data-thumb data-src="${esc(root + img.src)}" data-alt="${esc(img.alt)}" data-w="${img.width}" data-h="${img.height}" aria-label="Voir la photo ${i + 1} sur ${p.gallery.length}"${i === 0 ? ' aria-current="true"' : ''}>
              ${imgTag(img, root)}
            </a>`,
    )
    .join('');

  const specs = (p.specs ?? [])
    .map(
      (r) => `
            <div class="spec"><dt>${esc(r.label)}</dt><dd>${dm(r.value)}</dd></div>`,
    )
    .join('');

  const details = p.details
    .map(
      (img) => `
          <figure class="detail reveal">
            ${imgTag(img, root)}
            <figcaption>${esc(img.detailCaption ?? img.caption ?? '')}</figcaption>
          </figure>`,
    )
    .join('');

  const faq = (p.faq ?? [])
    .map(
      (f) => `
          <details class="faq-card reveal${f.mobile === false ? ' d-only' : ''}" open>
            <summary>${esc(f.q)}</summary>
            <p>${dm(f.a)}</p>
          </details>`,
    )
    .join('');

  const lbcOption = p.leboncoinUrl
    ? extLink(
        p.leboncoinUrl,
        'btn btn-leboncoin buy-option buy-option--alt',
        `<span class="buy-option-text"><span class="buy-option-title">${esc(s.leboncoinLabel)}</span><span class="buy-option-sub">${dm(s.leboncoinSub)}</span></span><span class="buy-option-arrow" aria-hidden="true">${ARROW_SVG}</span>`,
      )
    : '';

  const mainEtsy = extLink(
    p.etsyUrl,
    'btn btn-etsy buy-option buy-option--primary',
    `<span class="buy-option-text"><span class="buy-option-title">${esc(s.etsyLabel)}</span><span class="buy-option-sub">${dm(s.etsySub)}</span></span><span class="buy-option-arrow" aria-hidden="true">${ARROW_SVG}</span>`,
  );

  return `${head({
    title: p.title || `${p.name} · ${p.collection ?? 'Collection'} — ${site.name}`,
    description,
    canonical: pageUrl,
    ogType: 'product',
    ogImage: p.main,
    site,
    root,
    ld: [productJsonLd(p, site)],
  })}
<body class="page-product">
  <a class="skip" href="#contenu">Aller au contenu</a>
${header(site, { root, overlay: false, collectionId })}
  <nav class="crumbs d-only" aria-label="Fil d’Ariane">
    <div class="wrap"><a href="${root}#${collectionId}">${esc(s.breadcrumbRoot)}</a><span class="crumbs-sep" aria-hidden="true">/</span><span aria-current="page">${esc(p.name)}</span></div>
  </nav>

  <main id="contenu">
    <section class="product">
      <div class="wrap product-grid">
        <div class="gallery">
          <div class="gallery-main">
            <img id="galerie-principale" src="${esc(root + p.main.src)}" alt="${esc(p.main.alt)}" width="${p.main.width}" height="${p.main.height}" fetchpriority="high" decoding="async">
            ${p.badge ? `<p class="tag"><span class="dot-tag" aria-hidden="true"></span>${esc(p.badge)}</p>` : ''}
          </div>
          <div class="thumbs">${thumbs}
          </div>
        </div>
        <div class="buy">
          <p class="eyebrow eyebrow--ember">${esc(eyebrow)}</p>
          <h1 class="h-product serif">${esc(p.name)}</h1>
          <p class="product-tagline">${dm(p.tagline ?? p.description)}</p>
          ${priceBlock(p)}
          <div class="buy-box" id="achat" role="group" aria-label="${esc(s.buyTitle)}">
            ${mainEtsy}
            ${lbcOption}
            <p class="buy-note">${esc(s.priceNote)}</p>
          </div>
          <dl class="specs">${specs}
          </dl>
          <ul class="reassurance d-only">${s.reassurance.map((r) => `<li><span class="dot-small" aria-hidden="true"></span>${esc(r)}</li>`).join('')}</ul>
        </div>
      </div>
    </section>

    <section class="night" aria-label="${esc(s.storyEyebrow)}">
      ${imgTag(p.night, root, { cls: 'night-photo' })}
      <div class="night-shade" aria-hidden="true"></div>
      <div class="night-text">
        <p class="eyebrow eyebrow--gold d-only">${esc(s.storyEyebrow)}</p>
        <blockquote class="night-quote serif">« ${esc(p.quote ?? '')} »</blockquote>
        <p class="night-story d-only">${esc(p.story ?? '')}</p>
      </div>
    </section>

    <section class="details d-only" aria-labelledby="details-titre">
      <div class="wrap">
        <h2 class="h-section serif" id="details-titre">${esc(s.detailsTitle)}</h2>
        <div class="details-grid">${details}
        </div>
      </div>
    </section>

    <section class="faq" aria-labelledby="faq-titre">
      <div class="wrap">
        <h2 class="h-section serif" id="faq-titre">${esc(s.faqTitle)}</h2>
        <div class="faq-grid">${faq}
        </div>
      </div>
    </section>

    <section class="final final--product d-only" aria-labelledby="final-titre">
      <div class="glow glow--final" aria-hidden="true"></div>
      <div class="final-inner reveal">
        <p class="eyebrow eyebrow--gold">${esc(s.final.eyebrow)}</p>
        <h2 class="h-final serif" id="final-titre">${finalHeading(s.final.titleLine1, s.final.titleLine2)}</h2>
        ${extLink(p.etsyUrl, 'btn btn-primary', CTA_ARROW(s.final.cta))}
      </div>
    </section>
  </main>
${footer(site, products)}
  <div class="buybar" id="barre-achat">
    <p class="buybar-price"><span class="buybar-from">dès</span> <span class="buybar-amount serif">${esc(priceAmount(p))}</span></p>
    ${extLink(p.etsyUrl, 'btn btn-primary', CTA_ARROW(s.stickyCta))}
  </div>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
function main() {
  const site = readJson('data/site.json');
  const products = loadProducts();

  const slugs = new Set();
  for (const p of products) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.slug)) throw new Error(`Slug invalide pour « ${p.id} » : ${p.slug}`);
    if (slugs.has(p.slug)) throw new Error(`Slug en double : ${p.slug}`);
    slugs.add(p.slug);
  }

  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });
  if (existsSync(PUBLIC_DIR)) cpSync(PUBLIC_DIR, DIST, { recursive: true });

  writeFileSync(join(DIST, '.nojekyll'), '');
  writeFileSync(join(DIST, 'index.html'), renderHome(products, site));
  for (const p of products) {
    mkdirSync(join(DIST, p.slug), { recursive: true });
    writeFileSync(join(DIST, p.slug, 'index.html'), renderProduct(p, products, site));
  }
  writeFileSync(join(DIST, 'styles.css'), readFileSync(join(ROOT, 'src/styles.css')));

  const urls = [`${BASE_URL}/`, ...products.map((p) => abs(productPath(p)))];
  writeFileSync(
    join(DIST, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
      .map((u) => `  <url>\n    <loc>${esc(u)}</loc>\n  </url>`)
      .join('\n')}\n</urlset>\n`,
  );
  writeFileSync(join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${BASE_URL}/sitemap.xml\n`);

  console.log(`build ok : accueil + ${products.length} fiche(s) produit -> ${resolve(DIST)}`);
  for (const p of products) console.log(`  /${p.slug}/`);
  console.log(`BASE_URL = ${BASE_URL}`);
}

main();
