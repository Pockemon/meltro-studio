#!/usr/bin/env node
// Génère dist/ à partir de data/, src/ et public/. Node 20, modules natifs uniquement.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, 'dist');
const PUBLIC_DIR = join(ROOT, 'public');

// Le site est servi sous un sous-chemin (GitHub Pages) : le HTML n'utilise que des chemins relatifs.
// BASE_URL (data/site.json › baseUrl) ne sert qu'aux URL absolues : canonical, Open Graph, JSON-LD, sitemap, robots.txt.
let BASE_URL = '';

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
      night: images[index(p.nightImage, index(p.galleryImages?.[0]))],
      gallery: pick(p.galleryImages, all),
      details: pick(p.detailImages, all.slice(0, 3)),
    };
  });
}

const HEX = /^#[0-9a-f]{6}$/i;

function loadCollections() {
  const raw = readJson('data/collections.json');
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('data/collections.json doit contenir un tableau de collections.');
  const seen = new Set();
  return raw
    .map((c) => {
      for (const key of ['slug', 'name', 'season', 'tagline', 'description', 'accent']) {
        if (typeof c[key] !== 'string' || !c[key].trim()) throw new Error(`data/collections.json : « ${key} » manquant (${JSON.stringify(c).slice(0, 60)}).`);
      }
      if (!Number.isFinite(c.order)) throw new Error(`data/collections.json : « order » doit être un nombre (${c.slug}).`);
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(c.slug)) throw new Error(`Slug de collection invalide : ${c.slug}`);
      if (seen.has(c.slug)) throw new Error(`Slug de collection en double : ${c.slug}`);
      seen.add(c.slug);
      if (!HEX.test(c.accent)) throw new Error(`data/collections.json : accent invalide pour « ${c.slug} » (attendu #RRGGBB).`);
      const n = parseInt(c.accent.slice(1), 16);
      const rgb = [n >> 16, (n >> 8) & 255, n & 255];
      const lum = (v) => {
        const [r, g, bl] = v.map((x) => ((x / 255) <= 0.03928 ? x / 255 / 12.92 : (((x / 255) + 0.055) / 1.055) ** 2.4));
        return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
      };
      const ratio = (a, b2) => (Math.max(lum(a), lum(b2)) + 0.05) / (Math.min(lum(a), lum(b2)) + 0.05);
      const dark = [0x1a, 0x0f, 0x08];
      const cream = [0xff, 0xf4, 0xe6];
      return { ...c, accentRgb: rgb.join(' '), onAccent: ratio(rgb, dark) >= ratio(rgb, cream) ? '#1a0f08' : '#fff4e6' };
    })
    .sort((a, b) => a.order - b.order);
}

const featuredOf = (products) => products.find((p) => p.featured) ?? products[0];

// Image d'un produit désignée dans site.json : { product: id, image: index } (repli : premier produit, première image).
function pickImage(products, ref, fallbackIndex = 0) {
  const p = products.find((x) => x.id === ref?.product) ?? products[0];
  return p.images[Number.isInteger(ref?.image) && p.images[ref.image] ? ref.image : fallbackIndex] ?? p.images[0];
}

const formatPrice = (value) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value);
const priceAmount = (p) => `${formatPrice(p.priceFrom)}${NBSP}${CURRENCY_SYMBOLS[p.currency ?? 'EUR'] ?? p.currency}`;

const abs = (path) => `${BASE_URL}/${path}`;
const productPath = (p) => `${encodePath(p.slug)}/`;
const collectionPath = (c) => `collections/${encodePath(c.slug)}/`;
const piecesOf = (c, products) => products.filter((p) => p.collection === c.slug);
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

const priceBlock = (p, cls = '', tag = 'p') =>
  `<${tag} class="price${cls ? ` ${cls}` : ''}"><span class="price-from">dès</span> <span class="price-amount">${esc(priceAmount(p))}</span></${tag}>`;

const vtName = (p) => `photo-${p.slug}`;

