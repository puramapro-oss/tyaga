/**
 * Tarif TTC de l'emplacement « Sponsorisé » des recherches TYAGA sur le web
 * en France. TYAGA_LISTING_PROMOTION_QUOTE contient un seul objet JSON :
 * revision (identifiant de barème), startsAt / endsAt (ISO UTC),
 * durationHours (entier), priceEurCentsTtc et puramaPoints (entiers ou null).
 * Les deux montants sont tarifés indépendamment. Le devis ne réserve aucune
 * diffusion et n'est jamais une autorisation de débit.
 */
export interface ListingPromotionQuote {
  revision: string;
  endsAt: string;
  durationHours: number;
  priceEurCentsTtc: number | null;
  puramaPoints: number | null;
}

function parseUtc(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) {
    return NaN;
  }
  const time = Date.parse(value);
  const canonical = value.length === 20 ? value.replace('Z', '.000Z') : value;
  return Number.isFinite(time) && new Date(time).toISOString() === canonical ? time : NaN;
}

function isPrice(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647);
}

export function getListingPromotionQuote(raw: string | undefined, now = Date.now()): ListingPromotionQuote | null {
  if (!raw || !Number.isFinite(now)) return null;
  let rate: unknown;
  try {
    rate = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!rate || typeof rate !== 'object' || Array.isArray(rate)) return null;
  const keys = ['revision', 'startsAt', 'endsAt', 'durationHours', 'priceEurCentsTtc', 'puramaPoints'];
  if (Object.keys(rate).some(key => !keys.includes(key))) return null;
  const { revision, startsAt, endsAt, durationHours, priceEurCentsTtc, puramaPoints } = rate as Record<string, unknown>;
  const start = parseUtc(startsAt);
  const end = parseUtc(endsAt);
  if (typeof revision !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(revision)
      || !(start <= now && now < end)
      || typeof endsAt !== 'string'
      || typeof durationHours !== 'number' || !Number.isSafeInteger(durationHours) || durationHours <= 0 || durationHours > 8760
      || !isPrice(priceEurCentsTtc) || !isPrice(puramaPoints)
      || (priceEurCentsTtc === null && puramaPoints === null)) return null;
  return { revision, endsAt, durationHours, priceEurCentsTtc, puramaPoints };
}
