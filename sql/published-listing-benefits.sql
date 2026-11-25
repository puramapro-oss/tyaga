-- Install after digital-listings.sql and listing-promotions.sql. Operators may
-- reserve a finite inventory of equal-duration slots and record independent
-- funding and reservation references. No campaign or grant is seeded.
BEGIN;
CREATE TABLE IF NOT EXISTS tyaga_promotion.publication_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enabled boolean NOT NULL DEFAULT false,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  funded_by_reference text NOT NULL CHECK(length(btrim(funded_by_reference)) BETWEEN 1 AND 200),
  reserved_inventory_reference text UNIQUE NOT NULL CHECK(reserved_inventory_reference=btrim(reserved_inventory_reference) AND length(reserved_inventory_reference) BETWEEN 1 AND 200),
  reserved_slots integer NOT NULL CHECK(reserved_slots BETWEEN 1 AND 1000000),
  issued_slots integer NOT NULL DEFAULT 0 CHECK(issued_slots BETWEEN 0 AND reserved_slots),
  member_limit integer NOT NULL CHECK(member_limit BETWEEN 1 AND reserved_slots),
  duration_hours integer NOT NULL CHECK(duration_hours BETWEEN 1 AND 168),
  redeem_days integer NOT NULL CHECK(redeem_days BETWEEN 1 AND 90),
  CHECK(isfinite(starts_at) AND isfinite(ends_at) AND starts_at < ends_at),
  EXCLUDE USING gist (tstzrange(starts_at,ends_at,'[)') WITH &&) WHERE (enabled)
);
-- The UUID tombstone keeps withdrawal/republication from creating a new
-- event, even when the initial publication preceded any funded campaign.
CREATE TABLE IF NOT EXISTS tyaga_promotion.seen_publications (listing_id uuid PRIMARY KEY);
CREATE TABLE IF NOT EXISTS tyaga_promotion.publication_awards (
  listing_id uuid PRIMARY KEY REFERENCES tyaga_promotion.seen_publications(listing_id),
  campaign_id uuid NOT NULL REFERENCES tyaga_promotion.publication_campaigns(id),
  beneficiary uuid REFERENCES tyaga.profiles(id) ON DELETE SET NULL,
  fingerprint bytea NOT NULL,
  grant_id uuid UNIQUE REFERENCES tyaga_promotion.grants(id) ON DELETE SET NULL,
  UNIQUE(beneficiary,fingerprint)
);
CREATE INDEX IF NOT EXISTS publication_awards_member ON tyaga_promotion.publication_awards(campaign_id,beneficiary);
REVOKE ALL ON tyaga_promotion.publication_campaigns,tyaga_promotion.seen_publications,tyaga_promotion.publication_awards
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION tyaga_promotion.first_publication_benefit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  c tyaga_promotion.publication_campaigns;
  when_published timestamptz := statement_timestamp();
  normalized text;
  signature bytea;
  issued_grant uuid;
