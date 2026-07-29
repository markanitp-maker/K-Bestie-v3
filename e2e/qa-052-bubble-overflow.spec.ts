import { test, expect } from '@playwright/test';
import fs from 'fs';

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'https://k-bestie-v3-dev.vercel.app';
const logDir = '/tmp/agy-qa-052';
fs.mkdirSync(logDir, { recursive: true });

test.use({ viewport: { width: 393, height: 852 } }); // Galaxy S23 급 폭

test('QA-052: 자유대화 케이 말풍선이 긴 문장에서도 내부 스크롤 없이 전체 표시', async ({ page }) => {
  test.setTimeout(90000);

  await page.goto(`${BASE}/login`);
  await page.locator('input[type="text"]').fill('testi02');
  await page.locator('input[type="password"]').fill(process.env.QA_TEST_PASSWORD || '');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForURL('**/child**', { timeout: 15000 }).catch(() => {});

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

  const longMsg = '오늘 학교에서 정말 많은 일이 있었어. 아침에는 친구랑 조금 다퉜다가 점심시간에 화해했고, 체육 시간에는 축구를 했는데 우리 팀이 이겼어. 그리고 수업 끝나고는 도서관에서 책도 읽었어.';

  const input = page.locator('input[type="text"]').last();
  await input.waitFor({ state: 'visible', timeout: 10000 });
  await input.fill(longMsg);
  await page.getByRole('button', { name: '전송' }).click();
  await page.waitForTimeout(8000);

  // 1번(현재 발화) 말풍선 컨테이너 — overflow 되어 있지 않은지(scrollHeight<=clientHeight) 확인
  const currentBubbleP = page.locator('p.text-left').first();
  const box = await currentBubbleP.evaluate((el) => {
    const container = el.parentElement!;
    return {
      containerScrollHeight: container.scrollHeight,
      containerClientHeight: container.clientHeight,
      containerOverflowY: getComputedStyle(container).overflowY,
      textLength: el.textContent?.length ?? 0,
    };
  });
  console.log('CURRENT_BUBBLE_CHECK:', JSON.stringify(box));

  await page.screenshot({ path: `${logDir}/long-message.png`, fullPage: true });

  expect(box.containerOverflowY).not.toBe('auto');
  expect(box.containerOverflowY).not.toBe('scroll');
  expect(box.containerScrollHeight).toBeLessThanOrEqual(box.containerClientHeight + 2);
});
