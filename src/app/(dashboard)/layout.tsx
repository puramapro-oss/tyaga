import { redirect } from 'next/navigation';
import { CircleHelp } from 'lucide-react';
import Link from 'next/link';

import LogoutButton from '@/components/layout/LogoutButton';
import { BottomTabs, SidebarNav } from '@/components/layout/NavLinks';
import { tyagaPalette } from '@/lib/brand/palette';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { getInitials } from '@/lib/utils';

/**
 * Coque app : sidebar 280px desktop, bottom tabs mobile (72px réservés via
 * globals.css). P1 : Accueil seul — chaque future brique ajoutera son onglet.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const email = user.email ?? '';
  const initials = getInitials(user.user_metadata?.full_name || email);

  return (
    <div className="flex min-h-dvh">
      {/* Sidebar desktop */}
      <aside className="hidden w-[280px] shrink-0 flex-col justify-between border-r border-border p-5 md:flex">
        <div className="flex flex-col gap-8">
          <div className="flex items-center gap-3 px-2">
            <div
              aria-hidden
              className="flex h-9 w-9 items-center justify-center"
              style={{
                borderRadius: 'var(--radius-md)',
                background: `linear-gradient(135deg, ${tyagaPalette.primary} 0%, ${tyagaPalette.secondary} 100%)`,
              }}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 3c-4.5 0-8 3.4-8 7.8 0 4.4 3.5 8.2 8 8.2 3 0 5.6-1.6 7-4"
                  stroke="var(--background)"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                />
                <circle cx="19" cy="7" r="2.4" fill="var(--background)" />
              </svg>
            </div>
            <span className="font-display text-lg">TYAGA</span>
          </div>

          <SidebarNav />
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3 px-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-pill bg-secondary/25 text-xs font-semibold">
              {initials}
            </div>
            <span className="truncate text-sm text-foreground-muted">
              {email}
            </span>
          </div>
          <LogoutButton />
        </div>
      </aside>

      {/* Contenu */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header mobile */}
        <header className="flex items-center justify-between border-b border-border px-5 py-3 md:hidden">
          <span className="font-display text-lg">TYAGA</span>
          <div className="flex items-center gap-1">
            <Link
              href="/aide"
              aria-label="Aide"
              className="flex h-11 w-11 items-center justify-center rounded-pill text-foreground-muted transition-colors hover:bg-card/60 hover:text-foreground"
            >
              <CircleHelp size={19} />
            </Link>
            <LogoutButton compact />
          </div>
        </header>

        {/* pb mobile ≥ hauteur bottom tabs (72px + safe-area) — utility ici
            car p-5 (classe) écraserait la règle `main` de globals.css. */}
        <main className="flex-1 p-5 pb-[calc(72px+env(safe-area-inset-bottom))] md:p-8 md:pb-8">
          {children}
        </main>

        {/* Bottom tabs mobile */}
        <BottomTabs />
      </div>
    </div>
  );
}
