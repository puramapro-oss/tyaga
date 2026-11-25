import 'server-only';

import PointsPromotionCheckout from '@/components/marketplace/PointsPromotionCheckout';
import PromotionControl from '@/components/marketplace/PromotionControl';
import { getListingPromotionQuote } from '@/lib/listing-promotion';
import { pointsPromotionTestOrigin } from '@/lib/promotion-points-test';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { formatPrice } from '@/lib/utils';

interface Grant {
  grant_id: string;
  kind: 'campaign_benefit' | 'points_receipt' | 'eur_receipt';
  duration_hours: number;
  redeem_until: string;
  ends_at: string | null;
}
const kindLabel = { campaign_benefit: 'Avantage offert', points_receipt: 'Bon réglé en points PURAMA', eur_receipt: 'Bon réglé en euros' };
function time(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris',
  }).format(new Date(value));
}

export default async function ListingPromotionQuote({ annonceId }: { annonceId: string }) {
  const supabase = await createServerSupabaseClient();
  const [{ data, error }, publication] = await Promise.all([
    supabase.rpc('my_listing_promotions', { p_listing: annonceId }),
    supabase.rpc('my_publication_benefit', { p_listing: annonceId }),
  ]);
  const grants = (data ?? []) as Grant[];
  const publicationGrant = publication.error ? null : publication.data?.grant_id;
  const campaignActive = grants.some(grant => grant.ends_at !== null);
  const quote = getListingPromotionQuote(process.env.TYAGA_LISTING_PROMOTION_QUOTE);
  return (
    <section className="glass flex flex-col gap-3 p-5">
      <h2 className="font-display text-lg">Mettre mon annonce en avant</h2>
      <p className="text-sm">L’emplacement « Sponsorisé » affiche une annonce en tête parmi les résultats de la page qui correspondent à la recherche.</p>
      {error ? <p className="text-sm">Les bons sont momentanément indisponibles.</p> : grants.length ? (
        <ul className="flex flex-col gap-3">
          {grants.map(grant => (
            <li key={grant.grant_id} className="flex flex-col gap-1">
              <span className="text-sm font-semibold">{grant.grant_id === publicationGrant ? 'Bon gagné en publiant cette annonce' : kindLabel[grant.kind]} · {grant.duration_hours} h</span>
              <span className="text-xs text-foreground-muted">{grant.ends_at
                ? 'En cours jusqu’au ' + time(grant.ends_at) + ' (Paris). Un arrêt met fin à ce bon.'
                : 'À activer avant le ' + time(grant.redeem_until) + ' (Paris).'}</span>
              {(grant.ends_at || !campaignActive) && <PromotionControl listingId={annonceId} grantId={grant.grant_id} active={!!grant.ends_at} />}
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-foreground-muted">Aucun bon de mise en avant disponible pour cette annonce.</p>}
      {quote && (
        <p className="text-xs text-foreground-muted">
          Devis web en France pour {quote.durationHours} h · {[
            quote.priceEurCentsTtc === null ? null : formatPrice(quote.priceEurCentsTtc) + ' TTC',
            quote.puramaPoints === null ? null : quote.puramaPoints.toLocaleString('fr-FR') + ' points PURAMA',
          ].filter(Boolean).join(' ou ')}. Valable jusqu’au {time(quote.endsAt)} (Paris), réf. {quote.revision}.
          Ce devis web est présenté à titre indicatif.
        </p>
      )}
      {pointsPromotionTestOrigin(process.env) && <PointsPromotionCheckout key={annonceId} listingId={annonceId} />}
    </section>
  );
}
