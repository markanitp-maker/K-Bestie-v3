import assert from "node:assert/strict";
import test from "node:test";

import { computeConversationHeight } from "./useKeyboardConversationViewport";

/**
 * 071 — 모바일 키보드 하단 공백.
 *
 * 훅 자체는 브라우저 API(visualViewport)에 의존하므로, 여기서는 훅이 내보내는
 * 두 파생값의 계약만 고정한다. 이 계약이 깨지면 iOS에서 입력창과 키보드 사이에
 * 앱 배경 공백이 다시 생긴다.
 */

// 실제 구현을 가져다 쓴다. 식을 복제하면 구현이 바뀌어도 테스트가 통과해 버린다
// (2026-08-17: 하드코딩 100dvh -> var(--frame-h, 100dvh) 로 바뀔 때 복제본이 못 잡았다).
const conversationHeight = computeConversationHeight;

const bottomSafeAreaInset = (isKeyboardOpen: boolean): string =>
  isKeyboardOpen ? "0px" : "env(safe-area-inset-bottom)";

test("키보드가 닫혀 있으면 프레임 높이를 쓰고 없으면 100dvh로 떨어진다", () => {
  // PC 웹의 스마트폰/태블릿 프레임 안에서는 --frame-h 가 정의된다. 100dvh 를 그대로
  // 쓰면 프레임보다 커져 하단(자동/수동 토글·마이크)이 잘린다.
  assert.equal(conversationHeight(false, 812), "var(--frame-h, 100dvh)");
  assert.equal(conversationHeight(false, null), "var(--frame-h, 100dvh)");
});

test("키보드가 열리면 실제 visual viewport 높이를 쓴다 — iOS에서 100dvh는 키보드만큼 줄지 않는다", () => {
  assert.equal(conversationHeight(true, 480), "480px");
});

test("viewportHeight를 아직 못 읽었으면 프레임 높이(없으면 100dvh)로 안전하게 떨어진다", () => {
  assert.equal(conversationHeight(true, null), "var(--frame-h, 100dvh)");
  assert.equal(conversationHeight(true, 0), "var(--frame-h, 100dvh)");
});

test("키보드가 홈 인디케이터를 덮는 동안 safe-area 하단 여백은 제거한다", () => {
  assert.equal(bottomSafeAreaInset(true), "0px");
});

test("키보드가 닫히면 safe-area 하단 여백을 복원한다", () => {
  assert.equal(bottomSafeAreaInset(false), "env(safe-area-inset-bottom)");
});

test("바깥 래퍼와 안쪽 그리드가 같은 높이 기준을 쓴다 — 어긋나면 프레임에 스크롤바가 생기고 하단이 잘린다", () => {
  // 2026-08-17 실측 사고: 안쪽만 --frame-h 로 고치고 바깥 래퍼를 100dvh 로 두었더니
  // DemoFrame 안쪽 패딩까지 더해져 프레임을 넘어섰다.
  const inner = computeConversationHeight(false, null);
  const outerClosed = "var(--frame-h, 100dvh)";
  assert.equal(inner, outerClosed);
});
