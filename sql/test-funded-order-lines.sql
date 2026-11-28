BEGIN;
ALTER TABLE tyaga.marketplace_orders ADD COLUMN IF NOT EXISTS funding_route text NOT NULL DEFAULT 'stripe'
  CHECK (funding_route IN ('stripe','pay_test'));
ALTER TABLE tyaga.marketplace_orders ADD COLUMN IF NOT EXISTS funded_destination text;
-- This database-level setting is set by the operator on an isolated database.
-- A session-local SET never opens the interface.
CREATE OR REPLACE FUNCTION tyaga_fee.funded_order_tenant() RETURNS text
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT substr(c,length('tyaga.funded_order_tenant=')+1) FROM pg_db_role_setting s
 JOIN pg_database d ON d.oid=s.setdatabase CROSS JOIN LATERAL unnest(s.setconfig) c
 WHERE d.datname=current_database() AND d.datname ~ '^(purama|tyaga)_test_' AND s.setrole=0
 AND split_part(c,'=',1)='tyaga.funded_order_tenant'
 AND length(substr(c,length('tyaga.funded_order_tenant=')+1)) BETWEEN 1 AND 128
$$;
CREATE OR REPLACE FUNCTION tyaga_fee.guard_order_funding_route() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.funding_route,NEW.funded_destination) IS DISTINCT FROM
     (OLD.funding_route,OLD.funded_destination) THEN
   RAISE EXCEPTION 'immutable funding route' USING ERRCODE='23514';
 END IF;
 IF NEW.funding_route='pay_test' THEN
   IF NEW.fee_policy NOT IN ('fr_p2p_test_v2','fr_p2p_test_v3')
      OR tyaga_fee.funded_order_tenant() IS NULL OR NEW.stripe_checkout_session_id IS NOT NULL
      OR NEW.stripe_payment_intent_id IS NOT NULL OR NEW.stripe_transfer_id IS NOT NULL THEN
     RAISE EXCEPTION 'incompatible funding route' USING ERRCODE='23514';
   END IF;
   IF TG_OP='INSERT' THEN
     SELECT stripe_connect_account_id INTO NEW.funded_destination FROM tyaga.profiles WHERE id=NEW.seller_id;
     IF NEW.funded_destination IS NULL OR NEW.funded_destination !~ '^acct_[A-Za-z0-9]+$' THEN
       RAISE EXCEPTION 'missing seller destination' USING ERRCODE='23514';
     END IF;
   END IF;
 ELSIF NEW.funded_destination IS NOT NULL THEN
   RAISE EXCEPTION 'unexpected funded destination' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_order_funding_route ON tyaga.marketplace_orders;
CREATE TRIGGER guard_order_funding_route BEFORE INSERT OR UPDATE ON tyaga.marketplace_orders
FOR EACH ROW EXECUTE FUNCTION tyaga_fee.guard_order_funding_route();

