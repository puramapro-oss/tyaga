import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Informations légales — TYAGA',
  description: 'Documents légaux de TYAGA : CGU, CGV, mentions, confidentialité.',
};

const DOCS = [
  {
    href: '/legal/cgu',
    title: 'Conditions générales d’utilisation',
    desc: 'Règles de la plateforme : compte, annonces, commission, points, parrainage.',
  },
  {
    href: '/legal/cgv',
    title: 'Conditions générales de vente',
    desc: 'Côté acheteur : paiement, séquestre, livraison, litiges, rétractation.',
  },
  {
    href: '/legal/politique-confidentialite',
    title: 'Politique de confidentialité',
    desc: 'Données collectées, IA et photos, durées, droits RGPD, cookies.',
  },
  {
    href: '/legal/mentions-legales',
    title: 'Mentions légales',
    desc: 'Éditeur, hébergeur, propriété intellectuelle.',
  },
];

export default function LegalIndexPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-8 px-5 py-10 md:py-14">
      <header className="flex flex-col gap-3">
        <Link href="/" className="link-nav w-fit text-sm">
          ← Retour à TYAGA
        </Link>
        <h1 className="font-display text-3xl tracking-tight">
          Informations légales
        </h1>
        <p className="text-sm leading-relaxed text-foreground-secondary">
          Les documents qui encadrent l’utilisation de TYAGA.
        </p>
      </header>
      <div className="flex flex-col gap-3">
        {DOCS.map((d) => (
          <Link
            key={d.href}
            href={d.href}
            className="glass flex flex-col gap-1.5 p-5 transition-colors hover:border-primary/30"
          >
            <span className="font-display text-lg">{d.title}</span>
            <span className="text-sm leading-relaxed text-foreground-muted">
              {d.desc}
            </span>
          </Link>
        ))}
      </div>
    </main>
  );
}
