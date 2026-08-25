import { NextResponse } from 'next/server';
import type Stripe from 'stripe';

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

  // Défense : karma ne doit nous envoyer que du tyaga
  const slug =
    (event.data.object as { metadata?: Record<string, string> }).metadata?.app_slug ?? null;
  if (slug && slug !== 'tyaga') {
    return NextResponse.json({ received: true, ignored: slug });
  }

  // EX-E4 : idempotence locale (karma dédupe déjà — re-dédup par sécurité)
  const service = createServiceClient();
  const { error: dedupError } = await service
    .from('stripe_events_processed')
    .insert({ event_id: event.id, event_type: event.type });
  const alreadyProcessed = dedupError?.code === '23505';
  if (dedupError && !alreadyProcessed) {
    return NextResponse.json({ error: 'Dédup impossible' }, { status: 500 });
  }
  if (alreadyProcessed) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session, service);
        break;
      }
      case 'charge.refunded': {
        await handleRefunded(event.data.object as Stripe.Charge, service);
        break;
      }
      default:
        // Événement écosystème non pertinent pour TYAGA — acquitté silencieusement
        break;
    }
    return NextResponse.json({ received: true });
  } catch {
    // 500 : karma réessaiera ; l'idempotence empêche le double traitement
    return NextResponse.json({ error: 'Traitement échoué' }, { status: 500 });
  }
}

type ServiceClient = ReturnType<typeof createServiceClient>;

/** pending → paid + séquestre posé (fonds sur le solde plateforme). */
async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
  service: ServiceClient
): Promise<void> {
  if (session.payment_status !== 'succeeded' && session.payment_status !== 'paid') return;

  const orderId = session.metadata?.order_id;
  const paymentIntentId =
    typeof session.payment_intent === 'string' ? session.payment_intent : null;
  if (!orderId || !paymentIntentId) return;

  const now = new Date().toISOString();
  // .eq('status','pending') = idempotent : un event rejoué ne retouche pas une commande déjà paid
  const { error } = await service
    .from('marketplace_orders')
    .update({
      status: 'paid',
      escrow_status: 'held',
      stripe_payment_intent_id: paymentIntentId,
      updated_at: now,
    })
    .eq('id', orderId)
    .eq('status', 'pending');

  if (error) throw new Error(`update paid: ${error.code ?? error.message}`);
}

/** Remboursement → séquestre remboursé + commande annulée (system). */
async function handleRefunded(
  charge: Stripe.Charge,
  service: ServiceClient
): Promise<void> {
  const paymentIntentId =
    typeof charge.payment_intent === 'string' ? charge.payment_intent : null;
  if (!paymentIntentId) return;

  const { error } = await service
    .from('marketplace_orders')
    .update({
      status: 'cancelled',
      escrow_status: 'refunded',
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_payment_intent_id', paymentIntentId)
    .in('status', ['paid', 'shipped', 'delivered', 'completed']);

  if (error) throw new Error(`update refunded: ${error.code ?? error.message}`);
}
