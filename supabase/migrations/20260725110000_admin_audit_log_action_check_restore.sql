-- Migration: Restore admin_audit_log_action_check with view_safety_event_text
-- Description: Re-creates the missing CHECK constraint on admin_audit_log.action that was dropped but not re-created in 20260725100000_safety_events_alpha_allowlist.sql.

ALTER TABLE public.admin_audit_log DROP CONSTRAINT IF EXISTS admin_audit_log_action_check;

ALTER TABLE public.admin_audit_log ADD CONSTRAINT admin_audit_log_action_check
  CHECK (action IN (
    'view_conversations',
    'view_safety_events',
    'view_safety_event_text',
    'account_withdrawal_requested',
    'account_restore_requested',
    'account_restore_approved',
    'account_restore_rejected',
    'account_purged'
  ));
