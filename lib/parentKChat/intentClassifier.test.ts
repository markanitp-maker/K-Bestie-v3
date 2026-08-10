import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAskChildProposal, classifyParentKChatIntent } from "./intentClassifier";

// requests/request-parent-k-chat-intent-routing-fallback-fix.md §10.1 단위 테스트 표
const CASES: Array<[string, "GENERAL_CONVERSATION" | "FEEDBACK_OR_CORRECTION" | "CHILD_INFORMATION_QUERY" | "PARENT_QUERY_REQUEST"]> = [
  ["내 말 잘 들리니?", "GENERAL_CONVERSATION"],
  ["안녕", "GENERAL_CONVERSATION"],
  ["고마워", "GENERAL_CONVERSATION"],
  ["왜 같은 말만 해?", "FEEDBACK_OR_CORRECTION"],
  ["그런 질문에는 잘 들린다고 해야지", "FEEDBACK_OR_CORRECTION"],
  ["서현이가 어제 뭐 했니?", "CHILD_INFORMATION_QUERY"],
  ["요즘 서현이가 좋아하는 게 뭐야?", "CHILD_INFORMATION_QUERY"],
  ["서현이 이야기하기 전에 내 말 잘 들리는지 확인할게", "GENERAL_CONVERSATION"],
  ["어제 학교에서 무슨 일 있었어?", "CHILD_INFORMATION_QUERY"],
  ["다시 답해 줘", "FEEDBACK_OR_CORRECTION"],
  // requests/request-parent-k-query-router-error-analysis-dev-prod.md 가설 A 확정
  ["이번 주말에 뭐 하고 싶은지 물어봐줘", "PARENT_QUERY_REQUEST"],
  ["이번 주 뭐하고 놀았으면 좋은지 물어봐", "PARENT_QUERY_REQUEST"],
  ["이번 주 주말에 뭐 하고 놀았으면 좋겠는지 물어봐줘", "PARENT_QUERY_REQUEST"],
  ["요즘 좋아하는 놀이가 뭔지 물어봐줘", "PARENT_QUERY_REQUEST"],
  ["먹고 싶은 음식이 있는지 물어봐줘", "PARENT_QUERY_REQUEST"],
  ["친구랑 싸운 이유를 몰래 물어봐줘", "PARENT_QUERY_REQUEST"], // Red 판정은 라우터가 결정 — 여기선 라우팅만
  ["나한테 숨기는 게 있는지 알아봐줘", "PARENT_QUERY_REQUEST"],
  ["누구를 좋아하는지 캐물어봐줘", "PARENT_QUERY_REQUEST"],
  ["다음에 준비물 챙겼는지 질문해줘", "PARENT_QUERY_REQUEST"],
];

for (const [input, expected] of CASES) {
  test(`classifyParentKChatIntent("${input}") -> ${expected}`, () => {
    const result = classifyParentKChatIntent(input);
    assert.equal(result.intent, expected);
  });
}

test("§6 GENERAL_CONVERSATION 예시 — 다시 말해 줘 / 무슨 뜻이야 / 너는 누구야 / 오늘 기분 어때", () => {
  assert.equal(classifyParentKChatIntent("다시 말해 줘").intent, "GENERAL_CONVERSATION");
  assert.equal(classifyParentKChatIntent("무슨 뜻이야?").intent, "GENERAL_CONVERSATION");
  assert.equal(classifyParentKChatIntent("너는 누구야?").intent, "GENERAL_CONVERSATION");
  assert.equal(classifyParentKChatIntent("오늘 기분 어때?").intent, "GENERAL_CONVERSATION");
});

test("§11-C 일반 기록 조회 예시는 여전히 CHILD_INFORMATION_QUERY로 남는다(과잉 매칭 회귀 방지)", () => {
  assert.equal(classifyParentKChatIntent("서아가 요즘 좋아하는 게 뭐야?").intent, "CHILD_INFORMATION_QUERY");
  assert.equal(classifyParentKChatIntent("서현이가 최근 학교 얘기를 했어?").intent, "CHILD_INFORMATION_QUERY");
});

