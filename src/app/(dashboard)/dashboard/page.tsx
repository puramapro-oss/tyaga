import { Camera } from 'lucide-react';
import Link from 'next/link';

import AmbassadorCard from '@/components/dashboard/AmbassadorCard';
import CrossPromoCard from '@/components/dashboard/CrossPromoCard';
import FiscalCounter from '@/components/dashboard/FiscalCounter';
import ReferralAttach from '@/components/dashboard/ReferralAttach';
import ReferralCard from '@/components/dashboard/ReferralCard';
import VaultCard from '@/components/dashboard/VaultCard';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { fiscalSummary } from '@/lib/fiscal';
import { formatDate } from '@/lib/utils';

/**
 * EX-K2 — accueil : 3 blocs universels above the fold (parrainage,
 * ambassadeur, cross-promo VIDA/KASH WELCOME50), puis objets + solde Vault
 * + compteur fiscal EX-J7. Tous les chiffres viennent de la DB (0 si 0).
 */
export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [
    { data: profile },
    { data: itemCountRows },
    { data: ventesRows },
    { data: wallet },
    { data: filleulRows },
    { data: objectifRows },
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select('full_name, created_at, referral_code')
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
    supabase
      .from('vida_wallet')
      .select('balance_points')
      .eq('user_id', user!.id)
      .maybeSingle(),
    supabase
      .from('referrals')
      .select('id')
      .eq('referrer_id', user!.id),
    supabase
      .from('vida_objectifs')
      .select('label, current_points, target_points')
      .eq('user_id', user!.id)
      .eq('active', true),
  ]);
  const itemCount = itemCountRows?.length ?? 0;
  const filleuls = filleulRows?.length ?? 0;
  const balance = wallet?.balance_points ?? 0;

  // Ceinture et bretelles : backfill DDL + trigger + RPC couvrent tout profil
  let referralCode = profile?.referral_code ?? null;
  if (!referralCode) {
    const { data: ensured } = await supabase.rpc('ensure_referral_code');
    referralCode = ensured ?? null;
  }

  const firstName =
    profile?.full_name?.split(' ')[0] || user!.email?.split('@')[0] || 'toi';

  // EX-J7 — compteur fiscal : cumul nets de l'année en cours (D14 : requête)
  const fiscal = fiscalSummary(ventesRows ?? [], new Date().getFullYear());

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
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

      {/* Parrainage V4 — consomme /signup?ref=… au premier passage */}
      <ReferralAttach />

      {/* EX-K2 — 3 blocs universels above the fold. D5 : carrousel scroll-snap
          mobile (cards 280px) au lieu d'une pile pleine largeur, grille dès md */}
      <div className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 md:pb-0 md:gap-6 md:items-start">
        {referralCode && (
          <div className="min-w-[280px] snap-start md:min-w-0">
            <ReferralCard code={referralCode} filleuls={filleuls} />
          </div>
        )}
        {referralCode && (
          <div className="min-w-[280px] snap-start md:min-w-0">
            <AmbassadorCard filleuls={filleuls} />
          </div>
        )}
        <div className="min-w-[280px] snap-start md:min-w-0">
          <CrossPromoCard />
        </div>
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

      {/* Solde Vault + EX-J7 revenus annuels nets + alerte 250 €. D7 : 2 colonnes dès sm */}
      <div className="grid items-start gap-6 sm:grid-cols-2">
        <VaultCard balance={balance} objectifs={objectifRows ?? []} />
        <FiscalCounter summary={fiscal} />
      </div>
    </div>
  );
}
