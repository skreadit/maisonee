# Recette et état réel de la livraison

Mise à jour : 14 octobre 2026. Ce registre décrit la démonstration locale et ses limites. **L'objectif commercial du cahier des charges n'est pas encore atteint.** La présence d'un écran, d'un test écrit ou d'un fichier de configuration ne prouve pas une validation externe.

## Niveaux de preuve

- **Intégré localement** : interface, API et stockage utilisent le même modèle, sans fournisseur externe nécessaire au flux décrit.
- **Intégré, service externe à valider** : code et tests locaux présents, mais pas de recette réelle du fournisseur.
- **Partiel** : une partie du besoin est présente ; la limite est précisée.
- **Non livré** : aucune fonctionnalité annoncée comme opérationnelle.

## Matrice fonctionnelle

| Fonction | État livré | Preuve et limite |
| --- | --- | --- |
| Accueil, découverte, pages explicatives | Intégré localement | Navigation publique ; illustrations et profils explicitement fictifs ; aucun avis inventé |
| Recherche | Intégré localement | Ville textuelle, date, convives, cuisine, budget, tri par prix ; pas de calcul d'itinéraire/rayon ou carte |
| Profils et menus | Intégré localement | Offres publiées issues de la base, trois temps, prix, convives, allergènes déclarés ; pas de vérification alimentaire automatisée |
| Compte client | Intégré localement | Inscription, connexion, déconnexion, session serveur, modification nom/téléphone/adresse ; rôle admin non choisissable |
| Vérification d'e-mail / récupération de mot de passe | Non livré | Aide accessible sans compte ; aucun lien de réinitialisation ou e-mail fictif |
| Favoris | Intégré localement | Ajout/retrait par propriétaire, persistance en base |
| Candidature chef | Intégré localement | Profil en attente, création d'un menu puis contrôle admin avant publication ; pièces professionnelles à vérifier humainement |
| Profil, menus et disponibilités chef | Intégré localement | Modification limitée au propriétaire, dates explicitement ouvertes ; pas d'agenda tiers ni créneaux horaires multiples par jour |
| Demande de réservation | Intégré localement | Transaction, clé d'idempotence, contrôle disponibilité et nombre de convives, prix/commission/menu figés ; une réservation active par chef et date |
| Réponse du chef et suivi partagé | Intégré localement | Acceptation/refus visibles dans les espaces liés ; notifications en base ; actualisation périodique, sans infrastructure temps réel |
| Annulation avant paiement | Intégré localement | Règles de transition serveur ; tentative de paiement encore ouverte bloque l'annulation |
| Expiration de demande / fenêtre de paiement | Intégré et testé localement | Délais configurables de 24 h par défaut, plafonnés au début du jour du repas à Paris ; expiration à l'accès uniquement pour créneau sans tentative Stripe non expirée ; aucun worker planifié |
| Stripe Connect / Checkout | Intégré, service externe à valider | Sandbox exclusivement ; absence de configuration = indisponibilité explicite ; onboarding hébergé non exécuté |
| Confirmation de paiement | Intégré, service externe à valider | Signature, montants, destination, commission, idempotence et ordre des événements contrôlés localement ; retour navigateur insuffisant |
| Remboursements | Intégré, service externe à valider | Demande intégrale admin avec politique configurée ; preuve par événement signé ; traitement partiel externe rapproché ; aucun barème commercial adopté |
| Versements aux chefs | Partiel | Part prévue affichée ; destination charge de test implémentée ; pas de suivi des virements bancaires, réserve ou séquestre |
| Messagerie | Intégré localement | Conversation liée à la réservation, participants contrôlés, historique persistant ; pas de pièces jointes ni modération avancée |
| Notifications | Partiel | Réservation/message signalés dans l'espace et état lu ; aucun e-mail/SMS/push ; outbox sans worker de livraison |
| Prestation et avis | Intégré, parcours externe à valider | Terminaison après date passée et paiement confirmé ; un avis du client par prestation éligible ; pas de recette navigateur avec paiement fournisseur |
| Support | Intégré localement | Ticket avec ou sans compte, statut suivi en administration ; pas de réponse e-mail envoyée ni permanence |
| Litiges | Partiel | Statut de réservation et demande d'assistance ; pas de gestion automatisée des contestations Stripe ou dossier documentaire complet |
| Administration | Partiel | Candidatures, réservations, lecture des comptes, tickets, taux de commission, audit ; MFA absent donc accès bloqué hors démo |
| Pilotage financier | Partiel | Volumes et commissions associés aux statuts ; pas de comptabilité, de rapprochement exhaustif des frais/remboursements ou de facture fiscale |
| Simulateur de rentabilité | Intégré localement | Variables et trois scénarios paramétrables ; hypothèses, pas tarifs fournisseur ni prévision certaine |
| Médias | Partiel | Images locales de démonstration ; aucun dépôt de pièce sensible, stockage objet privé ou analyse de fichier |
| SEO et acquisition | Partiel | Langue française, métadonnées et navigation ; noindex/robots disallow actifs pour démo ; pas de sitemap commercial, pages locales, analytics ou campagne |
| RGPD et droit de la consommation | Préparation documentaire | Dossier de décisions et brouillons ; pas de validation juridique, contrats actifs, purge/export/suppression automatisés |
| Sauvegarde locale | Vérifiée sur fixture isolée | Copie hors ligne, restauration et réouverture PGlite testées ; pas de sauvegarde distante, PostgreSQL ni restauration complète des données réelles |
| Déploiement / supervision | Préparé, non déployé | Workflow et guide fournis ; pas de domaine, hébergement, alertes ou secrets de production |
| Promotions, parrainage, CMS, fidélité, entreprises, recommandations | Non livrés | Étapes ultérieures de la feuille de route |

