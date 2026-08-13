import assert from "node:assert/strict";
import { test } from "node:test";

import { filterRecentHistory } from "./index";
import type { SessionTurn } from "./memory/sameSession";

test("MISSION 첫 턴: currentUtteranceAlreadyInSession=true 일 때 sameSession의 유일한 아이 턴 제거", () => {
  const sameSession: SessionTurn[] = [{ role: "child", content: "안녕하세요" }];
  const currentUtterance = "안녕하세요";

  const history = filterRecentHistory(sameSession, currentUtterance, true);

  assert.deepEqual(history, []);
});

test("MISSION 중간 턴: currentUtteranceAlreadyInSession=true 일 때 이전 이력은 유지되고 마지막 현재 발화 턴만 제거", () => {
  const sameSession: SessionTurn[] = [
    { role: "child", content: "오늘 학교 갔다 왔어" },
    { role: "k", content: "학교에서 뭐 했어?" },
    { role: "child", content: "축구했어" },
  ];
  const currentUtterance = "축구했어";

  const history = filterRecentHistory(sameSession, currentUtterance, true);

  assert.deepEqual(history, [
    { role: "child", text: "오늘 학교 갔다 왔어" },
    { role: "k", text: "학교에서 뭐 했어?" },
  ]);
});

test("아이의 연속 동일 발화: currentUtteranceAlreadyInSession=true 일 때 마지막 1건만 제거되어 앞선 동일 발화 보존", () => {
  const sameSession: SessionTurn[] = [
    { role: "child", content: "안녕" },
    { role: "k", content: "안녕! 또 만났네" },
    { role: "child", content: "안녕" },
  ];
  const currentUtterance = "안녕";

  const history = filterRecentHistory(sameSession, currentUtterance, true);

  assert.deepEqual(history, [
    { role: "child", text: "안녕" },
    { role: "k", text: "안녕! 또 만났네" },
  ]);
});

test("FREE_CHAT 모드: currentUtteranceAlreadyInSession=false/undefined 일 때 sameSession 변형 없이 그대로 반환", () => {
  const sameSession: SessionTurn[] = [
    { role: "child", content: "안녕" },
    { role: "k", content: "안녕!" },
  ];

  const historyFalse = filterRecentHistory(sameSession, "오늘 날씨 좋다", false);
  assert.deepEqual(historyFalse, [
    { role: "child", text: "안녕" },
    { role: "k", text: "안녕!" },
  ]);

  const historyUndefined = filterRecentHistory(sameSession, "오늘 날씨 좋다", undefined);
  assert.deepEqual(historyUndefined, [
    { role: "child", text: "안녕" },
    { role: "k", text: "안녕!" },
  ]);
});

test("공백 및 포맷 차이: normalizeSameSessionText 정규화를 거쳐 정확히 대조 후 1건 제거", () => {
  // 정규화 대상은 "공백 개수 차이"뿐이다 — 문장 자체는 같아야 한다.
  const sameSession: SessionTurn[] = [{ role: "child", content: "안녕  하세요" }];
  const currentUtterance = "안녕 하세요";

  const history = filterRecentHistory(sameSession, currentUtterance, true);

  assert.deepEqual(history, []);
});

test("마지막 턴이 K 응답이거나 텍스트 불일치 시 제거하지 않음", () => {
  const sameSessionKLast: SessionTurn[] = [
    { role: "child", content: "안녕" },
    { role: "k", content: "응 무슨 일이야?" },
  ];
  const historyKLast = filterRecentHistory(sameSessionKLast, "응 무슨 일이야?", true);
  assert.equal(historyKLast.length, 2);

  const sameSessionDiffText: SessionTurn[] = [{ role: "child", content: "이전 발화" }];
  const historyDiff = filterRecentHistory(sameSessionDiffText, "새 발화", true);
  assert.equal(historyDiff.length, 1);
});
