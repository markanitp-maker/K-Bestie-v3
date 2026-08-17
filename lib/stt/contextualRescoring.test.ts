import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rescoreTranscript,
  RescoreCandidate,
} from "./contextualRescoring";

// ── 1. 실제 사고 복원 케이스 (넌센스 퀴즈 및 오인식 복원) ───────────────────

test("097 실제 사고: '소 노래' 오인식(오수/손/또) 복원", () => {
  const candidates: RescoreCandidate[] = [
    { text: "소", source: "nonsense_quiz" },
    { text: "송아지", source: "nonsense_quiz" },
  ];

  // 1) "오수 노래" -> "소 노래" (초성 도치 + 모음 인접 복원)
  const res1 = rescoreTranscript("오수 노래", candidates);
  assert.equal(res1.text, "소 노래");
  assert.equal(res1.changed, true);
  assert.equal(res1.matchedCandidate, "소");
  assert.ok((res1.score ?? 0) >= 0.50);

  // 2) "손 노래" -> "소 노래" (종성 ㄴ 탈락/삽입 복원)
  const res2 = rescoreTranscript("손 노래", candidates);
  assert.equal(res2.text, "소 노래");
  assert.equal(res2.changed, true);
  assert.equal(res2.matchedCandidate, "소");

  // 3) "또 노래" -> "소 노래" (치조음 ㄸ ↔ ㅅ 유사 자음 복원)
  const res3 = rescoreTranscript("또 노래", candidates);
  assert.equal(res3.text, "소 노래");
  assert.equal(res3.changed, true);
  assert.equal(res3.matchedCandidate, "소");
});

test("복원 케이스: 추가 단어 및 게임 어휘 오인식 복원", () => {
  // 1) "송하지" -> "송아지"
  const resQuiz = rescoreTranscript("송하지", [
    { text: "송아지", source: "nonsense_quiz" },
  ]);
  assert.equal(resQuiz.text, "송아지");
  assert.equal(resQuiz.changed, true);
  assert.equal(resQuiz.matchedCandidate, "송아지");

  // 2) "파나나 먹을래" -> "바나나 먹을래" (부분 치환)
  const resFruit = rescoreTranscript("파나나 먹을래", [
    { text: "바나나", source: "mission_topic" },
  ]);
  assert.equal(resFruit.text, "바나나 먹을래");
  assert.equal(resFruit.changed, true);
  assert.equal(resFruit.matchedCandidate, "바나나");

  // 3) "키즈 풀자" -> "퀴즈 풀자"
  const resChosung = rescoreTranscript("키즈 풀자", [
    { text: "퀴즈", source: "play_skill" },
  ]);
  assert.equal(resChosung.text, "퀴즈 풀자");
  assert.equal(resChosung.changed, true);
  assert.equal(resChosung.matchedCandidate, "퀴즈");

  // 4) "호성 게임" -> "초성 게임"
  const resGame = rescoreTranscript("호성 게임", [
    { text: "초성", source: "play_skill" },
  ]);
  assert.equal(resGame.text, "초성 게임");
  assert.equal(resGame.changed, true);
  assert.equal(resGame.matchedCandidate, "초성");

  // 5) "끝말이끼" -> "끝말잇기"
  const resChain = rescoreTranscript("끝말이끼", [
    { text: "끝말잇기", source: "play_skill" },
  ]);
  assert.equal(resChain.text, "끝말잇기");
  assert.equal(resChain.changed, true);
  assert.equal(resChain.matchedCandidate, "끝말잇기");
});

test("복원 케이스: 다어절(Multi-token) 후보 매칭", () => {
  const res = rescoreTranscript("오수 노래", [
    { text: "소 노래", source: "nonsense_quiz" },
  ]);
  assert.equal(res.text, "소 노래");
  assert.equal(res.changed, true);
  assert.equal(res.matchedCandidate, "소 노래");
});

