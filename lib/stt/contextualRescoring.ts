/**
 * STT(음성 인식) 전사 결과의 문맥 기반 후보 재해석 모듈.
 *
 * [핵심 원칙]
 * 1. 확신이 낮으면 원문을 그대로 둔다 (changed: false).
 * 2. 후보 치환(Candidate Substitution)만 수행하며, 새로운 문장을 생성하지 않는다.
 * 3. 발음 거리가 임계값 이내로 가까울 때만 치환한다.
 * 4. 원문과 후보의 음절 길이가 1개 이상 차이나면 치환하지 않는다.
 * 5. 어절(Token) 및 다어절(Span) 부분 치환을 지원하여 문맥 내 오인식된 단어만 안전하게 복원한다.
 */

import {
  decomposeHangul,
  jamoEditDistance,
} from "./koreanPhonetic";
import { isDiscardableTranscript } from "./transcriptFilter";

export interface RescoreCandidate {
  text: string;
  source: string;
}

export interface RescoreResult {
  text: string;
  changed: boolean;
  matchedCandidate?: string;
  score?: number;
}

const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;

const CHOSUNG = [
  "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ",
  "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
] as const;

const JUNGSUNG = [
  "ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅘ",
  "ㅙ", "ㅚ", "ㅛ", "ㅜ", "ㅝ", "ㅞ", "ㅟ", "ㅠ", "ㅡ", "ㅢ", "ㅣ",
] as const;

const JONGSUNG = [
  "", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ",
  "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ",
  "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
] as const;

/** 음향적/조음적으로 혼동되기 쉬운 자음 유사군 (치환 비용 0.5 적용) */
const CONSONANT_SIMILARITY_GROUPS: ReadonlySet<string>[] = [
  new Set(["ㅅ", "ㅆ", "ㅈ", "ㅉ", "ㅊ", "ㄷ", "ㄸ", "ㅌ"]), // 마찰음/파찰음/치조음군 (예: 소↔또, 키즈↔퀴즈)
  new Set(["ㄱ", "ㄲ", "ㅋ", "ㅎ"]),                         // 연구개음/후두음군
  new Set(["ㅂ", "ㅃ", "ㅍ", "ㅁ"]),                         // 양순음군 (예: 바나나↔파나나)
  new Set(["ㄴ", "ㄹ", "ㅁ"]),                              // 비음/유음군
];

/** 조음 위치가 인접한 모음 유사군 (치환 비용 0.5 적용) */
const VOWEL_SIMILARITY_GROUPS: ReadonlySet<string>[] = [
  new Set(["ㅗ", "ㅜ", "ㅛ", "ㅠ", "ㅡ"]),                   // 후설/원순 모음군 (예: 소↔수, 오수↔소)
  new Set(["ㅐ", "ㅔ", "ㅚ", "ㅟ", "ㅞ", "ㅙ", "ㅣ"]),       // 전설/이중 모음군 (예: 키↔퀴)
  new Set(["ㅏ", "ㅓ", "ㅑ", "ㅕ"]),                         // 저모음/중모음군
];

/**
 * 한국어 주요 조사 목록 (긴 조사 우선 정렬).
 * 어절에서 조사를 분리하여 어근 단위로 후보 매칭을 시도할 때 사용한다.
 */
const PARTICLES = [
  "이에요", "예요", "이랑", "에서", "으로",
  "은", "는", "이", "가", "을", "를", "과", "와", "도", "로", "에", "의", "만", "야", "아", "랑", "하고",
] as const;

/** 두 자모 간의 조음 유사도 기반 치환 비용 계산 */
function getSubstitutionCost(c1: string, c2: string): number {
  if (c1 === c2) return 0;
  for (const group of CONSONANT_SIMILARITY_GROUPS) {
    if (group.has(c1) && group.has(c2)) return 0.5;
  }
  for (const group of VOWEL_SIMILARITY_GROUPS) {
    if (group.has(c1) && group.has(c2)) return 0.5;
  }
  return 1.0;
}

/**
 * 초성 'ㅇ'(무음 onset)을 음향적으로 제외하여 자모를 분해한다.
 * 한국어 음성인식에서는 모음 시작 음절의 초성 'ㅇ'이 음향적 자음이 아니므로,
 * 음소 전위(도치)나 모음 결합 오인식을 비교할 때 노이즈를 제거한다.
 */
