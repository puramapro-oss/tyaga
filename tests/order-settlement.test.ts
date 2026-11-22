import test from 'node:test';
import assert from 'node:assert/strict';
import type { SettlementDependencies } from '../src/lib/order-settlement';

const { finalizeCompletedSale } = await import(
  new URL('../src/lib/order-settlement.ts', import.meta.url).pathname
) as typeof import('../src/lib/order-settlement');
const { orderPaymentLabel } = await import(
  new URL('../src/lib/order-payment-label.ts', import.meta.url).pathname
) as typeof import('../src/lib/order-payment-label');

type Gateway = ReturnType<SettlementDependencies['getTransfers']>;
type Receipt = Awaited<ReturnType<Gateway['create']>>;
const orderId = '77777777-7777-4777-8777-777777777777';
const buyerId = '11111111-1111-4111-8111-111111111111';
function frame() {
  return {
    order: { id: orderId, status: 'completed', escrow_status: 'held', stripe_transfer_id: null as string | null },
    settlement: { order_id: orderId, state: 'issuing', amount_cents: 9000, currency: 'eur',
      destination: 'acct_seller', transfer_group: `tyaga_order_${orderId}`,
      idempotency_key: `tyaga:settlement:v1:${orderId}`, stripe_transfer_id: null as string | null },
    issue: false,
  };
}
function receipt(): Receipt {
  return { id: 'tr_existing', amount: 9000, currency: 'eur', destination: 'acct_seller',
    transfer_group: `tyaga_order_${orderId}`, metadata: { app_slug: 'tyaga', order_id: orderId },
    amount_reversed: 0, reversed: false };
}
function fixture(data: Receipt[], options: { hasMore?: boolean; prepared?: ReturnType<typeof frame> } = {}) {
  const calls = { create: 0, list: 0, record: 0 };
  const deps: SettlementDependencies = {
    store: { async rpc(name) {
      if (name === 'prepare_order_settlement') return { data: options.prepared ?? frame(), error: null };
      calls.record++;
      const saved = frame();
      saved.order.escrow_status = 'released'; saved.order.stripe_transfer_id = data[0].id;
      saved.settlement.state = 'transferred'; saved.settlement.stripe_transfer_id = data[0].id;
      return { data: saved, error: null };
    } },
    getTransfers: () => ({
      async create() { calls.create++; return data[0]; },
      async list() { calls.list++; return { data, has_more: options.hasMore ?? false }; },
    }),
  };
  return { calls, run: () => finalizeCompletedSale(orderId, buyerId, deps) };
}

test('an exact single match is recorded without emitting a transfer', async () => {
  const app = fixture([receipt()]);
  assert.equal((await app.run()).settlement.status, 'paid');
  assert.deepEqual(app.calls, { create: 0, list: 1, record: 1 });
});

for (const [name, change] of [
  ['amount', { amount: 9001 }], ['currency', { currency: 'usd' }],
  ['destination', { destination: 'acct_other' }], ['group', { transfer_group: 'unrelated' }],
  ['order', { metadata: { app_slug: 'tyaga', order_id: 'other' } }],
  ['application', { metadata: { app_slug: 'other', order_id: orderId } }],
  ['metadata', { metadata: null }], ['identifier', { id: 'not_a_transfer' }],
  ['reversal amount', { amount_reversed: -1 }],
] as const) test(`reconciliation refuses a mismatched ${name}`, async () => {
  const app = fixture([{ ...receipt(), ...change }]);
  assert.equal((await app.run()).settlement.status, 'verification_required');
  assert.deepEqual(app.calls, { create: 0, list: 1, record: 0 });
});

for (const [name, receipts, more] of [
  ['no result', [], false], ['two matches', [receipt(), { ...receipt(), id: 'tr_second' }], false],
  ['incomplete page', [receipt()], true],
] as const) test(`${name} never authorizes another transfer`, async () => {
  const app = fixture([...receipts], { hasMore: more });
  assert.equal((await app.run()).settlement.status, 'verification_required');
  assert.equal(app.calls.create, 0); assert.equal(app.calls.record, 0);
});

test('expanded Stripe destination is checked by account identifier', async () => {
  const app = fixture([{ ...receipt(), destination: { id: 'acct_seller' } }]);
  assert.equal((await app.run()).settlement.status, 'paid');
});

test('incoherent returned order fails before Stripe', async () => {
  const prepared = frame(); prepared.order.id = buyerId; prepared.issue = true;
  const app = fixture([receipt()], { prepared });
  await assert.rejects(app.run(), /commande incohérente/);
  assert.equal(app.calls.create, 0); assert.equal(app.calls.list, 0);
});

test('a refunded order in an incoherent claimed response cannot emit', async () => {
  const prepared = frame(); prepared.order.escrow_status = 'refunded'; prepared.issue = true;
  const app = fixture([receipt()], { prepared });
  await assert.rejects(app.run(), /paramètres de virement incohérents/);
  assert.equal(app.calls.create, 0);
});

test('a terminal state carrying an emission flag fails closed', async () => {
  const prepared = frame(); prepared.settlement.state = 'transferred'; prepared.issue = true;
  const app = fixture([receipt()], { prepared });
  await assert.rejects(app.run(), /droit de virement incohérent/);
  assert.equal(app.calls.create, 0);
});

test('a terminal state without matching receipts does not advertise a paid seller', async () => {
  const prepared = frame(); prepared.settlement.state = 'transferred';
  const app = fixture([], { prepared });
  assert.equal((await app.run()).settlement.status, 'verification_required');
  assert.equal(app.calls.create, 0);
});

for (const [escrow, transfer, net, label] of [
  ['released', null, 9000, 'Versement vendeur à vérifier'],
  ['released', 'tr_existing', 9000, 'Virement vendeur effectué'],
  ['refunded', 'tr_existing', 9000, 'Remboursée'],
  ['held', null, 9000, 'Fonds sous séquestre'],
  ['held', 'tr_existing', 9000, 'Versement vendeur à vérifier'],
  ['released', null, 0, 'Aucun versement vendeur dû'],
] as const) test(`payment label requires evidence: ${escrow}/${transfer}/${net}`, () => {
  assert.equal(orderPaymentLabel({ escrow_status: escrow, stripe_transfer_id: transfer, net_amount_cents: net }), label);
});
