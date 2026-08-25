import { NextResponse } from 'next/server';
import { z } from 'zod';

import { rateLimit } from '@/lib/rate-limit';
import { createServerSupabaseClient } from '@/lib/supabase-server';

/**
 * EX-F3 — prix plancher du vendeur, par objet. Sert AUSSI à la négociation :
 * les suggestions de contre-prix ne descendent jamais dessous (lib/inbox).
 * RLS items_update : propriétaire uniquement — la garde finale est là.
 */

const bodySchema = z.object({
  floorCents: z.number().int().min(100).max(1_000_000).nullable(),
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

  const limit = rateLimit(`floor:${user.id}`, 30, 60 * 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: `Trop de changements. Réessaie dans ${Math.ceil(limit.retryAfterSec / 60)} min.` },
      { status: 429 }
    );
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
      { error: 'Plancher invalide (entre 1 € et 10 000 €).' },
      { status: 400 }
    );
  }

  // RLS items_update (user_id = auth.uid()) : un objet d'autrui = 0 ligne
  const { data: updated, error } = await supabase
    .from('items')
    .update({ floor_price_cents: parsed.data.floorCents, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id, floor_price_cents')
    .single();

  if (error || !updated) {
    return NextResponse.json({ error: 'Objet introuvable.' }, { status: 404 });
  }
  return NextResponse.json({ item: updated });
}
