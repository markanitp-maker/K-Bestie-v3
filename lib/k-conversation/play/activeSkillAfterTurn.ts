import type { PlaySkillId } from "./skillTypes";

/**
 * 013 §3-12 — 클라이언트에 내려보낼 "이 턴이 끝난 뒤" 놀이 상태.
 *
 * 엔진은 턴 시작 시점에 `getActiveSession` 으로 활성 스킬을 정한다. 그건 턴 **시작**
 * 상태라서 두 방향으로 어긋난다.
 *
 * - 이 턴에 게임이 새로 시작되면(아이가 "끝말잇기 하자" 라고 말한 턴) 아직 세션이
 *   없었으므로 null 로 나간다. 클라이언트는 놀이가 켜진 것을 한 턴 늦게 알고,
 *   그래서 **시작 턴에는 키보드 강제가 걸리지 않았다**(2026-08-20 Dev 실측:
 *   `activePlaySkillId=null` 인데 케이는 "좋아, 내가 먼저 시작할게. 새우!" 라고 답했다).
 * - 이 턴에 게임이 끝났으면 세션은 아직 조회 시점에 살아 있었으므로 id 가 남는다.
 *   그러면 클라이언트가 입력 모드를 되돌릴 시점을 놓친다.
 *
 * 그래서 양쪽 다 턴 처리 결과로 덮어쓴다.
 */
export interface ActiveSkillAfterTurnInput {
  /** 턴 시작 시점에 getActiveSession 으로 정한 값. */
  before: PlaySkillId | undefined;
  /** routePlaySkillTurn 결과. 놀이 경로를 타지 않았으면 null. */
  turnResult: {
    handled: boolean;
    ended?: boolean;
    skillId?: PlaySkillId;
  } | null;
}

export interface ActiveSkillAfterTurnResult {
  activePlaySkillId: PlaySkillId | undefined;
  hasActivePlaySession: boolean;
}

export function resolveActiveSkillAfterTurn(
  input: ActiveSkillAfterTurnInput
): ActiveSkillAfterTurnResult {
  const { before, turnResult } = input;

  if (!turnResult) {
    return { activePlaySkillId: before, hasActivePlaySession: Boolean(before) };
  }

  // 종료가 먼저다. 끝났으면 시작 여부와 무관하게 활성 스킬은 없다.
  if (turnResult.ended) {
    return { activePlaySkillId: undefined, hasActivePlaySession: false };
  }

  // 이 턴에 스킬이 처리했고 끝나지 않았으면 그 스킬이 살아 있다 — 새로 시작한
  // 경우도 여기에 걸린다.
  if (turnResult.handled && turnResult.skillId) {
    return { activePlaySkillId: turnResult.skillId, hasActivePlaySession: true };
  }

  return { activePlaySkillId: before, hasActivePlaySession: Boolean(before) };
}
