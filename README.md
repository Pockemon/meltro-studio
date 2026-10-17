# Meltro Studio

Boutique vitrine statique des objets décoratifs de Meltro Studio (vendeur particulier), thème « Meltro Nuit ». Pas de panier ni de paiement : chaque pièce renvoie vers Etsy (achat) et, si l'URL est renseignée, vers Leboncoin.

Aucune dépendance npm, pas de cookies, pas d'analytics. Node 20 suffit. Le seul JavaScript côté client est un petit script inline d'amélioration progressive (galerie, barre d'achat mobile, apparition au défilement) : sans JS, tout reste lisible et cliquable.

## Commandes

```bash
node build.mjs   # génère dist/
node check.mjs   # contrôle les données et le contenu de dist/
```

Pour prévisualiser : `python3 -m http.server --directory dist` (ou tout autre serveur statique) puis ouvrir http://localhost:8000.

## Organisation

| Chemin | Rôle |
| --- | --- |
| `data/products.json` | Source unique des produits (une entrée = une fiche + une place sur l'accueil). |
| `data/site.json` | Textes du site : navigation, hero, atouts, étapes, appels à l'action, pied de page, titre et description SEO. |
| `src/styles.css` | Feuille de styles « Meltro Nuit », copiée dans `dist/styles.css`. |
| `public/` | Fichiers copiés tels quels dans `dist/` (images, favicon). |
| `build.mjs` | Génère `dist/index.html`, une page `dist/<slug>/index.html` par produit, `styles.css`, `sitemap.xml`, `robots.txt`, `.nojekyll`, et copie `public/`. |
| `check.mjs` | Vérifie les données et `dist/` (voir plus bas). |

`dist/` est généré et n'est pas versionné.

## Design

Le design suit le fichier Figma `oEmQewpeqRKrtyZNulXtjm`, page « 03 — Site v2 » : Accueil Desktop (1440 px), Fiche produit Desktop, Accueil Mobile (390 px), Fiche produit Mobile. Les variables de la collection « Meltro Nuit » sont les propriétés CSS de `:root` (`--bg`, `--surface`, `--surface-2`, `--line`, `--text`, `--text-muted` → `--muted`, `--ember`, `--ember-deep`, `--gold`, `--on-ember`, `--cream`). Polices : Fraunces (300, 300 italique, 400, 400 italique) pour les titres et prix, DM Sans (400, 500, 600) pour le texte, chargées depuis Google Fonts avec repli `serif` / `sans-serif`.

Sous 860 px, la mise en page « mobile » des frames Figma s'applique (textes plus courts, éléments masqués) ; entre 861 et 1180 px, la mise en page bureau s'adapte (atouts en 2 × 2, marges réduites).

## Ajouter un produit

Il suffit d'ajouter une entrée dans `data/products.json` et de déposer ses images dans `public/images/`. Rien d'autre à modifier : la fiche `/<slug>/`, sa carte dans la grille « La collection » (affichée dès qu'il y a au moins deux produits, masquée tant qu'il n'y en a qu'un), le balisage JSON-LD, le sitemap et les liens de l'accueil sont générés.

```json
{
  "id": "lampe-nuage",
  "slug": "lampe-nuage",
  "name": "Lampe nuage",
  "collection": "Maison",
  "badge": "Édition limitée",
  "featured": false,
  "detail": "Dimensions · matière · précisions",
  "priceFrom": 49,
  "currency": "EUR",
  "description": "Texte de présentation (meta description et JSON-LD).",
  "etsyUrl": "https://www.etsy.com/fr/listing/...",
  "leboncoinUrl": "",
  "tagline": "Phrase d'accroche sous le titre de la fiche.",
  "pitch": "Texte de la « pièce du moment » sur l'accueil.",
  "highlights": ["36 × 36 cm", "Guirlande fournie"],
  "quote": "Citation du bandeau nuit.",
  "story": "Histoire de la pièce (bandeau nuit, bureau).",
  "specs": [{ "label": "Dimensions", "value": "36 × 36 cm" }],
  "faq": [{ "q": "Question ?", "a": "Réponse." }],
  "heroImage": 2,
  "heroImageMobile": 0,
  "nightImage": 2,
  "galleryImages": [0, 1, 2],
  "moodImages": [2, 1, 0],
  "detailImages": [0, 1, 2],
  "images": [
    { "src": "images/lampe-nuage-1.jpg", "alt": "Description de la photo", "caption": "Légende de la mosaïque", "detailCaption": "Légende « Dans le détail »" }
  ]
}
```

- `id` et `slug` : minuscules, chiffres et tirets, uniques. `slug` (par défaut `id`) donne l'adresse de la fiche : `/<slug>/`.
- `priceFrom` : nombre, prix « à partir de » affiché sous la forme « dès 49 € » (le plus bas des prix pratiqués, ici celui de Leboncoin). Le prix Etsy n'est jamais affiché car il varie avec les promotions ; la fiche précise « Prix et frais de port selon la plateforme. ». C'est aussi le `price` de l'offre JSON-LD, dont l'`url` est `leboncoinUrl` (ou `etsyUrl` si elle est vide).
- `leboncoinUrl` : laisser vide (`""`) tant qu'il n'y a pas d'annonce, le bouton « Voir sur Leboncoin » n'est alors pas affiché.
- `featured` : le premier produit `featured` (à défaut, le premier de la liste) est la « pièce du moment » et l'image du hero de l'accueil.
- `badge` + `collection` : l'étiquette « Édition limitée » sur la photo et la ligne « Halloween · Édition limitée » au-dessus du titre.
- Textes à deux versions : `tagline`, `pitch`, la valeur d'une ligne de `specs` et la réponse d'une entrée de `faq` peuvent être une chaîne, ou `{ "d": "texte bureau", "m": "texte mobile" }` quand la maquette mobile en dit moins. Une entrée de `faq` avec `"mobile": false` n'apparaît que sur bureau.
- `images` : chemins relatifs à `public/`, dans l'ordre. Les index (`heroImage`, `heroImageMobile`, `nightImage`, `galleryImages`, `moodImages`, `detailImages`) commencent à 0 et pointent dans cette liste : hero de l'accueil (bureau / mobile), bandeau nuit de la fiche, vignettes de la galerie (la première est la photo principale), mosaïque « Dans la lumière », photos « Dans le détail ». Chaque `alt` doit être descriptif.
- Les dimensions (`width`/`height`) sont lues dans les fichiers au moment du build (JPEG, PNG ou WebP). Redimensionner les photos à 1600 px maximum avant de les ajouter.

## Ce que vérifie `check.mjs`

- données : chaque produit a un `id` et un `slug` valides et uniques, un nom, un `priceFrom`, une `etsyUrl` valide, ses textes de fiche (`tagline`, `pitch`, `quote`, `story`, `specs`, `faq`, `highlights`) et des images existantes dont les index sont cohérents ;
- `dist/` contient `index.html`, `styles.css`, `sitemap.xml`, `robots.txt`, `.nojekyll` et la page `<slug>/index.html` de chaque produit ;
- chaque page : `lang="fr"`, `<title>`, meta description, un seul `<h1>`, `canonical`, `og:url`, `og:image` en URL absolue `BASE_URL` existante, aucun chemin commençant par `/`, un seul script inline de moins de 4 000 caractères (sans réseau ni stockage) en plus du JSON-LD, chaque image avec `alt`, `width`, `height` et fichier présent, une seule image prioritaire non `lazy`, tout lien externe en `target="_blank" rel="noopener"` ;
- aucun prix autre que `priceFrom` n'est affiché (le prix Etsy ne doit jamais apparaître) ;
- accueil : JSON-LD `WebSite` et `Organization`, lien vers la fiche de chaque produit, grille « collection » absente avec un seul produit ;
- fiche : boutons Etsy et Leboncoin vers les bonnes URL (Leboncoin absent si l'URL est vide), « dès 69 € », mention « Prix et frais de port selon la plateforme. », JSON-LD `Product` avec un seul `Offer` (`priceFrom`, EUR, InStock, `leboncoinUrl` ou à défaut `etsyUrl`), galerie, barre d'achat mobile, FAQ ;
- `sitemap.xml` liste l'accueil et toutes les fiches, `robots.txt` pointe vers le sitemap de `BASE_URL` ;
- `styles.css` : les 11 variables Figma, focus visible, animations limitées à `prefers-reduced-motion: no-preference`, contrastes texte/fond ≥ 4,5 (AA) ;
- aucun mot interdit (« 3D », « impression », « imprimé », « imprimante », insensible à la casse et aux accents) dans les fichiers texte de `dist/`, et « Même prix » absent.

Le script se termine avec le code 1 au moindre échec. Il est lancé après le build par la CI (`.github/workflows/ci.yml`) et par le workflow de déploiement.

## Déploiement (GitHub Pages)

Le site est servi sous `https://pockemon.github.io/meltro-studio/`.

- `.github/workflows/pages.yml` : sur push vers `main` (et manuellement via `workflow_dispatch`), lance `node build.mjs` et `node check.mjs`, puis déploie `dist/` avec `actions/configure-pages`, `actions/upload-pages-artifact` et `actions/deploy-pages` (environnement `github-pages`).
- À activer une fois dans le dépôt : Settings > Pages > Source : **GitHub Actions**.
- Le HTML n'utilise que des chemins relatifs (`styles.css`, `images/...`, `./`, et `../` depuis les fiches), ce qui fonctionne sous le sous-chemin `/meltro-studio/`. La constante `BASE_URL` de `build.mjs` ne sert qu'aux URL absolues : `canonical`, `og:url`, `og:image`, JSON-LD, `sitemap.xml` et `robots.txt`. `check.mjs` échoue si un chemin commence par `/` ou si ces URL ne commencent pas par `BASE_URL`.
- `dist/.nojekyll` est créé par le build pour que GitHub Pages serve les fichiers tels quels.
- Pour changer de domaine, modifier `BASE_URL` dans `build.mjs` (et la constante du même nom dans `check.mjs`).
