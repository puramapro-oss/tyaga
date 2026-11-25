import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { database, ids, storeFor, transfersFor } from './settlement-db.mjs';
import { finalizeCompletedSale } from '../src/lib/order-settlement.ts';
import * as feePolicy from '../src/lib/physical-fee-policy.ts';
const { PHYSICAL_PILOT_POLICY, PHYSICAL_PILOT_POLICIES } = feePolicy;
import * as transitions from '../src/lib/order-transitions.ts';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { NextResponse } = require('next/server');
const originalSchema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');
const source = ts.transpileModule(await readFile(new URL('../src/app/api/orders/[id]/transition/route.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;

async function app(t, options = {}) {
  const db = await database({ status: 'shipped', ...options });
  t.after(() => db.close());
  await db.exec("ALTER TABLE tyaga.marketplace_orders ADD COLUMN fee_policy text NOT NULL DEFAULT 'legacy'");
  if (options.pilot) await db.query('UPDATE tyaga.marketplace_orders SET fee_policy=$1',[options.pilot === true ? PHYSICAL_PILOT_POLICY : options.pilot]);
  const start = originalSchema.indexOf('DROP POLICY IF EXISTS orders_select');
  const end = originalSchema.indexOf('-- VENTES :', start);
  const freezeStart = originalSchema.indexOf('CREATE OR REPLACE FUNCTION tyaga.tg_orders_freeze()');
  const freezeEnd = originalSchema.indexOf('-- S2 (HIGH)', freezeStart);
  await db.exec(originalSchema.slice(start, end));
  await db.exec(originalSchema.slice(freezeStart, freezeEnd));
  await db.exec(`ALTER TABLE tyaga.marketplace_orders ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    GRANT SELECT, UPDATE ON tyaga.marketplace_orders TO authenticated;`);
  const user = options.user === undefined ? ids.buyer : options.user;
  const calls = { service: 0, expire: 0, auth: 0 };
  const gateway = transfersFor(options.faults ?? {});
  const store = storeFor(db, options.faults ?? {});
  const authClient = {
    auth: { async getUser() { calls.auth++; return { data: { user: user ? { id: user } : null } }; } },
    from(table) {
      assert.equal(table, 'marketplace_orders');
      const filters = []; let update;
      const query = {
        select() { return query; },
        eq(key, value) { assert.ok(['id', 'status'].includes(key)); filters.push([key, value]); return query; },
        update(value) { update = value; return query; },
        single() { return execute(); }, maybeSingle() { return execute(); },
      };
      async function execute() {
        if (update && options.beforeUpdate) await options.beforeUpdate(db);
        try {
          let data;
          await db.transaction(async tx => {
            await tx.exec('SET LOCAL ROLE authenticated');
            await tx.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [user]);
            const values = update ? [update.status, update.updated_at] : [];
            const where = filters.map(([key, value]) => { values.push(value); return `${key} = $${values.length}`; }).join(' AND ');
            const statement = update
              ? `UPDATE tyaga.marketplace_orders SET status=$1,updated_at=$2 WHERE ${where} RETURNING *`
              : `SELECT * FROM tyaga.marketplace_orders WHERE ${where}`;
            data = (await tx.query(statement, values)).rows[0] ?? null;
          });
          return { data, error: null };
        } catch (error) { return { data: null, error: { code: error.code } }; }
      }
      return query;
    },
  };
  const bindings = {
    'next/server': { NextResponse }, zod: require('zod'),
    '@/lib/order-settlement': { finalizeCompletedSale },
    '@/lib/order-transitions': transitions,
    '@/lib/physical-fee-policy': feePolicy,
    '@/lib/physical-sale-pilot': { hasPhysicalTestStripeKey: () => options.testKey === true },
    '@/lib/rate-limit': { rateLimit: () => ({ ok: !options.rateLimited, retryAfterSec: 60 }) },
    '@/lib/service': { createServiceClient: () => { calls.service++; return store; } },
    '@/lib/supabase-server': { createServerSupabaseClient: async () => authClient },
    '@/lib/stripe': { getStripe: () => {
      if (options.forbidChangedClient && !options.testKey) throw new Error('A live client was requested');
      return { transfers: gateway.getTransfers(), checkout: { sessions: { async expire() { calls.expire++; } } } };
    } },
  };
  const context = vm.createContext({ console: { error() {} }, Date, URL });
  const module = new vm.SourceTextModule(source, { context });
  await module.link(name => {
    const exports = bindings[name]; assert.ok(exports, name);
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  return { db, calls, gateway, async post(action = 'deliver', raw) {
    const response = await module.namespace.POST(new Request(`https://tyaga.example.test/api/orders/${ids.order}/transition`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw ?? JSON.stringify({ action }),
    }), { params: Promise.resolve({ id: ids.order }) });
    assert.ok(response instanceof NextResponse);
    return { status: response.status, body: await response.json() };
  } };
}

test('actual route and actual SQL return the final completed/released order; replay emits once', async t => {
  const a = await app(t);
  const first = await a.post();
  assert.equal(first.status, 200); assert.equal(first.body.order.status, 'completed');
  assert.equal(first.body.order.escrow_status, 'released');
  assert.equal(first.body.order.stripe_transfer_id, 'tr_test1');
  assert.equal((await a.post()).status, 200);
  assert.equal(a.gateway.calls.creates.length, 1);
});

for (const [name, options, expected] of [
  ['anonymous', { user: null }, 401],
  ['another user', { user: ids.stranger }, 404],
  ['seller confirming receipt', { user: ids.seller }, 403],
  ['already refunded', { status: 'cancelled', escrow: 'refunded' }, 409],
  ['rate limit', { rateLimited: true }, 429],
]) test(`route refuses ${name} before any settlement`, async t => {
  const a = await app(t, options);
  assert.equal((await a.post()).status, expected);
  assert.equal(a.calls.service, 0); assert.equal(a.gateway.calls.creates.length, 0);
});

test('invalid action and malformed JSON never reach settlement', async t => {
  const a = await app(t);
  assert.equal((await a.post('complete')).status, 400);
  assert.equal((await a.post('deliver', '{')).status, 400);
  assert.equal(a.calls.service, 0);
});

test('missing migration reports failure and keeps receipt confirmation without paying', async t => {
  const a = await app(t, { migrate: false });
  assert.equal((await a.post()).status, 500);
  assert.equal(a.gateway.calls.creates.length, 0);
  const order = (await a.db.query('SELECT status,escrow_status FROM tyaga.marketplace_orders')).rows[0];
  assert.deepEqual(order, { status: 'delivered', escrow_status: 'held' });
});

test('unknown Stripe outcome returns 202 and held funds; next route call only reconciles', async t => {
  const a = await app(t, { faults: { responseLost: true } });
  const first = await a.post();
  assert.equal(first.status, 202); assert.equal(first.body.order.status, 'completed');
  assert.equal(first.body.order.escrow_status, 'held');
  assert.equal(first.body.settlement.status, 'verification_required');
  assert.equal((await a.post()).body.settlement.status, 'paid');
  assert.equal(a.gateway.calls.creates.length, 1);
});

test('concurrent status change is refused by UPDATE status guard and real RLS', async t => {
  const a = await app(t, { beforeUpdate: db => db.exec("UPDATE tyaga.marketplace_orders SET status='cancelled',escrow_status='refunded'") });
  assert.equal((await a.post()).status, 403);
  assert.equal(a.calls.service, 0); assert.equal(a.gateway.calls.creates.length, 0);
});

test('seller shipping keeps its existing path and performs no finalization', async t => {
  const a = await app(t, { user: ids.seller, status: 'paid' });
  const response = await a.post('ship');
  assert.equal(response.status, 200); assert.equal(response.body.order.status, 'shipped');
  assert.equal(a.calls.service, 0); assert.equal(a.gateway.calls.creates.length, 0);
});


for (const [action,status] of [['cancel','pending'], ['deliver','shipped'], ['deliver','delivered'], ['deliver','completed']]) {
  for (const policy of PHYSICAL_PILOT_POLICIES) test(`une commande ${policy} ne peut pas ${action} depuis ${status} sous une clé de production`, async t => {
    const a = await app(t, { pilot: policy, testKey: false, status });
    await a.db.exec("UPDATE tyaga.marketplace_orders SET stripe_checkout_session_id='cs_test_order'");
    assert.equal((await a.post(action)).status,503);
    assert.equal((await a.db.query('SELECT status FROM tyaga.marketplace_orders')).rows[0].status, status);
    assert.equal(a.calls.service,0); assert.equal(a.calls.expire,0); assert.equal(a.gateway.calls.creates.length,0);
  });
}


test('la transition conserve le client de recette vérifié avant une bascule de clé en vol', async t => {
  const options = { pilot:true, testKey:true, forbidChangedClient:true, beforeUpdate:() => { options.testKey=false; } };
  const a=await app(t,options);
  assert.equal((await a.post('deliver')).status,200);
  assert.equal(options.testKey,false);
  assert.equal(a.gateway.calls.creates.length,1);
});
