import { redirect } from 'next/navigation';

import { createServiceClient } from '@/lib/service';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { isSuperAdmin } from '@/lib/utils';

/**
 * /admin God Mode (P4) — lecture seule V1. Gate serveur : e-mail super-admin
 * canonique OU flag profiles.is_super_admin (permet les tests e2e sans jamais
 * toucher au compte réel). Aucune action d'écriture ici : observabilité d'abord.
 */

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'God Mode — TYAGA',
};

const ORDER_STATUS: Record<string, string> = {
  pending: 'En attente de paiement',
  paid: 'Payée — séquestre',
  shipped: 'Expédiée',
  delivered: 'Livrée',
  completed: 'Terminée',
  cancelled: 'Annulée',
};

function StatusChip({ status }: { status: string }) {
  const tone =
    status === 'completed'
      ? 'bg-primary/15 text-primary-on-dark'
      : status === 'cancelled'
        ? 'bg-alert/15 text-alert'
        : 'bg-card text-foreground-muted';
  return (
    <span className={`inline-block whitespace-nowrap rounded-pill px-2.5 py-1 text-xs font-medium ${tone}`}>
      {ORDER_STATUS[status] ?? status}
    </span>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass border-gold p-4 md:p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-foreground-secondary">
        {label}
      </p>
      <p className="text-gold mt-1.5 font-display text-2xl md:text-3xl">{value}</p>
    </div>
  );
}

