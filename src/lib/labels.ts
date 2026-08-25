/** Libellés FR partagés — 1 source de vérité pour listes et fiches. */

export const CONDITION_LABELS: Record<string, string> = {
  neuf: 'Neuf',
  excellent: 'Excellent',
  tres_bon: 'Très bon état',
  bon: 'Bon état',
  satisfaisant: 'Satisfaisant',
  a_reparer: 'À réparer',
};

export const STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  scanned: { label: 'Scanné', tone: 'bg-secondary/15 text-secondary-on-dark' },
  estimated: { label: 'Estimé', tone: 'bg-primary/15 text-primary-on-dark' },
  listed: { label: 'En vente', tone: 'bg-primary/20 text-primary-on-dark' },
  negotiating: { label: 'Discussion', tone: 'bg-card text-foreground' },
  sold: { label: 'Vendu', tone: 'bg-foreground/10 text-foreground-muted' },
  archived: { label: 'Archivé', tone: 'bg-foreground/10 text-foreground-muted' },
};
