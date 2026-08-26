# task_plan.md — TYAGA (P0→P8)

> Phases cochables ✅/❌ — update APRÈS CHAQUE feature. Référentiel : SPEC.md (EX-ID).

## P0 — Setup & fondations ✅
- [x] Lire BRIEF 3× + docs autorités
- [x] Décision §5 bloquante → Option C (STATUS.md, confirmée Tissma 2026-08-24)
- [x] git init repo dédié local (D5)
- [x] .gitignore (env jamais tracké)
- [x] STATUS.md · DECISIONS.md (D1-D16) · SPEC.md (EX-A→EX-K + matrice) · DESIGN-PLAN.md
- [x] task_plan.md · ERRORS.md · PATTERNS.md · schema.sql · V1.1-BACKLOG.md
- [x] MANAS/apps/tyaga.md + ligne INDEX.md
- [x] Premier commit local

## P1 — Scaffold + design system + DB + auth ✅
- [x] Next.js 15 + React 19 + TS strict + Tailwind + eslint local (0 dep runtime @purama/*)
- [x] /lib/brand/ : parseSeed xmur3 + palette warmth-community-tyaga + fonts (Bricolage+Geist) — 0 hex dur
- [x] Schéma `tyaga` sur VPS (SSH vérifié AVANT) : tables + RLS + trigger profile + bucket `tyaga-photos`
- [x] .env.local (monorepo §5 + .env.secrets — jamais tracké)
- [x] Auth email + Google OAuth EN VRAI (VPS: GOTRUE_EXTERNAL_GOOGLE_ENABLED + URI_ALLOW_LIST + restart AVANT test)
- [x] Middleware (dashboard→login?next=) + signOut+clear+redirect
- [x] Deploy preview Vercel CLI + DNS tyaga.purama.dev

## P2 — Features core V1 (1/1, testée, déployée) ⏳
- [x] P2.1 Scan 3 photos + IA vision sonnet-4-6 (/api/scan) — EX-B ✅
- [x] P2.2 Estimation + net commission serveur (/api/estimate) — EX-C ✅ (6/6 e2e, 10 rows SQL pct=10 net exact, append-only prouvé)
- [x] P2.3 Annonce assistée (/api/annonces/generate) + publication marketplace C + Stripe Connect webhook partagé + export texte filet B — EX-D/E ✅ (p4 e2e 1/1: publish→achat→checkout Stripe live→pending→cancel; matrice RLS 13/13 VERT cf PREUVES.md; tsc 0 build 0; unit 5/5)
- [x] P2.4 Inbox assistant + anti-fraude (1-clic jamais auto, plancher, regex hors plateforme) — EX-F ✅ (unit 17/17, e2e p5 1/1 34s, flagged_off_platform SQL prouvé — PREUVES.md)
- [x] P2.5 Expédition guidée (checklist, adresse post-paiement, statuts manuels) — EX-G ✅ (e2e p6 1/1 29.8s : checklist 6 étapes, adresse post-paiement, expédié→reçu→completed+released SQL — PREUVES.md)
- [x] P2.6 Vida Vault sandbox (points 1pt=1€, 0/30/50/100%, objectifs CRUD) — EX-H ✅ (e2e p7 1/1 39s : points crédités SQL, proposition 50%, confirmation explicite 2-step, progression + wallet débité/objectif crédité SQL ; grep 0 appel virement ; unit 22/22 — PREUVES.md)
- [x] Fiscal compteur + alerte 250€ — EX-J7 ✅ (lib fiscal + FiscalCounter dashboard, unit 6 + e2e p8 1/1 bannière ≥250€)

## P3 — Universels ✅
- [x] Parrainage V4 (N1=50% + carte à vie)
- [x] Cross-promo VIDA/KASH WELCOME50 (bloc accueil)
- [x] Ambassadeur
- [x] Solde Vault + 4 blocs above the fold (EX-K2)

## P4 — Admin + Aide + FAQ ✅
- [x] /admin (super-admin gold) : users, commandes, litiges, logs — gate serveur email canonique OU `profiles.is_super_admin` (e2e via flag, jamais le compte réel), lecture seule V1, stats (utilisateurs/commandes/ventes/litiges) + tables récentes + logs Stripe, or via `--super-admin-gold` + utilities
- [x] /aide + FAQ + chatbot SAV — 6 catégories accordéon natif (0 JS), SupportChat haiku-4-5 (auth+rate 20/h+Zod+historique 6 tours+503 FR contact humain), contact mailto visible

## P5 — Design polish ✅
- [x] DA boucle ≥9/10 — r4 **VERT 9.36/10** (7 rubriques ≥9.1, DESIGN-SCORE.md, 3 viewports ×5 pages ; D11-bis contraste composite 5.11:1 min ; D12/D13 résidus non bloquants → V1.1 polish)
- [x] EX-I4 PuramaBackground fond animé (braises CSS, reduced-motion → statique)
- [x] La Boucle signature (anneau progression Vida + braise framer-motion spring, reduced-motion → statique)
- [x] EX-I3 safe areas iOS (viewport-fit cover + env(safe-area-inset-bottom)) — i18n 16 langues → V1.1-BACKLOG (D19)

## P6 — QA + certification ✅
- [x] Playwright — non-IA 100% pass (p1 4/4, p5, p8, p9 2/2, p10 3/3) ; 3 échecs p4/p6/p7 tous au même step IA (crédit Anthropic épuisé — vérifié live par auditeur : `"Your credit balance is too low"`, erreur #16) → re-run groupé à la recharge
- [x] Lighthouse ≥95 ×4 — `/` 98/100/96/100 · `/login` 98/100/96/100 (26/08)
- [x] Correcteur queue juridique — F19 pages légales 5 routes BUILD:0 + F20 liens + IA Act (UI×2 + CGU §3) + WELCOME50 lexique + CONFORMITE.md **VERT** + J9 favicon/OG 4 fichiers
- [x] jury-securite 0 critical + jury-bugs + jury-tests + inspecteur-pixel/juridique — batch 1 juries (juridique+tests) + batch 2 correcteur (RLS colonnes triggers freeze **VPS 7/7** + 9 fixes code + pixel 7/7) ; auditeur-vierge a tout re-vérifié sur preuves
- [x] CERTIFIED.md (auditeur-vierge) — **100/100 V1-CORE** (50/52 EX prouvés par preuves propres + 2 🔒 IA différés admis ; commit `7af5a8c`, dpl `dpl_AVP5ckiSUKud2QVJY5KwDWmqbc89`)

## P7 — Mobile ⏸ post feu vert (stores = action externe, Pilier 26 vague)
- [ ] Expo + EAS + stores (dev.purama.tyaga) — post feu vert Tissma

## P8 — Surveillance ✅
- [x] AGNI remontée statut + CONFORMITE.md — ingest 26/08 : tyaga `certified=t · conformite=t · launch_eligible=t` ; écosystème 6 certifiées → `launch_ready=true` (Pilier 26) ; dashboard.html régénéré ; CONFORMITE.md VERT (`19b45b22f53f`)

---
## Journal
- 2026-08-24 — P0 terminé. Option C confirmée par Tissma. 0 code, docs complets.
- 2026-08-25 — P1 ✅ (scaffold+DB+auth+deploy preview). P2.1/P2.2 ✅. P2.3 EX-D+EX-E ✅ : e2e p4 (achat→checkout live→annulation), matrice RLS 13/13 VERT (PREUVES.md), karma registry `tyaga` branché. **Deploy PROD** ✅ `https://tyaga.purama.dev` (dpl_Ue2SZFpkVBoUAp4EDC79iJcdnHAN, 11 env vars, smoke / 200 · /login 200 · /marketplace 307→login).
- 2026-08-25 — P2.4 EX-F ✅ : inbox temps réel (poll 5s) + suggestions 1-clic (jamais auto) + plancher vendeur (refus poli sous plancher, contre = plancher exact) + regex anti-hors-plateforme (IBAN/RIB/PayPal/WhatsApp/Telegram/Revolut/Lydia/tél/email) message bloqué + `flagged_off_platform`. Unit 17/17 · tsc 0 · e2e p5 1/1 (34s, 2 comptes, preuve SQL PostgREST).
- 2026-08-25 — P2.5 EX-G ✅ : checklist emballage 6 étapes (localStorage par commande, vendeur payée uniquement) + adresse livraison vend. post-paiement + suivi manuel expédié/reçu → completed + séquestre released (ventes + Connect via finalize). e2e p6 1/1 (29.8s, paiement simulé service rôle webhook, preuve SQL PostgREST) · tsc 0 · build 0 · unit 17/17.
- 2026-08-25 — P2.6 EX-H ✅ : Vida Vault sandbox — wallet points auto (trigger+credit_wallet via finalize), propositions 0/30/50/100 % jamais auto, confirmation explicite 2-step RPC `confirm_transfer` (SECURITY DEFINER après fix RLS : wallet sans policy UPDATE volontaire), objectifs CRUD + progression, bannière sandbox permanente. e2e p7 1/1 (39s, SQL deltas wallet/objectif) · grep 0 appel virement · tsc 0 · build 0 · unit 22/22. P2 core = 6/6 features B→H.
- 2026-08-26 — P2.7 EX-J7 ✅ : compteur revenus nets annuels /dashboard (requête ventes, D14 zéro table dédiée) + bannière alerte dès 250 € nets cumulés (`>=`, progressbar → alert). Unit 28/28 (6 fiscal) · e2e p8 1/1 (7.2s, PATCH service 300 € nets déterministe, bannière+montant+barre masquée) · tsc 0 · build 0. **P2 7/7 features B→J terminé.** Prochain : P3 Universels.
- 2026-08-26 — P3 ✅ EX-K2 + Parrainage V4 : 4 blocs above the fold /dashboard (parrainage code `TY-XXXXXX` copiable, ambassadeur, cross-promo VIDA/KASH WELCOME50, solde Vault). Boucle parrainage complète : `profiles.referral_code` (trigger+RPC `ensure_referral_code`), `/signup?ref=` → sessionStorage → `ReferralAttach` → POST `/api/referral/attach` → RPC `attach_referral` (self/already/invalid), N1 = `payReferralN1` 50% commission en points Vault branché `finalizeCompletedSale` (flag `commission_paid`, jamais bloquant). Unit 33/33 (5 referral) · e2e p9 2/2 (15.1s : blocs + rattachement filleul → compteur 1 + garde self) · tsc 0. Prochain : P4 Admin+Aide.
- 2026-08-26 — P4 ✅ Admin+Aide : `/admin` God Mode lecture seule (gate serveur `isSuperAdmin(email) || profiles.is_super_admin`, e2e via PATCH flag — compte réel jamais créé/connecté ; stats count + 10 dernières lignes users/commandes/ventes/litiges `flagged_off_platform`/logs `stripe_events_processed` ; or `--super-admin-gold` + `.text-gold/.border-gold/.bg-gold-soft`, 0 hex dur composant). `/aide` : FAQ 6 catégories 16 entrées accordéon natif + SupportChat (`/api/ai/support` : auth 401 FR, rate 20/h/user 429 FR, Zod, haiku-4-5 max 400 tok timeout 20 s, historique 6 tours client+serveur, 503 FR → hello@tyaga.purama.dev) + carte contact humain. Nav : Aide sidebar-only + icône header mobile (bottom tabs restent 7). e2e p10 3/3 (13.0s : rendu /aide, 401 API, gate non-admin→dashboard / flag→God Mode or / flag off→dashboard) · tsc 0 · build 0 · unit 33/33. **Deploy PROD** ✅ `dpl_29dCsu45957nKHzhertqGXTMSiav` (smoke : / 200 · /login 200 · /aide 307→login · /admin 307→login). Docs : PREUVES P4 · D18 · MANAS · PIEGES ×2. Prochain : P5 Design+i18n.
- 2026-08-26 — **P5 ✅** Design polish : DA boucle r1→r4 **VERT 9.36/10** (7 rubriques ≥9.1, 5 pages × 3 viewports, DESIGN-SCORE.md). Fix D11-bis contraste composite (probe v2 plein-DOM min 5.11:1 / 50 badges, `lightenUntilTintedAa` palette.ts). Lighthouse 13.3.0 prod ≥95 ×4 ×2 pages (EX-I5 : `/` 98/100/96/100 · `/login` 98/100/96/100). i18n 16 langues → V1.1 (D19). MATRICE.md créée 47 EX. Prochain : P6 juries.
- 2026-08-26 — P6 correcteur queue juridique ✅ : **F19** pages légales 5 routes (`/legal` index+CGU 13 sections+CGV+mentions+polconf 7 sections RGPD, LegalShell), liens d'accès signup/aide/accueil **F20**. Fix build 61× `react/no-unescaped-entities` + piège **perl -CSD -pi double-encodage** (56 séquences réparées python3 bytes — ERRORS + PIEGES.md). **AI Act art. 50** triple disclosure : SupportChat:60-63 + scan:278 + CGU §3 (ajouté). WELCOME50 = cross-promo sœurs (0 lexique interdit, 0 faux chiffres). **J9** favicon/OG : `icon.tsx`+`apple-icon.tsx`+`opengraph-image.tsx` (next/og 1200×630)+`og-logo.tsx`+layout metadata. e2e p1 fix `clearCookies` (piège GOTRUE autoconfirm → redirect /dashboard) **4/4**. **CONFORMITE.md VERT** (Pilier 19, 7 sections, `19b45b22f53f`). tsc 0 · build 0 (35 pages). MATRICE 52 EX : 44 ✅ / 6 ⏳ / 2 🔒.
- 2026-08-26 — **P6 ✅ CERTIFIÉ** batch 2 : juries sécu/bugs/tests/pixel (correcteur 2/2) : **RLS colonnes sensibles** — triggers freeze `tg_orders_freeze`/`tg_transfers_freeze`/`tg_profiles_freeze`/`tg_referrals_freeze` (BEFORE UPDATE si `auth.uid() IS NOT NULL`, bypass GUC `app.tyaga_srv`) **prouvé VPS 7/7** (A1-A6 BLOCKED client / service PASSES / reverse_sale floor −49 pts → 4950c). 9 fixes code : acceptation périmée `acceptIdx < offerIdx` (orders), TOCTOU 23505→409 + finalize idempotente, refund fail-closed `app_slug=tyaga`, sniffImageType magic bytes, formatEuros **floor** jamais round (24 999c → « 249 € » jamais « 250 € » avant l'alerte), admin annonce_id, W.CAG tap 44px. Pixel 7/7. ERRORS.md +6 · PREUVES correcteur 2/2 · DECISIONS **D21** (Upstash → V1.1). tsc 0 · lint 0 · build 0 · unit 37/37. Commit `7af5a8c` → deploy prod `dpl_AVP5ckiSUKud2QVJY5KwDWmqbc89` (BUILD:0 35 pages, smoke 5/5 200). **auditeur-vierge → CERTIFIED.md 100/100 V1-CORE** (re-exécuté tsc/lint/unit/build par lui-même, 50/52 EX par preuves propres, 5 ⏳ tranchés VERTS C5/I6/J3/J6/J8, E4 registry webhook VPS live, crédit IA vérifié épuisé en direct → déferral authentique). MATRICE **50/52 + 2 🔒**. Risques résiduels documentés non bloquants : premier paiement Stripe réel = première exécution live webhook partagé (stripe_events_processed=0) ; error.tsx/not-found.tsx globaux → V1.1 ; re-audit B3/D1 + e2e à la recharge crédit ; Upstash au multi-instance.
