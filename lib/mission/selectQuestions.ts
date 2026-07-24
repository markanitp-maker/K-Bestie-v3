// 미션 출제 선택 알고리즘 (서버 전용 — createServiceClient 사용, RLS 우회)
//
// 입력: childId, grade(정수), roundType
// 출력: 선택된 질문 id 8개 순서 배열 (앞 5개 = 필수, 뒤 3개 = 예비)
//
// 선택 로직:
//   1. 학년 + 이번 회차(round1/round2/common)에 맞는 활성 질문 후보 필터링
//   2. 이미 물어본 온보딩(1회성) 질문 제외
//   3. 주기가 아직 안 돌아온 질문(weekly/monthly/quarterly, 마지막 출제일 기준) 제외
//   4. 상시(always) 기분체크 질문 1~2개 필수 포함
//   5. 나머지를 채워 필수5 + 예비3 = 8개 구성
//   6. 온보딩("친해지기") 질문은 우선 배치해 첫 1주간 매 미션마다 자연스럽게 소진

import { createServiceClient } from "@/lib/supabase/server";
import { getDeterministicQuestionId } from "@/lib/questions/deterministicQuestionId";
import fs from "fs";
import path from "path";

export type RoundType = "round1_day" | "round2_night" | "common";
export type CycleType = "onboarding" | "always" | "weekly" | "monthly" | "quarterly";

let metadataMapCache: Map<string, any> | null = null;
function getQuestionMetadataMap() {
  if (metadataMapCache) return metadataMapCache;
  const jsonPath = path.join(process.cwd(), "data/questions/question-bank-v2.0.json");
  let content = "";
  try {
    content = fs.readFileSync(jsonPath, "utf-8");
  } catch (e) {
    return new Map();
  }
  let data: any[] = [];
  try {
    data = JSON.parse(content);
  } catch (e) {
    console.error("[getQuestionMetadataMap] Failed to parse JSON:", e);
    return new Map();
  }

  const map = new Map<string, any>();
  if (Array.isArray(data)) {
    for (const q of data) {
      try {
        if (q && typeof q === "object" && q.group_code) {
          const id = getDeterministicQuestionId(q.group_code);
          map.set(id, {
            domain_id: q.domain_id,
            information_goal: q.information_goal,
            daily_report_field: q.daily_report_field,
            purpose: q.purpose,
          });
        }
      } catch (err) {
        console.error(`[getQuestionMetadataMap] Invalid structure for group_code: ${q?.group_code}`, err);
      }
    }
  }
  metadataMapCache = map;
  return map;
}

function isValidMissionQuestion(id: string): boolean {
  const map = getQuestionMetadataMap();
  const meta = map.get(id);
  if (!meta) return false;
  if (meta.purpose !== "state_check") return false;
  if (!meta.domain_id || !meta.information_goal || !meta.daily_report_field) return false;
  const validDomains = [
    "①학교·학원 생활", "②친구관계와 또래생활", "③감정 힌트", 
    "④관심사와 개인취향", "⑤공부 고민", "⑥디지털 관심사와 콘텐츠 취향", 
    "⑦미래·진로·꿈", "⑧반복되는 이야기"
  ];
  if (!validDomains.includes(meta.domain_id)) return false;
  return true;
}

interface QuestionRow {
  id: string;
  cycle_type: CycleType;
  dashboard_area_tag: string;
  round_type: RoundType;
  applicable_grades: number[];
}

const REQUIRED_COUNT = 5;
const RESERVE_COUNT = 3;
const TOTAL_COUNT = REQUIRED_COUNT + RESERVE_COUNT; // 8

const MIN_MOOD_CHECK = 1; // 상시 기분체크 최소 포함 개수
const MAX_MOOD_CHECK = 2;

/** 주기별 재출제 최소 간격(일). onboarding/always 는 여기서 제외(별도 처리) */
const CYCLE_INTERVAL_DAYS: Record<Exclude<CycleType, "onboarding" | "always">, number> = {
  weekly: 7,
  monthly: 30,
  quarterly: 90,
};