export default async function AdminPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/admin');

  const service = createServiceClient();
  const { data: me } = await service
    .from('profiles')
    .select('is_super_admin')
    .eq('id', user.id)
    .maybeSingle();
  if (!isSuperAdmin(user.email) && !me?.is_super_admin) redirect('/dashboard');

  const [profiles, orders, ventes, flagged, stripeEvents] = await Promise.all([
    service
      .from('profiles')
      .select('id,email,full_name,referral_code,created_at')
      .order('created_at', { ascending: false })
      .limit(10),
    service
      .from('marketplace_orders')
      .select(
        // Jury bugs P6 : pas de listing_id — la colonne est annonce_id, une
        // colonne inexistante fait échouer TOUTE la requête (table muette).
        'id,annonce_id,buyer_id,seller_id,amount_cents,commission_amount_cents,net_amount_cents,status,escrow_status,created_at'
      )
      .eq('fee_policy', 'legacy')
      .order('created_at', { ascending: false })
      .limit(10),
    service
      .from('ventes')
      .select('id,order_id,net_amount_cents,fiscal_year,completed_at')
      .eq('fee_policy', 'legacy')
      .order('completed_at', { ascending: false })
      .limit(5),
    service
      .from('inbox_messages')
      .select('id,conversation_id,sender_id,body,flag_reason,created_at')
      .eq('flagged_off_platform', true)
      .order('created_at', { ascending: false })
      .limit(10),
    service
      .from('stripe_events_processed')
      .select('event_id,event_type,processed_at')
      .order('processed_at', { ascending: false })
      .limit(10),
  ]);

  const [profilesCount, ordersCount, ventesCount, flaggedCount] = await Promise.all([
    service.from('profiles').select('id', { count: 'exact', head: true }),
    service.from('marketplace_orders').select('id', { count: 'exact', head: true }).eq('fee_policy', 'legacy'),
    service.from('ventes').select('id', { count: 'exact', head: true }).eq('fee_policy', 'legacy'),
    service
      .from('inbox_messages')
      .select('id', { count: 'exact', head: true })
      .eq('flagged_off_platform', true),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-gold font-display text-2xl md:text-3xl">God Mode</h1>
          <p className="mt-1.5 text-sm text-foreground-muted">
            Observatoire lecture seule — utilisateurs, commandes, litiges, logs.
          </p>
        </div>
        <span className="border-gold bg-gold-soft text-gold rounded-pill border px-3 py-1.5 text-xs font-semibold">
          Super-admin
        </span>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <StatCard label="Utilisateurs" value={String(profilesCount.count ?? 0)} />
        <StatCard label="Commandes" value={String(ordersCount.count ?? 0)} />
        <StatCard label="Ventes complétées" value={String(ventesCount.count ?? 0)} />
        <StatCard label="Litiges" value={String(flaggedCount.count ?? 0)} />
      </section>

      <section className="glass p-5 md:p-6">
        <h2 className="font-display text-lg">Derniers utilisateurs</h2>
        {profiles.data && profiles.data.length > 0 ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-foreground-secondary">
                  <th className="py-2 pr-4 font-medium">E-mail</th>
                  <th className="py-2 pr-4 font-medium">Nom</th>
                  <th className="py-2 pr-4 font-medium">Code parrain</th>
                  <th className="py-2 font-medium">Inscription</th>
                </tr>
              </thead>
              <tbody>
                {profiles.data.map((p) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="max-w-[220px] truncate py-2.5 pr-4">{p.email}</td>
                    <td className="py-2.5 pr-4 text-foreground-muted">
                      {p.full_name ?? '—'}
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-xs text-foreground-muted">
                      {p.referral_code ?? '—'}
                    </td>
                    <td className="py-2.5 whitespace-nowrap text-foreground-muted">
                      {new Date(p.created_at).toLocaleDateString('fr-FR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 text-sm text-foreground-muted">
            Aucun utilisateur pour l’instant.
          </p>
        )}
      </section>

      <section className="glass p-5 md:p-6">
        <h2 className="font-display text-lg">Dernières commandes</h2>
        {orders.data && orders.data.length > 0 ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-foreground-secondary">
                  <th className="py-2 pr-4 font-medium">Montant</th>
                  <th className="py-2 pr-4 font-medium">Commission</th>
                  <th className="py-2 pr-4 font-medium">Net vendeur</th>
                  <th className="py-2 pr-4 font-medium">Statut</th>
                  <th className="py-2 font-medium">Séquestre</th>
                </tr>
              </thead>
              <tbody>
                {orders.data.map((o) => (
                  <tr key={o.id} className="border-t border-border">
                    <td className="py-2.5 pr-4 font-medium">
                      {formatCents(o.amount_cents)}
                    </td>
                    <td className="py-2.5 pr-4 text-foreground-muted">
                      {formatCents(o.commission_amount_cents)}
                    </td>
                    <td className="py-2.5 pr-4">{formatCents(o.net_amount_cents)}</td>
                    <td className="py-2.5 pr-4">
                      <StatusChip status={o.status} />
                    </td>
                    <td className="py-2.5 text-foreground-muted">{o.escrow_status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 text-sm text-foreground-muted">
            Aucune commande pour l’instant.
          </p>
        )}
      </section>

      <section className="glass p-5 md:p-6">
        <h2 className="font-display text-lg">
          Litiges — messages bloqués hors plateforme
        </h2>
        {flagged.data && flagged.data.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-3">
            {flagged.data.map((m) => (
              <li key={m.id} className="rounded-md bg-card p-3.5">
                <p className="text-xs text-foreground-secondary">
                  {new Date(m.created_at).toLocaleString('fr-FR')} — motif :{' '}
                  {m.flag_reason ?? 'non précisé'}
                </p>
                <p className="mt-1.5 line-clamp-2 text-sm text-foreground-muted">
                  {m.body}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-foreground-muted">
            Aucun message bloqué — les échanges restent sur la plateforme.
          </p>
        )}
      </section>

      <section className="glass p-5 md:p-6">
        <h2 className="font-display text-lg">Ventes récentes</h2>
        {ventes.data && ventes.data.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {ventes.data.map((v) => (
              <li
                key={v.id}
                className="flex items-center justify-between gap-3 border-t border-border py-2.5 first:border-t-0"
              >
                <span className="text-foreground-muted">
                  {new Date(v.completed_at).toLocaleDateString('fr-FR')} · exercice{' '}
                  {v.fiscal_year}
                </span>
                <span className="font-medium">{formatCents(v.net_amount_cents)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-foreground-muted">
            Aucune vente complétée pour l’instant.
          </p>
        )}
      </section>

      <section className="glass p-5 md:p-6">
        <h2 className="font-display text-lg">Logs Stripe</h2>
        {stripeEvents.data && stripeEvents.data.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-2 font-mono text-xs">
            {stripeEvents.data.map((e) => (
              <li
                key={e.event_id}
                className="flex items-center justify-between gap-3 border-t border-border py-2 first:border-t-0"
              >
                <span className="text-foreground-muted">{e.event_type}</span>
                <span className="text-foreground-secondary">
                  {new Date(e.processed_at).toLocaleString('fr-FR')}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-foreground-muted">
            Aucun événement Stripe traité pour l’instant.
          </p>
        )}
      </section>
    </div>
  );
}

function formatCents(cents: number | null): string {
  if (cents === null || cents === undefined) return '—';
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
  }).format(cents / 100);
}
