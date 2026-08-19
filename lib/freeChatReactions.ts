// 자유대화 규칙 기반 리액션 엔진 (LLM 호출 없음)
// 반영적 경청(reflective listening) 원칙: 정답/해결책 제공 X, 질문 남발 X, 판단·훈계 X.
// 케이는 아이와 동갑 친구 컨셉 — 항상 반말·편한 톤, 서술형 위주("~구나/~겠다"), 물음표 최소화.
//
// 문구 추가/수정은 이 파일만 고치면 된다(로직 변경 불필요).
// 판단 우선순위: 1) 안전 검사(최우선, 걸리면 나머지 전부 스킵) → 2) 위로/기쁨공감/놀람흥미 키워드 매칭
//              → 3) 아무것도 안 걸리면 중립경청 폴백.
//
// 안전 카테고리는 명백한 신호 위주로만 매칭해 오탐(멀쩡한 얘기를 위험으로 오인)을 최소화한다.
// 안전 응답은 케이가 혼자 해결하려 하지 않고, 반드시 아이가 믿는 어른(부모/선생님)에게 연결하도록 유도한다.

export type ReactionCategory = "safety" | "comfort" | "joy" | "surprise" | "neutral";

// neglect(방임)는 DB(safety_events.subcategory CHECK 제약)에 아직 반영 전 — 승인/마이그레이션 대기 중.
// 마이그레이션 실행 전까지는 neglect로 분류돼도 DB insert가 실패할 수 있음(에러는 로그로 남고 앱은 안 죽음).
export type SafetySubcategory = "violence" | "self_harm" | "threat" | "inappropriate_contact" | "neglect";

export interface ReactionResult {
  text: string;
  category: ReactionCategory;
  safetySubcategory?: SafetySubcategory;
  /** true면 부모에게 알려야 할 신호 — 실제 저장/알림 발송은 호출부(API route)에서 처리 */
  flaggedForParent: boolean;
}

// ── 1) 안전 검사 (최우선, 5개 세부 카테고리) ────────────────────────
// 아동 안전은 미탐(놓침)이 오탐보다 훨씬 위험 — 애매하면 안전 카테고리로 기울인다.
// 단, 명백한 관용표현(예: "배고파 죽겠어")과 제3자 얘기("쟤 왕따래")는 명시적으로 제외해
// 일상 대화가 안전 카테고리로 잘못 튀는 것만 방지한다.

// "죽겠다" 계열 관용구 — 자해 신호와 구별하기 위해 매칭 전 원문에서 제거한다.
const SELF_HARM_IDIOM_EXCLUSIONS = [
  "배고파 죽겠", "배고파서 죽겠", "웃겨 죽겠", "심심해 죽겠", "힘들어 죽겠",
  "피곤해 죽겠", "귀찮아 죽겠", "더워 죽겠", "추워 죽겠", "좋아 죽겠", "좋아서 죽겠",
  // 스포츠 용어. "자살"이 부분일치해 자해로 잡히던 것을 막는다(2026-08-19 실측).
  "자살골", "자책골",
];

const SELF_HARM_KEYWORDS = [
  "죽고싶", "죽고 싶", "죽어버리고싶", "죽어버리고 싶", "죽어버릴",
  "자살", "사라지고싶", "사라지고 싶", "없어지고싶", "없어지고 싶",
  "없어졌으면 좋겠", "살기 싫", "살고싶지 않", "살고 싶지 않",
  "태어나지 말았", "태어나지 않았", "태어나지 말걸", "다 사라졌으면", "다 끝내고 싶",
  "자해", "칼로 긋", "몸에 상처", "몸에 상처 내",
];

