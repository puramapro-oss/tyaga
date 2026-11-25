-- Recette Stripe Connect : chaque œuvre payante de cette version est un
-- échantillon que l'auteur accepte expressément de fournir à des testeurs.
BEGIN;
CREATE TABLE IF NOT EXISTS tyaga_licences_privees.commandes_test (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  annonce_id uuid NOT NULL REFERENCES tyaga_licences_privees.oeuvres(annonce_id),
  acheteur uuid NOT NULL REFERENCES tyaga.profiles(id), vendeur uuid NOT NULL REFERENCES tyaga.profiles(id),
  montant integer NOT NULL CHECK(montant > 0), destination text NOT NULL,
  titre text NOT NULL, conditions text NOT NULL, duree integer, version text NOT NULL,
  accepte_le timestamptz NOT NULL DEFAULT now(), session_id text UNIQUE, intent_id text UNIQUE,
  statut text NOT NULL DEFAULT 'pending' CHECK(statut IN ('pending','paid','revoked','expired')),
  CHECK(acheteur <> vendeur)
);
CREATE UNIQUE INDEX IF NOT EXISTS commande_test_active ON tyaga_licences_privees.commandes_test(acheteur,annonce_id)
  WHERE statut IN ('pending','paid','revoked');
REVOKE ALL ON TABLE tyaga_licences_privees.commandes_test FROM PUBLIC, anon, authenticated;

-- Les endpoints RPC de règlement sont réservés au serveur, y compris si
-- la procédure historique de bootstrap rejoue ses GRANT ALL globaux.
CREATE OR REPLACE FUNCTION tyaga_licences_privees.exiger_service() RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN IF current_setting('role',true) IS DISTINCT FROM 'service_role' THEN RAISE insufficient_privilege; END IF; END $$;

