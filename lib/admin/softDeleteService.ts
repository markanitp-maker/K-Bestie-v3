import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 관리자 "운영 요청 데이터" 소프트 삭제 공통 레이어 (requests/066)
 *
 * ── 안전 경계 (절대 규칙) ────────────────────────────────────────────────
 * 삭제 대상은 아래 SOFT_DELETE_RESOURCES 화이트리스트에 있는 "관리자 운영 요청 /
 * 처리 이력" 테이블 뿐이다. 호출자가 넘긴 문자열로 테이블명을 조립하지 않고,
 * 반드시 이 파일의 상수 테이블에서 꺼낸 값만 쿼리에 쓴다(범용 삭제 API 금지).
 *
 * 이 레이어를 통해서도 절대 삭제되지 않는 것 —
 *   부모/아이/가족/인증 계정(parents, child_profiles, families, family_members,
 *   member_accounts, auth.users), 대화 원본·보정 대화(chat_sessions,
 *   chat_messages, context_correction*), 미션(mission_*), 자유대화(free_chat*),
 *   리포트(daily_reports, weekly_*), 리텐션 원천 데이터, LLM Wiki/Memory
 *   (memory_facts 등), 황금열쇠 원장(gold_key_ledger), 결제 원장,
 *   서비스 핵심 이벤트 원장(app_events 등).
 * 위 테이블들은 이 파일 어디에서도 참조되지 않으며, 새 리소스를 추가할 때도
 * 추가해서는 안 된다.
 *
 * ── 감사 로그 개인정보 원칙 ─────────────────────────────────────────────
 * 스냅샷에는 각 리소스의 snapshotColumns(식별·상태용 최소 컬럼)만 담는다.
 * 자유 서술 원문(support_requests.body/subject), 설문 원문(beta_applications.answers),
 * 자격증명(child_approval_requests.encrypted_password) 등은 스냅샷에서 제외한다.
 * 대화 원문은 애초에 대상 테이블에 존재하지 않는다.
 */

/** 삭제 후 복구 가능 기간(일). 이 기간이 지나면 cron이 영구 삭제한다. */
export const SOFT_DELETE_RETENTION_DAYS = 30;

/** 한 번의 bulk 요청에서 처리할 수 있는 최대 건수. */
export const SOFT_DELETE_MAX_BULK = 200;

export type SoftDeleteResource =
  | "beta_applications"
  | "support_requests"
  | "plan_change_requests"
  | "child_approval_requests"
  | "event_reward_fulfillments";

export interface SoftDeleteResourceConfig {
  /** 실제 테이블명. 요청 값이 아니라 이 상수만 쿼리에 사용한다. */
  table: string;
  /** 관리자 UI에 노출할 한국어 라벨. */
  label: string;
  /**
   * 휴지통 목록·감사 로그 스냅샷에 담아도 안전한 컬럼.
   * 자유 서술 원문/설문 원문/자격증명/연락처는 의도적으로 제외한다.
   */
  snapshotColumns: string[];
  /** 목록 정렬·"등록일" 표기에 쓰는 컬럼. */
  createdAtColumn: string;
  /** 원래 상태 표기에 쓰는 컬럼(없으면 null). */
  statusColumn: string | null;
  /** 휴지통에서 "무엇인지" 알아볼 수 있게 이어 붙일 컬럼들. */
  titleColumns: string[];
}

