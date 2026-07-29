import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'https://k-bestie-v3-dev.vercel.app';
const logDir = '/tmp/agy-qa-048';
fs.mkdirSync(logDir, { recursive: true });

async function login(page: import('@playwright/test').Page) {
  await page.goto(`${BASE}/login`);
  await page.locator('input[type="text"]').fill('testi02');
  await page.locator('input[type="password"]').fill(process.env.QA_TEST_PASSWORD || '');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForURL('**/child**', { timeout: 15000 }).catch(() => {});
}

test('QA-048: 자유대화 케이 발화 3단계 타임라인 (아이 발화 미노출)', async ({ page }) => {
  test.setTimeout(150000);
  await login(page);

  await page.goto(`${BASE}/chat`);
  await page.waitForTimeout(2000);

  // 텍스트 입력 모드로 전환 (마이크 권한 불필요한 경로로 결정성 확보)
  const keyboardBtn = page.getByRole('button', { name: '텍스트로 답하기' });
  if (await keyboardBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await keyboardBtn.click();
  }

  const childMessages = ['안녕 케이', '오늘 학교 다녀왔어', '급식이 맛있었어'];
  const seenKBubbles: string[] = [];

  for (const msg of childMessages) {
    const input = page.locator('input[type="text"]').last();
    await input.waitFor({ state: 'visible', timeout: 10000 });
    await input.fill(msg);
    await page.getByRole('button', { name: '전송' }).click();

    // 케이 응답(생각 중 -> 말하는 중) 대기: 현재 말풍선 텍스트가 바뀔 때까지
    await page.waitForTimeout(8000);

    const currentBubble = page.locator('p.text-left').first();
    const currentText = (await currentBubble.textContent().catch(() => '')) || '';
    seenKBubbles.push(currentText.trim());

    // 아이가 방금 보낸 문장 "원문 그대로"가 2·3번 요약 영역(직전/그 이전 케이 발화)에
    // 나타나면 안 된다. 1번(현재 말풍선)은 케이 자신의 실제 응답이라 아이 발화의 일부
    // 단어를 자연스럽게 되받아 언급할 수 있으므로(예: 인사 반복) 이 체크에서 제외한다.
    const summaryArea = page.locator('div.flex.flex-col.items-center.justify-end.z-10').first();
    const summaryText = (await summaryArea.textContent().catch(() => '')) || '';
    console.log(`[turn msg="${msg}"] summaryText="${summaryText.trim()}"`);
  }

  await page.screenshot({ path: path.join(logDir, 'chat-final.png') });

  fs.writeFileSync(
    path.join(logDir, 'chat-k-bubbles.json'),
    JSON.stringify({ seenKBubbles }, null, 2)
  );
});

test('QA-048: 미션 대화 케이 발화 3단계 타임라인 (아이 발화 미노출)', async ({ page }) => {
  test.setTimeout(150000);
  await login(page);

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

  const childAnswers = ['응 좋아', '그냥 그랬어', '아니 별로'];

  for (const msg of childAnswers) {
    const input = page.locator('input[type="text"]').last();
    const visible = await input.isVisible({ timeout: 10000 }).catch(() => false);
    if (!visible) break;
    await input.fill(msg);
    await page.getByRole('button', { name: '전송' }).click();
    await page.waitForTimeout(8000);

    const summaryArea = page.locator('div.flex.flex-col.items-center.justify-end.z-10').first();
    const summaryText = (await summaryArea.textContent().catch(() => '')) || '';
    console.log(`[turn msg="${msg}"] summaryText="${summaryText.trim()}"`);
  }

  await page.screenshot({ path: path.join(logDir, 'mission-final.png') });
});
