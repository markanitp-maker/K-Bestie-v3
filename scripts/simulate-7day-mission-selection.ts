#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadMissionQuestionGoalCandidates,
  type MissionWeekday,
} from "../lib/mission-v3/questionBank";
import {
  selectConversationGoalDrafts,
  type ConversationGoalDraft,
} from "../lib/mission-v3/goalEngine";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env.local
const envPath = path.join(__dirname, "../.env.local");
const envVars: Record<string, string> = {};
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf8").split("\n").forEach((line) => {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (m) envVars[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  });
}

const TOKEN = envVars["SUPABASE_ACCESS_TOKEN"];
const DEV_PROJECT_REF = "mkrsaaedxqrcrktapaus";

if (!TOKEN) {
  console.error("ERROR: SUPABASE_ACCESS_TOKEN 이 .env.local 에 없습니다.");
  process.exit(1);
}

async function runDevSQL(q: string) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${DEV_PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: q }),
    }
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  return JSON.parse(text);
}

interface DayResult {
  dayName: string;
  weekday: MissionWeekday;
  dateStr: string;
  goals: ConversationGoalDraft[];
  firstQuestionFamily: string | null;
  questionIds: string[];
  semanticGroups: string[];
}

interface GradeBandReport {
  gradeBandName: string;
  grade: number;
  dailyGoal10Pass: boolean;
  repeatQuestionIdCount: number;
  repeatFirstFamilyCount: number;
  duplicateSessionSgCount: number;
  vacationSchoolExposureCount: number;
  semesterSchoolExposurePass: boolean;
  lowCooldownGoal10Pass: boolean;
  days: DayResult[];
}

const WEEKDAYS: Array<{ name: string; weekday: MissionWeekday; dayOffset: number }> = [
  { name: "Day 1 (월)", weekday: "mon", dayOffset: 0 },
  { name: "Day 2 (화)", weekday: "tue", dayOffset: 1 },
  { name: "Day 3 (수)", weekday: "wed", dayOffset: 2 },
  { name: "Day 4 (목)", weekday: "thu", dayOffset: 3 },
  { name: "Day 5 (금)", weekday: "fri", dayOffset: 4 },
  { name: "Day 6 (토)", weekday: "sat", dayOffset: 5 },
  { name: "Day 7 (일)", weekday: "sun", dayOffset: 6 },
];