export const SOFT_DELETE_RESOURCES: Record<SoftDeleteResource, SoftDeleteResourceConfig> = {
  beta_applications: {
    table: "beta_applications",
    label: "베타 신청",
    // answers(설문 원문·연락처)는 제외.
    snapshotColumns: ["id", "user_id", "applied_at", "reviewed_at", "created_at"],
    createdAtColumn: "created_at",
    statusColumn: null,
    titleColumns: ["user_id"],
  },
  support_requests: {
    table: "support_requests",
    label: "문의·건의·버그",
    // subject/body(사용자 작성 원문)는 제외.
    snapshotColumns: ["id", "request_number", "category", "status", "submitter_role", "created_at"],
    createdAtColumn: "created_at",
    statusColumn: "status",
    titleColumns: ["request_number", "category"],
  },
  plan_change_requests: {
    table: "plan_change_requests",
    label: "요금제 변경 요청",
    snapshotColumns: ["id", "parent_user_id", "child_id", "requested_tier", "status", "requested_at", "created_at"],
    createdAtColumn: "created_at",
    statusColumn: "status",
    titleColumns: ["requested_tier", "status"],
  },
  child_approval_requests: {
    table: "child_approval_requests",
    label: "아이 승인 요청",
    // encrypted_password는 절대 스냅샷에 담지 않는다.
    snapshotColumns: ["id", "family_id", "username", "grade", "status", "requested_at", "created_at"],
    createdAtColumn: "created_at",
    statusColumn: "status",
    titleColumns: ["username", "status"],
  },
  event_reward_fulfillments: {
    table: "event_reward_fulfillments",
    label: "이벤트·상품권 지급 이력",
    snapshotColumns: ["id", "event_type", "child_id", "reward_amount", "reward_type", "status", "created_at"],
    createdAtColumn: "created_at",
    statusColumn: "status",
    titleColumns: ["event_type", "status"],
  },
};

export const SOFT_DELETE_RESOURCE_IDS = Object.keys(SOFT_DELETE_RESOURCES) as SoftDeleteResource[];

export function isSoftDeleteResource(value: unknown): value is SoftDeleteResource {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SOFT_DELETE_RESOURCES, value);
}

/** 화이트리스트에 없는 리소스면 throw. 테이블명이 요청 값에서 새어 들어오는 것을 막는 관문. */
export function requireSoftDeleteResource(value: unknown): SoftDeleteResource {
  if (!isSoftDeleteResource(value)) {
    throw new SoftDeleteError(`허용되지 않은 리소스입니다: ${String(value)}`, 400);
  }
  return value;
}

export class SoftDeleteError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "SoftDeleteError";
    this.status = status;
  }
}

/** 삭제 사유 필수 검증 + 정규화. */
export function normalizeDeleteReason(reason: unknown): string {
  const trimmed = typeof reason === "string" ? reason.trim() : "";
  if (!trimmed) {
    throw new SoftDeleteError("삭제 사유는 필수입니다.", 400);
  }
  if (trimmed.length > 500) {
    throw new SoftDeleteError("삭제 사유는 500자 이하로 입력하세요.", 400);
  }
  return trimmed;
}

/** bulk id 배열 검증 + 정규화(중복 제거, 최대 건수 제한). */
export function normalizeIds(ids: unknown): string[] {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new SoftDeleteError("대상 id가 필요합니다.", 400);
  }
  const unique = Array.from(
    new Set(ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0).map((id) => id.trim()))
  );
  if (unique.length === 0) {
    throw new SoftDeleteError("대상 id가 필요합니다.", 400);
  }
  if (unique.length > SOFT_DELETE_MAX_BULK) {
    throw new SoftDeleteError(`한 번에 최대 ${SOFT_DELETE_MAX_BULK}건까지 처리할 수 있습니다.`, 400);
  }
  return unique;
}

/**
 * 목록 조회에서 삭제된 행을 제외한다. 관리자 목록/통계/검색/다운로드가 전부 이 헬퍼를
 * 거치게 해서 `deleted_at is null` 누락을 막는다.
 */
export function excludeDeleted<T extends { is: (column: string, value: null) => T }>(query: T): T {
  return query.is("deleted_at", null);
}

/** snapshotColumns에 있는 컬럼만 남긴다(개인정보·원문 유출 방지). */
export function sanitizeSnapshot(
  resource: SoftDeleteResource,
  row: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!row) return null;
  const { snapshotColumns } = SOFT_DELETE_RESOURCES[resource];
  const out: Record<string, unknown> = {};
  for (const column of snapshotColumns) {
    if (column in row) out[column] = row[column];
  }
  return out;
}