function decomposeHangulAcoustic(text: string): string {
  let result = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= HANGUL_START && code <= HANGUL_END) {
      const offset = code - HANGUL_START;
      const jongIndex = offset % 28;
      const jungIndex = Math.floor(offset / 28) % 21;
      const choIndex = Math.floor(offset / (28 * 21));

      const cho = CHOSUNG[choIndex];
      const jung = JUNGSUNG[jungIndex];
      const jong = JONGSUNG[jongIndex];

      if (cho !== "ㅇ") {
        result += cho;
      }
      result += jung;
      if (jong) {
        result += jong;
      }
    } else {
      result += text[i];
    }
  }
  return result;
}

/**
 * 조음 유사도 및 전위(Damerau-Levenshtein transposition)를 반영한 가중 편집 거리.
 */
function weightedDamerauLevenshtein(a: string, b: string): number {
  const lenA = a.length;
  const lenB = b.length;
  if (lenA === 0) return lenB;
  if (lenB === 0) return lenA;

  const d: number[][] = [];
  for (let i = 0; i <= lenA; i++) {
    d[i] = [];
    d[i][0] = i;
  }
  for (let j = 0; j <= lenB; j++) {
    d[0][j] = j;
  }

  for (let i = 1; i <= lenA; i++) {
    for (let j = 1; j <= lenB; j++) {
      const cost = getSubstitutionCost(a[i - 1], b[j - 1]);
      d[i][j] = Math.min(
        d[i - 1][j] + 1,        // deletion
        d[i][j - 1] + 1,        // insertion
        d[i - 1][j - 1] + cost  // substitution
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 0.8); // transposition
      }
    }
  }
  return d[lenA][lenB];
}

/** 완성형 한글 음절 수 계산 */
function countHangulSyllables(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= HANGUL_START && code <= HANGUL_END) {
      count++;
    }
  }
  return count;
}

/** 공백 및 문장부호/특수문자 제거 */
function normalizePunctuation(text: string): string {
  return text.replace(/[\s\p{P}\p{S}]/gu, "");
}

/** 종성(받침) 존재 여부 확인 */
function hasJongseong(char: string): boolean {
  if (!char) return false;
  const code = char.charCodeAt(0);
  if (code < HANGUL_START || code > HANGUL_END) return false;
  return (code - HANGUL_START) % 28 !== 0;
}

/**
 * 치환된 후보 단어의 종성(받침) 여부에 따라 조사의 음운적 형태를 자동 조정한다.
 * 예: "손은" -> "소는", "손이" -> "소가", "손을" -> "소를", "손과" -> "소와"
 */
function adjustParticle(candidate: string, particle: string): string {
  if (!particle || !candidate) return particle;
  const lastChar = candidate[candidate.length - 1];
  const withJong = hasJongseong(lastChar);

  if (particle === "은" || particle === "는") return withJong ? "은" : "는";
  if (particle === "이" || particle === "가") return withJong ? "이" : "가";
  if (particle === "을" || particle === "를") return withJong ? "을" : "를";
  if (particle === "과" || particle === "와") return withJong ? "과" : "와";
  if (particle === "아" || particle === "야") return withJong ? "아" : "야";
  if (particle === "이랑" || particle === "랑") return withJong ? "이랑" : "랑";
  if (particle === "으로" || particle === "로") return withJong ? "으로" : "로";
  return particle;
}

/**
 * 단일 토큰/어근과 후보 간의 발음 유사도 평가.
 *
 * [임계값 설정 근거]
 * 1. 음절 길이 차이: 최대 1음절 허용 (Math.abs(sylToken - sylCand) <= 1).
 *    2음절 이상 차이나는 경우('소' vs '소나기', '학교' vs '송아지')는 의미가 완전히 다른 단어이므로 엄격 차단.
 * 2. 최대 허용 거리(maxAllowedDist):
 *    - 1음절 후보: 1.5 (자모 1개 변형/탈락 또는 초성도치+모음유사 1.5 허용; 예: '오수'↔'소', '손'↔'소', '또'↔'소')
 *    - 2음절 후보: 2.0 (자모 2개 변형/탈락 허용; 예: '키즈'↔'퀴즈', '호성'↔'초성')
 *    - 3음절 이상: 2.5 (긴 단어 조음 변형 허용; 예: '송하지'↔'송아지', '끝말이끼'↔'끝말잇기')
 * 3. 최소 유사도 점수(minScore = 1 - dist / maxJamoLen):
 *    - 1음절: >= 0.50 (50%)
 *    - 2음절: >= 0.55 (55%)
 *    - 3음절 이상: >= 0.60 (60%)
 */
