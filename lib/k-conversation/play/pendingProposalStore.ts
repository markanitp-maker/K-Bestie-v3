import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlaySkillId } from "./skillTypes";

export interface PendingPlayProposal {
  chatSessionId: string;
  childId: string;
  offeredSkills: PlaySkillId[];
  proposedAt: number;
  initiatedBy: "k" | "child";
  rejected?: boolean;
  selectionRequired?: boolean;
  proposedTurn?: number;
}

// Same free chat session 내 short-lived proposal store (TTL: 10분)
const PROPOSAL_TTL_MS = 10 * 60 * 1000;

// 프로세스 메모리 캐시 및 DB 미제공/테스트/오류 시 fail-safe 폴백 저장소
const pendingProposalMemoryStore = new Map<string, PendingPlayProposal>();

/**
 * 특정 세션의 유효한 Pending Play Proposal을 조회합니다.
 * DB(chat_sessions.pending_play_proposal) 조회를 우선 시도하며,
 * DB 조회가 성공한 경우 그 결과가 최종입니다(DB가 null이면 즉시 null 반환, 인메모리 부활 방지).
 * DB 조회가 실패(에러/예외)하거나 DB 미제공 시에만 인메모리 폴백에서 조회합니다.
 * 만료되었거나 childId가 일치하지 않으면 null을 반환하고 만료된 항목은 정리합니다.
 */
export async function getPendingPlayProposal(
  chatSessionId: string,
  db?: SupabaseClient | null,
  childId?: string,
  currentTurn?: number
): Promise<PendingPlayProposal | null> {
  if (!chatSessionId) return null;

  // 1. DB에서 영속 상태 조회 시도
  if (db && typeof db.from === "function") {
    let dbSuccess = false;
    try {
      const query = db.from("chat_sessions");
      if (query && typeof query.select === "function") {
        const selectQuery = query.select("child_id, turn_count, pending_play_proposal");
        if (selectQuery && typeof selectQuery.eq === "function") {
          const eqQuery = selectQuery.eq("id", chatSessionId);
          let data: any = null;
          let error: any = null;

          if (typeof eqQuery?.maybeSingle === "function") {
            const res = await eqQuery.maybeSingle();
            data = res.data;
            error = res.error;
          } else if (typeof eqQuery?.single === "function") {
            const res = await eqQuery.single();
            data = res.data;
            error = res.error;
          }

          if (!error) {
            dbSuccess = true;

            // DB 조회 성공: pending_play_proposal이 없거나 null이면 즉시 null 반환 (부활 방지)
            if (!data || !data.pending_play_proposal) {
              pendingProposalMemoryStore.delete(chatSessionId);
              return null;
            }

            const raw = data.pending_play_proposal;
            if (typeof raw === "object" && raw !== null && Array.isArray(raw.offeredSkills)) {
              const proposalChildId = raw.childId || data.child_id || "";

              // childId 검증: 요청한 childId와 DB 레코드/제안의 childId가 다르면 null
              if (childId && proposalChildId && proposalChildId !== childId) {
                return null;
              }
              if (childId && data.child_id && data.child_id !== childId) {
                return null;
              }

              const proposal: PendingPlayProposal = {
                chatSessionId: raw.chatSessionId || chatSessionId,
                childId: proposalChildId,
                offeredSkills: raw.offeredSkills,
                proposedAt: typeof raw.proposedAt === "number" ? raw.proposedAt : Date.now(),
                initiatedBy: raw.initiatedBy === "child" ? "child" : "k",
                rejected: Boolean(raw.rejected),
                selectionRequired: Boolean(raw.selectionRequired),
                proposedTurn: typeof raw.proposedTurn === "number" ? raw.proposedTurn : undefined,
              };

              // TTL 검증 (10분)
              if (Date.now() - proposal.proposedAt > PROPOSAL_TTL_MS) {
                await clearPendingPlayProposal(chatSessionId, db);
                return null;
              }

              // 턴 수명 검증 (1턴 수명)
              const sessionTurn =
                typeof currentTurn === "number"
                  ? currentTurn
                  : typeof data.turn_count === "number"
                  ? data.turn_count
                  : undefined;
              if (typeof proposal.proposedTurn === "number" && typeof sessionTurn === "number") {
                const turnDiff = sessionTurn - proposal.proposedTurn;
                if (turnDiff > 1) {
                  await clearPendingPlayProposal(chatSessionId, db);
                  return null;
                }
              }

              // 인메모리 캐시 동기화
              pendingProposalMemoryStore.set(chatSessionId, proposal);
              return proposal;
            } else {
              await clearPendingPlayProposal(chatSessionId, db);
              return null;
            }
          }
        }
      }
    } catch (err) {
      console.error("[pendingProposalStore] getPendingPlayProposal DB error (fail-safe fallback):", err);
    }

    if (dbSuccess) {
      return null;
    }
  }

  // 2. 인메모리 폴백/캐시 조회 (DB 미제공이거나 DB 쿼리 자체가 실패/예외인 경우에만 진입)
  const memoryProposal = pendingProposalMemoryStore.get(chatSessionId);
  if (!memoryProposal) return null;

  // childId 검증
  if (childId && memoryProposal.childId && memoryProposal.childId !== childId) {
    return null;
  }

  // TTL 검증 (10분)
  if (Date.now() - memoryProposal.proposedAt > PROPOSAL_TTL_MS) {
    pendingProposalMemoryStore.delete(chatSessionId);
    return null;
  }

  // 턴 수명 검증
  if (typeof currentTurn === "number" && typeof memoryProposal.proposedTurn === "number") {
    const turnDiff = currentTurn - memoryProposal.proposedTurn;
    if (turnDiff > 1) {
      pendingProposalMemoryStore.delete(chatSessionId);
      return null;
    }
  }

  return memoryProposal;
}

