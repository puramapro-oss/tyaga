'use client';

import { Check, Copy, HeartPulse, Wallet } from 'lucide-react';
import { useState } from 'react';

/**
 * EX-K2 — cross-promo écosystème : VIDA (objectis) + KASH (finances perso),
 * code WELCOME50 copiable. Liens directs vers les apps sœurs PURAMA.
 */
export default function CrossPromoCard() {
  const [copied, setCopied] = useState(false);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText('WELCOME50');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard refusé : le code reste affiché, copiable manuellement
    }
  }

  return (
    <section className="glass flex flex-col gap-4 p-6">
      <h2 className="font-display text-xl">Écosystème PURAMA</h2>

      <div className="flex flex-col gap-2">
        <a
          href="https://vida.purama.dev"
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-11 items-center gap-3 rounded-pill border border-border px-4 text-sm font-medium transition-colors hover:border-primary/40"
        >
          <HeartPulse size={16} aria-hidden />
          VIDA — tes objectifs, nos points
          <span className="ml-auto text-foreground-muted" aria-hidden>
            ↗
          </span>
        </a>
        <a
          href="https://kash.purama.dev"
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-11 items-center gap-3 rounded-pill border border-border px-4 text-sm font-medium transition-colors hover:border-primary/40"
        >
          <Wallet size={16} aria-hidden />
          KASH — tes finances, claires
          <span className="ml-auto text-foreground-muted" aria-hidden>
            ↗
          </span>
        </a>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
        <p className="text-xs leading-relaxed text-foreground-muted">
          Code <span className="font-mono text-foreground">WELCOME50</span> :
          offre d’accueil à la création d’un compte sur VIDA ou KASH, valable
          une fois par personne. Conditions détaillées sur l’app où tu
          l’utilises.
        </p>
        <button
          type="button"
          onClick={copyCode}
          aria-label="Copier le code WELCOME50"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-pill border border-border transition-colors hover:border-primary/40"
        >
          {copied ? (
            <Check size={15} className="text-primary-on-dark" />
          ) : (
            <Copy size={15} />
          )}
        </button>
      </div>
    </section>
  );
}
