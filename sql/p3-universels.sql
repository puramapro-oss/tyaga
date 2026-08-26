-- ============ P3 UNIVERSNELS — Parrainage V4 (delta idempotent) ============
-- Poussé sur VPS après édition de schema.sql (source de vérité).

-- 1) Colonne code de parrainage sur profiles + backfill déterministe
ALTER TABLE tyaga.profiles ADD COLUMN IF NOT EXISTS referral_code text;

UPDATE tyaga.profiles
SET referral_code = 'TY-' || upper(substr(md5(id::text), 1, 6))
WHERE referral_code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_referral_code
  ON tyaga.profiles(referral_code);

-- 2) Nouveaux profils : code généré au trigger d'inscription
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
END $$;

-- 3) Code garanti même pour un profil préexistant sans code (belt & braces)
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

-- 4) Attach d'un filleul : résolution code → parrain, gardes anti-abus, insert
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
