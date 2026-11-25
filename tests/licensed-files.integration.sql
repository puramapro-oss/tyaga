BEGIN;
INSERT INTO auth.users(id) VALUES ('12000000-0000-4000-8000-000000000001'),('12000000-0000-4000-8000-000000000002');
UPDATE tyaga.profiles SET stripe_connect_account_id='acct_file' WHERE id='12000000-0000-4000-8000-000000000001';
INSERT INTO tyaga.annonces(id,user_id,title,description,status,user_validated,published_at,price_cents,
 asset_kind,listing_intent,listing_mode,digital_format,digital_license_terms,digital_license_days,digital_rights_attested,publication_request_id)
SELECT id::uuid,'12000000-0000-4000-8000-000000000001','Mon livre','Un ouvrage original au format PDF.',
 'published',true,now(),p,'digital','offer','rental','PDF','Téléchargement autorisé pendant 24 heures.',1,true,gen_random_uuid()
FROM (VALUES('22000000-0000-4000-8000-000000000001',0),('22000000-0000-4000-8000-000000000002',800)) AS f(id,p);
SET LOCAL ROLE service_role;
DO $$
DECLARE gratuit uuid:='22000000-0000-4000-8000-000000000001'; payant uuid:='22000000-0000-4000-8000-000000000002';
 auteur uuid:='12000000-0000-4000-8000-000000000001'; lecteur uuid:='12000000-0000-4000-8000-000000000002';
 contenu text:=encode(convert_to('%PDF-1.7 exemple %%EOF','UTF8'),'base64');
BEGIN
  BEGIN PERFORM tyaga.licence_fichier_joindre(gratuit,lecteur,'application/pdf',contenu,false);
    RAISE EXCEPTION 'Wrong owner'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM tyaga.licence_fichier_joindre(gratuit,auteur,'application/pdf',contenu,false);
  PERFORM tyaga.licence_fichier_joindre(gratuit,auteur,'application/pdf',contenu,false);
  BEGIN PERFORM tyaga.licence_fichier_joindre(gratuit,auteur,'application/pdf','eA==',false);
    RAISE EXCEPTION 'Replacement accepted'; EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN PERFORM tyaga.licence_fichier_joindre(payant,auteur,'application/pdf',contenu,false);
    RAISE EXCEPTION 'Paid asset treated as free'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM tyaga.licence_fichier_joindre(payant,auteur,'application/pdf',contenu,true);
  IF tyaga.licence_fichier(gratuit,lecteur,false,false) ? 'data' THEN RAISE EXCEPTION 'HEAD included bytes'; END IF;
  BEGIN PERFORM tyaga.licence_fichier(gratuit,lecteur,true,false);
    RAISE EXCEPTION 'Unlicensed reader'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','12000000-0000-4000-8000-000000000002',true);
SELECT tyaga.licence_acquerir('22000000-0000-4000-8000-000000000001',tyaga.licence_etat('22000000-0000-4000-8000-000000000001')->>'version',true);
SELECT set_config('test.file_version',tyaga.licence_etat('22000000-0000-4000-8000-000000000002')->>'version',true);
DO $$ BEGIN
 BEGIN PERFORM * FROM tyaga_licences_privees.fichiers; RAISE EXCEPTION 'Raw bytes accessible'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM tyaga.licence_fichier('22000000-0000-4000-8000-000000000001',auth.uid(),true,true);
   RAISE EXCEPTION 'Direct access RPC'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE service_role;
DO $$
DECLARE gratuit uuid:='22000000-0000-4000-8000-000000000001'; payant uuid:='22000000-0000-4000-8000-000000000002';
 lecteur uuid:='12000000-0000-4000-8000-000000000002'; commande uuid;
BEGIN
 IF convert_from(decode(tyaga.licence_fichier(gratuit,lecteur,true,false)->>'data','base64'),'UTF8') IS DISTINCT FROM '%PDF-1.7 exemple %%EOF' THEN
   RAISE EXCEPTION 'Grant did not deliver exact bytes'; END IF;
 commande := (tyaga.licence_devis_test(payant,lecteur,current_setting('test.file_version'),true)->>'id')::uuid;
 PERFORM tyaga.licence_session_test(commande,'cs_file');
 PERFORM tyaga.licence_regler_test(commande,'cs_file','pi_file',lecteur,'acct_file',800,'eur','paid');
 BEGIN PERFORM tyaga.licence_fichier(payant,lecteur,true,false);
   RAISE EXCEPTION 'Missing provider reconciliation'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF tyaga.licence_fichier(payant,lecteur,true,true)->>'data' IS NULL THEN RAISE EXCEPTION 'Paid sample missing'; END IF;
 PERFORM tyaga.licence_regler_test(commande,'cs_file','pi_file',lecteur,'acct_file',800,'eur','revoked');
 BEGIN PERFORM tyaga.licence_fichier(payant,lecteur,true,true);
   RAISE EXCEPTION 'Refund did not close bytes'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE tyaga_licences_privees.droits SET acquis_le=now()-interval '2 days',expire_le=now()-interval '1 day'
 WHERE annonce_id='22000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN PERFORM tyaga.licence_fichier('22000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000002',true,false);
   RAISE EXCEPTION 'Expired file access'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
