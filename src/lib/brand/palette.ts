// Palette identité TYAGA — générée depuis la seed 'warmth-community-tyaga'
// (DESIGN-PLAN §1). Famille chaleur : corail/orange, teintes 12–38°.
// Interdits God Mode V4 respectés : pas noir+accent unique, pas les 3 looks
// clichés. Deux teintes chaudes + variante alerte distincte de l'action.

import { seededRandom } from './hash';

export const PALETTE_SEED = 'warmth-community-tyaga';

/** Fond de référence Purama (#0A0A0F) pour les contrôles de contraste AA. */
const BACKGROUND_HEX = '#0a0a0f';

export interface BrandPalette {
  seed: string;
  /** Couleur d'action (remplissages, boutons) — corail. */
  primary: string;
  /** Corail éclairci pour texte/icône sur fond sombre OU teinté
   *  `bg-primary/15|20` (AA ≥ 6:1 vs fond nu → ≥ 4,5:1 vs le teinté, D11). */
  primaryOnDark: string;
  /** Brun très sombre pour le texte posé sur un remplissage primary plein
   *  (CTA `bg-primary`) — AA ≥ 6,5:1. primaryOnDark NE sert PAS à ça : il
   *  éclaircit une teinte déjà AA sur fond sombre, donc ≈ primary → invisible. */
  onPrimary: string;
  /** Accent secondaire — ambre/orange chaud. */
  secondary: string;
  /** Ambre éclairci pour texte/bordure sur fond sombre ou teinté (AA ≥ 6:1). */
  secondaryOnDark: string;
  /** Erreur — framboise, distincte des teintes d'action. */
  alert: string;
}

// ---------- Conversions couleur (sans dépendance) ----------

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const lig = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) =>
    lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to255 = (x: number) =>
    Math.round(255 * x)
      .toString(16)
      .padStart(2, '0');
  return `#${to255(f(0))}${to255(f(8))}${to255(f(4))}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const v = hex.replace('#', '');
  return [
    parseInt(v.slice(0, 2), 16),
    parseInt(v.slice(2, 4), 16),
    parseInt(v.slice(4, 6), 16),
  ];
}

function channelLuminance(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  );
}

function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// ---------- Génération ----------

interface HslDraft {
  h: number;
  s: number;
  l: number;
}

function draftToHex(d: HslDraft): string {
  return hslToHex(d.h, d.s, d.l);
}

/** Alpha de la couche glass des cartes (globals.css `--glass-bg`). */
const GLASS_BG_ALPHA = 0.07;

/** Fond RÉEL d'un badge teinté, pire cas : remplissage à `alpha` sur une carte
 *  glass rgba(255,255,255,0.07) posée sur #0a0a0f. C'est contre CE composite
 *  que le texte doit tenir AA, pas contre le fond nu — #dd804b fait 6,8:1 sur
 *  le fond nu mais 4,35:1 sur bg-primary/20 + glass (DA r3 D11, mesuré). */
function tintedCompositeWorstCase(fillHex: string, alpha: number): string {
  const page = hexToRgb(BACKGROUND_HEX);
  const glass = page.map((c) =>
    Math.round(255 * GLASS_BG_ALPHA + c * (1 - GLASS_BG_ALPHA)),
  );
  const [r, g, b] = hexToRgb(fillHex);
  const mix = (fg: number, bg: number) => Math.round(fg * alpha + bg * (1 - alpha));
  const toHex = (x: number) => x.toString(16).padStart(2, '0');
  return `#${toHex(mix(r, glass[0]))}${toHex(mix(g, glass[1]))}${toHex(mix(b, glass[2]))}`;
}

/** Éclaircit la teinte jusqu'au contraste voulu CONTRE LE COMPOSITE teinté
 *  pire-cas (glass + alpha 0,20 — bg-primary/15 est plus sombre, donc plus
 *  favorable). Cible 5:1 = AA 4,5:1 + réserve d'arrondi/variation d'alpha. */
