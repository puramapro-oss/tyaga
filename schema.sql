-- schema.sql — TYAGA (schéma dédié `tyaga`, VPS auth.purama.dev)
-- Exécuter via SSH : sshpass -p '[VPS_SSH_PASSWORD]' ssh root@72.62.191.111 psql
-- Idempotent (IF NOT EXISTS). RLS 100% tables. FK ON DELETE CASCADE partout.

CREATE SCHEMA IF NOT EXISTS tyaga;

-- ============ PROFILES ============
-- Trigger auto-create à la 1ère connexion (compte unifié écosystème)
CREATE TABLE IF NOT EXISTS tyaga.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text,
  avatar_url text,
  is_super_admin boolean NOT NULL DEFAULT false,
  google_connected boolean NOT NULL DEFAULT false,
  referral_code text,                          -- P3 : code de parrainage unique
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_referral_code
  ON tyaga.profiles(referral_code);

CREATE OR REPLACE FUNCTION tyaga.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = tyaga AS $$
BEGIN
  INSERT INTO tyaga.profiles (id, email, full_name, avatar_url, referral_code)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name',
          NEW.raw_user_meta_data->>'avatar_url',
          'TY-' || upper(substr(md5(NEW.id::text), 1, 6)))
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO tyaga.vida_wallet (user_id) VALUES (NEW.id) ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS on_auth_user_created_tyaga ON auth.users;
CREATE TRIGGER on_auth_user_created_tyaga
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION tyaga.handle_new_user();

-- ============ ITEMS ============
CREATE TABLE IF NOT EXISTS tyaga.items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES tyaga.profiles(id) ON DELETE CASCADE,
  title text,                                -- rempli après scan/validation
  category text,                             -- proposé par IA, modifiable
  brand text,
  model text,
  condition text NOT NULL DEFAULT 'bon'
    CHECK (condition IN ('neuf','excellent','tres_bon','bon','satisfaisant','a_reparer')),
  description text,
  tags text[] DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','scanned','estimated','listed','negotiating','sold','archived')),
  floor_price_cents integer,                 -- plancher vendeur (EX-F3)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_items_user ON tyaga.items(user_id);
CREATE INDEX IF NOT EXISTS idx_items_status ON tyaga.items(status);