test("복원 케이스: 문장부호 및 조사 결합 시 안전한 분리 및 복원", () => {
  const candidates: RescoreCandidate[] = [{ text: "소", source: "quiz" }];

  // 1) 문장부호 유지: "오수, 노래" -> "소, 노래"
  const resPunc1 = rescoreTranscript("오수, 노래", candidates);
  assert.equal(resPunc1.text, "소, 노래");
  assert.equal(resPunc1.changed, true);

  // 2) 느낌표 유지: "손!" -> "소!"
  const resPunc2 = rescoreTranscript("손!", candidates);
  assert.equal(resPunc2.text, "소!");
  assert.equal(resPunc2.changed, true);

  // 3) 조사 음운 조정: "손은" -> "소는" (받침 유무에 따른 은/는 조정)
  const resParticle1 = rescoreTranscript("손은 노래해", candidates);
  assert.equal(resParticle1.text, "소는 노래해");
  assert.equal(resParticle1.changed, true);

  // 4) 조사 음운 조정: "손이" -> "소가" (받침 유무에 따른 이/가 조정)
  const resParticle2 = rescoreTranscript("손이 노래해", candidates);
  assert.equal(resParticle2.text, "소가 노래해");
  assert.equal(resParticle2.changed, true);

  // 5) 조사 음운 조정: "손을" -> "소를" (받침 유무에 따른 을/를 조정)
  const resParticle3 = rescoreTranscript("손을 좋아해", candidates);
  assert.equal(resParticle3.text, "소를 좋아해");
  assert.equal(resParticle3.changed, true);
});

// ── 2. 정확 일치 케이스 (이미 정확하면 변경 없음) ───────────────────────────

test("정확 일치 케이스: 원문이 이미 후보와 일치하면 changed: false", () => {
  const candidates: RescoreCandidate[] = [
    { text: "소", source: "quiz" },
    { text: "송아지", source: "quiz" },
  ];

  // 1) "소 노래"는 이미 "소"가 정확히 포함됨
  const res1 = rescoreTranscript("소 노래", candidates);
  assert.equal(res1.text, "소 노래");
  assert.equal(res1.changed, false);

  // 2) 단일 단어 일치
  const res2 = rescoreTranscript("소", candidates);
  assert.equal(res2.text, "소");
  assert.equal(res2.changed, false);

  // 3) "송아지" 단일 단어 일치
  const res3 = rescoreTranscript("송아지", candidates);
  assert.equal(res3.text, "송아지");
  assert.equal(res3.changed, false);
});

// ── 3. 오작동 방지 (절대 바뀌면 안 되는 부정 케이스) ─────────────────────────

test("오작동 방지: 정답 채워넣기 금지 ('몰라' -> '송아지' 변환 금지)", () => {
  const candidates: RescoreCandidate[] = [
    { text: "소", source: "quiz" },
    { text: "송아지", source: "quiz" },
  ];

  const res1 = rescoreTranscript("몰라", candidates);
  assert.equal(res1.text, "몰라");
  assert.equal(res1.changed, false);

  const res2 = rescoreTranscript("잘 모르겠어", candidates);
  assert.equal(res2.text, "잘 모르겠어");
  assert.equal(res2.changed, false);

  const res3 = rescoreTranscript("아니야 몰라", candidates);
  assert.equal(res3.text, "아니야 몰라");
  assert.equal(res3.changed, false);
});

test("오작동 방지: 아이의 일상/감정/안전 발화 훼손 금지", () => {
  const candidates: RescoreCandidate[] = [
    { text: "소", source: "quiz" },
    { text: "송아지", source: "quiz" },
  ];

  const dailySentences = [
    "오늘 학교에서 속상한 일 있었어",
    "엄마한테 이를 거야",
    "선생님이 오늘 칭찬해줬어",
    "친구랑 싸워서 슬퍼",
    "나 지금 너무 화났어",
    "배고파서 밥 먹고 싶어",
    "게임 그만하고 잘래",
  ];

  for (const sentence of dailySentences) {
    const res = rescoreTranscript(sentence, candidates);
    assert.equal(res.text, sentence, `오작동 발생: ${sentence} -> ${res.text}`);
    assert.equal(res.changed, false);
  }
});

