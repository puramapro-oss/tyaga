import test from 'node:test';
import assert from 'node:assert/strict';
import { database, ids, migration, storeFor, transfersFor } from './settlement-db.mjs';
import { finalizeCompletedSale } from '../src/lib/order-settlement.ts';
import { orderPaymentLabel } from '../src/lib/order-payment-label.ts';

async function app(t, options = {}, faults = {}) {
  const db = await database(options);
  t.after(() => db.close());
  const transfers = transfersFor(faults);
  const store = storeFor(db, faults);
  const finalize = (buyer = ids.buyer) => finalizeCompletedSale(ids.order, buyer, {
    store, getTransfers: transfers.getTransfers,
  });
  const snapshot = async () => ({
    order: (await db.query('SELECT status,escrow_status,stripe_transfer_id FROM tyaga.marketplace_orders')).rows[0],
    sales: (await db.query('SELECT count(*)::integer AS n FROM tyaga.ventes')).rows[0].n,
    wallets: (await db.query('SELECT user_id,balance_points,total_earned_points FROM tyaga.vida_wallet ORDER BY user_id')).rows,
    referral: (await db.query('SELECT commission_paid FROM tyaga.referrals')).rows[0].commission_paid,
    claim: (await db.query('SELECT * FROM tyaga.order_settlements')).rows[0],
  });
  return { db, store, transfers, finalize, snapshot };
}

test('real SQL finalizes sale, wallet and N1 once; completed replay never pays twice', async t => {
  const a = await app(t);
  const result = await a.finalize();
  assert.equal(result.settlement.status, 'paid');
  assert.deepEqual(result.order, { id: ids.order, status: 'completed', escrow_status: 'released', stripe_transfer_id: 'tr_test1' });
  const s = await a.snapshot();
  assert.equal(s.sales, 1);
  assert.deepEqual(s.wallets.map(x => x.balance_points), [90, 5]);
  assert.equal(s.referral, true);
  assert.equal((await a.db.query('SELECT status FROM tyaga.annonces')).rows[0].status, 'unpublished');
  await a.db.exec("UPDATE tyaga.order_settlements SET claimed_at = now() - interval '60 days'");
  await a.finalize();
  assert.equal(a.transfers.calls.creates.length, 1);
  assert.equal(a.transfers.calls.lists.length, 0);
  assert.deepEqual((await a.snapshot()).wallets, s.wallets);
});

test('applied transfer with lost response is recovered read-only, even after 24 hours', async t => {
  const a = await app(t, {}, { responseLost: true });
  assert.equal((await a.finalize()).settlement.status, 'verification_required');
  assert.equal((await a.snapshot()).order.escrow_status, 'held');
  await a.db.exec("UPDATE tyaga.order_settlements SET claimed_at = now() - interval '60 days'");
  assert.equal((await a.finalize()).settlement.status, 'paid');
  assert.equal(a.transfers.calls.creates.length, 1);
  assert.equal(a.transfers.calls.lists.length, 1);
});

for (const fault of ['receiptFails', 'receiptResponseLost']) {
  test(`${fault}: a receipt persistence failure cannot cause a second transfer`, async t => {
    const a = await app(t, {}, { [fault]: true });
    await assert.rejects(a.finalize(), /reçu de virement/);
    assert.equal((await a.finalize()).settlement.status, 'paid');
    assert.equal(a.transfers.calls.creates.length, 1);
    assert.deepEqual((await a.snapshot()).wallets.map(x => x.balance_points), [90, 5]);
  });
}

test('lost committed prepare response consumes the claim and credits the wallet only once', async t => {
  const a = await app(t, {}, { prepareResponseLost: true });
  await assert.rejects(a.finalize(), /finalisation/);
  assert.equal((await a.finalize()).settlement.status, 'verification_required');
  const s = await a.snapshot();
  assert.equal(s.claim.state, 'issuing');
  assert.equal(s.sales, 1);
  assert.deepEqual(s.wallets.map(x => x.balance_points), [90, 5]);
  assert.equal(a.transfers.calls.creates.length, 0);
  assert.equal(a.transfers.calls.lists.length, 1);
});

