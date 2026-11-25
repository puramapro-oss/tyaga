// Called within the disposable native PostgreSQL fixture. The Supabase SDK and
// the application handlers are real. Auth tokens and HTTP transport stay local.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { compileFunction } from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');
const appOrigin = 'https://marketplace.example.test';
const dbOrigin = 'http://127.0.0.1:54321';
const fixtureEnv = {
  TYAGA_PROMOTION_POINTS_TEST: '1', TYAGA_PROMOTION_POINTS_TEST_ORIGIN: appOrigin,
  TYAGA_PROMOTION_POINTS_TEST_SUPABASE_ORIGIN: dbOrigin, NEXT_PUBLIC_SUPABASE_URL: dbOrigin,
};
const getScalar = async (connection, sql, args) => Object.values((await connection.query(sql, args)).rows[0])[0];

async function loadSource(path, bindings) {
  const code = await readFile(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const result = {};
  compileFunction(js.outputText, ['require', 'exports', 'process'])(id => {
    assert.ok(Object.hasOwn(bindings, id), 'unexpected dependency ' + id);
    return bindings[id];
  }, result, { env: fixtureEnv });
  return result;
}

export async function checkPointsRouteOnPostgres({ admin, service, browser, actor, listing, tariff }) {
  const token = 'synthetic-route-session';
  const serviceKey = 'synthetic-service';
  const browserKey = 'synthetic-anon';
  const calls = [];
  const sqlForRpc = {
    promotion_points_test_quote: 'SELECT tyaga.promotion_points_test_quote($1,$2)',
    promotion_points_test_receipt: 'SELECT tyaga.promotion_points_test_receipt($1,$2,$3,$4)',
    purchase_promotion_with_test_points: 'SELECT tyaga.purchase_promotion_with_test_points($1,$2,$3,$4)',
  };

  async function localTransport(input, init) {
    const request = new Request(input, init);
    const url = new URL(request.url);
    assert.equal(url.origin, dbOrigin);
    const auth = request.headers.get('authorization');
    if (url.pathname === '/auth/v1/user') {
      assert.equal(auth, 'Bearer ' + token);
      assert.equal(request.headers.get('apikey'), browserKey);
      calls.push('auth');
      return Response.json({ id: actor, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} });
    }
    if (url.pathname === '/rest/v1/annonces') {
      assert.equal(request.method, 'GET');
      assert.equal(auth, 'Bearer ' + token);
      assert.equal(request.headers.get('accept-profile'), 'tyaga');
      assert.deepEqual(Object.fromEntries(url.searchParams), { select: 'id', id: 'eq.' + listing, user_id: 'eq.' + actor, status: 'eq.published' });
      const data = await browser.query("SELECT id FROM tyaga.annonces WHERE id=$1 AND user_id=$2 AND status='published'", [listing, actor]);
      calls.push('published owner');
      return Response.json(data.rows);
    }
    const method = url.pathname.slice('/rest/v1/rpc/'.length);
    assert.equal(url.pathname, '/rest/v1/rpc/' + method);
    assert.ok(Object.hasOwn(sqlForRpc, method));
    assert.equal(request.method, 'POST');
    assert.equal(auth, 'Bearer ' + serviceKey);
    assert.equal(request.headers.get('content-profile'), 'tyaga');
    const args = await request.json();
    const params = [args.p_listing, args.p_actor];
    if (method !== 'promotion_points_test_quote') params.push(args.p_tariff_id, args.p_request_id);
    calls.push(method);
    return Response.json(await getScalar(service, sqlForRpc[method], params));
  }

  const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    db: { schema: 'tyaga' }, global: { fetch: localTransport } };
  const authProvider = createClient(dbOrigin, browserKey, options);
  const userDb = createClient(dbOrigin, browserKey, { ...options, accessToken: async () => token });
  const privileged = createClient(dbOrigin, serviceKey, options);
  const validation = await loadSource('../src/lib/promotion-points-test.ts', { 'server-only': {}, zod: require('zod') });
  const rateLimit = await loadSource('../src/lib/rate-limit.ts', {});
  const api = await loadSource('../src/app/api/annonces/[id]/promotion-points/route.ts', {
    'next/server': require('next/server'), zod: require('zod'),
    '@/lib/promotion-points-test': validation, '@/lib/rate-limit': rateLimit,
    '@/lib/service': { createServiceClient: () => privileged },
    '@/lib/supabase-server': { createServerSupabaseClient: async () => ({
      auth: { getUser: () => authProvider.auth.getUser(token) }, from: table => userDb.from(table),
    }) },
  });
  const wallet = () => getScalar(admin, 'SELECT balance FROM purama_pay.points_wallets WHERE user_id=$1', [actor]);
  const amountBefore = await wallet();
  const count = () => getScalar(admin, 'SELECT count(*)::int FROM tyaga_promotion.points_pilot_purchases WHERE actor=$1', [actor]);
  const countBefore = await count();
  const requestId = randomUUID();
  const url = appOrigin + '/api/annonces/' + listing + '/promotion-points';
  const ctx = { params: Promise.resolve({ id: listing }) };
  const quoteResponse = await api.GET(new Request(url), ctx);
  assert.equal(quoteResponse.status, 200);
  const { quote } = await quoteResponse.json();
  assert.deepEqual(quote, { tariffId: tariff, durationHours: 24, costPoints: 12, balancePoints: 36 });
  const purchase = () => api.POST(new Request(url, {
    method: 'POST', headers: { origin: appOrigin, 'content-type': 'application/json' },
    body: JSON.stringify({ requestId, tariffId: quote.tariffId, confirmed: true }),
  }), ctx);
  const purchased = await purchase();
  assert.equal(purchased.status, 200);
  const { receipt } = await purchased.json();
  assert.equal(receipt.costPoints, quote.costPoints);
  const repeated = await purchase();
  assert.equal(repeated.status, 200);
  assert.deepEqual(await repeated.json(), { receipt });
  const lookup = () => api.GET(new Request(url + '?' + new URLSearchParams({ requestId, tariffId: tariff })), ctx);
  assert.deepEqual(await (await lookup()).json(), { receipt: { ...receipt, status: 'purchased' } });
  assert.equal(await wallet(), amountBefore - quote.costPoints);
  assert.equal(await count(), countBefore + 1);
  const evidence = await admin.query(`SELECT t.amount,g.paid_units,g.beneficiary,g.receipt FROM purama_pay.points_transactions t
    JOIN tyaga_promotion.grants g ON g.receipt=t.id::text WHERE g.id=$1 AND t.id=$2 AND t.type='debit_catalog'`,
    [receipt.grantId, receipt.receiptId]);
  assert.deepEqual(evidence.rows, [{ amount: -quote.costPoints, paid_units: quote.costPoints, beneficiary: actor, receipt: receipt.receiptId }]);
  await service.query('SELECT tyaga.refund_promotion_test_points($1,$2)', [actor, requestId]);
  assert.deepEqual(await (await lookup()).json(), { receipt: { ...receipt, status: 'refunded' } });
  assert.equal(await wallet(), amountBefore);
  assert.equal(calls.filter(value => value === 'auth').length, 5);
  assert.equal(calls.filter(value => value === 'published owner').length, 3);
  assert.equal(calls.filter(value => value === 'purchase_promotion_with_test_points').length, 2);
  console.log('PASS real GET/POST handlers + Supabase client + native PAY: quote, repeated purchase, single debit/grant, receipt and reversal');
}
