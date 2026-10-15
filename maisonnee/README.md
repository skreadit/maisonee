# Maisonnée

Marketplace française de chefs à domicile : découverte, demandes de réservation persistantes, espaces client/chef/administrateur et intégration Stripe Connect limitée au test.

**État : démonstration locale intégrée, ouverture commerciale non validée.** Les chefs, photos et menus présentés sont des illustrations de démonstration. Aucun paiement réel n'est permis. En l'absence de secrets Stripe de test, le paiement affiche son indisponibilité et ne confirme jamais artificiellement une réservation.

## Démarrer sous Windows

Prérequis : **Node.js 24**, npm et un navigateur récent. Le fichier **DEMARRER.cmd** prépare la configuration locale et démarre le site sous Windows. Il installe les dépendances au premier lancement si nécessaire. Pour un démarrage manuel, ouvrir PowerShell dans le dossier `maisonnee` :

```powershell
node --version
npm.cmd ci
Copy-Item .env.example .env.local
npm.cmd run dev
```

Ouvrir **http://127.0.0.1:3000**. Ne recopier `.env.example` que lors de la première installation pour conserver les réglages déjà présents. Le premier accès crée la base locale, applique les migrations et charge les comptes fictifs. Les opérations suivantes conservent cette base ; ne pas lancer deux serveurs sur le même dossier PGlite.

Pour vérifier la version compilée, arrêter le serveur de développement avec `Ctrl+C`, puis :

```powershell
npm.cmd run build
npm.cmd run start
```

### Comptes locaux

Le mot de passe commun est **`DemoMaisonnee2026!`**. Ces comptes existent uniquement avec `APP_MODE=demo`.

| Espace | Adresse |
| --- | --- |
| Client | `client@maisonnee.demo` |
| Chef Gabriel | `chef@maisonnee.demo` |
| Administration | `admin@maisonnee.demo` |
| Cheffe Inès | `ines@maisonnee.demo` |
| Chef Adam | `adam@maisonnee.demo` |

La page de connexion propose également de préremplir les trois comptes principaux. Pour essayer le parcours : créer une demande depuis un profil, se connecter avec le chef pour l'accepter, puis retrouver la même demande côté client et administration. Utiliser des informations fictives.

## Ce qui est livré

- Recherche par ville, date, convives, cuisine et budget ; profils et menus issus de la base.
- Inscription, connexion, sessions, favoris, profil client et demandes idempotentes avec prix figés côté serveur.
- Candidature chef, menus, dates disponibles, acceptation/refus, échanges et notifications internes.
- Administration locale des candidatures, réservations, tickets, commission historisée et simulateur économique.
- Adaptateur Stripe Connect/Checkout, webhooks signés et dédupliqués, demandes de remboursement intégral de test soumises à une politique configurée.
- Migrations SQL, tests métier/API/paiement, scénarios navigateur et procédure de sauvegarde locale.

Le tableau précis des validations et limites est dans [la recette](docs/RECETTE.md). Le paiement hébergé, l'onboarding Stripe et les remboursements auprès du fournisseur restent à tester avec le compte sandbox du propriétaire. E-mails, récupération de compte, MFA administrateur, stockage privé des justificatifs, factures et suivi des versements bancaires ne sont pas livrés. Une notification interne n'est pas un e-mail envoyé.

## Vérifier le projet

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

Les tests unitaires et d'intégration utilisent une base isolée. Les tests navigateur nécessitent un serveur de démonstration séparé, sans clés Stripe et sans données personnelles. Voir [la procédure de recette](docs/RECETTE.md) avant `npm.cmd run test:e2e` : cette suite crée des comptes, des demandes et des messages de test.

## Repères techniques

| Dossier | Contenu |
| --- | --- |
| `src/components` | Pages publiques, formulaires et espaces privés |
| `src/app/api` | API de l'application et routes de paiement |
| `src/lib` | Base, sessions, règles métier, paiement, données démo et modèle économique |
| `migrations` | Schéma PostgreSQL versionné, appliqué au démarrage de la base |
| `tests` | Vitest et Playwright |
| `scripts/backup.mjs` | Copie/restauration PGlite locale, serveur arrêté |
| `public/images` | Illustrations culinaires de démonstration |

Les montants sont en centimes EUR. La commission de départ est de 10 % de la prestation, hors déplacement ; elle est figée dans chaque demande. Le montant client, la commission brute et la part chef avant frais sont distincts. Le navigateur ne décide ni du prix ni du statut payé.

## Documentation

- [Cadrage produit, architecture et scénarios économiques](docs/CADRAGE.md)
- [Direction artistique, composants et provenance des visuels](docs/DESIGN.md)
- [Fonctionnalités, tests et anomalies restantes](docs/RECETTE.md)
- [Exploitation, administration, déploiement et sauvegardes](docs/EXPLOITATION.md)
- [Configuration et recette Stripe test](docs/STRIPE.md)
- [Dossier de conformité et décisions humaines](docs/CONFORMITE.md)
- [Variables d'environnement](.env.example)

L'ouverture commerciale nécessite encore des chefs réels vérifiés, les contrats et l'identité exploitant, les services opérationnels et les tests externes décrits dans ces documents. Aucun hébergement, abonnement, domaine ou service payant n'a été souscrit.

## Résultats de validation

63 tests métier, API, sécurité, échéances, économie et événements de paiement réussis. TypeScript et lint réussis. Réservation, acceptation chef, messages persistants et suivi administrateur contrôlés dans le navigateur intégré avec les comptes fictifs autorisés. Le paiement sans configuration reste non payé. La suite Playwright fournie n'a pas pu lancer Edge dans le sandbox Windows ; elle reste à exécuter. Aucun paiement externe ni déploiement commercial validé.

