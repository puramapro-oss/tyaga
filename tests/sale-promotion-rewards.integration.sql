-- Disposable DB after the settlement, refund and sale promotion migrations.
BEGIN;
DO $test$
DECLARE
  buyer uuid:=gen_random_uuid(); seller uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
  item uuid:=gen_random_uuid(); listing uuid:=gen_random_uuid(); sale uuid:=gen_random_uuid();
  c uuid:=gen_random_uuid(); benefit_count integer;
BEGIN
  INSERT INTO auth.users(id) VALUES(buyer),(seller),(outsider);
  PERFORM set_config('test.reward_buyer',buyer::text,true);
  PERFORM set_config('test.reward_outsider',outsider::text,true);
  PERFORM set_config('test.reward_order',sale::text,true);
  INSERT INTO tyaga.items(id,user_id) VALUES(item,seller);
  INSERT INTO tyaga.annonces(id,item_id,user_id,title,description,price_cents,status,user_validated)
    VALUES(listing,item,seller,'Vélo','Vélo en vente',5000,'published',true);
  INSERT INTO tyaga.marketplace_orders(id,annonce_id,item_id,buyer_id,seller_id,amount_cents,commission_pct,commission_amount_cents,net_amount_cents)
    VALUES(sale,listing,item,buyer,seller,5000,10,500,4500);
  INSERT INTO tyaga_promotion.sale_campaigns(id,starts_at,ends_at,duration_hours,redeem_days,pair_quota,per_person_quota,min_gross_cents,enabled,inventory_reference)
    VALUES(c,now()-interval '1 hour',now()+interval '1 hour',24,30,1,1,1000,true,'test-slot-inventory');
  IF tyaga_promotion.award_sale(sale) THEN RAISE EXCEPTION 'Pending sale eligible'; END IF;
  UPDATE tyaga.marketplace_orders SET status='completed',escrow_status='released',stripe_payment_intent_id='pi_sample' WHERE id=sale;
  INSERT INTO tyaga.ventes(order_id,seller_id,gross_amount_cents,commission_amount_cents,net_amount_cents,fiscal_year)
    VALUES(sale,seller,5000,500,4500,2026);
  IF tyaga_promotion.award_sale(sale) THEN RAISE EXCEPTION 'Missing transfer accepted'; END IF;
  INSERT INTO tyaga.order_settlements(order_id,state,amount_cents,destination,transfer_group,idempotency_key,stripe_transfer_id)
    VALUES(sale,'transferred',4500,'acct_test','tyaga_order_'||sale,'tyaga:settlement:v1:'||sale,'tr_sample');
  UPDATE tyaga.marketplace_orders SET stripe_transfer_id='tr_sample' WHERE id=sale;
  IF NOT tyaga_promotion.award_sale(sale) THEN RAISE EXCEPTION 'Retry failed'; END IF;
  SELECT count(DISTINCT beneficiary) INTO benefit_count FROM tyaga_promotion.grants WHERE source='tyaga_rewards';
  IF benefit_count<>2 OR (SELECT count(*) FROM tyaga_promotion.sale_awards)<>1 THEN RAISE EXCEPTION 'Double grant or missing pair'; END IF;
  IF (SELECT SUM(balance_points) FROM tyaga.vida_wallet)<>0 THEN RAISE EXCEPTION 'Unexpected wallet mutation'; END IF;
  IF has_function_privilege('authenticated','tyaga_promotion.award_sale(uuid)','execute') THEN RAISE EXCEPTION 'Public invocation'; END IF;
END $test$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',current_setting('test.reward_outsider'),true);
DO $$ BEGIN IF EXISTS(SELECT FROM tyaga.my_sale_promotions(ARRAY[current_setting('test.reward_order')::uuid])) THEN RAISE EXCEPTION 'Third-party benefit visible'; END IF; END $$;
SELECT set_config('request.jwt.claim.sub',current_setting('test.reward_buyer'),true);
DO $$ BEGIN IF (SELECT benefit_status FROM tyaga.my_sale_promotions(ARRAY[current_setting('test.reward_order')::uuid])) IS DISTINCT FROM 'available'
  THEN RAISE EXCEPTION 'Missing benefit to buyer'; END IF; END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE tyaga.marketplace_orders SET status='cancelled',escrow_status='refunded' WHERE id=current_setting('test.reward_order')::uuid;
DO $$ BEGIN
  IF (SELECT count(*) FROM tyaga_promotion.grants WHERE revoked_at IS NOT NULL)<>2 THEN RAISE EXCEPTION 'Refund failed to revoke both benefits'; END IF;
  IF tyaga_promotion.award_sale(current_setting('test.reward_order')::uuid) THEN RAISE EXCEPTION 'Refund replay revived benefit'; END IF;
END $$;
ROLLBACK;
