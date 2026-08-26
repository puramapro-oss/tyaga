import { LifeBuoy, Mail } from 'lucide-react';

import SupportChat from '@/components/aide/SupportChat';
import { FAQ_CATEGORIES } from '@/lib/faq';

/**
 * /aide (P4) — chatbot SAV + FAQ en accordéon natif (0 JS pour la FAQ).
 * Le contact humain reste visible en permanence : l'IA est un filtre,
 * pas un mur.
 */

export const metadata = {
  title: 'Aide & FAQ — TYAGA',
};

export default function AidePage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <header>
        <h1 className="font-display text-2xl md:text-3xl">Aide & FAQ</h1>
        <p className="mt-1.5 text-sm text-foreground-muted">
          Tout ce qu’il faut savoir pour vendre et acheter sereinement.
        </p>
      </header>

      <SupportChat />

      {FAQ_CATEGORIES.map((category) => (
        <section key={category.title} className="glass p-5 md:p-6">
          <h2 className="font-display text-lg">{category.title}</h2>
          <div className="mt-3 flex flex-col">
            {category.entries.map((entry) => (
              <details
                key={entry.q}
                className="group border-b border-border last:border-b-0"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-3.5 text-sm font-medium text-foreground marker:hidden [&::-webkit-details-marker]:hidden">
                  {entry.q}
                  <span
                    aria-hidden
                    className="shrink-0 text-foreground-secondary transition-transform group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="pb-4 text-sm leading-relaxed text-foreground-muted">
                  {entry.a}
                </p>
              </details>
            ))}
          </div>
        </section>
      ))}

      <section className="glass flex items-start gap-4 p-5 md:p-6">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-pill bg-primary/15 text-primary-on-dark">
          <Mail size={18} />
        </span>
        <div>
          <h2 className="font-display text-lg">Besoin d’un humain ?</h2>
          <p className="mt-1 text-sm leading-relaxed text-foreground-muted">
            Écris à{' '}
            <a
              href="mailto:hello@tyaga.purama.dev"
              className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-primary"
            >
              hello@tyaga.purama.dev
            </a>{' '}
            — réponse sous 48 h, du lundi au samedi.
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-foreground-secondary">
            <LifeBuoy size={13} />
            Litige, remboursement, compte : un humain répond, pas un robot.
          </p>
        </div>
      </section>
    </div>
  );
}
