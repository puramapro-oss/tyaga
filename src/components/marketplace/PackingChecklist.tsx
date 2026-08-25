'use client';

import { Check, PackageCheck } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * EX-G1 — checklist d'emballage affichée au VENDEUR dès que la commande
 * est payée. 6 étapes concrètes ; la progression est mémorisée par
 * commande (localStorage), jamais partagée.
 */

const STEPS: string[] = [
  "Enveloppe l'objet dans du papier bulle ou du duvet, en insistant sur les angles et les parties fragiles.",
  'Choisis un carton à la bonne taille : l’objet ne doit pas bouger quand tu secoues le colis.',
  'Comble les vides avec du journal, du carton plié ou des calages (chocs = litiges).',
  "Glisse une copie de l'annonce ou un petit mot manuscrit avec ton pseudo TYAGA.",
  'Ferme le colis avec du scotch en « H » sur tous les rabats, renforce les coins.',
  'Note le poids et les dimensions, achète ton étiquette en ligne puis dépose le colis au point relais le plus proche.',
];

interface PackingChecklistProps {
  orderId: string;
}

export default function PackingChecklist({ orderId }: PackingChecklistProps) {
  const storageKey = `tyaga-emballage-${orderId}`;
  const [checked, setChecked] = useState<boolean[]>(STEPS.map(() => false));

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw) as boolean[];
        setChecked(STEPS.map((_, i) => saved[i] === true));
      }
    } catch {
      // localStorage indisponible (navigation privée) : checklist sans mémoire
    }
  }, [storageKey]);

  function toggle(i: number) {
    setChecked((prev) => {
      const next = prev.map((v, idx) => (idx === i ? !v : v));
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // sans mémoire : la case reste cochée le temps de la page
      }
      return next;
    });
  }

  const done = checked.filter(Boolean).length;

  return (
    <section
      aria-label="Emballage avant envoi"
      className="rounded-md border border-border bg-card p-4"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <PackageCheck size={17} className="text-primary" />
          <h3 className="text-sm font-semibold">Emballage avant envoi</h3>
        </div>
        <span className="text-xs text-foreground-muted" aria-live="polite">
          {done}/{STEPS.length} étapes
        </span>
      </div>
      <ol className="flex flex-col gap-2">
        {STEPS.map((step, i) => (
          <li key={i}>
            <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed">
              <input
                type="checkbox"
                aria-label={`Étape ${i + 1} : ${step.slice(0, 40)}…`}
                checked={checked[i]}
                onChange={() => toggle(i)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary)]"
              />
              <span className={checked[i] ? 'text-foreground-muted line-through' : ''}>
                {step}
              </span>
              {checked[i] && <Check size={14} className="mt-1 shrink-0 text-primary" />}
            </label>
          </li>
        ))}
      </ol>
    </section>
  );
}
