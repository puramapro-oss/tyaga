-- Apply after digital-listings.sql. Links are disabled until the owner consents.
BEGIN;

CREATE SCHEMA IF NOT EXISTS tyaga_partages_prives;
REVOKE ALL ON SCHEMA tyaga_partages_prives FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS tyaga_partages_prives.listing_preview_links (
  annonce_id uuid PRIMARY KEY REFERENCES tyaga.annonces(id) ON DELETE CASCADE,
  token uuid UNIQUE NOT NULL DEFAULT gen_random_uuid()
);
ALTER TABLE tyaga_partages_prives.listing_preview_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tyaga_partages_prives.listing_preview_links FROM PUBLIC, anon, authenticated;

-- Publication, withdrawal and consent changes serialize on the same listing row.
CREATE OR REPLACE FUNCTION tyaga.manage_listing_preview(p_listing uuid, p_action text, p_reviewed jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  listing tyaga.annonces%ROWTYPE;
  result uuid;
BEGIN
  SELECT * INTO listing FROM tyaga.annonces WHERE id = p_listing AND user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Listing unavailable' USING ERRCODE = '42501'; END IF;
  IF p_action = 'revoke' THEN
    DELETE FROM tyaga_partages_prives.listing_preview_links WHERE annonce_id = p_listing;
    RETURN NULL;
  END IF;
  IF p_action = 'enable' THEN
    IF listing.status <> 'published' OR NOT listing.user_validated OR p_reviewed IS DISTINCT FROM
        jsonb_build_object('title', listing.title, 'priceCents', listing.price_cents, 'kind', listing.asset_kind,
          'intent', listing.listing_intent, 'mode', listing.listing_mode) THEN
      RAISE EXCEPTION 'Review required' USING ERRCODE = '22023';
    END IF;
    INSERT INTO tyaga_partages_prives.listing_preview_links (annonce_id) VALUES (p_listing)
      ON CONFLICT (annonce_id) DO NOTHING;
  ELSIF p_action IS DISTINCT FROM 'read' THEN
    RAISE EXCEPTION 'Invalid action' USING ERRCODE = '22023';
  END IF;
  SELECT token INTO result FROM tyaga_partages_prives.listing_preview_links WHERE annonce_id = p_listing;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION tyaga.manage_listing_preview(uuid,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION tyaga.manage_listing_preview(uuid,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION tyaga.invalidate_listing_preview() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  DELETE FROM tyaga_partages_prives.listing_preview_links WHERE annonce_id = NEW.id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION tyaga.invalidate_listing_preview() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS invalidate_public_preview ON tyaga.annonces;
CREATE TRIGGER invalidate_public_preview AFTER UPDATE ON tyaga.annonces FOR EACH ROW
  WHEN ((OLD.user_id, OLD.status, OLD.user_validated, OLD.title, OLD.price_cents, OLD.asset_kind, OLD.listing_intent, OLD.listing_mode)
    IS DISTINCT FROM (NEW.user_id, NEW.status, NEW.user_validated, NEW.title, NEW.price_cents, NEW.asset_kind, NEW.listing_intent, NEW.listing_mode))
  EXECUTE FUNCTION tyaga.invalidate_listing_preview();

CREATE OR REPLACE FUNCTION tyaga.read_public_listing_preview(p_token uuid)
RETURNS TABLE (listing_id uuid, title text, price_cents integer, kind text, intent text, mode text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT a.id, a.title, a.price_cents, a.asset_kind, a.listing_intent, a.listing_mode
    FROM tyaga_partages_prives.listing_preview_links AS l
    JOIN tyaga.annonces AS a ON a.id = l.annonce_id
   WHERE l.token = p_token AND a.status = 'published' AND a.user_validated;
$$;
REVOKE ALL ON FUNCTION tyaga.read_public_listing_preview(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION tyaga.read_public_listing_preview(uuid) TO service_role;

COMMIT;
