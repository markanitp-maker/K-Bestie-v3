/**
 * 아이가 "내가 ~라고 했잖아"처럼 **단정**했는데, 그 내용이 실제 기억에 없을 때
 * 케이가 맞장구치는지 검사한다.
 *
 * 왜 출력을 검사하나 — 2026-08-17 Dev QA(김서아) 2회 실측:
 *
 *   1차: 프롬프트에 "추측하거나 빈칸을 지어내지 마"가 이미 있었다.
 *        아이: "내가 지난주에 놀이공원 갔다고 했잖아"
 *        케이: "아 맞다, 놀이공원 갔다고 했었지! 거기서 제일 재밌었던 건 뭐였어?"
 *
 *   2차: 단정형 상황을 명시하고 대안 문구까지 줬는데도 4종 전부 날조했다.
 *        케이: "강아지도 키우고 태권도도 다니는구나. 오 근데 어떤 강아지야?"
 *        → 아이가 따로 말한 두 가지를 스스로 결합하기까지 했다.
 *
 * 지침은 강제력이 없다. 오늘만 세 번째다(가짜 게임, 정답 선공개, 기억 날조).
 *
 * 기억 못 하는 건 아쉬운 정도지만, 안 한 얘기를 "맞아 그랬지"라고 하는 건
 * 아이를 속이는 것이다. 나중에 아이가 알아차리면 케이가 한 모든 기억 이야기를
 * 못 믿게 된다. 절친 관계에서 가장 크게 잃는 실패다.
 *
 * 정책 변경 (2026-08-17 대표 지시):
 * 베타 기간에는 블랙리스트 정책을 쓴다.
 * "기억에 없는 낱말을 되받기만 하면 차단"(화이트리스트)하던 5단계 규칙을 삭제하고,
 * 실제 관찰된 나쁜 패턴(명시적 동의, 거짓 망각, 단정 어미 기정사실화)만 차단한다.
 * 기억 대조(grounded)는 1글자 명사 및 원형·조사제거형 모두 대조하여 최대한 관대하게 통과시킨다.
 */

/** 아이가 과거를 단정하는 말투인가. "~했잖아", "~라고 했지" 같은 형태. */
const CHILD_ASSERTION_PATTERNS = [
  /했잖아/,
  /말했잖아/,
  /얘기했잖아/,
  /라고\s*했지(?!\?)/,
  /했었지(?!\?)/,
  /알려줬잖아/,
];

/**
 * 차단 목록 1 — 케이가 동의하는 말투인가.
 * "맞다", "맞아", "그랬지", "그랬구나", "했었지" 같은 확인 표현.
 */
const K_AGREEMENT_PATTERNS = [
  /맞다/,
  /맞아/,
  /그랬지/,
  /그랬구나/,
  /했었지/,
  /했지/,
  /기억나/,
  /기억해/,
  /기억하고\s*있/,
  /기억나지/,
  /얘기했었/,
  /해줬었/,
];

/**
 * 차단 목록 2 — 거짓 망각 말투인가 (2026-08-17 실측 4종 공통).
 * 없던 기억을 "내가 잊었다/깜빡했다"고 말하는 것은 그 기억이 있었다고 인정하는 가장 확실한 신호다.
 */
const K_FALSE_FORGETTING_PATTERNS = [
  /깜빡했/,
  /깜빡하/,
  /정신이\s*없었/,
  /내\s*정신\s*좀\s*봐/,
  /정신\s*좀\s*봐/,
  /내\s*정신/,
  /잊어버렸/,
  /잊었네/,
  /내가\s*자꾸/,
];

/** 케이가 모른다고 하는 말투인가. 이게 있으면 동의가 아니다. */
const K_DISCLAIMER_PATTERNS = [
  /기억(이)?\s*(잘)?\s*안\s*나/,
  /기억이\s*안\s*나/,
  /잘\s*모르겠/,
  /처음\s*듣/,
  /말해준\s*적/,
  /다시\s*말해\s*줄래/,
  /얘기해\s*줬었어\?/,
  /알려\s*줄래/,
];

/** 차단 목록 3 — 단정 어미로 기정사실화하는 패턴 (~구나 / ~겠다 / ~겠네 / ~겠어). */
const K_ASSERTIVE_ENDINGS = /(?:구나|겠다|겠네|겠어)/;

