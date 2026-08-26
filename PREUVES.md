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

## P2.7 — EX-J7 Fiscal compteur + alerte 250€ ✅ (2026-08-26)

**Seuil** : 250,00 € nets cumulés sur l'année fiscale en cours, alerte à `>=` (frontière incluse). D14 respecté : simple requête sur `ventes` (colonne `fiscal_year`), zéro table dédiée.

### Implémentation
- `src/lib/fiscal.ts` : `FISCAL_ALERT_THRESHOLD_CENTS = 25_000`, `fiscalSummary(sales, year)` (filtre année + somme nets + `alert` booléen), `formatEuros` (arrondi + fr-FR). Composant serveur pur.
- `src/components/dashboard/FiscalCounter.tsx` : section `aria-label="Revenus annuels"` → montant nets + progression (`role="progressbar"`, % du seuil) sous 250 €, bannière `role="alert"` `aria-label="Alerte seuil fiscal 250 euros"` (amber) dès le seuil — barre masquée quand alerte active.
- `dashboard/page.tsx` : `ventes` (net + fiscal_year) du vendeur dans le `Promise.all` existant → `fiscalSummary(rows, new Date().getFullYear())` → `<FiscalCounter/>`. Chiffres réels DB, 0 si 0.

### Preuves (matrice EX-J7 → « PW : somme ventes ≥250€ → bannière »)
- Unit `tests/fiscal.test.ts` (node:test, import dynamique `new URL(...)` miroir vida) — 6 tests : cumul année uniquement (année N-1 ignorée), vide → 0 sans alerte, 24 999 → false, frontière 25 000 → true, cumul 12 000+13 000 → true, seuil constant + `formatEuros`. **28/28** (22 vida + 6 fiscal).
- e2e `e2e/p8-fiscal.spec.ts` : login vendeur → `/dashboard` compteur = cumul réel (`formatEuros(sumBefore)` byte-à-byte, NBSP inclus) → PATCH service dernière vente → 300 € nets (gross 33 333 / commission 3 333) → reload → bannière `Alerte seuil fiscal 250 euros` visible + « 250 € de revenus nets atteints cette année. » + montant `sumAfter` + `progressbar` count 0. **PASSED 1/1 (7.2 s)**.

### Qualité
- `tsc --noEmit` exit=0 · `next build` 0 · unit 28/28 · e2e p8 1/1.
- Piège rencontré : `toLocaleString('fr-FR')` sépare les milliers par une espace insécable (U+00A0) — les assertions unit comparent sans séparateurs, l'e2e génère la même chaîne côté Node (byte-à-byte OK).
## P3 — EX-K2 Universels + Parrainage V4 ✅ (2026-08-26)

### Implémentation
- **4 blocs above the fold** (`/dashboard`, EX-K2) : Parrainage (code `TY-XXXXXX` + lien copiable), Ambassadeur (compteur filleuls, statut à vie), Écosystème PURAMA (cross-promo VIDA + KASH, code WELCOME50 copiable), solde Vida Vault. Objets + fiscal sous la ligne.
- **Codes parrain** : `profiles.referral_code` généré par trigger (`'TY-' || upper(substr(md5(id),1,6))`, backfill 4 profils) + RPC `ensure_referral_code()` idempotent appelé au rendu dashboard si absent.
- **Capture** : `/signup?ref=…` → `sessionStorage['tyaga_ref']` (survit confirmation email + OAuth Google) → bannière « Invitation de parrain détectée » → `ReferralAttach` (dashboard) POST `/api/referral/attach` → RPC `attach_referral` SECURITY DEFINER (`ok|invalid|self|already`) → clé levée + `router.refresh()`.
- **N1 (§9.2)** : `payReferralN1` dans `finalizeCompletedSale` après crédit vendeur — 50% de la commission (`Math.round(cents/200)`) en points Vault au parrain, flag `commission_paid` = jamais 2×, try/catch jamais bloquant pour la vente.

### Preuves
- Unit `tests/referral.test.ts` **5 tests** : n1 (200c→1, arrondi, 0 négatif), normalizeCode, referralLink, pattern `TY-[A-F0-9]{6}`. Total **33/33**.
- e2e `e2e/p9-universels.spec.ts` **2/2 (15.1s)** :
  1. EX-K2 — 4 headings + code regex + boutons copier + liens `https://vida.purama.dev` / `https://kash.purama.dev` + WELCOME50.
  2. Parrainage V4 — reset déterministe → code vendeur lu dashboard → login filleul (purge session : `clearCookies`+storages, sinon middleware redirect) → `sessionStorage` + reload → `expect.poll` SQL : ligne `referrals` (referrer=seller, code exact) → dashboard vendeur « 1 filleul » exact → garde self : propre code rejoué → 0 ligne self.
