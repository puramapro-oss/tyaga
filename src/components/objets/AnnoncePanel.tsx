'use client';

import { Check, ClipboardCopy, Megaphone, RefreshCw, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import SaleFeeSummary from '@/components/marketplace/SaleFeeSummary';
import type { CommissionBreakdown } from '@/lib/commission';

/**
 * EX-D — annonce assistée. Génération (brouillon IA montré AVANT publication,
 * EX-D1) → validation explicite (EX-D2 : bouton inactif sans case cochée) →
 * publication marketplace (EX-D3). Export texte copiable = filet B (EX-D4).
 */

interface ListingDraft {
  title: string;
  description: string;
  tags: string[];
  quote: CommissionBreakdown;
}

export default function AnnoncePanel({
  itemId,
  estimationAvailable,
  annonce,
}: {
  itemId: string;
  estimationAvailable: boolean;
  annonce: { id: string; title: string; export_text: string | null } | null;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<ListingDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [validated, setValidated] = useState(false); // EX-D2 : action utilisateur
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // reset si l'objet change (navigation client)
    setDraft(null);
    setValidated(false);
    setError(null);
    setCopied(false);
  }, [itemId]);

  async function generate() {
    setLoading(true);
    setError(null);
    setValidated(false);
    try {
      const res = await fetch('/api/annonces/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId }),
        signal: AbortSignal.timeout(45_000), // borné, jamais de chargement infini
      });
      const data = (await res.json()) as { draft?: ListingDraft; error?: string };
      if (!res.ok || !data.draft?.quote) {
        setError(data.error ?? "La génération d'annonce a échoué. Réessaie.");
        return;
      }
      setDraft(data.draft);
    } catch {
      setError('Connexion impossible. Vérifie ton réseau et réessaie.');
    } finally {
      setLoading(false);
    }
  }

  async function publish() {
    if (!draft || !validated || publishing || loading) return; // EX-D2 : garde double (UI + serveur)
    setPublishing(true);
    setError(null);
    try {
      const res = await fetch('/api/annonces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId,
          title: draft.title,
          description: draft.description,
          tags: draft.tags,
          expectedQuote: draft.quote,
          userValidated: true, // la case cochée est la seule voie vers true
        }),
        signal: AbortSignal.timeout(30_000),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        if (res.status === 409) {
          setDraft(null);
          setValidated(false);
          router.refresh();
        }
        setError(data.error ?? (res.status === 409
          ? 'Régénère ton brouillon pour vérifier le prix et les frais avant de publier.'
          : 'La publication a échoué. Réessaie.'));
        return;
      }
      setDraft(null);
      router.refresh(); // la section annonce publiée se recharge
    } catch {
      setError('Connexion impossible. Vérifie ton réseau et réessaie.');
    } finally {
      setPublishing(false);
    }
  }

  async function copyExport() {
    const text = annonce?.export_text;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError('Copie impossible sur ce navigateur. Sélectionne le texte manuellement.');
    }
  }

  // ---- Déjà publiée : état final, export filet B ----
  if (annonce) {
    return (
      <section className="glass flex flex-col gap-4 p-6">
        <div className="flex items-center justify-between gap-4">
          <h2 className="flex items-center gap-2 font-display text-xl">
            <Megaphone size={18} />
            Annonce publiée
          </h2>
          <span className="rounded-pill bg-primary/20 px-3 py-1 text-xs font-medium text-primary-on-dark">
            Marketplace
          </span>
        </div>
        <p className="text-sm leading-relaxed text-foreground-secondary">
          « {annonce.title} » est visible par les utilisateurs connectés.
        </p>
        <button
          type="button"
          onClick={copyExport}
          className="flex h-11 w-fit items-center gap-2 rounded-pill border border-border px-5 text-sm font-semibold transition-colors hover:border-primary/40"
        >
          {copied ? <Check size={16} /> : <ClipboardCopy size={16} />}
          {copied ? 'Copié !' : 'Copier pour Vinted / Leboncoin'}
        </button>
        {error && (
          <p role="alert" className="glass border-red-500/30 p-4 text-sm text-red-300">
            {error}
          </p>
        )}
      </section>
    );
  }

  // ---- Pas d'estimation : prérequis ----
  if (!estimationAvailable) {
    return (
      <section className="glass flex flex-col gap-3 p-6">
        <h2 className="flex items-center gap-2 font-display text-xl">
          <Megaphone size={18} />
          Annonce assistée
        </h2>
        <p className="text-sm leading-relaxed text-foreground-secondary">
          Estime d&apos;abord l&apos;objet : TYAGA rédige l&apos;annonce à partir de
          ton scan et de l&apos;estimation de vente.
        </p>
      </section>
    );
  }

  // ---- Brouillon IA : montré AVANT publication (EX-D1) ----
  if (draft) {
    return (
      <section className="glass flex flex-col gap-5 p-6" aria-label="Brouillon d'annonce">
        <div className="flex items-center justify-between gap-4">
          <h2 className="flex items-center gap-2 font-display text-xl">
            <Sparkles size={18} />
            Brouillon d&apos;annonce
          </h2>
          <button
            type="button"
            onClick={generate}
            disabled={loading || publishing}
            className="flex items-center gap-1.5 text-xs text-foreground-muted transition-colors hover:text-foreground"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : undefined} />
            Régénérer
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <p className="font-display text-lg">{draft.title}</p>
          <p className="whitespace-pre-line text-sm leading-relaxed text-foreground-secondary">
            {draft.description}
          </p>
          <div className="flex flex-wrap gap-2">
            {draft.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-pill bg-foreground/5 px-2.5 py-0.5 text-xs text-foreground-muted"
              >
                #{tag}
              </span>
            ))}
          </div>
          <SaleFeeSummary quote={draft.quote} />
        </div>

        {/* EX-D2 : validation explicite, bouton inactif sans elle */}
        <label className="flex cursor-pointer items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={validated}
            disabled={loading || publishing}
            onChange={(e) => setValidated(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[var(--primary)]"
          />
          <span className="text-foreground-secondary">
            J&apos;ai relu cette annonce et je valide sa publication sur la
            marketplace TYAGA.
          </span>
        </label>

        <button
          type="button"
          onClick={publish}
          disabled={!validated || publishing || loading}
          className="flex h-11 w-fit items-center gap-2 rounded-pill bg-primary px-5 text-sm font-semibold text-on-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Megaphone size={16} />
          {publishing ? 'Publication…' : 'Publier sur la marketplace'}
        </button>

        {error && (
          <p role="alert" className="glass border-red-500/30 p-4 text-sm text-red-300">
            {error}
          </p>
        )}
      </section>
    );
  }

  // ---- État initial ----
  return (
    <section className="glass flex flex-col gap-4 p-6">
      <h2 className="flex items-center gap-2 font-display text-xl">
        <Megaphone size={18} />
        Annonce assistée
      </h2>
      <p className="text-sm leading-relaxed text-foreground-secondary">
        TYAGA rédige titre, description et tags à partir de ton scan et de
        l&apos;estimation. Tu relis, tu valides, tu publies.
      </p>
      <button
        type="button"
        onClick={generate}
        disabled={loading}
        className="flex h-11 w-fit items-center gap-2 rounded-pill bg-primary px-5 text-sm font-semibold text-on-primary disabled:opacity-60"
      >
        <Sparkles size={16} className={loading ? 'animate-pulse' : undefined} />
        {loading ? 'TYAGA rédige l’annonce…' : 'Générer l’annonce'}
      </button>
      {error && (
        <p role="alert" className="glass border-red-500/30 p-4 text-sm text-red-300">
          {error}
        </p>
      )}
    </section>
  );
}
