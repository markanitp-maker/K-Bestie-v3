import type { SupabaseClient } from "@supabase/supabase-js";
import {
  calculateRelationshipCalendarStage,
  type RelationshipCalendarStage,
} from "./calendarStage";
import {
  resolveEffectiveStage,
  type RelationshipStageMetrics,
} from "./effectiveStage";
import { loadRelationshipStageRuleSet } from "./stageRuleConfig";
import {
  resolveScenarioCard,
  type ResolvedScenarioCard,
} from "./scenarioCard";

export interface RelationshipStageMetricsSource {
  conversationCount: number;
  conversationDays: number;
  usableMemoryCount: number;
  sharedMemoryCount: number;
  relationshipEventCount: number;
}

export type { RelationshipStageMetrics } from "./effectiveStage";

export interface EvaluatedRelationshipStage {
  calendarStage: RelationshipCalendarStage | null;
  effectiveStage: RelationshipCalendarStage | null;
  ruleVersion: string;
  blockedBy: string | null;
  scenarioCard: ResolvedScenarioCard | null;
  metrics: RelationshipStageMetrics;
}

const DEFAULT_METRICS: RelationshipStageMetrics = Object.freeze({
  conversationCount: 0,
  conversationDays: 0,
  usableMemoryCount: 0,
  sharedMemoryCount: 0,
  relationshipEventCount: 0,
});

/**
 * 세션 시작 시 1회만 호출한다(§29). 매 턴 호출 금지.
 * 5개 지표(대화 수, 대화 일수, 유효 기억 수, 공유 기억 수, 관계 이벤트 수)를 병렬로 조회한다.
 * 전용 컬럼이 없어 sharedMemoryCount는 memory_facts의 active 상태 및 source_count>=2로 근사한다.
 * 조회 실패 시 throw하지 않고 0으로 fallback한다.
 */
export async function loadRelationshipStageMetrics(
  db: SupabaseClient,
  childId: string,
): Promise<RelationshipStageMetrics> {
  try {
    const conversationCountPromise = db
      .from("chat_sessions")
      .select("*", { count: "exact", head: true })
      .eq("child_id", childId);

    const conversationDaysPromise = db
      .from("chat_sessions")
      .select("business_date")
      .eq("child_id", childId);

    const usableMemoryPromise = db
      .from("memory_facts")
      .select("*", { count: "exact", head: true })
      .eq("child_id", childId)
      .eq("status", "active");

    // sharedMemoryCount: 전용 컬럼이 없어 source_count>=2로 근사한다.
    const sharedMemoryPromise = db
      .from("memory_facts")
      .select("*", { count: "exact", head: true })
      .eq("child_id", childId)
      .eq("status", "active")
      .gte("source_count", 2);

    const relationshipEventPromise = db
      .from("behavior_events")
      .select("*", { count: "exact", head: true })
      .eq("child_id", childId)
      .eq("feature", "relationship");

    const [
      conversationCountRes,
      conversationDaysRes,
      usableMemoryRes,
      sharedMemoryRes,
      relationshipEventRes,
    ] = await Promise.allSettled([
      conversationCountPromise,
      conversationDaysPromise,
      usableMemoryPromise,
      sharedMemoryPromise,
      relationshipEventPromise,
    ]);

    let conversationCount = 0;
    if (conversationCountRes.status === "fulfilled" && !conversationCountRes.value.error) {
      conversationCount = typeof conversationCountRes.value.count === "number"
        ? conversationCountRes.value.count
        : 0;
    } else if (conversationCountRes.status === "rejected" || conversationCountRes.value?.error) {
      console.error(
        "[loadRelationshipStageMetrics] conversationCount 조회 실패:",
        conversationCountRes.status === "rejected"
          ? conversationCountRes.reason
          : conversationCountRes.value.error,
      );
    }

    let conversationDays = 0;
    if (conversationDaysRes.status === "fulfilled" && !conversationDaysRes.value.error) {
      const rows = conversationDaysRes.value.data;
      if (Array.isArray(rows)) {
        const uniqueDates = new Set(
          rows
            .map((r: { business_date?: string | null }) => r?.business_date)
            .filter(Boolean),
        );
        conversationDays = uniqueDates.size;
      }
    } else if (conversationDaysRes.status === "rejected" || conversationDaysRes.value?.error) {
      console.error(
        "[loadRelationshipStageMetrics] conversationDays 조회 실패:",
        conversationDaysRes.status === "rejected"
          ? conversationDaysRes.reason
          : conversationDaysRes.value.error,
      );
    }

    let usableMemoryCount = 0;
    if (usableMemoryRes.status === "fulfilled" && !usableMemoryRes.value.error) {
      usableMemoryCount = typeof usableMemoryRes.value.count === "number"
        ? usableMemoryRes.value.count
        : 0;
    } else if (usableMemoryRes.status === "rejected" || usableMemoryRes.value?.error) {
      console.error(
        "[loadRelationshipStageMetrics] usableMemoryCount 조회 실패:",
        usableMemoryRes.status === "rejected"
          ? usableMemoryRes.reason
          : usableMemoryRes.value.error,
      );
    }

    let sharedMemoryCount = 0;
    if (sharedMemoryRes.status === "fulfilled" && !sharedMemoryRes.value.error) {
      sharedMemoryCount = typeof sharedMemoryRes.value.count === "number"
        ? sharedMemoryRes.value.count
        : 0;
    } else if (sharedMemoryRes.status === "rejected" || sharedMemoryRes.value?.error) {
      console.error(
        "[loadRelationshipStageMetrics] sharedMemoryCount 조회 실패:",
        sharedMemoryRes.status === "rejected"
          ? sharedMemoryRes.reason
          : sharedMemoryRes.value.error,
      );
    }

    let relationshipEventCount = 0;
    if (relationshipEventRes.status === "fulfilled" && !relationshipEventRes.value.error) {
      relationshipEventCount = typeof relationshipEventRes.value.count === "number"
        ? relationshipEventRes.value.count
        : 0;
    } else if (relationshipEventRes.status === "rejected" || relationshipEventRes.value?.error) {
      console.error(
        "[loadRelationshipStageMetrics] relationshipEventCount 조회 실패:",
        relationshipEventRes.status === "rejected"
          ? relationshipEventRes.reason
          : relationshipEventRes.value.error,
      );
    }

    return {
      conversationCount,
      conversationDays,
      usableMemoryCount,
      sharedMemoryCount,
      relationshipEventCount,
    };
  } catch (error) {
    console.error("[loadRelationshipStageMetrics] 예외 발생:", error);
    return { ...DEFAULT_METRICS };
  }
}