/** 영구 삭제 예정일 = deleted_at + 보관일수. */
export function permanentDeleteAt(deletedAt: string, retentionDays = SOFT_DELETE_RETENTION_DAYS): Date {
  return new Date(new Date(deletedAt).getTime() + retentionDays * 24 * 60 * 60 * 1000);
}

/** 남은 복구 가능 일수(0 미만이면 0). */
export function remainingRestoreDays(
  deletedAt: string,
  now: Date = new Date(),
  retentionDays = SOFT_DELETE_RETENTION_DAYS
): number {
  const diffMs = permanentDeleteAt(deletedAt, retentionDays).getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
}

/** 영구 삭제 기준 시각(now - 보관일수). */
export function purgeCutoff(now: Date = new Date(), retentionDays = SOFT_DELETE_RETENTION_DAYS): Date {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}

export interface SoftDeleteActor {
  id: string | null;
  email: string;
  /** "admin_ui" | "cron" 등 감사 로그 source. */
  source: string;
  requestId?: string | null;
}

export interface BulkResult {
  /** 이번 요청으로 실제 상태가 바뀐 id. */
  changed: string[];
  /** 이미 그 상태였거나 대상이 없어 변화가 없던 id(멱등 처리). */
  unchanged: string[];
  /** 오류가 난 id. */
  failed: { id: string; error: string }[];
}

type Service = SupabaseClient<any, any, any>;

/**
 * 소프트 삭제. 이미 삭제된 행은 건드리지 않고 unchanged로 분류한다(멱등).
 * 대상 행이 없으면(존재하지 않는 id) 역시 unchanged — 존재 여부를 알려주지 않는다.
 */
export async function softDeleteRecords(
  service: Service,
  resource: SoftDeleteResource,
  ids: string[],
  actor: SoftDeleteActor,
  reason: string
): Promise<BulkResult> {
  const config = SOFT_DELETE_RESOURCES[resource];
  const targetIds = normalizeIds(ids);
  const normalizedReason = normalizeDeleteReason(reason);

  // 감사 로그 before 스냅샷 확보(삭제되지 않은 행만).
  const { data: beforeRows, error: beforeError } = await service
    .from(config.table)
    .select(config.snapshotColumns.join(", "))
    .in("id", targetIds)
    .is("deleted_at", null);
  if (beforeError) throw new SoftDeleteError(beforeError.message, 500);

  const beforeById = new Map<string, Record<string, unknown>>(
    ((beforeRows ?? []) as unknown as Record<string, unknown>[]).map((row) => [String(row.id), row])
  );

  if (beforeById.size === 0) {
    return { changed: [], unchanged: targetIds, failed: [] };
  }

  const deletedAt = new Date().toISOString();
  const { data: updated, error: updateError } = await service
    .from(config.table)
    .update({ deleted_at: deletedAt, deleted_by: actor.id, delete_reason: normalizedReason })
    .in("id", Array.from(beforeById.keys()))
    .is("deleted_at", null)
    .select("id");
  if (updateError) throw new SoftDeleteError(updateError.message, 500);

  const changed = ((updated ?? []) as { id: string }[]).map((row) => String(row.id));
  const changedSet = new Set(changed);

  await Promise.allSettled(
    changed.map((id) =>
      logAdminAudit(service, {
        action: changed.length > 1 ? "BULK_SOFT_DELETE" : "SOFT_DELETE",
        resourceType: resource,
        resourceId: id,
        actor,
        reason: normalizedReason,
        beforeSnapshot: sanitizeSnapshot(resource, beforeById.get(id)),
        afterSnapshot: { ...sanitizeSnapshot(resource, beforeById.get(id)), deleted_at: deletedAt },
      })
    )
  );

  return {
    changed,
    unchanged: targetIds.filter((id) => !changedSet.has(id)),
    failed: [],
  };
}

/**
 * 복구. 삭제 상태가 아니면 unchanged로 분류한다(중복 복구 멱등).
 * 보관 기간이 지난 행도 아직 영구 삭제 전이면 복구 가능하게 둔다(운영 실수 구제).
 */
