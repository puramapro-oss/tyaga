import { Package } from 'lucide-react';
import Link from 'next/link';

import CommandeActions from '@/components/marketplace/CommandeActions';
import PackingChecklist from '@/components/marketplace/PackingChecklist';
import { orderPaymentLabel } from '@/lib/order-payment-label';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { formatDate, formatPrice } from '@/lib/utils';

/**
 * EX-E3/EX-G2 — commandes des deux côtés (acheteur + vendeur), lisibles
 * uniquement par les parties (RLS orders_select). L'adresse de livraison
 * n'est montrée au VENDEUR qu'à partir du statut paid.
 */

export const metadata = { title: 'Commandes — TYAGA' };

const STATUS_LABELS: Record<string, string> = {
  pending: 'En attente de paiement',
  paid: 'Payée — fonds séquestrés',
  shipped: 'Expédiée',
  delivered: 'Reçue — en cours de clôture',
  completed: 'Terminée',
  cancelled: 'Annulée',
};

interface SalePromotion {
  order_id: string;
  duration_hours: number;
  redeem_until: string;
  benefit_status: 'available' | 'active' | 'used' | 'expired' | 'revoked';
}

const PROMOTION_LABELS = {
  available: 'Disponible', active: 'En cours de diffusion', used: 'Utilisé', expired: 'Expiré', revoked: 'Retiré',
} as const;

interface OrderRow {
  id: string;
  buyer_id: string;
  seller_id: string;
  status: string;
  escrow_status: string;
  stripe_transfer_id: string | null;
  amount_cents: number;
  fee_policy: string;
  item_amount_cents: number | null;
  buyer_fee_cents: number | null;
  net_amount_cents: number;
  commission_amount_cents: number;
  shipping_address: Record<string, string> | null;
  created_at: string;
  annonces: { id: string; title: string } | null;
}

export default async function CommandesPage({
  searchParams,
}: {
  searchParams: Promise<{ paiement?: string }>;
}) {
  const { paiement } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: orders } = await supabase
    .from('marketplace_orders')
    .select(
      `id, buyer_id, seller_id, status, escrow_status, stripe_transfer_id, amount_cents,
       fee_policy, item_amount_cents, buyer_fee_cents, net_amount_cents, commission_amount_cents, shipping_address, created_at,
       annonces ( id, title )`
    )
    .order('created_at', { ascending: false })
    .limit(50);

  const rows = ((orders ?? []) as unknown as OrderRow[]).map((o) => ({
    ...o,
    role: (user?.id === o.buyer_id ? 'buyer' : 'seller') as 'buyer' | 'seller',
  }));

  const { data: promotions } = rows.length && user
    ? await supabase.rpc('my_sale_promotions', { p_orders: rows.map(order => order.id) })
    : { data: [] };
  const promotionByOrder = new Map((promotions as SalePromotion[] | null ?? []).map(p => [p.order_id, p]));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center gap-3">
        <Package size={22} />
        <h1 className="font-display text-3xl">Commandes</h1>
      </div>

      {paiement === 'ok' && (
        <p className="glass border-primary/40 p-4 text-sm text-foreground">
          Le statut de ta commande indique si le paiement a été confirmé.
        </p>
      )}

      {paiement === 'retour-test' && (
        <p className="glass p-4 text-sm">Retour de la recette Stripe. Le statut de la commande confirme le résultat du test.</p>
      )}

      {rows.length === 0 ? (
        <section className="glass flex flex-col items-center gap-3 p-10 text-center">
          <Package size={28} className="text-foreground-muted" />
          <p className="font-display text-lg">Aucune commande</p>
          <p className="text-sm text-foreground-secondary">
            Tes achats et tes ventes apparaîtront ici, du paiement à la
            confirmation de réception.
          </p>
          <Link href="/marketplace" className="link-nav text-sm">
            Parcourir la marketplace
          </Link>
        </section>
      ) : (
        <ul className="flex flex-col gap-4">
          {rows.map((o) => {
            const promotion = promotionByOrder.get(o.id);
            return (
            <li key={o.id} className="glass flex flex-col gap-3 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                {/* Pixel P6 : inline-flex min-h-11 — le lien titre ne faisait
                    que ~24px de haut, sous la zone tactile 44px. */}
                <Link
                  href={`/marketplace/${o.annonces?.id ?? ''}`}
                  className="inline-flex min-h-11 items-center font-medium hover:text-primary"
                >
                  {o.annonces?.title ?? 'Annonce retirée'}
                </Link>
                <span className="rounded-pill bg-primary/15 px-3 py-1 text-xs font-medium text-primary-on-dark">
                  {o.role === 'buyer' ? 'Achat' : 'Vente'} ·{' '}
                  {STATUS_LABELS[o.status] ?? o.status}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-foreground-secondary">
                <span>{formatDate(o.created_at)}</span>
                <span className="font-mono">{formatPrice(o.amount_cents)}</span>
                {o.fee_policy === 'fr_p2p_test_v2' && o.item_amount_cents !== null && o.buyer_fee_cents !== null && (
                  <span>Recette France · article {formatPrice(o.item_amount_cents)} · frais acheteur {formatPrice(o.buyer_fee_cents)}</span>
                )}
                {o.role === 'seller' && (
                  <span>
                    net vendeur{' '}
                    <span className="font-mono">{formatPrice(o.net_amount_cents)}</span>{' '}
                    (commission {formatPrice(o.commission_amount_cents)})
                  </span>
                )}
                <span className="text-foreground-muted">
                  {orderPaymentLabel(o)}
                </span>
              </div>

              {o.role === 'seller' &&
                o.status !== 'pending' &&
                o.status !== 'cancelled' &&
                o.shipping_address && (
                  <div className="rounded-md border border-border p-3 text-sm leading-relaxed">
                    <p className="mb-1 text-xs font-medium text-foreground-muted">
                      Adresse de livraison
                    </p>
                    {o.shipping_address.fullName}
                    <br />
                    {o.shipping_address.line1}
                    {o.shipping_address.line2 ? `, ${o.shipping_address.line2}` : ''}
                    <br />
                    {o.shipping_address.postalCode} {o.shipping_address.city},{' '}
                    {o.shipping_address.country}
                  </div>
                )}

              {o.role === 'seller' && o.status === 'paid' && (
                <PackingChecklist orderId={o.id} />
              )}

              {promotion && (
                <aside className="rounded-md border border-border p-3 text-sm">
                  <strong>Avantage de cette transaction · {PROMOTION_LABELS[promotion.benefit_status]}</strong>
                  <p>Mise en avant de {promotion.duration_hours} h pour une de tes annonces.</p>
                  {promotion.benefit_status === 'available' && <p>À activer avant le {formatDate(promotion.redeem_until)} depuis ta fiche d’annonce. <Link className="link-nav" href="/marketplace">Ouvrir les annonces</Link></p>}
                </aside>
              )}
              <CommandeActions
                orderId={o.id} status={o.status} role={o.role}
                settlementPending={!o.stripe_transfer_id && o.net_amount_cents > 0
                  && o.escrow_status !== 'refunded'}
              />
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
