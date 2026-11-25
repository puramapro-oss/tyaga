import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import PromotionControl from '@/components/marketplace/PromotionControl';
import { authContinuationHref } from '@/lib/auth-redirect';
import { createServerSupabaseClient } from '@/lib/supabase-server';

export const metadata = { title: 'Utiliser mon bon de commande — TYAGA' };

const PAGE_SIZE = 20;
const statuses = {
  available: 'Disponible', active: 'En cours de diffusion', used: 'Utilisé',
  expired: 'Expiré', revoked: 'Retiré',
} as const;
interface SaleBenefit {
  grant_id: string;
  duration_hours: number;
  redeem_until: string;
  benefit_status: keyof typeof statuses;
  active_listing: string | null;
}

export default async function OrderPromotionPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) notFound();
  const path = `/commandes/${id}/avantage`;
  const db = await createServerSupabaseClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect(authContinuationHref('/login', path));

  const { data, error } = await db.rpc('my_order_promotion', { p_order: id }).maybeSingle();
  if (error) return <p role="alert">Le suivi du bon est momentanément indisponible. <Link href="/commandes">Mes commandes</Link></p>;
  if (!data) notFound();
  const benefit = data as SaleBenefit;
  const available = benefit.benefit_status === 'available';
  const page = Number((await searchParams).page ?? '1');
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(page * PAGE_SIZE)) notFound();
  const offset = (page - 1) * PAGE_SIZE;
  const listings = available ? await db.from('annonces').select('id, title')
    .eq('user_id', user.id).eq('status', 'published')
    .order('published_at', { ascending: false }).order('id')
    .range(offset, offset + PAGE_SIZE) : { data: [], error: null };
  const rows = listings.data ?? [];
  const until = new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Paris',
  }).format(new Date(benefit.redeem_until));
  return (
    <section className="glass mx-auto grid max-w-2xl gap-4 p-6">
      <Link href="/commandes" className="link-nav">Mes commandes</Link>
      <h1 className="font-display text-2xl">Ma mise en avant de {benefit.duration_hours} h</h1>
      <p>Bon nominatif de la campagne de vente TYAGA · {statuses[benefit.benefit_status]}</p>
      {benefit.active_listing && <Link className="link-nav" href={`/marketplace/${benefit.active_listing}`}>Voir mon annonce sponsorisée</Link>}
      {available && <>
        <p>Choisis l’annonce à diffuser dans les résultats « Sponsorisé ». Le bon couvre la diffusion. Le prix de vente et le net vendeur restent ceux de la commande.</p>
        <p>À activer avant le <time dateTime={benefit.redeem_until}>{until}</time> (Paris).</p>
        {listings.error ? <p role="alert">Tes annonces sont momentanément indisponibles.</p> :
          rows.length > 0 ? <ul className="grid gap-3">
            {rows.slice(0, PAGE_SIZE).map(listing => (
              <li key={listing.id} className="grid gap-2 rounded-md border border-border p-3">
                <Link href={`/marketplace/${listing.id}`} className="link-nav">{listing.title}</Link>
                <PromotionControl listingId={listing.id} grantId={benefit.grant_id} active={false} buttonLabel={`Utiliser ce bon pour « ${listing.title} »`} />
              </li>
            ))}
          </ul> : <p>{page === 1 ? 'Tu pourras utiliser ce bon dès que tu auras publié une annonce.' : 'Aucune annonce sur cette page.'} <Link className="link-nav" href="/marketplace">Ouvrir la marketplace</Link></p>}
        {(page > 1 || rows.length > PAGE_SIZE) && <nav aria-label="Pages de mes annonces" className="flex gap-4">
          {page > 1 && <Link className="link-nav" href={`${path}?page=${page - 1}`}>Précédentes</Link>}
          {rows.length > PAGE_SIZE && <Link className="link-nav" href={`${path}?page=${page + 1}`}>Suivantes</Link>}
        </nav>}
      </>}
    </section>
  );
}
