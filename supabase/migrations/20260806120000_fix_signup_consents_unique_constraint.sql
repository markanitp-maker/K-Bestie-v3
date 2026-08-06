-- Fix PostgreSQL ON CONFLICT specification matching for signup_consents table
-- Migration: 20260806120000_fix_signup_consents_unique_constraint.sql

-- 1) Create full non-partial unique index on (user_id, consent_type, document_version)
--    so that PostgREST .upsert(rows, { onConflict: "user_id,consent_type,document_version" })
--    matches the ON CONFLICT target without SQLSTATE 42P10 error.
CREATE UNIQUE INDEX IF NOT EXISTS signup_consents_user_type_doc_unique
  ON signup_consents (user_id, consent_type, document_version);

-- 2) Update handle_new_user SECURITY DEFINER function to specify search_path
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.parents (id, email, name)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'name', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
