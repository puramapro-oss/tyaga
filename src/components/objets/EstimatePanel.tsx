'use client';

import { Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * EX-C — déclencheur d'estimation. Le résultat s'affiche via la page serveur
 * (router.refresh) : prix, fourchette, délai « estimé », taux et net serveur.
 */

export default function EstimatePanel({
  itemId,
  alreadyEstimated,
}: {
  itemId: string;
  alreadyEstimated: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // reset si l'objet change (navigation client)
    setError(null);
  }, [itemId]);

  async function estimate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId }),
        signal: AbortSignal.timeout(45_000), // borné, jamais de chargement infini
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "L'estimation a échoué. Réessaie.");
        return;
      }
      router.refresh(); // la carte estimation + l'historique se rechargent
    } catch {
      setError('Connexion impossible. Vérifie ton réseau et réessaie.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={estimate}
        disabled={loading}
        className="flex h-11 w-fit items-center gap-2 rounded-pill bg-primary px-5 text-sm font-semibold text-primary-on-dark disabled:opacity-60"
      >
        <Sparkles size={16} className={loading ? 'animate-pulse' : undefined} />
        {loading
          ? 'TYAGA analyse le marché…'
          : alreadyEstimated
            ? "Demander une nouvelle estimation"
            : 'Estimer la vente'}
      </button>
      {error && (
        <p role="alert" className="glass border-red-500/30 p-4 text-sm text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
