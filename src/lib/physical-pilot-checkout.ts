import { NextResponse } from 'next/server';

import type { CommissionBreakdown } from './commission';
import { canUsePhysicalSalePilot, PHYSICAL_PILOT_POLICY, physicalPilotTestOrigin } from './physical-sale-pilot';
import { createServiceClient } from './service';
import { getStripe } from './stripe';
import type { createServerSupabaseClient } from './supabase-server';

type UserDb = Awaited<ReturnType<typeof createServerSupabaseClient>>;
type Address = { fullName: string; line1: string; line2?: string; postalCode: string; city: string; country: string };

const orderColumns = 'id, amount_cents, fee_policy, item_amount_cents, buyer_fee_cents, shipping_address, stripe_checkout_session_id, created_at';
const unavailable = () => NextResponse.json({ error: 'La recette de paiement est momentanément indisponible.' }, { status: 503 });

export async function createPhysicalPilotCheckout(
  client: UserDb,
  listing: { id: string; item_id: string; user_id: string; title: string },
  buyerId: string,
  quote: CommissionBreakdown,
  address: Address,
) {
  const origin = physicalPilotTestOrigin();
  if (!origin || !await canUsePhysicalSalePilot(client) || address.country !== 'FR') {
    return NextResponse.json({ error: 'Ce paiement de recette est réservé aux participants qualifiés en France.' }, { status: 403 });
  }
  if (quote.policy !== PHYSICAL_PILOT_POLICY || !quote.itemCents || !quote.buyerFeeCents) return unavailable();

  const service = createServiceClient();
  const { data: seller, error: sellerError } = await service.from('profiles')
    .select('stripe_connect_account_id').eq('id', listing.user_id).maybeSingle();
  if (sellerError || !seller?.stripe_connect_account_id) return unavailable();

  const stripe = getStripe();
  try {
    const account = await stripe.accounts.retrieve(seller.stripe_connect_account_id);
    if (account.country !== 'FR' || account.capabilities?.transfers !== 'active' || !account.payouts_enabled) {
      return unavailable();
    }
  } catch {
    return unavailable();
  }

  const { data: inserted, error } = await client.from('marketplace_orders').insert({
    annonce_id: listing.id, item_id: listing.item_id, buyer_id: buyerId, seller_id: listing.user_id,
    fee_policy: PHYSICAL_PILOT_POLICY, item_amount_cents: quote.itemCents, buyer_fee_cents: quote.buyerFeeCents,
    amount_cents: quote.grossCents, commission_pct: 0, commission_amount_cents: 0, net_amount_cents: quote.netCents,
    status: 'pending', escrow_status: 'none', shipping_address: address,
  }).select(orderColumns).single();

  let order = inserted;
  if (error?.code === '23505') {
    const { data: prior, error: lookupError } = await client.from('marketplace_orders')
      .select(orderColumns).eq('annonce_id', listing.id).eq('buyer_id', buyerId).eq('status', 'pending').maybeSingle();
    if (lookupError) return unavailable();
    const addressMatches = prior && Object.keys({ ...address, ...prior.shipping_address }).every(
      key => prior.shipping_address?.[key] === address[key as keyof Address],
    );
    if (!prior || prior.fee_policy !== PHYSICAL_PILOT_POLICY || prior.item_amount_cents !== quote.itemCents ||
        prior.buyer_fee_cents !== quote.buyerFeeCents || prior.amount_cents !== quote.grossCents || !addressMatches) {
      return NextResponse.json({ error: 'Une commande existe déjà pour cet objet. Consulte tes commandes.' }, { status: 409 });
    }
    order = prior;
  } else if (error) {
    if (error.code === '42501') return NextResponse.json({ error: 'Participation au pilote indisponible.' }, { status: 403 });
    if (error.code === '23514') return NextResponse.json({ error: 'Le prix ou les conditions ont changé. Ouvre de nouveau l’annonce.' }, { status: 409 });
    return unavailable();
  }
  if (!order) return unavailable();

  const metadata = { app_slug: 'tyaga', order_id: order.id, buyer_id: buyerId, seller_id: listing.user_id, fee_policy: PHYSICAL_PILOT_POLICY };
  try {
    // If the first response was lost, use the same parameters and Stripe key.
    // Beyond its retention window, never create a second provider session.
    if (!order.stripe_checkout_session_id && Date.now() - Date.parse(order.created_at) >= 23 * 3600_000) return unavailable();
    const session = order.stripe_checkout_session_id
      ? await stripe.checkout.sessions.retrieve(order.stripe_checkout_session_id)
      : await stripe.checkout.sessions.create({
          mode: 'payment', payment_method_types: ['card'], client_reference_id: order.id, metadata,
          // Identity, amount and line labels remain stable on retry even if the listing is renamed.
          line_items: [
            { quantity: 1, price_data: { currency: 'eur', unit_amount: quote.itemCents, product_data: { name: 'Article TYAGA · recette française' } } },
            { quantity: 1, price_data: { currency: 'eur', unit_amount: quote.buyerFeeCents, product_data: { name: 'Frais de service acheteur · recette française' } } },
          ],
          payment_intent_data: { metadata, transfer_group: 'tyaga_order_' + order.id },
          success_url: origin + '/commandes?paiement=retour-test',
          cancel_url: origin + '/marketplace/' + listing.id,
        }, { idempotencyKey: 'tyaga:physical-fee-test:' + order.id });
    if (session.livemode !== false || !session.id.startsWith('cs_test_') || session.client_reference_id !== order.id ||
        session.amount_total !== quote.grossCents || session.currency !== 'eur' || session.mode !== 'payment' ||
        Object.entries(metadata).some(([key, value]) => session.metadata?.[key] !== value)) return unavailable();
    if (session.status !== 'open' || !session.url) {
      return NextResponse.json({ error: 'Cette session de recette est terminée. Consulte tes commandes.' }, { status: 409 });
    }
    if (!order.stripe_checkout_session_id) {
      const { data: saved, error: saveError } = await service.from('marketplace_orders')
        .update({ stripe_checkout_session_id: session.id }).eq('id', order.id)
        .eq('status', 'pending').eq('fee_policy', PHYSICAL_PILOT_POLICY)
        .select('id').maybeSingle();
      if (saveError || !saved) return unavailable();
    }
    return NextResponse.json({ url: session.url });
  } catch {
    // A provider timeout may follow a successful write. Preserve the pending
    // row so the same buyer can safely resume with the original idempotency key.
    return unavailable();
  }
}
