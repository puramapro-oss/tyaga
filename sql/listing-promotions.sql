-- Run after schema.sql. Grants are single-use rights to ad inventory.
-- The issuing service verifies the original receipt and reserves the inventory
-- before calling issue_grant. Never grant its schema to a browser role.
-- Private SQL provisioning on a trusted connection, with bound parameters:
-- SELECT tyaga_promotion.issue_grant($1,$2,$3,$4,$5,$6,$7,$8);
-- $1 user; $2 source; $3 canonical receipt; $4 kind; $5 paid units;
-- $6 duration (hours); $7 first redemption; $8 exclusive redemption deadline.
-- operator / campaign_benefit and tyaga_rewards / campaign_benefit identify
-- already allocated promotional inventory, with zero units payable by the user.
-- payment_provider / eur_receipt uses settled euro cents; one_ledger /
-- points_receipt uses the already confirmed points debit in ONE. Authenticate
-- the provider event, beneficiary, product, scope, tariff and exact amount at
-- the source before issuance. Customer-supplied payment claims are ineligible.
-- On reversal/reconciliation: SELECT tyaga_promotion.revoke_grant($1,$2);
-- All receipt replays must reuse the exact original dates, units and duration.
BEGIN;
CREATE SCHEMA IF NOT EXISTS tyaga_promotion;
REVOKE ALL ON SCHEMA tyaga_promotion FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS tyaga_promotion.grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  beneficiary uuid NOT NULL REFERENCES tyaga.profiles(id) ON DELETE CASCADE,
  source text NOT NULL,
  receipt text NOT NULL CHECK (length(trim(receipt)) BETWEEN 1 AND 200 AND receipt = trim(receipt)),
  kind text NOT NULL,
  paid_units integer NOT NULL,
  duration_hours integer NOT NULL CHECK (duration_hours BETWEEN 1 AND 8760),
  valid_from timestamptz NOT NULL,
  redeem_until timestamptz NOT NULL,
  listing_id uuid REFERENCES tyaga.annonces(id) ON DELETE SET NULL,
  started_at timestamptz,
  ends_at timestamptz,
  cancelled_at timestamptz,
  revoked_at timestamptz,
  UNIQUE (source, receipt),
  CHECK (isfinite(valid_from) AND isfinite(redeem_until) AND valid_from < redeem_until),
  CHECK ((kind = 'campaign_benefit' AND source IN ('operator','tyaga_rewards') AND paid_units = 0)
     OR (kind = 'points_receipt' AND source = 'one_ledger' AND paid_units > 0)
     OR (kind = 'eur_receipt' AND source = 'payment_provider' AND paid_units > 0))
);
CREATE INDEX IF NOT EXISTS promo_holder ON tyaga_promotion.grants(beneficiary);
CREATE INDEX IF NOT EXISTS promo_serving ON tyaga_promotion.grants(listing_id,ends_at)
  WHERE started_at IS NOT NULL AND revoked_at IS NULL AND cancelled_at IS NULL;
ALTER TABLE tyaga_promotion.grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tyaga_promotion.grants FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION tyaga_promotion.issue_grant(
  p_beneficiary uuid,p_source text,p_receipt text,p_kind text,p_paid_units integer,
  p_duration_hours integer,p_valid_from timestamptz,p_redeem_until timestamptz)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE g tyaga_promotion.grants;
BEGIN
  INSERT INTO tyaga_promotion.grants AS existing
    (beneficiary,source,receipt,kind,paid_units,duration_hours,valid_from,redeem_until)
  VALUES (p_beneficiary,p_source,p_receipt,p_kind,p_paid_units,p_duration_hours,p_valid_from,p_redeem_until)
  ON CONFLICT (source,receipt) DO NOTHING RETURNING * INTO g;
  IF FOUND THEN RETURN g.id; END IF;
  SELECT * INTO STRICT g FROM tyaga_promotion.grants WHERE source=p_source AND receipt=p_receipt;
  IF ROW(g.beneficiary,g.kind,g.paid_units,g.duration_hours,g.valid_from,g.redeem_until)
     IS DISTINCT FROM ROW(p_beneficiary,p_kind,p_paid_units,p_duration_hours,p_valid_from,p_redeem_until)
  THEN RAISE EXCEPTION 'RECEIPT_CONFLICT'; END IF;
  RETURN g.id;