CREATE OR REPLACE FUNCTION tyaga.licence_echantillon(p_annonce uuid,p_auteur uuid,p_texte text,p_atteste boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a tyaga.annonces%ROWTYPE;
BEGIN
  PERFORM tyaga_licences_privees.exiger_service();
  SELECT * INTO a FROM tyaga.annonces WHERE id=p_annonce FOR UPDATE;
  IF NOT FOUND OR p_atteste IS DISTINCT FROM true OR a.user_id IS DISTINCT FROM p_auteur OR a.asset_kind <> 'digital'
    OR a.listing_intent <> 'offer' OR a.price_cents <= 0 OR a.status <> 'published' OR NOT a.digital_rights_attested
    OR NOT a.user_validated THEN RAISE insufficient_privilege; END IF;
  INSERT INTO tyaga_licences_privees.oeuvres(annonce_id,auteur_id,texte,prix_centimes)
    VALUES(a.id,a.user_id,p_texte,a.price_cents) ON CONFLICT DO NOTHING;
  IF (SELECT texte FROM tyaga_licences_privees.oeuvres WHERE annonce_id=a.id AND auteur_id=a.user_id)
    IS DISTINCT FROM p_texte THEN RAISE unique_violation; END IF;
END $$;

CREATE OR REPLACE FUNCTION tyaga.licence_devis_test(p_annonce uuid,p_acheteur uuid,p_version text,p_accepte boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a tyaga.annonces%ROWTYPE; dest text; c tyaga_licences_privees.commandes_test%ROWTYPE;
BEGIN
  PERFORM tyaga_licences_privees.exiger_service();
  SELECT * INTO a FROM tyaga.annonces WHERE id=p_annonce FOR UPDATE;
  IF NOT FOUND OR p_accepte IS DISTINCT FROM true OR p_acheteur IS NULL OR a.user_id=p_acheteur OR a.status<>'published'
     OR a.asset_kind<>'digital' OR a.listing_intent<>'offer' OR NOT a.user_validated OR NOT a.digital_rights_attested
     OR NOT EXISTS(SELECT 1 FROM tyaga_licences_privees.oeuvres WHERE annonce_id=a.id AND auteur_id=a.user_id AND prix_centimes>0)
    THEN RAISE insufficient_privilege; END IF;
  IF tyaga_licences_privees.version_offre(a) IS DISTINCT FROM p_version THEN RAISE serialization_failure; END IF;
  SELECT stripe_connect_account_id INTO dest FROM tyaga.profiles WHERE id=a.user_id;
  IF dest IS NULL OR dest NOT LIKE 'acct\_%' THEN RAISE no_data_found; END IF;
  SELECT * INTO c FROM tyaga_licences_privees.commandes_test WHERE annonce_id=a.id AND acheteur=p_acheteur AND statut<>'expired';
  IF NOT FOUND THEN
    INSERT INTO tyaga_licences_privees.commandes_test(annonce_id,acheteur,vendeur,montant,destination,titre,conditions,duree,version)
      VALUES(a.id,p_acheteur,a.user_id,a.price_cents,dest,a.title,a.digital_license_terms,a.digital_license_days,p_version) RETURNING * INTO c;
  ELSIF c.version <> p_version OR c.statut<>'pending' THEN RAISE unique_violation;
  END IF;
  RETURN to_jsonb(c);
END $$;

CREATE OR REPLACE FUNCTION tyaga.licence_session_test(p_commande uuid,p_session text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM tyaga_licences_privees.exiger_service();
  UPDATE tyaga_licences_privees.commandes_test SET session_id=p_session
    WHERE id=p_commande AND statut='pending' AND (session_id IS NULL OR session_id=p_session);
  IF NOT FOUND THEN RAISE serialization_failure; END IF;
END $$;

CREATE OR REPLACE FUNCTION tyaga.licence_regler_test(p_commande uuid,p_session text,p_intent text,p_acheteur uuid,
  p_destination text,p_montant integer,p_devise text,p_statut text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c tyaga_licences_privees.commandes_test%ROWTYPE; instant timestamptz:=statement_timestamp();
BEGIN
  PERFORM tyaga_licences_privees.exiger_service();
  SELECT * INTO STRICT c FROM tyaga_licences_privees.commandes_test WHERE id=p_commande FOR UPDATE;
  IF c.session_id IS NULL OR c.session_id IS DISTINCT FROM p_session OR c.acheteur IS DISTINCT FROM p_acheteur
     OR c.montant IS DISTINCT FROM p_montant OR p_devise IS DISTINCT FROM 'eur'
     OR c.destination IS DISTINCT FROM p_destination OR p_statut IS NULL OR p_statut NOT IN ('paid','revoked','expired')
     OR (p_statut<>'expired' AND (p_intent IS NULL OR p_intent NOT LIKE 'pi\_%'
        OR (c.intent_id IS NOT NULL AND c.intent_id<>p_intent))) THEN RAISE invalid_parameter_value; END IF;
  IF c.statut='revoked' THEN RETURN; END IF;
  IF p_statut='expired' THEN
    UPDATE tyaga_licences_privees.commandes_test SET statut='expired' WHERE id=c.id AND statut='pending';
  ELSIF p_statut='revoked' THEN
    UPDATE tyaga_licences_privees.commandes_test SET statut='revoked',intent_id=p_intent WHERE id=c.id;
    UPDATE tyaga_licences_privees.droits SET revoque_le=coalesce(revoque_le,instant) WHERE annonce_id=c.annonce_id AND lecteur_id=c.acheteur;
  ELSIF c.statut IN ('paid','pending') THEN
    UPDATE tyaga_licences_privees.commandes_test SET statut='paid',intent_id=p_intent WHERE id=c.id;
    INSERT INTO tyaga_licences_privees.droits(annonce_id,lecteur_id,acquis_le,expire_le,titre,conditions,version_acceptee)
      VALUES(c.annonce_id,c.acheteur,instant,CASE WHEN c.duree IS NOT NULL THEN instant + c.duree * interval '24 hours' END,
        c.titre,c.conditions,c.version) ON CONFLICT DO NOTHING;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION tyaga.licence_commande_test(p_commande uuid,p_annonce uuid,p_acheteur uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c tyaga_licences_privees.commandes_test%ROWTYPE;
BEGIN
  PERFORM tyaga_licences_privees.exiger_service();
  SELECT * INTO c FROM tyaga_licences_privees.commandes_test
    WHERE (p_commande IS NOT NULL AND id=p_commande) OR
          (p_commande IS NULL AND annonce_id=p_annonce AND acheteur = p_acheteur AND statut<>'expired');
  RETURN CASE WHEN FOUND THEN to_jsonb(c) END;
END $$;

CREATE OR REPLACE FUNCTION tyaga.licence_lire_echantillon(p_annonce uuid,p_acheteur uuid,p_intent text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE resultat text;
BEGIN
  PERFORM tyaga_licences_privees.exiger_service();
  SELECT o.texte INTO STRICT resultat FROM tyaga_licences_privees.oeuvres o
    JOIN tyaga_licences_privees.droits d USING(annonce_id)
    JOIN tyaga_licences_privees.commandes_test c ON c.annonce_id=d.annonce_id AND c.acheteur=d.lecteur_id
    WHERE d.annonce_id=p_annonce AND d.lecteur_id=p_acheteur AND d.revoque_le IS NULL
      AND (d.expire_le IS NULL OR d.expire_le>clock_timestamp()) AND c.statut='paid' AND c.intent_id=p_intent;
  RETURN resultat;
END $$;

REVOKE ALL ON FUNCTION tyaga.licence_echantillon(uuid,uuid,text,boolean),tyaga.licence_devis_test(uuid,uuid,text,boolean),
  tyaga.licence_session_test(uuid,text),tyaga.licence_regler_test(uuid,text,text,uuid,text,integer,text,text),
  tyaga.licence_commande_test(uuid,uuid,uuid),tyaga.licence_lire_echantillon(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION tyaga.licence_echantillon(uuid,uuid,text,boolean),tyaga.licence_devis_test(uuid,uuid,text,boolean),
  tyaga.licence_session_test(uuid,text),tyaga.licence_regler_test(uuid,text,text,uuid,text,integer,text,text),
  tyaga.licence_commande_test(uuid,uuid,uuid),tyaga.licence_lire_echantillon(uuid,uuid,text) TO service_role;
COMMIT;