function header(site, { root, overlay }) {
  const n = site.nav;
  return `
  <header class="nav${overlay ? ' nav--overlay' : ''}">
    <div class="nav-inner">
      <a class="logo" href="${root || './'}" aria-label="${esc(site.name)}, accueil"><span class="dot-logo" aria-hidden="true"></span><span class="logo-name serif">${esc(site.name)}</span></a>
      <nav class="nav-links" aria-label="Navigation principale">
        <a class="nav-link" href="${root}#collections">${esc(n.collections)}</a>
        <a class="nav-link" href="${root}#atelier">${esc(n.atelier)}</a>
        <a class="nav-link" href="${root}#commander">${esc(n.commander)}</a>
        ${site.etsyShopUrl ? extLink(site.etsyShopUrl, 'btn btn-outline btn-nav', `<span class="d-only">${esc(n.etsyDesktop)}</span><span class="m-only">${esc(n.etsyMobile)}</span>`) : ''}
      </nav>
    </div>
  </header>`;
}

function footer(site, products) {
  const f = site.footer;
  const lbc = leboncoinOf(site, products);
  return `
  <footer class="footer">
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
// Effets de profondeur : transform et opacity seulement, coupés en « réduire les animations » et sur écran tactile.
const INLINE_SCRIPT = `(function(){var d=document,rm=matchMedia('(prefers-reduced-motion: reduce)'),co=matchMedia('(pointer: coarse)');d.documentElement.classList.add('js');
function fx(){return!rm.matches&&!co.matches}
function tilt(host,max,go,stop){if(!host)return;var ev=0,raf=0;
function paint(){raf=0;if(!ev)return;var b=host.getBoundingClientRect(),x=(ev.clientX-b.left)/b.width,y=(ev.clientY-b.top)/b.height;go((y-.5)*2*max,(.5-x)*2*max,x*b.width,y*b.height);}
host.addEventListener('pointermove',function(e){if(e.pointerType==='touch'||!fx())return;ev=e;if(!raf)raf=requestAnimationFrame(paint);});
host.addEventListener('pointerleave',function(){ev=0;stop();});}
function put(el,rx,ry,per){el.style.transform='perspective('+per+'px) rotateX('+rx.toFixed(2)+'deg) rotateY('+ry.toFixed(2)+'deg)';}
d.addEventListener('DOMContentLoaded',function(){
var main=d.getElementById('galerie-principale'),thumbs=d.querySelectorAll('[data-thumb]');
thumbs.forEach(function(a){a.addEventListener('click',function(e){if(!main)return;e.preventDefault();
main.src=a.getAttribute('data-src');main.alt=a.getAttribute('data-alt');main.width=+a.getAttribute('data-w');main.height=+a.getAttribute('data-h');
thumbs.forEach(function(t){var on=t===a;t.classList.toggle('is-active',on);t.setAttribute('aria-current',on?'true':'false');});});});
var bar=d.getElementById('barre-achat'),anchor=d.getElementById('achat'),io='IntersectionObserver' in window;
if(bar&&anchor&&io){new IntersectionObserver(function(es){es.forEach(function(e){bar.classList.toggle('is-visible',!e.isIntersecting&&e.boundingClientRect.top<0);});}).observe(anchor);}
var rv=d.querySelectorAll('.reveal');
if(!io){rv.forEach(function(el){el.classList.add('is-in');});}else{var o=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('is-in');o.unobserve(e.target);}});},{rootMargin:'0px 0px -8% 0px'});rv.forEach(function(el){o.observe(el);});}
var hero=d.querySelector('.hero'),st=hero&&hero.querySelector('.stage');
if(st)tilt(hero,8,function(rx,ry){st.style.setProperty('--rx',rx.toFixed(2)+'deg');st.style.setProperty('--ry',ry.toFixed(2)+'deg');},function(){st.style.removeProperty('--rx');st.style.removeProperty('--ry');});
d.querySelectorAll('.card-item').forEach(function(c){var t=c.querySelector('.card-tilt'),g=c.querySelector('.card-glare');if(!t||!g)return;
tilt(c,10,function(rx,ry,x,y){put(t,rx,ry,900);g.style.transform='translate('+x.toFixed(0)+'px,'+y.toFixed(0)+'px)';c.classList.add('is-hot');},function(){t.style.transform='';c.classList.remove('is-hot');});});
var gs=d.querySelector('.gallery-stage'),gm=gs&&gs.firstElementChild;
if(gm)tilt(gs,4,function(rx,ry){put(gm,rx,ry,1400);},function(){gm.style.transform='';});
});})();`;

// ---------------------------------------------------------------------------
// Accueil
// ---------------------------------------------------------------------------
function renderHome(products, site, collections) {
  const feat = featuredOf(products);
  const h = site.hero;
  const at = site.atelier;
  const root = '';
  const etsyShop = site.etsyShopUrl;

  const stackImages = (h.stack?.images ?? [3, 4, 0]).map((n) => pickImage(products, { product: h.stack?.product, image: n }));
  const STACK_CLASSES = ['stack-card--a', 'stack-card--b', 'stack-card--c'];
  const stack = stackImages
    .slice(0, 3)
    .map(
      (img, i) => `
          <div class="stack-card ${STACK_CLASSES[i]}">${imgTag(img, root, { eager: true, priority: i === 2 })}</div>`,
    )
    .join('');

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

  const col = site.collections;
  const withPieces = collections.find((x) => piecesOf(x, products).length > 0);
  const lead = withPieces ?? collections[0];
  const side = collections.filter((x) => x !== lead);
  const tile = (x, big) => {
    const pieces = piecesOf(x, products);
    const open = pieces.length > 0;
    const count = `${pieces.length}${NBSP}${pieces.length > 1 ? col.pieceMany : col.pieceOne}`;
    const status = open ? `${count} · ${col.statusLimited}` : col.statusSoon;
    const cta = open || !etsyShop ? `<span class="tile-cta">${CTA_ARROW(open ? col.ctaOpen : col.ctaSoon)}</span>` : extLink(etsyShop, 'tile-cta', CTA_ARROW(col.ctaSoon));
    return `
          <li class="card-item tile-item${big ? ' tile-item--lead' : ''} reveal" style="--accent:${x.accent};--accent-rgb:${x.accentRgb}">
            <div class="card-tilt">
              <article class="tile${open ? '' : ' tile--soon'}" data-collection="${esc(x.slug)}">
                <span class="tile-glow" aria-hidden="true"></span>
                ${big && open ? `<span class="tile-photo">${imgTag(pieces[0].main, root)}</span>` : ''}
                <span class="tile-shade" aria-hidden="true"></span>
                <p class="tile-status"><span class="tile-dot" aria-hidden="true"></span>${esc(status)}</p>
                <div class="tile-text">
                  <p class="tile-season">${esc(x.season)}</p>
                  <h3 class="tile-name serif"><a class="tile-link" href="${collectionPath(x)}">${esc(x.name)}</a></h3>
                  <p class="tile-tagline">${esc(x.tagline)}</p>
                  ${cta}
                </div>
                <span class="card-glare" aria-hidden="true"></span>
              </article>
            </div>
          </li>`;
  };
  const tiles = [tile(lead, true), ...side.map((x) => tile(x, false))].join('');

  const atelierPhoto = pickImage(products, at.photo, 0);

  const figures = (at.figures ?? [])
    .map(
      (f) => `
            <li><span class="figure-value serif">${esc(f.value)}</span><span class="figure-label">${esc(f.label)}</span></li>`,
    )
    .join('');

  const steps = site.steps.items
    .map(
      (s, i) => `
          <li class="step reveal">
            <p class="step-num serif" aria-hidden="true">${String(i + 1).padStart(2, '0')}</p>
            <div class="step-text">
              <h3 class="step-title">${esc(s.title)}</h3>
              <p class="step-desc">${dm(s.text)}</p>
            </div>
          </li>`,
    )
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
    ogImage: feat.main,
    site,
    root,
    ld,
  })}
<body class="page-home">
  <a class="skip" href="#contenu">Aller au contenu</a>
${header(site, { root, overlay: true })}
  <main id="contenu">
  <section class="hero" aria-label="Présentation">
    <div class="glow glow--hero" aria-hidden="true"></div>
    <div class="stage">
      <div class="stage-float">
        <div class="stage-tilt">${stack}
        </div>
      </div>
    </div>
    <div class="hero-text">
      <p class="eyebrow eyebrow--gold">${esc(h.eyebrow)}</p>
      <h1 class="hero-title serif"><span class="line">${esc(h.titleLine1)}</span> <span class="line">${esc(h.titleLine2)}<em>${esc(h.titleEmphasis)}</em></span></h1>
      <p class="hero-sub">${dm(h.subtitle)}</p>
      <div class="hero-actions">
        <a class="btn btn-primary" href="#collections">${CTA_ARROW(h.primaryCta)}</a>
        ${etsyShop ? extLink(etsyShop, 'btn btn-outline', esc(h.etsyCta)) : ''}
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

  <section class="collections" id="collections" aria-labelledby="collections-titre">
    <div class="wrap">
      <div class="collections-head reveal">
        <div>
          <p class="eyebrow eyebrow--gold">${esc(col.eyebrow)}</p>
          <h2 class="h-collections serif" id="collections-titre">${finalHeading(col.titleLine1, col.titleLine2)}</h2>
        </div>
        <p class="collections-text d-only">${esc(col.text)}</p>
      </div>
      <ul class="tiles" style="--n:${Math.max(1, side.length)}">${tiles}
      </ul>
    </div>
  </section>

  <section class="atelier" id="atelier" aria-labelledby="atelier-titre">
    <div class="wrap atelier-grid reveal">
      <div class="atelier-visual">
        <div class="glow glow--atelier" aria-hidden="true"></div>
        <div class="atelier-photo">${imgTag(atelierPhoto, root)}</div>
      </div>
      <div class="atelier-text">
        <p class="eyebrow eyebrow--gold">${esc(at.eyebrow)}</p>
        <h2 class="h-atelier serif" id="atelier-titre">${finalHeading(at.titleLine1, at.titleLine2)}</h2>
        <p class="atelier-p">${dm(at.text)}</p>
        <ul class="figures d-only">${figures}
        </ul>
      </div>
    </div>
  </section>

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
      <a class="btn btn-primary" href="#collections">${CTA_ARROW(site.finalHome.cta)}</a>
    </div>
  </section>
  </main>
${footer(site, products)}
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Page collection
// ---------------------------------------------------------------------------
function renderCollection(col, collections, products, site) {
  const root = '../../';
  const cp = site.collectionPage;
  const etsyShop = site.etsyShopUrl;
  const pieces = piecesOf(col, products);
  const pageUrl = abs(collectionPath(col));
  const title = `${col.name} · Collections — ${site.name}`;
  const description = col.description;

  const pills = collections
    .map((x) => {
      if (x === col) return `<span class="pill is-current" aria-current="page">${esc(x.name)}</span>`;
      const label = piecesOf(x, products).length ? x.name : `${x.name} · ${cp.soonSuffix}`;
      return `<a class="pill" href="${root}${collectionPath(x)}">${esc(label)}</a>`;
    })
    .join('\n        ');

  const cards = pieces
    .map(
      (p, i) => `
          <li class="card-item reveal">
            <div class="card-tilt">
              <a class="card" href="${root}${productPath(p)}">
                <span class="card-visual" style="--vt:${vtName(p)}">
                  ${imgTag(p.main, root, { cls: 'card-photo', eager: i === 0, priority: i === 0 })}
                </span>
                <span class="card-body">
                  <span class="card-name serif">${esc(p.name)}</span>
                  <span class="card-tagline">${esc(p.cardTagline ?? plain(p.tagline) ?? '')}</span>
                  <span class="card-row">
                    ${priceBlock(p, 'price--card', 'span')}
                    <span class="card-cta">${CTA_ARROW(cp.cardCta)}</span>
                  </span>
                </span>
                <span class="card-glare" aria-hidden="true"></span>
              </a>
            </div>
          </li>`,
    )
    .join('');

  const columns = Number.isInteger(cp.columns) ? cp.columns : 3;
  const soon = (cp.soon ?? [])
    .slice(0, Math.max(0, columns - pieces.length))
    .map(
      (x) => `
          <li class="card-item d-only reveal">
            <div class="card-soon card-soon--plain">
              <p class="soon-title serif">${html(x.title)}</p>
              <p class="soon-text">${esc(x.text)}</p>
            </div>
          </li>`,
    )
    .join('');

  const body = pieces.length
    ? `<ul class="grid">${cards}${soon}
      </ul>`
    : `<div class="coll-empty reveal">
        <p class="soon-title serif">${esc(cp.empty.title)}</p>
        <p class="soon-text">${esc(cp.empty.text)}</p>
        ${etsyShop ? extLink(etsyShop, 'btn btn-outline', esc(cp.empty.cta)) : ''}
      </div>`;

  const ld = [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: `${col.name} — ${site.name}`,
      url: pageUrl,
      description,
      inLanguage: 'fr-FR',
      isPartOf: { '@type': 'WebSite', name: site.name, url: `${BASE_URL}/` },
      mainEntity: {
        '@type': 'ItemList',
        name: col.name,
        numberOfItems: pieces.length,
        itemListElement: pieces.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: abs(productPath(p)), name: p.name })),
      },
    },
  ];

  return `${head({
    title,
    description,
    canonical: pageUrl,
    ogType: 'website',
    ogImage: pieces[0]?.main ?? featuredOf(products).main,
    site,
    root,
    ld,
  })}
