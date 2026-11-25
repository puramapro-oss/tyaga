import Link from 'next/link';

import { createServerSupabaseClient } from '@/lib/supabase-server';
import { formatPrice } from '@/lib/utils';
import { closestListings } from './rankListingMatches';

type MatchSubject = {
  id: string;
  user_id: string;
  title: string;
  tags: string[];
  price_cents: number;
  asset_kind: 'physical' | 'digital';
  listing_intent: 'offer' | 'wanted';
  listing_mode: 'sale' | 'rental';
  digital_format: string | null;
  digital_license_days: number | null;
};

export default async function ListingMatches({ listing }: { listing: MatchSubject }) {
  const wanted = listing.listing_intent === 'wanted';
  const supabase = await createServerSupabaseClient();
  let query = supabase.from('annonces').select('id, title, tags, price_cents, digital_format')
    .eq('status', 'published').eq('asset_kind', listing.asset_kind)
    .eq('listing_mode', listing.listing_mode).eq('listing_intent', wanted ? 'offer' : 'wanted')
    .neq('user_id', listing.user_id);
  query = wanted ? query.lte('price_cents', listing.price_cents) : query.gte('price_cents', listing.price_cents);
  if (listing.digital_license_days !== null) query = query.eq('digital_license_days', listing.digital_license_days);
  const format = listing.digital_format?.trim().toLocaleLowerCase('fr');
  if (format) query = query.ilike('digital_format', format.replace(/[\\%_*]/g, char => `\\${char}`));
  const { data } = await query.order('published_at', { ascending: false }).order('id').limit(120);
  const candidates = (data ?? []).filter(row => !format || row.digital_format?.trim().toLocaleLowerCase('fr') === format);
  const matches = closestListings(listing, candidates);
  if (!matches.length) return null;
  return (
    <section aria-label="Annonces compatibles" className="glass grid gap-3 p-5">
      <h2 className="font-display text-xl">{wanted ? 'Offres dans ce budget' : 'Recherches compatibles'}</h2>
      <ul className="divide-y divide-border">
        {matches.map(row => (
          <li key={row.id}>
            <Link className="flex min-h-12 items-center justify-between gap-3 py-2" href={`/marketplace/${row.id}`}>
              <span className="min-w-0 break-words">{row.title}</span>
              <span className="shrink-0 font-mono text-sm">{wanted ? '' : 'Budget '}{formatPrice(row.price_cents)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
