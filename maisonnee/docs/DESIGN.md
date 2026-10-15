# Direction artistique et design system

Maisonnée est un nom de travail, à vérifier avant usage commercial. L'identité associe une composition éditoriale, des photographies de table et une typographie chaleureuse. Les visuels illustrent l'expérience ; ils ne représentent pas les chefs fictifs.

## Repères réutilisables

| Élément | Valeur |
| --- | --- |
| Encre et textes principaux | `#203d32` |
| Boutons et zones profondes | `#173b2e` |
| Fond ivoire | `#f8f6f0` |
| Surfaces | `#fffefa` |
| Accent cuivré | `#ad6c49` |
| Texte secondaire | `#74796e` |
| Bordures | `#dfe2d8` |
| Titres | Georgia et alternatives système, romain et italique |
| Interface | DM Sans, fichiers locaux, licence SIL OFL jointe |
| Rayons | 4–7 px pour formulaires/cartes, pilules pour catégories/statuts |
| Grille | 3 colonnes de chefs sur ordinateur, 1 sur mobile ; rupture à 760 px |

Les tokens et composants sont définis dans `src/app/globals.css`. Les états sélectionné, désactivé, chargement, erreur, succès et vide sont présents. Les liens et champs ont un focus visible. Le menu mobile, les contrôles natifs et les éléments `details` sont actionnables au clavier. Les animations respectent `prefers-reduced-motion`. Une conformité WCAG ne découle pas de ces mesures : audit de contraste, lecteurs d'écran et navigation clavier complet restent nécessaires.

La recherche et les dates de prestation utilisent des champs natifs pour limiter les dépendances. La recette visuelle a contrôlé l'accueil et la recherche à 390 px et l'interface à 1440 px. Aucun débordement horizontal sur les deux pages mobiles contrôlées ; aucune image cassée détectée à l'accueil.

## Provenance des illustrations

Fichiers téléchargés depuis Unsplash avec les paramètres `auto=format&fit=crop&w=1500&q=85`. Les noms d'auteurs n'ont pas été vérifiés : ne pas les inventer. Vérifier les droits et les éventuelles autorisations nécessaires avant un usage commercial.

| Fichier | Source vérifiée au téléchargement |
| --- | --- |
| `public/images/hero.jpg` | https://images.unsplash.com/photo-1414235077428-338989a2e8c0 |
| `public/images/season.jpg` | https://images.unsplash.com/photo-1547592180-85f173990554 |
| `public/images/plate.jpg` | https://images.unsplash.com/photo-1516684732162-798a0062be99 |
| `public/images/table.jpg` | https://images.unsplash.com/photo-1511795409834-ef04bbd61622 |
| `public/images/chef.jpg` | https://images.unsplash.com/photo-1577219491135-ce391730fb2c |

DM Sans est fourni en graisses 400/500/600/700 depuis Google Fonts, dans `public/fonts`. Sa licence provient du répertoire officiel `google/fonts/ofl/dmsans/OFL.txt`. Les pages finales ne sollicitent pas Google Fonts au chargement : la police est hébergée avec l'application.

## Limites visuelles et éditoriales

Le nom, la charte, les photos et les prix sont des choix de démonstration. Les avis restent vides tant qu'aucune prestation éligible n'existe. L'accessibilité complète, les Core Web Vitals représentatifs et l'ensemble des navigateurs/tablettes n'ont pas été certifiés. Aucun badge de professionnel vérifié ni diplôme inventé n'est présenté.
