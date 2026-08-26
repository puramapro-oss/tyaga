'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, ArchiveRestore, Check, Pencil, Trash2, X } from 'lucide-react';

import BoucleRing from '@/components/vida/BoucleRing';
import { objectifTypeLabel, progression } from '@/lib/vida';

export interface ObjectifRow {
  id: string;
  type: string;
  label: string;
  target_points: number;
  current_points: number;
  active: boolean;
}

/**
 * EX-H4 — carte objectif : barre de progression + montant, édition inline
 * (nom/cible), archivage, suppression. current_points ne change QUE par les
 * transferts confirmés — jamais éditable à la main.
 */
export default function ObjectifCard({ objectif }: { objectif: ObjectifRow }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(objectif.label);
  const [target, setTarget] = useState(String(objectif.target_points));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const p = progression(objectif.current_points, objectif.target_points);

  async function call(method: string, body?: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/vida/objectifs/${objectif.id}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok && method !== 'DELETE') {
        const json = (await res.json()) as { error?: string };
        setError(json.error ?? 'Modification impossible. Réessaie.');
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError('Connexion perdue. Vérifie ton réseau et réessaie.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    const targetPoints = Number.parseInt(target, 10);
    if (!Number.isFinite(targetPoints) || targetPoints < 1) {
      setError('La cible doit être d’au moins 1 point.');
      return;
    }
    const ok = await call('PATCH', {
      label: label.trim(),
      targetPoints,
    });
    if (ok) setEditing(false);
  }

  return (
    <article
      className={`glass flex flex-col gap-3 p-5 ${objectif.active ? '' : 'opacity-60'}`}
      aria-label={`Objectif ${objectif.label}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-foreground-muted">
            {objectifTypeLabel(objectif.type)}
          </p>
          {editing ? (
            <form onSubmit={saveEdit} className="mt-2 flex flex-col gap-2">
              <input
                aria-label="Nom de l’objectif"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                minLength={3}
                maxLength={80}
                required
                className="h-10 rounded-md border border-border bg-background px-3 text-sm"
              />
              <input
                aria-label="Cible en points"
                value={target}
                onChange={(e) => setTarget(e.target.value.replace(/[^0-9]/g, ''))}
                inputMode="numeric"
                pattern="[0-9]*"
                required
                className="h-10 rounded-md border border-border bg-background px-3 text-sm"
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={busy}
                  className="flex h-10 flex-1 items-center justify-center gap-2 rounded-pill bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50"
                >
                  <Check size={15} />
                  Enregistrer
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setLabel(objectif.label);
                    setTarget(String(objectif.target_points));
                    setError(null);
                  }}
                  className="flex h-10 items-center gap-2 rounded-pill border border-border px-4 text-sm"
                >
                  <X size={15} />
                  Annuler
                </button>
              </div>
            </form>
          ) : (
            <p className="font-display text-lg">{objectif.label}</p>
          )}
        </div>

        {!editing && (
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              aria-label="Modifier l’objectif"
              onClick={() => setEditing(true)}
              className="flex h-10 w-10 items-center justify-center rounded-md border border-border text-foreground-muted hover:text-foreground"
            >
              <Pencil size={16} />
            </button>
            <button
              type="button"
              aria-label={objectif.active ? 'Archiver l’objectif' : 'Réactiver l’objectif'}
              disabled={busy}
              onClick={() => call('PATCH', { active: !objectif.active })}
              className="flex h-10 w-10 items-center justify-center rounded-md border border-border text-foreground-muted hover:text-foreground disabled:opacity-50"
            >
              {objectif.active ? <Archive size={16} /> : <ArchiveRestore size={16} />}
            </button>
            <button
              type="button"
              aria-label="Supprimer l’objectif"
              disabled={busy}
              onClick={() => {
                if (confirmDelete) {
                  void call('DELETE');
                } else {
                  setConfirmDelete(true);
                }
              }}
              onBlur={() => setConfirmDelete(false)}
              className={`flex h-10 items-center justify-center rounded-md border text-sm ${
                confirmDelete
                  ? 'w-auto gap-1 border-red-500/60 px-3 text-red-400'
                  : 'w-10 border-border text-foreground-muted hover:text-foreground'
              } disabled:opacity-50`}
            >
              <Trash2 size={16} />
              {confirmDelete ? 'Confirmer ?' : null}
            </button>
          </div>
        )}
      </div>

      {/* EX-H4 : progression anneau (La Boucle) + barre + montant */}
      <div className="flex items-center gap-4">
        <BoucleRing
          current={objectif.current_points}
          target={objectif.target_points}
          size={72}
        />
        <div
          className="flex flex-1 flex-col gap-2"
          aria-label="Progression de l’objectif"
        >
          <div className="h-2.5 w-full overflow-hidden rounded-pill bg-card">
            <div
              className="h-full rounded-pill bg-primary transition-[width] duration-500"
              style={{ width: `${p.pct}%` }}
            />
          </div>
          <p className="text-sm text-foreground-muted" aria-live="polite">
            <span className="font-semibold text-foreground">
              {objectif.current_points} / {objectif.target_points} pts
            </span>{' '}
            ({p.pct} %){!p.complete && ` — encore ${p.remainingPoints} pts`}
            {p.complete && ' — objectif atteint 🌿'}
          </p>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
    </article>
  );
}