test('zero matching transfers after an error never permits automatic re-emission', async t => {
  const a = await app(t, {}, { failBeforeApply: true });
  await a.finalize();
  for (let i = 0; i < 3; i++) assert.equal((await a.finalize()).settlement.status, 'verification_required');
  assert.equal(a.transfers.calls.creates.length, 1);
  assert.equal((await a.snapshot()).claim.state, 'issuing');
});

test('interleaved application calls consume a single claim (PGlite serializes SQL)', async t => {
  let release; let entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const a = await app(t, {}, { beforeCreate: async () => { entered(); await gate; } });
  const first = a.finalize();
  await started;
  const second = await a.finalize();
  assert.equal(second.settlement.status, 'verification_required');
  release();
  assert.equal((await first).settlement.status, 'paid');
  assert.equal(a.transfers.calls.creates.length, 1);
  assert.deepEqual((await a.snapshot()).wallets.map(x => x.balance_points), [90, 5]);
});

test('missing connected account defers only the transfer; connection later gets one claim', async t => {
  const a = await app(t, { noAccount: true });
  assert.equal((await a.finalize()).settlement.status, 'awaiting_account');
  assert.equal(a.transfers.calls.creates.length, 0);
  await a.db.query('UPDATE tyaga.profiles SET stripe_connect_account_id = $1 WHERE id = $2', ['acct_new', ids.seller]);
  assert.equal((await a.finalize()).settlement.status, 'paid');
  assert.equal(a.transfers.calls.creates[0].args.destination, 'acct_new');
  assert.deepEqual((await a.snapshot()).wallets.map(x => x.balance_points), [90, 5]);
});

test('destination, amount, group and key remain fixed after a claim', async t => {
  const a = await app(t, {}, { responseLost: true });
  await a.finalize();
  await a.db.query('UPDATE tyaga.profiles SET stripe_connect_account_id = $1 WHERE id = $2', ['acct_changed', ids.seller]);
  assert.equal((await a.finalize()).settlement.status, 'paid');
  assert.deepEqual(a.transfers.calls.creates[0], {
    args: { amount: 9000, currency: 'eur', destination: 'acct_seller',
      transfer_group: `tyaga_order_${ids.order}`, metadata: { app_slug: 'tyaga', order_id: ids.order } },
    options: { idempotencyKey: `tyaga:settlement:v1:${ids.order}` },
  });
  assert.equal(a.transfers.calls.creates.length, 1);
});

for (const [name, options] of [
  ['pending', { status: 'pending', escrow: 'none' }],
  ['paid', { status: 'paid' }],
  ['shipped', { status: 'shipped' }],
  ['refunded', { status: 'cancelled', escrow: 'refunded' }],
  ['no payment evidence', { noPayment: true }],
  ['inconsistent amounts', { net: 9999 }],
]) test(`${name} is refused by the SQL guard before accounting or Stripe`, async t => {
  const a = await app(t, options);
  await assert.rejects(a.finalize(), /finalisation/);
  assert.equal(a.transfers.calls.creates.length, 0);
  const s = await a.snapshot();
  assert.equal(s.sales, 0);
  assert.equal(s.wallets.length, 0);
});

test('another user and the seller cannot claim the buyer reception', async t => {
  const a = await app(t);
  await assert.rejects(a.finalize(ids.stranger));
  await assert.rejects(a.finalize(ids.seller));
  assert.equal(a.transfers.calls.creates.length, 0);
  assert.equal((await a.snapshot()).sales, 0);
});

test('refund arriving during Stripe call keeps its status and retains the late receipt for review', async t => {
  const faults = {};
  const a = await app(t, {}, faults);
  faults.afterApply = () => a.db.exec("UPDATE tyaga.marketplace_orders SET status='cancelled',escrow_status='refunded'");
  const result = await a.finalize();
  assert.equal(result.order.status, 'cancelled');
  assert.equal(result.order.escrow_status, 'refunded');
  assert.equal(result.order.stripe_transfer_id, 'tr_test1');
  assert.equal(result.settlement.status, 'verification_required');
  assert.equal((await a.snapshot()).claim.state, 'refund_review');
  await assert.rejects(a.finalize());
  assert.equal(a.transfers.calls.creates.length, 1);
});

