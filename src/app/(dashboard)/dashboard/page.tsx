import { Camera } from 'lucide-react';
import Link from 'next/link';

import FiscalCounter from '@/components/dashboard/FiscalCounter';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { fiscalSummary } from '@/lib/fiscal';
import { formatDate } from '@/lib/utils';

/**
 * Accueil : état réel du compte (profil + compteur annonces + revenus EX-J7).
 */
export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: profile }, { data: itemCountRows }, { data: ventesRows }] =
    await Promise.all([
      supabase
        .from('profiles')
        .select('full_name, created_at')
        .eq('id', user!.id)
        .single(),
      supabase
        .from('items')
        .select('id')
        .eq('user_id', user!.id)
        .neq('status', 'draft'),
      supabase
        .from('ventes')
        .select('net_amount_cents, fiscal_year')
        .eq('seller_id', user!.id),
    ]);
  const itemCount = itemCountRows?.length ?? 0;

  const firstName =
    profile?.full_name?.split(' ')[0] || user!.email?.split('@')[0] || 'toi';

  // EX-J7 — compteur fiscal : cumul nets de l'année en cours (D14 : requête)
  const fiscal = fiscalSummary(ventesRows ?? [], new Date().getFullYear());

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="font-display text-3xl">Bonjour {firstName}</h1>
        <p className="mt-2 text-sm text-foreground-muted">
          Membre depuis{' '}
          {profile?.created_at
            ? formatDate(profile.created_at)
            : formatDate(user!.created_at ?? new Date())}
          .
        </p>
      </div>

      {/* Compteur réel DB — 0 si 0 (jamais de chiffre inventé) */}
      <div className="glass p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-foreground-muted">Objets en vente</p>
            <p className="font-mono mt-1 text-3xl">{itemCount ?? 0}</p>
          </div>
          <div
            aria-hidden
            className="flex h-12 w-12 items-center justify-center rounded-pill bg-primary/15 text-primary-on-dark"
          >
            <Camera size={22} />
          </div>
        </div>
        {itemCount === 0 && (
          <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4">
            <p className="text-sm leading-relaxed text-foreground-secondary">
              Aucun objet pour l’instant. 3 photos suffisent pour commencer.
            </p>
            <Link
              href="/scan"
              className="flex h-11 w-fit items-center gap-2 rounded-pill bg-primary px-5 text-sm font-semibold text-primary-on-dark"
            >
              <Camera size={16} />
              Scanner mon premier objet
            </Link>
          </div>
        )}
      </div>

      {/* EX-J7 — revenus annuels nets + alerte 250 € */}
      <FiscalCounter summary={fiscal} />
    </div>
  );
}
