const { PGlite } = require('@electric-sql/pglite');
const fs = require('fs');
const path = require('path');

async function main() {
  console.log('Starting PGlite...');
  const db = new PGlite(); // in-memory

  console.log('Setting up auth stubs...');
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth; CREATE ROLE anon nologin; CREATE ROLE authenticated nologin; CREATE ROLE service_role nologin;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$ LANGUAGE SQL STABLE;

    CREATE OR REPLACE FUNCTION auth.role() RETURNS text AS $$
      SELECT nullif(current_setting('request.jwt.claim.role', true), '');
    $$ LANGUAGE SQL STABLE;
  `);

  console.log('Creating base schema...');
  await db.exec(`
    CREATE TABLE families (
      id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
      name text NOT NULL,
      created_by uuid,
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      deleted_at timestamp with time zone,
      purge_batch_id uuid,
      purge_initiated_by uuid
    );

    CREATE TABLE family_members (
      id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
      family_id uuid NOT NULL REFERENCES families(id),
      user_id uuid,
      role text NOT NULL,
      joined_at timestamp with time zone DEFAULT now(),
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      deleted_at timestamp with time zone
    );

    CREATE TABLE parents (
      id uuid NOT NULL PRIMARY KEY,
      email text NOT NULL DEFAULT '',
      name text NOT NULL DEFAULT '',
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      tier integer NOT NULL DEFAULT 1,
      account_status text NOT NULL DEFAULT 'ACTIVE',
      withdrawn_at timestamp with time zone,
      purge_scheduled_at timestamp with time zone,
      restore_requested_at timestamp with time zone,
      restored_at timestamp with time zone,
      restored_by uuid,
      purged_at timestamp with time zone,
      withdrawal_reason text
    );

    CREATE TABLE child_profiles (
      id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
      family_id uuid NOT NULL REFERENCES families(id),
      member_id uuid REFERENCES family_members(id),
      name text NOT NULL,
      grade text NOT NULL,
      interests text[] NOT NULL DEFAULT '{}',
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      email text,
      tier integer NOT NULL DEFAULT 1,
      live_voice_name text NOT NULL DEFAULT 'Achernar',
      guardian_consent boolean NOT NULL DEFAULT false,
      guardian_consent_at timestamp with time zone,
      guardian_consent_version text,
      guardian_consent_withdrawn_at timestamp with time zone,
      duplicate_review_child_id uuid,
      duplicate_flagged_at timestamp with time zone
    );

    CREATE TABLE admin_audit_log (
      id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
      admin_user_id uuid NOT NULL,
      admin_email text NOT NULL,
      action text NOT NULL,
      child_id uuid,
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      family_id uuid,
      target_user_id uuid,
      reason text
    );

    CREATE TABLE chat_sessions (
      id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
      child_id uuid NOT NULL,
      started_at timestamp with time zone NOT NULL DEFAULT now(),
      ended_at timestamp with time zone,
      turn_count integer NOT NULL DEFAULT 0,
      session_type text NOT NULL DEFAULT 'free',
      mission_id text,
      deleted_at timestamp with time zone
    );

    CREATE TABLE safety_events (
      id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
      session_id uuid NOT NULL,
      subcategory text NOT NULL,
      child_text text NOT NULL,
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      viewed_at timestamp with time zone,
      source text,
      child_id uuid,
      question_history_id uuid,
      event_stage text,
      policy_version text
    );

    CREATE TABLE parent_questions (
      id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
      child_id uuid NOT NULL,
      question_text text NOT NULL,
      status text NOT NULL DEFAULT '대기중',
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      delivered_count integer NOT NULL DEFAULT 0,
      last_delivered_at timestamp with time zone
    );

    CREATE TABLE k_play_sessions (
      id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
      child_id uuid NOT NULL,
      play_type text NOT NULL,
      keys_cost integer NOT NULL,
      status text NOT NULL DEFAULT 'in_progress',
      started_at timestamp with time zone NOT NULL DEFAULT now(),
      expires_at timestamp with time zone NOT NULL,
      completed_at timestamp with time zone,
      progress_state jsonb NOT NULL DEFAULT '{}',
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      updated_at timestamp with time zone NOT NULL DEFAULT now()
    );

    CREATE TABLE gold_key_ledger (
      id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
      child_id uuid NOT NULL,
      reason text NOT NULL,
      earned_at timestamp with time zone NOT NULL DEFAULT now(),
      expires_at timestamp with time zone NOT NULL,
      consumed boolean NOT NULL DEFAULT false,
      consumed_at timestamp with time zone,
      mission_id uuid,
      reward_type text,
      consumed_by_play_session_id uuid
    );

    CREATE TABLE gold_key_consumptions (
      id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
      child_id uuid NOT NULL,
      play_session_id uuid,
      idempotency_key text NOT NULL,
      requested_count integer NOT NULL,
      consumed_count integer NOT NULL DEFAULT 0,
      refunded_count integer NOT NULL DEFAULT 0,
      status text NOT NULL,
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      updated_at timestamp with time zone NOT NULL DEFAULT now()
    );

    CREATE TABLE plans (
      tier integer NOT NULL PRIMARY KEY,
      name text NOT NULL,
      price_krw integer NOT NULL,
      voice_mode text NOT NULL,
      daily_report_detail text NOT NULL,
      weekly_report_detail text NOT NULL,
      created_at timestamp with time zone NOT NULL DEFAULT now()
    );

    CREATE TABLE daily_reports (
      id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
      session_id uuid
    );
  `);

  console.log('Base schema created.');

  const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');
  const files = [
    '20260725000000_daily_reports_eight_fields.sql',
    '20260725100000_plan_retention_extension.sql',
    '20260725100000_safety_events_alpha_allowlist.sql',
    '20260725110000_admin_audit_log_action_check_restore.sql',
    '20260725200000_parent_questions_lifecycle.sql',
    '20260725300000_goldkey_reserve_confirm_restore.sql',
    '20260725310000_goldkey_reserve_restart_fix.sql',
    '20260725500000_batch_schedule_kst_adjust.sql',
    '20260725600000_account_lifecycle_notifications.sql',
    '20260725700000_parent_questions_answer_summary.sql',
    '20260726100000_account_lifecycle_outbox.sql',
    '20260726200000_insight_extension_purchases.sql',
    '20260726210000_purchase_insight_extension_auth_fix.sql',
    '20260726220000_insight_retention_extensions_rls.sql'
  ];

  let rlsProof = { beforeFile14: null, afterFile14: null };
  const results = [];

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    if (!fs.existsSync(filePath)) {
      console.error(`[FAILED] ${file}: File not found`);
      results.push({ file, success: false, error: 'File not found' });
      continue;
    }

    try {
      const sql = fs.readFileSync(filePath, 'utf8');
      await db.exec(sql);
      console.log(`[SUCCESS] ${file}`);
      results.push({ file, success: true });
    } catch (err) {
      console.error(`[FAILED] ${file}: ${err.message}`);
      results.push({ file, success: false, error: err.message });
    }

    if (file === '20260725100000_plan_retention_extension.sql') {
      try {
        const { rows } = await db.query("SELECT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='insight_extensions' AND policyname='Family members can insert insight_extensions') as exists;");
        rlsProof.beforeFile14 = rows[0].exists;
        console.log(`[RLS Check] After file 2: ${rlsProof.beforeFile14}`);
      } catch (err) {
        console.error(`[RLS Check] Failed after file 2: ${err.message}`);
      }
    }

    if (file === '20260726220000_insight_retention_extensions_rls.sql') {
      try {
        const { rows } = await db.query("SELECT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='insight_extensions' AND policyname='Family members can insert insight_extensions') as exists;");
        rlsProof.afterFile14 = rows[0].exists;
        console.log(`[RLS Check] After file 14: ${rlsProof.afterFile14}`);
      } catch (err) {
        console.error(`[RLS Check] Failed after file 14: ${err.message}`);
      }
    }
  }

  const finalOutput = { migrations: results, rlsProof };
  const scratchDir = path.join(__dirname, '..', 'scratch');
  if (!fs.existsSync(scratchDir)) {
    fs.mkdirSync(scratchDir, { recursive: true });
  }
  fs.writeFileSync(path.join(scratchDir, 'migration_test_result.json'), JSON.stringify(finalOutput, null, 2));

  console.log('Result saved to scratch/migration_test_result.json. Exiting.');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
