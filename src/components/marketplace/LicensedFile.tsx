'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { declaredFileType, licensedFileExtensions, MAX_LICENSE_FILE_BYTES, type LicenseFileType } from '@/lib/licensed-file';

const types = Object.keys(licensedFileExtensions) as LicenseFileType[];
const button = 'w-fit min-h-11 rounded-pill border border-border-control px-4 py-2 text-sm disabled:opacity-60';

interface FileProps {
  endpoint: string;
  id: string;
  state: string;
  revision: number;
  upload?: 'free' | 'test-sample';
  afterUpload?: () => void;
  onBusy?: (value: boolean) => void;
  children?: ReactNode;
}

function supported(type: string | undefined): type is LicenseFileType {
  return Boolean(type && Object.hasOwn(licensedFileExtensions, type));
}

function localType(file: File): LicenseFileType | undefined {
  const type = declaredFileType(file.type);
  if (supported(type)) return type;
  if (type && type !== 'application/octet-stream') return undefined;
  const ext = file.name.split('.').pop()?.toLowerCase();
  return ext === 'jpeg' ? 'image/jpeg' : types.find(key => licensedFileExtensions[key] === ext);
}

export default function LicensedFile({ endpoint, id, state, revision, upload, afterUpload, onBusy, children }: FileProps) {
  const [meta, setMeta] = useState<{ type: LicenseFileType; size: number } | null | undefined>(undefined);
  const [file, setFile] = useState<File | null>(null);
  const [rights, setRights] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const action = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setMeta(undefined);
      setError('');
      if (upload) return;
      try {
        const response = await fetch(endpoint, { method: 'HEAD', cache: 'no-store', signal: controller.signal });
        if (response.status === 404) { setMeta(null); return; }
        const type = declaredFileType(response.headers.get('content-type'));
        const size = Number(response.headers.get('x-file-size'));
        if (!response.ok || !supported(type) || !Number.isInteger(size) || size < 1 || size > MAX_LICENSE_FILE_BYTES) {
          throw new Error('Impossible de vérifier le support de cette création.');
        }
        setMeta({ type, size });
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Lecture indisponible.');
      }
    }
    void load();
    return () => { controller.abort(); action.current?.abort(); };
  }, [endpoint, state, revision, retry, upload]);

  async function transfer() {
    if (action.current) return;
    const controller = new AbortController();
    action.current = controller;
    setBusy(true);
    onBusy?.(true);
    setError('');
    try {
      if (upload) {
        const type = file && localType(file);
        if (!file || !type || !rights || file.size < 1 || file.size > MAX_LICENSE_FILE_BYTES) {
          throw new Error('Choisis un fichier pris en charge de 2 Mio maximum et confirme les droits.');
        }
        const response = await fetch(endpoint, { method: 'POST', body: file, signal: controller.signal,
          headers: { 'Content-Type': type, 'X-File-Rights': 'confirmed', 'X-File-Purpose': upload } });
        if (!response.ok) throw new Error((await response.text()) || 'Le fichier n’a pas pu être joint.');
        afterUpload?.();
      } else if (meta) {
        const response = await fetch(endpoint, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error((await response.text()) || 'Téléchargement indisponible.');
        if (declaredFileType(response.headers.get('content-type')) !== meta.type) throw new Error('Type de fichier inattendu.');
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        if (blob.size !== meta.size) throw new Error('Le fichier reçu est incomplet.');
        const address = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = address;
        anchor.download = `creation-${id}.${licensedFileExtensions[meta.type]}`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(address), 30000);
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Transfert impossible.');
    } finally {
      action.current = null;
      setBusy(false);
      onBusy?.(false);
    }
  }

  if (!upload && meta === null) return <>{children}</>;
  const mayDownload = state === 'owner' || state === 'sample_owner' || state === 'active';
  return <div className="grid min-w-0 gap-3 text-sm">
    {upload ? <>
      <label className="grid gap-1">{upload === 'test-sample' ? 'Fichier échantillon de recette' : 'Fichier de ta création'}
        <input type="file" accept=".pdf,.png,.jpg,.jpeg,.wav,.mp4" disabled={busy}
          className="w-full min-w-0 rounded-md border border-border-control p-2"
          onChange={event => { setFile(event.target.files?.[0] ?? null); setRights(false); setError(''); }} />
      </label>
      <p>PDF, PNG, JPEG, WAV ou MP4 · 2 Mio maximum. Le fichier joint est définitif.</p>
      {upload === 'test-sample' && <p>Joins uniquement un échantillon destiné aux comptes de recette Stripe.</p>}
      <label><input type="checkbox" checked={rights} disabled={busy} onChange={event => setRights(event.target.checked)} />{' '}
        J’autorise la distribution de ce fichier selon les conditions de la licence{upload === 'test-sample' ? ' aux testeurs' : ''} et je dispose des droits nécessaires.</label>
      <button className={button} type="button" disabled={busy || !rights || !file} onClick={transfer}>
        {busy ? 'Envoi en cours…' : 'Joindre le fichier'}
      </button>
    </> : meta ? <>
      <p>Fichier {licensedFileExtensions[meta.type].toUpperCase()} · {Math.ceil(meta.size / 1024).toLocaleString('fr-FR')} Kio</p>
      {mayDownload && <button type="button" className={button} onClick={transfer} disabled={busy}>
        {busy ? 'Téléchargement en cours…' : 'Télécharger le fichier'}
      </button>}
    </> : !error && <p role="status">Vérification du support…</p>}
    {error && <p role="alert">{error}{!upload && !meta && <button type="button" className={button} onClick={() => setRetry(value => value + 1)}>Réessayer</button>}</p>}
  </div>;
}