## Pages présentes

| Route | Contenu |
| --- | --- |
| `/` | Accueil, recherche, sélection, occasions, recrutement, FAQ |
| `/chefs` | Résultats, filtres et tri |
| `/chefs/[slug]` | Présentation, menu et demande de réservation |
| `/connexion`, `/inscription` | Connexion et création de compte |
| `/devenir-chef` | Présentation et candidature |
| `/espace`, `/espace/reservations` | Espace client et réservations |
| `/espace/chef` | Activité chef |
| `/administration` | Administration locale protégée |
| `/aide` | FAQ et demande d'assistance sans compte obligatoire |
| `/a-propos`, `/comment-ca-marche` | Explication du service et de la démonstration |
| `/mentions-legales`, `/confidentialite`, `/conditions` | Informations préparatoires avec limites explicites |

Les variantes de routes héritées du cadrage peuvent être conservées comme aliases. Les pages privées sont soumises aux contrôles API ; cacher un bouton n'est pas une autorisation. Une route inconnue présente une page de retour à l'accueil ; la stratégie SEO de codes HTTP et métadonnées par profil reste à finaliser avant indexation.

## API et modèle de données

`GET /api` retourne les profils publics puis, selon la session, les données personnelles, réservations et conversations autorisées. Les résultats ont des plafonds de volume ; une vraie pagination serveur reste nécessaire pour une exploitation à grande échelle. Le chargement des filtres publics est côté interface dans cette version.

`POST /api` reçoit une action JSON : `register`, `login`, `logout`, `updateProfile`, `becomeChef`, `saveMenu`, `saveAvailability`, `createBooking`, `transitionBooking`, `toggleFavorite`, `sendMessage`, `markRead`, `reviewChef`, `createSupport`, `approveChef`, `setCommission`, `resolveSupport`. Il contrôle origine, format, taille, débit, session et propriété selon l'action. Les routes dédiées `/api/payments/status`, `/connect`, `/checkout`, `/webhook`, `/refund` sont décrites dans [STRIPE.md](STRIPE.md).

Le schéma livré regroupe certains concepts du cahier des charges : menu avec entrée/plat/dessert, snapshot et devis intégrés à la réservation, conversation rattachée à la réservation. Il ne contient pas une implémentation complète de toutes les entités cibles telles que pièces de vérification, adresses multiples, offres à options, versements, promotions, parrainage ou CMS. L'absence de ces tables ne doit pas être masquée par des lignes vides fictives dans les espaces privés.

## Vérifications automatisées

Les tests d'intégration exécutent les migrations dans des bases PGlite isolées. Ils ne remplacent ni PostgreSQL managé ni un test de charge multiprocessus. La passe globale du 14/10/2026 a réussi : **63 tests sur 63, répartis dans 6 fichiers, en 25,15 s**.

