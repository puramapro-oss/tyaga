-- Disposable database. Without PAY, verify the installation and fail-closed
-- behavior. To also exercise money movements, install the actual PAY schema,
-- create its expected Supabase roles, and mark this DATABASE isolated_test as
-- documented in the migration. No positive path is tested with a fake wallet.
BEGIN;
SET LOCAL plpgsql.check_asserts=on;
DO $test$
DECLARE
  owner_id uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); lid uuid:=gen_random_uuid();
  item uuid:=gen_random_uuid(); request1 uuid:=gen_random_uuid(); request2 uuid:=gen_random_uuid();
  fail_after_debit uuid:=gen_random_uuid(); conflict_id uuid:=gen_random_uuid();
  actual jsonb; initial jsonb; refund jsonb; wallet uuid; ready boolean; original_balance int;
  tariff text:='fixture-'||lid::text; query_ref text;
BEGIN
  ASSERT NOT has_function_privilege('authenticated','tyaga.purchase_promotion_with_test_points(uuid,uuid,text,uuid)','EXECUTE');
  ASSERT NOT has_function_privilege('anon','tyaga.promotion_points_test_receipt(uuid,uuid,text,uuid)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','tyaga.refund_promotion_test_points(uuid,uuid)','EXECUTE');
  ready:=tyaga_promotion.points_test_ready();
  IF NOT ready THEN
    PERFORM set_config('tyaga.promotion_points_environment','isolated_test',true);
    ASSERT NOT tyaga_promotion.points_test_ready();
    SET LOCAL ROLE service_role;
    ASSERT tyaga.promotion_points_test_quote(lid,owner_id) IS NULL;
    BEGIN PERFORM tyaga.purchase_promotion_with_test_points(lid,owner_id,tariff,request1);
      RAISE EXCEPTION 'unqualified database charged points';
    EXCEPTION WHEN check_violation THEN NULL; END;
    ASSERT tyaga.promotion_points_test_receipt(lid,owner_id,tariff,request1) IS NULL;
    RESET ROLE;
    RETURN;
  END IF;

  INSERT INTO auth.users(id,email) VALUES(owner_id,owner_id::text||'@example.invalid'),(outsider,outsider::text||'@example.invalid');
  INSERT INTO tyaga.items(id,user_id) VALUES(item,owner_id);
  INSERT INTO tyaga.annonces(id,item_id,user_id,title,description,price_cents,status,user_validated,published_at)
    VALUES(lid,item,owner_id,'Recette points','Annonce synthétique',1000,'published',true,now());
  INSERT INTO tyaga_promotion.points_pilot_offers(tariff_id,cost_points,duration_hours,starts_at,ends_at,reserved_quantity,inventory_ref,enabled)
    VALUES(tariff,12,24,now()-interval '1 hour',now()+interval '2 days',1,'fixture-stock:'||lid,true);
  INSERT INTO tyaga_promotion.points_pilot_members(tariff_id,actor,authorized_points,approval_ref)
    VALUES(tariff,owner_id,20,'fixture-privilege:'||lid);

  SET LOCAL ROLE service_role;
  ASSERT tyaga.promotion_points_test_quote(lid,owner_id) IS NULL;
  BEGIN PERFORM tyaga.purchase_promotion_with_test_points(lid,owner_id,tariff,request1);
    RAISE EXCEPTION 'insufficient balance accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
  -- Seed the isolated test actor via PAY itself. Product RPCs never credit points.
  PERFORM purama_pay.apply_wallet_movement(owner_id,'earn_mission',41,'synthetic-mission:'||lid);
  actual:=tyaga.promotion_points_test_quote(lid,owner_id);
  ASSERT (actual->>'cost_points')::int=12 AND (actual->>'balance_points')::int=20 AND (actual->>'duration_hours')::int=24;
  ASSERT tyaga.promotion_points_test_quote(lid,outsider) IS NULL;
  RESET ROLE;

  SELECT id,balance INTO wallet,original_balance FROM purama_pay.points_wallets WHERE user_id=owner_id;
  EXECUTE format('ALTER TABLE tyaga_promotion.points_pilot_purchases ADD CONSTRAINT fixture_force_late_rollback CHECK (request_id<>%L::uuid)',fail_after_debit);
  SET LOCAL ROLE service_role;
  BEGIN PERFORM tyaga.purchase_promotion_with_test_points(lid,owner_id,tariff,fail_after_debit);
    RAISE EXCEPTION 'late failure bypassed'; EXCEPTION WHEN check_violation THEN NULL; END;
  RESET ROLE;
  ASSERT (SELECT balance FROM purama_pay.points_wallets WHERE id=wallet)=original_balance;
  ASSERT NOT EXISTS(SELECT FROM tyaga_promotion.grants WHERE beneficiary=owner_id);
  ASSERT NOT EXISTS(SELECT FROM purama_pay.points_transactions WHERE wallet_id=wallet AND type='debit_catalog');

  SET LOCAL ROLE service_role;
  initial:=tyaga.purchase_promotion_with_test_points(lid,owner_id,tariff,request1);
  ASSERT initial=tyaga.purchase_promotion_with_test_points(lid,owner_id,tariff,request1);
  ASSERT tyaga.promotion_points_test_quote(lid,owner_id) IS NULL;
  ASSERT tyaga.promotion_points_test_receipt(lid,outsider,tariff,request1) IS NULL;
  ASSERT tyaga.promotion_points_test_receipt(lid,owner_id,tariff,request1)->>'status'='purchased';
  BEGIN PERFORM tyaga.purchase_promotion_with_test_points(lid,owner_id,tariff,request2);
    RAISE EXCEPTION 'stock exhausted'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN PERFORM tyaga.purchase_promotion_with_test_points(gen_random_uuid(),owner_id,tariff,request1);
    RAISE EXCEPTION 'receipt reused for another listing'; EXCEPTION WHEN unique_violation THEN NULL; END;
  RESET ROLE;
  ASSERT (SELECT balance FROM purama_pay.points_wallets WHERE id=wallet)=29;
  ASSERT (SELECT count(*) FROM purama_pay.points_transactions WHERE wallet_id=wallet AND type='debit_catalog' AND amount=-12)=1;
  ASSERT EXISTS(SELECT FROM tyaga_promotion.grants WHERE id=(initial->>'grant_id')::uuid AND beneficiary=owner_id
    AND kind='points_receipt' AND source='one_ledger' AND paid_units=12 AND receipt=initial->>'receipt_id');

  SET LOCAL ROLE service_role;
  refund:=tyaga.refund_promotion_test_points(owner_id,request1);
  ASSERT refund=tyaga.refund_promotion_test_points(owner_id,request1);
  ASSERT tyaga.promotion_points_test_receipt(lid,owner_id,tariff,request1)->>'status'='refunded';
  BEGIN PERFORM tyaga.purchase_promotion_with_test_points(lid,owner_id,tariff,request1);
    RAISE EXCEPTION 'refunded request paid again'; EXCEPTION WHEN check_violation THEN NULL; END;
  RESET ROLE;
  ASSERT (SELECT balance FROM purama_pay.points_wallets WHERE id=wallet)=41;
  ASSERT (SELECT count(*) FROM purama_pay.points_transactions WHERE wallet_id=wallet AND type='reversal' AND amount=12)=1;
  ASSERT EXISTS(SELECT FROM tyaga_promotion.grants WHERE id=(initial->>'grant_id')::uuid AND revoked_at IS NOT NULL);
  UPDATE tyaga_promotion.points_pilot_members SET authorized_points=11 WHERE actor=owner_id;
  SET LOCAL ROLE service_role;
  ASSERT tyaga.promotion_points_test_quote(lid,owner_id) IS NULL;
  BEGIN PERFORM tyaga.purchase_promotion_with_test_points(lid,owner_id,tariff,request2);
    RAISE EXCEPTION 'nominal cap exceeded'; EXCEPTION WHEN check_violation THEN NULL; END;
  RESET ROLE;
  UPDATE tyaga_promotion.points_pilot_members SET authorized_points=20 WHERE actor=owner_id;
  SET LOCAL ROLE service_role;
  -- A pre-existing PAY movement is evidence to reconcile, not permission to issue.
  query_ref:='tyaga:promotion:test:'||owner_id||':'||conflict_id;
  PERFORM purama_pay.apply_wallet_movement(owner_id,'debit_catalog',-1,query_ref);
  BEGIN PERFORM tyaga.purchase_promotion_with_test_points(lid,owner_id,tariff,conflict_id);
    RAISE EXCEPTION 'unmatched pre-existing movement accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
  actual:=tyaga.purchase_promotion_with_test_points(lid,owner_id,tariff,request2);
  RESET ROLE;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
  PERFORM tyaga.redeem_listing_promotion(lid,(actual->>'grant_id')::uuid);
  RESET ROLE;
  SET LOCAL ROLE service_role;
  BEGIN PERFORM tyaga.refund_promotion_test_points(owner_id,request2);
    RAISE EXCEPTION 'used promotion was refunded'; EXCEPTION WHEN check_violation THEN NULL; END;
  RESET ROLE;
  ASSERT (SELECT balance FROM purama_pay.points_wallets WHERE id=wallet)=28;
  ASSERT (SELECT balance_points FROM tyaga.vida_wallet WHERE user_id=owner_id)=0;
  PERFORM set_config('request.jwt.claim.sub','',true);
  DELETE FROM auth.users WHERE id=owner_id;
  ASSERT NOT EXISTS(SELECT FROM tyaga_promotion.points_pilot_members WHERE actor=owner_id);
  ASSERT NOT EXISTS(SELECT FROM tyaga_promotion.points_pilot_purchases WHERE actor=owner_id);
  ASSERT NOT EXISTS(SELECT FROM tyaga_promotion.grants WHERE beneficiary=owner_id);
  ASSERT NOT EXISTS(SELECT FROM purama_pay.points_wallets WHERE user_id=owner_id);
  ASSERT (SELECT sold_quantity FROM tyaga_promotion.points_pilot_offers WHERE tariff_id=tariff)=1;
END $test$;
ROLLBACK;