// 폭력/괴롭힘 — 아이 본인 얘기일 때만 안전 카테고리로 (남 얘기는 놀람흥미/중립으로 흘러가게 둔다)
const BULLYING_KEYWORDS = ["왕따", "괴롭혀", "괴롭힘", "따돌림", "따돌려", "집단으로 놀려"];
const BULLYING_THIRD_PERSON_MARKERS = ["쟤가", "쟤는", "쟤를", "걔가", "걔는", "걔를", "친구가 왕따", "친구가 괴롭", "다른 애가", "다른 애를"];
const BULLYING_FIRST_PERSON_MARKERS = ["나 왕따", "나만", "애들이 나를", "나를 괴롭", "나를 따돌", "날 따돌", "나한테", "내가 왕따", "나 괴롭"];

const VIOLENCE_KEYWORDS = [
  "때렸", "때리려", "맞았", "맞고", "맞을까", "꼬집", "꼬집혀",
  "폭행", "학대", "발로 찼", "손찌검",
];

// "맞다"는 "(맞아서) 아프다"와 "(점수를) 맞다/맞히다"라는 서로 무관한 두 뜻을 공유한다.
// "100점 맞았어"(성취) 같은 흔한 표현이 VIOLENCE_KEYWORDS의 "맞았"/"맞고"에 그대로
// 걸려 폭력 오탐(성적 자랑 → "심각한 일이니 부모님께 꼭 말해줘" 오응답)이 발생했다
// (agy E2E QA로 실제 재현·확인).
// 단순 부분문자열 제거(split/join)는 "문제 다 맞았어"처럼 채점 명사와 "맞다" 사이에
// "다/거의/전부/모두" 같은 말이 끼어들면 놓친다(codex-rv 2차 지적으로 발견 — "문제 맞았"가
// 연속 부분문자열이 아니라 그대로 남아 violence로 오분류됨). 그래서 정규식으로 "채점
// 명사 + (조사)? + (끼임말)? + 맞다 어간"을 통째로 지운다. "다 맞았"처럼 채점 명사 없이
// "다"만 있는 경우는 절대 넣지 않는다 — "다 같이 맞았어"처럼 실제 폭력 신호와 겹칠 수
// 있어 안전 쪽으로 기운다(미탐이 오탐보다 위험). 단독 "점"도 넣지 않는다 — "약점 맞았어"
// 처럼 실제 타격 의미의 문장까지 지워버릴 수 있어(codex-rv 3차 지적), 숫자가 바로 앞에
// 붙거나 "몇 점"일 때만 점수 문맥으로 인정한다.
const VIOLENCE_SCORING_CONTEXT_PATTERN =
  /(점수|정답|문제|만점|백점|빵점|\d+\s*점|몇\s*점)\s*(을|를|이나|도)?\s*(다|거의|전부|모두|하나)?\s*맞(았|고|을까)/g;

const THREAT_KEYWORDS = ["협박", "협박당했", "위협", "위협받았", "죽인다고 했", "가만 안 둔다고"];

// 부적절 접촉/노출/비밀 요구 등 문맥이 이미 명백한 고위험 표현 (단독으로 즉시 발동)
const INAPPROPRIATE_CONTACT_EXPLICIT_KEYWORDS = [
  "만지려", "만졌", "몸을 만", "옷을 벗", "비밀로 하래", "비밀로 하자고",
  "아무한테도 말하지마", "아무한테도 말하지 말", "우리끼리만", "엄마아빠한테 말하지마",
  "이상한 데 만", "이상한 데를 만", "사진 찍재", "사진 찍자고", "쉬하는 데",
  "둘만의 비밀",
  "만지라고", "만지라", "만지게", "더듬",
  "속옷을 벗", "바지를 벗", "팬티를 벗",
  "사진 찍으래", "사진 찍자래",
  "옷을 벗으래", "옷 벗으래", "옷을 벗으라고", "옷 벗으라고",
  "비밀로 하라고", "비밀로 해달래", "비밀로 하재",
];

