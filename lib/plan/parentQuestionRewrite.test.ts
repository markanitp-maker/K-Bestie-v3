import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseParentQuestionRewriteResponse,
  classifyAndRewriteParentQuestion,
  DEFAULT_BLOCKED_MESSAGE,
  isHardPreFilterBlock,
} from "./parentQuestionRewrite";

function json(obj: unknown) {
  return JSON.stringify(obj);
}

test("SAFE_AS_IS — 정상 파싱", () => {
  const r = parseParentQuestionRewriteResponse(
    json({
      classification: "SAFE_AS_IS",
      originalQuestionCount: 1,
      selectedIntent: "가장 친한 친구 확인",
      draftQuestion: "요즘 가장 친한 친구가 누구야?",
      rewriteReasons: [],
    }),
  );
  assert.equal(r.ok, true);
  assert.equal(r.status, "SAFE_AS_IS");
  assert.equal(r.draftQuestion, "요즘 가장 친한 친구가 누구야?");
});

test("SAFE_AFTER_REWRITE — 정상 파싱, rewriteReasons 보존", () => {
  const r = parseParentQuestionRewriteResponse(
    json({
      classification: "SAFE_AFTER_REWRITE",
      originalQuestionCount: 2,
      selectedIntent: "어제 마음이 불편했던 이유 확인",
      draftQuestion: "어제 마음이 조금 불편했던 일이 있었어?",
      rewriteReasons: ["친구와 싸웠다는 추측 제거", "복수 질문을 한 질문으로 축소"],
    }),
  );
  assert.equal(r.ok, true);
  assert.equal(r.status, "SAFE_AFTER_REWRITE");
  assert.equal(r.originalQuestionCount, 2);
  assert.deepEqual(r.rewriteReasons, ["친구와 싸웠다는 추측 제거", "복수 질문을 한 질문으로 축소"]);
});

test("BLOCKED — rejectReason 있으면 그대로 사용", () => {
  const r = parseParentQuestionRewriteResponse(
    json({ classification: "BLOCKED", rejectReason: "엄마 편을 들라고 강요하는 질문이에요." }),
  );
  assert.equal(r.ok, false);
  assert.equal(r.status, "BLOCKED");
  assert.equal(r.draftQuestion, null);
  assert.equal(r.rejectReason, "엄마 편을 들라고 강요하는 질문이에요.");
});

test("BLOCKED — rejectReason 비어있으면 기본 문구로 대체", () => {
  const r = parseParentQuestionRewriteResponse(json({ classification: "BLOCKED" }));
  assert.equal(r.ok, false);
  assert.equal(r.status, "BLOCKED");
  assert.equal(r.rejectReason, DEFAULT_BLOCKED_MESSAGE);
});

test("잘못된 classification 값 — GENERATION_FAILED", () => {
  const r = parseParentQuestionRewriteResponse(json({ classification: "UNSAFE", draftQuestion: "x" }));
  assert.equal(r.ok, false);
  assert.equal(r.status, "GENERATION_FAILED");
});

test("JSON 파싱 실패 — GENERATION_FAILED", () => {
  const r = parseParentQuestionRewriteResponse("이건 JSON이 아니에요");
  assert.equal(r.ok, false);
  assert.equal(r.status, "GENERATION_FAILED");
});

test("```json 코드블록으로 감싸도 파싱 성공", () => {
  const r = parseParentQuestionRewriteResponse(
    "```json\n" + json({ classification: "SAFE_AS_IS", draftQuestion: "오늘 뭐 하고 놀았어?" }) + "\n```",
  );
  assert.equal(r.ok, true);
  assert.equal(r.draftQuestion, "오늘 뭐 하고 놀았어?");
});

test("draftQuestion이 빈 문자열이면 GENERATION_FAILED(안전망)", () => {
  const r = parseParentQuestionRewriteResponse(json({ classification: "SAFE_AS_IS", draftQuestion: "" }));
  assert.equal(r.ok, false);
  assert.equal(r.status, "GENERATION_FAILED");
});

