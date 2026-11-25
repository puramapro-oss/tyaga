'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';

const field = 'w-full min-w-0 rounded-md border border-border-control bg-background-soft px-3 py-2.5 text-foreground';
const label = 'grid min-w-0 gap-1.5 text-sm';

export default function ListingForm({ physicalSearch = false }: { physicalSearch?: boolean }) {
  const router = useRouter();
  const [intent, setIntent] = useState<'offer' | 'wanted'>(physicalSearch ? 'wanted' : 'offer');
  const [mode, setMode] = useState<'sale' | 'rental'>('sale');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);
  const lastRequest = useRef<{ body: string; id: string } | null>(null);
  const wanted = intent === 'wanted';

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? '').trim();
    const amount = value('price').replace(',', '.');
    if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(amount) || Number(amount) > 1000000) {
      setError('Indique un montant entre 0 et 1 000 000 € avec deux décimales au maximum.');
      return;
    }
    const [euros, fraction = ''] = amount.split('.');
    const payload = {
      title: value('title'), description: value('description'),
      priceCents: Number(euros) * 100 + Number(fraction.padEnd(2, '0')),
      ...(physicalSearch ? {} : {
        intent, mode, format: value('format'), licenseTerms: value('licenseTerms'),
        licenseDays: mode === 'rental' ? Number(value('licenseDays')) : null,
        rightsAttested: !wanted && form.has('rightsAttested'),
      }),
      userValidated: form.has('userValidated'),
    };
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      const body = JSON.stringify(payload);
      if (lastRequest.current?.body !== body) {
        lastRequest.current = { body, id: crypto.randomUUID() };
      }
      const response = await fetch(physicalSearch ? '/api/annonces/recherche' : '/api/annonces/numerique', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, requestId: lastRequest.current.id }),
        signal: AbortSignal.timeout(30000),
      });
      const result = await response.json() as { annonce?: { id?: string }; error?: string };
      if (!response.ok || !result.annonce?.id) {
        setError(result.error ?? 'Publication impossible. Réessaie dans un instant.');
        return;
      }
      router.push(`/marketplace/${result.annonce.id}`);
      router.refresh();
    } catch {
      setError('La publication n’a pas pu être confirmée. Réessaie avec les mêmes informations.');
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <form onSubmit={publish} className="glass p-5 sm:p-6">
      <fieldset disabled={busy} className="grid gap-5">
        <legend className="sr-only">Informations de l’annonce</legend>
        {!physicalSearch && <div className="grid gap-4 sm:grid-cols-2">
          <label className={label}>Je souhaite
            <select className={field} value={intent} onChange={e => setIntent(e.target.value === 'wanted' ? 'wanted' : 'offer')}>
              <option value="offer">Proposer un produit</option><option value="wanted">Rechercher un produit</option>
            </select>
          </label>
          <label className={label}>Type de licence
            <select className={field} value={mode} onChange={e => setMode(e.target.value === 'rental' ? 'rental' : 'sale')}>
              <option value="sale">Licence sans durée limitée</option><option value="rental">Licence temporaire</option>
            </select>
          </label>
        </div>}
        <label className={label}>Titre de l’annonce
          <input required minLength={3} maxLength={70} name="title" className={field} placeholder={physicalSearch ? 'Je cherche un vélo de ville taille M' : wanted ? 'Je cherche un guide photo pour débuter' : 'Mon guide de photographie argentique'} />
        </label>
        <label className={label}>Description
          <textarea required minLength={20} maxLength={1200} rows={4} name="description" className={field} aria-describedby="description-hint" />
          <span id="description-hint" className="text-xs text-foreground-muted">{physicalSearch ? 'Indique l’état souhaité, les dimensions ou le modèle recherché en 20 caractères minimum.' : 'Décris le contenu et sa compatibilité en 20 caractères minimum. Garde les fichiers, les clés et les liens privés hors de l’annonce.'}</span>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          {!physicalSearch && <label className={label}>Format du produit
            <input required name="format" className={field} list="digital-formats" minLength={2} maxLength={80} placeholder="PDF, EPUB, WAV…" />
            <datalist id="digital-formats"><option value="PDF" /><option value="EPUB" /><option value="Texte" /><option value="WAV" /><option value="SVG" /></datalist>
          </label>}
          <label className={label}>
            {wanted ? 'Budget maximum (€)' : mode === 'rental' ? 'Prix pour toute la durée (€)' : 'Prix de la licence (€)'}
            <input required name="price" inputMode="decimal" className={field} placeholder="0,00" maxLength={10} />
            <span className="text-xs text-foreground-muted">{wanted ? 'Saisis 0 si tu recherches un don.' : 'Saisis 0 pour un accès gratuit.'}</span>
          </label>
        </div>
        {mode === 'rental' && <label className={label}>Durée de la licence en jours
          <input required name="licenseDays" type="number" min="1" max="3650" step="1" className={field} placeholder="7" />
        </label>}
        {!physicalSearch && <label className={label}>{wanted ? 'Droits d’usage recherchés' : 'Conditions de la licence'}
          <textarea required minLength={20} maxLength={1200} name="licenseTerms" rows={3} className={field} placeholder="Précise les usages personnels ou commerciaux, la modification et la redistribution." />
        </label>}
        {!wanted && <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="rightsAttested" required className="mt-1" />
          Je détiens les droits nécessaires pour accorder cette licence aux conditions indiquées.
        </label>}
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="userValidated" required className="mt-1" />
          J’ai relu cette annonce et je confirme sa publication.
        </label>
        {error && <p role="alert" className="rounded-md border border-alert/40 p-3 text-sm">{error}</p>}
        <button type="submit" className="min-h-12 rounded-pill bg-primary px-5 font-semibold text-on-primary disabled:opacity-60" disabled={busy}>
          {busy ? 'Publication en cours…' : wanted ? 'Publier ma recherche' : 'Publier mon offre'}
        </button>
      </fieldset>
    </form>
  );
}