test('a late pre-reversal response cannot overwrite an already recorded reversal', async t => {
  let release; let entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const a = await app(t, {}, { afterApply: async () => { entered(); await gate; } });
  const first = a.finalize();
  await started;
  a.transfers.calls.receipts[0] = {
    ...a.transfers.calls.receipts[0], reversed: true, amount_reversed: 9000,
  };
  assert.equal((await a.finalize()).settlement.status, 'verification_required');
  assert.equal((await a.snapshot()).claim.state, 'refund_review');
  release();
  const late = await first;
  assert.equal(late.settlement.status, 'verification_required');
  assert.equal(late.order.escrow_status, 'held');
  assert.equal((await a.snapshot()).claim.state, 'refund_review');
  assert.equal(a.transfers.calls.creates.length, 1);
});

test('a later reversal reconciliation removes a previously released payment label', async t => {
  let releaseCreate; let enterCreate; let releaseList; let enterList;
  const createGate = new Promise(resolve => { releaseCreate = resolve; });
  const createStarted = new Promise(resolve => { enterCreate = resolve; });
  const listGate = new Promise(resolve => { releaseList = resolve; });
  const listStarted = new Promise(resolve => { enterList = resolve; });
  const a = await app(t, {}, {
    afterApply: async () => { enterCreate(); await createGate; },
    beforeList: async () => { enterList(); await listGate; },
  });
  const first = a.finalize();
  await createStarted;
  const second = a.finalize();
  await listStarted;
  a.transfers.calls.receipts[0] = { ...a.transfers.calls.receipts[0], reversed: true, amount_reversed: 9000 };
  releaseCreate();
  assert.equal((await first).settlement.status, 'paid');
  releaseList();
  const reconciled = await second;
  assert.equal(reconciled.settlement.status, 'verification_required');
  assert.equal(reconciled.order.escrow_status, 'held');
  assert.equal(orderPaymentLabel({ ...reconciled.order, net_amount_cents: 9000 }), 'Versement vendeur à vérifier');
  assert.equal((await a.snapshot()).claim.state, 'refund_review');
  assert.equal(a.transfers.calls.creates.length, 1);
});

for (const sale of [false, true]) test(`legacy completed history (sale=${sale}) is never automatically credited or paid`, async t => {
  const a = await app(t, { status: 'completed', escrow: 'released', sale });
  assert.equal((await a.finalize()).settlement.status, 'verification_required');
  assert.equal(a.transfers.calls.creates.length, 0);
  assert.equal(a.transfers.calls.lists.length, 0);
  const s = await a.snapshot();
  assert.equal(s.sales, sale ? 1 : 0);
  assert.equal(s.wallets.length, 0);
  assert.equal(s.claim.state, 'legacy_review');
});

test('historical receipt prevents any new transfer and leaves accounting untouched', async t => {
  const a = await app(t, { status: 'completed', escrow: 'released', receipt: 'tr_original' });
  assert.equal((await a.finalize()).settlement.status, 'paid');
  assert.equal(a.transfers.calls.creates.length, 0);
  assert.equal((await a.snapshot()).wallets.length, 0);
});

test('reapplying the migration cannot reset an already consumed claim', async t => {
  const a = await app(t, {}, { failBeforeApply: true });
  await a.finalize();
  await a.db.exec(migration);
  assert.equal((await a.finalize()).settlement.status, 'verification_required');
  assert.equal(a.transfers.calls.creates.length, 1);
});

