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
