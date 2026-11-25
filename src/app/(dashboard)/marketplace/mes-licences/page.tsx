import Link from 'next/link';
import { redirect } from 'next/navigation';

import DigitalLicensePanel from '@/components/marketplace/DigitalLicensePanel';
import { createServerSupabaseClient } from '@/lib/supabase-server';

export const metadata = { title: 'Mes licences numériques — TYAGA' };
export const dynamic = 'force-dynamic';
type Grant = { annonce_id: string; titre: string; acquis_le: string; expire_le: string | null };

export default async function MyLicensesPage({ searchParams }: { searchParams: Promise<{ ouvrir?: string }> }) {
  const db = await createServerSupabaseClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect('/login');
  const { ouvrir } = await searchParams;
  const { data, error } = await db.rpc('mes_licences');
  const grants = (data ?? []) as Grant[];
  return <main className="mx-auto flex max-w-3xl flex-col gap-4">
    <Link className="underline" href="/marketplace">Retour aux annonces</Link>
    <h1 className="font-display text-3xl">Mes licences numériques</h1>
    {error ? <p role="alert">Tes licences sont momentanément indisponibles.</p> : grants.length === 0
      ? <p>Aucune licence activée.</p>
      : <ul className="flex flex-col gap-3">{grants.map(grant =>
        <li key={grant.annonce_id} className="glass space-y-2 p-4">
          <h2 className="font-display text-xl">{grant.titre}</h2>
          <p>{grant.expire_le ? `Échéance le ${new Date(grant.expire_le).toLocaleString('fr-FR', { timeZone: 'UTC' })} UTC` : 'Accès sans échéance'}</p>
          {grant.annonce_id === ouvrir ? <DigitalLicensePanel annonceId={grant.annonce_id} isOwner={false} priceCents={0} />
            : <Link className="underline" href={`/marketplace/mes-licences?ouvrir=${grant.annonce_id}`}>Consulter cette licence</Link>}
        </li>)}</ul>}
  </main>;
}
