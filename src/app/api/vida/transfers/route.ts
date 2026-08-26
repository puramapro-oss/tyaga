import { NextResponse } from 'next/server';
import { z } from 'zod';

import { rateLimit } from '@/lib/rate-limit';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { isTransferPct, transferPoints } from '@/lib/vida';

/**
 * EX-H2/EX-H3 — proposition de transfert vers un objectif Vida.
 * Le montant est TOUJOURS recalculé serveur depuis le net de la vente ;
 * le client ne choisit que le pourcentage. Statut initial 'proposed' —
 * rien ne bouge tant que la confirmation explicite n'est pas donnée.
 */

const bodySchema = z.object({
  venteId: z.string().uuid(),
  pct: z.number().int().refine(isTransferPct, 'Pourcentage invalide'),
  objectifId: z.string().uuid().nullable().optional(),
});

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Connecte-toi pour voir tes transferts.' }, { status: 401 });
  }

  const { data: transfers, error } = await supabase
    .from('vida_transfers')
    .select('id, vente_id, objectif_id, pct, points_amount, status, confirmed_at, created_at')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    return NextResponse.json(
      { error: 'Transferts indisponibles. Réessaie dans un instant.' },
      { status: 500 }
    );
  }
  return NextResponse.json({ transfers });
}

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Connecte-toi pour tes points Vida.' }, { status: 401 });
  }

  const limit = rateLimit(`vida-transfer:${user.id}`, 20, 60 * 60 * 1000);
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
      { error: 'Choisis un pourcentage parmi 0, 30, 50 ou 100 %.' },
      { status: 400 }
    );
  }
  const { venteId, pct } = parsed.data;
  const objectifId = pct === 0 ? null : (parsed.data.objectifId ?? null);

  // Vente du vendeur uniquement (RLS ventes_select) ; une ligne de vente
  // n'existe que pour une commande completed — c'est la garde EX-H2.
  const { data: vente } = await supabase
    .from('ventes')
    .select('id, net_amount_cents')
    .eq('id', venteId)
    .maybeSingle();
  if (!vente) {
    return NextResponse.json(
      { error: 'Vente introuvable — seules tes ventes confirmées sont transférables.' },
      { status: 404 }
    );
  }

  // Une proposition par vente (les annulées peuvent être refaites)
  const { count: existing } = await supabase
    .from('vida_transfers')
    .select('id', { count: 'exact', head: true })
    .eq('vente_id', venteId)
    .neq('status', 'cancelled');
  if ((existing ?? 0) > 0) {
    return NextResponse.json(
      { error: 'Cette vente a déjà une proposition de transfert.' },
      { status: 409 }
    );
  }

  // pct > 0 : objectif obligatoire, actif, au vendeur (RLS objectifs_select)
  if (pct > 0) {
    if (!objectifId) {
      return NextResponse.json(
        { error: 'Choisis un objectif pour verser ces points.' },
        { status: 400 }
      );
    }
    const { data: objectif } = await supabase
      .from('vida_objectifs')
      .select('id, active')
      .eq('id', objectifId)
      .maybeSingle();
    if (!objectif) {
      return NextResponse.json({ error: 'Objectif introuvable.' }, { status: 404 });
    }
    if (!objectif.active) {
      return NextResponse.json(
        { error: 'Cet objectif est archivé — réactive-le ou choisis-en un autre.' },
        { status: 409 }
      );
    }
  }

  const points = transferPoints(vente.net_amount_cents, pct);
  const { data: transfer, error: insertError } = await supabase
    .from('vida_transfers')
    .insert({
      user_id: user.id,
      vente_id: venteId,
      objectif_id: objectifId,
      pct,
      points_amount: points,
      status: 'proposed',
    })
    .select('id, pct, points_amount, objectif_id, status')
    .single();

  if (insertError?.code === '23505' || !transfer) {
    // idx_transfers_vente_active : la pré-validation ci-dessus a été doublée
    // par une insertion concurrente (fenêtre TOCTOU fermée par l'index partiel).
    return NextResponse.json(
      { error: 'Cette vente a déjà une proposition de transfert.' },
      { status: 409 }
    );
  }
  if (insertError) {
    return NextResponse.json(
      { error: 'Proposition impossible. Réessaie dans un instant.' },
      { status: 500 }
    );
  }
  return NextResponse.json({ transfer }, { status: 201 });
}
