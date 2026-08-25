/**
 * EX-E3 — matrice de transitions des commandes. Miroir exact de la policy RLS
 * `orders_update` (schema.sql) : chaque partie ne peut faire QUE ses transitions.
 * Le système (webhook via service role, bypass RLS) fait le reste.
 *
 *   buyer  : pending → cancelled   (avant paiement)
 *            shipped → delivered   (confirmation réception)
 *   seller : paid → shipped        (expédition)
 *   system : pending → paid        (checkout.session.completed)
 *            delivered → completed (après 'delivered' acheteur, + séquestre libéré + vente)
 *            * → refunded/cancelled (charge.refunded)
 */

export type OrderStatus =
  | 'pending'
  | 'paid'
  | 'shipped'
  | 'delivered'
  | 'completed'
  | 'cancelled';

export type OrderActor = 'buyer' | 'seller' | 'system';

const TRANSITIONS: Record<OrderActor, Partial<Record<OrderStatus, OrderStatus[]>>> = {
  buyer: {
    pending: ['cancelled'],
    shipped: ['delivered'],
  },
  seller: {
    paid: ['shipped'],
  },
  system: {
    pending: ['paid'],
    delivered: ['completed'],
    paid: ['cancelled'],
    shipped: ['cancelled'],
    completed: ['cancelled'], // remboursement après complétion (charge.refunded)
  },
};

export function canTransition(
  actor: OrderActor,
  from: OrderStatus,
  to: OrderStatus
): boolean {
  return TRANSITIONS[actor][from]?.includes(to) ?? false;
}

/** Lève si la transition est interdite — utilisé par l'API avant l'UPDATE (RLS = garde finale). */
export function assertTransition(
  actor: OrderActor,
  from: OrderStatus,
  to: OrderStatus
): void {
  if (!canTransition(actor, from, to)) {
    throw new TransitionError(actor, from, to);
  }
}

export class TransitionError extends Error {
  constructor(actor: OrderActor, from: OrderStatus, to: OrderStatus) {
    super(`Transition ${actor} ${from}→${to} interdite`);
    this.name = 'TransitionError';
  }
}

/** Action utilisateur → acteur + statut cible (API transition). */
export const USER_ACTIONS = {
  cancel: { actor: 'buyer' as const, to: 'cancelled' as const },
  ship: { actor: 'seller' as const, to: 'shipped' as const },
  deliver: { actor: 'buyer' as const, to: 'delivered' as const },
} as const;

export type UserAction = keyof typeof USER_ACTIONS;
