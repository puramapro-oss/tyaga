import { NextResponse } from 'next/server';
import { z } from 'zod';

import { rateLimit } from '@/lib/rate-limit';
import { createServerSupabaseClient } from '@/lib/supabase-server';

/**
 * EX-H4 — modification (label, cible, archivage) et suppression d'un objectif.
 * RLS objectifs_update/objectifs_delete : lignes du user uniquement.
 * Un objectif supprimé reste référencé par les transferts passés (FK absente
 * volontaire) ; une confirmation vers un objectif disparu échoue proprement (-2).
 */

const patchSchema = z.object({
  label: z.string().trim().min(3).max(80).optional(),
  targetPoints: z.number().int().min(1).max(1_000_000).optional(),
  active: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Connecte-toi pour modifier un objectif.' }, { status: 401 });
  }

  const limit = rateLimit(`vida-objectif:${user.id}`, 20, 60 * 60 * 1000);
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
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: 'Rien à modifier.' }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.label !== undefined) patch.label = parsed.data.label;
  if (parsed.data.targetPoints !== undefined) patch.target_points = parsed.data.targetPoints;
  if (parsed.data.active !== undefined) patch.active = parsed.data.active;

  const { data: objectif, error } = await supabase
    .from('vida_objectifs')
    .update(patch)
    .eq('id', id)
    .select('id, type, label, target_points, current_points, active')
    .maybeSingle();

  if (error || !objectif) {
    return NextResponse.json(
      { error: 'Objectif introuvable ou modification refusée.' },
      { status: 404 }
    );
  }
  return NextResponse.json({ objectif });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Connecte-toi pour supprimer un objectif.' }, { status: 401 });
  }

  const { error } = await supabase.from('vida_objectifs').delete().eq('id', id);
  if (error) {
    return NextResponse.json(
      { error: 'Suppression impossible. Réessaie dans un instant.' },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true });
}