test("오작동 방지: 발음 거리가 먼 단어는 치환하지 않는다", () => {
  // 1) "배고파" ↔ "바나나" (비유사)
  const res1 = rescoreTranscript("배고파", [{ text: "바나나", source: "quiz" }]);
  assert.equal(res1.text, "배고파");
  assert.equal(res1.changed, false);

  // 2) "사과" ↔ "바나나"
  const res2 = rescoreTranscript("사과가 맛있어", [{ text: "바나나", source: "quiz" }]);
  assert.equal(res2.text, "사과가 맛있어");
  assert.equal(res2.changed, false);

  // 3) "수박" ↔ "소"
  const res3 = rescoreTranscript("수박 먹을래", [{ text: "소", source: "quiz" }]);
  assert.equal(res3.text, "수박 먹을래");
  assert.equal(res3.changed, false);
});

test("오작동 방지: 길이 차이가 큰 단어는 치환하지 않는다", () => {
  const candidates: RescoreCandidate[] = [{ text: "소", source: "quiz" }];

  // "소나기"는 3음절로 1음절 후보 "소"와 음절 차이 2 -> 치환 금지
  const res1 = rescoreTranscript("소나기 왔어", candidates);
  assert.equal(res1.text, "소나기 왔어");
  assert.equal(res1.changed, false);

  // "송아지가 울어" -> 치환 금지
  const res2 = rescoreTranscript("송아지가 울어", candidates);
  assert.equal(res2.text, "송아지가 울어");
  assert.equal(res2.changed, false);

  // "청소 노래" -> 치환 금지
  const res3 = rescoreTranscript("청소 노래", candidates);
  assert.equal(res3.text, "청소 노래");
  assert.equal(res3.changed, false);
});

test("오작동 방지: 빈 입력, 자모만 입력, 빈 후보 목록 방어", () => {
  const candidates: RescoreCandidate[] = [{ text: "소", source: "quiz" }];

  // 1) 빈 후보 배열
  assert.equal(rescoreTranscript("오수 노래", []).changed, false);
  assert.equal(rescoreTranscript("오수 노래", []).text, "오수 노래");

  // 2) 빈 문자열 및 공백
  assert.equal(rescoreTranscript("", candidates).changed, false);
  assert.equal(rescoreTranscript("", candidates).text, "");
  assert.equal(rescoreTranscript("   ", candidates).changed, false);
  assert.equal(rescoreTranscript("   ", candidates).text, "   ");

  // 3) 낱자 자모만 있는 입력 (1단계 필터 방어)
  assert.equal(rescoreTranscript("ㅅㅗ", candidates).changed, false);
  assert.equal(rescoreTranscript("ㅅㅗ", candidates).text, "ㅅㅗ");
  assert.equal(rescoreTranscript("ㄱ", candidates).changed, false);
  assert.equal(rescoreTranscript("ㄱ", candidates).text, "ㄱ");

  // 4) null/undefined 방어
  assert.equal(rescoreTranscript(null as unknown as string, candidates).changed, false);
  assert.equal(rescoreTranscript(undefined as unknown as string, candidates).changed, false);

  // 5) 영문/숫자 입력
  assert.equal(rescoreTranscript("ABC 노래", candidates).changed, false);
  assert.equal(rescoreTranscript("123 노래", candidates).changed, false);
});

test("097 §3-2: 아이가 끝내지 못한 답을 정답으로 완성해 주지 않는다", () => {
  const answer = [{ text: "송아지", source: "nonsense_answer" }];

  // 아이가 "송아"까지만 말했다면 그건 정답이 아니다. 채워 주면 안 맞힌 문제를
  // 맞힌 것으로 만들어 준다. 실제 Dev 검증에서 이 경로가 열려 있었다.
  assert.equal(rescoreTranscript("송아", answer).changed, false);
  assert.equal(rescoreTranscript("송아", answer).text, "송아");
  assert.equal(rescoreTranscript("송", answer).changed, false);
  assert.equal(rescoreTranscript("아지", answer).changed, false);

  // 반대로 음절 수가 같고 자모만 어긋난 건 STT 오인식이므로 복원한다.
  // "소아지" 는 아이가 송아지라고 말했는데 받침이 떨어진 경우다.
  assert.equal(rescoreTranscript("소아지", answer).text, "송아지");

  // 발음이 비슷해 보여도 다른 낱말은 건드리지 않는다.
  assert.equal(rescoreTranscript("송편", answer).changed, false);
});
