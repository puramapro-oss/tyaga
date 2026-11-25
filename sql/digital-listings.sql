-- Install after schema.sql. Existing annonces are physical offers for sale.
BEGIN;

ALTER TABLE tyaga.annonces
  ADD COLUMN IF NOT EXISTS asset_kind text NOT NULL DEFAULT 'physical',
  ADD COLUMN IF NOT EXISTS listing_intent text NOT NULL DEFAULT 'offer',
  ADD COLUMN IF NOT EXISTS listing_mode text NOT NULL DEFAULT 'sale',
  ADD COLUMN IF NOT EXISTS digital_format text,
  ADD COLUMN IF NOT EXISTS digital_license_terms text,
  ADD COLUMN IF NOT EXISTS digital_license_days integer,
  ADD COLUMN IF NOT EXISTS digital_rights_attested boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS publication_request_id uuid,
  ALTER COLUMN item_id DROP NOT NULL;

ALTER TABLE tyaga.annonces DROP CONSTRAINT IF EXISTS annonces_asset_shape;
ALTER TABLE tyaga.annonces ADD CONSTRAINT annonces_asset_shape CHECK (
  (asset_kind = 'physical' AND item_id IS NOT NULL
   AND listing_intent = 'offer' AND listing_mode = 'sale'
   AND digital_format IS NULL AND digital_license_terms IS NULL
   AND digital_license_days IS NULL AND NOT digital_rights_attested AND publication_request_id IS NULL)
  OR
  (item_id IS NULL AND estimation_id IS NULL
   AND publication_request_id IS NOT NULL AND price_cents BETWEEN 0 AND 100000000
   AND char_length(btrim(title)) BETWEEN 3 AND 70
   AND char_length(btrim(description)) BETWEEN 20 AND 1200
   AND (status <> 'published' OR (user_validated AND published_at IS NOT NULL))
   AND (
     (asset_kind = 'physical' AND listing_intent = 'wanted' AND listing_mode = 'sale'
      AND digital_format IS NULL AND digital_license_terms IS NULL
      AND digital_license_days IS NULL AND NOT digital_rights_attested)
     OR
     (asset_kind = 'digital'
      AND digital_format IS NOT NULL AND char_length(btrim(digital_format)) BETWEEN 2 AND 80
      AND digital_license_terms IS NOT NULL AND char_length(btrim(digital_license_terms)) BETWEEN 20 AND 1200
      AND ((listing_intent = 'offer' AND digital_rights_attested)
        OR (listing_intent = 'wanted' AND NOT digital_rights_attested))
      AND ((listing_mode = 'sale' AND digital_license_days IS NULL)
        OR (listing_mode = 'rental' AND digital_license_days IS NOT NULL
            AND digital_license_days BETWEEN 1 AND 3650)))))
);

CREATE UNIQUE INDEX IF NOT EXISTS annonces_member_request_unique
  ON tyaga.annonces(user_id, publication_request_id) WHERE publication_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS annonces_published_kind_intent_mode
  ON tyaga.annonces(asset_kind, listing_intent, listing_mode, published_at DESC)
  WHERE status = 'published';

-- An order must reference a physical listing even through a direct database client.
-- The composite FK also prohibits changing its kind while any order exists,
-- including cancelled orders hidden from the person editing the listing under RLS.
CREATE UNIQUE INDEX IF NOT EXISTS annonces_id_asset_intent_unique ON tyaga.annonces(id, asset_kind, listing_intent);
ALTER TABLE tyaga.marketplace_orders
  ADD COLUMN IF NOT EXISTS order_asset_kind text NOT NULL DEFAULT 'physical',
  ADD COLUMN IF NOT EXISTS order_listing_intent text NOT NULL DEFAULT 'offer';
ALTER TABLE tyaga.marketplace_orders DROP CONSTRAINT IF EXISTS orders_physical_kind;
ALTER TABLE tyaga.marketplace_orders
  ADD CONSTRAINT orders_physical_kind CHECK (order_asset_kind = 'physical' AND order_listing_intent = 'offer');
-- Keep exactly one relationship for existing PostgREST annonces(...) embeds.
ALTER TABLE tyaga.marketplace_orders DROP CONSTRAINT IF EXISTS marketplace_orders_annonce_id_fkey;
ALTER TABLE tyaga.marketplace_orders
  ADD CONSTRAINT marketplace_orders_annonce_id_fkey FOREIGN KEY (annonce_id, order_asset_kind, order_listing_intent)
    REFERENCES tyaga.annonces(id, asset_kind, listing_intent) ON DELETE RESTRICT ON UPDATE RESTRICT;

COMMIT;