| Contrôle | Périmètre | État au moment de cette rédaction |
| --- | --- | --- |
| TypeScript | Typage du projet | Réussi le 14/10/2026 après intégration des échéances : aucune erreur |
| Lint | Analyse statique | Réussi le 14/10/2026, sortie 0 |
| Tests métier | Prix, commission, dates Paris, transitions, mot de passe, origine et admin | `backend-domain.test.ts` : 10/10 réussis |
| Intégration API/base | Inscription/session, prix client ignoré, concurrence, propriété, menus, commission, messages, support, favoris | `backend-integration.test.ts` : 14/14 réussis |
| Échéances de réservation | Demandes et acceptations expirées, créneaux libérés, protection des tentatives Stripe, bornes de configuration | `booking-expiry.test.ts` : 9/9 réussis |
| Sécurité hors démo | Origine, cookies HTTPS, secret, base obligatoire, proxy et route webhook | `production-security.test.ts` : 6/6 réussis |
| Stripe local | Événements signés par SDK, doublons, rollback, ordre, retard, montants, refunds, révocations | `payments.test.ts` : 19/19 réussis ; aucun appel réseau Stripe |
| Économie | GMV, frais, remboursements, acquisition, limites d'entrée et seuil de rentabilité | `economics.test.ts` : 5/5 réussis |
| Build | Compilation de l'application | Réussi avec Next.js 16.4.0 / Webpack ; routes publiques et API compilées |
| Playwright | Inscription/demande/chef/admin/messages, erreur de connexion, public mobile 390 px, bureau 1440 px et protection des espaces | 4 tests détectés ; lancement d'Edge refusé par le sandbox Windows (`0x80070005`) avant exécution applicative. Aucun parcours validé ni capture produite par cette passe. |
| Sauvegarde/restauration | PGlite réel isolé : écrire, fermer, copier, restaurer, rouvrir et comparer ; refus de chemins dangereux/écrasement | Réussi le 14/10/2026, sans toucher la base applicative |
| CI GitHub | Exécution distante du workflow livré | Non exécutée |
| Stripe sandbox externe | Onboarding, carte, authentification forte, refus, interruption, webhook Stripe et remboursement | Non exécuté : compte et secrets du propriétaire nécessaires |
| PostgreSQL / charge / sécurité indépendante | Déploiement, concurrence multiprocessus, scan de dépendances et audit | Non exécuté |

## Reproduire la recette navigateur

La configuration utilise Edge installé par défaut sous Windows. `PLAYWRIGHT_EXECUTABLE_PATH` permet de choisir un exécutable Chromium. Le workflow CI installe Chromium et renseigne cette variable. Les rapports et captures de travail se trouvent dans `../../work/playwright-report` et `../../work/playwright-results` par rapport au projet.

La tentative locale du 14/10/2026 a été bloquée par l'autorisation de lancement du navigateur, avant toute interaction avec l'application. Le rapport constate ce blocage d'environnement ; il ne prouve aucun défaut ou succès des parcours. Relancer depuis un terminal local autorisé avec un navigateur accessible, ou sur le workflow CI, avant de déclarer les scénarios réussis.

1. Ne pas lancer ces tests contre une base personnelle, commerciale ou contenant des paiements. La suite crée des comptes, une demande, des messages et de l'historique ; elle libère le créneau de son scénario, sans supprimer l'historique financier.
2. Utiliser un port dédié et un nouveau dossier PGlite. Dans un premier terminal PowerShell sous Node 24, depuis la racine :

```powershell
$env:APP_MODE = 'demo'
$env:APP_URL = 'http://127.0.0.1:3100'
$env:PGLITE_DATA_DIR = './data/recette-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
$env:DATABASE_URL = ''
$env:STRIPE_SECRET_KEY = ''
$env:STRIPE_WEBHOOK_SECRET = ''
npm.cmd run dev -- --port 3100
```

3. Vérifier que `/api/payments/status` retourne une configuration non prête ; la suite refuse volontairement un serveur Stripe configuré. Ne pas partager ce serveur PGlite avec une autre instance.
4. Dans un second terminal, depuis la même racine :

```powershell
$env:PLAYWRIGHT_BASE_URL = 'http://127.0.0.1:3100'
npm.cmd run test:e2e
```

5. Arrêter le serveur avec `Ctrl+C`. Examiner le rapport et les captures, puis noter version, environnement et résultat. Pour tester le build compilé, remplacer le lancement `dev` par `build` puis `start -- --port 3100` dans le premier terminal, en conservant l'isolation de base.

## Scénarios d'erreur et limites de couverture

Mauvais mot de passe, origine interdite, session expirée/révoquée, compte non propriétaire, tentative de prix falsifié, double demande concurrente, date indisponible, transitions interdites, webhook signé incorrect/expiré/dupliqué/tardif et ordre inversé sont couverts par les suites locales. Une récupération de mot de passe, un lien d'e-mail expiré ou un fichier trop volumineux ne sont pas des flux livrés ; ils devront avoir leurs propres tests lorsque ces fonctions seront implémentées.

Le parcours navigateur avec paiement refusé ou interrompu chez Stripe, la publication d'un avis après un vrai paiement de sandbox, le réseau instable pendant chaque mutation et les pannes d'infrastructure ne sont pas déclarés validés. Les événements Stripe locaux au format réel restent des fixtures, pas des échanges réseau avec Stripe. L'accessibilité clavier, les contrastes, le lecteur d'écran, le navigateur Safari/Firefox et les Core Web Vitals nécessitent une recette représentative ; aucune certification WCAG AA ou mesure LCP/INP/CLS n'est revendiquée.

