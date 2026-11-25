import { NextResponse } from 'next/server';
import type Stripe from 'stripe';

import { handleDigitalTestEvent } from '@/lib/digital-checkout-test';
import { checkPilotCheckout, checkPilotPaymentIntent, checkPilotRefund, type PaymentOrder } from '@/lib/physical-pilot-receipt';
import { isPhysicalPilotPolicy, PHYSICAL_PILOT_POLICIES } from '@/lib/physical-fee-policy';
import { hasPhysicalTestStripeKey } from '@/lib/physical-sale-pilot';
import { refundCompletedSale } from '@/lib/order-refund';
import { createServiceClient } from '@/lib/service';
import { getStripe } from '@/lib/stripe';

/**
 * EX-E4 — réception du webhook UNIFIÉ écosystème. TYAGA n'a AUCUN webhook
 * Stripe dédié : karma (karma.purama.dev/api/stripe/webhook) route ici via
 * karma.webhook_app_registry sur `metadata.app_slug = "tyaga"`.
 * Double sécurité : secret interne partagé + re-vérification signature Stripe.
 */

export async function POST(request: Request) {
  const internalSecret = request.headers.get('x-internal-secret');
  if (!internalSecret || internalSecret !== process.env.INTERNAL_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const signature = request.headers.get('x-stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Signature absente' }, { status: 400 });
  }

  const payload = await request.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(
      payload,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch {
    return NextResponse.json({ error: 'Signature invalide' }, { status: 400 });
  }

  try {
    if (await handleDigitalTestEvent(event)) return NextResponse.json({ received: true });
  } catch {
    return NextResponse.json({ error: 'Rapprochement de la licence à réessayer.' }, { status: 503 });
  }

  // Défense (jury bugs P6) : karma ne doit nous envoyer QUE du tyaga. Un event
  // sans app_slug n'est pas à nous → acquitté ignoré, JAMAIS traité (fail-closed).
  const slug =
    (event.data.object as { metadata?: Record<string, string> }).metadata?.app_slug ?? null;
  if (slug !== 'tyaga') {
    return NextResponse.json({ received: true, ignored: slug ?? 'unknown' });
  }

  // EX-E4 : idempotence locale. Le marqueur est posé APRÈS le succès du
  // traitement, JAMAIS avant (PIEGES.md §1) : si le handler échoue en cours
  // de route, aucun marqueur n'existe et le retry karma re-traite — les
  // handlers sont eux-mêmes idempotents (.eq status, UNIQUE payment_intent,
  // ventes UNIQUE order_id) donc un rejeu reste sans effet de bord.
  const service = createServiceClient();
  const { data: existing } = await service
    .from('stripe_events_processed')
    .select('event_id')
    .eq('event_id', event.id)
    .maybeSingle();
  // Les anciens événements de remboursement ont pu être acquittés avant la
  // compensation. Leur rejeu passe par le journal durable, même déjà marqué.
  if (existing && event.type !== 'charge.refunded') {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session, service, event.livemode);
        break;
      }
      case 'checkout.session.expired': {
        await handleExpired(event.data.object as Stripe.Checkout.Session, service, event.livemode);
        break;
      }
      case 'charge.refunded': {
        await handleRefunded(event.data.object as Stripe.Charge, service, event.livemode);
        break;
      }
      default:
        // Événement écosystème non pertinent pour TYAGA — acquitté silencieusement
        break;
    }
  } catch {
    // 500 : karma réessaiera ; aucun marqueur posé → le retry re-traitera
    return NextResponse.json({ error: 'Traitement échoué' }, { status: 500 });
  }

  const { error: dedupError } = await service
    .from('stripe_events_processed')
    .insert({ event_id: event.id, event_type: event.type });
  const alreadyProcessed = dedupError?.code === '23505';
  if (dedupError && !alreadyProcessed) {
    // Traitement OK mais marqueur impossible : on acquitte quand même —
    // le rejeu éventuel sera sans effet (handlers idempotents) et le marqueur
    // finira par être posé par un futur event si karma re-dédupe de son côté.
    return NextResponse.json({ received: true, dedup: 'unavailable' });
  }
  return NextResponse.json({ received: true });
}

type ServiceClient = ReturnType<typeof createServiceClient>;

const paymentColumns = 'id,buyer_id,seller_id,amount_cents,fee_policy,stripe_checkout_session_id,stripe_payment_intent_id';

async function readPaymentOrder(service: ServiceClient, column: 'id' | 'stripe_payment_intent_id' | 'stripe_checkout_session_id',
  value: string, onlyPilot = false): Promise<PaymentOrder | null> {
  let query = service.from('marketplace_orders').select(paymentColumns).eq(column, value);
  if (onlyPilot) query = query.in('fee_policy', PHYSICAL_PILOT_POLICIES);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error('Lecture de la commande impossible.');
  return data;
}