// 음식/식재료 및 넌센스 복합어 — "고추" 부분일치로 인한 오탐을 방지하기 위해 매칭 전 제외
const FOOD_PEPPER_COMPOUND_EXCLUSIONS = [
  "초고추장", "고추장아찌", "배추고추장", "고추장", "고춧가루", "고추가루",
  "청양고추", "풋고추", "꽈리고추", "오이고추", "아삭이고추", "아삭고추",
  "홍고추", "당조고추", "고추기름", "고추냉이", "고추전", "고추튀김",
  "고추조림", "고추잡채", "고추씨", "고추피클", "고추절임", "고추부각",
  "고추참치", "고추순", "고추잎", "고춧잎", "마르고추", "건고추",
  "마른고추", "붉은고추",
  "고추소박이", "고추된장무침", "풋고추된장무침", "오이고추된장무침",
  "고추장떡", "고추지", "고추부침개", "고추순나물",
];

// 가슴 관련 일상 감정/신체 통증/운동 관용구 — "가슴" 부분일치로 인한 오탐 방지용 제외
const CHEST_IDIOM_EXCLUSIONS = [
  "달리기 하니까 가슴", "달리기해서 가슴", "운동하니까 가슴", "뛰고 나니 가슴",
  "숨차서 가슴", "숨 차서 가슴",
  "가슴이 두근두근", "가슴 두근두근", "가슴두근두근",
  "가슴이 쿵쾅쿵쾅", "가슴 쿵쾅쿵쾅", "가슴쿵쾅쿵쾅",
  "가슴이 아파", "가슴이 아팠", "가슴이 아프", "가슴 아파", "가슴 아팠", "가슴 아프", "가슴아파", "가슴아팠", "가슴아프", "가슴앓이",
  "가슴이 답답", "가슴 답답", "가슴답답",
  "가슴이 뛰어", "가슴이 뛰었", "가슴 뛰어", "가슴 뛰었", "가슴뛰어", "가슴뛰었",
  "가슴이 두근", "가슴 두근", "가슴두근",
  "가슴이 뭉클", "가슴 뭉클", "가슴뭉클",
  "가슴이 벅차", "가슴 벅차", "가슴벅차",
  "가슴이 찡", "가슴 찡", "가슴찡",
  "가슴이 철렁", "가슴 철렁", "가슴철렁",
  "가슴이 쿵", "가슴 쿵", "가슴쿵",
  "가슴이 쓰려", "가슴 쓰려", "가슴이 저려", "가슴 저려", "가슴이 뻐근", "가슴 뻐근",
  "가슴이 찢어", "가슴 찢어", "가슴이 미어", "가슴 미어",
  "가슴팍", "가슴뼈", "가슴통증", "가슴 통증", "가슴 높이", "가슴 둘레",
];

// 단독으로는 위험을 확정할 수 없는 짧고 애매한 신체 단어
const AMBIGUOUS_BODY_KEYWORDS = ["고추", "가슴"];

// 애매 단어와 결합하여 부적절 접촉/노출/성적 강요를 판정하는 신호
const AMBIGUOUS_CONTACT_RISK_SIGNALS = [
  "만지", "만졌", "만져", "만지려", "만지고", "만지라", "만지게", "만지지", "더듬", "주물", "만짐", "손을 대", "손대",
  "보여달", "보여줬", "보여주", "보여줘", "보여주라", "보여달래", "보여주래", "보여달라고", "보여주라고",
  "벗기", "벗겼", "벗겨", "벗으", "벗어", "벗으래", "벗으라고", "벗겨서",
  "바지 속", "팬티 속", "옷 속", "바지속", "팬티속", "옷속",
  "사진", "촬영", "찍재", "찍자", "찍으래",
  "비밀", "말하지", "이상한 짓", "뽀뽀", "핥", "빨아", "빨았",
  "쓰다듬", "주무르", "손댔", "손대려", "손대고", "이상한 데", "이상한데",
];

