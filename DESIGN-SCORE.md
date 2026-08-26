# DESIGN-SCORE — TYAGA (Round 4, DA VEGA §9.4)

> Date : 2026-08-26 · Build prod `next start` sur http://localhost:3199 · Méthode : Playwright (chromium) 5 pages × 3 viewports (375×720, 768×1024, 1440×900) · Audit DOM (getComputedStyle/getBoundingClientRect sur 15 rendus) + **contraste calculé sur pixels réels des PNG composites** (616 éléments texte — la couche glass rgba et les teintes /15|20 sont donc incluses d'office, aucune approximation théorique). Rendu image DA indisponible ce round (outil Read → CDN) → jugé sur mesures DOM+pixel exhaustives, méthode identique aux rounds 2-3 (validée).
> Note méthode : /login visité en état authentifié redirige vers /dashboard — captures login refaites en contexte **déconnecté** (state.json ignoré), c'est le vrai écran login qui est noté.

## Verdict

**BOUCLE: VERT** — Moyenne **9.36/10**, les 7 rubriques ≥ 9. D11 (round 3) vérifié résolu sur le pixel. 2 résidus mineurs non bloquants (D12, D13), tous deux conformes WCAG, listés pour polish.

## Captures (15 + 15 vp)

`/tmp/da-r4/final-{home,login,dashboard,vida,marketplace}-{375,768,1440}.png` (fullPage) et `/tmp/da-r4/{page}-{vp}.png` + `*-vp.png` (above-the-fold). Données : `/tmp/da-r4/dom.json`, `/tmp/da-r4/contrast.json`.

## Historique rounds

| Rubrique (r4) | r1 | r2 | r3 | **r4** |
|---|---|---|---|---|
| R1 identité & signature | 7.8 | 8.9 | 9.4 | **9.4** |
| R2 lisibilité & contraste | 7.2 | 8.1 | 8.9 | **9.2** |
| R3 hiérarchie & typo | 8.0 | 9.0 | 9.5 | **9.5** |
| R4 layout & espacement | 7.5 | 8.8 | 9.5 | **9.3** |
| R5 responsive & mobile | 7.0 | 8.6 | 9.3 | **9.1** |
| R6 feedback & états | 8.2 | 9.3 | 10 | **9.6** |
| R7 cohérence système | 7.6 | 8.7 | 9.2 | **9.4** |

*(r3 avait des intitulés différents — projection sur les 7 rubriques r4 ; la table r4 est la référence.)*

## Rubriques r4 — preuves mesurées

