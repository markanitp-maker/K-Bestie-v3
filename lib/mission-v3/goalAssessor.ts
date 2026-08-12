import { extractJSON } from "@/app/api/_lib/utils";
import type { GenerateContentFn } from "@/lib/k-conversation/responseGenerator";
import type { MissionPromptGoal } from "@/lib/mission-v3/missionAdapter";
import type { GoalAssessment } from "@/lib/mission-v3/goalEngine";

export interface AssessGoalsInput {
  ai: { models: { generateContent: GenerateContentFn } };
  modelId: string;
  currentUtterance: string;
  recentHistory?: Array<{ role: "child" | "k"; text: string }>;
  goals: MissionPromptGoal[];
}

const VALID_STATUSES: ReadonlySet<GoalAssessment["status"]> = new Set([
  "SATISFIED",
  "PARTIAL",
  "DECLINED",
  "SKIPPED",
]);

// AGENTS.md §7: the first call is immediate, followed by 3s and 5s retries.
const RETRY_DELAYS_MS = [0, 3000, 5000] as const;

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

  return [
    "너는 아이의 현재 발화가 비공개 대화 Goal을 얼마나 충족했는지만 판정한다.",
    "아이에게 보낼 답변, 질문, 조언 등 자연어 대화 문장은 절대로 생성하지 마.",
    "각 Goal의 goalId는 내부 참조용이며 아이에게 노출하지 않는다. promptInstruction은 판정 기준일 뿐, 이를 답변 문장으로 만들지 마.",
    "SATISFIED: 현재 발화가 해당 주제에 의미 있고 구체적인 정보를 준 경우.",
    "PARTIAL: 관련은 있지만 애매하거나 더 확인해야 하는 경우.",
    "DECLINED: 아이가 명확히 답하기 싫다고 하거나 해당 화제를 피한 경우.",
    "SKIPPED: 현재 발화와 전혀 무관해 판단 근거가 없는 경우. 근거가 없으면 배열에서 생략해도 된다.",
    "한 발화가 여러 Goal을 동시에 충족할 수 있으므로, 해당하면 여러 원소를 반환해라.",
    "아이의 실제 발화 이상을 추측하지 마. 확실하지 않으면 confidence를 낮게 설정해라. evidenceSource는 모든 원소에서 반드시 child_utterance다.",
    "반드시 지정된 JSON 배열만 반환하고, 설명 문장이나 코드펜스를 포함하지 마.",
    "",
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

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
    await sleep(RETRY_DELAYS_MS[attempt]);

    let response: Awaited<ReturnType<GenerateContentFn>>;
    try {
      response = await input.ai.models.generateContent({
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
    } catch (error) {
      console.error(
        `[mission-v3/goalAssessor] Goal 판정 생성 실패 (시도 ${attempt + 1}/${RETRY_DELAYS_MS.length})`,
        error,
      );
      continue;
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
