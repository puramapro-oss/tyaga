'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Camera, Check, Loader2, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';

/**
 * EX-B — Scanner un objet : 3 photos (face, dos, défaut/étiquette),
 * proposition IA modifiable, enregistrement. L'IA propose, jamais n'impose.
 */

const SLOTS = [
  { angle: 'face', label: 'Face', hint: 'L’objet entier, bien cadré' },
  { angle: 'dos', label: 'Dos', hint: 'L’arrière, étiquettes visibles' },
  { angle: 'defaut', label: 'Défaut / étiquette', hint: 'Usure, tâche, référence' },
] as const;

const CONDITIONS: { value: string; label: string }[] = [
  { value: 'neuf', label: 'Neuf — jamais servi' },
  { value: 'excellent', label: 'Excellent — comme neuf' },
  { value: 'tres_bon', label: 'Très bon' },
  { value: 'bon', label: 'Bon' },
  { value: 'satisfaisant', label: 'Satisfaisant — visible' },
  { value: 'a_reparer', label: 'À réparer' },
];

interface Proposal {
  category: string;
  brand: string;
  model: string;
  condition: string;
  condition_confidence: string;
  hints: string;
}

export default function ScanPage() {
  const router = useRouter();
  const [photos, setPhotos] = useState<Record<string, File | null>>({
    face: null,
    dos: null,
    defaut: null,
  });
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [step, setStep] = useState<'photos' | 'form'>('photos');
  const [busy, setBusy] = useState<'analyse' | 'save' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [itemId, setItemId] = useState('');
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [form, setForm] = useState({
    category: '',
    brand: '',
    model: '',
    condition: 'bon',
  });
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Preview URLs révoquées au retrait (pas de fuite mémoire)
  useEffect(() => {
    return () => Object.values(previews).forEach((url) => URL.revokeObjectURL(url));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = useCallback((angle: string, file: File | null) => {
    setError('');
    setPreviews((prev) => {
      if (prev[angle]) URL.revokeObjectURL(prev[angle]);
      return { ...prev, [angle]: file ? URL.createObjectURL(file) : '' };
    });
    setPhotos((prev) => ({ ...prev, [angle]: file }));
  }, []);

  const ready = SLOTS.every((s) => photos[s.angle]);

  async function analyse() {
    if (!ready) return;
    setBusy('analyse');
    setError('');
    setNotice('');
    try {
      const body = new FormData();
      SLOTS.forEach((s) => body.append(s.angle, photos[s.angle]!));
      const res = await fetch('/api/scan', { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Analyse impossible. Réessaie.');
      setItemId(data.itemId);
      if (data.proposal) {
        setProposal(data.proposal);
        setForm({
          category: data.proposal.category || '',
          brand: data.proposal.brand || '',
          model: data.proposal.model || '',
          condition: data.proposal.condition || 'bon',
        });
      }
      if (data.message) setNotice(data.message);
      setStep('form');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analyse impossible. Réessaie.');
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!itemId) return;
    setBusy('save');
    setError('');
    try {
      const res = await fetch('/api/scan', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId,
          category: form.category,
          brand: form.brand,
          model: form.model,
          condition: form.condition,
          title: [form.brand, form.model].filter(Boolean).join(' ') || form.category,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Enregistrement impossible.');
      router.push('/objets');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Enregistrement impossible.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="font-display text-3xl">Scanner un objet</h1>
        <p className="mt-2 text-sm text-foreground-muted">
          3 photos suffisent. TYAGA identifie, tu confirmes.
        </p>
      </div>

      {error && (
        <p role="alert" className="glass border-red-500/30 p-4 text-sm text-red-300">
          {error}
        </p>
      )}
      {notice && step === 'form' && (
        <p className="glass p-4 text-sm leading-relaxed text-foreground-secondary">
          {notice} Tu peux remplir les champs à la main.
        </p>
      )}

      {step === 'photos' ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            {SLOTS.map((s) => (
              <div key={s.angle} className="glass flex flex-col gap-3 p-4">
                {previews[s.angle] ? (
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={previews[s.angle]}
                      alt={`Photo ${s.label}`}
                      className="aspect-square w-full rounded-md object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => inputRefs.current[s.angle]?.click()}
                      className="absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-pill bg-background/80 text-foreground backdrop-blur"
                      aria-label={`Reprendre la photo ${s.label}`}
                    >
                      <RefreshCw size={15} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => inputRefs.current[s.angle]?.click()}
                    className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border text-foreground-muted transition-colors hover:border-primary/50 hover:text-foreground"
                  >
                    <Camera size={24} />
                    <span className="text-xs font-medium">{s.label}</span>
                  </button>
                )}
                <div>
                  <p className="text-sm font-medium">{s.label}</p>
                  <p className="text-xs leading-relaxed text-foreground-muted">{s.hint}</p>
                </div>
                <input
                  ref={(el) => {
                    inputRefs.current[s.angle] = el;
                  }}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => pick(s.angle, e.target.files?.[0] ?? null)}
                />
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={analyse}
            disabled={!ready || busy !== null}
            className="flex h-12 items-center justify-center gap-2 rounded-pill bg-primary px-6 text-sm font-semibold text-on-primary transition-opacity disabled:opacity-40"
          >
            {busy === 'analyse' ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Analyse en cours…
              </>
            ) : (
              <>
                <Camera size={16} />
                Analyser mes 3 photos
              </>
            )}
          </button>
        </>
      ) : (
        <div className="glass flex flex-col gap-5 p-6">
          {proposal?.hints && (
            <p className="text-sm leading-relaxed text-foreground-secondary">
              <span className="font-medium">TYAGA a vu :</span> {proposal.hints}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm">
              Catégorie
              <input
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder="ex: sneakers"
                maxLength={80}
                className="h-11 rounded-md border border-border bg-card px-3 text-foreground outline-none focus:border-primary"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm">
              Marque
              <input
                value={form.brand}
                onChange={(e) => setForm({ ...form, brand: e.target.value })}
                placeholder="visible sur l’objet"
                maxLength={80}
                className="h-11 rounded-md border border-border bg-card px-3 text-foreground outline-none focus:border-primary"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm">
              Modèle / référence
              <input
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                placeholder="si visible"
                maxLength={80}
                className="h-11 rounded-md border border-border bg-card px-3 text-foreground outline-none focus:border-primary"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm">
              État
              <select
                value={form.condition}
                onChange={(e) => setForm({ ...form, condition: e.target.value })}
                className="h-11 rounded-md border border-border bg-card px-3 text-foreground outline-none focus:border-primary"
              >
                {CONDITIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p className="text-xs leading-relaxed text-foreground-muted">
            Tout est modifiable — l’IA propose, tu disposes.
          </p>

          <button
            type="button"
            onClick={save}
            disabled={busy !== null}
            className="flex h-12 items-center justify-center gap-2 rounded-pill bg-primary px-6 text-sm font-semibold text-on-primary transition-opacity disabled:opacity-40"
          >
            {busy === 'save' ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Enregistrement…
              </>
            ) : (
              <>
                <Check size={16} />
                Enregistrer l’objet
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
