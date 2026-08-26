'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, X } from 'lucide-react';

import {
  isTransferPct,
  transferOption,
  transferOptions,
  transferPoints,
  type TransferPct,
} from '@/lib/vida';

export interface VenteRow {
  id: string;
  net_amount_cents: number;
  created_at: string;
  title: string | null;
}

export interface ObjectifOption {
  id: string;
  label: string;
}

export interface ExistingTransfer {
  id: string;
  pct: number;
  points_amount: number;
  objectif_id: string | null;
}

/**
 * EX-H2/EX-H3 — proposition de transfert d'une vente confirmée.
 * Deux étapes OBLIGATOIRES : 1) choix du % → statut 'proposed',
 * 2) confirmation explicite (jamais automatique) → wallet → objectif.
 * Montant TOUJOURS affiché/recalculé serveur (1 pt = 1 € net).
 */
export default function TransferProposal({
  vente,
  objectifs,
  existing,
  objectifLabel,
}: {
  vente: VenteRow;
  objectifs: ObjectifOption[];
  existing: ExistingTransfer | null;
  objectifLabel: string | null;
}) {
  const router = useRouter();
  const [pct, setPct] = useState<TransferPct>(50);
  const [objectifId, setObjectifId] = useState<string>(objectifs[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalPts = transferPoints(vente.net_amount_cents, 100);
  const versedPts = transferPoints(vente.net_amount_cents, pct);

  async function propose(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isTransferPct(pct)) return;
    if (pct > 0 && objectifs.length === 0) {
      setError('Crée d’abord un objectif pour y verser des points.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/vida/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venteId: vente.id,
          pct,
          objectifId: pct === 0 ? null : objectifId,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? 'Proposition impossible. Réessaie.');
        return;
      }
      router.refresh();
    } catch {
      setError('Connexion perdue. Vérifie ton réseau et réessaie.');
    } finally {
      setBusy(false);
    }
  }

  async function decide(action: 'confirm' | 'cancel') {
    if (!existing) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/vida/transfers/${existing.id}/${action}`, {
        method: 'POST',
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? 'Action impossible. Réessaie.');
        return;
      }
      router.refresh();
    } catch {
      setError('Connexion perdue. Vérifie ton réseau et réessaie.');
    } finally {
      setBusy(false);
    }
  }

  // Étape 2 (EX-H3) : proposition en attente de confirmation explicite
  if (existing) {
    const o = transferOption(isTransferPct(existing.pct) ? existing.pct : 0);
    return (
      <article
        className="glass flex flex-col gap-3 border-primary/40 p-5"
        aria-label={`Proposition de transfert ${vente.title ?? 'vente'}`}
      >
        <p className="text-sm text-foreground-muted">
          Proposition en attente de ta confirmation
        </p>
        <p className="font-display text-lg">
          {o.label} — {existing.points_amount} pts
          {existing.pct > 0 && objectifLabel ? ` vers « ${objectifLabel} »` : ' conservés sur le wallet'}
        </p>
        <p className="text-xs text-foreground-muted">
          Rien n’a encore bougé : confirme pour appliquer, ou annule.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => decide('confirm')}
            className="flex h-11 items-center gap-2 rounded-pill bg-primary px-5 text-sm font-semibold text-white disabled:opacity-50"
          >
            <Check size={16} />
            {busy ? 'Traitement…' : 'Confirmer le transfert'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => decide('cancel')}
            className="flex h-11 items-center gap-2 rounded-pill border border-border px-5 text-sm disabled:opacity-50"
          >
            <X size={16} />
            Annuler
          </button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}
      </article>
    );
  }

  // Étape 1 (EX-H2) : choix du pourcentage
  return (
    <form
      onSubmit={propose}
      className="glass flex flex-col gap-3 p-5"
      aria-label={`Répartir la vente ${vente.title ?? ''}`}
    >
      <div>
        <p className="font-display text-lg">{vente.title ?? 'Vente confirmée'}</p>
        <p className="text-sm text-foreground-muted">
          Net vendeur : {totalPts} pts — combien verses vers un objectif Vida ?
        </p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Pourcentage à verser</legend>
        {transferOptions().map((o) => (
          <label
            key={o.pct}
            className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition-colors ${
              pct === o.pct ? 'border-primary bg-card' : 'border-border'
            }`}
          >
            <input
              type="radio"
              name={`pct-${vente.id}`}
              value={o.pct}
              checked={pct === o.pct}
              onChange={() => setPct(o.pct)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">{o.label}</span> —{' '}
              {transferPoints(vente.net_amount_cents, o.pct)} pts
              <span className="block text-xs text-foreground-muted">{o.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {pct > 0 && (
        <div className="flex flex-col gap-2">
          <label htmlFor={`objectif-${vente.id}`} className="text-sm text-foreground-muted">
            Objectif destinataire
          </label>
          {objectifs.length === 0 ? (
            <p className="text-sm text-red-400">
              Aucun objectif actif — crée-en un ci-dessous pour verser ces points.
            </p>
          ) : (
            <select
              id={`objectif-${vente.id}`}
              value={objectifId}
              onChange={(e) => setObjectifId(e.target.value)}
              className="h-11 rounded-md border border-border bg-background px-3 text-sm"
            >
              {objectifs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || (pct > 0 && objectifs.length === 0)}
        className="flex h-11 items-center justify-center rounded-pill bg-primary px-5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {busy ? 'Enregistrement…' : `Proposer ${versedPts} pts`}
      </button>
    </form>
  );
}
