'use client';

import { useState } from 'react';
import { listingPreviewSummary, previewTokenPattern, type ReviewedListing } from '@/lib/listing-preview';
import ShareListing from './ShareListing';

type Action = 'read' | 'enable' | 'revoke';
type PreviewProps = ReviewedListing & { id: string };

export function PublicListingPreview(props: PreviewProps) {
  const { id, title, priceCents, kind, intent, mode } = props;
  return <PreviewSettings key={JSON.stringify([id, title, priceCents, kind, intent, mode])} {...props} />;
}

function PreviewSettings({ id, ...listing }: PreviewProps) {
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const [token, setToken] = useState('');
  const [message, setMessage] = useState('');

  async function manage(action: Action) {
    setPending(true);
    setToken('');
    setMessage('');
    try {
      const response = await fetch(`/api/annonces/${id}/partage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'enable' ? { action, consent, reviewed: listing } : { action }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Service indisponible.');
      const prefix = '/api/annonces/apercu/';
      let nextToken = '';
      if (body.path !== null) {
        if (typeof body.path !== 'string' || !body.path.startsWith(prefix) || !previewTokenPattern.test(body.path.slice(prefix.length))) throw new Error('Lien indisponible.');
        nextToken = body.path.slice(prefix.length);
      }
      setToken(nextToken);
      if (action === 'revoke') setConsent(false);
      setMessage(action === 'revoke' ? 'Lien révoqué.' : nextToken ? 'Lien public disponible.' : 'Aucun aperçu public actif.');
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
      {token && <>
        <label className="grid gap-1">Lien public à partager<input aria-label="Lien public à partager" readOnly value={new URL(`/api/annonces/apercu/${token}`, window.location.origin).href} onFocus={e=>e.currentTarget.select()} className="w-full min-w-0 border border-border p-2 bg-background" /></label>
        <ShareListing previewToken={token} title={listing.title} />
      </>}
      <p role="status">{message}</p>
    </div>
  </details>;
}
