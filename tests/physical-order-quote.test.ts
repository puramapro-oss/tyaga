import assert from 'node:assert/strict';
import test from 'node:test';

import { computeCommission } from '../src/lib/commission';
import { agreedSalePrice, sameSaleQuote } from '../src/lib/physical-order-quote';

const first = '2026-11-25T10:00:00.123000+00:00';
const later = '2026-11-25T10:00:00.123001+00:00';
const offered = { offer_cents: 899, created_at: first };
const accepted = { offer_cents: 899, created_at: later };

test('prix accepté et commission historique sur le prix convenu', () => {
  const cents = agreedSalePrice(1500, offered, accepted);
  assert.equal(cents, 899);
  assert.deepEqual(computeCommission(cents), { grossCents: 899, netCents: 809, commissionCents: 90, commissionPct: 10 });
});

test('absence, nouvel ordre des messages, désaccord et prix invalide conservent le prix affiché', () => {
  assert.equal(agreedSalePrice(1500, offered, null), 1500);
  assert.equal(agreedSalePrice(1500, null, accepted), 1500);
  assert.equal(agreedSalePrice(1500, accepted, offered), 1500);
  assert.equal(agreedSalePrice(1500, offered, { ...accepted, offer_cents: 855 }), 1500);
  assert.equal(agreedSalePrice(500, offered, accepted), 500);
  assert.equal(agreedSalePrice(1500, { ...offered, offer_cents: 0 }, { ...accepted, offer_cents: 0 }), 1500);
});

test('la confirmation porte sur le prix, le taux, les frais et le net', () => {
  const quote = computeCommission(899);
  assert.equal(sameSaleQuote(quote, { ...quote }), true);
  for (const key of ['grossCents', 'netCents', 'commissionPct', 'commissionCents'] as const) {
    assert.equal(sameSaleQuote(quote, { ...quote, [key]: quote[key] + 1 }), false);
  }
});

test('pilote EUR : frais acheteur arrondis au centime, aucun frais vendeur, anciens devis distincts', async () => {
  const { physicalPilotQuote } = await import('../src/lib/commission');
  assert.deepEqual(physicalPilotQuote(2500), {
    policy: 'fr_p2p_test_v2', itemCents: 2500, buyerFeeCents: 108,
    grossCents: 2608, commissionPct: 0, commissionCents: 0, netCents: 2500,
  });
  assert.equal(physicalPilotQuote(2499)?.buyerFeeCents, 107);
  assert.equal(physicalPilotQuote(2501)?.buyerFeeCents, 108);
  assert.equal(physicalPilotQuote(14), null);
  assert.equal(physicalPilotQuote(15)?.grossCents, 50);
  assert.equal(physicalPilotQuote(2_147_483_647), null);
  const pilot = physicalPilotQuote(1000)!;
  assert.equal(sameSaleQuote(pilot, { ...pilot, buyerFeeCents: 0 }), false);
  assert.equal(sameSaleQuote(pilot, { ...pilot, policy: undefined }), false);
});

test('une configuration historique vide conserve le défaut ; zéro explicite reste valable', async () => {
  const { commissionPct } = await import('../src/lib/constants');
  const original = process.env.TYAGA_COMMISSION_PCT;
  try {
    process.env.TYAGA_COMMISSION_PCT = '   ';
    assert.equal(commissionPct(), 10);
    process.env.TYAGA_COMMISSION_PCT = '0';
    assert.equal(commissionPct(), 0);
  } finally {
    if (original === undefined) delete process.env.TYAGA_COMMISSION_PCT;
    else process.env.TYAGA_COMMISSION_PCT = original;
  }
});
