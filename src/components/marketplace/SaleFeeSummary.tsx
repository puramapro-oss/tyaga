import type { CommissionBreakdown } from '@/lib/commission';
import { formatPrice } from '@/lib/utils';

export default function SaleFeeSummary({ quote }: { quote: CommissionBreakdown }) {
  return (
    <dl aria-label="Détail du prix de vente" className="grid gap-2 rounded-md border border-border p-4 text-sm">
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
    </dl>
  );
}