function detectInappropriateContact(text: string): boolean {
  // 1) 문맥이 이미 명백한 고위험 표현은 즉시 단독 발동
  if (includesAny(text, INAPPROPRIATE_CONTACT_EXPLICIT_KEYWORDS)) {
    return true;
  }

  // 2) 정상 음식 복합어 제외 (단어가 붙어 새로운 매칭이 생기지 않도록 공백으로 치환)
  let textWithoutFood = text;
  for (const food of FOOD_PEPPER_COMPOUND_EXCLUSIONS) {
    textWithoutFood = textWithoutFood.split(food).join(" ");
  }

  // 3) 문장에 위험 접촉/노출/강요 신호가 존재하는지 확인
  const hasRiskSignal = includesAny(textWithoutFood, AMBIGUOUS_CONTACT_RISK_SIGNALS);

  // 4) 가슴 관용구 처리:
  //    - 위험 접촉 신호("만져", "주물", "쓰다듬", "벗", "보여달", "사진", "비밀", "이상한 데" 등)가 문장에 있으면
  //      관용구 치환을 건너뛴다 ("만져서 가슴이 아파", "주물러서 가슴이 아파" 등에서 "가슴"이 사전 제거되어
  //      미탐이 발생하는 치명적 결함을 원천 방지).
  //    - 위험 신호가 없을 때만 가슴 관용구("달리기 하니까 가슴이 아파", "가슴이 두근두근" 등)를 공백으로 치환한다.
  let sanitized = textWithoutFood;
  if (!hasRiskSignal) {
    for (const idiom of CHEST_IDIOM_EXCLUSIONS) {
      sanitized = sanitized.split(idiom).join(" ");
    }
  }

  // 5) 제외 후 애매 단어("고추", "가슴")가 남아있는지 확인
  const hasAmbiguousTerm = AMBIGUOUS_BODY_KEYWORDS.some((kw) => sanitized.includes(kw));
  if (!hasAmbiguousTerm) {
    return false;
  }

  // 6) 애매 단어 단독은 발동하지 않고, 위험 접촉/노출/강요 신호가 함께 있을 때만 발동
  return hasRiskSignal;
}

// neglect(방임) — 세분화 검토 요청에 따라 추가. DB 마이그레이션 승인 전까지는 log-only 폴백될 수 있음.
const NEGLECT_KEYWORDS = ["밥 안 줘", "밥을 안 줘", "굶", "집에 혼자", "아무도 없어", "며칠 혼자", "혼자 있으래"];

const SAFETY_RESPONSES: Record<SafetySubcategory, string[]> = {
  // 자해/극단적 표현: 다그치거나 놀라는 톤 금지 — 감정을 먼저 따뜻하게 받아주고 부드럽게 어른과 연결.
  self_harm: [
    "그런 마음이 들 만큼 많이 힘들었구나. 케이한테 말해줘서 고마워. 이 마음은 꼭 엄마아빠나 선생님한테도 같이 얘기하자, 응?",
    "그런 생각이 들었구나... 많이 힘들었나보다. 케이가 계속 네 곁에 있을게, 그리고 이 얘기는 엄마아빠한테도 꼭 같이 나누자.",
    "말해줘서 정말 고마워. 혼자 그런 마음을 안고 있었을 텐데... 이제 엄마아빠나 선생님이랑 같이 얘기해보자, 응?",
  ],
  // 폭력/학대·괴롭힘: 심각성을 분명히 전달하되, 반드시 믿는 어른에게 연결.
  violence: [
    "그건 케이 혼자 도와주긴 어려워. 엄마아빠나 선생님한테 꼭 얘기해줘, 알았지?",
    "많이 놀라고 아팠겠다... 그런 건 꼭 믿는 어른한테 바로 말해줘야 해.",
    "그거 진짜 심각한 일이야. 케이 말고 엄마아빠한테 지금 꼭 말해줘, 알았지?",
  ],
  threat: [
    "그거 진짜 무서웠겠다. 그런 얘기는 케이 말고 엄마아빠나 선생님한테 꼭 알려줘야 해.",
    "많이 겁났겠다... 혼자 참지 말고 믿는 어른한테 꼭 얘기해줘, 알았지?",
  ],
  inappropriate_contact: [
    "그건 케이 혼자 도와주기 어려운 일이야. 지금 바로 엄마아빠한테 꼭 말해줘, 알았지?",
    "말해줘서 정말 고마워. 그런 일은 절대 비밀로 하지 말고 믿는 어른한테 꼭 알려줘야 해.",
  ],
  neglect: [
    "많이 힘들고 외로웠겠다... 그런 건 꼭 엄마아빠나 선생님, 아니면 다른 믿는 어른한테 얘기해줘야 해.",
    "그런 일이 있었구나. 혼자 참지 말고 믿을 수 있는 어른한테 꼭 알려줘, 알았지?",
  ],
};

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((kw) => text.includes(kw));
}

