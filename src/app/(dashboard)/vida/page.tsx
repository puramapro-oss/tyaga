import { Info, Sparkles } from 'lucide-react';

import BoucleRing from '@/components/vida/BoucleRing';
import ObjectifCard, { type ObjectifRow } from '@/components/vida/ObjectifCard';
import ObjectifForm from '@/components/vida/ObjectifForm';
import TransferProposal from '@/components/vida/TransferProposal';
import { progression } from '@/lib/vida';
import { formatDate } from '@/lib/utils';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';

/**
 * EX-H — Vida Vault (sandbox). Tout est en POINTS (1 pt = 1 € net vendeur),
 * aucun virement bancaire V1 : le libellé sandbox est visible en permanence.
 * H1 wallet auto, H2 propositions 0/30/50/100 %, H3 confirmation explicite,
 * H4 objectifs + progression, H5 sandbox.
 */

export const metadata = { title: 'Points Vida — TYAGA' };

const TRANSFER_STATUS_LABELS: Record<string, string> = {
  proposed: 'En attente de confirmation',
  confirmed: 'Confirmé',
  cancelled: 'Annulé',
};

interface TransferRow {
  id: string;
  vente_id: string | null;
  pct: number;
  points_amount: number;
  objectif_id: string | null;
  status: string;
  created_at: string;
}

interface VenteRow {
  id: string;
  net_amount_cents: number;
  completed_at: string;
  order: { item: { title: string | null }[] }[] | null;
}