END $$;
CREATE OR REPLACE FUNCTION tyaga_promotion.revoke_grant(p_source text,p_receipt text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  UPDATE tyaga_promotion.grants SET revoked_at=COALESCE(revoked_at,clock_timestamp())
    WHERE source=p_source AND receipt=p_receipt;
  RETURN FOUND;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA tyaga_promotion FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA tyaga_promotion TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tyaga_promotion TO service_role;

-- The holder sees only their available rights and the active campaign on the
-- listing they own. No receipt, identity or balance is exposed.
CREATE OR REPLACE FUNCTION tyaga.my_listing_promotions(p_listing uuid)
RETURNS TABLE(grant_id uuid,kind text,duration_hours integer,redeem_until timestamptz,ends_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT g.id,g.kind,g.duration_hours,g.redeem_until,g.ends_at
  FROM tyaga_promotion.grants g
  WHERE g.beneficiary=auth.uid() AND EXISTS (
    SELECT FROM tyaga.annonces a WHERE a.id=p_listing AND a.user_id=auth.uid() AND a.status='published')
  AND g.revoked_at IS NULL AND g.cancelled_at IS NULL AND
    ((g.started_at IS NULL AND g.valid_from<=now() AND now()<g.redeem_until)
    OR (g.listing_id=p_listing AND g.started_at<=now() AND now()<g.ends_at))
  ORDER BY (g.started_at IS NOT NULL) DESC,g.redeem_until,g.id LIMIT 25;
$$;
CREATE OR REPLACE FUNCTION tyaga.redeem_listing_promotion(p_listing uuid,p_grant uuid)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE g tyaga_promotion.grants; current_time_utc timestamptz;
BEGIN
  -- Serialize all activations for one listing and recheck its publication.
  PERFORM 1 FROM tyaga.annonces WHERE id=p_listing AND user_id=auth.uid() AND status='published' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LISTING_UNAVAILABLE'; END IF;
  SELECT * INTO g FROM tyaga_promotion.grants WHERE id=p_grant AND beneficiary=auth.uid() FOR UPDATE;
  current_time_utc := clock_timestamp();
  IF NOT FOUND OR g.revoked_at IS NOT NULL OR g.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'GRANT_UNAVAILABLE'; END IF;
  IF g.started_at IS NOT NULL THEN
    IF g.listing_id=p_listing THEN RETURN g.ends_at; END IF;
    RAISE EXCEPTION 'GRANT_ALREADY_USED';
  END IF;
  IF current_time_utc<g.valid_from OR current_time_utc>=g.redeem_until THEN RAISE EXCEPTION 'GRANT_EXPIRED'; END IF;
  IF EXISTS (SELECT FROM tyaga_promotion.grants WHERE listing_id=p_listing
    AND ends_at>current_time_utc AND revoked_at IS NULL AND cancelled_at IS NULL)
    THEN RAISE EXCEPTION 'CAMPAIGN_ALREADY_ACTIVE'; END IF;
  UPDATE tyaga_promotion.grants SET listing_id=p_listing,started_at=current_time_utc,
    ends_at=current_time_utc+make_interval(hours=>g.duration_hours) WHERE id=g.id RETURNING ends_at INTO g.ends_at;
  RETURN g.ends_at;
END $$;
CREATE OR REPLACE FUNCTION tyaga.cancel_listing_promotion(p_listing uuid,p_grant uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  UPDATE tyaga_promotion.grants SET cancelled_at=COALESCE(cancelled_at,clock_timestamp())
    WHERE id=p_grant AND listing_id=p_listing AND beneficiary=auth.uid() AND started_at IS NOT NULL;
  RETURN FOUND;
END $$;
-- Organically eligible page only. Never introduces rows from another query
-- or page. Rotate the single placement once per minute across eligible grants.
CREATE OR REPLACE FUNCTION tyaga.sponsored_listing(p_candidates uuid[])
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  WITH eligible AS (
    SELECT g.listing_id, row_number() OVER (ORDER BY g.id)-1 AS slot, count(*) OVER () AS total
    FROM tyaga_promotion.grants g
    JOIN tyaga.annonces a ON a.id=g.listing_id AND a.user_id=g.beneficiary AND a.status='published'
    WHERE auth.uid() IS NOT NULL AND cardinality(p_candidates) BETWEEN 1 AND 24 AND g.listing_id=ANY(p_candidates)
      AND g.started_at<=now() AND now()<g.ends_at AND g.cancelled_at IS NULL AND g.revoked_at IS NULL
  )
  SELECT listing_id FROM eligible WHERE slot=mod(floor(extract(epoch FROM now())/60)::bigint,total);
$$;
REVOKE ALL ON FUNCTION tyaga.my_listing_promotions(uuid),tyaga.redeem_listing_promotion(uuid,uuid),
  tyaga.cancel_listing_promotion(uuid,uuid),tyaga.sponsored_listing(uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION tyaga.my_listing_promotions(uuid),tyaga.redeem_listing_promotion(uuid,uuid),
  tyaga.cancel_listing_promotion(uuid,uuid),tyaga.sponsored_listing(uuid[]) TO authenticated;
COMMIT;
