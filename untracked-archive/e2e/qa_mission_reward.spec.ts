import { test, expect } from '@playwright/test';
import fs from 'fs';

test('mission completion reward modal and navigation', async ({ page }) => {
  test.setTimeout(700000);
  const screenshotsDir = '/tmp/agy-qa-035-lite';
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  const missionFlowLogs: string[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[MissionFlow]')) missionFlowLogs.push(`${Date.now()}: ${text}`);
  });

  // 1. Login as testi02 (child-role login for child_id b9a5dac7 — no separate profile-switch step)
  await page.goto('https://k-bestie-v3-dev.vercel.app/login');
  await page.locator('input[type="text"]').fill('testi02');
  await page.locator('input[type="password"]').fill(process.env.TESTI02_PASSWORD || '');
  await page.locator('button[type="submit"]').click();

  await page.waitForURL('**/child/home', { timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${screenshotsDir}/1-child-home.png` });

  // 2. Go to mission screen
  await page.locator('a[href="/child/missions"]').click();
  await page.waitForURL('**/child/missions', { timeout: 10000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${screenshotsDir}/2-mission-start.png` });

  // If today's mission was already completed (e.g. from a prior test run),
  // confirm restart to get a fresh session.
  const restartButton = page.locator('button:has-text("다시 할래요")');
  if (await restartButton.isVisible().catch(() => false)) {
    await restartButton.click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${screenshotsDir}/2b-after-restart.png` });
  }

  // Switch to text mode if not already (voice mode is default). Retry the click
  // since the button can be transiently disabled right after a restart.
  const textModeToggle = page.locator('button[aria-label="텍스트로 답하기"]');
  const textInputCheck = page.locator('input[placeholder="케이에게 텍스트로 답하기..."]');
  for (let attempt = 0; attempt < 5; attempt++) {
    if (await textInputCheck.isVisible().catch(() => false)) break;
    if (await textModeToggle.isEnabled().catch(() => false)) {
      await textModeToggle.click().catch(() => {});
    }
    await page.waitForTimeout(2000);
  }
  await page.screenshot({ path: `${screenshotsDir}/2c-after-text-toggle.png` });

  // 3. Answer with plausible, on-topic-agnostic affirmative replies (generic
  // "테스트 답변 N" strings get judged as off-topic and don't advance progress).
  // The session may resume partial progress from a previous run, and not every
  // reply is guaranteed to be judged valid, so loop adaptively with a safety cap
  // rather than assuming exactly 5 sends reach completion.
  const answers = [
    '요즘 그림 그리는 게 재밌어졌어',
    '친구랑 같이 놀면 제일 좋을 것 같아',
    '오늘 학교에서 재밌는 일이 있었어',
    '기분이 좋았다가 조금 슬프기도 했어',
    '주말에 가족이랑 나들이 가고 싶어',
    '요즘 게임하는 게 제일 재밌어',
    '학교 끝나고 친구랑 놀았어',
    '엄마랑 같이 시간 보내는 게 좋아',
    '요즘 축구하는 걸 좋아하게 됐어',
    '집에서 쉬는 게 제일 좋아',
    '요즘 그림 그리는 게 재밌어졌어',
    '친구랑 같이 놀면 제일 좋을 것 같아',
    '오늘 학교에서 재밌는 일이 있었어',
    '기분이 좋았다가 조금 슬프기도 했어',
    '주말에 가족이랑 나들이 가고 싶어',
    '요즘 게임하는 게 제일 재밌어',
    '학교 끝나고 친구랑 놀았어',
    '엄마랑 같이 시간 보내는 게 좋아',
    '요즘 축구하는 걸 좋아하게 됐어',
    '집에서 쉬는 게 제일 좋아',
  ];
  const modalLocator = page.getByRole('heading', { name: /황금열쇠를 받았어요/ });
  let rewardShown = false;
  for (let i = 0; i < answers.length; i++) {
    const input = page.locator('input[placeholder="케이에게 텍스트로 답하기..."]');
    await input.waitFor({ state: 'visible', timeout: 15000 });
    await input.fill(answers[i]);
    await page.locator('button[aria-label="전송"]').click();
    await page.waitForTimeout(8000); // K's response + next question round trip
    await page.screenshot({ path: `${screenshotsDir}/3-mission-step-${i + 1}.png` });

    const completedSpeech = page.locator('text=미션을 모두 완료했어');
    const justCompleted = await completedSpeech.isVisible().catch(() => false);

    if (justCompleted) {
      // Give the missionCompletionFlow fallback (~8.7s worst case) a dedicated window,
      // then dump captured [MissionFlow] console logs to see exactly what fired.
      for (let extraWait = 0; extraWait < 6; extraWait++) {
        if (await modalLocator.isVisible().catch(() => false)) break;
        await page.waitForTimeout(5000);
      }
      await page.screenshot({ path: `${screenshotsDir}/3b-mission-step-${i + 1}-extra-wait.png` });
      console.log('--- MissionFlow logs at completion point ---');
      for (const l of missionFlowLogs) console.log(l);
      console.log('--- end MissionFlow logs ---');
      if (await modalLocator.isVisible().catch(() => false)) {
        rewardShown = true;
      }
      break;
    }
  }

  // 4. Verify reward modal
  if (!rewardShown) {
    await page.waitForTimeout(3000);
  }
  await page.screenshot({ path: `${screenshotsDir}/4-mission-complete.png` });
  await expect(modalLocator).toBeVisible({ timeout: 20000 });

  const closeBtnText = page.locator('button:has-text("닫기")');
  await expect(closeBtnText).toBeVisible();

  // 5. Close and verify navigation
  await closeBtnText.click();
  await page.waitForURL('**/child/home', { timeout: 10000 });
  await page.screenshot({ path: `${screenshotsDir}/5-after-close.png` });
  expect(page.url()).toContain('/child/home');
});
