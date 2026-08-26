import { NextResponse } from 'next/server';
import { z } from 'zod';

import { fiscalYearParis } from '@/lib/fiscal';
import {
  assertTransition,
  TransitionError,
  USER_ACTIONS,
  type OrderStatus,
} from '@/lib/order-transitions';
import { rateLimit } from '@/lib/rate-limit';
import { payReferralN1 } from '@/lib/referral';
import { createServiceClient } from '@/lib/service';
import { getStripe } from '@/lib/stripe';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { pointsFromNet } from '@/lib/vida';

/**
 * EX-E3 — transitions de commande par action de la bonne partie.
 * La RLS `orders_update` est la garde FINALE ; ce routeur valide avant
 * pour renvoyer des erreurs FR claires. Après `deliver` (acheteur), le
 * système enchaîne delivered→completed : séquestre libéré + ligne `ventes`
 * + virement Connect si le vendeur a un compte.
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
      'id, buyer_id, seller_id, status, escrow_status, stripe_checkout_session_id'
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

  // Rejouer `deliver` après un échec de finalisation : la commande est déjà
  // delivered/completed mais la vente peut manquer → on relance finalize
  // (idempotent) au lieu de renvoyer un 409 à l'acheteur.
  if (
    parsed.data.action === 'deliver' &&
    (order.status === 'delivered' || order.status === 'completed')
  ) {
    try {
      await finalizeCompletedSale(order.id);
    } catch (e) {
      console.error(`finalize ${order.id}:`, e);
      return NextResponse.json(
        { error: 'Finalisation toujours en échec. Réessaie dans quelques instants.' },
        { status: 500 }
      );
    }
    return NextResponse.json({
      order: { id: order.id, status: order.status, escrow_status: order.escrow_status },
    });
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
      await getStripe().checkout.sessions.expire(order.stripe_checkout_session_id);
    } catch {
      // Session déjà payée/expirée : le webhook tranche l'état final.
    }
  }

  // Acheteur a confirmé la réception → le système FINALISE la vente.
  // La commande est déjà `delivered` : si la finalisation échoue on le dit
  // à l'acheteur (il peut rejouer) au lieu de mentir avec un 200.
  if (to === 'delivered') {
    try {
      await finalizeCompletedSale(order.id);
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

/**
 * delivered→completed : séquestre libéré + ventes + wallet + parrainage +
 * retrait de l'annonce + virement Connect (si compte). Idempotent : chaque
 * étape tolère le rejeu (.eq status, UNIQUE order_id). Lève en cas d'échec
 * de commande/vente/crédit — le caller rejouera.
 */
async function finalizeCompletedSale(orderId: string): Promise<void> {
  const service = createServiceClient();

  const { data: order, error: orderError } = await service
    .from('marketplace_orders')
    .select(
      'annonce_id, seller_id, amount_cents, commission_amount_cents, net_amount_cents'
    )
    .eq('id', orderId)
    .single();
  if (orderError || !order) {
    throw new Error(`lecture commande (${orderError?.code ?? 'absente'})`);
  }

  const now = new Date().toISOString();
  const { error: completeError } = await service
    .from('marketplace_orders')
    .update({ status: 'completed', escrow_status: 'released', updated_at: now })
    .eq('id', orderId)
    .eq('status', 'delivered');
  if (completeError) throw new Error(`passage completed (${completeError.code})`);

  // EX-E2 : ligne de vente tracée (commission + net). Unique sur order_id.
  const { error: venteError } = await service.from('ventes').insert({
    order_id: orderId,
    seller_id: order.seller_id,
    gross_amount_cents: order.amount_cents,
    commission_amount_cents: order.commission_amount_cents,
    net_amount_cents: order.net_amount_cents,
    fiscal_year: fiscalYearParis(new Date()),
  });
  if (venteError?.code === '23505') {
    // Vente déjà enregistrée par un essai précédent → pas de double crédit.
  } else if (venteError) {
    throw new Error(`ligne vente (${venteError.code})`);
  } else {
    // EX-H1 : wallet Vida crédité en points (1 pt = 1 € net) uniquement quand
    // la ligne de vente est NOUVELLE. Si le crédit échoue on retire la ligne
    // (compensation) pour qu'un rejeu reparte d'un état propre.
    const points = pointsFromNet(order.net_amount_cents);
    if (points > 0) {
      const { error: creditError } = await service.rpc('credit_wallet', {
        p_user: order.seller_id,
        p_points: points,
      });
      if (creditError) {
        await service.from('ventes').delete().eq('order_id', orderId);
        throw new Error(`crédit wallet (${creditError.code})`);
      }
    }
    // Parrainage V4 N1 : 50 % de la commission au parrain si le vendeur est
    // un filleul à sa première vente complétée — jamais bloquant pour la vente.
    try {
      await payReferralN1(service, order.seller_id, order.commission_amount_cents);
    } catch {
      // Crédit parrain reporté ; flag `commission_paid` garantit l'absence de double paie
    }

    // Objet vendu → l'annonce est retirée de la marketplace (plus visible).
    await service
      .from('annonces')
      .update({ status: 'unpublished', updated_at: now })
      .eq('id', order.annonce_id)
      .eq('status', 'published');
  }

  // Virement Connect si le vendeur a un compte — jamais bloquant pour la vente
  const { data: profile } = await service
    .from('profiles')
    .select('stripe_connect_account_id')
    .eq('id', order.seller_id)
    .single();
  if (!profile?.stripe_connect_account_id) return;

  try {
    const transfer = await getStripe().transfers.create({
      amount: order.net_amount_cents,
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
