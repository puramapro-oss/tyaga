// Optional integration suite. Install the pg client and put PostgreSQL 15+ initdb
// and pg_ctl on PATH (or set PG_BIN_DIR). An external, canonical PAY schema is
// needed for the full suite: PAY_SCHEMA_PATH=/path/to/schema.sql node tests/promotion-points-pilot.postgres.mjs
// Every execution creates its own localhost-only, password-protected cluster.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const { Client } = createRequire(import.meta.url)('pg');
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const externalPaySchema = process.env.PAY_SCHEMA_PATH && await readFile(process.env.PAY_SCHEMA_PATH);
if (externalPaySchema) {
  assert.equal(createHash('sha256').update(externalPaySchema).digest('hex'),
    '1c8a2b8b5ad5ea4cdacc9e70fd74c9c4e68ddc40cf47a86cb659626fe987e688', 'Expected the audited PAY schema at 03edd69');
}
const dir = await mkdtemp(join(tmpdir(), 'tyaga-points-postgres-'));
const data = join(dir, 'data');
const password = randomBytes(32).toString('hex');
const clients = [];
let running = false;
const host = '127.0.0.1';
const reservePort = createServer();
await new Promise((resolve,reject) => reservePort.once('error',reject).listen(0,host,resolve));
const port = reservePort.address().port;
await new Promise(resolve => reservePort.close(resolve));
const dbname = 'tyaga_points_test';
const command = (name, args) => execFileSync(process.env.PG_BIN_DIR ? join(process.env.PG_BIN_DIR,name) : name,
  args, { encoding:'utf8', env:{ PATH:process.env.PATH, LC_ALL:'C' }, stdio:['ignore','pipe','pipe'] });
async function connect(database=dbname, role) {
  const c = new Client({ host,port,user:'postgres',password,database,ssl:false,statement_timeout:15000,connectionTimeoutMillis:4000 });
  await c.connect();
  clients.push(c);
  if (role === 'service_role') await c.query('SET ROLE service_role');
  if (role === 'authenticated') await c.query('SET ROLE authenticated');
  return c;
}
async function value(client, sql, params=[]) {
  const result = await client.query(sql,params);
  return Object.values(result.rows[0])[0];
}
const denied = code => err => err.code === code;
const quote = (c, owner, listing) => value(c,'SELECT tyaga.promotion_points_test_quote($1,$2)',[listing,owner]);
const purchase = (c, owner, listing, tariff, key) => value(c,'SELECT tyaga.purchase_promotion_with_test_points($1,$2,$3,$4)',[listing,owner,tariff,key]);
const refund = (c, owner, key) => value(c,'SELECT tyaga.refund_promotion_test_points($1,$2)',[owner,key]);
const receipt = (c, owner, listing, tariff, key) => value(c,'SELECT tyaga.promotion_points_test_receipt($1,$2,$3,$4)',[listing,owner,tariff,key]);
const balance = (c, owner) => value(c,'SELECT balance FROM purama_pay.points_wallets WHERE user_id=$1',[owner]);
const transactions = async (c,owner) => (await c.query(`SELECT t.id,t.type,t.amount FROM purama_pay.points_transactions t
  JOIN purama_pay.points_wallets w ON w.id=t.wallet_id WHERE w.user_id=$1 AND t.type IN ('debit_catalog','reversal')`,[owner])).rows;

// Holding the tariff row observes two independent PostgreSQL backends queued
// inside the purchase RPC before releasing them to resolve the race.
async function compete(admin, observer, workers, tariff, requests) {
  assert.equal(new Set(workers.map(c => c.processID)).size,2);
  await admin.query('BEGIN');
  let results;
  try {
    await admin.query('SELECT 1 FROM tyaga_promotion.points_pilot_offers WHERE tariff_id=$1 FOR UPDATE',[tariff]);
    results = Promise.allSettled(workers.map((c,i) => purchase(c,...requests[i])));
    let waiting = 0;
    for (let i=0;i<150 && waiting<2;i++) {
      waiting=await value(observer,"SELECT count(*)::int FROM pg_stat_activity WHERE wait_event_type='Lock' AND pid=ANY($1::int[])",[workers.map(c=>c.processID)]);
      if (waiting<2) await delay(20);
    }
    assert.equal(waiting,2,'Both backends must have reached the lock before the race');
  } finally { await admin.query('ROLLBACK'); }
  return results;
}