export async function restoreRecords(
  service: Service,
  resource: SoftDeleteResource,
  ids: string[],
  actor: SoftDeleteActor
): Promise<BulkResult> {
  const config = SOFT_DELETE_RESOURCES[resource];
  const targetIds = normalizeIds(ids);

  const { data: beforeRows, error: beforeError } = await service
    .from(config.table)
    .select(config.snapshotColumns.join(", "))
    .in("id", targetIds)
    .not("deleted_at", "is", null);
  if (beforeError) throw new SoftDeleteError(beforeError.message, 500);

  const beforeById = new Map<string, Record<string, unknown>>(
    ((beforeRows ?? []) as unknown as Record<string, unknown>[]).map((row) => [String(row.id), row])
  );

  if (beforeById.size === 0) {
    return { changed: [], unchanged: targetIds, failed: [] };
  }

  const { data: updated, error: updateError } = await service
    .from(config.table)
    .update({ deleted_at: null, deleted_by: null, delete_reason: null })
    .in("id", Array.from(beforeById.keys()))
    .not("deleted_at", "is", null)
    .select("id");
  if (updateError) throw new SoftDeleteError(updateError.message, 500);

  const changed = ((updated ?? []) as { id: string }[]).map((row) => String(row.id));
  const changedSet = new Set(changed);

  await Promise.allSettled(
    changed.map((id) =>
      logAdminAudit(service, {
        action: changed.length > 1 ? "BULK_RESTORE" : "RESTORE",
        resourceType: resource,
        resourceId: id,
        actor,
        reason: null,
        beforeSnapshot: sanitizeSnapshot(resource, beforeById.get(id)),
        afterSnapshot: { ...sanitizeSnapshot(resource, beforeById.get(id)), deleted_at: null },
      })
    )
  );

  return {
    changed,
    unchanged: targetIds.filter((id) => !changedSet.has(id)),
    failed: [],
  };
}

export interface TrashItem {
  resource: SoftDeleteResource;
  resourceLabel: string;
  id: string;
  title: string;
  originalStatus: string | null;
  createdAt: string | null;
  deletedAt: string;
  deletedBy: string | null;
  deletedByEmail: string | null;
  deleteReason: string | null;
  permanentDeleteAt: string;
  remainingDays: number;
}

export interface TrashQuery {
  resources?: SoftDeleteResource[];
  deletedFrom?: string | null;
  deletedTo?: string | null;
  deletedBy?: string | null;
  reasonSearch?: string | null;
  limit?: number;
}

function buildTitle(config: SoftDeleteResourceConfig, row: Record<string, unknown>): string {
  const parts = config.titleColumns
    .map((column) => row[column])
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map((value) => String(value));
  return parts.length > 0 ? parts.join(" · ") : String(row.id ?? "");
}

