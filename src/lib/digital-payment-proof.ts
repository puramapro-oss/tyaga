import type Stripe from 'stripe';

export const digitalSamplePurpose = 'tyaga_digital_sample_v1';
type Expected = { id: string; acheteur: string; vendeur: string; montant: number; destination: string };
type Proof = { status: 'expired' | 'open'; intent: null } | { status: 'revoked' | 'paid'; intent: string };

/** Only called with the session retrieved using server credentials. */
export function verifyDigitalTestPayment(session: Stripe.Checkout.Session, order: Expected): Proof {
  if (session.livemode || session.mode !== 'payment' || session.client_reference_id !== order.id || session.metadata?.purpose !== digitalSamplePurpose ||
      session.metadata?.app_slug !== 'tyaga' || session.metadata?.digital_order_id !== order.id || session.metadata?.buyer_id !== order.acheteur ||
      session.metadata?.seller_id !== order.vendeur || session.currency !== 'eur' || session.amount_total !== order.montant) throw new Error('Session incohérente.');
  if (session.status === 'expired') return { status: 'expired', intent: null };
  if (session.status !== 'complete' || session.payment_status !== 'paid') return { status: 'open', intent: null };
  const pi = session.payment_intent;
  if (!pi || typeof pi === 'string' || pi.livemode || pi.status !== 'succeeded' || pi.currency !== 'eur'
      || pi.amount !== order.montant || pi.amount_received !== order.montant || pi.metadata.app_slug !== 'tyaga' || pi.metadata.digital_order_id !== order.id || pi.metadata.buyer_id !== order.acheteur
      || pi.metadata.seller_id !== order.vendeur || pi.metadata.purpose !== digitalSamplePurpose || pi.transfer_data?.destination !== order.destination)
    throw new Error('Règlement de recette non confirmé.');
  const charge = pi.latest_charge;
  if (!charge || typeof charge === 'string' || charge.livemode || !charge.paid || charge.currency !== 'eur' || charge.amount !== order.montant || charge.payment_intent !== pi.id) throw new Error('Charge de recette indisponible.');
  const revoked = charge.refunded || charge.amount_refunded > 0 || charge.disputed;
  return { status: revoked ? 'revoked' : 'paid', intent: pi.id };
}
