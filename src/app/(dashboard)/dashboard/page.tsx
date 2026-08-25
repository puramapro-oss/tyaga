import { Camera } from 'lucide-react';
import Link from 'next/link';

import { createServerSupabaseClient } from '@/lib/supabase-server';
import { formatDate } from '@/lib/utils';

/**
 * Accueil P1 : état réel du compte (profil + compteur annonces). La brique
 * Scan (P2.1) remplacera l'état vide par l'entrée caméra.
 */
export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, created_at')
    .eq('id', user!.id)
    .single();

  const { count: itemCount } = await supabase
    .from('items')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user!.id)
    .neq('status', 'draft');

  const firstName =
    profile?.full_name?.split(' ')[0] || user!.email?.split('@')[0] || 'toi';

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
    </div>
  );
}
