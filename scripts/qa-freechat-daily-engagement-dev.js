#!/usr/bin/env node

const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DEV_PROJECT_REF = "mkrsaaedxqrcrktapaus";
const envPath = path.join(__dirname, "../.env.local");
const env = {};

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (match) env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, "");
  }
}

const token = env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error("ERROR: SUPABASE_ACCESS_TOKEN is required in .env.local");
  process.exit(1);
}

if (process.argv.some((argument) => argument.includes("prod"))) {
  console.error("ERROR: this QA script only permits the Development project");
  process.exit(1);
}

const familyId = randomUUID();
const childId = randomUUID();
const sessionId = randomUUID();

const runSql = async (query) => {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${DEV_PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    }
  );
  const body = await response.text();
  if (!response.ok) throw new Error(`Dev query failed (${response.status}): ${body}`);
  return JSON.parse(body);
};

const setupSql = `
DO $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Dev QA requires one existing auth user';
  END IF;

  INSERT INTO public.families(id, name, created_by)
  VALUES ('${familyId}', 'ROLLBACK-FREECHAT-CONCURRENCY-QA', v_user_id);

  INSERT INTO public.child_profiles(id, family_id, name, grade)
  VALUES ('${childId}', '${familyId}', 'ROLLBACK-FREECHAT-CHILD', '5학년');

  INSERT INTO public.chat_sessions(id, child_id, session_type, started_at)
  VALUES ('${sessionId}', '${childId}', 'free_chat', now() - interval '2 minutes');

  INSERT INTO public.chat_messages(session_id, role, content) VALUES
    ('${sessionId}', 'child', 'I built a paper airplane today'),
    ('${sessionId}', 'child', 'It flew across the whole room'),
    ('${sessionId}', 'child', 'Tomorrow I will make a larger one');
END;
$$;
`;

const rewardSql = `
SELECT rewarded, eligible, reason, meaningful_turn_count, distinct_meaningful_turn_count
FROM public.complete_freechat_daily_engagement(
  '${childId}',
  'development',
  '${sessionId}',
  999,
  now()
);
`;

const verifySql = `
SELECT
  count(*) FILTER (WHERE reward_type = 'freechat_daily_engagement')::integer AS reward_rows,
  count(*) FILTER (WHERE reward_type = 'freechat_daily_engagement' AND business_date = (now() AT TIME ZONE 'Asia/Seoul')::date)::integer AS today_rows
FROM public.gold_key_ledger
WHERE child_id = '${childId}';
`;

const cleanupSql = `
DELETE FROM public.child_mission_event_completions WHERE child_id = '${childId}';
DELETE FROM public.child_mission_onboarding_events WHERE child_id = '${childId}';
DELETE FROM public.gold_key_ledger WHERE child_id = '${childId}';
DELETE FROM public.chat_messages WHERE session_id = '${sessionId}';
DELETE FROM public.chat_sessions WHERE child_id = '${childId}';
DELETE FROM public.child_profiles WHERE id = '${childId}';
DELETE FROM public.families WHERE id = '${familyId}';
`;

const main = async () => {
  let setupComplete = false;
  try {
    await runSql(setupSql);
    setupComplete = true;

    const concurrentResults = await Promise.allSettled([
      runSql(rewardSql),
      runSql(rewardSql),
    ]);
    const rejected = concurrentResults.filter((result) => result.status === "rejected");
    if (rejected.length > 0) throw rejected[0].reason;

    const rows = concurrentResults.flatMap((result) => (
      result.status === "fulfilled" ? result.value : []
    ));
    const rewardedCount = rows.filter((row) => row.rewarded === true).length;
    const alreadyRewardedCount = rows.filter((row) => row.reason === "already_rewarded_today").length;
    if (rewardedCount !== 1 || alreadyRewardedCount !== 1) {
      throw new Error(`Expected one reward and one idempotent response, got ${JSON.stringify(rows)}`);
    }

    const verification = await runSql(verifySql);
    if (verification[0]?.reward_rows !== 1 || verification[0]?.today_rows !== 1) {
      throw new Error(`Expected exactly one ledger row, got ${JSON.stringify(verification)}`);
    }

    console.log(JSON.stringify({
      project: "development",
      concurrentRequests: 2,
      rewardedResponses: rewardedCount,
      idempotentResponses: alreadyRewardedCount,
      ledgerRows: verification[0].reward_rows,
      status: "PASSED",
    }, null, 2));
  } finally {
    if (setupComplete) await runSql(cleanupSql);
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
