import { z } from 'zod';
import { digitalTestOrigin, refreshSample } from '@/lib/digital-checkout-test';
import { declaredFileType, detectLicenseFile, licensedFileExtensions, MAX_LICENSE_FILE_BYTES, readLicenseFile, type LicenseFileType } from '@/lib/licensed-file';
import { rateLimit } from '@/lib/rate-limit';
import { createServiceClient } from '@/lib/service';
import { createServerSupabaseClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
const headers = { 'Cache-Control': 'private, no-store', 'Vary': 'Cookie', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const fail = (message: string, status: number) => new Response(message, { status, headers });

async function actor(context: Context) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return fail('Annonce indisponible.', 404);
  const db = await createServerSupabaseClient();
  const { data: { user } } = await db.auth.getUser();
  return user ? { id, userId: user.id } : fail('Connexion requise.', 401);
}

async function serve(context: Context, download: boolean) {
  const session = await actor(context);
  if (session instanceof Response) return session;
  const db = createServiceClient();
  const args = { p_annonce: session.id, p_lecteur: session.userId, p_octets: false, p_reglement_confirme: false };
  const { data: file, error } = await db.rpc('licence_fichier', args);
  if (error) return fail('Fichier indisponible.', error.code === '42501' ? 403 : 503);
  if (!file || !Object.hasOwn(licensedFileExtensions, file.type) || (file.sample && !digitalTestOrigin())) return fail('Fichier indisponible.', 404);
  const contentHeaders = { ...headers, 'Content-Type': file.type, 'X-File-Size': String(file.size),
    'Content-Disposition': `attachment; filename="creation-${session.id}.${licensedFileExtensions[file.type as LicenseFileType]}"`,
    'Content-Security-Policy': "sandbox; default-src 'none'" };
  if (!download) return new Response(null, { headers: contentHeaders });
  if (file.sample && !file.owner) {
    try {
      const receipt = await refreshSample(session.id, session.userId, false);
      if (!receipt) return fail('Le paiement de recette ne donne pas accès à ce fichier.', 403);
      args.p_reglement_confirme = true;
    } catch { return fail('Le paiement de recette doit être reconfirmé.', 503); }
  }
  const result = await db.rpc('licence_fichier', { ...args, p_octets: true });
  if (result.error || !result.data?.data) return fail('Le droit de téléchargement est indisponible.', result.error?.code === '42501' ? 403 : 503);
  return new Response(new Uint8Array(Buffer.from(result.data.data, 'base64')), { headers: contentHeaders });
}

export async function HEAD(_request: Request, context: Context) { return serve(context, false); }
export async function GET(_request: Request, context: Context) { return serve(context, true); }

export async function POST(request: Request, context: Context) {
  const session = await actor(context);
  if (session instanceof Response) return session;
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return fail('Origine refusée.', 403);
  if (request.headers.get('x-file-rights') !== 'confirmed') return fail('Droits et conditions à confirmer.', 400);
  const purpose = request.headers.get('x-file-purpose');
  if (purpose !== 'free' && (purpose !== 'test-sample' || !digitalTestOrigin())) return fail('Mode de licence indisponible.', 400);
  if (!rateLimit(`licence-fichier:${session.userId}`, 6, 60 * 1000).ok) return fail('Réessaie dans une minute.', 429);
  if (Number(request.headers.get('content-length')) > MAX_LICENSE_FILE_BYTES) return fail('Limite de 2 Mio dépassée.', 413);
  const declaredType = declaredFileType(request.headers.get('content-type'));
  if (!declaredType || !Object.hasOwn(licensedFileExtensions, declaredType)) return fail('Type de fichier non pris en charge.', 415);
  let bytes: Buffer | null;
  try { bytes = await readLicenseFile(request.body); } catch (e) {
    return fail(e instanceof RangeError ? 'Limite de 2 Mio dépassée.' : 'Lecture du fichier impossible.', e instanceof RangeError ? 413 : 400);
  }
  const type = bytes && detectLicenseFile(bytes);
  if (!bytes || !type || type !== declaredType) return fail('Format ou signature de fichier non pris en charge.', 415);
  const { error } = await createServiceClient().rpc('licence_fichier_joindre', { p_annonce: session.id, p_auteur: session.userId,
    p_media: type, p_base64: bytes.toString('base64'), p_test: purpose === 'test-sample' });
  if (error) return fail(error.code === '23505' ? 'Une œuvre est déjà jointe à cette annonce.' : 'Ce fichier ne peut pas être joint.',
    error.code === '23505' ? 409 : error.code === '42501' ? 403 : 503);
  return new Response(null, { status: 204, headers });
}
