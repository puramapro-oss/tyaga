import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as feePolicy from '../src/lib/physical-fee-policy.ts';
import { computeCommission, physicalPilotQuote } from '../src/lib/commission.ts';
import { sameSaleQuote } from '../src/lib/physical-order-quote.ts';
import { expectedSaleQuote } from '../src/lib/sale-quote-input.ts';
import * as transitions from '../src/lib/order-transitions.ts';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { NextResponse } = require('next/server');
const routeSource = ts.transpileModule(await readFile(new URL('../src/app/api/orders/route.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const transitionSource = ts.transpileModule(await readFile(new URL('../src/app/api/orders/[id]/transition/route.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const ids = {
  buyer: '11111111-1111-4111-8111-111111111111',
  seller: '22222222-2222-4222-8222-222222222222',
  other: '33333333-3333-4333-8333-333333333333',
  listing: '44444444-4444-4444-8444-444444444444',
};
const address = { fullName: 'Camille Test', line1: '12 rue des Tests', postalCode: '25000', city: 'Besançon', country: 'FR' };
const active = ['pending', 'paid', 'shipped', 'delivered', 'completed'];

async function moduleFor(source, bindings, extras = {}) {
  const context = vm.createContext({ Date, URL, console, ...extras });
  const loadedModule = new vm.SourceTextModule(source, { context });
  await loadedModule.link(name => {
    const exports = bindings[name];
    assert.ok(exports, `Unexpected import: ${name}`);
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context });
  });
  await loadedModule.evaluate();
  return loadedModule.namespace;
}

// The handler is real. These adapters model durable rows and provider outcomes;
// they neither contact Stripe nor claim to execute PostgreSQL/RLS.
async function app(options = {}) {
  let userId = options.userId === undefined ? ids.buyer : options.userId;
  const quote = options.realPilot ? physicalPilotQuote(1000) : computeCommission(1000);
  const listing = { id: ids.listing, item_id: 'item', user_id: ids.seller,
    title: 'Article de test', price_cents: 1000, status: 'published', fee_policy: options.realPilot ? feePolicy.PHYSICAL_PILOT_POLICY : 'legacy' };
  const state = { orders: [], sessions: [], created: [], retrieved: [], cancelled: [], expired: [], rpcCalls: [], pilotCalls: 0, customerCalls: 0 };
  const profile = { id: ids.buyer, stripe_customer_id: options.newCustomer ? null : 'cus_existing', stripe_connect_account_id: 'acct_testSeller' };

  function client(service = false) {
    return {
      auth: { async getUser() { return { data: { user: userId ? { id: userId } : null } }; } },
      async rpc(name, args) {
        assert.ok(service);
        assert.equal(name, 'cancel_expired_order');
        state.rpcCalls.push({ name, args });
        if (options.missingMigration) return { data: null, error: { code: 'PGRST202' } };
        const row = state.orders.find(order => order.id === args.p_order);
        if (options.beforeCancel) options.beforeCancel(row);
        if (!row || !['pending', 'cancelled'].includes(row.status) || row.stripe_checkout_session_id !== args.p_session.id) {
          return { data: null, error: { code: '23514' } };
        }
        if (row.status === 'pending') {
          row.status = 'cancelled'; state.cancelled.push(row.id);
        }
        if (options.cancelResponseLost) {
          options.cancelResponseLost = false;
          return { data: null, error: { code: 'injected_response_lost_after_commit' } };
        }
        return { data: { id: row.id, status: row.status, escrow_status: row.escrow_status }, error: null };
      },
      from(table) {
        const filters = []; let inserted; let patch; let head = false;
        const query = {
          select(_columns, opts) { head = opts?.head === true; return query; },
          eq(key, value) { filters.push(row => row[key] === value); return query; },
          is(key, value) { filters.push(row => row[key] === value); return query; },
          in(key, values) { filters.push(row => values.includes(row[key])); return query; },
          insert(value) { inserted = value; return query; },
          update(value) { patch = value; return query; },
          single() { return execute(); }, maybeSingle() { return execute(); },
          then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); },
        };
        async function execute() {
          if (table === 'annonces') return { data: { ...listing }, error: null };
          if (table === 'profiles') {
            if (options.profileError) return { data: null, error: { code: '57014' } };
            if (patch) {
              if (options.customerSaveError) return { data: null, error: { code: '57014' } };
              Object.assign(profile, patch);
            }
            return { data: { ...profile }, error: null };
          }
          assert.equal(table, 'marketplace_orders');
          if (inserted) {
            if (state.orders.some(row => row.annonce_id === inserted.annonce_id && active.includes(row.status))) {
              return { data: null, error: { code: '23505' } };
            }
            const row = { ...inserted, id: `order${state.orders.length + 1}`, fee_policy: inserted.fee_policy ?? 'legacy',
              stripe_checkout_session_id: null, created_at: new Date().toISOString() };
            state.orders.push(row);
            return { data: { ...row }, error: null };
          }
          if (!patch && options.orderReadError) return { data: null, count: null, error: { code: '57014' } };
          let rows = state.orders.filter(row => service || row.buyer_id === userId || row.seller_id === userId);
          rows = rows.filter(row => filters.every(filter => filter(row)));
          if (patch) {
            assert.ok(service, 'Order updates in this fixture require the service adapter');
            if (patch.status === 'cancelled' && options.cleanupThrows) {
              throw new Error('Cleanup transport unavailable');
            }
            if (patch.status === 'cancelled' && options.cleanupError) {
              return { data: null, error: { code: '57014' } };
            }
            if (patch.status === 'cancelled' && options.cleanupNoRows) {
              return { data: null, error: null };
            }
            if (options.beforeSessionSave && patch.stripe_checkout_session_id) {
              options.beforeSessionSave(rows[0]);
              rows = rows.filter(row => filters.every(filter => filter(row)));
            }
            if (options.saveError && patch.stripe_checkout_session_id && !options.saveCommitted) {
              return { data: null, error: { code: '57014' } };
            }
            for (const row of rows) {
              Object.assign(row, patch);
              if (patch.status === 'cancelled') state.cancelled.push(row.id);
            }
            if (options.saveError && patch.stripe_checkout_session_id) return { data: null, error: { code: '57014' } };
          }
          return { data: head ? null : rows[0] ? { ...rows[0] } : null, count: rows.length, error: null };
        }
        return query;
      },
    };
  }
  const stripe = {
    accounts: { retrieve: async () => ({ country: 'FR', capabilities: { transfers: 'active' }, payouts_enabled: true }) },
    customers: { async create() { state.customerCalls++; return { id: 'cus_created' }; } },
    checkout: { sessions: {
      async create(args, requestOptions) {
        state.created.push({ args, requestOptions });
        const session = { id: `cs_test_fixture${state.sessions.length + 1}`, url: 'https://checkout.example.test/fixture',
          mode: 'payment', currency: 'eur', amount_total: args.line_items.reduce((sum, line) => sum + line.price_data.unit_amount * line.quantity, 0),
          metadata: { ...args.metadata }, client_reference_id: args.client_reference_id ?? null,
          status: 'open', payment_status: 'unpaid', livemode: false };
        state.sessions.push(session);
        if (options.responseLost) throw new Error('Provider accepted the write; response lost');
        return { ...session, ...(options.receiptOverride ?? {}) };
      },
      async retrieve(id) {
        state.retrieved.push(id);
        if (options.retrieveError) throw new Error('Provider unavailable');
        const session = state.sessions.find(row => row.id === id);
        assert.ok(session, 'Only a known provider session can be retrieved');
        return { ...session, ...(options.receiptOverride ?? {}) };
      },
      async expire(id) {
        state.expired.push(id);
        const session = state.sessions.find(row => row.id === id);
        assert.ok(session, 'Only the persisted session may be expired');
        if (options.expireError || session.status !== 'open') throw new Error('Session not expired by this call');
        session.status = 'expired'; session.url = null;
        if (options.expireResponseLost) throw new Error('Expiry committed; response lost');
        return { ...session, ...(options.expireReceiptOverride ?? {}) };
      },
    } },
  };
  const bindings = {
    'next/server': { NextResponse }, zod: require('zod'),
    '@/lib/physical-pilot-checkout': { async createPhysicalPilotCheckout() {
      state.pilotCalls++; return NextResponse.json({ url: 'https://checkout.example.test/pilot' });
    } },
    '@/lib/physical-fee-policy': feePolicy,
    '@/lib/physical-sale-pilot': { hasPhysicalTestStripeKey: () => options.testKey !== false },
    '@/lib/order-transitions': transitions,
    '@/lib/order-settlement': { finalizeCompletedSale() { throw new Error('Cancellation must not settle a sale'); } },
    '@/lib/physical-order-quote': { physicalOrderQuote: async () => ({ ...quote }), sameSaleQuote },
    '@/lib/sale-quote-input': { expectedSaleQuote },
    '@/lib/rate-limit': { rateLimit: () => ({ ok: true }) },
    '@/lib/service': { createServiceClient: () => client(true) },
    '@/lib/stripe': { getStripe: () => stripe },
    '@/lib/supabase-server': { createServerSupabaseClient: async () => client() },
  };
  if (options.realPilot) {
    const pilot = ts.transpileModule(await readFile(new URL('../src/lib/physical-pilot-checkout.ts', import.meta.url), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText;
    bindings['@/lib/physical-pilot-checkout'] = await moduleFor(pilot, {
      'next/server': { NextResponse }, './physical-fee-policy': feePolicy,
      './physical-sale-pilot': { canUsePhysicalSalePilot: async () => true, physicalPilotTestOrigin: () => 'https://tyaga.example.test' },
      './service': bindings['@/lib/service'], './stripe': bindings['@/lib/stripe'],
    });
  }
  const route = await moduleFor(routeSource, bindings);
  const transition = await moduleFor(transitionSource, bindings);
  const body = () => ({ annonceId: ids.listing, expectedQuote: { ...quote }, shippingAddress: { ...address } });
  const request = value => new Request('https://tyaga.example.test/api/orders', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value ?? body()),
  });
  return { state, quote, listing, body, asUser(id) { userId = id; },
    async transition(action = 'cancel') {
      const response = await transition.POST(new Request('https://tyaga.example.test/api/orders/fixture/transition', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
      }), { params: Promise.resolve({ id: state.orders[0].id }) });
      return { status: response.status, body: await response.json() };
    },
    async response(value) { return route.POST(request(value)); },
    async post(value) { const response = await route.POST(request(value)); return { status: response.status, body: await response.json() }; } };
}

