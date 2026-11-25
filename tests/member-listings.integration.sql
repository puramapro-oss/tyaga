-- Execute only on a disposable test database, after schema.sql and sql/digital-listings.sql.
BEGIN;

DO $test$
DECLARE
  author uuid := gen_random_uuid();
  visitor uuid := gen_random_uuid();
  object_id uuid := gen_random_uuid();
  legacy uuid := gen_random_uuid();
  digital uuid := gen_random_uuid();
  wanted uuid := gen_random_uuid();
  request_id uuid := gen_random_uuid();
  listing uuid;
  intent text;
  mode text;
BEGIN
  IF (SELECT count(*) FROM pg_constraint
      WHERE conrelid = 'tyaga.marketplace_orders'::regclass AND contype = 'f'
        AND confrelid = 'tyaga.annonces'::regclass) <> 1 THEN
    RAISE EXCEPTION 'Ambiguous PostgREST relationship from orders to annonces';
  END IF;
  INSERT INTO auth.users(id) VALUES (author), (visitor);
  PERFORM set_config('member_test.author', author::text, true);
  PERFORM set_config('member_test.visitor', visitor::text, true);
  PERFORM set_config('member_test.wanted', wanted::text, true);
  INSERT INTO tyaga.items(id, user_id) VALUES (object_id, author);
  INSERT INTO tyaga.annonces(id, user_id, item_id, title, description, price_cents)
    VALUES (legacy, author, object_id, 'Perceuse', 'Ancienne annonce physique', 1200);
  IF NOT EXISTS (SELECT FROM tyaga.annonces WHERE id = legacy AND asset_kind = 'physical'
                 AND listing_intent = 'offer' AND listing_mode = 'sale') THEN
    RAISE EXCEPTION 'An existing physical publication must keep its semantics';
  END IF;

  INSERT INTO tyaga.annonces(id, user_id, title, description, price_cents,
    asset_kind, listing_intent, publication_request_id, status, user_validated, published_at)
    VALUES (wanted, author, 'Outil', 'Je cherche cet outil en bon état.', 4500,
            'physical', 'wanted', gen_random_uuid(), 'published', true, now());

  FOREACH intent IN ARRAY ARRAY['offer','wanted'] LOOP
    FOREACH mode IN ARRAY ARRAY['sale','rental'] LOOP
      INSERT INTO tyaga.annonces(user_id, title, description, price_cents, asset_kind,
        listing_intent, listing_mode, publication_request_id, digital_format, digital_license_terms,
        digital_license_days, digital_rights_attested, status, user_validated, published_at)
      VALUES (author, 'Affiche', 'Une création originale disponible.', 0, 'digital',
              intent, mode, gen_random_uuid(), 'PDF', 'Utilisation personnelle uniquement.',
              CASE WHEN mode = 'rental' THEN 30 END, intent = 'offer', 'published', true, now());
    END LOOP;
  END LOOP;

  INSERT INTO tyaga.annonces(id, user_id, title, description, price_cents, asset_kind,
    publication_request_id, digital_format, digital_license_terms, digital_rights_attested)
  VALUES (digital, author, 'Affiche', 'Une création originale disponible.', 1000, 'digital',
          request_id, 'PDF', 'Utilisation personnelle uniquement.', true);
  BEGIN
    INSERT INTO tyaga.annonces(user_id, title, description, price_cents, asset_kind,
      publication_request_id, digital_format, digital_license_terms, digital_rights_attested)
    VALUES (author, 'Copie', 'Une création originale disponible.', 1000, 'digital',
            request_id, 'PDF', 'Utilisation personnelle uniquement.', true);
    RAISE EXCEPTION 'Duplicate request created a new listing';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    UPDATE tyaga.annonces SET listing_mode='rental' WHERE id = digital;
    RAISE EXCEPTION 'Temporal licence accepted without duration';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE tyaga.annonces SET digital_rights_attested=false WHERE id = digital;
    RAISE EXCEPTION 'Offered licence accepted without attestation';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE tyaga.annonces SET status='published', user_validated=false WHERE id = digital;
    RAISE EXCEPTION 'Digital listing published without confirmation';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE tyaga.annonces SET item_id=object_id WHERE id = wanted;
    RAISE EXCEPTION 'Physical wanted listing incorrectly attached to inventory';
  EXCEPTION WHEN check_violation THEN NULL; END;

  FOREACH listing IN ARRAY ARRAY[digital, wanted] LOOP
    BEGIN
      INSERT INTO tyaga.marketplace_orders(annonce_id, item_id, buyer_id, seller_id,
        amount_cents, commission_pct, commission_amount_cents, net_amount_cents)
      VALUES (listing, object_id, visitor, author, 1000, 3, 30, 970);
      RAISE EXCEPTION 'Physical checkout accepted ineligible listing';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  END LOOP;
  INSERT INTO tyaga.marketplace_orders(annonce_id,item_id,buyer_id,seller_id,amount_cents,
    commission_pct,commission_amount_cents,net_amount_cents,status)
  VALUES (legacy,object_id,visitor,author,1200,3,36,1164,'cancelled');
  BEGIN
    UPDATE tyaga.annonces SET asset_kind='digital', item_id=NULL, digital_rights_attested=true,
      digital_format='PDF', digital_license_terms='Utilisation personnelle uniquement.',
      publication_request_id=gen_random_uuid() WHERE id=legacy;
    RAISE EXCEPTION 'An ordered listing changed its kind';
  EXCEPTION WHEN restrict_violation OR foreign_key_violation THEN NULL; END;
  BEGIN
    UPDATE tyaga.annonces SET listing_intent='wanted', item_id=NULL,
      publication_request_id=gen_random_uuid() WHERE id=legacy;
    RAISE EXCEPTION 'An ordered listing changed its intent';
  EXCEPTION WHEN restrict_violation OR foreign_key_violation THEN NULL; END;


END
$test$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('member_test.visitor'), true);
DO $rls$
DECLARE
  visitor uuid := auth.uid();
  author uuid := current_setting('member_test.author')::uuid;
  wanted uuid := current_setting('member_test.wanted')::uuid;
BEGIN
  INSERT INTO tyaga.conversations(annonce_id, buyer_id, seller_id) VALUES (wanted, visitor, author);
  BEGIN
    INSERT INTO tyaga.annonces(user_id, title, description, price_cents, asset_kind, listing_intent,
      publication_request_id, status, user_validated, published_at)
    VALUES (author, 'Usurpation', 'Requête par un autre compte.', 0, 'physical', 'wanted',
            gen_random_uuid(), 'published', true, now());
    RAISE EXCEPTION 'An interlocutor published under a different account';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END
$rls$;
RESET ROLE;
ROLLBACK;
