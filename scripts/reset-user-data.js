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

    TRUNCATE TABLE
      public.account_lifecycle_notifications,
      public.account_management_audit_log,
      public.admin_audit_log,
      public.alpha_safety_text_allowlist,
      public.answer_evidence,
      public.behavior_events,
      public.beta_applications,
      public.chat_messages,
      public.chat_sessions,
      public.child_approval_requests,
      public.child_invite_codes,
      public.child_memory,
      public.child_profiles,
      public.corrected_daily_conversations,
      public.daily_reports,
      public.evidence_card_links,
      public.families,
      public.family_join_requests,
      public.family_members,
      public.freechat_usage_state,
      public.gold_key_consumptions,
      public.gold_key_ledger,
      public.gold_key_reservations,
      public.insight_extension_purchases,
      public.insight_retention_extensions,
      public.k_play_sessions,
      public.mbti_completion_events,
      public.mbti_free_trial_coupons,
      public.member_accounts,
      public.memory_embeddings,
      public.memory_entities,
      public.memory_evidence,
      public.memory_facts,
      public.memory_history,
      public.memory_relations,
      public.mission_progress,
      public.mission_question_history,
      public.parent_invitations,
      public.parent_question_quota,
      public.parent_questions,
      public.plan_change_requests,
      public.play_bug_reports,
      public.play_execution_tickets,
      public.play_free_trial_coupons,
      public.play_internal_event_idempotency,
      public.play_refund_notifications,
      public.quiz_attempts,
      public.quiz_bug_reports,
      public.quiz_handoff_tokens,
      public.quiz_leaderboard,
      public.quiz_leaderboard_attempts,
      public.raw_daily_conversations,
      public.report_views,
      public.safety_events,
      public.support_requests,
      public.test_mode_overrides,
      public.turn_timing_events,
      public.usage_events,
      public.weekly_summaries
    RESTART IDENTITY CASCADE;

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
