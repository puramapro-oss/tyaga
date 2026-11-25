-- Recette PostgreSQL sur une base isolée avec le schéma TYAGA et les deux
-- migrations digital-listings puis digital-licenses. Toutes les écritures
-- de la recette sont annulées à la fin.
BEGIN;
INSERT INTO auth.users(id) VALUES
 ('10000000-0000-4000-8000-000000000001'), ('10000000-0000-4000-8000-000000000002'), ('10000000-0000-4000-8000-000000000003');
INSERT INTO tyaga.annonces(id,user_id,title,description,status,user_validated,published_at,
  price_cents,asset_kind,listing_intent,listing_mode,digital_format,digital_license_terms,digital_license_days,digital_rights_attested,publication_request_id)
SELECT id::uuid,'10000000-0000-4000-8000-000000000001','Mon texte original','Un véritable texte à lire sous licence.',
  'published',true,now(),price,'digital',intent,mode,'Texte','Lecture personnelle de ce texte.',days,intent='offer',gen_random_uuid()
FROM (VALUES
 ('20000000-0000-4000-8000-000000000001',0,'offer','rental',2),
 ('20000000-0000-4000-8000-000000000002',0,'offer','sale',NULL),
 ('20000000-0000-4000-8000-000000000003',100,'offer','sale',NULL),
 ('20000000-0000-4000-8000-000000000004',0,'wanted','sale',NULL)
) AS assets(id,price,intent,mode,days);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
DO $$
DECLARE id uuid := '20000000-0000-4000-8000-000000000001';
BEGIN
  IF tyaga.licence_etat(id)->>'state' <> 'attach' THEN RAISE EXCEPTION 'Attachment missing'; END IF;
  BEGIN PERFORM tyaga.licence_joindre(id, 'Oeuvre originale', false); RAISE EXCEPTION 'Missing attestation allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM tyaga.licence_joindre(id, 'Oeuvre originale', true);
  PERFORM tyaga.licence_joindre(id, 'Oeuvre originale', true);
  BEGIN PERFORM tyaga.licence_joindre(id, 'Texte modifié', true); RAISE EXCEPTION 'Overwrite allowed'; EXCEPTION WHEN unique_violation THEN NULL; END;
  IF tyaga.licence_etat(id,true)->>'text' <> 'Oeuvre originale' THEN RAISE EXCEPTION 'Owner preview'; END IF;
  BEGIN PERFORM tyaga.licence_acquerir(id,'x',true); RAISE EXCEPTION 'Self claim'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM tyaga.licence_joindre('20000000-0000-4000-8000-000000000002','Une seconde œuvre',true);
  BEGIN PERFORM tyaga.licence_joindre('20000000-0000-4000-8000-000000000003','Payant',true); RAISE EXCEPTION 'Attached to paid offer'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM tyaga.licence_joindre('20000000-0000-4000-8000-000000000004','Recherche',true); RAISE EXCEPTION 'Attached to request'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE tyaga.annonces SET price_cents=1 WHERE annonces.id='20000000-0000-4000-8000-000000000002'; RAISE EXCEPTION 'Paid mutation permitted'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
DO $$
DECLARE id uuid := '20000000-0000-4000-8000-000000000001'; permanent uuid := '20000000-0000-4000-8000-000000000002'; s jsonb; original jsonb;
BEGIN
  s := tyaga.licence_etat(id,true);
  IF s->>'state' IS DISTINCT FROM 'available' OR s ? 'text' THEN RAISE EXCEPTION 'Unlicensed read'; END IF;
  BEGIN PERFORM tyaga.licence_joindre(id,'Faux auteur',true); RAISE EXCEPTION 'Wrong owner'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM tyaga.licence_acquerir(id,s->>'version',false); RAISE EXCEPTION 'Missing consent'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM tyaga.licence_acquerir(id,repeat('a',64),true); RAISE EXCEPTION 'Stale consent'; EXCEPTION WHEN serialization_failure THEN NULL; END;
  BEGIN PERFORM tyaga.licence_acquerir('20000000-0000-4000-8000-000000000003','x',true); RAISE EXCEPTION 'Paid licence granted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM texte FROM tyaga_licences_privees.oeuvres; RAISE EXCEPTION 'Raw table readable'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM tyaga.licence_acquerir(id,s->>'version',true);
  original := tyaga.licence_etat(id,true);
  IF original->>'state' IS DISTINCT FROM 'active' OR original->>'text' IS DISTINCT FROM 'Oeuvre originale'
    OR (original->>'expiresAt')::timestamptz - (original->>'acquiredAt')::timestamptz IS DISTINCT FROM interval '48 hours'
    THEN RAISE EXCEPTION 'Bad rental'; END IF;
  PERFORM tyaga.licence_acquerir(id,s->>'version',true);
  IF tyaga.licence_etat(id,true) IS DISTINCT FROM original THEN RAISE EXCEPTION 'Replay modified licence'; END IF;
  PERFORM tyaga.licence_acquerir(permanent,tyaga.licence_etat(permanent)->>'version',true);
  IF tyaga.licence_etat(permanent,true)->>'expiresAt' IS NOT NULL THEN RAISE EXCEPTION 'Permanent licence expired'; END IF;
  IF (SELECT count(*) FROM tyaga.mes_licences()) <> 2 THEN RAISE EXCEPTION 'Private library omitted licences'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM tyaga.mes_licences()) > 0 OR tyaga.licence_etat('20000000-0000-4000-8000-000000000001',true) ? 'text'
    THEN RAISE EXCEPTION 'Cross-account read'; END IF;
END $$;
RESET ROLE;
UPDATE tyaga_licences_privees.droits SET acquis_le = now()-interval '3 days',expire_le = now()-interval '1 day'
  WHERE annonce_id='20000000-0000-4000-8000-000000000001';
UPDATE tyaga.annonces SET status='unpublished' WHERE id='20000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
DO $$
DECLARE id uuid := '20000000-0000-4000-8000-000000000001';
BEGIN
  PERFORM tyaga.licence_acquerir(id,'x',true);
  IF tyaga.licence_etat(id,true)->>'state' IS DISTINCT FROM 'expired' OR tyaga.licence_etat(id,true) ? 'text' THEN RAISE EXCEPTION 'Expired grant leaked or renewed'; END IF;
  IF tyaga.licence_etat('20000000-0000-4000-8000-000000000002',true)->>'text' IS DISTINCT FROM 'Une seconde œuvre' THEN RAISE EXCEPTION 'Previously acquired work inaccessible'; END IF;
END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM tyaga.licence_etat('20000000-0000-4000-8000-000000000002',true); RAISE EXCEPTION 'Anonymous RPC allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
