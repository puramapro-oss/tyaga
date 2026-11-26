import assert from 'node:assert/strict';
import test from 'node:test';

const { getListingPromotionQuote, promotionActivationMessage } = (await import(
  new URL('../src/lib/listing-promotion.ts', import.meta.url).pathname
)) as typeof import('../src/lib/listing-promotion');

// Barème fictif réservé à la vérification des unités et des bornes de validité.
const fixture = {
  revision: 'fixture-2', startsAt: '2026-11-01T12:00:00Z', endsAt: '2026-11-02T12:00:00.001Z',
  durationHours: 48, priceEurCentsTtc: 230, puramaPoints: 91,
};
const start = Date.parse(fixture.startsAt);
const end = Date.parse(fixture.endsAt);

test('deux prix distincts, sans conversion entre euros et points', () => {
  assert.deepEqual(getListingPromotionQuote(JSON.stringify(fixture), start), {
    revision: fixture.revision, endsAt: fixture.endsAt, durationHours: 48, priceEurCentsTtc: 230, puramaPoints: 91,
  });
  for (const field of ['puramaPoints', 'priceEurCentsTtc'] as const) {
    const oneMethod = getListingPromotionQuote(JSON.stringify({ ...fixture, [field]: null }), start);
    assert.ok(oneMethod);
    assert.equal(oneMethod[field], null);
  }
});

test('période de tarification demi-ouverte, heures UTC uniquement', () => {
  const raw = JSON.stringify(fixture);
  assert.equal(getListingPromotionQuote(raw, start - 1), null);
  assert.ok(getListingPromotionQuote(raw, end - 1));
  assert.equal(getListingPromotionQuote(raw, end), null);
  assert.equal(getListingPromotionQuote(raw, NaN), null);
  for (const endsAt of ['2026-11-31T12:00:00Z', '2026-11-02 12:00', fixture.startsAt]) {
    assert.equal(getListingPromotionQuote(JSON.stringify({ ...fixture, endsAt }), start), null);
  }
});

test('aucun prix implicite, montant client ou autre devise', () => {
  for (const raw of [undefined, 'invalid', '[]', '{}', 'null']) {
    assert.equal(getListingPromotionQuote(raw, start), null);
  }
  for (const patch of [
    { priceEurCentsTtc: -1 }, { priceEurCentsTtc: 0 }, { puramaPoints: 0.5 }, { puramaPoints: '5' },
    { priceEurCentsTtc: null, puramaPoints: null }, { priceEurCentsTtc: Number.MAX_SAFE_INTEGER + 1 },
    { durationHours: 8761 }, { priceEurCentsTtc: 2147483648 }, { durationHours: 0 }, { durationHours: 0.5 }, { currency: 'CHF' }, { revision: '' }, { puramaPoints: undefined },
  ]) {
    assert.equal(getListingPromotionQuote(JSON.stringify({ ...fixture, ...patch }), start), null);
  }
});

test('un reçu rejoué affiche son échéance d’origine même après la fin de diffusion', () => {
  const receipt = '2020-11-25T12:34:00.123456+00:00';
  const label = promotionActivationMessage(receipt);
  assert.match(label, /25 novembre 2020/);
  assert.match(label, /13:34/);
  assert.equal(label, promotionActivationMessage('2020-11-25T13:34:00.123+01:00'));
  for (const unreadable of [undefined, null, 'invalid', true]) {
    assert.match(promotionActivationMessage(unreadable), /suivi du bon/);
  }
});
