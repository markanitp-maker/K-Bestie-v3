import { logBehaviorEvent } from "@/lib/analytics/logBehaviorEvent";
import { getSupabaseTarget } from "@/lib/supabase/env";
import { createServiceClient } from "@/lib/supabase/server";

export type AppSessionAction =
  | "start"
  | "heartbeat"
  | "foreground"
  | "background"
  | "end";

export interface AppSessionActor {
  actorType: "parent" | "child";
  actorId: string;
  familyId: string;
  childId: string | null;
}

export class AppSessionError extends Error {
  constructor(
    message: string,
    public readonly code: "not_eligible" | "not_found" | "conflict" | "database_error",
  ) {
    super(message);
    this.name = "AppSessionError";
  }
}

export async function resolveAppSessionActor(userId: string): Promise<AppSessionActor> {
  const service = createServiceClient();
  const { data: member, error: memberError } = await service
    .from("family_members")
    .select("id, family_id, role")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();

  if (memberError) {
    throw new AppSessionError("가족 멤버십 조회에 실패했습니다.", "database_error");
  }
  if (!member || !member.family_id) {
    throw new AppSessionError("세션 계측 대상 계정이 아닙니다.", "not_eligible");
  }

  if (member.role === "child") {
    // child_profiles에는 deleted_at(소프트 삭제) 컬럼이 없다(하드 삭제만 존재) —
    // lib/admin/aggregateExecutionStatus.ts:59 참고. 매칭 행이 없으면 삭제된 아이로 간주.
    const { data: child, error: childError } = await service
      .from("child_profiles")
      .select("id")
      .eq("member_id", member.id)
      .eq("family_id", member.family_id)
      .maybeSingle();

    if (childError) {
      throw new AppSessionError("아이 프로필 조회에 실패했습니다.", "database_error");
    }
    if (!child) {
      throw new AppSessionError("세션 계측 대상 아이 계정이 아닙니다.", "not_eligible");
    }

    return {
      actorType: "child",
      actorId: userId,
      familyId: member.family_id,
      childId: child.id,
    };
  }

  if (member.role !== "parent" && member.role !== "owner_parent") {
    throw new AppSessionError("세션 계측 대상 계정이 아닙니다.", "not_eligible");
  }

  return {
    actorType: "parent",
    actorId: userId,
    familyId: member.family_id,
    childId: null,
  };
}

export async function startAppSession(
  actor: AppSessionActor,
  sessionId: string,
  route: string,
): Promise<void> {
  const service = createServiceClient();
  const { error } = await service.from("app_sessions").insert({
    session_id: sessionId,
    actor_type: actor.actorType,
    actor_id: actor.actorId,
    family_id: actor.familyId,
    child_id: actor.childId,
    route_at_start: route,
    environment: getSupabaseTarget(),
  });

  if (error) {
    if (error.code === "23505") {
      throw new AppSessionError("이미 시작된 앱 세션입니다.", "conflict");
    }
    console.error("[appSession] start insert failed:", error.message);
    throw new AppSessionError("앱 세션 생성에 실패했습니다.", "database_error");
  }

  await Promise.allSettled([
    logBehaviorEvent({
      eventName: "app_session_start",
      actorType: actor.actorType,
      actorId: actor.actorId,
      familyId: actor.familyId,
      childId: actor.childId,
      sessionId,
      feature: "app_session",
      route,
    }),
    logBehaviorEvent({
      eventName: "page_view",
      actorType: actor.actorType,
      actorId: actor.actorId,
      familyId: actor.familyId,
      childId: actor.childId,
      sessionId,
      feature: "app_session",
      route,
    }),
  ]);
}

export async function updateAppSession(
  actor: AppSessionActor,
  sessionId: string,
  action: Exclude<AppSessionAction, "start">,
  route: string,
): Promise<void> {
  const service = createServiceClient();
  const { data: updated, error } = await service.rpc("record_app_session_action", {
    p_session_id: sessionId,
    p_actor_type: actor.actorType,
    p_actor_id: actor.actorId,
    p_action: action,
  });

  if (error) {
    console.error("[appSession] lifecycle update failed:", error.message);
    throw new AppSessionError("앱 세션 갱신에 실패했습니다.", "database_error");
  }
  if (updated !== true) {
    throw new AppSessionError("갱신할 앱 세션이 없습니다.", "not_found");
  }

  if (action === "heartbeat") return;

  await logBehaviorEvent({
    eventName: action === "end" ? "app_session_end" : `app_${action}`,
    actorType: actor.actorType,
    actorId: actor.actorId,
    familyId: actor.familyId,
    childId: actor.childId,
    sessionId,
    feature: "app_session",
    route,
  });
}
