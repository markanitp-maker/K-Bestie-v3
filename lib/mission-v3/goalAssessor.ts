import { extractJSON } from "@/app/api/_lib/utils";
import { classifyGenerationFailure, type GenerateContentFn } from "@/lib/k-conversation/responseGenerator";
import type { MissionPromptGoal } from "@/lib/mission-v3/missionAdapter";
import type { GoalAssessment } from "@/lib/mission-v3/goalEngine";

export interface AssessGoalsInput {
  ai: { models: { generateContent: GenerateContentFn } };
  modelId: string;
  currentUtterance: string;
  recentHistory?: Array<{ role: "child" | "k"; text: string }>;
  goals: MissionPromptGoal[];
  /** 학년이 낮을수록 짧은 답변을 더 적극적으로 인정하기 위한 참고값(079).
   *  없으면 학년 문구 없이 기존과 동일하게 동작한다. */
  gradeRaw?: string | number | null;

  /**
   * 직전 턴에 K가 실제로 물어본 Goal(= mission_turns.previous_prompted_goal_id).
   *
   * 판정 지침에는 원래부터 "직전에 K가 물어본 Goal을 먼저 평가해라" 가 있었지만, 그게
   * 어느 Goal인지는 넘겨주지 않아 모델이 대화 맥락에서 짐작해야 했다. 그 결과 아이가
   * K의 질문에 제대로 답해도 다른 Goal이 평가되거나 아무것도 평가되지 않는 턴이 생겼다
   * (2026-08-14~19 Production 실측: 판정 배열이 빈 턴 68/386, 그중 67턴이 이 값 없음).
   * 여기서 goalId 를 명시해 "아이가 답한 대상"을 모델이 추측하지 않게 한다.
   */
  previousPromptedGoalId?: string | null;
}

const VALID_STATUSES: ReadonlySet<GoalAssessment["status"]> = new Set([
  "SATISFIED",
  "PARTIAL",
  "DECLINED",
  "SKIPPED",
]);

// 019 §3-4 — Goal 판정도 아이가 기다리는 실시간 턴 위에 있다.
//
// 이 판정과 responseGenerator 는 같은 요청 안에서 순차로 돌기 때문에, 둘 다 [0,3000,5000] 을
// 쓰면 Vertex 가 연속 실패할 때 지연만 16초가 쌓인다. 2026-08-19 Production 429 사고에서
// 실제로 그렇게 12.8~26.8초가 나왔다. 배치가 아니라 대화이므로 예산을 짧게 잡는다.
// 판정이 실패해도 빈 배열이 반환되어 Goal 은 열린 채로 남고 다음 턴에 다시 평가된다 —
// 오래 기다리는 쪽이 훨씬 나쁘다.
const RETRY_DELAYS_MS = [0, 600, 1200] as const;
/** 지연 + 호출을 합친 총 예산. 남은 예산이 부족하면 더 시도하지 않는다. */
export const TOTAL_RETRY_BUDGET_MS = 4000;
const MIN_ATTEMPT_BUDGET_MS = 1200;
/** 한 번의 호출이 이 시간을 넘으면 실패로 본다. SDK 가 응답 없이 매달리는 경우 대비. */
const ATTEMPT_TIMEOUT_MS = 3500;

const sleep = (delayMs: number): Promise<void> =>
  delayMs > 0
    ? new Promise((resolve) => setTimeout(resolve, delayMs))
    : Promise.resolve();

