#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const DEV_PROJECT_REF = "mkrsaaedxqrcrktapaus";
const PROD_PROJECT_REF = "fetvnhhjicndmxvhrffk";
const PRESERVED_ADMIN_EMAIL = "markanitp@gmail.com";

function readEnvFile() {
  const envPath = path.join(__dirname, "../.env.local");
  const values = {};
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (match) {
      values[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return values;
}

function maskEmail(email) {
  const [local = "", domain = ""] = String(email || "").split("@");
  return `${local.slice(0, 3)}***@${domain}`;
}

const args = process.argv.slice(2);
const target = args.includes("--target=prod") ? "prod" : "dev";
const expectedConfirmation =
  target === "prod" ? "RESET-PRODUCTION-USERS" : "RESET-DEV-USERS";
const confirmed = args.includes(`--confirm=${expectedConfirmation}`);
const projectRef = target === "prod" ? PROD_PROJECT_REF : DEV_PROJECT_REF;
const env = readEnvFile();
const accessToken = env.SUPABASE_ACCESS_TOKEN;
const supabaseUrl =
  target === "prod" ? env.NEXT_PUBLIC_SUPABASE_URL : env.NEXT_PUBLIC_SUPABASE_DEV_URL;
const serviceRoleKey =
  target === "prod" ? env.SUPABASE_SERVICE_ROLE_KEY : env.SUPABASE_DEV_SERVICE_ROLE_KEY;

if (!accessToken || !supabaseUrl || !serviceRoleKey) {
  console.error(`ERROR: ${target.toUpperCase()} 초기화에 필요한 환경변수가 없습니다.`);
  process.exit(1);
}
if (!supabaseUrl.includes(projectRef)) {
  console.error(`ERROR: ${target.toUpperCase()} URL과 프로젝트 ref가 일치하지 않습니다.`);
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function runSql(query) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    }
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Management API ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) : [];
}

async function listAllUsers() {
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }
  return users;
}

