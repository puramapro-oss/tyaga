-- Recette sans appel fournisseur. Rejouable sur une base éphémère préparée
-- avec schema.sql et les trois migrations digital*.sql, checkout en dernier.
BEGIN;
INSERT INTO auth.users(id) VALUES ('11000000-0000-4000-8000-000000000001'), ('11000000-0000-4000-8000-000000000002');
UPDATE tyaga.profiles SET stripe_connect_account_id='acct_testSeller' WHERE id='11000000-0000-4000-8000-000000000001';
INSERT INTO tyaga.annonces(id,user_id,title,description,status,user_validated,published_at,price_cents,
 asset_kind,listing_intent,listing_mode,digital_format,digital_license_terms,digital_license_days,digital_rights_attested,publication_request_id)
SELECT n::uuid,'11000000-0000-4000-8000-000000000001','Mon échantillon','Une création textuelle destinée aux testeurs.',
 'published',true,now(),800,'digital','offer','rental','Texte','Droit de lecture pour la recette.',1,true,gen_random_uuid()
FROM unnest(ARRAY['21000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000002']) n;

SET LOCAL ROLE service_role;
SELECT tyaga.licence_echantillon('21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','Échantillon 1',true);
SELECT tyaga.licence_echantillon('21000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000001','Échantillon 2',true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000002',true);
SELECT set_config('test.v1',tyaga.licence_etat('21000000-0000-4000-8000-000000000001')->>'version',true);
SELECT set_config('test.v2',tyaga.licence_etat('21000000-0000-4000-8000-000000000002')->>'version',true);
DO $$ BEGIN
 BEGIN PERFORM tyaga.licence_devis_test('21000000-0000-4000-8000-000000000001',auth.uid(),current_setting('test.v1'),true);
 RAISE EXCEPTION 'Participant granted authority'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE service_role;
DO $$
DECLARE a uuid:='21000000-0000-4000-8000-000000000001'; b uuid:='11000000-0000-4000-8000-000000000002'; c jsonb; id uuid;
BEGIN
 BEGIN PERFORM tyaga.licence_devis_test(a,b,'wrong',true); RAISE EXCEPTION 'Wrong terms'; EXCEPTION WHEN serialization_failure THEN NULL; END;
 c:=tyaga.licence_devis_test(a,b,current_setting('test.v1'),true);
 id:=(c->>'id')::uuid;
 IF c IS DISTINCT FROM tyaga.licence_devis_test(a,b,current_setting('test.v1'),true) THEN RAISE EXCEPTION 'Quote replay'; END IF;
 BEGIN PERFORM tyaga.licence_regler_test(id,'cs_1','pi_1',b,'acct_testSeller',800,'eur','paid'); RAISE EXCEPTION 'Unbound session'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 PERFORM tyaga.licence_session_test(id,'cs_1');
 BEGIN PERFORM tyaga.licence_session_test(id,'cs_2'); RAISE EXCEPTION 'Rebind session'; EXCEPTION WHEN serialization_failure THEN NULL; END;
 BEGIN PERFORM tyaga.licence_regler_test(id,'cs_1','pi_1',b,'acct_testSeller',799,'eur','paid'); RAISE EXCEPTION 'Wrong price'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM tyaga.licence_regler_test(id,'cs_1','pi_1',b,'acct_testSeller',800,'usd','paid'); RAISE EXCEPTION 'Wrong currency'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM tyaga.licence_regler_test(id,'cs_1','pi_1',b,'acct_other',800,'eur','paid'); RAISE EXCEPTION 'Wrong seller'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM tyaga.licence_regler_test(id,'cs_1','pi_1','11000000-0000-4000-8000-000000000001','acct_testSeller',800,'eur','paid'); RAISE EXCEPTION 'Wrong buyer'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 PERFORM tyaga.licence_regler_test(id,'cs_1','pi_1',b,'acct_testSeller',800,'eur','paid');
 PERFORM tyaga.licence_regler_test(id,'cs_1','pi_1',b,'acct_testSeller',800,'eur','paid');
 IF tyaga.licence_lire_echantillon(a,b,'pi_1') IS DISTINCT FROM 'Échantillon 1' THEN RAISE EXCEPTION 'Missing text'; END IF;
 BEGIN PERFORM tyaga.licence_lire_echantillon(a,b,'pi_other'); RAISE EXCEPTION 'Wrong intent read'; EXCEPTION WHEN no_data_found THEN NULL; END;
 IF tyaga.licence_etat(a,true) ? 'text' THEN RAISE EXCEPTION 'Direct free RPC leaked paid content'; END IF;
 PERFORM tyaga.licence_regler_test(id,'cs_1','pi_1',b,'acct_testSeller',800,'eur','revoked');
 PERFORM tyaga.licence_regler_test(id,'cs_1','pi_1',b,'acct_testSeller',800,'eur','paid');
 BEGIN PERFORM tyaga.licence_lire_echantillon(a,b,'pi_1'); RAISE EXCEPTION 'Refund replay reopened access'; EXCEPTION WHEN no_data_found THEN NULL; END;
 a:='21000000-0000-4000-8000-000000000002';
 id:=(tyaga.licence_devis_test(a,b,current_setting('test.v2'),true)->>'id')::uuid;
 PERFORM tyaga.licence_session_test(id,'cs_2');
 PERFORM tyaga.licence_regler_test(id,'cs_2','pi_2',b,'acct_testSeller',800,'eur','revoked');
 PERFORM tyaga.licence_regler_test(id,'cs_2','pi_2',b,'acct_testSeller',800,'eur','paid');
 BEGIN PERFORM tyaga.licence_lire_echantillon(a,b,'pi_2'); RAISE EXCEPTION 'Refund before paid opened access'; EXCEPTION WHEN no_data_found THEN NULL; END;
END $$;
ROLLBACK;