test('provider response lost: preserve the pending order and a retry never emits another session', async () => {
  const a = await app({ responseLost: true });
  const first = await a.post();
  assert.equal(first.status, 503);
  assert.equal(first.body.status, 'verification_required');
  assert.equal(first.body.orderId, a.state.orders[0].id);
  assert.doesNotMatch(first.body.error, /aucun montant/i);
  assert.equal(a.state.orders[0].status, 'pending');
  assert.equal((await a.post()).status, 503);
  assert.equal(a.state.orders.length, 1);
  assert.equal(a.state.created.length, 1);
  assert.deepEqual(a.state.cancelled, []);
  assert.equal(a.state.created[0].requestOptions?.idempotencyKey, `tyaga:checkout:v1:${a.state.orders[0].id}`);
});

test('a failed session receipt write never advertises a usable checkout', async () => {
  const a = await app({ saveError: true });
  assert.equal((await a.post()).status, 503);
  assert.equal(a.state.orders[0].stripe_checkout_session_id, null);
  assert.equal(a.state.orders[0].status, 'pending');
  assert.equal((await a.post()).status, 503);
  assert.equal(a.state.created.length, 1);
});

test('receipt acknowledgement lost after commit: retry reads the original session and recovers', async () => {
  const a = await app({ saveError: true, saveCommitted: true });
  assert.equal((await a.post()).status, 503);
  const resumed = await a.post();
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.url, a.state.sessions[0].url);
  assert.equal(a.state.created.length, 1);
  assert.deepEqual(a.state.retrieved, [a.state.sessions[0].id]);
});

