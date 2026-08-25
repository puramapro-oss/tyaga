# PREUVES.md — TYAGA (preuves mesurées par feature)

> Chaque ligne = preuve réelle (commande + résultat), pas affirmation. Complément de la matrice SPEC.md.

## P2.2 — EX-C (estimation) ✅
- e2e `e2e/p2-estimation.spec.ts` 6/6 vert.
- SQL : 10 rows `estimations` `pct=10`, `net = round(prix×0.90)` exact.
- Append-only prouvé (re-demande = nouvelle ligne, ancienne conservée).

## P2.3 — EX-D (annonce assistée) ✅
- e2e `e2e/p3-annonce.spec.ts` vert : scan → estimation → génération IA (titre+desc+tags) → EX-D1 aperçu AVANT publication ; EX-D2 checkbox validation obligatoire (bouton inactif sans) ; EX-D3 2e compte voit l'annonce publiée `/marketplace` ; EX-D4 export filet B copie presse-papier.
- `tsc --noEmit` 0, `next build` 0.

## P2.3 — EX-E (marketplace Stripe Connect) ✅
Date : 2026-08-25.

### Preuves code + build
- `tsc --noEmit` EXIT=0 ; `next build` EXIT=0 (19 routes, cf /tmp/build-p4.txt).
- Unit `node --test tests/order-transitions.test.ts` 5/5 (cycle E3 + refus transitions illégales).
- EX-E4 : route unique `src/app/api/internal/stripe-fulfillment/route.ts` appelée par webhook karma partagé (dispatch `metadata.app_slug`), idempotence `event_id` ; `grep -ri 'webhook' src/app/api` = 0 webhook dédié TYAGA.
- Registry VPS `karma.webhook_app_registry` : row `tyaga | t` → `https://tyaga.purama.dev/api/internal/stripe-fulfillment` (52 apps).
- EX-E5 : e2e assert `/aucun règlement hors plateforme/` visible page annonce ; grep UI paiement hors Stripe = 0.

### e2e p4 (`e2e/p4-marketplace.spec.ts` PASSED 37.9s)
- Vendeur publie annonce ; vendeur voit `C’est ton annonce` (guard) ; acheteur ≠ vendeur achète (EX-E1).
- Checkout Stripe LIVE atteint (`checkout.stripe.com`, session créée, AUCUNE saisie carte — policy).
- `marketplace_orders` pending : buyer/seller distincts, `commission_pct=10`, `commission_amount_cents`/`net_amount_cents` tracés (EX-E2).
- Acheteur annule → `Achat · Annulée` ; vendeur voit `Vente · Annulée` + `Adresse de livraison` ABSENT (EX-G2 partiel : adresse masquée tant que pending/cancelled).

### Matrice RLS EX-E3 — SQL VPS (psql impersonation auth.uid(), /tmp/rls-matrix4.sql → /tmp/rls-out4.txt)
Commande : `sshpass … ssh root@72.62.191.111 "docker exec -i supabase-db psql -U postgres -d postgres" < /tmp/rls-matrix4.sql`

| # | Cas (état → cible, acteur) | Attendu | Résultat |
|---|---|---|---|
| C1 | seller pending→cancelled | 0 ligne | `C1 RESULT: 0 lignes` ✅ |
| C2 | buyer pending→paid | refus | `C2 RESULT: refus RLS` ✅ |
| C3 | INSERT buyer_id usurpé | refus | `C3 RESULT: refus RLS` ✅ |
| C4 | anon SELECT | 0 row | `anon_rows = 0` ✅ |
| C5 | buyer pending→cancelled | UPDATE 1 | `UPDATE 1` ✅ |
| C6 | système pending→paid+held | UPDATE 1 | `UPDATE 1` ✅ |
| C7 | buyer paid→shipped | 0 ligne | `C7 RESULT: 0 lignes` ✅ |
| C8 | seller paid→delivered | refus | `C8 RESULT: refus RLS` ✅ |
| C9 | seller paid→shipped | UPDATE 1 | `UPDATE 1` ✅ |
| C10 | seller shipped→delivered | 0 ligne | `C10 RESULT: 0 lignes` ✅ |
| C11 | buyer shipped→delivered | UPDATE 1 | `UPDATE 1` ✅ |
| C12a | buyer delivered→completed | 0 ligne | `C12a RESULT: 0 lignes` ✅ |
| C12b | seller delivered→completed | 0 ligne | `C12b RESULT: 0 lignes` ✅ |
| C13 | système delivered→completed+released | UPDATE 1 | `UPDATE 1` ✅ |

FINAL : `completed \| released` + commission 450 / net 4050 (ordre test 4500). Nettoyage : `DELETE 1` + ordre orphelin v3 supprimé (remaining = 1 commande e2e légitime annulée).

**13/13 VERT.** Séquence complète `pending → paid → shipped → delivered → completed` uniquement par la bonne partie (acheteur annule/reçoit, vendeur expédie, système paie/clôture) ; impersonnation `SET LOCAL ROLE authenticated` + `request.jwt.claims`.