BEGIN
  IF NEW.status <> 'published' OR (TG_OP='UPDATE' AND OLD.status='published') THEN RETURN NEW; END IF;
  INSERT INTO tyaga_promotion.seen_publications(listing_id) VALUES(NEW.id) ON CONFLICT DO NOTHING;
  IF NOT FOUND OR NOT NEW.user_validated OR NEW.user_id IS DISTINCT FROM auth.uid() OR NEW.published_at IS NULL
    OR NEW.price_cents NOT BETWEEN 0 AND 100000000 THEN RETURN NEW; END IF;

  SELECT * INTO c FROM tyaga_promotion.publication_campaigns WHERE enabled AND starts_at<=when_published
    AND when_published<ends_at AND issued_slots<reserved_slots FOR UPDATE;
  IF NOT FOUND OR clock_timestamp()>=c.ends_at THEN RETURN NEW; END IF;
  normalized := btrim(regexp_replace(translate(lower(NEW.title),'àâäéèêëîïôöùûüç','aaaeeeeiioouuuc'),'[^[:alnum:]]+',' ','g'));
  IF char_length(normalized)<5 OR char_length(btrim(NEW.description))<32
    OR (SELECT count(DISTINCT word) FROM regexp_split_to_table(lower(NEW.description),'[^[:alnum:]]+') AS words(word) WHERE length(word)>=3)<4
    OR lower(btrim(NEW.description))=lower(btrim(NEW.title)) THEN RETURN NEW; END IF;
  IF NEW.asset_kind='physical' AND NEW.listing_intent='offer' AND NOT EXISTS(
    SELECT 1 FROM tyaga.items i WHERE i.id=NEW.item_id AND i.user_id=NEW.user_id
  ) THEN RETURN NEW; END IF;
  IF NEW.asset_kind='digital' AND (char_length(btrim(coalesce(NEW.digital_format,'')))<2
    OR char_length(btrim(coalesce(NEW.digital_license_terms,'')))<20
    OR (NEW.listing_mode='rental' AND coalesce(NEW.digital_license_days,0) NOT BETWEEN 1 AND 3650)
    OR (NEW.listing_intent='offer' AND NOT NEW.digital_rights_attested)) THEN RETURN NEW; END IF;

  IF (SELECT count(*) FROM tyaga_promotion.publication_awards WHERE campaign_id=c.id AND beneficiary=NEW.user_id)>=c.member_limit THEN RETURN NEW; END IF;
  -- Reusing a title in a different direction or for a different asset class may represent a distinct need.
  signature := sha256(convert_to(jsonb_build_array(NEW.asset_kind,NEW.listing_intent,normalized)::text,'UTF8'));
  INSERT INTO tyaga_promotion.publication_awards(listing_id,campaign_id,beneficiary,fingerprint)
    VALUES(NEW.id,c.id,NEW.user_id,signature) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN NEW; END IF;
  issued_grant := tyaga_promotion.issue_grant(NEW.user_id,'tyaga_rewards','publication:'||NEW.id,
    'campaign_benefit',0,c.duration_hours,when_published,when_published+make_interval(days=>c.redeem_days));
  UPDATE tyaga_promotion.publication_awards SET grant_id=issued_grant WHERE listing_id=NEW.id;
  UPDATE tyaga_promotion.publication_campaigns SET issued_slots=issued_slots+1 WHERE id=c.id;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION tyaga_promotion.first_publication_benefit() FROM PUBLIC,anon,authenticated,service_role;
-- Hold off concurrent publication across snapshot + installation. No awards for imported history.
LOCK TABLE tyaga.annonces IN SHARE ROW EXCLUSIVE MODE;
INSERT INTO tyaga_promotion.seen_publications(listing_id)
  SELECT id FROM tyaga.annonces WHERE published_at IS NOT NULL OR status IN ('published','unpublished')
  ON CONFLICT DO NOTHING;
DROP TRIGGER IF EXISTS funded_first_publication ON tyaga.annonces;
CREATE TRIGGER funded_first_publication AFTER INSERT OR UPDATE OF status ON tyaga.annonces
  FOR EACH ROW WHEN (NEW.status='published') EXECUTE FUNCTION tyaga_promotion.first_publication_benefit();

CREATE OR REPLACE FUNCTION tyaga.my_publication_benefit(p_listing uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('duration_hours',g.duration_hours,'grant_id',g.id)
    FROM tyaga_promotion.publication_awards w JOIN tyaga_promotion.grants g ON g.id=w.grant_id
    JOIN tyaga.annonces a ON a.id=w.listing_id
    WHERE w.listing_id=p_listing AND w.beneficiary=auth.uid() AND a.user_id=auth.uid() AND g.beneficiary=auth.uid()
      AND g.revoked_at IS NULL AND g.cancelled_at IS NULL
      AND (g.started_at IS NULL AND g.valid_from<=statement_timestamp() AND statement_timestamp()<g.redeem_until OR g.started_at<=statement_timestamp() AND statement_timestamp()<g.ends_at);
$$;
REVOKE ALL ON FUNCTION tyaga.my_publication_benefit(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION tyaga.my_publication_benefit(uuid) TO authenticated;
COMMIT;
