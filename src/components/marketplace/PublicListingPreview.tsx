'use client';

import { useState } from 'react';
import { listingPreviewSummary, previewTokenPattern, type ReviewedListing } from '@/lib/listing-preview';

type Action = 'read' | 'enable' | 'revoke';
export function PublicListingPreview({ id, ...listing }: ReviewedListing & { id: string }) {
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const [address, setAddress] = useState('');
  const [message, setMessage] = useState('');

  async function manage(action: Action) {
    setPending(true);
    setMessage('');
    try {
      const response = await fetch(`/api/annonces/${id}/partage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'enable' ? { action, consent, reviewed: listing } : { action }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Service indisponible.');
      const prefix = '/api/annonces/apercu/';
      let url = '';
      if (body.path !== null) {
        if (typeof body.path !== 'string' || !body.path.startsWith(prefix) || !previewTokenPattern.test(body.path.slice(prefix.length))) throw new Error('Lien indisponible.');
        url = new URL(body.path, window.location.origin).href;
      }
      setAddress(url);
      if (action === 'revoke') setConsent(false);
      setMessage(action === 'revoke' ? 'Lien révoqué.' : url ? 'Lien public disponible.' : 'Aucun aperçu public actif.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Service indisponible.'); }
    finally { setPending(false); }
  }
  return <details className="glass p-4">
    <summary className="cursor-pointer font-semibold">Partager un aperçu public</summary>
    <div className="mt-3 grid gap-3">
      <p>Toute personne disposant du lien pourra voir ces informations, même sans compte. Un aperçu déjà copié ou enregistré par un réseau social peut rester visible après révocation.</p>
      <div className="rounded border border-border p-3 break-words"><strong>{listing.title}</strong><p>{listingPreviewSummary(listing)}</p></div>
      <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={consent} onChange={e => setConsent(e.target.checked)} />J’autorise le partage public de cet aperçu.</label>
      <div className="flex flex-wrap gap-4">
        <button className="link-action" type="button" disabled={pending || !consent} onClick={() => manage('enable')}>Créer le lien public</button>
        <button className="link-action" type="button" disabled={pending} onClick={() => manage('read')}>Retrouver mon lien</button>
        <button className="link-action" type="button" disabled={pending} onClick={() => manage('revoke')}>Révoquer le lien</button>
      </div>
      {address && <label className="grid gap-1">Lien public à partager<input aria-label="Lien public à partager" readOnly value={address} onFocus={e=>e.currentTarget.select()} className="w-full min-w-0 border border-border p-2 bg-background" /></label>}
      <p role="status">{message}</p>
    </div>
  </details>;
}
