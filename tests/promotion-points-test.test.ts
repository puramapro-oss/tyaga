import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compileFunction } from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';

import * as terms from '../src/lib/promotion-points-test';

const appOrigin = 'https://market.example.test';
const backend = 'http://127.0.0.1:54321';
const environment = {
  TYAGA_PROMOTION_POINTS_TEST: '1',
  TYAGA_PROMOTION_POINTS_TEST_ORIGIN: appOrigin,
  TYAGA_PROMOTION_POINTS_TEST_SUPABASE_ORIGIN: backend,
  NEXT_PUBLIC_SUPABASE_URL: backend,
};
const actor = 'ab000000-0000-4000-a000-000000000001';
const listing = 'ab000000-0000-4000-a000-000000000002';
const requestId = 'ab000000-0000-4000-a000-000000000003';
const grantId = 'ab000000-0000-4000-a000-000000000004';
const tariffId = 'essai-2026.v1';
const purchase = { requestId, tariffId, confirmed: true };
const receipt = { grant_id: grantId, receipt_id: 'recette-1', cost_points: 42 };
const appPath = '/api/annonces/' + listing + '/promotion-points';
const confirmation = { 'content-type': 'application/json', origin: appOrigin };
const ctx = { params: Promise.resolve({ id: listing }) };

const source = readFileSync(new URL('../src/app/api/annonces/[id]/promotion-points/route.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} });
const routeFactory = compileFunction(compiled.outputText, ['require', 'exports', 'process']);
type Handler = (request: Request, params: typeof ctx) => Promise<Response>;

function route(options: {
  env?: Record<string, string | undefined>, noUser?: boolean, owner?: boolean, limited?: boolean,
  result?: unknown, rpcError?: string, throwRpc?: boolean, authError?: boolean,
} = {}) {
  const rpcCalls: { name: string, args: Record<string, string> }[] = [];
  const filters: [string, string][] = [];
  let authCalls = 0;
  const db = {
    select(column: string) { assert.equal(column, 'id'); return db; },
    eq(key: string, value: string) { filters.push([key, value]); return db; },
    maybeSingle() { return { data: options.owner === false ? null : { id: listing }, error: null }; },
  };
  const bindings: Record<string, unknown> = {
    'next/server': { NextResponse: Response },
    zod: { z },
    '@/lib/promotion-points-test': terms,
    '@/lib/supabase-server': { async createServerSupabaseClient() {
      authCalls++;
      if (options.authError) throw new Error('unavailable');
      return {
        auth: { getUser: async () => ({ data: { user: options.noUser ? null : { id: actor } } }) },
        from(table: string) { assert.equal(table, 'annonces'); return db; },
      };
    } },
    '@/lib/rate-limit': { rateLimit: () => ({ ok: !options.limited, retryAfterSec: 5 }) },
    '@/lib/service': { createServiceClient: () => ({ async rpc(name: string, args: Record<string, string>) {
      rpcCalls.push({ name, args });
      if (options.throwRpc) throw new Error('response lost');
      return { data: options.result ?? null, error: options.rpcError ? { code: options.rpcError } : null };
    } }) },
  };
  const handlers = {} as Record<'GET' | 'POST', Handler>;
  routeFactory((name: string) => {
    assert.ok(name in bindings, 'unexpected dependency ' + name);
    return bindings[name];
  }, handlers, { env: { ...environment, ...options.env } });
  return {
    get: (suffix = '', origin = appOrigin) => handlers.GET(new Request(origin + appPath + suffix), ctx),
    post: (body: unknown = purchase, headers: Record<string, string> = confirmation) =>
      handlers.POST(new Request(appOrigin + appPath, { method: 'POST', headers, body: JSON.stringify(body) }), ctx),
    raw: (request: Request) => handlers.POST(request, ctx),
    rpcCalls, filters, authCalls: () => authCalls,
  };
}

test('closed by default, restricted to the configured application, schema and isolated backend', async () => {
  assert.equal(terms.pointsPromotionTestOrigin({}), null);
  assert.equal(terms.pointsPromotionTestOrigin(environment), appOrigin);
  for (const env of [
    { TYAGA_PROMOTION_POINTS_TEST: '0' }, { VERCEL_ENV: 'production' },
    { NEXT_PUBLIC_SUPABASE_URL: 'https://another.example.test' }, { NEXT_PUBLIC_SUPABASE_DB_SCHEMA: 'public' },
    { TYAGA_PROMOTION_POINTS_TEST_ORIGIN: 'http://public.example.test' },
    { TYAGA_PROMOTION_POINTS_TEST_ORIGIN: 'https://TYAGA.PURAMA.DEV.' },
    { TYAGA_PROMOTION_POINTS_TEST_ORIGIN: 'https://member:secret@example.test/' },
    { TYAGA_PROMOTION_POINTS_TEST_SUPABASE_ORIGIN: backend + '/rest/v1' },
    { TYAGA_PROMOTION_POINTS_TEST_SUPABASE_ORIGIN: '' },
    { TYAGA_PROMOTION_POINTS_TEST_SUPABASE_ORIGIN: 'https://auth.purama.dev', NEXT_PUBLIC_SUPABASE_URL: 'https://auth.purama.dev' },
  ]) {
    const api = route({ env });
    assert.deepEqual(await (await api.get()).json(), { quote: null });
    assert.equal((await api.post()).status, 403);
    assert.equal(api.authCalls(), 0);
  }
  const api = route();
  assert.deepEqual(await (await api.get('', 'https://external.test')).json(), { quote: null });
  assert.equal(api.authCalls(), 0);
});

test('quote resolves server-side owner of a published listing, returns only authorized terms', async () => {
  const api = route({ result: { tariff_id: tariffId, cost_points: 42, balance_points: 100, duration_hours: 24, private: 'not exposed' } });
  const res = await api.get();
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await res.json(), { quote: { tariffId, costPoints: 42, balancePoints: 100, durationHours: 24 } });
  assert.deepEqual(api.filters, [['id', listing], ['user_id', actor], ['status', 'published']]);
  assert.deepEqual(api.rpcCalls, [{ name: 'promotion_points_test_quote', args: { p_listing: listing, p_actor: actor } }]);
  assert.deepEqual(await (await route().get()).json(), { quote: null });
  assert.equal((await route({ result: { tariff_id: 'invalid!' } }).get()).status, 503);
});

test('purchase and quote require a live auth session and ownership; outages do not admit requests', async () => {
  for (const [options, expected] of [[{ noUser: true }, 401], [{ owner: false }, 404], [{ authError: true }, 503]] as const) {
    const api = route(options);
    assert.equal((await api.get()).status, expected);
    assert.equal((await api.post()).status, expected);
    assert.equal(api.rpcCalls.length, 0);
  }
});

test('purchase requires exact same origin, JSON and bounded body; rejects client monetary or identity fields', async () => {
  const api = route();
  for (const headers of [{}, { origin: 'https://wrong.test' }, { origin: appOrigin, 'sec-fetch-site': 'cross-site' }]) {
    assert.equal((await api.post(purchase, { 'content-type': 'application/json', ...headers } as Record<string, string>)).status, 403);
  }
  assert.equal((await api.post(purchase, { origin: appOrigin })).status, 415);
  for (const extra of [{ confirmed: false }, { points: 42 }, { actor }, { durationHours: 24 }, { tariffId: 'bad/id' }, { requestId: 'bad' }]) {
    assert.equal((await api.post({ ...purchase, ...extra })).status, 400);
  }
  assert.equal((await api.post({ ...purchase, extra: 'a'.repeat(3000) })).status, 413);
  assert.equal((await api.raw(new Request(appOrigin + appPath, { method: 'POST', headers: confirmation, body: '{' }))).status, 400);
  const limited = route({ limited: true });
  const limitedResult = await limited.post();
  assert.equal(limitedResult.status, 429);
  assert.equal(limitedResult.headers.get('retry-after'), '5');
  assert.equal(api.rpcCalls.length + limited.rpcCalls.length, 0);
});

test('a confirmed purchase and retry use the same actor, request and tariff; only receipt fields are served', async () => {
  const api = route({ result: { ...receipt, wallet_balance: 123 } });
  for (let i = 0; i < 2; i++) {
    const res = await api.post();
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { receipt: { grantId, receiptId: 'recette-1', costPoints: 42 } });
  }
  assert.deepEqual(api.rpcCalls, Array(2).fill({
    name: 'purchase_promotion_with_test_points',
    args: { p_actor: actor, p_listing: listing, p_tariff_id: tariffId, p_request_id: requestId },
  }));
});

