# Stripe Connect — intégration de test

État du livrable : code intégré, migrations et 19 tests locaux validés. Aucun compte Stripe, paiement, remboursement ou versement externe n’a été créé pendant cette réalisation. Les parcours hébergés par Stripe et la réception de vrais événements de sandbox restent à valider avec les accès du propriétaire.

## Choix et flux

Le serveur utilise le SDK `stripe` 23.0.0, dont la version API par défaut est `2026-09-30.endive`. Les comptes connectés français utilisent Accounts v1 avec propriétés `controller` : tableau de bord Express, collecte des justificatifs par Stripe, frais et pertes de paiement à la charge de la plateforme. Ce choix technique de test ne vaut pas acceptation commerciale de ces responsabilités. La configuration Connect et le choix v1/v2 doivent être revus avec Stripe avant lancement. [Propriétés controller](https://docs.stripe.com/connect/migrate-to-controller-properties).

La réservation conserve son prix, sa devise et son taux de commission. Le paiement utilise ce montant exclusivement côté serveur : la commission initiale est de 10 % de la prestation, hors frais de déplacement, arrondie au centime. Le montant de commission figé et le compte connecté sont copiés dans une tentative de paiement. Le navigateur ne transmet que l’identifiant de réservation.

Checkout crée une destination charge avec `payment_intent_data.application_fee_amount` et `transfer_data.destination`. La carte est le seul moyen proposé (`allowed_payment_method_types: ['card']` dans cette version SDK). Les fonds sont affectés au solde du compte connecté selon le fonctionnement Stripe : **ce mécanisme n’est pas un séquestre jusqu’au repas**. La plateforme supporte notamment les frais Stripe, remboursements et contestations de ce modèle. La commission brute n’est donc pas la marge nette. Aucun tarif Stripe n’est codé en dur. [Destination charges](https://docs.stripe.com/connect/destination-charges?platform=web&ui=stripe-hosted).

## Configuration

| Variable | Valeur attendue |
|---|---|
| `STRIPE_SECRET_KEY` | Clé de sandbox commençant par `sk_test_`, exclusivement serveur |
| `STRIPE_WEBHOOK_SECRET` | Secret `whsec_` de l’endpoint utilisé, exclusivement serveur |
| `APP_URL` | Origine canonique HTTPS, ou HTTP sur localhost/127.0.0.1 pour les tests locaux |
| `REFUND_POLICY_MODE` | Vide par défaut ; `manual_admin_review` uniquement après validation de la procédure humaine |
| `REFUND_POLICY_VERSION` | Identifiant de la politique approuvée, vide par défaut |

Ne jamais mettre ces secrets dans une variable `NEXT_PUBLIC_`, un dépôt ou une capture d’écran. Les clés `sk_live_` et les événements `livemode: true` sont systématiquement refusés ; **aucun paramètre ne permet d’activer les paiements réels dans cette version**. Une configuration absente produit une réponse explicite `503` et aucun paiement simulé réussi.

## API

Les routes de mutation ordinaires exigent une session, une origine autorisée, du JSON, une limite de taille et une limite de débit. La route webhook exige une signature, sans session utilisateur.

| Route | Comportement |
|---|---|
| `GET /api/payments/status` | Indicateurs de configuration et mode test ; aucun secret |
| `POST /api/payments/connect` `{}` | Chef connecté uniquement ; crée/réutilise son compte, retourne un lien d’onboarding |
| `POST /api/payments/checkout` `{bookingId}` | Propriétaire de la réservation uniquement ; réservation acceptée et non expirée, chef prêt |
| `POST /api/payments/webhook` | Corps brut et en-tête `Stripe-Signature` |
| `POST /api/payments/refund` `{bookingId, reason}` | Administrateur autorisé, politique configurée, motif obligatoire, remboursement intégral de test |

Un chef qui réserve chez un autre chef peut payer en qualité de client : l’autorisation repose sur `client_id`. Une redirection vers `/espace/reservations?paiement=retour` ne marque jamais la réservation payée. Le retour Connect vers `/espace/chef` ne marque jamais le chef prêt. Un lien Connect expiré se renouvelle depuis le bouton de cet espace ; il n’est pas envoyé par e-mail. [Liens d’onboarding](https://docs.stripe.com/api/account_links/create).

## Webhooks et invariants

Configurer des événements **snapshot**, dans la même version API que le SDK, pour l’endpoint de plateforme et les comptes connectés selon le type d’événement :

- `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled` ;
- `checkout.session.completed`, `checkout.session.expired` ;
- `account.updated` pour les comptes connectés ;
- `charge.refunded`, `refund.created`, `refund.updated`, `refund.failed`.

Le SDK vérifie la signature sur le corps brut et sa tolérance temporelle standard. L’identifiant d’événement est inséré avec contrainte d’unicité dans la même transaction que les changements métier. Une incohérence entraîne un rollback et une réponse d’erreur pour permettre la reprise après investigation. [Webhooks Stripe](https://docs.stripe.com/webhooks).

Un succès vérifie l’identifiant de tentative, la réservation, le PaymentIntent déjà associé, la devise, le total attendu/reçu, la commission et la destination. `checkout.session.completed` rattache seulement l’intention ; le succès du PaymentIntent confirme le paiement. Un refus reçu après un succès ne dégrade pas ce dernier. Deux livraisons identiques produisent une seule confirmation, un seul historique et une seule notification interne.

Une réservation annulée ou dont la fenêtre a expiré n’est pas réactivée par un paiement tardif : les fonds reçus sont consignés `PAID`, la tentative est `REVIEW`, et le client est invité à contacter le support. Il faut examiner ces dossiers avant tout remboursement. Les événements `account.updated` anciens ne peuvent pas annuler une révocation plus récente ; les deux événements contradictoires à la même seconde privilégient la désactivation.

La clé d’idempotence Checkout repose sur l’identifiant de tentative persisté. Les reprises réseau réutilisent cette tentative et la session ouverte. Une création dont la réponse n’a jamais été enregistrée est bloquée au-delà de 23 heures pour éviter de réutiliser une clé après la période minimale de conservation Stripe. Ce cas nécessite un rapprochement humain, pas une nouvelle tentative aveugle.

## Annulation, remboursements, rapprochement

Une session ouverte peut encore être payée après un refus de carte. Le backend bloque donc l’annulation tant qu’une tentative `CREATED` ou `PENDING` existe, y compris si la réservation indique `FAILED`. Une interruption Checkout n’annule pas automatiquement la réservation. Son expiration signée rend une nouvelle tentative possible si la réservation reste éligible.

La route de remboursement demeure désactivée tant qu’une politique humaine n’a pas été renseignée. Elle enregistre la version, le motif et l’administrateur avant d’envoyer une demande idempotente de remboursement intégral avec inversion du transfert et remboursement de la commission. Aucun barème d’annulation ni droit contractuel n’est inventé. La réponse API ne change pas seule le statut comptable : `charge.refunded` signé le confirme. Les remboursements partiels effectués dans Stripe sont rapprochés lorsqu’un événement signé correspondant arrive. Les anciens événements ne réduisent jamais le montant remboursé déjà enregistré.

L’administration hors démonstration est actuellement bloquée tant que le dispositif MFA n’est pas livré. Les remboursements ne contournent pas ce verrou.

Contrôles opérateur avant ouverture puis quotidiens : examiner `payment_events.outcome` (en particulier `PAID_REQUIRES_REVIEW` et `UNMATCHED_REFUND`), les tentatives `REVIEW`, les remboursements en attente/échec et les tentatives sans session. Rapprocher avec les identifiants Stripe du compte sandbox. La reprise d’un événement en erreur intervient après correction et retransmission depuis Stripe ; ne pas marquer les écritures financières manuellement pour masquer l’écart. Le rapprochement automatique complet, la gestion des litiges Stripe et le suivi des virements bancaires ne sont pas implémentés.

## Recette et limites vérifiées

`tests/payments.test.ts` exécute les trois migrations sur une vraie base PGlite isolée et des événements au format Stripe, signés localement par le SDK avec un secret de fixture. Les tests vérifient : accès par propriétaire, montant figé, clés réelles interdites, signature modifiée/expirée, déduplication concurrente, rollback financier, association d’intention, retards et ordre inversé, refus puis succès, remboursement monotone et révocation de compte. **19 tests passent**. Ces tests n’utilisent pas le réseau et ne constituent pas une recette externe Stripe.

À réaliser avec le compte du propriétaire : onboarding complet en sandbox ; vérification des capacités ; paiement accepté, refusé et authentification forte ; interruption et reprise ; événement envoyé par Stripe/CLI ; répétition et retard ; remboursement intégral avec retour de commission/transfert ; contrôle Dashboard des soldes et frais. Utiliser uniquement les données de test publiées par Stripe. [Tester Connect](https://docs.stripe.com/connect/testing), [cartes de test](https://docs.stripe.com/testing).

Restent aussi à valider : endpoint HTTPS public, séparation des secrets par environnement, version snapshot effective, journalisation/alertes, scénarios sous PostgreSQL managé et concurrence multiprocessus, sauvegarde/restauration, conditions contractuelles, frais effectifs, responsabilité des pertes, calendrier des versements et autorisation explicite de l’exploitant avant toute évolution vers le réel.
