import type { PlaySkillId, PlaySkillModule } from "./skillTypes";
import { CHOSUNG_SKILL } from "./chosungSkill";
import { WORD_CHAIN_SKILL } from "../wordChain/wordChainSkill";
import { NONSENSE_QUIZ_SKILL } from "../nonsenseQuiz/nonsenseQuizSkill";
import type { UtteranceSignals } from "../utteranceSignals";
import { resolveRequestedSkill } from "./skillRequestResolution";

/**
 * 활성화된 모든 Play Skill의 등록부.
 * 향후 신규 놀이(WORD_CHAIN 등) 추가 시 이 배열에 모듈 1줄만 추가합니다 (§3-4).
 */
export const PLAY_SKILL_REGISTRY: readonly PlaySkillModule[] = [
  CHOSUNG_SKILL,
  WORD_CHAIN_SKILL,
  NONSENSE_QUIZ_SKILL,
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
/**
 * 놀이별 이름·별칭. 아이가 한 문장에서 놀이를 여러 개 말했을 때 어느 것을 요청했는지
 * 위치로 가려내기 위해 쓴다(요청서 014). 레지스트리와 함께 관리한다.
 */
const SKILL_ALIASES: Record<string, readonly string[]> = {
  CHOSUNG: ["초성게임", "초성 게임", "초성"],
  WORD_CHAIN: ["끝말잇기", "끝말 잇기", "끝말"],
  NONSENSE_QUIZ: ["넌센스퀴즈", "넌센스 퀴즈", "넌센스", "수수께끼"],
};

/**
 * 아이 발화가 직접 요청한 Skill 을 찾는다.
 *
 * 여러 Skill 이 동시에 매칭되면 **등록 순서로 첫 번째를 고르지 않는다**. 2026-08-18 Dev 실측에서
 * 아이가 "초성 게임은 개판이야 끝말잇기나 하자" 라고 했는데 등록 순서 때문에 초성게임이 이겨서
 * 끝말잇기 요청이 두 턴 연속 무시됐다. 사람이 말한 순서와 불만 맥락을 따른다
 * (lib/k-conversation/play/skillRequestResolution.ts).
 */
export function findDirectlyRequestedSkill(
  signals: UtteranceSignals,
  utterance: string,
  registry: readonly PlaySkillModule[] = PLAY_SKILL_REGISTRY
): PlaySkillModule | null {
  const matched = registry.filter((skill) => skill.matchesDirectRequest(signals, utterance));
  if (matched.length === 0) return null;
  if (matched.length === 1) return matched[0];

  const resolved = resolveRequestedSkill(
    utterance,
    matched.map((skill) => ({ skill, aliases: SKILL_ALIASES[skill.id] ?? [skill.displayName] }))
  );
  return resolved?.skill ?? matched[0];
}

/**
 * 활성화된 모든 Play Skill 목록에서 케이가 아이에게 안내할 놀이 카탈로그 프래그먼트를 파생 생성합니다.
 */
export function buildPlayCatalogFragment(
  registry: readonly PlaySkillModule[] = PLAY_SKILL_REGISTRY
): string {
  if (!registry || registry.length === 0) {
    return "";
  }
  const items = registry
    .map((skill) => `- ${skill.displayName}: ${skill.childFacingDescription}`)
    .join("\n");

  return [
    "[네가 같이 할 수 있는 놀이]",
    items,
    "- 아이가 무슨 놀이를 할 수 있냐고 물으면 이 목록에서 골라 네가 먼저 말해줘. 아이에게 되묻지 마.",
    // 081 리뷰: 단순 금지만 두면 "숨바꼭질 하자"에 퉁명스럽게 거절하게 된다.
    // 못 하는 이유를 짧게 말하고 대안을 먼저 내미는 쪽으로 유도한다.
    "- 이 목록에 없는 놀이는 직접 할 수 없다고 친절히 말하고, 대신 목록에 있는 놀이를 하자고 제안해줘.",
    "- 이 목록은 놀이 소개 및 제안용이야.",
  ].join("\n");
}