/**
 * 프로필 + 지표 → 단계 + 카드. 실패해도 throw 하지 않는다.
 * 1. child_profiles 조회
 * 2. relationship_started_at 없으면 calendarStage = null, 전부 null 반환
 * 3. calendarStage 유효 시 5개 지표 병렬 로드
 * 4. currentEffectiveStage 고려하여 자동 강등 방지(§8)
 * 5. effectiveStage + grade로 ScenarioCard 결정
 */
export async function evaluateRelationshipStage(input: {
  db: SupabaseClient;
  childId: string;
  env?: NodeJS.ProcessEnv;
  asOf?: Date;
}): Promise<EvaluatedRelationshipStage> {
  const ruleSet = loadRelationshipStageRuleSet(input.env);

  try {
    const { data: profile, error: profileError } = await input.db
      .from("child_profiles")
      .select("relationship_started_at,relationship_effective_stage,grade")
      .eq("id", input.childId)
      .maybeSingle();

    if (profileError || !profile) {
      if (profileError) {
        console.error("[evaluateRelationshipStage] child_profiles 조회 실패:", profileError);
      }
      return {
        calendarStage: null,
        effectiveStage: null,
        ruleVersion: ruleSet.version,
        blockedBy: null,
        scenarioCard: null,
        metrics: { ...DEFAULT_METRICS },
      };
    }

    const calendarStage = calculateRelationshipCalendarStage(
      { relationship_started_at: profile.relationship_started_at ?? null },
      input.asOf,
    );

    if (calendarStage === null) {
      return {
        calendarStage: null,
        effectiveStage: null,
        ruleVersion: ruleSet.version,
        blockedBy: null,
        scenarioCard: null,
        metrics: { ...DEFAULT_METRICS },
      };
    }

    const metrics = await loadRelationshipStageMetrics(input.db, input.childId);

    const currentEffectiveStage =
      (profile.relationship_effective_stage as RelationshipCalendarStage) || null;

    const effectiveResult = resolveEffectiveStage({
      calendarStage,
      metrics,
      ruleSet,
      currentEffectiveStage,
    });

    const scenarioCard = resolveScenarioCard({
      grade: profile.grade,
      effectiveStage: effectiveResult.effectiveStage,
    });

    return {
      calendarStage,
      effectiveStage: effectiveResult.effectiveStage,
      ruleVersion: effectiveResult.ruleVersion,
      blockedBy: effectiveResult.blockedBy,
      scenarioCard,
      metrics,
    };
  } catch (error) {
    console.error("[evaluateRelationshipStage] 예외 발생:", error);
    return {
      calendarStage: null,
      effectiveStage: null,
      ruleVersion: ruleSet?.version ?? "v1",
      blockedBy: null,
      scenarioCard: null,
      metrics: { ...DEFAULT_METRICS },
    };
  }
}
