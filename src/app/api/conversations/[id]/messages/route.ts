import { NextResponse } from 'next/server';
import { z } from 'zod';

import { detectOffPlatform } from '@/lib/inbox';
import { rateLimit } from '@/lib/rate-limit';
import { createServiceClient } from '@/lib/service';
import { createServerSupabaseClient } from '@/lib/supabase-server';

/**
 * EX-F4 — envoi d'un message. Tout paiement ou échange de coordonnées hors
 * plateforme est DÉTECTÉ AVANT insertion : le message est persisté
 * `flagged_off_platform = true` (traçabilité, visible de l'envoyeur seul via
 * RLS) et l'API répond 400 avec l'avertissement FR à l'envoyeur — il n'est
 * JAMAIS délivré au destinataire.
 */

const bodySchema = z.object({
  body: z.string().trim().min(1).max(2000),
  offerCents: z.number().int().min(100).max(1_000_000).nullable().optional(),
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

  const limit = rateLimit(`msg-send:${user.id}`, 60, 60 * 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: `Trop de messages envoyés. Réessaie dans ${Math.ceil(limit.retryAfterSec / 60)} min.` },
      { status: 429 }
    );
  }

  // RLS convs_select : participant uniquement → 404 sinon
  const { data: conv } = await supabase
    .from('conversations')
    .select('id, buyer_id, seller_id')
    .eq('id', id)
    .maybeSingle();
  if (!conv) {
    return NextResponse.json({ error: 'Conversation introuvable.' }, { status: 404 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Message invalide (1 à 2000 caractères).' },
      { status: 400 }
    );
  }

  // Offre chiffrée : l'acheteur propose (EX-D) ; le vendeur ne peut en poser
  // une QUE pour ACCEPTER la dernière offre acheteur en cours, au montant
  // exact — la contre-offre vendeur passe par les suggestions (≥ plancher, EX-F3).
  let offerCents: number | null = null;
  if (conv.buyer_id === user.id) {
    offerCents = parsed.data.offerCents ?? null;
  } else if (parsed.data.offerCents != null) {
    const { data: lastBuyerOffer } = await supabase
      .from('inbox_messages')
      .select('offer_cents')
      .eq('conversation_id', conv.id)
      .eq('sender_id', conv.buyer_id)
      .not('offer_cents', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (
      !lastBuyerOffer?.offer_cents ||
      lastBuyerOffer.offer_cents !== parsed.data.offerCents
    ) {
      return NextResponse.json(
        { error: 'Tu ne peux accepter que la dernière offre de l’acheteur, au montant exact.' },
        { status: 400 }
      );
    }
    offerCents = parsed.data.offerCents;
  }

  // EX-F4 : détection hors plateforme AVANT délivrance
  const offPlatform = detectOffPlatform(parsed.data.body);

  const insert = {
    conversation_id: conv.id,
    sender_id: user.id,
    body: parsed.data.body,
    offer_cents: offerCents,
    flagged_off_platform: offPlatform !== null,
    flag_reason: offPlatform?.label ?? null,
  };
  const { data: message, error: insertError } = await supabase
    .from('inbox_messages')
    .insert(insert)
    .select('id, sender_id, body, offer_cents, flagged_off_platform, flag_reason, created_at')
    .single();

  if (insertError || !message) {
    return NextResponse.json(
      { error: 'Envoi impossible. Réessaie dans un instant.' },
      { status: 500 }
    );
  }

  // Fraîcheur de la liste (participant vérifié ci-dessus) — non bloquant
  await createServiceClient()
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conv.id);

  if (offPlatform) {
    return NextResponse.json(
      {
        error: `Message bloqué : ${offPlatform.fr} détecté. Paiement ou contact hors plateforme interdit — tout se passe sur TYAGA (paiement sécurisé, vendeur payé après réception).`,
        flagged: true,
        message,
      },
      { status: 400 }
    );
  }
  return NextResponse.json({ message }, { status: 201 });
}
