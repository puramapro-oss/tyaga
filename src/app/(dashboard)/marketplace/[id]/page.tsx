import { ArrowLeft, Store } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import ContactButton from '@/components/inbox/ContactButton';
import BuyPanel from '@/components/marketplace/BuyPanel';
import { CONDITION_LABELS } from '@/lib/labels';
import { createServiceClient } from '@/lib/service';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { formatDate, formatPrice } from '@/lib/utils';

/**
 * EX-D3 — annonce publique (marketplace). Lisible par tout utilisateur
 * authentifié via RLS (status = 'published'). L'identité du vendeur n'est
 * pas exposée (profiles = lecture propriétaire uniquement).
 */

const PHOTO_ALTS = ['Face', 'Dos', 'Défaut / étiquette'] as const;

/** Client non typé (pas de database.ts) : forme du select embarqué */
interface AnnonceRow {
  id: string;
  user_id: string;
  title: string;
  description: string;
  tags: string[];
  price_cents: number;
  published_at: string;
  items: {
    category: string | null;
    brand: string | null;
    model: string | null;
    condition: string | null;
    item_photos: { storage_path: string; position: number }[];
  } | null;
}

export default async function AnnoncePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const [{ data: annonce }, {
    data: { user },
  }] = await Promise.all([
    supabase
      .from('annonces')
      .select(
        `id, user_id, title, description, tags, price_cents, published_at,
         items ( category, brand, model, condition, item_photos ( storage_path, position ) )`
      )
      .eq('id', id)
      .eq('status', 'published')
      .maybeSingle(),
    supabase.auth.getUser(),
  ]);

  if (!annonce) notFound();
  const row = annonce as unknown as AnnonceRow;
  // EX-E1 : le vendeur ne peut pas acheter son propre objet (CHECK buyer_neq_seller)
  const isOwner = user?.id === row.user_id;

  const photos = (row.items?.item_photos ?? [])
    .slice()
    .sort((p1, p2) => p1.position - p2.position);
  const service = createServiceClient();
  const photoUrls = await Promise.all(
    photos.map(async (p, i) => {
      const { data } = await service.storage
        .from('tyaga-photos')
        .createSignedUrl(p.storage_path, 3600);
      return { url: data?.signedUrl ?? null, alt: PHOTO_ALTS[p.position] ?? PHOTO_ALTS[i] };
    })
  );

  const condition = row.items?.condition ?? null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <Link
        href="/marketplace"
        className="flex w-fit items-center gap-2 text-sm text-foreground-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft size={16} />
        Marketplace
      </Link>

      <div>
        <h1 className="font-display text-3xl">{annonce.title}</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          {condition
            ? `${CONDITION_LABELS[condition] ?? condition} · `
            : ''}
          publiée le {formatDate(annonce.published_at)}
        </p>
      </div>

      {photoUrls.some((p) => p.url) && (
        <div className="grid grid-cols-3 gap-3">
          {photoUrls
            .filter((p) => p.url)
            .map((p) => (
              // eslint-disable-next-line @next/next/no-img-element -- URL signée Supabase
              <img
                key={p.url!}
                src={p.url!}
                alt={`Photo ${p.alt}`}
                className="aspect-square w-full rounded-lg border border-border object-cover"
              />
            ))}
        </div>
      )}

      <section className="glass flex flex-col gap-4 p-6">
        <p className="whitespace-pre-line text-sm leading-relaxed text-foreground-secondary">
          {annonce.description}
        </p>
        {annonce.tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {(annonce.tags as string[]).map((tag) => (
              <span
                key={tag}
                className="rounded-pill bg-foreground/5 px-2.5 py-0.5 text-xs text-foreground-muted"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between border-t border-border pt-4">
          <span className="text-sm text-foreground-muted">Prix demandé</span>
          <span className="font-mono text-2xl font-semibold">
            {formatPrice(annonce.price_cents)}
          </span>
        </div>
      </section>

      {isOwner ? (
        <p className="glass p-4 text-sm text-foreground-secondary">
          C’est ton annonce : suis son déroulé depuis « Commandes ».
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <BuyPanel annonceId={annonce.id} priceCents={annonce.price_cents} />
          {/* EX-F1 : messagerie interne — la question AVANT l'achat */}
          <ContactButton annonceId={annonce.id} />
        </div>
      )}

      <p className="flex items-center gap-2 text-xs text-foreground-muted">
        <Store size={14} />
        Annonce validée par son vendeur avant publication.
      </p>
    </div>
  );
}