function detectSafetySubcategory(text: string): SafetySubcategory | null {
  // self_harm: 관용구("배고파 죽겠어" 등)만 있는 경우 제외하고 매칭 (공백으로 치환)
  const strippedForSelfHarm = SELF_HARM_IDIOM_EXCLUSIONS.reduce((t, idiom) => t.split(idiom).join(" "), text);
  if (includesAny(strippedForSelfHarm, SELF_HARM_KEYWORDS)) return "self_harm";

  const strippedForViolence = text.replace(VIOLENCE_SCORING_CONTEXT_PATTERN, " ");
  if (includesAny(strippedForViolence, VIOLENCE_KEYWORDS)) return "violence";

  // 폭력/괴롭힘 키워드가 있어도 명백히 제3자 얘기이고 본인 얘기라는 단서가 없으면 안전 카테고리에서 제외
  if (includesAny(text, BULLYING_KEYWORDS)) {
    const isThirdPersonOnly = includesAny(text, BULLYING_THIRD_PERSON_MARKERS) && !includesAny(text, BULLYING_FIRST_PERSON_MARKERS);
    if (!isThirdPersonOnly) return "violence";
  }

  if (includesAny(text, THREAT_KEYWORDS)) return "threat";
  if (detectInappropriateContact(text)) return "inappropriate_contact";
  if (includesAny(text, NEGLECT_KEYWORDS)) return "neglect";

  return null;
}

// ── 2) 위로 (부정 감정) ────────────────────────────────────────────
const COMFORT_KEYWORDS = [
  "속상", "슬퍼", "슬펐", "슬프", "울었", "울고", "눈물",
  "싫어", "짜증", "화나", "화났", "억울", "서운", "서러",
  "외로", "외로워", "아파", "아팠", "힘들", "힘들었",
  "우울", "미워", "밉다", "불안", "지쳤", "답답",
];

const COMFORT_RESPONSES = [
  "아이고 진짜 속상했겠다~",
  "저런 많이 힘들었구나~",
  "에고... 그거 진짜 짜증났겠다",
  "헐 완전 속상했겠다 그거",
  "너무 슬펐겠다...",
  "그거 진짜 서운했겠는데",
  "많이 아팠겠다...",
  "화날 만하다 진짜",
  "억울했겠다 그건",
  "혼자 있으니까 더 외로웠겠다",
  "울고 싶을 만했네...",
  "그런 일이 있었구나, 마음 아프다",
  "진짜 힘들었을 것 같아",
  "속상한 마음 다 이해돼",
  "그거 완전 짜증나는 일이네",
  "그런 기분 들 만해",
  "많이 답답했겠다",
  "그렇게 됐구나, 속상하겠다",
  "진짜 서럽다 그거",
  "그 마음 다 알 것 같아",
  "많이 지쳤겠다...",
];

// ── 3) 기쁨공감 (긍정 감정) ─────────────────────────────────────────
const JOY_KEYWORDS = [
  "좋아", "좋았", "재밌", "재미있", "신나", "신났",
  "최고", "행복", "웃", "웃었", "성공", "이겼",
  "칭찬", "뿌듯", "자랑", "신기", "대박", "기뻐", "기뻤", "럭키",
];