<body class="page-collection" style="--accent:${col.accent};--accent-rgb:${col.accentRgb};--on-accent:${col.onAccent}">
  <a class="skip" href="#contenu">Aller au contenu</a>
${header(site, { root, overlay: false })}
  <main id="contenu">
    <section class="coll-head" aria-labelledby="collection-titre">
      <div class="glow glow--coll" aria-hidden="true"></div>
      <div class="coll-head-text">
        <nav class="crumbs-inline" aria-label="Fil d’Ariane">
          <a href="${root}">${esc(cp.breadcrumbHome)}</a><span class="crumbs-sep" aria-hidden="true">/</span><a href="${root}#collections">${esc(cp.breadcrumbRoot)}</a><span class="crumbs-sep" aria-hidden="true">/</span><span aria-current="page">${esc(col.name)}</span>
        </nav>
        <p class="eyebrow eyebrow--gold">${esc(col.season)}</p>
        <h1 class="h-coll serif" id="collection-titre">${esc(col.name)}</h1>
        <p class="coll-desc">${esc(col.description)}</p>
      </div>
    </section>

    <div class="wrap">
      <nav class="pills" aria-label="Autres collections">
        ${pills}
      </nav>
    </div>

    <section class="coll-pieces" aria-label="Pièces de la collection ${esc(col.name)}">
      <div class="wrap">
        ${body}
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

