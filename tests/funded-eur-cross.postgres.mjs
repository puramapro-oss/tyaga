// Run with the pinned PAY test migration and evidence fixture supplied independently.
// This suite owns a password-protected localhost PostgreSQL cluster. It never accepts a remote database.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { Client } = createRequire(import.meta.url)('pg');
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const tenant = 'fixture-tyaga-fr';
const operator = 'fixture-eur-operator';
const funding = 'fixture-reward-200';
const basket = 'fixture-2-sellers';
const buyer = randomUUID();
const sellers = [randomUUID(), randomUUID()];
const sources = {};
const clients = [];
const summary = { currency: 'EUR', unit: 'cent', payEvidence: 'isolated operator fixture', sources, checks: {} };
const temporary = await mkdtemp(join(tmpdir(), 'tyaga-funded-cross-'));
const password = randomBytes(24).toString('hex');
const portProbe = createServer();
await new Promise((ok,no) => portProbe.once('error',no).listen(0,'127.0.0.1',ok));
const port = portProbe.address().port;
await new Promise(ok => portProbe.close(ok));
let started = false;
function postgres(name,args) {
  const command = process.env.PG_BIN_DIR ? join(process.env.PG_BIN_DIR,name) : name;
  execFileSync(command,args,{encoding:'utf8', stdio:['ignore','pipe','pipe'],env:{...process.env,LC_ALL:'C'}});
}
async function connect(role, database = 'tyaga_test_funded_cross') {
  const c = new Client({ host:'127.0.0.1', port, user:'postgres', password, database,
    statement_timeout:10000, connectionTimeoutMillis:5000 });
  await c.connect(); clients.push(c);
  if (role) await c.query('SET ROLE '+role);
  return c;
}
async function load(admin, name, path) {
  const bytes = await readFile(path);
  sources[name] = createHash('sha256').update(bytes).digest('hex');
  await admin.query(bytes.toString('utf8'));
}
const scalar = async (client,sql,args) => Object.values((await client.query(sql,args)).rows[0])[0];
async function seedOrder(admin,seller,price,fee,route='pay_test') {
  const item = randomUUID(), listing = randomUUID(), order = randomUUID();
  await admin.query('INSERT INTO tyaga.items(id,user_id) VALUES($1,$2)', [item,seller]);
  await admin.query(`INSERT INTO tyaga.annonces(id,user_id,item_id,title,description,price_cents,status,user_validated,published_at,fee_policy)
    VALUES($1,$2,$3,'Fixture','Test isolé', $4,'published',true,now(),'fr_p2p_test_v3')`,[listing,seller,item,price]);
  await admin.query(`INSERT INTO tyaga.marketplace_orders(id,annonce_id,item_id,buyer_id,seller_id,amount_cents,
    commission_pct,commission_amount_cents,net_amount_cents,shipping_address,fee_policy,item_amount_cents,buyer_fee_cents,funding_route)
    VALUES($1,$2,$3,$4,$5,$6,0,0,$7,'{"country":"FR"}','fr_p2p_test_v3',$7,$8,$9)`,
    [order,listing,item,buyer,seller,price+fee,price,fee,route]);
  return {orderId:order,sellerId:seller,amountCents:price+fee};
}
async function setup(admin) {
  await admin.query(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE ROLE authenticator;
    CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA extensions;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
    CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);
    CREATE TABLE storage.objects(bucket_id text,name text);
    CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;`);
  for (const path of ['schema.sql','sql/digital-listings.sql','sql/20261122-order-settlement.sql','sql/20261122-order-refund.sql',
    'sql/physical-sale-fee-v2.sql','sql/physical-sale-fee-v3.sql','sql/20261125-checkout-cancellation.sql']) {
    await load(admin,path,join(root,path));
  }
}
async function run() {
  const control = await connect(undefined,'postgres');
  await control.query('CREATE DATABASE tyaga_test_funded_cross');
  const admin = await connect();
  summary.pg = (await admin.query('SHOW server_version')).rows[0].server_version;
  await setup(admin);
  await exercise(admin);
}

try {
  const data = join(temporary,'pg');
  const pw = join(temporary,'password');
  await writeFile(pw,password+'\n',{mode:0o600});
  postgres('initdb',['-D',data,'--username=postgres','--auth=scram-sha-256','--pwfile='+pw,'--encoding=UTF8','--no-locale']);
  postgres('pg_ctl',['-D',data,'-l',join(temporary,'postgres.log'),'-o',`-c unix_socket_directories='' -c listen_addresses=127.0.0.1 -p ${port}`,'-w','start']);
  started = true;
  await run();
  console.log(JSON.stringify(summary,null,2));
} finally {
  try { await Promise.allSettled(clients.map(c => c.end())); }
  finally {
    if (started) postgres('pg_ctl',['-D',join(temporary,'pg'),'-m','immediate','-w','stop']);
    await rm(temporary,{recursive:true,force:true});
  }
}

async function exercise(admin) {
  const payPath=process.env.PAY_EUR_TEST_PATH;
  assert.ok(payPath,'Set PAY_EUR_TEST_PATH to the canonical PAY qa/funded-eur directory');
  for (const f of ['source.fixture.sql','allocations.sql']) await load(admin,'PAY/'+f,join(payPath,f));
  await load(admin,'sql/test-funded-order-lines.sql',join(root,'sql/test-funded-order-lines.sql'));
  await admin.query("ALTER DATABASE tyaga_test_funded_cross SET tyaga.funded_order_tenant = 'fixture-tyaga-fr'");
  const [market,pay,pay2,issuer,publicClient] = await Promise.all(
    ['service_role','purama_pay_test_server','purama_pay_test_server','purama_pay_test_operator','authenticated'].map(r=>connect(r)));
  for (const [index,uid] of [buyer,...sellers].entries()) {
    await admin.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[uid,uid+'@example.invalid']);
    await admin.query("INSERT INTO tyaga_fee.pilot_sellers(seller_id,qualification_ref) VALUES($1,'fixture-qualified-fr')",[uid]);
    if (index>0) await admin.query('UPDATE tyaga.profiles SET stripe_connect_account_id=$2 WHERE id=$1',[uid,'acct_testSeller'+index]);
  }
  const offerA = await seedOrder(admin,sellers[0],11616,383);
  const offerB = await seedOrder(admin,sellers[1],7734,267);
  summary.testReferences={tenant,buyer,funding,basket,
    a:{...offerA,sellerTransfer:'fixture-transfer-a',sellerReversal:'fixture-reversal-a',buyerRefund:'fixture-buyer-return-a'},
    b:{...offerB,sellerTransfer:'fixture-transfer-b'}};
  const regular=await seedOrder(admin,sellers[1],7734,267,'stripe');
  const ids=[offerA.orderId,offerB.orderId,regular.orderId];
  const customerView=async (viewer, orderIds=ids)=>{
    await publicClient.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[viewer]);
    return (await publicClient.query('SELECT * FROM tyaga.my_test_funded_orders($1::uuid[]) ORDER BY order_id',[orderIds])).rows;
  };
  const waiting=await customerView(buyer);
  assert.deepEqual(waiting.map(r=>r.order_id).sort(),ids.slice(0,2).sort());
  const fields=['order_id','pay_status','seller_status','reconciliation_status','funded_cents','buyer_due_cents'];
  for(const row of waiting){
    assert.deepEqual(Object.keys(row).sort(),[...fields].sort());
    assert.deepEqual([row.pay_status,row.funded_cents,row.buyer_due_cents],['awaiting_funding',null,null]);
  }
  const raceA = await seedOrder(admin,sellers[0],11616,383);
  const raceB = await seedOrder(admin,sellers[1],11616,383);
  const marketRead = o=>scalar(market,'SELECT tyaga.read_test_funded_order_line($1,$2,$3)',[o.orderId,buyer,o.sellerId]);
  const payRead = (o,t=tenant,id=buyer)=>scalar(pay,'SELECT purama_pay_test.read_eur_line($1,$2,$3,$4)',[t,id,o.orderId,o.sellerId]);
  const reserve = (db,ref,lines)=>scalar(db,'SELECT purama_pay_test.reserve_eur_basket($1,$2,$3,$4,$5::jsonb)',
    [tenant,buyer,funding,ref,JSON.stringify(lines)]);
  const available = async()=>Number(await scalar(admin,`SELECT f.amount_cents-coalesce((SELECT sum(l.amount_cents) FROM purama_pay_test.line l
    JOIN purama_pay_test.basket b USING(tenant_id,basket_ref) WHERE b.tenant_id=f.tenant_id AND b.funding_ref=f.funding_ref
    AND l.status IN ('reserved','captured')),0) FROM purama_pay_test_source.funding f WHERE f.tenant_id=$1 AND f.funding_ref=$2`,[tenant,funding]));
  const transition = (name,o,db=pay)=>scalar(db,`SELECT purama_pay_test.${name}_eur_line($1,$2,$3,$4)`,[tenant,buyer,o.orderId,o.sellerId]);
  const reconcile = (o, amount=o.amountCents)=>scalar(market,'SELECT tyaga.reconcile_test_funded_order_line($1,$2,$3,$4,$5,$6,$7)',
    [tenant,buyer,o.orderId,o.sellerId,funding,basket,amount]);
  const blocked = async (fn, predicate) => assert.rejects(fn,predicate);
  await issuer.query(`INSERT INTO purama_pay_test_source.funding
    (tenant_id,buyer_id,operator_account,funding_ref,evidence_ref,amount_cents,currency,environment,finalized,dedicated)
    VALUES($1,$2,$3,$4,'fixture-received-200',20000,'EUR','test',true,true)`,[tenant,buyer,operator,funding]);
  assert.equal(await available(),20000);
  summary.checks.initialDedicatedCents=20000;
  for (const o of [offerA,offerB,raceA,raceB]) {
    const source=await marketRead(o);
    assert.ok(source,'TYAGA source quote required');
    const gross = source.gross_cents;
    assert.equal(gross,o.amountCents);
    await issuer.query(`INSERT INTO purama_pay_test_source.orders
      (tenant_id,buyer_id,seller_id,order_id,operator_account,quote_ref,amount_cents,currency,environment,accepted)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'EUR','test',true)`,[tenant,buyer,o.sellerId,o.orderId,operator,'fixture-offer-quote',gross]);
  }
  // Hold the genuine funding row while two independent server connections contend.
  await admin.query('BEGIN');
  await admin.query('SELECT 1 FROM purama_pay_test_source.funding WHERE tenant_id=$1 AND funding_ref=$2 FOR UPDATE',[tenant,funding]);
  const observed = await connect();
  const outcomes = Promise.allSettled([reserve(pay,'race-a',[raceA]),reserve(pay2,'race-b',[raceB])]);
  let queued = 0;
  try {
    for(let i=0;i<100 && queued<2;i++){
      queued=Number(await scalar(observed,"SELECT count(*) FROM pg_stat_activity WHERE pid=ANY($1::int[]) AND wait_event_type='Lock'",[[pay.processID,pay2.processID]]));
      if(queued<2) await new Promise(ok=>setTimeout(ok,20));
    }
  }finally{await admin.query('COMMIT');}
  const settled=await outcomes;
  assert.equal(queued,2);
  assert.equal(settled.filter(r=>r.status==='fulfilled').length,1);
  assert.match(settled.find(r=>r.status==='rejected').reason.message,/insufficient/);
  assert.equal(await available(),8001);
  const accepted = settled[0].status==='fulfilled'?raceA:raceB;
  assert.equal((await transition('release',accepted)).status,'released');
  assert.equal(await available(),20000);
  const released = await scalar(market,'SELECT tyaga.reconcile_test_funded_order_line($1,$2,$3,$4,$5,$6,$7)',
    [tenant,buyer,accepted.orderId,accepted.sellerId,funding,accepted===raceA?'race-a':'race-b',accepted.amountCents]);
  assert.deepEqual([released.reconciliation_status,released.active_funded_cents,released.buyer_due_cents],['released',0,null]);
  summary.checks.releasedBeforeCapture={status:released.reconciliation_status,active:released.active_funded_cents,due:released.buyer_due_cents};
  summary.checks.race={concurrentPostgresBackends:2,observedBlocked:queued,accepted:1,refused:1,restoredCents:20000};
  await reserve(pay,basket,[offerA,offerB]);
  await reserve(pay,basket,[offerB,offerA]);
  assert.equal(await available(),0);
  assert.equal(await payRead(offerA,'other-tenant'),null);
  assert.equal(await payRead(offerA,tenant,randomUUID()),null);
  await blocked(()=>transition('capture',{...offerA,sellerId:sellers[1]}));
  await blocked(()=>transition('capture',offerA,publicClient),e=>e.code==='42501');
  await blocked(()=>reserve(pay,basket,[{...offerA,amountCents:offerA.amountCents-1},offerB]));
  await blocked(()=>admin.query('UPDATE tyaga.marketplace_orders SET seller_id=$2 WHERE id=$1',[offerA.orderId,sellers[1]]));
  await blocked(()=>admin.query('UPDATE tyaga.marketplace_orders SET amount_cents=amount_cents-1 WHERE id=$1',[offerA.orderId]));
  for (const o of [offerA,offerB]) {
    const capture=await transition('capture',o); assert.equal(capture.status,'captured');assert.equal(capture.amountCents,o.amountCents);
    await reconcile(o);
  }
  await blocked(()=>reconcile(offerA,offerA.amountCents-1));
  assert.equal((await payRead(offerB)).status,'captured');
  await finishScenario({admin,issuer,market,pay,offerA,offerB,available,payRead,marketRead,reconcile,blocked,transition});
  const buyerView=await customerView(buyer);
  const rowA=buyerView.find(row=>row.order_id===offerA.orderId);
  const rowB=buyerView.find(row=>row.order_id===offerB.orderId);
  assert.deepEqual([rowA.pay_status,rowA.seller_status,rowA.reconciliation_status,rowA.buyer_due_cents],
    ['refunded','reversed','returned',null]);
  assert.deepEqual([rowB.pay_status,rowB.seller_status,rowB.reconciliation_status,rowB.funded_cents,rowB.buyer_due_cents],
    ['captured','confirmed','seller_confirmed',8001,0]);
  assert.deepEqual(await customerView(sellers[0]),[rowA]);
  assert.deepEqual(await customerView(sellers[1]),[rowB]);
  assert.deepEqual(await customerView(randomUUID()),[]);
  assert.deepEqual(await customerView(''),[]);
  await customerView(buyer);
  await blocked(()=>scalar(publicClient,'SELECT tyaga.read_test_funded_order_line($1,$2,$3)',[offerA.orderId,buyer,offerA.sellerId]),
    e=>e.code==='42501');
  await admin.query('ALTER DATABASE tyaga_test_funded_cross RESET tyaga.funded_order_tenant');
  assert.deepEqual(await customerView(buyer),[]);
  summary.checks.userProjection={buyer:buyerView.length,sellerA:1,sellerB:1,other:0,regularStripe:0,
    disabledTenant:0,initialStatus:waiting[0].pay_status,allowedFields:fields};
}

async function finishScenario({admin,issuer,market,pay,offerA,offerB,available,payRead,marketRead,reconcile,blocked,transition}) {
  const a=await marketRead(offerA), b=await marketRead(offerB);
  const browserOnly=await connect('authenticated');
  const witness=(o,source,kind,ref,net,original=null,amount=o.amountCents,db=issuer)=>
    scalar(db,'SELECT tyaga.record_test_funded_order_transfer($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
      [tenant,buyer,o.orderId,o.sellerId,funding,basket,amount,kind,ref,source.seller_account,net,'EUR',original]);
  await blocked(()=>witness(offerA,a,'seller_transfer','fixture-service-self-credit',a.seller_net_cents,null,offerA.amountCents,market),
    e=>e.code==='42501');
  await blocked(()=>witness(offerA,{...a,seller_account:b.seller_account},'seller_transfer','fixture-wrong-account',a.seller_net_cents),
    e=>e.code==='23514');
  for(const [o,q,ref] of [[offerA,a,'fixture-transfer-a'],[offerB,b,'fixture-transfer-b']]) {
    const confirmed=await witness(o,q,'seller_transfer',ref,q.seller_net_cents);
    assert.equal(confirmed.seller_status,'confirmed');
    assert.equal(confirmed.seller_transfer_ref,ref);
    assert.deepEqual(await witness(o,q,'seller_transfer',ref,q.seller_net_cents),confirmed);
  }
  await blocked(()=>witness(offerA,a,'seller_reversal','fixture-reversal-a',a.seller_net_cents,'fixture-transfer-b'),e=>e.code==='23514');
  await blocked(()=>transition('refund',offerA),e=>/refund|proof|evidence/i.test(e.message));
  assert.equal(await available(),0);
  // A verified operator may advance a customer's refund before collecting from
  // the seller. The buyer's money and the seller's outstanding claim must differ.
  await admin.query('BEGIN');
  try {
    await admin.query('SET LOCAL ROLE purama_pay_test_operator');
    await admin.query(`INSERT INTO purama_pay_test_source.refunds(tenant_id,buyer_id,seller_id,order_id,operator_account,
      funding_ref,evidence_ref,amount_cents,currency,environment,finalized)
      VALUES ($1,$2,$3,$4,$5,$6,'fixture-operator-advance-a',$7,'EUR','test',true)`,
      [tenant,buyer,offerA.sellerId,offerA.orderId,operator,funding,offerA.amountCents]);
    await admin.query('SET LOCAL ROLE purama_pay_test_server');
    const credit=await transition('refund',offerA,admin);
    assert.equal(credit.status,'refunded');
    await admin.query('SET LOCAL ROLE service_role');
    const outstanding=await scalar(admin,'SELECT tyaga.reconcile_test_funded_order_line($1,$2,$3,$4,$5,$6,$7)',
      [tenant,buyer,offerA.orderId,offerA.sellerId,funding,basket,offerA.amountCents]);
    assert.deepEqual([outstanding.buyer_funds_status,outstanding.seller_status,outstanding.reconciliation_status],
      ['refunded','confirmed','review']);
    summary.checks.operatorAdvanceBeforeSellerRecovery={buyer:outstanding.buyer_funds_status,
      seller:outstanding.seller_status,reconciliation:outstanding.reconciliation_status};
  } finally { await admin.query('ROLLBACK'); }
  assert.equal(await available(),0);
  const reversal=await witness(offerA,a,'seller_reversal','fixture-reversal-a',a.seller_net_cents,'fixture-transfer-a');
  assert.equal(reversal.seller_status,'reversed');
  assert.equal(reversal.seller_reversal_ref,'fixture-reversal-a');
  // Operator fixture certifies the buyer's entire amount after observing the seller reversal.
  // This is a separate piece of evidence because the seller amount excludes the buyer fee.
  assert.equal((await marketRead(offerA)).gross_cents,offerA.amountCents);
  await issuer.query(`INSERT INTO purama_pay_test_source.refunds(tenant_id,buyer_id,seller_id,order_id,operator_account,
    funding_ref,evidence_ref,amount_cents,currency,environment,finalized)
    VALUES($1,$2,$3,$4,$5,$6,'fixture-buyer-return-a',$7,'EUR','test',true)`,
  [tenant,buyer,offerA.sellerId,offerA.orderId,operator,funding,offerA.amountCents]);
  const first=await transition('refund',offerA);
  const replay=await transition('refund',offerA);
  assert.deepEqual(replay,first);
  assert.equal(await available(),11999);
  const afterA=await reconcile(offerA), afterB=await reconcile(offerB);
  assert.deepEqual([afterA.buyer_funds_status,afterA.seller_status,afterA.seller_net_cents,afterA.buyer_fee_cents],
    ['refunded','reversed',11616,383]);
  assert.deepEqual([afterB.buyer_funds_status,afterB.seller_status,afterB.seller_net_cents,afterB.buyer_fee_cents],
    ['captured','confirmed',7734,267]);
  assert.equal((await payRead(offerA)).refundEvidenceRef,'fixture-buyer-return-a');
  assert.equal((await payRead(offerB)).refundEvidenceRef,null);
  assert.equal(afterA.reconciliation_status,'returned');
  assert.equal(afterB.reconciliation_status,'seller_confirmed');
  assert.equal(afterA.source_operator_account,operator);
  await blocked(()=>scalar(browserOnly,'SELECT tyaga.read_test_funded_order_line($1,$2,$3)',[offerA.orderId,buyer,offerA.sellerId]),e=>e.code==='42501');
  const evidence=(await admin.query('SELECT kind,count(*)::int AS n FROM tyaga_fee.funded_order_receipts GROUP BY kind ORDER BY kind')).rows;
  assert.deepEqual(evidence,[{kind:'seller_reversal',n:1},{kind:'seller_transfer',n:2}]);
  summary.checks.beforeRefund=[{gross:11999,net:11616,fee:383},{gross:8001,net:7734,fee:267}];
  summary.checks.afterRefund={available:await available(),a:{funds:afterA.buyer_funds_status,seller:afterA.seller_status},
    b:{funds:afterB.buyer_funds_status,seller:afterB.seller_status},evidence,sameRefundOnReplay:true};
  const mixedOrder=await seedOrder(admin,sellers[0],11616,383);
  const mixedQuote=await marketRead(mixedOrder);
  const partial=10000, partialFunding='fixture-partial-funding', partialBasket='fixture-mixed';
  await issuer.query(`INSERT INTO purama_pay_test_source.funding
    (tenant_id,buyer_id,operator_account,funding_ref,evidence_ref,amount_cents,currency,environment,finalized,dedicated)
    VALUES($1,$2,$3,$4,'fixture-funded-100',10000,'EUR','test',true,true)`,[tenant,buyer,operator,partialFunding]);
  // This offer authorizes a 100.00 EUR PAY contribution on a 119.99 EUR merchant order.
  await issuer.query(`INSERT INTO purama_pay_test_source.orders
    (tenant_id,buyer_id,seller_id,order_id,operator_account,quote_ref,amount_cents,currency,environment,accepted)
    VALUES ($1,$2,$3,$4,$5,'fixture-mixed-quote',$6,'EUR','test',true)`,
    [tenant,buyer,mixedOrder.sellerId,mixedOrder.orderId,operator,partial]);
  await scalar(pay,'SELECT purama_pay_test.reserve_eur_basket($1,$2,$3,$4,$5)',
    [tenant,buyer,partialFunding,partialBasket,JSON.stringify([{...mixedOrder,amountCents:partial}])]);
  await transition('capture',mixedOrder);
  const partialArgs=[tenant,buyer,mixedOrder.orderId,mixedOrder.sellerId,partialFunding,partialBasket,partial];
  await blocked(()=>scalar(issuer,'SELECT tyaga.record_test_funded_order_transfer($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
    [...partialArgs,'seller_transfer','fixture-mixed-no-card',mixedQuote.seller_account,mixedQuote.seller_net_cents,'EUR',null]),
    e=>e.code==='23514' && e.message.includes('additional collection'));
  const mixed=await scalar(market,'SELECT tyaga.reconcile_test_funded_order_line($1,$2,$3,$4,$5,$6,$7)',partialArgs);
  assert.deepEqual([mixed.status,mixed.buyer_due_cents,mixed.seller_status,mixed.seller_transfer_ref],
    ['pending',1999,'unconfirmed',null]);
  assert.equal(await available(),11999);
  summary.checks.mixedWithoutCard={gross:mixed.gross_cents,pay:mixed.funded_cents,owed:mixed.buyer_due_cents,
    order:mixed.status,seller:mixed.seller_status,transfer:mixed.seller_transfer_ref};
  // A well-funded grant still cannot pay fees outside the attested quote.
  const feeOffer=await seedOrder(admin,sellers[1],7734,267);
  await issuer.query(`INSERT INTO purama_pay_test_source.funding(tenant_id,buyer_id,operator_account,funding_ref,evidence_ref,
      amount_cents,currency,environment,finalized,dedicated) VALUES($1,$2,$3,'fixture-fees','fixture-rich',8001,'EUR','test',true,true)`,
    [tenant,buyer,operator]);
  await issuer.query(`INSERT INTO purama_pay_test_source.orders(tenant_id,buyer_id,seller_id,order_id,operator_account,
      quote_ref,amount_cents,currency,environment,accepted) VALUES($1,$2,$3,$4,$5,'fixture-product-only',7734,'EUR','test',true)`,
    [tenant,buyer,feeOffer.sellerId,feeOffer.orderId,operator]);
  const tryFees=(amountCents)=>scalar(pay,'SELECT purama_pay_test.reserve_eur_basket($1,$2,$3,$4,$5)',
    [tenant,buyer,'fixture-fees','fixture-item-only',JSON.stringify([{...feeOffer,amountCents}])]);
  await blocked(()=>tryFees(8001),e=>e.message.includes('order evidence unavailable'));
  assert.equal(await payRead(feeOffer),null);
  await tryFees(7734);
  assert.equal((await transition('capture',feeOffer)).amountCents,7734);
  const feeProjection=await scalar(market,'SELECT tyaga.reconcile_test_funded_order_line($1,$2,$3,$4,$5,$6,$7)',
    [tenant,buyer,feeOffer.orderId,feeOffer.sellerId,'fixture-fees','fixture-item-only',7734]);
  assert.deepEqual([feeProjection.buyer_due_cents,feeProjection.seller_status],[267,'unconfirmed']);
  summary.checks.productOnlyQuote={availableGrant:8001,authorizedProduct:7734,attemptWithFees:8001,
    unauthorizedGross:'rejected',due:feeProjection.buyer_due_cents,seller:feeProjection.seller_status};
  summary.boundaries={money:'synthetic dedicated source receipt in test EUR',database:'native PostgreSQL',
    merchant:'private acknowledgement of fixture transfers and one reversal',providerPayments:'not executed'};
}
