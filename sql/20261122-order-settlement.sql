-- Finalisation atomique et droit d'émission durable, une fois par commande.
-- Appliquer après schema.sql, après arrêt des anciens finaliseurs. Aucun appel
-- Stripe ici. Ne jamais supprimer/réinitialiser un claim pour relancer un paiement.
BEGIN;

CREATE TABLE IF NOT EXISTS tyaga.order_settlements (
  order_id uuid PRIMARY KEY REFERENCES tyaga.marketplace_orders(id) ON DELETE RESTRICT,
  state text NOT NULL CHECK (state IN (
    'awaiting_account', 'ready', 'issuing', 'transferred', 'no_transfer_due',
    'legacy_review', 'refund_review'
  )),
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL DEFAULT 'eur' CHECK (currency = 'eur'),
  destination text,
  transfer_group text NOT NULL UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  stripe_transfer_id text UNIQUE,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (state NOT IN ('ready', 'issuing') OR destination IS NOT NULL)
);
ALTER TABLE tyaga.order_settlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tyaga.order_settlements FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON tyaga.order_settlements TO service_role;

-- L'ancien code pouvait virer puis perdre le reçu, ou créditer le wallet puis
-- perdre la réponse. Une absence de preuve historique n'autorise AUCUN rejeu.
INSERT INTO tyaga.order_settlements (
  order_id, state, amount_cents, destination, transfer_group,
  idempotency_key, stripe_transfer_id
)
SELECT o.id,
       CASE WHEN o.stripe_transfer_id IS NOT NULL THEN 'transferred' ELSE 'legacy_review' END,
       o.net_amount_cents, p.stripe_connect_account_id,
       'tyaga_order_' || o.id, 'tyaga:settlement:v1:' || o.id, o.stripe_transfer_id
FROM tyaga.marketplace_orders o
JOIN tyaga.profiles p ON p.id = o.seller_id
WHERE o.status = 'completed' OR o.escrow_status = 'released'
   OR o.stripe_transfer_id IS NOT NULL
   OR EXISTS (SELECT 1 FROM tyaga.ventes v WHERE v.order_id = o.id)
ON CONFLICT (order_id) DO NOTHING;

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
     OR v_order.amount_cents <> v_order.net_amount_cents + v_order.commission_amount_cents THEN
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
        net_amount_cents, fiscal_year
      ) VALUES (
        p_order, v_order.seller_id, v_order.amount_cents, v_order.commission_amount_cents,
        v_order.net_amount_cents, extract(year FROM now() AT TIME ZONE 'Europe/Paris')::integer
      );
      PERFORM tyaga.credit_wallet(v_order.seller_id, v_order.net_amount_cents / 100);
      UPDATE tyaga.referrals SET commission_paid = true
       WHERE referred_id = v_order.seller_id AND NOT commission_paid
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

CREATE OR REPLACE FUNCTION tyaga.record_order_transfer(p_order uuid, p_transfer jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, tyaga AS $$
DECLARE
  v_order tyaga.marketplace_orders;
  v_settlement tyaga.order_settlements;
  v_refund_review boolean;
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_order FROM tyaga.marketplace_orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_settlement FROM tyaga.order_settlements WHERE order_id = p_order FOR UPDATE;
  IF NOT FOUND OR v_settlement.state NOT IN ('issuing', 'transferred', 'refund_review') THEN
    RAISE EXCEPTION 'transfer was not claimed' USING ERRCODE = '23514';
  END IF;
  IF p_transfer->>'id' IS NULL OR p_transfer->>'id' !~ '^tr_[A-Za-z0-9]+$'
     OR (p_transfer->>'amount')::integer IS DISTINCT FROM v_settlement.amount_cents
     OR p_transfer->>'currency' IS DISTINCT FROM v_settlement.currency
     OR p_transfer->>'destination' IS DISTINCT FROM v_settlement.destination
     OR p_transfer->>'transfer_group' IS DISTINCT FROM v_settlement.transfer_group
     OR p_transfer->>'order_id' IS DISTINCT FROM p_order::text
     OR p_transfer->>'app_slug' IS DISTINCT FROM 'tyaga'
     OR (p_transfer->>'amount_reversed')::integer IS NULL
     OR (p_transfer->>'amount_reversed')::integer < 0
     OR (p_transfer->>'reversed')::boolean IS NULL THEN
    RAISE EXCEPTION 'transfer does not match the claim' USING ERRCODE = '23514';
  END IF;
  IF (v_settlement.stripe_transfer_id IS NOT NULL AND v_settlement.stripe_transfer_id <> p_transfer->>'id')
     OR (v_order.stripe_transfer_id IS NOT NULL AND v_order.stripe_transfer_id <> p_transfer->>'id') THEN
    RAISE EXCEPTION 'conflicting transfer receipt' USING ERRCODE = '23514';
  END IF;
  -- Une preuve de remboursement/réversion est absorbante : une réponse
  -- Stripe plus ancienne (reversed=false) peut arriver après le rapprochement.
  v_refund_review := v_settlement.state = 'refund_review' OR v_order.status <> 'completed'
    OR v_order.escrow_status NOT IN ('held', 'released')
    OR (p_transfer->>'reversed')::boolean OR (p_transfer->>'amount_reversed')::integer > 0;
  UPDATE tyaga.order_settlements SET
    stripe_transfer_id = p_transfer->>'id',
    state = CASE WHEN v_refund_review THEN 'refund_review' ELSE 'transferred' END,
    updated_at = now()
   WHERE order_id = p_order RETURNING * INTO v_settlement;
  -- Si un remboursement est arrivé pendant l'appel externe, on conserve le
  -- reçu pour rapprochement. On ne ressuscite JAMAIS la commande remboursée.
  UPDATE tyaga.marketplace_orders SET stripe_transfer_id = p_transfer->>'id',
    escrow_status = CASE WHEN NOT v_refund_review THEN 'released'
      WHEN status = 'completed' AND escrow_status = 'released' THEN 'held'
      ELSE escrow_status END,
    updated_at = now()
   WHERE id = p_order RETURNING * INTO v_order;
  RETURN jsonb_build_object('order', jsonb_build_object(
    'id', v_order.id, 'status', v_order.status, 'escrow_status', v_order.escrow_status,
    'stripe_transfer_id', v_order.stripe_transfer_id
  ), 'settlement', to_jsonb(v_settlement), 'issue', false);
END $$;

REVOKE ALL ON FUNCTION tyaga.prepare_order_settlement(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION tyaga.record_order_transfer(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION tyaga.prepare_order_settlement(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION tyaga.record_order_transfer(uuid, jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