-- External test-operator receipts. These are evidence for settlement, never
-- customer balances or instructions to send money.
CREATE TABLE IF NOT EXISTS tyaga_fee.funded_order_receipts(
 order_id uuid NOT NULL REFERENCES tyaga.marketplace_orders(id) ON DELETE RESTRICT,
 tenant text NOT NULL, funding_ref text NOT NULL, basket_ref text NOT NULL, funded_cents integer NOT NULL,
 kind text NOT NULL CHECK(kind IN ('seller_transfer','seller_reversal')),
 receipt text NOT NULL, destination text NOT NULL, amount_cents integer NOT NULL CHECK(amount_cents>0),
 original_receipt text, recorded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (order_id,kind), UNIQUE(tenant,receipt)
);
REVOKE ALL ON tyaga_fee.funded_order_receipts FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE tyaga_fee.funded_order_receipts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION tyaga.read_test_funded_order_line(p_order uuid,p_buyer uuid,p_seller uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF tyaga_fee.funded_order_tenant() IS NULL OR NOT (
    coalesce(current_setting('role',true),'') IN ('service_role','purama_pay_test_operator')
    OR (current_setting('role',true)='authenticated' AND auth.uid() IS NOT NULL
        AND (auth.uid()=p_buyer OR auth.uid()=p_seller))
 ) THEN
    RAISE EXCEPTION 'isolated operator required' USING ERRCODE='42501';
 END IF;
 RETURN (SELECT jsonb_build_object('order_id',o.id,'buyer_id',o.buyer_id,'seller_id',o.seller_id,
  'tenant',tyaga_fee.funded_order_tenant(),'currency','EUR','funding_route',o.funding_route,
  'status',o.status,'gross_cents',o.amount_cents,'seller_net_cents',o.net_amount_cents,
  'buyer_fee_cents',o.buyer_fee_cents,'seller_account',o.funded_destination,
  'payment_intent_id',o.stripe_payment_intent_id,'transfer_id',s.stripe_transfer_id,
  'refund_cents',coalesce(s.refunded_amount_cents,0))
  FROM tyaga.marketplace_orders o LEFT JOIN tyaga.order_settlements s ON s.order_id=o.id
  WHERE o.id=p_order AND o.buyer_id=p_buyer AND o.seller_id=p_seller
  AND o.fee_policy IN ('fr_p2p_test_v2','fr_p2p_test_v3'));
END $$;

CREATE OR REPLACE FUNCTION tyaga.reconcile_test_funded_order_line(
 p_tenant text,p_buyer uuid,p_order uuid,p_seller uuid,p_funding_ref text,p_basket_ref text,p_amount_cents integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o jsonb; src jsonb; total integer; sent tyaga_fee.funded_order_receipts; reversed tyaga_fee.funded_order_receipts;
BEGIN
 o:=tyaga.read_test_funded_order_line(p_order,p_buyer,p_seller);
 IF o IS NULL OR p_tenant IS DISTINCT FROM o->>'tenant' OR o->>'funding_route'<>'pay_test' OR
  p_funding_ref IS NULL OR p_basket_ref IS NULL OR p_amount_cents IS NULL OR p_amount_cents<=0 THEN
   RAISE EXCEPTION 'funded order mismatch' USING ERRCODE='23514'; END IF;
 total:=(o->>'gross_cents')::integer;
 IF p_amount_cents>total THEN RAISE EXCEPTION 'funding exceeds order' USING ERRCODE='23514'; END IF;
 src:=purama_pay_test.read_eur_line(p_tenant,p_buyer,p_order,p_seller);
 IF src IS NULL OR NOT(src @> jsonb_build_object('mode','isolated_test','currency','EUR','tenantId',p_tenant,
    'buyerId',p_buyer,'orderId',p_order,'sellerId',p_seller,'fundingRef',p_funding_ref,
    'basketRef',p_basket_ref,'amountCents',p_amount_cents)) OR coalesce(src->>'status','') NOT IN
    ('reserved','captured','released','refunded') OR coalesce(src->>'operatorAccount','')='' OR
   (src->>'status'='refunded' AND (coalesce(src->>'refundEvidenceRef','')='' OR
      (src->>'refundedCents')::integer IS DISTINCT FROM p_amount_cents)) THEN
    RAISE EXCEPTION 'funding receipt mismatch' USING ERRCODE='23514'; END IF;
 SELECT * INTO sent FROM tyaga_fee.funded_order_receipts WHERE order_id=p_order AND kind='seller_transfer';
 SELECT * INTO reversed FROM tyaga_fee.funded_order_receipts WHERE order_id=p_order AND kind='seller_reversal';
 IF sent.order_id IS NOT NULL AND (sent.tenant,sent.funding_ref,sent.basket_ref,sent.funded_cents)
   IS DISTINCT FROM (p_tenant,p_funding_ref,p_basket_ref,p_amount_cents) THEN
   RAISE EXCEPTION 'order already reconciled to different funding' USING ERRCODE='23514'; END IF;
 RETURN o || jsonb_build_object('pay_status',src->>'status','funded_cents',p_amount_cents,
  'buyer_due_cents',CASE WHEN src->>'status' IN ('released','refunded') THEN NULL ELSE total-p_amount_cents END,
  'active_funded_cents',CASE WHEN src->>'status' IN ('reserved','captured') THEN p_amount_cents ELSE 0 END,
  'seller_transfer_ref',sent.receipt,'seller_reversal_ref',reversed.receipt,
  'seller_status',CASE WHEN reversed.order_id IS NOT NULL THEN 'reversed' WHEN sent.order_id IS NOT NULL THEN 'confirmed' ELSE 'unconfirmed' END,
  'buyer_funds_status',src->>'status','refund_evidence_ref',src->>'refundEvidenceRef',
  'source_operator_account',src->>'operatorAccount',
  'reconciliation_status',CASE WHEN src->>'status'='released' THEN 'released'
   WHEN src->>'status'='refunded' AND sent.order_id IS NOT NULL AND reversed.order_id IS NULL THEN 'review'
   WHEN src->>'status'='refunded' THEN 'returned' WHEN reversed.order_id IS NOT NULL THEN 'awaiting_buyer_return'
   WHEN sent.order_id IS NOT NULL THEN 'seller_confirmed' ELSE 'awaiting_settlement' END);
END $$;

CREATE OR REPLACE FUNCTION tyaga.record_test_funded_order_transfer(
 p_tenant text,p_buyer uuid,p_order uuid,p_seller uuid,p_funding_ref text,p_basket_ref text,p_amount_cents integer,
 p_kind text,p_receipt text,p_account text,p_proof_cents integer,p_currency text,p_original_receipt text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE f jsonb; prior tyaga_fee.funded_order_receipts;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'purama_pay_test_operator' OR tyaga_fee.funded_order_tenant() IS DISTINCT FROM p_tenant OR p_tenant IS NULL THEN
   RAISE EXCEPTION 'isolated operator required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM tyaga.marketplace_orders WHERE id=p_order AND buyer_id=p_buyer AND seller_id=p_seller FOR UPDATE;
 f:=tyaga.reconcile_test_funded_order_line(p_tenant,p_buyer,p_order,p_seller,p_funding_ref,p_basket_ref,p_amount_cents);
 IF p_kind IS NULL OR p_kind NOT IN ('seller_transfer','seller_reversal') OR p_receipt IS NULL OR
  length(p_receipt) NOT BETWEEN 1 AND 160 OR p_receipt<>trim(p_receipt) OR p_receipt IN (p_funding_ref,p_basket_ref) OR
  p_account IS DISTINCT FROM f->>'seller_account' OR p_currency IS DISTINCT FROM 'EUR' OR
  p_proof_cents IS DISTINCT FROM (f->>'seller_net_cents')::integer THEN
  RAISE EXCEPTION 'operator receipt does not match order' USING ERRCODE='23514'; END IF;
 SELECT * INTO prior FROM tyaga_fee.funded_order_receipts WHERE order_id=p_order AND kind=p_kind;
 IF FOUND THEN
   IF (prior.receipt,prior.original_receipt) IS DISTINCT FROM (p_receipt,p_original_receipt) THEN
     RAISE EXCEPTION 'conflicting operator receipt' USING ERRCODE='23514'; END IF;
   RETURN f;
 END IF;
 IF (f->>'buyer_due_cents')::integer<>0 THEN RAISE EXCEPTION 'additional collection unverified' USING ERRCODE='23514'; END IF;
 IF p_kind='seller_transfer' THEN
   IF f->>'pay_status'<>'captured' OR f->>'status'='cancelled' OR p_original_receipt IS NOT NULL THEN
     RAISE EXCEPTION 'capture required' USING ERRCODE='23514'; END IF;
 ELSIF f->>'seller_transfer_ref' IS NULL OR p_original_receipt IS DISTINCT FROM f->>'seller_transfer_ref' OR
       f->>'pay_status' NOT IN ('captured','refunded') THEN
    RAISE EXCEPTION 'original seller transfer required' USING ERRCODE='23514';
 END IF;
 INSERT INTO tyaga_fee.funded_order_receipts(order_id,tenant,funding_ref,basket_ref,funded_cents,kind,
  receipt,destination,amount_cents,original_receipt) VALUES(p_order,p_tenant,p_funding_ref,p_basket_ref,
  p_amount_cents,p_kind,p_receipt,p_account,p_proof_cents,p_original_receipt);
 RETURN tyaga.reconcile_test_funded_order_line(p_tenant,p_buyer,p_order,p_seller,p_funding_ref,p_basket_ref,p_amount_cents);
END $$;
REVOKE ALL ON FUNCTION tyaga_fee.funded_order_tenant(),tyaga_fee.guard_order_funding_route() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION tyaga.read_test_funded_order_line(uuid,uuid,uuid),
 tyaga.reconcile_test_funded_order_line(text,uuid,uuid,uuid,text,text,integer),
 tyaga.record_test_funded_order_transfer(text,uuid,uuid,uuid,text,text,integer,text,text,text,integer,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION tyaga.read_test_funded_order_line(uuid,uuid,uuid),
 tyaga.reconcile_test_funded_order_line(text,uuid,uuid,uuid,text,text,integer) TO service_role;
REVOKE EXECUTE ON FUNCTION tyaga.record_test_funded_order_transfer(text,uuid,uuid,uuid,text,text,integer,text,text,text,integer,text,text) FROM service_role;
GRANT USAGE ON SCHEMA tyaga TO purama_pay_test_operator;
GRANT EXECUTE ON FUNCTION tyaga.record_test_funded_order_transfer(text,uuid,uuid,uuid,text,text,integer,text,text,text,integer,text,text) TO purama_pay_test_operator;
-- The dashboard receives no operator references, other parties' orders or payment instructions.
-- Only this restricted projection is executable with the member's session.
CREATE OR REPLACE FUNCTION tyaga.my_test_funded_orders(p_orders uuid[])
RETURNS TABLE(order_id uuid,pay_status text,seller_status text,reconciliation_status text,
              funded_cents integer,buyer_due_cents integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE viewer uuid:=auth.uid(); tenant text:=tyaga_fee.funded_order_tenant(); o record; src jsonb; f jsonb;
BEGIN
 IF viewer IS NULL OR tenant IS NULL OR cardinality(p_orders)>50 THEN RETURN; END IF;
 FOR o IN SELECT m.id,m.buyer_id,m.seller_id FROM tyaga.marketplace_orders m
          WHERE m.id=ANY(p_orders) AND viewer IN (m.buyer_id,m.seller_id)
            AND m.funding_route='pay_test' LOOP
   src:=purama_pay_test.read_eur_line(tenant,o.buyer_id,o.id,o.seller_id);
   order_id:=o.id;
   IF src IS NULL THEN
     pay_status:='awaiting_funding'; seller_status:='unconfirmed'; reconciliation_status:='awaiting_funding';
     funded_cents:=NULL; buyer_due_cents:=NULL;
   ELSE
     f:=tyaga.reconcile_test_funded_order_line(tenant,o.buyer_id,o.id,o.seller_id,
       src->>'fundingRef',src->>'basketRef',(src->>'amountCents')::integer);
     pay_status:=f->>'pay_status'; seller_status:=f->>'seller_status'; reconciliation_status:=f->>'reconciliation_status';
     funded_cents:=(f->>'funded_cents')::integer; buyer_due_cents:=(f->>'buyer_due_cents')::integer;
   END IF;
   RETURN NEXT;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION tyaga.my_test_funded_orders(uuid[]) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION tyaga.my_test_funded_orders(uuid[]) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