test('a successful request can be replayed after rename or an old timestamp without creating again', async () => {
  const a = await app();
  const first = await a.post();
  assert.equal(first.status, 200);
  a.listing.title = 'Renamed after the first checkout';
  a.state.orders[0].created_at = '2026-01-01T00:00:00Z';
  assert.deepEqual(await a.post(), first);
  assert.equal(a.state.created.length, 1);
});

test('an old pending order without a stored session is explicit uncertainty, never a fresh create', async () => {
  const a = await app({ responseLost: true });
  await a.post();
  a.state.orders[0].created_at = '2026-01-01T00:00:00Z';
  assert.equal((await a.post()).body.status, 'verification_required');
  assert.equal(a.state.created.length, 1);
});

test('another buyer cannot resume or replace an existing checkout', async () => {
  const a = await app();
  await a.post();
  a.state.orders[0].buyer_id = ids.other;
  const second = await a.post();
  assert.equal(second.status, 409);
  assert.equal(second.body.url, undefined);
  assert.equal(a.state.created.length, 1);
  assert.equal(a.state.retrieved.length, 0);
});

test('changed address or quote cannot silently reuse the earlier contract', async () => {
  const a = await app();
  await a.post();
  const changed = a.body(); changed.shippingAddress.line1 = '99 nouvelle adresse';
  assert.equal((await a.post(changed)).status, 409);
  a.quote.grossCents += 10;
  assert.equal((await a.post()).status, 409);
  assert.equal(a.state.created.length, 1);
  assert.equal(a.state.retrieved.length, 0);
});

