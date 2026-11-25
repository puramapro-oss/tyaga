'use client';

import {
  AlertTriangle,
  ArrowLeft,
  Loader2,
  Send,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import { formatPrice } from '@/lib/utils';

/**
 * EX-F1/F2 — fil de conversation. Rafraîchi toutes les 5 s (EX-F1 « temps réel
 * ou refresh ») : fetch + AbortController nettoyé au démontage. Les réponses
 * 1-clic sont PROPOSÉES : rien n'est envoyé sans clic explicite (EX-F2).
 */

interface ThreadMessage {
  id: string;
  senderId: string;
  body: string;
  offerCents: number | null;
  flagged: boolean;
  flagReason: string | null;
  createdAt: string;
}

interface ThreadSuggestion {
  suggestion_type: 'answer' | 'negotiate' | 'accept' | 'decline';
  price_counter_cents: number | null;
  body: string;
}

interface ThreadData {
  conversation: {
    id: string;
    role: 'buyer' | 'seller';
    title: string;
    priceCents: number;
    floorCents: number | null;
    negotiationEnabled: boolean;
    isWanted: boolean;
  };
  messages: ThreadMessage[];
  suggestions: ThreadSuggestion[];
}

const SUGGESTION_LABELS: Record<ThreadSuggestion['suggestion_type'], string> = {
  answer: 'Répondre',
  negotiate: 'Négocier',
  accept: 'Accepter',
  decline: 'Refuser',
};

export default function Thread({ conversationId, myId }: { conversationId: string; myId: string }) {
  const [data, setData] = useState<ThreadData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const [offerDraft, setOfferDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(
    async (signal: AbortSignal) => {
      const res = await fetch(`/api/conversations/${conversationId}`, { signal });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Chargement impossible.');
      }
      setData((await res.json()) as ThreadData);
    },
    [conversationId]
  );

  // Chargement initial + rafraîchissement 5 s (EX-F1), nettoyé au démontage
  useEffect(() => {
    const controller = new AbortController();
    const tick = () =>
      load(controller.signal).catch((err: unknown) => {
        if ((err as Error).name !== 'AbortError') {
          setError((err as Error).message || 'Chargement impossible.');
        }
      });
    tick();
    const timer = setInterval(tick, 5000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [load]);

  // Suivre le bas du fil quand les messages arrivent
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [data?.messages.length]);

  async function send(body: string, offerCents: number | null = null) {
    if (sending || body.trim() === '') return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, offerCents }),
      });
      const payload = (await res.json()) as { error?: string; flagged?: boolean };
      if (!res.ok) {
        // EX-F4 : avertissement FR explicite à l'envoyeur, message non délivré
        setError(payload.error ?? 'Envoi impossible. Réessaie.');
        if (payload.flagged) await load(new AbortController().signal).catch(() => {});
        return;
      }
      setDraft('');
      await load(new AbortController().signal).catch(() => {});
    } catch {
      setError('Connexion impossible. Vérifie ton réseau et réessaie.');
    } finally {
      setSending(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(draft);
  }

  async function onOffer(e: FormEvent) {
    e.preventDefault();
    const euros = Number(offerDraft.trim().replace(',', '.'));
    if (!Number.isFinite(euros) || euros < 1 || euros > 10000) {
      setError('Offre invalide : entre 1 € et 10 000 €.');
      return;
    }
    const cents = Math.round(euros * 100);
    await send(`Je te propose ${cents / 100} €.`, cents);
    setOfferDraft('');
  }

  const role = data?.conversation.role;
  // Dernière offre de l'acheteur : c'est ELLE que le vendeur « accepte »
  // (l'API refuse tout autre montant de sa part). Le fil est ordonné du plus
  // ancien au plus récent → on scanne depuis la fin.
  const threadMessages = data?.messages ?? [];
  let lastBuyerOffer: number | null = null;
  for (let i = threadMessages.length - 1; i >= 0; i--) {
    if (threadMessages[i].senderId !== myId && threadMessages[i].offerCents !== null) {
      lastBuyerOffer = threadMessages[i].offerCents;
      break;
    }
  }

  function suggestionOffer(s: ThreadSuggestion): number | null {
    if (role === 'seller' && s.suggestion_type === 'accept') return lastBuyerOffer;
    return s.price_counter_cents ?? null;
  }

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col">
      <div className="flex items-center gap-3 pb-4">
        <Link
          href="/messages"
          className="flex h-11 w-11 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-card hover:text-foreground"
          aria-label="Retour aux messages"
        >
          <ArrowLeft size={18} />
        </Link>
        <div className="min-w-0">
          <h1 className="truncate font-display text-xl">
            {data?.conversation.title ?? 'Conversation'}
          </h1>
          {data && (
            <p className="text-sm text-foreground-muted">
              {data.conversation.isWanted ? 'Budget' : 'Prix affiché'} <span className="font-mono">{formatPrice(data.conversation.priceCents)}</span>
              {data.conversation.floorCents !== null && role === 'seller' && (
                <>
                  {' '}· plancher <span className="font-mono">{formatPrice(data.conversation.floorCents)}</span>
                </>
              )}
            </p>
          )}
        </div>
      </div>

      {/* Fil */}
      <div className="glass flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4" aria-label="Messages">
        {!data && !error && (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 size={20} className="animate-spin text-foreground-muted" />
          </div>
        )}
        {data?.messages.length === 0 && (
          <p className="m-auto max-w-sm text-center text-sm text-foreground-muted">
            Pose ta première question sur cette annonce.
          </p>
        )}
        {data?.messages.map((m) => {
          const mine = m.senderId === myId;
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`flex max-w-[85%] flex-col gap-1 rounded-xl px-4 py-2.5 text-sm leading-relaxed ${
                  mine
                    ? 'bg-primary text-on-primary'
                    : 'bg-card border border-border text-foreground'
                }`}
              >
                {m.offerCents !== null && (
                  <span className={`text-xs font-semibold uppercase tracking-wide ${mine ? 'text-primary-on-dark/70' : 'text-foreground-muted'}`}>
                    Offre : {formatPrice(m.offerCents)}
                  </span>
                )}
                <span className="whitespace-pre-line">{m.body}</span>
                {m.flagged && (
                  <span className="flex items-center gap-1 text-xs font-medium text-alert">
                    <AlertTriangle size={12} />
                    Bloqué — jamais envoyé au destinataire ({m.flagReason})
                  </span>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Suggestions EX-F2 : proposition seulement, envoi au clic */}
      {data && data.suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-3" aria-label="Réponses suggérées">
          {data.suggestions.map((s, i) => (
            <button
              key={`${s.suggestion_type}-${i}`}
              type="button"
              disabled={sending}
              onClick={() => void send(s.body, suggestionOffer(s))}
              className="flex h-9 items-center gap-1.5 rounded-pill border border-border-control bg-background-soft px-3.5 text-sm text-foreground-secondary transition-colors hover:bg-card hover:text-foreground disabled:opacity-60"
            >
              <Sparkles size={13} className="text-secondary-on-dark" />
              {SUGGESTION_LABELS[s.suggestion_type]}
              {s.price_counter_cents !== null && (
                <span className="font-mono">{formatPrice(s.price_counter_cents)}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Offre chiffrée — acheteur uniquement (EX-F3 côté serveur) */}
      {data?.conversation.negotiationEnabled && role === 'buyer' && (
        <form onSubmit={onOffer} className="flex items-center gap-2 pt-3">
          <input
            inputMode="decimal"
            placeholder="Offre (€)"
            value={offerDraft}
            onChange={(e) => setOfferDraft(e.target.value)}
            className="h-11 w-28 rounded-md border border-border-control bg-background-soft px-3 text-sm text-foreground placeholder:text-foreground-secondary focus:border-primary"
            aria-label="Montant de l'offre en euros"
          />
          <button
            type="submit"
            disabled={sending}
            className="flex h-11 items-center gap-2 rounded-pill border border-border-control bg-background-soft px-4 text-sm font-medium text-foreground transition-colors hover:bg-card disabled:opacity-60"
          >
            Proposer
          </button>
        </form>
      )}

      {/* Composer */}
      <form onSubmit={onSubmit} className="flex items-center gap-2 py-3">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Écris ton message…"
          maxLength={2000}
          className="h-11 flex-1 rounded-md border border-border-control bg-background-soft px-3 text-sm text-foreground placeholder:text-foreground-secondary focus:border-primary"
          aria-label="Message"
        />
        <button
          type="submit"
          disabled={sending || draft.trim() === ''}
          className="flex h-11 w-11 items-center justify-center rounded-pill bg-primary text-on-primary transition-transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60"
          aria-label="Envoyer"
        >
          {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </form>

      {error && (
        <p role="alert" className="mb-3 rounded-md border border-alert/40 bg-alert/10 px-4 py-3 text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
