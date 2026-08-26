import { AlertTriangle, LineChart } from 'lucide-react';

import { formatEuros, type FiscalSummary } from '@/lib/fiscal';

/**
 * EX-J7 — compteur revenus annuels nets + alerte dès 250 € cumulés.
 * Composant serveur (données déjà calculées), chiffres réels DB (0 si 0).
 */
export default function FiscalCounter({ summary }: { summary: FiscalSummary }) {
  const pct = Math.min(
    100,
    Math.round((summary.netCents / summary.thresholdCents) * 100)
  );

  return (
    <section
      className="glass flex flex-col gap-4 p-6"
      aria-label="Revenus annuels"
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-foreground-muted">
            Revenus nets {summary.year}
          </p>
          <p className="font-mono mt-1 text-3xl">
            {formatEuros(summary.netCents)}
          </p>
        </div>
        <span
          aria-hidden
          className="flex h-12 w-12 items-center justify-center rounded-pill bg-primary/15 text-primary-on-dark"
        >
          <LineChart size={22} />
        </span>
      </div>

      {/* Progression vers le seuil — informative tant qu'il n'est pas atteint */}
      {!summary.alert && (
        <div className="flex flex-col gap-2">
          <div
            className="h-1.5 w-full overflow-hidden rounded-pill bg-primary/15"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Progression vers le seuil fiscal"
          >
            <div
              className="h-full rounded-pill bg-primary transition-all"
              style={{ width: `${Math.max(pct, 2)}%` }}
            />
          </div>
          <p className="text-xs text-foreground-muted">
            {pct} % du seuil d’information ({formatEuros(summary.thresholdCents)})
          </p>
        </div>
      )}

      {/* Alerte EX-J7 — dès 250 € nets cumulés sur l’année */}
      {summary.alert && (
        <p
          className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm leading-relaxed text-amber-100"
          role="alert"
          aria-label="Alerte seuil fiscal 250 euros"
        >
          <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            <span className="font-semibold">
              {formatEuros(summary.thresholdCents)} de revenus nets atteints
              cette année.
            </span>{' '}
            Ces revenus sont à déclarer selon ton régime fiscal — cette
            information est indicative et ne constitue pas un conseil fiscal.
          </span>
        </p>
      )}
    </section>
  );
}
