import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createServerSupabaseClient } from '@/lib/supabase-server';

const input = z.object({
  action: z.enum(['activate', 'cancel']),
  listingId: z.string().uuid(),
  grantId: z.string().uuid(),
}).strict();

export async function POST(request: Request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ error: 'Format de demande invalide.' }, { status: 415 });
  }
  const body = input.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'Demande invalide.' }, { status: 400 });
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Connecte-toi pour gérer cette annonce.' }, { status: 401 });
  const activate = body.data.action === 'activate';
  const { data, error } = await supabase.rpc(activate ? 'redeem_listing_promotion' : 'cancel_listing_promotion', {
    p_listing: body.data.listingId,
    p_grant: body.data.grantId,
  });
  if (error?.code === 'P0001' || (!error && !data)) {
    return NextResponse.json({ error: 'Ce bon ou cette annonce ne permet plus cette opération.' }, { status: 409 });
  }
  if (error) return NextResponse.json({ error: 'La mise en avant est momentanément indisponible.' }, { status: 503 });
  // The RPC returns the original end time when an activation is replayed.
  return NextResponse.json(activate ? { ok: true, endsAt: data } : { ok: true });
}
