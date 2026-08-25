'use client';

import { LogOut } from 'lucide-react';

import { createClient } from '@/lib/supabase';

/**
 * Déconnexion : signOut + purge du stockage + redirect dur
 * (erreur connue #2 — jamais un bouton mort).
 */
export default function LogoutButton({ compact = false }: { compact?: boolean }) {
  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      // stockage bloqué (navigation privée) : la redirection suffit
    }
    window.location.href = '/login';
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      className={
        compact
          ? 'flex h-11 w-11 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-card hover:text-foreground'
          : 'flex h-11 items-center gap-3 rounded-md px-3 text-foreground-muted transition-colors hover:bg-card hover:text-foreground'
      }
      aria-label="Se déconnecter"
    >
      <LogOut size={18} />
      {!compact && <span className="text-sm">Se déconnecter</span>}
    </button>
  );
}