for (const override of [
  { amount_total: 1 }, { currency: 'usd' }, { metadata: { app_slug: 'other' } },
  { client_reference_id: 'another-order' }, { mode: 'subscription' }, { id: 'not-a-checkout' },
]) test(`mismatched provider receipt is refused: ${JSON.stringify(override)}`, async () => {
  const a = await app({ receiptOverride: override });
  assert.equal((await a.post()).status, 503);
  assert.equal(a.state.orders[0].stripe_checkout_session_id, null);
  assert.equal(a.state.orders[0].status, 'pending');
});

test('expired and complete sessions do not return a checkout URL or create a new one', async () => {
  for (const status of ['expired', 'complete']) {
    const a = await app(); await a.post(); a.state.sessions[0].status = status;
    assert.equal((await a.post()).status, 409);
    assert.equal(a.state.created.length, 1);
  }
});

test('lookup failure never falls through into a new financial operation', async () => {
  const a = await app({ orderReadError: true });
  assert.equal((await a.post()).status, 503);
  assert.equal(a.state.created.length, 0);
  assert.equal(a.state.orders.length, 0);
});

test('a concurrent order transition prevents the route returning a stale checkout', async () => {
  const a = await app({ beforeSessionSave: row => { row.status = 'cancelled'; } });
  assert.equal((await a.post()).status, 503);
  assert.equal(a.state.orders[0].stripe_checkout_session_id, null);
});

test('unauthenticated requests and the 3 percent pilot retain their existing contracts', async () => {
  const anonymous = await app({ userId: null });
  assert.equal((await anonymous.post()).status, 401);
  assert.equal(anonymous.state.created.length, 0);
  for (const policy of feePolicy.PHYSICAL_PILOT_POLICIES) {
    const a = await app(); a.listing.fee_policy = policy;
    assert.equal((await a.post()).status, 200);
    assert.equal(a.state.pilotCalls, 1);
    assert.equal(a.state.created.length, 0);
  }
});

