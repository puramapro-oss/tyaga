// Run on an isolated Supabase-compatible database, after schema.sql and
// sql/listing-promotions.sql, with the pg package in the Node resolution path:
// PGDATABASE=marketplace_test node tests/listing-promotion-concurrency.mjs
// Standard PGHOST, PGUSER, PGPORT and PGPASSWORD select the test instance.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const { Client } = createRequire(import.meta.url)('pg');
if (!process.env.PGDATABASE?.endsWith('_test')) throw new Error('An isolated *_test database is required.');
const connections = [];
async function connect(user) {
  const db = new Client();
  await db.connect();
  connections.push(db);
  if (user) {
    await db.query('SET ROLE authenticated');
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [user]);
  }
  return db;
}
const owner = randomUUID();
const other = randomUUID();
const listing = randomUUID();
const secondListing = randomUUID();
const item = randomUUID();
const receipt = randomUUID();
const admin = await connect();
const lo = new Date(Date.now() - 3_600_000);
const hi = new Date(Date.now() + 3_600_000);
const issueSql = 'SELECT tyaga_promotion.issue_grant($1,$2,$3,$4,$5,$6,$7,$8) AS id';
const params = [owner, 'operator', receipt, 'campaign_benefit', 0, 24, lo, hi];
const activateSql = 'SELECT tyaga.redeem_listing_promotion($1,$2) AS ending';
const serveSql = 'SELECT tyaga.sponsored_listing($1::uuid[]) AS sponsor';
const idOf = result => result.rows[0].id;

