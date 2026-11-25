import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

import ListingForm from '@/components/marketplace/ListingForm';

export const metadata = { title: 'Annonce numérique — TYAGA' };

export default function NewDigitalListing() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <Link href="/marketplace?kind=digital" className="link-nav w-fit gap-2 text-sm"><ArrowLeft size={16} /> Annonces numériques</Link>
      <h1 className="font-display text-3xl">Publier une annonce numérique</h1>
      <ListingForm />
    </div>
  );
}