function tryMatch(
  tokenClean: string,
  candClean: string
): { matched: boolean; score: number; distance: number } {
  if (!tokenClean || !candClean) {
    return { matched: false, score: 0, distance: 999 };
  }
  if (tokenClean === candClean) {
    return { matched: true, score: 1.0, distance: 0 };
  }

  const sylToken = countHangulSyllables(tokenClean);
  const sylCand = countHangulSyllables(candClean);
  if (Math.abs(sylToken - sylCand) > 1) {
    return { matched: false, score: 0, distance: 999 };
  }

  // 097 §3-2: 재해석은 아이가 말한 소리를 복원하는 것이지, 안 말한 답을 채워 넣는 게 아니다.
  // 후보가 원문보다 길면 그건 복원이 아니라 완성이다. "송아" → "송아지" 처럼 아이가
  // 끝내지 못한 답을 정답으로 만들어 주는 경로가 여기서 생긴다.
  // 반대로 "오수" → "소" 처럼 STT 가 끼워 넣은 음절을 걷어내는 건 복원이므로 허용한다.
  if (sylCand > sylToken) {
    return { matched: false, score: 0, distance: 999 };
  }

  // 1) 표준 자모 분해 및 편집 거리 (koreanPhonetic 재사용)
  const stdJamoToken = decomposeHangul(tokenClean);
  const stdJamoCand = decomposeHangul(candClean);
  const stdDist = jamoEditDistance(stdJamoToken, stdJamoCand);

  // 2) 음향 가중치 및 무음 초성 ㅇ 제거 분해 편집 거리
  const acJamoToken = decomposeHangulAcoustic(tokenClean);
  const acJamoCand = decomposeHangulAcoustic(candClean);
  const acDist = weightedDamerauLevenshtein(acJamoToken, acJamoCand);

  const maxJamoLen = Math.max(
    stdJamoToken.length,
    stdJamoCand.length,
    acJamoToken.length,
    acJamoCand.length
  );
  const bestDist = Math.min(stdDist, acDist);
  const score = Math.max(0, 1 - bestDist / maxJamoLen);

  const maxAllowedDist = sylCand <= 1 ? 1.5 : sylCand === 2 ? 2.0 : 2.5;
  const minScore = sylCand <= 1 ? 0.50 : sylCand === 2 ? 0.55 : 0.60;

  const matched = bestDist <= maxAllowedDist && score >= minScore;
  return { matched, score, distance: bestDist };
}

/**
 * 어절 문자열에서 문장부호 및 조사를 분리하여 후보 매칭 및 대체 텍스트를 생성한다.
 */
function evaluateCandidateMatch(
  tokenStr: string,
  candidateText: string
): { matched: boolean; score: number; distance: number; replacedText: string } {
  const cleanCand = normalizePunctuation(candidateText);
  if (!cleanCand) {
    return { matched: false, score: 0, distance: 999, replacedText: "" };
  }

  // 선행 및 후행 문장부호 분리
  const matchPunc = tokenStr.match(/^([^\p{L}\p{N}]*)([\s\S]*?)([^\p{L}\p{N}]*)$/u);
  const leadingPunc = matchPunc ? matchPunc[1] : "";
  const coreBody = matchPunc ? matchPunc[2] : tokenStr;
  const trailingPunc = matchPunc ? matchPunc[3] : "";

  const cleanToken = normalizePunctuation(coreBody);
  if (!cleanToken) {
    return { matched: false, score: 0, distance: 999, replacedText: "" };
  }

  // 1. 이미 후보와 완전히 동일한 경우
  if (cleanToken === cleanCand) {
    return {
      matched: true,
      score: 1.0,
      distance: 0,
      replacedText: tokenStr,
    };
  }

  // 2. 어절 본문 직접 매칭 시도
  const directEval = tryMatch(cleanToken, cleanCand);
  if (directEval.matched) {
    return {
      matched: true,
      score: directEval.score,
      distance: directEval.distance,
      replacedText: `${leadingPunc}${candidateText}${trailingPunc}`,
    };
  }

  // 3. 조사 분리 후 어근 매칭 시도
  for (const p of PARTICLES) {
    if (cleanToken.endsWith(p) && cleanToken.length > p.length) {
      const core = cleanToken.slice(0, -p.length);
      const coreEval = tryMatch(core, cleanCand);
      if (coreEval.matched) {
        const adjustedP = adjustParticle(candidateText, p);
        return {
          matched: true,
          score: coreEval.score,
          distance: coreEval.distance,
          replacedText: `${leadingPunc}${candidateText}${adjustedP}${trailingPunc}`,
        };
      }
    }
  }

  return { matched: false, score: 0, distance: 999, replacedText: "" };
}

