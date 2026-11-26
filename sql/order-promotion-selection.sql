BEGIN;

-- Resolve only the calling participant's sale benefit. Status and eligibility
-- come from the existing sale projection. Redemption still uses its own RPC.
CREATE OR REPLACE FUNCTION tyaga.my_order_promotion(p_order uuid)
RETURNS TABLE(grant_id uuid, duration_hours integer, redeem_until timestamptz,
              benefit_status text, active_listing uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT g.id, p.duration_hours, p.redeem_until, p.benefit_status, l.id
  FROM tyaga.my_sale_promotions(ARRAY[p_order]) AS p
  JOIN tyaga_promotion.grants AS g
    ON g.source='tyaga_rewards' AND g.beneficiary=auth.uid()
      AND g.receipt IN ('sale:'||p.order_id||':buyer', 'sale:'||p.order_id||':seller')
  LEFT JOIN tyaga.annonces AS l
    ON p.benefit_status='active' AND l.id=g.listing_id
      AND l.user_id=auth.uid() AND l.status='published';
$$;

REVOKE ALL ON FUNCTION tyaga.my_order_promotion(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION tyaga.my_order_promotion(uuid) TO authenticated;

COMMIT;
