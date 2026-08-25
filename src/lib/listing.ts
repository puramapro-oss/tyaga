/**
 * EX-D4 — filet B : texte d'annonce prêt à copier vers Vinted/Leboncoin.
 * Formaté côté serveur à la publication, stocké une fois (annonces.export_text)
 * pour un copier-coller identique à chaque export.
 */

export function buildExportText(input: {
  title: string;
  description: string;
  tags: string[];
  priceCents: number;
}): string {
  const price = new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
  }).format(input.priceCents / 100);

  const parts = [
    input.title,
    '',
    input.description,
    '',
    `Prix : ${price}`,
  ];
  if (input.tags.length > 0) {
    parts.push(`Tags : ${input.tags.map((t) => `#${t.replace(/\s+/g, '')}`).join(' ')}`);
  }

  return parts.join('\n').trim();
}