/** "초4", "4학년", "4" 등 학년 텍스트를 정수로 파싱 (실패 시 null) */
export function parseGrade(grade: string | number | null | undefined): number | null {
  if (typeof grade === "number") return Number.isFinite(grade) ? grade : null;
  if (!grade) return null;
  const m = String(grade).match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 미션 질문 8개(필수5+예비3)를 선별해 순서 배열로 반환한다.
 * @returns 질문 id 배열 (최대 8개, 후보 부족 시 그보다 적을 수 있음)
 */
export async function selectQuestions(
  childId: string,
  grade: number,
  roundType: RoundType
): Promise<string[]> {
  const service = createServiceClient();

  // 1. 학년 + 회차 후보 (활성 질문). round_type 은 해당 회차 또는 common 포함
  const { data: candidatesRaw, error: qErr } = await service
    .from("mission_questions")
    .select("id, cycle_type, dashboard_area_tag, round_type, applicable_grades")
    .eq("is_active", true)
    .in("round_type", [roundType, "common"]);

  if (qErr || !candidatesRaw) return [];

  const candidates = (candidatesRaw as QuestionRow[]).filter((q) =>
    Array.isArray(q.applicable_grades) && q.applicable_grades.includes(grade) && isValidMissionQuestion(q.id)
  );
  if (candidates.length === 0) return [];

  // 아이의 출제이력 로드 (question_id -> 마지막 asked_at)
  const { data: historyRaw } = await service
    .from("mission_question_history")
    .select("question_id, asked_at")
    .eq("child_id", childId);

  const lastAskedAt = new Map<string, number>();
  for (const h of (historyRaw ?? []) as { question_id: string; asked_at: string }[]) {
    const t = new Date(h.asked_at).getTime();
    const prev = lastAskedAt.get(h.question_id);
    if (prev === undefined || t > prev) lastAskedAt.set(h.question_id, t);
  }

  const now = Date.now();
  const daysSince = (ts: number) => (now - ts) / (1000 * 60 * 60 * 24);

  // 자녀별 관계 단계 확인 (완료된 이전 미션 세션이 없으면 first_meeting)
  const isFirstMeeting = lastAskedAt.size === 0;

  const { count: completedCount, error: sessionErr } = await service
    .from("chat_sessions")
    .select("id, mission_progress!inner(status)", { count: "exact", head: true })
    .eq("child_id", childId)
    .eq("session_type", "mission")
    .eq("mission_progress.status", "COMPLETED");
  if (sessionErr) {
    console.error("[selectQuestions] session check error:", sessionErr);
  }
  const hasMemoryEvidence = (completedCount && completedCount > 0) ? true : false;

  const memoryFilteredCandidates = candidates.filter((q) => {
    if (q.dashboard_area_tag === "recurring_stories") {
      if (isFirstMeeting || !hasMemoryEvidence) {
        return false;
      }
    }
    return true;
  });

  // 2/3. 주기 필터 및 과거 참조(memoryEvidence) 필터
  const eligible = memoryFilteredCandidates.filter((q) => {

    const last = lastAskedAt.get(q.id);
    if (q.cycle_type === "onboarding") {
      return last === undefined; // 이미 물어본 온보딩 제외
    }
    if (q.cycle_type === "always") {
      return true; // 상시는 항상 후보
    }
    if (last === undefined) return true; // 주기형이지만 한 번도 출제 안 됨
    return daysSince(last) >= CYCLE_INTERVAL_DAYS[q.cycle_type];
  });

  const picked: string[] = [];
  const pickedSet = new Set<string>();
  const add = (ids: string[]) => {
    for (const id of ids) {
      if (picked.length >= TOTAL_COUNT) break;
      if (!pickedSet.has(id)) {
        picked.push(id);
        pickedSet.add(id);
      }
    }
  };

  const moodChecks = shuffle(eligible.filter((q) => q.cycle_type === "always" && q.dashboard_area_tag === "emotion"));
  const onboarding = shuffle(eligible.filter((q) => q.cycle_type === "onboarding"));
  const rest = shuffle(
    eligible.filter(
      (q) => !(q.cycle_type === "always" && q.dashboard_area_tag === "emotion") && q.cycle_type !== "onboarding"
    )
  );

  // 4. 상시 기분체크 1~2개 필수 포함
  add(moodChecks.slice(0, MAX_MOOD_CHECK).map((q) => q.id));

  // 6. 온보딩 우선 소진 (기분체크 확보 후)
  add(onboarding.map((q) => q.id));

  // 5. 나머지로 채우기
  add(rest.map((q) => q.id));

  // [보정] 만약 주기 필터로 인해 picked 질문 개수가 5개(REQUIRED_COUNT) 미만인 경우,
  // 학년 조건에 해당하는 전체 후보(candidates) 중에서 아직 픽업되지 않은 질문들을
  // 가장 과거에 출제되었던 순(asked_at이 없거나 오래된 순)으로 정렬하여 5개를 충족할 때까지 강제로 채웁니다.
  if (picked.length < REQUIRED_COUNT) {
    const remainingCandidates = memoryFilteredCandidates.filter((q) => !pickedSet.has(q.id));
    const sortedRemaining = remainingCandidates.sort((a, b) => {
      const aTime = lastAskedAt.get(a.id) ?? 0;
      const bTime = lastAskedAt.get(b.id) ?? 0;
      return aTime - bTime;
    });
    add(sortedRemaining.map((q) => q.id));
  }

  // 기분체크가 하나도 없고 후보에 남아있다면(이미 add로 처리됐지만) 보정
  if (moodChecks.length >= MIN_MOOD_CHECK) {
    const hasMood = picked.some((id) => moodChecks.some((m) => m.id === id));
    if (!hasMood && picked.length > 0) {
      picked[picked.length - 1] = moodChecks[0].id;
    }
  }

  return picked.slice(0, TOTAL_COUNT);
}

export const REQUIRED_COUNT_V2 = 10;
const RESERVE_COUNT_V2 = 10;
export const TOTAL_COUNT_V2 = REQUIRED_COUNT_V2 + RESERVE_COUNT_V2; // 20
export const RESERVE_TARGET_COUNT = 10; // Fixed 선택기의 예비 문항 목표 개수

export async function getApprovedV2Candidates(
  grade: number,
  roundType: RoundType
): Promise<QuestionRow[]> {
  const service = createServiceClient();
  const { data: candidatesRaw, error: qErr } = await service
    .from("mission_questions")
    .select("id, cycle_type, dashboard_area_tag, round_type, applicable_grades")
    .eq("is_active", true)
    .eq("clinical_status", "APPROVED")
    .in("round_type", [roundType, "common"]);

  if (qErr || !candidatesRaw) return [];

  return (candidatesRaw as QuestionRow[]).filter((q) =>
    Array.isArray(q.applicable_grades) && q.applicable_grades.includes(grade) && isValidMissionQuestion(q.id)
  );
}

/**
 * 주어진 V2 후보 목록에 아이별 개인화 필터(쿨다운·최근출제 제외)를 적용해 지금 실제로 낼 수 있는 후보만 반환한다.
 * selectQuestionsV2와 countApprovedV2Candidates가 이 함수를 공유해 두 로직이 어긋나지 않도록 한다.
 */
async function filterV2EligibleCandidates(
  childId: string,
  candidates: QuestionRow[]
): Promise<{ eligible: QuestionRow[]; memoryFilteredCandidates: QuestionRow[]; lastAskedAt: Map<string, number> }> {
  const service = createServiceClient();
  const { data: historyRaw } = await service
    .from("mission_question_history")
    .select("question_id, asked_at")
    .eq("child_id", childId);

  const lastAskedAt = new Map<string, number>();
  for (const h of (historyRaw ?? []) as { question_id: string; asked_at: string | null }[]) {
    if (!h.asked_at) continue;
    const t = new Date(h.asked_at).getTime();
    const prev = lastAskedAt.get(h.question_id);
    if (prev === undefined || t > prev) lastAskedAt.set(h.question_id, t);
  }

  const now = Date.now();
  const daysSince = (ts: number) => (now - ts) / (1000 * 60 * 60 * 24);

  // 자녀별 관계 단계 확인 (완료된 이전 미션 세션이 없으면 first_meeting)
  const isFirstMeeting = lastAskedAt.size === 0;

  const { count: completedCount, error: sessionErr } = await service
    .from("chat_sessions")
    .select("id, mission_progress!inner(status)", { count: "exact", head: true })
    .eq("child_id", childId)
    .eq("session_type", "mission")
    .eq("mission_progress.status", "COMPLETED");
  if (sessionErr) {
    console.error("[filterV2EligibleCandidates] session check error:", sessionErr);
  }
  const hasMemoryEvidence = (completedCount && completedCount > 0) ? true : false;

  const memoryFilteredCandidates = candidates.filter((q) => {
    if (q.dashboard_area_tag === "recurring_stories") {
      if (isFirstMeeting || !hasMemoryEvidence) {
        return false;
      }
    }
    return true;
  });

  const eligible = memoryFilteredCandidates.filter((q) => {

    const last = lastAskedAt.get(q.id);
    if (q.cycle_type === "onboarding") {
      return last === undefined;
    }
    if (q.cycle_type === "always") {
      return true;
    }
    if (last === undefined) return true;
    return daysSince(last) >= CYCLE_INTERVAL_DAYS[q.cycle_type];
  });

  return { eligible, memoryFilteredCandidates, lastAskedAt };
}

/**
 * V2 시작 전 폴백 판정용 — 승인+활성 원시 후보가 아니라, 이 아이에게 쿨다운·최근출제 개인화 필터까지 적용한 후
 * "지금 실제로 낼 수 있는" 후보 개수를 반환한다. PRIMARY 10개+RESERVE 10개(REQUIRED_COUNT_V2/TOTAL_COUNT_V2)
 * 충족 여부는 호출부(app/api/mission/start/route.ts)에서 이 값을 기준으로 판단한다.
 */
export async function countApprovedV2Candidates(
  childId: string,
  grade: number,
  roundType: RoundType
): Promise<number> {
  const candidates = await getApprovedV2Candidates(grade, roundType);
  if (candidates.length === 0) return 0;
  const { eligible } = await filterV2EligibleCandidates(childId, candidates);
  return eligible.length;
}

/**
 * V2 용 미션 질문 20개(기본10+예비10)를 선별해 순서 배열로 반환한다.
 * clinical_status = 'APPROVED' 이고 is_active = true 인 문항만 선택한다.
 */
export async function selectQuestionsV2(
  childId: string,
  grade: number,
  roundType: RoundType
): Promise<string[]> {
  const service = createServiceClient();

  const candidates = await getApprovedV2Candidates(grade, roundType);
  if (candidates.length === 0) return [];

  const { eligible, memoryFilteredCandidates, lastAskedAt } = await filterV2EligibleCandidates(childId, candidates);


  const picked: string[] = [];
  const pickedSet = new Set<string>();
  const add = (ids: string[]) => {
    for (const id of ids) {
      if (picked.length >= TOTAL_COUNT_V2) break;
      if (!pickedSet.has(id)) {
        picked.push(id);
        pickedSet.add(id);
      }
    }
  };

  const moodChecks = shuffle(eligible.filter((q) => q.cycle_type === "always" && q.dashboard_area_tag === "emotion"));
  const onboarding = shuffle(eligible.filter((q) => q.cycle_type === "onboarding"));
  const rest = shuffle(
    eligible.filter(
      (q) => !(q.cycle_type === "always" && q.dashboard_area_tag === "emotion") && q.cycle_type !== "onboarding"
    )
  );

  // 4. 상시 기분체크 1~2개 필수 포함
  add(moodChecks.slice(0, MAX_MOOD_CHECK).map((q) => q.id));

  // 6. 온보딩 우선 소진 (기분체크 확보 후)
  add(onboarding.map((q) => q.id));

  // 5. 나머지로 채우기
  add(rest.map((q) => q.id));

  // [보정] 만약 주기 필터로 인해 picked 질문 개수가 10개(REQUIRED_COUNT_V2) 미만인 경우,
  // 학년 조건에 해당하는 전체 후보(candidates) 중에서 아직 픽업되지 않은 질문들을
  // 가장 과거에 출제되었던 순(asked_at이 없거나 오래된 순)으로 정렬하여 10개를 충족할 때까지 강제로 채웁니다.
  if (picked.length < REQUIRED_COUNT_V2) {
    const remainingCandidates = memoryFilteredCandidates.filter((q) => !pickedSet.has(q.id));
    const sortedRemaining = remainingCandidates.sort((a, b) => {
      const aTime = lastAskedAt.get(a.id) ?? 0;
      const bTime = lastAskedAt.get(b.id) ?? 0;
      return aTime - bTime;
    });
    add(sortedRemaining.map((q) => q.id));
  }

  // 예비 질문까지 포함하여 총 20개(TOTAL_COUNT_V2)를 다 채우지 못한 경우,
  // 후보군에 남아있는 것들 중 오래된 순서대로 끝까지 채웁니다.
  if (picked.length < TOTAL_COUNT_V2) {
    const remainingCandidates = memoryFilteredCandidates.filter((q) => !pickedSet.has(q.id));
    const sortedRemaining = remainingCandidates.sort((a, b) => {
      const aTime = lastAskedAt.get(a.id) ?? 0;
      const bTime = lastAskedAt.get(b.id) ?? 0;
      return aTime - bTime;
    });
    add(sortedRemaining.map((q) => q.id));
  }

  // 기분체크가 하나도 없고 후보에 남아있다면 보정
  if (moodChecks.length >= MIN_MOOD_CHECK) {
    const hasMood = picked.some((id) => moodChecks.some((m) => m.id === id));
    if (!hasMood && picked.length > 0) {
      picked[picked.length - 1] = moodChecks[0].id;
    }
  }

  return picked.slice(0, TOTAL_COUNT_V2);
}

export async function getAlphaApprovedCandidates(
  grade: number,
  roundType: RoundType
): Promise<QuestionRow[]> {
  const service = createServiceClient();
  
  // Manifest 파일 경로
  const manifestPath = path.join(process.cwd(), "data/questions/alpha-approved-manifest.json");
  let approvedGroupCodes: string[] = [];
  try {
    const fileContent = fs.readFileSync(manifestPath, "utf-8");
    const manifest = JSON.parse(fileContent);
    approvedGroupCodes = manifest.approved_group_codes || [];
  } catch (error) {
    console.error("[getAlphaApprovedCandidates] Failed to read manifest:", error);
    return [];
  }

  if (approvedGroupCodes.length === 0) return [];

  // 매니페스트에 있는 group_code들을 결정론적 UUID로 변환
  const targetIds = approvedGroupCodes.map((code) => getDeterministicQuestionId(code));

  // clinical_status, is_active 무관하게 id 목록만으로 조회, 단 round_type 제한은 그대로
  const { data: candidatesRaw, error: qErr } = await service
    .from("mission_questions")
    .select("id, cycle_type, dashboard_area_tag, round_type, applicable_grades")
    .in("id", targetIds)
    .in("round_type", [roundType, "common"]);

  if (qErr || !candidatesRaw) return [];

  return (candidatesRaw as QuestionRow[]).filter((q) =>
    Array.isArray(q.applicable_grades) && q.applicable_grades.includes(grade) && isValidMissionQuestion(q.id)
  );
}

/**
 * V2와 동일한 로직으로 Alpha 허용 대상자용 질문을 선택합니다.
 */
export async function selectAlphaQuestions(
  childId: string,
  grade: number,
  roundType: RoundType
): Promise<string[]> {
  const service = createServiceClient();

  const candidates = await getAlphaApprovedCandidates(grade, roundType);
  if (candidates.length === 0) return [];

  const { eligible, memoryFilteredCandidates, lastAskedAt } = await filterV2EligibleCandidates(childId, candidates);

  const picked: string[] = [];
  const pickedSet = new Set<string>();
  const add = (ids: string[]) => {
    for (const id of ids) {
      if (picked.length >= TOTAL_COUNT_V2) break;
      if (!pickedSet.has(id)) {
        picked.push(id);
        pickedSet.add(id);
      }
    }
  };

  const moodChecks = shuffle(eligible.filter((q) => q.cycle_type === "always" && q.dashboard_area_tag === "emotion"));
  const onboarding = shuffle(eligible.filter((q) => q.cycle_type === "onboarding"));
  const rest = shuffle(
    eligible.filter(
      (q) => !(q.cycle_type === "always" && q.dashboard_area_tag === "emotion") && q.cycle_type !== "onboarding"
    )
  );

  // 4. 상시 기분체크 1~2개 필수 포함
  add(moodChecks.slice(0, MAX_MOOD_CHECK).map((q) => q.id));

  // 6. 온보딩 우선 소진 (기분체크 확보 후)
  add(onboarding.map((q) => q.id));

  // 5. 나머지로 채우기
  add(rest.map((q) => q.id));

  // [보정] 만약 주기 필터로 인해 picked 질문 개수가 10개(REQUIRED_COUNT_V2) 미만인 경우,
  // 학년 조건에 해당하는 전체 후보(candidates) 중에서 아직 픽업되지 않은 질문들을
  // 가장 과거에 출제되었던 순(asked_at이 없거나 오래된 순)으로 정렬하여 10개를 충족할 때까지 강제로 채웁니다.
  if (picked.length < REQUIRED_COUNT_V2) {
    const remainingCandidates = memoryFilteredCandidates.filter((q) => !pickedSet.has(q.id));
    const sortedRemaining = remainingCandidates.sort((a, b) => {
      const aTime = lastAskedAt.get(a.id) ?? 0;
      const bTime = lastAskedAt.get(b.id) ?? 0;
      return aTime - bTime;
    });
    add(sortedRemaining.map((q) => q.id));
  }

  // 예비 질문까지 포함하여 총 20개(TOTAL_COUNT_V2)를 다 채우지 못한 경우,
  // 후보군에 남아있는 것들 중 오래된 순서대로 끝까지 채웁니다.
  if (picked.length < TOTAL_COUNT_V2) {
    const remainingCandidates = memoryFilteredCandidates.filter((q) => !pickedSet.has(q.id));
    const sortedRemaining = remainingCandidates.sort((a, b) => {
      const aTime = lastAskedAt.get(a.id) ?? 0;
      const bTime = lastAskedAt.get(b.id) ?? 0;
      return aTime - bTime;
    });
    add(sortedRemaining.map((q) => q.id));
  }

  // 기분체크가 하나도 없고 후보에 남아있다면 보정
  if (moodChecks.length >= MIN_MOOD_CHECK) {
    const hasMood = picked.some((id) => moodChecks.some((m) => m.id === id));
    if (!hasMood && picked.length > 0) {
      picked[picked.length - 1] = moodChecks[0].id;
    }
  }

  return picked.slice(0, TOTAL_COUNT_V2);
}

/**
 * 10개의 고정된 질문 구조(인사 1 + 8영역 + 일상 1)를 뽑아 배열로 반환한다.
 */
export async function selectFixedMissionQuestions(
  childId: string,
  grade: number,
  roundType: RoundType
): Promise<string[]> {
  const service = createServiceClient();
  const { data: allActiveRaw, error: qErr } = await service
    .from("mission_questions")
    .select("id, cycle_type, dashboard_area_tag, round_type, applicable_grades")
    .eq("is_active", true);

  if (qErr || !allActiveRaw) return [];
  const allActive = allActiveRaw as QuestionRow[];

  // 1차 후보: 학년 + 라운드 일치
  const candidates = allActive.filter((q) =>
    Array.isArray(q.applicable_grades) && q.applicable_grades.includes(grade) &&
    (q.round_type === roundType || q.round_type === "common")
  );

  // 2차 후보: 학년 일치 (라운드 무관)
  const candidatesRelaxRound = allActive.filter((q) =>
    Array.isArray(q.applicable_grades) && q.applicable_grades.includes(grade)
  );

  // 아이의 출제이력 로드 (question_id -> 마지막 asked_at) - 쿨다운 적용을 위해
  const { data: historyRaw } = await service
    .from("mission_question_history")
    .select("question_id, asked_at")
    .eq("child_id", childId);

  const lastAskedAt = new Map<string, number>();
  for (const h of (historyRaw ?? []) as { question_id: string; asked_at: string | null }[]) {
    if (!h.asked_at) continue;
    const t = new Date(h.asked_at).getTime();
    const prev = lastAskedAt.get(h.question_id);
    if (prev === undefined || t > prev) lastAskedAt.set(h.question_id, t);
  }

  const now = Date.now();
  const daysSince = (ts: number) => (now - ts) / (1000 * 60 * 60 * 24);

  // 쿨다운(주기) 필터 적용된 1차 후보
  const eligible = candidates.filter((q) => {
    const last = lastAskedAt.get(q.id);
    if (q.cycle_type === "onboarding") {
      return last === undefined;
    }
    if (q.cycle_type === "always") {
      return true;
    }
    if (last === undefined) return true;
    return daysSince(last) >= CYCLE_INTERVAL_DAYS[q.cycle_type];
  });

  const getSlotIdExcluding = (tag: string, exclude: Set<string>): string | undefined => {
    const filterEx = (arr: typeof allActive) => arr.filter((q) => !exclude.has(q.id));

    let available = filterEx(eligible.filter((q) => q.dashboard_area_tag === tag));
    if (available.length > 0) return shuffle(available)[0].id;

    available = filterEx(candidates.filter((q) => q.dashboard_area_tag === tag));
    if (available.length > 0) {
      const notRecentlyAsked = available.filter((q) => !lastAskedAt.has(q.id));
      if (notRecentlyAsked.length > 0) return shuffle(notRecentlyAsked)[0].id;
      return shuffle(available)[0].id;
    }

    available = filterEx(candidatesRelaxRound.filter((q) => q.dashboard_area_tag === tag));
    if (available.length > 0) {
      const notRecentlyAsked = available.filter((q) => !lastAskedAt.has(q.id));
      if (notRecentlyAsked.length > 0) return shuffle(notRecentlyAsked)[0].id;
      return shuffle(available)[0].id;
    }

    available = filterEx(allActive.filter((q) => q.dashboard_area_tag === tag));
    if (available.length > 0) {
      const notRecentlyAsked = available.filter((q) => !lastAskedAt.has(q.id));
      if (notRecentlyAsked.length > 0) return shuffle(notRecentlyAsked)[0].id;
      return shuffle(available)[0].id;
    }

    return undefined;
  };

  const getSlotId = (tag: string): string => {
    const id = getSlotIdExcluding(tag, new Set());
    if (id === undefined) {
      throw new Error(`[selectFixedMissionQuestions] No candidate found for tag: ${tag}`);
    }
    return id;
  };

  const picked: string[] = [];
  const tagsConfig = [
    "greeting",
    "school_life",
    "peer_relations",
    "emotion",
    "interests",
    "study_concerns",
    "digital_interests",
    "future_dreams",
    "recurring_stories",
    "daily_general",
  ];

  for (const tag of tagsConfig) {
    picked.push(getSlotId(tag));
  }
  
  // RESERVE: PRIMARY 10개를 제외하고 태그당 1개씩 예비 후보를 추가로 찾는다.
  const pickedSet = new Set(picked);
  const reserves: string[] = [];

  for (const tag of tagsConfig) {
    if (reserves.length >= RESERVE_TARGET_COUNT) break;
    const id = getSlotIdExcluding(tag, pickedSet);
    if (id !== undefined) {
      reserves.push(id);
      pickedSet.add(id);
    }
  }

  // 태그당 1개씩으로 목표(10개)를 못 채웠으면, 태그 구분 없이 남은 전체 후보 중에서 더 채운다.
  if (reserves.length < RESERVE_TARGET_COUNT) {
    const remainingPool = allActive.filter((q) => !pickedSet.has(q.id) &&
      Array.isArray(q.applicable_grades) && q.applicable_grades.includes(grade));
    const notRecentlyAsked = shuffle(remainingPool.filter((q) => !lastAskedAt.has(q.id)));
    const rest = shuffle(remainingPool.filter((q) => lastAskedAt.has(q.id)));
    for (const q of [...notRecentlyAsked, ...rest]) {
      if (reserves.length >= RESERVE_TARGET_COUNT) break;
      if (!pickedSet.has(q.id)) {
        reserves.push(q.id);
        pickedSet.add(q.id);
      }
    }
  }

  return [...picked, ...reserves];
}

/** 미션 진행 중 RESERVE 문항이 소진됐을 때 추가로 후보를 찾는다 */
export async function selectAdditionalReserveQuestions(
  childId: string,
  grade: number,
  roundType: RoundType,
  excludeIds: string[],
  count: number = 1
): Promise<string[]> {
  const service = createServiceClient();
  const { data: allActiveRaw, error: qErr } = await service
    .from("mission_questions")
    .select("id, cycle_type, dashboard_area_tag, round_type, applicable_grades")
    .eq("is_active", true);
  if (qErr || !allActiveRaw) return [];
  const allActive = allActiveRaw as QuestionRow[];
  const exclude = new Set(excludeIds);

  const { data: historyRaw } = await service
    .from("mission_question_history")
    .select("question_id, asked_at")
    .eq("child_id", childId);
  const lastAskedAt = new Map<string, number>();
  for (const h of (historyRaw ?? []) as { question_id: string; asked_at: string | null }[]) {
    if (!h.asked_at) continue;
    const t = new Date(h.asked_at).getTime();
    const prev = lastAskedAt.get(h.question_id);
    if (prev === undefined || t > prev) lastAskedAt.set(h.question_id, t);
  }

  const remainingPool = allActive.filter((q) => !exclude.has(q.id) &&
    Array.isArray(q.applicable_grades) && q.applicable_grades.includes(grade));
  const notRecentlyAsked = shuffle(remainingPool.filter((q) => !lastAskedAt.has(q.id)));
  const rest = shuffle(remainingPool.filter((q) => lastAskedAt.has(q.id)));

  const picked: string[] = [];
  for (const q of [...notRecentlyAsked, ...rest]) {
    if (picked.length >= count) break;
    picked.push(q.id);
  }
  return picked;
}