const JOY_RESPONSES = [
  "우와~ 진짜 신났겠다!",
  "오 완전 좋았겠는데?",
  "대박 완전 재밌었겠다!",
  "우와 진짜 최고다!",
  "헐 완전 신나는 일이네!",
  "오오 그거 진짜 뿌듯했겠다",
  "완전 행복했겠는데?",
  "우와 짱 잘했다!",
  "오 진짜 웃겼겠다 ㅋㅋ",
  "대박이다 진짜!",
  "우와 너무 좋았겠다!",
  "오 신기하다 진짜!",
  "완전 성공했네 축하해!",
  "우와 그거 완전 자랑할 만하다",
  "진짜 기분 좋았겠다!",
  "오 대박 완전 잘됐다!",
  "우와 너무 재밌었겠다 진짜",
  "그거 진짜 짜릿했겠다!",
  "완전 신났겠는데 너?",
  "우와 최고의 하루였네!",
  "오 진짜 뿌듯하겠다!",
  "완전 럭키했네!",
];

// ── 4) 놀람흥미 (사건/이야기 전개) ──────────────────────────────────
const SURPRISE_KEYWORDS = [
  "그래서", "있잖아", "봤어", "봤는데", "갔어", "갔는데",
  "만났", "생겼", "어제", "오늘", "그런데", "근데",
];

const SURPRISE_RESPONSES = [
  "오~ 그래서 어떻게 됐어?",
  "헐 진짜?",
  "오 뭔데 뭔데?",
  "완전 궁금하다, 계속 말해줘!",
  "헐 대박 그래서?",
  "오 진짜? 더 얘기해줘!",
  "와 신기하다 그거!",
  "헐 그거 어떻게 된 거야?",
  "오오 계속 들려줘!",
  "진짜? 그다음은?",
  "오 완전 궁금해지는데?",
  "헐 실화야?",
  "와 그래서 그다음엔?",
  "오 재밌겠다 계속해봐!",
  "헐 대박이다 그거!",
  "진짜 그런 일이 있었어?",
  "오 완전 흥미진진하다!",
  "헐 신기하네 진짜!",
  "오 그래서 어떻게 됐는데?",
  "완전 궁금한데 더 말해줘!",
];

// ── 5) 중립경청 (폴백) ─────────────────────────────────────────────
const NEUTRAL_RESPONSES = [
  "그랬구나~",
  "응응 듣고 있어~",
  "오 그렇구나",
  "케이한테 더 얘기해줘~",
  "음~ 그렇구나",
  "그래 그래, 계속 얘기해봐",
  "오케이 듣고 있어!",
  "그렇구나, 더 있어?",
  "응 응, 알겠어",
  "그런 일이 있었구나",
  "케이가 다 듣고 있어~",
  "오호 그래서?",
  "음 그렇군",
  "그랬어? 더 말해줘",
  "케이 여기 있어, 계속 얘기해",
];

function classifyNonSafety(text: string): Exclude<ReactionCategory, "safety"> {
  if (includesAny(text, COMFORT_KEYWORDS)) return "comfort";
  if (includesAny(text, JOY_KEYWORDS)) return "joy";
  if (includesAny(text, SURPRISE_KEYWORDS)) return "surprise";
  return "neutral";
}

function poolFor(category: Exclude<ReactionCategory, "safety">): string[] {
  switch (category) {
    case "comfort": return COMFORT_RESPONSES;
    case "joy": return JOY_RESPONSES;
    case "surprise": return SURPRISE_RESPONSES;
    case "neutral": return NEUTRAL_RESPONSES;
  }
}

/** 풀에서 랜덤 선택하되, 직전에 케이가 실제로 말한 문장과 동일한 문장은(풀에 다른 선택지가 있다면) 피한다.
 *  앵무새처럼 같은 문장을 연속 반복하는 것을 방지하기 위함. */
