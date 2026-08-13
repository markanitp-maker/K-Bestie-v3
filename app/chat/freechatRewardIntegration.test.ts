import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

test("pause 실패는 대화를 중단하지 않고 로그와 최대 1회 재시도로 관측한다", () => {
  assert.match(source, /attempt <= 2/);
  assert.match(source, /\[freechat-reward\] pause request failed/);
  assert.match(source, /freechat_reward_request_failed/);
  assert.doesNotMatch(source, /fetch\("\/api\/chat\/pause",[\s\S]{0,300}\.catch\(\(\) => \{\}\)/);
});

test("서버가 실제 지급했다고 응답한 경우에만 보상 모달 상태를 설정한다", () => {
  assert.match(source, /parseFreechatPauseSuccess\(await response\.json\(\)\)/);
  assert.match(source, /if \(getFreechatRewardModalContent\(parsed\.reward\)\) \{\s*setDailyReward\(parsed\.reward\)/);
  assert.match(source, /idPrefix="freechat-daily-reward"/);
});

test("동일 mount에서는 같은 종료 session의 pause 요청을 한 번만 시작한다", () => {
  assert.match(source, /rewardRequestSessionsRef\.current\.has\(sessionId\)/);
  assert.match(source, /rewardRequestSessionsRef\.current\.add\(sessionId\)/);
});

test("종료 보상 판정 전에 pending message writes가 모두 정착된다", () => {
  assert.match(source, /pendingMessageWritesRef\.current\.add\(pendingWrite\)/);
  assert.match(source, /while \(pendingMessageWritesRef\.current\.size > 0\)/);
  assert.match(source, /await Promise\.allSettled\(Array\.from\(pendingMessageWritesRef\.current\)\)/);
});