- `tsc --noEmit` exit=0.

### Piège rencontré
- Re-login même contexte Playwright : session active → middleware `/login`→`/dashboard` → `input[type="email"]` jamais rendu (timeout 60s). Fix : helper `logout` (`clearCookies` + `localStorage.clear` + `sessionStorage.clear`) avant chaque changement d'utilisateur.
## P4 — Admin + Aide + FAQ ✅ (2026-08-26)

### Implémentation
- **`/admin` God Mode lecture seule** : gate serveur `isSuperAdmin(user.email) || profiles.is_super_admin` (force-dynamic) → redirect `/login?next=/admin` si non connecté, `/dashboard` si non admin. Stats count (utilisateurs/commandes/ventes complétées/litiges `flagged_off_platform`) + 10 dernières lignes (profiles, marketplace_orders, ventes, inbox_messages flaggées, logs `stripe_events_processed`). Or via `--super-admin-gold` + utilities `.text-gold/.border-gold/.bg-gold-soft` — 0 hex dur composant.
- **`/aide`** : FAQ 6 catégories 16 entrées (`lib/faq.ts`) accordéon natif `<details>` (0 JS) + SupportChat (`/api/ai/support` : auth 401 FR, rate 20/h/user 429 FR, Zod, haiku-4-5 max 400 tok timeout 20 s, historique 6 tours, 503 FR → contact humain) + carte contact mailto `hello@tyaga.purama.dev` toujours visible.
- **Nav** : Aide sidebar-only (`NavLinks.tsx`) + icône header mobile (`(dashboard)/layout.tsx`) — bottom tabs restent à 7.

### Preuves
- e2e `e2e/p10-admin-aide.spec.ts` **3/3 (13.0s)** :
  1. `/aide` rendu : 6 catégories, accordéon `details` ≥6, suggestions rapides, textarea label, mailto visible.
  2. `/api/ai/support` non connecté → 401 + « Connecte-toi ».
  3. Gate admin : flag off → `/admin` redirige `/dashboard`, 0 heading God Mode ; flag on → heading + `.text-gold` + Utilisateurs/Commandes/Litiges ; flag off → referme. ZÉRO appel IA (aucun crédit brûlé), compte réel jamais créé/connecté.
- `tsc --noEmit` exit=0 · `next build` 0 · unit 33/33.

### Pièges rencontrés
- Apostrophe droite `'` dans texte JSX → `react/no-unescaped-entities` casse le build (6 occurrences admin + aide). Règle : U+2019 `’` partout.
- `getByText(...).first()` peut matcher un texte dans un `<details>` FERMÉ (hidden) → `toBeVisible` échoue 14 retries. Cibler un élément toujours visible (ex. `getByRole('link', { name: … })` de la carte contact).

## P5 — Design polish (2026-08-26)

### Implémentation
- **EX-I4 `PuramaBackground`** (`src/components/shared/PuramaBackground.tsx`, monté `layout.tsx`) : 9 braises CSS montantes, positions/durées/délais **déterministes** (tableau fixe, 0 `Math.random` → 0 dérive SSR/CSR), calque `fixed inset-0 -z-10 pointer-events-none`, keyframes `braise-rise` GPU-only (`transform`/`opacity`, `will-change`), couleurs `color-mix(var(--primary))` + ton `secondary` (0 hex dur). `prefers-reduced-motion` → `animation:none`, opacité figée 0.22, braises gelées à 12vh.
- **La Boucle signature** (`src/components/vida/BoucleRing.tsx`, framer-motion spring) : arc `strokeDashoffset` animé + braise (halo 7px + cœur 3.5px) qui naît au centre et migre vers le bout de l'arc (`delay 0.35s`, spring 50/14) ; `%` central `font-mono` ; `aria-label` contextuel (`role="img"`). `useReducedMotion()` → `initial:false` + `duration:0` (rendu statique immédiat). Intégré : `VaultCard` (objectif actif le plus proche par ratio, caption « Objectif le plus proche : « … » » / « Crée un objectif pour fermer La Boucle ») + `ObjectifCard` (anneau 72px à côté de la barre EX-H4, sélecteurs p7 intacts). Gem retiré du VaultCard (règle Chanel : une seule signature).
- **EX-I3 safe areas** : `viewportFit:'cover'` (viewport export `layout.tsx`) + `NavLinks` BottomTabs `pb-[env(safe-area-inset-bottom)]` + `main` dashboard `padding-bottom: calc(72px + env(safe-area-inset-bottom))` (globals.css).
- **D19** : i18n 16 langues → V1.1-BACKLOG (SPEC V1-CORE FR-only + Pilier 21, consigné DECISIONS.md).

