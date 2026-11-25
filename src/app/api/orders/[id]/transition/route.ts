import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { z } from 'zod';

import { finalizeCompletedSale } from '@/lib/order-settlement';
import {
  assertTransition,
  TransitionError,
  USER_ACTIONS,
  type OrderStatus,
} from '@/lib/order-transitions';
import { isPhysicalPilotPolicy } from '@/lib/physical-fee-policy';
import { hasPhysicalTestStripeKey } from '@/lib/physical-sale-pilot';
import { rateLimit } from '@/lib/rate-limit';
import { createServiceClient } from '@/lib/service';
import { getStripe } from '@/lib/stripe';
import { createServerSupabaseClient } from '@/lib/supabase-server';

/**
 * EX-E3 — transitions de commande par action de la bonne partie.
 * La RLS et le trigger protègent les transitions client. L'annulation exige
 * un reçu d'expiration puis une RPC serveur atomique. Après `deliver`, le
 * système enchaîne delivered→completed : vente et points atomiques, puis
 * une tentative de virement Connect. Le séquestre reste held tant qu'aucun
 * reçu correspondant n'est enregistré (sauf net vendeur nul).
 */

const bodySchema = z.object({
  action: z.enum(['cancel', 'seller_cancel', 'ship', 'deliver']),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Connecte-toi.' }, { status: 401 });
  }

  const limit = rateLimit(`transition:${user.id}`, 30, 60 * 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: `Trop d’actions. Réessaie dans ${Math.ceil(limit.retryAfterSec / 60)} min.` },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Action inconnue.' }, { status: 400 });
  }

  const { actor, to } = USER_ACTIONS[parsed.data.action];
  // RLS orders_select : lisible uniquement buyer/seller → 404 sinon
  const { data: order } = await supabase
    .from('marketplace_orders')
    .select(
      'id, buyer_id, seller_id, status, escrow_status, amount_cents, stripe_checkout_session_id, fee_policy'
    )
    .eq('id', id)
    .maybeSingle();

  if (!order) {
    return NextResponse.json({ error: 'Commande introuvable.' }, { status: 404 });
  }
  const isBuyer = order.buyer_id === user.id;
  const isSeller = order.seller_id === user.id;
  if ((actor === 'buyer' && !isBuyer) || (actor === 'seller' && !isSeller)) {
    return NextResponse.json(
      { error: 'Seule l’autre partie peut faire cette action.' },
      { status: 403 }
    );
  }

  const pilot = isPhysicalPilotPolicy(order.fee_policy);
  if (pilot && !hasPhysicalTestStripeKey()) {
    return NextResponse.json({ error: 'Cette commande de test requiert le prestataire de recette.' }, { status: 503 });
  }

  // Capture the verified test client before any asynchronous state transition.
  const pilotStripe = pilot ? getStripe() : null;

  // Rejouer `deliver` après un échec de finalisation : la commande est déjà
  // delivered/completed : la RPC sérialise la comptabilité et ne consomme
  // qu'un seul droit de virement. Une reprise rapproche uniquement le reçu.
  if (
    parsed.data.action === 'deliver' &&
    (order.status === 'delivered' || order.status === 'completed')
  ) {
    try {
      const settled = await settleOrder(order.id, user.id, pilotStripe);
      return NextResponse.json(settled, {
        status: settled.settlement.status === 'verification_required' ? 202 : 200,
      });
    } catch (e) {
      console.error(`finalize ${order.id}:`, e);
      return NextResponse.json(
        { error: 'Finalisation toujours en échec. Réessaie dans quelques instants.' },
        { status: 500 }
      );
    }
  }

  try {
    // A prior cancellation may have committed even when its response was lost.
    // Replay still requires the same provider receipt and server-side checks.
    const cancellationReplay = to === 'cancelled' && order.status === 'cancelled'
      && order.escrow_status === 'none';
    if (!cancellationReplay) assertTransition(actor, order.status as OrderStatus, to);
  } catch (e) {
    if (e instanceof TransitionError) {
      return NextResponse.json(
        { error: `Action impossible : commande « ${order.status} ».` },
        { status: 409 }
      );
    }
    throw e;
  }

  if (to === 'cancelled') {
    const review = () => NextResponse.json({
      error: 'L’état du paiement ou de l’annulation attend une vérification. Consulte tes commandes avant de réessayer.',
      status: 'verification_required', orderId: order.id,
    }, { status: 503 });
    // A missing receipt can mean Stripe accepted a request whose response was
    // lost. Never free the listing while that financial outcome is unknown.
    if (!order.stripe_checkout_session_id) return review();
    try {
      const sessions = (pilotStripe ?? getStripe()).checkout.sessions;
      let session: Stripe.Checkout.Session;
      try {
        session = await sessions.expire(order.stripe_checkout_session_id);
      } catch {
        // Expiring an already expired session fails. A lost response can also
        // hide success, so read the same session instead of assuming either.
        session = await sessions.retrieve(order.stripe_checkout_session_id);
      }
      if (session.status === 'complete' || session.payment_status === 'paid') {
        return NextResponse.json({ error: 'Le paiement a déjà été engagé. Cette commande ne peut plus être annulée ici.' }, { status: 409 });
      }
      if (session.id !== order.stripe_checkout_session_id || session.status !== 'expired'
        || session.payment_status !== 'unpaid' || session.mode !== 'payment'
        || session.currency !== 'eur' || session.amount_total !== order.amount_cents
        || (session.client_reference_id !== null && session.client_reference_id !== order.id)
        || session.metadata?.app_slug !== 'tyaga' || session.metadata?.order_id !== order.id
        || session.metadata?.buyer_id !== order.buyer_id || session.metadata?.seller_id !== order.seller_id
        || (pilot && (session.livemode !== false || !/^cs_test_[A-Za-z0-9]+$/.test(session.id)))) {
        return review();
      }
      // Persist only bounded proof fields, never the full provider payload.
      // The RPC rechecks ownership, status and session under a PostgreSQL lock.
      const { data: cancelled, error } = await createServiceClient().rpc('cancel_expired_order', {
        p_order: order.id, p_actor: user.id,
        p_session: { id: session.id, status: session.status, payment_status: session.payment_status,
          mode: session.mode, currency: session.currency, amount_total: session.amount_total,
          client_reference_id: session.client_reference_id, livemode: session.livemode,
          metadata: { app_slug: 'tyaga', order_id: order.id, buyer_id: order.buyer_id, seller_id: order.seller_id } },
      });
      if (error || cancelled?.id !== order.id || cancelled?.status !== 'cancelled' || cancelled?.escrow_status !== 'none') {
        return review();
      }
      return NextResponse.json({ order: cancelled });
    } catch {
      return review();
    }
  }

  const now = new Date().toISOString();
  // RLS + trigger: buyer shipped→delivered, seller paid→shipped.
  const { data: updated, error: updateError } = await supabase
    .from('marketplace_orders')
    .update({ status: to, updated_at: now })
    .eq('id', order.id)
    .eq('status', order.status)
    .select('id, status, escrow_status')
    .single();

  if (updateError || !updated) {
    return NextResponse.json(
      { error: 'Action refusée (transition non autorisée).' },
      { status: 403 }
    );
  }

  // Acheteur a confirmé la réception → le système FINALISE la vente.
  // La commande est déjà `delivered` : si la finalisation échoue on le dit
  // à l'acheteur (il peut rejouer) au lieu de mentir avec un 200.
  if (to === 'delivered') {
    try {
      const settled = await settleOrder(order.id, user.id, pilotStripe);
      return NextResponse.json(settled, {
        status: settled.settlement.status === 'verification_required' ? 202 : 200,
      });
    } catch (e) {
      console.error(`finalize ${order.id}:`, e);
      return NextResponse.json(
        {
          error:
            'Objet marqué reçu, mais la finalisation a échoué. Réessaie dans quelques instants.',
        },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ order: updated });
}

function settleOrder(orderId: string, buyerId: string, pilotStripe: ReturnType<typeof getStripe> | null) {
  return finalizeCompletedSale(orderId, buyerId, {
    store: createServiceClient(),
    getTransfers: () => (pilotStripe ?? getStripe()).transfers,
  });
}
