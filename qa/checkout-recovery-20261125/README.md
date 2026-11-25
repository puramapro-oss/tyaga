# Reprise Checkout et annulation — réception du 25 novembre 2026

**PARTIEL — candidat de revue, non prêt à fusionner ou à appliquer en production.**

Base : `70c2e74ac78bfb2bce263c0e323934c6b296d3e5`, branche
`feat/annonces-pura-share-20261125` (PR2). La branche de cette revue est
`codex/audit-tyaga-checkout-reconcile-20261125`, avec déploiement Git Vercel désactivé.

## Problèmes reproduits et corrections HTTP

Une création Stripe simulée acceptée suivie d'une réponse perdue entraînait
l'annulation de la commande ; le rejeu créait une deuxième session. Un échec
de sauvegarde de l'identifiant de session pouvait aussi être suivi d'une réponse
HTTP de succès. Le premier banc du vrai handler a reçu 4 réussites et 14 échecs
sur la base, puis 18 réussites après correction. Ces sorties initiales ont été
reçues sur le Mac ; elles ne constituent pas une exécution SQL ou Stripe réelle.

Le candidat conserve l'état inconnu, utilise des clés d'idempotence stables,
contrôle le reçu et son accusé de sauvegarde. La reprise ne recrée pas une session :
elle lit celle qui est déjà liée à une commande et à son contrat. Un ancien pending
sans identifiant persistant reste en vérification, sans nouveau paiement.

La route d'annulation attend une expiration vérifiée de la même session et un
accusé de RPC correspondant. Une session payée, un reçu incohérent ou une migration
absente ne produisent pas un succès. L'acteur autorisé est toujours vérifié avant
la reprise. Aucune commande historique incertaine n'est silencieusement réparée.

La contre-revue a identifié deux défauts supplémentaires : un rejeu après réponse
d'annulation perdue restait bloqué et le nettoyage avant Checkout ignorait son
accusé. Les trois contre-exemples du rapport `recovery-before.tap` échouent avant
correction. Ils passent après correction ; un cas supplémentaire traite une
exception de transport pendant le nettoyage. Le message d'erreur n'affirme plus
que la commande reste réservée lorsque l'annulation a pu avoir été commise.

## Qualification reçue

| Contrôle | Résultat et portée |
|---|---|
| Contre-épreuve HTTP avant correction finale | 36 tests : 33 PASS / 3 FAIL |
| Reprise HTTP après correction finale | **37/37 PASS**, aucun ignoré |
| Runner unitaire standard | **168/168 PASS**, inclut les 37 ci-dessus |
| `npm run typecheck` | PASS |
| ESLint sources et nouveau fichier de test, zéro warning admis | PASS |
| Contre-revue indépendante du delta HTTP | PASS dans le périmètre relu |
| Impact GitNexus des deux handlers | UNKNOWN ; appels HTTP non résolus, références relues manuellement |
| Nouvelle migration SQL | **NON TESTÉE**, aucune exécution |
| Concurrence PostgreSQL native | **NON TESTÉE** |
| Stripe / bases / comptes réels | **NON TESTÉS**, aucun appel |

Le banc charge le véritable TypeScript des handlers et BuyPanel. Les adaptateurs
Stripe et Supabase sont simulés et bornés à la fixture ; il n'exécute pas la RPC
SQL et n'établit pas la validité de ses verrous. Les succès simulés ne constituent
pas une recette de production. Les compteurs ne doivent pas être additionnés.

Commandes de réception exécutées depuis la racine :

```sh
node --experimental-vm-modules --conditions=react-server --import ./tests/ts-resolve.mjs --test tests/checkout-order-route.test.mjs
npm run test:unit
npm run typecheck
node node_modules/eslint/bin/eslint.js src tests/checkout-order-route.test.mjs --max-warnings 0
```

## SQL : défaut antérieur prouvé, correctif encore non qualifié

Avant l'interruption, une fixture PGlite avec les véritables policies et le trigger
du schéma de base a reçu un passage vendeur `pending → shipped` sans paiement,
puis acheteur `shipped → cancelled`. Ce défaut provient de la composition des
conditions RLS et ne constitue pas une preuve de concurrence multiconnexion.

`sql/20261125-checkout-cancellation.sql` est un candidat additif qui prévoit une
policy plus stricte, un trigger et une RPC d'annulation verrouillée. **Ce fichier
n'a pas été exécuté, même sur la fixture.** Un tour du sous-agent a été interrompu
par un signalement automatique générique de risque cyber. Aucun motif détaillé
n'était disponible. La suite a été réduite aux corrections HTTP et aux tests avec
adaptateurs simulés. L'empreinte du fichier SQL est restée inchangée :

`5eb0b716b171ef1c6a166cf295cc2db3a7a62c0cc423d2a854324bda01b26522`

La qualification doit encore vérifier la syntaxe et la réapplication, les droits,
les transitions légitimes, la conservation des refus, les réponses perdues et les
courses paiement/annulation sous véritables verrous. Le harnais natif
`tests/order-concurrency.postgres.mjs` reste inchangé. La nouvelle migration n'est
pas chargée par les anciens bancs SQL. **Ne pas fusionner ni déployer ce candidat
sur la seule base des 168 tests unitaires.**

## Continuité et limites

Le premier lot demeure dans le checkout Mac isolé. Les changements ultérieurs
sont préparés dans le clone Linux isolé après perte de la connexion au Mac.
Aucune source originale, donnée personnelle, clé, service, DNS ou base réelle
n'a été modifié par cette réception. La politique physique v3 (3 % + 0,35 €),
les contrats historiques et les licences numériques restent distincts.

Références officielles : [erreurs Stripe](https://docs.stripe.com/error-low-level),
[idempotence](https://docs.stripe.com/api/idempotent_requests) et
[expiration Checkout](https://docs.stripe.com/api/checkout/sessions/expire).

Les empreintes et résultats exacts sont dans `verification.json` ; les sorties
reçues sont conservées dans ce dossier. Les contrôles de publication et de CI
doivent être rattachés à leur propre commit et arbre.
