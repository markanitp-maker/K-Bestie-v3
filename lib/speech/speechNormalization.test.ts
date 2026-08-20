import assert from "node:assert/strict";
import test from "node:test";
import { cleanTtsText, splitTtsSentences } from "./speechNormalization";

test("cleanTtsText: 이모지·bullet·markdown·HTML·중복 공백을 제거하고 의미를 보존한다", () => {
  const raw = "## 오늘 😊\n- **친구와** <strong>즐겁게</strong> 놀았어요.\n• [공원](https://example.com)에 갔어요.";
  assert.equal(cleanTtsText(raw), "오늘 친구와 즐겁게 놀았어요. 공원에 갔어요.");
  assert.equal(cleanTtsText("대한민국 🇰🇷 1️⃣ 첫 번째 이야기"), "대한민국 첫 번째 이야기");
});

test("splitTtsSentences: 긴 한국어 텍스트를 문장부호 단위로 빈 조각 없이 나눈다", () => {
  // 2026-08-20 대표님 QA 로 계약이 바뀌었다 — 부호로 **나누되 읽지는 않는다**.
  // 이 단정의 원래 의도(빈 조각 없이 문장 단위로 나눈다)는 그대로다.
  assert.deepEqual(
    splitTtsSentences("첫 문장입니다.두 번째인가요? 네! 마지막 문장입니다。   "),
    ["첫 문장입니다", "두 번째인가요", "네", "마지막 문장입니다"]
  );
});

test("cleanTtsText: 강조를 지워도 조사가 떨어지지 않는다", () => {
  // 2026-08-20 실측 — 강조 표시를 공백으로 바꿨더니 `서아 가`, `중요 한` 이 됐다.
  // 케이가 어색하게 끊어 읽는다. 붙여서 지워야 한다.
  assert.equal(cleanTtsText("**서아**가 축구를 했어요"), "서아가 축구를 했어요");
  assert.equal(cleanTtsText("*중요*한 이야기예요"), "중요한 이야기예요");
  assert.equal(cleanTtsText("__강조__된 말"), "강조된 말");
  assert.equal(cleanTtsText("<b>서아</b>는 웃었어요"), "서아는 웃었어요");
  // 낱말 사이의 강조는 원래 공백이 있으니 그대로다.
  assert.equal(cleanTtsText("서아가 **정말** 좋아했어요"), "서아가 정말 좋아했어요");
});

test("cleanTtsText: 문장 속 기호를 지워 뜻을 바꾸지 않는다", () => {
  // 지시서 §4 — 문장 의미 자체는 변경하지 않는다.
  // 예전에는 `*` 를 통째로 지워 `3 * 4` 가 `3 4` 가 됐다.
  assert.equal(cleanTtsText("3 * 4 는 12예요"), "3 * 4 는 12예요");
  assert.equal(cleanTtsText("가격은 5 > 3 이에요"), "가격은 5 > 3 이에요");
});

test("cleanTtsText: 블록 태그는 문장을 붙이지 않는다", () => {
  // 인라인 태그는 붙여 지우되, 블록 태그는 문장 경계라 공백이 필요하다.
  assert.equal(cleanTtsText("<p>첫째 문장</p><p>둘째 문장</p>"), "첫째 문장 둘째 문장");
  assert.equal(cleanTtsText("첫줄<br>둘째줄"), "첫줄 둘째줄");
});

test("cleanTtsText: 줄머리 제목·인용 기호는 없앤다", () => {
  assert.equal(cleanTtsText("# 제목\n> 인용문"), "제목 인용문");
});

test("splitTtsSentences: 문장부호를 소리 내어 읽지 않는다", () => {
  // 2026-08-20 대표님 QA — "마침표, 물음표, 이런거 안 읽게 해줘".
  // 한국어 음성 엔진 일부가 부호를 이름 그대로 읽는다.
  assert.deepEqual(
    splitTtsSentences("오늘 서아는 즐거웠어요. 친구랑 축구했대요!"),
    ["오늘 서아는 즐거웠어요", "친구랑 축구했대요"]
  );
  assert.deepEqual(
    splitTtsSentences("무슨 일이 있었을까요? 한번 물어보세요."),
    ["무슨 일이 있었을까요", "한번 물어보세요"]
  );

  // 문장 속 부호도 이름으로 읽히기 쉬운 것은 없앤다.
  assert.deepEqual(splitTtsSentences("서아가 말했어요: 재밌었다고요."), ["서아가 말했어요 재밌었다고요"]);
  assert.deepEqual(splitTtsSentences("(참고) 어제와 비슷해요"), ["참고 어제와 비슷해요"]);
  assert.deepEqual(splitTtsSentences("축구/야구 둘 다 좋아해요"), ["축구 야구 둘 다 좋아해요"]);
});

test("splitTtsSentences: 따옴표를 지워도 낱말이 붙지 않는다", () => {
  // 붙여 지우면 `"좋아"라고` 가 `좋아라고` 로 뭉쳐 한 낱말처럼 읽힌다(실측).
  assert.deepEqual(
    splitTtsSentences('서아는 "좋아"라고 했어요'),
    ["서아는 좋아 라고 했어요"]
  );
});

test("splitTtsSentences: 쉼표는 남겨 호흡을 유지한다", () => {
  // 쉼표는 끊어 읽는 호흡을 만들고, 이름으로 읽히는 경우가 거의 없다.
  assert.deepEqual(
    splitTtsSentences("학교, 학원, 친구 이야기를 했어요."),
    ["학교, 학원, 친구 이야기를 했어요"]
  );
});

test("splitTtsSentences: 부호를 지워도 문장 경계는 지킨다", () => {
  // 제거를 분할보다 먼저 하면 경계가 사라져 긴 리포트가 한 덩어리로 읽힌다.
  const parts = splitTtsSentences("첫째 문장이에요. 둘째 문장이에요! 셋째 문장인가요?");
  assert.equal(parts.length, 3, `문장 경계가 무너졌다: ${JSON.stringify(parts)}`);
  for (const part of parts) {
    assert.ok(!/[.!?]/.test(part), `부호가 남았다: ${part}`);
  }
});
