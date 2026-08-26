import { NextResponse } from 'next/server';
import { z } from 'zod';

import { rateLimit } from '@/lib/rate-limit';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { OBJECTIF_TYPES } from '@/lib/vida';

/**
 * EX-H4 — objectifs Vida : liste + création (CRUD complet avec la route
 * /api/vida/objectifs/[id]). Progression lue depuis current_points/target_points.
 */

const bodySchema = z.object({
  type: z.enum(OBJECTIF_TYPES),
  label: z.string().trim().min(3).max(80),
  targetPoints: z.number().int().min(1).max(1_000_000),
});

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Connecte-toi pour voir tes objectifs.' }, { status: 401 });
  }

  const { data: objectifs, error } = await supabase
    .from('vida_objectifs')
    .select('id, type, label, target_points, current_points, active, created_at')
    .order('created_at', { ascending: true })
    .limit(50);
  if (error) {
    return NextResponse.json(
      { error: 'Objectifs indisponibles. Réessaie dans un instant.' },
      { status: 500 }
    );
  }
  return NextResponse.json({ objectifs });
}

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Connecte-toi pour créer un objectif.' }, { status: 401 });
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
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Objectif invalide — nom de 3 à 80 caractères et cible d’au moins 1 point.' },
      { status: 400 }
    );
  }

  // RLS objectifs_insert : user_id imposé = auth.uid()
  const { data: objectif, error } = await supabase
    .from('vida_objectifs')
    .insert({
      user_id: user.id,
      type: parsed.data.type,
      label: parsed.data.label,
      target_points: parsed.data.targetPoints,
      current_points: 0,
      active: true,
    })
    .select('id, type, label, target_points, current_points, active')
    .single();

  if (error || !objectif) {
    return NextResponse.json(
      { error: 'Création impossible. Réessaie dans un instant.' },
      { status: 500 }
    );
  }
  return NextResponse.json({ objectif }, { status: 201 });
}
