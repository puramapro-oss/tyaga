import { FileText, Store } from 'lucide-react';
import Link from 'next/link';

import { listingPhotoName } from '@/components/marketplace/listingPhotos';
import { marketplaceHref, parseMarketplaceFilters } from '@/lib/marketplace-filters';
import { CONDITION_LABELS } from '@/lib/labels';
import { createServiceClient } from '@/lib/service';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { formatDate, formatPrice } from '@/lib/utils';

export const metadata = { title: 'Marketplace — TYAGA' };

interface MarketplaceRow {
  user_id: string;
  item_id: string | null;
  id: string;
  title: string;
  asset_kind: 'physical' | 'digital';
  listing_intent: 'offer' | 'wanted';
  listing_mode: 'sale' | 'rental';
  digital_format: string | null;
  digital_license_days: number | null;
  price_cents: number;
  published_at: string;
  items: {
    condition: string | null;
    item_photos: { storage_path: string; position: number }[];
  } | null;
}

const PAGE_SIZE = 24;
const fieldClass = 'h-11 min-w-0 rounded-md border border-border-control bg-background-soft px-3 text-sm';

export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseMarketplaceFilters(await searchParams);
  const { kind, intent, mode, q, format, page } = filters;
  const filtered = Boolean(kind || intent || mode || q || format);
  const offset = (page - 1) * PAGE_SIZE;
  const supabase = await createServerSupabaseClient();
  let query = supabase.from('annonces')
    .select(`id, user_id, item_id, title, price_cents, published_at, asset_kind, listing_intent, listing_mode,
      digital_format, digital_license_days, items ( condition, item_photos ( storage_path, position ) )`)
    .eq('status', 'published');

  if (kind) query = query.eq('asset_kind', kind);
  if (intent) query = query.eq('listing_intent', intent);
  if (mode) query = query.eq('listing_mode', mode);
  // PostgREST accepte * comme variante de %. Traiter les caractères de motif
  // comme du texte empêche une saisie de transformer la recherche en joker.
  const literal = (value: string) => value.replace(/[\\%_*]/g, (char) => `\\${char}`);
  if (q) query = query.ilike('title', `%${literal(q)}%`);
  if (format) query = query.ilike('digital_format', literal(format));

  const { data, error } = await query.order('published_at', { ascending: false })
    .order('id', { ascending: false }).range(offset, offset + PAGE_SIZE);
  const rows = (data ?? []) as unknown as MarketplaceRow[];
  const organicPage = rows.slice(0, PAGE_SIZE);
  const { data: preferred } = organicPage.length
    ? await supabase.rpc('sponsored_listing', { p_candidates: organicPage.map(row => row.id) })
    : { data: null };
  const sponsor = organicPage.find(row => row.id === preferred);
  const ranked = sponsor ? [sponsor, ...organicPage.filter(row => row.id !== sponsor.id)] : organicPage;
  const cards = await Promise.all(ranked.map(async (row) => {
    const photo = row.items?.item_photos?.slice().sort((a, b) => a.position - b.position)[0];
    const signed = photo && row.asset_kind === 'physical' && listingPhotoName(photo.storage_path, row.user_id, row.item_id)
      ? await createServiceClient().storage.from('tyaga-photos').createSignedUrl(photo.storage_path, 3600)
      : null;
    return { ...row, photoUrl: signed?.data?.signedUrl };
  }));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Store size={22} aria-hidden />
          <h1 className="font-display text-3xl">Marketplace</h1>
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          <Link href="/marketplace/numerique" className="inline-flex min-h-11 items-center rounded-pill bg-primary px-5 font-semibold text-on-primary">
            Publier une annonce numérique
          </Link>
          <Link href="/scan" className="inline-flex min-h-11 items-center rounded-pill border border-border-control px-5">
            Vendre un objet
          </Link>
          <Link href="/marketplace/recherche" className="inline-flex min-h-11 items-center rounded-pill border border-border-control px-5">
            Rechercher un objet
          </Link>
          <Link href="/marketplace/mes-licences" className="link-action text-sm">Mes licences</Link>
        </div>
      </header>

      <form action="/marketplace" method="get" role="search" aria-label="Filtrer les annonces" className="glass grid gap-3 p-4">
        <label className="grid gap-1 text-sm">
          Rechercher dans les titres
          <input name="q" type="search" defaultValue={q} maxLength={70} className={fieldClass} />
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1 text-sm">Produit
            <select name="kind" defaultValue={kind} className={fieldClass}>
              <option value="">Tous les produits</option><option value="physical">Objet physique</option><option value="digital">Produit numérique</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">Annonce
            <select name="intent" defaultValue={intent} className={fieldClass}>
              <option value="">Offres et recherches</option><option value="offer">Offres</option><option value="wanted">Recherches</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">Transaction
            <select name="mode" defaultValue={mode} className={fieldClass}>
              <option value="">Toutes les transactions</option><option value="sale">Vente</option><option value="rental">Location ou licence temporaire</option>
            </select>
          </label>
        </div>
        {format && <label className="grid gap-1 text-sm">Format numérique
          <input name="format" defaultValue={format} maxLength={80} className={fieldClass} />
        </label>}
        <div className="flex flex-wrap items-center gap-4">
          <button type="submit" className="min-h-11 rounded-pill border border-border-control px-5 text-sm font-medium">Afficher les annonces</button>
          {filtered && <Link href="/marketplace" className="link-action text-sm">Effacer les filtres</Link>}
        </div>
      </form>

      {error ? (
        <p role="alert" className="glass p-5">Le catalogue est momentanément indisponible. Réessaie dans un instant.</p>
      ) : cards.length === 0 ? (
        <section className="glass flex flex-col items-center gap-2 p-8 text-center">
          <h2 className="font-display text-lg">{filtered ? 'Aucune annonce ne correspond à ces critères' : 'Aucune annonce sur cette page'}</h2>
          {filtered && <Link href="/marketplace" className="link-action">Voir toutes les annonces</Link>}
        </section>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {cards.map((c) => {
            const digital = c.asset_kind === 'digital';
            const Icon = digital ? FileText : Store;
            const condition = c.items?.condition;
            return (
              <li key={c.id} className="min-w-0">
                <Link href={`/marketplace/${c.id}`} className="glass flex h-full gap-4 p-4 transition-colors hover:border-primary/40">
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-card">
                    {c.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- URL signée Supabase
                      <img src={c.photoUrl} alt="" className="h-full w-full object-cover" />
                    ) : <Icon size={22} aria-hidden className="text-foreground-muted" />}
                  </div>
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-xs text-foreground-muted">
                      {c.listing_intent === 'wanted' ? 'Recherche' : 'Offre'} · {digital ? 'Numérique' : 'Objet'}
                    </span>
                    <span className="break-words font-medium">{c.title}</span>
                    {c.id === sponsor?.id && <strong className="text-xs text-primary">Sponsorisé</strong>}
                    <span className="break-words text-xs text-foreground-muted">
                      {digital ? c.digital_format : condition && (CONDITION_LABELS[condition] ?? condition)}
                      {digital && c.listing_mode === 'rental' && ` · Licence de ${c.digital_license_days} j`}
                    </span>
                    <span className="font-mono font-semibold">
                      {c.listing_intent === 'wanted' && 'Budget '}{formatPrice(c.price_cents)}
                    </span>
                    <time className="text-xs text-foreground-muted" dateTime={c.published_at}>{formatDate(c.published_at)}</time>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {!error && (page > 1 || rows.length > PAGE_SIZE) && (
        <nav aria-label="Pages du catalogue" className="flex items-center justify-between gap-3 text-sm">
          {page > 1 && <Link href={marketplaceHref(filters, page - 1)} className="link-action">Page précédente</Link>}
          <span>Page {page}</span>
          {rows.length > PAGE_SIZE && <Link href={marketplaceHref(filters, page + 1)} className="link-action">Page suivante</Link>}
        </nav>
      )}
    </div>
  );
}