async function simulateGradeBand(gradeBandName: string, grade: number): Promise<GradeBandReport> {
  const simChildId = `sim-child-${gradeBandName}-${Date.now()}`;
  const baseDate = new Date("2026-08-17T19:00:00.000Z"); // Monday

  // Fetch all active approved questions for this grade from DEV DB
  const rawQuestions = await runDevSQL(`
    SELECT
      id, question_text, applicable_grades, semantic_group, cooldown_days,
      weekday_affinity, topic, conversation_style, fun_type, memory_usable,
      sensitivity, answer_mode, periodicity, question_family, school_context_tag
    FROM public.mission_questions
    WHERE is_active = true
      AND clinical_status = 'APPROVED'
      AND ${grade} = ANY(applicable_grades)
    ORDER BY created_at ASC, id ASC;
  `);

  const usedQuestionIds7d = new Set<string>();
  const firstQuestionFamilies7d = new Set<string>();
  const pastProgressHistory: Array<{ child_id: string; session_id: string; question_ids: string[]; created_at: string }> = [];
  const pastTopicUsage: Map<string, { last_used_at: string }> = new Map();

  let dailyGoal10Pass = true;
  let repeatQuestionIdCount = 0;
  let repeatFirstFamilyCount = 0;
  let duplicateSessionSgCount = 0;

  const dayResults: DayResult[] = [];

  const createSimDb = (currentQuestions: any[], simTime: Date, temporalContexts: any[] = []) => ({
    from: (table: string) => {
      if (table === "child_temporal_context") {
        return {
          select: () => {
            let rows = [...temporalContexts];
            const query = {
              eq: (col: string, val: any) => {
                rows = rows.filter((r) => r[col] === val);
                return query;
              },
              is: (col: string, val: any) => {
                rows = rows.filter((r) => r[col] === val);
                return query;
              },
              maybeSingle: async () => ({
                data: rows[0] ?? null,
                error: null,
              }),
            };
            return query;
          },
        };
      }
      if (table === "mission_questions") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                contains: () => ({
                  order: () => ({
                    limit: async () => ({ data: currentQuestions, error: null }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "mission_progress") {
        return {
          select: () => ({
            eq: (col: string, val: any) => ({
              order: () => ({
                limit: async () => ({
                  data: pastProgressHistory
                    .filter((p) => p.child_id === val)
                    .reverse(),
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "conversation_topics") {
        return {
          select: () => ({
            eq: (col1: string, val1: any) => ({
              order: () => ({
                limit: async () => ({
                  data: (val1 === simChildId ? Array.from(pastTopicUsage.entries()) : []).map(([sg, val]) => ({
                    semantic_group: sg,
                    last_used_at: val.last_used_at,
                    last_initiated_by: "k",
                  })),
                  error: null,
                }),
              }),
              eq: (col2: string, val2: any) => ({
                maybeSingle: async () => {
                  if (val1 !== simChildId) return { data: null, error: null };
                  const sg = val2;
                  const usage = pastTopicUsage.get(sg);
                  if (!usage) return { data: null, error: null };
                  const usageExpiresAt = new Date(usage.last_used_at).getTime() + 3 * 86400000;
                  const remainingMs = usageExpiresAt - simTime.getTime();
                  const cooldownUntil = new Date(Date.now() + remainingMs).toISOString();
                  return {
                    data: {
                      cooldown_until: cooldownUntil,
                      last_initiated_by: "k",
                    },
                    error: null,
                  };
                },
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table query: ${table}`);
    },
  });

  // 1. 7-Day Simulation Loop
  for (const item of WEEKDAYS) {
    const simTime = new Date(baseDate.getTime() + item.dayOffset * 86400000);
    const simDb = createSimDb(rawQuestions, simTime, []) as any;

    const candidates = await loadMissionQuestionGoalCandidates({
      db: simDb,
      childId: simChildId,
      grade,
      weekday: item.weekday,
      now: simTime,
    });

    const drafts = selectConversationGoalDrafts({
      missionSessionId: `session-day-${item.dayOffset}`,
      childId: simChildId,
      candidates,
      parentQuestion: null,
    });

    if (drafts.length !== 10) {
      dailyGoal10Pass = false;
    }

    // Check unique semantic groups in session
    const sessionSgs = new Set<string>();
    for (const d of drafts) {
      if (sessionSgs.has(d.semanticGroup)) {
        duplicateSessionSgCount++;
      }
      sessionSgs.add(d.semanticGroup);
    }

    // Check question_id repeats in last 7 days
    const todayQids: string[] = [];
    for (const d of drafts) {
      const qid = d.questionId || (d as any).question_id || d.semanticGroup;
      if (usedQuestionIds7d.has(qid)) {
        repeatQuestionIdCount++;
      }
      todayQids.push(qid);
    }

    // Check 1st question family repeat in last 7 days
    const firstDraft = drafts[0];
    const firstCandidate = candidates.find((c) => c.questionId === firstDraft.questionId);
    const firstFam = firstCandidate?.questionFamily || null;
    if (firstFam) {
      if (firstQuestionFamilies7d.has(firstFam)) {
        repeatFirstFamilyCount++;
      }
      firstQuestionFamilies7d.add(firstFam);
    }

    // Record today's questions into progress & topic usage for future days
    todayQids.forEach((qid) => usedQuestionIds7d.add(qid));

    pastProgressHistory.push({
      child_id: simChildId,
      session_id: `session-day-${item.dayOffset}`,
      question_ids: todayQids,
      created_at: simTime.toISOString(),
    });

    // K initiates the prompt question's topic for the mission session
    if (drafts.length > 0) {
      pastTopicUsage.set(drafts[0].semanticGroup, { last_used_at: simTime.toISOString() });
    }

    dayResults.push({
      dayName: item.name,
      weekday: item.weekday,
      dateStr: simTime.toISOString().split("T")[0],
      goals: drafts,
      firstQuestionFamily: firstFam,
      questionIds: todayQids,
      semanticGroups: Array.from(sessionSgs),
    });
  }

  // 2. Vacation Fixture Check
  // In vacation fixture: school_required questions MUST be 0
  // 전체 rawQuestions를 그대로 넣고 엔진이 child_temporal_context를 읽어 자체 필터링하는지 검증
  const vacationContext = [
    {
      id: `vacation-ctx-${grade}`,
      child_id: `vacation-child-${grade}`,
      context_type: "vacation_school",
      status: "VACATION_CONFIRMED",
      expected_school_start_date: "2026-09-01",
      school_question_block_until: "2026-08-31",
      confirmation_status: null,
      last_asked_business_date: null,
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
      expired_at: null,
    },
  ];
  const vacationDb = createSimDb(rawQuestions, baseDate, vacationContext) as any;
  const vacationCandidates = await loadMissionQuestionGoalCandidates({
    db: vacationDb,
    childId: `vacation-child-${grade}`,
    grade,
    weekday: "mon",
    now: baseDate,
  });
  const vacationDrafts = selectConversationGoalDrafts({
    missionSessionId: "vacation-session",
    childId: `vacation-child-${grade}`,
    candidates: vacationCandidates,
    parentQuestion: null,
  });

  let vacationSchoolExposureCount = 0;
  for (const d of vacationDrafts) {
    const qid = d.questionId;
    const match = rawQuestions.find((q: any) => q.id === qid);
    if (match && match.school_context_tag === "school_required") {
      vacationSchoolExposureCount++;
    }
  }

  // 3. Semester Fixture Check (Normal school term Thursday)
  const semesterTime = new Date("2026-08-20T19:00:00.000Z");
  const semesterDb = createSimDb(rawQuestions, semesterTime, []) as any;
  const semesterCandidates = await loadMissionQuestionGoalCandidates({
    db: semesterDb,
    childId: `semester-child-${grade}`,
    grade,
    weekday: "thu",
    now: semesterTime,
  });
  const schoolQids = new Set(rawQuestions.filter((q: any) => q.school_context_tag === "school_required").map((q: any) => q.id));
  const semesterSchoolExposurePass = semesterCandidates.some((c) => schoolQids.has(c.questionId));

  // 4. Low Cooldown Stress Test (15+ semantic groups on cooldown)
  const stressTime = new Date("2026-08-21T19:00:00.000Z");
  const allGroups = [
    "SCHOOL_EXPERIENCE", "PEER_CONNECTION", "DAILY_LIFE", "MEAL_AND_TASTE",
    "HOBBY_AND_CREATION", "DIGITAL_CONTENT", "PHYSICAL_STATE", "EMOTION_HINT",
    "FAMILY_RELATIONSHIP", "LEARNING_AND_STUDY", "FUTURE_DREAM", "MOOD_CHECK",
    "SELF_EFFICACY", "REST_AND_RELAX", "OUTDOOR_ACTIVITY"
  ];
  const stressProgress = [
    {
      session_id: "stress-session-1",
      question_ids: rawQuestions.slice(0, 10).map((q: any) => q.id),
      created_at: new Date(stressTime.getTime() - 86400000).toISOString(),
    },
  ];
  const stressDb = {
    from: (table: string) => {
      if (table === "child_temporal_context") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                is: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "mission_questions") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                contains: () => ({
                  order: () => ({
                    limit: async () => ({ data: rawQuestions, error: null }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "mission_progress") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: async () => ({ data: stressProgress, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "conversation_topics") {
        return {
          select: () => ({
            eq: (col1: string, val1: any) => ({
              order: () => ({
                limit: async () => ({
                  data: allGroups.map((sg) => ({
                    semantic_group: sg,
                    last_used_at: new Date(stressTime.getTime() - 86400000).toISOString(),
                    last_initiated_by: "k",
                  })),
                  error: null,
                }),
              }),
              eq: (col2: string, val2: any) => ({
                maybeSingle: async () => ({
                  data: {
                    cooldown_until: new Date(stressTime.getTime() + 86400000 * 5).toISOString(),
                    last_initiated_by: "k",
                  },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  } as any;

  const stressCandidates = await loadMissionQuestionGoalCandidates({
    db: stressDb,
    childId: `stress-child-${grade}`,
    grade,
    weekday: "fri",
    now: stressTime,
  });
  const stressDrafts = selectConversationGoalDrafts({
    missionSessionId: "stress-session",
    childId: `stress-child-${grade}`,
    candidates: stressCandidates,
    parentQuestion: null,
  });
  const lowCooldownGoal10Pass = stressDrafts.length === 10;

  return {
    gradeBandName,
    grade,
    dailyGoal10Pass,
    repeatQuestionIdCount,
    repeatFirstFamilyCount,
    duplicateSessionSgCount,
    vacationSchoolExposureCount,
    semesterSchoolExposurePass,
    lowCooldownGoal10Pass,
    days: dayResults,
  };
}

async function main() {
  console.log("====================================================");
  console.log("078 7-Day Mission Selection Simulation (DEV ONLY)");
  console.log(`Target: DEV DB (${DEV_PROJECT_REF})`);
  console.log("====================================================\n");

  const gradeBands = [
    { name: "초1~2", grade: 1 },
    { name: "초3~4", grade: 3 },
    { name: "초5~6", grade: 5 },
  ];

  const reports: GradeBandReport[] = [];

  for (const gb of gradeBands) {
    console.log(`▶ Simulating ${gb.name} (Grade ${gb.grade})...`);
    const report = await simulateGradeBand(gb.name, gb.grade);
    reports.push(report);
    console.log(`  - 7일 Daily Goal = 10 : ${report.dailyGoal10Pass ? "PASS (10)" : "FAIL"}`);
    console.log(`  - 7일 question_id 중복 : ${report.repeatQuestionIdCount}건`);
    console.log(`  - 첫 질문 family 반복  : ${report.repeatFirstFamilyCount}건`);
    console.log(`  - 세션 내 semantic_group 중복 : ${report.duplicateSessionSgCount}건`);
    console.log(`  - 방학 fixture school_required 노출 : ${report.vacationSchoolExposureCount}건`);
    console.log(`  - 학기 fixture 학교 질문 노출 : ${report.semesterSchoolExposurePass ? "YES" : "NO"}`);
    console.log(`  - Cooldown 부족 상황 Goal=10 : ${report.lowCooldownGoal10Pass ? "PASS" : "FAIL"}\n`);
  }

  console.log("====================================================");
  console.log("7-DAY SIMULATION SUMMARY (7항목 × 3학년군)");
  console.log("====================================================");
  console.log("항목                                | 초1~2    | 초3~4    | 초5~6");
  console.log("------------------------------------+----------+----------+----------");
  console.log(`매일 Goal = 10                      | ${reports[0].dailyGoal10Pass ? "PASS (10)" : "FAIL"} | ${reports[1].dailyGoal10Pass ? "PASS (10)" : "FAIL"} | ${reports[2].dailyGoal10Pass ? "PASS (10)" : "FAIL"}`);
  console.log(`최근 7일 동일 question_id 반복 = 0  | ${reports[0].repeatQuestionIdCount === 0 ? "PASS (0)" : "FAIL"}  | ${reports[1].repeatQuestionIdCount === 0 ? "PASS (0)" : "FAIL"}  | ${reports[2].repeatQuestionIdCount === 0 ? "PASS (0)" : "FAIL"}`);
  console.log(`첫 질문 family 반복 = 0             | ${reports[0].repeatFirstFamilyCount === 0 ? "PASS (0)" : "FAIL"}  | ${reports[1].repeatFirstFamilyCount === 0 ? "PASS (0)" : "FAIL"}  | ${reports[2].repeatFirstFamilyCount === 0 ? "PASS (0)" : "FAIL"}`);
  console.log(`동일 session 내 SG 중복 = 0         | ${reports[0].duplicateSessionSgCount === 0 ? "PASS (0)" : "FAIL"}  | ${reports[1].duplicateSessionSgCount === 0 ? "PASS (0)" : "FAIL"}  | ${reports[2].duplicateSessionSgCount === 0 ? "PASS (0)" : "FAIL"}`);
  console.log(`방학 fixture school_required = 0    | ${reports[0].vacationSchoolExposureCount === 0 ? "PASS (0)" : "FAIL"}  | ${reports[1].vacationSchoolExposureCount === 0 ? "PASS (0)" : "FAIL"}  | ${reports[2].vacationSchoolExposureCount === 0 ? "PASS (0)" : "FAIL"}`);
  console.log(`학기 fixture 학교 질문 노출 = YES   | ${reports[0].semesterSchoolExposurePass ? "PASS (YES)" : "FAIL"} | ${reports[1].semesterSchoolExposurePass ? "PASS (YES)" : "FAIL"} | ${reports[2].semesterSchoolExposurePass ? "PASS (YES)" : "FAIL"}`);
  console.log(`cooldown 부족 상황 Goal = 10        | ${reports[0].lowCooldownGoal10Pass ? "PASS (10)" : "FAIL"} | ${reports[1].lowCooldownGoal10Pass ? "PASS (10)" : "FAIL"} | ${reports[2].lowCooldownGoal10Pass ? "PASS (10)" : "FAIL"}`);
  console.log("====================================================");

  const allPassed = reports.every(
    (r) =>
      r.dailyGoal10Pass &&
      r.repeatQuestionIdCount === 0 &&
      r.repeatFirstFamilyCount === 0 &&
      r.duplicateSessionSgCount === 0 &&
      r.vacationSchoolExposureCount === 0 &&
      r.semesterSchoolExposurePass &&
      r.lowCooldownGoal10Pass
  );

  if (allPassed) {
    console.log("🎉 ALL 7 SIMULATION CRITERIA PASSED ACROSS ALL 3 GRADE BANDS!");
  } else {
    console.error("❌ SIMULATION FAILED CRITERIA!");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Simulation execution failed:", err);
  process.exit(1);
});
