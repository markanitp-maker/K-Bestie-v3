import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// 요청서 013 — 미션 대화가 "질문지 낭독"이 아니라 "아이 이야기에서 파생된 질문"으로
// 진행되도록 만든 지침과, 유효 답변 판정 기준이 되살아나지(퇴행하지) 않도록 고정한다.
//
// 지침은 프롬프트 문자열이라 단위 테스트로 동작을 검증할 수 없다. 그래서 실제 대화 동작은
// Dev 실브라우저 QA 로 확인하고(요청서 §7), 여기서는 "규칙이 파일에 남아 있는지"와
// "금지된 옛 규칙이 다시 들어오지 않았는지"만 지킨다.

const readSource = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

test("미션 지침은 아이 이야기에서 파생된 질문을 우선한다", () => {
  const source = readSource("lib/mission-v3/missionAdapter.ts");
  assert.match(source, /방금 한 이야기에서 자연스럽게 이어지는 것을 우선/);
  // 방향(Goal)은 유지해야 한다 — 질문 자체를 없애는 것이 목적이 아니다(§5-2).
  assert.match(source, /질문 하나로 마무리해/);
  assert.match(source, /goal\.promptInstruction\.trim\(\)/);
});

test("미션 지침은 기계적 전환 멘트를 금지한다", () => {
  const source = readSource("lib/mission-v3/missionAdapter.ts");
  for (const banned of ["이제 다음 질문할게", "그럼 다른 질문 해볼게", "네 얘기 잘 들었어. 그런데"]) {
    assert.ok(
      source.includes(banned),
      `금지 예시 "${banned}" 가 지침에 명시돼 있어야 한다`
    );
  }
  assert.match(source, /전환 멘트는 쓰지 마/);
});

test("미션 지침은 이미 확보한 정보의 재질문을 금지하고 후속 질문은 허용한다", () => {
  const source = readSource("lib/mission-v3/missionAdapter.ts");
  assert.match(source, /이미 말한 내용을 표현만 바꿔 다시 묻지 마/);
  assert.match(source, /그 뒤 이야기나 달라진 점을 물어봐/);
});

test("미션 지침은 아이 질문·지적에 먼저 답하는 예외를 유지한다", () => {
  const source = readSource("lib/mission-v3/missionAdapter.ts");
  assert.match(source, /아이가 너에게 질문했거나 뭔가를 지적했으면 그 답을 먼저 하고/);
  assert.match(source, /복귀:/);
});

test("유효 답변 판정은 파생 질문 답변과 아이가 스스로 꺼낸 이야기도 인정한다", () => {
  const source = readSource("lib/mission-v3/goalAssessor.ts");
  assert.match(source, /파생된 질문을 했더라도/);
  assert.match(source, /스스로 꺼낸 이야기도/);
  // 의미 정보 카테고리(§3-4)가 판정 기준에 들어가 있어야 한다.
  for (const category of ["구체적인 사건", "감정이나 그 이유", "관계", "관심사", "선택·생각·의견", "최근 달라진 점"]) {
    assert.ok(source.includes(category), `의미 정보 카테고리 "${category}" 가 있어야 한다`);
  }
});

test("유효 답변 판정은 무의미 답변과 정보 반복을 인정하지 않는다", () => {
  const source = readSource("lib/mission-v3/goalAssessor.ts");
  assert.match(source, /새로운 정보가 없는 답변은 SATISFIED 로 인정하지 마라/);
  assert.match(source, /직전 답변에서 이미 나온 정보를 다시 말한 것뿐이면/);
  // 길이로 판정하지 않는다는 기존 규칙(079)도 그대로 살아 있어야 한다(§5-5).
  assert.match(source, /답변 길이나 문장 완성도를 SATISFIED의 조건으로 쓰지 마라/);
});

test("관계 안전 지침이 두 모드 공통 프롬프트에 들어간다", () => {
  const source = readSource("lib/k-conversation/responseGenerator.ts");
  assert.match(source, /RELATIONSHIP_SAFETY_INSTRUCTION/);
});

test("관계 안전 출력 검사가 엔진 응답 경로에 연결돼 있다", () => {
  const source = readSource("lib/k-conversation/index.ts");
  assert.match(source, /applyRelationshipSafety/);
  assert.match(source, /관계 안전 위반 응답을 차단했다/);
});

test("자유대화는 질문을 강제하지 않는다", () => {
  const source = readSource("lib/k-conversation/responseGenerator.ts");
  // 물음표를 강제하거나 금지하지 않는 기존 규칙이 유지돼야 한다(§3-7).
  assert.match(source, /물음표를 써도 되고 안 써도 돼/);
  assert.match(source, /정보를 확보하거나 목표를 달성하려 하지 마/);
});

test("사용하지 않던 구버전 자유대화 프롬프트는 제거됐다", () => {
  const source = readSource("app/api/_lib/prompts.ts");
  assert.ok(
    !/export const FREE_CHAT_SYSTEM_PROMPT/.test(source),
    "FREE_CHAT_SYSTEM_PROMPT 상수가 다시 들어왔다(요청서 013 §3-12)"
  );
  // 미션 legacy 경로가 아직 쓰는 상수는 남아 있어야 한다.
  assert.match(source, /export const MISSION_CHAT_SYSTEM_PROMPT/);
});