const buildAssessmentInstruction = (input: AssessGoalsInput): string => {
  const goals = input.goals
    .map((goal) => [
      `- goalId: ${goal.goalId}`,
      `  semanticGroup: ${goal.semanticGroup}`,
      `  promptInstruction: ${goal.promptInstruction.trim()}`,
    ].join("\n"))
    .join("\n");
  const recentHistory = (input.recentHistory ?? [])
    .filter((turn) => turn.text.trim())
    .map((turn) => `${turn.role === "child" ? "아이" : "K"}: ${turn.text.trim()}`)
    .join("\n");
  // 값이 없으면 빈 줄만 남아 기존 프롬프트와 실질적으로 동일하다(079 하위 호환).
  const gradeGuidance = input.gradeRaw == null || `${input.gradeRaw}`.trim() === ""
    ? ""
    : `[아이 학년] ${`${input.gradeRaw}`.trim()}`;

  // 직전에 K가 물어본 Goal. 이번 턴 판정 대상에 남아 있을 때만 표시한다 —
  // 이미 종료된 Goal 을 가리키면 모델이 없는 선택지를 고르려 한다.
  const askedGoal = input.previousPromptedGoalId
    ? input.goals.find((goal) => goal.goalId === input.previousPromptedGoalId)
    : undefined;
  const askedGuidance = askedGoal
    ? `[직전에 K가 물어본 Goal]\ngoalId: ${askedGoal.goalId}\n아이의 이번 발화가 이 질문에 대한 답이면 이 Goal을 반드시 판정 결과에 포함해라.`
    : "";

  return [
    "너는 아이의 현재 발화가 비공개 대화 Goal을 얼마나 충족했는지만 판정한다.",
    "아이에게 보낼 답변, 질문, 조언 등 자연어 대화 문장은 절대로 생성하지 마.",
    "각 Goal의 goalId는 내부 참조용이며 아이에게 노출하지 않는다. promptInstruction은 판정 기준일 뿐, 이를 답변 문장으로 만들지 마.",
    // 079: Production 290턴 감사에서 18건(6.2%)이 질문에 명백히 답했는데 SATISFIED가
    // 되지 않았다. 원인은 별 UI가 아니라 이 판정 기준이었다 — "구체적인 정보"를 요구해
    // 초등학생의 정상적인 단답("던지는 거", "만화책")을 PARTIAL로 떨어뜨렸다.
    // 기준을 "얼마나 자세히 말했는가"에서 "질문이 요구한 핵심 정보를 줬는가"로 바꾼다.
    "SATISFIED: 아이가 그 질문이 요구한 핵심 정보를 직접 제공한 경우.",
    "초등학생의 답변은 짧고 단순할 수 있다. 답변 길이나 문장 완성도를 SATISFIED의 조건으로 쓰지 마라.",
    "한 단어나 짧은 구라도 질문의 핵심을 직접 답했다면 SATISFIED로 판정해라.",
    "더 자세히 이야기할 여지가 있다는 이유만으로 PARTIAL을 주지 마라.",
    "PARTIAL: 질문이 요구한 핵심 정보가 실제로 아직 빠진 경우에만 쓴다.",
    "질문이 두 가지 이상을 함께 물었다면(예: \"누구랑 뭐 했어?\"), 그중 하나만 답한 경우는 PARTIAL이다.",
    "아이가 질문의 잘못된 전제를 현실 정보로 정정하면(예: 학교 질문에 \"지금 방학이야\"), 그 질문을 다시 묻지 않도록 해결된 답변으로 취급해라.",
    "직전에 K가 물어본 Goal을 먼저 평가해라.",
    "학년이 낮을수록 짧은 답변을 정상적인 의사표현으로 더 적극적으로 인정해라.",
    "",
    "[판정 예시]",
    "SATISFIED: \"무슨 게임 했어?\"→\"로블록스\" / \"누구랑 놀았어?\"→\"민준이랑\" / \"뭐 먹었어?\"→\"떡볶이\"",
    "SATISFIED: \"기분 어땠어?\"→\"속상했어\" / \"뭐가 제일 재밌어?\"→\"던지는 거\" / \"어떤 책 좋아해?\"→\"만화책\"",
    "PARTIAL: \"새로 좋아하는 거 있어?\"→\"응\" (있다는 것만 알고 무엇인지 모름)",
    "PARTIAL: \"왜 짜증났어?\"→\"짜증났어\" (이유가 빠짐) / \"어떤 점이 재밌어?\"→\"그냥\" (내용 없음)",
    "SATISFIED 금지: 질문과 무관한 답변. 예) 학교에서 있었던 일을 물었는데 \"부루마불\"만 말한 경우.",
    // 013 §3-4 — K가 던진 질문이 질문지 문장이 아니어도(아이 이야기에서 파생된 질문이어도)
    // 아이 답변이 그 Goal의 핵심 정보를 주면 SATISFIED 다. 판정 기준은 "무슨 질문이었나"가
    // 아니라 "그 Goal이 알고자 한 정보가 아이 말로 확보됐나" 다.
    "K가 질문지 문장 그대로 묻지 않고 아이 이야기에서 파생된 질문을 했더라도, 아이 답변이 그 Goal이 알고자 한 정보를 담고 있으면 SATISFIED 다.",
    "아이가 묻지 않았는데 스스로 꺼낸 이야기도 그 Goal의 정보를 담고 있으면 SATISFIED 로 인정해라.",
    "다음 중 하나에 대한 새로운 정보면 그 Goal의 핵심 정보로 본다: 구체적인 사건·경험, 감정이나 그 이유, 친구·가족·선생님 관계, 관심사·취향·놀이·콘텐츠, 학교·학원·공부에서 있었던 일, 기대하거나 걱정하는 일, 아이의 선택·생각·의견, 최근 달라진 점.",
    // 013 §3-4 / §5-4 — 새 정보가 없는 답변은 인정하지 않는다. 글자 수로 판정하지도 않는다.
    "새로운 정보가 없는 답변은 SATISFIED 로 인정하지 마라: \"응\", \"아니\", \"몰라\", \"그냥\", 질문을 그대로 되풀이한 답, 의미 없는 감탄사.",
    "직전 답변에서 이미 나온 정보를 다시 말한 것뿐이면 새 정보가 아니므로 SATISFIED 로 올리지 마라.",
    "DECLINED: 아이가 명확히 답하기 싫다고 하거나 해당 화제를 피한 경우.",
    "SKIPPED: 현재 발화와 전혀 무관해 판단 근거가 없는 경우. 근거가 없으면 배열에서 생략해도 된다.",
    "한 발화가 여러 Goal을 동시에 충족할 수 있으므로, 해당하면 여러 원소를 반환해라.",
    "아이의 실제 발화 이상을 추측하지 마. 확실하지 않으면 confidence를 낮게 설정해라. evidenceSource는 모든 원소에서 반드시 child_utterance다.",
    "반드시 지정된 JSON 배열만 반환하고, 설명 문장이나 코드펜스를 포함하지 마.",
    "",
    gradeGuidance,
    askedGuidance,
    "[판정 대상 Goal]",
    goals,
    recentHistory ? `\n[최근 대화 맥락]\n${recentHistory}` : "",
    `\n[아이의 현재 발화]\n${input.currentUtterance.trim()}`,
  ].join("\n");
};

