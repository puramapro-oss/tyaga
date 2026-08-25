'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * EX-E3 — actions de commande selon le rôle et le statut.
 * L'API + la RLS refusent toute transition d'une mauvaise partie : ce
 * composant ne fait qu'afficher les boutons légitimes.
 */

interface CommandeActionsProps {
  orderId: string;
  status: string;
  role: 'buyer' | 'seller';
}

const BUTTON_CLASS =
  'flex h-11 items-center justify-center gap-2 rounded-pill border border-border px-5 text-sm font-semibold transition-colors hover:border-primary/40 disabled:opacity-60';

export default function CommandeActions({
  orderId,
  status,
  role,
}: CommandeActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const action =
    role === 'buyer' && status === 'pending'
      ? { key: 'cancel', label: 'Annuler la commande' }
      : role === 'seller' && status === 'paid'
        ? { key: 'ship', label: 'Objet expédié' }
        : role === 'buyer' && status === 'shipped'
          ? { key: 'deliver', label: 'J’ai bien reçu l’objet' }
          : null;

  if (!action) return null;

  async function run() {
    if (loading) return;
    setError(null);
    setLoading(action!.key);
    try {
      const res = await fetch(`/api/orders/${orderId}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: action!.key }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Action impossible.');
        setLoading(null);
        return;
      }
      router.refresh();
      setLoading(null);
    } catch {
      setError('Connexion impossible. Réessaie.');
      setLoading(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={run} disabled={loading !== null} className={`${BUTTON_CLASS} w-fit`}>
        {loading === action.key && <Loader2 size={15} className="animate-spin" />}
        {action.label}
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
