# TYAGA — DESIGN-SCORE.md (Round 2 — 2026-08-26)

Directeur artistique VEGA (Pilier 9.4), contexte vierge, juge l'écran rendu.
Méthode : serveur `next start -p 3199`, compte e2e `tyaga-e2e@purama-test.dev` (données Vida + historique), 5 pages × 3 viewports (375×720, 768×1024, 1440×900), captures full-page dans `/tmp/da-r2/` + audit DOM/piixels (styles calculés, ratios de contraste WCAG, chaînes d'overflow, tokens résolus). Fonctionnalités IA non pénalisées (crédit API épuisé, annoncé).

**Captures** : `login-{m375,t768,d1440}.png`, `dashboard-{…}.png`, `vida-{…}.png`, `marketplace-{…}.png`, `aide-{…}.png` (dans `/tmp/da-r2/`). Preuves machine : `/tmp/da-r2/audit.json`, `/tmp/da-r2/overflow-report.json`, `/tmp/da-r2/audit2.out`.

---

## Fixations Round 1 vérifiées

| Déffect R1 | Verdict R2 | Preuve |
|---|---|---|
| D1 overflow ObjectifCard | CORRIGÉ | `/dashboard-m375` scrollW 375 = clientW 375 ; débordements restants = cartes snap-carousel `min-w-[280px]` volontaires |
| D2 /vida 2 colonnes mobile | CORRIGÉ | grids `/vida-m375` = 1 colonne (piste 303px) |
| D3 vedette anneau « La Boucle » | CORRIGÉ | « LA BOUCLE — OBJECTIF EN TÊTE » présent + anneau SVG 128px, 4 cercles de progression, à 375 ET 1440 |
| D6 braises /login | NON RE-FLAGGÉ | keyframes `braise-rise` actives + spans braises animés 3-6px (y:217-580) |
| D4, D5, D7 | CORRIGÉS visuellement | carousel promo snap OK @375 ; Vault/Fiscal 2×200px seulement @768 ; aucun débordement 768 |

---

## Notes R1-R7

| # | Rubrique | Mini | Maxi | Moyenne | Observations (ce que je vois) |
|---|---|---|---|---|---|
| R1 | Écran accueil/login | 5 | 5 | **5.0** | Carte glass 327px @375 / 448px centrée (x:160) @768, H1 24px Bricolage Grotesque ls -0.6px, braises animées = signature vivante. MAIS le CTA « Se connecter » a son label **invisible** : color=fill=bg=#dd804b, aucun text-shadow (forensique `/tmp/da-r2/cta-final.mjs`). Le contrôle n°1 de l'écran est muet — disqualifiant pour ≥9. |
| R2 | Dashboard | 6 | 7 | **6.5** | Hiérarchie exemplaire H1 30px/600 → H2 20px/600, chiffres Geist Mono, snap-carousel KPI 280px mobile, sidebar 280px @1440, glass 6× blur 20px. Même bug sur « Copier mon lien d'invitation » (`dashboard/page.tsx:134` `bg-primary text-primary-on-dark`) : label #dd804b sur fond #dd804b. Contrastes texte 44/45 ≥4.5 ailleurs. |
| R3 | Fluidité layout mobile | 5 | 7 | **6.0** | Bottom-nav fixe 72px @375, colonnes uniques, snaps horizontaux contenus (body ne scrolle pas) sur dashboard/vida/aide. MAIS `/marketplace` @375 : scroll horizontal de page entier (voir R6) — la sensation mobile casse sur 1 page clé sur 5. |
| R4 | Cohérence tokens | 6.5 | 7.5 | **7.0** | Fond html/body `rgb(10,10,15)` = #0A0A0F exact partout ; glass `--glass-bg 0.07` + blur 20px vérifiés ; pill (9999rem) + radii 24/16px tenus ; identité braise légitime (primary #dd804b, secondary #d9b958 — override par app conforme GOD MODE V4, pas un des 3 clichés). Défaut : **2 patterns CTA cohabitent** (`text-primary-on-dark` invisible vs `text-white` 2.89:1) — le token sémantique on-primary est cassé (voir D9). |
| R5 | Vie/soba écrans clés | 6.5 | 8.5 | **7.5** | /vida est le plus riche : eyebrow « LA BOUCLE », anneau progression 128px, historique mono, objectifs — raconte le sacrifice (points donnés) en un regard. /marketplace dense (cards glass 24px radius, pad 16) mais la liste déborde à 375. Sobriété tenue, zéro cliché IA interdit. |
| R6 | Overflow 375/768 | 4 | 10 | **5.0** | @768 et @1440 : 0 débordement sur les 5 pages. @375 : `/marketplace` **scrollW 463 vs 375 (+88px)** — `li` de 443px dans une piste grid de 335px (`ul.grid.gap-4.sm:grid-cols-2`, li min-width:auto, chaîne min-w-0 rompue au niveau li). Les 4 autres pages @375 sont propres. Un scroll horizontal de page = faute grave unique mais rédhibitoire. |
| R7 | Hiérarchie typo/espacements | 8.5 | 9.5 | **9.0** | Échelle stricte 30/20/18/16/14/12px, graisse 600 display / 400-500 body, paire Bricolage Grotesque + Geist + Geist Mono tenue sur les 5 pages sans exception, gap-4/6 régulier, ls négatif sur H1, échelle de largeurs de contenu par page (1024/896/768/672) cohérente. |

---

## Moyenne globale : **6.57 / 10**

## Verdict : **BOUCLE: CONTINUER**

---

## Défauts restants (transmis au correcteur)

- **D8 — /marketplace @375px : débordement horizontal de page +88px.** `ul.grid.gap-4.sm:grid-cols-2` (liste des annonces) : chaque `li` rend 443px pour une piste de 335px. Le `a.glass.flex.gap-4` interne a bien `min-w-0 flex-1` mais le `li` (grid item, `min-width:auto`) n'a pas de `min-w-0` → min-content du bloc texte (titre tronqué non contraignant) pousse l'item hors piste. Fix : `min-w-0` (ou `overflow-hidden`) sur les `li` de cette liste ; re-vérifier scrollW=375.
- **D9 — Token `--primary-on-dark` cassé : labels de CTA invisibles partout où `bg-primary` est plein.** `palette.ts:121` : `primaryOnDark: lightenUntilAa(primaryDraft, 4.5)` → #dd804b est déjà ≥4.5:1 sur fond sombre, donc aucun éclaircissement → `--primary-on-dark` = #dd804b = `--primary`. Tout bouton `bg-primary text-primary-on-dark` écrit #dd804b sur #dd804b. Preuves mesurées : `/login` « Se connecter » (innerHTML = texte brut du bouton, color=fill=bg, shadow:none) et `/dashboard` « Copier mon lien d'invitation » (`dashboard/page.tsx:134`). Touché aussi (code identique) : `page.tsx:46` (accueil), `messages/page.tsx:56`, `objets/page.tsx:95`, `scan/page.tsx:207,285`, `EstimatePanel.tsx:57`, `AnnoncePanel.tsx:219,249`. Fix : définir `--on-primary: #1a0f08` (contraste 6.5:1 sur #dd804b) et remplacer `text-primary-on-dark` par `text-on-primary` sur toutes les surfaces `bg-primary` pleines (le token `primary-on-dark` reste correct sur fonds sombres / `bg-primary/15`).
- **D10 — /vida : CTAs blancs sur primaire = 2.89:1 (< 4.5 AA).** « Proposer 24 pts » ×2 et « Créer l'objectif » (14px/600) : blanc sur #dd804b mesuré 2.89:1. Fichiers : `components/vida/TransferProposal.tsx:136,235`, `ObjectifForm.tsx:115`, `ObjectifCard.tsx:108`. Fix : même `text-on-primary #1a0f08` que D9 — unifie au passage les deux patterns CTA de l'app.

Ordre de passage : D9 (bloquant, systémique, 1 token + ~12 remplacements) → D8 (1 classe) → D10 (couvert par D9). Après correctif : re-capture 5 pages × 3 viewports, re-note. D6 braises vérifiées présentes — ne pas re-flagger.
