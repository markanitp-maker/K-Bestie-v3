export const QUESTION_FAMILIES = [
  "SCHOOL_HIGHLIGHT",
  "SCHOOL_CLASS",
  "FRIEND_PLAY",
  "FRIEND_FUNNY",
  "FRIEND_CONFLICT",
  "GAME_TODAY",
  "VIDEO_TODAY",
  "ACADEMY_TODAY",
  "ACADEMY_LEARNING",
  "FOOD_TODAY",
  "OUTING_TODAY",
  "WEEKEND_EXPECTATION",
  "WEEKEND_HIGHLIGHT",
  "MOOD_TODAY",
  "ACHIEVEMENT_TODAY",
  "RAPPORT_INTEREST",
  "RAPPORT_PREFERENCE",
  "RAPPORT_COMMUNICATION_STYLE",
  // 078 Phase A-2 신규 확장 (20건 이상 명확 군집)
  "FAMILY_TODAY",
  "DAILY_HIGHLIGHT",
  "FUTURE_EXPECTATION",
  "ADULT_SUPPORT",
] as const;

export type QuestionFamily = (typeof QUESTION_FAMILIES)[number];

export interface ClassifyQuestionFamilyInput {
  questionText: string;
  semanticGroup?: string | null;
  topic?: string | null;
}

/**
 * 078 Phase A — 질문은행 family 분류기
 * 문장 표현이 달라도 사실상 동일한 질문을 하나의 question_family로 묶는다.
 * 22개 family 중 명확히 부합하지 않는 질문은 null을 반환한다.
 */
