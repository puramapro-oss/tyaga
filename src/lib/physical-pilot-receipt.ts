import type Stripe from 'stripe';
import { isPhysicalPilotPolicy } from './physical-fee-policy';
import { hasPhysicalTestStripeKey } from './physical-sale-pilot';

export type PaymentOrder = {
  id: string; buyer_id: string; seller_id: string; amount_cents: number; fee_policy?: string;
  stripe_checkout_session_id: string | null; stripe_payment_intent_id: string | null;
};

function isPilot(order: PaymentOrder | null, metadata: Stripe.Metadata | null, live: boolean, objectLive: boolean, testKey: boolean) {
  if (!isPhysicalPilotPolicy(order?.fee_policy) && !isPhysicalPilotPolicy(metadata?.fee_policy)) return false;
  if (!order || !isPhysicalPilotPolicy(order.fee_policy) || metadata?.fee_policy !== order.fee_policy ||
      metadata.app_slug !== 'tyaga' || metadata.order_id !== order.id || metadata.buyer_id !== order.buyer_id ||
      metadata.seller_id !== order.seller_id || live !== false || objectLive !== false || !testKey)
    throw new Error('Le reçu du pilote ne correspond pas à cette commande de test.');
  return true;
}

export function checkPilotCheckout(order: PaymentOrder | null, session: Stripe.Checkout.Session,
  eventLive: boolean, expectation: 'paid' | 'expired', testKey = hasPhysicalTestStripeKey()) {
  if (!isPilot(order, session.metadata, eventLive, session.livemode, testKey)) return;
  if (!order || !order.stripe_checkout_session_id || session.id !== order.stripe_checkout_session_id ||
      session.client_reference_id !== order.id || session.mode !== 'payment' || session.currency !== 'eur' || session.amount_total !== order.amount_cents ||
      !Number.isSafeInteger(session.amount_total) || order.amount_cents <= 0) throw new Error('Devis de test incohérent.');
  if (expectation === 'expired') {
    if (session.status !== 'expired' || session.payment_status !== 'unpaid') throw new Error('Expiration de test non confirmée.');
    return;
  }
  const intentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
  if (session.status !== 'complete' || session.payment_status !== 'paid' ||
      !intentId?.startsWith('pi_') ||
      (order.stripe_payment_intent_id !== null && order.stripe_payment_intent_id !== intentId))
    throw new Error('Paiement de test non confirmé.');
}

export function checkPilotRefund(order: PaymentOrder | null, charge: Stripe.Charge, eventLive: boolean, testKey = hasPhysicalTestStripeKey()) {
  if (!isPilot(order, charge.metadata, eventLive, charge.livemode, testKey)) return;
  const pi = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
  if (!order || !pi || pi !== order.stripe_payment_intent_id || charge.amount !== order.amount_cents ||
      charge.currency !== 'eur' || charge.amount_refunded <= 0 || charge.amount_refunded > charge.amount)
    throw new Error('Remboursement de test non rapproché.');
}

// Compare the provider's settled amount and its independently stored metadata
// with the immutable order. A price negotiation is already in amount_cents.
export function checkPilotPaymentIntent(order: PaymentOrder, intent: Stripe.PaymentIntent, expectedId: string,
  eventLive: boolean, testKey = hasPhysicalTestStripeKey()) {
  if (!isPilot(order, intent.metadata, eventLive, intent.livemode, testKey) ||
      intent.id !== expectedId || intent.status !== 'succeeded' || intent.currency !== 'eur' ||
      intent.amount !== order.amount_cents || intent.amount_received !== order.amount_cents) {
    throw new Error('Le règlement du prestataire ne correspond pas au devis de cette commande.');
  }
}
