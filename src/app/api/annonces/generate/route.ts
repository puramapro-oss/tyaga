import { NextResponse } from 'next/server';
import { z } from 'zod';

import { computeCommission, physicalPilotQuote } from '@/lib/commission';
import { CONDITION_LABELS } from '@/lib/labels';
import { canUsePhysicalSalePilot } from '@/lib/physical-sale-pilot';
import { generateListing } from '@/lib/listing-ai';
import { rateLimit } from '@/lib/rate-limit';
import { createServerSupabaseClient } from '@/lib/supabase-server';

/**
 * EX-D1 — génération du brouillon d'annonce (titre + description + tags)
 * à partir du scan et de la DERNIÈRE estimation. Aucune écriture DB ici :
 * le résultat est montré à l'utilisateur AVANT publication (EX-D2).
 */

export const maxDuration = 60;

const bodySchema = z.object({ itemId: z.string().uuid() });

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: 'Connecte-toi pour préparer une annonce.' },
      { status: 401 }
    );
  }

  const limit = rateLimit(`listing:${user.id}`, 10, 60 * 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json(
      {
        error: `Trop de demandes. Réessaie dans ${Math.ceil(limit.retryAfterSec / 60)} min.`,
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
    return NextResponse.json({ error: 'Identifiant objet invalide.' }, { status: 400 });
  }

  // RLS client : lecture possible uniquement si propriétaire
  const { data: item } = await supabase
    .from('items')
    .select('id, user_id, title, category, brand, model, condition, status')
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

  const { data: estimation } = await supabase
    .from('estimations')
    .select('id, price_suggested_cents, price_min_cents, price_max_cents')
    .eq('item_id', item.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!estimation) {
    return NextResponse.json(
      { error: "Estime d'abord l'objet avant de préparer l'annonce." },
      { status: 400 }
    );
  }

  let draft;
  try {
    draft = await generateListing({
      title: item.title ?? '',
      category: item.category ?? '',
      brand: item.brand ?? '',
      model: item.model ?? '',
      condition: item.condition ?? 'bon',
      conditionLabel: CONDITION_LABELS[item.condition ?? 'bon'] ?? 'Bon état',
      priceCents: estimation.price_suggested_cents,
      priceMinCents: estimation.price_min_cents,
      priceMaxCents: estimation.price_max_cents,
    });
  } catch {
    return NextResponse.json(
      {
        error: "La rédaction d'annonce est indisponible pour l'instant. Réessaie dans un instant.",
      },
      { status: 503 }
    );
  }

  // Rien n'est persisté : brouillon retourné, publication = action séparée
  return NextResponse.json({
    draft: { ...draft, price_cents: estimation.price_suggested_cents,
      quote: computeCommission(estimation.price_suggested_cents),
      pilotQuote: await canUsePhysicalSalePilot(supabase) ? physicalPilotQuote(estimation.price_suggested_cents) : null },
  });
}