async function main() {
  const users = await listAllUsers();
  const admins = users.filter(
    (user) => String(user.email || "").toLowerCase() === PRESERVED_ADMIN_EMAIL
  );
  if (admins.length !== 1) {
    throw new Error(
      `보존 관리자 계정이 정확히 1개여야 합니다. 발견: ${admins.length}`
    );
  }

  const inventory = await runSql(`
    SELECT
      (SELECT count(*) FROM public.parents) AS parents,
      (SELECT count(*) FROM public.families) AS families,
      (SELECT count(*) FROM public.child_profiles) AS children,
      (SELECT count(*) FROM public.child_approval_requests) AS child_requests,
      (SELECT count(*) FROM public.chat_sessions) AS chat_sessions,
      (SELECT count(*) FROM public.daily_reports) AS daily_reports,
      (SELECT count(*) FROM public.mission_questions) AS mission_questions,
      (SELECT count(*) FROM public.quiz_question_bank) AS quiz_questions,
      (SELECT count(*) FROM public.plans) AS plans;
  `);

  console.log(
    JSON.stringify(
      {
        target,
        projectRef,
        authUsers: users.length,
        preservedAdmin: {
          id: admins[0].id,
          email: maskEmail(admins[0].email),
        },
        deleteAuthUsers: users
          .filter((user) => user.id !== admins[0].id)
          .map((user) => ({ id: user.id, email: maskEmail(user.email) })),
        database: inventory[0],
        mode: confirmed ? "execute" : "dry-run",
      },
      null,
      2
    )
  );

  if (!confirmed) {
    console.log(
      `DRY RUN: 실행하려면 --confirm=${expectedConfirmation}를 추가하세요.`
    );
    return;
  }

  await runSql(`
    BEGIN;

    DO $$
    DECLARE
      table_name TEXT;
    BEGIN
      FOREACH table_name IN ARRAY ARRAY[
        'account_lifecycle_notifications',
        'account_management_audit_log',
        'admin_audit_log',
        'alpha_safety_text_allowlist',
        'answer_evidence',
        'behavior_events',
        'beta_applications',
        'chat_messages',
        'chat_sessions',
        'child_approval_requests',
        'child_invite_codes',
        'child_memory',
        'child_profiles',
        'corrected_daily_conversations',
        'daily_reports',
        'evidence_card_links',
        'families',
        'family_join_requests',
        'family_members',
        'freechat_usage_state',
        'gold_key_consumptions',
        'gold_key_ledger',
        'gold_key_reservations',
        'insight_extension_purchases',
        'insight_retention_extensions',
        'k_play_sessions',
        'mbti_completion_events',
        'mbti_free_trial_coupons',
        'member_accounts',
        'memory_embeddings',
        'memory_entities',
        'memory_evidence',
        'memory_facts',
        'memory_history',
        'memory_relations',
        'mission_progress',
        'mission_question_history',
        'parent_invitations',
        'parent_question_quota',
        'parent_questions',
        'plan_change_requests',
        'play_bug_reports',
        'play_execution_tickets',
        'play_free_trial_coupons',
        'play_internal_event_idempotency',
        'play_refund_notifications',
        'quiz_attempts',
        'quiz_bug_reports',
        'quiz_handoff_tokens',
        'quiz_leaderboard',
        'quiz_leaderboard_attempts',
        'raw_daily_conversations',
        'report_views',
        'safety_events',
        'support_requests',
        'test_mode_overrides',
        'turn_timing_events',
        'usage_events',
        'weekly_summaries'
      ]
      LOOP
        IF to_regclass('public.' || table_name) IS NOT NULL THEN
          EXECUTE format(
            'TRUNCATE TABLE public.%I RESTART IDENTITY CASCADE',
            table_name
          );
        END IF;
      END LOOP;
    END
    $$;

    DELETE FROM public.parents
    WHERE id <> '${admins[0].id}'::uuid;

    DELETE FROM public.admin_roles
    WHERE id <> '${admins[0].id}'::uuid;

    COMMIT;
  `);

  const usersToDelete = users.filter((user) => user.id !== admins[0].id);
  for (const user of usersToDelete) {
    const { error } = await supabase.auth.admin.deleteUser(user.id);
    if (error) {
      throw new Error(`인증 계정 삭제 실패(${maskEmail(user.email)}): ${error.message}`);
    }
  }

  const remainingUsers = await listAllUsers();
  const verification = await runSql(`
    SELECT
      (SELECT count(*) FROM public.parents) AS parents,
      (SELECT count(*) FROM public.families) AS families,
      (SELECT count(*) FROM public.child_profiles) AS children,
      (SELECT count(*) FROM public.child_approval_requests) AS child_requests,
      (SELECT count(*) FROM public.chat_sessions) AS chat_sessions,
      (SELECT count(*) FROM public.daily_reports) AS daily_reports,
      (SELECT count(*) FROM public.mission_questions) AS mission_questions,
      (SELECT count(*) FROM public.quiz_question_bank) AS quiz_questions,
      (SELECT count(*) FROM public.plans) AS plans;
  `);

  if (
    remainingUsers.length !== 1 ||
    remainingUsers[0].id !== admins[0].id ||
    Number(verification[0].parents) !== 1 ||
    Number(verification[0].families) !== 0 ||
    Number(verification[0].children) !== 0 ||
    Number(verification[0].child_requests) !== 0
  ) {
    throw new Error(
      `초기화 후 검증 실패: ${JSON.stringify({
        authUsers: remainingUsers.length,
        database: verification[0],
      })}`
    );
  }

  console.log(
    JSON.stringify(
      {
        result: "success",
        target,
        preservedAdminId: admins[0].id,
        deletedAuthUsers: usersToDelete.length,
        database: verification[0],
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(`RESET FAILED: ${error.message}`);
  process.exit(1);
});
