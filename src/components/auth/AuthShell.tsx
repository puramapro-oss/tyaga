/**
 * Coque commune login/signup : carte glass centrée, max-w-md.
 */
export default function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-10">
      <div className="glass w-full max-w-md p-8">
        <h1 className="font-display text-2xl">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-foreground-muted">
          {subtitle}
        </p>
        <div className="mt-6 flex flex-col gap-4">{children}</div>
      </div>
    </main>
  );
}
