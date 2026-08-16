// 자유대화 정책 확정 반영(20턴 레거시 상한 제거 + 하루 3세션/30분/5분휴식) 검증.
// 텍스트 입력 모드로 실제 React 상태(전송→handleTurnComplete→응답)를 20턴 넘게
// 반복 실행해, 예전에 있던 20턴 하드리밋 effect가 더는 존재하지 않음을 확인한다.
import { test, expect } from '@playwright/test';

const QA_PASSWORD = process.env.QA_TEST_PASSWORD || 'QaDev1c65f921aea7!';

test('20턴 초과해도 자유대화가 끊기지 않는다(레거시 상한 제거 확인)', async ({ page }) => {
  test.setTimeout(180000);

  const bugMessages: string[] = [];
  page.on('console', (msg) => {
    const t = msg.text();
    if (t.includes('오늘 대화는 여기까지')) bugMessages.push(t);
  });

  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  const idInput = page.getByPlaceholder('아이 아이디를 입력하세요');
  await idInput.waitFor({ state: 'visible', timeout: 15000 });
  await idInput.click();
  await idInput.fill('qatesti-dev');
  const pwInput = page.getByPlaceholder('비밀번호를 입력하세요');
  await pwInput.click();
  await pwInput.fill(QA_PASSWORD);
  const loginBtn = page.getByRole('button', { name: '로그인', exact: true });
  await expect(loginBtn).toBeEnabled({ timeout: 5000 });
  await loginBtn.click();
  await page.waitForURL('**/child**', { timeout: 20000 });

  await page.goto('/chat');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // 새 세션으로 시작(과거 축적된 턴의 영향을 받지 않도록) — 이미 대화 중이면 그대로 이어감
  const startBtn = page.getByRole('button', { name: '대화 시작하기' });
  if (await startBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await startBtn.click();
    await page.waitForTimeout(2000);
  }

  // 텍스트 모드로 전환
  const keyboardBtn = page.getByRole('button', { name: '텍스트로 답하기' });
  if (await keyboardBtn.isVisible({ timeout: 8000 }).catch(() => false)) {
    await keyboardBtn.click();
  }

  const messages = [
    '오늘 학교에서 축구했어', '체육 시간이 제일 좋아', '친구랑 놀이터에서 놀았어',
    '숙제는 다 했어', '저녁에 치킨 먹었어', '동생이랑 게임했어', '엄마가 칭찬해줬어',
    '내일은 소풍 가는 날이야', '그림 그리기를 배웠어', '책을 읽었어',
    '자전거를 탔어', '수영장에 갔어', '피아노 연습했어', '강아지랑 산책했어',
    '퍼즐을 맞췄어', '블록을 쌓았어', '노래를 불렀어', '춤을 췄어',
    '별을 봤어', '달리기를 했어', '줄넘기를 했어', '색칠을 했어', '만들기를 했어',
  ];

  let sentCount = 0;
  for (const text of messages) {
    const input = page.locator('input[type="text"]').last();
    const visible = await input.isVisible({ timeout: 5000 }).catch(() => false);
    if (!visible) {
      console.log(`[STOP] input no longer visible after ${sentCount} turns — possible premature termination`);
      break;
    }
    await input.fill(text);
    await page.getByRole('button', { name: '전송' }).click();
    sentCount++;
    await page.waitForTimeout(600);
  }

  console.log(`[RESULT] sent ${sentCount}/${messages.length} turns`);
  console.log(`[RESULT] "오늘 대화는 여기까지" fired ${bugMessages.length} times during the run`);

  await page.waitForTimeout(2000);
  const finalUrl = page.url();
  const dailyLimitVisible = await page.getByText('오늘 대화는 여기까지야!').isVisible({ timeout: 2000 }).catch(() => false);
  console.log('[RESULT] daily-limit screen visible at end:', dailyLimitVisible, 'url:', finalUrl);

  await page.screenshot({ path: '/tmp/qa-freechat-policy-verification.png', fullPage: true });

  // 22개 메시지(>20턴) 전부 정상 전송됐어야 하고, 20턴 시점에 강제 종료된 적이 없어야 한다.
  expect(sentCount).toBe(messages.length);
});