/**
 * 특정 세션에 Pending Play Proposal을 저장합니다.
 * DB(chat_sessions.pending_play_proposal)와 인메모리 폴백 모두에 기록합니다.
 * DB 저장 실패 시에도 대화가 죽지 않고 계속 진행되도록 안전하게 격리합니다.
 */
export async function setPendingPlayProposal(
  proposal: PendingPlayProposal,
  db?: SupabaseClient | null
): Promise<void> {
  if (!proposal || !proposal.chatSessionId) return;

  const normalizedProposal: PendingPlayProposal = {
    ...proposal,
    proposedAt: proposal.proposedAt || Date.now(),
  };

  // 1. 인메모리 폴백/캐시 갱신
  pendingProposalMemoryStore.set(proposal.chatSessionId, normalizedProposal);

  // 2. DB 영속화 시도
  if (db && typeof db.from === "function") {
    try {
      const query = db.from("chat_sessions");
      if (query && typeof query.update === "function") {
        const updateQuery = query.update({ pending_play_proposal: normalizedProposal });
        if (updateQuery && typeof updateQuery.eq === "function") {
          const { error } = await updateQuery.eq("id", proposal.chatSessionId);
          if (error) {
            console.error("[pendingProposalStore] setPendingPlayProposal DB update error (fail-safe):", error.message);
          }
        }
      }
    } catch (err) {
      console.error("[pendingProposalStore] setPendingPlayProposal DB threw error (fail-safe):", err);
    }
  }
}

/**
 * 특정 세션의 Pending Play Proposal을 정리합니다.
 * (Topic Shift, 무관한 대화, 거절, Skill 시작, 세션 종료 시 호출)
 */
export async function clearPendingPlayProposal(
  chatSessionId: string,
  db?: SupabaseClient | null
): Promise<void> {
  if (!chatSessionId) return;

  // 1. 인메모리 폴백/캐시 삭제
  pendingProposalMemoryStore.delete(chatSessionId);

  // 2. DB 컬럼 null 처리
  if (db && typeof db.from === "function") {
    try {
      const query = db.from("chat_sessions");
      if (query && typeof query.update === "function") {
        const updateQuery = query.update({ pending_play_proposal: null });
        if (updateQuery && typeof updateQuery.eq === "function") {
          const { error } = await updateQuery.eq("id", chatSessionId);
          if (error) {
            console.error("[pendingProposalStore] clearPendingPlayProposal DB update error (fail-safe):", error.message);
          }
        }
      }
    } catch (err) {
      console.error("[pendingProposalStore] clearPendingPlayProposal DB threw error (fail-safe):", err);
    }
  }
}

/**
 * 특정 세션의 Pending Play Proposal을 거절 상태로 표시합니다.
 */
export async function markPendingProposalRejected(
  chatSessionId: string,
  db?: SupabaseClient | null
): Promise<void> {
  if (!chatSessionId) return;

  const existing = await getPendingPlayProposal(chatSessionId, db);
  if (existing) {
    existing.rejected = true;
    await setPendingPlayProposal(existing, db);
  }
}

/**
 * 테스트 격리용 전체 초기화 함수.
 */
export function clearAllPendingProposalsForTest(): void {
  pendingProposalMemoryStore.clear();
}
