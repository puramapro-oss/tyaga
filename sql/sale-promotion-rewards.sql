-- Install after the order settlement, refund and listing promotion migrations. Inventory is explicitly allocated by the
-- operator. No default campaign, no cash award and no VIDA wallet mutation.
BEGIN;
CREATE TABLE IF NOT EXISTS tyaga_promotion.sale_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  duration_hours int NOT NULL CHECK (duration_hours BETWEEN 1 AND 168),
  redeem_days int NOT NULL CHECK (redeem_days BETWEEN 1 AND 90),
  pair_quota int NOT NULL CHECK (pair_quota BETWEEN 1 AND 1000000),
  per_person_quota int NOT NULL CHECK (per_person_quota BETWEEN 1 AND pair_quota),
  min_gross_cents int NOT NULL CHECK (min_gross_cents > 0),
  enabled boolean NOT NULL DEFAULT false,
  inventory_reference text NOT NULL CHECK (length(trim(inventory_reference)) BETWEEN 1 AND 200),
  CHECK (isfinite(starts_at) AND isfinite(ends_at) AND starts_at < ends_at),
  EXCLUDE USING gist (tstzrange(starts_at, ends_at, '[)') WITH &&) WHERE (enabled)
);
CREATE TABLE IF NOT EXISTS tyaga_promotion.sale_awards (
  order_id uuid PRIMARY KEY REFERENCES tyaga.marketplace_orders(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES tyaga_promotion.sale_campaigns(id),
  buyer_id uuid NOT NULL, seller_id uuid NOT NULL,
  CHECK (buyer_id <> seller_id)
);
CREATE INDEX IF NOT EXISTS sale_awards_buyer ON tyaga_promotion.sale_awards(campaign_id,buyer_id);
CREATE INDEX IF NOT EXISTS sale_awards_seller ON tyaga_promotion.sale_awards(campaign_id,seller_id);
ALTER TABLE tyaga_promotion.sale_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE tyaga_promotion.sale_awards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tyaga_promotion.sale_campaigns,tyaga_promotion.sale_awards FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION tyaga_promotion.award_sale(p_order uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  o tyaga.marketplace_orders;
  v tyaga.ventes;
  c tyaga_promotion.sale_campaigns;
  issued timestamptz := statement_timestamp();
BEGIN
  SELECT * INTO o FROM tyaga.marketplace_orders WHERE id=p_order FOR UPDATE;
  IF NOT FOUND OR o.status <> 'completed' OR o.escrow_status <> 'released'
    OR nullif(o.stripe_payment_intent_id,'') IS NULL OR nullif(o.stripe_transfer_id,'') IS NULL
    THEN RETURN false; END IF;
  IF NOT EXISTS (
    SELECT FROM tyaga.order_settlements s WHERE s.order_id=o.id AND s.state='transferred'
    AND s.stripe_transfer_id=o.stripe_transfer_id AND s.amount_cents=o.net_amount_cents
    AND s.currency='eur' AND nullif(s.destination,'') IS NOT NULL AND s.refund_state IS NULL
    AND s.refunded_amount_cents=0
  ) THEN RETURN false; END IF;
  SELECT * INTO v FROM tyaga.ventes WHERE order_id=o.id AND seller_id=o.seller_id
    AND gross_amount_cents=o.amount_cents AND commission_amount_cents=o.commission_amount_cents
    AND net_amount_cents=o.net_amount_cents;
  IF NOT FOUND THEN RETURN false; END IF;
  IF EXISTS (SELECT FROM tyaga_promotion.sale_awards WHERE order_id=p_order) THEN RETURN true; END IF;
  SELECT * INTO c FROM tyaga_promotion.sale_campaigns
    WHERE enabled AND starts_at<=v.completed_at AND v.completed_at<ends_at
    AND starts_at<=issued AND issued<ends_at AND min_gross_cents<=v.gross_amount_cents FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  -- The campaign row lock serializes overlapping pairs, inventory and per-person caps.
  IF (SELECT count(*) FROM tyaga_promotion.sale_awards WHERE campaign_id=c.id)>=c.pair_quota
    OR EXISTS (
      SELECT person FROM (
        SELECT buyer_id AS person FROM tyaga_promotion.sale_awards WHERE campaign_id=c.id AND buyer_id IN (o.buyer_id,o.seller_id)
        UNION ALL
        SELECT seller_id FROM tyaga_promotion.sale_awards WHERE campaign_id=c.id AND seller_id IN (o.buyer_id,o.seller_id)
      ) participants GROUP BY person HAVING count(*)>=c.per_person_quota
    ) THEN RETURN false; END IF;
  INSERT INTO tyaga_promotion.sale_awards VALUES(o.id,c.id,o.buyer_id,o.seller_id);
  PERFORM tyaga_promotion.issue_grant(o.buyer_id,'tyaga_rewards','sale:'||o.id||':buyer',
    'campaign_benefit',0,c.duration_hours,issued,issued+make_interval(days=>c.redeem_days));
  PERFORM tyaga_promotion.issue_grant(o.seller_id,'tyaga_rewards','sale:'||o.id||':seller',
    'campaign_benefit',0,c.duration_hours,issued,issued+make_interval(days=>c.redeem_days));
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION tyaga_promotion.after_transfer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  -- Payment settlement remains authoritative. A reward failure may be retried by
  -- a trusted worker calling award_sale with the same order after reconciliation.
  BEGIN
    PERFORM tyaga_promotion.award_sale(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'TYAGA sale promotion allocation deferred for order %, SQLSTATE %',NEW.id,SQLSTATE;
  END;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION tyaga_promotion.withdraw_sale()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE original_order uuid;
BEGIN
  IF TG_TABLE_NAME='ventes' THEN original_order:=OLD.order_id; ELSE original_order:=OLD.id; END IF;
  IF EXISTS (SELECT FROM tyaga_promotion.sale_awards WHERE order_id=original_order) THEN
    PERFORM tyaga_promotion.revoke_grant('tyaga_rewards','sale:'||original_order||':buyer');
    PERFORM tyaga_promotion.revoke_grant('tyaga_rewards','sale:'||original_order||':seller');
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS promotion_confirmed_transfer ON tyaga.marketplace_orders;
CREATE TRIGGER promotion_confirmed_transfer AFTER UPDATE OF stripe_transfer_id ON tyaga.marketplace_orders
  FOR EACH ROW WHEN (NEW.stripe_transfer_id IS NOT NULL AND NEW.stripe_transfer_id IS DISTINCT FROM OLD.stripe_transfer_id)
  EXECUTE FUNCTION tyaga_promotion.after_transfer();
DROP TRIGGER IF EXISTS promotion_refunded_order ON tyaga.marketplace_orders;
CREATE TRIGGER promotion_refunded_order AFTER UPDATE OF status,escrow_status ON tyaga.marketplace_orders
  FOR EACH ROW WHEN (NEW.status='cancelled' OR NEW.escrow_status='refunded' OR (OLD.escrow_status='released' AND NEW.escrow_status='held')) EXECUTE FUNCTION tyaga_promotion.withdraw_sale();
DROP TRIGGER IF EXISTS promotion_removed_sale ON tyaga.ventes;
CREATE TRIGGER promotion_removed_sale BEFORE DELETE ON tyaga.ventes FOR EACH ROW EXECUTE FUNCTION tyaga_promotion.withdraw_sale();
DROP TRIGGER IF EXISTS promotion_removed_order ON tyaga.marketplace_orders;
CREATE TRIGGER promotion_removed_order BEFORE DELETE ON tyaga.marketplace_orders FOR EACH ROW EXECUTE FUNCTION tyaga_promotion.withdraw_sale();
REVOKE ALL ON FUNCTION tyaga_promotion.award_sale(uuid),tyaga_promotion.after_transfer(),tyaga_promotion.withdraw_sale()
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION tyaga_promotion.award_sale(uuid) TO service_role;
CREATE OR REPLACE FUNCTION tyaga.my_sale_promotions(p_orders uuid[])
RETURNS TABLE(order_id uuid,duration_hours integer,redeem_until timestamptz,benefit_status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT a.order_id,g.duration_hours,g.redeem_until,CASE
    WHEN g.revoked_at IS NOT NULL THEN 'revoked'
    WHEN g.cancelled_at IS NOT NULL THEN 'used'
    WHEN g.started_at IS NOT NULL AND now()<g.ends_at THEN 'active'
    WHEN g.started_at IS NOT NULL THEN 'used'
    WHEN now()>=g.redeem_until THEN 'expired' ELSE 'available' END
  FROM tyaga_promotion.sale_awards a JOIN tyaga_promotion.grants g
    ON g.source='tyaga_rewards' AND g.beneficiary=auth.uid()
    AND g.receipt='sale:'||a.order_id||CASE WHEN a.buyer_id=auth.uid() THEN ':buyer' ELSE ':seller' END
  WHERE auth.uid() IN (a.buyer_id,a.seller_id) AND cardinality(p_orders) BETWEEN 1 AND 50
    AND a.order_id=ANY(p_orders);
$$;
REVOKE ALL ON FUNCTION tyaga.my_sale_promotions(uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION tyaga.my_sale_promotions(uuid[]) TO authenticated;
COMMIT;
