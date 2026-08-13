import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("자유대화 보상 적격성은 기존 서버 RPC에만 위임한다", () => {
  assert.match(source, /\.rpc\("complete_freechat_daily_engagement"/);
  assert.match(source, /p_turn_count:\s*normalizedTurnCount/);
  assert.doesNotMatch(source, /normalizedTurnCount\s*[<>]=?\s*[2360]/);
  assert.doesNotMatch(source, /rewardResult\.meaningful_turn_count\s*[<>]=?/);
});

test("pause 성공 응답은 실제 지급량·활성 잔액·reward type·KST 날짜를 포함한다", () => {
  assert.match(source, /amount:\s*rewardResult\.rewarded \? 1 : 0/);
  assert.match(source, /balance:\s*balanceError \? null : \(activeBalance \?\? 0\)/);
  assert.match(source, /rewardType:\s*FREECHAT_DAILY_REWARD_TYPE/);
  assert.match(source, /businessDate:\s*getKstBusinessDate\(completedAt\)/);
});

test("RPC 및 잔액 조회 실패를 서버 로그에 남긴다", () => {
  assert.match(source, /console\.error\("\[chat\/pause\] complete_freechat_daily_engagement failed"/);
  assert.match(source, /console\.error\("\[chat\/pause\] active Gold Key balance lookup failed"/);
});

test("최초 완료시각을 원자적으로 보존해 자정 경계 재시도도 같은 business date를 사용한다", () => {
  assert.match(source, /\.is\("ended_at", null\)/);
  assert.match(source, /persistedEndedAt = endedSession\?\.ended_at/);
  assert.match(source, /p_completed_at:\s*completedAt\.toISOString\(\)/);
  assert.match(source, /businessDate:\s*getKstBusinessDate\(completedAt\)/);
});

test("service-role 변경 전에 free_chat 세션 유형을 검증한다", () => {
  const typeGuardIndex = source.indexOf('accessibleSession.session_type !== "free_chat"');
  const timestampMutationIndex = source.indexOf('.update({ ended_at: requestedEndedAt })');
  assert.ok(typeGuardIndex >= 0);
  assert.ok(timestampMutationIndex > typeGuardIndex);
});

test("활성 잔액은 과거 완료시각이 아니라 조회 현재시각으로 계산한다", () => {
  assert.match(source, /\.gt\("expires_at", new Date\(\)\.toISOString\(\)\)/);
});
