'use client';

import { Send } from 'lucide-react';
import { useState } from 'react';

/**
 * Chatbot SAV (P4) — client minimal : historique local (6 tours max envoyés),
 * suggestions rapides au premier écran, erreur FR avec contact humain.
 * L'IA répond sur le périmètre TYAGA V1 ; hors périmètre → hello@tyaga.purama.dev.
 */

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

const QUICK_QUESTIONS = [
  'Comment suis-je payé pour une vente ?',
  'Où en est ma commande ?',
  'Comment supprimer mon compte ?',
];

export default function SupportChat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(text: string) {
    const message = text.trim();
    if (!message || pending) return;
    setError(null);
    setInput('');
    const history = turns.slice(-6);
    setTurns((t) => [...t, { role: 'user', content: message }]);
    setPending(true);
    try {
      const res = await fetch('/api/ai/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history }),
      });
      const data = (await res.json()) as { answer?: string; error?: string };
      if (!res.ok || !data.answer) {
        throw new Error(data.error ?? 'réponse invalide');
      }
      setTurns((t) => [...t, { role: 'assistant', content: data.answer! }]);
    } catch {
      setError(
        "L'assistant n'a pas pu répondre. Écris-nous à hello@tyaga.purama.dev — réponse sous 48 h."
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="glass p-5 md:p-6" aria-label="Assistant support TYAGA">
      <h2 className="font-display text-xl">Poser une question</h2>
      <p className="mt-1 text-sm text-foreground-muted">
        Réponse immédiate sur le fonctionnement de TYAGA ; on transmet au
        support humain pour tout le reste.
      </p>

      {turns.length === 0 && !pending && (
        <div className="mt-4 flex flex-wrap gap-2">
          {QUICK_QUESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => send(q)}
              className="rounded-pill bg-card px-3.5 py-2 text-xs font-medium text-foreground-muted transition-colors hover:bg-primary/15 hover:text-foreground"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      <ol className="mt-4 flex flex-col gap-3" aria-live="polite">
        {turns.map((turn, i) => (
          <li
            key={i}
            className={`max-w-[85%] rounded-lg px-3.5 py-2.5 text-sm leading-relaxed ${
              turn.role === 'user'
                ? 'self-end bg-primary/15 text-foreground'
                : 'self-start bg-card text-foreground-muted'
            }`}
          >
            {turn.content}
          </li>
        ))}
        {pending && (
          <li className="self-start rounded-lg bg-card px-3.5 py-2.5 text-sm text-foreground-secondary">
            TYAGA réfléchit…
          </li>
        )}
      </ol>

      {error && (
        <p role="alert" className="mt-3 text-sm text-alert">
          {error}
        </p>
      )}

      <form
        className="mt-4 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          rows={2}
          maxLength={2000}
          placeholder="Décris ton problème en une phrase…"
          aria-label="Ta question au support TYAGA"
          className="min-w-0 flex-1 resize-none rounded-md border border-border bg-card px-3.5 py-2.5 text-foreground outline-none placeholder:text-foreground-secondary focus:border-primary"
        />
        <button
          type="submit"
          disabled={pending || !input.trim()}
          aria-label="Envoyer la question"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-pill bg-primary text-foreground transition-opacity disabled:opacity-40"
        >
          <Send size={17} />
        </button>
      </form>
    </section>
  );
}
