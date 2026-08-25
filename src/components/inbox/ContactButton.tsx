'use client';

import { Loader2, MessageCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * EX-F1 — l'acheteur ouvre (ou retrouve) la conversation d'une annonce.
 * Toujours visible à côté du bouton Acheter : questionner d'abord est un
 * parcours normal, l'achat reste le parcours sécurisé.
 */

interface ContactButtonProps {
  annonceId: string;
}

export default function ContactButton({ annonceId }: ContactButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onContact() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annonceId }),
      });
      const data = (await res.json()) as { conversationId?: string; error?: string };
      if (!res.ok || !data.conversationId) {
        setError(data.error ?? 'Impossible d’ouvrir la conversation. Réessaie.');
        return;
      }
      router.push(`/messages/${data.conversationId}`);
    } catch {
      setError('Connexion impossible. Vérifie ton réseau et réessaie.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onContact}
        disabled={loading}
        className="flex h-11 items-center justify-center gap-2 rounded-pill border border-border-control bg-background-soft px-5 text-sm font-medium text-foreground transition-colors hover:bg-card disabled:opacity-60"
      >
        {loading ? (
          <Loader2 size={15} className="animate-spin" />
        ) : (
          <MessageCircle size={15} />
        )}
        Poser une question
      </button>
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