/**
 * 기능어·조사·일반 부사·존재사 등 기억 일치(grounded) 판정에서 제외할 단어 목록.
 * 이것들이 기억 문장에 우연히 포함되어 있어도(예: "있다고", "했다", "내가", "아까")
 * 실제 내용에 대한 회상으로 인정하지 않는다.
 */
const GROUNDING_EXCLUDED_WORDS = new Set([
  // 인칭 / 대명사
  "내가", "너가", "네가", "나는", "너는", "나도", "너도", "나", "너", "내", "날",
  "우리", "우리가", "우리는", "저희", "그", "그거", "이거", "저거",
  // 단정 / 전달 어미 / 기능어
  "했잖아", "말했잖아", "얘기했잖아", "알려줬잖아", "했었잖아", "그랬잖아",
  "라고", "이라고", "다는", "라는", "이라는",
  "다고", "하고", "이고", "하며", "하고는",
  "했지", "했었지", "말했지", "알지", "그치", "맞지",
  // 존재사 / 기본 보조용언 (기억 문장에 흔히 등장하므로 단독 일치 배제)
  "있다", "있다고", "있었어", "있었지", "있는데", "있어", "있는", "있지", "있",
  "없다", "없다고", "없었어", "없었지", "없는데", "없어", "없는", "없지", "없",
  "했다", "했다고", "했어", "하는", "한다", "한다고", "하면",
  "이다", "이다고", "이야", "이에요", "예요",
  "되다", "된다", "된다고", "됐어", "됐다", "됐다고",
  // 시간 부사 / 일반 부사
  "아까", "전에", "저번에", "지난번에", "그때", "방금", "예전에", "옛날에",
  "거야", "거", "것", "거잖아", "거였잖아", "잖아", "거든",
  "진짜", "정말", "완전", "자꾸", "계속", "그냥", "너무", "엄청", "많이", "잘",
  "응", "어", "음", "오", "아", "와", "네", "예",
]);

export interface FabricatedRecallVerdict {
  /** 없는 기억에 동의하는 응답인가. */
  isFabricated: boolean;
  reason?: string;
}

/**
 * 낱말마다 대조에 쓸 표기 후보를 묶어서 돌려준다.
 *
 * 한 낱말이 원형·조사제거형·어미제거형으로 여러 개가 나오므로 **반드시 낱말 단위로
 * 묶어야** 한다. 평평한 목록으로 세면 "키운다고"가 표기 3개로 부풀어 기억 일치
 * 비율이 낮게 계산되고, 진짜 회상이 차단된다(2026-08-17 실측).
 */
