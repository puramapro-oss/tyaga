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
  /** Corail éclairci pour texte/bordure sur fond sombre (contraste AA ≥ 4,5:1). */
  primaryOnDark: string;
  /** Accent secondaire — ambre/orange chaud. */
  secondary: string;
  /** Ambre éclairci pour texte/bordure sur fond sombre (AA ≥ 4,5:1). */
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

/** Éclaircit la teinte par pas de +2 en luminosité jusqu'au contraste AA voulu. */
function lightenUntilAa(draft: HslDraft, minRatio: number): string {
  let d = { ...draft };
  let hex = draftToHex(d);
  while (contrastRatio(hex, BACKGROUND_HEX) < minRatio && d.l < 96) {
    d = { ...d, l: d.l + 2 };
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

  return {
    seed,
    primary: draftToHex(primaryDraft),
    primaryOnDark: lightenUntilAa(primaryDraft, 4.5),
    secondary: draftToHex(secondaryDraft),
    secondaryOnDark: lightenUntilAa(secondaryDraft, 4.5),
    alert: lightenUntilAa(alertDraft, 4.5),
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
    `--primary-rgb: ${rgbTriplet(p.primary)};`,
    `--primary-on-dark-rgb: ${rgbTriplet(p.primaryOnDark)};`,
    `--secondary: ${p.secondary};`,
    `--secondary-on-dark: ${p.secondaryOnDark};`,
    `--secondary-rgb: ${rgbTriplet(p.secondary)};`,
    `--secondary-on-dark-rgb: ${rgbTriplet(p.secondaryOnDark)};`,
    `--alert: ${p.alert};`,
    `--alert-rgb: ${rgbTriplet(p.alert)};`,
  ].join('\n    ');
}