function pickRandomAvoiding(pool: string[], avoid?: string): string {
  const candidates = avoid && pool.length > 1 ? pool.filter((p) => p !== avoid) : pool;
  const list = candidates.length > 0 ? candidates : pool;
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * 아이 발화 텍스트를 규칙 기반으로 분류해 케이의 리액션을 반환한다(LLM 미사용).
 * @param childText 아이가 방금 한 말(STT 전사 텍스트)
 * @param lastKText 직전에 케이가 실제로 말했던 문장(있으면 동일 문장 연속 반복 방지에 사용)
 */
export function pickReaction(childText: string, lastKText?: string): ReactionResult {
  const safetySub = detectSafetySubcategory(childText);
  if (safetySub) {
    const text = pickRandomAvoiding(SAFETY_RESPONSES[safetySub], lastKText);
    return { text, category: "safety", safetySubcategory: safetySub, flaggedForParent: true };
  }

  const category = classifyNonSafety(childText);
  const pool = poolFor(category);
  const text = pickRandomAvoiding(pool, lastKText);
  return { text, category, flaggedForParent: false };
}

// ── 6) safety_events 단시간 중복 방지 (DB-based Deduplication Guard) ──
// 동일 childId + 동일 subcategory + 동일 발화 텍스트가 짧은 시간(60초) 내에 DB에 이미 존재할 때
// 중복 insert 및 중복 이벤트 발생을 방지한다 (요청서 §3-8 요구사항).
// Vercel 서버리스 환경에서 인스턴스 격리/재시작과 무관하게 DB 조회를 통해 중복을 차단한다.
export const SAFETY_EVENT_DEDUPE_TTL_MS = 60_000; // 60초

export interface InsertSafetyEventParams {
  sessionId?: string | null;
  childId?: string | null;
  subcategory?: SafetySubcategory | string;
  childText: string;
  source?: string;
}

/**
 * DB 조회를 통해 동일 child + 동일 subcategory + 동일 발화가 최근 TTL(60초) 내에 존재하는지 확인한다.
 * DB 조회 실패 시에는 아동 안전 이벤트 누락을 방지하기 위해 fail-open(중복 아님으로 간주하여 insert 진행)한다.
 */
export async function isRecentDuplicateSafetyEvent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseClient: any,
  params: InsertSafetyEventParams,
  nowMs: number = Date.now()
): Promise<boolean> {
  try {
    const trimmedText = params.childText?.trim();
    if (!trimmedText || !params.subcategory) return false;

    const sinceIso = new Date(nowMs - SAFETY_EVENT_DEDUPE_TTL_MS).toISOString();

    let query = supabaseClient
      .from("safety_events")
      .select("id")
      .eq("child_text", trimmedText)
      .eq("subcategory", params.subcategory)
      .gte("created_at", sinceIso);

    if (params.childId) {
      query = query.eq("child_id", params.childId);
    } else if (params.sessionId) {
      query = query.eq("session_id", params.sessionId);
    }

    const { data, error } = await query.limit(1);

    if (error) {
      console.warn("[safety_events] dedupe check query failed (failing open):", error.message);
      return false; // fail-open: DB 조회 에러 시 insert 차단하지 않음
    }

    if (Array.isArray(data)) {
      return data.length > 0;
    }
    return Boolean(data);
  } catch (err) {
    console.warn("[safety_events] dedupe check threw (failing open):", (err as Error).message);
    return false; // fail-open
  }
}

/**
 * safety_events 테이블에 이벤트를 기록하되, 동일 child + 카테고리 + 발화의 단시간 중복 insert를 차단한다.
 * DB 조회를 통해 중복 여부를 판별하며, 조회 실패 시 fail-open으로 insert를 진행한다.
 */
export async function insertSafetyEventWithDedupe(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseClient: any,
  params: InsertSafetyEventParams,
  nowMs: number = Date.now()
): Promise<{ inserted: boolean; duplicate: boolean; error?: unknown }> {
  if (!params.childText || !params.subcategory) {
    return { inserted: false, duplicate: false };
  }

  const isDup = await isRecentDuplicateSafetyEvent(supabaseClient, params, nowMs);
  if (isDup) {
    return { inserted: false, duplicate: true };
  }

  const { error } = await supabaseClient.from("safety_events").insert({
    session_id: params.sessionId || null,
    child_id: params.childId || null,
    subcategory: params.subcategory,
    child_text: params.childText,
    source: params.source ?? "QUESTION_ENGINE",
  });

  if (error) {
    console.error("[safety_events] insert failed:", error.message);
  }

  return { inserted: !error, duplicate: false, error };
}
