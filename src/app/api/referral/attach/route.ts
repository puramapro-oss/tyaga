import { NextResponse } from 'next/server';
import { z } from 'zod';

import { rateLimit } from '@/lib/rate-limit';
import { createServerSupabaseClient } from '@/lib/supabase-server';

/**
 * P3 Parrainage V4 — attache la session courante au parrain porteur du code.
 * Toutes les gardes (self, déjà parrainé, code inconnu) vivent dans la RPC
 * SECURITY DEFINER `tyaga.attach_referral`.
 */

const bodySchema = z.object({
  code: z.string().trim().min(4).max(12),
});

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: 'Connecte-toi pour valider ton parrain.' },
      { status: 401 }
    );
  }

  const limit = rateLimit(`referral-attach:${user.id}`, 10, 60 * 60 * 1000);
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
      { error: 'Code de parrainage invalide (4 à 12 caractères).' },
      { status: 400 }
    );
  }

  const { data: result, error } = await supabase.rpc('attach_referral', {
    p_code: parsed.data.code.trim().toUpperCase(),
  });
  if (error) {
    return NextResponse.json(
      { error: 'Parrainage indisponible. Réessaie dans un instant.' },
      { status: 500 }
    );
  }

  switch (result) {
    case 'ok':
      return NextResponse.json({ attached: true });
    case 'invalid':
      return NextResponse.json(
        { error: 'Ce code de parrainage est inconnu.' },
        { status: 400 }
      );
    case 'self':
      return NextResponse.json(
        { error: 'Tu ne peux pas te parrainer toi-même.' },
        { status: 400 }
      );
    case 'already':
      return NextResponse.json(
        { error: 'Un parrain est déjà rattaché à ton compte.' },
        { status: 400 }
      );
    default:
      return NextResponse.json(
        { error: 'Parrainage indisponible. Réessaie dans un instant.' },
        { status: 500 }
      );
  }
}
