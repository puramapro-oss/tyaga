-- Install after digital-licenses.sql and digital-checkout-test.sql.
BEGIN;
CREATE TABLE IF NOT EXISTS tyaga_licences_privees.fichiers (
  annonce_id uuid PRIMARY KEY REFERENCES tyaga_licences_privees.oeuvres(annonce_id) ON DELETE RESTRICT,
  media_type text NOT NULL CHECK(media_type IN ('application/pdf','image/jpeg','image/png','audio/wav','video/mp4')),
  contenu bytea NOT NULL CHECK(octet_length(contenu) BETWEEN 1 AND 2097152),
  empreinte bytea NOT NULL CHECK(octet_length(empreinte)=32)
);
REVOKE ALL ON tyaga_licences_privees.fichiers FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION tyaga.licence_fichier_joindre(p_annonce uuid,p_auteur uuid,p_media text,p_base64 text,p_test boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  a tyaga.annonces%ROWTYPE;
  octets bytea;
  existing tyaga_licences_privees.fichiers%ROWTYPE;
BEGIN
  PERFORM tyaga_licences_privees.exiger_service();
  IF p_auteur IS NULL OR p_base64 IS NULL OR length(p_base64)>2796204 OR p_media IS NULL OR
     p_media NOT IN ('application/pdf','image/jpeg','image/png','audio/wav','video/mp4') THEN RAISE invalid_parameter_value; END IF;
  octets := decode(p_base64,'base64');
  IF octet_length(octets) NOT BETWEEN 1 AND 2097152 THEN RAISE invalid_parameter_value; END IF;
  SELECT * INTO a FROM tyaga.annonces WHERE id=p_annonce FOR UPDATE;
  IF NOT FOUND OR a.user_id IS DISTINCT FROM p_auteur OR a.status<>'published' OR a.asset_kind<>'digital'
    OR a.listing_intent<>'offer' OR NOT a.user_validated OR NOT a.digital_rights_attested
    OR p_test IS DISTINCT FROM (a.price_cents>0) THEN RAISE insufficient_privilege; END IF;
  SELECT * INTO existing FROM tyaga_licences_privees.fichiers WHERE annonce_id=a.id;
  IF FOUND THEN
    IF existing.empreinte<>sha256(octets) OR existing.media_type<>p_media THEN RAISE unique_violation; END IF;
    RETURN;
  END IF;
  -- This attachment is an alternative to a text work. Never alter a work already reviewed or purchased.
  IF EXISTS(SELECT FROM tyaga_licences_privees.oeuvres WHERE annonce_id=a.id) THEN RAISE unique_violation; END IF;
  INSERT INTO tyaga_licences_privees.oeuvres(annonce_id,auteur_id,texte,prix_centimes)
    VALUES(a.id,p_auteur,'Fichier sous licence. Le téléchargement est autorisé pendant la durée du droit.',a.price_cents);
  INSERT INTO tyaga_licences_privees.fichiers(annonce_id,media_type,contenu,empreinte)
    VALUES(a.id,p_media,octets,sha256(octets));
END $$;

-- Server-only bytes. The authenticated reader and any provider reconciliation
-- originate in the API; always recheck the grant and expiry at retrieval time.
CREATE OR REPLACE FUNCTION tyaga.licence_fichier(p_annonce uuid,p_lecteur uuid,p_octets boolean,p_reglement_confirme boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o tyaga_licences_privees.oeuvres%ROWTYPE; a tyaga.annonces%ROWTYPE; d tyaga_licences_privees.droits%ROWTYPE;
BEGIN
  PERFORM tyaga_licences_privees.exiger_service();
  IF p_lecteur IS NULL OR p_octets IS NULL THEN RAISE insufficient_privilege; END IF;
  SELECT * INTO o FROM tyaga_licences_privees.oeuvres WHERE annonce_id=p_annonce;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO a FROM tyaga.annonces WHERE id=p_annonce;
  SELECT * INTO d FROM tyaga_licences_privees.droits WHERE annonce_id=p_annonce AND lecteur_id=p_lecteur;
  IF o.auteur_id=p_lecteur AND a.user_id=p_lecteur THEN NULL;
  ELSIF d.lecteur_id IS NOT NULL AND d.revoque_le IS NULL AND (d.expire_le IS NULL OR d.expire_le>clock_timestamp()) THEN
    IF p_octets AND o.prix_centimes>0 AND (p_reglement_confirme IS DISTINCT FROM true OR NOT EXISTS(
      SELECT FROM tyaga_licences_privees.commandes_test WHERE annonce_id=p_annonce AND acheteur=p_lecteur AND statut='paid'
    )) THEN RAISE insufficient_privilege; END IF;
  ELSIF p_octets OR a.status<>'published' OR NOT a.user_validated OR a.asset_kind<>'digital'
    OR a.listing_intent<>'offer' OR a.user_id<>o.auteur_id THEN RAISE insufficient_privilege; END IF;
  RETURN (SELECT jsonb_build_object('type',f.media_type,'size',octet_length(f.contenu),'sample',o.prix_centimes>0,
    'owner',o.auteur_id=p_lecteur AND a.user_id=p_lecteur)
    || CASE WHEN p_octets THEN jsonb_build_object('data',encode(f.contenu,'base64')) ELSE '{}'::jsonb END
    FROM tyaga_licences_privees.fichiers f WHERE f.annonce_id=p_annonce);
END $$;
REVOKE ALL ON FUNCTION tyaga.licence_fichier_joindre(uuid,uuid,text,text,boolean),
  tyaga.licence_fichier(uuid,uuid,boolean,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION tyaga.licence_fichier_joindre(uuid,uuid,text,text,boolean),
  tyaga.licence_fichier(uuid,uuid,boolean,boolean) TO service_role;
COMMIT;
