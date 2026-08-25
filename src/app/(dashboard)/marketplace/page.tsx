import { Store } from 'lucide-react';
import Link from 'next/link';

import { CONDITION_LABELS } from '@/lib/labels';
import { createServiceClient } from '@/lib/service';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { formatDate, formatPrice } from '@/lib/utils';

/**
 * EX-D3 — marketplace interne : toutes les annonces PUBLIÉES, visibles par
 * tout utilisateur authentifié (RLS annonces_select). Aucune annonce privée,
 * aucun brouillon : seules les lignes validées par leur vendeur apparaissent.
 */

export const metadata = { title: 'Marketplace — TYAGA' };

/** Client non typé (pas de database.ts) : forme du select embarqué */
interface MarketplaceRow {
  id: string;
  title: string;
  price_cents: number;
  published_at: string;
  items: {
    condition: string | null;
    item_photos: { storage_path: string; position: number }[];
  } | null;
}

export default async function MarketplacePage() {
  const supabase = await createServerSupabaseClient();

  const { data: annonces } = await supabase
    .from('annonces')
    .select(
      `id, title, price_cents, published_at,
       items ( condition, item_photos ( storage_path, position ) )`
    )
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(60);

  // Première photo de chaque objet → URL signée courte (bucket privé)
  const service = createServiceClient();
  const cards = await Promise.all(
    ((annonces ?? []) as unknown as MarketplaceRow[]).map(async (a) => {
      const photos = (a.items?.item_photos ?? [])
        .slice()
        .sort((p1, p2) => p1.position - p2.position);
      let photoUrl: string | null = null;
      if (photos[0]) {
        const { data } = await service.storage
          .from('tyaga-photos')
          .createSignedUrl(photos[0].storage_path, 3600);
        photoUrl = data?.signedUrl ?? null;
      }
      return {
        id: a.id,
        title: a.title,
        price: a.price_cents,
        publishedAt: a.published_at,
        condition: a.items?.condition ?? null,
        photoUrl,
      };
    })
  );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center gap-3">
        <Store size={22} />
        <h1 className="font-display text-3xl">Marketplace</h1>
      </div>
      <p className="text-sm leading-relaxed text-foreground-secondary">
        Objets mis en vente par la communauté TYAGA. Chaque annonce a été relue
        et validée par son vendeur avant publication.
      </p>

      {cards.length === 0 ? (
        <section className="glass flex flex-col items-center gap-3 p-10 text-center">
          <Store size={28} className="text-foreground-muted" />
          <p className="font-display text-lg">Aucune annonce publiée</p>
          <p className="text-sm text-foreground-secondary">
            Les premières annonces apparaîtront ici dès qu&apos;un objet sera
            scanné, estimé et publié.
          </p>
        </section>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {cards.map((c) => (
            <li key={c.id}>
              <Link
                href={`/marketplace/${c.id}`}
                className="glass flex gap-4 p-4 transition-colors hover:border-primary/40"
              >
                <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-border bg-card">
                  {c.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- URL signée Supabase
                    <img
                      src={c.photoUrl}
                      alt={c.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-foreground-muted">
                      <Store size={20} />
                    </div>
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col justify-between gap-1">
                  <p className="truncate font-medium">{c.title}</p>
                  <p className="text-xs text-foreground-muted">
                    {c.condition
                      ? (CONDITION_LABELS[c.condition] ?? c.condition)
                      : 'État non précisé'}{' '}
                    · {formatDate(c.publishedAt)}
                  </p>
                  <p className="font-mono text-lg font-semibold">
                    {formatPrice(c.price)}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
