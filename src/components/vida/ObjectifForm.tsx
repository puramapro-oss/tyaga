'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';

import { OBJECTIF_TYPES, OBJECTIF_TYPE_LABELS, type ObjectifType } from '@/lib/vida';

/**
 * EX-H4 — création d'un objectif Vida (type, nom, cible en points).
 * 1 point = 1 € net vendeur : la cible s'exprime en points, jamais en euros.
 */
export default function ObjectifForm() {
  const router = useRouter();
  const [type, setType] = useState<ObjectifType>('vida_subscription');
  const [label, setLabel] = useState('');
  const [target, setTarget] = useState('100');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const targetPoints = Number.parseInt(target, 10);
    if (!Number.isFinite(targetPoints) || targetPoints < 1) {
      setError('La cible doit être d’au moins 1 point.');
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/vida/objectifs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, label: label.trim(), targetPoints }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? 'Création impossible. Réessaie dans un instant.');
        return;
      }
      setLabel('');
      setTarget('100');
      router.refresh();
    } catch {
      setError('Connexion perdue. Vérifie ton réseau et réessaie.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="glass flex flex-col gap-3 p-5" aria-label="Nouvel objectif">
      <p className="font-display text-lg">Nouvel objectif</p>

      <div className="flex flex-col gap-2">
        <label htmlFor="objectif-type" className="text-sm text-foreground-muted">
          Type
        </label>
        <select
          id="objectif-type"
          value={type}
          onChange={(e) => setType(e.target.value as ObjectifType)}
          className="h-11 rounded-md border border-border bg-background px-3 text-sm"
        >
          {OBJECTIF_TYPES.map((t) => (
            <option key={t} value={t}>
              {OBJECTIF_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="objectif-label" className="text-sm text-foreground-muted">
          Nom
        </label>
        <input
          id="objectif-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Ex : 3 mois d’abonnement Vida"
          maxLength={80}
          required
          minLength={3}
          className="h-11 rounded-md border border-border bg-background px-3 text-sm"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="objectif-target" className="text-sm text-foreground-muted">
          Cible (points — 1 pt = 1 €)
        </label>
        <input
          id="objectif-target"
          value={target}
          onChange={(e) => setTarget(e.target.value.replace(/[^0-9]/g, ''))}
          inputMode="numeric"
          pattern="[0-9]*"
          required
          className="h-11 rounded-md border border-border bg-background px-3 text-sm"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="flex h-11 items-center justify-center gap-2 rounded-pill bg-primary px-5 text-sm font-semibold text-on-primary transition-opacity disabled:opacity-50"
      >
        <Plus size={16} />
        {busy ? 'Création…' : 'Créer l’objectif'}
      </button>
    </form>
  );
}
