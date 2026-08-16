import { test, expect } from '@playwright/test';

const DEV_BASE = 'https://k-bestie-v3-dev.vercel.app';
const QA_PASSWORD = process.env.QA_TEST_PASSWORD || 'QaDev1c65f921aea7!';

test('C. 064 미션 대화 화면 말풍선 배치 검증', async ({ page }) => {
  test.setTimeout(60000);
  
  await page.goto(`${DEV_BASE}/login`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('아이 아이디를 입력하세요').fill('qatesti-dev');
  await page.getByPlaceholder('비밀번호를 입력하세요').fill(QA_PASSWORD);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForTimeout(2000);

  const laterBtn = page.getByRole('button', { name: '나중에 할게요' });
  if (await laterBtn.count().catch(() => 0)) {
    await laterBtn.click().catch(() => {});
    await page.waitForTimeout(500);
  }

  // Navigate to Mission chat page
  await page.goto(`${DEV_BASE}/child/missions`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  const laterBtn2 = page.getByRole('button', { name: '나중에 할게요' });
  if (await laterBtn2.count().catch(() => 0)) {
    await laterBtn2.click().catch(() => {});
    await page.waitForTimeout(500);
  }

  // Click start if present
  const startBtn = page.getByRole('button', { name: /시작하기|이어하기/ });
  if (await startBtn.count().catch(() => 0)) {
    await startBtn.click().catch(() => {});
    await page.waitForTimeout(2000);
  }

  const viewports = [
    { name: 'C_iphone_390x844.png', width: 390, height: 844 },
    { name: 'C_android_360x800.png', width: 360, height: 800 },
    { name: 'C_android_412x915.png', width: 412, height: 915 },
  ];

  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `/tmp/agy-qa-071-061-064/${vp.name}`, fullPage: false });
  }

  // Inject long text into bubble to verify no mascot overlap or clipping
  const LONG_CHILD_TEXT = "오늘 학교에서 정말 흥미진진하고 재미있는 시험을 봤는데 내가 열심히 준비해서 100점을 받았어! 너무 기뻐서 친구들과 신나게 놀았고 선생님도 잘했다고 크게 칭찬해주셨어!";
  
  await page.evaluate((text) => {
    const pElements = Array.from(document.querySelectorAll('p'));
    if (pElements.length > 0) {
      pElements[pElements.length - 1].textContent = text;
    }
  }, LONG_CHILD_TEXT);
  await page.waitForTimeout(500);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/agy-qa-071-061-064/C_long_text_layout.png', fullPage: false });
  console.log('Captured C screenshots successfully.');
});
