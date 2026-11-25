import { NextResponse } from 'next/server';

import {
  digitalListingFields, digitalListingSchema, matchesMemberListing, purchaseWantedFields, purchaseWantedSchema,
} from '@/lib/digital-listing';
import { rateLimit } from '@/lib/rate-limit';
import { createServerSupabaseClient } from '@/lib/supabase-server';

const digitalPublication = digitalListingSchema.transform(listing => ({
  requestId: listing.requestId,
  fields: digitalListingFields(listing),
}));

const wantedPublication = purchaseWantedSchema.transform(listing => ({
  requestId: listing.requestId,
  fields: purchaseWantedFields(listing),
}));

export async function publishMemberListing(request: Request, kind: 'digital' | 'physical-wanted') {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Connecte-toi pour publier.' }, { status: 401 });

  const limit = rateLimit(`publish:${user.id}`, 20, 60 * 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json({ error: 'Trop de publications. Réessaie plus tard.' }, {
      status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) },
    });
  }
  const body: unknown = await request.json().catch(() => null);
  const schema = kind === 'digital' ? digitalPublication : wantedPublication;
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const message = kind === 'digital' ? 'Vérifie les conditions, la durée, les droits et le prix de ton annonce.' : 'Vérifie le titre, la description, le budget et la validation.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
  const { fields, requestId } = parsed.data;
  const { data, error } = await supabase.from('annonces').insert({
    ...fields,
    user_id: user.id,
    publication_request_id: requestId,
    user_validated: true,
    status: 'published',
    published_at: new Date().toISOString(),
  }).select('id').single();

  if (data && !error) return NextResponse.json({ annonce: data }, { status: 201 });

  if (error?.code === '23505') {
    const { data: prior, error: lookupError } = await supabase.from('annonces')
      .select('id, status, asset_kind, listing_intent, listing_mode, title, description, price_cents, digital_format, digital_license_terms, digital_license_days, digital_rights_attested')
      .eq('user_id', user.id).eq('publication_request_id', requestId).maybeSingle();
    if (prior && prior.status === 'published' && matchesMemberListing(prior, fields)) {
      return NextResponse.json({ annonce: { id: prior.id } });
    }
    if (!lookupError) {
      return NextResponse.json({ error: 'Cette demande correspond déjà à une autre version de l’annonce.' }, { status: 409 });
    }
  }
  return NextResponse.json({ error: 'Publication indisponible. Tu peux réessayer.' }, { status: 503 });
}
