import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RedCoachingModal } from "./RedCoachingModal";

test("동일 주제 안전 대안이 있으면 원래 주제·이유·대안·변경 버튼을 분리해 표시한다", () => {
  const html = renderToStaticMarkup(
    <RedCoachingModal
      variant="RED"
      coachingText="친구와 싸웠다고 미리 정하거나 특정 친구를 캐묻지 않아요."
      requestedTopic="친구 관계"
      requestedArea="peer_conflict"
      safeAlternativeText="요즘 친구들과 어떻게 지내는지 물어볼까요?"
      onClose={() => {}}
      onUseSafeAlternative={() => {}}
    />,
  );

  assert.match(html, /원래 궁금한 주제/);
  assert.match(html, /친구 관계/);
  assert.match(html, /같은 주제의 안전한 대안/);
  assert.match(html, /안전한 질문으로 바꾸기/);
  assert.doesNotMatch(html, /학교에서 가장 재밌었던 순간/);
});

test("안전 대안이 없으면 닫기만 표시하고 변경 버튼을 숨긴다", () => {
  const html = renderToStaticMarkup(
    <RedCoachingModal
      variant="RED"
      coachingText="케이는 아이 몰래 알아내는 도구가 아니에요."
      requestedTopic="비밀 확인"
      requestedArea="secret"
      safeAlternativeText={null}
      onClose={() => {}}
      onUseSafeAlternative={null}
    />,
  );

  assert.match(html, /이 질문은 케이가 대신 묻기 어려워요/);
  assert.match(html, /비밀 확인/);
  assert.match(html, />닫기</);
  assert.doesNotMatch(html, /같은 주제의 안전한 대안/);
  assert.doesNotMatch(html, /안전한 질문으로 바꾸기/);
});