/** 휴지통 통합 조회. 화이트리스트 리소스만 순회한다. */
export async function listTrash(service: Service, query: TrashQuery = {}): Promise<TrashItem[]> {
  const resources = (query.resources && query.resources.length > 0 ? query.resources : SOFT_DELETE_RESOURCE_IDS).filter(
    isSoftDeleteResource
  );
  const limit = Math.min(Math.max(query.limit ?? 200, 1), 500);
  const now = new Date();

  const settled = await Promise.allSettled(
    resources.map(async (resource) => {
      const config = SOFT_DELETE_RESOURCES[resource];
      const columns = Array.from(
        new Set([...config.snapshotColumns, "deleted_at", "deleted_by", "delete_reason", config.createdAtColumn])
      );

      let q = service
        .from(config.table)
        .select(columns.join(", "))
        .not("deleted_at", "is", null)
        .order("deleted_at", { ascending: false })
        .limit(limit);

      if (query.deletedFrom) q = q.gte("deleted_at", query.deletedFrom);
      if (query.deletedTo) q = q.lte("deleted_at", query.deletedTo);
      if (query.deletedBy) q = q.eq("deleted_by", query.deletedBy);
      if (query.reasonSearch) q = q.ilike("delete_reason", `%${query.reasonSearch}%`);

      const { data, error } = await q;
      if (error) throw new SoftDeleteError(error.message, 500);

      return ((data ?? []) as unknown as Record<string, unknown>[]).map((row): TrashItem => {
        const deletedAt = String(row.deleted_at);
        return {
          resource,
          resourceLabel: config.label,
          id: String(row.id),
          title: buildTitle(config, row),
          originalStatus: config.statusColumn ? ((row[config.statusColumn] as string) ?? null) : null,
          createdAt: (row[config.createdAtColumn] as string) ?? null,
          deletedAt,
          deletedBy: (row.deleted_by as string) ?? null,
          deletedByEmail: null,
          deleteReason: (row.delete_reason as string) ?? null,
          permanentDeleteAt: permanentDeleteAt(deletedAt).toISOString(),
          remainingDays: remainingRestoreDays(deletedAt, now),
        };
      });
    })
  );

  const items: TrashItem[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") items.push(...result.value);
    else console.error("[softDeleteService] listTrash partial failure:", result.reason);
  }

  // 삭제자 이메일 보강(감사 로그에서 조회 — parents 테이블은 건드리지 않는다).
  const adminIds = Array.from(new Set(items.map((i) => i.deletedBy).filter((v): v is string => !!v)));
  if (adminIds.length > 0) {
    const { data: audits } = await service
      .from("admin_audit_log")
      .select("admin_user_id, admin_email")
      .in("admin_user_id", adminIds);
    const emailById = new Map(
      ((audits ?? []) as { admin_user_id: string; admin_email: string }[]).map((a) => [a.admin_user_id, a.admin_email])
    );
    for (const item of items) {
      if (item.deletedBy) item.deletedByEmail = emailById.get(item.deletedBy) ?? null;
    }
  }

  return items.sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1));
}

export interface PurgeResult {
  resource: SoftDeleteResource;
  purged: number;
  attachmentsDeleted: number;
  errors: string[];
}

/**
 * 보관 기간이 지난 소프트 삭제 행을 영구 삭제한다.
 *
 * 순서(첨부/Storage 불일치 방지): 대상 검증 → 첨부 Storage 파일 삭제 → DB 물리 삭제
 * → 감사 로그 기록. 첨부 삭제가 실패하면 그 행의 DB 삭제를 건너뛰고 다음 실행에서
 * 재시도한다(고아 Storage 파일을 만들지 않는다). 감사 로그 자체는 삭제하지 않는다.
 */
export async function purgeExpired(
  service: Service,
  actor: SoftDeleteActor,
  options: { now?: Date; retentionDays?: number; limitPerResource?: number } = {}
): Promise<PurgeResult[]> {
  const now = options.now ?? new Date();
  const retentionDays = options.retentionDays ?? SOFT_DELETE_RETENTION_DAYS;
  const limitPerResource = Math.min(Math.max(options.limitPerResource ?? 200, 1), 500);
  const cutoff = purgeCutoff(now, retentionDays).toISOString();

  const results: PurgeResult[] = [];

  for (const resource of SOFT_DELETE_RESOURCE_IDS) {
    const config = SOFT_DELETE_RESOURCES[resource];
    const result: PurgeResult = { resource, purged: 0, attachmentsDeleted: 0, errors: [] };

    try {
      const { data: rows, error } = await service
        .from(config.table)
        .select(config.snapshotColumns.join(", "))
        .not("deleted_at", "is", null)
        .lt("deleted_at", cutoff)
        .limit(limitPerResource);
      if (error) throw new SoftDeleteError(error.message, 500);

      const targets = (rows ?? []) as unknown as Record<string, unknown>[];
      if (targets.length === 0) {
        results.push(result);
        continue;
      }

      let purgeableIds = targets.map((row) => String(row.id));

      // 첨부파일이 있는 리소스는 Storage 파일을 먼저 지운다.
      if (resource === "support_requests") {
        const { removed, blockedIds, errors } = await purgeSupportAttachments(service, purgeableIds);
        result.attachmentsDeleted = removed;
        result.errors.push(...errors);
        if (blockedIds.length > 0) {
          const blocked = new Set(blockedIds);
          purgeableIds = purgeableIds.filter((id) => !blocked.has(id));
        }
      }

      if (purgeableIds.length === 0) {
        results.push(result);
        continue;
      }

      const { error: deleteError } = await service.from(config.table).delete().in("id", purgeableIds);
      if (deleteError) throw new SoftDeleteError(deleteError.message, 500);

      result.purged = purgeableIds.length;

      const snapshotById = new Map(targets.map((row) => [String(row.id), row]));
      await Promise.allSettled(
        purgeableIds.map((id) =>
          logAdminAudit(service, {
            action: "PERMANENT_DELETE",
            resourceType: resource,
            resourceId: id,
            actor,
            reason: `${retentionDays}일 보관 기간 경과 자동 영구 삭제`,
            beforeSnapshot: sanitizeSnapshot(resource, snapshotById.get(id)),
            afterSnapshot: null,
          })
        )
      );
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err));
    }

    results.push(result);
  }

  return results;
}

