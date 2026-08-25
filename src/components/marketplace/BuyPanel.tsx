'use client';

import { Lock, Loader2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { formatPrice } from '@/lib/utils';

/**
 * EX-E1/EX-E5 — achat sur la plateforme. Adresse de livraison (visible
 * vendeur UNIQUEMENT après paiement), puis Checkout Stripe. Aucun règlement
 * hors plateforme, jamais suggéré.
 */

interface BuyPanelProps {
  annonceId: string;
  priceCents: number;
}

const FIELDS = [
  { name: 'fullName', label: 'Nom complet', placeholder: 'Camille Durand' },
  { name: 'line1', label: 'Adresse', placeholder: '12 rue des Lilas' },
  { name: 'line2', label: 'Complément (facultatif)', placeholder: 'Appartement 4' },
  { name: 'postalCode', label: 'Code postal', placeholder: '75011' },
  { name: 'city', label: 'Ville', placeholder: 'Paris' },
] as const;

export default function BuyPanel({ annonceId, priceCents }: BuyPanelProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({ country: 'FR' });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          annonceId,
          shippingAddress: {
            fullName: values.fullName ?? '',
            line1: values.line1 ?? '',
            ...(values.line2 ? { line2: values.line2 } : {}),
            postalCode: values.postalCode ?? '',
            city: values.city ?? '',
            country: values.country || 'FR',
          },
        }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(data.error ?? 'Achat impossible. Réessaie dans un instant.');
        setLoading(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setError('Connexion impossible. Vérifie ton réseau et réessaie.');
      setLoading(false);
    }
  }

  return (
    <section className="glass flex flex-col gap-4 p-6" aria-label="Acheter cet objet">
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <p className="text-sm font-medium">Adresse de livraison</p>
        {FIELDS.map((f) => (
          <label key={f.name} className="flex flex-col gap-1 text-sm">
            <span className="text-foreground-muted">{f.label}</span>
            <input
              name={f.name}
              placeholder={f.placeholder}
              value={values[f.name] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
              className="h-11 rounded-md border border-border-control bg-background-soft px-3 text-foreground placeholder:text-foreground-secondary focus:border-primary disabled:opacity-50"
              disabled={loading}
            />
          </label>
        ))}
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-foreground-muted">Pays (code)</span>
          <input
            name="country"
            placeholder="FR"
            maxLength={2}
            value={values.country ?? 'FR'}
            onChange={(e) =>
              setValues((v) => ({ ...v, country: e.target.value.toUpperCase() }))
            }
            className="h-11 w-24 rounded-md border border-border-control bg-background-soft px-3 text-foreground uppercase focus:border-primary disabled:opacity-50"
            disabled={loading}
          />
        </label>

        {error && (
          <p role="alert" className="rounded-md border border-alert/40 bg-alert/10 px-4 py-3 text-sm text-foreground">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="mt-1 flex h-12 items-center justify-center gap-2 rounded-pill bg-primary font-medium text-primary-on-dark transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60"
        >
          {loading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Lock size={16} />
          )}
          Acheter — {formatPrice(priceCents)}
        </button>
      </form>
      <p className="text-xs leading-relaxed text-foreground-muted">
        Paiement sécurisé via Stripe — aucun règlement hors plateforme. Le
        vendeur est payé seulement après ta confirmation de réception.
      </p>
    </section>
  );
}
