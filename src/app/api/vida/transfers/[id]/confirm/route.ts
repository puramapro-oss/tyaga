import { NextResponse } from 'next/server';

import { rateLimit } from '@/lib/rate-limit';
import { createServerSupabaseClient } from '@/lib/supabase-server';

/**
 * EX-H3 — confirmation EXPLICITE d'une proposition de transfert.
 * Délègue à `tyaga.confirm_transfer` (atomique, sous RLS) : débit wallet →
 * crédit objectif → statut confirmed, ou rien. Jamais automatique.
 */
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
    return NextResponse.json({ error: 'Connecte-toi pour confirmer un transfert.' }, { status: 401 });
  }

  const limit = rateLimit(`vida-confirm:${user.id}`, 20, 60 * 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: `Trop de tentatives. Réessaie dans ${Math.ceil(limit.retryAfterSec / 60)} min.` },
      { status: 429 }
    );
  }

  const { data: result, error: rpcError } = await supabase.rpc('confirm_transfer', {
    p_transfer: id,
  });

  if (rpcError) {
    return NextResponse.json(
      { error: 'Confirmation impossible. Réessaie dans un instant.' },
      { status: 500 }
    );
  }
  const code = Number(result);
  if (code === 0) {
    return NextResponse.json(
      { error: 'Proposition introuvable ou déjà traitée.' },
      { status: 404 }
    );
  }
  if (code === -1) {
    return NextResponse.json(
      { error: 'Solde wallet insuffisant — la proposition reste ouverte, vérifie tes points.' },
      { status: 409 }
    );
  }
  if (code === -2) {
    return NextResponse.json(
      { error: 'Objectif introuvable ou archivé — recrée ta proposition vers un objectif actif.' },
      { status: 409 }
    );
  }
  if (code !== 1) {
    return NextResponse.json({ error: 'Confirmation impossible.' }, { status: 500 });
  }

  const { data: transfer } = await supabase
    .from('vida_transfers')
    .select('id, pct, points_amount, objectif_id, status, confirmed_at')
    .eq('id', id)
    .single();
  return NextResponse.json({ transfer });
}
