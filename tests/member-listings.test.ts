import assert from 'node:assert/strict';
import test from 'node:test';

import {
  digitalListingFields, digitalListingSchema, matchesMemberListing, purchaseWantedFields, purchaseWantedSchema,
} from '../src/lib/digital-listing';

const request = {
  requestId: '413ea375-f8d0-460f-b241-790159fcb474',
  title: '  Affiche de Frasne  ',
  description: 'Illustration originale du village.',
  priceCents: 1250,
  userValidated: true,
};
const offer = {
  ...request, intent: 'offer', mode: 'sale', licenseDays: null,
  rightsAttested: true, format: 'PNG', licenseTerms: 'Utilisation privée sur un appareil.',
};

for (const intent of ['offer', 'wanted']) {
  for (const mode of ['sale', 'rental']) {
    test(`publier une annonce numérique ${intent}/${mode}`, () => {
      const row = digitalListingFields(digitalListingSchema.parse({
        ...offer, intent, mode, rightsAttested: intent === 'offer', licenseDays: mode === 'rental' ? 12 : null,
      }));
      assert.equal(row.listing_intent, intent);
      assert.equal(row.listing_mode, mode);
      assert.equal(row.title, 'Affiche de Frasne');
    });
  }
}

test('validation de la licence, du prix et du consentement', () => {
  for (const invalid of [
    { rightsAttested: false }, { intent: 'wanted', rightsAttested: true },
    { mode: 'rental', licenseDays: null }, { licenseDays: 7 },
    { mode: 'rental', licenseDays: 0 }, { mode: 'rental', licenseDays: 3651 },
    { mode: 'rental', licenseDays: 1.5 }, { licenseTerms: '   ' },
    { format: ' ' }, { userValidated: false }, { userValidated: null },
    { priceCents: -1 }, { priceCents: 2.5 }, { priceCents: 100000001 },
    { priceCents: '1200' }, { requestId: 'test' }, { item_id: request.requestId },
    { user_id: request.requestId }, { status: 'published' }, { price_cents: 0 },
  ]) assert.equal(digitalListingSchema.safeParse({ ...offer, ...invalid }).success, false);
  assert.equal(digitalListingSchema.safeParse({ ...offer, priceCents: 0 }).success, true);
});

test('la recherche physique ne permet pas de publier une offre ou un fichier', () => {
  assert.equal(purchaseWantedFields(purchaseWantedSchema.parse(request)).listing_intent, 'wanted');
  assert.equal(purchaseWantedSchema.safeParse({ ...request, item_id: request.requestId }).success, false);
  assert.equal(purchaseWantedSchema.safeParse(offer).success, false);
});

test('une reprise ne valide pas des conditions, un budget ou une durée modifiés', () => {
  const fields = digitalListingFields(digitalListingSchema.parse(offer));
  assert.equal(matchesMemberListing({ ...fields, id: 'persisted' }, fields), true);
  for (const changed of [
    { price_cents: 0 }, { listing_intent: 'wanted' }, { digital_license_terms: 'Autre licence' },
    { digital_license_days: 45 }, { asset_kind: 'physical' }, { digital_rights_attested: false },
  ]) assert.equal(matchesMemberListing({ ...fields, ...changed }, fields), false);
  assert.equal(matchesMemberListing(fields, purchaseWantedFields(purchaseWantedSchema.parse(request))), false);
});