function renderProduct(p, products, site, collections) {
  const root = '../';
  const s = site.product;
  const col = collections.find((x) => x.slug === p.collection);
  const eyebrow = [col.name, p.badge].filter(Boolean).join(' · ');
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
    title: p.title || `${p.name} · ${col.name} — ${site.name}`,
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
${header(site, { root, overlay: false })}
  <nav class="crumbs d-only" aria-label="Fil d’Ariane">
    <div class="wrap"><a href="${root}#collections">${esc(s.breadcrumbRoot)}</a><span class="crumbs-sep" aria-hidden="true">/</span><a href="${root}${collectionPath(col)}">${esc(col.name)}</a><span class="crumbs-sep" aria-hidden="true">/</span><span aria-current="page">${esc(p.name)}</span></div>
  </nav>

  <main id="contenu">
    <section class="product">
      <div class="wrap product-grid">
        <div class="gallery">
          <div class="gallery-stage">
            <div class="gallery-main" style="--vt:${vtName(p)}">
              <img id="galerie-principale" src="${esc(root + p.main.src)}" alt="${esc(p.main.alt)}" width="${p.main.width}" height="${p.main.height}" fetchpriority="high" decoding="async">
              ${p.badge ? `<p class="tag"><span class="dot-tag" aria-hidden="true"></span>${esc(p.badge)}</p>` : ''}
            </div>
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
  BASE_URL = String(site.baseUrl ?? '').replace(/\/+$/, '');
  if (!/^https?:\/\/[^/\s]+(\/[^\s]*)?$/.test(BASE_URL)) throw new Error('data/site.json : baseUrl doit être une URL absolue (https://…).');
  const customDomain = String(site.customDomain ?? '').trim();
  if (customDomain && !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(customDomain)) {
    throw new Error(`data/site.json : customDomain invalide (« ${customDomain} »). Attendu : un nom de domaine, sans https:// ni /.`);
  }
  if (customDomain && new URL(BASE_URL).host !== customDomain) {
    console.warn(`attention : customDomain (${customDomain}) et baseUrl (${BASE_URL}) ne désignent pas le même hôte.`);
  }
  const collections = loadCollections();
  const products = loadProducts();

  const slugs = new Set();
  for (const p of products) {
    if (p.slug === 'collections') throw new Error('Le slug « collections » est réservé aux pages collection.');
    if (!collections.some((c) => c.slug === p.collection)) {
      throw new Error(`Produit « ${p.id} » : collection « ${p.collection} » inconnue (attendu : ${collections.map((c) => c.slug).join(', ')}).`);
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.slug)) throw new Error(`Slug invalide pour « ${p.id} » : ${p.slug}`);
    if (slugs.has(p.slug)) throw new Error(`Slug en double : ${p.slug}`);
    slugs.add(p.slug);
  }

  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });
  if (existsSync(PUBLIC_DIR)) cpSync(PUBLIC_DIR, DIST, { recursive: true });

  writeFileSync(join(DIST, '.nojekyll'), '');
  if (customDomain) writeFileSync(join(DIST, 'CNAME'), `${customDomain}\n`);
  writeFileSync(join(DIST, 'index.html'), renderHome(products, site, collections));
  for (const c of collections) {
    mkdirSync(join(DIST, 'collections', c.slug), { recursive: true });
    writeFileSync(join(DIST, 'collections', c.slug, 'index.html'), renderCollection(c, collections, products, site));
  }
  for (const p of products) {
    mkdirSync(join(DIST, p.slug), { recursive: true });
    writeFileSync(join(DIST, p.slug, 'index.html'), renderProduct(p, products, site, collections));
  }
  writeFileSync(join(DIST, 'styles.css'), readFileSync(join(ROOT, 'src/styles.css')));

  const urls = [`${BASE_URL}/`, ...collections.map((c) => abs(collectionPath(c))), ...products.map((p) => abs(productPath(p)))];
  writeFileSync(
    join(DIST, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
      .map((u) => `  <url>\n    <loc>${esc(u)}</loc>\n  </url>`)
      .join('\n')}\n</urlset>\n`,
  );
  writeFileSync(join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${BASE_URL}/sitemap.xml\n`);

  console.log(`build ok : accueil + ${collections.length} collection(s) + ${products.length} fiche(s) produit -> ${resolve(DIST)}`);
  for (const c of collections) console.log(`  /${collectionPath(c)} (${piecesOf(c, products).length} pièce(s))`);
  for (const p of products) console.log(`  /${p.slug}/`);
  console.log(`BASE_URL = ${BASE_URL}`);
  console.log(customDomain ? `CNAME = ${customDomain}` : 'CNAME : aucun (customDomain vide)');
}

main();