/**
 * 음성 인식 결과(raw transcript)를 주어진 문맥 후보(candidates)와 발음 유사도 기반으로 비교하여 재해석한다.
 *
 * @param raw 원문 STT 전사 문자열
 * @param candidates 현재 게임/미션 문맥에서 제공된 유효 후보 목록
 * @returns RescoreResult (치환된 텍스트, 변경 여부, 매칭된 후보, 유사도 점수)
 */
export function rescoreTranscript(
  raw: string,
  candidates: RescoreCandidate[]
): RescoreResult {
  // 1. 기본 유효성 검사 및 방어
  if (!raw || typeof raw !== "string" || !raw.trim()) {
    return { text: raw ?? "", changed: false };
  }

  // 1단계 필터 방어: 자모만으로 구성된 발화는 재해석하지 않음
  if (isDiscardableTranscript(raw)) {
    return { text: raw, changed: false };
  }

  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { text: raw, changed: false };
  }

  const validCandidates = candidates.filter(
    (c) => c && typeof c.text === "string" && c.text.trim().length > 0
  );
  if (validCandidates.length === 0) {
    return { text: raw, changed: false };
  }

  // 010 — 아이 말이 이미 후보와 정확히 같으면 손대지 않는다.
  //
  // 발음 유사도만 보면 짧은 후보가 이길 수 있다. 2026-08-19 Dev QA 실측:
  // "이름표"(사전에 있는 정상 단어)가 "이름"(점수 0.714)으로 바뀌어 끝말잇기가
  // '름' 으로 넘어갔고 이어갈 낱말이 없어 K 가 바로 포기했다.
  // 정확히 일치하는 후보가 있으면 그게 정답이다 — 교정할 것이 없다.
  const normalizedRaw = raw.trim().replace(/\s+/g, "");
  if (
    validCandidates.some(
      (candidate) => candidate.text.trim().replace(/\s+/g, "") === normalizedRaw
    )
  ) {
    return { text: raw, changed: false };
  }

  // 2. 어절(Token) 단위 위치 추적
  const tokenRegex = /\S+/g;
  const tokens: { text: string; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = tokenRegex.exec(raw)) !== null) {
    tokens.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }

  if (tokens.length === 0) {
    return { text: raw, changed: false };
  }

  // 3. 다어절(Span) 및 단일 어절 창(Window) 탐색
  let bestCandidate: RescoreCandidate | null = null;
  let bestScore = -1;
  let bestDist = 999;
  let bestSpanStart = -1;
  let bestSpanEnd = -1;
  let bestReplacement = "";

  for (let spanLen = Math.min(tokens.length, 3); spanLen >= 1; spanLen--) {
    for (let i = 0; i <= tokens.length - spanLen; i++) {
      const spanTokens = tokens.slice(i, i + spanLen);
      const spanStart = spanTokens[0].start;
      const spanEnd = spanTokens[spanTokens.length - 1].end;
      const spanRawText = raw.substring(spanStart, spanEnd);

      for (const cand of validCandidates) {
        const evalRes = evaluateCandidateMatch(spanRawText, cand.text);
        if (evalRes.matched) {
          // 이미 원문과 동일하여 치환할 필요가 없는 경우 스킵
          if (evalRes.distance === 0 || evalRes.replacedText === spanRawText) {
            continue;
          }

          // 더 높은 유사도 점수 (동점 시 더 작은 편집 거리) 선택
          if (
            evalRes.score > bestScore ||
            (evalRes.score === bestScore && evalRes.distance < bestDist)
          ) {
            bestScore = evalRes.score;
            bestDist = evalRes.distance;
            bestCandidate = cand;
            bestSpanStart = spanStart;
            bestSpanEnd = spanEnd;
            bestReplacement = evalRes.replacedText;
          }
        }
      }
    }
  }

  // 4. 최적 매칭된 어절/구간만 부분 치환하여 반환
  if (bestCandidate && bestSpanStart >= 0 && bestReplacement) {
    const updatedText =
      raw.substring(0, bestSpanStart) +
      bestReplacement +
      raw.substring(bestSpanEnd);

    if (updatedText !== raw) {
      return {
        text: updatedText,
        changed: true,
        matchedCandidate: bestCandidate.text,
        score: Number(bestScore.toFixed(3)),
      };
    }
  }

  return { text: raw, changed: false };
}
