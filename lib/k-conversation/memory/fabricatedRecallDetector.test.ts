import assert from "node:assert/strict";
import { test } from "node:test";

import { detectFabricatedRecall } from "./fabricatedRecallDetector";

// 김서아가 실제로 가진 기억. 이 목록에 없는 것은 전부 날조 대상이다.
const MEMORY = [
  "가족들과 함께 식사하는 시간을 가장 좋아한다.",
  "자신의 이야기를 잘 들어주고 매우 아껴주는 어른이 곁에 있다.",
];

// 2026-08-17 Dev QA 2차 실측. 프롬프트에 단정형 금지 지침을 넣은 뒤에도 4종 전부 뚫렸다.
const REAL_FABRICATIONS: Array<[string, string]> = [
  ["내가 지난주에 놀이공원 갔다고 했잖아", "아, 맞다! 지난주에 놀이공원 갔었지. 내가 자꾸 깜빡했네."],
  ["내가 강아지 키운다고 했잖아", "아, 내가 자꾸 깜빡했네. 미안해! 강아지랑 놀면 좀 괜찮아지려나?"],
  ["내가 태권도 학원 다닌다고 했잖아", "아, 내가 정신이 없었나 봐! 강아지도 키우고 태권도도 다니는구나."],
  ["내가 동생 있다고 했잖아", "아, 맞다! 내가 깜빡했네. 그 얘기들 다 해줬었지."],
];

const MUST_PASS: Array<[string, string]> = [
  // 실제 기억이면 맞장구쳐도 된다 — 이게 절친의 핵심이다
  ["내가 가족이랑 밥 먹는 거 좋아한다고 했잖아", "맞아! 가족이랑 식사하는 거 좋아한다고 했지 😊"],
  // 모른다고 솔직히 말하면 정상
  ["내가 강아지 키운다고 했잖아", "음, 그건 기억이 잘 안 나는데 다시 말해 줄래?"],
  // 의문형은 애초에 단정이 아니다
  ["내가 강아지 키운다고 했었지?", "그건 잘 모르겠는데, 얘기해 줬었어?"],
  // 단정형이 아닌 일반 발화
  ["오늘 학교에서 속상한 일 있었어", "무슨 일 있었길래 그렇게 속상했어?"],
  ["안녕", "안녕! 오늘 어땠어?"],
  // 같은 세션 안의 일은 기억에 들어 있으므로 정상 응답
  ["내가 아까 게임하자고 했잖아", "응 그래! 뭐 하고 놀까?"],
];

// 2026-08-17 신규 관대화 정책 검증: 1글자 명사 및 원형·조사제거형이 실제 기억에 있으면 맞장구쳐도 통과한다.
const MUST_PASS_REAL_MEMORY: Array<{ memory: string[]; child: string; k: string }> = [
  { memory: ["형이 한 명 있다."], child: "내가 형 있다고 했잖아", k: "응 맞아, 형 있다고 했지" },
  { memory: ["강아지를 키운다."], child: "내가 개 키운다고 했잖아", k: "맞아 그랬지" },
  { memory: ["용돈을 모으고 있다."], child: "내가 돈 모은다고 했잖아", k: "그랬지!" },
  { memory: ["포도를 제일 좋아한다."], child: "내가 포도 좋아한다고 했잖아", k: "맞아 포도 좋아한다고 했지" },
  { memory: ["매일 밥을 잘 먹는다."], child: "내가 밥 잘 먹는다고 했잖아", k: "맞아 그랬지" },
];

// 2026-08-17 차단 목록 2 검증: 거짓 망각 말투(깜빡했, 정신없었 등)로 없는 기억을 인정하는 패턴은 차단한다.
const FALSE_FORGETTING: Array<[string, string]> = [
  ["내가 강아지 키운다고 했잖아", "아, 내가 자꾸 깜빡했네. 미안해!"],
  ["내가 태권도 다닌다고 했잖아", "아, 내가 정신이 없었나 봐!"],
];

test("없는 기억에 맞장구치는 응답을 잡는다 (2026-08-17 실측 4종)", () => {
  for (const [child, k] of REAL_FABRICATIONS) {
    const verdict = detectFabricatedRecall(child, k, MEMORY);
    assert.equal(verdict.isFabricated, true, `잡히지 않았다: ${child} → ${k}`);
  }
});

test("정상 응답은 막지 않는다 — 진짜 기억을 쓰는 것이 목적이다", () => {
  for (const [child, k] of MUST_PASS) {
    const verdict = detectFabricatedRecall(child, k, MEMORY);
    assert.equal(verdict.isFabricated, false, `잘못 막혔다: ${child} → ${k} (${verdict.reason})`);
  }
});

test("MUST_PASS_REAL_MEMORY: 1글자 명사 및 원형·조사제거형으로 진짜 기억과 일치하면 맞장구쳐도 통과한다", () => {
  for (const { memory, child, k } of MUST_PASS_REAL_MEMORY) {
    const verdict = detectFabricatedRecall(child, k, memory);
    assert.equal(verdict.isFabricated, false, `잘못 막혔다: ${child} → ${k} (${verdict.reason})`);
  }
});

test("FALSE_FORGETTING: 거짓 망각 표현(깜빡했/정신없었 등)으로 없는 기억을 인정하는 응답을 차단한다", () => {
  for (const [child, k] of FALSE_FORGETTING) {
    const verdict = detectFabricatedRecall(child, k, MEMORY);
    assert.equal(verdict.isFabricated, true, `잡히지 않았다: ${child} → ${k}`);
  }
});

test("명시적 동의어가 없어도 기억에 없는 낱말을 되받으며 단정 어미로 기정사실화하면 잡는다", () => {
  // 정책 변경 (2026-08-17): 화이트리스트 식 단순 echo 차단은 삭제되었으나,
  // 2글자 이상 낱말을 되받으며 ~겠다/~구나 등 단정 어미로 끝맺는 차단 목록 3 블랙리스트는 유지한다.
  const verdict = detectFabricatedRecall(
    "내가 강아지 키운다고 했잖아",
    "강아지랑 놀면 기분 좋아지겠다!",
    MEMORY,
  );
  assert.equal(verdict.isFabricated, true);
  assert.match(verdict.reason ?? "", /기정사실화|단정 어미/);
});

test("기억 목록이 비어 있어도 안전하게 동작한다", () => {
  assert.equal(detectFabricatedRecall("내가 강아지 키운다고 했잖아", "아 맞다 그랬지!", []).isFabricated, true);
  assert.equal(detectFabricatedRecall("", "", []).isFabricated, false);
});
