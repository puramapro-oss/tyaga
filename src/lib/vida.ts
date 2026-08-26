/**
 * EX-H — Vida Vault (sandbox points). Helpers purs, testés unitairement
 * (`node --test tests/`). 1 point = 1 € net vendeur, jamais d'euro virtuel
 * flottant : tout passe par des entiers points.
 */

/** Pourcentages de transfert proposés après une vente confirmée (EX-H2). */
export const TRANSFER_PCTS = [0, 30, 50, 100] as const;
export type TransferPct = (typeof TRANSFER_PCTS)[number];

export function isTransferPct(v: unknown): v is TransferPct {
  return typeof v === 'number' && (TRANSFER_PCTS as readonly number[]).includes(v);
}

export interface TransferOption {
  pct: TransferPct;
  label: string;
  /** Description courte orientée décision (jamais de jargon bancaire). */
  hint: string;
}

const TRANSFER_OPTIONS: readonly TransferOption[] = [
  { pct: 0, label: '0 % — tout garder', hint: 'Les points restent sur ton wallet TYAGA.' },
  { pct: 30, label: '30 %', hint: 'Petite pierre à l’objectif, le reste disponible.' },
  { pct: 50, label: '50 %', hint: 'L’équilibre : moitié objectif, moitié wallet.' },
  { pct: 100, label: '100 % — tout verser', hint: 'La vente entière part vers l’objectif.' },
];

export function transferOptions(): readonly TransferOption[] {
  return TRANSFER_OPTIONS;
}

export function transferOption(pct: TransferPct): TransferOption {
  const o = TRANSFER_OPTIONS.find((x) => x.pct === pct);
  if (!o) throw new Error('Pourcentage de transfert inconnu');
  return o;
}

/** Net vendeur (centimes) → points wallet (1 pt = 1 €). Ex-H1, floor toujours. */
export function pointsFromNet(netCents: number): number {
  if (!Number.isFinite(netCents) || netCents < 0) return 0;
  return Math.floor(netCents / 100);
}

/** Points à verser pour un pct donné — floor, cohérent avec pointsFromNet. */
export function transferPoints(netCents: number, pct: TransferPct): number {
  return Math.floor((pointsFromNet(netCents) * pct) / 100);
}

export interface Progression {
  /** Avancement 0..100 (plafonné, jamais >100 pour la barre). */
  pct: number;
  remainingPoints: number;
  complete: boolean;
}

export function progression(currentPoints: number, targetPoints: number): Progression {
  const cur = Math.max(0, Math.floor(currentPoints || 0));
  const tgt = Math.max(1, Math.floor(targetPoints || 0));
  const raw = Math.round((cur / tgt) * 100);
  return {
    pct: Math.min(100, Math.max(0, raw)),
    remainingPoints: Math.max(0, tgt - cur),
    complete: cur >= tgt,
  };
}

/** Libellés objectifs Vida — miroir du CHECK type en base (vida_objectifs). */
export const OBJECTIF_TYPES = [
  'vida_subscription',
  'soin',
  'investissement',
  'autre',
] as const;
export type ObjectifType = (typeof OBJECTIF_TYPES)[number];

export const OBJECTIF_TYPE_LABELS: Record<ObjectifType, string> = {
  vida_subscription: 'Abonnement Vida',
  soin: 'Soin / santé',
  investissement: 'Épargne / investissement',
  autre: 'Autre objectif',
};

export function objectifTypeLabel(t: string): string {
  return OBJECTIF_TYPE_LABELS[t as ObjectifType] ?? OBJECTIF_TYPE_LABELS.autre;
}
