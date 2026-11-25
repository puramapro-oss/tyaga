import { MessageCircle } from 'lucide-react';
import Link from 'next/link';

import { createServerSupabaseClient } from '@/lib/supabase-server';
import { formatDate, formatPrice } from '@/lib/utils';

/**
 * EX-F1 — liste des conversations (RLS convs_select : participant). La date
 * affichée est updated_at, rafraîchie à chaque message envoyé/reçu.
 */

interface ConversationRow {
  id: string;
  buyer_id: string;
  updated_at: string;
  annonces: { title: string; price_cents: number } | null;
}

export default async function MessagesPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: rows } = await supabase
    .from('conversations')
    .select(
      `id, buyer_id, updated_at,
       annonces ( title, price_cents )`
    )
    .or(`buyer_id.eq.${user!.id},seller_id.eq.${user!.id}`)
    .order('updated_at', { ascending: false })
    .limit(100);

  const conversations = (rows ?? []) as unknown as ConversationRow[];

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="font-display text-3xl">Messages</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Retrouve tes échanges sur les offres et les recherches.
        </p>
      </div>

      {conversations.length === 0 ? (
        <section className="glass flex flex-col items-center gap-3 p-10 text-center">
          <MessageCircle size={24} className="text-foreground-muted" />
          <p className="text-sm leading-relaxed text-foreground-secondary">
            Pour démarrer une conversation, ouvre une annonce et contacte son auteur.
          </p>
          <Link
            href="/marketplace"
            className="flex h-11 items-center rounded-pill bg-primary px-5 text-sm font-medium text-on-primary transition-transform hover:scale-[1.01] active:scale-[0.99]"
          >
            Explorer la marketplace
          </Link>
        </section>
      ) : (
        <ul className="glass flex flex-col divide-y divide-border" aria-label="Conversations">
          {conversations.map((c) => {
            const isInitiator = c.buyer_id === user!.id;
            return (
              <li key={c.id}>
                <Link
                  href={`/messages/${c.id}`}
                  className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-card/60"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-primary/15 text-primary-on-dark">
                    <MessageCircle size={17} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {c.annonces?.title ?? 'Annonce'}
                    </span>
                    <span className="block text-xs text-foreground-muted">
                      {isInitiator ? 'Ma prise de contact' : 'Mon annonce'} · {formatDate(c.updated_at)}
                    </span>
                  </span>
                  {c.annonces?.price_cents != null && (
                    <span className="font-mono shrink-0 text-sm">
                      {formatPrice(c.annonces.price_cents)}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
