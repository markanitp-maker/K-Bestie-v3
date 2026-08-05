import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SOFT_DELETE_RESOURCES,
  SOFT_DELETE_RESOURCE_IDS,
  SOFT_DELETE_MAX_BULK,
  SOFT_DELETE_RETENTION_DAYS,
  SoftDeleteError,
  isSoftDeleteResource,
  normalizeDeleteReason,
  normalizeIds,
  permanentDeleteAt,
  purgeCutoff,
  remainingRestoreDays,
  requireSoftDeleteResource,
  sanitizeSnapshot,
} from "./softDeleteService";

// ── 제외 대상 차단 (안전 경계) ─────────────────────────────────────────────
// 부모·아이·가족·인증 계정, 대화 원본/보정, 미션, 자유대화, 리포트, 리텐션 원천,
// LLM Memory, 황금열쇠·결제·핵심 이벤트 원장은 화이트리스트에 존재하지 않아야 한다.
const FORBIDDEN_TABLES = [
  "parents",
  "child_profiles",
  "families",
  "family_members",
  "member_accounts",
  "users",
  "chat_sessions",
  "chat_messages",
  "context_corrections",
  "mission_progress",
  "free_chat_sessions",
  "daily_reports",
  "weekly_reports",
  "memory_facts",
  "gold_key_ledger",
  "app_events",
];

test("화이트리스트에 제외 대상 테이블이 하나도 없다", () => {
  const allowedTables = SOFT_DELETE_RESOURCE_IDS.map((id) => SOFT_DELETE_RESOURCES[id].table);
  for (const forbidden of FORBIDDEN_TABLES) {
    assert.equal(allowedTables.includes(forbidden), false, `${forbidden}이(가) 삭제 허용 목록에 있으면 안 된다`);
  }
});

test("제외 대상 리소스는 requireSoftDeleteResource에서 차단된다", () => {
  for (const forbidden of [...FORBIDDEN_TABLES, "", "  ", "beta_applications; drop table parents", null, undefined, 7]) {
    assert.equal(isSoftDeleteResource(forbidden), false);
    assert.throws(() => requireSoftDeleteResource(forbidden), SoftDeleteError);
  }
});

test("허용 리소스는 통과한다", () => {
  for (const id of SOFT_DELETE_RESOURCE_IDS) {
    assert.equal(requireSoftDeleteResource(id), id);
  }
});

test("리소스 키와 테이블명이 일치하고 라벨이 있다", () => {
  for (const id of SOFT_DELETE_RESOURCE_IDS) {
    const config = SOFT_DELETE_RESOURCES[id];
    assert.equal(config.table, id);
    assert.ok(config.label.length > 0);
    assert.ok(config.snapshotColumns.includes("id"));
  }
});

// ── 삭제 사유 필수 검증 ────────────────────────────────────────────────────
test("삭제 사유가 비어 있으면 거부한다", () => {
  for (const bad of [undefined, null, "", "   ", "\n\t", 123]) {
    assert.throws(() => normalizeDeleteReason(bad), SoftDeleteError);
  }
});

test("삭제 사유는 trim되고 길이 제한이 있다", () => {
  assert.equal(normalizeDeleteReason("  정식 오픈 전 정리  "), "정식 오픈 전 정리");
  assert.throws(() => normalizeDeleteReason("가".repeat(501)), SoftDeleteError);
});

// ── bulk id 검증 ───────────────────────────────────────────────────────────
test("id 배열은 중복 제거하고 빈 값을 거른다", () => {
  assert.deepEqual(normalizeIds(["a", "a", " b ", "", null, 3]), ["a", "b"]);
});

test("빈 id 배열은 거부한다", () => {
  assert.throws(() => normalizeIds([]), SoftDeleteError);
  assert.throws(() => normalizeIds(["", "  "]), SoftDeleteError);
  assert.throws(() => normalizeIds("a"), SoftDeleteError);
});

test("bulk 최대 건수를 넘으면 거부한다", () => {
  const tooMany = Array.from({ length: SOFT_DELETE_MAX_BULK + 1 }, (_, i) => `id-${i}`);
  assert.throws(() => normalizeIds(tooMany), SoftDeleteError);
  assert.equal(normalizeIds(tooMany.slice(0, SOFT_DELETE_MAX_BULK)).length, SOFT_DELETE_MAX_BULK);
});

// ── 스냅샷 개인정보 제거 ───────────────────────────────────────────────────
test("스냅샷은 허용 컬럼만 남긴다 — 자유 서술 원문·설문 원문·자격증명 제외", () => {
  const supportSnapshot = sanitizeSnapshot("support_requests", {
    id: "req-1",
    request_number: "REQ-0001",
    category: "bug",
    status: "open",
    subject: "민감한 제목",
    body: "사용자가 쓴 원문 내용",
    device_info: { ua: "..." },
  });
  assert.deepEqual(Object.keys(supportSnapshot ?? {}).sort(), ["category", "id", "request_number", "status"]);
  assert.equal("body" in (supportSnapshot ?? {}), false);
  assert.equal("subject" in (supportSnapshot ?? {}), false);

  const betaSnapshot = sanitizeSnapshot("beta_applications", {
    id: "beta-1",
    user_id: "u-1",
    answers: { phone: "010-0000-0000", motivation: "원문" },
  });
  assert.equal("answers" in (betaSnapshot ?? {}), false);

  const approvalSnapshot = sanitizeSnapshot("child_approval_requests", {
    id: "car-1",
    username: "testchild",
    encrypted_password: "SECRET",
    status: "pending",
  });
  assert.equal("encrypted_password" in (approvalSnapshot ?? {}), false);
});

test("스냅샷 입력이 없으면 null", () => {
  assert.equal(sanitizeSnapshot("support_requests", null), null);
  assert.equal(sanitizeSnapshot("support_requests", undefined), null);
});

// ── 30일 경과 대상 계산 ────────────────────────────────────────────────────
test("영구 삭제 예정일은 삭제일 + 보관일수", () => {
  const deletedAt = "2026-08-01T00:00:00.000Z";
  assert.equal(permanentDeleteAt(deletedAt).toISOString(), "2026-08-31T00:00:00.000Z");
});

test("남은 복구 가능 일수", () => {
  const deletedAt = "2026-08-01T00:00:00.000Z";
  assert.equal(remainingRestoreDays(deletedAt, new Date("2026-08-01T00:00:00.000Z")), SOFT_DELETE_RETENTION_DAYS);
  assert.equal(remainingRestoreDays(deletedAt, new Date("2026-08-30T00:00:00.000Z")), 1);
  // 경과분은 음수가 아니라 0으로 표시한다.
  assert.equal(remainingRestoreDays(deletedAt, new Date("2026-09-15T00:00:00.000Z")), 0);
});

test("영구 삭제 기준 시각은 now - 보관일수", () => {
  const now = new Date("2026-09-01T00:00:00.000Z");
  assert.equal(purgeCutoff(now).toISOString(), "2026-08-02T00:00:00.000Z");
  // 31일 전에 삭제된 건은 대상, 29일 전 건은 비대상.
  assert.ok(new Date("2026-08-01T00:00:00.000Z") < purgeCutoff(now));
  assert.ok(new Date("2026-08-03T00:00:00.000Z") > purgeCutoff(now));
});
