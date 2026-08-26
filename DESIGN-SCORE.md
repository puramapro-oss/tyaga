# DESIGN-SCORE — TYAGA (Round 3, DA VEGA §9.4)

> Date : 2026-08-26 · Build prod `next start` sur http://localhost:3199 · Méthode : Playwright (chromium) 5 pages × 3 viewports (375×720, 768×1024, 1440×900) + audit DOM/pixel (getComputedStyle, getBoundingClientRect, luminance relative WCAG). Rendu image indisponible ce round → jugé sur captures + mesures DOM (méthode round 2, validée).

## Verdict

**BOUCLE: CONTINUER** — Moyenne **9.4/10**, mais R2 = 8.9 < 9 (1 défaut mesurable D11).

## Captures (15)

`/tmp/da-r3/da3-{home,login,dashboard,vida,marketplace}-{375,768,1440}.png`

## Rubriques

| # | Rubrique | Note | Preuves mesurées |
|---|---|---|---|
| R1 | Login / accueil | **9.4** | Home = écran APP minimal (H1 « TYAGA » 36px Bricolage Grotesque, ls -0.9px, 2 CTA pill 327×48 sur 375) ; CTA « Commencer » #dd804b/#1a0d05 = 6.58:1 AA ; login = card glass (1 backdrop-blur 20px), Google 16.85:1 ; 9 nœuds texte audités sur /login non-auth : 0 fail ; 0 overflow ; braises 9 éléments animés. |
| R2 | Dashboard | **8.9** | Hiérarchie 30px H1 / 20px H2 / 16-14px body tenue ; 7 surfaces glass ; VaultCard + 1 BoucleRing rendu (aria-label « La Boucle : X % ») ; données réelles (33 objets, 108 pts, filleul TY-8E77B5). **D11** : badges « 1 filleul » et « Actif » à 4.35:1 < 4.5:1 (détail ci-dessous). |
| R3 | Fluidité mobile 375 | **9.5** | Overflow 0px sur les 5 pages ; 0 cible tactile < 44px (min mesuré 52×44) ; bottom nav fixed 72px, 7 items × 52px = 364px ≤ 375, aucun chevauchement (dernier contenu bottom 564px < navTop 648px). |
| R4 | Tokens | **9.5** | bodyBg rgb(10,10,15) = #0A0A0F exact ; glass --glass-blur 20px (17 surfaces marketplace, 14 vida) ; pill 9999rem systématique sur CTA/badges (computed 159984px) ; rayons seulement {16, 24}px + pill — système à 3 valeurs ; paire Bricolage Grotesque (display) / Geist (body) / mono tabulaire (chiffres anneau) tenue partout. |
| R5 | Vie / sobriété | **9.3** | braise-rise : 9 éléments sur les 5 pages, unique famille de keyframes (sobre) ; BoucleRing = arc SVG spring + braise posée au bout de l'arc + fallback prefers-reduced-motion + chiffres tabulaires ; 24-33 éléments interactifs transitionnés. Signature thématique réelle (braise → anneau = thèse TYAGA), pas de déco gratuite. |
| R6 | Overflow 375/768 | **10** | scrollWidth − clientWidth = **0px** sur 5 pages × {375, 768} et aussi 1440. |
| R7 | Typo / espacements / hiérarchie | **9.2** | Échelle headings 36/30/24/20 fw 600, ls proportionnels négatifs (−0.9 → −0.5px), lh body 24/16 = 1.5 ; rythme gaps {16, 24}px + padding 24px constants sur les conteneurs ; utility 12px réservé aux badges/méta. D11 compté dans R2 (pas double-pénalisé). |

**Moyenne : 9.4/10**

## Défauts (D11)

### D11 — Badges texte `text-primary-on-dark` sur fond teinté : 4.35:1 < 4.5:1 (AA fail)

- **Mesure** : texte 12px font-weight 500, fg rgb(221,128,75) sur fond effectif rgb(66,47,40) (= `bg-primary/20` empilé sur card glass) → **4.35:1**, exigence WCAG AA petit texte = 4.5:1. Mesuré in-browser sur /dashboard (badges « 1 filleul », « Actif »).
- **Cause racine** : `palette.ts:139` — `lightenUntilAa(primaryDraft, 4.5)` garantit AA contre #0A0A0F nu, mais les badges posent le texte sur un teinté `bg-primary/15|20` (fond nettement plus clair), ce qui casse l'hypothèse.
- **Occurrences du même pattern** (texte 12px, pas les icônes qui passent à 3:1) :
  - `src/components/dashboard/ReferralCard.tsx:47` — « 1 filleul » (mesuré 4.35:1)
  - `src/components/dashboard/AmbassadorCard.tsx:18` — « Actif » (mesuré 4.35:1)
  - `src/components/objets/AnnoncePanel.tsx:123` — badge bg-primary/20, même pattern
  - `src/app/(dashboard)/commandes/page.tsx:110` — badge bg-primary/15
  - `src/lib/labels.ts:14-15` — tons `bg-primary/15|20 text-primary-on-dark` (« Estimé », « En vente »)
- **Fix proposé (1 ligne, corrige tout le scope)** : dans `src/lib/brand/palette.ts:139`, remplacer la cible `lightenUntilAa(primaryDraft, 4.5)` par une cible qui tient le pire fond teinté — concrètement viser ≥ 6:1 contre le fond badge mesuré rgb(66,47,40), ce qui donne `#e7a681` (= `color-mix(in srgb, var(--primary) 70%, white 30%)`) → **6.09:1** mesuré. Vérifié sans effet de bord : `--primary-on-dark` n'est utilisé ni sur CTA pleins (D9 a basculé sur `--on-primary` brun sombre) ni comme fond ; son éclaircissement améliore seulement outline focus (globals.css:124) et icônes (déjà conformes).
- **Fix alternatif (chirurgical, 5 classes)** : créer `.badge-accent { color: color-mix(in srgb, var(--primary) 70%, white 30%); }` et l'appliquer aux 5 occurrences badge au lieu de `text-primary-on-dark`.

Après fix : re-capture /dashboard (+ une page objets/commandes si visible) @375, re-mesure des 5 occurrences ≥ 4.5:1, attendu R2 ≥ 9 → VERT.

## À garder (preuves de la demande)

- **CTA primaires** : #dd804b plein + texte #1a0d05 = 6.58:1 partout (home, login, dashboard, vida ×2) — D9/D10 tiennent.
- **Overflow 0px** sur 5 pages × 3 viewports — D8 tient.
- **Braises** : 9 éléments `braise-rise` sur /, /login, /dashboard, /vida, /marketplace — D6 tient et s'étend à tout l'app shell.
- **La Boucle** (`src/components/vida/BoucleRing.tsx`) : signature mémorable, accessible (role="img" + aria-label chiffrée), reduced-motion géré, spring + braise sur l'arc. 5 anneaux rendus sur /vida (1 vedette + 4 objectifs), 1 sur dashboard.
- **Paire typo Bricolage Grotesque / Geist + mono tabulaire** : distincte des 3 clichés IA interdits (ni crème+serif+terracotta, ni noir+vert acide, ni hairlines zéro radius — pill + 16/24px + cuivre braise).
- **Données réelles** partout (33 objets, 108 pts, split 0/30/50/100 % lisible, items marketplace avec prix/dates/états) — 0 vide factice, 0 Lorem.
- **Bottom nav 8 onglets** : tient 375px sans débord, cibles 52×44px, n'obscurcit pas le contenu.
