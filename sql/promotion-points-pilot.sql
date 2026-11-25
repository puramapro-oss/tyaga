-- Optional only. Install after listing-promotions.sql; absence of PAY keeps
-- quotes/purchases closed. No wallet initialization, issuance of points, or
-- change to PAY. Runtime entry points are server-only.
BEGIN;
CREATE TABLE IF NOT EXISTS tyaga_promotion.points_pilot_offers (
  tariff_id text PRIMARY KEY CHECK(tariff_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'),
  cost_points integer NOT NULL CHECK(cost_points>0),
  duration_hours integer NOT NULL CHECK(duration_hours BETWEEN 1 AND 168),
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  reserved_quantity integer NOT NULL CHECK(reserved_quantity BETWEEN 1 AND 1000000),
  inventory_ref text NOT NULL UNIQUE CHECK(length(btrim(inventory_ref)) BETWEEN 1 AND 200),
  enabled boolean NOT NULL DEFAULT false,
  CHECK(isfinite(starts_at) AND isfinite(ends_at) AND starts_at<ends_at),
  EXCLUDE USING gist (tstzrange(starts_at,ends_at,'[)') WITH &&) WHERE (enabled)
);
CREATE TABLE IF NOT EXISTS tyaga_promotion.points_pilot_members (
  tariff_id text NOT NULL REFERENCES tyaga_promotion.points_pilot_offers(tariff_id),
  actor uuid NOT NULL REFERENCES tyaga.profiles(id) ON DELETE CASCADE,
  authorized_points integer NOT NULL CHECK(authorized_points>0),
  approval_ref text NOT NULL UNIQUE CHECK(length(btrim(approval_ref)) BETWEEN 1 AND 200),
  enabled boolean NOT NULL DEFAULT true,
  PRIMARY KEY(tariff_id,actor)
);
CREATE TABLE IF NOT EXISTS tyaga_promotion.points_pilot_purchases (
  actor uuid NOT NULL, request_id uuid NOT NULL, listing_id uuid NOT NULL,
  tariff_id text NOT NULL, cost_points integer NOT NULL CHECK(cost_points>0),
  grant_id uuid NOT NULL UNIQUE REFERENCES tyaga_promotion.grants(id) ON DELETE CASCADE,
  wallet_id uuid NOT NULL, debit_ref text NOT NULL UNIQUE, debit_id uuid NOT NULL UNIQUE,
  purchased_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(actor,request_id),
  FOREIGN KEY(tariff_id,actor) REFERENCES tyaga_promotion.points_pilot_members(tariff_id,actor) ON DELETE CASCADE
);
-- An account closure erases personal pilot receipts alongside its PAY test
-- wallet. Already sold placement inventory stays allocated to the campaign.
ALTER TABLE tyaga_promotion.points_pilot_members DROP CONSTRAINT IF EXISTS points_pilot_members_actor_fkey;
ALTER TABLE tyaga_promotion.points_pilot_members ADD CONSTRAINT points_pilot_members_actor_fkey
  FOREIGN KEY(actor) REFERENCES tyaga.profiles(id) ON DELETE CASCADE;
ALTER TABLE tyaga_promotion.points_pilot_purchases DROP CONSTRAINT IF EXISTS points_pilot_purchases_grant_id_fkey;
ALTER TABLE tyaga_promotion.points_pilot_purchases ADD CONSTRAINT points_pilot_purchases_grant_id_fkey
  FOREIGN KEY(grant_id) REFERENCES tyaga_promotion.grants(id) ON DELETE CASCADE;
ALTER TABLE tyaga_promotion.points_pilot_purchases DROP CONSTRAINT IF EXISTS points_pilot_purchases_tariff_id_actor_fkey;
ALTER TABLE tyaga_promotion.points_pilot_purchases ADD CONSTRAINT points_pilot_purchases_tariff_id_actor_fkey
  FOREIGN KEY(tariff_id,actor) REFERENCES tyaga_promotion.points_pilot_members(tariff_id,actor) ON DELETE CASCADE;
ALTER TABLE tyaga_promotion.points_pilot_offers ADD COLUMN IF NOT EXISTS sold_quantity integer;
CREATE INDEX IF NOT EXISTS points_pilot_usage ON tyaga_promotion.points_pilot_purchases(tariff_id,actor);
ALTER TABLE tyaga_promotion.points_pilot_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tyaga_promotion.points_pilot_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE tyaga_promotion.points_pilot_purchases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tyaga_promotion.points_pilot_offers,tyaga_promotion.points_pilot_members,
  tyaga_promotion.points_pilot_purchases FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION tyaga_promotion.freeze_points_tariff() RETURNS trigger
  LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF ROW(NEW.tariff_id,NEW.cost_points,NEW.duration_hours,NEW.starts_at,NEW.ends_at,NEW.reserved_quantity,NEW.inventory_ref)
    IS DISTINCT FROM ROW(OLD.tariff_id,OLD.cost_points,OLD.duration_hours,OLD.starts_at,OLD.ends_at,OLD.reserved_quantity,OLD.inventory_ref) THEN
    RAISE EXCEPTION 'new tariff id required' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS freeze_points_tariff ON tyaga_promotion.points_pilot_offers;
CREATE TRIGGER freeze_points_tariff BEFORE UPDATE ON tyaga_promotion.points_pilot_offers
  FOR EACH ROW EXECUTE FUNCTION tyaga_promotion.freeze_points_tariff();

-- Only a database-wide setting persists here. Connection-local SET/claims
-- never qualify a deployment. An operator can opt in a disposable database
-- with ALTER DATABASE <isolated-db> SET tyaga.promotion_points_environment='isolated_test'.
CREATE OR REPLACE FUNCTION tyaga_promotion.points_test_ready() RETURNS boolean
  LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT EXISTS(SELECT FROM pg_db_role_setting s
    JOIN pg_database d ON d.oid=s.setdatabase AND d.datname=current_database()
    WHERE s.setrole=0 AND 'tyaga.promotion_points_environment=isolated_test'=ANY(s.setconfig))
    AND to_regclass('purama_pay.points_transactions') IS NOT NULL
    AND to_regclass('purama_pay.points_wallets') IS NOT NULL
    AND EXISTS(SELECT FROM pg_proc p WHERE
      p.oid=to_regprocedure('purama_pay.apply_wallet_movement(uuid,text,integer,text)')
      AND p.prosecdef AND p.prorettype='jsonb'::regtype
      AND has_function_privilege('service_role',p.oid,'EXECUTE')
      AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
      AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE'));
$$;
ALTER TABLE tyaga_promotion.points_pilot_purchases
  ADD COLUMN IF NOT EXISTS reversal_id uuid UNIQUE,
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz;
UPDATE tyaga_promotion.points_pilot_offers o SET sold_quantity=(
  SELECT count(*) FROM tyaga_promotion.points_pilot_purchases p WHERE p.tariff_id=o.tariff_id AND p.refunded_at IS NULL)
  WHERE o.sold_quantity IS NULL;
ALTER TABLE tyaga_promotion.points_pilot_offers ALTER COLUMN sold_quantity SET DEFAULT 0,
  ALTER COLUMN sold_quantity SET NOT NULL;
ALTER TABLE tyaga_promotion.points_pilot_offers DROP CONSTRAINT IF EXISTS points_pilot_inventory_limit;
ALTER TABLE tyaga_promotion.points_pilot_offers ADD CONSTRAINT points_pilot_inventory_limit
  CHECK(sold_quantity BETWEEN 0 AND reserved_quantity);
CREATE OR REPLACE FUNCTION tyaga_promotion.points_service_only() RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF current_setting('role',true) IS DISTINCT FROM 'service_role' THEN
    RAISE insufficient_privilege;
  END IF;
END $$;

-- Reading eligibility never creates a wallet or exposes unassigned balances.
-- The displayed balance is the maximum this member may spend in this pilot.
CREATE OR REPLACE FUNCTION tyaga.promotion_points_test_quote(p_listing uuid,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q jsonb;
BEGIN
  PERFORM tyaga_promotion.points_service_only();
  IF NOT tyaga_promotion.points_test_ready() OR NOT EXISTS(
    SELECT FROM tyaga.annonces WHERE id=p_listing AND user_id=p_actor AND status='published')
    THEN RETURN NULL; END IF;
  SELECT jsonb_build_object('tariff_id',o.tariff_id,'duration_hours',o.duration_hours,
    'cost_points',o.cost_points,'balance_points',least(w.balance,m.authorized_points-coalesce(used.points,0)))
  INTO q FROM tyaga_promotion.points_pilot_offers o
  JOIN tyaga_promotion.points_pilot_members m ON m.tariff_id=o.tariff_id AND m.actor=p_actor
  JOIN purama_pay.points_wallets w ON w.user_id=m.actor
  LEFT JOIN LATERAL (
    SELECT sum(p.cost_points) AS points FROM tyaga_promotion.points_pilot_purchases p
    WHERE p.tariff_id=o.tariff_id AND p.actor=m.actor AND p.refunded_at IS NULL
  ) used ON true
  WHERE o.enabled AND m.enabled AND o.starts_at<=statement_timestamp() AND statement_timestamp()<o.ends_at
    AND o.sold_quantity<o.reserved_quantity AND m.authorized_points>=coalesce(used.points,0)+o.cost_points
    AND w.balance>=o.cost_points;
  RETURN q;
END $$;

-- No attempt to purchase is made on recovery. A session verified by the
-- calling service authenticates p_actor. All four immutable receipt fields
-- must match; a closed listing or sold-out offer cannot hide its own receipt.
CREATE OR REPLACE FUNCTION tyaga.promotion_points_test_receipt(
  p_listing uuid,p_actor uuid,p_tariff_id text,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
  PERFORM tyaga_promotion.points_service_only();
  IF NOT tyaga_promotion.points_test_ready() THEN RETURN NULL; END IF;
  SELECT jsonb_build_object('grant_id',grant_id,'receipt_id',debit_id,'cost_points',cost_points,
    'status',CASE WHEN refunded_at IS NULL THEN 'purchased' ELSE 'refunded' END)
  INTO result FROM tyaga_promotion.points_pilot_purchases
  WHERE actor=p_actor AND request_id=p_request_id AND listing_id=p_listing AND tariff_id=p_tariff_id;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION tyaga.purchase_promotion_with_test_points(
  p_listing uuid,p_actor uuid,p_tariff_id text,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  offer tyaga_promotion.points_pilot_offers; member tyaga_promotion.points_pilot_members;
  receipt tyaga_promotion.points_pilot_purchases;
  wallet uuid; available integer; spent bigint; raw_result jsonb;
  debit uuid; grant_uuid uuid; ref text; purchase_time timestamptz;
BEGIN
  PERFORM tyaga_promotion.points_service_only();
  IF NOT tyaga_promotion.points_test_ready() OR p_actor IS NULL OR p_listing IS NULL
    OR p_request_id IS NULL OR p_tariff_id IS NULL THEN RAISE check_violation; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_actor::text||':'||p_request_id::text, 0));
  SELECT * INTO receipt FROM tyaga_promotion.points_pilot_purchases WHERE actor=p_actor AND request_id=p_request_id;
  IF FOUND THEN
    IF (receipt.tariff_id,receipt.listing_id) IS DISTINCT FROM (p_tariff_id,p_listing) THEN
      RAISE EXCEPTION 'request belongs to another purchase' USING ERRCODE='23505';
    END IF;
    IF receipt.refunded_at IS NOT NULL THEN RAISE check_violation; END IF;
    RETURN jsonb_build_object('grant_id',receipt.grant_id,'receipt_id',receipt.debit_id,'cost_points',receipt.cost_points);
  END IF;

  PERFORM 1 FROM tyaga.annonces WHERE id=p_listing AND user_id=p_actor AND status='published' FOR SHARE;
  IF NOT FOUND THEN RAISE check_violation; END IF;
  SELECT * INTO offer FROM tyaga_promotion.points_pilot_offers WHERE tariff_id=p_tariff_id FOR UPDATE;
  IF NOT FOUND OR NOT offer.enabled THEN RAISE check_violation; END IF;
  SELECT * INTO member FROM tyaga_promotion.points_pilot_members WHERE actor=p_actor AND tariff_id=p_tariff_id FOR SHARE;
  IF NOT FOUND OR NOT member.enabled THEN RAISE check_violation; END IF;
  SELECT id,balance INTO wallet,available FROM purama_pay.points_wallets WHERE user_id=p_actor FOR UPDATE;
  IF NOT FOUND OR available<offer.cost_points THEN RAISE check_violation; END IF;
  purchase_time := clock_timestamp();
  IF purchase_time<offer.starts_at OR purchase_time>=offer.ends_at THEN RAISE check_violation; END IF;
  SELECT coalesce(sum(cost_points),0) INTO spent FROM tyaga_promotion.points_pilot_purchases
    WHERE tariff_id=p_tariff_id AND actor=p_actor AND refunded_at IS NULL;
  IF offer.sold_quantity>=offer.reserved_quantity OR spent+offer.cost_points>member.authorized_points THEN RAISE check_violation; END IF;

  ref:='tyaga:promotion:test:'||p_actor::text||':'||p_request_id::text;
  IF EXISTS(SELECT FROM purama_pay.points_transactions WHERE wallet_id=wallet AND reference=ref) THEN
    RAISE EXCEPTION 'unreconciled PAY reference' USING ERRCODE='23514';
  END IF;
  raw_result:=purama_pay.apply_wallet_movement(p_actor,'debit_catalog',-offer.cost_points,ref);
  IF raw_result->'applied' IS DISTINCT FROM 'true'::jsonb THEN RAISE check_violation; END IF;
  SELECT id INTO STRICT debit FROM purama_pay.points_transactions
    WHERE wallet_id=wallet AND type='debit_catalog' AND reference=ref AND amount=-offer.cost_points;
  grant_uuid:=tyaga_promotion.issue_grant(p_actor,'one_ledger',debit::text,'points_receipt',
    offer.cost_points,offer.duration_hours,purchase_time,offer.ends_at);
  INSERT INTO tyaga_promotion.points_pilot_purchases
    (actor,request_id,listing_id,tariff_id,cost_points,grant_id,wallet_id,debit_ref,debit_id,purchased_at)
    VALUES(p_actor,p_request_id,p_listing,p_tariff_id,offer.cost_points,grant_uuid,wallet,ref,debit,purchase_time);
  UPDATE tyaga_promotion.points_pilot_offers SET sold_quantity=sold_quantity+1 WHERE tariff_id=p_tariff_id;
  RETURN jsonb_build_object('grant_id',grant_uuid,'receipt_id',debit,'cost_points',offer.cost_points);
END $$;

-- Administrative cancellation only, for an unredeemed entitlement. An
-- interrupted request is retried with its original actor and request id.
CREATE OR REPLACE FUNCTION tyaga.refund_promotion_test_points(p_actor uuid,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt tyaga_promotion.points_pilot_purchases; g tyaga_promotion.grants;
  wallet uuid; ref text; compensation uuid; raw_result jsonb;
BEGIN
  PERFORM tyaga_promotion.points_service_only();
  IF NOT tyaga_promotion.points_test_ready() OR p_actor IS NULL OR p_request_id IS NULL THEN RAISE check_violation; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_actor::text||':'||p_request_id::text,0));
  SELECT * INTO receipt FROM tyaga_promotion.points_pilot_purchases WHERE actor=p_actor AND request_id=p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE check_violation; END IF;
  IF receipt.refunded_at IS NOT NULL THEN
    RETURN jsonb_build_object('reversal_id',receipt.reversal_id,'cost_points',receipt.cost_points);
  END IF;
  PERFORM 1 FROM tyaga_promotion.points_pilot_offers WHERE tariff_id=receipt.tariff_id FOR UPDATE;
  SELECT * INTO g FROM tyaga_promotion.grants WHERE id=receipt.grant_id FOR UPDATE;
  IF NOT FOUND OR g.started_at IS NOT NULL OR
    (g.beneficiary,g.source,g.receipt,g.kind,g.paid_units) IS DISTINCT FROM
    (p_actor,'one_ledger',receipt.debit_id::text,'points_receipt',receipt.cost_points) THEN RAISE check_violation; END IF;
  SELECT id INTO wallet FROM purama_pay.points_wallets WHERE user_id=p_actor AND id=receipt.wallet_id FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS(SELECT FROM purama_pay.points_transactions WHERE id=receipt.debit_id
    AND wallet_id=wallet AND type='debit_catalog' AND amount=-receipt.cost_points AND reference=receipt.debit_ref) THEN
    RAISE check_violation;
  END IF;
  ref:='tyaga:promotion:reversal:'||receipt.debit_id::text;
  IF EXISTS(SELECT FROM purama_pay.points_transactions WHERE wallet_id=wallet AND reference=ref) THEN
    RAISE EXCEPTION 'unreconciled compensation' USING ERRCODE='23514';
  END IF;
  raw_result:=purama_pay.apply_wallet_movement(p_actor,'reversal',receipt.cost_points,ref);
  IF raw_result->'applied' IS DISTINCT FROM 'true'::jsonb THEN RAISE check_violation; END IF;
  SELECT id INTO STRICT compensation FROM purama_pay.points_transactions
    WHERE wallet_id=wallet AND type='reversal' AND reference=ref AND amount=receipt.cost_points;
  IF NOT tyaga_promotion.revoke_grant('one_ledger',receipt.debit_id::text) THEN RAISE check_violation; END IF;
  UPDATE tyaga_promotion.points_pilot_purchases SET reversal_id=compensation,refunded_at=clock_timestamp()
    WHERE actor=p_actor AND request_id=p_request_id;
  UPDATE tyaga_promotion.points_pilot_offers SET sold_quantity=sold_quantity-1
    WHERE tariff_id=receipt.tariff_id AND sold_quantity>0;
  IF NOT FOUND THEN RAISE check_violation; END IF;
  RETURN jsonb_build_object('reversal_id',compensation,'cost_points',receipt.cost_points);
END $$;

REVOKE ALL ON FUNCTION tyaga_promotion.points_service_only(), tyaga_promotion.freeze_points_tariff(),
  tyaga_promotion.points_test_ready() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION tyaga.promotion_points_test_quote(uuid,uuid),tyaga.promotion_points_test_receipt(uuid,uuid,text,uuid),
  tyaga.purchase_promotion_with_test_points(uuid,uuid,text,uuid),
  tyaga.refund_promotion_test_points(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION tyaga.promotion_points_test_quote(uuid,uuid),tyaga.promotion_points_test_receipt(uuid,uuid,text,uuid),
  tyaga.purchase_promotion_with_test_points(uuid,uuid,text,uuid),
  tyaga.refund_promotion_test_points(uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
