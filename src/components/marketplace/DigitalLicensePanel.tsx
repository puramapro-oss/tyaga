'use client';

import Link from 'next/link';
import { useEffect, useId, useState } from 'react';

import LicensedFile from '@/components/marketplace/LicensedFile';

type License =
  | { state: 'attach' | 'sample_attach' | 'sample_owner' | 'sample_missing' | 'owner' | 'missing' | 'paid' | 'revoked'; text?: string }
  | { state: 'available' | 'sample_available'; version: string; terms: string; days: number | null }
  | { state: 'expired' | 'active'; terms: string; expiresAt: string | null; acquiredAt: string; text?: string };
type ResponseState = License & { serverNow: string; sample?: boolean };

export default function DigitalLicensePanel({ annonceId, isOwner, priceCents }: {
  annonceId: string; isOwner: boolean; priceCents: number;
}) {
  const heading = useId();
  const [license, setLicense] = useState<ResponseState | null>(null);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [medium, setMedium] = useState<'text' | 'file'>('text');
  const [agreed, setAgreed] = useState(false);
  const [working, setWorking] = useState(false);
  const [revision, setRevision] = useState(0);
  const [reading, setReading] = useState(false);
  const url = `/api/annonces/${annonceId}/licence`;
  const buttonClass = 'w-fit rounded-pill border border-border-control px-4 py-2 text-sm disabled:opacity-60';
  useEffect(() => {
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      setLicense(null);
      setAgreed(false);
      setReading(false);
      setRevision(value => value + 1);
    };
    const visibility = () => {
      if (document.visibilityState === 'hidden') {
        // Drop the opened text before switching accounts/tabs or suspending.
        setReading(false);
        setLicense(null);
      } else {
        refresh();
      }
    };
    document.addEventListener('visibilitychange', visibility);
    const started = Date.now();
    async function load() {
      try {
        const res = await fetch(url + (reading ? '?lire=1' : ''), { cache: 'no-store', signal: ctl.signal });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Lecture de la licence indisponible.');
        if (ctl.signal.aborted || document.visibilityState === 'hidden') return;
        const result = data as ResponseState;
        // Compare against server time. Expire conservatively by accounting
        // for the round-trip before rendering any protected text.
        if (result.state === 'active' && result.expiresAt) {
          const remaining = Date.parse(result.expiresAt) - Date.parse(result.serverNow) - (Date.now() - started);
          if (remaining <= 0) {
            setLicense({ ...result, state: 'expired', text: undefined });
            return;
          }
          timer = setTimeout(refresh, Math.min(remaining, 2147483647));
        }
        if (result.sample && reading) {
          clearTimeout(timer);
          const lease = result.state === 'active' && result.expiresAt
            ? Date.parse(result.expiresAt) - Date.parse(result.serverNow) - (Date.now() - started) : 60000;
          timer = setTimeout(refresh, Math.max(0, Math.min(60000, lease)));
        }
        setAgreed(false);
        setLicense(result);
        setError('');
      } catch (reason) {
        if (!ctl.signal.aborted) {
          setLicense(null);
          setError(reason instanceof Error ? reason.message : 'Lecture indisponible.');
        }
      }
    }
    void load();
    return () => { ctl.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', visibility); };
  }, [priceCents, reading, revision, url]);

  async function save() {
    if (!license || working || !agreed) return;
    if (license.state !== 'attach' && license.state !== 'available' && license.state !== 'sample_available' && license.state !== 'sample_attach') return;
    setWorking(true);
    setError('');
    try {
      const body = license.state === 'available' || license.state === 'sample_available'
        ? { action: license.state === 'sample_available' ? 'checkout' : 'claim', version: license.version, accept: true }
        : { action: license.state === 'sample_attach' ? 'sample' : 'attach', text, attest: true };
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Opération indisponible.');
      if (typeof result.url === 'string') {
        const destination = new URL(result.url);
        if (destination.origin !== 'https://checkout.stripe.com') throw new Error('Adresse du prestataire inattendue.');
        window.location.assign(destination.href);
        return;
      }
      setText('');
      setAgreed(false);
      setLicense(null);
      setRevision(value => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Opération indisponible.');
    } finally { setWorking(false); }
  }

  const accessible = license?.state === 'owner' || license?.state === 'active';
  return <section className="glass flex flex-col gap-3 p-5" aria-labelledby={heading}>
    <h2 id={heading} className="font-display text-xl">Accès à la création</h2>
    {error && <p role="alert">{error} <button className={buttonClass} onClick={() => setRevision(value => value + 1)}>Actualiser</button></p>}
    {!license && !error && <p role="status">Vérification de l’accès…</p>}
    {(license?.state === 'attach' || license?.state === 'sample_attach') && isOwner && <>
      <label className="grid gap-1 text-sm">Support de la création
        <select value={medium} disabled={working}
          onChange={event => { setMedium(event.target.value === 'file' ? 'file' : 'text'); setAgreed(false); }}
          className="min-h-11 rounded-md border border-border-control bg-background-soft px-3">
          <option value="text">Texte</option><option value="file">Fichier</option>
        </select>
      </label>
      {medium === 'file' ? <LicensedFile endpoint={url + '/fichier'} id={annonceId} state={license.state}
        revision={revision} upload={license.state === 'sample_attach' ? 'test-sample' : 'free'} onBusy={setWorking}
        afterUpload={() => { setLicense(null); setRevision(value => value + 1); }} /> : <>
      <label>Texte intégral de ta création
        <textarea className="mt-1 block min-h-32 w-full rounded-lg border border-border-control bg-background p-2" maxLength={32000}
          value={text} onChange={event => setText(event.target.value)} />
      </label>
      <p className="text-sm">{license.state === 'sample_attach' ? 'Recette Stripe. Joins uniquement un échantillon destiné aux testeurs. Aucun paiement réel.' : 'Une fois joint, ce texte est définitif et cette offre reste gratuite.'}</p>
      <label><input type="checkbox" checked={agreed} onChange={event => setAgreed(event.target.checked)} /> {license.state === 'sample_attach' ? 'J’autorise les testeurs à lire cet échantillon après un paiement fictif.' : 'Je dispose des droits pour distribuer ce texte aux conditions de l’annonce.'}</label>
      <button className={buttonClass} disabled={working || !agreed || !text.trim()} onClick={save}>Joindre le texte</button>
      </>}
    </>}
    {license?.state === 'sample_owner' && <p>Ton échantillon est joint. Un autre compte de recette peut essayer son accès avec une carte Stripe de test.</p>}
    {license?.state === 'sample_missing' && <p>Le créateur n’a pas encore joint d’échantillon pour la recette.</p>}
    {license?.state === 'missing' && <p>L’auteur n’a pas encore joint sa création.</p>}
    {license?.state === 'paid' && <p>Le paiement et la délivrance de cette licence sont indisponibles.</p>}
    {(license?.state === 'available' || license?.state === 'sample_available') && <>
      <p>{license.state === 'sample_available' ? 'Recette Stripe Connect. Utilise uniquement une carte de test. Aucun débit réel.' : license.days === null ? 'Accès gratuit sans échéance.' : `Accès gratuit pendant ${license.days} jour(s) dès l’activation.`}</p>
      <LicensedFile endpoint={url + '/fichier'} id={annonceId} state={license.state} revision={revision} />
      <p className="whitespace-pre-wrap break-words">{license.terms}</p>
      <p className="text-sm">Si la création est un fichier, tu peux le télécharger pendant la licence. Une copie téléchargée peut rester sur ton appareil après son expiration. Les conditions d’usage continuent de s’appliquer.</p>
      <label><input type="checkbox" checked={agreed} onChange={event => setAgreed(event.target.checked)} /> {license.state === 'sample_available' ? 'J’accepte ces conditions de recette et je demande l’accès à l’échantillon après le paiement fictif.' : 'J’accepte ces conditions d’utilisation.'}</label>
      <button className={buttonClass} disabled={working || !agreed} onClick={save}>{license.state === 'sample_available' ? 'Essayer le paiement en mode test' : 'Activer ma licence gratuite'}</button>
    </>}
    {license?.state === 'revoked' && <p>Le règlement de recette a été remboursé ou contesté. Le droit de lecture a pris fin.</p>}
    {license?.state === 'expired' && <p>Cette licence a expiré. L’accès à la création est fermé.</p>}
    {license?.state === 'active' && <p>{license.expiresAt ? `Accès jusqu’au ${new Date(license.expiresAt).toLocaleString('fr-FR')}.` : 'Licence active sans échéance.'}</p>}
    {(accessible || license?.state === 'sample_owner') && license && <LicensedFile endpoint={url + '/fichier'} id={annonceId} state={license.state} revision={revision}>
    {accessible && <button className={buttonClass} onClick={() => { setLicense(null); setReading(value => !value); }}>{reading ? 'Fermer le texte' : 'Lire le texte'}</button>}
    {accessible && license && 'text' in license && reading && <article className="whitespace-pre-wrap break-words" aria-label="Texte de la création">{license.text}</article>}
    </LicensedFile>}
    {license?.state === 'active' && <Link className="underline" href="/marketplace/mes-licences">Mes licences</Link>}
  </section>;
}
