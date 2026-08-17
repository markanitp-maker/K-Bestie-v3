import assert from "node:assert/strict";
import { test } from "node:test";

import { formatRelationshipMemory } from "./index";

/**
 * 2026-08-17 Dev QA(김서아) 실측 결함:
 *
 *   아이: "내가 강아지 키운다고 했었지?"      → 케이: "그건 잘 기억이 안 나는데…"   (정상)
 *   아이: "내가 지난주에 놀이공원 갔다고 했잖아" → 케이: "아 맞다, 놀이공원 갔다고 했었지!" (날조)
 *
 * 의문형에는 방어하는데 **단정형에는 그대로 동의**했다.
 * 기억 못 하는 건 아쉬운 정도지만, 안 한 얘기를 맞다고 하는 건 아이를 속이는 것이다.
 * 아이가 나중에 알아차리면 케이가 한 모든 기억 이야기를 못 믿게 된다.
 */

const emptySnapshot = {
  sameSession: [],
  sameDay: [],
  recentEpisode: null,
  longTermFacts: [],
  tiersUsed: [],
} as unknown as Parameters<typeof formatRelationshipMemory>[0];

test("단정형 발화에 없는 기억을 맞다고 하지 말라는 지침이 프롬프트에 들어간다", () => {
  const fragment = formatRelationshipMemory(emptySnapshot);

  // 아이가 "~라고 했잖아"로 단정해도 동의하지 말라는 지침
  assert.match(fragment, /했잖아/, "단정형 발화 상황이 지침에 명시되어야 한다");
  assert.match(fragment, /맞다고 하지 마/, "동의 금지가 명시되어야 한다");

  // 대신 무엇을 해야 하는지도 있어야 한다 — 금지만 있으면 침묵으로 흐른다
  assert.match(fragment, /기억이 잘 안 나네|다시 말해줄래/, "대안 응답이 제시되어야 한다");

  // 없는 사건·장소·사람을 케이가 먼저 말하거나 확인해 주는 것 금지
  assert.match(fragment, /사건·장소·사람 이름/, "구체 사실 날조 금지가 명시되어야 한다");
});

test("기존 Silent Memory 규칙이 유지된다", () => {
  const fragment = formatRelationshipMemory(emptySnapshot);

  // 지금 아이 말이 최우선 — 절친의 기본이다
  assert.match(fragment, /지금 아이가 한 말.*최우선/);
  // 기억을 검색·저장했다는 사실을 말하지 않는다
  assert.match(fragment, /기억을 검색했거나 저장했다는 사실은 말하지 마/);
  // 다른 아이 정보 유출 금지
  assert.match(fragment, /다른 아이나 형제자매/);
  // 안전이 개인화보다 우선
  assert.match(fragment, /안전 규칙을 먼저/);
});

test("기억이 있으면 그 내용이 프롬프트에 실린다", () => {
  const snapshot = {
    sameSession: [],
    sameDay: [],
    recentEpisode: null,
    longTermFacts: [
      { content: "가족들과 함께 식사하는 시간을 가장 좋아한다." },
      { content: "자신의 이야기를 잘 들어주고 매우 아껴주는 어른이 곁에 있다." },
    ],
    tiersUsed: ["longTerm"],
  } as unknown as Parameters<typeof formatRelationshipMemory>[0];

  const fragment = formatRelationshipMemory(snapshot);
  assert.match(fragment, /가족들과 함께 식사하는 시간을 가장 좋아한다/);
  assert.match(fragment, /아껴주는 어른이 곁에 있다/);
});
