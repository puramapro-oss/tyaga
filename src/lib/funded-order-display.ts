import { formatPrice } from './utils';

export interface FundedOrderView {
  order_id: string;
  pay_status: 'awaiting_funding' | 'reserved' | 'captured' | 'released' | 'refunded';
  seller_status: 'unconfirmed' | 'confirmed' | 'reversed';
  reconciliation_status: string;
  funded_cents: number | null;
  buyer_due_cents: number | null;
}

/** Only render amounts and attestations returned by the participant-only database view. */
export function fundedOrderMessages(view?: FundedOrderView): string[] {
  const unavailable = ['Suivi du financement indisponible.'];
  if (!view) return unavailable;
  if (view.pay_status === 'awaiting_funding') return ['En attente d’une affectation de financement.'];
  if (view.funded_cents === null || !Number.isSafeInteger(view.funded_cents) || view.funded_cents <= 0) return unavailable;
  const amount = formatPrice(view.funded_cents);
  const funds = {
    reserved: `Financement réservé · ${amount}`,
    captured: `Financement utilisé · ${amount}`,
    released: `Réservation libérée · ${amount}`,
    refunded: `Financement restitué à l’acheteur · ${amount}`,
  }[view.pay_status];
  if (!funds) return unavailable;
  const messages = [funds];
  if ((view.pay_status === 'reserved' || view.pay_status === 'captured') && view.buyer_due_cents !== null && view.buyer_due_cents > 0) {
    messages.push(`Complément acheteur à régler · ${formatPrice(view.buyer_due_cents)}`);
  }
  if (view.seller_status === 'confirmed') messages.push('Règlement du vendeur confirmé.');
  if (view.seller_status === 'unconfirmed' && (view.pay_status === 'captured' || view.pay_status === 'reserved')) messages.push('Règlement du vendeur en attente.');
  if (view.seller_status === 'reversed') messages.push('Retour du règlement vendeur confirmé.');
  if (view.reconciliation_status === 'awaiting_buyer_return') messages.push('Restitution à l’acheteur en attente.');
  if (view.reconciliation_status === 'review') messages.push('Contrôle en cours du retour vendeur.');
  return messages;
}
