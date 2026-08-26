// Import type-only (effacé au runtime) : les tests node --test peuvent
// charger ce module sans déclencher la garde 'server-only' de service.ts.
import type { createServiceClient } from './service';

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * Parrainage V4 (CLAUDE.md §9.2) — N1 = 50 % de la commission TYAGA sur le
 * premier paiement du filleul, crédité au parrain en points Vault (1 pt = 1 €).
 * Sandbox V1 : crédité en points, aucun virement réel (D15).
 */

export const REFERRAL_CODE_PATTERN = /^TY-[A-F0-9]{6}$/;

/** Clé sessionStorage : code parrain capté par /signup?ref=… (P3). */
export const REFERRAL_STORAGE_KEY = 'tyaga_ref';

/** Points N1 crédités au parrain pour une commission TYAGA donnée (cents). */
export function n1PointsFromCommission(commissionCents: number): number {
  if (!Number.isFinite(commissionCents) || commissionCents <= 0) return 0;
  return Math.round(commissionCents / 200); // 50 % de la commission, 1 pt = 1 €
}

/** Normalisation saisie : trim + majuscules (codes stockés en majuscules). */
export function normalizeCode(input: string): string {
  return input.trim().toUpperCase();
}

/** Lien d'invitation partageable. */
export function referralLink(code: string, origin: string): string {
  return `${origin}/signup?ref=${encodeURIComponent(normalizeCode(code))}`;
}

/**
 * Crédite le N1 au parrain lors de la PREMIÈRE vente complétée du filleul.
 * Flag `commission_paid` = jamais deux fois ; échec non bloquant pour la vente.
 */
export async function payReferralN1(
  service: ServiceClient,
  referredId: string,
  commissionCents: number
): Promise<number> {
  // Jury bugs P6 : claim atomique AVANT le crédit — le flag posé conditionnel
  // dans le même UPDATE ferme la fenêtre TOCTOU (deux finalisations
  // concurrentes ne peuvent pas créditer le parrain deux fois).
  const { data: claimed, error: claimError } = await service
    .from('referrals')
    .update({ commission_paid: true })
    .eq('referred_id', referredId)
    .eq('commission_paid', false)
    .select('id, referrer_id')
    .maybeSingle();
  if (claimError || !claimed) return 0;

  const points = n1PointsFromCommission(commissionCents);
  if (points <= 0) return 0;
  try {
    await service.rpc('credit_wallet', {
      p_user: claimed.referrer_id,
      p_points: points,
    });
  } catch (e) {
    // Crédit raté : on relâche le claim pour qu'un rejeu puisse repayer.
    await service
      .from('referrals')
      .update({ commission_paid: false })
      .eq('id', claimed.id);
    throw e;
  }
  return points;
}
