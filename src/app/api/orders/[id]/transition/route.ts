import { NextResponse } from 'next/server';
import { z } from 'zod';

import { finalizeCompletedSale } from '@/lib/order-settlement';
import {
  assertTransition,
  TransitionError,
  USER_ACTIONS,
  type OrderStatus,
} from '@/lib/order-transitions';
import { hasPhysicalTestStripeKey, PHYSICAL_PILOT_POLICY } from '@/lib/physical-sale-pilot';
import { rateLimit } from '@/lib/rate-limit';
import { createServiceClient } from '@/lib/service';
import { getStripe } from '@/lib/stripe';
import { createServerSupabaseClient } from '@/lib/supabase-server';

/**
 * EX-E3 — transitions de commande par action de la bonne partie.
 * La RLS `orders_update` est la garde FINALE ; ce routeur valide avant
 * pour renvoyer des erreurs FR claires. Après `deliver` (acheteur), le
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
      'id, buyer_id, seller_id, status, escrow_status, stripe_checkout_session_id, fee_policy'
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

  const pilot = order.fee_policy === PHYSICAL_PILOT_POLICY;
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
    assertTransition(actor, order.status as OrderStatus, to);
  } catch (e) {
    if (e instanceof TransitionError) {
      return NextResponse.json(
        { error: `Action impossible : commande « ${order.status} ».` },
        { status: 409 }
      );
    }
    throw e;
  }

  const now = new Date().toISOString();
  // Garde finale = RLS : buyer pending→cancelled / shipped→delivered,
  // seller paid→shipped / pending→cancelled
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

  // Annulation avant paiement → on ferme la session Checkout qui traîne
  // (sinon l'acheteur pourrait payer une commande annulée ; le webhook
  // `checkout.session.expired` est le filet de secours). Best-effort.
  if (to === 'cancelled' && order.status === 'pending' && order.stripe_checkout_session_id) {
    try {
      await (pilotStripe ?? getStripe()).checkout.sessions.expire(order.stripe_checkout_session_id);
    } catch {
      // Session déjà payée/expirée : le webhook tranche l'état final.
    }
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
