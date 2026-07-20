/**
 * 질문·대화 엔진 V2 기능 플래그 및 시드 코호트 판별 모듈
 */

export function isQuestionEngineV2Enabled(childId: string): boolean {
  const flagOn = process.env.QUESTION_ENGINE_V2 === "true";
  if (!flagOn) return false;

  const seedIdsStr = process.env.QUESTION_ENGINE_V2_SEED_CHILD_IDS ?? "";
  const seedIds = seedIdsStr
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (seedIds.length === 0) return true;

  return seedIds.includes(childId);
}
