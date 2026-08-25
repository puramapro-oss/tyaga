export const APP_NAME = 'TYAGA';

export const APP_SLUG = 'tyaga';

export const APP_DOMAIN = 'tyaga.purama.dev';

export const SUPER_ADMIN_EMAIL = 'matiss.frasne@gmail.com';

/** Seuil compteur fiscal (EX-J) : alerte à 250 ventes nettes → seuil 305 €. */
export const FISCAL_ALERT_NET_CENTS = 25000;

/** Commission marketplace V1 (D13) — surchargée par TYAGA_COMMISSION_PCT. */
export function commissionPct(): number {
  const pct = Number(process.env.TYAGA_COMMISSION_PCT);
  return Number.isFinite(pct) && pct >= 0 && pct <= 30 ? pct : 10;
}

export const COMPANY_INFO = {
  name: 'SASU PURAMA',
  address: '8 Rue Chapelle, 25560 Frasne',
  legal: 'TVA non applicable, art. 293B du CGI',
};
