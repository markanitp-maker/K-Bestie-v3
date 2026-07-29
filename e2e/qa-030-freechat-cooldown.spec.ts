import { test, expect } from '@playwright/test';
import fs from 'fs';

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'https://k-bestie-v3-dev.vercel.app';
const logDir = '/tmp/agy-qa-030';
fs.mkdirSync(logDir, { recursive: true });

test('QA-030: 휴식 중 /chat 진입 시 서버 기준 휴식 화면 표시 및 자동 재활성화', async ({ page }) => {
  test.setTimeout(90000);

  await page.goto(`${BASE}/login`);
  await page.locator('input[type="text"]').fill('testi02');
  await page.locator('input[type="password"]').fill(process.env.QA_TEST_PASSWORD || '');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForURL('**/child**', { timeout: 15000 }).catch(() => {});

  await page.goto(`${BASE}/chat`);
  await page.waitForTimeout(2000);

  const cooldownText = page.getByText('지금은 잠깐 쉬는 시간이야');
  const isCooldownVisible = await cooldownText.isVisible({ timeout: 5000 }).catch(() => false);
  console.log('COOLDOWN_SCREEN_VISIBLE:', isCooldownVisible);
  await page.screenshot({ path: `${logDir}/1-cooldown.png` });

  // 카운트다운이 0에 도달할 때까지 대기(설정한 40초 + 여유)한 뒤, 새로고침 없이
  // 자동으로 재진입 가능한 화면(마이크/텍스트 버튼 등)으로 전환되는지 확인
  await page.waitForTimeout(45000);
  const stillCooldown = await cooldownText.isVisible({ timeout: 2000 }).catch(() => false);
  console.log('STILL_COOLDOWN_AFTER_WAIT:', stillCooldown);
  await page.screenshot({ path: `${logDir}/2-after-cooldown.png` });
});
