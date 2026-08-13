import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

test("pause 실패는 대화를 중단하지 않고 로그와 최대 1회 재시도로 관측한다", () => {
  assert.match(source, /attempt <= 2/);
  assert.match(source, /window\.setTimeout\(\(\) => abortController\.abort\(\), 8000\)/);
  assert.match(source, /window\.clearTimeout\(timeoutId\)/);
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
  assert.match(source, /Promise\.allSettled\(pendingWrites\)/);
  assert.match(source, /then\(\(\) => "settled" as const\)/);
  assert.match(source, /resolve\("timeout"\)/);
  assert.match(source, /if \(waitResult === "timeout"\)/);
  assert.match(source, /pending message writes timed out/);
});

test("대화 중 홈 이동은 보상 판정과 획득 모달 처리가 끝날 때까지 지연한다", () => {
  assert.match(source, /exitAfterRewardRef\.current = true;\s*stopSession\(\)/);
  assert.match(source, /if \(getFreechatRewardModalContent\(parsed\.reward\)\) \{\s*setDailyReward\(parsed\.reward\);\s*\} else \{\s*finishPendingExit\(\)/);
  assert.match(source, /onClose=\{handleCloseDailyReward\}/);
});

test("cooldown과 daily-limit early return에서도 획득 모달을 렌더한다", () => {
  const modalRenderCount = source.match(/\{dailyRewardModal\}/g)?.length ?? 0;
  assert.ok(modalRenderCount >= 4);
});

test("live 상태에 sessionId가 없으면 보상 대기 없이 홈으로 이동한다", () => {
  assert.match(source, /if \(!sessionId\) \{\s*stopSession\(\);\s*setSessionActive\(false\);\s*router\.replace\("\/child\/home"\)/);
});
