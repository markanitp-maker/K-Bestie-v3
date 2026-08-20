import { quotativeParticle } from "../utils/koreanParticle";
// 요청서 014 — 케이가 못 알아들었을 때 "못 들었어"를 반복하지 않는다.
//
// 실제 사고: 케이가 "다시 말해줄래?"를 계속 반복해 아이가 항의했다
// ("2번 말했으면 알아들어야 하는 거 아냐").
//
// 대표님 지시:
//   - 들은 대로 되물어라. 예) 내가 "죽을개"라고 들었는데, 이게 맞니?
//   - 무시하거나 "못 들었어"라고 하지 마라.
//
// 그래서 규칙은 하나다: **들린 게 있으면 그걸 되묻고, 아무것도 안 들렸을 때만 다시 말해달라고 한다.**
// 두 번째부터가 아니라 처음부터 그렇게 한다 — 아이 입장에서 첫 번째 "못 들었어"도 이미 무시다.
//
// 안전은 이 판정보다 먼저 끝난다(respond() 1단계). 여기 도달한 발화는 안전 검사를 통과한
// 것이므로 그대로 되물어도 위험하지 않다.

/**
 * 되물을 수 있는 최대 길이.
 *
 * 이 경로는 "짧은 단어를 못 알아들었다"를 위한 것이다. 길게 말했는데 신뢰도가 낮은 경우는
 * 통째로 되물으면 오히려 이상해진다("내가 '오늘 학교에서 어쩌고 저쩌고'라고 들었는데 맞니?").
 * 그런 경우는 기존 템플릿이 낫다.
 */
export const MAX_ECHO_BACK_LENGTH = 20;

/** 되물을 값이 없다고 볼 문자열. 공백·기호만 남은 것은 들린 게 아니다. */
const isEchoable = (text: string): boolean => {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_ECHO_BACK_LENGTH) return false;
  // 최소 한 글자는 실제 말이어야 한다(한글/영문/숫자).
  return /[가-힣a-zA-Z0-9]/.test(trimmed);
};

/**
 * 케이가 직전 턴에도 못 알아들었다고 했는지.
 * 같은 말을 두 번 반복하지 않기 위한 신호다.
 */
const UNCLEAR_K_TURN_PATTERN =
  /(못\s*들었|안\s*들렸|놓쳐|다시\s*말해|다시\s*얘기|다시\s*한\s*번|다시\s*말해볼래|이게\s*맞(니|아)|들었는데)/;

export const isRepeatedUnclearTurn = (recentKTexts: readonly string[]): boolean =>
  countConsecutiveUnclearTurns(recentKTexts) > 0;

/**
 * 케이가 연속으로 몇 번이나 못 알아들었다고 했는지.
 * 뒤에서부터 세다가 알아들은 턴이 나오면 멈춘다.
 */
export const countConsecutiveUnclearTurns = (recentKTexts: readonly string[]): number => {
  let count = 0;
  for (let i = recentKTexts.length - 1; i >= 0; i -= 1) {
    const text = recentKTexts[i]?.trim();
    if (!text) break;
    if (!UNCLEAR_K_TURN_PATTERN.test(text)) break;
    count += 1;
  }
  return count;
};

/** 이 횟수를 넘게 못 알아들으면 되묻기를 멈추고 화제를 넘긴다. */
export const MAX_ECHO_BACK_ATTEMPTS = 2;

export interface UnclearAudioRecovery {
  /** 아이에게 보낼 문장. null 이면 호출부가 기존 템플릿을 쓴다. */
  text: string | null;
}

/**
 * 못 알아들은 턴에 보낼 문장을 만든다.
 *
 * - 들린 말이 있으면 그대로 되묻는다(반복이든 아니든).
 * - 두 번째부터는 아이가 이미 한 번 답했다는 걸 인정하는 말을 앞에 붙인다.
 * - 들린 게 없으면 null 을 돌려준다 — 그때만 기존 "다시 말해줄래?" 템플릿을 쓴다.
 */
export function buildUnclearAudioRecovery(input: {
  childUtterance: string;
  recentKTexts?: readonly string[];
}): UnclearAudioRecovery {
  const heard = input.childUtterance.trim();
  if (!isEchoable(heard)) return { text: null };

  // 같은 되묻기를 무한정 반복하지 않는다. 두 번 되물었는데도 안 통하면 아이가 지친다
  // (리뷰 HIGH 지적: "맞니?"/"맞아?" 사이를 오가며 탈출 조건이 없었다).
  // 그래도 무시하지는 않는다 — 들은 말은 그대로 돌려주고 화제를 넘긴다.
  const attempts = countConsecutiveUnclearTurns(input.recentKTexts ?? []);
  if (attempts >= MAX_ECHO_BACK_ATTEMPTS) {
    return { text: `내가 "${heard}"${quotativeParticle(heard)} 들었는데 자꾸 헷갈리네ㅠ 미안해. 우리 다른 얘기 먼저 할까?` };
  }
  return {
    text: attempts > 0
      ? `아, 미안! 내가 "${heard}"${quotativeParticle(heard)} 들었는데, 이게 맞아?`
      : `내가 "${heard}"${quotativeParticle(heard)} 들었는데, 이게 맞니?`,
  };
}
