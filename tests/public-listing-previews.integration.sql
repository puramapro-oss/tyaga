BEGIN;
DO $test$
DECLARE
  owner_id uuid := gen_random_uuid();
  buyer_id uuid := gen_random_uuid();
  listing uuid := gen_random_uuid();
  first_token uuid;
  second_token uuid;
  reviewed jsonb := '{"title":"Clavier","priceCents":1500,"kind":"physical","intent":"wanted","mode":"sale"}';
BEGIN
  INSERT INTO auth.users(id) VALUES(owner_id),(buyer_id);
  INSERT INTO tyaga.annonces(id,user_id,title,description,price_cents,listing_intent,
    publication_request_id,status,user_validated,published_at)
  VALUES(listing,owner_id,'Clavier','Un clavier pour mon bureau.',1500,'wanted',gen_random_uuid(),'published',true,now());
  PERFORM set_config('request.jwt.claim.sub',buyer_id::text,true);
  BEGIN
    PERFORM tyaga.manage_listing_preview(listing,'enable',reviewed);
    RAISE EXCEPTION 'Only owner may consent'; EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
  IF tyaga.manage_listing_preview(listing,'read',NULL) IS NOT NULL THEN RAISE EXCEPTION 'Expected opt-in'; END IF;
  BEGIN
    PERFORM tyaga.manage_listing_preview(listing,'enable',reviewed || '{"priceCents":200}');
    RAISE EXCEPTION 'Stale reviewed price accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  first_token := tyaga.manage_listing_preview(listing,'enable',reviewed);
  IF first_token IS NULL OR first_token IS DISTINCT FROM tyaga.manage_listing_preview(listing,'enable',reviewed)
    OR NOT EXISTS (SELECT FROM tyaga.read_public_listing_preview(first_token) WHERE listing_id=listing AND title='Clavier') THEN
    RAISE EXCEPTION 'Invalid public preview or non-idempotent retry';
  END IF;
  PERFORM tyaga.manage_listing_preview(listing,'revoke',NULL);
  IF EXISTS(SELECT FROM tyaga.read_public_listing_preview(first_token)) THEN RAISE EXCEPTION 'Revocation failed'; END IF;
  second_token := tyaga.manage_listing_preview(listing,'enable',reviewed);
  IF first_token=second_token THEN RAISE EXCEPTION 'Old token reused'; END IF;
  UPDATE tyaga.annonces SET status='unpublished' WHERE id=listing;
  UPDATE tyaga.annonces SET status='published' WHERE id=listing;
  IF EXISTS(SELECT FROM tyaga.read_public_listing_preview(second_token)) THEN RAISE EXCEPTION 'Republishing restored a revoked URL'; END IF;
  second_token := tyaga.manage_listing_preview(listing,'enable',reviewed);
  UPDATE tyaga.annonces SET price_cents=1600 WHERE id=listing;
  IF EXISTS(SELECT FROM tyaga.read_public_listing_preview(second_token)) THEN RAISE EXCEPTION 'Unreviewed price exposed'; END IF;
  IF has_table_privilege('anon','tyaga_partages_prives.listing_preview_links','SELECT')
     OR has_table_privilege('authenticated','tyaga_partages_prives.listing_preview_links','SELECT')
     OR has_function_privilege('anon','tyaga.manage_listing_preview(uuid,text,jsonb)','EXECUTE')
     OR has_function_privilege('authenticated','tyaga.read_public_listing_preview(uuid)','EXECUTE') THEN
     RAISE EXCEPTION 'Direct enumeration or unauthorized management permitted';
  END IF;
END $test$;
ROLLBACK;