### Preuves
- e2e `e2e/p11-design.spec.ts` **3/3** + régression `p10` **3/3** = 6/6 (14.0s) : 9 braises attachées + `animation-name: braise-rise` + z-index conteneur <0 ; `meta[name=viewport]` contient `viewport-fit=cover` ; anneau `role="img"` nommé `/La Boucle/` visible /dashboard + /vida.
- `tsc --noEmit` exit=0 · `next build` 0 · unit **33/33** (`node --test tests/*.test.ts`).
- **Deploy PROD** ✅ `dpl_JDiFpCa7oCiba1qiFTQWHJ8PVAFb` (smoke `https://tyaga.purama.dev/` → 200). Commit `a89990e`.

### Piège rencontré
- Tests unitaires : glob `src/lib/*.test.*` → 0 fichier (les tests vivent dans `tests/*.test.ts`). Toujours `npm run test:unit`.
- Playwright `toBeLessThan` attend un Number : `evaluate` sur `getComputedStyle().zIndex` (string) → wrap `Number(…)`. Et z-index négatif se vérifie sur le CONTENEUR (`-z-10`), pas sur l'enfant absolu (calcule `auto` = 0).

## P5 — DA boucle round 2 : fixes D1-D7 (2026-08-26)

### Ground truth (probe `/tmp/probe-vida.mjs`, Playwright, 2 viewports × 2 pages)
- Round 1 DA : 8.73/10 CONTINUER (D1-D7). Probe remplace le blâme ambigu par la mesure :
  - `/vida` @375 → overflow **0px** (le « 88px » DA venait de labels plus longs sur son compte — même classe de bug min-content) ; @768 → **49px réels**, coupables = actions `flex shrink-0 gap-1` (boutons 3×`h-10 w-10`) poussés par le header `ObjectifCard` sans `min-w-0`.
  - `/dashboard` @375 sain (1801px de hauteur ; le « 3598px promo pile » de DA était la hauteur `/vida` mal étiquetée).

### Fixes (commit `b4c47cc`)
- **D1/D2** `ObjectifCard.tsx` : header `flex flex-wrap` + gauche `min-w-0 flex-1 basis-40`, label `break-words`, colonne progression `min-w-0` — sélecteur p7 `[aria-label="Progression de l'objectif"]` intact.
- **D3** `/vida` : grille `lg:grid-cols-[1fr_400px]` — colonne La Boucle (vedette + objectifs) gauche, colonne argent (wallet/à confirmer/à répartir/historique) droite ; ordre DOM = wallet d'abord sur mobile (`lg:order-1/2`).
- **D4** vedette : objectif actif au meilleur ratio porte `BoucleRing size={128}` en héros (`aria-label="Objectif en tête"`, pts/pct/restant `aria-live`).
- **D5** `/dashboard` promo : pile pleine largeur mobile → carrousel `snap-x snap-mandatory` cards `min-w-[280px]` (`-mx-4 px-4`), grille 3 col dès `md`. Hauteur mobile 1801px → **1230px**.
- **D7** Vault/Fiscal : `sm:grid-cols-2` (était `md`).
- **D6** SKIPPÉ : prémisse DA fausse — braises déjà sur `/login`, e2e p11 le prouve (9 braises).

