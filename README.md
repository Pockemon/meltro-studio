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
| `data/site.json` | Réglages du site : titre, description, URL publique, liens vers les boutiques. |
| `src/styles.css` | Feuille de styles, copiée dans `dist/styles.css`. |
| `public/` | Fichiers copiés tels quels dans `dist/` (images, favicon, `_headers`). |
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
  "price": 49,
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
- `price` : nombre, identique sur Etsy et Leboncoin (frais de port en plus).
- `leboncoinUrl` : laisser vide (`""`) tant qu'il n'y a pas d'annonce, le bouton « Voir sur Leboncoin » n'est alors pas affiché.
- `images` : chemins relatifs à `public/`. La première image est la photo principale et sert d'image de partage pour le premier produit. Une image peut aussi être une simple chaîne (`"images/x.jpg"`) ; l'alt est alors généré automatiquement, mieux vaut en écrire un descriptif.
- Les dimensions (`width`/`height`) sont lues dans les fichiers au moment du build (JPEG, PNG ou WebP). Redimensionner les photos à 1600 px maximum avant de les ajouter.

## Ce que vérifie `check.mjs`

- chaque produit a un nom, un prix, une `etsyUrl` valide et au moins une image existante dans `public/` ;
- `dist/` contient `index.html`, `styles.css`, `sitemap.xml` et `robots.txt` ;
- `index.html` est en `lang="fr"`, n'embarque aucun script exécutable (seul le JSON-LD), chaque image a `alt`, `width` et `height`, et le nombre de boutons Etsy / Leboncoin correspond aux données ;
- aucun mot interdit (« 3D », « impression », « imprimé », « imprimante », insensible à la casse et aux accents) dans les fichiers texte de `dist/`.

Le script se termine avec le code 1 au moindre échec. Il est lancé par la CI (`.github/workflows/ci.yml`) après le build.

## Déploiement (Cloudflare Pages)

- Commande de build : `node build.mjs`
- Dossier de sortie : `dist`
- Variable d'environnement : `NODE_VERSION=20` (si nécessaire)
- `SITE_URL` (optionnel) : URL publique du site, sans slash final. Elle prime sur `url` de `data/site.json` et sert aux URL absolues (`canonical`, Open Graph, JSON-LD, sitemap, robots.txt). Pensez à mettre à jour `url` dans `data/site.json` quand le domaine définitif est connu.

## Polices

Fraunces (300 titres, 400 nom et prix) et DM Sans (400, 500, 600) sont chargées depuis Google Fonts, avec repli `serif` / `sans-serif`.
