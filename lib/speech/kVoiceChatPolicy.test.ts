import assert from "node:assert/strict";
import test from "node:test";

import { resolveAutoPlaySource, shouldAutoPlayKAnswer, shouldSendFinalVoiceTranscript } from "./kVoiceChatPolicy";

test("음성 질문의 K 답변만 자동 재생한다", () => {
  // 답변 텍스트도 함께 본다 — 빈 답변 가드는 아래 테스트가 따로 고정한다.
  assert.equal(shouldAutoPlayKAnswer("hands-free", "오늘 서아는 즐거웠대요"), true);
  assert.equal(shouldAutoPlayKAnswer("typing", "오늘 서아는 즐거웠대요"), false);
});

test("빈 final transcript 또는 STT 오류가 있으면 전송하지 않는다", () => {
  assert.equal(shouldSendFinalVoiceTranscript({ transcript: "   ", sttError: null, isListening: false, lastSentTranscript: "" }), false);
  assert.equal(shouldSendFinalVoiceTranscript({ transcript: "오늘 어땠어?", sttError: "마이크 오류", isListening: false, lastSentTranscript: "" }), false);
});

test("동일한 final transcript가 두 번 전달돼도 한 번만 전송한다", () => {
  const transcript = "오늘 어땠어?";
  assert.equal(shouldSendFinalVoiceTranscript({ transcript, sttError: null, isListening: false, lastSentTranscript: "" }), true);
  assert.equal(shouldSendFinalVoiceTranscript({ transcript, sttError: null, isListening: false, lastSentTranscript: transcript }), false);
});

test("자동 재생: 답변이 비어 있으면 음성 질문이어도 재생하지 않는다", () => {
  // 빈 답변을 읽히려 하면 utterance 가 즉시 끝나거나 시작되지 않아
  // isSpeaking 이 켜진 채 남는다 — 버튼이 "정지" 로 굳는다.
  assert.equal(shouldAutoPlayKAnswer("hands-free", ""), false);
  assert.equal(shouldAutoPlayKAnswer("hands-free", "   "), false);
  assert.equal(shouldAutoPlayKAnswer("hands-free", "\n\t"), false);

  // 답변이 있으면 음성 질문에만 재생한다.
  assert.equal(shouldAutoPlayKAnswer("hands-free", "오늘 서아는 즐거웠대요"), true);
  assert.equal(shouldAutoPlayKAnswer("typing", "오늘 서아는 즐거웠대요"), false);
});

test("자동재생 판정은 fallback 문구가 아니라 API 원본으로 한다", () => {
  // 화면은 `data.answer || "응답을 가져올 수 없어요."` 로 fallback 을 먼저 씌운다.
  // 그 값을 판정에 넘기면 빈 답변 가드가 무력화된다 — 실제로 그랬다(리뷰 지적).
  const rawEmpty = resolveAutoPlaySource("");
  const rawNull = resolveAutoPlaySource(null);
  const rawBlank = resolveAutoPlaySource("   ");
  for (const raw of [rawEmpty, rawNull, rawBlank]) {
    assert.equal(shouldAutoPlayKAnswer("hands-free", raw), false, JSON.stringify(raw));
  }

  // fallback 문구를 그대로 넘기면 통과해 버린다 — 이게 놓쳤던 경로다.
  assert.equal(shouldAutoPlayKAnswer("hands-free", "응답을 가져올 수 없어요."), true);

  // 진짜 답변이 있으면 읽는다.
  assert.equal(
    shouldAutoPlayKAnswer("hands-free", resolveAutoPlaySource("오늘 서아는 즐거웠대요")),
    true
  );
});
