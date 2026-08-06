import { SupabaseClient } from "@supabase/supabase-js";
import { VacationEventType } from "./vacationEventDetector";

export type VacationContextStatus = "SEMESTER" | "VACATION_UNCONFIRMED" | "VACATION_CONFIRMED" | "SCHOOL_START_CONFIRMATION_DUE";

export interface VacationContext {
  id: string;
  child_id: string;
  context_type: string;
  status: VacationContextStatus;
  expected_school_start_date: string | null;
  school_question_block_until: string | null;
  confirmation_status: string | null;
  last_asked_business_date: string | null;
  source_session_id?: string | null;
  source_message_id?: string | null;
  created_at: string;
  updated_at: string;
  expired_at: string | null;
}

// "YYYY-MM-DD" 문자열을 Date 객체(UTC 파싱)로 변환하지 않고 달력 연산만으로 하루 전
// 날짜를 계산한다 — new Date(dateString)은 로컬 타임존에 따라 결과가 흔들릴 수 있어
// 이 프로젝트에서 business_date류 계산에는 금지된 패턴이다.
function dateStringMinusOneDay(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() - 1);
  const yy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export async function getActiveVacationContext(
  supabase: SupabaseClient,
  childId: string
): Promise<VacationContext | null> {
  const { data, error } = await supabase
    .from("child_temporal_context")
    .select("*")
    .eq("child_id", childId)
    .eq("context_type", "vacation_school")
    .is("expired_at", null)
    .maybeSingle();

  if (error) {
    console.error("getActiveVacationContext error:", error);
    return null;
  }
  return data as VacationContext | null;
}

export function resolveSchoolQuestionBlockState(
  context: VacationContext | null,
  businessDateKST: string
): {
  blocked: boolean;
  needsSchoolStartDateQuestion: boolean;
  needsSchoolStartConfirmationQuestion: boolean;
} {
  if (!context || context.status === "SEMESTER") {
    return {
      blocked: false,
      needsSchoolStartDateQuestion: false,
      needsSchoolStartConfirmationQuestion: false,
    };
  }

  if (context.status === "VACATION_UNCONFIRMED") {
    const askedToday = context.last_asked_business_date === businessDateKST;
    return {
      blocked: true,
      needsSchoolStartDateQuestion: !askedToday,
      needsSchoolStartConfirmationQuestion: false,
    };
  }

  if (context.status === "VACATION_CONFIRMED" || context.status === "SCHOOL_START_CONFIRMATION_DUE") {
    if (context.expected_school_start_date && businessDateKST >= context.expected_school_start_date) {
      const askedToday = context.last_asked_business_date === businessDateKST;
      return {
        blocked: true,
        needsSchoolStartDateQuestion: false,
        needsSchoolStartConfirmationQuestion: !askedToday,
      };
    } else {
      // 오늘 < 개학일 : 개학일 전날까지 차단
      return {
        blocked: true,
        needsSchoolStartDateQuestion: false,
        needsSchoolStartConfirmationQuestion: false,
      };
    }
  }

  return { blocked: false, needsSchoolStartDateQuestion: false, needsSchoolStartConfirmationQuestion: false };
}

export function getVacationFollowUpQuestion(grade: number): string {
  if (grade === 1) return "아, 방학이구나! 언제 학교 다시 가?";
  if (grade === 2) return "방학이라 학교를 안 가는구나. 언제 개학해?";
  if (grade === 3) return "아, 지금 방학이구나. 개학하는 날짜를 알고 있어?";
  if (grade === 4) return "방학이라 학교를 안 가는구나. 언제 개학하는지 알려주면 그때까지 학교 얘기는 안 물어볼게.";
  if (grade === 5) return "아직 방학 중이구나. 개학일을 알려주면 그전까지 학교 관련 질문은 하지 않을게.";
  return "지금은 방학이구나. 개학 날짜를 알려주면 그때까지 학교 이야기는 묻지 않을게.";
}

export function getSchoolStartConfirmationQuestion(grade: number): string {
  if (grade <= 3) return "오늘이 개학하는 날이라고 했지! 오늘 학교 갔어?";
  return "오늘이 개학하는 날이라고 했지. 이제 학교 갔어?";
}

export async function markVacationQuestionAsked(
  supabase: SupabaseClient,
  childId: string,
  businessDateKST: string
): Promise<void> {
  const current = await getActiveVacationContext(supabase, childId);
  if (!current) return;
  const { error } = await supabase
    .from("child_temporal_context")
    .update({ last_asked_business_date: businessDateKST, updated_at: new Date().toISOString() })
    .eq("id", current.id);
  if (error) console.error("markVacationQuestionAsked error:", error);
}

