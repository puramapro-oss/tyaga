-- Forward migration after physical-sale-fee-v2.sql. A listing is the tariff
-- contract. Leave all existing listings, negotiations, orders and sales intact.
-- Install the forward migration again to check it; do not roll back to V2.
BEGIN;
ALTER TABLE tyaga.annonces DROP CONSTRAINT IF EXISTS annonce_fee_policy;
ALTER TABLE tyaga.annonces ADD CONSTRAINT annonce_fee_policy CHECK (
  fee_policy='legacy' OR (fee_policy IN ('fr_p2p_test_v2','fr_p2p_test_v3')
    AND asset_kind='physical' AND listing_intent='offer' AND listing_mode='sale' AND item_id IS NOT NULL));
ALTER TABLE tyaga.ventes DROP CONSTRAINT IF EXISTS ventes_fee_policy_check;
ALTER TABLE tyaga.ventes ADD CONSTRAINT ventes_fee_policy_check
  CHECK(fee_policy IN ('legacy','fr_p2p_test_v2','fr_p2p_test_v3'));
ALTER TABLE tyaga.marketplace_orders DROP CONSTRAINT IF EXISTS order_fee_snapshot;
ALTER TABLE tyaga.marketplace_orders ADD CONSTRAINT order_fee_snapshot CHECK (
  (fee_policy='legacy' AND buyer_fee_cents=0 AND (item_amount_cents IS NULL OR item_amount_cents=amount_cents))
  OR (fee_policy IN ('fr_p2p_test_v2','fr_p2p_test_v3') AND item_amount_cents IS NOT NULL AND item_amount_cents>0
    AND commission_pct=0 AND commission_amount_cents=0 AND net_amount_cents=item_amount_cents
    AND buyer_fee_cents=35+(item_amount_cents::bigint*(CASE fee_policy WHEN 'fr_p2p_test_v3' THEN 30 ELSE 29 END)+500)/1000
    AND amount_cents>=50 AND amount_cents=item_amount_cents::bigint+buyer_fee_cents
    AND (shipping_address->>'country') IS NOT DISTINCT FROM 'FR'));

CREATE OR REPLACE FUNCTION tyaga_fee.guard_listing() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.fee_policy='fr_p2p_test_v2' THEN
      RAISE EXCEPTION 'closed tariff for new listings' USING ERRCODE='23514';
    END IF;
  ELSIF OLD.fee_policy IS DISTINCT FROM NEW.fee_policy THEN
    RAISE EXCEPTION 'fee policy is fixed at listing creation' USING ERRCODE='23514';
  END IF;
  IF NEW.fee_policy<>'legacy' AND NEW.status='published' THEN
    IF NOT EXISTS(SELECT FROM tyaga_fee.pilot_sellers WHERE seller_id=NEW.user_id FOR SHARE)
      OR NOT EXISTS(SELECT FROM tyaga.items WHERE id=NEW.item_id AND user_id=NEW.user_id)
      OR NOT NEW.user_validated OR NEW.published_at IS NULL THEN
      RAISE EXCEPTION 'physical fee pilot unavailable' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION tyaga_fee.stamp_negotiation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF EXISTS(SELECT FROM tyaga.conversations c JOIN tyaga.annonces a ON a.id=c.annonce_id
     WHERE c.id=NEW.conversation_id AND a.fee_policy<>'legacy') THEN
    NEW.created_at:=clock_timestamp();
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION tyaga_fee.guard_vida_transfer() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF EXISTS(SELECT FROM tyaga.ventes WHERE id=NEW.vente_id AND fee_policy<>'legacy') THEN
    RAISE EXCEPTION 'test sale has no VIDA rights' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

-- For publish forms, the database advertises only the version it can accept.
-- can_publish_test_fee() stays available to old clients checking an existing listing.
CREATE OR REPLACE FUNCTION tyaga.current_test_fee_policy() RETURNS text
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT CASE WHEN tyaga.can_publish_test_fee() THEN 'fr_p2p_test_v3'::text END;
$$;
REVOKE ALL ON FUNCTION tyaga.current_test_fee_policy() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION tyaga.current_test_fee_policy() TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
