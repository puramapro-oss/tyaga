'use client';

import { Check, Copy, Users } from 'lucide-react';
import { useEffect, useState } from 'react';

import { referralLink } from '@/lib/referral';

/**
 * EX-K2 — bloc parrainage : code TY-XXXXXX + lien d'invitation copiable.
 * N1 (Parrainage V4) : 50 % de la commission TYAGA sur la première vente
 * complétée du filleul, créditée au parrain en points Vault.
 */
export default function ReferralCard({
  code,
  filleuls,
}: {
  code: string;
  filleuls: number;
}) {
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);

  // Construit côté client : aucune env d'origine à maintenir
  useEffect(() => {
    setLink(referralLink(code, window.location.origin));
  }, [code]);

  async function copy(kind: 'code' | 'link') {
    const text = kind === 'code' ? code : link;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard refusé (permission/HTTP) : le code reste lisible/copiable à la main
    }
  }

  return (
    <section className="glass flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-xl">
          <Users size={18} />
          Parrainage
        </h2>
        {/* Pixel P6 : fond plein — le badge translucide (primary/20) tombait
            à 3,27:1 sur le glass, sous le seuil WCAG 4,5:1. */}
        <span className="rounded-pill bg-primary px-3 py-1 text-xs font-medium text-on-primary">
          {filleuls} filleul{filleuls > 1 ? 's' : ''}
        </span>
      </div>

      <div>
        <p className="text-sm text-foreground-muted">Ton code</p>
        <div className="mt-1 flex items-center gap-3">
          <p className="min-w-0 truncate font-mono text-2xl tracking-wider">{code}</p>
          {/* Pixel P6 : shrink-0 — le flex réduisait le bouton copier à 17px
              de large @768, sous la zone tactile 44px. */}
          <button
            type="button"
            onClick={() => copy('code')}
            aria-label="Copier mon code de parrainage"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-pill border border-border transition-colors hover:border-primary/40"
          >
            {copied === 'code' ? (
              <Check size={15} className="text-primary-on-dark" />
            ) : (
              <Copy size={15} />
            )}
          </button>
        </div>
      </div>

      {link && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => copy('link')}
            className="flex h-11 items-center justify-center gap-2 rounded-pill bg-primary px-5 text-sm font-semibold text-on-primary"
          >
            {copied === 'link' ? (
              <>
                <Check size={16} /> Lien copié
              </>
            ) : (
              <>
                <Copy size={16} /> Copier mon lien d’invitation
              </>
            )}
          </button>
          <p className="truncate text-xs text-foreground-muted">{link}</p>
        </div>
      )}

      <p className="border-t border-border pt-3 text-xs leading-relaxed text-foreground-muted">
        Ta première vente complétée en tant que filleul rapporte à ton parrain
        50 % de la commission TYAGA, en points Vault.
      </p>
    </section>
  );
}
