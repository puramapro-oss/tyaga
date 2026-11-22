// Native PostgreSQL only: each psql invocation owns a separate connection.
// Uses the same schema/migration fixture as the embedded SQL regression suite.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { before, test } from 'node:test';
import { database, ids } from './settlement-db.mjs';

const dbName = process.env.TYAGA_TEST_PG_DATABASE;
const host = process.env.TYAGA_TEST_PG_HOST;
const user = process.env.TYAGA_TEST_PG_USER;
const container = process.env.TYAGA_TEST_PG_CONTAINER;
if (!dbName?.startsWith('tyaga_test_') || !user?.startsWith('tyaga_test_') ||
    !host || !(host.startsWith('/') || ['localhost', '127.0.0.1', '::1'].includes(host))) {
  throw new Error('Explicit local TYAGA_TEST_PG_DATABASE, TYAGA_TEST_PG_USER and TYAGA_TEST_PG_HOST are required');
}

function sqlValue(value) {
  if (value === null) return 'NULL';
  if (typeof value === 'number') {
    assert(Number.isFinite(value));
    return String(value);
  }
  if (typeof value === 'boolean') return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function connection(sql, params = [], holdOpen = false) {
  sql = sql.replace(/\$(\d+)\b/g, (_match, index) => sqlValue(params[Number(index) - 1]));
  const args = ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', host,
    '-p', process.env.TYAGA_TEST_PG_PORT ?? '5432', '-U', user, '-d', dbName];
  const command = container ? 'docker' : process.env.TYAGA_TEST_PSQL_BIN ?? 'psql';
  const commandArgs = container ? ['exec', '-i', '-e', 'PGCONNECT_TIMEOUT=5',
    '-e', 'PGOPTIONS=-c statement_timeout=10000 -c lock_timeout=8000', container, 'psql', ...args] : args;
  const child = spawn(command, commandArgs, {
    env: { ...process.env, PGCONNECT_TIMEOUT: '5',
      PGOPTIONS: '-c statement_timeout=10000 -c lock_timeout=8000' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const done = new Promise((resolve, reject) => {
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim())));
    child.stdin.on('error', () => {});
  });
  if (holdOpen) child.stdin.write(`${sql}\n`);
  else child.stdin.end(sql);
  return { done, finish: (lastSql) => child.stdin.end(lastSql) };
}

function query(sql, params = []) {
  return connection(sql, params).done;
}

async function asService(expression) {
  return JSON.parse(await query(`SET ROLE service_role; SELECT ${expression};`));
}

const prepare = `tyaga.prepare_order_settlement('${ids.order}','${ids.buyer}')`;
const refund = "tyaga.prepare_order_refund('pi_test','ch_native',10000,10000,'eur',true)";
const transfer = { id: 'tr_native', amount: 9000, currency: 'eur', destination: 'acct_seller',
  transfer_group: `tyaga_order_${ids.order}`, order_id: ids.order, app_slug: 'tyaga',
  reversed: false, amount_reversed: 0 };
const recordTransfer = `tyaga.record_order_transfer('${ids.order}',${sqlValue(JSON.stringify(transfer))}::jsonb)`;

before(async () => {
  assert.equal(await query("SELECT coalesce(to_regnamespace('tyaga')::text, 'empty');"), 'empty',
    'Use a fresh disposable database; existing application schemas are never reset');
  await database({}, async () => ({ exec: query, query }));
  console.log(`Native PostgreSQL ${await query('SHOW server_version;')}`);
});

test('eight independent connections consume one transfer claim and credit one sale', async () => {
  const frames = await Promise.all(Array.from({ length: 8 }, () => asService(prepare)));
  assert.equal(frames.filter((frame) => frame.issue).length, 1);
  const counts = JSON.parse(await query(`SELECT json_build_object(
    'sales', (SELECT count(*) FROM tyaga.ventes),
    'seller', (SELECT balance_points FROM tyaga.vida_wallet WHERE user_id='${ids.seller}'),
    'referrer', (SELECT balance_points FROM tyaga.vida_wallet WHERE user_id='${ids.referrer}'));`));
  assert.deepEqual(counts, { sales: 1, seller: 90, referrer: 5 });
});

test('a late transfer waits for the refund row lock and cannot resurrect the order', async () => {
  // A balance above the debit prevents a floor of zero from hiding double debits.
  await query(`UPDATE tyaga.vida_wallet SET balance_points=190 WHERE user_id='${ids.seller}';`);
  const heldRefund = connection(`SET application_name='tyaga_test_refund_hold'; BEGIN;
    SET LOCAL ROLE service_role; SELECT ${refund};`, [], true);
  void heldRefund.done.catch(() => {});
  let receipt;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      ready = (await query("SELECT count(*) FROM pg_stat_activity WHERE application_name='tyaga_test_refund_hold' AND state='idle in transaction';")) === '1';
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert(ready, 'The first connection must hold the transaction before the competing receipt');
    receipt = asService(recordTransfer);
    void receipt.catch(() => {});
    let waiting = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      waiting = (await query("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%record_order_transfer%';")) === '1';
      if (waiting) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert(waiting, 'A separate receipt connection must actually wait for the PostgreSQL lock');
  } finally {
    // Explicit release after the observation, independent of runner speed.
    // Closing stdin on failure also prevents an orphaned open transaction.
    heldRefund.finish('COMMIT;\n');
    await heldRefund.done;
  }
  const frame = await receipt;
  assert.equal(frame.order.status, 'cancelled');
  assert.equal(frame.order.escrow_status, 'refunded');
  assert.equal(frame.settlement.state, 'refund_review');
});

test('eight refund retries debit the original sale once', async () => {
  await Promise.all(Array.from({ length: 8 }, () => asService(refund)));
  assert.equal(await query(`SELECT balance_points FROM tyaga.vida_wallet WHERE user_id='${ids.seller}';`), '100');
  assert.equal(await query('SELECT count(*) FROM tyaga.ventes;'), '0');
  assert.equal(await query(`SELECT balance_points FROM tyaga.vida_wallet WHERE user_id='${ids.referrer}';`), '5');
});

test('eight independent reversal attempts consume exactly one durable claim', async () => {
  const frames = await Promise.all(Array.from({ length: 8 }, () =>
    asService(`tyaga.claim_order_reversal('${ids.order}','tr_native')`)));
  assert.equal(frames.filter((frame) => frame.issue).length, 1);
  assert(frames.every((frame) => frame.settlement.refund_state === 'reversing'));
});

test('an older transfer receipt cannot undo complete reversal evidence', async () => {
  const proof = { ...transfer, reversed: true, amount_reversed: 9000, reversal_id: 'trr_native' };
  await asService(`tyaga.record_order_reversal('${ids.order}',${sqlValue(JSON.stringify(proof))}::jsonb)`);
  await asService(recordTransfer);
  const frame = await asService(refund);
  assert.equal(frame.refund_state, 'complete');
  assert.equal(frame.stripe_reversal_id, 'trr_native');
  const order = JSON.parse(await query(`SELECT json_build_object('status',status,'escrow',escrow_status)
    FROM tyaga.marketplace_orders WHERE id='${ids.order}';`));
  assert.deepEqual(order, { status: 'cancelled', escrow: 'refunded' });
});

test('authenticated users cannot invoke settlement or refund service functions', async () => {
  await assert.rejects(query(`SET ROLE authenticated; SELECT ${prepare};`), /permission denied/);
  await assert.rejects(query(`SET ROLE authenticated; SELECT ${refund};`), /permission denied/);
});
