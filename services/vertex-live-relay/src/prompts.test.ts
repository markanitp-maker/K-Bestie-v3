import { test } from "node:test";
import assert from "node:assert/strict";
import { buildKPeerPersonaFragment } from "./prompts.js";

// 요청서(케이 동갑내기 페르소나) — 릴레이가 티켓의 gradeLabel만으로 정체성 문구를
// 올바르게 만드는지 검증한다(초1~6 + 중학교 1학년 + 미설정 안전 폴백).

test("초1~6 학년 라벨은 각각 8~13살로 매핑된다", () => {
  const cases: [string, number][] = [
    ["1학년", 8],
    ["2학년", 9],
    ["3학년", 10],
    ["4학년", 11],
    ["5학년", 12],
    ["6학년", 13],
  ];
  for (const [label, age] of cases) {
    const fragment = buildKPeerPersonaFragment(label);
    assert.ok(fragment.includes(`${label} ${age}살`), `${label} -> ${age}살 문구가 있어야 한다`);
  }
});

test("중학교 1학년은 14살로 매핑되고 내부 콘텐츠 대체값(초6)을 노출하지 않는다", () => {
  const fragment = buildKPeerPersonaFragment("중학교 1학년");
  assert.ok(fragment.includes("중학교 1학년 14살"));
  assert.ok(!fragment.includes("6학년"));
});

test("gradeLabel이 없으면(레거시 티켓) 나이를 추측하지 않는 안전 폴백을 쓴다", () => {
  const fragment = buildKPeerPersonaFragment(undefined);
  assert.ok(fragment.includes("학년 정보를 먼저 확인해야 해"));
  assert.ok(!/\d살/.test(fragment));
});
