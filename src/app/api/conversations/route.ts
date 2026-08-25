import { NextResponse } from 'next/server';
import { z } from 'zod';

import { rateLimit } from '@/lib/rate-limit';
import { createServerSupabaseClient } from '@/lib/supabase-server';

/**
 * EX-F1 — conversations par annonce. GET = mes conversations (RLS
 * convs_select : participant uniquement). POST = trouver ou créer la
 * conversation d'une annonce publiée (l'acheteur initie, jamais le vendeur
 * avec lui-même ; UNIQUE(annonce_id, buyer_id) + re-sélection en cas de
 * course).
 */

const postSchema = z.object({ annonceId: z.string().uuid() });

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Connecte-toi.' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('conversations')
    .select(
      `id, buyer_id, seller_id, updated_at,
       annonces ( id, title, price_cents )`
    )
    .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
    .order('updated_at', { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json(
      { error: 'Impossible de charger tes messages. Réessaie dans un instant.' },
      { status: 500 }
    );
  }
  return NextResponse.json({ conversations: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Connecte-toi.' }, { status: 401 });
  }

  const limit = rateLimit(`conv-create:${user.id}`, 30, 60 * 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: `Trop de demandes. Réessaie dans ${Math.ceil(limit.retryAfterSec / 60)} min.` },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 });
  }
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Annonce inconnue.' }, { status: 400 });
  }

  // RLS annonces_select : publiée uniquement pour les autres utilisateurs
  const { data: annonce } = await supabase
    .from('annonces')
    .select('id, user_id')
    .eq('id', parsed.data.annonceId)
    .eq('status', 'published')
    .maybeSingle();
  if (!annonce) {
    return NextResponse.json({ error: 'Annonce introuvable.' }, { status: 404 });
  }
  if (annonce.user_id === user.id) {
    return NextResponse.json(
      { error: 'C’est ton annonce : pas besoin de te contacter.' },
      { status: 400 }
    );
  }

  const { data: existing } = await supabase
    .from('conversations')
    .select('id')
    .eq('annonce_id', annonce.id)
    .eq('buyer_id', user.id)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ conversationId: existing.id });
  }

  // RLS convs_insert : buyer_id = auth.uid() uniquement
  const { data: created, error: insertError } = await supabase
    .from('conversations')
    .insert({ annonce_id: annonce.id, buyer_id: user.id, seller_id: annonce.user_id })
    .select('id')
    .single();

  if (insertError) {
    // Course sur UNIQUE(annonce_id, buyer_id) → la conversation existe déjà
    if (insertError.code === '23505') {
      const { data: race } = await supabase
        .from('conversations')
        .select('id')
        .eq('annonce_id', annonce.id)
        .eq('buyer_id', user.id)
        .maybeSingle();
      if (race) return NextResponse.json({ conversationId: race.id });
    }
    return NextResponse.json(
      { error: 'Impossible d’ouvrir la conversation. Réessaie dans un instant.' },
      { status: 500 }
    );
  }
  return NextResponse.json({ conversationId: created.id }, { status: 201 });
}
