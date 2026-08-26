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

## P2.4 — EX-F Inbox assistant + anti-fraude ✅ (2026-08-25)

### Unitaires (`tests/inbox.test.ts` 12/12 + `tests/order-transitions.test.ts` 5/5 = 17/17, exit=0)
- EX-F4 : détection IBAN / PayPal / WhatsApp+Telegram+Revolut+Lydia / tél FR (+33, 0X) / email / RIB FR ; message normal passe.
- EX-F2 : acheteur = 3 suggestions sans montant ; vendeur sans offre = 2 réponses d'accueil.
- EX-F3 : offre < plancher → refus poli proposé (jamais de contre < plancher) ; contre-offre = plancher exact ; offre ≥ plancher → acceptation au montant offert.

### e2e p5 (`e2e/p5-inbox.spec.ts` PASSED 34.0s, 1 worker)
- Parcours 2 comptes réels (seller/buyer confirmés via admin API) : publication annonce → plancher 60 € enregistré (`Enregistré`).
- EX-F1 : acheteur contacte depuis marketplace → fil `/messages/[id]` persisté, refresh vendeur `/messages` → lien visible.
- EX-F2 : suggestion acheteur « toujours disponible ? » envoyée UNIQUEMENT sur clic ; envoi explicite via composer.
- EX-F3 : offre 50 € < plancher → vendeur voit « Offre : 50 » + puce Négocier contre-propos chiffré 60 € (= plancher exact, `span.font-mono`) + clic Refuser → « Je ne descends pas sous 60 € ».
- EX-F4 : message « PayPal » acheteur → bloqué, avertissement FR « Message bloqué : PayPal détecté » ; vendeur (après reload) ne voit JAMAIS le message (RLS) ; preuve SQL PostgREST `Accept-Profile: tyaga` : dernier `inbox_messages` = body contient « PayPal », `flagged_off_platform = true`.

### Qualité
- `tsc --noEmit` exit=0 (spec e2e incluse) · `next build` 0 (segment précédent, inchangé) · unit 17/17.

## P2.5 — EX-G Expédition guidée ✅ (2026-08-25)

### Audit d'état (avant code)
- EX-G2 adresse post-paiement : déjà en place P2.3 (`commandes/page.tsx` — bloc adresse si `role=seller && status ∉ {pending, cancelled}` ; p4 e2e avait prouvé l'absence avant paiement).
- EX-G3 suivi manuel : déjà en place P2.3 (`CommandeActions` + `/api/orders/[id]/transition` + `finalizeCompletedSale` → completed+released+ventes).
- EX-G1 checklist : MANQUANT → `PackingChecklist.tsx` créé (6 étapes concrètes > 4+ exigées, progression localStorage par commande, jamais partagée) ; rendu si `role=seller && status==='paid'`.

### e2e p6 (`e2e/p6-expedition.spec.ts` PASSED 29.8s, 1 worker)
- Parcours complet 2 comptes réels : publication → achat réel jusqu'à `checkout.stripe.com` (aucune carte saisie) → commande `pending` visible acheteur.
- Paiement simulé côté système (service PostgREST PATCH `marketplace_orders` → `status=paid, escrow_status=held`, rôle webhook karma — réel paiement interdit en test).
- EX-G1 : vendeur `/commandes` → « Vente · Payée » + `section[aria-label="Emballage avant envoi"]` + « 0/6 étapes » → coche Étape 1 → « 1/6 étapes ».
- EX-G2 : « Adresse de livraison » + « Alex Acheteur » visibles vendeur UNIQUEMENT à ce stade (payée).
- EX-G3 : « Objet expédié » → « Vente · Expédiée » + checklist disparue → acheteur « J'ai bien reçu l'objet » → « Achat · Terminée » + « Vendeur payé ».
- Preuve SQL PostgREST (`Accept-Profile: tyaga`) : ordre = `status=completed`, `escrow_status=released`.

### Qualité
- `tsc --noEmit` exit=0 · `next build` 0 · unit 17/17.

## P2.6 — EX-H Vida Vault sandbox ✅ (2026-08-25)

### Implémentation
- H1 : wallet `vida_wallet` auto-créé inscription (trigger schema.sql) + `credit_wallet` SECURITY DEFINER idempotent appelé par `finalizeCompletedSale` (vente completed → net crédité, 1 pt = 1 € net).
- H2 : `/vida` section « Ventes à répartir » → radio 0/30/50/100 % + select objectif, POST `/api/vida/transfers` (Zod, rate limit) → statut `proposed`. Jamais automatique.
- H3 : étape 2 « À confirmer » → carte proposition + bouton « Confirmer le transfert » → RPC `tyaga.confirm_transfer` (SECURITY DEFINER, `user_id = auth.uid()` + statut proposed vérifiés en tête, SELECT FOR UPDATE) : débit wallet atomique + crédit objectif ; codes -1 solde / -2 objectif. Annulation possible.
- H4 : `ObjectifCard` barre progression + `X / Y pts` ; objectifs CRUD (`/api/vida/objectifs` + `[id]` archive).
- H5 : bannière sandbox permanente « Aucun virement bancaire n'est effectué » + footer ; grep code vida (`payout|virement|transfers.create`) = 0 appel API — uniquement libellés UI d'avertissement.

### Fix DB (pré-e2e)
- Bug : `confirm_transfer` SECURITY INVOKER + `vida_wallet` sans policy UPDATE (volontaire : écrits service uniquement) → UPDATE 0 rows → faux « solde insuffisant » (-1).
- Fix : `ALTER FUNCTION tyaga.confirm_transfer(uuid) SECURITY DEFINER` (appliqué VPS live + schema.sql). Autorisation reste en tête de fn (`auth.uid()` + `proposed`), rejet de l'alternative « policy UPDATE wallet » (permettrait au client d'écrire un solde arbitraire).

### e2e p7 (`e2e/p7-vida.spec.ts` PASSED 39.0s, 1 worker)
- Parcours complet 2 comptes réels : publication → achat → checkout.stripe.com (aucune carte) → paiement simulé service (rôle webhook) → expédié → reçu → completed → vente créée.
- EX-H1 (SQL) : `ventes.net_amount_cents` → `netPts` ; solde wallet `before ≥ netPts` (delta, comptes persistants).
- EX-H5 : « Sandbox : » visible. EX-H4 : création objectif (100 pts) → « 0 / 100 pts ».
- EX-H2 : radio 50 % + select objectif → « Proposer » → carte « Proposition en attente de ta confirmation » + objectif TOUJOURS 0 (rien avant confirmation). Purge service des `proposed` antérieurs (comptes persistants) pour isoler le run.
- EX-H3 : clic « Confirmer le transfert » (jamais auto). EX-H4 : objectif passe à `transferredPts / 100 pts` + historique puce « Confirmé ».
- SQL finale : wallet `after === before - transferredPts` ; `vida_objectifs.current_points === transferredPts`, `target_points = 100`.

### Qualité
- `tsc --noEmit` exit=0 · `next build` 0 (routes /vida + 5 API vida) · unit 22/22 (`tests/vida.test.ts`).
