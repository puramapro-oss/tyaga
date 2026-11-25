BEGIN;
CREATE FUNCTION pg_temp.fixture_listing(owner_id uuid, heading text, kind text DEFAULT 'physical',
  intent text DEFAULT 'wanted', body text DEFAULT 'Je cherche un équipement précis pour mon atelier de réparation.')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE new_id uuid:=gen_random_uuid();item uuid;
BEGIN
  IF kind='physical' AND intent='offer' THEN
    INSERT INTO tyaga.items(user_id) VALUES(owner_id) RETURNING id INTO item;
  END IF;
  INSERT INTO tyaga.annonces(id,user_id,item_id,title,description,price_cents,status,published_at,user_validated,
     asset_kind,listing_intent,listing_mode,publication_request_id,digital_format,digital_license_terms,digital_license_days,digital_rights_attested)
    VALUES(new_id,owner_id,item,heading,body,1500,'published',now(),true,kind,intent,CASE WHEN kind='digital' THEN 'rental' ELSE 'sale' END,
      CASE WHEN item IS NULL THEN gen_random_uuid() END,CASE WHEN kind='digital' THEN 'PDF' END,
      CASE WHEN kind='digital' THEN 'Un usage personnel autorisé pendant une journée.' END,CASE WHEN kind='digital' THEN 1 END,
      kind='digital' AND intent='offer');
  RETURN new_id;
END $$;
DO $$
DECLARE u uuid:=gen_random_uuid();v uuid:=gen_random_uuid();w uuid:=gen_random_uuid();campaign uuid:=gen_random_uuid();
 l uuid; old_id uuid; first_id uuid; reward jsonb;
BEGIN
  INSERT INTO auth.users(id) VALUES(u),(v),(w);
  PERFORM set_config('request.jwt.claim.sub',u::text,true);
  old_id:=pg_temp.fixture_listing(u,'Publication ancienne');
  IF tyaga.my_publication_benefit(old_id) IS NOT NULL THEN RAISE EXCEPTION 'No funding'; END IF;
  INSERT INTO tyaga_promotion.publication_campaigns(id,starts_at,ends_at,funded_by_reference,reserved_inventory_reference,
    reserved_slots,member_limit,duration_hours,redeem_days)
    VALUES(campaign,now()-interval '1 hour',now()+interval '1 hour','approved-budget-fixture','inventory-fixture',4,2,12,14);
  l:=pg_temp.fixture_listing(u,'Campagne fermée');
  IF tyaga.my_publication_benefit(l) IS NOT NULL THEN RAISE EXCEPTION 'Disabled campaign'; END IF;
  UPDATE tyaga_promotion.publication_campaigns SET enabled=true WHERE id=campaign;
  UPDATE tyaga.annonces SET status='unpublished' WHERE id=old_id;
  UPDATE tyaga.annonces SET status='published' WHERE id=old_id;
  IF tyaga.my_publication_benefit(old_id) IS NOT NULL THEN RAISE EXCEPTION 'Historic replay'; END IF;
  l:=pg_temp.fixture_listing(u,'Description pauvre','physical','wanted','bonjour bonjour bonjour bonjour bonjour');
  IF tyaga.my_publication_benefit(l) IS NOT NULL THEN RAISE EXCEPTION 'Duplicate-word description'; END IF;
  l:=pg_temp.fixture_listing(v,'Objet non autorisé');
  IF EXISTS(SELECT FROM tyaga_promotion.publication_awards WHERE listing_id=l) THEN RAISE EXCEPTION 'Creator mismatch'; END IF;
  first_id:=pg_temp.fixture_listing(u,'Vélo de route');
  reward:=tyaga.my_publication_benefit(first_id);
  IF reward IS NULL OR (reward->>'duration_hours')::int<>12 OR NOT EXISTS(SELECT FROM tyaga_promotion.grants
    WHERE id=(reward->>'grant_id')::uuid AND source='tyaga_rewards' AND kind='campaign_benefit' AND paid_units=0 AND beneficiary=u)
    THEN RAISE EXCEPTION 'Missing funded grant'; END IF;
  UPDATE tyaga.annonces SET status='unpublished' WHERE id=first_id;
  UPDATE tyaga.annonces SET status='published' WHERE id=first_id;
  IF tyaga.my_publication_benefit(first_id) IS DISTINCT FROM reward THEN RAISE EXCEPTION 'Retry created a second grant'; END IF;
  l:=pg_temp.fixture_listing(u,' VELO -- de   ROUTE ');
  IF tyaga.my_publication_benefit(l) IS NOT NULL THEN RAISE EXCEPTION 'Duplicate semantics'; END IF;
  l:=pg_temp.fixture_listing(u,'Vélo de route','physical','offer');
  IF tyaga.my_publication_benefit(l) IS NULL THEN RAISE EXCEPTION 'Physical offer was not eligible'; END IF;
  l:=pg_temp.fixture_listing(u,'Une autre recherche');
  IF tyaga.my_publication_benefit(l) IS NOT NULL THEN RAISE EXCEPTION 'Owner limit exceeded'; END IF;
  PERFORM set_config('request.jwt.claim.sub',v::text,true);
  IF tyaga.my_publication_benefit(first_id) IS NOT NULL THEN RAISE EXCEPTION 'Benefit crossed accounts'; END IF;
  l:=pg_temp.fixture_listing(v,'Modèle de portrait','digital','offer');
  IF tyaga.my_publication_benefit(l) IS NULL THEN RAISE EXCEPTION 'Digital offer skipped'; END IF;
  l:=pg_temp.fixture_listing(v,'Modèle de portrait','digital','wanted');
  IF tyaga.my_publication_benefit(l) IS NULL THEN RAISE EXCEPTION 'Digital request skipped'; END IF;
  PERFORM set_config('request.jwt.claim.sub',w::text,true);
  l:=pg_temp.fixture_listing(w,'Publication sans stock');
  IF tyaga.my_publication_benefit(l) IS NOT NULL OR NOT EXISTS(SELECT FROM tyaga.annonces WHERE id=l) THEN RAISE EXCEPTION 'Out of inventory'; END IF;
  IF (SELECT issued_slots FROM tyaga_promotion.publication_campaigns WHERE id=campaign)<>4 THEN RAISE EXCEPTION 'Stock count'; END IF;
  PERFORM set_config('request.jwt.claim.sub',u::text,true);
  PERFORM tyaga_promotion.revoke_grant('tyaga_rewards','publication:'||first_id);
  IF tyaga.my_publication_benefit(first_id) IS NOT NULL THEN RAISE EXCEPTION 'Revoked entitlement visible'; END IF;
  IF EXISTS(SELECT FROM tyaga.vida_wallet WHERE user_id IN(u,v,w) AND balance_points<>0) THEN RAISE EXCEPTION 'Wallet changed'; END IF;
END $$;
ROLLBACK;
