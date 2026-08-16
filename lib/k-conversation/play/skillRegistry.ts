import type { PlaySkillId, PlaySkillModule } from "./skillTypes";
import { CHOSUNG_SKILL } from "./chosungSkill";
import type { UtteranceSignals } from "../utteranceSignals";

/**
 * 활성화된 모든 Play Skill의 등록부.
 * 향후 신규 놀이(WORD_CHAIN 등) 추가 시 이 배열에 모듈 1줄만 추가합니다 (§3-4).
 */
export const PLAY_SKILL_REGISTRY: readonly PlaySkillModule[] = [
  CHOSUNG_SKILL,
];

/**
 * Skill ID로 등록된 모듈을 검색합니다.
 */
export function findSkillById(
  id: PlaySkillId,
  registry: readonly PlaySkillModule[] = PLAY_SKILL_REGISTRY
): PlaySkillModule | null {
  return registry.find((skill) => skill.id === id) ?? null;
}

/**
 * 아이의 발화 및 신호에서 직접 요청된 Skill 모듈을 검색합니다.
 */
export function findDirectlyRequestedSkill(
  signals: UtteranceSignals,
  utterance: string,
  registry: readonly PlaySkillModule[] = PLAY_SKILL_REGISTRY
): PlaySkillModule | null {
  for (const skill of registry) {
    if (skill.matchesDirectRequest(signals, utterance)) {
      return skill;
    }
  }
  return null;
}
