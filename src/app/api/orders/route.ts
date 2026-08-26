import { NextResponse } from 'next/server';
import { z } from 'zod';

import { computeCommission } from '@/lib/commission';
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
    .select('id, item_id, user_id, title, price_cents, status')
    .eq('id', annonceId)
    .eq('status', 'published')
    .maybeSingle();

  if (!annonce) {
    return NextResponse.json({ error: 'Annonce introuvable ou retirée.' }, { status: 404 });
  }
  // EX-E1 : acheteur ≠ vendeur (doublure du CHECK DB buyer_neq_seller)
  if (annonce.user_id === user.id) {
    return NextResponse.json(
      { error: 'Tu ne peux pas acheter ton propre objet.' },
      { status: 403 }
    );
  }

  // Une seule commande active par annonce
  const { count: activeCount } = await supabase
    .from('marketplace_orders')
    .select('id', { count: 'exact', head: true })
    .eq('annonce_id', annonceId)
    .in('status', ['pending', 'paid', 'shipped', 'delivered', 'completed']);
  if ((activeCount ?? 0) > 0) {
    return NextResponse.json(
      { error: 'Cet objet a déjà un acheteur en cours.' },
      { status: 409 }
    );
  }

  // Prix négocié (EX-D) : si la conversation avec le vendeur porte une offre
  // de l'acheteur que le vendeur a ACCEPTÉE (même montant), c'est ce prix qui
  // fait foi — sinon on reste au prix de l'annonce.
  let priceCents = annonce.price_cents;
  const { data: conv } = await supabase
    .from('conversations')
    .select('id')
    .eq('annonce_id', annonce.id)
    .eq('buyer_id', user.id)
    .maybeSingle();
  if (conv) {
    // Jury bugs P6 : fenêtre du plus RÉCENT au plus ancien (desc), et l'accept
    // vendeur ne vaut que s'il est plus récent que la dernière offre acheteur.
    const { data: msgs } = await supabase
      .from('inbox_messages')
      .select('sender_id, offer_cents')
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: false })
      .limit(50);
    const desc = msgs ?? [];
    const acceptIdx = desc.findIndex(
      (m) => m.sender_id === annonce.user_id && m.offer_cents !== null
    );
    const offerIdx = desc.findIndex(
      (m) => m.sender_id === user.id && m.offer_cents !== null
    );
    if (acceptIdx !== -1 && offerIdx !== -1 && acceptIdx < offerIdx) {
      const buyerOffer = desc[offerIdx].offer_cents;
      const sellerAccept = desc[acceptIdx].offer_cents;
      if (
        buyerOffer != null &&
        sellerAccept != null &&
        buyerOffer === sellerAccept &&
        buyerOffer >= 100 &&
        buyerOffer <= annonce.price_cents
      ) {
        priceCents = buyerOffer;
      }
    }
  }

  // EX-E2 : commission calculée SERVEUR à la création, tracée en colonnes
  const { grossCents, commissionPct, commissionCents, netCents } = computeCommission(priceCents);

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

  if (orderError?.code === '23505' || !order) {
    // idx_orders_annonce_active : un autre acheteur est passé entre le count
    // et l'insert (fenêtre TOCTOU fermée par l'index unique partiel).
    return NextResponse.json(
      { error: 'Cet objet a déjà un acheteur en cours.' },
      { status: 409 }
    );
  }
  if (orderError) {
    return NextResponse.json(
      { error: 'Commande impossible. Réessaie dans un instant.' },
      { status: 500 }
    );
  }

  // Customer Stripe : création une fois, réutilisation ensuite
  const service = createServiceClient();
  const { data: profile } = await service
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .single();

  const stripe = getStripe();
  let customerId = profile?.stripe_customer_id ?? null;
  try {
    if (!customerId) {
      const customer = await stripe.customers.create({
        metadata: { app_slug: 'tyaga', user_id: user.id },
      });
      customerId = customer.id;
      await service
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', user.id);
    }

    const origin = new URL(request.url).origin;
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customerId,
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
    });

    // Session id hors RLS (WITH CHECK ne couvre pas pending→pending) → service role
    await service
      .from('marketplace_orders')
      .update({ stripe_checkout_session_id: session.id, updated_at: new Date().toISOString() })
      .eq('id', order.id);

    return NextResponse.json({ url: session.url });
  } catch {
    // Pas de session → commande annulée immédiatement (jamais de pending fantôme)
    await service
      .from('marketplace_orders')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', order.id);
    return NextResponse.json(
      { error: 'Paiement indisponible momentanément. Aucun montant n’a été débité.' },
      { status: 502 }
    );
  }
}