### Preuves
- Probe re-run : overflow **0px @375 et @768** sur `/vida` + `/dashboard`.
- `tsc` 0 · `eslint` 0 · build 0 (BUILD_ID frais) · unit **33/33**.
- e2e régression : `p9`+`p10`+`p11` **8/8 pass** (15.7s + retry). `p7` IA-dépendant **bloqué crédit ANTHROPIC_API_KEY** (HTTP 400 « credit balance is too low » — ERRORS.md 26/08, erreur #16 : regroupé pour audit à la recharge ; l'étape CRUD du spec passait avant le timeout IA, pas une régression design).
- **Deploy PROD** ✅ `dpl_H5AV5A7a4EjzsTPeYEYbEzpgTZKt` (smoke `/` 200 · `/login` 200 · `/vida` `/dashboard` `/marketplace` 307→login).

### Pièges rencontrés
- « 3598px de dashboard mobile » chez le DA = hauteur `/vida` : toujours re-mesurer soi-même avant de corriger un blâme visuel.
- `ls` sous squeez (persona ultra) rend la sortie illisible → rediriger vers /tmp et Read.

## P5 — DA boucle round 3 : fixes D8-D10 (26/08/2026)

Verdict DA r2 : **6.57/10 — BOUCLE: CONTINUER** (R6 overflow 5.0, R1 login 5.0 tiraillés par D9).

### Fixes
- **D9 (bloquant, systémique)** : libellés des CTA `bg-primary` pleins invisibles — `--primary-on-dark` ≡ `--primary` (le corail est déjà AA sur fond sombre, `lightenUntilAa` no-op). Ajout `onPrimary` dans `src/lib/brand/palette.ts` (`darkenUntilContrast` vs le remplissage, cible 6.5:1), token `--on-primary` + triplet RGB, couleur Tailwind `on-primary`, puis 16 fichiers migrés `text-primary-on-dark`/`text-white`/`text-foreground` → `text-on-primary` sur fonds pleins (20 usages). `primary-on-dark` garde son rôle sur fonds teintés (`bg-primary/15`).
- **D8** : `/marketplace` overflow +88px @375 — grid item prenait sa largeur max-content (li mesuré 443px dans une piste de 335px). `min-w-0` sur chaque `li` pour rétablir la chaîne truncate.
- **D10** : CTA `/vida` `text-white` 2.89:1 → couverts par le fix D9.

### Preuves
- Probe `/tmp/probe-r3.mjs` : overflow **0px @375 et @768** sur `/vida` `/dashboard` `/marketplace` `/login` `/` (10/10 ok, marketplace 463→375px).
- Contraste mesuré navigateur : tous les CTA primary pleins = **6.58:1** fg `rgb(26,13,5)` (« Commencer », « Copier mon lien d'invitation », « Proposer 24 pts », « Créer l'objectif », envoi chat SAV) — AA ≥4.5 ✅, cible 6.5 ✅.
- `tsc` 0 · `eslint` 0 · build 0 · unit **33/33**.
- e2e régression non-IA : `p9`+`p10`+`p11` **8/8 pass** (8.8s). IA toujours bloquée (erreur #16, ERRORS.md 26/08).
- **Deploy PROD** ✅ `dpl_GRRpLSyfEfrWMfpFShmB7BouB5gh` (commit `26a770c`) — smoke `/` 200 · `/login` 200 · `/dashboard` 307→login · token `--on-primary: #1a0d05` présent dans le HTML live.

## P5 — DA boucle round 3→4 : fix D11 badges teintés (26/08/2026)

**DA r3 = 9,4/10 — BOUCLE: CONTINUER (1 défaut)** : R1 9,4 · R2 8,9 · R3 9,5 · R4 9,5 · R5 9,3 · R6 10 · R7 9,2. D1–D10 tenus (0 cible <44px, nav 72px, blur 20px, rayons {16,24}, 0 cliché IA, 0 overflow).

**D11** : `text-*-on-dark` sur fonds teintés = 4,35:1. Cause racine palette : AA calé sur fond nu, pas sur le teinté composé.
Fix généralisé (`src/lib/brand/palette.ts`, `ON_TINTED_AA = 6` sur les 3 `lightenUntilAa` — primary, secondary, alert).

**Preuves** :
- Probe alpha-blend `/tmp/probe-d11.mjs` : **50 badges teintés / 5 pages, min 5,22:1** ≥ 4,5:1 AA ✅ — `/dashboard` 3 (5,22 bg-primary/20, 5,68 /15) · `/objets` 33 (5,22 « En vente », 5,68 « Estimé », 8,10 « Scanné » secondary/15) · `/commandes` 8 (5,68) · `/aide` 1 · `/messages` 5.
- CTA pleins inchangés : `--on-primary` D9 (6,58:1), zéro effet de bord.
- `tsc` 0 · build 0 · unit **33/33** · e2e non-IA `p9`+`p10`+`p11` **8/8 pass**.

### D11-bis — le fix 6:1 était un no-op, vrai fix composite (26/08/2026)

Commit c372a64 (ON_TINTED_AA=6) s'est révélé **no-op pour primary/secondary** : le draft #dd804b fait déjà 6,8:1 sur le fond nu → `lightenUntilAa` ne remontait jamais. Le probe v1 (blend direct sur fond page, sans la couche glass) donnait 5,22:1 fantôme ; le fond réel des badges = `bg-primary/20` + glass `rgba(255,255,255,.07)` + `#0a0a0f` = rgb(66,47,40) → 4,35:1 persistant (méthode DA r3 = exacte).

Vrai fix : `lightenUntilTintedAa` cible le composite pire-cas `tintedCompositeWorstCase(fill, 0.20)` à 5:1.

- Probe v2 plein-DOM (compositing de TOUTES les couches ancêtres, méthode DA) : **min global 5,11:1** / 50 badges / 5 pages — `#e29265` « 1 filleul »/« Actif »/« En vente » 5,11 · « Estimé »/icônes 5,59 · secondary « Scanné » inchangé (déjà 5,85) · alert `#e87d87` 5,08.
- tsc 0 · build 0 · unit 33/33 · e2e non-IA p9+p10+p11 8/8.
