import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { z } from 'zod';

import { createPhysicalPilotCheckout } from '@/lib/physical-pilot-checkout';
import { isPhysicalPilotPolicy } from '@/lib/physical-fee-policy';
import { physicalOrderQuote, sameSaleQuote } from '@/lib/physical-order-quote';
import { expectedSaleQuote } from '@/lib/sale-quote-input';
import { rateLimit } from '@/lib/rate-limit';
import { createServiceClient } from '@/lib/service';
import { getStripe } from '@/lib/stripe';
import { createServerSupabaseClient } from '@/lib/supabase-server';

/**
 * EX-E1 — achat : crée la commande (pending) puis une Checkout Session Stripe.
 * Fonds vers le solde plateforme au paiement = SÉQUESTRE (escrow_status 'held'
 * posé par le webhook). Acheteur ≠ vendeur (CHECK DB + double validation API).
 */

const addressSchema = z.object({
  fullName: z.string().trim().min(3).max(80),
  line1: z.string().trim().min(4).max(120),
  line2: z.string().trim().max(120).optional(),
  postalCode: z.string().trim().regex(/^\d{4,6}$/),
  city: z.string().trim().min(2).max(60),
  country: z.string().trim().length(2).toUpperCase(),
});

const bodySchema = z.object({
  annonceId: z.string().uuid(),
  expectedQuote: expectedSaleQuote,
  shippingAddress: addressSchema,
});

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: 'Connecte-toi pour acheter.' },
      { status: 401 }
    );
  }

  const limit = rateLimit(`order:${user.id}`, 10, 60 * 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: `Trop de tentatives. Réessaie dans ${Math.ceil(limit.retryAfterSec / 60)} min.` },
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
    return NextResponse.json(
      { error: 'Adresse de livraison incomplète — vérifie chaque champ.' },
      { status: 400 }
    );
  }
  const { annonceId, shippingAddress } = parsed.data;

  // Annonce publiée uniquement (RLS annonces_select)
  const { data: annonce } = await supabase
    .from('annonces')
    .select('id, item_id, user_id, title, price_cents, status, fee_policy')
    .eq('id', annonceId)
    .eq('status', 'published')
    .maybeSingle();

  if (!annonce) {
    return NextResponse.json({ error: 'Annonce introuvable ou retirée.' }, { status: 404 });
  }
  if (!annonce.item_id) {
    return NextResponse.json(
      { error: 'La commande avec livraison est réservée aux offres de vente d’objets physiques.' },
      { status: 409 }
    );
  }
  // EX-E1 : acheteur ≠ vendeur (doublure du CHECK DB buyer_neq_seller)
  if (annonce.user_id === user.id) {
    return NextResponse.json(
      { error: 'Tu ne peux pas acheter ton propre objet.' },
      { status: 403 }
    );
  }

  const quote = await physicalOrderQuote(supabase, annonce, user.id);
  if (!quote) {
    return NextResponse.json({ error: 'Impossible de vérifier le prix convenu. Réessaie.' }, { status: 503 });
  }
  const pilot = isPhysicalPilotPolicy(annonce.fee_policy);
  if ((pilot && !parsed.data.expectedQuote) || (parsed.data.expectedQuote && !sameSaleQuote(parsed.data.expectedQuote, quote))) {
    return NextResponse.json({
      error: 'Les montants ont changé. Vérifie le nouveau détail avant de confirmer.',
      quote,
    }, { status: 409 });
  }
  if (pilot) return createPhysicalPilotCheckout(supabase, annonce, user.id, quote, shippingAddress);

  const verificationRequired = (orderId?: string) => NextResponse.json({
    error: 'Le paiement attend une vérification. Consulte tes commandes avant une nouvelle tentative.',
    status: 'verification_required', ...(orderId ? { orderId } : {}),
  }, { status: 503 });
  const conflict = () => NextResponse.json({
    error: 'Cet objet a déjà une commande en cours. Consulte tes commandes.',
  }, { status: 409 });
  const validSession = (session: Stripe.Checkout.Session, orderId: string, historical = false) =>
    /^cs_[A-Za-z0-9_]+$/.test(session.id) && session.mode === 'payment'
    && session.currency === 'eur' && session.amount_total === quote.grossCents
    && (session.client_reference_id === orderId || (historical && session.client_reference_id == null))
    && session.metadata?.app_slug === 'tyaga' && session.metadata?.order_id === orderId
    && session.metadata?.buyer_id === user.id && session.metadata?.seller_id === annonce.user_id;

  const resumePendingCheckout = async () => {
    const { data: prior, error } = await supabase.from('marketplace_orders')
      .select('id, buyer_id, seller_id, amount_cents, commission_pct, commission_amount_cents, net_amount_cents, shipping_address, stripe_checkout_session_id, fee_policy')
      .eq('annonce_id', annonceId).eq('buyer_id', user.id).eq('status', 'pending').maybeSingle();
    if (error) return verificationRequired();
    if (!prior || prior.buyer_id !== user.id || prior.seller_id !== annonce.user_id || prior.fee_policy !== 'legacy') return conflict();
    const addressMatches = prior.shipping_address && Object.keys({ ...shippingAddress, ...prior.shipping_address })
      .every(key => prior.shipping_address[key] === shippingAddress[key as keyof typeof shippingAddress]);
    if (!addressMatches || !sameSaleQuote(quote, {
      grossCents: prior.amount_cents, commissionPct: prior.commission_pct,
      commissionCents: prior.commission_amount_cents, netCents: prior.net_amount_cents,
    })) return conflict();
    // Historical pending rows do not prove that an idempotency key was used.
    // No new create, including after Stripe's retention window: only read a
    // session already bound to this buyer and immutable order.
    if (!prior.stripe_checkout_session_id) return verificationRequired(prior.id);
    try {
      const session = await getStripe().checkout.sessions.retrieve(prior.stripe_checkout_session_id);
      if (session.id !== prior.stripe_checkout_session_id || !validSession(session, prior.id, true)) {
        return verificationRequired(prior.id);
      }
      if (session.status !== 'open' || !session.url) return NextResponse.json({
        error: 'Cette session de paiement est terminée. Consulte tes commandes.',
      }, { status: 409 });
      return NextResponse.json({ url: session.url });
    } catch {
      return verificationRequired(prior.id);
    }
  };

  // Une seule commande active par annonce
  const { count: activeCount, error: activeError } = await supabase
    .from('marketplace_orders')
    .select('id', { count: 'exact', head: true })
    .eq('annonce_id', annonceId)
    .in('status', ['pending', 'paid', 'shipped', 'delivered', 'completed']);
  if (activeError || activeCount === null) return verificationRequired();
  if (activeCount > 0) return resumePendingCheckout();

  const { grossCents, commissionPct, commissionCents, netCents } = quote;

  // RLS orders_insert : buyer + status pending ✓
  const { data: order, error: orderError } = await supabase
    .from('marketplace_orders')
    .insert({
      annonce_id: annonce.id,
      item_id: annonce.item_id,
      buyer_id: user.id,
      seller_id: annonce.user_id,
      amount_cents: grossCents,
      commission_pct: commissionPct,
      commission_amount_cents: commissionCents,
      net_amount_cents: netCents,
      status: 'pending',
      escrow_status: 'none',
      shipping_address: shippingAddress,
    })
    .select('id')
    .single();

  if (orderError?.code === '23505') {
    // idx_orders_annonce_active : un autre acheteur est passé entre le count
    // et l'insert (fenêtre TOCTOU fermée par l'index unique partiel).
    return resumePendingCheckout();
  }
  if (orderError || !order) {
    return NextResponse.json(
      { error: 'Commande impossible. Réessaie dans un instant.' },
      { status: 500 }
    );
  }

  // Customer Stripe : création une fois, réutilisation ensuite
  const service = createServiceClient();
  let checkoutAttempted = false;
  try {
    const { data: profile, error: profileError } = await service
      .from('profiles').select('stripe_customer_id').eq('id', user.id).single();
    if (profileError || !profile) throw new Error('Profil de paiement indisponible.');
    const stripe = getStripe();
    let customerId = profile.stripe_customer_id ?? null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        metadata: { app_slug: 'tyaga', user_id: user.id },
      }, { idempotencyKey: `tyaga:customer:v1:${user.id}` });
      customerId = customer.id;
      const { data: savedCustomer, error: customerError } = await service
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', user.id).select('id').maybeSingle();
      if (customerError || !savedCustomer) throw new Error('Profil de paiement non enregistré.');
    }

    const origin = new URL(request.url).origin;
    checkoutAttempted = true;
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customerId,
      client_reference_id: order.id,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'eur',
            unit_amount: grossCents,
            product_data: { name: annonce.title.slice(0, 100) },
          },
        },
      ],
      // EX-E4 : routage karma par metadata.app_slug = "tyaga"
      metadata: {
        app_slug: 'tyaga',
        order_id: order.id,
        buyer_id: user.id,
        seller_id: annonce.user_id,
      },
      payment_intent_data: {
        metadata: {
          app_slug: 'tyaga',
          order_id: order.id,
          buyer_id: user.id,
          seller_id: annonce.user_id,
        },
      },
      success_url: `${origin}/commandes?paiement=ok`,
      cancel_url: `${origin}/marketplace/${annonce.id}?annule=1`,
    }, { idempotencyKey: `tyaga:checkout:v1:${order.id}` });

    if (!validSession(session, order.id) || session.status !== 'open' || !session.url) {
      return verificationRequired(order.id);
    }

    // Session id hors RLS (WITH CHECK ne couvre pas pending→pending) → service role
    const { data: saved, error: saveError } = await service
      .from('marketplace_orders')
      .update({ stripe_checkout_session_id: session.id, updated_at: new Date().toISOString() })
      .eq('id', order.id).eq('status', 'pending').is('stripe_checkout_session_id', null)
      .select('id').maybeSingle();
    if (saveError || !saved) return verificationRequired(order.id);

    return NextResponse.json({ url: session.url });
  } catch {
    // A rejected/lost provider response does not prove that no session exists.
    // Preserve the active order so a retry cannot emit a second checkout.
    if (!checkoutAttempted) {
      try {
        const { data: cancelled, error: cancelError } = await service.from('marketplace_orders')
          .update({ status: 'cancelled', updated_at: new Date().toISOString() })
          .eq('id', order.id).eq('status', 'pending').is('stripe_checkout_session_id', null)
          .select('id').maybeSingle();
        if (cancelError || cancelled?.id !== order.id) return verificationRequired(order.id);
      } catch {
        return verificationRequired(order.id);
      }
      return NextResponse.json({ error: 'Paiement indisponible momentanément. Réessaie dans un instant.' }, { status: 503 });
    }
    return verificationRequired(order.id);
  }
}