function lightenUntilTintedAa(draft: HslDraft, minRatio = 5): string {
  const worstCase = tintedCompositeWorstCase(draftToHex(draft), 0.2);
  let d = { ...draft };
  let hex = draftToHex(d);
  while (contrastRatio(hex, worstCase) < minRatio && d.l < 96) {
    d = { ...d, l: d.l + 2 };
    hex = draftToHex(d);
  }
  return hex;
}

/** Assombrit la teinte par pas de −2 en luminosité jusqu'au contraste voulu
 *  CONTRE la couleur de remplissage (texte sombre sur CTA plein). */
function darkenUntilContrast(draft: HslDraft, fill: string, minRatio: number): string {
  let d = { ...draft };
  let hex = draftToHex(d);
  while (contrastRatio(hex, fill) < minRatio && d.l > 4) {
    d = { ...d, l: d.l - 2 };
    hex = draftToHex(d);
  }
  return hex;
}

function generatePalette(seed: string): BrandPalette {
  const rand = seededRandom(seed);

  // Teinte d'action : corail, fenêtre chaleur 12–24° (typographie Bricolage,
  // univers revente — la braise qui démarre la boucle).
  const primaryHue = 12 + rand() * 12;
  // Accent : ambre/orange décalé de +14 à +24° — jamais la même teinte.
  const secondaryHue = primaryHue + 14 + rand() * 10;

  const primaryDraft: HslDraft = {
    h: primaryHue,
    s: 62 + rand() * 16,
    l: 56 + rand() * 6,
  };
  const secondaryDraft: HslDraft = {
    h: secondaryHue,
    s: 58 + rand() * 14,
    l: 54 + rand() * 6,
  };
  // Erreur : framboise ~350°, hors fenêtre chaleur, saturée — distincte de l'action.
  const alertDraft: HslDraft = { h: 348 + rand() * 8, s: 70, l: 58 };

  const primaryHex = draftToHex(primaryDraft);

  return {
    seed,
    primary: primaryHex,
    // D11 : cible le composite teinté pire-cas, PAS le fond nu — un calage
    // « AA sur fond nu » est un no-op quand le draft y est déjà ≥ 4,5:1
    // (#dd804b : 6,8:1 sur nu, 4,35:1 sur bg-primary/20 + glass).
    primaryOnDark: lightenUntilTintedAa(primaryDraft),
    onPrimary: darkenUntilContrast(primaryDraft, primaryHex, 6.5),
    secondary: draftToHex(secondaryDraft),
    secondaryOnDark: lightenUntilTintedAa(secondaryDraft),
    alert: lightenUntilTintedAa(alertDraft),
  };
}

export const tyagaPalette: BrandPalette = generatePalette(PALETTE_SEED);

/** `#ff8866` → `"255 136 102"` (triplet RGB pour var Tailwind opacité). */
export function rgbTriplet(hex: string): string {
  return hexToRgb(hex).join(' ');
}

/** Feuille `:root` des tokens identité — injectée par app/layout.tsx (zéro flash). */
export function paletteCssVars(p: BrandPalette): string {
  return [
    `--primary: ${p.primary};`,
    `--primary-on-dark: ${p.primaryOnDark};`,
    `--on-primary: ${p.onPrimary};`,
    `--primary-rgb: ${rgbTriplet(p.primary)};`,
    `--on-primary-rgb: ${rgbTriplet(p.onPrimary)};`,
    `--primary-on-dark-rgb: ${rgbTriplet(p.primaryOnDark)};`,
    `--secondary: ${p.secondary};`,
    `--secondary-on-dark: ${p.secondaryOnDark};`,
    `--secondary-rgb: ${rgbTriplet(p.secondary)};`,
    `--secondary-on-dark-rgb: ${rgbTriplet(p.secondaryOnDark)};`,
    `--alert: ${p.alert};`,
    `--alert-rgb: ${rgbTriplet(p.alert)};`,
  ].join('\n    ');
}
