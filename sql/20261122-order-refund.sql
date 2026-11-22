-- À appliquer après 20261122-order-settlement.sql. Compensation durable du
-- remboursement complet ; aucun prorata implicite pour un remboursement partiel.
BEGIN;
ALTER TABLE tyaga.order_settlements
  ADD COLUMN IF NOT EXISTS refund_state text CHECK (refund_state IN (
    'partial_review', 'pending_transfer', 'pending_reversal', 'reversing', 'reversal_review', 'complete'
  )),
  ADD COLUMN IF NOT EXISTS refund_charge_id text,
  ADD COLUMN IF NOT EXISTS refunded_amount_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refund_transfer_may_exist boolean,
  ADD COLUMN IF NOT EXISTS refund_accounted_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversal_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_reversal_id text,
  ADD COLUMN IF NOT EXISTS reversal_confirmed_at timestamptz;

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
    IF FOUND THEN
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

CREATE OR REPLACE FUNCTION tyaga.claim_order_reversal(p_order uuid, p_transfer text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, tyaga AS $$
DECLARE v_order tyaga.marketplace_orders; v_settlement tyaga.order_settlements; v_issue boolean := false;
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_order FROM tyaga.marketplace_orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND OR v_order.status <> 'cancelled' OR v_order.escrow_status <> 'refunded' THEN
    RAISE EXCEPTION 'order not refunded' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_settlement FROM tyaga.order_settlements WHERE order_id = p_order FOR UPDATE;
  IF NOT FOUND OR v_settlement.refund_accounted_at IS NULL
     OR p_transfer IS NULL OR p_transfer IS DISTINCT FROM v_settlement.stripe_transfer_id
     OR p_transfer IS DISTINCT FROM v_order.stripe_transfer_id THEN
    RAISE EXCEPTION 'refund transfer mismatch' USING ERRCODE = '23514';
  END IF;
  IF v_settlement.refund_state = 'pending_reversal' AND v_settlement.reversal_claimed_at IS NULL THEN
    UPDATE tyaga.order_settlements SET refund_state = 'reversing', reversal_claimed_at = now(), updated_at = now()
     WHERE order_id = p_order RETURNING * INTO v_settlement;
    v_issue := true;
  END IF;
  RETURN jsonb_build_object('issue', v_issue, 'settlement', to_jsonb(v_settlement));
END $$;

CREATE OR REPLACE FUNCTION tyaga.record_order_reversal(p_order uuid, p_transfer jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, tyaga AS $$
DECLARE v_order tyaga.marketplace_orders; v_settlement tyaga.order_settlements; v_full boolean;
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_order FROM tyaga.marketplace_orders WHERE id = p_order FOR UPDATE;
  SELECT * INTO v_settlement FROM tyaga.order_settlements WHERE order_id = p_order FOR UPDATE;
  IF NOT FOUND OR v_order.status <> 'cancelled' OR v_order.escrow_status <> 'refunded'
     OR v_settlement.refund_accounted_at IS NULL
     OR p_transfer->>'id' IS NULL
     OR p_transfer->>'id' IS DISTINCT FROM v_settlement.stripe_transfer_id
     OR p_transfer->>'id' IS DISTINCT FROM v_order.stripe_transfer_id
     OR (p_transfer->>'amount')::integer IS DISTINCT FROM v_settlement.amount_cents
     OR p_transfer->>'currency' IS DISTINCT FROM v_settlement.currency
     OR p_transfer->>'order_id' IS DISTINCT FROM p_order::text
     OR p_transfer->>'app_slug' IS DISTINCT FROM 'tyaga'
     OR (p_transfer->>'reversed')::boolean IS NULL
     OR (p_transfer->>'amount_reversed')::integer IS NULL
     OR (p_transfer->>'amount_reversed')::integer < 0
     OR (p_transfer->>'amount_reversed')::integer > v_settlement.amount_cents THEN
    RAISE EXCEPTION 'invalid reversal proof' USING ERRCODE = '23514';
  END IF;
  v_full := (p_transfer->>'reversed')::boolean
    AND (p_transfer->>'amount_reversed')::integer = v_settlement.amount_cents;
  -- La preuve complète est absorbante, même si une lecture Stripe ancienne
  -- (partielle ou nulle) termine après elle.
  UPDATE tyaga.order_settlements SET
    refund_state = CASE WHEN refund_state = 'complete' OR v_full THEN 'complete' ELSE 'reversal_review' END,
    reversal_confirmed_at = CASE WHEN v_full THEN coalesce(reversal_confirmed_at, now()) ELSE reversal_confirmed_at END,
    stripe_reversal_id = coalesce(stripe_reversal_id, p_transfer->>'reversal_id'), updated_at = now()
   WHERE order_id = p_order RETURNING * INTO v_settlement;
  RETURN to_jsonb(v_settlement);
END $$;

REVOKE ALL ON FUNCTION tyaga.prepare_order_refund(text,text,integer,integer,text,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION tyaga.claim_order_reversal(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION tyaga.record_order_reversal(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION tyaga.prepare_order_refund(text,text,integer,integer,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION tyaga.claim_order_reversal(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION tyaga.record_order_reversal(uuid,jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