async function exercise() {
  const control = await connect('postgres');
  await control.query('CREATE DATABASE tyaga_points_test');
  const admin = await connect();
  await admin.query(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE ROLE authenticator;
    CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA extensions;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
    CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);
    CREATE TABLE storage.objects(bucket_id text,name text);
    CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;`);
  for (const name of ['schema.sql','sql/digital-listings.sql','sql/listing-promotions.sql','sql/promotion-points-pilot.sql']) {
    await admin.query(await readFile(join(root,name),'utf8'));
  }
  const [first,second,browser,observer] = await Promise.all([connect(dbname,'service_role'),connect(dbname,'service_role'),connect(dbname,'authenticated'),connect()]);
  const [alice,bob,poor] = Array.from({length:3},()=>({owner:randomUUID(),listing:randomUUID(),item:randomUUID()}));
  const tariff='synthetic_inventory';
  const key=randomUUID();
  await admin.query("ALTER DATABASE tyaga_points_test SET tyaga.promotion_points_environment='isolated_test'");
  assert.equal(await quote(first,alice.owner,alice.listing),null);
  await assert.rejects(purchase(first,alice.owner,alice.listing,tariff,key),denied('23514'));
  await assert.rejects(purchase(browser,alice.owner,alice.listing,tariff,key),denied('42501'));
  console.log('PASS missing PAY backend and browser purchase permission');
  if (!externalPaySchema) {
    console.log('NON TESTÉ native PAY movements: set PAY_SCHEMA_PATH to the independently supplied canonical schema');
    return;
  }
  await admin.query(externalPaySchema.toString('utf8'));
  await admin.query('ALTER DATABASE tyaga_points_test RESET tyaga.promotion_points_environment');
  await first.query("SET tyaga.promotion_points_environment='isolated_test'");
  for (const person of [alice,bob,poor]) {
    const {owner,listing,item}=person;
    await admin.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[owner,`${owner}@example.invalid`]);
    await admin.query('INSERT INTO tyaga.items(id,user_id) VALUES($1,$2)',[item,owner]);
    await admin.query(`INSERT INTO tyaga.annonces(id,item_id,user_id,title,description,price_cents,status,user_validated,published_at)
      VALUES($1,$2,$3,'Synthetic listing','Local PostgreSQL synthetic fixture',100,'published',true,now())`,[listing,item,owner]);
    await first.query("SELECT purama_pay.apply_wallet_movement($1,'earn_admin',$2,$3)",[owner,person===poor?4:100,randomUUID()]);
  }
  await admin.query(`INSERT INTO tyaga_promotion.points_pilot_offers
    (tariff_id,cost_points,duration_hours,starts_at,ends_at,reserved_quantity,inventory_ref,enabled)
    VALUES($1,12,24,now()-interval '1 hour',now()+interval '2 hours',1,$2,true)`,[tariff,randomUUID()]);
  for (const {owner} of [alice,bob,poor]) await admin.query(`INSERT INTO tyaga_promotion.points_pilot_members
    (tariff_id,actor,authorized_points,approval_ref) VALUES($1,$2,36,$3)`,[tariff,owner,randomUUID()]);
  assert.equal(await quote(first,alice.owner,alice.listing),null);
  await assert.rejects(purchase(first,alice.owner,alice.listing,tariff,key),denied('23514'));
  await admin.query("ALTER DATABASE tyaga_points_test SET tyaga.promotion_points_environment='isolated_test'");
  assert.deepEqual(await quote(first,alice.owner,alice.listing),{cost_points:12,balance_points:36,duration_hours:24,tariff_id:tariff});
  assert.equal(await quote(first,bob.owner,alice.listing),null);
  assert.equal(await quote(first,poor.owner,poor.listing),null);
  await assert.rejects(purchase(first,poor.owner,poor.listing,tariff,randomUUID()),denied('23514'));
  assert.equal(await balance(admin,poor.owner),4);
  assert.equal((await transactions(admin,poor.owner)).length,0);
  console.log('PASS opt-in database, ownership, authorized quota and insufficient wallet');

  // Force an error in the next step after the real PAY debit, on this fresh
  // cluster only. Check the canonical ledger and the stock before retrying.
  await admin.query(`CREATE FUNCTION public.fail_synthetic_grant() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'synthetic downstream error'; END $$;
    CREATE TRIGGER fail_synthetic_grant BEFORE INSERT ON tyaga_promotion.grants FOR EACH ROW EXECUTE FUNCTION public.fail_synthetic_grant()`);
  await assert.rejects(purchase(first,alice.owner,alice.listing,tariff,key),/synthetic downstream error/);
  assert.equal(await balance(admin,alice.owner),100);
  assert.deepEqual(await transactions(admin,alice.owner),[]);
  assert.equal(await value(admin,'SELECT count(*)::int FROM tyaga_promotion.points_pilot_purchases'),0);
  await admin.query('DROP TRIGGER fail_synthetic_grant ON tyaga_promotion.grants');
  const request=[alice.owner,alice.listing,tariff,key];
  const [one,two]=await compete(admin,observer,[first,second],tariff,[request,request]);
  assert.equal(one.status,'fulfilled',one.reason?.message);
  assert.equal(two.status,'fulfilled',two.reason?.message);
  assert.deepEqual(one.value,two.value);
  const grant=one.value;
  assert.equal(await balance(admin,alice.owner),88);
  assert.deepEqual(await transactions(admin,alice.owner),[{id:grant.receipt_id,type:'debit_catalog',amount:-12}]);
  assert.equal(await value(admin,'SELECT count(*)::int FROM tyaga_promotion.grants'),1);
  await assert.rejects(purchase(first,alice.owner,bob.listing,tariff,key),denied('23505'));
  console.log('PASS atomic rollback after PAY debit, concurrent retries, one debit and one entitlement');

  const firstReceipt=await receipt(first,...request);
  assert.equal(firstReceipt.receipt_id,grant.receipt_id);
  assert.equal(firstReceipt.status,'purchased');
  await admin.query("UPDATE tyaga.annonces SET status='unpublished' WHERE id=$1",[alice.listing]);
  assert.deepEqual(await receipt(first,...request),firstReceipt);
  assert.equal(await receipt(first,bob.owner,alice.listing,tariff,key),null);
  await admin.query("UPDATE tyaga.annonces SET status='published' WHERE id=$1",[alice.listing]);
  const returns=await Promise.all([refund(first,alice.owner,key),refund(second,alice.owner,key)]);
  assert.deepEqual(returns[0],returns[1]);
  assert.equal(await balance(admin,alice.owner),100);
  const history=await transactions(admin,alice.owner);
  assert.equal(history.length,2);
  assert.deepEqual(history.find(t=>t.type==='reversal'),{id:returns[0].reversal_id,type:'reversal',amount:12});
  assert.equal((await receipt(first,...request)).status,'refunded');
  await assert.rejects(purchase(first,...request),denied('23514'));
  await browser.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[alice.owner]);
  await assert.rejects(browser.query('SELECT tyaga.redeem_listing_promotion($1,$2)',[alice.listing,grant.grant_id]),/GRANT_UNAVAILABLE/);
  console.log('PASS recover receipt after withdrawal, private read, double compensation, revoked entitlement');

  const { checkPointsRouteOnPostgres } = await import('./promotion-points-pilot.api-postgres.mjs');
  await checkPointsRouteOnPostgres({ admin, service:first, browser, actor:alice.owner, listing:alice.listing, tariff });

  const contender=[alice,bob].map(p=>[p.owner,p.listing,tariff,randomUUID()]);
  const results=await compete(admin,observer,[first,second],tariff,contender);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const winner=results.findIndex(r=>r.status==='fulfilled');
  assert.equal(results[1-winner].reason.code,'23514');
  const [winnerOwner,winnerListing,,winnerKey]=contender[winner];
  const won=results[winner].value;
  assert.equal(await balance(admin,winnerOwner),88);
  assert.equal(await balance(admin,contender[1-winner][0]),100);
  assert.equal(await quote(first,winnerOwner,winnerListing),null);
  await browser.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[winnerOwner]);
  await browser.query('SELECT tyaga.redeem_listing_promotion($1,$2)',[winnerListing,won.grant_id]);
  await assert.rejects(refund(second,winnerOwner,winnerKey),denied('23514'));
  assert.equal(await value(browser,'SELECT tyaga.cancel_listing_promotion($1,$2)',[winnerListing,won.grant_id]),true);
  await assert.rejects(refund(second,winnerOwner,winnerKey),denied('23514'));
  assert.equal(await balance(admin,winnerOwner),88);
  console.log('PASS two distinct buyers racing on the last unit, redemption, cancellation after use');

  const [otherOwner,otherListing] = contender[1-winner];
  const otherLedger = await transactions(admin,otherOwner);
  await admin.query('DELETE FROM auth.users WHERE id=$1',[winnerOwner]);
  assert.equal(await value(admin,'SELECT count(*)::int FROM tyaga_promotion.points_pilot_members WHERE actor=$1',[winnerOwner]),0);
  assert.equal(await value(admin,'SELECT count(*)::int FROM tyaga_promotion.points_pilot_purchases WHERE actor=$1',[winnerOwner]),0);
  assert.equal(await value(admin,'SELECT count(*)::int FROM tyaga_promotion.grants WHERE beneficiary=$1',[winnerOwner]),0);
  assert.equal(await value(admin,'SELECT count(*)::int FROM purama_pay.points_wallets WHERE user_id=$1',[winnerOwner]),0);
  assert.equal(await value(admin,'SELECT sold_quantity FROM tyaga_promotion.points_pilot_offers WHERE tariff_id=$1',[tariff]),1);
  assert.equal(await receipt(first,...contender[winner]),null);
  await assert.rejects(purchase(first,...contender[winner]),denied('23514'));
  assert.equal(await quote(first,otherOwner,otherListing),null);
  assert.equal(await balance(admin,otherOwner),100);
  assert.deepEqual(await transactions(admin,otherOwner),otherLedger);
  console.log('PASS account deletion, no receipt replay, consumed stock retained and other wallet intact');
}
try {
  const pwfile=join(dir,'bootstrap-password');
  await writeFile(pwfile,password,{mode:0o600});
  command('initdb',['-D',data,'--auth=scram-sha-256','--username=postgres','--pwfile='+pwfile,'--encoding=UTF8','--no-locale']);
  command('pg_ctl',['-D',data,'-l',join(dir,'postgres.log'),'-w','-o',`-h ${host} -k '' -p ${port}`,'start']);
  running=true;
  await exercise();
} finally {
  await Promise.allSettled(clients.map(c=>c.end()));
  if (running) command('pg_ctl',['-D',data,'-m','fast','-w','stop']);
  await rm(dir,{recursive:true,force:true});
}
