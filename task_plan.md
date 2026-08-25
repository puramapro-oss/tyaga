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
- [ ] P2.6 Vida Vault sandbox (points 1pt=1€, 0/30/50/100%, objectifs CRUD) — EX-H
- [ ] Fiscal compteur + alerte 250€ — EX-J7

## P3 — Universels ❌
- [ ] Parrainage V4 (N1=50% + carte à vie)
- [ ] Cross-promo VIDA/KASH WELCOME50 (bloc accueil)
- [ ] Ambassadeur

## P4 — Admin + Aide + FAQ ❌
- [ ] /admin (super-admin gold) : users, commandes, litiges, logs
- [ ] /aide + FAQ + chatbot SAV

## P5 — Design polish + i18n ❌
- [ ] DA boucle ≥9/10 (DESIGN-SCORE.md, 3 viewports)
- [ ] Animations (La Boucle signature, reduced-motion) + i18n 16 langues

## P6 — QA + certification ❌
- [ ] Playwright 100% SPEC (matrice traçabilité EX→preuve)
- [ ] Lighthouse ≥95 ×4
- [ ] jury-securite 0 critical + jury-bugs + jury-tests + inspecteur-pixel/juridique
- [ ] CERTIFIED.md (auditeur-vierge)

## P7 — Mobile ❌
- [ ] Expo + EAS + stores (dev.purama.tyaga) — post feu vert

## P8 — Surveillance ❌
- [ ] AGNI remontée statut + CONFORMITE.md

---
## Journal
- 2026-08-24 — P0 terminé. Option C confirmée par Tissma. 0 code, docs complets.
- 2026-08-25 — P1 ✅ (scaffold+DB+auth+deploy preview). P2.1/P2.2 ✅. P2.3 EX-D+EX-E ✅ : e2e p4 (achat→checkout live→annulation), matrice RLS 13/13 VERT (PREUVES.md), karma registry `tyaga` branché. **Deploy PROD** ✅ `https://tyaga.purama.dev` (dpl_Ue2SZFpkVBoUAp4EDC79iJcdnHAN, 11 env vars, smoke / 200 · /login 200 · /marketplace 307→login).
- 2026-08-25 — P2.4 EX-F ✅ : inbox temps réel (poll 5s) + suggestions 1-clic (jamais auto) + plancher vendeur (refus poli sous plancher, contre = plancher exact) + regex anti-hors-plateforme (IBAN/RIB/PayPal/WhatsApp/Telegram/Revolut/Lydia/tél/email) message bloqué + `flagged_off_platform`. Unit 17/17 · tsc 0 · e2e p5 1/1 (34s, 2 comptes, preuve SQL PostgREST).
- 2026-08-25 — P2.5 EX-G ✅ : checklist emballage 6 étapes (localStorage par commande, vendeur payée uniquement) + adresse livraison vend. post-paiement + suivi manuel expédié/reçu → completed + séquestre released (ventes + Connect via finalize). e2e p6 1/1 (29.8s, paiement simulé service rôle webhook, preuve SQL PostgREST) · tsc 0 · build 0 · unit 17/17.