/**
 * support_requests 영구 삭제 전, 첨부 Storage 오브젝트를 먼저 제거한다.
 * DB 행은 FK CASCADE로 함께 지워지므로 Storage 파일이 먼저 사라져야 고아가 생기지 않는다.
 */
async function purgeSupportAttachments(
  service: Service,
  supportRequestIds: string[]
): Promise<{ removed: number; blockedIds: string[]; errors: string[] }> {
  const errors: string[] = [];
  const { data: attachments, error } = await service
    .from("feedback_request_attachments")
    .select("id, feedback_request_id, storage_bucket, storage_path")
    .in("feedback_request_id", supportRequestIds);

  if (error) {
    return { removed: 0, blockedIds: supportRequestIds, errors: [`첨부 조회 실패: ${error.message}`] };
  }

  const rows = (attachments ?? []) as {
    feedback_request_id: string;
    storage_bucket: string | null;
    storage_path: string | null;
  }[];
  if (rows.length === 0) return { removed: 0, blockedIds: [], errors };

  const byBucket = new Map<string, { path: string; requestId: string }[]>();
  for (const row of rows) {
    if (!row.storage_path) continue;
    const bucket = row.storage_bucket || "feedback-attachments";
    const list = byBucket.get(bucket) ?? [];
    list.push({ path: row.storage_path, requestId: row.feedback_request_id });
    byBucket.set(bucket, list);
  }

  let removed = 0;
  const blocked = new Set<string>();

  for (const [bucket, entries] of byBucket) {
    const { error: removeError } = await service.storage.from(bucket).remove(entries.map((e) => e.path));
    if (removeError) {
      errors.push(`Storage 삭제 실패(${bucket}): ${removeError.message}`);
      for (const entry of entries) blocked.add(entry.requestId);
    } else {
      removed += entries.length;
    }
  }

  return { removed, blockedIds: Array.from(blocked), errors };
}

export interface AuditEntry {
  action: string;
  resourceType: string;
  resourceId: string | null;
  actor: SoftDeleteActor;
  reason: string | null;
  beforeSnapshot: Record<string, unknown> | null;
  afterSnapshot: Record<string, unknown> | null;
}

/**
 * 감사 로그 기록. 실패해도 본 작업을 되돌리지 않고 로그만 남긴다(감사 실패로
 * 삭제/복구가 롤백되면 오히려 운영이 막힌다).
 */
export async function logAdminAudit(service: Service, entry: AuditEntry): Promise<void> {
  const { error } = await service.from("admin_audit_log").insert({
    admin_user_id: entry.actor.id,
    admin_email: entry.actor.email,
    action: entry.action,
    reason: entry.reason,
    resource_type: entry.resourceType,
    resource_id: entry.resourceId,
    before_snapshot: entry.beforeSnapshot,
    after_snapshot: entry.afterSnapshot,
    request_id: entry.actor.requestId ?? null,
    source: entry.actor.source,
  });
  if (error) {
    console.error("[softDeleteService] 감사 로그 기록 실패:", {
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      error: error.message,
    });
  }
}
