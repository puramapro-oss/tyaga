-- Forward migration after the marketplace and physical fee migrations.
-- Apply before the paired API change. No provider call and no historical
-- cancellation is inferred or rewritten. Unknown checkouts require review.
BEGIN;

CREATE TABLE IF NOT EXISTS tyaga.order_checkout_cancellations (
  order_id uuid PRIMARY KEY REFERENCES tyaga.marketplace_orders(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL,
  checkout_session_id text NOT NULL UNIQUE,
  verified_receipt jsonb NOT NULL CHECK (jsonb_typeof(verified_receipt) = 'object'),
  verified_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tyaga.order_checkout_cancellations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tyaga.order_checkout_cancellations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON tyaga.order_checkout_cancellations TO service_role;

-- A direct PostgREST UPDATE must not free the unique active-listing slot
-- while a provider request may still be in flight. USING and WITH CHECK alone
-- cannot pair the old and new status; enforce the two client transitions too.
DROP POLICY IF EXISTS orders_update ON tyaga.marketplace_orders;
CREATE POLICY orders_update ON tyaga.marketplace_orders FOR UPDATE
  USING ((buyer_id = auth.uid() AND status = 'shipped')
    OR (seller_id = auth.uid() AND status = 'paid'))
  WITH CHECK ((buyer_id = auth.uid() AND status = 'delivered')
    OR (seller_id = auth.uid() AND status = 'shipped'));
CREATE OR REPLACE FUNCTION tyaga.guard_checkout_cancellation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status
     AND current_setting('role', true) IN ('anon', 'authenticated')
     AND NOT ((OLD.status = 'paid' AND NEW.status = 'shipped' AND OLD.seller_id = auth.uid())
       OR (OLD.status = 'shipped' AND NEW.status = 'delivered' AND OLD.buyer_id = auth.uid())) THEN
    RAISE EXCEPTION 'client order transition requires verified server action'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_checkout_cancellation ON tyaga.marketplace_orders;
CREATE TRIGGER guard_checkout_cancellation BEFORE UPDATE ON tyaga.marketplace_orders
  FOR EACH ROW EXECUTE FUNCTION tyaga.guard_checkout_cancellation();

CREATE OR REPLACE FUNCTION tyaga.cancel_expired_order(p_order uuid, p_actor uuid, p_session jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_order tyaga.marketplace_orders;
BEGIN
  -- Keep the internal gate even if an older global GRANT is ever replayed.
  IF current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_order FROM tyaga.marketplace_orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order not found' USING ERRCODE = 'P0002'; END IF;
  IF p_actor IS NULL OR p_actor NOT IN (v_order.buyer_id, v_order.seller_id) THEN
    RAISE EXCEPTION 'order participant required' USING ERRCODE = '42501';
  END IF;
  IF v_order.status NOT IN ('pending', 'cancelled') OR v_order.escrow_status <> 'none'
     OR v_order.stripe_payment_intent_id IS NOT NULL THEN
    RAISE EXCEPTION 'payment state changed' USING ERRCODE = '23514';
  END IF;
  IF jsonb_typeof(p_session) IS DISTINCT FROM 'object'
     OR v_order.stripe_checkout_session_id IS NULL
     OR p_session->>'id' IS DISTINCT FROM v_order.stripe_checkout_session_id
     OR p_session->>'id' !~ '^cs_[A-Za-z0-9_]+$'
     OR p_session->>'status' IS DISTINCT FROM 'expired'
     OR p_session->>'payment_status' IS DISTINCT FROM 'unpaid'
     OR p_session->>'mode' IS DISTINCT FROM 'payment'
     OR p_session->>'currency' IS DISTINCT FROM 'eur'
     OR p_session->>'amount_total' IS DISTINCT FROM v_order.amount_cents::text
     OR coalesce(p_session->>'client_reference_id', p_order::text) <> p_order::text
     OR p_session->'metadata'->>'app_slug' IS DISTINCT FROM 'tyaga'
     OR p_session->'metadata'->>'order_id' IS DISTINCT FROM p_order::text
     OR p_session->'metadata'->>'buyer_id' IS DISTINCT FROM v_order.buyer_id::text
     OR p_session->'metadata'->>'seller_id' IS DISTINCT FROM v_order.seller_id::text THEN
    RAISE EXCEPTION 'verified expiry does not match order' USING ERRCODE = '23514';
  END IF;
  IF v_order.fee_policy IN ('fr_p2p_test_v2', 'fr_p2p_test_v3')
     AND (p_session->>'livemode' IS DISTINCT FROM 'false'
       OR p_session->>'id' !~ '^cs_test_[A-Za-z0-9]+$') THEN
    RAISE EXCEPTION 'test expiry required' USING ERRCODE = '23514';
  END IF;

  -- Persist only the bounded receipt facts supplied by the verified server.
  -- The receipt and the cancellation commit together under the same row lock.
  INSERT INTO tyaga.order_checkout_cancellations
    (order_id, actor_id, checkout_session_id, verified_receipt)
  VALUES (p_order, p_actor, v_order.stripe_checkout_session_id, p_session)
  ON CONFLICT (order_id) DO NOTHING;
  UPDATE tyaga.marketplace_orders SET status = 'cancelled', updated_at = now()
    WHERE id = p_order AND status = 'pending' RETURNING * INTO v_order;
  IF NOT FOUND THEN
    SELECT * INTO v_order FROM tyaga.marketplace_orders WHERE id = p_order;
  END IF;
  RETURN jsonb_build_object('id', v_order.id, 'status', v_order.status,
    'escrow_status', v_order.escrow_status);
END $$;
REVOKE ALL ON FUNCTION tyaga.cancel_expired_order(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION tyaga.cancel_expired_order(uuid, uuid, jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
