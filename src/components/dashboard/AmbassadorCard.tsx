import { Award, Sparkles } from 'lucide-react';

/**
 * EX-K2 — bloc ambassadeur : palier selon le nombre de filleuls rattachés.
 * 0 filleul = à activer (le bloc parrainage voisin donne le lien) ;
 * 1 filleul ou plus = Ambassadeur.
 */
export default function AmbassadorCard({ filleuls }: { filleuls: number }) {
  const actif = filleuls >= 1;
  return (
    <section className="glass flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-xl">
          <Award size={18} />
          Ambassadeur
        </h2>
        {actif ? (
          <span className="rounded-pill bg-primary/20 px-3 py-1 text-xs font-medium text-primary-on-dark">
            Actif
          </span>
        ) : (
          <span className="rounded-pill border border-border px-3 py-1 text-xs font-medium text-foreground-muted">
            À activer
          </span>
        )}
      </div>

      <p className="font-mono text-3xl">{filleuls}</p>
      <p className="text-sm leading-relaxed text-foreground-secondary">
        {actif
          ? `${filleuls} filleul${filleuls > 1 ? 's' : ''} rattaché${filleuls > 1 ? 's' : ''} à ton code. Chaque première vente complétée te rapporte ton N1 en points Vault.`
          : 'Partage ton code de parrainage : dès ton premier filleul, tu deviens Ambassadeur TYAGA.'}
      </p>

      <p className="flex items-start gap-2 border-t border-border pt-3 text-xs leading-relaxed text-foreground-muted">
        <Sparkles size={13} className="mt-0.5 shrink-0" aria-hidden />
        Statut d’Ambassadeur conservé sans palier ni engagement, tant que le
        programme de parrainage TYAGA reste actif.
      </p>
    </section>
  );
}
