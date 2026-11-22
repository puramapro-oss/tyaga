// Tests isolés : PGlite exécute les vrais objets SQL nécessaires du schéma.
// Il ne remplace pas une qualification de concurrence PostgreSQL multi-session.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PGlite } = require('@electric-sql/pglite');
const base = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');
export const migration = await readFile(new URL('../sql/20261122-order-settlement.sql', import.meta.url), 'utf8');
export const refundMigration = await readFile(new URL('../sql/20261122-order-refund.sql', import.meta.url), 'utf8');
export const ids = {
  buyer: '11111111-1111-4111-8111-111111111111',
  seller: '22222222-2222-4222-8222-222222222222',
  referrer: '33333333-3333-4333-8333-333333333333',
  stranger: '44444444-4444-4444-8444-444444444444',
  item: '55555555-5555-4555-8555-555555555555',
  annonce: '66666666-6666-4666-8666-666666666666',
  order: '77777777-7777-4777-8777-777777777777',
};

export async function database(options = {}, createDatabase = () => PGlite.create()) {
  const db = await createDatabase();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA tyaga; CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS
      $$SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;`);
  for (const table of ['profiles', 'items', 'estimations', 'annonces', 'marketplace_orders', 'ventes', 'vida_wallet', 'referrals']) {
    const sql = base.match(new RegExp(`CREATE TABLE IF NOT EXISTS tyaga\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0];
    if (!sql) throw new Error(`Missing original table ${table}`);
    await db.exec(sql);
  }
  await db.exec(`ALTER TABLE tyaga.profiles ADD COLUMN stripe_connect_account_id text;
    ALTER TABLE tyaga.marketplace_orders ADD COLUMN stripe_checkout_session_id text;
    GRANT USAGE ON SCHEMA tyaga TO service_role, authenticated, anon;
    GRANT ALL ON ALL TABLES IN SCHEMA tyaga TO service_role;`);
  const start = base.indexOf('CREATE OR REPLACE FUNCTION tyaga.credit_wallet(');
  const end = base.indexOf('REVOKE ALL ON FUNCTION tyaga.credit_wallet', start);
  await db.exec(base.slice(start, end));
  await db.exec('REVOKE ALL ON FUNCTION tyaga.credit_wallet(uuid, integer) FROM PUBLIC, anon, authenticated;');
  for (const id of [ids.buyer, ids.seller, ids.referrer, ids.stranger]) {
    await db.query('INSERT INTO auth.users VALUES ($1);', [id]);
    await db.query('INSERT INTO tyaga.profiles (id, stripe_connect_account_id) VALUES ($1, $2);',
      [id, id === ids.seller ? (options.noAccount ? null : 'acct_seller') : null]);
  }
  await db.query('INSERT INTO tyaga.items (id, user_id) VALUES ($1,$2)', [ids.item, ids.seller]);
  await db.query(`INSERT INTO tyaga.annonces (id, item_id, user_id, title, description, price_cents, status)
    VALUES ($1,$2,$3,'Test','Test',10000,'published')`, [ids.annonce, ids.item, ids.seller]);
  await db.query(`INSERT INTO tyaga.marketplace_orders
    (id,annonce_id,item_id,buyer_id,seller_id,amount_cents,commission_pct,commission_amount_cents,
     net_amount_cents,status,escrow_status,stripe_payment_intent_id,stripe_transfer_id)
    VALUES ($1,$2,$3,$4,$5,10000,10,$6,$7,$8,$9,$10,$11)`,
    [ids.order,ids.annonce,ids.item,ids.buyer,ids.seller,
      options.commission ?? 1000,options.net ?? 9000,options.status ?? 'delivered',
      options.escrow ?? 'held', options.noPayment ? null : 'pi_test',options.receipt ?? null]);
  await db.query(`INSERT INTO tyaga.referrals (referrer_id, referred_id, code) VALUES ($1,$2,'TY-ABC123')`,
    [ids.referrer,ids.seller]);
  if (options.sale) await db.query(`INSERT INTO tyaga.ventes
    (order_id,seller_id,gross_amount_cents,commission_amount_cents,net_amount_cents,fiscal_year)
    VALUES ($1,$2,10000,1000,9000,2026)`, [ids.order,ids.seller]);
  if (options.migrate !== false) {
    await db.exec(migration);
    if (options.refundMigration !== false) await db.exec(refundMigration);
  }
  return db;
}

export function storeFor(db, controls = {}) {
  return { async rpc(name, args) {
    if (name === controls.failBeforeRpc) {
      controls.failBeforeRpc = null; return { data: null, error: { code: 'injected_before_rpc' } };
    }
    if (name === 'record_order_transfer' && controls.receiptFails) {
      controls.receiptFails = false; return { data: null, error: { code: 'receipt_unavailable' } };
    }
    try {
      let data;
      await db.transaction(async tx => {
        await tx.exec('SET LOCAL ROLE service_role');
        let row;
        if (name === 'prepare_order_settlement') {
          row = await tx.query('SELECT tyaga.prepare_order_settlement($1,$2) AS value', [args.p_order,args.p_buyer]);
        } else if (name === 'record_order_transfer') {
          row = await tx.query('SELECT tyaga.record_order_transfer($1,$2::jsonb) AS value', [args.p_order,JSON.stringify(args.p_transfer)]);
        } else if (name === 'prepare_order_refund') {
          row = await tx.query('SELECT tyaga.prepare_order_refund($1,$2,$3,$4,$5,$6) AS value',
            [args.p_payment_intent,args.p_charge,args.p_amount,args.p_refunded,args.p_currency,args.p_full]);
        } else if (name === 'claim_order_reversal') {
          row = await tx.query('SELECT tyaga.claim_order_reversal($1,$2) AS value', [args.p_order,args.p_transfer]);
        } else if (name === 'record_order_reversal') {
          row = await tx.query('SELECT tyaga.record_order_reversal($1,$2::jsonb) AS value', [args.p_order,JSON.stringify(args.p_transfer)]);
        } else throw new Error(`Unexpected RPC ${name}`);
        data = row.rows[0].value;
      });
      if (name === 'prepare_order_settlement' && controls.prepareResponseLost) {
        controls.prepareResponseLost = false; return { data: null, error: { code: 'response_lost' } };
      }
      if (name === 'record_order_transfer' && controls.receiptResponseLost) {
        controls.receiptResponseLost = false; return { data: null, error: { code: 'response_lost' } };
      }
      if (name === controls.loseAfterRpc) {
        controls.loseAfterRpc = null; return { data: null, error: { code: 'injected_after_commit' } };
      }
      return { data, error: null };
    } catch (error) { return { data: null, error: { code: error.code ?? 'test_error' } }; }
  } };
}

export function transfersFor(controls = {}) {
  const calls = { creates: [], lists: [], receipts: [] };
  return { calls, getTransfers: () => ({
    async create(args, options) {
      calls.creates.push({ args, options });
      if (controls.beforeCreate) await controls.beforeCreate();
      if (controls.failBeforeApply) throw new Error('definite test rejection');
      const transfer = { ...args, id: `tr_test${calls.creates.length}`, reversed: false, amount_reversed: 0 };
      calls.receipts.push(transfer);
      if (controls.afterApply) await controls.afterApply();
      if (controls.responseLost) { controls.responseLost = false; throw new Error('response lost after apply'); }
      return transfer;
    },
    async list(args) {
      calls.lists.push(args);
      if (controls.beforeList) await controls.beforeList();
      if (controls.listFails) throw new Error('read unavailable');
      return { data: [...calls.receipts], has_more: false };
    },
  }) };
}