test('maps definitive declines and uncertain confirmations to distinct responses', async () => {
  for (const [rpcError, status, code] of [['23505',409,'REQUEST_CONFLICT'], ['23514',409,'TERMS_UNAVAILABLE'], ['42501',403,undefined], ['unavailable',503,undefined]] as const) {
    const res = await route({ rpcError }).post();
    assert.equal(res.status, status);
    assert.equal((await res.json()).code, code);
  }
  assert.equal((await route({ throwRpc: true }).post()).status, 503);
  assert.equal((await route({ result: { invalid: true } }).post()).status, 503);
});

test('receipt recovery reads by authenticated actor and exact request, including after withdrawal or refund', async () => {
  const query = '?requestId=' + requestId + '&tariffId=' + tariffId;
  for (const status of ['purchased', 'refunded']) {
    const api = route({ owner: false, result: { ...receipt, status } });
    const res = await api.get(query);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { receipt: { grantId, receiptId: 'recette-1', costPoints: 42, status } });
    assert.deepEqual(api.filters, []);
    assert.deepEqual(api.rpcCalls, [{ name: 'promotion_points_test_receipt',
      args: { p_actor: actor, p_listing: listing, p_request_id: requestId, p_tariff_id: tariffId } }]);
  }
  assert.deepEqual(await (await route().get(query)).json(), { receipt: null });
  assert.equal((await route({ noUser: true }).get(query)).status, 401);
  assert.equal((await route({ throwRpc: true }).get(query)).status, 503);
  assert.equal((await route({ result: { ...receipt, status: 'unknown' } }).get(query)).status, 503);
  const invalid = route();
  for (const q of [query + '&actor=' + actor, query + '&requestId=' + requestId, '?requestId=invalid']) {
    assert.equal((await invalid.get(q)).status, 400);
  }
  assert.deepEqual(invalid.rpcCalls, []);
});
