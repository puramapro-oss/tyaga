'use client';

import { Share2 } from 'lucide-react';
import { useState } from 'react';

export default function ShareListing({ id, title }: { id: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState('');

  async function share() {
    const url = new URL(`/marketplace/${encodeURIComponent(id)}`, window.location.origin).href;
    setCopied(false);
    setManual('');
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
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
        <Share2 size={16} aria-hidden /> Partager l’annonce
      </button>
      <span role="status">{copied ? 'Lien de l’annonce copié.' : ''}</span>
      {manual && <label className="grid gap-1">Lien à copier
        <input className="rounded-md border border-border-control bg-background-soft px-3 py-2" readOnly value={manual} onFocus={e => e.target.select()} />
      </label>}
    </div>
  );
}
