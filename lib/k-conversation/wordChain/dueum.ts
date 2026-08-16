/**
 * 끝말잇기(WORD_CHAIN) 두음법칙(頭音法則) 유틸리티.
 * 국립국어원 표준 한글 맞춤법 제3장 제5절(제10항, 제11항, 제12항) 기준 준수.
 * 사전에 allowedInitials를 중복 저장하지 않고 결정론적 유틸로 계산합니다 (§3-16).
 *
 * [표준 두음법칙 근거]
 * 1. 한글 맞춤법 제10항 (ㄴ -> ㅇ):
 *    한자음 '녀, 뇨, 뉴, 니'(모음 ㅑ, ㅒ, ㅕ, ㅖ, ㅛ, ㅠ, ㅣ)가 단어 첫머리에 올 때 '여, 요, 유, 이'로 적는다.
 *    예: 녀->여 (남녀->여자), 뇨->요 (당뇨->요소), 뉴->유 (결뉴->유대), 니->이 (은닉->익명), 념->염, 녕->영, 닉->익, 년->연 등.
 *
 * 2. 한글 맞춤법 제11항 (ㄹ -> ㅇ):
 *    한자음 '랴, 려, 례, 료, 류, 리'(모음 ㅑ, ㅒ, ㅕ, ㅖ, ㅛ, ㅠ, ㅣ)가 단어 첫머리에 올 때 '야, 여, 예, 요, 유, 이'로 적는다.
 *    예: 랴->야 (양량->양심), 려->여 (격려->여관), 례->예 (혼례->예절), 료->요 (음료->요리), 류->유 (종류->유행), 리->이 (도리->이치), 량->양, 력->역, 련->연, 렬->열, 림->임, 립->입, 린->인 등.
 *
 * 3. 한글 맞춤법 제12항 (ㄹ -> ㄴ):
 *    한자음 '라, 래, 로, 뢰, 루, 르' 등 'ㅑ, ㅕ, ㅖ, ㅛ, ㅠ, ㅣ' 이외 모음을 가진 한자음이 첫머리에 올 때 '나, 내, 노, 뇌, 누, 느'로 적는다.
 *    예: 라->나 (신라->나팔), 락->낙 (쾌락->낙원), 란->난 (요란->난초), 랄->날, 람->남 (관람->남용), 랍->납, 랑->낭, 래->내 (왕래->내일), 랭->냉, 로->노 (도로->노인), 록->녹 (기록->녹음), 론->논 (토론->논리), 롱->농, 뢰->뇌, 루->누 (누각), 륵->늑 (늑골), 름->늠, 릉->능 (왕릉->능묘) 등.
 *
 * [원칙]
 * - 직접 연결이 항상 우선하며, allowedNextInitials[0]은 항상 자기 자신입니다.
 * - '노'->'오', '나'->'아' 같은 비표준 확장은 철저히 금지합니다.
 */

const HANGUL_BASE = 0xac00;
const HANGUL_END = 0xd7a3;

// 초성 인덱스: 'ㄴ' = 2, 'ㄹ' = 5, 'ㅇ' = 11
const INITIAL_N = 2;
const INITIAL_R = 5;
const INITIAL_NG = 11;

// 중성(모음) 중 'ㅑ, ㅒ, ㅕ, ㅖ, ㅛ, ㅠ, ㅣ' 인덱스 집합 (제10항, 제11항 적용)
// ㅑ: 2, ㅒ: 3, ㅕ: 6, ㅖ: 7, ㅛ: 12, ㅠ: 17, ㅣ: 20
const I_OR_Y_VOWEL_INDICES = new Set<number>([2, 3, 6, 7, 12, 17, 20]);

/**
 * 주어진 이전 단어의 마지막 음절에 대해 다음 단어의 첫 음절로 올 수 있는 허용 음절 목록을 반환합니다.
 * 첫 번째 원소는 항상 직접 연결(자기 자신)입니다.
 *
 * @param lastSyllable 직전 단어의 끝 음절 (1글자)
 * @returns 허용되는 다음 시작 음절 목록 (직접 연결 + 두음법칙 변형)
 */
export function allowedNextInitials(lastSyllable: string): readonly string[] {
  if (!lastSyllable || typeof lastSyllable !== "string") {
    return [];
  }

  const char = lastSyllable.trim().slice(0, 1);
  if (!char) {
    return [];
  }

  const code = char.charCodeAt(0) - HANGUL_BASE;
  if (code < 0 || char.charCodeAt(0) > HANGUL_END) {
    // 한글 완성형 음절이 아닌 경우 자기 자신만 반환
    return [char];
  }

  const initial = Math.floor(code / (21 * 28));
  const vowel = Math.floor((code % (21 * 28)) / 28);
  const final = code % 28;

  const result: string[] = [char];

  // 1. 초성이 'ㄹ'(5)인 경우
  if (initial === INITIAL_R) {
    if (I_OR_Y_VOWEL_INDICES.has(vowel)) {
      // 제11항: 랴, 려, 례, 료, 류, 리 계열 -> 초성을 'ㅇ'(11)로 변경
      const transformedCode =
        HANGUL_BASE + (INITIAL_NG * 21 + vowel) * 28 + final;
      const transformedChar = String.fromCharCode(transformedCode);
      if (transformedChar !== char && !result.includes(transformedChar)) {
        result.push(transformedChar);
      }
    } else {
      // 제12항: 라, 래, 로, 뢰, 루, 르 계열 -> 초성을 'ㄴ'(2)로 변경
      const transformedCode =
        HANGUL_BASE + (INITIAL_N * 21 + vowel) * 28 + final;
      const transformedChar = String.fromCharCode(transformedCode);
      if (transformedChar !== char && !result.includes(transformedChar)) {
        result.push(transformedChar);
      }
    }
  }
  // 2. 초성이 'ㄴ'(2)인 경우
  else if (initial === INITIAL_N) {
    if (I_OR_Y_VOWEL_INDICES.has(vowel)) {
      // 제10항: 냐, 녀, 녜, 뇨, 뉴, 니 계열 -> 초성을 'ㅇ'(11)로 변경
      const transformedCode =
        HANGUL_BASE + (INITIAL_NG * 21 + vowel) * 28 + final;
      const transformedChar = String.fromCharCode(transformedCode);
      if (transformedChar !== char && !result.includes(transformedChar)) {
        result.push(transformedChar);
      }
    }
  }

  return result;
}

/**
 * 직전 단어의 끝 음절과 다음 단어의 첫 음절이 끝말잇기 규칙(직접 연결 또는 표준 두음법칙)에 부합하는지 판정합니다.
 *
 * @param prevLastSyllable 직전 단어의 마지막 음절
 * @param nextFirstSyllable 다음 단어의 첫 음절
 */
export function isChainConnected(
  prevLastSyllable: string,
  nextFirstSyllable: string
): boolean {
  if (!prevLastSyllable || !nextFirstSyllable) {
    return false;
  }

  const prevLast = prevLastSyllable.trim().slice(-1);
  const nextFirst = nextFirstSyllable.trim().slice(0, 1);

  if (!prevLast || !nextFirst) {
    return false;
  }

  // 1. 직접 연결 우선
  if (prevLast === nextFirst) {
    return true;
  }

  // 2. 표준 두음법칙 변형 확인
  const allowed = allowedNextInitials(prevLast);
  return allowed.includes(nextFirst);
}
