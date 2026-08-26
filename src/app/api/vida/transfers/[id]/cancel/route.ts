import { NextResponse } from 'next/server';

import { rateLimit } from '@/lib/rate-limit';
import { createServerSupabaseClient } from '@/lib/supabase-server';

/** EX-H3 — annulation d'une proposition encore ouverte (aucun point bouge). */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Connecte-toi pour annuler un transfert.' }, { status: 401 });
  }

  const limit = rateLimit(`vida-cancel:${user.id}`, 20, 60 * 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: `Trop de tentatives. Réessaie dans ${Math.ceil(limit.retryAfterSec / 60)} min.` },
      { status: 429 }
    );
  }

  // RLS transfers_update : propre + toujours 'proposed' (un transfert confirmé
  // est définitif, aucun retour arrière silencieux).
  const { data: transfer, error } = await supabase
    .from('vida_transfers')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('status', 'proposed')
    .select('id, status')
    .maybeSingle();

  if (error || !transfer) {
    return NextResponse.json(
      { error: 'Proposition introuvable ou déjà traitée.' },
      { status: 404 }
    );
  }
  return NextResponse.json({ transfer });
}
