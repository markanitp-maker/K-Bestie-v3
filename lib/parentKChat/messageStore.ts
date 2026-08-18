import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseTarget, type SupabaseTarget } from "@/lib/supabase/env";

export type ParentKChatRole = "parent" | "k";

export interface ParentKChatMessageRow {
  parent_id: string;
  child_id: string | null;
  role: ParentKChatRole;
  content: string;
  route: string | null;
  answerable: boolean | null;
  environment: SupabaseTarget;
}

export interface RecordParentKChatTurnInput {
  parentId: string;
  childId?: string | null;
  role: ParentKChatRole;
  content: string;
  route?: string | null;
  answerable?: boolean | null;
  /**
   * 테스트용 주입구. 기본값은 실제 DB insert 함수다.
   *
   * `mock.module` 은 `--experimental-test-module-mocks` 플래그가 있어야 돌아서
   * 평범한 `tsx --test` 에서는 조용히 죽는다. 주입이면 플래그 없이 어디서든 검증된다.
   */
  insertMessage?: (row: ParentKChatMessageRow) => Promise<unknown>;
}

async function defaultInsertMessage(db: SupabaseClient, row: ParentKChatMessageRow): Promise<void> {
  const { error } = await db.from("parent_k_chat_messages").insert(row);
  if (error) {
    console.error("[parent-k-chat] 대화 저장 실패:", error);
  }
}

/**
 * 부모–케이 대화 턴 저장 (2026-08-18 대표님 결정).
 *
 * 계측/저장은 본 기능을 절대 방해하면 안 된다.
 * await 로 부모를 기다리게 하지 않고 fire-and-forget + catch 처리한다.
 * 저장이 실패해도 대화는 정상적으로 반환되어야 한다.
 */
export function recordParentKChatTurn(
  db: SupabaseClient,
  input: RecordParentKChatTurnInput
): void {
  const {
    parentId,
    childId,
    role,
    content,
    route,
    answerable,
    insertMessage,
  } = input;

  // 1) parentId, content 필수 검증 (빈 문자열이면 저장 시도 안 함)
  if (!parentId || typeof parentId !== "string" || !parentId.trim()) return;
  if (!content || typeof content !== "string" || !content.trim()) return;

  // 2) role 검증 ('parent' | 'k' 외에는 저장 시도 안 함)
  if (role !== "parent" && role !== "k") return;

  const environment = getSupabaseTarget();

  const row: ParentKChatMessageRow = {
    parent_id: parentId.trim(),
    child_id: childId ? String(childId).trim() : null,
    role,
    content: content.trim(),
    route: route ?? null,
    answerable: typeof answerable === "boolean" ? answerable : null,
    environment,
  };

  void (async () => {
    try {
      if (insertMessage) {
        await insertMessage(row);
      } else {
        await defaultInsertMessage(db, row);
      }
    } catch (err) {
      console.error("[parent-k-chat] 대화 저장 중 예외 발생:", err);
    }
  })().catch(() => {});
}
