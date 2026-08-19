import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decomposeHangul,
  jamoEditDistance,
  isPhoneticallySimilar,
} from "./koreanPhonetic";
import { recoverGameCommand } from "./gameCommandRecovery";

// ── 1. decomposeHangul 단위 테스트 ──────────────────────────────────────────

test("decomposeHangul: 한글 음절을 초성·중성·종성으로 정확히 분해한다", () => {
  assert.equal(decomposeHangul("초성"), "ㅊㅗㅅㅓㅇ");
  assert.equal(decomposeHangul("호성"), "ㅎㅗㅅㅓㅇ");
  assert.equal(decomposeHangul("퀴즈"), "ㅋㅟㅈㅡ");
  assert.equal(decomposeHangul("키즈"), "ㅋㅣㅈㅡ");
  assert.equal(decomposeHangul("끝말잇기"), "ㄲㅡㅌㅁㅏㄹㅇㅣㅅㄱㅣ");
  assert.equal(decomposeHangul("끝말이끼"), "ㄲㅡㅌㅁㅏㄹㅇㅣㄲㅣ");
});

test("decomposeHangul: 비한글 및 낱자 자모는 그대로 보존한다", () => {
  assert.equal(decomposeHangul("Hello 123!"), "Hello 123!");
  assert.equal(decomposeHangul("ㅊㅅ게임"), "ㅊㅅㄱㅔㅇㅣㅁ");
  assert.equal(decomposeHangul(""), "");
});

// ── 2. jamoEditDistance 단위 테스트 ─────────────────────────────────────────

test("jamoEditDistance: 동일 문자열 및 단일 자모 차이 거리 계산", () => {
  assert.equal(jamoEditDistance("ㅊㅗㅅㅓㅇ", "ㅊㅗㅅㅓㅇ"), 0);
  assert.equal(jamoEditDistance("ㅊㅗㅅㅓㅇ", "ㅎㅗㅅㅓㅇ"), 1); // ㅊ ↔ ㅎ (치환 1)
  assert.equal(jamoEditDistance("ㅋㅟㅈㅡ", "ㅋㅣㅈㅡ"), 1);     // ㅟ ↔ ㅣ (치환 1)
  assert.equal(jamoEditDistance("ㄱㅏ", "ㄱㅏㅇ"), 1);         // ㅇ 삽입 (1)
  assert.equal(jamoEditDistance("", "ㄱ"), 1);
});

// ── 3. isPhoneticallySimilar 단위 테스트 ────────────────────────────────────

test("isPhoneticallySimilar: 같은 말 (공백·특수문자 무시)", () => {
  assert.equal(isPhoneticallySimilar("초성퀴즈", "초성퀴즈"), true);
  assert.equal(isPhoneticallySimilar("초성 퀴즈", "초성퀴즈"), true);
  assert.equal(isPhoneticallySimilar("초성퀴즈!", "초성퀴즈"), true);
  assert.equal(isPhoneticallySimilar("끝말 잇기", "끝말잇기"), true);
});

test("isPhoneticallySimilar: 한 글자/자모 차이 (유사)", () => {
  assert.equal(isPhoneticallySimilar("호성", "초성"), true);       // 1자모 차이 (5자모 중 1자모)
  assert.equal(isPhoneticallySimilar("키즈", "퀴즈"), true);       // 1자모 차이 (4자모 중 1자모)
  assert.equal(isPhoneticallySimilar("끝말이끼", "끝말잇기"), true); // 2자모 차이 (10자모 중 2자모)
  assert.equal(isPhoneticallySimilar("끝말있기", "끝말잇기"), true); // 1자모 차이
});

test("isPhoneticallySimilar: 전혀 다른 말 (비유사 및 엄격한 차단)", () => {
  assert.equal(isPhoneticallySimilar("기말", "끝말"), false);       // 2음절에서 2자모 차이 -> 엄격 차단
  assert.equal(isPhoneticallySimilar("초콜릿", "초성"), false);     // 3자모 이상 차이
  assert.equal(isPhoneticallySimilar("게임", "초성게임"), false);   // 길이 차이 및 5자모 차이
  assert.equal(isPhoneticallySimilar("마트", "퀴즈"), false);
  assert.equal(isPhoneticallySimilar("", "초성"), false);
});

// ── 4. recoverGameCommand 긍정 케이스 (복구 성공해야 하는 실제 발화) ────────

test("recoverGameCommand: 박말똥 실제 발화 복구 케이스", () => {
  // 1) "강 호성께 전화해 볼까" -> "호성"이 "초성"과 유사하여 CHOSUNG 복구
  assert.equal(recoverGameCommand("강 호성께 전화해 볼까"), "CHOSUNG");

  // 2) "키즈 해 보라고" -> "키즈"가 "퀴즈"와 유사하여 복구된다.
  //
  // 도착지를 CHOSUNG 에서 NONSENSE_QUIZ 로 바꿨다(2026-08-20). 원래 단정은 "퀴즈 ≈ 초성퀴즈"
  // 라는 가정이었는데, 대표님 QA 에서 그 가정이 틀렸다는 실측이 나왔다 —
  // 아이가 "넌센스 퀴즈" 라고 했고 STT 가 "스퀴즈 봐" 로 흘렸는데 초성게임이 시작돼
  // "넌센스 퀴즈라 그랬지 초성 게임 하라 그랬냐" 는 지적을 받았다(세션 7cde49ed 00:12).
  // "퀴즈" 라고 불리는 놀이는 넌센스 퀴즈다. 초성게임은 "초성게임" 으로 부른다.
  assert.equal(recoverGameCommand("키즈 해 보라고"), "NONSENSE_QUIZ");

  // 3) "초성 퀴즈 하잖아" -> CHOSUNG 복구
  assert.equal(recoverGameCommand("초성 퀴즈 하잖아"), "CHOSUNG");

  // 4) "끝말이끼 하자" -> WORD_CHAIN 복구
  assert.equal(recoverGameCommand("끝말이끼 하자"), "WORD_CHAIN");

  // 5) "끝말 있기 해줘" -> WORD_CHAIN 복구
  assert.equal(recoverGameCommand("끝말 있기 해줘"), "WORD_CHAIN");
});

