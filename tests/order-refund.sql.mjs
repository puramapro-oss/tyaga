import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { database, ids, storeFor, transfersFor } from './settlement-db.mjs';
import { finalizeCompletedSale } from '../src/lib/order-settlement.ts';
import { refundCompletedSale } from '../src/lib/order-refund.ts';
import { orderPaymentLabel } from '../src/lib/order-payment-label.ts';

const charge = { id: 'ch_test', payment_intent: 'pi_test', amount: 10000,
  amount_refunded: 10000, currency: 'eur', refunded: true, metadata: { app_slug: 'tyaga' } };
const require = createRequire(import.meta.url);
const ts = require('typescript');
const { NextResponse } = require('next/server');
const source = ts.transpileModule(await readFile(new URL('../src/app/api/internal/stripe-fulfillment/route.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;

async function app(t, options = {}, faults = {}) {
  const db = await database(options.legacy ?? {});
  t.after(() => db.close());
  const store = storeFor(db, faults);
  const gateway = transfersFor(faults);
  const reversals = [];
  const getTransfers = () => ({
    ...gateway.getTransfers(),
    async retrieve(id) {
      const current = gateway.calls.receipts.find(r => r.id === id);
      if (!current) throw new Error('unknown transfer');
      const snapshot = structuredClone(current);
      if (faults.beforeRetrieve) await faults.beforeRetrieve(snapshot);
      return snapshot;
    },
    async createReversal(id, args, opts) {
      reversals.push({ id, args, opts });
      if (faults.beforeReversal) await faults.beforeReversal();
      if (faults.reversalFails) throw new Error('reversal rejected');
      const current = gateway.calls.receipts.find(r => r.id === id);
      assert.ok(current); assert.equal(args.amount, current.amount);
      assert.equal(current.amount_reversed, 0, 'fixture refuses excessive reversal like Stripe');
      gateway.calls.receipts[gateway.calls.receipts.indexOf(current)] = {
        ...current, reversed: true, amount_reversed: current.amount,
      };
      if (faults.reversalResponseLost) { faults.reversalResponseLost = false; throw new Error('reversal applied, response lost'); }
      return { id: 'trr_test1', amount: args.amount, currency: 'eur', transfer: id, metadata: args.metadata };
    },
  });
  const settle = () => finalizeCompletedSale(ids.order, ids.buyer, { store, getTransfers });
  if (options.legacy) {
    await db.query(`INSERT INTO tyaga.vida_wallet (user_id,balance_points,total_earned_points) VALUES ($1,90,90)`, [ids.seller]);
    if (options.legacy.receipt) gateway.calls.receipts.push({
      id: options.legacy.receipt, amount: 9000, currency: 'eur', destination: 'acct_historical',
      transfer_group: null, metadata: { app_slug: 'tyaga', order_id: ids.order }, reversed: false, amount_reversed: 0,
    });
  } else if (options.settle !== false) await settle();
  const snapshot = async () => ({
    order: (await db.query('SELECT status,escrow_status,stripe_transfer_id,net_amount_cents FROM tyaga.marketplace_orders')).rows[0],
    sales: (await db.query('SELECT count(*)::integer AS n FROM tyaga.ventes')).rows[0].n,
    wallets: (await db.query('SELECT user_id,balance_points,total_earned_points FROM tyaga.vida_wallet ORDER BY user_id')).rows,
    claim: (await db.query('SELECT * FROM tyaga.order_settlements')).rows[0],
  });
  const processed = new Set(options.processed ? ['evt_test'] : []);
  const orphanRefunds = [];
  const webhookStore = { ...store, from(table) {
    if (table === 'marketplace_orders' || table === 'order_settlements') {
      let update; const filters = [];
      const query = {
        select() { return query; }, update(value) { update = value; return query; },
        eq(key, value) { assert.ok(['id','order_id','status'].includes(key)); filters.push([key,value]); return query; },
        async maybeSingle() { const result = await execute(); return { ...result, data: result.data?.[0] ?? null }; },
        then(resolve, reject) { return execute().then(resolve, reject); },
      };
      async function execute() {
        if (!update && table === 'marketplace_orders' && faults.readOrderFails) {
          faults.readOrderFails = false; return { data: null, error: { code: 'injected_read_failure' } };
        }
        try {
          const values = []; let sets = '';
          if (update) sets = Object.entries(update).map(([key,value]) => {
            assert.ok(['status','escrow_status','stripe_payment_intent_id','updated_at'].includes(key));
            values.push(value); return `${key}=$${values.length}`;
          }).join(',');
          const where = filters.map(([key,value]) => { values.push(value); return `${key}=$${values.length}`; }).join(' AND ');
          const sql = update ? `UPDATE tyaga.${table} SET ${sets} WHERE ${where} RETURNING *`
            : `SELECT * FROM tyaga.${table} WHERE ${where}`;
          return { data: (await db.query(sql, values)).rows, error: null };
        } catch (error) { return { data: null, error: { code: error.code } }; }
      }
      return query;
    }
    assert.equal(table, 'stripe_events_processed'); let id;
    return { select() { return this; }, eq(_key, value) { id = value; return this; },
      async maybeSingle() { return { data: processed.has(id) ? { event_id: id } : null, error: null }; },
      async insert(value) {
        if (processed.has(value.event_id)) return { error: { code: '23505' } };
        processed.add(value.event_id); return { error: null };
      },
    };
  } };
  const bindings = {
    'next/server': { NextResponse }, '@/lib/order-refund': { refundCompletedSale },
    '@/lib/service': { createServiceClient: () => webhookStore },
    '@/lib/stripe': { getStripe: () => ({ transfers: getTransfers(), refunds: {
      async create(args) { orphanRefunds.push(args); return { id: 're_orphan', status: 'succeeded' }; },
    }, webhooks: {
      constructEvent(payload, signature) { assert.equal(signature, 'test-signature'); return JSON.parse(payload); },
    } }) },
  };
  const context = vm.createContext({ Date, process: { env: {
    INTERNAL_WEBHOOK_SECRET: 'isolated-test', STRIPE_WEBHOOK_SECRET: 'isolated-test',
  } } });
  const module = new vm.SourceTextModule(source, { context });
  await module.link(name => {
    const exports = bindings[name]; assert.ok(exports, name);
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  return { db, store, gateway, reversals, snapshot, settle, processed, orphanRefunds,
    refund: (data = charge) => refundCompletedSale(data, { store, getTransfers }),
    async webhook(data = charge, eventId = 'evt_test', type = 'charge.refunded') {
      const response = await module.namespace.POST(new Request('https://tyaga.example.test/api/internal/stripe-fulfillment', {
        method: 'POST', headers: { 'x-internal-secret': 'isolated-test', 'x-stripe-signature': 'test-signature' },
        body: JSON.stringify({ id: eventId, type, data: { object: data } }),
      }));
      return { status: response.status, body: await response.json() };
    },
  };
}

test('full refund is atomic, replayable and reverses exactly once without changing N1 or earned totals', async t => {
  const a = await app(t);
  await a.db.query('UPDATE tyaga.vida_wallet SET balance_points=190,total_earned_points=190 WHERE user_id=$1', [ids.seller]);
  assert.equal((await a.webhook()).status, 200);
  assert.equal((await a.webhook()).status, 200);
  const s = await a.snapshot();
  assert.equal(s.sales, 0); assert.equal(s.order.status, 'cancelled'); assert.equal(s.order.escrow_status, 'refunded');
  assert.deepEqual(s.wallets.map(w => [w.balance_points,w.total_earned_points]), [[100,190],[5,5]]);
  assert.equal(s.claim.refund_state, 'complete'); assert.equal(a.reversals.length, 1);
});

test('original stranded cancelled/refunded order is compensated on replay even with old event marker', async t => {
  const a = await app(t, { processed: true, legacy: {
    status: 'cancelled', escrow: 'refunded', sale: true, receipt: 'tr_original',
  } });
  assert.equal((await a.webhook()).status, 200);
  const s = await a.snapshot();
  assert.equal(s.sales, 0); assert.equal(s.wallets[0].balance_points, 0); assert.equal(a.reversals.length, 1);
  assert.equal((await a.webhook()).status, 200); assert.equal(a.reversals.length, 1);
});

test('wallet failure rolls back all refund accounting; already cancelled history still retries', async t => {
  const a = await app(t, { legacy: { status: 'cancelled', escrow: 'refunded', sale: true, receipt: 'tr_original' } });
  await a.db.exec(`CREATE FUNCTION tyaga.reject_refund_test() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'injected wallet failure'; END $$;
    CREATE TRIGGER test_refund BEFORE UPDATE ON tyaga.vida_wallet FOR EACH ROW EXECUTE FUNCTION tyaga.reject_refund_test();`);
  assert.equal((await a.webhook()).status, 500);
  assert.equal(a.processed.has('evt_test'), false);
  assert.equal((await a.snapshot()).sales, 1); assert.equal((await a.snapshot()).wallets[0].balance_points, 90);
  await a.db.exec('DROP TRIGGER test_refund ON tyaga.vida_wallet');
  assert.equal((await a.webhook()).status, 200);
  assert.equal((await a.snapshot()).sales, 0); assert.equal((await a.snapshot()).wallets[0].balance_points, 0);
});

for (const rpc of ['prepare_order_refund', 'record_order_reversal']) {
  test(`committed ${rpc} response lost is recovered without second debit or reversal`, async t => {
    const faults = {}; const a = await app(t, {}, faults); faults.loseAfterRpc = rpc;
    assert.equal((await a.webhook()).status, 500); assert.equal(a.processed.has('evt_test'), false);
    assert.equal((await a.webhook()).status, 200);
    assert.equal(a.reversals.length, 1); assert.equal((await a.snapshot()).wallets[0].balance_points, 0);
  });
}

test('applied reversal with lost response is proved by retrieve without re-emission after 60 days', async t => {
  const a = await app(t, {}, { reversalResponseLost: true });
  assert.equal((await a.webhook()).status, 500);
  await a.db.exec("UPDATE tyaga.order_settlements SET reversal_claimed_at = now() - interval '60 days'");
  assert.equal((await a.webhook()).status, 200);
  assert.equal(a.reversals.length, 1); assert.equal((await a.snapshot()).claim.refund_state, 'complete');
});

test('failed persistence of reversal receipt is not acknowledged and retries by reading proof', async t => {
  const faults = {}; const a = await app(t, {}, faults); faults.failBeforeRpc = 'record_order_reversal';
  assert.equal((await a.webhook()).status, 500); assert.equal(a.processed.has('evt_test'), false);
  assert.equal((await a.webhook()).status, 200); assert.equal(a.reversals.length, 1);
});

for (const fault of ['reversalFails', 'claimResponseLost']) {
  test(`${fault} leaves a durable unresolved claim, never a second ambiguous emission`, async t => {
    const faults = {}; const a = await app(t, {}, faults);
    if (fault === 'reversalFails') faults.reversalFails = true;
    else faults.loseAfterRpc = 'claim_order_reversal';
    assert.equal((await a.webhook()).status, 500);
    assert.equal((await a.webhook()).status, 500);
    assert.equal(a.reversals.length, fault === 'reversalFails' ? 1 : 0);
    assert.equal(a.processed.has('evt_test'), false);
    assert.equal((await a.snapshot()).claim.refund_state, 'reversing');
  });
}

test('partial refund keeps a review state and does not invent a full cancellation or prorata', async t => {
  const a = await app(t);
  const partial = { ...charge, amount_refunded: 2000, refunded: false };
  assert.equal((await a.webhook(partial, 'evt_partial')).status, 500);
  let s = await a.snapshot();
  assert.equal(s.sales, 1); assert.equal(s.wallets[0].balance_points, 90);
  assert.equal(s.order.status, 'completed'); assert.equal(s.order.escrow_status, 'held');
  assert.equal(orderPaymentLabel(s.order), 'Versement vendeur à vérifier');
  assert.equal(s.claim.refund_state, 'partial_review'); assert.equal(a.reversals.length, 0);
  assert.equal((await a.webhook()).status, 200);
  assert.equal((await a.webhook(partial, 'evt_partial')).status, 200);
  s = await a.snapshot();
  assert.equal(s.claim.refunded_amount_cents, 10000); assert.equal(s.claim.refund_state, 'complete');
  assert.equal(s.order.escrow_status, 'refunded'); assert.equal(a.reversals.length, 1);
});

test('partial transfer reversal never causes an automatic complementary reversal', async t => {
  const a = await app(t);
  a.gateway.calls.receipts[0].amount_reversed = 4500;
  assert.equal((await a.webhook()).status, 500);
  assert.equal(a.reversals.length, 0); assert.equal((await a.snapshot()).claim.refund_state, 'reversal_review');
  a.gateway.calls.receipts[0].amount_reversed = 9000; a.gateway.calls.receipts[0].reversed = true;
  assert.equal((await a.webhook()).status, 200); assert.equal(a.reversals.length, 0);
});

test('refund before any transfer claim needs no Stripe reversal and blocks later delivery finalization', async t => {
  const a = await app(t, { settle: false });
  assert.equal((await a.webhook()).status, 200);
  assert.equal((await a.snapshot()).claim.refund_state, 'complete');
  await assert.rejects(a.settle());
  assert.equal(a.gateway.calls.creates.length, 0); assert.equal(a.reversals.length, 0);
});

test('transfer applied but receipt lost is reconciled and reversed on refund', async t => {
  const a = await app(t, {}, { responseLost: true });
  assert.equal((await a.webhook()).status, 200);
  assert.equal(a.gateway.calls.creates.length, 1); assert.equal(a.reversals.length, 1);
  assert.equal((await a.snapshot()).claim.refund_state, 'complete');
});

test('transfer still in flight at refund is not acknowledged; late receipt is compensated on retry', async t => {
  let release; let entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const a = await app(t, { settle: false }, { beforeCreate: async () => { entered(); await gate; } });
  const pending = a.settle(); await started;
  assert.equal((await a.webhook()).status, 500); assert.equal(a.processed.has('evt_test'), false);
  release();
  assert.equal((await pending).settlement.status, 'verification_required');
  assert.equal((await a.webhook()).status, 200);
  const s = await a.snapshot();
  assert.equal(s.order.status, 'cancelled'); assert.equal(s.order.escrow_status, 'refunded');
  assert.equal(s.sales, 0); assert.equal(s.wallets[0].balance_points, 0); assert.equal(a.reversals.length, 1);
});

test('refund can precede the stale successful transfer response without reviving payment status', async t => {
  let release; let entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const a = await app(t, { settle: false }, { afterApply: async () => { entered(); await gate; } });
  const pending = a.settle(); await started;
  assert.equal((await a.webhook()).status, 200); release();
  assert.equal((await pending).settlement.status, 'verification_required');
  const s = await a.snapshot();
  assert.equal(s.order.escrow_status, 'refunded'); assert.equal(s.claim.refund_state, 'complete');
  assert.equal(a.reversals.length, 1);
});

test('interleaved refund handlers reserve one reversal and preserve one wallet debit', async t => {
  let release; let entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const a = await app(t, {}, { beforeReversal: async () => { entered(); await gate; } });
  await a.db.query('UPDATE tyaga.vida_wallet SET balance_points=190,total_earned_points=190 WHERE user_id=$1', [ids.seller]);
  const first = a.webhook(); await started;
  assert.equal((await a.webhook(charge, 'evt_second')).status, 500);
  release(); assert.equal((await first).status, 200);
  assert.equal((await a.webhook(charge, 'evt_second')).status, 200);
  assert.equal(a.reversals.length, 1); assert.equal((await a.snapshot()).wallets[0].balance_points, 100);
});

test('a stale partial reversal observation cannot regress a full persisted compensation', async t => {
  let release; let entered; let blocked = false;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const a = await app(t, {}, { beforeRetrieve: async () => {
    if (!blocked) { blocked = true; entered(); await gate; }
  } });
  a.gateway.calls.receipts[0].amount_reversed = 4500;
  const first = a.webhook(); await started;
  a.gateway.calls.receipts[0].amount_reversed = 9000; a.gateway.calls.receipts[0].reversed = true;
  assert.equal((await a.webhook(charge, 'evt_newer')).status, 200);
  release(); assert.equal((await first).status, 200);
  assert.equal((await a.snapshot()).claim.refund_state, 'complete'); assert.equal(a.reversals.length, 0);
});

test('historical transfer without a receipt remains reviewable and is never assumed absent', async t => {
  const a = await app(t, { legacy: { status: 'completed', escrow: 'released', sale: true } });
  assert.equal((await a.webhook()).status, 500);
  assert.equal((await a.snapshot()).claim.refund_state, 'pending_transfer');
  assert.equal(a.reversals.length, 0); assert.equal(a.processed.has('evt_test'), false);
});

test('wrong charge values and mismatched transfer evidence fail closed', async t => {
  const a = await app(t);
  for (const change of [{ amount: 9999 }, { currency: 'usd' }, { amount_refunded: 2000, refunded: true }]) {
    await assert.rejects(a.refund({ ...charge, ...change }));
  }
  assert.equal((await a.snapshot()).sales, 1);
  a.gateway.calls.receipts[0].metadata.order_id = ids.stranger;
  assert.equal((await a.webhook()).status, 500); assert.equal(a.reversals.length, 0);
});

test('refund RPCs are service-only and missing refund migration cannot be acknowledged', async t => {
  const a = await app(t);
  for (const signature of ['prepare_order_refund(text,text,integer,integer,text,boolean)',
    'claim_order_reversal(uuid,text)', 'record_order_reversal(uuid,jsonb)']) {
    assert.equal((await a.db.query('SELECT has_function_privilege($1,$2,$3) AS allowed',
      ['authenticated',`tyaga.${signature}`,'EXECUTE'])).rows[0].allowed, false);
  }
  await a.db.exec('DROP FUNCTION tyaga.prepare_order_refund(text,text,integer,integer,text,boolean)');
  assert.equal((await a.webhook()).status, 500); assert.equal(a.processed.has('evt_test'), false);
  assert.equal(a.reversals.length, 0);
});

test('refund arriving before checkout attachment remains retryable and later closes the order', async t => {
  const a = await app(t, { settle: false });
  await a.db.exec("UPDATE tyaga.marketplace_orders SET status='pending',escrow_status='none',stripe_payment_intent_id=NULL");
  assert.equal((await a.webhook()).status, 500);
  assert.equal(a.processed.has('evt_test'), false);
  const checkout = { payment_status: 'paid', payment_intent: 'pi_test',
    metadata: { app_slug: 'tyaga', order_id: ids.order } };
  assert.equal((await a.webhook(checkout, 'evt_checkout', 'checkout.session.completed')).status, 200);
  assert.equal((await a.webhook()).status, 200);
  assert.equal((await a.snapshot()).order.escrow_status, 'refunded');
  assert.equal(a.gateway.calls.creates.length, 0); assert.equal(a.reversals.length, 0);
  assert.equal((await a.webhook(checkout, 'evt_checkout_retry', 'checkout.session.completed')).status, 200);
  assert.equal(a.orphanRefunds.length, 0);
  assert.equal((await a.webhook({ ...checkout, payment_intent: 'pi_second' },
    'evt_other_payment', 'checkout.session.completed')).status, 200);
  assert.equal(a.orphanRefunds.length, 1);
  assert.equal(a.orphanRefunds[0].payment_intent, 'pi_second');
});

test('a failed order read during checkout replay never proves an orphan payment', async t => {
  const faults = {}; const a = await app(t, {}, faults); faults.readOrderFails = true;
  const checkout = { payment_status: 'paid', payment_intent: 'pi_test',
    metadata: { app_slug: 'tyaga', order_id: ids.order } };
  assert.equal((await a.webhook(checkout, 'evt_checkout_read', 'checkout.session.completed')).status, 500);
  assert.equal(a.orphanRefunds.length, 0); assert.equal(a.processed.has('evt_checkout_read'), false);
  assert.equal((await a.webhook(checkout, 'evt_checkout_read', 'checkout.session.completed')).status, 200);
  assert.equal(a.orphanRefunds.length, 0);
});
