import { NextResponse } from 'next/server';
import { z } from 'zod';

import { computeCommission } from '@/lib/commission';
import { estimateItem, type ItemCondition } from '@/lib/estimate-ai';
import { rateLimit } from '@/lib/rate-limit';
import { createServerSupabaseClient } from '@/lib/supabase-server';

/**
 * EX-C — Estimation de revente. Chaque appel = NOUVELLE ligne estimations
 * (EX-C4 historique) ; le net est calculé ici, jamais côté client (EX-C2).
 */

export const maxDuration = 60;

const bodySchema = z.object({ itemId: z.string().uuid() });

const CONDITIONS: ItemCondition[] = [
  'neuf',
  'excellent',
  'tres_bon',
  'bon',
  'satisfaisant',
  'a_reparer',
];

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: 'Connecte-toi pour estimer un objet.' },
      { status: 401 }
    );
  }

  const limit = rateLimit(`estimate:${user.id}`, 10, 60 * 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json(
      {
        error: `Trop de demandes d'estimation. Réessaie dans ${Math.ceil(limit.retryAfterSec / 60)} min.`,
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
    .select('id, user_id, category, brand, model, condition, status')
    .eq('id', parsed.data.itemId)
    .eq('user_id', user.id)
    .single();

  if (!item) {
    return NextResponse.json({ error: 'Objet introuvable.' }, { status: 404 });
  }
  if (item.status === 'draft' || !item.category) {
    return NextResponse.json(
      { error: "Enregistre d'abord la fiche de l'objet (scan) avant d'estimer." },
      { status: 400 }
    );
  }
  const condition = CONDITIONS.includes(item.condition as ItemCondition)
    ? (item.condition as ItemCondition)
    : 'bon';

  let estimate;
  try {
    estimate = await estimateItem({
      category: item.category,
      brand: item.brand ?? '',
      model: item.model ?? '',
      condition,
    });
  } catch {
    return NextResponse.json(
      {
        error:
          "L'estimation est indisponible pour l'instant. Réessaie dans un instant.",
      },
      { status: 503 }
    );
  }

  // EX-C2 : net TOUJOURS calculé serveur, au taux du moment (traçabilité)
  const { netCents, commissionPct } = computeCommission(estimate.price_suggested_cents);

  // EX-C4 : append-only, on ne touche jamais aux lignes précédentes
  const { data: saved, error: insertError } = await supabase
    .from('estimations')
    .insert({
      item_id: item.id,
      user_id: user.id,
      price_suggested_cents: estimate.price_suggested_cents,
      price_min_cents: estimate.price_min_cents,
      price_max_cents: estimate.price_max_cents,
      delay_days_min: estimate.delay_days_min,
      delay_days_max: estimate.delay_days_max,
      commission_pct: commissionPct,
      net_amount_cents: netCents,
      confidence: estimate.confidence,
      rationale: estimate.rationale,
      model_used: process.env.ANTHROPIC_MODEL_MAIN || 'claude-sonnet-4-6',
    })
    .select('id, price_suggested_cents, price_min_cents, price_max_cents, delay_days_min, delay_days_max, commission_pct, net_amount_cents, confidence, rationale, created_at')
    .single();

  if (insertError || !saved) {
    return NextResponse.json(
      { error: "Impossible d'enregistrer l'estimation. Réessaie." },
      { status: 500 }
    );
  }

  // Progression du statut : scanned → estimated (jamais de retour arrière)
  if (item.status === 'scanned') {
    await supabase
      .from('items')
      .update({ status: 'estimated' })
      .eq('id', item.id)
      .eq('user_id', user.id);
  }

  return NextResponse.json({ estimation: saved });
}
