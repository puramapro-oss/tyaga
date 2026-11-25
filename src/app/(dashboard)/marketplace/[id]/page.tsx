import { ArrowLeft, Store } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import ContactButton from '@/components/inbox/ContactButton';
import BuyPanel from '@/components/marketplace/BuyPanel';
import SaleFeeSummary from '@/components/marketplace/SaleFeeSummary';
import { canUsePhysicalSalePilot, PHYSICAL_PILOT_POLICY } from '@/lib/physical-sale-pilot';
import { computeCommission, physicalPilotQuote } from '@/lib/commission';
import { physicalOrderQuote } from '@/lib/physical-order-quote';
import DigitalLicensePanel from '@/components/marketplace/DigitalLicensePanel';
import ListingMatches from '@/components/marketplace/ListingMatches';
import { listingPhotoName } from '@/components/marketplace/listingPhotos';
import ListingPromotionQuote from '@/components/marketplace/ListingPromotionQuote';
import ShareListing from '@/components/marketplace/ShareListing';
import { PublicListingPreview } from '@/components/marketplace/PublicListingPreview';
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
  item_id: string | null;
  title: string;
  description: string;
  tags: string[];
  price_cents: number;
  published_at: string;
  fee_policy: string;
  asset_kind: 'physical' | 'digital';
  listing_intent: 'offer' | 'wanted';
  listing_mode: 'sale' | 'rental';
  digital_format: string | null;
  digital_license_terms: string | null;
  digital_license_days: number | null;
  digital_rights_attested: boolean;
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
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) notFound();
  const supabase = await createServerSupabaseClient();

  const [{ data: annonce, error }, {
    data: { user },
  }] = await Promise.all([
    supabase
      .from('annonces')
      .select(
        `id, user_id, item_id, title, description, tags, price_cents, published_at,
         asset_kind, listing_intent, listing_mode, fee_policy, digital_format, digital_license_terms,
         digital_license_days, digital_rights_attested,
         items ( category, brand, model, condition, item_photos ( storage_path, position ) )`
      )
      .eq('id', id)
      .eq('status', 'published')
      .maybeSingle(),
    supabase.auth.getUser(),
  ]);

  if (error) {
    return <p role="alert" className="glass mx-auto max-w-2xl p-6">Cette annonce est momentanément indisponible. Réessaie dans un instant.</p>;
  }
  if (!annonce) notFound();
  const row = annonce as unknown as AnnonceRow;
  // EX-E1 : le vendeur ne peut pas acheter son propre objet (CHECK buyer_neq_seller)
  const isOwner = user?.id === row.user_id;

  const digital = row.asset_kind === 'digital';
  const wanted = row.listing_intent === 'wanted';
  const rental = row.listing_mode === 'rental';
  const physicalCheckout = row.asset_kind === 'physical' && row.listing_intent === 'offer' && row.listing_mode === 'sale';
  const pilot = row.fee_policy === PHYSICAL_PILOT_POLICY;
  const pilotAvailable = !pilot || await canUsePhysicalSalePilot(supabase);
  const quote = physicalCheckout && user && pilotAvailable
    ? (isOwner ? (pilot ? physicalPilotQuote(row.price_cents) : computeCommission(row.price_cents))
      : await physicalOrderQuote(supabase, row, user.id))
    : null;
  const related = new URLSearchParams({ kind: row.asset_kind, mode: row.listing_mode, intent: wanted ? 'offer' : 'wanted' });
  if (row.digital_format) related.set('format', row.digital_format);

  const photos = (digital ? [] : row.items?.item_photos ?? [])
    .filter(p => listingPhotoName(p.storage_path, row.user_id, row.item_id))
    .sort((p1, p2) => p1.position - p2.position);
  const photoUrls = await Promise.all(
    photos.map(async (p, i) => {
      const { data } = await createServiceClient().storage
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
        <h1 className="break-words font-display text-3xl">{row.title}</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          {wanted ? 'Recherche' : 'Offre'} · {digital ? 'Produit numérique' : 'Objet physique'} · {condition
            ? `${CONDITION_LABELS[condition] ?? condition} · `
            : ''}
          publiée le {formatDate(annonce.published_at)}
        </p>
      </div>

      <ShareListing id={row.id} title={row.title} />
      {isOwner && <PublicListingPreview id={row.id} title={row.title} priceCents={row.price_cents} kind={row.asset_kind} intent={row.listing_intent} mode={row.listing_mode} />}

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
        <p className="whitespace-pre-line break-words text-sm leading-relaxed text-foreground-secondary">
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
        {digital && (
          <div className="grid gap-3 border-t border-border pt-4 text-sm">
            <h2 className="font-display text-lg">{wanted ? 'Licence recherchée' : 'Licence proposée'}</h2>
            <dl className="grid gap-2">
              <div><dt className="text-foreground-muted">Format</dt><dd className="break-words">{row.digital_format}</dd></div>
              <div><dt className="text-foreground-muted">Durée</dt><dd>{rental ? `${row.digital_license_days} jours` : 'Sans durée limitée'}</dd></div>
              <div><dt className="text-foreground-muted">Conditions d’utilisation</dt><dd className="whitespace-pre-line break-words">{row.digital_license_terms}</dd></div>
            </dl>
            {!wanted && row.digital_rights_attested && <p className="text-xs text-foreground-muted">L’auteur de l’annonce déclare disposer des droits nécessaires pour accorder cette licence.</p>}
          </div>
        )}
        <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
          <span className="text-sm text-foreground-muted">{wanted ? 'Budget maximum' : rental ? 'Prix pour toute la durée' : 'Prix demandé'}</span>
          <span className="font-mono text-2xl font-semibold">
            {formatPrice(annonce.price_cents)}
          </span>
        </div>
      </section>

      {digital && !wanted && <DigitalLicensePanel annonceId={row.id} isOwner={isOwner} priceCents={row.price_cents} />}
      {isOwner && quote && <SaleFeeSummary quote={quote} />}
      {isOwner && <ListingPromotionQuote annonceId={row.id} />}
      {isOwner ? (
        <p className="glass p-4 text-sm text-foreground-secondary">
          C’est ton annonce. <Link href={physicalCheckout ? '/commandes' : '/messages'} className="link-action">
            {physicalCheckout ? 'Voir mes commandes' : 'Voir mes échanges'}
          </Link>
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {physicalCheckout && (quote ? <BuyPanel annonceId={row.id} quote={quote} /> :
            <p role="alert">{pilot && !pilotAvailable ? 'Cette vente est réservée aux participants de la recette française.'
              : 'Le prix convenu ne peut pas être vérifié pour le moment. Réessaie dans un instant.'}</p>)}
          {/* EX-F1 : messagerie interne — la question AVANT l'achat */}
          <ContactButton annonceId={annonce.id} />
        </div>
      )}

      <ListingMatches listing={row} />
      {(digital || wanted) && (
        <Link className="link-action w-fit text-sm" href={`/marketplace?${related}`}>
          {digital ? (wanted ? 'Trouver les offres de ce format' : 'Trouver les recherches de ce format') : 'Parcourir les objets proposés'}
        </Link>
      )}
      <p className="flex items-center gap-2 text-xs text-foreground-muted">
        <Store size={14} />
        Annonce publiée après validation par son auteur.
      </p>
    </div>
  );
}
