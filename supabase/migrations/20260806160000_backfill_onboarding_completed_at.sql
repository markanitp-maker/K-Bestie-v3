-- Migration: 20260806160000_backfill_onboarding_completed_at.sql
-- Backfill onboarding_completed_at for all existing ACTIVE/RESTORED parents.
-- These users completed onboarding before the column was added (pre-migration).
-- We set it to their created_at date as a reasonable approximation.
-- New users will have this set precisely by autoApproveChildRequest.

UPDATE public.parents
SET onboarding_completed_at = created_at
WHERE account_status IN ('ACTIVE', 'RESTORED')
  AND onboarding_completed_at IS NULL;