test('actual BuyPanel displays the uncertain-payment error and never navigates to a missing URL', async () => {
  const a = await app({ responseLost: true });
  const source = ts.transpileModule(await readFile(new URL('../src/components/marketplace/BuyPanel.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const values = [null, false, null, { ...address }]; let slot = 0;
  const window = { location: { href: 'unchanged' } };
  const jsx = (type, props) => ({ type, props });
  const namespace = await moduleFor(source, {
    'react': { useState() { const index = slot++; return [values[index], value => { values[index] = value; }]; } },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'lucide-react': { Lock() {}, Loader2() {} },
    '@/components/marketplace/SaleFeeSummary': { default() {} },
    '@/lib/physical-fee-policy': feePolicy,
    '@/lib/utils': { formatPrice: String },
  }, { window, fetch: (_url, init) => a.response(JSON.parse(init.body)) });
  const rendered = namespace.default({ annonceId: ids.listing, quote: a.quote });
  const form = rendered.props.children.find(child => child?.type === 'form');
  await form.props.onSubmit({ preventDefault() {} });
  assert.equal(window.location.href, 'unchanged');
  assert.equal(values[1], false);
  assert.match(values[2], /vérification/);
});

for (const actor of ['buyer', 'seller']) test(`${actor} cancellation requires an expired matching provider receipt before the server action`, async () => {
  const a = await app();
  assert.equal((await a.post()).status, 200);
  if (actor === 'seller') a.asUser(ids.seller);
  const result = await a.transition(actor === 'buyer' ? 'cancel' : 'seller_cancel');
  assert.equal(result.status, 200);
  assert.equal(result.body.order.status, 'cancelled');
  assert.equal(a.state.sessions[0].status, 'expired');
  assert.equal(a.state.rpcCalls.length, 1);
  assert.equal(a.state.rpcCalls[0].args.p_session.id, a.state.sessions[0].id);
});

test('unknown checkout outcome cannot be cancelled to open another checkout', async () => {
  const a = await app({ responseLost: true });
  assert.equal((await a.post()).status, 503);
  assert.equal((await a.transition()).status, 503);
  assert.equal((await a.post()).status, 503);
  assert.equal(a.state.orders[0].status, 'pending');
  assert.equal(a.state.created.length, 1);
  assert.equal(a.state.expired.length, 0);
  assert.equal(a.state.rpcCalls.length, 0);
});

for (const variant of ['already_expired', 'expiry_response_lost']) test(`expiry reconciliation: ${variant}`, async () => {
  const a = await app({ expireResponseLost: variant === 'expiry_response_lost' });
  await a.post();
  if (variant === 'already_expired') a.state.sessions[0].status = 'expired';
  const result = await a.transition();
  assert.equal(result.status, 200);
  assert.equal(a.state.retrieved.length, 1);
  assert.equal(a.state.orders[0].status, 'cancelled');
});

test('failed expiry preserves an open checkout and its order', async () => {
  const a = await app({ expireError: true });
  await a.post();
  assert.equal((await a.transition()).status, 503);
  assert.equal(a.state.sessions[0].status, 'open');
  assert.equal(a.state.orders[0].status, 'pending');
  assert.equal(a.state.rpcCalls.length, 0);
});

for (const status of ['complete', 'paid']) test(`payment won the race: ${status}`, async () => {
  const a = await app({ expireError: true });
  await a.post();
  if (status === 'complete') a.state.sessions[0].status = 'complete';
  else a.state.sessions[0].payment_status = 'paid';
  assert.equal((await a.transition()).status, 409);
  assert.equal(a.state.rpcCalls.length, 0);
  assert.equal(a.state.orders[0].status, 'pending');
});

for (const receipt of [{ amount_total: 1 }, { metadata: {} }, { id: 'cs_test_other' }]) {
  test(`cancellation refuses an unmatched expiry receipt: ${JSON.stringify(receipt)}`, async () => {
    const a = await app({ expireReceiptOverride: receipt });
    await a.post();
    assert.equal((await a.transition()).status, 503);
    assert.equal(a.state.rpcCalls.length, 0);
    assert.equal(a.state.orders[0].status, 'pending');
  });
}

test('missing cancellation migration never falls back to a direct order update', async () => {
  const a = await app({ missingMigration: true });
  await a.post();
  assert.equal((await a.transition()).status, 503);
  assert.equal(a.state.orders[0].status, 'pending');
  assert.deepEqual(a.state.cancelled, []);
});

test('payment recorded before cancellation finalization prevents a cancelled response', async () => {
  const a = await app({ beforeCancel(row) { row.status = 'paid'; row.escrow_status = 'held'; } });
  await a.post();
  assert.equal((await a.transition()).status, 503);
  assert.equal(a.state.orders[0].status, 'paid');
  assert.deepEqual(a.state.cancelled, []);
});

test('lost cancellation acknowledgement is honest and replay reconciles the same receipt', async () => {
  const a = await app({ cancelResponseLost: true });
  await a.post();
  const first = await a.transition();
  assert.equal(first.status, 503);
  assert.equal(a.state.orders[0].status, 'cancelled');
  assert.doesNotMatch(first.body.error, /reste réservée/i);
  const replay = await a.transition();
  assert.equal(replay.status, 200);
  assert.equal(replay.body.order.status, 'cancelled');
  assert.equal(a.state.cancelled.length, 1);
  assert.equal(a.state.created.length, 1);
});

for (const option of ['cleanupError', 'cleanupNoRows', 'cleanupThrows']) test(`failed pre-checkout cleanup remains explicit: ${option}`, async () => {
  const a = await app({ profileError: true, [option]: true });
  const result = await a.post();
  assert.equal(result.status, 503);
  assert.equal(result.body.status, 'verification_required');
  assert.equal(result.body.orderId, a.state.orders[0].id);
  assert.equal(a.state.orders[0].status, 'pending');
  assert.equal(a.state.created.length, 0);
});

test('definite pre-checkout failure releases the order only after confirmed cleanup', async () => {
  const a = await app({ profileError: true });
  const result = await a.post();
  assert.equal(result.status, 503);
  assert.equal(a.state.orders[0].status, 'cancelled');
  assert.equal(a.state.created.length, 0);
});

test('cancellation still requires the authenticated action owner', async () => {
  const a = await app();
  await a.post();
  assert.equal((await a.transition('seller_cancel')).status, 403);
  a.asUser(ids.other);
  assert.equal((await a.transition()).status, 404);
  a.asUser(null);
  assert.equal((await a.transition()).status, 401);
  assert.equal(a.state.expired.length, 0);
  assert.equal(a.state.rpcCalls.length, 0);
});

test('la réservation PAY est rejouable sans session Stripe et conserve son circuit', async () => {
  const a = await app({ realPilot: true });
  const body = { ...a.body(), fundingRoute: 'pay_test' };
  const reserved = await a.post(body);
  assert.equal(reserved.status, 200);
  assert.equal(reserved.body.state, 'awaiting_funding');
  assert.equal(reserved.body.grossCents, a.quote.grossCents);
  assert.equal(reserved.body.sellerNetCents, 1000);
  assert.equal(reserved.body.url, undefined);
  assert.deepEqual(await a.post(body), reserved);
  assert.equal((await a.post(a.body())).status, 409);
  assert.equal(a.state.orders.length, 1);
  assert.equal(a.state.orders[0].funding_route, 'pay_test');
  assert.equal(a.state.created.length, 0);
  const standard = await app({ realPilot: true });
  assert.equal((await standard.post()).status, 200);
  assert.equal((await standard.post({ ...standard.body(), fundingRoute: 'pay_test' })).status, 409);
  assert.equal(standard.state.sessions.length, 1);
  const legacy = await app();
  assert.equal((await legacy.post({ ...legacy.body(), fundingRoute: 'pay_test' })).status, 409);
  assert.equal(legacy.state.created.length, 0);
});