export function contentWordVariants(text: string): string[][] {
  const rawWords = text
    .replace(/[^가-힣\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0);

  return rawWords.map((word) => {
    const variants = new Set<string>();
    variants.add(word); // 원형 (예: "포도", "형이", "돈", "밥")

    // 1) 일반 조사 및 어미 제거형 (예: "형이" -> "형", "포도를" -> "포도")
    const stripped = word.replace(
      /(?:이라고|라고|이라는|라는|했잖아|했지|한다고|이다|에서|에게|한테|으로|로|이랑|랑|과|와|은|는|이|가|을|를|도|만|의|에|요)$/,
      "",
    );
    if (stripped.length > 0) variants.add(stripped);

    // 2) 용언 어미 활용 (예: "키운다고" -> "키운다", "모은다고" -> "모은다")
    if (word.endsWith("다고")) {
      const strippedGo = word.slice(0, -1);
      if (strippedGo.length > 0) variants.add(strippedGo);
    }

    return Array.from(variants);
  });
}

/** 표기를 평평하게 편 목록. 케이 응답 되받기 검사처럼 낱말 묶음이 필요 없을 때 쓴다. */
export function contentTokens(text: string): string[] {
  return Array.from(new Set(contentWordVariants(text).flat()));
}

/**
 * 아이 발화가 단정형이고, 그 내용이 기억에 없는데 케이가 동의하면 true.
 *
 * @param childUtterance 아이가 방금 한 말
 * @param kResponse 케이가 만든 응답
 * @param knownMemoryTexts 실제로 가지고 있는 기억 문장들
 */
export function detectFabricatedRecall(
  childUtterance: string,
  kResponse: string,
  knownMemoryTexts: readonly string[],
): FabricatedRecallVerdict {
  if (!childUtterance || !kResponse) return { isFabricated: false };

  // 1) 아이가 단정하지 않았으면 이 검사 대상이 아니다.
  if (!CHILD_ASSERTION_PATTERNS.some((p) => p.test(childUtterance))) {
    return { isFabricated: false };
  }

  // 2) 기억 대조 (Grounded check).
  //
  // 낱말 **하나만** 맞아도 통과시키면 흔한 동사 하나에 거짓말이 얹혀 통과한다.
  // 2026-08-17 실측: 같은 세션에 "오늘 학교 갔다 왔어"가 있으면
  // "내가 지난주에 놀이공원 갔다고 했잖아"의 "갔다"가 걸려 grounded 가 되고,
  // 케이가 "아 맞다, 놀이공원 갔다고 했었지!"라고 해도 가드가 안 걸렸다.
  //
  // 그래서 **낱말의 절반 이상**이 기억에 있어야 회상으로 인정한다.
  //   "형(O) 있다(O)"            2/2 → 회상
  //   "돈(O) 모은다(X)"          1/2 → 회상 (절반은 채운다)
  //   "지난주(X) 놀이공원(X) 갔다(O)" 1/3 → 회상 아님 → 차단 대상
  // 단어 단위 단순 비교라 형태소 분석만큼 정확하진 않지만, 양방향 실측으로
  // 진짜 회상 7종 통과 / 실측 날조 5종 차단을 확인한 기준이다.
  const memoryBlob = knownMemoryTexts.join(" ");
  // 낱말 단위로 센다. 한 낱말의 표기 중 **하나라도** 기억에 있으면 그 낱말은 맞은 것이다.
  const candidateWords = contentWordVariants(childUtterance).filter(
    (variants) => !variants.some((v) => GROUNDING_EXCLUDED_WORDS.has(v)),
  );
  const groundedCount = candidateWords.filter((variants) =>
    variants.some((v) => v.length >= 1 && memoryBlob.includes(v)),
  ).length;
  const grounded = candidateWords.length > 0 && groundedCount * 2 >= candidateWords.length;
  if (grounded) return { isFabricated: false };
  const candidateTokens = candidateWords.flat();

  // 3) 차단 목록 1 — 명시적 동의어가 있으면 날조다 (면책 표현이 섞여 있어도 동의가 우선).
  if (K_AGREEMENT_PATTERNS.some((p) => p.test(kResponse))) {
    return {
      isFabricated: true,
      reason: "아이가 단정한 내용이 기억에 없는데 케이가 동의했다",
    };
  }

  // 4) 차단 목록 2 — 거짓 망각 (깜빡했/정신없었 등)으로 없는 기억을 인정한 경우 차단.
  if (K_FALSE_FORGETTING_PATTERNS.some((p) => p.test(kResponse))) {
    return {
      isFabricated: true,
      reason: "기억에 없는 내용을 케이가 거짓 망각(깜빡/정신없음 등)으로 인정했다",
    };
  }

  // 5) 케이가 모른다고 면책한 경우 통과 (차단 목록 3보다 우선).
  if (K_DISCLAIMER_PATTERNS.some((p) => p.test(kResponse))) {
    return { isFabricated: false };
  }

  // 6) 차단 목록 3 — 아이가 단정한 2글자 이상 낱말을 되받으며 단정 어미(~구나/~겠다/~겠네/~겠어)로 끝맺는 경우.
  const echoedTokens = candidateTokens.filter((t) => t.length >= 2 && kResponse.includes(t));
  if (echoedTokens.length > 0 && K_ASSERTIVE_ENDINGS.test(kResponse)) {
    return {
      isFabricated: true,
      reason: `기억에 없는 낱말(${echoedTokens.join(", ")})을 단정 어미로 기정사실화했다`,
    };
  }

  // 7) 블랙리스트 정책: 확인된 나쁜 패턴 외에는 통과
  return { isFabricated: false };
}

/**
 * 차단됐을 때 대신 내보낼 문구.
 *
 * 침묵은 안 된다. 아이가 말했는데 응답이 없으면 무시당했다고 느낀다.
 * 모른다고 솔직히 말하고 아이에게 되묻는 것이 절친의 태도다.
 */
export const FABRICATED_RECALL_FALLBACK_TEXT =
  "음, 그건 내가 잘 기억이 안 나네. 다시 얘기해 줄래?";
