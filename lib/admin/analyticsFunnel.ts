import { rate } from "@/lib/admin/analytics";

export interface FunnelStep {
  key: string;
  label: string;
  target: number;
  completed: number;
  failed: number;
  completionRate: number | null;
}

export interface BehaviorFunnelInput {
  eligibleUnits: number;
  loginUnits: number;
  totalChildren: number;
  missionStartChildIds: Set<string>;
  missionCompletedChildIds: Set<string>;
  socialChildIds: Set<string>;
}

export interface PipelineFunnelInput {
  allTargetKeys: Set<string>;
  rawKeys: Set<string>;
  correctionSuccessKeys: Set<string>;
  memorySuccessKeys: Set<string>;
  reportSuccessKeys: Set<string>;
  generatedReportIds: Set<string>;
  viewedReportIds: Set<string>;
}

/**
 * 사용자 행동 퍼널 (고유 사용자·아이 단위)
 * 1) access: 활성 사용자
 * 2) mission_start: 미션 시작 아이 (고유 child)
 * 3) mission_complete: 미션 완료 아이 (고유 child, mission_start의 subset)
 * 4) social: 자유대화/놀이 활동 아이 (고유 child)
 */
export function buildBehaviorFunnel(input: BehaviorFunnelInput): FunnelStep[] {
  const missionStartCount = input.missionStartChildIds.size;
  // 미션 완료 아이는 미션 시작 아이 집합 안에서만 센다
  const missionCompletedCount = [...input.missionCompletedChildIds].filter((id) =>
    input.missionStartChildIds.has(id)
  ).length;
  const socialCount = input.socialChildIds.size;

  const rows = [
    { key: "access", label: "접속", target: input.eligibleUnits, completed: input.loginUnits },
    { key: "mission_start", label: "미션 시작", target: input.totalChildren, completed: missionStartCount },
    { key: "mission_complete", label: "미션 완료", target: missionStartCount, completed: missionCompletedCount },
    { key: "social", label: "자유대화/놀이 활동", target: input.totalChildren, completed: socialCount },
  ];

  return rows.map((row) => ({
    ...row,
    failed: Math.max(0, row.target - row.completed),
    completionRate: rate(row.completed, row.target),
  }));
}

/**
 * 리포팅 파이프라인 퍼널 ((child_id, business_date) 슬롯 / 리포트 ID 단위)
 * 1) collection: 대화 수집 (allTargetKeys 중 수집된 rawKeys)
 * 2) correction: 보정 완료 (rawKeys 중 보정 성공한 슬롯)
 * 3) memory: Memory Batch 완료 (보정 성공 슬롯 중 memory 성공한 슬롯)
 * 4) report: 리포트 생성 (memory 성공 슬롯 중 리포트 생성된 슬롯)
 * 5) report_view: 부모 리포트 확인 (생성된 고유 리포트 중 열람된 고유 리포트)
 */
export function buildPipelineFunnel(input: PipelineFunnelInput): FunnelStep[] {
  const collectionTarget = input.allTargetKeys.size;
  const collectionCompleted = [...input.rawKeys].filter((k) => input.allTargetKeys.has(k)).length;

  const correctionTarget = collectionCompleted;
  const correctionCompleted = [...input.correctionSuccessKeys].filter((k) => input.rawKeys.has(k)).length;

  const memoryTarget = correctionCompleted;
  const memoryCompleted = [...input.memorySuccessKeys].filter(
    (k) => input.rawKeys.has(k) && input.correctionSuccessKeys.has(k)
  ).length;

  const reportTarget = memoryCompleted;
  const reportCompleted = [...input.reportSuccessKeys].filter(
    (k) => input.rawKeys.has(k) && input.correctionSuccessKeys.has(k) && input.memorySuccessKeys.has(k)
  ).length;

  const reportViewTarget = input.generatedReportIds.size;
  const reportViewCompleted = [...input.viewedReportIds].filter((id) => input.generatedReportIds.has(id)).length;

  const rows = [
    { key: "collection", label: "대화 수집", target: collectionTarget, completed: collectionCompleted },
    { key: "correction", label: "보정 완료", target: correctionTarget, completed: correctionCompleted },
    { key: "memory", label: "Memory Batch 완료", target: memoryTarget, completed: memoryCompleted },
    { key: "report", label: "리포트 생성", target: reportTarget, completed: reportCompleted },
    { key: "report_view", label: "부모 리포트 확인", target: reportViewTarget, completed: reportViewCompleted },
  ];

  return rows.map((row) => ({
    ...row,
    failed: Math.max(0, row.target - row.completed),
    completionRate: rate(row.completed, row.target),
  }));
}
