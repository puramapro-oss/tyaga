type MatchListing = {
  id: string;
  title: string;
  tags: string[];
  price_cents: number;
};

const common = new Set([
  'avec pour sous chez dans les des une aux sur par qui que',
  'recherche recherches cherche propose offre offres vends vente location louer achat acheter',
  'objet produit licence numerique numeriques modele format urgent souhaite voudrais besoin taille',
  'electrique electriques neuf neuve neufs bon bonne etat excellent noir blanc blanche grand grande petit petite',
  'sans duree temporaire demande particulier guide fichier pdf epub wav svg',
].join(' ').split(' '));

function keywords(listing: MatchListing): Set<string> {
  const normalized = [listing.title, ...(listing.tags ?? [])].join(' ').toLowerCase()
    .normalize('NFD').replace(/\p{M}/gu, '');
  const tokens = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(tokens.filter(token => (token.length >= 3 || /\d/.test(token)) && /\p{L}/u.test(token) && !common.has(token))
    .map(token => token.length > 4 ? token.replace(/s$/, '') : token));
}

/** Budget, nature, durée et sens sont déjà filtrés en base. Cette étape exige
 * au moins un mot significatif commun et favorise les sujets les plus proches. */
export function closestListings<T extends MatchListing>(source: MatchListing, rows: T[], limit = 3): T[] {
  const terms = keywords(source);
  if (!terms.size) return [];
  return rows.map(row => {
    const other = keywords(row);
    const shared = [...terms].filter(term => other.has(term)).length;
    const score = shared / (terms.size + other.size - shared);
    return { row, score };
  }).filter(candidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score || Math.abs(a.row.price_cents - source.price_cents) - Math.abs(b.row.price_cents - source.price_cents))
    .slice(0, limit).map(candidate => candidate.row);
}
