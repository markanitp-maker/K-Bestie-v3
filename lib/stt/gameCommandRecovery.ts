/**
 * STT 오인식 발화에서 게임 시작 명령을 복구하는 모듈.
 * 일반 대화에는 적용되지 않으며, 정확 매칭이 실패한 경우에만 호출된다.
 */

import {
  decomposeHangul,
  isPhoneticallySimilar,
  jamoEditDistance,
} from "./koreanPhonetic";

export type RecoveredGameCommand = "CHOSUNG" | "WORD_CHAIN" | "NONSENSE_QUIZ" | null;

interface CommandTarget {
  target: string;
  command: "CHOSUNG" | "WORD_CHAIN" | "NONSENSE_QUIZ";
  /** 2음절 단독 표현은 놀이 맥락이 있을 때만 인정한다. */
  needsContext?: boolean;
}

/**
 * 복구 대상 표현 목록.
 * 오탐을 방지하기 위해 정해진 게임 관련 핵심 표현들만 대상으로 한다.
 */
const TARGET_COMMANDS: readonly CommandTarget[] = [
  // CHOSUNG 대상 표현 (복합 표현 및 핵심 키워드)
  { target: "초성게임", command: "CHOSUNG" },
  { target: "초성퀴즈", command: "CHOSUNG" },
  { target: "초성놀이", command: "CHOSUNG" },
  { target: "초성문제", command: "CHOSUNG" },
  { target: "ㅊㅅ게임", command: "CHOSUNG" },
  { target: "ㅊㅅ퀴즈", command: "CHOSUNG" },
  // 2음절 단독 표현은 실제 낱말과 너무 가깝다("초성"↔"조성진", "퀴즈"↔"키즈카페").
  // 그래서 문장에 놀이 맥락이 함께 있을 때만 인정한다(needsContext).
  { target: "초성", command: "CHOSUNG", needsContext: true },

  // WORD_CHAIN 대상 표현
  { target: "끝말잇기", command: "WORD_CHAIN" },
  { target: "말잇기", command: "WORD_CHAIN" },
  { target: "단어잇기", command: "WORD_CHAIN" },

  // NONSENSE_QUIZ 대상 표현
  { target: "넌센스퀴즈", command: "NONSENSE_QUIZ" },
  { target: "넌센스게임", command: "NONSENSE_QUIZ" },
  { target: "수수께끼퀴즈", command: "NONSENSE_QUIZ" },
  { target: "수수께끼놀이", command: "NONSENSE_QUIZ" },
  { target: "수수께끼", command: "NONSENSE_QUIZ", needsContext: true },
  { target: "넌센스", command: "NONSENSE_QUIZ", needsContext: true },
  // 010 대표님 QA 실측(2026-08-20 00:12): 아이가 "넌센스 퀴즈" 라고 했는데 STT 가
  // 앞을 흘려 "스퀴즈 봐" 로 들어왔다. 그런데 "퀴즈" 단독이 CHOSUNG 으로 매핑돼 있어서
  // **초성게임이 시작됐다.** 아이가 "넌센스 퀴즈라 그랬지 초성 게임 하라 그랬냐" 고 지적했다.
  //
  // "퀴즈" 라고 불리는 놀이는 넌센스 퀴즈다. 초성게임은 "초성게임" 으로 부른다.
  // 그래서 퀴즈 계열 단독·잘림 표현은 전부 넌센스로 돌린다.
  { target: "넌센스퀴", command: "NONSENSE_QUIZ" },
  { target: "센스퀴즈", command: "NONSENSE_QUIZ" },
  // 리뷰 지적(2026-08-20 MAJOR): "스퀴즈" 에 needsContext 를 빼먹어 "퀴즈쇼 봤어",
  // "스퀴즈 번트"(야구) 같은 말이 놀이 시작으로 복구됐다. 짧은 표현은 놀이 맥락이
  // 함께 있을 때만 인정한다 — "초성"·"퀴즈" 와 같은 정책이다.
  { target: "스퀴즈", command: "NONSENSE_QUIZ", needsContext: true },
  { target: "퀴즈", command: "NONSENSE_QUIZ", needsContext: true },
] as const;

/**
 * 공백 및 문장부호/특수문자를 제거한다.
 */
function normalizeText(text: string): string {
  return text.replace(/[\s\p{P}\p{S}]/gu, "");
}

/** 놀이를 시작하려는 맥락인지 판단하는 토큰. 정규화(공백 제거) 후 비교한다.
 *  "조성진 피아노 들었어", "키즈카페 갔어"처럼 맥락이 없으면 복구하지 않는다. */
const PLAY_CONTEXT_TOKENS = [
  "하자", "할래", "할까", "해봐", "해보", "해줘", "해볼", "하잖아", "하는거",
  "하고싶", "내줘", "내봐", "내주", "놀자", "놀래", "놀아", "게임", "놀이", "문제", "맞춰", "맞혀",
  // "스퀴즈 봐"(= 넌센스 퀴즈 봐) 처럼 단독 "봐" 로 요청하는 발화가 실측으로 나왔다.
  // "봤" 은 넣지 않는다 — "퀴즈쇼 봤어" 는 놀이 요청이 아니라 본 이야기다.
  "봐",
] as const;