## Registre des points ouverts

| Priorité | Point | Sortie attendue |
| --- | --- | --- |
| Bloquant ouverture | MFA admin et récupération/vérification de compte absents | Fournisseur ou implémentation revue, accès et récupération testés |
| Bloquant ouverture | Pas de recette Stripe externe ni frais/responsabilités validés | Sandbox complète, preuves et décision du propriétaire |
| Bloquant ouverture | Identité exploitant, contrats, annulation, médiation, fiscalité et vrais chefs manquants | Dossier humain validé et offre réelle autorisée |
| Bloquant ouverture | Pas d'e-mails, supervision, sauvegarde distante ou PostgreSQL validé | Services configurés, alertes/délivrabilité/reprise testées |
| Bloquant ouverture | Collecte de données sensibles et justificatifs non opérationnelle | Minimisation, accès, stockage, conservation et droits définis/testés |
| Avant pilote réel | Exploitation des échéances | Surveiller les tentatives retenues ; traitement à l'accès, sans délai de notification garanti en arrière-plan ; recette PostgreSQL/externe encore nécessaire |
| Avant pilote réel | Pas de modèle de facture et rapprochement exhaustif | Flux comptable approuvé et données exactes après refunds |
| Avant montée en charge | Bootstrap plafonné et filtres côté navigateur | Pagination/recherche serveur, mesures de charge et budgets de performance |
| Avant publication | Pages démo, métadonnées et robots bloquants | Remplacement par contenus vérifiés, SEO indexable et statuts HTTP contrôlés |
| Après validation commerciale | Carte, calendrier tiers, CMS, croissance et fidélité | Priorisation par valeur, coût, données et marge mesurés |

## Décisions humaines avant ouverture

L'exploitant doit fournir ou approuver : son identité et son contact, la marque/le domaine, les chefs réellement admis, les contrats et politiques applicables, le mode de facturation/TVA, le médiateur pertinent, les responsabilités Connect, les fournisseurs et budgets, les responsables de support et de données, les durées de conservation, la procédure d'incident, les accès sécurisés et l'autorisation de déploiement. Le détail juridique sourcé figure dans [CONFORMITE.md](CONFORMITE.md).

Les paiements réels, dépenses, communications externes et bascule de production exigent l'autorisation explicite du propriétaire. Cette version refuse techniquement le live Stripe ; une approbation seule ne l'activerait pas. Le lancement commercial ne doit être déclaré qu'après clôture des blocages et validation des parcours complets.

## Vérification dans le navigateur intégré — 14 octobre 2026

Réalisée séparément de la suite Playwright, avec autorisation explicite des trois comptes locaux fictifs. Le serveur HTTP a renvoyé 200 et les trois profils enregistrés.

- Connexion client réelle depuis l'interface, ouverture du profil Gabriel et sélection d'une date disponible.
- Création d'une demande fictive au 20 novembre 2026, quatre convives, total de 276 €, puis consultation dans l'espace client avec les statuts Demande envoyée / Non payé.
- Message du client enregistré, déconnexion, connexion chef et récupération de cette même demande et de ce message.
- Acceptation par le chef et réponse dans la conversation. Connexion administrateur : même menu, date, total et état Acceptée · paiement attendu / Non payé.
- Reconnexion client : réponse du chef retrouvée. Paiement de test demandé sans identifiants Stripe : indisponibilité explicite, sans changement du statut financier.
- Déconnexion exécutée en fin de parcours.
- Contrôle visuel à 1440 × 1000 sur accueil, réservation et administration. À 390 × 844, accueil et recherche sans débordement horizontal (largeur du document 375 px avec barre de défilement) et menu mobile actionnable. Aucun visuel cassé observé à l'accueil.

Cette recette ne valide pas un paiement externe, les remboursements fournisseur, l'inscription navigateur, toutes les actions du chef/admin, les appareils physiques ni une conformité WCAG. Les tests automatisés des services couvrent des scénarios complémentaires séparément. La suite Playwright reste à exécuter dans un environnement autorisant son navigateur.

La compilation utilise l'option officielle --webpack : Turbopack nécessitait des jonctions de fichiers interdites dans le sandbox Windows. Aucun contrôle TypeScript, test ou règle de sécurité n'a été désactivé. Le correctif de compatibilité realpath utilisé uniquement dans l'environnement de validation est décrit dans EXPLOITATION ; il n'est pas nécessaire au lancement normal hors sandbox.

Audit des dépendances de production exécuté le 14/10/2026 avec npm audit --omit=dev : 0 vulnérabilité connue signalée (critique, élevée, modérée ou faible). Cela ne remplace pas un audit de sécurité du code ou de l'infrastructure.

