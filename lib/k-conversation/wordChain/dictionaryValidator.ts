import { WordChainEntry, deriveWordChainEntry } from "./dictionaryTypes";

export interface DictionaryIssue {
  word: string;
  reason: string;
}

/**
 * 아동 안전 기준에 따른 금지어 키워드 목록.
 * 출처: 방송통신심의위원회 인터넷 내용등급기준 및 K-Bestie 아동 보호/안전 가이드라인 (§3-13 EXCLUDE).
 * 비속어, 욕설, 성적 표현, 음란물, 폭력, 약물, 사행성 표현 등을 부분 문자열 매칭으로 차단합니다.
 */
export const FORBIDDEN_KEYWORDS: readonly string[] = [
  // 1. 비속어, 욕설, 비하 및 모욕 표현
  "시발", "씨발", "존나", "졸라", "병신", "개새끼", "닥쳐", "지랄", "새끼", "쌍년", "미친년", "미친놈",
  "뒈져", "뒤져", "빡쳐", "꺼져", "젠장", "찌질", "엠창", "패드립", "느금마", "니애미", "니애비", "느개비",
  "썅", "개자식", "잡것", "호구", "찐따", "걸레", "틀딱", "한남", "한녀", "맘충", "급식충", "일베",
  "메갈", "개돼지", "등신", "호로", "애자", "장애인비하", "머가리", "대가리깨",

  // 2. 성적, 음란, 성인물 표현
  "섹스", "성교", "성기", "자지", "보지", "유두", "자위", "포르노", "야동", "콘돔", "사정", "음란",
  "성폭행", "강간", "성추행", "매춘", "윤락", "원조교제", "발기", "음경", "음순", "포경", "처녀",
  "성매매", "자궁", "정액", "사타구니", "가슴만", "엉덩이만", "변태", "오르가즘", "애무",

  // 3. 폭력, 자해, 살상, 범죄, 약물, 사행성 표현
  "살인", "자살", "살해", "도살", "학살", "시체", "마약", "대마초", "필로폰", "코카인", "헤로인", "담배",
  "도박", "칼부림", "칼빵", "폭행", "고문", "유괴", "납치", "인질", "테러", "권총", "소총", "수류탄",
  "카지노", "경마", "사채", "성인용품", "바카라", "불법토토"
] as const;

/**
 * 동사/형용사 용언 파생 접미사 의심 목록 (2음절 이상 단어 종결형).
 */
const VERB_ADJECTIVE_DERIVATION_SUFFIXES = [
  "하다", "되다", "스럽다", "롭다", "답다", "시키다", "거리다", "대다", "맞다"
] as const;

/**
 * 용언 종결 어미 / 대화체 / 과거형 / 연결 어미 의심 목록 (2음절 이상 단어 종결형).
 */
const VERB_ENDING_SUFFIXES = [
  // 과거/완료/미래 시제 종결
  "했다", "됐다", "렸다", "겼다", "았다", "었다", "였다", "겠다", "쳤다", "났다", "봤다", "줬다", "왔다", "갔다", "섰다", "졌다",
  // 현재형 종결 어미 및 대표 활용형
  "는다", "은다", "ㅂ니다", "습니다", "린다", "킨다", "친다", "춘다", "운다", "든다", "본다", "간다", "온다", "준다", "산다", "안다",
  // 청유/명령/감탄
  "하자", "가자", "먹자", "보자", "구나", "잖아", "시오", "ㅂ시다", "읍시다",
  // 대화체/존댓말 어미
  "어요", "아요", "여요", "지요", "네요", "세요", "데요", "군요", "죠",
  // 연결 어미
  "하고", "하며", "하니", "하면", "해서", "이고", "이며", "이면", "이라서", "이지만", "는데", "은데", "는지", "은지", "을까", "ㄹ까", "을래"
] as const;

/**
 * 2음절 이상 조사 결합 의심 접미사 목록.
 */
const PARTICLE_SUFFIXES = [
  "처럼", "만큼", "보다", "마저", "조차", "부터", "까지", "에게", "한테", "에서", "으로", "로써", "로서", "이라도", "커녕", "이나마"
] as const;

/**
 * 한글 완성형 음절 정규식 (가-힣).
 */
const HANGUL_SYLLABLES_REGEX = /^[가-힣]+$/;

/**
 * 끝말잇기 사전 엔트리 목록을 전수 검증하여 위반 항목 목록을 반환합니다.
 */
