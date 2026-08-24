# DESIGN-PLAN.md — TYAGA

## 1. Identity seed
```ts
identitySeed: {
  seed: 'warmth-community-tyaga',        // parseSeed() — déterministe xmur3, confirmé Tissma
  colors: { /* générées par /lib/brand/palette-generator.ts — 0 hex en dur dans l'UI */ },
  typography: {
    display: 'Bricolage Grotesque',       // signature — 0 collision sur 17 apps
    body: 'Geist Sans',                   // base Design System V1
    utility: 'Geist Mono',                // prix, chiffres tabular-nums
  },
  signatureShape: 'La Boucle — chaque objet scanné devient une braise qui alimente la progression vers l\'objectif Vida',
  heroThesis: 'Ton superflu finance ton futur — l\'objet photographié se transforme en progression visible',
}
```

## 2. Variante domaine : « revente / marketplace consumer »
Références monde réel : **Vinted** (photo-first, badges état, prix nets) × **Back Market** (confiance, garants visuels). PAS Robinhood (pas dense-data), PAS Calm (pas zen-passif).
- Cards objets : PHOTO dominante (ratio 4:5), titre 2 lignes max, badge état (Neuf/Excellent/Très bon/Bon/Satisfaisant/À réparer), prix NET en gros (Geist Mono).
- Ambiance chaleureuse (mood warmth-community : corail/orange) mais fond sombre Purama `#0A0A0F` + ambiance radiale.
- Progression désencombrement : « X objets lâchés · Y€ transformés » — jamais en hero chiffre creux.

## 3. Wireframes (375px et desktop)
- `/` écran app : logo TYAGA (braise/boucle) + tagline « Ton superflu finance ton futur » + CTA « Commencer » (gradient signature) + « Se connecter ». Fond animé, 1 seule vue above the fold.
- Dashboard : sidebar 280px desktop (Accueil, Scanner, Mes objets, Messages, Expéditions, Vault, Parrainage, Profil/Réglages + admin si super-admin) ; mobile bottom tabs 5 (Accueil, Scanner [central, proéminent], Objets, Messages, Vault).
  - Bloc 1 solde Vault + progression objectif Vida (La Boucle).
  - Bloc 2 « Scanner un objet » — CTA principal photo.
  - Blocs parrainage / ambassadeur / cross-promo VIDA (WELCOME50).
- `/scan` : flow 3 pas (3 photos → fiche IA modifiable → estimation) — stepper minimal, 1 action par écran.
- `/items/[id]` : galerie photos, fiche, estimation, annonce, statut pipeline (scanné → estimé → en vente → vendu).
- `/market` + `/market/[id]` : grille cards photo-first (acheteur).
- `/inbox` : liste conversations → fil avec bulles + chips réponses 1-clic + banner anti-hors-plateforme.
- `/vault` : solde points, historique transferts, objectifs CRUD + barres progression.
- `/expedition/[id]` : checklist cochable + adresse + boutons statut.

## 4. Signature mémorable
« **La Boucle** » : à chaque objet vendu, une braise (particule corail) rejoint un anneau de progression autour de l'objectif Vida. Animation framer-motion spring, reduced-motion → statique. UNE signature unique (règle Chanel : rien d'autre décoratif).

## 5. Anti-clichés IA (interdits)
- PAS : gros chiffre + dégradé générique en hero ; emoji comme icône (Lucide only) ; Inter/Roboto ; fond statique ; gradient CSS en background ; hex en dur ; look crème+serif+terracotta / noir+vert acide / journal hairlines.
- Écrans creux interdits : chaque vue a du VRAI contenu (objets réels ou empty state illustré + CTA).

## 6. Accessibilité & perf
Contraste AA min (prix nets sur fond glass), zones tactiles ≥44px, `prefers-reduced-motion` respecté, lazy-load photos `next/image`, Lighthouse ≥95.
