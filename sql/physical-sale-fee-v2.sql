-- Apply after schema.sql, digital-listings.sql, 20261122-order-settlement.sql
-- and 20261122-order-refund.sql. Only prequalified FR private test users.
BEGIN;
CREATE SCHEMA IF NOT EXISTS tyaga_fee;
REVOKE ALL ON SCHEMA tyaga_fee FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE IF NOT EXISTS tyaga_fee.pilot_sellers (
  seller_id uuid PRIMARY KEY REFERENCES tyaga.profiles(id) ON DELETE CASCADE,
  qualification_ref text NOT NULL CHECK (length(trim(qualification_ref)) BETWEEN 1 AND 240),
  qualified_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tyaga_fee.pilot_sellers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tyaga_fee.pilot_sellers FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION tyaga.can_publish_test_fee() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT EXISTS(SELECT FROM tyaga_fee.pilot_sellers WHERE seller_id=auth.uid());
$$;
REVOKE ALL ON FUNCTION tyaga.can_publish_test_fee() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION tyaga.can_publish_test_fee() TO authenticated;

ALTER TABLE tyaga.annonces ADD COLUMN IF NOT EXISTS fee_policy text NOT NULL DEFAULT 'legacy';
ALTER TABLE tyaga.ventes ADD COLUMN IF NOT EXISTS fee_policy text NOT NULL DEFAULT 'legacy'
  CHECK (fee_policy IN ('legacy','fr_p2p_test_v2'));
ALTER TABLE tyaga.marketplace_orders
  ADD COLUMN IF NOT EXISTS fee_policy text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS item_amount_cents integer,
  ADD COLUMN IF NOT EXISTS buyer_fee_cents integer NOT NULL DEFAULT 0;
ALTER TABLE tyaga.annonces DROP CONSTRAINT IF EXISTS annonce_fee_policy;
ALTER TABLE tyaga.annonces ADD CONSTRAINT annonce_fee_policy CHECK (
  fee_policy='legacy' OR (fee_policy='fr_p2p_test_v2' AND asset_kind='physical'
    AND listing_intent='offer' AND listing_mode='sale' AND item_id IS NOT NULL));
ALTER TABLE tyaga.marketplace_orders DROP CONSTRAINT IF EXISTS order_fee_snapshot;
ALTER TABLE tyaga.marketplace_orders ADD CONSTRAINT order_fee_snapshot CHECK (
  (fee_policy='legacy' AND buyer_fee_cents=0 AND (item_amount_cents IS NULL OR item_amount_cents=amount_cents))
  OR (fee_policy='fr_p2p_test_v2' AND item_amount_cents IS NOT NULL AND item_amount_cents>0
    AND commission_pct=0 AND commission_amount_cents=0 AND net_amount_cents=item_amount_cents
    AND buyer_fee_cents=35+(item_amount_cents::bigint*29+500)/1000
    AND amount_cents>=50 AND amount_cents=item_amount_cents::bigint+buyer_fee_cents
    AND (shipping_address->>'country') IS NOT DISTINCT FROM 'FR'));

CREATE OR REPLACE FUNCTION tyaga_fee.guard_listing() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF OLD.fee_policy IS DISTINCT FROM NEW.fee_policy THEN
      RAISE EXCEPTION 'fee policy is fixed at listing creation' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.fee_policy='fr_p2p_test_v2' AND NEW.status='published' THEN
    IF NOT EXISTS(SELECT FROM tyaga_fee.pilot_sellers WHERE seller_id=NEW.user_id FOR SHARE)
       OR NOT EXISTS(SELECT FROM tyaga.items WHERE id=NEW.item_id AND user_id=NEW.user_id)
       OR NOT NEW.user_validated OR NEW.published_at IS NULL THEN
      RAISE EXCEPTION 'physical fee pilot unavailable' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS physical_sale_fee_listing ON tyaga.annonces;
CREATE TRIGGER physical_sale_fee_listing BEFORE INSERT OR UPDATE ON tyaga.annonces
  FOR EACH ROW EXECUTE FUNCTION tyaga_fee.guard_listing();

-- Mirror the existing price agreement with the most recent unflagged message
-- from each party; the exact same timestamp is never an acceptance.
CREATE OR REPLACE FUNCTION tyaga_fee.agreed_price(a tyaga.annonces,buyer uuid) RETURNS integer
  LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT COALESCE((
    SELECT offer.offer_cents FROM tyaga.conversations c
    CROSS JOIN LATERAL (SELECT m.offer_cents,m.created_at FROM tyaga.inbox_messages m
      WHERE m.conversation_id=c.id AND m.sender_id=buyer AND NOT m.flagged_off_platform AND m.offer_cents IS NOT NULL
      ORDER BY m.created_at DESC,m.id DESC LIMIT 1) offer
    CROSS JOIN LATERAL (SELECT m.offer_cents,m.created_at FROM tyaga.inbox_messages m
      WHERE m.conversation_id=c.id AND m.sender_id=a.user_id AND NOT m.flagged_off_platform AND m.offer_cents IS NOT NULL
      ORDER BY m.created_at DESC,m.id DESC LIMIT 1) acceptance
    WHERE c.annonce_id=a.id AND c.buyer_id=buyer AND c.seller_id=a.user_id
      AND acceptance.created_at>offer.created_at AND acceptance.offer_cents=offer.offer_cents
      AND offer.offer_cents BETWEEN 100 AND a.price_cents
  ),a.price_cents);
$$;

-- A mobile or web client cannot backdate an offer and thereby change the
-- ordering that determines the pilot's financial snapshot.
CREATE OR REPLACE FUNCTION tyaga_fee.stamp_negotiation() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF EXISTS (SELECT FROM tyaga.conversations c JOIN tyaga.annonces a ON a.id=c.annonce_id
     WHERE c.id=NEW.conversation_id AND a.fee_policy='fr_p2p_test_v2') THEN
    NEW.created_at:=clock_timestamp();
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS physical_sale_fee_stamp_offer ON tyaga.inbox_messages;
CREATE TRIGGER physical_sale_fee_stamp_offer BEFORE INSERT ON tyaga.inbox_messages
  FOR EACH ROW WHEN (NEW.offer_cents IS NOT NULL) EXECUTE FUNCTION tyaga_fee.stamp_negotiation();

CREATE OR REPLACE FUNCTION tyaga_fee.guard_order() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a tyaga.annonces; participants integer; enrolling boolean:=false;
BEGIN
  IF TG_OP='INSERT' THEN
    SELECT * INTO a FROM tyaga.annonces WHERE id=NEW.annonce_id FOR SHARE;
    IF NEW.fee_policy IS DISTINCT FROM a.fee_policy THEN
      RAISE EXCEPTION 'fee policy differs from listing' USING ERRCODE='23514';
    END IF;
    IF NEW.fee_policy='legacy' THEN RETURN NEW; END IF;
    IF a.status<>'published' OR a.user_id IS DISTINCT FROM NEW.seller_id OR a.item_id IS DISTINCT FROM NEW.item_id
      OR NEW.buyer_id=NEW.seller_id OR NEW.item_amount_cents IS DISTINCT FROM tyaga_fee.agreed_price(a,NEW.buyer_id)
      OR NEW.status<>'pending' OR NEW.escrow_status<>'none'
      OR NEW.stripe_checkout_session_id IS NOT NULL OR NEW.stripe_payment_intent_id IS NOT NULL OR NEW.stripe_transfer_id IS NOT NULL
    THEN RAISE EXCEPTION 'invalid pilot order' USING ERRCODE='23514'; END IF;
    enrolling:=true;
  ELSE
    IF (NEW.fee_policy,NEW.item_amount_cents,NEW.buyer_fee_cents) IS DISTINCT FROM
       (OLD.fee_policy,OLD.item_amount_cents,OLD.buyer_fee_cents) THEN
      RAISE EXCEPTION 'fee snapshot is immutable' USING ERRCODE='23514';
    END IF;
    IF NEW.fee_policy='legacy' THEN RETURN NEW; END IF;
    IF (NEW.annonce_id,NEW.item_id,NEW.seller_id,NEW.buyer_id,NEW.amount_cents,NEW.net_amount_cents,NEW.shipping_address)
       IS DISTINCT FROM (OLD.annonce_id,OLD.item_id,OLD.seller_id,OLD.buyer_id,OLD.amount_cents,OLD.net_amount_cents,OLD.shipping_address) THEN
      RAISE EXCEPTION 'pilot order snapshot is immutable' USING ERRCODE='23514';
    END IF;
    IF NEW.stripe_checkout_session_id IS DISTINCT FROM OLD.stripe_checkout_session_id THEN
      IF current_setting('role',true) IS DISTINCT FROM 'service_role' OR OLD.stripe_checkout_session_id IS NOT NULL
         OR NEW.stripe_checkout_session_id IS NULL OR NEW.stripe_checkout_session_id !~ '^cs_test_[A-Za-z0-9]+$'
         OR OLD.status<>'pending' THEN RAISE EXCEPTION 'private test checkout required' USING ERRCODE='23514'; END IF;
      enrolling:=true;
    END IF;
    IF (NEW.stripe_payment_intent_id,NEW.stripe_transfer_id,NEW.escrow_status) IS DISTINCT FROM
       (OLD.stripe_payment_intent_id,OLD.stripe_transfer_id,OLD.escrow_status)
       AND current_setting('role',true) IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'private payment evidence required' USING ERRCODE='23514';
    END IF;
    IF OLD.stripe_payment_intent_id IS NOT NULL AND
       OLD.stripe_payment_intent_id IS DISTINCT FROM NEW.stripe_payment_intent_id THEN
      RAISE EXCEPTION 'payment intent is immutable' USING ERRCODE='23514';
    END IF;
    IF NEW.status IN ('paid','shipped','delivered','completed') AND
       (NEW.stripe_checkout_session_id IS NULL OR NEW.stripe_checkout_session_id !~ '^cs_test_[A-Za-z0-9]+$'
        OR NEW.stripe_payment_intent_id IS NULL OR NEW.stripe_payment_intent_id !~ '^pi_[A-Za-z0-9]+$') THEN
      RAISE EXCEPTION 'confirmed test session required' USING ERRCODE='23514';
    END IF;
  END IF;
  IF enrolling THEN
    SELECT count(*) INTO participants FROM (
      SELECT seller_id FROM tyaga_fee.pilot_sellers WHERE seller_id IN(NEW.seller_id,NEW.buyer_id)
      ORDER BY seller_id FOR SHARE
    ) AS qualified;
    IF participants<>2 THEN RAISE EXCEPTION 'two qualified participants required' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS physical_sale_fee_order ON tyaga.marketplace_orders;
CREATE TRIGGER physical_sale_fee_order BEFORE INSERT OR UPDATE ON tyaga.marketplace_orders
  FOR EACH ROW EXECUTE FUNCTION tyaga_fee.guard_order();
-- A completed pilot sale is visible as a receipt but never entitles the
-- holder to reassign points already earned on other, settled sales.
CREATE OR REPLACE FUNCTION tyaga_fee.guard_vida_transfer() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF EXISTS(SELECT FROM tyaga.ventes WHERE id=NEW.vente_id AND fee_policy='fr_p2p_test_v2') THEN
    RAISE EXCEPTION 'test sale has no VIDA rights' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS physical_sale_fee_vida_transfer ON tyaga.vida_transfers;
CREATE TRIGGER physical_sale_fee_vida_transfer BEFORE INSERT OR UPDATE OF vente_id ON tyaga.vida_transfers
  FOR EACH ROW EXECUTE FUNCTION tyaga_fee.guard_vida_transfer();
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA tyaga_fee FROM PUBLIC, anon, authenticated, service_role;

-- New revision of the existing finalizer. Same RPC, lock, payout claim and
-- recovery history. Its sale basis excludes the buyer service fee; pilot
-- transactions never consume the referrer's first eligible commission.
CREATE OR REPLACE FUNCTION tyaga.prepare_order_settlement(p_order uuid, p_buyer uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, tyaga AS $$
DECLARE
  v_order tyaga.marketplace_orders;
  v_settlement tyaga.order_settlements;
  v_destination text;
  v_referrer uuid;
  v_issue boolean := false;
BEGIN
  -- Double garde : même un GRANT global rejoué depuis un ancien schema.sql
  -- ne rend pas cette fonction utilisable par anon/authenticated.
  IF current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_order FROM tyaga.marketplace_orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order not found' USING ERRCODE = 'P0002'; END IF;
  IF p_buyer IS NULL OR p_buyer <> v_order.buyer_id THEN
    RAISE EXCEPTION 'buyer required' USING ERRCODE = '42501';
  END IF;
  IF v_order.status NOT IN ('delivered', 'completed')
     OR v_order.escrow_status NOT IN ('held', 'released')
     OR v_order.stripe_payment_intent_id IS NULL THEN
    RAISE EXCEPTION 'order cannot be settled' USING ERRCODE = '23514';
  END IF;
  IF v_order.net_amount_cents < 0 OR v_order.commission_amount_cents < 0
     OR coalesce(v_order.item_amount_cents,v_order.amount_cents)::bigint <> v_order.net_amount_cents::bigint + v_order.commission_amount_cents THEN
    RAISE EXCEPTION 'invalid amounts' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_settlement FROM tyaga.order_settlements WHERE order_id = p_order FOR UPDATE;
  IF NOT FOUND THEN
    SELECT stripe_connect_account_id INTO v_destination FROM tyaga.profiles
     WHERE id = v_order.seller_id;
    -- Protège aussi un historique introduit après le backfill (déploiement
    -- ancien encore présent, restauration) : jamais de crédit supposé manquant.
    IF v_order.status = 'completed' OR v_order.escrow_status = 'released'
       OR v_order.stripe_transfer_id IS NOT NULL
       OR EXISTS (SELECT 1 FROM tyaga.ventes WHERE order_id = p_order) THEN
      INSERT INTO tyaga.order_settlements (
        order_id, state, amount_cents, destination, transfer_group, idempotency_key, stripe_transfer_id
      ) VALUES (
        p_order, CASE WHEN v_order.stripe_transfer_id IS NULL THEN 'legacy_review' ELSE 'transferred' END,
        v_order.net_amount_cents, v_destination, 'tyaga_order_' || p_order,
        'tyaga:settlement:v1:' || p_order, v_order.stripe_transfer_id
      ) RETURNING * INTO v_settlement;
    ELSE
      -- Vente, points vendeur, N1 et annonce : une transaction, aucun trou
      -- entre INSERT, crédit et drapeau. Toute erreur annule l'ensemble.
      INSERT INTO tyaga.ventes (
        order_id, seller_id, gross_amount_cents, commission_amount_cents,
        net_amount_cents, fiscal_year, fee_policy
      ) VALUES (
        p_order, v_order.seller_id, coalesce(v_order.item_amount_cents,v_order.amount_cents), v_order.commission_amount_cents,
        v_order.net_amount_cents, extract(year FROM now() AT TIME ZONE 'Europe/Paris')::integer, v_order.fee_policy
      );
      IF v_order.fee_policy='legacy' THEN
        PERFORM tyaga.credit_wallet(v_order.seller_id, v_order.net_amount_cents / 100);
      END IF;
      UPDATE tyaga.referrals SET commission_paid = true
       WHERE v_order.fee_policy='legacy' AND referred_id = v_order.seller_id AND NOT commission_paid
       RETURNING referrer_id INTO v_referrer;
      IF v_referrer IS NOT NULL THEN
        -- Math.round(commission / 200), pour les centimes positifs, sans flottant.
        PERFORM tyaga.credit_wallet(v_referrer, (v_order.commission_amount_cents / 200)
          + CASE WHEN v_order.commission_amount_cents % 200 >= 100 THEN 1 ELSE 0 END);
      END IF;
      UPDATE tyaga.annonces SET status = 'unpublished', updated_at = now()
       WHERE id = v_order.annonce_id AND status = 'published';
      UPDATE tyaga.marketplace_orders SET status = 'completed',
        escrow_status = CASE WHEN v_order.net_amount_cents = 0 THEN 'released' ELSE 'held' END,
        updated_at = now()
       WHERE id = p_order RETURNING * INTO v_order;
      INSERT INTO tyaga.order_settlements (
        order_id, state, amount_cents, destination, transfer_group, idempotency_key
      ) VALUES (
        p_order,
        CASE WHEN v_order.net_amount_cents = 0 THEN 'no_transfer_due'
             WHEN v_destination IS NULL THEN 'awaiting_account' ELSE 'ready' END,
        v_order.net_amount_cents, v_destination, 'tyaga_order_' || p_order,
        'tyaga:settlement:v1:' || p_order
      ) RETURNING * INTO v_settlement;
    END IF;
  END IF;

  IF v_settlement.state = 'awaiting_account' THEN
    SELECT stripe_connect_account_id INTO v_destination FROM tyaga.profiles
     WHERE id = v_order.seller_id;
    IF v_destination IS NOT NULL THEN
      UPDATE tyaga.order_settlements SET destination = v_destination, state = 'ready', updated_at = now()
       WHERE order_id = p_order RETURNING * INTO v_settlement;
    END IF;
  END IF;
  IF v_settlement.state = 'ready' THEN
    -- Aucun lease ni timeout : ce droit consommé ne redevient JAMAIS émissible.
    -- Même si la réponse RPC se perd avant tout appel Stripe, la reprise lit seulement.
    UPDATE tyaga.order_settlements SET state = 'issuing', claimed_at = now(), updated_at = now()
     WHERE order_id = p_order RETURNING * INTO v_settlement;
    v_issue := true;
  END IF;
  RETURN jsonb_build_object('order', jsonb_build_object(
    'id', v_order.id, 'status', v_order.status, 'escrow_status', v_order.escrow_status,
    'stripe_transfer_id', v_order.stripe_transfer_id
  ), 'settlement', to_jsonb(v_settlement), 'issue', v_issue);
END $$;

-- Preserve the canonical refund/reversal workflow and never claw back VIDA
-- points for a pilot order, since those orders never granted any.
CREATE OR REPLACE FUNCTION tyaga.prepare_order_refund(
  p_payment_intent text, p_charge text, p_amount integer, p_refunded integer,
  p_currency text, p_full boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, tyaga AS $$
DECLARE
  v_order tyaga.marketplace_orders;
  v_settlement tyaga.order_settlements;
  v_possible boolean;
  v_net integer;
  v_seller uuid;
  v_destination text;
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_order FROM tyaga.marketplace_orders
   WHERE stripe_payment_intent_id = p_payment_intent FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF p_charge IS NULL OR p_charge !~ '^ch_[A-Za-z0-9]+$'
     OR p_currency IS DISTINCT FROM 'eur' OR p_amount IS DISTINCT FROM v_order.amount_cents
     OR p_refunded IS NULL OR p_refunded <= 0 OR p_refunded > p_amount
     OR p_full IS DISTINCT FROM (p_refunded = p_amount) THEN
    RAISE EXCEPTION 'refund does not match order' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_settlement FROM tyaga.order_settlements WHERE order_id = v_order.id FOR UPDATE;
  IF NOT FOUND THEN
    v_possible := v_order.stripe_transfer_id IS NOT NULL
      OR v_order.status IN ('completed', 'cancelled') OR v_order.escrow_status IN ('released', 'refunded')
      OR EXISTS (SELECT 1 FROM tyaga.ventes WHERE order_id = v_order.id);
    SELECT stripe_connect_account_id INTO v_destination FROM tyaga.profiles WHERE id = v_order.seller_id;
    INSERT INTO tyaga.order_settlements (
      order_id, state, amount_cents, destination, transfer_group, idempotency_key,
      stripe_transfer_id, refund_transfer_may_exist
    ) VALUES (
      v_order.id, 'refund_review', v_order.net_amount_cents, v_destination,
      'tyaga_order_' || v_order.id, 'tyaga:settlement:v1:' || v_order.id,
      v_order.stripe_transfer_id, v_possible
    ) RETURNING * INTO v_settlement;
  ELSE
    v_possible := coalesce(v_settlement.refund_transfer_may_exist,
      v_order.stripe_transfer_id IS NOT NULL OR v_settlement.claimed_at IS NOT NULL
      OR v_settlement.state IN ('legacy_review', 'transferred', 'refund_review'));
  END IF;
  IF v_settlement.refund_charge_id IS NOT NULL AND v_settlement.refund_charge_id <> p_charge THEN
    RAISE EXCEPTION 'conflicting refund charge' USING ERRCODE = '23514';
  END IF;
  UPDATE tyaga.order_settlements SET state = 'refund_review', refund_charge_id = p_charge,
    refund_transfer_may_exist = v_possible,
    refunded_amount_cents = greatest(refunded_amount_cents, p_refunded), updated_at = now()
   WHERE order_id = v_order.id RETURNING * INTO v_settlement;

  -- Un événement partiel ancien ne peut défaire un remboursement complet.
  IF NOT p_full AND v_settlement.refund_accounted_at IS NULL THEN
    UPDATE tyaga.order_settlements SET refund_state = 'partial_review'
     WHERE order_id = v_order.id RETURNING * INTO v_settlement;
    UPDATE tyaga.marketplace_orders SET escrow_status = CASE
      WHEN status = 'completed' AND escrow_status = 'released' THEN 'held' ELSE escrow_status END
     WHERE id = v_order.id;
    RETURN to_jsonb(v_settlement);
  END IF;

  IF v_settlement.refund_accounted_at IS NULL THEN
    -- DELETE RETURNING + débit + statut + marqueur : même transaction.
    -- Le verrou commande sérialise aussi deux remboursements simultanés.
    DELETE FROM tyaga.ventes WHERE order_id = v_order.id
     RETURNING net_amount_cents, seller_id INTO v_net, v_seller;
    IF FOUND AND v_order.fee_policy='legacy' THEN
      UPDATE tyaga.vida_wallet SET balance_points = greatest(balance_points - (v_net / 100), 0),
        updated_at = now() WHERE user_id = v_seller;
    END IF;
    UPDATE tyaga.order_settlements SET refund_accounted_at = now()
     WHERE order_id = v_order.id RETURNING * INTO v_settlement;
  END IF;
  UPDATE tyaga.marketplace_orders SET status = 'cancelled', escrow_status = 'refunded', updated_at = now()
   WHERE id = v_order.id;
  UPDATE tyaga.order_settlements SET refund_state = CASE
    WHEN refund_state IN ('complete', 'reversing', 'reversal_review') THEN refund_state
    WHEN stripe_transfer_id IS NOT NULL THEN 'pending_reversal'
    WHEN NOT v_possible THEN 'complete'
    ELSE 'pending_transfer' END, updated_at = now()
   WHERE order_id = v_order.id RETURNING * INTO v_settlement;
  RETURN to_jsonb(v_settlement);
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
