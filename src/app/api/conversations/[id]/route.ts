import { NextResponse } from 'next/server';

import { buildSuggestions, type InboxRole } from '@/lib/inbox';
import { createServerSupabaseClient } from '@/lib/supabase-server';

/**
 * EX-F1/F2/F3 — fil d'une conversation : messages persistés (RLS msgs_select :
 * un message bloqué F4 n'est visible que de son envoyeur) + suggestions
 * recalculées à chaque lecture selon le rôle, le plancher et la dernière
 * offre. Pur lecture : l'envoi reste sur POST /messages (jamais automatique).
 */

interface ThreadResponse {
  conversation: {
    id: string;
    role: InboxRole;
    title: string;
    priceCents: number;
    floorCents: number | null;
  };
  messages: {
    id: string;
    senderId: string;
    body: string;
    offerCents: number | null;
    flagged: boolean;
    flagReason: string | null;
    createdAt: string;
  }[];
  suggestions: ReturnType<typeof buildSuggestions>;
}

export async function GET(
  _request: Request,
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

  // RLS convs_select : participant uniquement → 404 sinon
  const { data: conv } = await supabase
    .from('conversations')
    .select(
      `id, buyer_id, seller_id,
       annonces ( title, price_cents, items ( floor_price_cents ) )`
    )
    .eq('id', id)
    .maybeSingle();

  if (!conv) {
    return NextResponse.json({ error: 'Conversation introuvable.' }, { status: 404 });
  }
  const row = conv as unknown as {
    id: string;
    buyer_id: string;
    seller_id: string;
    annonces: { title: string; price_cents: number; items: { floor_price_cents: number | null } | null } | null;
  };
  const role: InboxRole = row.buyer_id === user.id ? 'buyer' : 'seller';
  const priceCents = row.annonces?.price_cents ?? 0;
  const floorCents = row.annonces?.items?.floor_price_cents ?? null;

  const { data: messages, error: msgError } = await supabase
    .from('inbox_messages')
    .select('id, sender_id, body, offer_cents, flagged_off_platform, flag_reason, created_at')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true })
    .limit(200);

  if (msgError) {
    return NextResponse.json(
      { error: 'Impossible de charger les messages. Réessaie dans un instant.' },
      { status: 500 }
    );
  }

  const list = (messages ?? []) as unknown as {
    id: string;
    sender_id: string;
    body: string;
    offer_cents: number | null;
    flagged_off_platform: boolean;
    flag_reason: string | null;
    created_at: string;
  }[];

  // Dernière offre de l'acheteur → pilote les suggestions vendeur (EX-F3)
  let lastOfferCents: number | null = null;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].sender_id === row.buyer_id && list[i].offer_cents !== null) {
      lastOfferCents = list[i].offer_cents;
      break;
    }
  }

  const payload: ThreadResponse = {
    conversation: {
      id: row.id,
      role,
      title: row.annonces?.title ?? 'Annonce',
      priceCents,
      floorCents,
    },
    messages: list.map((m) => ({
      id: m.id,
      senderId: m.sender_id,
      body: m.body,
      offerCents: m.offer_cents,
      flagged: m.flagged_off_platform,
      flagReason: m.flag_reason,
      createdAt: m.created_at,
    })),
    suggestions: buildSuggestions({ role, priceCents, floorCents, lastOfferCents }),
  };
  return NextResponse.json(payload);
}
