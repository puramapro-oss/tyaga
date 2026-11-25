-- Disposable Supabase-compatible PostgreSQL. Apply schema.sql, digital-listings,
-- order settlement, order refund and physical-sale-fee-v2 first.
BEGIN;
SET LOCAL plpgsql.check_asserts=on;
CREATE TEMP TABLE fee_fixture AS SELECT gen_random_uuid() AS seller,gen_random_uuid() AS buyer,
  gen_random_uuid() AS referrer,gen_random_uuid() AS item,gen_random_uuid() AS listing,
  gen_random_uuid() AS legacy,gen_random_uuid() AS purchase,gen_random_uuid() AS conv;
GRANT SELECT ON fee_fixture TO authenticated,service_role;
INSERT INTO auth.users(id) SELECT seller FROM fee_fixture UNION ALL SELECT buyer FROM fee_fixture UNION ALL SELECT referrer FROM fee_fixture;
INSERT INTO tyaga.items(id,user_id) SELECT item,seller FROM fee_fixture;
INSERT INTO tyaga.referrals(referrer_id,referred_id,code) SELECT referrer,seller,'fixture' FROM fee_fixture;
UPDATE tyaga.vida_wallet SET balance_points=37 WHERE user_id=(SELECT seller FROM fee_fixture);
INSERT INTO tyaga.annonces(id,user_id,item_id,title,description,price_cents,user_validated,status,published_at)
  SELECT legacy,seller,item,'Historique','Ancienne offre',1000,true,'published',now() FROM fee_fixture;

CREATE FUNCTION pg_temp.create_pilot_listing() RETURNS void LANGUAGE sql AS $$
  INSERT INTO tyaga.annonces(id,user_id,item_id,title,description,price_cents,user_validated,status,published_at,fee_policy)
    SELECT listing,seller,item,'Pilote','Nouvelle offre',1200,true,'published',now(),'fr_p2p_test_v2' FROM fee_fixture
$$;
CREATE FUNCTION pg_temp.pilot_purchase(p_price int,p_fee int,p_country text,p_policy text DEFAULT 'fr_p2p_test_v2')
RETURNS void LANGUAGE sql AS $$
  INSERT INTO tyaga.marketplace_orders(id,annonce_id,item_id,buyer_id,seller_id,amount_cents,commission_pct,
    commission_amount_cents,net_amount_cents,shipping_address,fee_policy,item_amount_cents,buyer_fee_cents)
    SELECT purchase,listing,item,buyer,seller,p_price+p_fee,0,0,p_price,jsonb_build_object('country',p_country),
      p_policy,p_price,p_fee FROM fee_fixture
