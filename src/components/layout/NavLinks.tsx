'use client';

import {
  Camera,
  CircleHelp,
  Home,
  Box,
  MessageCircle,
  Package,
  Sparkles,
  Store,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Navigation app : Accueil, Scanner, Mes objets, Marketplace, Messages. Desktop = colonne,
 * mobile = onglets bas. Actif = bg-card + aria-current.
 */

const LINKS = [
  { href: '/dashboard', label: 'Accueil', icon: Home, exact: true },
  { href: '/scan', label: 'Scanner', icon: Camera, exact: true },
  { href: '/objets', label: 'Mes objets', icon: Box, exact: true },
  { href: '/marketplace', label: 'Marketplace', icon: Store, exact: false },
  { href: '/messages', label: 'Messages', icon: MessageCircle, exact: false },
  { href: '/commandes', label: 'Commandes', icon: Package, exact: true },
  { href: '/vida', label: 'Points Vida', icon: Sparkles, exact: true },
] as const;

export function SidebarNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1">
      {LINKS.map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`flex h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors ${
              active
                ? 'bg-card text-foreground'
                : 'text-foreground-muted hover:bg-card/60 hover:text-foreground'
            }`}
          >
            <Icon size={17} />
            {label}
          </Link>
        );
      })}
      {/* Aide : sidebar seulement — les bottom tabs mobile restent à 7 */}
      <Link
        href="/aide"
        aria-current={pathname.startsWith('/aide') ? 'page' : undefined}
        className={`flex h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors ${
          pathname.startsWith('/aide')
            ? 'bg-card text-foreground'
            : 'text-foreground-muted hover:bg-card/60 hover:text-foreground'
        }`}
      >
        <CircleHelp size={17} />
        Aide
      </Link>
    </nav>
  );
}

export function BottomTabs() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 flex min-h-[72px] items-center justify-around border-t border-border bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      {LINKS.map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            aria-label={label}
            className={`flex h-11 items-center gap-2 rounded-pill px-4 text-sm font-medium transition-colors ${
              active
                ? 'bg-card text-foreground'
                : 'text-foreground-muted hover:text-foreground'
            }`}
          >
            <Icon size={20} />
          </Link>
        );
      })}
    </nav>
  );
}