test("draftQuestion이 100자 초과면 GENERATION_FAILED(안전망)", () => {
  const r = parseParentQuestionRewriteResponse(
    json({ classification: "SAFE_AFTER_REWRITE", draftQuestion: "가".repeat(101) }),
  );
  assert.equal(r.ok, false);
  assert.equal(r.status, "GENERATION_FAILED");
});

test("draftQuestion에 위험 패턴이 남아있으면 GENERATION_FAILED(안전망) — LLM이 지침을 어긴 경우", () => {
  const r = parseParentQuestionRewriteResponse(
    json({ classification: "SAFE_AFTER_REWRITE", draftQuestion: "어제 누가 잘못했는지 말해줄래?" }),
  );
  assert.equal(r.ok, false);
  assert.equal(r.status, "GENERATION_FAILED");
});

test("originalQuestionCount 누락/비정상이면 null, 소수는 반올림", () => {
  const r1 = parseParentQuestionRewriteResponse(json({ classification: "SAFE_AS_IS", draftQuestion: "괜찮았어?" }));
  assert.equal(r1.originalQuestionCount, null);
  const r2 = parseParentQuestionRewriteResponse(
    json({ classification: "SAFE_AS_IS", draftQuestion: "괜찮았어?", originalQuestionCount: 2.6 }),
  );
  assert.equal(r2.originalQuestionCount, 3);
});

test("classifyAndRewriteParentQuestion — LLM 호출 성공 시 파싱 결과 반환", async () => {
  const mockAi = {
    models: {
      generateContent: async () => ({
        text: json({ classification: "SAFE_AS_IS", draftQuestion: "오늘 급식 뭐 나왔어?" }),
      }),
    },
  };
  const r = await classifyAndRewriteParentQuestion(mockAi, "fake-model", "오늘 급식 뭐 나왔는지 물어봐줘");
  assert.equal(r.ok, true);
  assert.equal(r.draftQuestion, "오늘 급식 뭐 나왔어?");
});

test("무해한 '몰래' 맥락은 draftQuestion을 통과시킨다(claude-review 재지적 회귀)", () => {
  const r = parseParentQuestionRewriteResponse(
    json({ classification: "SAFE_AFTER_REWRITE", draftQuestion: "산타 선물 몰래 받고 좋아했어?" }),
  );
  assert.equal(r.ok, true);
  assert.equal(r.draftQuestion, "산타 선물 몰래 받고 좋아했어?");
});

test("캐묻는 동사가 붙은 '몰래'는 여전히 GENERATION_FAILED로 강등", () => {
  const r = parseParentQuestionRewriteResponse(
    json({ classification: "SAFE_AFTER_REWRITE", draftQuestion: "친구가 몰래 캐물어보라고 했어?" }),
  );
  assert.equal(r.ok, false);
  assert.equal(r.status, "GENERATION_FAILED");
});

test("isHardPreFilterBlock — diagnosis/secret_probe만 LLM 이전 하드블록", () => {
  assert.equal(isHardPreFilterBlock("diagnosis"), true);
  assert.equal(isHardPreFilterBlock("secret_probe"), true);
  assert.equal(isHardPreFilterBlock("interrogation"), false);
  assert.equal(isHardPreFilterBlock("behavior_eval"), false);
  assert.equal(isHardPreFilterBlock(undefined), false);
});

test("classifyAndRewriteParentQuestion — LLM 호출 자체가 실패하면 GENERATION_FAILED", async () => {
  const mockAi = {
    models: {
      generateContent: async () => {
        throw new Error("network error");
      },
    },
  };
  const r = await classifyAndRewriteParentQuestion(mockAi, "fake-model", "아무 질문");
  assert.equal(r.ok, false);
  assert.equal(r.status, "GENERATION_FAILED");
});
