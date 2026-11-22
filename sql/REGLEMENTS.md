# Règlement des commandes et reprise des remboursements

Cette notice accompagne les migrations `20261122-order-settlement.sql` et
`20261122-order-refund.sql`. Les preuves de recette sont consignées dans
[`PREUVES.md`](../PREUVES.md). Aucune migration distante et aucun appel financier
réel ne sont nécessaires aux tests décrits ici.

## Installation et ordre de mise en service

Les migrations supposent le schéma TYAGA existant, ses tables et
`credit_wallet`. Elles sont transactionnelles et peuvent être rejouées sans
remettre à zéro les journaux déjà créés.

1. Suspendre et laisser terminer les anciennes versions du finaliseur et du
   webhook de paiement. Elles ignorent le journal ; les faire tourner à côté
   du nouveau code pourrait encore produire leurs anciens effets.
2. Appliquer `sql/20261122-order-settlement.sql`, puis
   `sql/20261122-order-refund.sql`, sur la base cible avec le rôle de migration.
3. Vérifier les droits des nouvelles RPC, le chargement du schéma PostgREST et
   les cas historiques en revue, avant de remettre les nouvelles routes en
   service.
4. Qualifier les verrous avec plusieurs connexions PostgreSQL sur une base
   isolée de même version que la cible, puis les parcours Stripe en mode test.

Une migration absente fait échouer les routes concernées avant l'émission
financière. Le succès d'un build ne remplace pas l'application de ces deux
migrations. Le schéma de base complet et les opérations réelles ne sont pas
implicitement qualifiés par les fixtures SQL partielles des tests.

## Une seule tentative de virement par commande

`prepare_order_settlement` verrouille la commande, vérifie l'acheteur, le
paiement et l'état autorisé. La vente, le crédit vendeur, le N1 et le retrait de
l'annonce sont exécutés dans une seule transaction. Une erreur de crédit,
y compris du N1, annule cette transaction et permet un rejeu sûr.

Les formules sont conservées : vendeur `floor(net_cents / 100)` points ; N1
`round(commission_cents / 200)` pour les centimes positifs. L'année de vente
est déterminée dans le fuseau `Europe/Paris`.

| État du journal | Signification et reprise autorisée |
| --- | --- |
| `awaiting_account` | Comptabilité terminée, aucun virement tenté ; la connexion d'un compte permet la première réservation. |
| `ready` | État interne, consommé sous verrou avant la réponse RPC. |
| `issuing` | Le droit d'émission est consommé définitivement ; toute reprise est une lecture Stripe. |
| `transferred` | Un reçu correspondant est enregistré. Le statut payé exige aussi une commande terminée et un séquestre libéré. |
| `no_transfer_due` | Net nul, aucun appel de virement de montant zéro. |
| `legacy_review` | Ancienne finalisation ambiguë ; aucun crédit ni virement automatique de rattrapage. |
| `refund_review` | Une preuve de remboursement ou de réversion demande une revue ; une réponse plus ancienne ne peut effacer cet état. |

Le montant, la devise, la destination, le groupe et la clé sont figés avant
l'appel Stripe. Le reçu est vérifié sur l'identifiant, le groupe, les metadata
application/commande, le montant, la devise et la destination. Zéro résultat,
plusieurs résultats, une page incomplète ou une erreur de lecture n'autorisent
jamais une nouvelle émission.

La clé d'idempotence Stripe protège l'appel initial et ses reprises réseau
immédiates. Elle ne constitue pas la protection durable : Stripe peut retirer
une clé après au moins 24 heures. Le journal ne possède donc ni délai
d'expiration ni remise en disponibilité automatique.

Une réponse RPC perdue après consommation du droit, même avant tout appel
Stripe, exige un rapprochement. Cette limite est intentionnelle : absence de
reçu et preuve de non-exécution sont deux informations différentes. Ne jamais
effacer le journal ou remettre un claim à `ready` pour débloquer un paiement.

## Remboursements : comptabilité et preuve de compensation

`prepare_order_refund` verrouille le même ordre que la finalisation. Pour un
remboursement complet prouvé, elle regroupe la suppression de la vente avec
`DELETE RETURNING`, le débit du wallet, l'état `cancelled/refunded` et le
marqueur de compensation dans la même transaction. Une ancienne commande déjà
annulée qui conserve une vente peut ainsi être reprise.

Le débit conserve la règle existante : `floor(net_cents / 100)`, avec plancher
de solde à zéro. `total_earned_points` et le N1 ne sont pas annulés : aucune
nouvelle règle économique n'est introduite pour ces compteurs.

| État de remboursement | Comportement |
| --- | --- |
| `partial_review` | Remboursement partiel observé ; aucun prorata, aucune annulation complète supposée. |
| `pending_transfer` | Un virement a pu exister mais son reçu manque ; rapprochement en lecture seulement. |
| `pending_reversal` | Reçu connu et comptabilité compensée ; la première réversion peut être réservée. |
| `reversing` | Une tentative de réversion est réservée définitivement ; les reprises lisent la preuve Stripe. |
| `reversal_review` | Réversion partielle ou observation incohérente ; aucun complément automatique. |
| `complete` | Aucun virement n'était possible avant le remboursement, ou la réversion complète est prouvée. Cet état ne régresse pas. |

La réversion porte sur le montant entier figé du transfert. Les réponses et
les erreurs ambiguës ne provoquent aucune deuxième tentative d'émission.
Une réversion déjà appliquée dont la réponse s'est perdue est reconnue par
une lecture du transfert ; un échec de persistance du reçu est traité de la
même façon. Une réversion partielle ne déclenche pas un complément calculé.

