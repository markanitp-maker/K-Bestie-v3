import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlaySkillModule } from "./skillTypes";
import { PLAY_SKILL_REGISTRY } from "./skillRegistry";
import { isPlaySessionStale } from "./playLifecycle";

export interface CleanedSkillRecord {
  skillId: string;
  reason: "stale" | "duplicate";
}

export interface ActiveSkillResolution {
  skill: PlaySkillModule | null;
  sessionId: string | null;
  cleaned: CleanedSkillRecord[];
  /**
   * 활성 세션 조회가 하나라도 실패했는가.
   *
   * `skill: null` 과 함께 true 면 "놀이 없음" 이 아니라 **모름** 이다. 실패를 부재로
   * 취급하면 살아 있는 놀이의 턴이 조용히 처리되지 않는다(2026-08-20 결함).
   *
   * `skill` 을 찾았는데도 true 일 수 있다 — 다른 스킬을 못 읽었다는 뜻이다.
   * 그 스킬에 중복 활성 세션이 남아 있을 수 있으므로, **종료 경로는 이 값을 보고
   * "전부 종료했다" 고 단정하지 않아야 한다**(리뷰 지적, 2026-08-20).
   */
  lookupFailed: boolean;
}

export interface ResolveActiveSkillOptions {
  nowMs?: number;
  registry?: readonly PlaySkillModule[];
  chatSessionId?: string;
}

interface DiscoveredActiveSession {
  skill: PlaySkillModule;
  sessionId: string;
  updatedAt?: string | null;
  startedAt?: string | null;
}

/**
 * Single Active Skill Coordinator (§3-5, §3-6, §3-15, §3-16).
 *
 * 1. 등록된 모든 Play Skill에서 getActiveSession()을 호출하여 활성 세션을 수집합니다.
 * 2. stale(30분 이상 미갱신)인 세션은 Active로 인정하지 않고 end()로 안전하게 정리합니다.
 * 3. fresh Active 세션이 2개 이상이면 invariant 위반으로 기록하고,
 *    가장 최근에 갱신된(updatedAt/startedAt) 1개만 남기고 나머지는 end()로 정리합니다.
 *    (데이터 삭제가 아닌 end() 호출만 수행, §3-6).
 * 4. 최종적으로 0개 또는 1개의 활성 Skill 및 sessionId를 반환합니다.
 */
export async function resolveActiveSkill(
  db: SupabaseClient,
  childId: string,
  opts?: ResolveActiveSkillOptions
): Promise<ActiveSkillResolution> {
  const cleaned: CleanedSkillRecord[] = [];

  if (!db || !childId) {
    return { skill: null, sessionId: null, cleaned, lookupFailed: false };
  }

  const nowMs = opts?.nowMs ?? Date.now();
  const registry = opts?.registry ?? PLAY_SKILL_REGISTRY;
  const chatSessionId = opts?.chatSessionId;

  // 1. 등록된 모든 Skill에 대해 getActiveSession 조회 (Promise.allSettled)
  const discovered: DiscoveredActiveSession[] = [];

  const sessionResults = await Promise.allSettled(
    registry.map(async (skill) => {
      // 실패를 삼키면 "세션 없음" 과 구별되지 않아 활성 놀이 턴이 조용히 처리되지 않는다.
      // 던지게 해서 allSettled 의 rejected 로 드러낸다.
      const session = await skill.getActiveSession(db, childId, {
        throwOnError: true,
      });
      return { skill, session };
    })
  );

  let lookupFailed = false;

  for (const result of sessionResults) {
    if (result.status === "fulfilled") {
      const { skill, session } = result.value;
      if (session && session.id) {
        discovered.push({
          skill,
          sessionId: session.id,
          updatedAt: session.updatedAt,
          startedAt: session.startedAt,
        });
      }
    } else {
      // 조회 실패다. "놀이 없음" 이 아니므로 호출부에 알린다.
      lookupFailed = true;
      console.error(
        "[activeSkillCoordinator] Failed checking active session for skill:",
        result.reason
      );
    }
  }

  // 2. stale 세션 필터링 및 end() 정리
  const freshActive: DiscoveredActiveSession[] = [];

  for (const item of discovered) {
    const isStale = isPlaySessionStale(item.updatedAt, nowMs, item.startedAt);
    if (isStale) {
      try {
        await item.skill.end({
          db,
          childId,
          chatSessionId,
          reason: "STALE_SESSION_CLEANUP",
        });
        cleaned.push({ skillId: item.skill.id, reason: "stale" });
      } catch (err) {
        // 못 닫았으면 정리된 것이 아니다. cleaned 로 세고 활성 목록에서 빼면
        // 살아 있는 세션을 없는 것으로 취급하게 된다(리뷰 지적, 2026-08-20).
        // 상태를 확정하지 못했다고 알린다.
        console.error(
          `[activeSkillCoordinator] Failed to end stale skill ${item.skill.id}:`,
          err
        );
        lookupFailed = true;
      }
    } else {
      freshActive.push(item);
    }
  }

  // 3. 남은 Active가 0개인 경우
  //    조회가 실패했다면 "0개" 는 사실이 아니라 모르는 것이다.
  if (freshActive.length === 0) {
    return { skill: null, sessionId: null, cleaned, lookupFailed };
  }

  // 4. 남은 Active가 1개인 경우
  if (freshActive.length === 1) {
    return {
      skill: freshActive[0].skill,
      sessionId: freshActive[0].sessionId,
      cleaned,
      // 세션을 찾았어도 못 읽은 스킬이 있으면 "전부 확인" 은 아니다.
      lookupFailed,
    };
  }

  // 5. 남은 Active가 2개 이상인 경우 (Invariant 위반 / Cross-game guard)
  console.error(
    `[activeSkillCoordinator] Cross-game active guard: invariant violation: multiple active skills detected for child ${childId} (${freshActive
      .map((s) => s.skill.id)
      .join(
        ", "
      )}). Resolving to most recently updated skill and ending duplicate sessions.`
  );

  const getSessionTimestamp = (item: DiscoveredActiveSession): number => {
    const timeStr = item.updatedAt ?? item.startedAt;
    if (!timeStr) return 0;
    const t = new Date(timeStr).getTime();
    return Number.isNaN(t) ? 0 : t;
  };

  // stable sort: timestamp descending. 동일 시 먼저 등록/조회된 항목 유지.
  const sorted = [...freshActive].sort((a, b) => {
    return getSessionTimestamp(b) - getSessionTimestamp(a);
  });

  const chosen = sorted[0];
  const duplicates = sorted.slice(1);

  for (const dup of duplicates) {
    try {
      await dup.skill.end({
        db,
        childId,
        chatSessionId,
        reason: "DUPLICATE_ACTIVE_CLEANUP",
      });
      cleaned.push({ skillId: dup.skill.id, reason: "duplicate" });
    } catch (err) {
      // 중복을 못 닫았으면 활성이 하나라고 확정할 수 없다. 그런데도 단일 활성으로
      // 답하면, 남은 세션이 다음 턴에 되살아나 놀이가 뒤섞인다(리뷰 지적, 2026-08-20).
      console.error(
        `[activeSkillCoordinator] Failed to end duplicate skill ${dup.skill.id}:`,
        err
      );
      lookupFailed = true;
    }
  }

  return {
    skill: chosen.skill,
    sessionId: chosen.sessionId,
    cleaned,
    lookupFailed,
  };
}