-- ============ ITEM_PHOTOS ============
-- Preuve horodatée (BRIEF §6) : sha256 + captured_at
CREATE TABLE IF NOT EXISTS tyaga.item_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES tyaga.items(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES tyaga.profiles(id) ON DELETE CASCADE,
  storage_path text NOT NULL,                -- {user_id}/{item_id}/{angle}.jpg
  angle text NOT NULL DEFAULT 'face' CHECK (angle IN ('face','dos','defaut')),
  position integer NOT NULL DEFAULT 0,
  sha256 text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_photos_item ON tyaga.item_photos(item_id);

-- ============ ESTIMATIONS ============
-- Historique : chaque demande = nouvelle ligne (EX-C4)
CREATE TABLE IF NOT EXISTS tyaga.estimations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES tyaga.items(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES tyaga.profiles(id) ON DELETE CASCADE,
  price_suggested_cents integer NOT NULL,
  price_min_cents integer NOT NULL,
  price_max_cents integer NOT NULL,
  delay_days_min integer NOT NULL,
  delay_days_max integer NOT NULL,
  commission_pct integer NOT NULL,            -- taux au moment T (traçabilité)
  net_amount_cents integer NOT NULL,          -- calculé serveur
  confidence text NOT NULL DEFAULT 'medium' CHECK (confidence IN ('low','medium','high')),
  rationale text,
  model_used text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_estimations_item ON tyaga.estimations(item_id);

-- ============ ANNONCES ============
CREATE TABLE IF NOT EXISTS tyaga.annonces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES tyaga.items(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES tyaga.profiles(id) ON DELETE CASCADE,
  estimation_id uuid REFERENCES tyaga.estimations(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text NOT NULL,
  tags text[] DEFAULT '{}',
  price_cents integer NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','validated','published','unpublished')),
  user_validated boolean NOT NULL DEFAULT false,  -- EX-D2 : jamais published sans action user
  published_at timestamptz,
  export_text text,                          -- filet B : annonce texte prête à copier
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_annonces_status ON tyaga.annonces(status);

-- ============ MARKPLACE_ORDERS ============
-- Option C : paiement Stripe Connect, fonds séquestrés jusqu'à livraison
CREATE TABLE IF NOT EXISTS tyaga.marketplace_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  annonce_id uuid NOT NULL REFERENCES tyaga.annonces(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES tyaga.items(id) ON DELETE CASCADE,
  buyer_id uuid NOT NULL REFERENCES tyaga.profiles(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES tyaga.profiles(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  commission_pct integer NOT NULL,
  commission_amount_cents integer NOT NULL,
  net_amount_cents integer NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','paid','shipped','delivered','completed','cancelled')),
  escrow_status text NOT NULL DEFAULT 'none'
    CHECK (escrow_status IN ('none','held','released','refunded')),
  stripe_payment_intent_id text,
  stripe_transfer_id text,
  shipping_address jsonb,                    -- visible vendeur UNIQUEMENT après paid (EX-G2)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT buyer_neq_seller CHECK (buyer_id <> seller_id)  -- EX-E1
);

CREATE INDEX IF NOT EXISTS idx_orders_buyer ON tyaga.marketplace_orders(buyer_id);
CREATE INDEX IF NOT EXISTS idx_orders_seller ON tyaga.marketplace_orders(seller_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON tyaga.marketplace_orders(status);
-- Idempotence webhook (EX-E4)
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_payment_intent ON tyaga.marketplace_orders(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;

-- ============ VENTES ============
CREATE TABLE IF NOT EXISTS tyaga.ventes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES tyaga.marketplace_orders(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES tyaga.profiles(id) ON DELETE CASCADE,
  gross_amount_cents integer NOT NULL,
  commission_amount_cents integer NOT NULL,   -- EX-E2 tracé
  net_amount_cents integer NOT NULL,
  fiscal_year integer NOT NULL,               -- compteur EX-J7 (requête, pas table dédiée D14)
  completed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ventes_seller ON tyaga.ventes(seller_id);

-- ============ INBOX ============
CREATE TABLE IF NOT EXISTS tyaga.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  annonce_id uuid NOT NULL REFERENCES tyaga.annonces(id) ON DELETE CASCADE,
  buyer_id uuid NOT NULL REFERENCES tyaga.profiles(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES tyaga.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (annonce_id, buyer_id)
);

CREATE TABLE IF NOT EXISTS tyaga.inbox_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES tyaga.conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES tyaga.profiles(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  flagged_off_platform boolean NOT NULL DEFAULT false,  -- EX-F4
  flag_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conv ON tyaga.inbox_messages(conversation_id);

-- Suggestions 1-cic proposées (jamais auto-envoyées — EX-F2)
CREATE TABLE IF NOT EXISTS tyaga.inbox_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES tyaga.conversations(id) ON DELETE CASCADE,
  item_id uuid REFERENCES tyaga.items(id) ON DELETE CASCADE,
  suggestion_type text NOT NULL CHECK (suggestion_type IN ('answer','negotiate','accept','decline')),
  price_counter_cents integer,
  body text NOT NULL,
  used boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============ VIDA VAULT (SANDBOX — points, 0 virement réel V1) ============
CREATE TABLE IF NOT EXISTS tyaga.vida_wallet (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES tyaga.profiles(id) ON DELETE CASCADE,
  balance_points integer NOT NULL DEFAULT 0,   -- 1 pt = 1€ net vendeur
  total_earned_points integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tyaga.vida_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES tyaga.profiles(id) ON DELETE CASCADE,
  vente_id uuid REFERENCES tyaga.ventes(id) ON DELETE SET NULL,
  objectif_id uuid,
  pct integer NOT NULL CHECK (pct IN (0,30,50,100)),   -- EX-H2
  points_amount integer NOT NULL,
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','confirmed','cancelled')),  -- EX-H3 confirmation user
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transfers_user ON tyaga.vida_transfers(user_id);

CREATE TABLE IF NOT EXISTS tyaga.vida_objectifs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES tyaga.profiles(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('vida_subscription','soin','investissement','autre')),
  label text NOT NULL,
  target_points integer NOT NULL CHECK (target_points > 0),
  current_points integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_objectifs_user ON tyaga.vida_objectifs(user_id);

-- ============ UNIVERSNELS (P3) ============
CREATE TABLE IF NOT EXISTS tyaga.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL REFERENCES tyaga.profiles(id) ON DELETE CASCADE,
  referred_id uuid NOT NULL UNIQUE REFERENCES tyaga.profiles(id) ON DELETE CASCADE,
  code text NOT NULL,
  commission_paid boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============ updated_at trigger ============
CREATE OR REPLACE FUNCTION tyaga.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','items','annonces','marketplace_orders','conversations','vida_wallet','vida_objectifs']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS touch_%1$s ON tyaga.%1$s', t);
    EXECUTE format('CREATE TRIGGER touch_%1$s BEFORE UPDATE ON tyaga.%1$s FOR EACH ROW EXECUTE FUNCTION tyaga.touch_updated_at()', t);
  END LOOP;
END $$;

-- ============ RLS (100% tables) ============
ALTER TABLE tyaga.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tyaga.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE tyaga.item_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE tyaga.estimations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tyaga.annonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE tyaga.marketplace_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE tyaga.ventes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tyaga.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tyaga.inbox_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE tyaga.inbox_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tyaga.vida_wallet ENABLE ROW LEVEL SECURITY;
ALTER TABLE tyaga.vida_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tyaga.vida_objectifs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tyaga.referrals ENABLE ROW LEVEL SECURITY;

-- PROFILES
DROP POLICY IF EXISTS profiles_select ON tyaga.profiles;
CREATE POLICY profiles_select ON tyaga.profiles FOR SELECT USING (id = auth.uid() OR is_super_admin);
DROP POLICY IF EXISTS profiles_update ON tyaga.profiles;
CREATE POLICY profiles_update ON tyaga.profiles FOR UPDATE USING (id = auth.uid());

-- ITEMS : owner tout, published lisible authentifiés
DROP POLICY IF EXISTS items_select ON tyaga.items;
CREATE POLICY items_select ON tyaga.items FOR SELECT
  USING (user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM tyaga.annonces a WHERE a.item_id = items.id AND a.status = 'published'));
DROP POLICY IF EXISTS items_insert ON tyaga.items;
CREATE POLICY items_insert ON tyaga.items FOR INSERT WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS items_update ON tyaga.items;
CREATE POLICY items_update ON tyaga.items FOR UPDATE USING (user_id = auth.uid());
DROP POLICY IF EXISTS items_delete ON tyaga.items;
CREATE POLICY items_delete ON tyaga.items FOR DELETE USING (user_id = auth.uid());

-- ITEM_PHOTOS : owner
DROP POLICY IF EXISTS photos_select ON tyaga.item_photos;
CREATE POLICY photos_select ON tyaga.item_photos FOR SELECT
  USING (user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM tyaga.items i JOIN tyaga.annonces a ON a.item_id = i.id
               WHERE i.id = item_photos.item_id AND a.status = 'published'));
DROP POLICY IF EXISTS photos_insert ON tyaga.item_photos;
CREATE POLICY photos_insert ON tyaga.item_photos FOR INSERT WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS photos_delete ON tyaga.item_photos;
CREATE POLICY photos_delete ON tyaga.item_photos FOR DELETE USING (user_id = auth.uid());

-- ESTIMATIONS : owner
DROP POLICY IF EXISTS estimations_select ON tyaga.estimations;
CREATE POLICY estimations_select ON tyaga.estimations FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS estimations_insert ON tyaga.estimations;
CREATE POLICY estimations_insert ON tyaga.estimations FOR INSERT WITH CHECK (user_id = auth.uid());

-- ANNONCES : owner CRUD, published lisible authentifiés (EX-D3)
DROP POLICY IF EXISTS annonces_select ON tyaga.annonces;
CREATE POLICY annonces_select ON tyaga.annonces FOR SELECT
  USING (user_id = auth.uid() OR status = 'published');
DROP POLICY IF EXISTS annonces_insert ON tyaga.annonces;
CREATE POLICY annonces_insert ON tyaga.annonces FOR INSERT WITH CHECK (user_id = auth.uid() AND user_validated = true);
DROP POLICY IF EXISTS annonces_update ON tyaga.annonces;
CREATE POLICY annonces_update ON tyaga.annonces FOR UPDATE USING (user_id = auth.uid());
DROP POLICY IF EXISTS annonces_delete ON tyaga.annonces;
CREATE POLICY annonces_delete ON tyaga.annonces FOR DELETE USING (user_id = auth.uid());

-- ORDERS : buyer ou seller (EX-E3 RLS par partie)
DROP POLICY IF EXISTS orders_select ON tyaga.marketplace_orders;
CREATE POLICY orders_select ON tyaga.marketplace_orders FOR SELECT
  USING (buyer_id = auth.uid() OR seller_id = auth.uid());
DROP POLICY IF EXISTS orders_insert ON tyaga.marketplace_orders;
CREATE POLICY orders_insert ON tyaga.marketplace_orders FOR INSERT
  WITH CHECK (buyer_id = auth.uid() AND status = 'pending');
-- EX-E3 — transitions par partie uniquement (USING = état AVANT, WITH CHECK = état APRÈS) :
--   buyer  : pending→cancelled, shipped→delivered
--   seller : paid→shipped
--   system (service role, bypass RLS) : pending→paid, delivered→completed, remboursements
DROP POLICY IF EXISTS orders_update ON tyaga.marketplace_orders;
CREATE POLICY orders_update ON tyaga.marketplace_orders FOR UPDATE
  USING (
       (buyer_id = auth.uid()  AND status = 'pending')
    OR (buyer_id = auth.uid()  AND status = 'shipped')
    OR (seller_id = auth.uid() AND status = 'paid')
  )
  WITH CHECK (
       (buyer_id = auth.uid()  AND status = 'cancelled')
    OR (buyer_id = auth.uid()  AND status = 'delivered')
    OR (seller_id = auth.uid() AND status = 'shipped')
  );

-- VENTES : seller (lecteur), écritures serveur uniquement (service role bypass RLS)
DROP POLICY IF EXISTS ventes_select ON tyaga.ventes;
CREATE POLICY ventes_select ON tyaga.ventes FOR SELECT USING (seller_id = auth.uid());

-- CONVERSATIONS/MESSAGES : participants
DROP POLICY IF EXISTS convs_select ON tyaga.conversations;
CREATE POLICY convs_select ON tyaga.conversations FOR SELECT
  USING (buyer_id = auth.uid() OR seller_id = auth.uid());
DROP POLICY IF EXISTS convs_insert ON tyaga.conversations;
CREATE POLICY convs_insert ON tyaga.conversations FOR INSERT WITH CHECK (buyer_id = auth.uid());
DROP POLICY IF EXISTS msgs_select ON tyaga.inbox_messages;
CREATE POLICY msgs_select ON tyaga.inbox_messages FOR SELECT
  USING (EXISTS (SELECT 1 FROM tyaga.conversations c
                 WHERE c.id = conversation_id AND (c.buyer_id = auth.uid() OR c.seller_id = auth.uid())));
DROP POLICY IF EXISTS msgs_insert ON tyaga.inbox_messages;
CREATE POLICY msgs_insert ON tyaga.inbox_messages FOR INSERT
  WITH CHECK (sender_id = auth.uid()
    AND EXISTS (SELECT 1 FROM tyaga.conversations c
                WHERE c.id = conversation_id AND (c.buyer_id = auth.uid() OR c.seller_id = auth.uid())));

-- SUGGESTIONS : participant lecture
DROP POLICY IF EXISTS sugg_select ON tyaga.inbox_suggestions;
CREATE POLICY sugg_select ON tyaga.inbox_suggestions FOR SELECT
  USING (EXISTS (SELECT 1 FROM tyaga.conversations c
                 WHERE c.id = conversation_id AND (c.buyer_id = auth.uid() OR c.seller_id = auth.uid())));
DROP POLICY IF EXISTS sugg_update ON tyaga.inbox_suggestions;
CREATE POLICY sugg_update ON tyaga.inbox_suggestions FOR UPDATE
  USING (EXISTS (SELECT 1 FROM tyaga.conversations c
                 WHERE c.id = conversation_id AND (c.buyer_id = auth.uid() OR c.seller_id = auth.uid())));

-- VIDA : owner
DROP POLICY IF EXISTS wallet_select ON tyaga.vida_wallet;
CREATE POLICY wallet_select ON tyaga.vida_wallet FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS transfers_select ON tyaga.vida_transfers;
CREATE POLICY transfers_select ON tyaga.vida_transfers FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS transfers_insert ON tyaga.vida_transfers;
CREATE POLICY transfers_insert ON tyaga.vida_transfers FOR INSERT WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS transfers_update ON tyaga.vida_transfers;
CREATE POLICY transfers_update ON tyaga.vida_transfers FOR UPDATE USING (user_id = auth.uid());
DROP POLICY IF EXISTS objectifs_select ON tyaga.vida_objectifs;
CREATE POLICY objectifs_select ON tyaga.vida_objectifs FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS objectifs_insert ON tyaga.vida_objectifs;
CREATE POLICY objectifs_insert ON tyaga.vida_objectifs FOR INSERT WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS objectifs_update ON tyaga.vida_objectifs;
CREATE POLICY objectifs_update ON tyaga.vida_objectifs FOR UPDATE USING (user_id = auth.uid());
DROP POLICY IF EXISTS objectifs_delete ON tyaga.vida_objectifs;
CREATE POLICY objectifs_delete ON tyaga.vida_objectifs FOR DELETE USING (user_id = auth.uid());

-- REFERRALS : referrer
DROP POLICY IF EXISTS referrals_select ON tyaga.referrals;
CREATE POLICY referrals_select ON tyaga.referrals FOR SELECT USING (referrer_id = auth.uid());
DROP POLICY IF EXISTS referrals_insert ON tyaga.referrals;
CREATE POLICY referrals_insert ON tyaga.referrals FOR INSERT WITH CHECK (referrer_id = auth.uid());

-- ============ STORAGE ============
-- Bucket tyaga-photos : upload owner {user_id}/..., lecture annonces publiées
INSERT INTO storage.buckets (id, name, public)
VALUES ('tyaga-photos', 'tyaga-photos', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS tyaga_photos_insert ON storage.objects;
CREATE POLICY tyaga_photos_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'tyaga-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS tyaga_photos_select ON storage.objects;
CREATE POLICY tyaga_photos_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'tyaga-photos');

DROP POLICY IF EXISTS tyaga_photos_delete ON storage.objects;
CREATE POLICY tyaga_photos_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'tyaga-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ============ GRANTS POSTGREST (OBLIGATOIRE — sinon 42501 permission denied) ============
GRANT USAGE ON SCHEMA tyaga TO postgres,anon,authenticated,service_role;
GRANT ALL ON ALL TABLES IN SCHEMA tyaga TO postgres,anon,authenticated,service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA tyaga TO postgres,anon,authenticated,service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA tyaga TO postgres,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA tyaga GRANT ALL ON TABLES TO postgres,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA tyaga GRANT ALL ON SEQUENCES TO postgres,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA tyaga GRANT ALL ON FUNCTIONS TO postgres,anon,authenticated,service_role;

-- ============ EXPOSITION POSTGREST (VPS auth.purama.dev) ============
-- Le schéma est exposé par le GUC du rôle `authenticator` (prioritaire sur
-- PGRST_DB_SCHEMAS du .env docker) — vérifié sur TYAGA 2026-08-25 :
--   ALTER ROLE authenticator SET pgrst.db_schemas = '<liste complète + tyaga>';
-- puis : cd /opt/supabase/docker && docker compose up -d --force-recreate rest
-- Vérif : curl https://auth.purama.dev/rest/v1/profiles?select=id \
--   -H "apikey: $ANON" -H "Accept-Profile: tyaga"  → 200 []

-- ============ EX-E — MIGRATION MARKETPLACE PAIEMENT (appliquée VPS 2026-08-25) ============
-- Idempotence webhook (dédup central karma + re-dédup local par sécurité)
CREATE TABLE IF NOT EXISTS tyaga.stripe_events_processed (
  event_id text PRIMARY KEY,
  event_type text,
  processed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tyaga.stripe_events_processed ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stripe_events_all ON tyaga.stripe_events_processed;
CREATE POLICY stripe_events_all ON tyaga.stripe_events_processed
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Comptes Stripe du profil (client payment / vendeur Connect)
ALTER TABLE tyaga.profiles ADD COLUMN IF NOT EXISTS stripe_customer_id text;
ALTER TABLE tyaga.profiles ADD COLUMN IF NOT EXISTS stripe_connect_account_id text;

-- Session Checkout par commande
ALTER TABLE tyaga.marketplace_orders ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text;

-- ============ EX-H fonctions (2026-08-25) ============
-- Crédit wallet atomique, réservé au rôle service (jamais exposé au client)
CREATE OR REPLACE FUNCTION tyaga.credit_wallet(p_user uuid, p_points integer)
RETURNS void LANGUAGE plpgsql
SECURITY DEFINER SET search_path = tyaga, public AS $$
BEGIN
  IF p_points IS NULL OR p_points <= 0 THEN RETURN; END IF;
  INSERT INTO tyaga.vida_wallet (user_id, balance_points, total_earned_points)
  VALUES (p_user, p_points, p_points)
  ON CONFLICT (user_id) DO UPDATE
  SET balance_points = tyaga.vida_wallet.balance_points + p_points,
      total_earned_points = tyaga.vida_wallet.total_earned_points + p_points,
      updated_at = now();
END $$;

REVOKE ALL ON FUNCTION tyaga.credit_wallet(uuid, integer) FROM PUBLIC, anon, authenticated;

-- Confirmation explicite d'un transfert proposé : wallet → objectif, atomique.
-- SECURITY DEFINER : vida_wallet n'a AUCUNE policy UPDATE volontairement
-- (écrits service uniquement) — l'autorisation est v_tr.user_id = auth.uid(),
-- vérifiée en tête de fn avant tout débit.
CREATE OR REPLACE FUNCTION tyaga.confirm_transfer(p_transfer uuid)
RETURNS integer LANGUAGE plpgsql
SECURITY DEFINER SET search_path = tyaga, public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_tr tyaga.vida_transfers;
  v_pts integer;
BEGIN
  IF v_user IS NULL THEN RETURN 0; END IF;
  SELECT * INTO v_tr FROM tyaga.vida_transfers
   WHERE id = p_transfer AND user_id = v_user AND status = 'proposed'
   FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;
  v_pts := v_tr.points_amount;

  -- 0 % = garder sur le wallet : on enregistre juste la décision
  IF v_pts = 0 OR v_tr.objectif_id IS NULL THEN
    UPDATE tyaga.vida_transfers SET status = 'confirmed', confirmed_at = now() WHERE id = p_transfer;
    RETURN 1;
  END IF;

  UPDATE tyaga.vida_wallet
     SET balance_points = balance_points - v_pts, updated_at = now()
   WHERE user_id = v_user AND balance_points >= v_pts;
  IF NOT FOUND THEN RETURN -1; END IF;

  UPDATE tyaga.vida_objectifs
     SET current_points = current_points + v_pts, updated_at = now()
   WHERE id = v_tr.objectif_id AND user_id = v_user AND active;
  IF NOT FOUND THEN RETURN -2; END IF;

  UPDATE tyaga.vida_transfers SET status = 'confirmed', confirmed_at = now() WHERE id = p_transfer;
  RETURN 1;
END $$;

GRANT EXECUTE ON FUNCTION tyaga.confirm_transfer(uuid) TO authenticated;

-- ============ P3 UNIVERSNELS — Parrainage V4 (idempotent, cf sql/p3-universels.sql) ============
ALTER TABLE tyaga.profiles ADD COLUMN IF NOT EXISTS referral_code text;

UPDATE tyaga.profiles
SET referral_code = 'TY-' || upper(substr(md5(id::text), 1, 6))
WHERE referral_code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_referral_code
  ON tyaga.profiles(referral_code);

-- Code garanti même pour un profil préexistant sans code
CREATE OR REPLACE FUNCTION tyaga.ensure_referral_code()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = tyaga AS $$
DECLARE v_code text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  SELECT referral_code INTO v_code FROM tyaga.profiles WHERE id = auth.uid();
  IF v_code IS NOT NULL THEN RETURN v_code; END IF;
  v_code := 'TY-' || upper(substr(md5(auth.uid()::text), 1, 6));
  UPDATE tyaga.profiles SET referral_code = v_code, updated_at = now()
   WHERE id = auth.uid();
  RETURN v_code;
END $$;

REVOKE ALL ON FUNCTION tyaga.ensure_referral_code() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION tyaga.ensure_referral_code() TO authenticated;

-- Attach d'un filleul : résolution code → parrain, gardes anti-abus, insert
CREATE OR REPLACE FUNCTION tyaga.attach_referral(p_code text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = tyaga AS $$
DECLARE v_referrer uuid; v_clean text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN 'unauthenticated'; END IF;
  v_clean := upper(trim(coalesce(p_code, '')));
  IF length(v_clean) < 4 THEN RETURN 'invalid'; END IF;
  SELECT id INTO v_referrer FROM tyaga.profiles WHERE referral_code = v_clean;
  IF v_referrer IS NULL THEN RETURN 'invalid'; END IF;
  IF v_referrer = auth.uid() THEN RETURN 'self'; END IF;
  IF EXISTS (SELECT 1 FROM tyaga.referrals WHERE referred_id = auth.uid()) THEN
    RETURN 'already';
  END IF;
  BEGIN
    INSERT INTO tyaga.referrals (referrer_id, referred_id, code)
    VALUES (v_referrer, auth.uid(), v_clean);
    RETURN 'ok';
  EXCEPTION WHEN unique_violation THEN RETURN 'already';
  END;
END $$;

REVOKE ALL ON FUNCTION tyaga.attach_referral(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION tyaga.attach_referral(text) TO authenticated;
