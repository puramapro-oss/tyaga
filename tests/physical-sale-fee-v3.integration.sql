-- Same disposable session as physical-sale-fee-v3-before.integration.sql.
BEGIN;
SET LOCAL plpgsql.check_asserts=on;
CREATE FUNCTION pg_temp.fee_upgrade_order(lid uuid,policy text,price int,fee int) RETURNS uuid
LANGUAGE sql AS $$
  INSERT INTO tyaga.marketplace_orders(annonce_id,item_id,buyer_id,seller_id,amount_cents,commission_pct,
    commission_amount_cents,net_amount_cents,shipping_address,fee_policy,item_amount_cents,buyer_fee_cents)
    SELECT lid,item,buyer,seller,price+fee,0,0,price,'{"country":"FR"}'::jsonb,policy,price,fee FROM fee_upgrade
    RETURNING id;
$$;
DO $$ DECLARE f fee_upgrade; o tyaga.marketplace_orders; persisted uuid; current_order uuid;
  full_charge int; pi text; ch text; result jsonb;
BEGIN
  SELECT * INTO STRICT f FROM fee_upgrade;
  ASSERT (SELECT fee_policy FROM tyaga.annonces WHERE id=f.existing_stock)='fr_p2p_test_v2';
  SELECT * INTO STRICT o FROM tyaga.marketplace_orders WHERE id=f.pending_id;
  ASSERT (o.fee_policy,o.status,o.item_amount_cents,o.buyer_fee_cents,o.amount_cents)=('fr_p2p_test_v2','pending',1200,70,1270);
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  ASSERT tyaga.current_test_fee_policy() IS NULL;
  PERFORM set_config('request.jwt.claim.sub',f.seller::text,true);
  ASSERT tyaga.current_test_fee_policy()='fr_p2p_test_v3';
  BEGIN
    INSERT INTO tyaga.annonces(user_id,item_id,title,description,price_cents,status,user_validated,published_at,fee_policy)
      VALUES(f.seller,f.item,'Refus','Refus de la version ancienne',1000,'published',true,now(),'fr_p2p_test_v2');
    RAISE EXCEPTION 'new listing on closed V2 tariff'; EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE tyaga.annonces SET fee_policy='fr_p2p_test_v3' WHERE id=f.existing_stock;
    RAISE EXCEPTION 'old listing repriced'; EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO tyaga.annonces(id,user_id,item_id,title,description,price_cents,status,user_validated,published_at,fee_policy)
    VALUES(f.v3_listing,f.seller,f.item,'Nouveau tarif','Offre de recette au tarif trois',5000,'published',true,now(),tyaga.current_test_fee_policy());
  PERFORM set_config('request.jwt.claim.sub',f.buyer::text,true);
  BEGIN
    PERFORM pg_temp.fee_upgrade_order(f.existing_stock,'fr_p2p_test_v3',1000,65);
    RAISE EXCEPTION 'existing agreement billed on V3'; EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM pg_temp.fee_upgrade_order(f.existing_stock,'fr_p2p_test_v2',1200,70);
    RAISE EXCEPTION 'agreed price lost during upgrade'; EXCEPTION WHEN check_violation THEN NULL;
  END;
  persisted:=pg_temp.fee_upgrade_order(f.existing_stock,'fr_p2p_test_v2',1000,64);
  BEGIN
    PERFORM pg_temp.fee_upgrade_order(f.v3_listing,'fr_p2p_test_v3',5000,180);
    RAISE EXCEPTION 'V3 accepted obsolete 2.9 percent fee'; EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM pg_temp.fee_upgrade_order(f.v3_listing,'fr_p2p_test_v2',5000,180);
    RAISE EXCEPTION 'snapshot version differs from listing'; EXCEPTION WHEN check_violation THEN NULL;
  END;
  current_order:=pg_temp.fee_upgrade_order(f.v3_listing,'fr_p2p_test_v3',5000,185);
  BEGIN
    PERFORM pg_temp.fee_upgrade_order(f.v3_listing,'fr_p2p_test_v3',5000,185);
    RAISE EXCEPTION 'two buyers can reserve same listing'; EXCEPTION WHEN unique_violation THEN NULL;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub','',true);
  SET LOCAL ROLE service_role;
  FOR o IN SELECT * FROM tyaga.marketplace_orders WHERE id IN (f.pending_id,persisted,current_order) LOOP
    full_charge:=CASE WHEN o.id=f.pending_id THEN 1270 WHEN o.id=persisted THEN 1064 ELSE 5185 END;
    ASSERT o.amount_cents=full_charge;
    pi:='pi_'||replace(o.id::text,'-','');
    ch:='ch_'||replace(o.id::text,'-','');
    UPDATE tyaga.marketplace_orders SET stripe_checkout_session_id='cs_test_'||replace(o.id::text,'-','') WHERE id=o.id;
    UPDATE tyaga.marketplace_orders SET status='paid',escrow_status='held',stripe_payment_intent_id=pi WHERE id=o.id;
    UPDATE tyaga.marketplace_orders SET status='delivered' WHERE id=o.id;
    result:=tyaga.prepare_order_settlement(o.id,f.buyer);
    ASSERT (result->'settlement'->>'amount_cents')::int=o.item_amount_cents;
    ASSERT tyaga.prepare_order_settlement(o.id,f.buyer)=result;
    ASSERT (SELECT count(*) FROM tyaga.ventes v WHERE v.order_id=o.id AND v.fee_policy=o.fee_policy
      AND v.gross_amount_cents=o.item_amount_cents AND v.net_amount_cents=o.item_amount_cents AND v.commission_amount_cents=0)=1;
    BEGIN
      INSERT INTO tyaga.vida_transfers(user_id,vente_id,pct,points_amount)
        SELECT f.seller,id,0,0 FROM tyaga.ventes WHERE order_id=o.id;
      RAISE EXCEPTION 'test sale created VIDA transfer'; EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
      PERFORM tyaga.prepare_order_refund(pi,ch,o.item_amount_cents,o.item_amount_cents,'eur',true);
      RAISE EXCEPTION 'refund used seller basis instead of original checkout'; EXCEPTION WHEN check_violation THEN NULL;
    END;
    result:=tyaga.prepare_order_refund(pi,ch,full_charge,full_charge,'eur',true);
    ASSERT (result->>'refunded_amount_cents')::int=full_charge;
    ASSERT (tyaga.prepare_order_refund(pi,ch,full_charge,full_charge,'eur',true)->>'refunded_amount_cents')::int=full_charge;
    ASSERT NOT EXISTS(SELECT FROM tyaga.ventes WHERE order_id=o.id);
    ASSERT (SELECT fee_policy FROM tyaga.marketplace_orders WHERE id=o.id)=o.fee_policy;
  END LOOP;
  ASSERT (SELECT balance_points FROM tyaga.vida_wallet WHERE user_id=f.seller)=0;
  RESET ROLE;
END $$;
ROLLBACK;
