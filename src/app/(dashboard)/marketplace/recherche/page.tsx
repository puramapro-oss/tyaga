import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

import ListingForm from '@/components/marketplace/ListingForm';

export const metadata = { title: 'Rechercher un objet — TYAGA' };

export default function NewPhysicalSearch() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <Link href="/marketplace?kind=physical" className="link-nav w-fit gap-2 text-sm"><ArrowLeft size={16} /> Annonces d’objets</Link>
      <h1 className="font-display text-3xl">Publier une recherche d’objet</h1>
      <ListingForm physicalSearch />
    </div>
  );
}
