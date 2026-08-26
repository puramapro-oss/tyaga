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
  if (existing) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session, service);
        break;
      }
      case 'checkout.session.expired': {
        await handleExpired(event.data.object as Stripe.Checkout.Session, service);
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
    const { data: cancelled } = await service
      .from('marketplace_orders')
      .select('id, status')
      .eq('id', orderId)
      .maybeSingle();
    // Commande introuvable = supprimée : idem, on rembourse.
    if (!cancelled || cancelled.status === 'cancelled') {
      const refund = await getStripe().refunds.create({ payment_intent: paymentIntentId });
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
  service: ServiceClient
): Promise<void> {
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
  service: ServiceClient
): Promise<void> {
  const paymentIntentId =
    typeof charge.payment_intent === 'string' ? charge.payment_intent : null;
  if (!paymentIntentId) return;

  const { data: refunded, error } = await service
    .from('marketplace_orders')
    .update({
      status: 'cancelled',
      escrow_status: 'refunded',
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_payment_intent_id', paymentIntentId)
    .in('status', ['paid', 'shipped', 'delivered', 'completed'])
    .select('id, stripe_transfer_id');

  if (error) throw new Error(`update refunded: ${error.code ?? error.message}`);

  for (const order of refunded ?? []) {
    // Vente complétée déjà créditée (points wallet + ligne ventes) → clawback
    // atomique côté SQL. Idempotent : plus de vente = retour 0, rien à faire.
    const { error: reverseError } = await service.rpc('reverse_sale', {
      p_order: order.id,
    });
    if (reverseError) throw new Error(`reverse_sale ${order.id}: ${reverseError.code}`);

    // Le net a déjà été viré au compte Connect → on l'inverse côté Stripe.
    if (order.stripe_transfer_id) {
      try {
        await getStripe().transfers.createReversal(order.stripe_transfer_id);
      } catch {
        // Inversion impossible (déjà reversée/fonds insuffisants) : la dette
        // reste traçable via la commande refunded + le transfert initial.
      }
    }
  }
}