Un transfert arrivé pendant le remboursement conserve son reçu sans
ressusciter la commande. Le rejeu du webhook peut ensuite le rapprocher et
réserver sa réversion. Une réponse de transfert antérieure à la réversion ne
peut rétablir un statut payé.

`charge.refunded` inclut les remboursements partiels. Ils restent en revue
sans inventer leur traitement métier. Un événement partiel plus ancien ne
peut défaire un remboursement complet déjà enregistré.

Stripe ne garantit pas l'ordre des événements. Si le remboursement arrive
avant le checkout qui rattache le PaymentIntent, le webhook répond en erreur
réessayable et ne pose aucun marqueur de succès. Après rattachement, son rejeu
peut achever la compensation. Les paiements jamais rattachés demandent un
rapprochement ; ils ne sont pas considérés résolus.

Le rejeu d'un ancien événement de remboursement déjà marqué traverse encore
le journal durable. Les autres événements conservent leur déduplication. Un
checkout rejoué ne demande pas un nouveau remboursement du même PaymentIntent
si le journal prouve déjà son remboursement complet. Une lecture de commande
en erreur ne peut être interprétée comme la preuve d'un paiement orphelin.

## Suivi opératoire et limites

Le dispatcher de webhooks existant reste le mécanisme de reprise. Une
compensation inconnue ou partielle renvoie une erreur et ne reçoit aucun
nouveau marqueur de succès. La durée et le nombre de reprises dépendent de
ce dispatcher : ce lot n'ajoute aucun worker ni calendrier de relance.

Les événements encore non résolus à la fin de cette fenêtre doivent être
rapprochés par l'exploitation. Le journal est la liste persistante des cas
rattachés à une commande. Les paiements non rattachés restent visibles comme
échecs du dispatcher et nécessitent leurs identifiants d'événement et de
PaymentIntent pour investigation.

Exemple de contrôle en lecture seule :

```sql
SELECT s.order_id, o.status, o.escrow_status,
       s.state, s.refund_state, s.amount_cents,
       s.stripe_transfer_id, s.stripe_reversal_id,
       s.claimed_at, s.reversal_claimed_at, s.refund_accounted_at
FROM tyaga.order_settlements s
JOIN tyaga.marketplace_orders o ON o.id = s.order_id
WHERE s.state IN ('legacy_review', 'issuing')
   OR s.state = 'refund_review' AND s.refund_state IS NULL
   OR s.refund_state IS NOT NULL AND s.refund_state <> 'complete'
ORDER BY s.created_at;
```

Un virement Connect confirmé correspond au transfert vers le compte Stripe
vendeur. Il ne constitue pas une preuve de versement ultérieur sur son compte
bancaire. L'interface n'affirme plus « Vendeur payé » sur le seul état
`released` ; elle utilise le reçu et l'état du séquestre.

La migration ne reconstruit pas les anciens crédits sans trace ni les
historiques financiers incomplets. Ils restent protégés contre un nouveau
virement automatique. Le journal référencé par une commande n'est pas effacé
en cascade : son absence ne doit jamais recréer un droit d'émission.

## Recettes reproductibles

Les dépendances de test sont verrouillées dans le dépôt : PGlite `0.5.17`,
JSDOM `29.0.2`. Les tests financiers utilisent le vrai code de production, les
vraies fonctions SQL et les vrais objets HTTP Next ; les frontières Stripe,
session et transport Supabase sont remplacées localement.

```sh
npm ci --legacy-peer-deps --ignore-scripts --no-audit
npm run test:unit
npm run test:settlement:sql
npm run test:auth-callback
```

`test:settlement:sql` exécute les fichiers successivement pour limiter la
mémoire. Les tables, fonctions de crédit, règles RLS et triggers utilisés par
les fixtures proviennent de `schema.sql`. Les deux migrations de ce lot sont
exécutées telles quelles. Les tests de webhook remplacent la vérification
cryptographique Stripe ; ils ne qualifient pas une signature réelle.

PGlite fournit une instance PostgreSQL embarquée et sérialise les requêtes.
Les entrelacements applicatifs sont contrôlés par des barrières de promesses.
Ils ne constituent pas, à eux seuls, une preuve de concurrence native entre
plusieurs connexions. Les résultats natifs éventuels sont rapportés
séparément dans `PREUVES.md` avec leur version et leur périmètre.

La recette native maintenue est `npm run test:postgres-concurrency`. Elle
exige une base **vide et jetable**, un nom de base et un rôle commençant par
`tyaga_test_`, et un hôte local. Elle refuse de réinitialiser un schéma TYAGA
existant. Définir `TYAGA_TEST_PG_DATABASE`, `TYAGA_TEST_PG_USER` et
`TYAGA_TEST_PG_HOST`, éventuellement `TYAGA_TEST_PG_PORT` et
`TYAGA_TEST_PSQL_BIN`. En CI, `TYAGA_TEST_PG_CONTAINER` sélectionne le service
PostgreSQL dédié via `docker exec`. Chaque appel ouvre sa propre connexion ;
la transaction de contrôle reste ouverte jusqu'à l'observation du verrou,
puis est libérée explicitement. Aucune URL de production ni variable de
connexion produit n'est utilisée par ces tests.

## Références techniques

- [Clés d'idempotence Stripe](https://docs.stripe.com/api/idempotent_requests)
- [Liste des transferts par groupe](https://docs.stripe.com/api/transfers/list)
- [Lecture d'un transfert](https://docs.stripe.com/api/transfers/retrieve)
- [Création d'une réversion](https://docs.stripe.com/api/transfer_reversals/create)
- [Événement charge.refunded, y compris partiel](https://docs.stripe.com/api/events/types#event_types-charge.refunded)
- [Ordre des événements webhook](https://docs.stripe.com/webhooks#event-ordering)
