'use client';

import { Check, Loader2, Shield } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { formatPrice } from '@/lib/utils';

/**
 * EX-F3 — prix plancher du vendeur pour cet objet. En dessous, TYAGA proposera
 * un refus poli à toute offre : jamais de contre-prix sous le plancher.
 */

interface FloorPricePanelProps {
  itemId: string;
  floorCents: number | null;
  priceCents: number | null;
}

export default function FloorPricePanel({ itemId, floorCents, priceCents }: FloorPricePanelProps) {
  const [value, setValue] = useState(floorCents !== null ? String(floorCents / 100) : '');
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setSaved(false);

    const trimmed = value.trim();
    if (trimmed === '') {
      // Champ vidé = plancher retiré (la négo redevient libre)
      await save(null);
      return;
    }
    const euros = Number(trimmed.replace(',', '.'));
    if (!Number.isFinite(euros) || euros < 1 || euros > 10000) {
      setError('Plancher invalide : entre 1 € et 10 000 €.');
      return;
    }
    await save(Math.round(euros * 100));
  }

  async function save(floorCents: number | null) {
    setLoading(true);
    try {
      const res = await fetch(`/api/items/${itemId}/floor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ floorCents }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Enregistrement impossible. Réessaie dans un instant.');
        return;
      }
      setError(null);
      setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 3000);
    } catch {
      setError('Connexion impossible. Vérifie ton réseau et réessaie.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="glass flex flex-col gap-3 p-6" aria-label="Prix plancher">
      <h2 className="flex items-center gap-2 font-display text-xl">
        <Shield size={18} />
        Prix plancher
      </h2>
      <p className="text-sm leading-relaxed text-foreground-secondary">
        Ton montant minimum incompressible. Si un acheteur propose moins, TYAGA
        te suggère un refus poli — aucune contre-proposition ne descendra sous
        ce plancher.
      </p>
      <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-foreground-muted">Plancher (€)</span>
          <input
            inputMode="decimal"
            placeholder={priceCents !== null ? String(priceCents / 100) : 'ex. 25'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-11 w-32 rounded-md border border-border-control bg-background-soft px-3 text-foreground placeholder:text-foreground-secondary focus:border-primary disabled:opacity-50"
            disabled={loading}
            aria-label="Plancher en euros"
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="mt-5 flex h-11 items-center gap-2 rounded-pill bg-primary px-5 text-sm font-medium text-on-primary transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60"
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : saved ? <Check size={15} /> : null}
          {saved ? 'Enregistré' : 'Enregistrer'}
        </button>
        {floorCents !== null && (
          <span className="mt-5 text-sm text-foreground-muted">
            Actuel : <span className="font-mono">{formatPrice(floorCents)}</span>
          </span>
        )}
      </form>
      {error && (
        <p role="alert" className="rounded-md border border-alert/40 bg-alert/10 px-4 py-3 text-sm">
          {error}
        </p>
      )}
    </section>
  );
}
