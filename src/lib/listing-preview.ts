export interface ReviewedListing {
  title: string;
  priceCents: number;
  kind: 'physical' | 'digital';
  intent: 'offer' | 'wanted';
  mode: 'sale' | 'rental';
}

export function listingPreviewSummary(listing: ReviewedListing) {
  const type = listing.kind === 'digital' ? 'Création numérique' : 'Objet physique';
  const action = listing.intent === 'wanted' ? 'Recherche' : 'Offre';
  const mode = listing.mode === 'rental' ? 'Location ou licence temporaire' : 'Achat ou vente';
  const price = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(listing.priceCents / 100);
  return [action, type, mode, (listing.intent === 'wanted' ? 'Budget ' : 'Prix ') + price].join(' · ');
}

export const previewTokenPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const htmlEntities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, character => htmlEntities[character]);
}

export function renderListingPreview(listing: ReviewedListing, id: string) {
  const title = escapeHtml(listing.title);
  const summary = escapeHtml(listingPreviewSummary(listing));
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>${title} | TYAGA</title><meta property="og:title" content="${title}"><meta property="og:description" content="${summary}"><meta property="og:type" content="website"><meta property="og:site_name" content="TYAGA · PURAMA"><style>html{color-scheme:light dark}body{font:1.15rem/1.6 system-ui;margin:0}main{max-width:38rem;margin:12vh auto;padding:1.5rem;overflow-wrap:anywhere}h1{font-size:clamp(1.8rem,6vw,3rem);line-height:1.2}a{display:inline-block;padding:.7rem 0}</style></head><body><main><p>TYAGA · PURAMA</p><h1>${title}</h1><p>${summary}</p><a href="/marketplace/${encodeURIComponent(id)}" rel="noreferrer">Ouvrir cette annonce sur TYAGA</a></main></body></html>`;
}
