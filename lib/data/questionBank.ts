/**
 * 게임 참여: MBTI — 200문항 문항뱅크 (2026-07-25 축당 50문항 개편)
 *
 * 축(EI/SN/TF/JP)별 정확히 50문항, 총 200문항. 매 세션 시작 시 축당 5문항씩
 * 총 20문항을 균형 무작위 추출한다(선정 로직은 `lib/mbti/selectQuestions.ts`).
 *
 * 품질 기준:
 * - 만 8~10세(초등 2~4학년) 아동이 혼자 읽을 수 있는 쉬운 어휘·짧은 문장
 * - 추상적 성격 형용사 금지, 학교·친구·놀이·가족·일상·새로운 상황 등 구체적
 *   상황형 이지선다만 사용
 * - "정답은 없어, 재미로 해보자!" 톤 유지 — 어느 쪽도 더 낫다는 인상을 주지 않음
 * - 공식 MBTI/타 성격검사 문항의 복제·변형 금지, 자체 창작만 사용
 *
 * A/B 극 배치 균형: 축당 50문항 중 정확히 25문항은 첫 번째 극(E/S/F/J)을 A에,
 * 25문항은 반대 극(I/N/T/P)을 A에 배치한다(한쪽 위치를 계속 고르면 특정 유형이
 * 나오는 편향을 막기 위함). `assertQuestionBankShape`가 이 불변조건을 검사한다.
 */

import type { Axis, Pole } from "./mbtiTypes";

/** 문항의 한 선택지. pole은 해당 축의 두 극 중 하나로 배점된다. */
export interface QuestionChoice {
  /** 화면 표시 및 답변 저장용 식별자(문항뱅크 내부 식별자일 뿐, 실제 화면 좌우 위치는
   * 세션 생성 시 고정되는 `optionOrder`가 결정한다 — `lib/mbti/selectQuestions.ts` 참고). */
  id: "A" | "B";
  /** 아동이 읽는 선택지 문구(짧은 문장 1개). */
  text: string;
  /** 이 선택지를 고르면 배점되는 극. */
  pole: Pole;
}

export interface Question {
  /** 문항 고유 ID. 축-순번 형태(예: "EI-01"), 축당 01~50. */
  id: string;
  /** 이 문항이 속한 진단 축. */
  axis: Axis;
  /** 아동에게 보이는 상황 설명 문구(질문). */
  prompt: string;
  /** 두 선택지. 각각 해당 축의 서로 다른 극에 배점된다. */
  choices: readonly [QuestionChoice, QuestionChoice];
  /** 문항 화면 상단에 표시할 일러스트 경로(`/public/Images/questions/`). 원본 일러스트는
   * 20장뿐이라(축당 균등하지 않게 학교수업/친구관계/놀이취미/가족일상 4개 상황 유형으로
   * 분류) 200문항 전체를 그 상황 유형이 같은 이미지에 다대일로 매칭했다 — 즉 정상적인
   * 출제에서는 모든 활성 문항이 실제 이미지를 갖고, 화면의 🐾 플레이스홀더는 이미지
   * 로드 실패 같은 예외 상황에서만 나타나는 fallback이다(정상 흐름에서 노출되지 않음).
   * 같은 축의 50문항 안에서 같은 이미지가 몰리지 않도록 세션 선정 알고리즘과는 별개로
   * 미리 분산 배치해뒀다. `imagePath?: string`로 optional을 유지하는 건 타입 계약상
   * "이미지 없는 문항"이 이론상 가능함(예: 향후 신규 문항 추가 시 매칭 전 과도기)을
   * 반영하는 것이지, 지금 실제로 비어 있는 문항이 있다는 뜻은 아니다. */
  imagePath?: string;
}

/**
 * 기존(2026-07 이전) 16문항 — 대표 검토를 거쳐 확정된 문항이며 각 축의 첫 4문항
 * (-01~-04)으로 그대로 편입한다. 신규 46문항(-05~-50)은 동일 축·품질 기준으로
 * 별도 작성해 뒤에 이어붙인다.
 */
const EXISTING_QUESTIONS: readonly Question[] = [
  // ── E/I 축 ──────────────────────────────────────────
  {
    id: "EI-01",
    axis: "EI",
    prompt: "쉬는 시간에 친구들이 우르르 놀이터로 뛰어나가면 너는?",
    choices: [
      { id: "A", text: "신나서 바로 같이 뛰어나간다", pole: "E" },
      { id: "B", text: "하던 그림을 마저 그리다가 천천히 나간다", pole: "I" },
    ],

    imagePath: "/Images/questions/q13_party_center_vs_quiet_corner.png",
  },
  {
    id: "EI-02",
    axis: "EI",
    prompt: "새 학기에 짝꿍이 된 친구와 처음 이야기할 때 너는?",
    choices: [
      { id: "A", text: "내가 먼저 말을 걸고 이것저것 물어본다", pole: "E" },
      { id: "B", text: "친구가 먼저 말을 걸어주면 그때 이야기한다", pole: "I" },
    ],

    imagePath: "/Images/questions/q03_new_friend_first.png",
  },
  {
    id: "EI-03",
    axis: "EI",
    prompt: "생일 파티에 초대받았어. 어떤 파티가 더 좋아?",
    choices: [
      { id: "A", text: "반 친구들을 다 초대하는 왁자지껄한 파티", pole: "E" },
      { id: "B", text: "친한 친구 한두 명만 부르는 조용한 파티", pole: "I" },
    ],

    imagePath: "/Images/questions/q08_help_friend_feel_vs_solution.png",
  },
  {
    id: "EI-04",
    axis: "EI",
    prompt: "학교 끝나고 집에 왔어. 오늘 하루는 어땠어?",
    choices: [
      { id: "A", text: "친구들이랑 실컷 놀아서 기운이 넘친다", pole: "E" },
      { id: "B", text: "혼자 방에서 좀 쉬어야 기운이 난다", pole: "I" },
    ],

    imagePath: "/Images/questions/q19_make_schedule_vs_spontaneous.png",
  },

  // ── S/N 축 ──────────────────────────────────────────
  {
    id: "SN-01",
    axis: "SN",
    prompt: "선생님이 그림일기를 그리라고 하셨어. 너는?",
    choices: [
      { id: "A", text: "오늘 실제로 있었던 일을 그대로 그린다", pole: "S" },
      { id: "B", text: "오늘 있었던 일에 상상을 더해서 그린다", pole: "N" },
    ],

    imagePath: "/Images/questions/q15_science_fact_vs_idea.png",
  },
  {
    id: "SN-02",
    axis: "SN",
    prompt: "친구가 새로운 보드게임 규칙을 설명해줄 때 너는?",
    choices: [
      { id: "A", text: "설명서를 하나하나 순서대로 따라 하며 배운다", pole: "S" },
      { id: "B", text: "대충 감으로 시작해보면서 익힌다", pole: "N" },
    ],

    imagePath: "/Images/questions/q01_blocks_plan_vs_change.png",
  },
  {
    id: "SN-03",
    axis: "SN",
    prompt: "미술 시간에 자유롭게 그리기를 할 때 너는?",
    choices: [
      { id: "A", text: "실제로 본 적 있는 것(우리 집, 강아지 등)을 그린다", pole: "S" },
      { id: "B", text: "세상에 없는 상상 속 동물이나 나라를 그린다", pole: "N" },
    ],

    imagePath: "/Images/questions/q16_team_lead_vs_support.png",
  },
  {
    id: "SN-04",
    axis: "SN",
    prompt: '친구가 "오늘 이상한 꿈 꿨어!"라고 말하면 너는?',
    choices: [
      { id: "A", text: '"무슨 일이 있었는데? 처음부터 순서대로 말해줘"라고 묻는다', pole: "S" },
      { id: "B", text: '"그래서 그다음엔 어떻게 됐을 것 같아?"라며 상상을 더한다', pole: "N" },
    ],

    imagePath: "/Images/questions/q14_gift_choose_practical_vs_heart.png",
  },

  // ── T/F 축 ──────────────────────────────────────────
  {
    id: "TF-01",
    axis: "TF",
    prompt: "친구가 시험을 못 봐서 속상해할 때 너는?",
    choices: [
      { id: "A", text: '"속상하겠다, 내가 옆에 있어줄게"라고 말해준다', pole: "F" },
      { id: "B", text: '"다음엔 이 부분을 더 연습하면 될 것 같아"라고 방법을 알려준다', pole: "T" },
    ],

    imagePath: "/Images/questions/q08_help_friend_feel_vs_solution.png",
  },
  {
    id: "TF-02",
    axis: "TF",
    prompt: "모둠 활동에서 의견이 갈릴 때 너는?",
    choices: [
      { id: "A", text: "친구들 기분이 상하지 않는 쪽으로 정하고 싶다", pole: "F" },
      { id: "B", text: "어떤 게 더 맞는 방법인지 따져보고 정하고 싶다", pole: "T" },
    ],

    imagePath: "/Images/questions/q16_team_lead_vs_support.png",
  },
  {
    id: "TF-03",
    axis: "TF",
    prompt: "친구랑 게임을 하다가 규칙 때문에 다퉜어. 너는?",
    choices: [
      { id: "A", text: '"속상했으면 미안해"라고 먼저 마음을 풀어준다', pole: "F" },
      { id: "B", text: '"규칙을 다시 한번 정확히 확인해보자"라고 말한다', pole: "T" },
    ],

    imagePath: "/Images/questions/q08_help_friend_feel_vs_solution.png",
  },
  {
    id: "TF-04",
    axis: "TF",
    prompt: "반려동물이나 화분이 시들시들 아파 보일 때 너는?",
    choices: [
      { id: "A", text: "마음이 아파서 옆에서 계속 쓰다듬어주고 돌봐준다", pole: "F" },
      { id: "B", text: "왜 아픈지 원인을 찾아보고 해결 방법을 알아본다", pole: "T" },
    ],

    imagePath: "/Images/questions/q19_make_schedule_vs_spontaneous.png",
  },

  // ── J/P 축 ──────────────────────────────────────────
  {
    id: "JP-01",
    axis: "JP",
    prompt: "주말 계획을 세울 때 너는?",
    choices: [
      { id: "A", text: "미리 시간표를 딱 정해놓아야 마음이 편하다", pole: "J" },
      { id: "B", text: "그때그때 하고 싶은 걸 정하는 게 더 좋다", pole: "P" },
    ],

    imagePath: "/Images/questions/q19_make_schedule_vs_spontaneous.png",
  },
  {
    id: "JP-02",
    axis: "JP",
    prompt: "숙제를 받으면 너는?",
    choices: [
      { id: "A", text: "받자마자 바로 계획을 세워서 미리 끝낸다", pole: "J" },
      { id: "B", text: "마감 날이 다가오면 그때 몰아서 한다", pole: "P" },
    ],

    imagePath: "/Images/questions/q17_free_time_many_friends_vs_alone_hobby.png",
  },
  {
    id: "JP-03",
    axis: "JP",
    prompt: "책상 정리를 할 때 너는?",
    choices: [
      { id: "A", text: "물건마다 자리를 딱 정해놓고 그대로 유지한다", pole: "J" },
      { id: "B", text: "그때그때 편한 곳에 둔다", pole: "P" },
    ],

    imagePath: "/Images/questions/q19_make_schedule_vs_spontaneous.png",
  },
  {
    id: "JP-04",
    axis: "JP",
    prompt: "놀이공원에 가면 너는?",
    choices: [
      { id: "A", text: "어떤 놀이기구를 몇 시에 탈지 미리 정해두고 싶다", pole: "J" },
      { id: "B", text: "가서 보이는 대로 마음 가는 대로 타고 싶다", pole: "P" },
    ],

    imagePath: "/Images/questions/q12_game_rule_exact_vs_flexible.png",
  },
] as const;

