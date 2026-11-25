-- À appliquer après digital-listings.sql. Le texte intégral ne passe jamais par
-- une table ou un bucket exposé par PostgREST. Les quatre RPC utilisent auth.uid().
BEGIN;
CREATE SCHEMA IF NOT EXISTS tyaga_licences_privees;
REVOKE ALL ON SCHEMA tyaga_licences_privees FROM PUBLIC, anon, authenticated;
CREATE UNIQUE INDEX IF NOT EXISTS idx_annonces_id_prix ON tyaga.annonces(id, price_cents);

CREATE TABLE IF NOT EXISTS tyaga_licences_privees.oeuvres (
  annonce_id uuid PRIMARY KEY,
  auteur_id uuid NOT NULL REFERENCES tyaga.profiles(id),
  texte text NOT NULL CHECK (char_length(btrim(texte)) BETWEEN 1 AND 32000 AND octet_length(texte) <= 128000),
  prix_centimes integer NOT NULL DEFAULT 0 CHECK (prix_centimes >= 0),
  atteste_le timestamptz NOT NULL DEFAULT now(),
  -- L'offre ne peut devenir payante ni être détruite sous les droits accordés.
  FOREIGN KEY (annonce_id, prix_centimes) REFERENCES tyaga.annonces(id, price_cents) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS tyaga_licences_privees.droits (
  annonce_id uuid NOT NULL REFERENCES tyaga_licences_privees.oeuvres(annonce_id) ON DELETE RESTRICT,
  lecteur_id uuid NOT NULL REFERENCES tyaga.profiles(id) ON DELETE CASCADE,
  acquis_le timestamptz NOT NULL DEFAULT now(),
  expire_le timestamptz,
  titre text NOT NULL,
  conditions text NOT NULL,
  version_acceptee text NOT NULL,
  revoque_le timestamptz,
  PRIMARY KEY (annonce_id, lecteur_id),
  CHECK (expire_le IS NULL OR expire_le > acquis_le)
);
CREATE INDEX IF NOT EXISTS droits_par_lecteur ON tyaga_licences_privees.droits(lecteur_id, acquis_le DESC);
REVOKE ALL ON ALL TABLES IN SCHEMA tyaga_licences_privees FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION tyaga.licence_joindre(p_annonce uuid, p_texte text, p_attestation boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := auth.uid();
  a tyaga.annonces%ROWTYPE;
  contenu text;
BEGIN
  IF v_user IS NULL OR p_attestation IS DISTINCT FROM true THEN RAISE insufficient_privilege; END IF;
  IF p_texte IS NULL OR char_length(btrim(p_texte)) NOT BETWEEN 1 AND 32000 OR octet_length(p_texte) > 128000 THEN
    RAISE invalid_parameter_value;
  END IF;
  SELECT * INTO a FROM tyaga.annonces WHERE id = p_annonce FOR UPDATE;
  IF NOT FOUND OR a.user_id <> v_user OR a.status <> 'published' OR a.asset_kind <> 'digital'
     OR a.listing_intent <> 'offer' OR a.price_cents <> 0 OR a.digital_rights_attested IS DISTINCT FROM true THEN
    RAISE insufficient_privilege;
  END IF;
  INSERT INTO tyaga_licences_privees.oeuvres(annonce_id, auteur_id, texte)
    VALUES (p_annonce, v_user, p_texte) ON CONFLICT DO NOTHING;
  SELECT texte INTO contenu FROM tyaga_licences_privees.oeuvres WHERE annonce_id = p_annonce AND auteur_id = v_user;
  IF contenu IS DISTINCT FROM p_texte THEN RAISE unique_violation; END IF;
END $$;

CREATE OR REPLACE FUNCTION tyaga_licences_privees.version_offre(a tyaga.annonces)
RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT encode(sha256(convert_to(jsonb_build_array(a.id, a.user_id, a.price_cents, a.listing_mode,
    a.digital_license_terms, a.digital_license_days, a.title, a.digital_format)::text, 'UTF8')), 'hex');
$$;

CREATE OR REPLACE FUNCTION tyaga.licence_etat(p_annonce uuid, p_lire boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := auth.uid();
  d tyaga_licences_privees.droits%ROWTYPE;
  a tyaga.annonces%ROWTYPE;
  v_attachee boolean;
  v_prix integer;
  v_active boolean;
  resultat jsonb;
BEGIN
  IF v_user IS NULL THEN RAISE insufficient_privilege; END IF;
  SELECT * INTO d FROM tyaga_licences_privees.droits WHERE annonce_id = p_annonce AND lecteur_id = v_user;
  IF FOUND THEN
    IF d.revoque_le IS NOT NULL THEN RETURN jsonb_build_object('state','revoked'); END IF;
    SELECT prix_centimes INTO v_prix FROM tyaga_licences_privees.oeuvres WHERE annonce_id = p_annonce;
    IF v_prix > 0 THEN RETURN jsonb_build_object('state',CASE WHEN d.expire_le IS NULL OR d.expire_le > clock_timestamp()
      THEN 'sample_access' ELSE 'expired' END,'expiresAt',d.expire_le,'acquiredAt',d.acquis_le,'terms',d.conditions); END IF;
    v_active := d.expire_le IS NULL OR d.expire_le > clock_timestamp();
    resultat := jsonb_build_object('state', CASE WHEN v_active THEN 'active' ELSE 'expired' END,
      'title', d.titre, 'terms', d.conditions, 'acquiredAt', d.acquis_le, 'expiresAt', d.expire_le);
    IF p_lire AND v_active THEN
      RETURN resultat || jsonb_build_object('text', (SELECT texte FROM tyaga_licences_privees.oeuvres WHERE annonce_id = p_annonce));
    END IF;
    RETURN resultat;
  END IF;

  SELECT * INTO a FROM tyaga.annonces WHERE id = p_annonce AND status = 'published'
    AND asset_kind = 'digital' AND listing_intent = 'offer' AND digital_rights_attested AND user_validated;
  IF NOT FOUND THEN RAISE no_data_found; END IF;
  SELECT EXISTS(SELECT 1 FROM tyaga_licences_privees.oeuvres WHERE annonce_id = p_annonce AND auteur_id = a.user_id) INTO v_attachee;
  IF a.price_cents > 0 THEN
    RETURN jsonb_build_object('state', CASE WHEN v_attachee AND a.user_id <> v_user THEN 'sample_available'
      WHEN a.user_id = v_user AND NOT v_attachee THEN 'sample_attach'
      WHEN a.user_id = v_user THEN 'sample_owner' ELSE 'sample_missing' END,
      'version',tyaga_licences_privees.version_offre(a),'terms',a.digital_license_terms,'days',a.digital_license_days);
  END IF;
  IF NOT v_attachee THEN
    RETURN jsonb_build_object('state', CASE WHEN a.user_id = v_user THEN 'attach' ELSE 'missing' END);
  END IF;
  IF a.user_id = v_user THEN
    resultat := jsonb_build_object('state', 'owner');
    IF p_lire THEN
      RETURN resultat || jsonb_build_object('text', (SELECT texte FROM tyaga_licences_privees.oeuvres WHERE annonce_id = p_annonce));
    END IF;
    RETURN resultat;
  END IF;
  RETURN jsonb_build_object('state', 'available', 'version', tyaga_licences_privees.version_offre(a),
    'terms', a.digital_license_terms, 'days', a.digital_license_days);
END $$;

CREATE OR REPLACE FUNCTION tyaga.licence_acquerir(p_annonce uuid, p_version text, p_accepter boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := auth.uid();
  instant timestamptz := statement_timestamp();
  a tyaga.annonces%ROWTYPE;
BEGIN
  IF v_user IS NULL OR p_accepter IS DISTINCT FROM true THEN RAISE insufficient_privilege; END IF;
  IF EXISTS(SELECT 1 FROM tyaga_licences_privees.droits WHERE annonce_id = p_annonce AND lecteur_id = v_user) THEN
    RETURN; -- y compris après expiration : un rejeu ne renouvelle jamais le droit
  END IF;
  SELECT * INTO a FROM tyaga.annonces WHERE id = p_annonce FOR SHARE;
  IF NOT FOUND OR a.user_id = v_user OR a.price_cents <> 0 OR a.status <> 'published'
     OR a.asset_kind <> 'digital' OR a.listing_intent <> 'offer'
     OR a.digital_rights_attested IS DISTINCT FROM true OR a.user_validated IS DISTINCT FROM true
     OR NOT EXISTS(SELECT 1 FROM tyaga_licences_privees.oeuvres WHERE annonce_id = p_annonce AND auteur_id = a.user_id) THEN
    RAISE insufficient_privilege;
  END IF;
  IF tyaga_licences_privees.version_offre(a) IS DISTINCT FROM p_version THEN RAISE serialization_failure; END IF;
  INSERT INTO tyaga_licences_privees.droits(annonce_id, lecteur_id, acquis_le, expire_le, titre, conditions, version_acceptee)
  VALUES (a.id, v_user, instant, CASE WHEN a.listing_mode = 'rental' THEN instant + a.digital_license_days * interval '24 hours' END,
    a.title, a.digital_license_terms, p_version) ON CONFLICT DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION tyaga.mes_licences()
RETURNS TABLE(annonce_id uuid, titre text, acquis_le timestamptz, expire_le timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT d.annonce_id, d.titre, d.acquis_le, d.expire_le FROM tyaga_licences_privees.droits d
  WHERE d.lecteur_id = auth.uid() ORDER BY d.acquis_le DESC, d.annonce_id;
$$;
REVOKE ALL ON FUNCTION tyaga_licences_privees.version_offre(tyaga.annonces) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION tyaga.licence_joindre(uuid,text,boolean), tyaga.licence_acquerir(uuid,text,boolean),
  tyaga.licence_etat(uuid,boolean), tyaga.mes_licences() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION tyaga.licence_joindre(uuid,text,boolean), tyaga.licence_acquerir(uuid,text,boolean),
  tyaga.licence_etat(uuid,boolean), tyaga.mes_licences() TO authenticated;
COMMIT;