test('referrer credit failure rolls back sale, seller credit, referral flag, listing and claim', async t => {
  const a = await app(t);
  await a.db.exec(`CREATE FUNCTION tyaga.test_reject_credit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.user_id = '${ids.referrer}' THEN RAISE EXCEPTION 'test credit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER test_credit BEFORE INSERT ON tyaga.vida_wallet FOR EACH ROW EXECUTE FUNCTION tyaga.test_reject_credit();`);
  await assert.rejects(a.finalize());
  const s = await a.snapshot();
  assert.equal(s.sales, 0); assert.equal(s.wallets.length, 0); assert.equal(s.referral, false);
  assert.equal(s.order.status, 'delivered'); assert.equal(s.claim, undefined);
  assert.equal((await a.db.query('SELECT status FROM tyaga.annonces')).rows[0].status, 'published');
  assert.equal(a.transfers.calls.creates.length, 0);
  await a.db.exec('DROP TRIGGER test_credit ON tyaga.vida_wallet');
  assert.equal((await a.finalize()).settlement.status, 'paid');
});

test('SQL grants and runtime role guard both refuse non-service callers', async t => {
  const a = await app(t);
  for (const role of ['anon', 'authenticated']) {
    const check = await a.db.query(`SELECT has_function_privilege($1,
      'tyaga.prepare_order_settlement(uuid,uuid)', 'EXECUTE') AS allowed`, [role]);
    assert.equal(check.rows[0].allowed, false);
    await assert.rejects(a.db.transaction(async tx => {
      await tx.exec(`SET LOCAL ROLE ${role}`);
      await tx.query('SELECT * FROM tyaga.order_settlements');
    }));
  }
  await a.db.exec('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tyaga TO authenticated');
  await assert.rejects(a.db.transaction(async tx => {
    await tx.exec('SET LOCAL ROLE authenticated');
    await tx.query('SELECT tyaga.prepare_order_settlement($1,$2)', [ids.order,ids.buyer]);
  }), /service role required/);
});

test('missing migration fails closed without any Stripe call', async t => {
  const a = await app(t, { migrate: false });
  await assert.rejects(a.finalize());
  assert.equal(a.transfers.calls.creates.length, 0);
  assert.equal((await a.db.query('SELECT count(*)::integer AS n FROM tyaga.ventes')).rows[0].n, 0);
});

test('receipt RPC rejects mismatched order, group, amount, currency and destination', async t => {
  const a = await app(t, {}, { responseLost: true });
  await a.finalize();
  const transfer = { id: 'tr_test1', amount: 9000, currency: 'eur', destination: 'acct_seller',
    transfer_group: `tyaga_order_${ids.order}`, order_id: ids.order, app_slug: 'tyaga',
    reversed: false, amount_reversed: 0 };
  for (const mismatch of [
    { amount: 8000 }, { currency: 'usd' }, { destination: 'acct_other' },
    { transfer_group: 'other' }, { order_id: ids.stranger }, { app_slug: 'other' },
  ]) {
    const result = await a.store.rpc('record_order_transfer', { p_order: ids.order, p_transfer: { ...transfer, ...mismatch } });
    assert.equal(result.error?.code, '23514');
  }
  assert.equal((await a.snapshot()).claim.state, 'issuing');
  assert.equal((await a.finalize()).settlement.status, 'paid');
  const conflict = await a.store.rpc('record_order_transfer', { p_order: ids.order, p_transfer: { ...transfer, id: 'tr_other' } });
  assert.equal(conflict.error?.code, '23514');
  assert.equal((await a.snapshot()).order.stripe_transfer_id, 'tr_test1');
});

test('N1 rounding and seller floor are unchanged at a half-point boundary', async t => {
  const a = await app(t, { commission: 100, net: 9900 });
  await a.finalize();
  assert.deepEqual((await a.snapshot()).wallets.map(x => x.balance_points), [99, 1]);
});

test('zero net records the sale without a zero-amount Stripe transfer', async t => {
  const a = await app(t, { commission: 10000, net: 0 });
  assert.equal((await a.finalize()).settlement.status, 'not_required');
  assert.equal(a.transfers.calls.creates.length, 0);
  assert.equal((await a.snapshot()).sales, 1);
});
