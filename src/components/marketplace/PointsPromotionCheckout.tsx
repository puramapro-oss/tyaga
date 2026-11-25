'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

type Terms = { tariffId: string; costPoints: number; durationHours: number };
type Quote = Terms & { balancePoints: number };
type Pending = { tariffId: string; requestId: string; terms: Terms | null };
type Receipt = { grantId: string; receiptId: string; costPoints: number; status?: 'purchased' | 'refunded' };
const format = new Intl.NumberFormat('fr-FR');
const button = 'min-h-11 w-fit rounded-pill border border-border-control px-4 disabled:opacity-60';
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function units(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isTerms(value: unknown): value is Terms {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<Terms>;
  return typeof v.tariffId === 'string' && v.tariffId.length > 0 && units(v.costPoints) && units(v.durationHours);
}

function isQuote(value: unknown): value is Quote {
  return isTerms(value) && 'balancePoints' in value && typeof value.balancePoints === 'number'
    && Number.isSafeInteger(value.balancePoints) && value.balancePoints >= 0;
}

function isReceipt(value: unknown): value is Receipt {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<Receipt>;
  return typeof v.receiptId === 'string' && typeof v.grantId === 'string' && units(v.costPoints)
    && (v.status === undefined || v.status === 'purchased' || v.status === 'refunded');
}

function readAttempt(key: string): Pending | null {
  let data = window.history.state?.[key];
  try { data ??= JSON.parse(sessionStorage.getItem(key) ?? 'null'); } catch { /* Stockage isolé par le navigateur. */ }
  if (!data || typeof data.tariffId !== 'string' || typeof data.requestId !== 'string' || !uuid.test(data.requestId)) return null;
  // Une ancienne confirmation peut exister sans montant ni durée. Elle donne
  // uniquement accès à la recherche de son reçu, jamais à un nouveau débit.
  const terms = isTerms(data.terms) && data.terms.tariffId === data.tariffId ? data.terms : null;
  return { tariffId: data.tariffId, requestId: data.requestId, terms };
}

function store(key: string, pending: Pending) {
  try { sessionStorage.setItem(key, JSON.stringify(pending)); } catch {
    window.history.replaceState({ ...window.history.state, [key]: pending }, '');
  }
}

function forget(key: string) {
  try {
    if (window.history.state?.[key]) {
      const state = { ...window.history.state };
      delete state[key];
      window.history.replaceState(state, '');
    }
  } catch { /* Une ancienne référence conservée ne produit aucun nouveau débit. */ }
  try { sessionStorage.removeItem(key); } catch { /* Le reçu serveur reste consultable. */ }
}

export default function PointsPromotionCheckout({ listingId }: { listingId: string }) {
  const router = useRouter();
  const url = `/api/annonces/${encodeURIComponent(listingId)}/promotion-points`;
  const key = `tyaga:promotion-points:${listingId}`;
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [absent, setAbsent] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0);
  const inFlight = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoaded(false);
    setQuote(null);
    setAccepted(false);
    setPending(readAttempt(key));
    void (async () => {
      try {
        const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) return;
        const { quote: current } = await response.json();
        if (!controller.signal.aborted) {
          setLoaded(true);
          setQuote(isQuote(current) ? current : null);
        }
      } catch { /* Le devis courant est facultatif pour retrouver une demande. */ }
    })();
    return () => controller.abort();
  }, [key, url, revision]);

  const terms = pending ? pending.terms : quote;
  const sameTerms = Boolean(quote && terms && quote.tariffId === terms.tariffId
    && quote.costPoints === terms.costPoints && quote.durationHours === terms.durationHours);
  const canBuy = Boolean(terms && quote && sameTerms && quote.balancePoints >= quote.costPoints && (!pending || absent));

  function finish(result: Receipt) {
    setReceipt(result);
    setPending(null);
    setAccepted(false);
    setMessage('');
    forget(key);
    router.refresh();
  }

  async function recover() {
    if (!pending || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage('');
    setAccepted(false);
    try {
      const params = new URLSearchParams({ requestId: pending.requestId, tariffId: pending.tariffId });
      const response = await fetch(`${url}?${params}`, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Reçu momentanément indisponible.');
      if (data.receipt === null) {
        setAbsent(true);
        setQuote(null);
        setLoaded(false);
        setRevision(value => value + 1);
        setMessage('Aucun reçu retrouvé pour cette demande.');
      } else if (isReceipt(data.receipt) && data.receipt.status
        && (!pending.terms || data.receipt.costPoints === pending.terms.costPoints)) {
        finish(data.receipt);
      } else throw new Error('Le reçu doit être revérifié.');
    } catch (err) {
      setAbsent(false);
      setMessage(err instanceof Error ? err.message : 'Le reçu doit être revérifié.');
    } finally { inFlight.current = false; setBusy(false); }
  }

  async function buy() {
    if (!terms || !canBuy || !accepted || inFlight.current || receipt) return;
    inFlight.current = true;
    setBusy(true);
    setMessage('');
    try {
      let req = pending;
      if (!req) {
        const { tariffId, costPoints, durationHours } = terms;
        req = { tariffId, requestId: crypto.randomUUID(), terms: { tariffId, costPoints, durationHours } };
        try { store(key, req); } catch {
          setMessage('Le navigateur ne peut pas conserver la référence. Autorise le stockage de session et réessaie.');
          return;
        }
        setPending(req);
      }
      setAbsent(false);
      setAccepted(false);
      const response = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(30000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tariffId: req.tariffId, requestId: req.requestId, confirmed: true }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(typeof data.error === 'string' ? data.error : 'Retrouve le reçu de cette demande avant de poursuivre.');
        return;
      }
      if (!isReceipt(data.receipt) || data.receipt.costPoints !== terms.costPoints) throw new Error('Reçu inattendu.');
      finish(data.receipt);
    } catch {
      setMessage('La réception du bon reste à vérifier. Tu peux retrouver le reçu de la demande initiale.');
    } finally { inFlight.current = false; setBusy(false); }
  }

  function viewCurrentQuote() {
    if (!pending || !absent || busy) return;
    forget(key);
    setPending(null);
    setQuote(null);
    setAccepted(false);
    setAbsent(false);
    setMessage('');
    setRevision(value => value + 1);
  }

  if (receipt) return <p role="status" className="break-words text-sm">
    {receipt.status === 'refunded' ? 'Points de recette restitués. Le bon est annulé.' : 'Bon de recette disponible. Tu peux l’activer dans les bons de cette annonce.'}
    {' '}Reçu {receipt.receiptId} · {format.format(receipt.costPoints)} points.
  </p>;
  if (!pending && !quote) return null;
  return <section className="grid gap-3 rounded-md border border-border p-4 text-sm" aria-label="Achat de bon avec points de recette">
    <h3 className="font-semibold">{pending ? 'Retrouver mon achat de recette' : 'Acheter un bon avec les points de recette'}</h3>
    {terms && <p>Une mise en avant de <strong>{format.format(terms.durationHours)} h</strong> coûte <strong>{format.format(terms.costPoints)} points de recette</strong>. Tu choisis ensuite quand activer le bon.</p>}
    {!pending && quote && <p>Points utilisables pour cette campagne · {format.format(quote.balancePoints)}</p>}
    <p className="break-all text-xs text-foreground-muted">Barème {pending?.tariffId ?? quote?.tariffId}</p>
    {pending && <>
      <p>Cette demande conserve sa référence d’origine. La recherche de son reçu est en lecture seule.</p>
      <button type="button" className={button} disabled={busy} onClick={recover}>Retrouver le reçu initial</button>
      {absent && loaded && (!sameTerms || !canBuy) && <button type="button" className={button} disabled={busy}
        onClick={viewCurrentQuote}>Consulter le devis actuel</button>}
    </>}
    {!pending && quote && !canBuy && <p>Tu disposes de trop peu de points de recette pour ce bon.</p>}
    {canBuy && terms && <>
      <label className="flex items-start gap-2">
        <input type="checkbox" checked={accepted} disabled={busy} className="mt-1" onChange={event => setAccepted(event.target.checked)} />
        J’autorise le débit de {format.format(terms.costPoints)} points de recette pour ce bon de {format.format(terms.durationHours)} h.
      </label>
      <button type="button" className={button} disabled={!accepted || busy} onClick={buy}>
        {busy ? 'Vérification de l’achat…' : pending ? 'Reprendre le même achat' : 'Confirmer l’achat du bon'}
      </button>
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}
