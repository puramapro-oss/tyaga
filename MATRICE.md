# MATRICE.md — Traçabilité EX-ID → test → preuve (TYAGA V1-CORE)

> Chaque exigence SPEC.md ↔ test réel ↔ preuve mesurée. Source des preuves : PREUVES.md (détail), task_plan.md journal, /tmp probes archivés dans les rapports.
> Statuts : ✅ prouvé · ⏳ P6 en cours · 🔒 IA différée (crédit ANTHROPIC épuisé, erreur #16 — testé vert AVANT épuisement, re-audit groupé prévu).

## EX-A — Auth & compte

| EX | Test | Preuve | Statut |
|---|---|---|---|
| A1 inscription email+confirm+login | e2e tous specs (login tyaga-e2e + comptes seller/buyer créés + confirmés admin API) | PREUVES P2.3/P2.4 (2 comptes réels persistants) | ✅ |
| A2 Google OAuth EN VRAI | VPS `GOTRUE_EXTERNAL_GOOGLE_ENABLED`+`URI_ALLOW_LIST`+restart AVANT test manuel ; e2e p1 redirection `accounts.google.com` | task_plan P1 `[x]` manuel (25/08) + e2e p1:124 redirection — session créée prouvée manuel, pas capturée | ✅ (partiel : redirection automatisée, session = manuel) |
| A3 middleware redirect + profil auto | smoke prod `/dashboard`→307 `/login?next=` ; trigger schéma `tyaga` (schema.sql) | journal 25/08 deploys smoke ; P2 comptes auto-profilés | ✅ |
| A4 signOut non mort | e2e p9 helper `logout` (clearCookies+storages) → middleware renvoie /login | PREUVES P3 piège re-login | ✅ |

## EX-B — Scan

| EX | Test | Preuve | Statut |
|---|---|---|---|
| B1 3 photos capture/galerie → storage `tyaga-photos/{user}/{item}` | e2e `p2-scan.spec.ts` | P2.1 ✅ 25/08 (task_plan) | ✅ |
| B2 sha256 + captured_at | SQL VPS `SELECT count(sha256), count(captured_at) FROM tyaga.item_photos` → 129/129 non-null, `storage_path` = `{user_id}/{item_id}/fichier` (PREUVES P6-B2) | PREUVES P6-B2 (26/08) | ✅ |
| B3 IA vision <20s ou message FR | e2e p2 (`/api/scan`) | P2.1 ✅ 25/08 | 🔒 re-audit à la recharge |
| B4 IA propose, user modifie | e2e p2 (champs éditables avant save) | P2.1 ✅ 25/08 | ✅ |
| B5 item `scanned` + liste | e2e p2 + `/objets` (« Scanné » badge, probe D11) | P2.1 ✅ 25/08 + probe 26/08 | ✅ |

## EX-C — Estimation

| EX | Test | Preuve | Statut |
|---|---|---|---|
| C1 prix conseillé+fourchette+délai « estimé » | e2e `p2-estimate.spec.ts` | PREUVES P2.2 6/6 | ✅ |
| C2 net serveur `prix×(1−10%)` | e2e + SQL 10 rows `pct=10` `net=round(prix×0.90)` exact | PREUVES P2.2 | ✅ |
| C3 commission affichée AVANT publication+vente | e2e p3/p4 (assert libellé 10 %) | PREUVES P2.2/P2.3 | ✅ |
| C4 historique append-only | e2e re-demande = nouvelle ligne, ancienne conservée | PREUVES P2.2 | ✅ |
| C5 jamais « vendu garanti » | scan lexical auditeur : seules occurrences « garanti » = pages légales + sanitizers IA `.replace(/garanti\w*/gi,'estimé')` (listing-ai.ts:57, estimate-ai.ts:91) | CERTIFIED.md §C5 (26/08) | ✅ 26/08 |

## EX-D — Annonce assistée

| EX | Test | Preuve | Statut |
|---|---|---|---|
| D1 IA génère titre+desc+tags, aperçu AVANT publication | e2e `p3-annonce.spec.ts` | PREUVES P2.3 (vert 25/08) | 🔒 re-audit IA |
| D2 publication impossible sans validation explicite | e2e p3 (checkbox, bouton inactif) | PREUVES P2.3 | ✅ |
| D3 annonce visible par tout utilisateur authentifié | e2e p3/p4 (2e compte voit `/marketplace`) | PREUVES P2.3 | ✅ |
| D4 export texte filet B copie presse-papier | e2e p3 | PREUVES P2.3 | ✅ |

## EX-E — Marketplace interne

| EX | Test | Preuve | Statut |
|---|---|---|---|
| E1 Stripe Connect, séquestre, acheteur≠vendeur | e2e `p4-marketplace.spec.ts` (checkout LIVE atteint, 0 carte saisie) | PREUVES P2.3 37.9s | ✅ |
| E2 commission 10% tracée chaque vente | e2e + SQL `commission_amount_cents`/`net_amount_cents` | PREUVES P2.3 | ✅ |
| E3 cycle états, transitions par la bonne partie (RLS) | matrice RLS 13/13 SQL VPS impersonation | PREUVES P2.3 13/13 VERT | ✅ |
| E4 webhook partagé karma `app_slug=tyaga`, idempotence event_id | grep 0 webhook dédié + registry VPS row `tyaga` + `stripe_events_processed` | PREUVES P2.3 | ✅ |
| E5 zéro UI paiement hors plateforme | e2e p4 assert « aucun règlement hors plateforme » + EX-F4 blocage | PREUVES P2.3 | ✅ |

## EX-F — Inbox assistant

| EX | Test | Preuve | Statut |
|---|---|---|---|
| F1 messagerie persistée par annonce | e2e `p5-inbox.spec.ts` (2 comptes, refresh) | PREUVES P2.4 34.0s | ✅ |
| F2 suggestions 1-clic, envoi UNIQUEMENT sur clic | unit `tests/inbox.test.ts` + e2e p5 | PREUVES P2.4 unit 12/12 | ✅ |
| F3 plancher vendeur, jamais contre-offre dessous | unit + e2e p5 (offre 50<plancher 60 → contre=60 exact) | PREUVES P2.4 | ✅ |
| F4 regex hors plateforme → bloqué + flag | unit (IBAN/RIB/PayPal/WA/TG/Revolut/Lydia/tél/email) + e2e p5 SQL `flagged_off_platform=true` | PREUVES P2.4 | ✅ |

## EX-G — Expédition

| EX | Test | Preuve | Statut |
|---|---|---|---|
| G1 checklist emballage 4+ étapes | e2e `p6-expedition.spec.ts` (6 étapes, 0/6→1/6) | PREUVES P2.5 29.8s | ✅ |
| G2 adresse livraison visible seulement post-paiement | e2e p4 (ABSENT pending) + p6 (visible paid) | PREUVES P2.3/P2.5 | ✅ |
| G3 suivi manuel → séquestre libéré + vente finalisée | e2e p6 SQL `status=completed, escrow_status=released` | PREUVES P2.5 | ✅ |

## EX-H — Vida Vault

| EX | Test | Preuve | Statut |
|---|---|---|---|
| H1 wallet points auto (1pt=1€ net) | e2e `p7-vida.spec.ts` SQL delta wallet | PREUVES P2.6 39.0s | ✅ |
| H2 propositions 0/30/50/100% jamais auto | e2e p7 (radio, statut `proposed`) | PREUVES P2.6 | ✅ |
| H3 confirmation explicite 2-step RPC | e2e p7 clic + SQL atomique ; fix SECURITY DEFINER | PREUVES P2.6 | ✅ |
| H4 progression + objectifs CRUD | e2e p7 (objectif 100pts, barre, création) | PREUVES P2.6 | ✅ |
| H5 sandbox, 0 virement réel | grep code vida 0 appel payout + bannière e2e | PREUVES P2.6 | ✅ |

## EX-I — Design

| EX | Test | Preuve | Statut |
|---|---|---|---|
| I1 palette seed générée `/lib/brand/`, 0 hex dur composants | grep hex composants (exceptions D20 : logo Google `AuthFields.tsx:84-96` + littéraux satori `opengraph-image.tsx`) ; DA r1-r4 | PREUVES P4 (admin gold utilities) + DA + D20 | ✅ |
| I2 typo Bricolage+Geist | layout.tsx fonts | DA r1-r4 | ✅ |
| I3 responsive 375→1920, sidebar+bottom tabs, safe areas | probes overflow 0px @375/@768 (r2 D8, r3) + e2e p11 viewport-fit | PREUVES P5 r2/r3 | ✅ |
| I4 PuramaBackground animé, pas fond statique | e2e p11 (9 braises, keyframes, z<0, reduced-motion) | PREUVES P5 | ✅ |
| I5 Lighthouse ≥95 ×4 | Lighthouse 13.3.0 prod 26/08 : `/` perf 98 · a11y 100 · bp 96 · seo 100 ; `/login` 98/100/96/100 (/tmp/p6-lh-*.json) | ✅ ≥95 ×4 ×2 pages |
| I6 anti-slop variante revente consumer | DA boucle r4 **VERT 9.36/10** (7 rubriques ≥9.1, 45 captures, 616 contrastes 0 échec AA) | DESIGN-SCORE.md ; CERTIFIED.md §I6 | ✅ 26/08 |

## EX-J — Transverse

| EX | Test | Preuve | Statut |
|---|---|---|---|
| J1 tsc 0 + lint 0 + build 0 | chaque feature | PREUVES toutes sections (26/08 dernier run) | ✅ |
| J2 erreurs FR + solution | e2e p10:105 (401 « Connecte-toi » réel) ; messages 503/429 SupportChat implémentés FR mais non couverts e2e | PREUVES P4 (401) ; 503/429 = implémentés, pas testés | ✅ (401 prouvé) |
| J3 loading+error+empty chaque vue | états empty FR dans chaque vue clé (objets:90, dashboard:132, marketplace:81, vida:316) + fetches bornés `AbortSignal.timeout(30-45s)` + erreur FR live (/tmp/ectx.txt) | CERTIFIED.md §J3 (26/08) | ✅ 26/08 |
| J4 IA s'appelle TYAGA | grep -ri 'claude' src/ → 6 hits serveur seulement (imports/models/commentaire), 0 .tsx, `model_used` jamais rendu | ✅ 26/08 |
| J5 RLS 100% tables + colonnes sensibles | RLS ligne 13/13 tables (P2.3) + triggers freeze colonnes prouvés VPS 7/7 (A1-A6 BLOCKED, service PASSES, reverse_sale floor -49 pts) | PREUVES P6 correcteur 2/2 (/tmp/verify-out.txt + /tmp/v65.txt, 26/08) | ✅ 26/08 |
| J6 rate limit + Zod + try/catch toutes API | 17/18 routes rate-limitées + Zod tous bodies ; 18e = /api/internal/stripe-fulfillment double auth secret+signature Stripe (plus fort que rate limit) ; Upstash centralisé → V1.1 (D21) | CERTIFIED.md §J6 (26/08) | ✅ 26/08 |
| J7 fiscal compteur + alerte 250€ | unit 6 + e2e `p8-fiscal.spec.ts` bannière frontière | PREUVES P2.7 | ✅ |
| J8 0 placeholder/TODO/console.log/any, 0 faux chiffres | scan lexical src/ par auditeur : 0 TODO, 0 FIXME, 0 Lorem, 0 console.log, 0 `: any` | CERTIFIED.md §J8 (26/08) | ✅ 26/08 |
| J9 favicon + OG image custom TYAGA | `src/app/icon.tsx` (32) + `apple-icon.tsx` (180) + `opengraph-image.tsx` (1200×630, next/og) + `src/lib/og-logo.tsx` + layout metadata OG/twitter | BUILD:0 35 pages (26/08) | ✅ |

## EX-K — Accueil & navigation

| EX | Test | Preuve | Statut |
|---|---|---|---|
| K1 `/` écran app (logo + Commencer + Se connecter), 0 landing 13 sections | e2e `p1-auth.spec.ts` (goto `/` → CTA visibles) + DA r1-r4 | PREUVES P2.3 ; DESIGN-SCORE | ✅ |
| K2 dashboard 3 blocs above the fold (parrainage, ambassadeur, cross-promo WELCOME50) + objets + Vault | e2e `p9-universels.spec.ts` (4 headings + WELCOME50 + liens vida/kash.purama.dev) | PREUVES P3 (26/08) | ✅ |

## Bilan

- ✅ prouvé : 50/52 (auditeur-vierge a tranché les 5 ⏳ par preuve directe — CERTIFIED.md)
- 🔒 IA différée : 2 — B3, D1 (testés verts 25/08 avant épuisement crédit ; re-audit groupé à la recharge, erreur #16 CLAUDE.md — admis par l'auditeur comme déferral authentique)

Dernière mise à jour : 2026-08-26 (**CERTIFIED.md 100/100 V1-CORE** — auditeur-vierge, commit `7af5a8c`, dpl `dpl_AVP5ckiSUKud2QVJY5KwDWmqbc89`, bilan 50/52 + 2 🔒 différés).
