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
  settlementPending?: boolean;
}

const BUTTON_CLASS =
  'flex h-11 items-center justify-center gap-2 rounded-pill border border-border px-5 text-sm font-semibold transition-colors hover:border-primary/40 disabled:opacity-60';

export default function CommandeActions({
  orderId,
  status,
  role,
  settlementPending = false,
}: CommandeActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const action =
    role === 'buyer' && status === 'pending'
      ? { key: 'cancel', label: 'Annuler la commande' }
      : role === 'seller' && status === 'pending'
        ? { key: 'seller_cancel', label: 'Retirer l’objet de la vente' }
        : role === 'seller' && status === 'paid'
          ? { key: 'ship', label: 'Objet expédié' }
          : role === 'buyer' && status === 'shipped'
            ? { key: 'deliver', label: 'J’ai bien reçu l’objet' }
            : role === 'buyer' && status === 'delivered'
              ? { key: 'deliver', label: 'Finaliser la réception' }
              : role === 'buyer' && status === 'completed' && settlementPending
                ? { key: 'deliver', label: 'Vérifier le versement' }
            : null;

  if (!action) return null;

  async function run() {
    if (loading) return;
    setError(null);
    setNotice(null);
    setLoading(action!.key);
    try {
      const res = await fetch(`/api/orders/${orderId}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: action!.key }),
      });
      const data = (await res.json()) as {
        error?: string; settlement?: { status: string };
      };
      if (!res.ok) {
        setError(data.error ?? 'Action impossible.');
        setLoading(null);
        return;
      }
      if (data.settlement?.status === 'verification_required') {
        setNotice('La réception est enregistrée. Le versement vendeur reste à vérifier.');
      } else if (data.settlement?.status === 'awaiting_account') {
        setNotice('La réception est enregistrée. Le vendeur doit connecter son compte de versement.');
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
      {notice && <p role="status" className="text-sm text-foreground-secondary">{notice}</p>}
    </div>
  );
}
