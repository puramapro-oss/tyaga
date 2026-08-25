import { ArrowLeft, Clock, Sparkles, Tag } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import AnnoncePanel from '@/components/objets/AnnoncePanel';
import EstimatePanel from '@/components/objets/EstimatePanel';
import FloorPricePanel from '@/components/objets/FloorPricePanel';
import { CONDITION_LABELS, STATUS_LABELS } from '@/lib/labels';
import { createServiceClient } from '@/lib/service';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { formatDate, formatPrice } from '@/lib/utils';

/**
 * EX-C — fiche objet + estimations. Le net affiché vient TOUJOURS de la DB
 * (calculé serveur à l'insertion) : cette page ne fait jamais d'arithmétique
 * de commission. Le délai est affiché « estimé », jamais garanti (EX-C5).
 */

const PHOTO_ALTS = ['Face', 'Dos', 'Défaut / étiquette'] as const;

export default async function ItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: item } = await supabase
    .from('items')
    .select(
      'id, title, category, brand, model, condition, status, created_at, floor_price_cents'
    )
    .eq('id', id)
    .eq('user_id', user!.id)
    .single();
  if (!item) notFound();

  const { data: photos } = await supabase
    .from('item_photos')
    .select('storage_path, angle, position')
    .eq('item_id', item.id)
    .order('position');

  const { data: estimations } = await supabase
    .from('estimations')
    .select(
      'id, price_suggested_cents, price_min_cents, price_max_cents, delay_days_min, delay_days_max, commission_pct, net_amount_cents, confidence, rationale, created_at'
    )
    .eq('item_id', item.id)
    .order('created_at', { ascending: false });

  // Bucket privé → URLs signées courtes (1 h), générées côté serveur
  const service = createServiceClient();
  const photoUrls = await Promise.all(
    (photos ?? []).map(async (p, i) => {
      const { data } = await service.storage
        .from('tyaga-photos')
        .createSignedUrl(p.storage_path, 3600);
      return { url: data?.signedUrl ?? null, alt: PHOTO_ALTS[p.position] ?? PHOTO_ALTS[i] };
    })
  );

  // EX-D3 : l'annonce publiée (une seule active par objet)
  const { data: annonce } = await supabase
    .from('annonces')
    .select('id, title, export_text')
    .eq('item_id', item.id)
    .eq('status', 'published')
    .maybeSingle();

  const latest = estimations?.[0] ?? null;
  const status = STATUS_LABELS[item.status] ?? {
    label: item.status,
    tone: 'bg-card text-foreground-muted',
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <Link
        href="/objets"
        className="flex w-fit items-center gap-2 text-sm text-foreground-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft size={16} />
        Mes objets
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">
            {item.title || item.category || 'Objet'}
          </h1>
          <p className="mt-1 text-sm text-foreground-muted">
            {[item.category, item.brand, item.model].filter(Boolean).join(' · ') ||
              'Fiche à compléter'}
            {item.category && ` — ${CONDITION_LABELS[item.condition] ?? item.condition}`}
            {' '}· scanné le {formatDate(item.created_at)}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-pill px-3 py-1 text-xs font-medium ${status.tone}`}
        >
          {status.label}
        </span>
      </div>

      {photoUrls.some((p) => p.url) && (
        <div className="grid grid-cols-3 gap-3">
          {photoUrls
            .filter((p) => p.url)
            .map((p) => (
              // eslint-disable-next-line @next/next/no-img-element -- URL signée Supabase, pas d'optim loader
              <img
                key={p.url!}
                src={p.url!}
                alt={`Photo ${p.alt}`}
                className="aspect-square w-full rounded-lg border border-border object-cover"
              />
            ))}
        </div>
      )}

      {latest ? (
        <section className="glass flex flex-col gap-5 p-6" aria-label="Estimation">
          <div className="flex items-center justify-between gap-4">
            <h2 className="flex items-center gap-2 font-display text-xl">
              <Sparkles size={18} />
              Estimation de vente
            </h2>
            <span className="rounded-pill bg-secondary/15 px-3 py-1 text-xs font-medium text-secondary-on-dark">
              Confiance {latest.confidence === 'high' ? 'haute' : latest.confidence === 'low' ? 'basse' : 'moyenne'}
            </span>
          </div>

          {/* EX-C1 : prix conseillé + fourchette + délai estimé */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-foreground-muted">
                Prix conseillé
              </p>
              <p className="font-mono mt-1 text-2xl">
                {formatPrice(latest.price_suggested_cents)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-foreground-muted">
                Fourchette
              </p>
              <p className="font-mono mt-1 text-2xl">
                {formatPrice(latest.price_min_cents)} –{' '}
                {formatPrice(latest.price_max_cents)}
              </p>
            </div>
            <div>
              <p className="flex items-center gap-1 text-xs uppercase tracking-wide text-foreground-muted">
                <Clock size={12} />
                Délai estimé
              </p>
              <p className="font-mono mt-1 text-2xl">
                {latest.delay_days_min}–{latest.delay_days_max} j
              </p>
            </div>
          </div>

          {latest.rationale && (
            <p className="text-sm leading-relaxed text-foreground-secondary">
              {latest.rationale}
            </p>
          )}

          {/* EX-C2/C3 : taux affiché + net serveur, avant toute publication */}
          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-foreground-muted">
                <Tag size={14} />
                Commission TYAGA ({latest.commission_pct} %)
              </span>
              <span className="font-mono">
                −{formatPrice(latest.price_suggested_cents - latest.net_amount_cents)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">Net pour toi</span>
              <span className="font-mono text-xl font-semibold text-secondary-on-dark">
                {formatPrice(latest.net_amount_cents)}
              </span>
            </div>
            <p className="text-xs text-foreground-muted">
              Délai de vente estimé, jamais promis — dépend de l&apos;état réel
              et de la demande.
            </p>
          </div>
        </section>
      ) : (
        <section className="glass flex flex-col gap-3 p-6">
          <h2 className="font-display text-xl">Estimation de vente</h2>
          <p className="text-sm leading-relaxed text-foreground-secondary">
            TYAGA compare ton objet au marché de l&apos;occasion (Vinted,
            Leboncoin) et propose un prix, une fourchette et un délai de vente
            estimé.
          </p>
        </section>
      )}

      <EstimatePanel itemId={item.id} alreadyEstimated={Boolean(latest)} />

      <AnnoncePanel
        itemId={item.id}
        estimationAvailable={Boolean(latest)}
        annonce={annonce ?? null}
      />

      {/* EX-F3 : plancher de négociation, utile dès l'estimation */}
      <FloorPricePanel
        itemId={item.id}
        floorCents={item.floor_price_cents}
        priceCents={latest?.price_suggested_cents ?? null}
      />

      {estimations && estimations.length > 1 && (
        <section className="glass flex flex-col gap-3 p-6">
          <h2 className="font-display text-lg">Historique des estimations</h2>
          <ul className="flex flex-col divide-y divide-border">
            {estimations.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between gap-4 py-2.5 text-sm"
              >
                <span className="text-foreground-muted">
                  {formatDate(e.created_at)}
                </span>
                <span className="font-mono">
                  {formatPrice(e.price_suggested_cents)} · net{' '}
                  {formatPrice(e.net_amount_cents)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
