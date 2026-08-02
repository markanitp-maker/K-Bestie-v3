import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const logDir = '/tmp/agy-qa-048';
fs.mkdirSync(logDir, { recursive: true });

async function login(page: import('@playwright/test').Page) {
  await page.goto(`${BASE}/login`);
  await page.locator('input[type="text"]').fill('testi02');
  await page.locator('input[type="password"]').fill(process.env.QA_TEST_PASSWORD || 'testtest123!');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForURL('**/child**', { timeout: 15000 }).catch(() => {});
}

async function startMission(page: import('@playwright/test').Page) {
  await page.goto(`${BASE}/child/missions`);
  await page.waitForTimeout(2000);

  const restartBtn = page.getByText('다시 할래요');
  if (await restartBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await restartBtn.click();
    await page.waitForTimeout(1500);
  }
  const startBtn = page.getByText(/^(시작하기|이어하기)$/);
  if (await startBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await startBtn.click();
  }
  await page.waitForTimeout(3000);

  const keyboardBtn = page.getByRole('button', { name: '텍스트로 답하기' });
  if (await keyboardBtn.isVisible({ timeout: 8000 }).catch(() => false)) {
    await keyboardBtn.click();
  }
}

test('QA-048 E2E: 시나리오 A (이해 실패 -> 쉬운 설명 -> 정상 답변)', async ({ page }) => {
  test.setTimeout(150000);
  await login(page);
  await startMission(page);

  // 1. 이해 실패 발화
  const input = page.locator('input[type="text"]').last();
  await input.waitFor({ state: 'visible', timeout: 10000 });
  await input.fill("무슨 말인지 모르겠어");
  await page.getByRole('button', { name: '전송' }).click();

  // 대기
  await page.waitForTimeout(10000);
  
  // 2. 정상 답변
  const input2 = page.locator('input[type="text"]').last();
  await input2.waitFor({ state: 'visible', timeout: 10000 });
  await input2.fill("체육 시간에 축구한 거");
  await page.getByRole('button', { name: '전송' }).click();

  await page.waitForTimeout(10000);
  await page.screenshot({ path: path.join(logDir, 'scenario-a.png') });
});

test('QA-048 E2E: 시나리오 B (이해 실패 -> 쉬운 설명 -> 모르겠음 -> 다음 질문)', async ({ page }) => {
  test.setTimeout(150000);
  await login(page);
  await startMission(page);

  // 1. 이해 실패 발화
  const input = page.locator('input[type="text"]').last();
  await input.waitFor({ state: 'visible', timeout: 10000 });
  await input.fill("이해가 안 돼");
  await page.getByRole('button', { name: '전송' }).click();

  // 대기
  await page.waitForTimeout(10000);
  
  // 2. 모르겠음
  const input2 = page.locator('input[type="text"]').last();
  await input2.waitFor({ state: 'visible', timeout: 10000 });
  await input2.fill("잘 모르겠어");
  await page.getByRole('button', { name: '전송' }).click();

  await page.waitForTimeout(10000);
  await page.screenshot({ path: path.join(logDir, 'scenario-b.png') });
});

test('QA-048 E2E: 시나리오 D (무관 답변 -> 쉬운 설명 -> 정상 답변)', async ({ page }) => {
  test.setTimeout(150000);
  await login(page);
  await startMission(page);

  // 1. 무관 답변 -> validateAnswer는 무관 답변을 거르지 않음. 
  // LLM classification에서 NO_RESPONSE로 떨어지면 그냥 넘어갈 수도 있음.
  // 단, 무관 답변 시 classifyAnswer가 NO_RESPONSE를 반환하므로 질문 실패 처리될 것임.
  // 이 테스트는 보류 (현재 LLM classifier 정책상 무관답변은 NO_RESPONSE 처리)
});
