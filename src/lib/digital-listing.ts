import { z } from 'zod';

export const purchaseWantedSchema = z.object({
  requestId: z.string().uuid(),
  title: z.string().trim().min(3).max(70),
  description: z.string().trim().min(20).max(1200),
  priceCents: z.number().int().min(0).max(100_000_000),
  userValidated: z.literal(true),
}).strict();

export const digitalListingSchema = purchaseWantedSchema.extend({
  intent: z.enum(['offer', 'wanted']),
  mode: z.enum(['sale', 'rental']),
  format: z.string().trim().min(2).max(80),
  licenseTerms: z.string().trim().min(20).max(1200),
  licenseDays: z.number().int().min(1).max(3650).nullable(),
  rightsAttested: z.boolean(),
}).strict().superRefine((listing, ctx) => {
  if ((listing.mode === 'rental') !== (listing.licenseDays !== null)) {
    ctx.addIssue({ code: 'custom', path: ['licenseDays'], message: 'Durée incompatible avec cette licence.' });
  }
  if ((listing.intent === 'offer') !== listing.rightsAttested) {
    ctx.addIssue({ code: 'custom', path: ['rightsAttested'], message: 'Vérifie la déclaration des droits.' });
  }
});

/** Normalised publication terms, also compared on retry. */
export function digitalListingFields(listing: z.infer<typeof digitalListingSchema>) {
  return {
    asset_kind: 'digital' as const,
    listing_intent: listing.intent,
    listing_mode: listing.mode,
    title: listing.title,
    description: listing.description,
    price_cents: listing.priceCents,
    digital_format: listing.format,
    digital_license_terms: listing.licenseTerms,
    digital_license_days: listing.licenseDays,
    digital_rights_attested: listing.rightsAttested,
  };
}

export function purchaseWantedFields(listing: z.infer<typeof purchaseWantedSchema>) {
  return {
    asset_kind: 'physical' as const,
    listing_intent: 'wanted' as const,
    listing_mode: 'sale' as const,
    title: listing.title,
    description: listing.description,
    price_cents: listing.priceCents,
  };
}

export function matchesMemberListing(
  existing: Record<string, unknown>,
  fields: ReturnType<typeof digitalListingFields | typeof purchaseWantedFields>,
) {
  return Object.entries(fields).every(([key, value]) => existing[key] === value);
}