export async function applyVacationEvent(
  supabase: SupabaseClient,
  childId: string,
  event: {
    eventType: VacationEventType;
    schoolStartDate: string | null;
  },
  businessDateKST: string,
  sourceSessionId?: string,
  sourceMessageId?: string
): Promise<void> {
  const current = await getActiveVacationContext(supabase, childId);
  let status: VacationContextStatus = current?.status || "SEMESTER";
  let expectedStartDate = current?.expected_school_start_date || null;
  let blockUntil = current?.school_question_block_until || null;
  let lastAsked = current?.last_asked_business_date || null;

  if (event.eventType === "VACATION_DECLARED") {
    status = "VACATION_UNCONFIRMED";
    if (current?.status !== "VACATION_UNCONFIRMED") {
      lastAsked = null;
    }
  } else if (event.eventType === "SCHOOL_START_DATE_UNKNOWN") {
    status = "VACATION_UNCONFIRMED";
    lastAsked = businessDateKST;
  } else if (event.eventType === "SCHOOL_START_DATE_PROVIDED") {
    status = "VACATION_CONFIRMED";
    if (event.schoolStartDate) {
      expectedStartDate = event.schoolStartDate;
      blockUntil = dateStringMinusOneDay(event.schoolStartDate);
    }
  } else if (event.eventType === "SCHOOL_START_CONFIRMED") {
    status = "SEMESTER";
  } else if (event.eventType === "SCHOOL_START_POSTPONED") {
    if (event.schoolStartDate) {
      status = "VACATION_CONFIRMED";
      expectedStartDate = event.schoolStartDate;
      blockUntil = dateStringMinusOneDay(event.schoolStartDate);
    } else {
      status = "VACATION_UNCONFIRMED";
      lastAsked = businessDateKST;
    }
  }

  if (status === "SEMESTER" && current) {
    const { error } = await supabase
      .from("child_temporal_context")
      .update({ expired_at: new Date().toISOString() })
      .eq("id", current.id);
    if (error) console.error("applyVacationEvent expire error:", error);
    return;
  } else if (status === "SEMESTER" && !current) {
    return;
  }

  const upsertData = {
    child_id: childId,
    context_type: "vacation_school",
    status,
    expected_school_start_date: expectedStartDate,
    school_question_block_until: blockUntil,
    last_asked_business_date: lastAsked,
    source_session_id: sourceSessionId || null,
    source_message_id: sourceMessageId || null,
  };

  if (current) {
    const { error } = await supabase
      .from("child_temporal_context")
      .update({ ...upsertData, updated_at: new Date().toISOString() })
      .eq("id", current.id);
    if (error) console.error("applyVacationEvent update error:", error);
  } else {
    const { error } = await supabase
      .from("child_temporal_context")
      .insert(upsertData);
    if (error) console.error("applyVacationEvent insert error:", error);
  }
}

export async function pickNonSchoolQuestionId(
  supabase: SupabaseClient,
  candidateIds: string[],
  blocked: boolean
): Promise<string> {
  if (!blocked || candidateIds.length === 0) return candidateIds[0];
  const { data } = await supabase.from("mission_questions").select("id, school_context_tag").in("id", candidateIds);
  const tagMap = new Map((data ?? []).map((r: any) => [r.id, r.school_context_tag]));
  const nonSchool = candidateIds.find((id) => tagMap.get(id) !== "school_required");
  return nonSchool ?? candidateIds[0];
}

export async function filterSchoolRequiredQuestion(
  supabase: SupabaseClient,
  questionText: string,
  blocked: boolean,
  grade: number
): Promise<string> {
  if (!blocked || !questionText) return questionText;
  const { data: currentQ } = await supabase
    .from("mission_questions")
    .select("school_context_tag")
    .eq("question_text", questionText)
    .maybeSingle();

  if (currentQ?.school_context_tag !== "school_required") {
    return questionText;
  }

  const { data: replacements } = await supabase
    .from("mission_questions")
    .select("question_text")
    .eq("is_active", true)
    .eq("clinical_status", "APPROVED")
    .neq("school_context_tag", "school_required")
    .contains("applicable_grades", [grade])
    .limit(5);

  if (replacements && replacements.length > 0) {
    const randomPick = replacements[Math.floor(Math.random() * replacements.length)];
    return randomPick.question_text;
  }

  return questionText;
}


