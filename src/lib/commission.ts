import 'server-only';

import { commissionPct } from './constants';
import { PHYSICAL_PILOT_POLICY } from './physical-sale-pilot';

export interface CommissionBreakdown {
  policy?: typeof PHYSICAL_PILOT_POLICY;
  itemCents?: number;
  buyerFeeCents?: number;
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


export function physicalPilotQuote(itemCents: number): CommissionBreakdown | null {
  if (!Number.isSafeInteger(itemCents) || itemCents <= 0 || itemCents > 2_147_483_647) return null;
  const buyerFeeCents = Math.round(itemCents * 29 / 1000) + 35;
  const grossCents = itemCents + buyerFeeCents;
  if (grossCents < 50 || grossCents > 2_147_483_647) return null;
  return { policy: PHYSICAL_PILOT_POLICY, grossCents, itemCents, buyerFeeCents,
    commissionPct: 0, commissionCents: 0, netCents: itemCents };
}