async function validateCheckout(service: ServiceClient, session: Stripe.Checkout.Session, live: boolean, expected: 'paid' | 'expired') {
  const stated = session.metadata?.order_id;
  const order = stated ? await readPaymentOrder(service, 'id', stated) : null;
  // A missing or displaced metadata marker cannot disguise a session already
  // bound to a pilot order as a legacy orphan eligible for an automatic refund.
  const bound = session.id && !isPhysicalPilotPolicy(order?.fee_policy) && order?.stripe_checkout_session_id !== session.id
    ? await readPaymentOrder(service, 'stripe_checkout_session_id', session.id, true) : null;
  const receiptOrder = bound ?? order;
  checkPilotCheckout(receiptOrder, session, live, expected);
  return receiptOrder && isPhysicalPilotPolicy(receiptOrder.fee_policy) ? receiptOrder : null;
}


/** pending → paid + séquestre posé (fonds sur le solde plateforme). */
async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
  service: ServiceClient,
  live: boolean
): Promise<void> {
  const pilotOrder = await validateCheckout(service, session, live, 'paid');
  if (pilotOrder && !hasPhysicalTestStripeKey()) throw new Error('Prestataire de test indisponible.');
  const pilotStripe = pilotOrder ? getStripe() : null;
  if (session.payment_status !== 'succeeded' && session.payment_status !== 'paid') return;

  const orderId = session.metadata?.order_id;
  const paymentIntentId =
    typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
  if (!orderId || !paymentIntentId) return;
  if (pilotOrder && pilotStripe) {
    const intent = await pilotStripe.paymentIntents.retrieve(paymentIntentId);
    checkPilotPaymentIntent(pilotOrder, intent, paymentIntentId, live);
  }

  const now = new Date().toISOString();
  // .eq('status','pending') = idempotent : un event rejoué ne retouche pas une commande déjà paid
  const { data: updated, error } = await service
    .from('marketplace_orders')
    .update({
      status: 'paid',
      escrow_status: 'held',
      stripe_payment_intent_id: paymentIntentId,
      updated_at: now,
    })
    .eq('id', orderId)
    .eq('status', 'pending')
    .select('id');

  if (error) throw new Error(`update paid: ${error.code ?? error.message}`);

  // Paiement orphelin : la commande a été annulée (vendeur/acheteur) ou
  // supprimée entre le checkout et le webhook → on rembourse immédiatement.
  // L'acheteur ne doit JAMAIS payer un objet qui ne lui sera pas livré.
  if (!updated || updated.length === 0) {
    const { data: cancelled, error: cancelledError } = await service
      .from('marketplace_orders')
      .select('id, status, escrow_status, stripe_payment_intent_id')
      .eq('id', orderId)
      .maybeSingle();
    if (cancelledError) throw new Error(`read checkout order: ${cancelledError.code}`);
    // Commande introuvable = supprimée : idem, on rembourse.
    if (!cancelled || cancelled.status === 'cancelled') {
      if (cancelled?.escrow_status === 'refunded'
          && cancelled.stripe_payment_intent_id === paymentIntentId) {
        const { data: refundProof, error: proofError } = await service
          .from('order_settlements')
          .select('refund_accounted_at')
          .eq('order_id', cancelled.id)
          .maybeSingle();
        if (proofError) throw new Error(`refund proof ${cancelled.id}: ${proofError.code}`);
        if (refundProof?.refund_accounted_at) return;
      }
      const refund = await (pilotStripe ?? getStripe()).refunds.create({ payment_intent: paymentIntentId });
      if (refund.status === 'failed') {
        throw new Error(`refund orphan ${paymentIntentId}: failed`);
      }
    }
    // Sinon : commande déjà payée par un event précédent → rien à faire.
  }
}

/** Session Checkout expirée sans paiement → commande annulée (system). */
async function handleExpired(
  session: Stripe.Checkout.Session,
  service: ServiceClient,
  live: boolean
): Promise<void> {
  await validateCheckout(service, session, live, 'expired');
  const orderId = session.metadata?.order_id;
  if (!orderId) return;

  const { error } = await service
    .from('marketplace_orders')
    .update({
      status: 'cancelled',
      escrow_status: 'none',
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId)
    .eq('status', 'pending');

  if (error) throw new Error(`update expired: ${error.code ?? error.message}`);
}

/** Remboursement → commande annulée + séquestre remboursé + clawback points/vente. */
async function handleRefunded(
  charge: Stripe.Charge,
  service: ServiceClient,
  live: boolean
): Promise<void> {
  const intent = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
  const order = intent ? await readPaymentOrder(service, 'stripe_payment_intent_id', intent) : null;
  checkPilotRefund(order, charge, live);
  const pilotStripe = isPhysicalPilotPolicy(order?.fee_policy) ? getStripe() : null;
  if (pilotStripe && order && intent) {
    const captured = await pilotStripe.paymentIntents.retrieve(intent);
    checkPilotPaymentIntent(order, captured, intent, live);
  }
  await refundCompletedSale(charge, {
    store: service,
    getTransfers: () => (pilotStripe ?? getStripe()).transfers,
  });
}