| # | Rubrique | Note | Ce que je vois (mesures) |
|---|---|---|---|
| R1 | Identité & signature | **9.4** | Fond `#0A0A0F` exact (html+body) + **9 braises radiales animées** (span.braise, radial-gradient corail/or) sur les 5 pages — fond vivant, pas statique, pas un dégradé-cliché. **La Boucle** : 5 rendus sur /vida (aria-label chiffrée) + 10 arcs SVG ; thèse « l'objet devient braise qui alimente l'objectif » tenue. Home = écran APP (H1 « TYAGA » 36px Bricolage Grotesque + tagline + 2 CTA pill, tient above-the-fold : fullPage == viewport). Paire typo Bricolage/Geist/Geist Mono : 0 collision. Palette corail `#DD804B` + crème `#FEF3C7` générée — ≠ des 3 clichés interdits (aucune serif, pas de vert acide/vermillon, radius {16, 24, pill}). |
| R2 | Lisibilité & contraste | **9.2** | **616 éléments texte mesurés sur pixel composite : 0 échec AA**. Min par page : vida 4.64:1, dashboard 5.24:1, home/login 6.77:1, marketplace 11.47-15.75:1. D11 vérifié résolu : badges « 1 filleul »/« Actif » (ex-4.35:1) → **5.24:1** mesuré (fg éclairci #E29265). Résidu D12 : badge « Confirmé » /vida à **4.64:1** — passe AA (+0.14) mais marge mince, cf. défauts. |
| R3 | Hiérarchie & typo | **9.5** | Échelle observée {12, 14, 16, 18, 20, 24, 30, 36}px stricte sur 15 rendus — 3 familles exactement (Bricolage display 30/36px fw 600, Geist body 14px dominant, Geist Mono réservé chiffres/prix). H1 30px + H2 20px fw 600 sur chaque page authée (dashboard 4 headings, vida 4, marketplace cards photo-first prix mono). lh 1.5, ls négatifs sur display. Aucune taille or-échelle détectée. |
| R4 | Layout & espacement | **9.3** | Marketplace 1440 : grille 3 colonnes nettes (left edges 20/589/981, 24+24 textes alignés) ; dashboard colonnes ~350px (20/373/722/1072) ; rythme vertical /vida : gaps médian 12px, p90 34px, max 60px — dense-maîtrisé, ni tassement ni vide gratuit. Cards photo-first ratio tenu, 16/16 photos chargées (storage Supabase, pas d'images de placeholder). Vida : colonne latérale à edges multiples (901/905/943/973) = nesting cards, pas un défaut de grille. |
| R5 | Responsive & mobile | **9.1** | `scrollWidth == clientWidth` sur les **15 rendus** (0 overflow 375/768/1440), 0 élément hors-écran. Radios 13×13 wrappés dans labels cliquables 261×78 (zone tactile réelle conforme). CTA « Commencer » 448×48 (375 : 327×48), submit login 261×48, bottom nav r3 52×44 toujours en place. Résidu D13 : 2 boutons copier 36×36 + 2 liens login 38-40px < 44px spec interne (≥24px WCAG 2.5.8 → conformité légal tenue, écart au standard maison DESIGN-PLAN §6). |
| R6 | Feedback & états | **9.6** | Focus-visible : outline **2px solid #E29265** sur input login ; **0 focusable sans style sur 84 testés** (dashboard 24, vida 30, marketplace 30). Hover submit : scale 1.01 (transform mesuré `matrix(1.01,…)`), 23-43 éléments transitionnés par page. Flux IA (scan/annonce/chat) en état d'attente documenté — non pénalisé (crédit API, connu). (10 en r3 tenu sur tout ce qui est mesurable ce round.) |
| R7 | Cohérence système | **9.4** | tokens tenus partout : bg `#0A0A0F`, fg `#F5F5FA` + opacités {.55/.78} uniquement, accents {#DD804B, #E29265, #FEF3C7} + on-primary #1A0D05 ; radii conteneurs exclusivement {16px, 24px, pill} (dashboard 6×24+5 pill, marketplace 32×24, vida 13×16+6×24) — zéro radius arbitraire ; CTA tous pill plein #DD804B (pas de gradient background, conforme au plan anti-cliché). 0 hex en dur détecté dans l'UI (palette générée). |

**Moyenne : 9.36/10 — VERT (min 9.1).**

## Défauts résolus ce round

- **D11 (r3, badges teintés 4.35:1)** — RÉSOLU, vérifié sur pixel composite : « 1 filleul » et « Actif » /dashboard passent à **5.24:1** (fg `--primary-on-dark` éclairci #E29265). Le fix palette couvre le pattern sur dashboard/login.

## Défauts restants (mineurs, non bloquants — tous ≥9 donc VERT)

- **D12 (marge AA mince, 1 occurrence)** : badge « Confirmé » /vida — `src/app/(dashboard)/vida/page.tsx:255` utilise `bg-primary/15 text-primary` (fg #DD804B **brut**, pas la variante éclairci du fix D11) → **4.64:1**. Passe AA de +0.14 seulement. Fix 1 classe : `text-primary` → `text-primary-on-dark` (même ligne), attendu ~5.2:1. (Les autres badges vida « Annulé »/« En attente » passent largement.)
- **D13 (tactile < spec interne 44px, ≥24px WCAG OK)** : boutons « Copier mon code de parrainage » et « Copier le code WELCOME50 » /dashboard à **36×36** ; liens « Mot de passe oublié » (97×40) et « Créer un compte » (145×38) /login. Fix : padding +4px (p-2→p-2.5 ou h-9→h-11) sur les 2 boutons icône ; les liens texte peuvent rester (zone ≥24px + texte long = cible réelle large).

## À garder (preuves)

- **0 échec AA sur 616 textes mesurés en pixel composite** (glass + teintes incluses) — R2 tient.
- **Overflow 0px sur 15 rendus** — D8 tient depuis r2.
- **Braises ×9 + La Boucle ×5** — signature mémorable vivante sur tout l'app shell, reduced-motion géré (r3).
- **CTA plein #DD804B + #1A0D05 = 6.58:1** — D9/D10 tiennent.
- **3 typos / 3 radii / 5 couleurs fg** — discipline de système rare.
- **Données réelles** (16 photos storage, filleul TY-8E77B5, points chiffrés) — 0 Lorem, 0 vide factice.

**BOUCLE: VERT** — certification design VEGA §9.4 acquise. D12/D13 à traiter en polish (aucun ne rouvre la boucle).