export function classifyQuestionFamily(input: ClassifyQuestionFamilyInput): QuestionFamily | null {
  const text = (input.questionText || "").trim();
  if (!text) {
    return null;
  }

  const sg = (input.semanticGroup || "").trim().toUpperCase();

  // 1. RAPPORT_COMMUNICATION_STYLE: 케이와의 대화/질문 방식, 대화 주제 선호
  if (
    /(케이|케이가|케이랑|케이에게).*(어떻게 말|어떤 식|질문|대화|이야기|말했으면|애처럼|편해|말하면|하고 싶은 얘기|얘기하면|제일 얘기|잘못 알아들으면|장난스럽게)/.test(text) ||
    /케이랑 (무슨 이야기|앞으로|제일 얘기)/.test(text) ||
    /케이가 (질문할 때|너무 질문|친구처럼|너무 애처럼|네 말을)/.test(text) ||
    /게임 얘기.*학교 얘기.*친구 얘기/.test(text) ||
    /어떤 얘기부터 하는 게 제일 편해/.test(text) ||
    /월요일엔 케이랑 무슨 얘기/.test(text) ||
    /오늘 케이랑 제일 얘기하고 싶은/.test(text) ||
    /말하기 싫은 질문이 나오면 케이에게/.test(text)
  ) {
    return "RAPPORT_COMMUNICATION_STYLE";
  }

  // 2. RAPPORT_PREFERENCE: 호칭/이름/케이에게 기억해줬으면 하는 취향
  if (
    /(뭐라고 불러|어떻게 불러|이름이 뭐야|넌 누구니|별명|이름의 뜻)/.test(text) ||
    /(케이가|케이에게|케이한테).*(기억|알려줘|알아줬|취향)/.test(text) ||
    /기억해주면.*(나 좀 아네|좋을|편할|다음 대화)/.test(text) ||
    /꼭 기억했으면 하는/.test(text) ||
    /기억해두면 다음 대화가 좋은/.test(text) ||
    /기억하면 대화가 더 편할/.test(text) ||
    /케이가 너를 뭐라고 부르면/.test(text) ||
    /케이는 너랑 친해지고 싶은데.*뭐라고/.test(text)
  ) {
    return "RAPPORT_PREFERENCE";
  }

  // 3. RAPPORT_INTEREST: 좋아하는 동물/캐릭터/놀이/관심사/취향 (초기 친해지기 취향)
  if (
    /(좋아하는 동물|좋아하는 캐릭터|좋아하는 놀이|좋아하는 노래|좋아하는 소리)/.test(text) ||
    /요즘.*(관심사|머릿속을 제일 많이 차지|시간 가는 줄 모르고|빠져 있는|취향 제대로인|제일 좋아하는 것은|새로 좋아하게 된|새롭게 좋아하게 된|자주 듣는 노래|새로 관심|새로운 관심)/.test(text) ||
    /쉬는 날에는 무엇을 하면서/.test(text) ||
    /예전에는 좋아했는데 요즘은 덜 좋아하게 된/.test(text) ||
    /세 달 전과 비교해서 새로 좋아하게 된/.test(text) ||
    /혼자 할 때 재미있는 것과 친구랑 할 때/.test(text) ||
    /친구에게 (추천|알려주고) 싶은 재미있는/.test(text) ||
    /전에 네가 좋아한다고 말했던/.test(text) ||
    (sg === "RAPPORT_IDENTITY" && /(좋아하는|관심|취향|놀이|너에 대해|이름)/.test(text)) ||
    (sg === "INTEREST_AND_PREFERENCE" && /(좋아하는|관심사|시간 가는 줄|빠져 있는|취향|재미있어진|좋아하게 된|하고 싶은 활동|관심)/.test(text)) ||
    (sg === "HOBBY_AND_CREATION" && /(노래|음악|만들고 싶은|그리고 싶은|좋아하는)/.test(text))
  ) {
    return "RAPPORT_INTEREST";
  }

  // 4. GAME_TODAY: 게임 관련 (로블록스/게임/게임 플레이)
  if (
    /(로블록스|브롤스타즈|마인크래프트|게임맵|무슨 게임|자주 하는 게임|제일 많이 하는 게임|게임했|게임할|게임이나|게임 플레이|플레이 중)/.test(text) ||
    (text.includes("게임") && !text.includes("게임 얘기, 학교 얘기") && !/(상상|만약)/.test(text)) ||
    (sg === "DIGITAL_CONTENT" && /게임/.test(text))
  ) {
    return "GAME_TODAY";
  }

  // 5. VIDEO_TODAY: 유튜브/영상/만화/보는 콘텐츠
  if (
    /(유튜브|영상|만화|넷플릭스|애니메이션|보는 콘텐츠|콘텐츠에서|어떤 걸 찾아봐)/.test(text) ||
    (sg === "DIGITAL_CONTENT" && /(영상|유튜브|만화|콘텐츠|폰이나 태블릿|디지털 기기|온라인)/.test(text))
  ) {
    return "VIDEO_TODAY";
  }

  // 6. ACADEMY_LEARNING: 학원에서 배운 것/내용/수업 흥미
  if (
    /학원.*(배웠|배운|새로 배운|신기했던|재밌었던 건|재미있거나|이해된|무슨 내용)/.test(text) ||
    /(학원이나 공부|학원에서 배운).*(배우|재미 붙은|이해된|기억에 남는 건|신기했던 건)/.test(text)
  ) {
    return "ACADEMY_LEARNING";
  }

  // 7. ACADEMY_TODAY: 학원 가는 날/학원 일정/어떤 학원
  if (
    /(학원 갔어|학원 가는 날|학원 갔으면|학원 다니면|학원이나 다른 일정|학원이나 일정|학원 시간|어떤 학원|무슨 학원|학원 일정)/.test(text) ||
    (text.includes("학원") && /(오늘 학원|학원 가|학교 끝나고 학원|학원 다니|학원이나)/.test(text))
  ) {
    return "ACADEMY_TODAY";
  }

  // 8. FRIEND_CONFLICT: 친구와의 다툼/갈등/삐침/속상함
  if (
    sg === "FRIEND_CONFLICT" ||
    /(친구|친구랑|친구와|친구 관계).*(다투|싸웠|삐친|삐졌|서운|속상|기분 상한|불편했던|부딪히|갈등|화난|마음 상한|생각이 달랐)/.test(text) ||
    /(다퉜|싸웠|삐친|삐졌).*친구/.test(text)
  ) {
    return "FRIEND_CONFLICT";
  }

  // 9. FRIEND_FUNNY: 친구와 웃겼던 일/재미있었던 일
  if (
    /(친구|친구랑|친구들이랑).*(웃긴|웃기게|웃겼|웃었던|웃은 일|웃은 순간|가장 많이 웃은|웃긴 친구|장난)/.test(text) ||
    /(웃긴|웃겼던).*친구/.test(text)
  ) {
    return "FRIEND_FUNNY";
  }

  // 10. FRIEND_PLAY: 친구와 놀기/만남/친구 관계
  if (
    /(친구|친구랑|친구들|친구와).*(놀았|놀아|만나|무슨 얘기|무슨 대화|같이 한|도와준|도와줬|연락|함께|친한|있을 때|유행하는)/.test(text) ||
    /오늘 누구랑 (놀았|제일 많이 놀았|제일 많이 이야기|놀이 했어)/.test(text) ||
    /내일 누구랑 놀고 싶어/.test(text) ||
    /내일 누구와 어떤 시간을/.test(text) ||
    /이번 주에 누구랑 제일 많이 놀았어/.test(text) ||
    /오늘 무슨 놀이 했어/.test(text) ||
    (sg === "PEER_CONNECTION" && /(친구|쉬는 시간|놀이|같이|함께|누구와|누구랑)/.test(text))
  ) {
    return "FRIEND_PLAY";
  }

  // 11. FOOD_TODAY: 밥/급식/간식/음식
  if (
    sg === "MEAL_AND_TASTE" ||
    /(밥|급식|간식|음식|메뉴|맛있|먹었|먹은|식사|먹고 싶은|디저트|물을 마셨을 때)/.test(text)
  ) {
    return "FOOD_TODAY";
  }

  // 12. OUTING_TODAY: 외출/나들이/밖에서 논 일
  if (
    /(밖에|밖에서|어디 다녀|다녀온|나갔다|나들이|외출|산책|어디 놀러)/.test(text) ||
    /오늘 어디 다녀왔/.test(text) ||
    /오늘 밖에/.test(text)
  ) {
    return "OUTING_TODAY";
  }

  // 13. WEEKEND_HIGHLIGHT: 주말 회고/주말에 있었던 일
  if (
    /(주말에|이번 주말|주말 동안|주말 통틀어).*(재밌었던|재미있었던|좋았던|기억에 남|생각나는|생각난|했던 것 중|했던 일 중|아쉬웠던|다시 하고 싶은|순간이 뭐야|순간은 뭐야|어땠어|제일 좋았던|다시 해보고)/.test(text) ||
    /이번 주 통틀어 제일 좋았던/.test(text) ||
    /이번 주에 제일 좋았던/.test(text) ||
    /이번 주에 다시 해보고 싶은/.test(text) ||
    /주말에 했던 (일|것)/.test(text) ||
    /이번 주말에 다시 하고 싶은/.test(text) ||
    /주말에 했던 것 중 오늘까지 생각난/.test(text)
  ) {
    return "WEEKEND_HIGHLIGHT";
  }

  // 14. WEEKEND_EXPECTATION: 주말 기대/계획, 내일 토요일/금요일 신남
  if (
    /(내일 토요일|내일 금요일|금요일이라|토요일이라).*(좋아|기분|신나|달라)/.test(text) ||
    /(주말에|이번 주말에|다음 주말|토요일에|금요일에).*(계획|하고 싶|가고 싶|어디 가|보내고 싶|설계하면|할 거야|만나고 싶은|아침에 일어나면|시간 생기면|뭐 할|뭐 하고 싶)/.test(text) ||
    /주말 하루를 네 마음대로/.test(text) ||
    /주말에 계획 없으면/.test(text) ||
    /주말에는 집콕/.test(text) ||
    /주말에 아무 일정/.test(text) ||
    /주말에 제일 하고 싶은/.test(text) ||
    /토요일 아침에 일어나면/.test(text) ||
    /다음 주말에는 뭐/.test(text)
  ) {
    if (!/(재밌었던|재미있었던|좋았던 순간|기억에 남|생각나는|생각난|했던 것 중|했던 일 중|통틀어서|통틀어|아쉬웠던|어땠어|다시 하고 싶은)/.test(text)) {
      return "WEEKEND_EXPECTATION";
    }
  }

  // 15. SCHOOL_CLASS: 수업/선생님/과목/교실 배움/쉬는 시간 활동/학습
  if (
    /(수업|선생님|과목|교시|쉬는 시간|배운 것 중|숫자나 글자|발표하거나|숙제나 공부|숙제|교실|운동장).*(재밌|재미있|흥미|어려|쉬운|기억|새롭게|도움|집중|말|배웠|막힌|잘 풀린|놀았어|나간 일|뭐였어|써보고|해보고|책에서)/.test(text) ||
    /오늘 선생님이 (한|해준) 말/.test(text) ||
    /오늘 수업 중/.test(text) ||
    /오늘 수업에서/.test(text) ||
    /쉬는 시간에는 주로 뭐/.test(text) ||
    /오늘 새롭게 알게 된/.test(text) ||
    /오늘 숫자나 글자를 새로 배웠어/.test(text) ||
    /오늘 발표하거나 앞에/.test(text) ||
    /배운 것 중 내일/.test(text) ||
    /오늘 했던 학교 활동/.test(text) ||
    /오늘 학교에서 하기 싫었던/.test(text) ||
    sg === "TEACHER_RELATIONSHIP" ||
    (sg === "LEARNING_AND_STUDY" && /(수업|선생님|과목|학교|숙제|공부|배운|배우)/.test(text)) ||
    (sg === "SCHOOL_EXPERIENCE" && /(수업|선생님|공부|배운|쉬는 시간|집중|의견|새롭게|어려웠던|그림 그렸어|만들기나 색칠|교실|운동장|활동|책)/.test(text))
  ) {
    return "SCHOOL_CLASS";
  }

  // 16. SCHOOL_HIGHLIGHT: 학교 하이라이트/기억나는 일/학교에서 무슨 일
  if (
    /(학교에서|학교생활에서|학교생활이|학교 가서|학교가|학교\(또는 유치원\)에서|중학교에서|중학교).*(기억|생각|떠오르는|인상|무슨 일|재밌었던|재미있었던|재미있었어|하이라이트|순간|어땠어|제일 먼저 뭐 했|의외로 괜찮|제일 편한|다시 하고 싶은|처음 한 일|웃은 일|있었던 일|편해졌어|걱정되는|기대되는)/.test(text) ||
    /학교에서 오늘 무슨 일/.test(text) ||
    /오늘 학교에서 가장 기억에 남는/.test(text) ||
    /오늘 학교에서 있었던 일/.test(text) ||
    /학교에서 제일 기억나는/.test(text) ||
    /학교생활에서 제일 괜찮은/.test(text) ||
    /이번 주 학교에서 제일 (기억|재미)/.test(text) ||
    /이번 달 학교생활에서 제일 기억/.test(text) ||
    (sg === "SCHOOL_EXPERIENCE" && /(기억|순간|떠오르는|무슨 일|인상적|어땠어|재밌었던|재미있었던|웃은 일|편해졌어)/.test(text))
  ) {
    return "SCHOOL_HIGHLIGHT";
  }

  // 17. ACHIEVEMENT_TODAY: 오늘 잘한 일/성취/스스로 칭찬/해낸 일
  if (
    sg === "ACHIEVEMENT" ||
    /(잘했다|잘한 일|스스로 잘했|해낸|칭찬하고 싶은|뿌듯|도전해서|성취|스스로 괜찮게|장점이 도움이 된|끝까지 해낸|용기 내서|포기하지 않고|스스로 만족|잘했다고)/.test(text) ||
    /실수했지만 다시/.test(text) ||
    /(스스로|혼자) 해결한/.test(text) ||
    /다시 해본 일이 있어/.test(text) ||
    /마음에 든 작품이나 글씨/.test(text) ||
    /생각보다 (잘 풀린|잘된) 일/.test(text) ||
    /네가 제일 잘한 건/.test(text) ||
    /오늘 처음 해본 게 있어/.test(text) ||
    /네가 직접 선택해서 한 일이/.test(text) ||
    /네가 누군가를 (기쁘게|웃게)/.test(text)
  ) {
    return "ACHIEVEMENT_TODAY";
  }

  // 18. MOOD_TODAY: 오늘 기분/컨디션/감정/피로/체력
  if (
    /(기분|컨디션|마음 날씨|피곤|졸렸|쌩쌩|힘들었|속상|짜증|신났|행복|감정|몸은 어땠|체력|조용히 쉬었|쉬고 싶다고|마음 점수|떨렸어)/.test(text) ||
    /(마음은 맑음|마음을 한 단어로|지금 마음 어때|편안했던 순간|화가 난|힘들거나 신경|눈물이 날 것|조금 힘들거나|마음속에 오래|마음에 오래|부담스럽다고|부끄러웠던|마음이 콩콩|마음이 축|마음은 편안|마음은 편해|웃음이 난|소외된 느낌|혼자 있고 싶었던|누군가와 이야기하고 싶었던|즐거웠던 순간|기분이 좋았|마음 편안해|조금 긴장했던|마음을 날씨로|힘들거나 아쉬웠던|제일 편했던|마음이 복잡|기분이 확|이불 속에 들어가면|신나게 뛰었던|마음은 좀 편해졌어)/.test(text) ||
    sg === "MOOD_CHECK" ||
    sg === "PHYSICAL_STATE"
  ) {
    return "MOOD_TODAY";
  }

  // 19. FAMILY_TODAY (078 Phase A-2 신규: 가족 관계/가족과 함께 한 일/가족 도움)
  if (
    sg === "FAMILY_RELATIONSHIP" ||
    /(가족|가족과|가족이|가족한테|가족에게|가족이랑|부모님|엄마|아빠|형|누나|동생|언니|오빠)/.test(text)
  ) {
    return "FAMILY_TODAY";
  }

  // 20. DAILY_HIGHLIGHT (078 Phase A-2 신규: 일상 하이라이트/하루 반추/오늘 하루 중 좋았던 일)
  if (
    /(오늘 하루 중|하루 중 가장|오늘 하루에서|오늘 제일 좋았던|오늘 좋았던|오늘 가장 많이 웃은|오늘 하나만 꼭 기억|오늘 가장 조용했던|오늘 있었던 일 중 가장|오늘 특별했던|오늘 제일 기억나는|오늘 하루를 네 방식대로|오늘을 한 단어로|오늘을 한 가지 색으로|오늘 다시 돌아가 보고|오늘 다시 하고 싶은|오늘 다르게 해보고|오늘 예상과 다르게|오늘 생각과 다르게|오늘 계획과 다르게|오늘 좀 어땠어)/.test(text) ||
    /오늘 좋았던 일 하나/.test(text) ||
    /오늘 제일 좋았던 일/.test(text) ||
    /오늘 하루에서 하나만/.test(text) ||
    (sg === "DAILY_HIGHLIGHT" && /(기억|순간|하루|오늘|선택한 일)/.test(text))
  ) {
    return "DAILY_HIGHLIGHT";
  }

  // 21. FUTURE_EXPECTATION (078 Phase A-2 신규: 내일/다음 주/다음 달 기대 및 미래 소망)
  if (
    /(내일 기대되는|내일 재미있는 일이|내일 괜찮은 일이|내일 아침에|내일의 너에게|내일의 너한테|다음 주에 꼭 해보고|다음 주에 제일 기다려지는|다음 주에 가장 기대되는|다음 주에 제일 기대되는|다음 주에 꼭 하고 싶은|다음 주의 너에게|다음 주의 너한테|다음 달에 꼭 해보고|다음 달에 새로 해보고|다음 달의 너에게|다음 달에는 새로|커서 뭐가 되고 싶어|나중에 크면|앞으로 해보고 싶은 게 생겼어|새롭게 배우거나 한번 해보고 싶은|새로 해보고 싶은 활동|지금 딱 하나 하고 싶은|지금 제일 하고 싶은|지금 하나를 골라서 실컷|요즘 해보고 싶은 일이나 되고 싶은|내일 뭐 하고 싶어)/.test(text) ||
    sg === "FUTURE_HOPE"
  ) {
    return "FUTURE_EXPECTATION";
  }

  // 22. ADULT_SUPPORT (078 Phase A-2 신규: 어른과의 대화/도움/지원망)
  if (
    /(어른이|어른에게|어른한테|어른이 있어|어른은 누구야|누구에게 이야기|누구한테 말하고|도움이 필요할 때|힘들 때 편하게|고민이 생기면 누구에게|털어놓을 수 있는)/.test(text) ||
    sg === "SUPPORT_NETWORK"
  ) {
    return "ADULT_SUPPORT";
  }

  return null;
}

