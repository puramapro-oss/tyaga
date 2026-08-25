import { NextResponse } from 'next/server';
import { z } from 'zod';

import { buildExportText } from '@/lib/listing';
import { rateLimit } from '@/lib/rate-limit';
import { createServerSupabaseClient } from '@/lib/supabase-server';

/**
 * EX-D2/D3/D4 — publication d'annonce. La publication est un acte EXPLICITE :
 * user_validated=true exigé dans le corps (le client ne peut pas publier sans
 * avoir coché la validation). Une seule annonce publiée par objet à la fois.
 */

const bodySchema = z.object({
  itemId: z.string().uuid(),
  title: z.string().trim().min(3).max(70),
  description: z.string().trim().min(20).max(1200),
  tags: z.array(z.string().trim().min(2).max(24)).max(5),
  // EX-D2 : true OBLIGATOIRE — aucun published sans action utilisateur
  userValidated: z.literal(true),
});

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: 'Connecte-toi pour publier une annonce.' },
      { status: 401 }
    );
  }

  const limit = rateLimit(`publish:${user.id}`, 20, 60 * 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json(
      {
        error: `Trop de publications. Réessaie dans ${Math.ceil(limit.retryAfterSec / 60)} min.`,
      },
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
      {
        error:
          parsed.error.issues[0]?.path[0] === 'userValidated'
            ? 'Validation requise avant publication.'
            : 'Annonce invalide — vérifie le titre, la description et les tags.',
      },
      { status: 400 }
    );
  }

  // RLS client : lecture possible uniquement si propriétaire
  const { data: item } = await supabase
    .from('items')
    .select('id, user_id, status')
    .eq('id', parsed.data.itemId)
    .eq('user_id', user.id)
    .single();

  if (!item) {
    return NextResponse.json({ error: 'Objet introuvable.' }, { status: 404 });
  }
  if (item.status === 'draft') {
    return NextResponse.json(
      { error: "Enregistre d'abord la fiche de l'objet (scan)." },
      { status: 400 }
    );
  }

  // Prix de publication = dernière estimation (une seule source de vérité)
  const { data: estimation } = await supabase
    .from('estimations')
    .select('id, price_suggested_cents')
    .eq('item_id', item.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!estimation) {
    return NextResponse.json(
      { error: "Estime d'abord l'objet avant de publier." },
      { status: 400 }
    );
  }

  // Une seule annonce publiée par objet
  const { data: existing } = await supabase
    .from('annonces')
    .select('id')
    .eq('item_id', item.id)
    .eq('status', 'published')
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      { error: 'Cet objet a déjà une annonce publiée.' },
      { status: 409 }
    );
  }

  const { title, description, tags } = parsed.data;
  // EX-D4 : export texte formaté serveur, stocké une fois
  const exportText = buildExportText({
    title,
    description,
    tags,
    priceCents: estimation.price_suggested_cents,
  });

  const { data: annonce, error: insertError } = await supabase
    .from('annonces')
    .insert({
      item_id: item.id,
      user_id: user.id,
      estimation_id: estimation.id,
      title,
      description,
      tags,
      price_cents: estimation.price_suggested_cents,
      status: 'published', // direct : validated puis published en un acte utilisateur
      user_validated: true, // exigé par le corps + la policy RLS annonces_insert
      published_at: new Date().toISOString(),
      export_text: exportText,
    })
    .select('id, title, price_cents, status, export_text')
    .single();

  if (insertError || !annonce) {
    return NextResponse.json(
      { error: 'Publication impossible. Réessaie dans un instant.' },
      { status: 500 }
    );
  }

  // Progression : estimated → listed (jamais de retour arrière)
  if (item.status === 'estimated' || item.status === 'scanned') {
    await supabase
      .from('items')
      .update({ status: 'listed' })
      .eq('id', item.id)
      .eq('user_id', user.id);
  }

  return NextResponse.json({ annonce });
}
