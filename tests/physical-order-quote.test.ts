import assert from 'node:assert/strict';
import test from 'node:test';

import { computeCommission, physicalListingQuote, physicalPilotQuote } from '../src/lib/commission';
import { PHYSICAL_PILOT_POLICY, PREVIOUS_PHYSICAL_PILOT_POLICY } from '../src/lib/physical-fee-policy';
import { expectedSaleQuote } from '../src/lib/sale-quote-input';
import { canPublishCurrentPhysicalSalePilot, canUsePhysicalSalePilot } from '../src/lib/physical-sale-pilot';
import { agreedSalePrice, physicalOrderQuote, sameSaleQuote } from '../src/lib/physical-order-quote';

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

test('tarif français attaché à chaque annonce, frais acheteur arrondis au centime, net vendeur entier', () => {
  const previous = physicalListingQuote(2500, PREVIOUS_PHYSICAL_PILOT_POLICY);
  const current = physicalPilotQuote(2500);
  assert.deepEqual(previous, {
    policy: 'fr_p2p_test_v2', itemCents: 2500, buyerFeeCents: 108,
    grossCents: 2608, commissionPct: 0, commissionCents: 0, netCents: 2500,
  });
  assert.deepEqual(current, {
    policy: 'fr_p2p_test_v3', itemCents: 2500, buyerFeeCents: 110,
    grossCents: 2610, commissionPct: 0, commissionCents: 0, netCents: 2500,
  });
  assert.equal(physicalListingQuote(2499, PREVIOUS_PHYSICAL_PILOT_POLICY)?.buyerFeeCents, 107);
  assert.equal(physicalPilotQuote(2249)?.buyerFeeCents, 102);
  assert.equal(physicalPilotQuote(2250)?.buyerFeeCents, 103);
  for (const policy of [PREVIOUS_PHYSICAL_PILOT_POLICY, PHYSICAL_PILOT_POLICY]) {
    assert.equal(physicalListingQuote(14, policy), null);
    assert.equal(physicalListingQuote(15, policy)?.grossCents, 50);
    assert.equal(physicalListingQuote(2_147_483_647, policy), null);
    assert.equal(physicalListingQuote(99.5, policy), null);
  }
  assert.deepEqual(physicalListingQuote(2500, 'legacy'), computeCommission(2500));
  assert.equal(physicalListingQuote(2500, 'unknown'), null);
  assert.ok(expectedSaleQuote.safeParse(previous).success && expectedSaleQuote.safeParse(current).success);
});

test('deux barèmes différents au même total nécessitent une nouvelle confirmation', () => {
  const previous = physicalListingQuote(101, PREVIOUS_PHYSICAL_PILOT_POLICY)!;
  const current = physicalPilotQuote(101)!;
  assert.equal(current.grossCents, previous.grossCents);
  assert.equal(sameSaleQuote(previous, current), false);
  assert.equal(sameSaleQuote(current, { ...current, buyerFeeCents: 0 }), false);
  assert.equal(sameSaleQuote(current, { ...current, policy: undefined }), false);
});

test('négociation à 12,50 € sur une ancienne et une nouvelle annonce en vente à 25 €', async () => {
  const db = { from(table: string) {
    let actor: unknown;
    const query = {
      eq(column: string, value: unknown) { if (column === 'sender_id') actor = value; return query; },
      select() { return query; }, not() { return query; }, order() { return query; }, limit() { return query; },
      async maybeSingle() {
        return table === 'conversations' ? { data: { id: 'thread' } } :
          { data: { offer_cents: 1250, created_at: actor === 'buyer' ? first : later } };
      },
    };
    return query;
  } } as unknown as Parameters<typeof physicalOrderQuote>[0];
  for (const [policy, fee] of [[PREVIOUS_PHYSICAL_PILOT_POLICY, 71], [PHYSICAL_PILOT_POLICY, 73]] as const) {
    const confirmed = await physicalOrderQuote(db, { id: 'listing', user_id: 'seller', price_cents: 2500, fee_policy: policy }, 'buyer');
    assert.deepEqual(confirmed, { policy, itemCents: 1250, buyerFeeCents: fee, netCents: 1250,
      commissionPct: 0, commissionCents: 0, grossCents: 1250 + fee });
  }
});

test('seule une base acceptant le barème actuel peut offrir une nouvelle publication pilote', async t => {
  const env = {
    STRIPE_SECRET_KEY: 'sk_test_simulated', VERCEL_ENV: 'preview',
    TYAGA_PHYSICAL_FEE_TEST: '1', TYAGA_PHYSICAL_FEE_TEST_ORIGIN: 'https://test.example.invalid',
  };
  for (const [key, value] of Object.entries(env)) {
    const old = process.env[key];
    process.env[key] = value;
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
  for (const [result, expected] of [
    [{ data: null, error: { code: 'PGRST202' } }, false],
    [{ data: null, error: null }, false],
    [{ data: PREVIOUS_PHYSICAL_PILOT_POLICY, error: null }, false],
    [{ data: PHYSICAL_PILOT_POLICY, error: null }, true],
  ] as const) {
    const db = { rpc: async (name: string) => {
      if (name === 'can_publish_test_fee') return { data: true, error: null };
      assert.equal(name, 'current_test_fee_policy');
      return result;
    } } as unknown as Parameters<typeof canUsePhysicalSalePilot>[0];
    assert.equal(await canPublishCurrentPhysicalSalePilot(db), expected);
    assert.equal(await canUsePhysicalSalePilot(db), true);
  }
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
