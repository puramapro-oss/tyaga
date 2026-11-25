import { previewTokenPattern, renderListingPreview, type ReviewedListing } from '@/lib/listing-preview';
import { createServiceClient } from '@/lib/service';

export const dynamic = 'force-dynamic';

const headers = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'private, no-store, max-age=0',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const missing = () => new Response('Aperçu indisponible.', { status: 404, headers });
  if (!previewTokenPattern.test(token)) return missing();
  const { data, error } = await createServiceClient().rpc('read_public_listing_preview', { p_token: token }).maybeSingle();
  if (error) return new Response('Service temporairement indisponible.', { status: 503, headers });
  if (!data) return missing();
  const row = data as { listing_id: string; title: string; price_cents: number; kind: ReviewedListing['kind']; intent: ReviewedListing['intent']; mode: ReviewedListing['mode'] };
  return new Response(renderListingPreview({ title: row.title, priceCents: row.price_cents, kind: row.kind, intent: row.intent, mode: row.mode }, row.listing_id), { headers });
}