test("애매한 입력은 안전하게 CHILD_INFORMATION_QUERY로 폴백한다(낮은 confidence)", () => {
  const result = classifyParentKChatIntent("최근에 친구 때문에 속상해한 적 있어?");
  assert.equal(result.intent, "CHILD_INFORMATION_QUERY");
  assert.ok(result.confidence < 0.9);
});

// requests/request-parent-k-conversation-context-and-draft-edit-fix.md §11 재현 사례 + 테스트 A/B/C
test("§11-A pending draft가 있으면 '학원으로 질문 변경해'는 신규 기록조회가 아니라 후속 수정으로 판정된다", () => {
  const result = classifyParentKChatIntent("방학이라 학교 안 가. 학원으로 질문 변경해.", true);
  assert.equal(result.intent, "PARENT_QUERY_REQUEST");
  assert.equal(result.isFollowUpToPendingDraft, true);
});

test("§11-A pending draft가 없으면 동일 문장이 기존처럼 CHILD_INFORMATION_QUERY로 남는다(회귀 방지)", () => {
  const result = classifyParentKChatIntent("방학이라 학교 안 가. 학원으로 질문 변경해.", false);
  assert.equal(result.intent, "CHILD_INFORMATION_QUERY");
});

test("§11-B 문구 수정('너무 딱딱해. 좀 부드럽게 바꿔줘')은 pending draft 후속 수정으로 판정된다", () => {
  const result = classifyParentKChatIntent("너무 딱딱해. 좀 부드럽게 바꿔줘", true);
  assert.equal(result.intent, "PARENT_QUERY_REQUEST");
  assert.equal(result.isFollowUpToPendingDraft, true);
});

test("§11-C 취소('그 질문은 취소해')는 PARENT_QUERY_REQUEST_CANCEL로 판정된다", () => {
  const result = classifyParentKChatIntent("그 질문은 취소해", true);
  assert.equal(result.intent, "PARENT_QUERY_REQUEST_CANCEL");
});

test("pending draft가 있어도 명확한 GENERAL/FEEDBACK 신호는 그대로 우선한다(오분류 방지)", () => {
  assert.equal(classifyParentKChatIntent("안녕", true).intent, "GENERAL_CONVERSATION");
  assert.equal(classifyParentKChatIntent("그 답변 이상해", true).intent, "FEEDBACK_OR_CORRECTION");
});

test("pending draft가 있어도 새로운 '~물어봐줘' 요청은 별개의 신규 PARENT_QUERY_REQUEST로 판정된다(후속수정 플래그 없음)", () => {
  const result = classifyParentKChatIntent("친구 관계는 어떤지 물어봐줘", true);
  assert.equal(result.intent, "PARENT_QUERY_REQUEST");
  assert.equal(result.isFollowUpToPendingDraft, undefined);
});

test("후속 '그럼 아이에게 물어봐줘'는 직전 케이 관계 주제를 유지한다", () => {
  const result = buildAskChildProposal(
    "그럼 서현이에게 물어봐줘",
    [
      { role: "user", text: "케이랑 매일 대화할 것 같아?" },
      { role: "k", text: "매일 할지는 아직 단정하기 어려워요." },
    ],
    null,
    false,
  );

  assert.equal(result.requestedTopic, "케이랑 매일 대화할 것 같아?");
  assert.match(result.proposal, /직전 대화 주제: 케이랑 매일 대화할 것 같아\?/);
  assert.match(result.proposal, /부모의 후속 요청: 그럼 서현이에게 물어봐줘/);
});

test("명시적인 새 질문 요청은 이전 주제로 바꾸지 않는다", () => {
  const result = buildAskChildProposal(
    "이번 주말에 뭐 하고 싶은지 물어봐줘",
    [{ role: "user", text: "케이랑 매일 대화할 것 같아?" }],
    null,
    false,
  );

  assert.equal(result.proposal, "이번 주말에 뭐 하고 싶은지 물어봐줘");
  assert.equal(result.requestedTopic, "이번 주말에 뭐 하고 싶은지 물어봐줘");
});
