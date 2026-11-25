'use client';

import { Share2 } from 'lucide-react';
import { useState } from 'react';

type ShareTarget = { title: string } & ({ id: string; previewToken?: never } | { previewToken: string; id?: never });

export default function ShareListing(target: ShareTarget) {
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState('');
  const publicPreview = target.previewToken !== undefined;

  async function share() {
    const path = target.previewToken !== undefined
      ? `/api/annonces/apercu/${encodeURIComponent(target.previewToken)}`
      : `/marketplace/${encodeURIComponent(target.id)}`;
    const url = new URL(path, window.location.origin).href;
    setCopied(false);
    setManual('');
    if (navigator.share) {
      try {
        await navigator.share({ title: target.title, url });
        return;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setManual(url);
    }
  }

  return (
    <div className="grid gap-2 text-sm">
      <button type="button" className="inline-flex min-h-11 w-fit items-center gap-2 rounded-pill border border-border-control px-4" onClick={share}>
        <Share2 size={16} aria-hidden /> {publicPreview ? 'Partager l’aperçu public' : 'Partager l’annonce'}
      </button>
      <span role="status">{copied && (publicPreview ? 'Lien de l’aperçu public copié.' : 'Lien de l’annonce copié.')}</span>
      {manual && publicPreview && <p role="status">Sélectionne le lien public ci-dessus pour le copier.</p>}
      {manual && !publicPreview && <label className="grid gap-1">Lien à copier
        <input className="rounded-md border border-border-control bg-background-soft px-3 py-2" readOnly value={manual} onFocus={e => e.target.select()} />
      </label>}
    </div>
  );
}
