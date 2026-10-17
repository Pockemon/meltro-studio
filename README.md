# Meltro Studio

Vitrine statique des objets décoratifs de Meltro Studio (vendeur particulier). Pas de panier ni de paiement : chaque produit renvoie vers Etsy (achat) et, si l'URL est renseignée, vers Leboncoin.

Aucune dépendance npm, aucun JavaScript côté client, pas de cookies, pas d'analytics. Node 20 suffit.

## Commandes

```bash
node build.mjs   # génère dist/
node check.mjs   # contrôle les données et le contenu de dist/
```

Pour prévisualiser : `python3 -m http.server --directory dist` (ou tout autre serveur statique) puis ouvrir http://localhost:8000.

## Organisation

| Chemin | Rôle |
| --- | --- |
| `data/products.json` | Source unique des produits. |
| `data/site.json` | Réglages du site : titre, description, liens vers les boutiques. |
| `src/styles.css` | Feuille de styles, copiée dans `dist/styles.css`. |
| `public/` | Fichiers copiés tels quels dans `dist/` (images, favicon). |
| `build.mjs` | Génère `dist/index.html`, `dist/styles.css`, `dist/sitemap.xml`, `dist/robots.txt` et copie `public/` vers `dist/`. |
| `check.mjs` | Vérifie les produits et `dist/` (voir plus bas). |

`dist/` est généré et n'est pas versionné.

## Ajouter un produit

Il suffit d'ajouter une entrée dans `data/products.json` et de déposer ses images dans `public/images/`. Rien d'autre à modifier : la carte, la galerie, le balisage JSON-LD et le sitemap suivent.

```json
{
  "id": "lampe-nuage",
  "name": "Nom du produit",
  "collection": "Collection",
  "detail": "Dimensions · matière · précisions",
  "priceFrom": 49,
  "currency": "EUR",
  "description": "Texte de présentation.",
  "etsyUrl": "https://www.etsy.com/fr/listing/...",
  "leboncoinUrl": "",
  "images": [
    { "src": "images/lampe-nuage-1.jpg", "alt": "Description de la photo" },
    { "src": "images/lampe-nuage-2.jpg", "alt": "Description de la photo" }
  ]
}
```

- `id` : minuscules, chiffres et tirets, unique (sert d'ancre dans la page).
- `priceFrom` : nombre, prix « à partir de » affiché sous la forme « Dès 49 € » (le plus bas des prix pratiqués, ici celui de Leboncoin). Le prix Etsy n'est jamais affiché car il varie avec les promotions ; chaque plateforme affiche son prix exact et ses frais de port, ce que rappelle la mention « Prix exact et frais de port sur chaque plateforme. ». C'est aussi le `price` de l'offre JSON-LD, dont l'`url` est `leboncoinUrl` (ou `etsyUrl` si elle est vide).
- `leboncoinUrl` : laisser vide (`""`) tant qu'il n'y a pas d'annonce, le bouton « Voir sur Leboncoin » n'est alors pas affiché.
- Lien « Leboncoin » de l'en-tête (masqué sur mobile, comme dans Figma) : tant qu'il n'y a qu'un produit, il pointe vers son `leboncoinUrl` ; à partir de deux produits, il n'apparaît que si `leboncoinShopUrl` (page vendeur) est renseignée dans `data/site.json`. Sans URL, il est masqué.
- `images` : chemins relatifs à `public/`. La première image est la photo principale et sert d'image de partage pour le premier produit. Une image peut aussi être une simple chaîne (`"images/x.jpg"`) ; l'alt est alors généré automatiquement, mieux vaut en écrire un descriptif.
- Les dimensions (`width`/`height`) sont lues dans les fichiers au moment du build (JPEG, PNG ou WebP). Redimensionner les photos à 1600 px maximum avant de les ajouter.

## Ce que vérifie `check.mjs`

- chaque produit a un nom, un `priceFrom`, une `etsyUrl` valide et au moins une image existante dans `public/` ;
- `dist/` contient `index.html`, `styles.css`, `sitemap.xml`, `robots.txt` et `.nojekyll` ;
- `canonical`, `og:url`, `og:image`, sitemap et robots.txt pointent vers `BASE_URL`, et aucun chemin du HTML ou du CSS ne commence par `/` ;
- `index.html` est en `lang="fr"`, n'embarque aucun script exécutable (seul le JSON-LD), chaque image a `alt`, `width` et `height`, et le nombre de boutons Etsy / Leboncoin correspond aux données ;
- « Dès 69 € » (prix `priceFrom` de chaque produit) et la mention « Prix exact et frais de port sur chaque plateforme. » sont présents, « Même prix » est absent de `dist/`, et chaque JSON-LD contient un seul `Offer` (`priceFrom`, EUR, InStock, `leboncoinUrl` ou à défaut `etsyUrl`) ;
- aucun mot interdit (« 3D », « impression », « imprimé », « imprimante », insensible à la casse et aux accents) dans les fichiers texte de `dist/`.

Le script se termine avec le code 1 au moindre échec. Il est lancé après le build par la CI (`.github/workflows/ci.yml`) et par le workflow de déploiement.

## Déploiement (GitHub Pages)

Le site est servi sous `https://pockemon.github.io/meltro-studio/`.

- `.github/workflows/pages.yml` : sur push vers `main` (et manuellement via `workflow_dispatch`), lance `node build.mjs` et `node check.mjs`, puis déploie `dist/` avec `actions/configure-pages`, `actions/upload-pages-artifact` et `actions/deploy-pages` (environnement `github-pages`).
- À activer une fois dans le dépôt : Settings > Pages > Source : **GitHub Actions**.
- Le HTML n'utilise que des chemins relatifs (`styles.css`, `images/...`, `./`), ce qui fonctionne sous le sous-chemin `/meltro-studio/`. La constante `BASE_URL` de `build.mjs` ne sert qu'aux URL absolues : `canonical`, `og:url`, `og:image`, JSON-LD, `sitemap.xml` et `robots.txt`. `check.mjs` échoue si un chemin commence par `/` ou si ces URL ne commencent pas par `BASE_URL`.
- `dist/.nojekyll` est créé par le build pour que GitHub Pages serve les fichiers tels quels.
- Pour changer de domaine, modifier `BASE_URL` dans `build.mjs` (et la constante du même nom dans `check.mjs`).

## Polices

Fraunces (300 titres, 400 nom et prix) et DM Sans (400, 500, 600) sont chargées depuis Google Fonts, avec repli `serif` / `sans-serif`.
