# DESIGN-SCORE.md — TYAGA (audit DA, contexte vierge)

Date : 2026-08-26 · Méthode : build `next build` + `next start -p 3199`, captures Playwright 3 viewports × 5 pages (DSF 2), jugé sur pixels vus, jamais sur le code.

Captures : `/tmp/tyaga-da/<viewport>-<page>.png` (mobile-375 / tablet-768 / desktop-1280 × login, dashboard, vida, marketplace, scan).

## 1. Grille des scores (0-10)

| Page | R1 Identité | R2 Anti-slop | R3 Lisibilité | R4 Tokens | R5 Responsive | R6 Boucle | R7 Finitions |
|---|---|---|---|---|---|---|---|
| login mobile | 9.5 | 9 | 9.5 | 9 | 8.5 | 8.5 | 9 |
| login tablet | 9.5 | 9 | 9.5 | 9 | 9 | 8.5 | 9 |
| login desktop | 9.5 | 9.5 | 9.5 | 9 | 9 | 9 | 9.5 |
| dashboard mobile | 9.5 | 9 | 9 | 9 | 9 | 9.5 | 8 |
| dashboard tablet | 9 | 8.5 | 9 | 9 | 8.5 | 9.5 | 8.5 |
| dashboard desktop | 9.5 | 9.5 | 9.5 | 9.5 | 9.5 | 9.5 | 9 |
| vida mobile | 8.5 | 8.5 | 8.5 | 8.5 | **4** | 7.5 | 6 |
| vida tablet | 8.5 | 8.5 | 8.5 | 8.5 | **4.5** | 7.5 | 6 |
| vida desktop | 8.5 | 8.5 | 9 | 9 | 8.5 | 8 | 7 |
| marketplace mobile | 9 | 9 | 9 | 9 | 9 | 7.5 | 9 |
| marketplace tablet | 9 | 9 | 9 | 9 | 9 | 7.5 | 9 |
| marketplace desktop | 9 | 9 | 9 | 9 | 9 | 7.5 | 9 |
| scan mobile | 9 | 9 | 9.5 | 9 | 9 | 7.5 | 9 |
| scan tablet | 9 | 9 | 9.5 | 9 | 9 | 7.5 | 9 |
| scan desktop | 9 | 9 | 9.5 | 9 | 9.5 | 8 | 9.5 |

## 2. Moyennes par rubrique

| R1 Identité mémorable | R2 Anti-slop | R3 Lisibilité & hiérarchie | R4 Cohérence tokens | R5 Responsive 375→1280 | R6 Signature « La Boucle » | R7 Finitions |
|---|---|---|---|---|---|---|
| **9.07** | **8.93** | **9.17** | **8.97** | **8.33** | **8.20** | **8.43** |

**Moyenne globale : 8.73/10**

## 3. Ce qui est vu et tenu

- Identité chaude (braise/corail sur `#0A0A0F`) immédiatement distincte du violet Purama par défaut — n'importe quel cliché IA (crème+serif, noir+vert acide, journal hairlines) est évité. Logo anneau + braise lu sur les 5 pages.
- Login desktop tient en 1 écran (2560×1800 @2x = exactement le viewport) : carte glass centrée, hiérarchie display Bricolage → corps Geist → prix mono tenue partout.
- Dashboard desktop : sidebar 280px + carte Vault avec anneau de progression et braises visibles, densité pro, zéro scroll. Mobile : bottom tabs 5 avec scanner central proéminent — conforme au DESIGN-PLAN §3.
- Scan : stepper minimal, 1 action par écran, tenu sur les 3 viewports.
- Marketplace : cards photo-first ratio 4:5, badge état, prix nets Geist Mono corail — la promesse Vinted × Back Market est tenue.
- Contrastes : muted sur `#0A0A0F` largement AA, prix corail sur glass lisibles.

## 4. Défauts — précis, actionnables

| # | Fichier / élément | Défaut vu | Correction proposée |
|---|---|---|---|
| D1 | `src/app/(dashboard)/vida/page.tsx` — bloc large (historique transferts ou anneau) | **Overflow horizontal mobile** : capture 926px @2x = 463px CSS vs 375px viewport → 88px de contenu tronqué à droite | Ajouter `min-w-0` sur tous les enfants de chaînes flex ; wrapper la liste historique dans `overflow-x-auto` ; chasser toute largeur fixe `w-[…]` > 343px (375 − 2×16 padding) |
| D2 | `src/app/(dashboard)/vida/page.tsx` — même bloc | **Overflow horizontal tablette** : 1634px @2x = 817px CSS vs 768px → 49px tronqués. Même cause que D1, se manifeste jusqu'à ≥768px | Même fix que D1 ; vérifier à 768 et 834 après patch |
| D3 | `src/app/(dashboard)/vida/page.tsx` — structure globale | Page-colonne unique de 2324px (mobile) / 3096px (tablette) / 2648px (desktop) : rythme qui traîne, objectifs ET historique empilés même à 1280px | Desktop : `lg:grid-cols-[1fr_400px]` — objectifs à gauche, solde + historique à droite ; resserrer les gaps verticaux (`space-y` réduit d'un cran) |
| D4 | `src/app/(dashboard)/vida/page.tsx` — header objectif | **La Boucle absente de LA page objectif Vida** : barres de progression plates, pas d'anneau, pas de braises — la signature vit seulement sur /dashboard | Reprendre le même composant anneau + braises (celui de la carte Vault du dashboard) autour de l'objectif principal ; `prefers-reduced-motion` → statique |
| D5 | `src/app/(dashboard)/dashboard/page.tsx` — pile promo | Dashboard mobile = 3598px CSS de scroll : parrainage + ambassadeur + VIDA empilés en full-width, respiration excessive en bas de page | Regrouper parrainage / ambassadeur / cross-promo VIDA en 1 carrousel horizontal scroll-snap (cards 280px) ou 1 section à onglets ; viser < 2600px |
| D6 | `src/app/(auth)/login/page.tsx` — fond | Signature portée uniquement par le glow radial sur login/marketplace/scan (R6 = 7.5) : la 1re seconde d'app ne montre pas encore « La Boucle » | Sur login : 3-4 braises montantes discrètes (particules CSS absolute, opacité ≤ 0.5, derrière la carte) pour asseoir la signature dès l'arrivée. Chanel rule respectée : rien d'autre d'ajouté |
| D7 | `src/app/(dashboard)/dashboard/page.tsx` — grille tablette | À 768px le dashboard reste un empilement mobile étiré (R5 8.5) : cartes full-width, aucune colonne | Passer les blocs Vault/Scanner en 2 colonnes dès `sm:` (640-1024px) |

Aucun défaut de contraste bloquant, aucun emoji-icône vu, aucun hex visiblement hors-système, aucun des 3 looks interdits.

## 5. Verdict

Rubriques sous 9 : R5 (8.33, tirée par vida mobile 4 / vida tablet 4.5), R6 (8.20), R7 (8.43) — plus R2 à 8.93.

**BOUCLE: CONTINUER**

Conditions du vert : D1+D2 (overflows vida) corrigés et re-capturés à 375/768, D3 (layout 2 colonnes vida desktop), D4 (anneau La Boucle sur /vida), D5 (réduction pile promo dashboard mobile). D6/D7 recommandés.
