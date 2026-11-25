import type { CommissionBreakdown } from '@/lib/commission';
import { formatPrice } from '@/lib/utils';

export default function SaleFeeSummary({ quote }: { quote: CommissionBreakdown }) {
  const pilot = quote.policy === 'fr_p2p_test_v2';
  return (
    <dl aria-label="Détail du prix de vente" className="grid gap-2 rounded-md border border-border p-4 text-sm">
      {pilot && (
        <>
          <div className="flex flex-wrap justify-between gap-x-3">
            <dt>Prix de l’objet</dt><dd className="font-mono">{formatPrice(quote.itemCents!)}</dd>
          </div>
          <div className="flex flex-wrap justify-between gap-x-3">
            <dt>Frais acheteur</dt><dd className="font-mono">{formatPrice(quote.buyerFeeCents!)}</dd>
          </div>
        </>
      )}
      <div className="flex flex-wrap justify-between gap-x-3">
        <dt>Total acheteur</dt>
        <dd className="font-mono font-semibold">{formatPrice(quote.grossCents)}</dd>
      </div>
      <div className="flex flex-wrap justify-between gap-x-3">
        <dt>Commission vendeur ({quote.commissionPct.toLocaleString('fr-FR')} %)</dt>
        <dd className="font-mono">{formatPrice(quote.commissionCents)}</dd>
      </div>
      <div className="flex flex-wrap justify-between gap-x-3">
        <dt>Net vendeur</dt>
        <dd className="font-mono font-semibold">{formatPrice(quote.netCents)}</dd>
      </div>
      {pilot && <div className="border-t border-border pt-2 text-xs text-foreground-muted">
        <dt>Paiement de test</dt><dd>Recette Stripe en France. Seules les cartes de test sont acceptées.</dd>
      </div>}
    </dl>
  );
}
