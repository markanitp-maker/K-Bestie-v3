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
    return { skill: null, sessionId: null, cleaned };
  }

  const nowMs = opts?.nowMs ?? Date.now();
  const registry = opts?.registry ?? PLAY_SKILL_REGISTRY;
  const chatSessionId = opts?.chatSessionId;

  // 1. 등록된 모든 Skill에 대해 getActiveSession 조회 (Promise.allSettled)
  const discovered: DiscoveredActiveSession[] = [];

  const sessionResults = await Promise.allSettled(
    registry.map(async (skill) => {
      const session = await skill.getActiveSession(db, childId);
      return { skill, session };
    })
  );

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
      } catch (err) {
        console.error(
          `[activeSkillCoordinator] Failed to end stale skill ${item.skill.id}:`,
          err
        );
      }
      cleaned.push({ skillId: item.skill.id, reason: "stale" });
    } else {
      freshActive.push(item);
    }
  }

  // 3. 남은 Active가 0개인 경우
  if (freshActive.length === 0) {
    return { skill: null, sessionId: null, cleaned };
  }

  // 4. 남은 Active가 1개인 경우
  if (freshActive.length === 1) {
    return {
      skill: freshActive[0].skill,
      sessionId: freshActive[0].sessionId,
      cleaned,
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
    } catch (err) {
      console.error(
        `[activeSkillCoordinator] Failed to end duplicate skill ${dup.skill.id}:`,
        err
      );
    }
    cleaned.push({ skillId: dup.skill.id, reason: "duplicate" });
  }

  return {
    skill: chosen.skill,
    sessionId: chosen.sessionId,
    cleaned,
  };
}
