import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  assertTransition,
  TransitionError,
  USER_ACTIONS,
  type OrderStatus,
} from '@/lib/order-transitions';
import { rateLimit } from '@/lib/rate-limit';
import { createServiceClient } from '@/lib/service';
import { getStripe } from '@/lib/stripe';
import { createServerSupabaseClient } from '@/lib/supabase-server';

/**
 * EX-E3 — transitions de commande par action de la bonne partie.
 * La RLS `orders_update` est la garde FINALE ; ce routeur valide avant
 * pour renvoyer des erreurs FR claires. Après `deliver` (acheteur), le
 * système enchaîne delivered→completed : séquestre libéré + ligne `ventes`
 * + virement Connect si le vendeur a un compte.
 */

const bodySchema = z.object({
  action: z.enum(['cancel', 'ship', 'deliver']),
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
      'id, buyer_id, seller_id, status, escrow_status, amount_cents, commission_amount_cents, net_amount_cents'
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
  // Garde finale = RLS : buyer pending→cancelled, buyer shipped→delivered, seller paid→shipped
  const { data: updated, error: updateError } = await supabase
    .from('marketplace_orders')
    .update({ status: to, updated_at: now })
    .eq('id', order.id)
    .select('id, status, escrow_status')
    .single();

  if (updateError || !updated) {
    return NextResponse.json(
      { error: 'Action refusée (transition non autorisée).' },
      { status: 403 }
    );
  }

  // Acheteur a confirmé la réception → le système FINALISE la vente
  if (to === 'delivered') {
    await finalizeCompletedSale(order.id, order.net_amount_cents, order.seller_id);
  }

  return NextResponse.json({ order: updated });
}

/** delivered→completed : séquestre libéré + ventes + virement Connect (si compte). */
async function finalizeCompletedSale(
  orderId: string,
  netCents: number,
  sellerId: string
): Promise<void> {
  const service = createServiceClient();

  const { data: order, error: orderError } = await service
    .from('marketplace_orders')
    .select('amount_cents, commission_amount_cents, net_amount_cents')
    .eq('id', orderId)
    .single();
  if (orderError || !order) return;

  const now = new Date().toISOString();
  const { error: completeError } = await service
    .from('marketplace_orders')
    .update({ status: 'completed', escrow_status: 'released', updated_at: now })
    .eq('id', orderId)
    .eq('status', 'delivered');
  if (completeError) return;

  // EX-E2 : ligne de vente tracée (commission + net). Unique sur order_id.
  const { error: venteError } = await service.from('ventes').insert({
    order_id: orderId,
    seller_id: sellerId,
    gross_amount_cents: order.amount_cents,
    commission_amount_cents: order.commission_amount_cents,
    net_amount_cents: order.net_amount_cents,
    fiscal_year: new Date().getFullYear(),
  });
  if (venteError?.code !== '23505' && venteError) return;

  // Virement Connect si le vendeur a un compte — jamais bloquant pour la vente
  const { data: profile } = await service
    .from('profiles')
    .select('stripe_connect_account_id')
    .eq('id', sellerId)
    .single();
  if (!profile?.stripe_connect_account_id) return;

  try {
    const transfer = await getStripe().transfers.create({
      amount: netCents,
      currency: 'eur',
      destination: profile.stripe_connect_account_id,
      metadata: { app_slug: 'tyaga', order_id: orderId },
    });
    await service
      .from('marketplace_orders')
      .update({ stripe_transfer_id: transfer.id, updated_at: now })
      .eq('id', orderId);
  } catch {
    // Virement reporté (solde/limites) : vente reste completed, transfert rejouable
  }
}
