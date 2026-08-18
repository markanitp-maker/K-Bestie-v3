import test from "node:test";
import assert from "node:assert/strict";
import { recordParentKChatTurn, type ParentKChatMessageRow } from "./messageStore";
import { getSupabaseTarget } from "@/lib/supabase/env";

const dummyDb = {} as any;

test("1. 부모 턴·케이 턴이 각각 올바른 role 로 저장된다", async () => {
  const savedRows: ParentKChatMessageRow[] = [];
  const insertMessage = async (row: ParentKChatMessageRow) => {
    savedRows.push(row);
  };

  recordParentKChatTurn(dummyDb, {
    parentId: "parent-uuid-1",
    childId: "child-uuid-1",
    role: "parent",
    content: "서현이 오늘 기분 어땠어?",
    insertMessage,
  });

  recordParentKChatTurn(dummyDb, {
    parentId: "parent-uuid-1",
    childId: "child-uuid-1",
    role: "k",
    content: "오늘 서현이는 기분이 좋았어요.",
    route: "HAS_EVIDENCE",
    answerable: true,
    insertMessage,
  });

  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(savedRows.length, 2);
  assert.equal(savedRows[0].role, "parent");
  assert.equal(savedRows[0].content, "서현이 오늘 기분 어땠어?");
  assert.equal(savedRows[0].parent_id, "parent-uuid-1");
  assert.equal(savedRows[0].child_id, "child-uuid-1");
  assert.equal(savedRows[0].route, null);
  assert.equal(savedRows[0].answerable, null);

  assert.equal(savedRows[1].role, "k");
  assert.equal(savedRows[1].content, "오늘 서현이는 기분이 좋았어요.");
  assert.equal(savedRows[1].parent_id, "parent-uuid-1");
  assert.equal(savedRows[1].child_id, "child-uuid-1");
  assert.equal(savedRows[1].route, "HAS_EVIDENCE");
  assert.equal(savedRows[1].answerable, true);
});

test("2. environment 가 getSupabaseTarget() 값으로 들어간다", async () => {
  const savedRows: ParentKChatMessageRow[] = [];
  const insertMessage = async (row: ParentKChatMessageRow) => {
    savedRows.push(row);
  };

  recordParentKChatTurn(dummyDb, {
    parentId: "parent-uuid-2",
    childId: null,
    role: "parent",
    content: "안녕 케이야",
    insertMessage,
  });

  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(savedRows.length, 1);
  assert.equal(savedRows[0].environment, getSupabaseTarget());
  assert.ok(["dev", "prod"].includes(savedRows[0].environment));
});

test("3. role 은 'parent' | 'k' 만 허용 (그 외는 저장 시도 안 함)", async () => {
  const savedRows: ParentKChatMessageRow[] = [];
  const insertMessage = async (row: ParentKChatMessageRow) => {
    savedRows.push(row);
  };

  recordParentKChatTurn(dummyDb, {
    parentId: "parent-uuid-3",
    childId: "child-uuid-3",
    role: "admin" as any,
    content: "관리자 메시지",
    insertMessage,
  });

  recordParentKChatTurn(dummyDb, {
    parentId: "parent-uuid-3",
    childId: "child-uuid-3",
    role: "system" as any,
    content: "시스템 메시지",
    insertMessage,
  });

  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(savedRows.length, 0);
});

test("4. 저장이 실패해도 예외가 호출자에게 새지 않는다", async () => {
  const failingInsert = async () => {
    throw new Error("DB Connection Failed");
  };

  assert.doesNotThrow(() => {
    recordParentKChatTurn(dummyDb, {
      parentId: "parent-uuid-4",
      childId: "child-uuid-4",
      role: "parent",
      content: "실패 테스트 질문",
      insertMessage: failingInsert,
    });
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
});

test("5. parentId 나 content 가 비면 아무것도 저장하지 않는다", async () => {
  const savedRows: ParentKChatMessageRow[] = [];
  const insertMessage = async (row: ParentKChatMessageRow) => {
    savedRows.push(row);
  };

  recordParentKChatTurn(dummyDb, {
    parentId: "",
    role: "parent",
    content: "질문 내용",
    insertMessage,
  });

  recordParentKChatTurn(dummyDb, {
    parentId: "   ",
    role: "parent",
    content: "질문 내용",
    insertMessage,
  });

  recordParentKChatTurn(dummyDb, {
    parentId: "parent-uuid-5",
    role: "parent",
    content: "",
    insertMessage,
  });

  recordParentKChatTurn(dummyDb, {
    parentId: "parent-uuid-5",
    role: "parent",
    content: "   ",
    insertMessage,
  });

  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(savedRows.length, 0);
});
