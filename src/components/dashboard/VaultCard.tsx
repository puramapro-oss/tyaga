import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import BoucleRing from '@/components/vida/BoucleRing';

export interface ObjectifMini {
  label: string;
  current_points: number;
  target_points: number;
}

/**
 * EX-K2 — solde Vault : points gagnés sur chaque vente complétée (1 pt = 1 €
 * net, D15 sandbox). La Boucle (signature) : l'anneau suit la progression de
 * l'objectif actif le plus proche — chaque vente alimente l'anneau. Sans
 * objectif actif, l'anneau reste vide : le CTA propose d'en créer un.
 */
export default function VaultCard({
  balance,
  objectifs = [],
}: {
  balance: number;
  objectifs?: ObjectifMini[];
}) {
  // Objectif actif le plus avancé en ratio (ex æquo → le plus proche en points)
  const goal = [...objectifs]
    .filter((o) => o.target_points > 0)
    .sort(
      (a, b) =>
        b.current_points / b.target_points - a.current_points / a.target_points ||
        a.target_points - b.target_points,
    )[0];

  return (
    <section className="glass p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-foreground-muted">Vida Vault</p>
          <p className="font-mono mt-1 text-3xl">
            {balance} point{balance > 1 ? 's' : ''}
          </p>
          <p className="mt-2 text-xs text-foreground-secondary">
            {goal
              ? `Objectif le plus proche : « ${goal.label} »`
              : 'Crée un objectif pour fermer La Boucle'}
          </p>
        </div>
        <BoucleRing
          current={goal?.current_points ?? 0}
          target={goal?.target_points ?? 0}
        />
      </div>
      <Link
        href="/vida"
        className="mt-4 flex h-11 w-fit items-center gap-2 rounded-pill border border-border px-5 text-sm font-semibold transition-colors hover:border-primary/40"
      >
        Mes objectifs Vida
        <ArrowRight size={16} aria-hidden />
      </Link>
    </section>
  );
}
