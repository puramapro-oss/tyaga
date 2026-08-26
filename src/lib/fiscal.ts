/**
 * EX-J7 — Compteur fiscal vendeur (auto-entrepreneur).
 * Requête sur `ventes` (D14 : pas de table dédiée) ; 1 pt de vérité pour
 * le seuil d'alerte : 250 € nets cumulés sur l'année fiscale en cours.
 */

export const FISCAL_ALERT_THRESHOLD_CENTS = 25_000;

export interface FiscalSale {
  net_amount_cents: number;
  fiscal_year: number;
}

export interface FiscalSummary {
  year: number;
  netCents: number;
  thresholdCents: number;
  /** true dès que le cumul atteint le seuil (>=, pas >) */
  alert: boolean;
}

export function fiscalSummary(
  sales: FiscalSale[],
  year: number
): FiscalSummary {
  const netCents = sales
    .filter((s) => s.fiscal_year === year)
    .reduce((acc, s) => acc + s.net_amount_cents, 0);
  return {
    year,
    netCents,
    thresholdCents: FISCAL_ALERT_THRESHOLD_CENTS,
    alert: netCents >= FISCAL_ALERT_THRESHOLD_CENTS,
  };
}

export function formatEuros(cents: number): string {
  // floor, pas round : 24 999 c affichait « 250 € » alors que l'alerte 250 €
  // (>= 25 000 c) n'était pas encore atteinte — l'affichage ne doit jamais
  // précéder le seuil.
  return `${Math.floor(cents / 100).toLocaleString('fr-FR')} €`;
}

/**
 * Année fiscale au calendrier français (métropole). `Date.getFullYear()`
 * est en UTC : une vente du 1er janvier entre 0 h et 1 h UTC serait
 * comptée sur l'année N-1. On formate en Europe/Paris à la place.
 */
export function fiscalYearParis(now: Date): number {
  return parseInt(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(now).slice(0, 4),
    10
  );
}
