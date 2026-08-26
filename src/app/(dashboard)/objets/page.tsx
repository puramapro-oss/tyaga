import { Box, Camera, ChevronRight } from 'lucide-react';
import Link from 'next/link';

import { STATUS_LABELS } from '@/lib/labels';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { formatDate } from '@/lib/utils';

/**
 * EX-B5 — Mes objets : tout ce qui est au-delà du brouillon de scan.
 * Compteur et liste 100% réels (0 si 0).
 */

export default async function ObjetsPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: items } = await supabase
    .from('items')
    .select('id, title, category, brand, model, condition, status, created_at')
    .eq('user_id', user!.id)
    .neq('status', 'draft')
    .order('created_at', { ascending: false });

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="font-display text-3xl">Mes objets</h1>
        <p className="mt-2 text-sm text-foreground-muted">
          {items?.length ?? 0} objet{(items?.length ?? 0) > 1 ? 's' : ''} suivi
          {(items?.length ?? 0) > 1 ? 's' : ''} par TYAGA.
        </p>
      </div>

      {items && items.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {items.map((item) => {
            const status = STATUS_LABELS[item.status] ?? {
              label: item.status,
              tone: 'bg-card text-foreground-muted',
            };
            return (
              <li key={item.id}>
                <Link
                  href={`/objets/${item.id}`}
                  className="glass flex items-center gap-4 p-4 transition-colors hover:border-primary/40"
                >
                  <div
                    aria-hidden
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-pill bg-primary/12 text-primary-on-dark"
                  >
                    <Box size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {item.title || item.category || 'Objet sans nom'}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-foreground-muted">
                      {[item.category, item.brand, item.model]
                        .filter(Boolean)
                        .join(' · ') || 'À compléter'}{' '}
                      — ajouté le {formatDate(item.created_at)}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-pill px-3 py-1 text-xs font-medium ${status.tone}`}
                  >
                    {status.label}
                  </span>
                  <ChevronRight
                    size={16}
                    aria-hidden
                    className="shrink-0 text-foreground-muted"
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="glass flex flex-col items-center gap-4 p-8 text-center">
          <div
            aria-hidden
            className="flex h-12 w-12 items-center justify-center rounded-pill bg-primary/15 text-primary-on-dark"
          >
            <Box size={22} />
          </div>
          <p className="text-sm leading-relaxed text-foreground-secondary">
            Aucun objet pour l’instant. Scanne ton premier objet — 3 photos
            suffisent.
          </p>
          <Link
            href="/scan"
            className="flex h-11 items-center gap-2 rounded-pill bg-primary px-5 text-sm font-semibold text-on-primary"
          >
            <Camera size={16} />
            Scanner un objet
          </Link>
        </div>
      )}
    </div>
  );
}
