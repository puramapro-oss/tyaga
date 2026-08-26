import { ArrowRight, Gem } from 'lucide-react';
import Link from 'next/link';

/**
 * EX-K2 — solde Vault : points gagnés sur chaque vente complétée (1 pt = 1 €
 * net, D15 sandbox). CTA vers /vida pour les objectifs.
 */
export default function VaultCard({ balance }: { balance: number }) {
  return (
    <section className="glass p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-foreground-muted">Vida Vault</p>
          <p className="font-mono mt-1 text-3xl">
            {balance} point{balance > 1 ? 's' : ''}
          </p>
        </div>
        <div
          aria-hidden
          className="flex h-12 w-12 items-center justify-center rounded-pill bg-primary/15 text-primary-on-dark"
        >
          <Gem size={22} />
        </div>
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