try {
  await admin.query('INSERT INTO auth.users(id) VALUES ($1),($2)', [owner, other]);
  await admin.query('INSERT INTO tyaga.items(id,user_id) VALUES($1,$2)', [item, owner]);
  await admin.query(`INSERT INTO tyaga.annonces(id,item_id,user_id,title,description,price_cents,status,user_validated,published_at)
    VALUES ($1,$3,$4,'Fixture A','Annonce de recette',100,'published',true,now()),($2,$3,$4,'Fixture B','Annonce de recette',100,'published',true,now())`,
    [listing, secondListing, item, owner]);
  const [issuer2, first, second, stranger] = await Promise.all([connect(),connect(owner),connect(owner),connect(other)]);
  // Each Promise uses a separate backend connection. Multiple deliveries of
  // one funding receipt reserve exactly one entitlement.
  const [issued, replay] = await Promise.all([admin.query(issueSql, params), issuer2.query(issueSql,params)]);
  const grant = idOf(issued);
  assert.equal(idOf(replay), grant);
  await assert.rejects(admin.query(issueSql,[...params.slice(0,5),48,lo,hi]), /RECEIPT_CONFLICT/);
  await assert.rejects(first.query(issueSql,params), error => error.code === '42501');
  await assert.rejects(stranger.query(activateSql,[listing,grant]), /LISTING_UNAVAILABLE/);
  assert.equal((await stranger.query('SELECT * FROM tyaga.my_listing_promotions($1)',[listing])).rowCount,0);
  assert.equal((await first.query('SELECT * FROM tyaga.my_listing_promotions($1)',[listing])).rowCount,1);
  await assert.rejects(admin.query(issueSql,[owner,'one_ledger',randomUUID(),'points_receipt',0,24,lo,hi]), error => error.code==='23514');
  const expired = idOf(await admin.query(issueSql,[owner,'operator',randomUUID(),'campaign_benefit',0,24,new Date(0),lo]));
  await assert.rejects(first.query(activateSql,[listing,expired]), /GRANT_EXPIRED/);
  const foreignGrant = idOf(await admin.query(issueSql,[other,'operator',randomUUID(),'campaign_benefit',0,24,lo,hi]));
  await assert.rejects(first.query(activateSql,[listing,foreignGrant]), /GRANT_UNAVAILABLE/);

  // Two activations of the same voucher/listing have precisely the same end.
  const [one,two] = await Promise.all([first.query(activateSql,[listing,grant]),second.query(activateSql,[listing,grant])]);
  assert.deepEqual(one.rows,two.rows);
  assert.equal((await stranger.query(serveSql,[[listing,secondListing]])).rows[0].sponsor,listing);
  assert.equal((await stranger.query(serveSql,[[secondListing]])).rows[0].sponsor,null);
  assert.equal((await stranger.query(serveSql,[Array(25).fill(listing)])).rows[0].sponsor,null);
  await assert.rejects(first.query(activateSql,[secondListing,grant]), /GRANT_ALREADY_USED/);
  assert.equal((await stranger.query('SELECT tyaga.cancel_listing_promotion($1,$2) AS ok',[listing,grant])).rows[0].ok,false);
  await first.query('SELECT tyaga.cancel_listing_promotion($1,$2)',[listing,grant]);
  await first.query('SELECT tyaga.cancel_listing_promotion($1,$2)',[listing,grant]);
  assert.equal((await stranger.query(serveSql,[[listing]])).rows[0].sponsor,null);
  await assert.rejects(first.query(activateSql,[listing,grant]), /GRANT_UNAVAILABLE/);

  // Two different confirmed receipts race for one listing. Only one wins
  // and the loser's entitlement remains available.
  const receipts = ['points_receipt','eur_receipt'].map(() => randomUUID());
  const grants = [
    idOf(await admin.query(issueSql,[owner,'one_ledger',receipts[0],'points_receipt',15,24,lo,hi])),
    idOf(await admin.query(issueSql,[owner,'payment_provider',receipts[1],'eur_receipt',25,24,lo,hi])),
  ];
  // Hold the listing until both independent backends are waiting on locks.
  // This makes the replay reproducible even on a fast local database.
  await admin.query('BEGIN');
  await admin.query('SELECT id FROM tyaga.annonces WHERE id=$1 FOR UPDATE',[listing]);
  const race = Promise.allSettled([first.query(activateSql,[listing,grants[0]]),second.query(activateSql,[listing,grants[1]])]);
  let queued = false;
  try {
    for (let attempt = 0; attempt < 100 && !queued; attempt++) {
      const waiting = await issuer2.query(`SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE pid=ANY($1::int[]) AND wait_event_type='Lock'`,[[first.processID,second.processID]]);
      queued = waiting.rows[0].n === 2;
      if (!queued) await new Promise(resolve=>setTimeout(resolve,10));
    }
  } finally {
    await admin.query('ROLLBACK');
  }
  const outcomes = await race;
  assert.ok(queued, 'both sessions reached the same locked listing');
  assert.equal(outcomes.filter(outcome=>outcome.status==='fulfilled').length,1);
  assert.match(outcomes.find(outcome=>outcome.status==='rejected').reason.message,/CAMPAIGN_ALREADY_ACTIVE/);
  const winner = outcomes.findIndex(outcome=>outcome.status==='fulfilled');
  await admin.query('SELECT tyaga_promotion.revoke_grant($1,$2)',[winner === 0 ? 'one_ledger' : 'payment_provider', receipts[winner]]);
  assert.equal((await stranger.query(serveSql,[[listing]])).rows[0].sponsor,null);
  const remaining = grants[1-winner];
  await first.query(activateSql,[listing,remaining]);
  await admin.query("UPDATE tyaga.annonces SET status='unpublished' WHERE id=$1",[listing]);
  assert.equal((await stranger.query(serveSql,[[listing]])).rows[0].sponsor,null);
  const balances = await admin.query('SELECT balance_points FROM tyaga.vida_wallet WHERE user_id=ANY($1::uuid[])',[[owner,other]]);
  assert.equal(balances.rowCount,2);
  assert.ok(balances.rows.every(row => row.balance_points===0));
  console.log('PASS PostgreSQL concurrent issuance, redemption, competing receipts, permissions, expiry, cancellation, revocation, organic scope, unchanged VIDA balances');
} finally {
  try {
    await admin.query('DELETE FROM auth.users WHERE id=ANY($1::uuid[])',[[owner,other]]);
  } finally {
    await Promise.all(connections.map(db=>db.end()));
  }
}
