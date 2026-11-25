'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function PromotionControl({ listingId, grantId, active, buttonLabel }: {
  listingId: string; grantId: string; active: boolean; buttonLabel?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  async function submit() {
    setPending(true);
    try {
      const response = await fetch('/api/listing-promotions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, grantId, action: active ? 'cancel' : 'activate' }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        setMessage(result?.error || 'Impossible de modifier la mise en avant.');
      } else {
        setMessage(active ? 'Diffusion arrêtée.' : 'Bon activé.');
      }
      router.refresh();
    } catch {
      setMessage('Connexion interrompue. Tu peux réessayer.');
    } finally {
      setPending(false);
    }
  }
  return (
    <div>
      <button type="button" aria-label={buttonLabel} disabled={pending} onClick={submit} className="min-h-11 rounded-pill border border-border px-4">
        {active ? 'Arrêter la diffusion' : 'Utiliser ce bon'}
      </button>
      <p role="status" className="text-xs">{message}</p>
    </div>
  );
}
