-- Upgrade fixture, disposable database only. Run ONCE after V2 and before V3.
-- Session-local identifiers let the post-migration test inspect these exact rows.
BEGIN;
CREATE TEMP TABLE fee_upgrade AS SELECT gen_random_uuid() seller,gen_random_uuid() buyer,
  gen_random_uuid() item,gen_random_uuid() existing_order_listing,gen_random_uuid() existing_stock,
  gen_random_uuid() pending_id,gen_random_uuid() negotiated_conversation,gen_random_uuid() v3_listing;
GRANT SELECT ON fee_upgrade TO authenticated,service_role;
INSERT INTO auth.users(id,email) SELECT seller,seller::text||'@example.invalid' FROM fee_upgrade
  UNION ALL SELECT buyer,buyer::text||'@example.invalid' FROM fee_upgrade;
INSERT INTO tyaga_fee.pilot_sellers(seller_id,qualification_ref) SELECT seller,'fixture:preserved-seller' FROM fee_upgrade
  UNION ALL SELECT buyer,'fixture:preserved-buyer' FROM fee_upgrade;
INSERT INTO tyaga.items(id,user_id) SELECT item,seller FROM fee_upgrade;
INSERT INTO tyaga.annonces(id,user_id,item_id,title,description,price_cents,user_validated,status,published_at,fee_policy)
  SELECT ids.id,f.seller,f.item,'Ancienne annonce','Ancienne annonce de recette',1200,true,'published',now(),'fr_p2p_test_v2'
  FROM fee_upgrade f CROSS JOIN LATERAL (VALUES(f.existing_order_listing),(f.existing_stock)) ids(id);
INSERT INTO tyaga.conversations(id,annonce_id,buyer_id,seller_id)
  SELECT negotiated_conversation,existing_stock,buyer,seller FROM fee_upgrade;
INSERT INTO tyaga.inbox_messages(conversation_id,sender_id,body,offer_cents)
  SELECT negotiated_conversation,buyer,'Offre',1000 FROM fee_upgrade
  UNION ALL SELECT negotiated_conversation,seller,'Accord',1000 FROM fee_upgrade;
UPDATE tyaga.inbox_messages m SET created_at=CASE WHEN sender_id=f.seller
  THEN timestamptz '2026-02-05 12:01:00+00' ELSE timestamptz '2026-02-05 12:00:00+00' END
  FROM fee_upgrade f WHERE m.conversation_id=f.negotiated_conversation;
INSERT INTO tyaga.marketplace_orders(id,annonce_id,item_id,buyer_id,seller_id,amount_cents,commission_pct,
  commission_amount_cents,net_amount_cents,shipping_address,fee_policy,item_amount_cents,buyer_fee_cents)
  SELECT pending_id,existing_order_listing,item,buyer,seller,1270,0,0,1200,'{"country":"FR"}'::jsonb,
    'fr_p2p_test_v2',1200,70 FROM fee_upgrade;
COMMIT;
