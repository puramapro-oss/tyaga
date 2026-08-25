import 'server-only';

import { commissionPct } from './constants';

export interface CommissionBreakdown {
  /** Prix affiché acheteur (centimes). */
  grossCents: number;
  commissionPct: number;
  commissionCents: number;
  /** Net vendeur (centimes) — TOUJOURS calculé serveur (EX-C3). */
  netCents: number;
}

/**
 * Décomposition prix → commission → net. Arrondi au centime inférieur pour le
 * vendeur (jamais de centime fantôme en sa défaveur inversé), commission = brut − net.
 */
export function computeCommission(grossCents: number): CommissionBreakdown {
  if (!Number.isFinite(grossCents) || grossCents < 0) {
    throw new Error('Montant invalide');
  }
  const pct = commissionPct();
  const netCents = Math.floor((grossCents * (100 - pct)) / 100);
  return {
    grossCents,
    commissionPct: pct,
    commissionCents: grossCents - netCents,
    netCents,
  };
}
