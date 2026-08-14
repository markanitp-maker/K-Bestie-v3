-- Migration: 20260815190000_behavior_events_pwa_update_feature.sql
-- Purpose: Add 'pwa_update' to behavior_events_feature_check constraint for PWA update lifecycle telemetry.
-- Note: Preserves all existing features without altering existing rows or table structure.
-- Safety: Uses NOT VALID then VALIDATE CONSTRAINT to ensure zero downtime and existing data validity.

ALTER TABLE public.behavior_events
  DROP CONSTRAINT IF EXISTS behavior_events_feature_check;

ALTER TABLE public.behavior_events
  ADD CONSTRAINT behavior_events_feature_check CHECK (feature IN (
    'auth',
    'home',
    'mission',
    'freechat',
    'play',
    'daily_report',
    'weekly_report',
    'monthly_report',
    'conversation_topic',
    'child_management',
    'guardian_settings',
    'subscription',
    'app_session',
    'relationship',
    'pwa_update'
  )) NOT VALID;

ALTER TABLE public.behavior_events
  VALIDATE CONSTRAINT behavior_events_feature_check;

GRANT ALL ON public.behavior_events TO anon, authenticated;
GRANT ALL ON public.behavior_events TO service_role;