$$;
CREATE FUNCTION pg_temp.expect_constraint(statement text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE statement; EXCEPTION WHEN check_violation THEN RETURN; END;
  RAISE EXCEPTION 'Expected rejection of %',statement;
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',seller::text,true) FROM fee_fixture;
DO $$ BEGIN
  ASSERT NOT tyaga.can_publish_test_fee();
  ASSERT NOT has_schema_privilege('authenticated','tyaga_fee','usage');
  PERFORM pg_temp.expect_constraint('SELECT pg_temp.create_pilot_listing()');
END $$;
RESET ROLE;
INSERT INTO tyaga_fee.pilot_sellers(seller_id,qualification_ref) SELECT seller,'fixture:seller' FROM fee_fixture;
SET LOCAL ROLE authenticated;
SELECT pg_temp.create_pilot_listing();
DO $$ BEGIN ASSERT tyaga.can_publish_test_fee(); END $$;
SELECT pg_temp.expect_constraint($q$UPDATE tyaga.annonces SET fee_policy='legacy' WHERE id=(SELECT listing FROM fee_fixture)$q$);
SELECT set_config('request.jwt.claim.sub',buyer::text,true) FROM fee_fixture;
SELECT pg_temp.expect_constraint($q$SELECT pg_temp.pilot_purchase(1200,70,'FR')$q$);
RESET ROLE;
INSERT INTO tyaga_fee.pilot_sellers(seller_id,qualification_ref) SELECT buyer,'fixture:buyer' FROM fee_fixture;
INSERT INTO tyaga.conversations(id,annonce_id,seller_id,buyer_id) SELECT conv,listing,seller,buyer FROM fee_fixture;
INSERT INTO tyaga.inbox_messages(conversation_id,sender_id,body,offer_cents) SELECT conv,buyer,'Offre',1000 FROM fee_fixture;
INSERT INTO tyaga.inbox_messages(conversation_id,sender_id,body,offer_cents) SELECT conv,seller,'Acceptée',1000 FROM fee_fixture;
-- PGlite can timestamp both synthetic inserts at the same millisecond.
-- Order the fixture explicitly, first checking the equal-time rejection.
UPDATE tyaga.inbox_messages SET created_at=timestamptz '2026-01-01 10:00:00+00'
  WHERE conversation_id=(SELECT conv FROM fee_fixture);
DO $$ BEGIN
  ASSERT (SELECT tyaga_fee.agreed_price(a,f.buyer) FROM fee_fixture f JOIN tyaga.annonces a ON a.id=f.listing)=1200;
END $$;
UPDATE tyaga.inbox_messages SET created_at=timestamptz '2026-01-01 10:01:00+00'
  WHERE conversation_id=(SELECT conv FROM fee_fixture) AND sender_id=(SELECT seller FROM fee_fixture);
DO $$ BEGIN
  ASSERT (SELECT tyaga_fee.agreed_price(a,f.buyer) FROM fee_fixture f JOIN tyaga.annonces a ON a.id=f.listing)=1000;
END $$;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_constraint($q$SELECT pg_temp.pilot_purchase(1000,0,'FR','legacy')$q$);
SELECT pg_temp.expect_constraint($q$SELECT pg_temp.pilot_purchase(900,61,'FR')$q$);
SELECT pg_temp.expect_constraint($q$SELECT pg_temp.pilot_purchase(1000,63,'FR')$q$);
SELECT pg_temp.expect_constraint($q$SELECT pg_temp.pilot_purchase(1000,64,'CH')$q$);
SELECT pg_temp.pilot_purchase(1000,64,'FR');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
DELETE FROM tyaga_fee.pilot_sellers WHERE seller_id=(SELECT buyer FROM fee_fixture);
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_constraint($q$UPDATE tyaga.marketplace_orders SET stripe_checkout_session_id='cs_test_fixture' WHERE id=(SELECT purchase FROM fee_fixture)$q$);
RESET ROLE;
INSERT INTO tyaga_fee.pilot_sellers(seller_id,qualification_ref) SELECT buyer,'fixture:buyer2' FROM fee_fixture;

SET LOCAL ROLE service_role;
SELECT pg_temp.expect_constraint($q$UPDATE tyaga.marketplace_orders SET fee_policy='legacy' WHERE id=(SELECT purchase FROM fee_fixture)$q$);
SELECT pg_temp.expect_constraint($q$UPDATE tyaga.marketplace_orders SET stripe_checkout_session_id='cs_live_fixture' WHERE id=(SELECT purchase FROM fee_fixture)$q$);
SELECT pg_temp.expect_constraint($q$UPDATE tyaga.marketplace_orders SET status='paid',escrow_status='held',stripe_payment_intent_id='pi_fixture' WHERE id=(SELECT purchase FROM fee_fixture)$q$);
UPDATE tyaga.marketplace_orders SET stripe_checkout_session_id='cs_test_fixture' WHERE id=(SELECT purchase FROM fee_fixture);
UPDATE tyaga.marketplace_orders SET status='paid',escrow_status='held',stripe_payment_intent_id='pi_fixture' WHERE id=(SELECT purchase FROM fee_fixture);
UPDATE tyaga.marketplace_orders SET status='delivered' WHERE id=(SELECT purchase FROM fee_fixture);
SELECT tyaga.prepare_order_settlement(purchase,buyer) FROM fee_fixture;
SELECT tyaga.prepare_order_settlement(purchase,buyer) FROM fee_fixture;
DO $$ BEGIN
  ASSERT EXISTS(SELECT FROM tyaga.ventes WHERE order_id=(SELECT purchase FROM fee_fixture) AND fee_policy='fr_p2p_test_v2'
    AND gross_amount_cents=1000 AND net_amount_cents=1000 AND commission_amount_cents=0);
  ASSERT EXISTS(SELECT FROM tyaga.order_settlements WHERE order_id=(SELECT purchase FROM fee_fixture) AND amount_cents=1000);
  ASSERT NOT (SELECT commission_paid FROM tyaga.referrals WHERE referred_id=(SELECT seller FROM fee_fixture));
  ASSERT (SELECT balance_points FROM tyaga.vida_wallet WHERE user_id=(SELECT seller FROM fee_fixture))=37;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',seller::text,true) FROM fee_fixture;
SELECT pg_temp.expect_constraint($q$INSERT INTO tyaga.vida_transfers(user_id,vente_id,pct,points_amount)
  SELECT v.seller_id,v.id,0,0 FROM tyaga.ventes v WHERE order_id=(SELECT purchase FROM fee_fixture)$q$);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_constraint($q$SELECT tyaga.prepare_order_refund('pi_fixture','ch_fixture',1000,1000,'eur',true)$q$);
SELECT tyaga.prepare_order_refund('pi_fixture','ch_fixture',1064,1064,'eur',true);
DO $$ BEGIN
  ASSERT (SELECT status FROM tyaga.marketplace_orders WHERE id=(SELECT purchase FROM fee_fixture))='cancelled';
  ASSERT NOT EXISTS(SELECT FROM tyaga.ventes WHERE order_id=(SELECT purchase FROM fee_fixture));
  ASSERT (SELECT balance_points FROM tyaga.vida_wallet WHERE user_id=(SELECT seller FROM fee_fixture))=37;
END $$;

-- Existing callers do not set the new columns. Their sale, seller points
-- and first-referral semantics keep their exact historical basis.
INSERT INTO tyaga.marketplace_orders(annonce_id,item_id,buyer_id,seller_id,amount_cents,commission_pct,
  commission_amount_cents,net_amount_cents,status,escrow_status,stripe_payment_intent_id)
  SELECT legacy,item,buyer,seller,1000,10,100,900,'delivered','held','pi_old' FROM fee_fixture;
SELECT tyaga.prepare_order_settlement(o.id,o.buyer_id) FROM tyaga.marketplace_orders o WHERE o.stripe_payment_intent_id='pi_old';
DO $$ BEGIN
  ASSERT EXISTS(SELECT FROM tyaga.ventes WHERE fee_policy='legacy' AND seller_id=(SELECT seller FROM fee_fixture)
    AND gross_amount_cents=1000 AND net_amount_cents=900 AND commission_amount_cents=100);
  ASSERT (SELECT balance_points FROM tyaga.vida_wallet WHERE user_id=(SELECT seller FROM fee_fixture))=46;
  ASSERT (SELECT commission_paid FROM tyaga.referrals WHERE referred_id=(SELECT seller FROM fee_fixture));
END $$;
ROLLBACK;
