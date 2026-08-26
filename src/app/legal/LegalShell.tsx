import Link from 'next/link';

/**
 * Coque commune des pages /legal/* — publiques (middleware), serveur, sobres.
 * Mêmes tokens que l’app : pas de prose générique, glass + foreground-muted.
 */
export default function LegalShell({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-8 px-5 py-10 md:py-14">
      <header className="flex flex-col gap-3">
        <Link href="/" className="link-nav w-fit text-sm">
          ← Retour à TYAGA
        </Link>
        <h1 className="font-display text-3xl tracking-tight">{title}</h1>
        <p className="text-sm leading-relaxed text-foreground-secondary">
          {intro}
        </p>
        <p className="text-xs text-foreground-muted">
          Dernière mise à jour : 26 août 2026
        </p>
      </header>
      <div className="flex flex-col gap-8">{children}</div>
      <footer className="mt-4 border-t border-border pt-4 text-xs text-foreground-muted">
        SASU PURAMA · 8 Rue Chapelle, 25560 Frasne · hello@tyaga.purama.dev
      </footer>
    </main>
  );
}

export function LegalSection({
  h,
  children,
}: {
  h: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold text-foreground">{h}</h2>
      <div className="flex flex-col gap-3 text-sm leading-relaxed text-foreground-secondary">
        {children}
      </div>
    </section>
  );
}
