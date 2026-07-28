// 진행/완료/닫기/오류 4개 내부 API가 공유하는 처리 골격 (딥 인터뷰 ④, Round 8-3).
//
// 공통 세션 봉투(playSessionId, playId, childId, status, currentStep, totalSteps,
// startedAt, updatedAt, expiresAt, payloadVersion)만 플랫폼이 이해하고, MBTI 고유
// opaquePayload는 해석하지 않고 k_play_sessions.progress_state.opaquePayload에 그대로
// 저장·반환한다. revision/sequence로 역순 갱신을 막는다.

import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyInternalPlayRequest } from "@/lib/play/internalApiAuth";
import {
  findIdempotentResponse,
  recordIdempotentResponse,
  type InternalEventType,
} from "@/lib/play/internalEventIdempotency";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * opaquePayload 병합. progress(마지막 문항 저장)와 complete(완료 통지) 호출은 서로 다른
 * 부분 키 집합만 보내며 클라이언트에서 사실상 동시에(fire-and-forget) 발사될 수 있어
 * 두 요청의 DB 쓰기 순서가 보장되지 않는다. 완전 교체 대신 두 값이 모두 객체일 때만
 * 얕은 병합해, 어느 쪽이 나중에 반영되든 다른 쪽이 저장한 키를 잃지 않는다.
 */
export function mergeOpaquePayload(existing: unknown, incoming: unknown): unknown {
  if (isPlainObject(existing) && isPlainObject(incoming)) {
    return { ...existing, ...incoming };
  }
  return incoming ?? existing;
}

export interface CommonEnvelopeInput {
  playSessionId?: string;
  currentStep?: number;
  totalSteps?: number;
  payloadVersion?: number;
  revision?: number;
  opaquePayload?: unknown;
}

interface StoredProgressState {
  opaquePayload?: unknown;
  payloadVersion?: number;
  revision?: number;
  currentStep?: number;
  totalSteps?: number;
}

/**
 * 공통 처리: 인증 → idempotency 조회 → playSessionId 소유권(play_type) 확인 →
 * 콜백(`mutate`)으로 실제 상태 갱신 → idempotency 기록. `mutate`는 새 status(있으면)와
 * 응답 JSON을 반환한다.
 */
export async function handleInternalPlayEvent(
  req: NextRequest,
  eventType: InternalEventType,
  mutate: (session: { id: string; progressState: StoredProgressState }, body: CommonEnvelopeInput) => Promise<{
    newStatus?: "in_progress" | "completed" | "expired" | "refunded";
    newProgressState?: StoredProgressState;
    responseBody: Record<string, unknown>;
  }>,
): Promise<NextResponse> {
  const auth = verifyInternalPlayRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  const idempotencyKey = req.headers.get("idempotency-key") ?? "";
  if (!idempotencyKey) {
    return NextResponse.json({ error: "missing_idempotency_key" }, { status: 400 });
  }

  const cached = await findIdempotentResponse(idempotencyKey);
  if (cached !== null) {
    return NextResponse.json(cached as Record<string, unknown>);
  }

  let body: CommonEnvelopeInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const playSessionId = typeof body.playSessionId === "string" ? body.playSessionId : "";
  if (!playSessionId) {
    return NextResponse.json({ error: "playSessionId required" }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: sessionRow, error: sessionErr } = await service
    .from("k_play_sessions")
    .select("id, play_type, progress_state")
    .eq("id", playSessionId)
    .maybeSingle();

  if (sessionErr || !sessionRow) {
    return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  }

  if (sessionRow.play_type !== auth.playId) {
    // 이 서버 자격증명(playId)이 발급한 세션이 아님 — 다른 놀이 프로젝트가 남의
    // playSessionId를 도용해 호출하는 경로를 차단.
    return NextResponse.json({ error: "play_id_mismatch" }, { status: 403 });
  }

  const currentProgressState = (sessionRow.progress_state ?? {}) as StoredProgressState;

  // revision/sequence 역순 갱신 방지: 새로 들어온 revision이 저장된 값보다 작거나
  // 같으면(같은 값 재전송은 idempotencyKey가 이미 처리하므로 여기 도달 안 함이 정상,
  // 방어적으로만 체크) 거부한다.
  if (
    typeof body.revision === "number" &&
    typeof currentProgressState.revision === "number" &&
    body.revision <= currentProgressState.revision
  ) {
    const responseBody = { error: "stale_revision" };
    await recordIdempotentResponse(idempotencyKey, playSessionId, eventType, responseBody);
    return NextResponse.json(responseBody, { status: 409 });
  }

  const mutation = await mutate({ id: sessionRow.id, progressState: currentProgressState }, body);

  const updatePayload: Record<string, unknown> = {};
  if (mutation.newProgressState) {
    updatePayload.progress_state = mutation.newProgressState;
  }
  if (mutation.newStatus) {
    updatePayload.status = mutation.newStatus;
    if (mutation.newStatus === "completed") {
      updatePayload.completed_at = new Date().toISOString();
    }
  }

  if (Object.keys(updatePayload).length > 0) {
    const { error: updateErr } = await service
      .from("k_play_sessions")
      .update(updatePayload)
      .eq("id", playSessionId);

    if (updateErr) {
      console.error(`[internal/${eventType}] k_play_sessions 갱신 실패:`, updateErr, { playSessionId });
      return NextResponse.json({ error: "update_failed" }, { status: 500 });
    }
  }

  await recordIdempotentResponse(idempotencyKey, playSessionId, eventType, mutation.responseBody);
  return NextResponse.json(mutation.responseBody);
}