/**
 * 신규 46문항(축당) — 2026-07-25 200문항뱅크 개편으로 새로 작성된 문항. 독립 검수
 * (§9, 중복/표절 위험/난이도/균형 확인) 통과 후 편입됐다.
 */
const NEW_QUESTIONS: readonly Question[] = [
  // ── E/I 축 신규 46문항 ──────────────────────────────────────────
  {
    id: "EI-05",
    axis: "EI",
    prompt: "처음 간 캠핑장 옆 텐트에 또래 아이들이 놀고 있어. 너는?",
    choices: [
      { id: "A", text: "우리 가족이랑 놀면서 천천히 지켜본다", pole: "I" },
      { id: "B", text: "먼저 다가가서 같이 놀자고 한다", pole: "E" },
    ],

    imagePath: "/Images/questions/q17_free_time_many_friends_vs_alone_hobby.png",
  },
  {
    id: "EI-06",
    axis: "EI",
    prompt: "쉬는 시간에 딱히 할 일이 없을 때 너는?",
    choices: [
      { id: "A", text: "혼자 창밖을 보거나 낙서를 한다", pole: "I" },
      { id: "B", text: "친구들한테 가서 뭐 하고 노는지 낀다", pole: "E" },
    ],

    imagePath: "/Images/questions/q09_school_task_detail_vs_big_picture.png",
  },
  {
    id: "EI-07",
    axis: "EI",
    prompt: "가족 모임에 친척들이 잔뜩 모였어. 너는?",
    choices: [
      { id: "A", text: "어른들 사이를 돌아다니며 이야기한다", pole: "E" },
      { id: "B", text: "조용한 방에서 사촌 한 명이랑 논다", pole: "I" },
    ],

    imagePath: "/Images/questions/q06_trip_plan_vs_go_with_flow.png",
  },
  {
    id: "EI-08",
    axis: "EI",
    prompt: "새 학원에 처음 간 날, 너는?",
    choices: [
      { id: "A", text: "수업을 들으며 분위기를 먼저 살핀다", pole: "I" },
      { id: "B", text: "옆자리 친구한테 먼저 이름을 물어본다", pole: "E" },
    ],

    imagePath: "/Images/questions/q03_new_friend_first.png",
  },
  {
    id: "EI-09",
    axis: "EI",
    prompt: "체험학습으로 버스를 탔어. 가는 길에 너는?",
    choices: [
      { id: "A", text: "친구들이랑 크게 노래 부르고 떠든다", pole: "E" },
      { id: "B", text: "창밖을 보며 조용히 생각에 잠긴다", pole: "I" },
    ],

    imagePath: "/Images/questions/q15_science_fact_vs_idea.png",
  },
  {
    id: "EI-10",
    axis: "EI",
    prompt: "주말에 하루 종일 집에 있게 됐어. 너는?",
    choices: [
      { id: "A", text: "집에서 혼자 노는 게 편하고 좋다", pole: "I" },
      { id: "B", text: "심심해서 친구한테 놀자고 전화한다", pole: "E" },
    ],

    imagePath: "/Images/questions/q19_make_schedule_vs_spontaneous.png",
  },
  {
    id: "EI-11",
    axis: "EI",
    prompt: "학교에서 발표를 하게 됐어. 너는?",
    choices: [
      { id: "A", text: "내 자리에서 차분히 준비하는 게 편하다", pole: "I" },
      { id: "B", text: "앞에 나가 큰 목소리로 발표하는 게 신난다", pole: "E" },
    ],

    imagePath: "/Images/questions/q09_school_task_detail_vs_big_picture.png",
  },
  {
    id: "EI-12",
    axis: "EI",
    prompt: "놀이공원에서 처음 보는 아이랑 같은 놀이기구를 탔어. 너는?",
    choices: [
      { id: "A", text: "자연스럽게 말을 걸어 친구가 된다", pole: "E" },
      { id: "B", text: "눈인사만 하고 각자 재밌게 탄다", pole: "I" },
    ],

    imagePath: "/Images/questions/q07_puzzle_fast_try_vs_slow_check.png",
  },
  {
    id: "EI-13",
    axis: "EI",
    prompt: "생각할 게 많을 때 너는?",
    choices: [
      { id: "A", text: "혼자 조용히 있으면서 생각을 정리한다", pole: "I" },
      { id: "B", text: "친구랑 이야기하면서 생각을 정리한다", pole: "E" },
    ],

    imagePath: "/Images/questions/q17_free_time_many_friends_vs_alone_hobby.png",
  },
  {
    id: "EI-14",
    axis: "EI",
    prompt: "반에 새 친구가 전학 왔어. 너는?",
    choices: [
      { id: "A", text: "제일 먼저 다가가 학교를 안내해준다", pole: "E" },
      { id: "B", text: "먼저 다가온 친구에게 반갑게 답한다", pole: "I" },
    ],

    imagePath: "/Images/questions/q03_new_friend_first.png",
  },
  {
    id: "EI-15",
    axis: "EI",
    prompt: "동네 놀이터에 나갔더니 아는 친구가 없어. 너는?",
    choices: [
      { id: "A", text: "처음 보는 아이들한테 같이 놀자고 한다", pole: "E" },
      { id: "B", text: "혼자서도 재밌게 놀 거리를 찾는다", pole: "I" },
    ],

    imagePath: "/Images/questions/q02_playground_join_vs_watch.png",
  },
  {
    id: "EI-16",
    axis: "EI",
    prompt: "친구 여러 명이랑 오래 놀고 집에 왔어. 너는?",
    choices: [
      { id: "A", text: "재밌었지만 이제 혼자 쉬고 싶다", pole: "I" },
      { id: "B", text: "너무 재밌어서 더 놀고 싶다", pole: "E" },
    ],

    imagePath: "/Images/questions/q02_playground_join_vs_watch.png",
  },
  {
    id: "EI-17",
    axis: "EI",
    prompt: "짝 활동에서 짝을 정할 때 너는?",
    choices: [
      { id: "A", text: "평소 친한 친구에게 조용히 다가간다", pole: "I" },
      { id: "B", text: "여러 친구에게 같이 하자고 말한다", pole: "E" },
    ],

    imagePath: "/Images/questions/q16_team_lead_vs_support.png",
  },
  {
    id: "EI-18",
    axis: "EI",
    prompt: "쉬는 시간 종이 쳤어. 너는 주로?",
    choices: [
      { id: "A", text: "자리에서 책을 보거나 혼자 쉰다", pole: "I" },
      { id: "B", text: "친구들이랑 큰 소리로 이야기하며 논다", pole: "E" },
    ],

    imagePath: "/Images/questions/q20_show_talent_vs_prepare_first.png",
  },
  {
    id: "EI-19",
    axis: "EI",
    prompt: "가족 여행에서 처음 간 식당에 들어갔어. 너는?",
    choices: [
      { id: "A", text: "사장님한테 먼저 인사하고 이것저것 묻는다", pole: "E" },
      { id: "B", text: "조용히 자리에 앉아 메뉴를 고른다", pole: "I" },
    ],

    imagePath: "/Images/questions/q19_make_schedule_vs_spontaneous.png",
  },
  {
    id: "EI-20",
    axis: "EI",
    prompt: "친구가 생일 파티에 반 전체를 불렀어. 도착한 너는?",
    choices: [
      { id: "A", text: "편한 친구 몇 명이랑 한곳에서 논다", pole: "I" },
      { id: "B", text: "여기저기 다니며 많은 친구랑 논다", pole: "E" },
    ],

    imagePath: "/Images/questions/q13_party_center_vs_quiet_corner.png",
  },
  {
    id: "EI-21",
    axis: "EI",
    prompt: "학교에서 있었던 일을 집에 와서 너는?",
    choices: [
      { id: "A", text: "마음속으로 하루를 조용히 되돌아본다", pole: "I" },
      { id: "B", text: "가족한테 신나게 다 이야기한다", pole: "E" },
    ],

    imagePath: "/Images/questions/q17_free_time_many_friends_vs_alone_hobby.png",
  },
  {
    id: "EI-22",
    axis: "EI",
    prompt: "모둠에서 발표할 사람을 정할 때 너는?",
    choices: [
      { id: "A", text: "내가 하겠다고 손을 번쩍 든다", pole: "E" },
      { id: "B", text: "발표보다 자료 준비를 맡고 싶다", pole: "I" },
    ],

    imagePath: "/Images/questions/q04_group_talk_vs_listen.png",
  },
  {
    id: "EI-23",
    axis: "EI",
    prompt: "쉬는 날 아침에 눈을 떴어. 하고 싶은 건?",
    choices: [
      { id: "A", text: "방에서 좋아하는 걸 혼자 하고 싶다", pole: "I" },
      { id: "B", text: "친구들 불러서 다 같이 놀고 싶다", pole: "E" },
    ],

    imagePath: "/Images/questions/q06_trip_plan_vs_go_with_flow.png",
  },
  {
    id: "EI-24",
    axis: "EI",
    prompt: "새 동아리에 처음 들어간 날 너는?",
    choices: [
      { id: "A", text: "먼저 말 걸며 금방 친구를 만든다", pole: "E" },
      { id: "B", text: "활동을 하다 보면 천천히 친해진다", pole: "I" },
    ],

    imagePath: "/Images/questions/q15_science_fact_vs_idea.png",
  },
  {
    id: "EI-25",
    axis: "EI",
    prompt: "놀이 중에 잠깐 쉬는 시간이 생겼어. 너는?",
    choices: [
      { id: "A", text: "잠깐 혼자 앉아 숨을 고른다", pole: "I" },
      { id: "B", text: "쉬는 동안에도 친구들이랑 수다 떤다", pole: "E" },
    ],

    imagePath: "/Images/questions/q12_game_rule_exact_vs_flexible.png",
  },
  {
    id: "EI-26",
    axis: "EI",
    prompt: "학급 회의에서 하고 싶은 말이 생겼어. 너는?",
    choices: [
      { id: "A", text: "바로 손들고 큰 소리로 말한다", pole: "E" },
      { id: "B", text: "머릿속으로 정리한 뒤 조심스레 말한다", pole: "I" },
    ],

    imagePath: "/Images/questions/q04_group_talk_vs_listen.png",
  },
  {
    id: "EI-27",
    axis: "EI",
    prompt: "점심 먹고 남은 시간에 너는?",
    choices: [
      { id: "A", text: "교실에서 조용히 좋아하는 걸 한다", pole: "I" },
      { id: "B", text: "운동장에 나가 친구들과 뛰어논다", pole: "E" },
    ],

    imagePath: "/Images/questions/q15_science_fact_vs_idea.png",
  },
  {
    id: "EI-28",
    axis: "EI",
    prompt: "처음 보는 손님이 우리 집에 놀러 왔어. 너는?",
    choices: [
      { id: "A", text: "인사만 하고 곁에서 가만히 있는다", pole: "I" },
      { id: "B", text: "신나서 먼저 이런저런 이야기를 한다", pole: "E" },
    ],

    imagePath: "/Images/questions/q11_room_tidy_now_vs_later.png",
  },
  {
    id: "EI-29",
    axis: "EI",
    prompt: "학교 축제에서 무대에 오를 기회가 생겼어. 너는?",
    choices: [
      { id: "A", text: "많은 사람 앞에 서는 게 신난다", pole: "E" },
      { id: "B", text: "무대보다 뒤에서 돕는 게 마음 편하다", pole: "I" },
    ],

    imagePath: "/Images/questions/q20_show_talent_vs_prepare_first.png",
  },
  {
    id: "EI-30",
    axis: "EI",
    prompt: "친구가 여러 명 있는 단체 대화방에 들어갔어. 너는?",
    choices: [
      { id: "A", text: "주로 읽고 필요할 때만 글을 쓴다", pole: "I" },
      { id: "B", text: "먼저 인사하고 이야기를 자주 남긴다", pole: "E" },
    ],

    imagePath: "/Images/questions/q08_help_friend_feel_vs_solution.png",
  },
  {
    id: "EI-31",
    axis: "EI",
    prompt: "받아쓰기 짝 연습을 할 때 너는?",
    choices: [
      { id: "A", text: "여러 친구랑 번갈아 하는 게 재밌다", pole: "E" },
      { id: "B", text: "한 친구랑 차분히 하는 게 좋다", pole: "I" },
    ],

    imagePath: "/Images/questions/q16_team_lead_vs_support.png",
  },
  {
    id: "EI-32",
    axis: "EI",
    prompt: "가족이 다 같이 거실에 모여 있어. 너는?",
    choices: [
      { id: "A", text: "잠깐 내 방에 가서 혼자 있고 싶다", pole: "I" },
      { id: "B", text: "이야기 나누며 함께 있는 게 좋다", pole: "E" },
    ],

    imagePath: "/Images/questions/q11_room_tidy_now_vs_later.png",
  },
  {
    id: "EI-33",
    axis: "EI",
    prompt: "여럿이 함께 하는 놀이와 혼자 하는 놀이 중 너는?",
    choices: [
      { id: "A", text: "혼자 몰입해서 노는 게 좋다", pole: "I" },
      { id: "B", text: "여럿이 왁자지껄하게 노는 게 좋다", pole: "E" },
    ],

    imagePath: "/Images/questions/q01_blocks_plan_vs_change.png",
  },
  {
    id: "EI-34",
    axis: "EI",
    prompt: "복도에서 아는 친구를 만났어. 너는?",
    choices: [
      { id: "A", text: "반갑게 이름 부르며 큰 소리로 인사한다", pole: "E" },
      { id: "B", text: "눈 마주치며 살짝 웃고 인사한다", pole: "I" },
    ],

    imagePath: "/Images/questions/q15_science_fact_vs_idea.png",
  },
  {
    id: "EI-35",
    axis: "EI",
    prompt: "새로운 반에서 아직 친한 친구가 없어. 너는?",
    choices: [
      { id: "A", text: "자연스럽게 친해질 때까지 기다린다", pole: "I" },
      { id: "B", text: "내가 먼저 말 걸어 친구를 만든다", pole: "E" },
    ],

    imagePath: "/Images/questions/q20_show_talent_vs_prepare_first.png",
  },
  {
    id: "EI-36",
    axis: "EI",
    prompt: "가족끼리 보드게임을 시작했어. 너는?",
    choices: [
      { id: "A", text: "신나서 큰 소리로 분위기를 띄운다", pole: "E" },
      { id: "B", text: "차분하게 내 차례를 즐긴다", pole: "I" },
    ],

    imagePath: "/Images/questions/q11_room_tidy_now_vs_later.png",
  },
  {
    id: "EI-37",
    axis: "EI",
    prompt: "학교에서 조용히 있고 싶은 날, 그럴 때 너는?",
    choices: [
      { id: "A", text: "혼자 있는 시간을 가지면 기운이 난다", pole: "I" },
      { id: "B", text: "그래도 친구들과 있으면 금방 기운이 난다", pole: "E" },
    ],

    imagePath: "/Images/questions/q20_show_talent_vs_prepare_first.png",
  },
  {
    id: "EI-38",
    axis: "EI",
    prompt: "쉬는 시간에 친구가 '같이 나가자' 했어. 너는?",
    choices: [
      { id: "A", text: "오늘은 교실에 있고 싶다고 말하기도 한다", pole: "I" },
      { id: "B", text: "좋다며 바로 따라 나가 논다", pole: "E" },
    ],

    imagePath: "/Images/questions/q16_team_lead_vs_support.png",
  },
  {
    id: "EI-39",
    axis: "EI",
    prompt: "처음 가 본 놀이터에서 너는?",
    choices: [
      { id: "A", text: "먼저 온 아이들 사이에 끼어 논다", pole: "E" },
      { id: "B", text: "혼자 이것저것 타보며 논다", pole: "I" },
    ],

    imagePath: "/Images/questions/q02_playground_join_vs_watch.png",
  },
  {
    id: "EI-40",
    axis: "EI",
    prompt: "여행지에서 사진을 찍을 때 너는?",
    choices: [
      { id: "A", text: "조용히 풍경이나 나만의 사진을 찍는다", pole: "I" },
      { id: "B", text: "사람들 모아서 다 같이 찍는 걸 좋아한다", pole: "E" },
    ],

    imagePath: "/Images/questions/q19_make_schedule_vs_spontaneous.png",
  },
  {
    id: "EI-41",
    axis: "EI",
    prompt: "친구 집에 놀러 갔더니 모르는 아이도 있어. 너는?",
    choices: [
      { id: "A", text: "모르는 아이한테도 먼저 말을 건다", pole: "E" },
      { id: "B", text: "아는 친구 옆에서 편하게 논다", pole: "I" },
    ],

    imagePath: "/Images/questions/q18_problem_rule_vs_empathy.png",
  },
  {
    id: "EI-42",
    axis: "EI",
    prompt: "기운이 쭉 빠진 날, 다시 힘이 나려면 너는?",
    choices: [
      { id: "A", text: "혼자 조용히 쉬면 힘이 난다", pole: "I" },
      { id: "B", text: "친구들과 만나 수다 떨면 힘이 난다", pole: "E" },
    ],

    imagePath: "/Images/questions/q06_trip_plan_vs_go_with_flow.png",
  },
  {
    id: "EI-43",
    axis: "EI",
    prompt: "학예회 준비 중 역할을 정해. 너는?",
    choices: [
      { id: "A", text: "대사 많은 주인공 역할을 하고 싶다", pole: "E" },
      { id: "B", text: "무대 뒤 소품이나 음악을 맡고 싶다", pole: "I" },
    ],

    imagePath: "/Images/questions/q16_team_lead_vs_support.png",
  },
  {
    id: "EI-44",
    axis: "EI",
    prompt: "친구들과 놀다가 집에 갈 시간이야. 너는?",
    choices: [
      { id: "A", text: "충분히 놀았으니 홀가분하게 집에 간다", pole: "I" },
      { id: "B", text: "아쉬워서 조금만 더 놀자고 한다", pole: "E" },
    ],

    imagePath: "/Images/questions/q14_gift_choose_practical_vs_heart.png",
  },
  {
    id: "EI-45",
    axis: "EI",
    prompt: "교실에 새 친구가 혼자 앉아 있어. 너는?",
    choices: [
      { id: "A", text: "다가가서 같이 놀자고 말을 건다", pole: "E" },
      { id: "B", text: "친구가 편해 보일 때 슬며시 다가간다", pole: "I" },
    ],

    imagePath: "/Images/questions/q03_new_friend_first.png",
  },
  {
    id: "EI-46",
    axis: "EI",
    prompt: "여러 사람 앞에서 이야기할 일이 생겼어. 너는?",
    choices: [
      { id: "A", text: "사람이 많을수록 더 신이 난다", pole: "E" },
      { id: "B", text: "사람이 적을 때 더 마음이 편하다", pole: "I" },
    ],

    imagePath: "/Images/questions/q04_group_talk_vs_listen.png",
  },
  {
    id: "EI-47",
    axis: "EI",
    prompt: "가족 여행 중 낯선 마을에서 축제를 만났어. 너는?",
    choices: [
      { id: "A", text: "사람들 사이로 들어가 신나게 구경한다", pole: "E" },
      { id: "B", text: "조금 떨어져서 차분히 지켜본다", pole: "I" },
    ],

    imagePath: "/Images/questions/q11_room_tidy_now_vs_later.png",
  },
  {
    id: "EI-48",
    axis: "EI",
    prompt: "친구랑 놀 약속을 잡을 때 너는?",
    choices: [
      { id: "A", text: "한두 명이랑 노는 걸 좋아한다", pole: "I" },
      { id: "B", text: "여러 명이 같이 모이는 걸 좋아한다", pole: "E" },
    ],

    imagePath: "/Images/questions/q13_party_center_vs_quiet_corner.png",
  },
  {
    id: "EI-49",
    axis: "EI",
    prompt: "운동회 응원 시간이 됐어. 너는?",
    choices: [
      { id: "A", text: "제일 앞에서 큰 소리로 응원한다", pole: "E" },
      { id: "B", text: "자리에서 손뼉 치며 조용히 응원한다", pole: "I" },
    ],

    imagePath: "/Images/questions/q09_school_task_detail_vs_big_picture.png",
  },
  {
    id: "EI-50",
    axis: "EI",
    prompt: "숙제를 다 하고 시간이 남았어. 너는?",
    choices: [
      { id: "A", text: "친구한테 연락해서 같이 놀 거리를 찾는다", pole: "E" },
      { id: "B", text: "혼자 책 읽거나 그림 그리며 논다", pole: "I" },
    ],

    imagePath: "/Images/questions/q17_free_time_many_friends_vs_alone_hobby.png",
  },

  // ── S/N 축 신규 46문항 ──────────────────────────────────────────
  {
    id: "SN-05",
    axis: "SN",
    prompt: "블록으로 무언가를 만들 때 너는?",
    choices: [
      { id: "A", text: "떠오르는 대로 새로운 걸 만든다", pole: "N" },
      { id: "B", text: "설명서를 보고 그대로 만든다", pole: "S" },
    ],

    imagePath: "/Images/questions/q01_blocks_plan_vs_change.png",
  },
  {
    id: "SN-06",
    axis: "SN",
    prompt: "구름을 올려다볼 때 너는?",
    choices: [
      { id: "A", text: "무슨 모양 같은지 상상한다", pole: "N" },
      { id: "B", text: "그냥 구름이 떠 있구나 하고 본다", pole: "S" },
    ],

    imagePath: "/Images/questions/q10_story_real_vs_imagine.png",
  },
  {
    id: "SN-07",
    axis: "SN",
    prompt: "선생님이 숙제를 내주셨어. 너는?",
    choices: [
      { id: "A", text: "내 아이디어를 더해서 한다", pole: "N" },
      { id: "B", text: "시키신 대로 정확히 한다", pole: "S" },
    ],

    imagePath: "/Images/questions/q09_school_task_detail_vs_big_picture.png",
  },
  {
    id: "SN-08",
    axis: "SN",
    prompt: "새 책을 펼쳤을 때 너는?",
    choices: [
      { id: "A", text: "다음 내용이 어떻게 될지 마구 상상한다", pole: "N" },
      { id: "B", text: "첫 장부터 차례대로 읽는다", pole: "S" },
    ],

    imagePath: "/Images/questions/q05_draw_follow_vs_improvise.png",
  },
  {
    id: "SN-09",
    axis: "SN",
    prompt: "길을 설명할 때 너는?",
    choices: [
      { id: "A", text: "몇 번째 골목에서 꺾는지 정확히 말한다", pole: "S" },
      { id: "B", text: "큰 나무를 지나 느낌으로 가면 된다고 말한다", pole: "N" },
    ],

    imagePath: "/Images/questions/q19_make_schedule_vs_spontaneous.png",
  },
  {
    id: "SN-10",
    axis: "SN",
    prompt: "빈 상자를 하나 받았어. 너는?",
    choices: [
      { id: "A", text: "우주선이나 비밀기지로 상상하며 논다", pole: "N" },
      { id: "B", text: "물건 담는 상자로 쓴다", pole: "S" },
    ],

    imagePath: "/Images/questions/q10_story_real_vs_imagine.png",
  },
  {
    id: "SN-11",
    axis: "SN",
    prompt: "친구가 그림을 보여줬어. 너는?",
    choices: [
      { id: "A", text: "이 그림에 어떤 이야기가 있을지 상상한다", pole: "N" },
      { id: "B", text: "무엇을 그렸는지 하나하나 살펴본다", pole: "S" },
    ],

    imagePath: "/Images/questions/q18_problem_rule_vs_empathy.png",
  },
  {
    id: "SN-12",
    axis: "SN",
    prompt: "요리를 도울 때 너는?",
    choices: [
      { id: "A", text: "조리법에 적힌 양을 정확히 지킨다", pole: "S" },
      { id: "B", text: "내 맛대로 이것저것 넣어본다", pole: "N" },
    ],

    imagePath: "/Images/questions/q06_trip_plan_vs_go_with_flow.png",
  },
  {
    id: "SN-13",
    axis: "SN",
    prompt: "밤하늘의 별을 볼 때 너는?",
    choices: [
      { id: "A", text: "별들을 이어 나만의 그림을 그린다", pole: "N" },
      { id: "B", text: "별이 몇 개나 있는지 세어본다", pole: "S" },
    ],

    imagePath: "/Images/questions/q05_draw_follow_vs_improvise.png",
  },
  {
    id: "SN-14",
    axis: "SN",
    prompt: "발표 자료를 만들 때 너는?",
    choices: [
      { id: "A", text: "사실과 정보를 정확히 담는다", pole: "S" },
      { id: "B", text: "재미난 상상과 아이디어를 담는다", pole: "N" },
    ],

    imagePath: "/Images/questions/q09_school_task_detail_vs_big_picture.png",
  },
  {
    id: "SN-15",
    axis: "SN",
    prompt: "'만약에' 놀이를 한다면 너는?",
    choices: [
      { id: "A", text: "말도 안 되는 상상을 신나게 펼친다", pole: "N" },
      { id: "B", text: "실제로 있을 법한 일로 대답한다", pole: "S" },
    ],

    imagePath: "/Images/questions/q12_game_rule_exact_vs_flexible.png",
  },
  {
    id: "SN-16",
    axis: "SN",
    prompt: "새 장난감을 받았어. 너는?",
    choices: [
      { id: "A", text: "설명서를 먼저 꼼꼼히 읽는다", pole: "S" },
      { id: "B", text: "일단 이렇게 저렇게 만져보며 논다", pole: "N" },
    ],

    imagePath: "/Images/questions/q07_puzzle_fast_try_vs_slow_check.png",
  },
  {
    id: "SN-17",
    axis: "SN",
    prompt: "미래에 대해 이야기할 때 너는?",
    choices: [
      { id: "A", text: "어떤 신기한 세상이 올지 상상한다", pole: "N" },
      { id: "B", text: "지금 할 수 있는 일부터 생각한다", pole: "S" },
    ],

    imagePath: "/Images/questions/q05_draw_follow_vs_improvise.png",
  },
  {
    id: "SN-18",
    axis: "SN",
    prompt: "그림을 그릴 때 너는?",
    choices: [
      { id: "A", text: "눈앞에 있는 걸 자세히 보고 그린다", pole: "S" },
      { id: "B", text: "머릿속 상상을 자유롭게 그린다", pole: "N" },
    ],

    imagePath: "/Images/questions/q05_draw_follow_vs_improvise.png",
  },
  {
    id: "SN-19",
    axis: "SN",
    prompt: "이야기를 지어낼 때 너는?",
    choices: [
      { id: "A", text: "현실에 없는 신비한 세계를 만든다", pole: "N" },
      { id: "B", text: "내가 겪은 일을 바탕으로 만든다", pole: "S" },
    ],

    imagePath: "/Images/questions/q10_story_real_vs_imagine.png",
  },
  {
    id: "SN-20",
    axis: "SN",
    prompt: "친구가 수수께끼를 냈어. 너는?",
    choices: [
      { id: "A", text: "힌트를 하나씩 따져 답을 찾는다", pole: "S" },
      { id: "B", text: "엉뚱하지만 기발한 답을 마구 떠올린다", pole: "N" },
    ],

    imagePath: "/Images/questions/q08_help_friend_feel_vs_solution.png",
  },
  {
    id: "SN-21",
    axis: "SN",
    prompt: "낙서할 때 너는?",
    choices: [
      { id: "A", text: "상상 속 괴물이나 요정을 그린다", pole: "N" },
      { id: "B", text: "주변에 보이는 물건을 그린다", pole: "S" },
    ],

    imagePath: "/Images/questions/q01_blocks_plan_vs_change.png",
  },
  {
    id: "SN-22",
    axis: "SN",
    prompt: "선생님 설명을 들을 때 너는?",
    choices: [
      { id: "A", text: "설명을 하나하나 그대로 따라간다", pole: "S" },
      { id: "B", text: "설명을 들으며 이런저런 아이디어가 떠오른다", pole: "N" },
    ],

    imagePath: "/Images/questions/q04_group_talk_vs_listen.png",
  },
  {
    id: "SN-23",
    axis: "SN",
    prompt: "종이접기를 할 때 너는?",
    choices: [
      { id: "A", text: "접는 순서를 하나씩 정확히 따른다", pole: "S" },
      { id: "B", text: "내 마음대로 접어 새로운 걸 만든다", pole: "N" },
    ],

    imagePath: "/Images/questions/q07_puzzle_fast_try_vs_slow_check.png",
  },
  {
    id: "SN-24",
    axis: "SN",
    prompt: "여행을 앞두고 너는?",
    choices: [
      { id: "A", text: "어떤 신나는 일이 생길지 상상한다", pole: "N" },
      { id: "B", text: "무엇을 챙겨야 할지 하나씩 살핀다", pole: "S" },
    ],

    imagePath: "/Images/questions/q19_make_schedule_vs_spontaneous.png",
  },
  {
    id: "SN-25",
    axis: "SN",
    prompt: "친구에게 오늘 일을 말할 때 너는?",
    choices: [
      { id: "A", text: "있었던 일을 순서대로 그대로 말한다", pole: "S" },
      { id: "B", text: "재미있게 살을 붙여 이야기한다", pole: "N" },
    ],

    imagePath: "/Images/questions/q02_playground_join_vs_watch.png",
  },
  {
    id: "SN-26",
    axis: "SN",
    prompt: "새 단어를 배웠어. 너는?",
    choices: [
      { id: "A", text: "이 말로 무슨 재밌는 걸 할까 상상한다", pole: "N" },
      { id: "B", text: "뜻과 쓰는 법을 정확히 익힌다", pole: "S" },
    ],

    imagePath: "/Images/questions/q03_new_friend_first.png",
  },
  {
    id: "SN-27",
    axis: "SN",
    prompt: "퍼즐을 맞출 때 너는?",
    choices: [
      { id: "A", text: "테두리부터 순서대로 맞춰간다", pole: "S" },
      { id: "B", text: "완성 그림을 떠올리며 여기저기 맞춰본다", pole: "N" },
    ],

    imagePath: "/Images/questions/q07_puzzle_fast_try_vs_slow_check.png",
  },
  {
    id: "SN-28",
    axis: "SN",
    prompt: "비 오는 날 창밖을 볼 때 너는?",
    choices: [
      { id: "A", text: "빗방울이 어디로 흘러갈지 상상한다", pole: "N" },
      { id: "B", text: "비가 얼마나 오는지 살펴본다", pole: "S" },
    ],

    imagePath: "/Images/questions/q11_room_tidy_now_vs_later.png",
  },
  {
    id: "SN-29",
    axis: "SN",
    prompt: "만들기 준비물을 챙길 때 너는?",
    choices: [
      { id: "A", text: "목록을 보고 하나씩 확인한다", pole: "S" },
      { id: "B", text: "필요한 게 뭘까 떠올리며 챙긴다", pole: "N" },
    ],

    imagePath: "/Images/questions/q07_puzzle_fast_try_vs_slow_check.png",
  },
  {
    id: "SN-30",
    axis: "SN",
    prompt: "친구가 '이거 뭐 같아?'라고 물으면 너는?",
    choices: [
      { id: "A", text: "여러 가지로 상상해 대답한다", pole: "N" },
      { id: "B", text: "생긴 그대로 뭐라고 대답한다", pole: "S" },
    ],

    imagePath: "/Images/questions/q13_party_center_vs_quiet_corner.png",
  },
  {
    id: "SN-31",
    axis: "SN",
    prompt: "숫자 세기 놀이를 할 때 너는?",
    choices: [
      { id: "A", text: "하나씩 차근차근 정확히 센다", pole: "S" },
      { id: "B", text: "눈대중으로 재빨리 어림한다", pole: "N" },
    ],

    imagePath: "/Images/questions/q01_blocks_plan_vs_change.png",
  },
  {
    id: "SN-32",
    axis: "SN",
    prompt: "그림책을 다 읽고 너는?",
    choices: [
      { id: "A", text: "뒷이야기를 상상해서 지어낸다", pole: "N" },
      { id: "B", text: "내용을 처음부터 다시 떠올려본다", pole: "S" },
    ],

    imagePath: "/Images/questions/q07_puzzle_fast_try_vs_slow_check.png",
  },
  {
    id: "SN-33",
    axis: "SN",
    prompt: "레고 설명서가 있을 때 너는?",
    choices: [
      { id: "A", text: "단계대로 정확히 조립한다", pole: "S" },
      { id: "B", text: "설명서 없이 내 방식대로 만든다", pole: "N" },
    ],

    imagePath: "/Images/questions/q10_story_real_vs_imagine.png",
  },
  {
    id: "SN-34",
    axis: "SN",
    prompt: "새 노래를 들었어. 너는?",
    choices: [
      { id: "A", text: "노래를 들으며 한 장면을 상상한다", pole: "N" },
      { id: "B", text: "가사와 멜로디를 그대로 따라 부른다", pole: "S" },
    ],

    imagePath: "/Images/questions/q12_game_rule_exact_vs_flexible.png",
  },
  {
    id: "SN-35",
    axis: "SN",
    prompt: "물건을 설명할 때 너는?",
    choices: [
      { id: "A", text: "색깔, 크기 같은 걸 정확히 말한다", pole: "S" },
      { id: "B", text: "무엇과 닮았는지 빗대어 말한다", pole: "N" },
    ],

    imagePath: "/Images/questions/q17_free_time_many_friends_vs_alone_hobby.png",
  },
  {
    id: "SN-36",
    axis: "SN",
    prompt: "빈 도화지를 받았어. 너는?",
    choices: [
      { id: "A", text: "어떤 상상을 그릴까 먼저 떠올린다", pole: "N" },
      { id: "B", text: "무엇을 그릴지 실제 본 걸 정한다", pole: "S" },
    ],

    imagePath: "/Images/questions/q12_game_rule_exact_vs_flexible.png",
  },
  {
    id: "SN-37",
    axis: "SN",
    prompt: "친구와 역할 놀이를 할 때 너는?",
    choices: [
      { id: "A", text: "실제 있을 법한 상황으로 논다", pole: "S" },
      { id: "B", text: "새로운 이야기를 마구 만들어낸다", pole: "N" },
    ],

    imagePath: "/Images/questions/q12_game_rule_exact_vs_flexible.png",
  },
  {
    id: "SN-38",
    axis: "SN",
    prompt: "만든 작품을 소개할 때 너는?",
    choices: [
      { id: "A", text: "어떻게 만들었는지 순서대로 말한다", pole: "S" },
      { id: "B", text: "어떤 상상으로 만들었는지 이야기한다", pole: "N" },
    ],

    imagePath: "/Images/questions/q12_game_rule_exact_vs_flexible.png",
  },
  {
    id: "SN-39",
    axis: "SN",
    prompt: "구름 낀 하늘을 보며 너는?",
    choices: [
      { id: "A", text: "저 위에 뭐가 있을까 상상한다", pole: "N" },
      { id: "B", text: "오늘 날씨가 어떤지 살펴본다", pole: "S" },
    ],

    imagePath: "/Images/questions/q05_draw_follow_vs_improvise.png",
  },
  {
    id: "SN-40",
    axis: "SN",
    prompt: "책상 위 물건을 셀 때 너는?",
    choices: [
      { id: "A", text: "하나하나 정확히 세어 말한다", pole: "S" },
      { id: "B", text: "대략 이만큼 있겠다 하고 짐작한다", pole: "N" },
    ],

    imagePath: "/Images/questions/q11_room_tidy_now_vs_later.png",
  },
  {
    id: "SN-41",
    axis: "SN",
    prompt: "빈 시간이 생기면 너는?",
    choices: [
      { id: "A", text: "이런저런 상상에 자주 빠진다", pole: "N" },
      { id: "B", text: "지금 할 수 있는 걸 찾아 한다", pole: "S" },
    ],

    imagePath: "/Images/questions/q11_room_tidy_now_vs_later.png",
  },
  {
    id: "SN-42",
    axis: "SN",
    prompt: "친구 말을 들을 때 너는?",
    choices: [
      { id: "A", text: "들은 내용을 그대로 이해한다", pole: "S" },
      { id: "B", text: "숨은 뜻이 뭘까 상상해본다", pole: "N" },
    ],

    imagePath: "/Images/questions/q14_gift_choose_practical_vs_heart.png",
  },
  {
    id: "SN-43",
    axis: "SN",
    prompt: "새 놀이를 배울 때 너는?",
    choices: [
      { id: "A", text: "이 놀이를 더 재밌게 바꿀 상상을 한다", pole: "N" },
      { id: "B", text: "정해진 방법을 그대로 익힌다", pole: "S" },
    ],

    imagePath: "/Images/questions/q01_blocks_plan_vs_change.png",
  },
  {
    id: "SN-44",
    axis: "SN",
    prompt: "일기를 쓸 때 너는?",
    choices: [
      { id: "A", text: "오늘 있었던 일을 사실대로 적는다", pole: "S" },
      { id: "B", text: "상상을 더해 재밌게 꾸며 적는다", pole: "N" },
    ],

    imagePath: "/Images/questions/q10_story_real_vs_imagine.png",
  },
  {
    id: "SN-45",
    axis: "SN",
    prompt: "선물 상자를 받기 전 너는?",
    choices: [
      { id: "A", text: "안에 뭐가 있을지 온갖 상상을 한다", pole: "N" },
      { id: "B", text: "상자 크기와 무게로 짐작해본다", pole: "S" },
    ],

    imagePath: "/Images/questions/q02_playground_join_vs_watch.png",
  },
  {
    id: "SN-46",
    axis: "SN",
    prompt: "그림 그리기 대회에 나갔어. 너는?",
    choices: [
      { id: "A", text: "눈에 보이는 풍경을 자세히 그린다", pole: "S" },
      { id: "B", text: "상상 속 장면을 자유롭게 그린다", pole: "N" },
    ],

    imagePath: "/Images/questions/q07_puzzle_fast_try_vs_slow_check.png",
  },
  {
    id: "SN-47",
    axis: "SN",
    prompt: "친구가 이상한 이야기를 하면 너는?",
    choices: [
      { id: "A", text: "거기에 상상을 더 보태 이야기한다", pole: "N" },
      { id: "B", text: "정말 그런지 하나씩 되물어본다", pole: "S" },
    ],

    imagePath: "/Images/questions/q13_party_center_vs_quiet_corner.png",
  },
  {
    id: "SN-48",
    axis: "SN",
    prompt: "요리 순서를 배울 때 너는?",
    choices: [
      { id: "A", text: "적힌 순서를 하나씩 그대로 따른다", pole: "S" },
      { id: "B", text: "내 방식대로 순서를 바꿔본다", pole: "N" },
    ],

    imagePath: "/Images/questions/q06_trip_plan_vs_go_with_flow.png",
  },
  {
    id: "SN-49",
    axis: "SN",
    prompt: "새 학용품을 보면 너는?",
    choices: [
      { id: "A", text: "이걸로 뭘 만들까 상상부터 한다", pole: "N" },
      { id: "B", text: "어떻게 쓰는 물건인지 살펴본다", pole: "S" },
    ],

    imagePath: "/Images/questions/q15_science_fact_vs_idea.png",
  },
  {
    id: "SN-50",
    axis: "SN",
    prompt: "길에서 신기한 걸 봤어. 너는?",
    choices: [
      { id: "A", text: "왜 저럴까 이런저런 상상을 한다", pole: "N" },
      { id: "B", text: "무엇인지 자세히 살펴본다", pole: "S" },
    ],

    imagePath: "/Images/questions/q17_free_time_many_friends_vs_alone_hobby.png",
  },

  // ── T/F 축 신규 46문항 ──────────────────────────────────────────
  {
    id: "TF-05",
    axis: "TF",
    prompt: "친구가 넘어져서 울고 있어. 너는?",
    choices: [
      { id: "A", text: "먼저 다가가 괜찮냐고 위로한다", pole: "F" },
      { id: "B", text: "어디를 다쳤는지 살펴보고 도와준다", pole: "T" },
    ],

    imagePath: "/Images/questions/q18_problem_rule_vs_empathy.png",
  },
  {
    id: "TF-06",
    axis: "TF",
    prompt: "게임에서 누가 이겼는지 헷갈려. 너는?",
    choices: [
      { id: "A", text: "점수를 다시 세어 정확히 가린다", pole: "T" },
      { id: "B", text: "둘 다 잘했다며 기분 좋게 넘긴다", pole: "F" },
    ],

    imagePath: "/Images/questions/q10_story_real_vs_imagine.png",
  },
  {
    id: "TF-07",
    axis: "TF",
    prompt: "친구가 새 옷을 보여줬어. 너는?",
    choices: [
      { id: "A", text: "기분 좋으라고 예쁘다고 말한다", pole: "F" },
      { id: "B", text: "솔직하게 내 생각을 말한다", pole: "T" },
    ],

    imagePath: "/Images/questions/q02_playground_join_vs_watch.png",
  },
  {
    id: "TF-08",
    axis: "TF",
    prompt: "모둠에서 역할을 나눌 때 너는?",
    choices: [
      { id: "A", text: "다들 하고 싶은 걸 하도록 맞춘다", pole: "F" },
      { id: "B", text: "누가 뭘 잘하는지 따져 정한다", pole: "T" },
    ],

    imagePath: "/Images/questions/q20_show_talent_vs_prepare_first.png",
  },
  {
    id: "TF-09",
    axis: "TF",
    prompt: "동생이 실수로 물을 쏟았어. 너는?",
    choices: [
      { id: "A", text: "왜 쏟았는지 알아보고 함께 치운다", pole: "T" },
      { id: "B", text: "놀랐겠다며 먼저 다독인다", pole: "F" },
    ],

    imagePath: "/Images/questions/q06_trip_plan_vs_go_with_flow.png",
  },
  {
    id: "TF-10",
    axis: "TF",
    prompt: "친구 둘이 다퉜어. 너는?",
    choices: [
      { id: "A", text: "누구 말이 맞는지 따져본다", pole: "T" },
      { id: "B", text: "둘 다 마음이 풀리게 도와준다", pole: "F" },
    ],

    imagePath: "/Images/questions/q18_problem_rule_vs_empathy.png",
  },
  {
    id: "TF-11",
    axis: "TF",
    prompt: "친구가 그림을 못 그렸다고 속상해해. 너는?",
    choices: [
      { id: "A", text: "네 그림 멋지다고 기운을 준다", pole: "F" },
      { id: "B", text: "이 부분을 이렇게 고치면 좋겠다고 말한다", pole: "T" },
    ],

    imagePath: "/Images/questions/q13_party_center_vs_quiet_corner.png",
  },
  {
    id: "TF-12",
    axis: "TF",
    prompt: "규칙을 어긴 친구를 봤어. 너는?",
    choices: [
      { id: "A", text: "규칙은 규칙이니 지켜야 한다고 말한다", pole: "T" },
      { id: "B", text: "사정이 있었는지 먼저 들어본다", pole: "F" },
    ],

    imagePath: "/Images/questions/q18_problem_rule_vs_empathy.png",
  },
  {
    id: "TF-13",
    axis: "TF",
    prompt: "친구가 도시락을 안 가져왔어. 너는?",
    choices: [
      { id: "A", text: "속상하겠다며 내 반찬을 나눠준다", pole: "F" },
      { id: "B", text: "선생님께 말씀드리는 게 낫다고 알려준다", pole: "T" },
    ],

    imagePath: "/Images/questions/q02_playground_join_vs_watch.png",
  },
  {
    id: "TF-14",
    axis: "TF",
    prompt: "숙제 답이 친구와 다르게 나왔어. 너는?",
    choices: [
      { id: "A", text: "어느 답이 맞는지 다시 풀어본다", pole: "T" },
      { id: "B", text: "친구 마음 상하지 않게 조심히 말한다", pole: "F" },
    ],

    imagePath: "/Images/questions/q03_new_friend_first.png",
  },
  {
    id: "TF-15",
    axis: "TF",
    prompt: "친구가 시험을 잘 봤다고 자랑해. 너는?",
    choices: [
      { id: "A", text: "진심으로 축하한다고 말해준다", pole: "F" },
      { id: "B", text: "어떻게 공부했는지 방법을 물어본다", pole: "T" },
    ],

    imagePath: "/Images/questions/q14_gift_choose_practical_vs_heart.png",
  },
  {
    id: "TF-16",
    axis: "TF",
    prompt: "아끼던 장난감이 고장 났어. 너는?",
    choices: [
      { id: "A", text: "아끼던 거라 속상한 마음을 달랜다", pole: "F" },
      { id: "B", text: "왜 고장 났는지 살펴 고쳐본다", pole: "T" },
    ],

    imagePath: "/Images/questions/q07_puzzle_fast_try_vs_slow_check.png",
  },
  {
    id: "TF-17",
    axis: "TF",
    prompt: "친구가 나한테 비밀을 털어놨어. 너는?",
    choices: [
      { id: "A", text: "어떻게 하면 좋을지 방법을 말해준다", pole: "T" },
      { id: "B", text: "마음을 알아주고 편이 되어준다", pole: "F" },
    ],

    imagePath: "/Images/questions/q02_playground_join_vs_watch.png",
  },
  {
    id: "TF-18",
    axis: "TF",
    prompt: "줄을 서는데 누가 새치기했어. 너는?",
    choices: [
      { id: "A", text: "순서대로 서야 맞다고 말한다", pole: "T" },
      { id: "B", text: "급한 일 있었는지 물어보고 넘긴다", pole: "F" },
    ],

    imagePath: "/Images/questions/q08_help_friend_feel_vs_solution.png",
  },
  {
    id: "TF-19",
    axis: "TF",
    prompt: "친구가 혼자 앉아 있어 보여. 너는?",
    choices: [
      { id: "A", text: "외로울까 봐 옆에 가서 함께 있는다", pole: "F" },
      { id: "B", text: "왜 혼자 있는지 이유를 물어본다", pole: "T" },
    ],

    imagePath: "/Images/questions/q13_party_center_vs_quiet_corner.png",
  },
  {
    id: "TF-20",
    axis: "TF",
    prompt: "칭찬 스티커를 나눠줄 때 너는?",
    choices: [
      { id: "A", text: "한 일에 맞게 공평하게 나눈다", pole: "T" },
      { id: "B", text: "다 같이 기분 좋게 골고루 나눈다", pole: "F" },
    ],

    imagePath: "/Images/questions/q09_school_task_detail_vs_big_picture.png",
  },
  {
    id: "TF-21",
    axis: "TF",
    prompt: "친구가 발표하다 실수했어. 너는?",
    choices: [
      { id: "A", text: "어디를 틀렸는지 나중에 알려준다", pole: "T" },
      { id: "B", text: "괜찮다고 따뜻하게 웃어준다", pole: "F" },
    ],

    imagePath: "/Images/questions/q15_science_fact_vs_idea.png",
  },
  {
    id: "TF-22",
    axis: "TF",
    prompt: "보드게임 규칙을 두고 의견이 갈려. 너는?",
    choices: [
      { id: "A", text: "서로 좋게 정하자고 이야기한다", pole: "F" },
      { id: "B", text: "설명서를 찾아 정확히 확인한다", pole: "T" },
    ],

    imagePath: "/Images/questions/q05_draw_follow_vs_improvise.png",
  },
  {
    id: "TF-23",
    axis: "TF",
    prompt: "친구가 우산을 안 가져왔어. 너는?",
    choices: [
      { id: "A", text: "비 그칠 때까지 기다리라고 알려준다", pole: "T" },
      { id: "B", text: "같이 쓰자며 우산을 내민다", pole: "F" },
    ],

    imagePath: "/Images/questions/q08_help_friend_feel_vs_solution.png",
  },
  {
    id: "TF-24",
    axis: "TF",
    prompt: "팀 경기에서 진 팀이 속상해해. 너는?",
    choices: [
      { id: "A", text: "괜찮다고 함께 기운을 북돋운다", pole: "F" },
      { id: "B", text: "어떻게 하면 다음에 이길지 알려준다", pole: "T" },
    ],

    imagePath: "/Images/questions/q07_puzzle_fast_try_vs_slow_check.png",
  },
  {
    id: "TF-25",
    axis: "TF",
    prompt: "새 친구가 말을 잘 못 해 쭈뼛거려. 너는?",
    choices: [
      { id: "A", text: "편하게 웃어주며 다정하게 대한다", pole: "F" },
      { id: "B", text: "먼저 궁금한 걸 물어보며 대화한다", pole: "T" },
    ],

    imagePath: "/Images/questions/q14_gift_choose_practical_vs_heart.png",
  },
  {
    id: "TF-26",
    axis: "TF",
    prompt: "물건이 하나 없어졌어. 너는?",
    choices: [
      { id: "A", text: "어디서 없어졌는지 차근차근 찾는다", pole: "T" },
      { id: "B", text: "속상하지만 마음을 가라앉힌다", pole: "F" },
    ],

    imagePath: "/Images/questions/q11_room_tidy_now_vs_later.png",
  },
  {
    id: "TF-27",
    axis: "TF",
    prompt: "친구가 슬픈 영화를 보고 울어. 너는?",
    choices: [
      { id: "A", text: "그냥 이야기일 뿐이라고 말해준다", pole: "T" },
      { id: "B", text: "같이 슬퍼하며 등을 토닥여준다", pole: "F" },
    ],

    imagePath: "/Images/questions/q18_problem_rule_vs_empathy.png",
  },
  {
    id: "TF-28",
    axis: "TF",
    prompt: "심부름으로 거스름돈을 받았어. 너는?",
    choices: [
      { id: "A", text: "고맙다고 인사부터 한다", pole: "F" },
      { id: "B", text: "금액이 맞는지 정확히 세어본다", pole: "T" },
    ],

    imagePath: "/Images/questions/q17_free_time_many_friends_vs_alone_hobby.png",
  },
  {
    id: "TF-29",
    axis: "TF",
    prompt: "친구가 자기 강아지가 아프다고 해. 너는?",
    choices: [
      { id: "A", text: "병원에 데려가 봤는지 물어본다", pole: "T" },
      { id: "B", text: "많이 걱정되겠다며 마음을 나눈다", pole: "F" },
    ],

    imagePath: "/Images/questions/q18_problem_rule_vs_empathy.png",
  },
  {
    id: "TF-30",
    axis: "TF",
    prompt: "둘이 나눠 먹을 간식이 하나 남았어. 너는?",
    choices: [
      { id: "A", text: "똑같이 반으로 나누자고 한다", pole: "T" },
      { id: "B", text: "먹고 싶어 하는 친구에게 양보한다", pole: "F" },
    ],

    imagePath: "/Images/questions/q14_gift_choose_practical_vs_heart.png",
  },
  {
    id: "TF-31",
    axis: "TF",
    prompt: "친구가 큰 실수를 해서 풀 죽어 있어. 너는?",
    choices: [
      { id: "A", text: "누구나 실수한다며 위로한다", pole: "F" },
      { id: "B", text: "다음엔 이렇게 하자고 방법을 말한다", pole: "T" },
    ],

    imagePath: "/Images/questions/q14_gift_choose_practical_vs_heart.png",
  },
  {
    id: "TF-32",
    axis: "TF",
    prompt: "받아쓰기 채점을 도울 때 너는?",
    choices: [
      { id: "A", text: "맞고 틀린 걸 정확히 가른다", pole: "T" },
      { id: "B", text: "틀려도 기죽지 않게 좋게 말해준다", pole: "F" },
    ],

    imagePath: "/Images/questions/q04_group_talk_vs_listen.png",
  },
  {
    id: "TF-33",
    axis: "TF",
    prompt: "친구가 이사 가서 슬퍼해. 너는?",
    choices: [
      { id: "A", text: "보고 싶겠다며 함께 아쉬워한다", pole: "F" },
      { id: "B", text: "자주 연락할 방법을 찾아본다", pole: "T" },
    ],

    imagePath: "/Images/questions/q14_gift_choose_practical_vs_heart.png",
  },
  {
    id: "TF-34",
    axis: "TF",
    prompt: "놀이 순서를 정할 때 너는?",
    choices: [
      { id: "A", text: "가위바위보로 공평하게 정하자고 한다", pole: "T" },
      { id: "B", text: "양보하며 서로 기분 좋게 정한다", pole: "F" },
    ],

    imagePath: "/Images/questions/q01_blocks_plan_vs_change.png",
  },
  {
    id: "TF-35",
    axis: "TF",
    prompt: "친구가 혼나서 눈물이 그렁그렁해. 너는?",
    choices: [
      { id: "A", text: "왜 혼났는지 상황을 살펴본다", pole: "T" },
      { id: "B", text: "곁에서 조용히 마음을 달래준다", pole: "F" },
    ],

    imagePath: "/Images/questions/q14_gift_choose_practical_vs_heart.png",
  },
  {
    id: "TF-36",
    axis: "TF",
    prompt: "두 가지 방법 중 뭐가 나은지 고를 때 너는?",
    choices: [
      { id: "A", text: "모두가 편한 쪽으로 고른다", pole: "F" },
      { id: "B", text: "어느 쪽이 더 나은지 따져 고른다", pole: "T" },
    ],

    imagePath: "/Images/questions/q11_room_tidy_now_vs_later.png",
  },
  {
    id: "TF-37",
    axis: "TF",
    prompt: "친구가 나랑 놀고 싶어 하는 눈치야. 너는?",
    choices: [
      { id: "A", text: "먼저 말해주면 좋겠다고 생각한다", pole: "T" },
      { id: "B", text: "마음을 알아채고 먼저 같이 놀자 한다", pole: "F" },
    ],

    imagePath: "/Images/questions/q14_gift_choose_practical_vs_heart.png",
  },
  {
    id: "TF-38",
    axis: "TF",
    prompt: "숙제를 언제 할지 정할 때 너는?",
    choices: [
      { id: "A", text: "할 일 양을 따져 시간을 정한다", pole: "T" },
      { id: "B", text: "하고 싶을 때 기분 좋게 시작한다", pole: "F" },
    ],

    imagePath: "/Images/questions/q17_free_time_many_friends_vs_alone_hobby.png",
  },
  {
    id: "TF-39",
    axis: "TF",
    prompt: "친구가 상을 못 받아 시무룩해. 너는?",
    choices: [
      { id: "A", text: "네 마음 다 안다며 토닥여준다", pole: "F" },
      { id: "B", text: "다음 기회를 노려보자고 말한다", pole: "T" },
    ],

    imagePath: "/Images/questions/q13_party_center_vs_quiet_corner.png",
  },
  {
    id: "TF-40",
    axis: "TF",
    prompt: "블록이 자꾸 무너져. 너는?",
    choices: [
      { id: "A", text: "왜 무너지는지 살펴 튼튼하게 쌓는다", pole: "T" },
      { id: "B", text: "속상해도 다시 해보자며 마음을 잡는다", pole: "F" },
    ],

    imagePath: "/Images/questions/q01_blocks_plan_vs_change.png",
  },
  {
    id: "TF-41",
    axis: "TF",
    prompt: "친구가 새로 산 신발을 자랑해. 너는?",
    choices: [
      { id: "A", text: "어디서 샀는지 물어본다", pole: "T" },
      { id: "B", text: "멋지다며 신나게 함께 기뻐한다", pole: "F" },
    ],

    imagePath: "/Images/questions/q18_problem_rule_vs_empathy.png",
  },
  {
    id: "TF-42",
    axis: "TF",
    prompt: "심판을 맡았는데 판정이 애매해. 너는?",
    choices: [
      { id: "A", text: "양쪽 다 서운하지 않게 살핀다", pole: "F" },
      { id: "B", text: "규칙대로 정확하게 판정한다", pole: "T" },
    ],

    imagePath: "/Images/questions/q12_game_rule_exact_vs_flexible.png",
  },
  {
    id: "TF-43",
    axis: "TF",
    prompt: "친구가 감기에 걸렸대. 너는?",
    choices: [
      { id: "A", text: "약 먹고 푹 쉬라고 알려준다", pole: "T" },
      { id: "B", text: "많이 아프겠다며 걱정해준다", pole: "F" },
    ],

    imagePath: "/Images/questions/q08_help_friend_feel_vs_solution.png",
  },
  {
    id: "TF-44",
    axis: "TF",
    prompt: "간식을 여럿이 나눌 때 너는?",
    choices: [
      { id: "A", text: "서로 양보하며 기분 좋게 나눈다", pole: "F" },
      { id: "B", text: "수를 세어 똑같이 나눈다", pole: "T" },
    ],

    imagePath: "/Images/questions/q13_party_center_vs_quiet_corner.png",
  },
  {
    id: "TF-45",
    axis: "TF",
    prompt: "친구가 자기 이야기를 길게 해. 너는?",
    choices: [
      { id: "A", text: "핵심이 뭔지 물어보며 듣는다", pole: "T" },
      { id: "B", text: "고개 끄덕이며 끝까지 들어준다", pole: "F" },
    ],

    imagePath: "/Images/questions/q08_help_friend_feel_vs_solution.png",
  },
  {
    id: "TF-46",
    axis: "TF",
    prompt: "친구가 나 때문에 속상했다고 해. 너는?",
    choices: [
      { id: "A", text: "마음 아프게 해서 미안하다고 한다", pole: "F" },
      { id: "B", text: "어떤 점이 속상했는지 물어본다", pole: "T" },
    ],

    imagePath: "/Images/questions/q02_playground_join_vs_watch.png",
  },
  {
    id: "TF-47",
    axis: "TF",
    prompt: "체육 시간에 편을 가르는데 한 친구만 안 뽑혀서 속상해 보여. 너는?",
    choices: [
      { id: "A", text: "괜찮다며 얼른 우리 편으로 부른다", pole: "F" },
      { id: "B", text: "다음부터 순서를 정해 뽑자고 제안한다", pole: "T" },
    ],

    imagePath: "/Images/questions/q15_science_fact_vs_idea.png",
  },
  {
    id: "TF-48",
    axis: "TF",
    prompt: "체험학습 버스 자리를 두고 실랑이가 났어. 너는?",
    choices: [
      { id: "A", text: "번호 순서대로 앉는 게 공평하다고 말한다", pole: "T" },
      { id: "B", text: "먼저 온 친구에게 양보하며 웃어넘긴다", pole: "F" },
    ],

    imagePath: "/Images/questions/q16_team_lead_vs_support.png",
  },
  {
    id: "TF-49",
    axis: "TF",
    prompt: "할머니 댁에서 사촌이 게임에 자꾸 져서 속상해해. 너는?",
    choices: [
      { id: "A", text: "속상하겠다며 다음엔 잘될 거라고 다독인다", pole: "F" },
      { id: "B", text: "어느 부분에서 지는지 같이 살펴본다", pole: "T" },
    ],

    imagePath: "/Images/questions/q19_make_schedule_vs_spontaneous.png",
  },
  {
    id: "TF-50",
    axis: "TF",
    prompt: "모둠 점수가 깎여서 친구들이 서로 탓해. 너는?",
    choices: [
      { id: "A", text: "정확히 무슨 일이 있었는지 순서대로 물어본다", pole: "T" },
      { id: "B", text: "다들 속상하니 그만하자며 다독인다", pole: "F" },
    ],

    imagePath: "/Images/questions/q20_show_talent_vs_prepare_first.png",
  },

  // ── J/P 축 신규 46문항 ──────────────────────────────────────────
  {
    id: "JP-05",
    axis: "JP",
    prompt: "아침에 일어나면 너는?",
    choices: [
      { id: "A", text: "그때그때 하고 싶은 걸 한다", pole: "P" },
      { id: "B", text: "오늘 할 일을 순서대로 정한다", pole: "J" },
    ],

    imagePath: "/Images/questions/q06_trip_plan_vs_go_with_flow.png",
  },
  {
    id: "JP-06",
    axis: "JP",
    prompt: "방학이 시작됐어. 너는?",
    choices: [
      { id: "A", text: "방학 계획표를 미리 짜둔다", pole: "J" },
      { id: "B", text: "계획 없이 자유롭게 보내고 싶다", pole: "P" },
    ],

    imagePath: "/Images/questions/q06_trip_plan_vs_go_with_flow.png",
  },
  {
    id: "JP-07",
    axis: "JP",
    prompt: "가방을 챙길 때 너는?",
    choices: [
      { id: "A", text: "아침에 생각나는 대로 챙긴다", pole: "P" },
      { id: "B", text: "시간표대로 미리 다 챙겨둔다", pole: "J" },
    ],

    imagePath: "/Images/questions/q04_group_talk_vs_listen.png",
  },
  {
    id: "JP-08",
    axis: "JP",
    prompt: "숙제와 놀기 중 무엇을 먼저 할까. 너는?",
    choices: [
      { id: "A", text: "놀고 싶으면 먼저 놀고 본다", pole: "P" },
      { id: "B", text: "숙제부터 끝내고 논다", pole: "J" },
    ],

    imagePath: "/Images/questions/q19_make_schedule_vs_spontaneous.png",
  },
  {
    id: "JP-09",
    axis: "JP",
    prompt: "여행 가방을 쌀 때 너는?",
    choices: [
      { id: "A", text: "목록을 만들어 하나씩 챙긴다", pole: "J" },
      { id: "B", text: "필요한 것만 대충 챙겨 떠난다", pole: "P" },
    ],

    imagePath: "/Images/questions/q06_trip_plan_vs_go_with_flow.png",
  },
  {
    id: "JP-10",
    axis: "JP",
    prompt: "친구랑 노는 방법을 정할 때 너는?",
    choices: [
      { id: "A", text: "그때 끌리는 놀이를 한다", pole: "P" },
      { id: "B", text: "뭘 하고 놀지 먼저 정한다", pole: "J" },
    ],

    imagePath: "/Images/questions/q18_problem_rule_vs_empathy.png",
  },
  {
    id: "JP-11",
    axis: "JP",
    prompt: "그림을 그리기 전에 너는?",
    choices: [
      { id: "A", text: "무엇을 그릴지 정하고 시작한다", pole: "J" },
      { id: "B", text: "손 가는 대로 그리며 정한다", pole: "P" },
    ],

    imagePath: "/Images/questions/q07_puzzle_fast_try_vs_slow_check.png",
  },
  {
    id: "JP-12",
    axis: "JP",
    prompt: "약속 시간에 대해 너는?",
    choices: [
      { id: "A", text: "조금 늦어도 괜찮다고 생각한다", pole: "P" },
      { id: "B", text: "시간을 딱 맞춰 도착하려 한다", pole: "J" },
    ],

    imagePath: "/Images/questions/q13_party_center_vs_quiet_corner.png",
  },
  {
    id: "JP-13",
    axis: "JP",
    prompt: "책상 서랍을 쓸 때 너는?",
    choices: [
      { id: "A", text: "물건마다 칸을 정해 넣는다", pole: "J" },
      { id: "B", text: "빈 곳에 편하게 넣는다", pole: "P" },
    ],

    imagePath: "/Images/questions/q11_room_tidy_now_vs_later.png",
  },
  {
    id: "JP-14",
    axis: "JP",
    prompt: "주말이 왔어. 너는?",
    choices: [
      { id: "A", text: "할 일과 놀 일을 미리 정한다", pole: "J" },
      { id: "B", text: "계획 없이 흘러가는 대로 논다", pole: "P" },
    ],

    imagePath: "/Images/questions/q19_make_schedule_vs_spontaneous.png",
  },
  {
    id: "JP-15",
    axis: "JP",
    prompt: "만들기 과제를 받으면 너는?",
    choices: [
      { id: "A", text: "이것저것 해보며 만들어간다", pole: "P" },
      { id: "B", text: "순서를 정해 차근차근 만든다", pole: "J" },
    ],

    imagePath: "/Images/questions/q09_school_task_detail_vs_big_picture.png",
  },
  {
    id: "JP-16",
    axis: "JP",
    prompt: "게임을 시작하기 전 너는?",
    choices: [
      { id: "A", text: "일단 시작하고 규칙은 하면서 안다", pole: "P" },
      { id: "B", text: "규칙을 다 익히고 시작한다", pole: "J" },
    ],

    imagePath: "/Images/questions/q12_game_rule_exact_vs_flexible.png",
  },
  {
    id: "JP-17",
    axis: "JP",
    prompt: "숙제를 언제 하느냐면 너는?",
    choices: [
      { id: "A", text: "정해둔 시간에 딱 맞춰 한다", pole: "J" },
      { id: "B", text: "하고 싶어질 때 시작한다", pole: "P" },
    ],

    imagePath: "/Images/questions/q17_free_time_many_friends_vs_alone_hobby.png",
  },
  {
    id: "JP-18",
    axis: "JP",
    prompt: "장난감을 다 갖고 놀면 너는?",
    choices: [
      { id: "A", text: "바로 제자리에 정리한다", pole: "J" },
      { id: "B", text: "나중에 몰아서 치운다", pole: "P" },
    ],

    imagePath: "/Images/questions/q01_blocks_plan_vs_change.png",
  },
  {
    id: "JP-19",
    axis: "JP",
    prompt: "소풍 가는 날 아침, 너는?",
    choices: [
      { id: "A", text: "아침에 서둘러 챙겨 나간다", pole: "P" },
      { id: "B", text: "챙길 걸 전날 다 준비해둔다", pole: "J" },
    ],

    imagePath: "/Images/questions/q15_science_fact_vs_idea.png",
  },
  {
    id: "JP-20",
    axis: "JP",
    prompt: "모둠에서 새 과제를 시작해. 너는?",
    choices: [
      { id: "A", text: "일단 해보면서 방향을 잡는다", pole: "P" },
      { id: "B", text: "계획을 세우고 나서 시작한다", pole: "J" },
    ],

    imagePath: "/Images/questions/q16_team_lead_vs_support.png",
  },
  {
    id: "JP-21",
    axis: "JP",
    prompt: "시험 공부를 할 때 너는?",
    choices: [
      { id: "A", text: "공부 계획을 짜서 그대로 한다", pole: "J" },
      { id: "B", text: "그날 기분대로 골라서 한다", pole: "P" },
    ],

    imagePath: "/Images/questions/q15_science_fact_vs_idea.png",
  },
  {
    id: "JP-22",
    axis: "JP",
    prompt: "여행 중 자유 시간이 생겼어. 너는?",
    choices: [
      { id: "A", text: "마음 가는 대로 돌아다닌다", pole: "P" },
      { id: "B", text: "어디를 갈지 정해서 움직인다", pole: "J" },
    ],

    imagePath: "/Images/questions/q17_free_time_many_friends_vs_alone_hobby.png",
  },
  {
    id: "JP-23",
    axis: "JP",
    prompt: "정리 정돈에 대해 너는?",
    choices: [
      { id: "A", text: "좀 어질러도 크게 신경 안 쓴다", pole: "P" },
      { id: "B", text: "물건이 제자리에 있어야 편하다", pole: "J" },
    ],

    imagePath: "/Images/questions/q17_free_time_many_friends_vs_alone_hobby.png",
  },
  {
    id: "JP-24",
    axis: "JP",
    prompt: "친구와 만나기로 했어. 너는?",
    choices: [
      { id: "A", text: "뭘 할지 미리 정해둔다", pole: "J" },
      { id: "B", text: "만나서 뭐 할지 그때 정한다", pole: "P" },
    ],

    imagePath: "/Images/questions/q14_gift_choose_practical_vs_heart.png",
  },
  {
    id: "JP-25",
    axis: "JP",
    prompt: "그림일기를 쓸 때 너는?",
    choices: [
      { id: "A", text: "쓰고 싶을 때 몰아서 쓴다", pole: "P" },
      { id: "B", text: "매일 정한 시간에 꼬박꼬박 쓴다", pole: "J" },
    ],

    imagePath: "/Images/questions/q05_draw_follow_vs_improvise.png",
  },
  {
    id: "JP-26",
    axis: "JP",
    prompt: "블록으로 집을 만들 때 너는?",
    choices: [
      { id: "A", text: "완성된 모습을 정하고 시작한다", pole: "J" },
      { id: "B", text: "만들면서 모양을 바꿔간다", pole: "P" },
    ],

    imagePath: "/Images/questions/q12_game_rule_exact_vs_flexible.png",
  },
  {
    id: "JP-27",
    axis: "JP",
    prompt: "용돈을 받으면 너는?",
    choices: [
      { id: "A", text: "얼마를 쓰고 모을지 미리 정한다", pole: "J" },
      { id: "B", text: "필요할 때 그때그때 쓴다", pole: "P" },
    ],

    imagePath: "/Images/questions/q11_room_tidy_now_vs_later.png",
  },
  {
    id: "JP-28",
    axis: "JP",
    prompt: "숙제가 여러 개일 때 너는?",
    choices: [
      { id: "A", text: "눈에 띄는 것부터 그때그때 한다", pole: "P" },
      { id: "B", text: "순서를 정해 하나씩 끝낸다", pole: "J" },
    ],

    imagePath: "/Images/questions/q17_free_time_many_friends_vs_alone_hobby.png",
  },
  {
    id: "JP-29",
    axis: "JP",
    prompt: "아침 등교 준비를 할 때 너는?",
    choices: [
      { id: "A", text: "정해진 순서대로 착착 준비한다", pole: "J" },
      { id: "B", text: "그날그날 편한 대로 준비한다", pole: "P" },
    ],

    imagePath: "/Images/questions/q03_new_friend_first.png",
  },
  {
    id: "JP-30",
    axis: "JP",
    prompt: "친구들이 갑자기 놀자고 해. 너는?",
    choices: [
      { id: "A", text: "계획 없어도 신나게 따라나선다", pole: "P" },
      { id: "B", text: "오늘 할 일을 마치고 나서 논다", pole: "J" },
    ],

    imagePath: "/Images/questions/q14_gift_choose_practical_vs_heart.png",
  },
  {
    id: "JP-31",
    axis: "JP",
    prompt: "방을 꾸밀 때 너는?",
    choices: [
      { id: "A", text: "어디에 뭘 둘지 정하고 꾸민다", pole: "J" },
      { id: "B", text: "이리저리 옮겨보며 꾸민다", pole: "P" },
    ],

    imagePath: "/Images/questions/q17_free_time_many_friends_vs_alone_hobby.png",
  },
  {
    id: "JP-32",
    axis: "JP",
    prompt: "놀이 도중 규칙을 바꾸자고 하면 너는?",
    choices: [
      { id: "A", text: "재밌겠다며 바로 바꿔본다", pole: "P" },
      { id: "B", text: "정한 규칙대로 하는 게 좋다", pole: "J" },
    ],

    imagePath: "/Images/questions/q07_puzzle_fast_try_vs_slow_check.png",
  },
  {
    id: "JP-33",
    axis: "JP",
    prompt: "책을 읽을 때 너는?",
    choices: [
      { id: "A", text: "궁금한 곳부터 골라 읽는다", pole: "P" },
      { id: "B", text: "처음부터 끝까지 순서대로 읽는다", pole: "J" },
    ],

    imagePath: "/Images/questions/q05_draw_follow_vs_improvise.png",
  },
  {
    id: "JP-34",
    axis: "JP",
    prompt: "여름 방학 숙제를 너는?",
    choices: [
      { id: "A", text: "계획을 세워 미리미리 끝낸다", pole: "J" },
      { id: "B", text: "남은 날 봐가며 그때그때 한다", pole: "P" },
    ],

    imagePath: "/Images/questions/q11_room_tidy_now_vs_later.png",
  },
  {
    id: "JP-35",
    axis: "JP",
    prompt: "학용품을 정리할 때 너는?",
    choices: [
      { id: "A", text: "손 닿는 곳에 편하게 둔다", pole: "P" },
      { id: "B", text: "종류별로 자리를 정해 둔다", pole: "J" },
    ],

    imagePath: "/Images/questions/q20_show_talent_vs_prepare_first.png",
  },
  {
    id: "JP-36",
    axis: "JP",
    prompt: "놀러 나가기 전에 너는?",
    choices: [
      { id: "A", text: "일단 나가서 갈 곳을 정한다", pole: "P" },
      { id: "B", text: "어디 갈지 정하고 나간다", pole: "J" },
    ],

    imagePath: "/Images/questions/q02_playground_join_vs_watch.png",
  },
  {
    id: "JP-37",
    axis: "JP",
    prompt: "그림을 그리다 다른 게 하고 싶어졌어. 너는?",
    choices: [
      { id: "A", text: "하던 걸 끝내고 다음 걸 한다", pole: "J" },
      { id: "B", text: "바로 하고 싶은 걸로 바꾼다", pole: "P" },
    ],

    imagePath: "/Images/questions/q10_story_real_vs_imagine.png",
  },
  {
    id: "JP-38",
    axis: "JP",
    prompt: "친구 생일 선물을 준비할 때 너는?",
    choices: [
      { id: "A", text: "가서 보고 마음에 드는 걸 고른다", pole: "P" },
      { id: "B", text: "뭘 살지 미리 정해둔다", pole: "J" },
    ],

    imagePath: "/Images/questions/q02_playground_join_vs_watch.png",
  },
  {
    id: "JP-39",
    axis: "JP",
    prompt: "청소 시간이 됐어. 너는?",
    choices: [
      { id: "A", text: "눈에 보이는 것부터 그때그때 한다", pole: "P" },
      { id: "B", text: "맡은 순서대로 차근차근 한다", pole: "J" },
    ],

    imagePath: "/Images/questions/q04_group_talk_vs_listen.png",
  },
  {
    id: "JP-40",
    axis: "JP",
    prompt: "새 물건을 사면 너는?",
    choices: [
      { id: "A", text: "설명서 읽고 정리부터 한다", pole: "J" },
      { id: "B", text: "일단 써보면서 익혀간다", pole: "P" },
    ],

    imagePath: "/Images/questions/q19_make_schedule_vs_spontaneous.png",
  },
  {
    id: "JP-41",
    axis: "JP",
    prompt: "하루 일정을 대할 때 너는?",
    choices: [
      { id: "A", text: "계획이 바뀌어도 아무렇지 않다", pole: "P" },
      { id: "B", text: "계획대로 착착 되면 마음이 편하다", pole: "J" },
    ],

    imagePath: "/Images/questions/q11_room_tidy_now_vs_later.png",
  },
  {
    id: "JP-42",
    axis: "JP",
    prompt: "친구들과 놀 장소를 정할 때 너는?",
    choices: [
      { id: "A", text: "가다가 좋아 보이는 곳으로 간다", pole: "P" },
      { id: "B", text: "어디서 놀지 먼저 정한다", pole: "J" },
    ],

    imagePath: "/Images/questions/q08_help_friend_feel_vs_solution.png",
  },
  {
    id: "JP-43",
    axis: "JP",
    prompt: "만들기 재료가 남았어. 너는?",
    choices: [
      { id: "A", text: "종류대로 정리해 보관한다", pole: "J" },
      { id: "B", text: "일단 상자에 담아둔다", pole: "P" },
    ],

    imagePath: "/Images/questions/q01_blocks_plan_vs_change.png",
  },
  {
    id: "JP-44",
    axis: "JP",
    prompt: "게임에서 다음에 뭘 할지 정할 때 너는?",
    choices: [
      { id: "A", text: "그때 상황 봐서 정한다", pole: "P" },
      { id: "B", text: "미리 순서를 정해둔다", pole: "J" },
    ],

    imagePath: "/Images/questions/q07_puzzle_fast_try_vs_slow_check.png",
  },
  {
    id: "JP-45",
    axis: "JP",
    prompt: "일기를 쓰는 습관에 대해 너는?",
    choices: [
      { id: "A", text: "매일 같은 시간에 쓴다", pole: "J" },
      { id: "B", text: "생각날 때 자유롭게 쓴다", pole: "P" },
    ],

    imagePath: "/Images/questions/q01_blocks_plan_vs_change.png",
  },
  {
    id: "JP-46",
    axis: "JP",
    prompt: "여행을 떠나기 전 너는?",
    choices: [
      { id: "A", text: "일정을 자세히 짜둔다", pole: "J" },
      { id: "B", text: "짐은 대충 챙기고 가서 정한다", pole: "P" },
    ],

    imagePath: "/Images/questions/q06_trip_plan_vs_go_with_flow.png",
  },
  {
    id: "JP-47",
    axis: "JP",
    prompt: "책상 위가 어질러졌어. 너는?",
    choices: [
      { id: "A", text: "쓰다가 나중에 한 번에 치운다", pole: "P" },
      { id: "B", text: "바로 깔끔하게 정리한다", pole: "J" },
    ],

    imagePath: "/Images/questions/q11_room_tidy_now_vs_later.png",
  },
  {
    id: "JP-48",
    axis: "JP",
    prompt: "새 놀이를 할 때 너는?",
    choices: [
      { id: "A", text: "규칙을 그때그때 만들며 논다", pole: "P" },
      { id: "B", text: "규칙을 먼저 정하고 논다", pole: "J" },
    ],

    imagePath: "/Images/questions/q10_story_real_vs_imagine.png",
  },
  {
    id: "JP-49",
    axis: "JP",
    prompt: "숙제를 다 했는지 너는?",
    choices: [
      { id: "A", text: "목록을 만들어 하나씩 확인한다", pole: "J" },
      { id: "B", text: "대충 기억해서 챙긴다", pole: "P" },
    ],

    imagePath: "/Images/questions/q19_make_schedule_vs_spontaneous.png",
  },
  {
    id: "JP-50",
    axis: "JP",
    prompt: "하고 싶은 일이 여러 개 생겼어. 너는?",
    choices: [
      { id: "A", text: "순서를 정해 하나씩 해나간다", pole: "J" },
      { id: "B", text: "끌리는 것부터 그때그때 한다", pole: "P" },
    ],

    imagePath: "/Images/questions/q19_make_schedule_vs_spontaneous.png",
  },
] as const;

