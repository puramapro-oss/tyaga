import Link from 'next/link';

import { tyagaPalette } from '@/lib/brand/palette';

/**
 * Écran d'accueil APP (pas une landing 13 sections) :
 * logo + promesse + 2 CTA, comme ChatGPT.
 */
export default function HomePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6">
      <div className="flex w-full max-w-md flex-col items-center gap-10 text-center">
        {/* Marque */}
        <div className="flex flex-col items-center gap-5">
          <div
            aria-hidden
            className="flex h-16 w-16 items-center justify-center"
            style={{
              borderRadius: 'var(--radius-xl)',
              background: `linear-gradient(135deg, ${tyagaPalette.primary} 0%, ${tyagaPalette.secondary} 100%)`,
              boxShadow: `0 0 60px ${tyagaPalette.primary}4D`,
            }}
          >
            {/* Boucle de braise — signature TYAGA */}
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 3c-4.5 0-8 3.4-8 7.8 0 4.4 3.5 8.2 8 8.2 3 0 5.6-1.6 7-4"
                stroke="var(--background)"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
              <circle cx="19" cy="7" r="2.4" fill="var(--background)" />
            </svg>
          </div>
          <h1 className="font-display text-4xl tracking-tight">TYAGA</h1>
          <p className="text-balance text-[15px] leading-relaxed text-foreground-muted">
            Prends une photo. TYAGA rédige l’annonce, gère la vente.
            Vida encaisse pour tes objectifs.
          </p>
        </div>

        {/* CTA */}
        <div className="flex w-full flex-col gap-3">
          <Link
            href="/signup"
            className="flex h-12 items-center justify-center rounded-pill bg-primary font-medium text-on-primary transition-transform hover:scale-[1.02] active:scale-[0.98]"
          >
            Commencer
          </Link>
          <Link
            href="/login"
            className="link-nav flex h-12 items-center justify-center rounded-pill border border-border-control font-medium transition-colors hover:border-foreground-secondary"
          >
            Se connecter
          </Link>
        </div>

        <p className="text-xs text-foreground-secondary">
          Par PURAMA · Écosystème Vida
        </p>

        <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-foreground-muted">
          <Link href="/legal/cgu" className="link-action text-xs">
            CGU
          </Link>
          ·
          <Link href="/legal/cgv" className="link-action text-xs">
            CGV
          </Link>
          ·
          <Link href="/legal/politique-confidentialite" className="link-action text-xs">
            Confidentialité
          </Link>
          ·
          <Link href="/legal/mentions-legales" className="link-action text-xs">
            Mentions légales
          </Link>
        </p>
      </div>
    </main>
  );
}