export function validateWordChainDictionary(entries: readonly WordChainEntry[]): DictionaryIssue[] {
  const issues: DictionaryIssue[] = [];
  const seenNormalizedWords = new Set<string>();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const originalWord = entry.word ?? "";
    const derived = deriveWordChainEntry(entry);
    const normalized = derived.normalizedWord;

    // 1. 단어 존재 및 공백 검사
    if (!originalWord || originalWord.trim().length === 0) {
      issues.push({ word: originalWord, reason: "단어가 비어 있습니다." });
      continue;
    }

    if (/\s/.test(originalWord)) {
      issues.push({ word: originalWord, reason: "단어에 공백이 포함되어 있습니다." });
    }

    // 2. 한글 완성형 음절 검사 (자모 단독, 영문, 숫자, 기호 차단)
    if (!HANGUL_SYLLABLES_REGEX.test(normalized)) {
      issues.push({
        word: originalWord,
        reason: "한글 완성형 음절(가-힣)이 아닌 문자(자모, 영문, 숫자, 특수문자 등)가 포함되어 있습니다."
      });
    }

    // 3. 단어 길이 및 1음절 검사
    if (normalized.length < 1) {
      issues.push({ word: originalWord, reason: "단어 음절 길이가 1 미만입니다." });
    }

    // 4. 난이도(difficulty) 1~6 정수 검사
    if (
      typeof entry.difficulty !== "number" ||
      !Number.isInteger(entry.difficulty) ||
      entry.difficulty < 1 ||
      entry.difficulty > 6
    ) {
      issues.push({
        word: originalWord,
        reason: `난이도(difficulty)가 1~6 범위의 정수가 아닙니다 (현재값: ${entry.difficulty}).`
      });
    }

    // 5. 중복 단어 검사 (정규화 기준)
    if (seenNormalizedWords.has(normalized)) {
      issues.push({
        word: originalWord,
        reason: `중복된 단어입니다 (정규화: ${normalized}).`
      });
    } else {
      seenNormalizedWords.add(normalized);
    }

    // 6. 금지어 검사 (부분 문자열 매칭)
    for (const forbidden of FORBIDDEN_KEYWORDS) {
      if (normalized.includes(forbidden)) {
        issues.push({
          word: originalWord,
          reason: `금지어 키워드('${forbidden}')가 포함되어 있습니다.`
        });
        break;
      }
    }

    // 7. 동사/형용사 파생 접미사 검사
    for (const suffix of VERB_ADJECTIVE_DERIVATION_SUFFIXES) {
      if (normalized.length > suffix.length && normalized.endsWith(suffix)) {
        issues.push({
          word: originalWord,
          reason: `동사/형용사 파생 접미사('~${suffix}')로 끝나는 활용형 의심 단어입니다.`
        });
        break;
      }
    }

    // 8. 용언 종결 어미 / 대화체 / 연결 어미 검사
    for (const suffix of VERB_ENDING_SUFFIXES) {
      if (normalized.length > suffix.length && normalized.endsWith(suffix)) {
        issues.push({
          word: originalWord,
          reason: `용언 종결/연결 어미('~${suffix}')로 끝나는 활용형 의심 단어입니다.`
        });
        break;
      }
    }

    // 9. 2음절 이상 조사 결합 의심 검사
    for (const suffix of PARTICLE_SUFFIXES) {
      if (normalized.length > suffix.length && normalized.endsWith(suffix)) {
        issues.push({
          word: originalWord,
          reason: `조사 결합 형태('~${suffix}')로 끝나는 의심 단어입니다.`
        });
        break;
      }
    }

    // 10. acceptedAliases 검사
    if (entry.acceptedAliases && Array.isArray(entry.acceptedAliases)) {
      const aliasSet = new Set<string>();
      for (const alias of entry.acceptedAliases) {
        const normAlias = (alias ?? "").replace(/\s+/g, "");

        if (!normAlias || !HANGUL_SYLLABLES_REGEX.test(normAlias)) {
          issues.push({
            word: originalWord,
            reason: `별칭('${alias}')이 올바른 한글 완성형 음절이 아닙니다.`
          });
        }

        if (normAlias === normalized) {
          issues.push({
            word: originalWord,
            reason: `별칭('${alias}')이 원본 단어와 동일합니다.`
          });
        }

        if (aliasSet.has(normAlias)) {
          issues.push({
            word: originalWord,
            reason: `별칭('${alias}')이 별칭 목록 내에서 중복됩니다.`
          });
        } else {
          aliasSet.add(normAlias);
        }

        // 별칭에 대해서도 금지어 검사
        for (const forbidden of FORBIDDEN_KEYWORDS) {
          if (normAlias.includes(forbidden)) {
            issues.push({
              word: originalWord,
              reason: `별칭('${alias}')에 금지어 키워드('${forbidden}')가 포함되어 있습니다.`
            });
            break;
          }
        }
      }
    }
  }

  return issues;
}