export default async function VidaPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/vida');

  const [walletRes, objectifsRes, transfersRes, ventesRes] = await Promise.all([
    supabase
      .from('vida_wallet')
      .select('balance_points, total_earned_points')
      .maybeSingle(),
    supabase
      .from('vida_objectifs')
      .select('id, type, label, target_points, current_points, active')
      .order('created_at', { ascending: true }),
    supabase
      .from('vida_transfers')
      .select(
        'id, vente_id, pct, points_amount, objectif_id, status, created_at'
      )
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('ventes')
      .select(
        'id, net_amount_cents, completed_at, order:marketplace_orders(item:items(title))'
      )
      .order('completed_at', { ascending: false })
      .limit(20),
  ]);

  const wallet = walletRes.data ?? { balance_points: 0, total_earned_points: 0 };
  const objectifs: ObjectifRow[] = objectifsRes.data ?? [];
  const transfers: TransferRow[] = transfersRes.data ?? [];
  const ventes: VenteRow[] = ventesRes.data ?? [];

  const objectifLabels = new Map(objectifs.map((o) => [o.id, o.label]));
  const activeObjectifs = objectifs.filter((o) => o.active);

  // Ventes sans proposition active (= proposed ou confirmed) → à répartir
  const ventesARation = ventes.filter(
    (v) => !transfers.some((t) => t.vente_id === v.id && t.status !== 'cancelled')
  );
  // Propositions en attente, par vente (étape 2 — confirmation explicite)
  const pendingByVente = new Map(
    transfers
      .filter((t) => t.status === 'proposed' && t.vente_id)
      .map((t) => [t.vente_id as string, t])
  );
  const pendingVentes = ventes.filter((v) => pendingByVente.has(v.id));
  const historique = transfers.filter((t) => t.status !== 'proposed');

  // D4 — objectif vedette : l'actif le plus avancé porte La Boucle en grand
  const vedette =
    activeObjectifs.length > 0
      ? activeObjectifs.reduce((best, o) =>
          o.current_points / Math.max(1, o.target_points) >
          best.current_points / Math.max(1, best.target_points)
            ? o
            : best,
        )
      : null;

  return (
    // D3 — 2 colonnes dès lg : La Boucle + objectifs à gauche, solde et
    // historique à droite. Mobile : l'ordre DOM garde wallet avant objectifs.
    <div className="mx-auto grid w-full max-w-4xl grid-cols-1 gap-6 px-4 py-8 md:px-6 lg:grid-cols-[1fr_400px] lg:items-start lg:gap-8">
      <header className="flex flex-col gap-2 lg:col-span-2">
        <h1 className="font-display text-2xl md:text-3xl">Points Vida</h1>
        <p className="text-sm text-foreground-muted">
          Chaque vente confirmée devient des points. Choisis ce que tu en fais :
          les garder, ou les verser vers un objectif qui compte pour toi.
        </p>
      </header>

      {/* EX-H5 — libellé sandbox permanent, aucun virement réel V1 */}
      <p className="glass flex items-start gap-3 border-primary/30 p-4 text-sm text-foreground-muted lg:col-span-2">
        <Info size={18} className="mt-0.5 shrink-0" aria-hidden />
        <span>
          <span className="font-medium text-foreground">Sandbox :</span> 1 point
          = 1 € net vendeur. Aucun virement bancaire n’est effectué dans cette
          version — les points restent dans l’app.
        </span>
      </p>

      {/* Colonne argent (wallet, transferts, historique) — 1re sur mobile, à droite en lg */}
      <div className="flex min-w-0 flex-col gap-6 lg:order-2">
        {/* EX-H1 — wallet points */}
        <section
          className="glass flex flex-col gap-4 p-6"
          aria-label="Wallet Vida"
        >
          <div className="flex items-center gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-pill bg-primary/15 text-primary-on-dark">
              <Sparkles size={22} aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-sm text-foreground-muted">Solde</p>
              <p className="font-display text-3xl">
                {wallet.balance_points}{' '}
                <span className="text-base font-normal text-foreground-muted">
                  pts
                </span>
              </p>
            </div>
          </div>
          <p className="text-sm text-foreground-muted">
            Total gagné depuis l’inscription :{' '}
            <span className="font-semibold text-foreground">
              {wallet.total_earned_points} pts
            </span>
          </p>
        </section>

        {/* Étape 2 (EX-H3) — propositions en attente de confirmation */}
        {pendingVentes.length > 0 && (
          <section
            className="flex flex-col gap-4"
            aria-label="Transferts à confirmer"
          >
            <h2 className="font-display text-xl">À confirmer</h2>
            {pendingVentes.map((v) => {
              const t = pendingByVente.get(v.id)!;
              return (
                <TransferProposal
                  key={v.id}
                  vente={{
                    id: v.id,
                    net_amount_cents: v.net_amount_cents,
                    created_at: v.completed_at,
                    title: v.order?.[0]?.item?.[0]?.title ?? null,
                  }}
                  objectifs={[]}
                  existing={{
                    id: t.id,
                    pct: t.pct,
                    points_amount: t.points_amount,
                    objectif_id: t.objectif_id,
                  }}
                  objectifLabel={
                    t.objectif_id
                      ? objectifLabels.get(t.objectif_id) ?? null
                      : null
                  }
                />
              );
            })}
          </section>
        )}

        {/* Étape 1 (EX-H2) — ventes à répartir */}
        {ventesARation.length > 0 && (
          <section className="flex flex-col gap-4" aria-label="Ventes à répartir">
            <h2 className="font-display text-xl">Ventes à répartir</h2>
            {ventesARation
              .filter((v) => !pendingByVente.has(v.id))
              .map((v) => (
                <TransferProposal
                  key={v.id}
                  vente={{
                    id: v.id,
                    net_amount_cents: v.net_amount_cents,
                    created_at: v.completed_at,
                    title: v.order?.[0]?.item?.[0]?.title ?? null,
                  }}
                  objectifs={activeObjectifs.map((o) => ({
                    id: o.id,
                    label: o.label,
                  }))}
                  existing={null}
                  objectifLabel={null}
                />
              ))}
            {ventesARation.every((v) => pendingByVente.has(v.id)) && (
              <p className="text-sm text-foreground-muted">
                Toutes tes ventes ont une proposition en attente.
              </p>
            )}
          </section>
        )}

        {/* Historique */}
        {historique.length > 0 && (
          <section
            className="flex flex-col gap-4"
            aria-label="Historique des transferts"
          >
            <h2 className="font-display text-xl">Historique</h2>
            <ul className="flex flex-col gap-2">
              {historique.map((t) => (
                <li
                  key={t.id}
                  className="glass flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
                >
                  <span className="min-w-0">
                    <span className="font-semibold">{t.points_amount} pts</span>
                    {t.pct > 0
                      ? ` — ${t.pct} % vers « ${
                          t.objectif_id
                            ? objectifLabels.get(t.objectif_id) ??
                              'objectif supprimé'
                            : '—'
                        } »`
                      : ' — conservés sur le wallet'}
                  </span>
                  <span className="flex items-center gap-3 text-foreground-muted">
                    <span>{formatDate(t.created_at)}</span>
                    <span
                      className={`rounded-pill px-2 py-0.5 text-xs ${
                        t.status === 'confirmed'
                          ? 'bg-primary/15 text-primary-on-dark'
                          : 'bg-card text-foreground-muted'
                      }`}
                    >
                      {TRANSFER_STATUS_LABELS[t.status] ?? t.status}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="text-xs text-foreground-secondary">
          Le net de chaque vente confirmée est crédité en points automatiquement à
          la clôture — 1 pt = 1 € net vendeur.
        </p>
      </div>

      {/* Colonne La Boucle (D4 vedette + EX-H4 objectifs) — à gauche en lg */}
      <div className="flex min-w-0 flex-col gap-6 lg:order-1">
        {vedette && (
          <section
            className="glass flex flex-col items-center gap-5 p-6 text-center sm:flex-row sm:text-left"
            aria-label="Objectif en tête"
          >
            <BoucleRing
              current={vedette.current_points}
              target={vedette.target_points}
              size={128}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <p className="text-xs uppercase tracking-wide text-foreground-muted">
                La Boucle — objectif en tête
              </p>
              <p className="break-words font-display text-xl">{vedette.label}</p>
              {(() => {
                const vp = progression(
                  vedette.current_points,
                  vedette.target_points,
                );
                return (
                  <p className="text-sm text-foreground-muted" aria-live="polite">
                    <span className="font-semibold text-foreground">
                      {vedette.current_points} / {vedette.target_points} pts
                    </span>{' '}
                    ({vp.pct} %)
                    {!vp.complete && ` — encore ${vp.remainingPoints} pts`}
                    {vp.complete && ' — objectif atteint 🌿'}
                  </p>
                );
              })()}
            </div>
          </section>
        )}

        {/* EX-H4 — objectifs + progression */}
        <section className="flex flex-col gap-4" aria-label="Objectifs Vida">
          <h2 className="font-display text-xl">Objectifs</h2>
          {objectifs.length === 0 ? (
            <p className="glass p-5 text-sm text-foreground-muted">
              Aucun objectif pour l’instant — crée le premier ci-dessous.
            </p>
          ) : (
            <div className="grid gap-4">
              {objectifs.map((o) => (
                <ObjectifCard key={o.id} objectif={o} />
              ))}
            </div>
          )}
          <ObjectifForm />
        </section>
      </div>
    </div>
  );
}