function hasPlayContext(normalized: string): boolean {
  return PLAY_CONTEXT_TOKENS.some((token) => normalized.includes(token));
}

/**
 * 놀이 요청이 아닌 것이 확실한 표현. 리뷰 지적(2026-08-20)으로 추가했다.
 *
 * "스퀴즈" 를 넌센스 퀴즈 잘림으로 인정하니 야구 용어("스퀴즈 번트")와 방송("퀴즈쇼")이
 * 놀이 시작으로 복구됐다. 이런 말은 실제 낱말이라 유사도로는 구분할 수 없다 —
 * 명시적으로 뺀다.
 */
const NON_PLAY_PHRASES = ["퀴즈쇼", "퀴즈대회", "스퀴즈번트", "스퀴즈플레이", "스퀴저"] as const;

function isNonPlayPhrase(normalized: string): boolean {
  return NON_PLAY_PHRASES.some((phrase) => normalized.includes(phrase));
}

interface MatchCandidate {
  command: "CHOSUNG" | "WORD_CHAIN" | "NONSENSE_QUIZ";
  dist: number;
  targetJamoLen: number;
}

/**
 * STT가 뭉갠 발화에서 부분 문자열 창(window)을 훑어 게임 명령을 복구한다.
 * 정확 매칭이 이미 실패한 경우에만 호출된다.
 * 여러 후보가 매칭될 경우 편집 거리가 가장 짧고, 타겟 길이가 더 긴 것을 우선 채택한다.
 */
export function recoverGameCommand(text: string): RecoveredGameCommand {
  if (!text || typeof text !== "string") {
    return null;
  }

  const cleanText = normalizeText(text);
  if (!cleanText) {
    return null;
  }

  let bestMatch: MatchCandidate | null = null;

  // 놀이가 아닌 것이 확실한 표현이면 아예 복구하지 않는다.
  if (isNonPlayPhrase(cleanText)) return null;

  const playContext = hasPlayContext(cleanText);

  // 글자가 정확히 들어 있는 타겟이 있으면 **그 타겟들만** 후보로 본다.
  //
  // 리뷰 지적(2026-08-20): "스퀴즈" 가 그대로 들어 있는데도 4글자 타겟 "초성퀴즈" 의
  // 유사 매칭이 이겨 초성게임으로 갔다. 아이가 명확히 말한 낱말이 있으면 그것이
  // 다른 게임의 흐릿한 유사도보다 앞선다. 정확히 들어 있는 타겟이 전부
  // 맥락 부족으로 걸러지면 **아무것도 복구하지 않는다** — 다른 게임으로 넘기는 것보다
  // 복구를 포기하는 쪽이 낫다("스퀴즈" 한 마디를 초성게임으로 시작해 버리면 안 된다).
  const exactTargets = TARGET_COMMANDS.filter((entry) => cleanText.includes(entry.target));
  const searchSpace = exactTargets.length > 0 ? exactTargets : TARGET_COMMANDS;

  for (const { target, command, needsContext } of searchSpace) {
    // 2음절 단독 표현은 놀이 맥락이 없으면 건너뛴다.
    if (needsContext && !playContext) continue;

    const targetLen = target.length;
    const targetJamo = decomposeHangul(target);
    const targetJamoLen = targetJamo.length;

    // 타겟 길이를 기준으로 ±1 글자 창(window) 크기 탐색
    const minWin = Math.max(1, targetLen - 1);
    const maxWin = Math.min(cleanText.length, targetLen + 1);

    for (let wLen = minWin; wLen <= maxWin; wLen++) {
      for (let start = 0; start <= cleanText.length - wLen; start++) {
        const sub = cleanText.substring(start, start + wLen);

        if (isPhoneticallySimilar(sub, target)) {
          const subJamo = decomposeHangul(sub);
          // 글자가 정확히 일치하면 유사 매칭보다 무조건 앞선다.
          // 리뷰 지적: "스퀴즈 봐" 에서 "스퀴즈" 는 정확히 들어 있는데도,
          // 4글자 타겟 "초성퀴즈" 의 유사 매칭이 이겨 초성게임으로 갔다.
          const dist = sub === target ? -1 : jamoEditDistance(subJamo, targetJamo);

          // 더 유사한 쪽(1. 편집거리 최소, 2. 자모 길이 최장) 갱신
          if (
            !bestMatch ||
            dist < bestMatch.dist ||
            (dist === bestMatch.dist && targetJamoLen > bestMatch.targetJamoLen)
          ) {
            bestMatch = {
              command,
              dist,
              targetJamoLen,
            };
          }
        }
      }
    }
  }

  return bestMatch ? bestMatch.command : null;
}
