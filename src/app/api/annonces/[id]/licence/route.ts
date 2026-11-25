import { NextResponse } from 'next/server';
import { z } from 'zod';

import { attachSample, createTestCheckout, digitalTestOrigin, refreshSample } from '@/lib/digital-checkout-test';
import { rateLimit } from '@/lib/rate-limit';
import { createServerSupabaseClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
const idSchema = z.string().uuid();
const mutation = z.discriminatedUnion('action', [
  z.object({ action: z.literal('attach'), text: z.string().trim().min(1).max(32000), attest: z.literal(true) }).strict(),
  z.object({ action: z.literal('sample'), text: z.string().trim().min(1).max(32000), attest: z.literal(true) }).strict(),
  z.object({ action: z.literal('checkout'), version: z.string().regex(/^[a-f0-9]{64}$/), accept: z.literal(true) }).strict(),
  z.object({ action: z.literal('claim'), version: z.string().regex(/^[a-f0-9]{64}$/), accept: z.literal(true) }).strict(),
]);

function respond(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } });
}

function rpcError(code: string) {
  switch (code) {
    case 'P0002': return respond({ error: 'Cette licence est indisponible.' }, 404);
    case '42501': return respond({ error: 'Ce compte ne dispose pas du droit demandé.' }, 403);
    case '23505': return respond({ error: 'Un autre texte est déjà attaché à cette offre.' }, 409);
    case '40001': return respond({ error: 'Les conditions ont changé. Actualise la licence avant de les accepter.' }, 409);
    case '22023': return respond({ error: 'Vérifie le texte et sa longueur.' }, 400);
    default: return respond({ error: 'Le service des licences est momentanément indisponible.' }, 503);
  }
}

export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return respond({ error: 'Annonce inconnue.' }, 404);
  const db = await createServerSupabaseClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return respond({ error: 'Connecte-toi pour accéder à tes licences.' }, 401);
  const { data, error } = await db.rpc('licence_etat', {
    p_annonce: id, p_lire: new URL(request.url).searchParams.get('lire') === '1',
  });
  if (error) return rpcError(error.code);
  if (!String(data?.state).startsWith('sample_')) return respond({ ...data, serverNow: new Date().toISOString() });
  if (!digitalTestOrigin()) return respond({ state: 'paid', serverNow: new Date().toISOString() });
  if (['sample_attach', 'sample_owner', 'sample_missing'].includes(data.state)) return respond({ ...data, serverNow: new Date().toISOString() });
  try {
    const receipt = await refreshSample(id, user.id, new URL(request.url).searchParams.get('lire') === '1');
    const { data: current, error: refreshError } = await db.rpc('licence_etat', { p_annonce: id, p_lire: false });
    if (refreshError) return rpcError(refreshError.code);
    if (current.state === 'sample_access') {
      if (!receipt) return respond({ error: 'Le règlement de recette doit être reconfirmé.' }, 503);
      return respond({ ...current, state: 'active', sample: true, text: receipt.text ?? undefined, serverNow: new Date().toISOString() });
    }
    return respond({ ...current, serverNow: new Date().toISOString() });
  } catch { return respond({ error: 'Le règlement de recette est momentanément invérifiable.' }, 503); }
}

export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return respond({ error: 'Annonce inconnue.' }, 404);
  const db = await createServerSupabaseClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return respond({ error: 'Connecte-toi pour agir sur cette licence.' }, 401);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return respond({ error: 'Format attendu : JSON.' }, 415);
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return respond({ error: 'Origine refusée.' }, 403);
  if (!rateLimit(`licence:${user.id}`, 40, 60 * 1000).ok) return respond({ error: 'Réessaie dans une minute.' }, 429);
  // JSON escapes may use six bytes per character. Bound the stream as well as
  // Content-Length so a chunked upload cannot grow beyond the text contract.
  const maxBytes = 200000;
  if (Number(request.headers.get('content-length')) > maxBytes) return respond({ error: 'Texte trop long.' }, 413);
  const reader = request.body?.getReader();
  if (!reader) return respond({ error: 'Requête vide.' }, 400);
  let size = 0;
  let body = '';
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return respond({ error: 'Texte trop long.' }, 413);
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
    const parsed = mutation.safeParse(JSON.parse(body));
    if (!parsed.success) return respond({ error: 'Vérifie les informations et le consentement.' }, 400);
    const input = parsed.data;
    if (input.action === 'sample' || input.action === 'checkout') {
      if (!digitalTestOrigin()) return respond({ error: 'Le paiement de recette est fermé.' }, 503);
      try {
        if (input.action === 'sample') {
          await attachSample(id, user.id, input.text);
          return respond({ ok: true });
        }
        return respond({ url: await createTestCheckout(id, user.id, input.version) });
      } catch { return respond({ error: 'Le vendeur ou le devis de recette est indisponible. Actualise la licence.' }, 409); }
    }
    const { error } = input.action === 'attach'
      ? await db.rpc('licence_joindre', { p_annonce: id, p_texte: input.text, p_attestation: input.attest })
      : await db.rpc('licence_acquerir', { p_annonce: id, p_version: input.version, p_accepter: input.accept });
    return error ? rpcError(error.code) : respond({ ok: true });
  } catch {
    return respond({ error: 'La requête est illisible ou le service est indisponible.' }, 400);
  }
}
