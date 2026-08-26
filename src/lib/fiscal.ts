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
  return `${Math.round(cents / 100).toLocaleString('fr-FR')} €`;
}