const parseAssessments = (
  parsed: unknown,
  goalsById: Map<string, MissionPromptGoal>,
): GoalAssessment[] => {
  if (!Array.isArray(parsed)) return [];

  const seenGoalIds = new Set<string>();
  return parsed.flatMap((candidate): GoalAssessment[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const { goalId, status, confidence } = candidate as Record<string, unknown>;
    if (typeof goalId !== "string") return [];
    const goal = goalsById.get(goalId);
    if (!goal || seenGoalIds.has(goalId)) return [];
    if (typeof status !== "string" || !VALID_STATUSES.has(status as GoalAssessment["status"])) return [];
    if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return [];

    seenGoalIds.add(goalId);
    return [{
      goalId,
      semanticGroup: goal.semanticGroup,
      status: status as GoalAssessment["status"],
      confidence,
      evidenceSource: "child_utterance",
    }];
  });
};

/**
 * Classifies only the child utterance against open Mission v3 Goals. A failed
 * classification deliberately returns no assessments so the turn can proceed
 * with all Goals still open.
 */
export const assessGoalsFromUtterance = async (
  input: AssessGoalsInput,
): Promise<GoalAssessment[]> => {
  if (input.goals.length === 0) return [];

  const goalsById = new Map(input.goals.map((goal) => [goal.goalId, goal]));
  const contents = buildAssessmentInstruction(input);

  const startedAt = Date.now();
  const budgetMs = TOTAL_RETRY_BUDGET_MS;
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
    const delayMs = RETRY_DELAYS_MS[attempt];
    if (attempt > 0) {
      const remaining = budgetMs - (Date.now() - startedAt) - delayMs;
      if (remaining < MIN_ATTEMPT_BUDGET_MS) {
        console.error(
          "[mission-v3/goalAssessor] 재시도 예산 소진 — 판정 없이 진행",
          JSON.stringify({ attempt: attempt + 1, elapsedMs: Date.now() - startedAt }),
        );
        break;
      }
    }
    await sleep(delayMs);

    let response: Awaited<ReturnType<GenerateContentFn>>;
    const attemptStartedAt = Date.now();
    // SDK 자체 타임아웃을 믿지 않는다 — 호출이 매달리면 예산 검사에 도달하지 못한다.
    const attemptTimeoutMs = Math.max(
      MIN_ATTEMPT_BUDGET_MS,
      Math.min(ATTEMPT_TIMEOUT_MS, budgetMs - (attemptStartedAt - startedAt)),
    );
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    try {
      const call = input.ai.models.generateContent({
        model: input.modelId,
        contents,
        config: {
          systemInstruction: [
            "반드시 JSON 배열로만 응답하라. 설명 문장이나 코드펜스 없이 순수 JSON만 출력하라.",
            "응답의 각 원소는 다음 스키마를 정확히 따라야 한다:",
            '[{"goalId":"문자열","status":"SATISFIED","confidence":0.0,"evidenceSource":"child_utterance"}]',
            "status는 SATISFIED, PARTIAL, DECLINED, SKIPPED 중 하나이고 confidence는 0부터 1 사이의 숫자여야 한다.",
            "배열 외의 JSON 객체나 다른 텍스트는 출력하지 마라.",
          ].join("\n"),
          thinkingConfig: { thinkingBudget: 0 },
        },
      });
      const timeout = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error("goal-assessor-timeout")), attemptTimeoutMs);
      });
      response = await Promise.race([call, timeout]);
    } catch (error) {
      const failureType = classifyGenerationFailure(error);
      console.error(
        `[mission-v3/goalAssessor] Goal 판정 생성 실패 (시도 ${attempt + 1}/${RETRY_DELAYS_MS.length})`,
        JSON.stringify({ failureType, elapsedMs: Date.now() - attemptStartedAt, model: input.modelId }),
      );
      // 429 는 재시도로 풀리지 않는다 — 판정 없이 넘기고 다음 턴에 다시 평가한다.
      if (failureType === "RATE_LIMIT") {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        break;
      }
      continue;
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }

    try {
      return parseAssessments(extractJSON(response.text ?? ""), goalsById);
    } catch (error) {
      console.error(
        `[mission-v3/goalAssessor] Goal 판정 JSON 파싱 실패 (시도 ${attempt + 1}/${RETRY_DELAYS_MS.length})`,
        error,
      );
    }
  }

  return [];
};
