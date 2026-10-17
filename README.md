# Meltro Studio

Site vitrine statique de la marque Meltro Studio (objets de décoration conçus en Savoie, vendus par un particulier), thème « Meltro Nuit ». L'accueil présente la marque et ses collections ; pas de panier ni de paiement : chaque pièce renvoie vers Etsy (achat) et, si l'URL est renseignée, vers Leboncoin.

Aucune dépendance npm, pas de cookies, pas d'analytics. Node 20 suffit. Le seul JavaScript côté client est un petit script inline d'amélioration progressive (galerie, barre d'achat mobile, apparition au défilement, effets de profondeur) : sans JS, tout reste lisible et cliquable.

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
| `data/collections.json` | Les collections (slug, nom, saison, accroche, description, accent, ordre). Une entrée = une tuile sur l'accueil + une page `/collections/<slug>/`. |
| `data/site.json` | Textes du site : navigation, hero (et sa pile de photos), atouts, tuiles des collections (`collections`), textes des pages collection (`collectionPage`), atelier, étapes, appels à l'action, pied de page, titre et description SEO, `baseUrl` et `customDomain`. |
| `src/styles.css` | Feuille de styles « Meltro Nuit », copiée dans `dist/styles.css`. |
| `public/` | Fichiers copiés tels quels dans `dist/` (images, favicon). |
| `build.mjs` | Génère `dist/index.html`, une page `dist/collections/<slug>/index.html` par collection (vide ou non), une page `dist/<slug>/index.html` par produit, `styles.css`, `sitemap.xml`, `robots.txt`, `.nojekyll` (et `CNAME` si `customDomain` est renseigné), et copie `public/`. |
| `check.mjs` | Vérifie les données et `dist/` (voir plus bas). |

`dist/` est généré et n'est pas versionné.

## Design

Le design suit le fichier Figma `oEmQewpeqRKrtyZNulXtjm`, page « 03 — Site v2 » : Accueil Desktop (1440 px, section « Les collections » 19:6), Collection Desktop (19:49), Fiche produit Desktop, Accueil Mobile (390 px), Fiche produit Mobile. Il n'y a pas de frame mobile pour les collections : les tuiles et la page s'empilent en pleine largeur. Les variables de la collection « Meltro Nuit » sont les propriétés CSS de `:root` (`--bg`, `--surface`, `--surface-2`, `--line`, `--text`, `--text-muted` → `--muted`, `--ember`, `--ember-deep`, `--gold`, `--on-ember`, `--cream`). Polices : Fraunces (300, 300 italique, 400, 400 italique) pour les titres et prix, DM Sans (400, 500, 600) pour le texte, chargées depuis Google Fonts avec repli `serif` / `sans-serif`.

L'accueil est une vitrine de marque : hero (accroche, boutons « Voir la collection » et « Boutique Etsy », pile de trois photos en perspective), quatre atouts, « Les collections » (`#collections`), « L'atelier » (`#atelier`), trois étapes « Comment commander » (`#commander`) et appel final. Les textes viennent de `data/site.json`. Les textes propres à une pièce (lueur, histoire, ambiance de la citrouille) ne figurent que sur sa fiche.

Sous 860 px, la mise en page « mobile » des frames Figma s'applique (textes plus courts, éléments masqués) ; entre 861 et 1180 px, la mise en page bureau s'adapte (atouts en 2 × 2, marges réduites).

## Effets de profondeur

Tout est en CSS (`transform` et `opacity` uniquement) plus un petit script inline sans bibliothèque :

- hero : pile de trois cartes avec une vraie perspective (1200 px), flottement lent au repos et parallaxe au pointeur (±8°) ;
- tuiles de collection (accueil) et cartes produit (pages collection) : inclinaison ±10° au pointeur, reflet radial qui suit le pointeur et ombre ambre ;
- apparition au défilement avec une légère rotation `rotateX` (8° → 0) et un décalage ;
- fiche : la photo principale s'incline légèrement sous le pointeur ;
- transitions de page entre la page collection et la fiche (View Transitions inter-documents, `@view-transition { navigation: auto; }`) : la photo de la carte et la photo principale de la fiche partagent le même `view-transition-name` (`photo-<slug>`), le reste fait un fondu. Les navigateurs sans cette API naviguent normalement.

Avec `prefers-reduced-motion: reduce`, il ne reste qu'un simple fondu (ni inclinaison, ni flottement, ni transition partagée). Les inclinaisons ne s'appliquent pas aux écrans tactiles (`pointer: coarse`).

## Nom de domaine

Le site est servi sur **https://meltrostudio.com** (DNS Cloudflare, domaine personnalisé configuré dans Settings > Pages). `data/site.json` contient `baseUrl` (`https://meltrostudio.com`, utilisée pour `canonical`, `og:*`, JSON-LD, sitemap et robots) et `customDomain` (`meltrostudio.com`). Le build écrit alors `dist/CNAME`. Les chemins du HTML restent relatifs : rien d'autre ne dépend du domaine.

Pour changer de domaine : modifier ces deux champs puis relancer `node build.mjs && node check.mjs` (le check échoue si `customDomain` et `baseUrl` ne désignent pas le même hôte). Un `customDomain` vide supprime `dist/CNAME`.

## Collections

Chaque produit porte un champ `collection` (le `slug` d'une entrée de `data/collections.json`), sinon le build échoue.

```json
{ "slug": "halloween", "name": "Halloween", "season": "Septembre – novembre",
  "tagline": "Phrase de la tuile d'accueil.", "description": "Texte de l'en-tête de la page collection.",
  "accent": "#FF7A1A", "order": 1 }
```

- Accueil : la première collection (par `order`) qui a des pièces est la grande tuile à gauche, avec la photo de sa première pièce et le statut « N pièce(s) · Édition limitée » ; les autres sont empilées à droite. Une collection sans pièce affiche « Bientôt », une lueur de son `accent` et « Être prévenu sur Etsy → » vers la boutique ; la tuile entière mène à la page collection, seul ce lien mène à Etsy.
- Page `/collections/<slug>/` (générée pour toutes les collections) : fil d'Ariane « Accueil / Collections / Nom », saison, titre, description, lueur de l'accent, pastilles vers les autres collections (« Noël · bientôt » si vide), cartes produit complétées jusqu'à `collectionPage.columns` places par des cartes « Prochaine pièce en préparation ». Une collection vide affiche « Premières pièces bientôt » et un bouton « Suivre sur Etsy ».
- Fiche produit : fil d'Ariane « Les collections / Halloween / Nom » avec liens, surtitre au nom de la collection.
- JSON-LD `CollectionPage` + `ItemList` sur chaque page collection, URL des collections dans le sitemap. Le slug de produit `collections` est réservé.

## Ajouter un produit

Il suffit d'ajouter une entrée dans `data/products.json` et de déposer ses images dans `public/images/`. Rien d'autre à modifier : la fiche `/<slug>/`, sa carte cliquable sur la page de sa collection (complétée jusqu'à `collectionPage.columns` places par des cartes « Prochaine pièce en préparation » tirées de `collectionPage.soon`), le statut de la tuile d'accueil, le balisage JSON-LD et le sitemap sont générés.

```json
{
  "id": "lampe-nuage",
  "slug": "lampe-nuage",
  "name": "Lampe nuage",
  "collection": "halloween",
  "badge": "Édition limitée",
  "featured": false,
  "detail": "Dimensions · matière · précisions",
  "priceFrom": 49,
  "currency": "EUR",
  "description": "Texte de présentation (meta description et JSON-LD).",
  "etsyUrl": "https://www.etsy.com/fr/listing/...",
  "leboncoinUrl": "",
  "tagline": "Phrase d'accroche sous le titre de la fiche.",
  "cardTagline": "Phrase courte sur la carte de l'accueil.",
  "quote": "Citation du bandeau nuit.",
  "story": "Histoire de la pièce (bandeau nuit, bureau).",
  "specs": [{ "label": "Dimensions", "value": "36 × 36 cm" }],
  "faq": [{ "q": "Question ?", "a": "Réponse." }],
  "nightImage": 2,
  "galleryImages": [0, 1, 2],
  "detailImages": [0, 1, 2],
  "images": [
    { "src": "images/lampe-nuage-1.jpg", "alt": "Description de la photo", "detailCaption": "Légende « Dans le détail »" }
  ]
}
```

- `id` et `slug` : minuscules, chiffres et tirets, uniques. `slug` (par défaut `id`) donne l'adresse de la fiche : `/<slug>/`.
- `priceFrom` : nombre, prix « à partir de » affiché sous la forme « dès 49 € » (le plus bas des prix pratiqués, ici celui de Leboncoin). Le prix Etsy n'est jamais affiché car il varie avec les promotions ; la fiche précise « Prix et frais de port selon la plateforme. ». C'est aussi le `price` de l'offre JSON-LD, dont l'`url` est `leboncoinUrl` (ou `etsyUrl` si elle est vide).
- `leboncoinUrl` : laisser vide (`""`) tant qu'il n'y a pas d'annonce, le bouton « Voir sur Leboncoin » n'est alors pas affiché.
- `featured` : le premier produit `featured` (à défaut, le premier de la liste) fournit l'image de partage (`og:image`) de l'accueil.
- `cardTagline` : phrase de la carte sur la page collection (à défaut, `tagline`). La carte affiche aussi le nom, « dès » + `priceFrom` et « Voir la pièce → », et toute la carte est cliquable.
- Textes de marque : conçu en Savoie, fabriqué en petite série. Ne jamais écrire « fait main », « faite à la main », « finie à la main » ni « artisanal » : `check.mjs` échoue.
- `collection` : slug de la collection (obligatoire). `badge` : l'étiquette « Édition limitée » sur la photo de la fiche ; la ligne « Halloween · Édition limitée » au-dessus du titre reprend le nom de la collection.
- Textes à deux versions : `tagline`, la valeur d'une ligne de `specs` et la réponse d'une entrée de `faq` peuvent être une chaîne, ou `{ "d": "texte bureau", "m": "texte mobile" }` quand la maquette mobile en dit moins. Une entrée de `faq` avec `"mobile": false` n'apparaît que sur bureau.
- `images` : chemins relatifs à `public/`, dans l'ordre. Les index (`nightImage`, `galleryImages`, `detailImages`) commencent à 0 et pointent dans cette liste : bandeau nuit de la fiche, vignettes de la galerie (la première est la photo principale), photos « Dans le détail ». Le hero et « L'atelier » de l'accueil choisissent leurs photos dans `data/site.json` (`hero.stack`, `atelier.photo` : `{ "product": "id", "image": index }`). Chaque `alt` doit être descriptif.
- Les dimensions (`width`/`height`) sont lues dans les fichiers au moment du build (JPEG, PNG ou WebP). Redimensionner les photos à 1600 px maximum avant de les ajouter.

## Ce que vérifie `check.mjs`

- données : chaque produit a un `id` et un `slug` valides et uniques, un nom, un `priceFrom`, une `etsyUrl` valide, ses textes de fiche (`tagline`, `cardTagline`, `quote`, `story`, `specs`, `faq`) et des images existantes dont les index sont cohérents ;
- `dist/` contient `index.html`, `styles.css`, `sitemap.xml`, `robots.txt`, `.nojekyll` et la page `<slug>/index.html` de chaque produit ;
- chaque page : `lang="fr"`, `<title>`, meta description, un seul `<h1>`, `canonical`, `og:url`, `og:image` en URL absolue `BASE_URL` existante, aucun chemin commençant par `/`, un seul script inline de moins de 6 000 caractères (sans réseau ni stockage) en plus du JSON-LD, chaque image avec `alt`, `width`, `height` et fichier présent, une seule image prioritaire non `lazy`, tout lien externe en `target="_blank" rel="noopener"` ;
- aucun prix autre que `priceFrom` n'est affiché (le prix Etsy ne doit jamais apparaître) ;
- domaine : `baseUrl` valide, `dist/CNAME` présent si et seulement si `customDomain` est renseigné ;
- collections : champs obligatoires, slug et ordre uniques, accent `#RRGGBB` lisible sur le fond ; chaque produit a une collection connue ; chaque collection a sa page `dist/collections/<slug>/index.html` ;
- accueil : JSON-LD `WebSite` et `Organization`, trois tuiles qui lient les trois collections (grande tuile = première collection avec des pièces, statut, photo, lueur, reflet, « Être prévenu sur Etsy → » vers la boutique pour les vides), trois cartes dans le hero, navigation et ancres (`#collections`, `#atelier`, `#commander`), textes issus de Figma, absence de « pièce du moment » et de mosaïque ;
- fiche : boutons Etsy et Leboncoin vers les bonnes URL (Leboncoin absent si l'URL est vide), « dès 69 € », mention « Prix et frais de port selon la plateforme. », JSON-LD `Product` avec un seul `Offer` (`priceFrom`, EUR, InStock, `leboncoinUrl` ou à défaut `etsyUrl`), galerie, barre d'achat mobile, FAQ ;
- pages collection : fil d'Ariane, `<h1>`, saison, description, lueur, pastilles, une carte par pièce (avec le nom de transition de la photo) et cartes « en préparation », ou message « Premières pièces bientôt » + bouton Etsy ; JSON-LD `CollectionPage` + `ItemList` ;
- fiche : fil d'Ariane « Les collections / Collection / Nom » avec liens et surtitre de collection ;
- `sitemap.xml` liste l'accueil, les collections et toutes les fiches, `robots.txt` pointe vers le sitemap de `BASE_URL` ;
- `styles.css` : les 11 variables Figma, focus visible, animations et transitions limitées à `prefers-reduced-motion: no-preference`, `@view-transition`, contrastes texte/fond ≥ 4,5 (AA) ;
- aucun mot interdit (« 3D », « impression », « imprimé », « imprimante », insensible à la casse et aux accents) dans les fichiers texte de `dist/` et dans `data/`, « Même prix » absent, et aucune mention « fait main » / « faite à la main » / « finie à la main » / « artisanal ».

Le script se termine avec le code 1 au moindre échec. Il est lancé après le build par la CI (`.github/workflows/ci.yml`) et par le workflow de déploiement.

## Déploiement (GitHub Pages)

Le site est servi sur `https://meltrostudio.com/` (anciennement `https://pockemon.github.io/meltro-studio/`, qui redirige vers le domaine personnalisé).

- `.github/workflows/pages.yml` : sur push vers `main` (et manuellement via `workflow_dispatch`), lance `node build.mjs` et `node check.mjs`, puis déploie `dist/` avec `actions/configure-pages`, `actions/upload-pages-artifact` et `actions/deploy-pages` (environnement `github-pages`).
- À activer une fois dans le dépôt : Settings > Pages > Source : **GitHub Actions**.
- Le HTML n'utilise que des chemins relatifs (`styles.css`, `images/...`, `./`, `../` depuis les fiches et `../../` depuis les pages collection), ce qui fonctionne à la racine d'un domaine comme sous un sous-chemin. `baseUrl` (`data/site.json`) ne sert qu'aux URL absolues : `canonical`, `og:url`, `og:image`, JSON-LD, `sitemap.xml` et `robots.txt`. `check.mjs` échoue si un chemin commence par `/` ou si ces URL ne commencent pas par `BASE_URL`.
- `dist/.nojekyll` est créé par le build pour que GitHub Pages serve les fichiers tels quels.
- Pour changer de domaine, voir « Nom de domaine » plus haut : `baseUrl` et `customDomain` dans `data/site.json`.
