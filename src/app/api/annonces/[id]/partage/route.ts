import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase-server';

const reviewed = z.object({
  title: z.string().min(1).max(70),
  priceCents: z.number().int().nonnegative(),
  kind: z.enum(['physical', 'digital']),
  intent: z.enum(['wanted', 'offer']),
  mode: z.enum(['sale', 'rental']),
}).strict();
const command = z.discriminatedUnion('action', [
  z.object({ action: z.literal('enable'), consent: z.literal(true), reviewed }).strict(),
  z.object({ action: z.literal('revoke') }).strict(),
  z.object({ action: z.literal('read') }).strict(),
]);
const headers = { 'Cache-Control': 'no-store' };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Connexion requise.' }, { status: 401, headers });
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: 'Origine refusée.' }, { status: 403, headers });
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return NextResponse.json({ error: 'Format JSON requis.' }, { status: 415, headers });
  }
  const reader = request.body?.getReader();
  if (!reader) return NextResponse.json({ error: 'Demande vide.' }, { status: 400, headers });
  const bytes = new Uint8Array(4096);
  let length = 0;
  let value: unknown;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (chunk.value.length > bytes.length - length) {
        await reader.cancel();
        return NextResponse.json({ error: 'Demande trop longue.' }, { status: 413, headers });
      }
      bytes.set(chunk.value, length);
      length += chunk.value.length;
    }
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)));
  } catch { return NextResponse.json({ error: 'Demande illisible.' }, { status: 400, headers }); }
  finally { reader.releaseLock(); }
  const input = command.safeParse(value);
  if (!input.success || !z.string().uuid().safeParse(id).success) return NextResponse.json({ error: 'Demande invalide.' }, { status: 400, headers });
  const action = input.data;
  const { data, error } = await supabase.rpc('manage_listing_preview', {
    p_listing: id,
    p_action: action.action,
    p_reviewed: action.action === 'enable' ? action.reviewed : null,
  });
  if (error) {
    const status = error.code === '42501' ? 404 : error.code === '22023' ? 409 : 503;
    return NextResponse.json({ error: status === 409 ? 'L’annonce a changé. Recharge sa fiche avant de confirmer.' : 'Aperçu indisponible.' }, { status, headers });
  }
  return NextResponse.json({ path: data ? `/api/annonces/apercu/${data}` : null }, { headers });
}
