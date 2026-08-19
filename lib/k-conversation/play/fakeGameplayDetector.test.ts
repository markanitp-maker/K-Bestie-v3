import assert from "node:assert/strict";
import { test } from "node:test";

import { detectFakeGameplay } from "./fakeGameplayDetector";

// 2026-08-17 Dev(김서아) 실측 대화에서 케이가 실제로 한 말이다.
// 전부 DB 게임 세션이 없는 상태에서 나왔다.
const REAL_INCIDENT_UTTERANCES = [
  "'ㄸㄱ'야! 빨갛고 달콤한 과일인데 뭘까?",
  "내가 먼저 시작할게, '사과'!",
  "일마루! 내 차례네, 그럼 '루브르 박물관'!",
  '좋아, 바로 초성 게임 시작할게! 첫 번째 문제 나간다. "ㅂㄷㄱㅇ"야!',
  "아냐, 정답은 '다이아몬드'였어!",
  "첫 글자는 '다'로 시작해!",
  "앗, 그건 아니야! 힌트 줄 테니 5글자 안팎으로 한번 더 생각해봐!",
  "그럼 나는 '차표' 할래! 차로 시작하는 단어야",
];

// 활성 세션이 없어도 정상인 발화. 이쪽을 막으면 대화가 더 망가진다.
const NORMAL_UTTERANCES = [
  "좋아, 초성게임 하자!",
  "초성게임, 끝말잇기, 넌센스 퀴즈 중에 고를 수 있어! 어떤 걸로 해볼래?",
  "ㅋㅋ 진짜 웃기다",
  "ㅎㅎ 그랬구나",
  "ㅠㅠ 속상했겠다",
  "ㅇㅋ 알겠어",
  "오늘 학교에서 뭐 했어?",
  "급식 맛있었어? 뭐 나왔는데?",
  "심심할 땐 뭐 하고 놀까?",
  "우와 대단하다!",
  "오늘 하루 어땠어? 재밌는 일 있었어?",
  "엄마한테 혼났구나, 속상했겠다",
  "나도 그거 좋아해! 너는 어떤 색 좋아해?",
  "친구랑 뭐 하고 놀았어?",
  "그거 진짜 신기하다, 더 얘기해줘",
];

test("세션 없이 게임을 진행하는 응답을 잡는다 (2026-08-17 실측 발화)", () => {
  for (const text of REAL_INCIDENT_UTTERANCES) {
    const verdict = detectFakeGameplay(text);
    assert.equal(verdict.isFake, true, `잡히지 않았다: ${text}`);
    assert.ok(verdict.kinds.length > 0, `kinds 가 비었다: ${text}`);
  }
});

test("정상 대화는 막지 않는다 — 오탐이 미탐보다 위험하다", () => {
  for (const text of NORMAL_UTTERANCES) {
    const verdict = detectFakeGameplay(text);
    assert.equal(verdict.isFake, false, `잘못 막혔다: ${text} (${verdict.kinds.join(",")})`);
  }
});

test("웃음·줄임말 자음은 초성 문제가 아니다", () => {
  // 같은 글자 반복은 웃음이다.
  for (const text of ["ㅋㅋ", "ㅋㅋㅋㅋ", "ㅎㅎ", "ㄷㄷ", "ㅜㅜ", "ㅠㅠ"]) {
    assert.equal(detectFakeGameplay(text).isFake, false, `웃음이 막혔다: ${text}`);
  }
  // 일상 줄임말도 문제가 아니다.
  for (const text of ["ㅇㅋ 알겠어", "ㄱㅅ!", "ㅈㅅ 늦었어"]) {
    assert.equal(detectFakeGameplay(text).isFake, false, `줄임말이 막혔다: ${text}`);
  }
  // 서로 다른 자음이 이어지면 초성 출제로 본다.
  assert.equal(detectFakeGameplay("ㅂㄷㅁㅌ 맞춰봐").isFake, true);
});

test("빈 값·비문자열을 안전하게 처리한다", () => {
  assert.equal(detectFakeGameplay("").isFake, false);
  assert.equal(detectFakeGameplay(null as unknown as string).isFake, false);
  assert.equal(detectFakeGameplay(undefined as unknown as string).isFake, false);
});

test("010: 놀이 중에 가드가 걸리면 메뉴로 되돌리지 않는다", async () => {
  const { pickFakeGameplayRecoveryText } = await import("./fakeGameplayDetector");
  // 대표님 QA 실측(2026-08-20 00:08): 초성게임 중 아이가 "몰라" 했는데 케이가
  // "무슨 놀이 할지 네가 골라줄래?" 라고 답해 게임이 통째로 날아갔다.
  const inSession = pickFakeGameplayRecoveryText([], true);
  assert.doesNotMatch(inSession, /무슨 놀이|어떤 놀이|하고 싶은 놀이|중에 뭐 할래/);
  assert.match(inSession, /계속|이어서/);

  // 세션이 없을 때는 무엇을 할지 되묻는 것이 맞다.
  const noSession = pickFakeGameplayRecoveryText([], false);
  assert.match(noSession, /놀이/);
});

test("010: 놀이 중 복구 문구도 직전에 쓴 것을 피한다", async () => {
  const { pickFakeGameplayRecoveryText } = await import("./fakeGameplayDetector");
  const first = pickFakeGameplayRecoveryText([], true);
  const second = pickFakeGameplayRecoveryText([first], true);
  assert.notEqual(second, first);
});
