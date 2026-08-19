import type { PlaySkillId, PlaySkillModule } from "./skillTypes";
import { CHOSUNG_SKILL } from "./chosungSkill";
import { WORD_CHAIN_SKILL } from "../wordChain/wordChainSkill";
import { NONSENSE_QUIZ_SKILL } from "../nonsenseQuiz/nonsenseQuizSkill";
import type { UtteranceSignals } from "../utteranceSignals";
import {
  filterMentionedCandidates,
  hasPlayRequestMarker,
  looksLikePlayMetaCommentary,
  resolveRequestedSkill,
} from "./skillRequestResolution";

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
  // 015 2차 — 놀이를 평가·설명만 하는 문장에서는 판을 시작하지 않는다.
  // 아이가 게임 이름을 나열하며 개발 피드백을 하던 중 끝말잇기가 시작된 사고가 있었다.
  //
  // 단, 불평과 요청이 한 문장에 같이 오는 경우가 흔하다
  // ("초성 게임은 다시 개발 해 개판이야 끝말잇기나 하자"). 요청 동사가 있으면 요청으로 본다.
  if (looksLikePlayMetaCommentary(utterance) && !hasPlayRequestMarker(utterance)) return null;

  const withAliases = registry.map((skill) => ({
    skill,
    aliases: SKILL_ALIASES[skill.id] ?? [skill.displayName],
  }));

  // 놀이를 둘 이상 말했고 요청 동사가 있으면, 스킬별 신호 매칭보다 이름 위치로 먼저 가린다.
  //
  // 2026-08-19 독립 리뷰 실측: "끝말잇기 말고 초성게임" 이 **끝말잇기를 시작**했다.
  // utteranceSignals 는 "말고" 가 있으면 게임 시작 신호를 전부 끄는데, 끝말잇기 스킬만
  // 자체 패턴으로 true 를 내서 혼자 남아 이긴 것이다. "초성게임 말고 넌센스퀴즈 하고 싶어" 는
  // 후보가 0개가 되어 요청이 통째로 사라졌다.
  // 단순 언급("초성게임 재밌었어")으로 판을 시작하지 않도록 요청 동사가 있을 때만 이 경로를 탄다.
  const mentioned = filterMentionedCandidates(utterance, withAliases);
  // "끝말잇기 말고 초성게임" 처럼 요청 동사 없이 고르기만 하는 문장도 이 경로를 탄다.
  if (mentioned.length >= 2 && (hasPlayRequestMarker(utterance) || /말고/.test(utterance))) {
    const resolvedByName = resolveRequestedSkill(utterance, mentioned);
    if (resolvedByName) return resolvedByName.skill;
  }

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