test("recoverGameCommand: 추가 게임 명령 변형 복구 케이스", () => {
  assert.equal(recoverGameCommand("초성게임 하자"), "CHOSUNG");
  assert.equal(recoverGameCommand("ㅊㅅ퀴즈 할래"), "CHOSUNG");
  assert.equal(recoverGameCommand("말잇기 놀이하자"), "WORD_CHAIN");
  assert.equal(recoverGameCommand("단어잇기 해보자"), "WORD_CHAIN");
});

// ── 5. recoverGameCommand 부정 케이스 (오탐 방지 — 7개 모두 null) ──────────

test("recoverGameCommand: 부정 케이스 7개 전체 차단 (오탐 방지)", () => {
  assert.equal(recoverGameCommand("오늘 학교에서 발표했어"), null);
  assert.equal(recoverGameCommand("엄마랑 마트 갔어"), null);
  assert.equal(recoverGameCommand("초콜릿 먹고 싶어"), null);     // "초"로 시작하지만 초성게임 아님
  assert.equal(recoverGameCommand("기말고사 봤어"), null);        // "끝말"과 비슷하지만 다름
  assert.equal(recoverGameCommand("말이 안 통해"), null);
  assert.equal(recoverGameCommand("단어 뜻이 뭐야"), null);
  assert.equal(recoverGameCommand("게임하고 싶어"), null);        // 게임 일반. 특정 게임 지정 아님
});

test("recoverGameCommand: 빈 입력 및 비문자열 방어", () => {
  assert.equal(recoverGameCommand(""), null);
  assert.equal(recoverGameCommand("   "), null);
  assert.equal(recoverGameCommand(null as unknown as string), null);
  assert.equal(recoverGameCommand(undefined as unknown as string), null);
});

/** 2026-08-17 직접 검증에서 나온 오탐. 2음절 단독 표현("초성","퀴즈")이 실제 낱말과
 *  자모 1개 차이라 "조성진 피아노 들었어", "키즈카페 갔어"가 초성게임으로 잡혔다.
 *  아이가 매일 쓰는 말이라 그대로 두면 딴 얘기 중에 게임이 시작된다.
 *  놀이 맥락이 함께 있을 때만 인정하도록 고쳤다. */
test("오탐 방지: 실제 낱말이 게임 명령으로 복구되지 않는다", () => {
  const notCommands = [
    "조성진 피아노 들었어",
    "키즈카페 갔어",
    "키즈카페에서 놀았어",
    "조성 마을 갔어",
    "초등학교 갔다 왔어",
    "호수 공원 갔어",
    "기말고사 봤어",
    "끝나고 뭐해",
    "게임하고 싶어",
  ];
  for (const text of notCommands) {
    assert.equal(recoverGameCommand(text), null, `오탐: ${text}`);
  }
});

test("놀이 맥락이 있으면 2음절 표현도 복구된다", () => {
  assert.equal(recoverGameCommand("강 호성께 전화해 볼까"), "CHOSUNG");
  assert.equal(recoverGameCommand("호성 게임 하자"), "CHOSUNG");
  // "퀴즈" 계열은 넌센스로 간다(위 주석의 실측 근거 참고).
  assert.equal(recoverGameCommand("키즈 해 보라고"), "NONSENSE_QUIZ");
});

test("010: 잘린 넌센스 발화가 초성게임으로 잘못 라우팅되지 않는다", () => {
  // 대표님 QA 실측(2026-08-20 00:12): "넌센스 퀴즈" 가 "스퀴즈 봐" 로 들어와
  // 초성게임이 시작됐다. 아이가 곧바로 지적했다.
  for (const text of ["스퀴즈 봐", "센스 퀴즈", "넌센스퀴", "퀴즈 하자"]) {
    assert.equal(recoverGameCommand(text), "NONSENSE_QUIZ", `잘못 라우팅된다: ${text}`);
  }
  // 맥락 없는 "스퀴즈" 한 마디는 복구하지 않는다(리뷰 지적, 2026-08-20).
  // 야구 용어일 수도 있어 놀이를 시작해 버리면 안 된다. 초성게임으로 가는 것은 더 나쁘다.
  assert.equal(recoverGameCommand("스퀴즈"), null);
  // 놀이가 아닌 것이 확실한 표현은 복구 대상이 아니다.
  for (const text of ["퀴즈쇼 봤어", "스퀴즈 번트", "퀴즈가 뭐야"]) {
    assert.equal(recoverGameCommand(text), null, `놀이가 아닌데 복구된다: ${text}`);
  }
  // 초성은 그대로 초성으로 가야 한다.
  for (const text of ["초성게임 하자", "초성 퀴즈 하자", "ㅊㅅ게임"]) {
    assert.equal(recoverGameCommand(text), "CHOSUNG", `초성이 안 잡힌다: ${text}`);
  }
  // 놀이와 무관한 말은 복구하지 않는다.
  assert.equal(recoverGameCommand("키즈카페 갔어"), null);
  assert.equal(recoverGameCommand("조성진 피아노 들었어"), null);
});