export const QUESTION_BANK: readonly Question[] = [...EXISTING_QUESTIONS, ...NEW_QUESTIONS];

/**
 * 문항뱅크 불변조건을 검사하는 헬퍼(테스트/런타임 가드용):
 * - 총 200문항, 축당 정확히 50문항
 * - 문항 ID 중복 없음
 * - 축당 A 선택지에 배정된 극이 정확히 25/25로 균형(위치 편향 방지)
 */
export function assertQuestionBankShape(questions: readonly Question[]): void {
  if (questions.length !== 200) {
    throw new Error(`문항뱅크는 200문항이어야 합니다. 현재: ${questions.length}`);
  }

  const seenIds = new Set<string>();
  const perAxis = new Map<Axis, number>();
  const aPoleCountByAxis = new Map<Axis, Map<Pole, number>>();

  for (const q of questions) {
    if (seenIds.has(q.id)) {
      throw new Error(`문항 ID가 중복되었습니다: "${q.id}"`);
    }
    seenIds.add(q.id);

    perAxis.set(q.axis, (perAxis.get(q.axis) ?? 0) + 1);

    const aPole = q.choices[0].pole;
    const axisMap = aPoleCountByAxis.get(q.axis) ?? new Map<Pole, number>();
    axisMap.set(aPole, (axisMap.get(aPole) ?? 0) + 1);
    aPoleCountByAxis.set(q.axis, axisMap);
  }

  for (const axis of ["EI", "SN", "TF", "JP"] as const) {
    const count = perAxis.get(axis) ?? 0;
    if (count !== 50) {
      throw new Error(`${axis} 축은 50문항이어야 합니다. 현재: ${count}`);
    }

    const aPoleCounts = [...(aPoleCountByAxis.get(axis)?.values() ?? [])];
    if (aPoleCounts.length !== 2 || !aPoleCounts.every((c) => c === 25)) {
      throw new Error(
        `${axis} 축의 A 선택지 극 배치가 25/25로 균형이어야 합니다. 현재: ${aPoleCounts.join("/")}`,
      );
    }
  }
}
